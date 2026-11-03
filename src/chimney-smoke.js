import * as THREE from 'three';

// update(absoluteSeconds, state): the first argument is ABSOLUTE seconds, not dt;
// finite state.time takes priority (including while paused, for fixed/rewind QA).
// With no explicit state.time, paused freezes the last sampled absolute clock.
// This pool consumes no weather RNG, owns no render target, and derives every
// particle age/position from that clock. sampleAt is pure and deterministic for
// the same time, seed, origin and supplied wind/field snapshot.
export const CHIMNEY_SMOKE_CONFIG = Object.freeze({
  count: 64,
  lifetime: 8.4,
  height: 1.72,
  // Source opacity reaches its plateau in the first ~0.03 world units. The
  // previous long birth fade made the mouth empty and the upper plume denser.
  fadeIn: Object.freeze([0.0008, 0.022]),
  fadeOut: Object.freeze([0.62, 0.94]),
  peakOpacity: 0.42,
  concentrationGainFrom231: 1.5,
  windAdvectionScale: 0.30,
  dilutionRate: 2.65,
  bodyWidthScale: 1.60,
  windResponseSeconds: 0.72,
  clusterPeriod: 1.75,
  clusterDensityFloor: 0.95,
  clusterDensityGain: 1.65,
});

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fract = x => x - Math.floor(x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
function seededRandom(seed) {
  let s = seed | 0;
  return () => { s = s + 0x6d2b79f5 | 0; let v = Math.imul(s ^ s >>> 15, 1 | s); v = v + Math.imul(v ^ v >>> 7, 61 | v) ^ v; return ((v ^ v >>> 14) >>> 0) / 4294967296; };
}

// The guard intervals on BOTH sides of the modulo are exactly transparent.
// Smoothstep makes the alpha and its first derivative zero at each boundary.
export function chimneySmokeEnvelope(age) {
  const c = CHIMNEY_SMOKE_CONFIG;
  return smooth(...c.fadeIn, age) * (1 - smooth(...c.fadeOut, age));
}

// Concentration, unlike occupied width, decreases as a parcel entrains air.
// This is an authored age envelope rather than a fluid or combustion solver.
export function chimneySmokeDilution(age) {
  return Math.exp(-CHIMNEY_SMOKE_CONFIG.dilutionRate * clamp(age));
}

const vertexShader = `
attribute vec3 aCenter;
attribute vec2 aScale;
attribute vec3 aParticle;
attribute vec4 aCluster;
varying vec2 vUv;
varying float vAge, vSeed, vOpacity;
varying vec4 vCluster;
void main() {
  vUv = uv; vAge = aParticle.x; vSeed = aParticle.y; vOpacity = aParticle.z; vCluster = aCluster;
  // Transform the CENTER to camera space, then add camera-space right/up.
  // No camera quaternion, point sprite coordinate, or stale CPU basis is needed.
  vec4 center = modelViewMatrix * vec4(aCenter, 1.0);
  center.xy += position.xy * aScale;
  gl_Position = projectionMatrix * center;
}`;

const fragmentShader = `
uniform vec3 uColor;
uniform vec4 uClock;
varying vec2 vUv;
varying float vAge, vSeed, vOpacity;
varying vec4 vCluster;
float hash3(vec3 p) {
  p = fract(p * .3183099 + vec3(.17, .31, .23));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p) {
  vec3 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(cell), hash3(cell+vec3(1,0,0)), f.x),
                 mix(hash3(cell+vec3(0,1,0)), hash3(cell+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(cell+vec3(0,0,1)), hash3(cell+vec3(1,0,1)), f.x),
                 mix(hash3(cell+vec3(0,1,1)), hash3(cell+vec3(1,1,1)), f.x), f.y), f.z);
}
float filteredNoise(vec3 p) {
  // As a wisp becomes subpixel, each band approaches its own mean. Thin smoke
  // must not shimmer or disappear simply because its high band is undersampled.
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(noise3(p), .5, smoothstep(.35, 1.15, footprint));
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float quadEdge = (1.0 - smoothstep(.84, 1.0, abs(p.x))) * (1.0 - smoothstep(.86, 1.0, abs(p.y)));
  // Neighbouring emission times share a rolling, expanding packet. The coarse
  // field is coherent across their overlapping quads; seed only perturbs fine
  // fibres, so the column does not become independent spherical sprite puffs.
  p.x += sin(p.y * 2.4 + vCluster.y * 1.4 + uClock.x * .45) * (.08 + vCluster.x * .085);
  p.y += sin(p.x * 2.2 + vCluster.z * 1.7) * .055 * vCluster.x;
  float radius = dot(p, p);
  float edge = (1.0 - smoothstep(.42, 1.0, radius)) * quadEdge;
  float soft = exp(-radius * 1.85) * edge;
  vec3 q = vec3(p.x * 1.7 + vCluster.y * .45, p.y * .76 - vAge * 1.9 + vCluster.z * .4, vCluster.y * 1.2 + vCluster.z * 1.7);
  q += vec3(uClock.x * .31, uClock.y * .24 + uClock.z * .2, uClock.w * .34);
  float textureDensity = filteredNoise(q) * .76 + filteredNoise(q * 2.37 + vec3(vSeed * .3, 5.7, vSeed * .2)) * .24;
  float alpha = soft * (.43 + textureDensity * .57) * vOpacity;
  // Every smoke fragment has the SAME RGB. Normal alpha composition within
  // this one draw is therefore order independent, even as quads pass each other.
  // No additive emission, dark premultiplied fringe, or per-particle tint halo.
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createChimneySmoke({ origin = { x: 0, y: 0, z: 0 }, seed = 42, field = null } = {}) {
  const c = CHIMNEY_SMOKE_CONFIG;
  const random = seededRandom((seed | 0) ^ 0x39bc1657);
  const phase = new Float64Array(c.count), seeds = new Float64Array(c.count), variation = new Float64Array(c.count);
  const plumePhase = random() * Math.PI * 2;
  for (let i = 0; i < c.count; i++) {
    phase[i] = (i + random() * .12) / c.count;
    seeds[i] = random();
    variation[i] = .93 + random() * .14;
  }

  const centers = new Float32Array(c.count * 3), scales = new Float32Array(c.count * 2), particles = new Float32Array(c.count * 3), clusters = new Float32Array(c.count * 4);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
  geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aParticle', new THREE.InstancedBufferAttribute(particles, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aCluster', new THREE.InstancedBufferAttribute(clusters, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = c.count;
  const material = new THREE.ShaderMaterial({
    name: 'continuous-clustered-warm-grey-chimney-smoke',
    uniforms: { uColor: { value: new THREE.Color() }, uClock: { value: new THREE.Vector4() } },
    vertexShader, fragmentShader,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.NormalBlending, premultipliedAlpha: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'cabin-continuous-chimney-smoke';
  object.frustumCulled = false;
  object.renderOrder = 2;
  const source = new THREE.Vector3();
  const sampledWind = new THREE.Vector2(), filteredWind = new THREE.Vector2();
  let previousTime = null, disposed = false;
  const stats = {
    count: c.count, drawCalls: 1, quads: c.count, triangles: c.count * 2,
    lifetime: c.lifetime, height: c.height,
    assets: 0, renderTargets: 0, blend: 'normal', time: 0,
    active: 0, opacitySum: 0, centroid: { x: 0, y: 0, z: 0 },
    wind: { x: 0, z: 0 }, concentrationGain: c.concentrationGainFrom231, windAdvectionScale: c.windAdvectionScale, disposed: false,
  };

  function setOrigin(value) {
    source.set(finite(value?.x), finite(value?.y), finite(value?.z));
    object.position.copy(source);
    return object;
  }
  setOrigin(origin);

  function resolveTime(time, state = {}) {
    if (Number.isFinite(state.time)) return state.time;
    if (state.paused && previousTime !== null) return previousTime;
    return finite(time, previousTime ?? 0);
  }

  function resolveWind(state, target) {
    // The wind toggle stops imposed transport immediately; buoyant ascent and
    // the plume's own small packet rolls continue under the same clock.
    if (state.windPaused) return target.set(0, 0);
    // smokeWind is an optional fixed-QA override in the same world X/Z units
    // as EnvironmentField.sampleWind; Vector2.y means world Z.
    const explicit = state.smokeWind;
    if (explicit) return target.set(finite(explicit.x), finite(explicit.z ?? explicit.y));
    if (field?.sampleWind) {
      const result = field.sampleWind(source.x, source.z, target);
      if (result && result !== target) target.set(finite(result.x), finite(result.z ?? result.y));
      if (Number.isFinite(target.x) && Number.isFinite(target.y)) return target;
    }
    const wind = state.windVector2 ?? state.wind ?? { x: .85, y: .25 };
    const strength = clamp(finite(state.windStrength, .12));
    return target.set(finite(wind.x) * strength, finite(wind.z ?? wind.y) * strength);
  }

  function particleAt(i, time, state, wx, wz, out) {
    const age = fract(time / c.lifetime + phase[i]);
    const root = smooth(0, 1, age), age2 = age * age;
    const sway = time * .235 + plumePhase;
    const wake = .18 * age2 + .72 * age2 * age;
    // A concentration label is sampled at EMISSION, then advected with the
    // parcel. Close birth times share the same packet at every height. Birth
    // time changes by a lifetime only when its quad is in the alpha=0 guard.
    const birthTime = time - age * c.lifetime;
    const emissionPhase = Math.PI * 2 * (birthTime / c.clusterPeriod + .075 * Math.sin(birthTime * .43 + plumePhase));
    const pulse = Math.pow(.5 + .5 * Math.cos(emissionPhase), 2.2);
    const emissionStrength = .82 + .18 * Math.sin(birthTime * .31 + plumePhase) ** 2;
    const density = c.clusterDensityFloor + c.clusterDensityGain * pulse * emissionStrength;
    const expansion = 1 + (.17 + .45 * smooth(.06, .72, age)) * pulse;
    const windSpeed = Math.hypot(wx, wz);
    const roll = plumePhase + birthTime * .63 + age * (6.8 + Math.min(windSpeed, 2) * .8);
    const rollRadius = (.018 + age * .062) * root * (.35 + .65 * pulse);
    // Shared centerline makes a column, rather than independently wobbling balls.
    // Every lateral term vanishes at the chimney and wind enters quadratically.
    const x = wx * wake * c.windAdvectionScale + Math.sin(age * 5.2 - sway) * (.016 + age * .045) * root + Math.sin(roll) * rollRadius + (seeds[i] - .5) * .014 * root;
    const z = wz * wake * c.windAdvectionScale + Math.cos(age * 4.4 - sway * .83) * (.011 + age * .029) * root + Math.cos(roll * .84 + .3) * rollRadius * .72 + (seeds[i] - .5) * .009 * root;
    const y = c.height * (.76 * age + .24 * age2);
    const rain = clamp(finite(state.effectiveRain ?? state.rain));
    const disperse = 1 - .18 * smooth(.35, .9, age) * pulse;
    const dilution = chimneySmokeDilution(age);
    const alpha = chimneySmokeEnvelope(age) * c.peakOpacity * density * dilution * disperse * (1 - rain * .13);
    out.id = i; out.age = age; out.x = x; out.y = y; out.z = z;
    out.worldX = source.x + x; out.worldY = source.y + y; out.worldZ = source.z + z;
    // Keep the aperture narrow, then make the body distinctly readable in the
    // landscape. This widens real coverage, rather than changing light/bloom.
    const bodyWidth = 1 + (c.bodyWidthScale - 1) * smooth(.04, .30, age);
    out.width = (.046 + .17 * Math.pow(age, 1.1)) * variation[i] * expansion * bodyWidth;
    // Shorter overlapping quads retain a thin connection without convolving the
    // two-second emission packets into the previous uniform column.
    out.height = (.064 + .09 * age) * variation[i] * (1 + .10 * pulse);
    out.opacity = alpha; out.seed = seeds[i]; out.dilution = dilution;
    out.birthTime = birthTime; out.clusterPulse = pulse; out.densityMultiplier = density;
    out.expansion = expansion; out.clusterRoll = roll; out.bodyWidth = bodyWidth;
    out.flowSin = Math.sin(birthTime * .23 + plumePhase); out.flowCos = Math.cos(birthTime * .23 + plumePhase);
    out.verticalVelocity = c.height * (.76 + .48 * age) / c.lifetime;
    return out;
  }

  // Pure absolute-time evaluation. Rewind, frame skipping, and duplicate samples
  // consume no RNG and do not change this or the weather/field state. Pass a fixed
  // smokeWind for a state snapshot whose field will later continue changing.
  function sampleAt(time = 0, state = {}) {
    const t = Number.isFinite(state.time) ? state.time : finite(time);
    const wind = resolveWind(state, new THREE.Vector2());
    const samples = [], centroid = { x: 0, y: 0, z: 0 };
    let opacitySum = 0, active = 0;
    for (let i = 0; i < c.count; i++) {
      const p = particleAt(i, t, state, wind.x, wind.y, {});
      samples.push(p); opacitySum += p.opacity;
      if (p.opacity > 0) active++;
      centroid.x += p.worldX * p.opacity; centroid.y += p.worldY * p.opacity; centroid.z += p.worldZ * p.opacity;
    }
    if (opacitySum > 0) for (const axis of ['x', 'y', 'z']) centroid[axis] /= opacitySum;
    return { time: t, wind: { x: wind.x, z: wind.y }, opacitySum, active, centroid, particles: samples };
  }

  const scratchParticle = {};
  function update(time = 0, state = {}) {
    if (disposed) return stats;
    const t = resolveTime(time, state), dt = previousTime === null ? 0 : t - previousTime;
    resolveWind(state, sampledWind);
    // The ONLY stateful part is live forcing response, never particle simulation.
    // A pause at the SAME clock must preserve the in-flight response. Only an
    // actual paused clock change (fixed/seek), backwards seek, long jump, first
    // public frame, or explicit QA wind replaces the current forcing snapshot.
    // Normal playback uses an exact exponential response, without a dt clamp.
    const seek = dt < 0 || dt > c.lifetime || (state.paused && dt !== 0);
    if (previousTime === null || seek || state.smokeWind || state.windPaused) filteredWind.copy(sampledWind);
    else if (!state.paused && dt > 0) filteredWind.lerp(sampledWind, -Math.expm1(-dt / c.windResponseSeconds));
    previousTime = t;
    let total = 0, cx = 0, cy = 0, cz = 0, active = 0;
    for (let i = 0; i < c.count; i++) {
      const p = particleAt(i, t, state, filteredWind.x, filteredWind.y, scratchParticle), j = i * 3, k = i * 2, q = i * 4;
      centers[j] = p.x; centers[j + 1] = p.y; centers[j + 2] = p.z;
      scales[k] = p.width; scales[k + 1] = p.height;
      particles[j] = p.age; particles[j + 1] = p.seed; particles[j + 2] = p.opacity;
      clusters[q] = p.clusterPulse; clusters[q + 1] = p.flowSin; clusters[q + 2] = p.flowCos; clusters[q + 3] = Math.sin(p.clusterRoll);
      total += p.opacity; cx += p.worldX * p.opacity; cy += p.worldY * p.opacity; cz += p.worldZ * p.opacity;
      if (p.opacity > 0) active++;
    }
    geometry.attributes.aCenter.needsUpdate = true;
    geometry.attributes.aScale.needsUpdate = true;
    geometry.attributes.aParticle.needsUpdate = true;
    geometry.attributes.aCluster.needsUpdate = true;
    const day = clamp(finite(state.daylight, 1)), rain = clamp(finite(state.effectiveRain ?? state.rain));
    const darken = 1 - rain * .13;
    material.uniforms.uColor.value.setRGB((.075 + .485 * day) * darken, (.078 + .467 * day) * darken, (.080 + .435 * day) * darken);
    // Bounded continuous clocks avoid GPU float precision loss after long runs.
    material.uniforms.uClock.value.set(Math.sin(t * .069), Math.cos(t * .069), Math.sin(t * .037), Math.cos(t * .037));
    Object.assign(stats, { time: t, active, opacitySum: total });
    Object.assign(stats.centroid, { x: cx / total, y: cy / total, z: cz / total });
    Object.assign(stats.wind, { x: filteredWind.x, z: filteredWind.y });
    return stats;
  }

  function diagnostics() {
    return { ...stats, centroid: { ...stats.centroid }, wind: { ...stats.wind },
      phases: Array.from(phase), origin: source.toArray(), fadeIn: [...c.fadeIn], fadeOut: [...c.fadeOut],
      clusters: { period: c.clusterPeriod, densityFloor: c.clusterDensityFloor, densityGain: c.clusterDensityGain, bodyWidthScale: c.bodyWidthScale, flow: 'emission-labelled packets expand, roll and disperse as they rise' },
      sourceProfile: { fullOpacityHeight: c.height * (.76 * c.fadeIn[1] + .24 * c.fadeIn[1] ** 2), dilutionRate: c.dilutionRate, meaning: 'short C1 birth fade; parcel concentration decreases while width expands; source density measured separately from screen coverage' },
      filtering: 'value-noise bands blend to mean by derivative footprint',
      ordering: 'same RGB on every particle; normal alpha overlap is order independent',
      forcing: 'live field low-pass; same-time pause freezes; fixed clock seek/sampleAt uses supplied wind snapshot' };
  }

  function dispose() {
    if (disposed) return;
    disposed = true; stats.disposed = true;
    object.removeFromParent(); geometry.dispose(); material.dispose();
  }
  update(0, { time: 0, daylight: 1 });
  // Priming GPU buffers is not a public scene frame. The first scene update
  // samples its newly updated field directly, even when it starts paused at 0.
  previousTime = null;
  return { object, stats, update, setOrigin, sampleAt, diagnostics, dispose };
}
