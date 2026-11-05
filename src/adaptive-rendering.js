// Pixel-ratio policy only: scene complexity, animation and update cadence stay
// owned by the caller. Time arguments use the same monotonic milliseconds as RAF.
export const ADAPTIVE_RENDERING_DEFAULTS = Object.freeze({
  initialRatio: 0.85,
  minimumRatio: 0.55,
  smoothRatio: 0.72,
  recordingRatio: 0.72,
  windowMs: 1500,
  warmupMs: 3000,
  cooldownMs: 3000,
  frameBudgetMs: 1000 / 30,
  slowMedianMs: (1000 / 30) * 1.1,
  slowP90Ms: 45,
  fastMedianMs: 25,
  fastP90Ms: 30,
  fastWindowsToRaise: 3,
  decreaseStep: 0.15,
  increaseStep: 0.1,
  maximumFrameMs: 250,
});

const MODES = new Set(['auto', 'clear', 'smooth', 'record']);
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const timestamp = (value) => Number.isFinite(value) ? value : clock();

export function createAdaptiveRendering({
  nativePixelRatio = 1,
  maxRatio = 1.5,
  mode = 'auto',
  viewport = null,
  onRatio = () => {},
  onMode = () => {},
} = {}) {
  if (!MODES.has(mode)) throw new TypeError(`Unknown rendering mode: ${mode}`);
  if (typeof onRatio !== 'function' || typeof onMode !== 'function') throw new TypeError('Render callbacks must be functions');
  const config = ADAPTIVE_RENDERING_DEFAULTS;
  let native = positive(nativePixelRatio, 1);
  const maximum = positive(maxRatio, 1.5);
  let currentMode = mode;
  const getCeiling = () => {
    const device = Math.min(native, maximum);
    if (currentMode === 'clear' || !viewport) return device;
    const {width, height} = viewport;
    if (!(width > 0 && height > 0)) return device;
    const cap = currentMode === 'record'
      ? Math.min(1440 / width, 900 / height)
      : Math.sqrt(1600000 / (width * height));
    return Math.min(device, cap);
  };
  const requestedRatio = () => ({
    auto: config.initialRatio, clear: ceiling,
    smooth: config.smoothRatio, record: config.recordingRatio,
  })[currentMode];
  let ceiling = getCeiling();
  let floor = Math.min(ceiling, config.minimumRatio);
  let ratio = Math.min(ceiling, requestedRatio());
  let armed = false;
  let visible = true;
  let disposed = false;
  let warmupUntil = null;
  let nextChangeAt = -Infinity;
  let lastSampleAt = null;
  let windowStart = null;
  let samples = [];
  let windowStalls = 0, clampedSlowSamples = 0;
  let fastWindows = 0;
  let medianMs = null;
  let p90Ms = null;
  let lastWindowSamples = 0;
  let evaluatedWindows = 0;
  let adjustments = 0;
  let lastChangeAt = null;
  let lastReason = 'initial';
  let classification = 'unmeasured';
  const ignored = { warmup: 0, hidden: 0, invalid: 0, clock: 0 };

  const clearWindow = () => {
    samples = [];
    windowStart = null;
    windowStalls = 0;
    fastWindows = 0;
  };

  const restart = (now, reason) => {
    clearWindow();
    lastSampleAt = null;
    medianMs = null;
    p90Ms = null;
    lastWindowSamples = 0;
    classification = 'unmeasured';
    warmupUntil = armed ? now + config.warmupMs : null;
    nextChangeAt = now + config.warmupMs;
    lastReason = reason;
  };

  const applyRatio = (next, now, reason) => {
    // Rounding the steps avoids accumulating fractional drift at both bounds.
    next = Math.max(floor, Math.min(ceiling, Math.round(next * 1000) / 1000));
    if (Math.abs(next - ratio) < 0.000001) return false;
    const previousRatio = ratio;
    ratio = next;
    adjustments += 1;
    lastChangeAt = now;
    lastReason = reason;
    nextChangeAt = now + config.cooldownMs;
    clearWindow();
    onRatio(ratio, { previousRatio, mode: currentMode, reason, now });
    return true;
  };

  const api = {
    get mode() { return currentMode; },
    get ratio() { return ratio; },
    get nativePixelRatio() { return native; },
    get limits() { return Object.freeze({ floor, ceiling }); },
    get stats() {
      return Object.freeze({
        mode: currentMode, ratio, ready: armed, visible, disposed,
        status: disposed ? 'disposed' : !armed ? 'waiting' : !visible ? 'hidden' : currentMode !== 'auto' ? 'fixed' : medianMs === null ? 'warming-or-sampling' : 'sampling',
        frameBudgetMs: config.frameBudgetMs,
        medianMs, p90Ms, lastWindowSamples, evaluatedWindows,
        sampleCount: samples.length, windowStart, warmupUntil,
        fastWindows, nextChangeAt, adjustments, lastChangeAt, lastReason,
        classification, clampedSlowSamples, ignored: Object.freeze({ ...ignored }),
      });
    },

    // Call once after the completed scene/composer is ready to render. Repeated
    // calls do not restart loading metrics, compilation warmup or sampling.
    ready(now) {
      if (disposed || armed) return api;
      armed = true;
      restart(timestamp(now), 'ready');
      return api;
    },

    setMode(nextMode, now) {
      if (!MODES.has(nextMode)) throw new TypeError(`Unknown rendering mode: ${nextMode}`);
      if (disposed || currentMode === nextMode) return api;
      now = timestamp(now);
      currentMode = nextMode;
      restart(now, 'mode-change');
      ceiling = getCeiling();
      floor = Math.min(ceiling, config.minimumRatio);
      applyRatio(requestedRatio(), now, 'mode-change');
      onMode(currentMode);
      return api;
    },

    // DOM visibility belongs to the caller; no hidden frame enters a window.
    setVisible(nextVisible, now) {
      if (disposed || visible === Boolean(nextVisible)) return api;
      visible = Boolean(nextVisible);
      restart(timestamp(now), visible ? 'visible' : 'hidden');
      return api;
    },

    // Use on a viewport/DPR change, including a size change at the same DPR.
    // Auto keeps its current ratio within the new bounds instead of jumping up.
    resize(nextNativePixelRatio = native, now, nextViewport = viewport) {
      if (disposed) return api;
      now = timestamp(now);
      native = positive(nextNativePixelRatio, native);
      viewport = nextViewport;
      ceiling = getCeiling();
      floor = Math.min(ceiling, config.minimumRatio);
      restart(now, 'resize');
      applyRatio(currentMode === 'auto' ? ratio : requestedRatio(), now, 'resize');
      return api;
    },

    // Explicit measurement reset for a scene/effect change. This preserves the
    // selected mode and ratio; normal world reset need not call this at all.
    reset(now, reason = 'measurement-reset') {
      if (!disposed) restart(timestamp(now), reason);
      return api;
    },

    sample(frameMs, now) {
      if (disposed || !armed) return false;
      now = timestamp(now);
      if (!visible) { ignored.hidden += 1; return false; }
      if (!Number.isFinite(frameMs) || frameMs <= 0) {
        ignored.invalid += 1;
        clearWindow();
        return false;
      }
      if (lastSampleAt !== null && now <= lastSampleAt) {
        ignored.clock += 1;
        clearWindow();
        lastSampleAt = null;
        return false;
      }
      lastSampleAt = now;
      if (now < warmupUntil) { ignored.warmup += 1; return false; }
      if (currentMode !== 'auto') return false;
      if (windowStart === null) windowStart = now;
      // Keep real visible stalls in the tail distribution. Bounding their
      // weight avoids treating a single interruption as unlimited frame cost.
      if (frameMs > config.maximumFrameMs) { windowStalls += 1; clampedSlowSamples += 1; }
      samples.push(Math.min(frameMs, config.maximumFrameMs));
      // Six samples still allow a valid 4–5 fps stream to lower pixel cost;
      // a high fixed sample count would strand the slowest devices forever.
      if (now - windowStart < config.windowMs || samples.length < 6) return false;
      const sorted = samples.slice().sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      p90Ms = sorted[Math.ceil(sorted.length * 0.9) - 1];
      lastWindowSamples = sorted.length;
      evaluatedWindows += 1;
      samples = [];
      windowStart = null;
      classification = medianMs > config.slowMedianMs || p90Ms > config.slowP90Ms || windowStalls >= 2 ? 'slow'
        : !windowStalls && medianMs < config.fastMedianMs && p90Ms < config.fastP90Ms ? 'fast' : 'balanced';
      windowStalls = 0;
      fastWindows = classification === 'fast' ? fastWindows + 1 : 0;
      if (now < nextChangeAt) return false;
      if (classification === 'slow') return applyRatio(ratio - config.decreaseStep, now, 'slow-window');
      if (fastWindows >= config.fastWindowsToRaise) return applyRatio(ratio + config.increaseStep, now, 'sustained-headroom');
      return false;
    },

    dispose() {
      disposed = true;
      clearWindow();
    },
  };
  // The caller reads .ratio for initial renderer creation. No callback fires
  // until an effective ratio change, so construction cannot reference itself.
  return api;
}
