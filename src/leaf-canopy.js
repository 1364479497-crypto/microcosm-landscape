// Per-tree, geometry-weighted canopy light transfer. This is a low-frequency
// foliage self-occlusion approximation, not a replacement for rendered shadows.
// No random numbers, tree transforms, geometry, colours, lights or draws change.

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const LEAF_CANOPY_DEFAULTS = Object.freeze({
  resolution: 12,
  extinction: 1.45,
  minAO: .28,
  aoPower: .70,
  leafArea: .2276504,
  needleArea: .1462299,
});

// Direction is in the undeformed vegetation/tree axes. Rotate a sun direction
// back through the existing wind transform before evaluating this function.
// Squared signed axis weights form a continuous six-lobe approximation; this
// does not resolve narrow rays between individual leaves. Transfer values are
// strictly attenuation: the caller owns sun radiance, shadow and transmission.
export const LEAF_CANOPY_GLSL = `
float leafCanopyEscape(vec3 direction, vec4 transferA, vec4 transferB) {
  vec3 d = direction * inversesqrt(max(dot(direction, direction), 0.000000000001));
  vec3 e = vec3(d.x >= 0.0 ? transferA.x : transferA.y,
                d.y >= 0.0 ? transferA.z : transferA.w,
                d.z >= 0.0 ? transferB.x : transferB.y);
  return clamp(dot(d * d, e), 0.0, 1.0);
}
`;

function rotated(q, x, y, z) {
  // Quaternion-vector multiplication without a dependency or temporary objects.
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + q.y * tz - q.z * ty,
    y + q.w * ty + q.z * tx - q.x * tz,
    z + q.w * tz + q.x * ty - q.y * tx];
}

function boundsAndSamples(items, needle, config) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const samples = [], cohorts = new Map();
  for (const d of items) {
    const size = d.size, axis = rotated(d.q, 0, 1, 0);
    const xAxis = rotated(d.q, 1, 0, 0), zAxis = rotated(d.q, 0, 0, 1);
    const center = [d.p.x + axis[0] * size * .52, d.p.y + axis[1] * size * .52, d.p.z + axis[2] * size * .52];
    for (let k = 0; k < 3; k++) {
      const half = size * (Math.abs(axis[k]) * .54 + (needle ? .40 : .22) * Math.abs(xAxis[k]) + (needle ? .40 : .10) * Math.abs(zAxis[k]));
      lo[k] = Math.min(lo[k], center[k] - half); hi[k] = Math.max(hi[k], center[k] + half);
    }
    const secondary = d.meta.secondary;
    const shootDistance = Math.hypot(center[0] - secondary[0], center[1] - secondary[1], center[2] - secondary[2]);
    cohorts.set(secondary, Math.max(cohorts.get(secondary) || 0, shootDistance));
    // Measured unit-primitive surface: seven-triangle leaf .2276504; the
    // twenty-two needle triangles .1462299 (green shoot axis excluded).
    // Half the surface is mean projected area for unresolved orientations.
    samples.push({ d, center, area: .5 * (needle ? config.needleArea : config.leafArea) * size * size, secondary, shootDistance });
  }
  return { lo, hi, samples, cohorts };
}

function interpolants(point, lo, cell, n) {
  const axes = point.map((v, k) => {
    const f = clamp((v - lo[k]) / cell[k] - .5, 0, n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    return [i, f - i];
  });
  const ids = [], weights = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    ids.push(axes[0][0] + x + n * (axes[1][0] + y + n * (axes[2][0] + z)));
    weights.push((x ? axes[0][1] : 1 - axes[0][1]) * (y ? axes[1][1] : 1 - axes[1][1]) * (z ? axes[2][1] : 1 - axes[2][1]));
  }
  return { ids, weights, fractions: axes.map(a => a[1]) };
}

function percentile(values, p) { return values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? 1; }
function summary(values) {
  if (!values.length) return { count: 0, min: 1, p10: 1, median: 1, p90: 1, max: 1, mean: 1 };
  values.sort((a, b) => a - b);
  return { count: values.length, min: values[0], p10: percentile(values, .1), median: percentile(values, .5), p90: percentile(values, .9), max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
}

function bakeTree(items, needle, config, stats) {
  const { lo, hi, samples, cohorts } = boundsAndSamples(items, needle, config), n = config.resolution;
  const cell = hi.map((v, k) => Math.max(v - lo[k], .0001) / n), volume = cell[0] * cell[1] * cell[2];
  // The small CPU tables use doubles so subtracting a leaf's own splat does
  // not leave a fictitious optical thickness in an otherwise empty crown.
  const density = new Float64Array(n * n * n);
  for (const s of samples) {
    const interpolation = interpolants(s.center, lo, cell, n);
    s.interpolation = interpolation;
    for (let k = 0; k < 8; k++) density[interpolation.ids[k]] += s.area * interpolation.weights[k] / volume;
  }
  const depths = Array.from({ length: 6 }, () => new Float64Array(density.length));
  // Prefix/suffix integration is O(6*n³), independent of foliage count.
  // The current voxel is excluded. A leaf's trilinear splat also reaches its
  // neighbouring voxels; that exact remaining self-contribution is removed
  // after interpolation below rather than being mistaken for canopy cover.
  const index = (x, y, z) => x + n * (y + n * z);
  for (let axis = 0; axis < 3; axis++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    let positive = 0, negative = 0;
    for (let k = 0; k < n; k++) {
      const p = [0, 0, 0], m = [0, 0, 0];
      p[axis] = n - 1 - k; m[axis] = k;
      p[(axis + 1) % 3] = m[(axis + 1) % 3] = a;
      p[(axis + 2) % 3] = m[(axis + 2) % 3] = b;
      const pi = index(...p), mi = index(...m);
      depths[axis * 2][pi] = positive;
      depths[axis * 2 + 1][mi] = negative;
      positive += density[pi] * cell[axis]; negative += density[mi] * cell[axis];
    }
  }
  const treeAO = [], treeOpen = [], ageValues = [];
  for (const s of samples) {
    const f = s.interpolation.fractions;
    const selfDepth = cell.map((length, axis) => {
      const b = f[(axis + 1) % 3], c = f[(axis + 2) % 3];
      return s.area / volume * length * f[axis] * (1 - f[axis])
        * ((1 - b) * (1 - b) + b * b) * ((1 - c) * (1 - c) + c * c);
    });
    const escape = depths.map((grid, direction) => {
      let opticalDepth = 0;
      for (let k = 0; k < 8; k++) opticalDepth += grid[s.interpolation.ids[k]] * s.interpolation.weights[k];
      opticalDepth = Math.max(0, opticalDepth - selfDepth[Math.floor(direction / 2)]);
      return Math.exp(-Math.min(16, opticalDepth * config.extinction));
    });
    // Upper-hemisphere access; no fictitious inward ground glow. The nonzero
    // floor preserves unresolved multiple scattering, especially in saplings.
    const aperture = .52 * escape[2] + .12 * (escape[0] + escape[1] + escape[4] + escape[5]);
    const ao = config.minAO + (1 - config.minAO) * Math.pow(aperture, config.aoPower);
    // A small young-tissue mask follows distal shoot cohorts. It is not random
    // per-leaf colour and does not declare a botanical age in days or years.
    const distal = s.shootDistance / Math.max(.0001, cohorts.get(s.secondary));
    const age = smooth(.48, .97, distal) * (.45 + .55 * aperture);
    s.d.canopyLightA = escape.slice(0, 4);
    s.d.canopyLightB = [escape[4], escape[5], ao, age];
    s.d.canopyAperture = aperture;
    treeAO.push(ao); treeOpen.push(aperture); ageValues.push(age);
  }
  // A diagnostic crown-depth split is geometry-based, independent of the
  // computed AO. This makes the inner/outer comparison useful for regression.
  const center = lo.map((v, k) => (v + hi[k]) * .5), half = hi.map((v, k) => Math.max((v - lo[k]) * .5, .0001));
  const shell = samples.map(s => ({ ao: s.d.canopyLightB[2], radius: Math.hypot(...s.center.map((v, k) => (v - center[k]) / half[k])) })).sort((a, b) => a.radius - b.radius);
  const quartile = Math.max(1, Math.floor(shell.length * .25));
  stats.trees.push({ kind: needle ? 'needle' : 'leaf', foliage: items.length, root: items[0].meta.root.slice(0, 3), resolution: n, bounds: { min: lo, max: hi },
    ao: summary(treeAO), aperture: summary(treeOpen), youngTissue: summary(ageValues),
    geometricInnerAO: summary(shell.slice(0, quartile).map(s => s.ao)), geometricOuterAO: summary(shell.slice(-quartile).map(s => s.ao)) });
  stats.voxels += density.length;
}

/**
 * Bake once after growth budgets have selected the final leaves and sprays.
 * Each item must expose p, q, size and meta.{root,secondary}; Three vectors and
 * quaternions work as plain objects. Root array identity groups an exact tree.
 *
 * Adds canopyLightA=[+X,-X,+Y,-Y], canopyLightB=[+Z,-Z,AO,youngTissue] and
 * canopyAperture. All values are [0,1]. No existing item fields are changed.
 * Default resolution is per tree, so differently sized trees retain comparable
 * spatial filtering. Extinction uses real size²/voxel volume then ray length;
 * it must not be tuned as a scene-wide exposure or a direct-light black mask.
 * leafArea/needleArea describe the current unit primitives and must be measured
 * again if their geometry changes. Stem wood is outside this foliage field.
 */
export function bakeLeafCanopy(leaves, needles, options = {}) {
  const start = globalThis.performance?.now() ?? Date.now();
  const config = { ...LEAF_CANOPY_DEFAULTS, ...options };
  config.resolution = Math.round(clamp(config.resolution, 6, 20));
  config.extinction = clamp(config.extinction, 0, 4);
  config.minAO = clamp(config.minAO, .10, 1);
  config.aoPower = clamp(config.aoPower, .3, 2);
  config.leafArea = Math.max(.0001, config.leafArea);
  config.needleArea = Math.max(.0001, config.needleArea);
  const stats = { config, foliage: leaves.length + needles.length, voxels: 0, trees: [] };
  for (const [items, needle] of [[leaves, false], [needles, true]]) {
    const trees = new Map();
    for (const d of items) { let group = trees.get(d.meta.root); if (!group) trees.set(d.meta.root, group = []); group.push(d); }
    for (const tree of trees.values()) bakeTree(tree, needle, config, stats);
  }
  stats.buildMs = (globalThis.performance?.now() ?? Date.now()) - start;
  return stats;
}
