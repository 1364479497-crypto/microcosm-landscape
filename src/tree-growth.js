import * as THREE from 'three';

// Independently authored, finite growth trees for the miniature. Branches are
// curved tapered tubes; foliage is attached to shoots rather than crown blobs.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

export const TREE_GROWTH_BUDGETS = Object.freeze({
  broadleaf: { branches: 183, foliage: 3000, foliageTriangles: 21000 },
  shrub: { branches: 69, foliage: 576, foliageTriangles: 4032 },
  spruce: { primaryBranches: 44, secondaryBranches: 320, tertiaryBranches: 96, foliage: 1180, foliageTriangles: 29500 },
  juvenile: { broadleafFoliage: 560, spruceFoliage: 360, sprucePrimaryBranches: 21, spruceSecondaryBranches: 104, spruceTertiaryBranches: 24 },
  rootsPerTree: 6,
});

function completeGeometry(positions, uvs, indices, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// A narrow petiole, a six-sided blade outline, a raised central ridge and a
// slightly curled tip. This is an opaque leaf silhouette, not a square card.
export function createTreeLeafGeometry() {
  const p = [
    -.009, 0, 0, .009, 0, 0,
    0, .16, .018,
    -.215, .405, .007,
    -.143, .755, -.024,
    0, 1, -.145,
    .143, .755, -.024,
    .215, .405, .007,
    0, .49, .064,
  ];
  const uv = [];
  for (let i = 0; i < p.length; i += 3) uv.push(.5 + p[i] / .46, p[i + 1]);
  const indices = [0, 1, 2];
  const outline = [2, 7, 6, 5, 4, 3];
  for (let i = 0; i < outline.length; i++) indices.push(8, outline[i], outline[(i + 1) % outline.length]);
  return completeGeometry(p, uv, indices, 'Petiole-rooted folded seven-triangle broad leaf');
}

// Twenty-two separate needles growing from eleven points on a living shoot.
// Each is one tapered triangle. The radial arrangement has no crossed planes,
// texture alpha, rectangular sheets or closed discs.
export function createConiferNeedleGeometry() {
  const positions = [], uvs = [], indices = [];
  for (let node = 0; node < 11; node++) {
    for (let pair = 0; pair < 2; pair++) {
      const az = node * 2.399963 + pair * Math.PI + .28;
      const attachment = .035 + node * .083;
      const radial = new THREE.Vector3(Math.cos(az), .15 + .035 * (node % 2), Math.sin(az)).normalize();
      const cross = new THREE.Vector3(-Math.sin(az), .12, Math.cos(az)).normalize();
      const base = new THREE.Vector3(0, attachment, 0);
      const length = .33 + .034 * ((node + pair) % 3);
      const a = base.clone().addScaledVector(cross, -.0175);
      const b = base.clone().addScaledVector(cross, .0175);
      const tip = base.clone().addScaledVector(radial, length).addScaledVector(UP, .065);
      const first = positions.length / 3;
      positions.push(...a.toArray(), ...b.toArray(), ...tip.toArray());
      uvs.push(0, 0, 1, 0, .5, 1);
      indices.push(first, first + 1, first + 2);
    }
  }
  // New green shoot tissue is real tapered three-sided geometry. Every
  // needle base intersects this axis even when its host woody twig curves.
  const stemBase = positions.length / 3;
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3;
    positions.push(Math.cos(a) * .018, -.015, Math.sin(a) * .018);
    uvs.push(i / 3, 0);
  }
  positions.push(0, 1.035, 0); uvs.push(.5, 1);
  for (let i = 0; i < 3; i++) indices.push(stemBase + i, stemBase + (i + 1) % 3, stemBase + 3);
  const geometry = completeGeometry(positions, uvs, indices, 'Twenty-two radial spruce needles on a solid growing shoot');
  geometry.userData.needleCount = 22;
  geometry.userData.stemTriangles = 3;
  geometry.userData.shootAxis = { base: [0, -.015, 0], tip: [0, 1.035, 0] };
  return geometry;
}

function cubic(a, b, c, d) {
  return t => {
    const s = 1 - t;
    return a.clone().multiplyScalar(s * s * s)
      .addScaledVector(b, 3 * s * s * t)
      .addScaledVector(c, 3 * s * t * t)
      .addScaledVector(d, t * t * t);
  };
}

function foliageOrientation(direction, roll = 0) {
  const y = direction.clone().normalize();
  let z = UP.clone().addScaledVector(y, -UP.dot(y));
  if (z.lengthSq() < .001) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
}

/**
 * bark is the vegetation ring accumulator {p,n,uv,c,root,primary,secondary,
 * traits,idx}. All positions remain in the existing world-space vegetation
 * group, and all wind/season attributes retain the original meanings.
 */
export function createTreeGrowth({ terrain, rng, stats, bark, leaves, needles, quality = 'high' }) {
  if (!terrain?.height || typeof rng !== 'function' || !bark || !leaves || !needles) {
    throw new Error('Tree growth requires terrain, seeded rng, bark, leaves and needles.');
  }
  const range = (a, b) => lerp(a, b, rng());
  const diagnostics = { branches: [], roots: [], petioles: [], needleAttachments: [], trees: [], budgets: TREE_GROWTH_BUDGETS };
  const pendingStats = stats || {};
  for (const name of ['branchJobs', 'continuations', 'lateralChildren']) {
    if (!pendingStats[name]) pendingStats[name] = [0, 0, 0, 0];
  }
  for (const name of ['trees', 'broadleafTrees', 'pines', 'shrubs']) pendingStats[name] ??= 0;
  let treeIndex = 0;

  function putMeta(meta) {
    bark.root.push(...meta.root);
    bark.primary.push(...meta.primary);
    bark.secondary.push(...meta.secondary);
    bark.traits.push(...meta.traits);
  }

  function emitCurve(path, radius, endRatio, sections, sides, meta, tint, level, phase, root = false) {
    const samples = [], color = new THREE.Color(tint), baseVertex = bark.p.length / 3;
    let distance = 0, previous = null, frameX = null;
    for (let k = 0; k <= sections; k++) {
      const t = k / sections, p = path(t);
      const tangent = path(Math.min(1, t + .002)).sub(path(Math.max(0, t - .002))).normalize();
      if (tangent.lengthSq() < .5) tangent.copy(UP);
      if (previous) distance += p.distanceTo(previous);
      if (!frameX) {
        const fallback = Math.abs(tangent.y) > .91 ? new THREE.Vector3(1, 0, 0) : UP;
        frameX = new THREE.Vector3().crossVectors(tangent, fallback).normalize();
      } else {
        frameX.addScaledVector(tangent, -frameX.dot(tangent)).normalize();
      }
      const frameZ = new THREE.Vector3().crossVectors(frameX, tangent).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(frameX, tangent, frameZ));
      // The broad collar is confined to the first ring; exposed roots sink
      // below the ground, so the trunk does not sit on a floating root star.
      const collar = level === 0 && !root ? 1 + .32 * Math.exp(-t * 35) : 1;
      const r = radius * lerp(1, endRatio, Math.pow(t, .84)) * collar;
      samples.push({ p: p.clone(), q, r });
      for (let j = 0; j <= sides; j++) {
        const a = j === sides ? 0 : j * TAU / sides;
        const n = frameX.clone().multiplyScalar(Math.cos(a)).addScaledVector(frameZ, Math.sin(a));
        const ridge = 1 + .035 * Math.sin(a * 3 + phase + t * 4.5) + .018 * Math.sin(a * 7 - t * 3);
        const v = p.clone().addScaledVector(n, r * ridge);
        bark.p.push(v.x, v.y, v.z);
        bark.n.push(n.x, n.y, n.z);
        // Optional physical-radius attribute used by the bark material. Keep
        // it aligned with the ring vertices, including the duplicated seam.
        if (bark.radius) bark.radius.push(r);
        if (bark.period) bark.period.push(radius * TAU);
        // Both components are physical scene units, including the duplicated
        // seam. Species material determines its own visible bark scale.
        bark.uv.push(j / sides * radius * TAU, distance);
        const shade = .91 + .075 * Math.sin(a + phase) + .025 * Math.sin(t * 17 + phase);
        bark.c.push(color.r * shade, color.g * shade, color.b * shade);
        putMeta(meta);
        if (k < sections && j < sides) {
          const v0 = baseVertex + k * (sides + 1) + j;
          bark.idx.push(v0, v0 + sides + 1, v0 + 1, v0 + 1, v0 + sides + 1, v0 + sides + 2);
        }
      }
      previous = p;
    }
    pendingStats.branchJobs[level]++;
    diagnostics.branches.push({
      tree: treeIndex, species: meta.traits[1], level, root,
      start: samples[0].p.toArray(), end: samples[sections].p.toArray(),
      radius, startRadius: samples[0].r, endRadius: samples[sections].r,
      sections, sides, baseVertex, ringVertices: sides + 1,
      tipDrop: samples[sections].p.y - samples[sections - 1].p.y,
    });
    return samples;
  }

  function along(samples, t) {
    const position = clamp(t, 0, 1) * (samples.length - 1);
    const k = Math.min(samples.length - 2, Math.floor(position)), f = position - k;
    return {
      p: samples[k].p.clone().lerp(samples[k + 1].p, f),
      q: samples[k].q.clone().slerp(samples[k + 1].q, f),
      r: lerp(samples[k].r, samples[k + 1].r, f),
    };
  }

  function baseMeta(root, height, species, phase) {
    return {
      root: [...root.toArray(), height],
      primary: [...root.toArray(), phase],
      secondary: [...root.toArray(), phase],
      traits: [rng(), species, 0, 0],
    };
  }

  function branchMeta(parent, p, level, species) {
    const primary = level === 1 ? [...p.toArray(), range(0, TAU)] : parent.primary;
    const secondary = level === 2 ? [...p.toArray(), range(0, TAU)] : level === 1 ? primary : parent.secondary;
    return { root: parent.root, primary, secondary, traits: [parent.traits[0], species, level > 0 ? .6 : 0, level > 1 ? .8 : 0] };
  }

  function growRoots(root, h, meta, tint, phase, shrub) {
    const count = shrub ? 3 : 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const a = phase + (i + range(-.2, .2)) * TAU / count;
      const reach = h * range(shrub ? .055 : .075, shrub ? .085 : .115);
      const direction = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const start = root.clone().addScaledVector(direction, h * .011);
      start.y = terrain.height(start.x, start.z) - h * .004;
      const end = root.clone().addScaledVector(direction, reach);
      const groundY = terrain.height(end.x, end.z);
      end.y = groundY - h * .012;
      const b = start.clone().addScaledVector(direction, reach * .34);
      b.y = terrain.height(b.x, b.z) + h * .012;
      const c = start.clone().addScaledVector(direction, reach * .75);
      c.y = terrain.height(c.x, c.z) + h * .001;
      emitCurve(cubic(start, b, c, end), h * (shrub ? .009 : .012), .07, 4, 5, meta, tint, 0, a, true);
      diagnostics.roots.push({ tree: treeIndex, species: meta.traits[1], start: start.toArray(), end: end.toArray(), groundY, buried: groundY - end.y });
    }
  }

  function deciduous(x, z, h, species = 0, shrub = false, options = {}) {
    // Existing five-argument calls retain their species/shrub meaning. A
    // caller may also put the options object in the optional shrub slot.
    if (shrub && typeof shrub === 'object') { options = shrub; shrub = false; }
    const juvenile = Boolean(options.juvenile), density = clamp(Number(options.density) || 1, .35, 1.2);
    treeIndex++;
    const speciesCode = species === 1 ? 5 : species === 2 ? 2 : 0;
    const root = new THREE.Vector3(x, terrain.height(x, z) - h * .013, z);
    const phase = range(0, TAU), meta0 = baseMeta(root, h * 1.28, speciesCode, phase);
    const tint = speciesCode === 5 ? 0xc8c5b5 : speciesCode === 2 ? 0x8a7770 : 0x7f8570;
    const lengths = shrub ? [.46, .34, .22, .15] : juvenile ? [.61, .335, .205, .135] : [.57, .39, .225, .145];
    const children = (shrub ? [3, 3, 2, 0] : juvenile ? [3, 2, 2, 0] : [6, 4, 3, 0])
      .map((count, level) => level === 3 ? 0 : Math.max(2, Math.round(count * Math.min(1, Math.sqrt(density)))));
    const sections = [11, 5, 4, 3], sides = [11, 5, 4, 3];
    const leafStart = leaves.length, barkStart = bark.idx.length / 3;
    const maxFoliage = shrub ? TREE_GROWTH_BUDGETS.shrub.foliage : juvenile ? TREE_GROWTH_BUDGETS.juvenile.broadleafFoliage : TREE_GROWTH_BUDGETS.broadleaf.foliage;
    const foliageBudget = Math.min(maxFoliage, Math.round((shrub ? 576 : juvenile ? 432 : 2800) * density));
    const treeLeaves = [];
    growRoots(root, h, meta0, tint, phase, shrub);
    const jobs = [{ p: root, q: new THREE.Quaternion(), length: h * lengths[0], radius: h * (shrub ? .029 : .030), level: 0, meta: meta0, continuation: false }];
    for (let cursor = 0; cursor < jobs.length; cursor++) {
      const job = jobs[cursor], level = job.level;
      const direction = UP.clone().applyQuaternion(job.q).normalize();
      const lateral = new THREE.Vector3(Math.cos(phase + cursor * 1.4), 0, Math.sin(phase + cursor * 1.4));
      const end = job.p.clone().addScaledVector(direction, job.length)
        .addScaledVector(lateral, job.length * range(-.08, .08));
      if (level > 0) end.y += job.length * (level === 3 ? -.11 : .075);
      const endDirection = direction.clone().addScaledVector(level === 3 ? DOWN : UP, level === 3 ? .32 : .19).normalize();
      const b = job.p.clone().addScaledVector(direction, job.length * .35);
      const c = end.clone().addScaledVector(endDirection, -job.length * .30)
        .addScaledVector(lateral, job.length * .065);
      const path = cubic(job.p, b, c, end);
      const sec = emitCurve(path, job.radius, level === 3 ? .04 : level === 0 ? .32 : .23, sections[level], sides[level], job.meta, tint, level, phase + cursor * .7);

      if (level === 3) {
        const leafCount = Math.max(6, Math.round((shrub ? 12 : juvenile ? 12 : 20) * density));
        const twigRoll = range(0, TAU);
        for (let i = 0; i < leafCount; i++) {
          const t = .035 + (i + range(.15, .85)) / leafCount * .94;
          const parent = along(sec, t);
          // Alternating leaves retain the two-ranked character of hornbeam
          // and birch. Cherry's slower spiral fills each twig in depth.
          const azimuth = twigRoll + (speciesCode === 2 ? i * 2.399963 : (i % 2 ? Math.PI : 0) + i * .14) + range(-.30, .30);
          const q = parent.q.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(UP, azimuth))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), range(.80, 1.40)));
          const leafDirection = UP.clone().applyQuaternion(q);
          leafDirection.y = clamp(leafDirection.y * .68 - .045, -.54, .55);
          leafDirection.normalize();
          const at = parent.p.clone().addScaledVector(leafDirection, parent.r * .82);
          const orientation = foliageOrientation(leafDirection, range(-.48, .48));
          const canopy = at.clone().sub(root).addScaledVector(UP, -h * .70).normalize()
            .applyQuaternion(orientation.clone().invert());
          const size = h * range(shrub ? .105 : speciesCode === 5 ? .074 : .084, shrub ? .145 : speciesCode === 2 ? .118 : .108);
          const meta = { ...job.meta, traits: [rng(), speciesCode, job.meta.traits[2], job.meta.traits[3]] };
          const color = new THREE.Color(speciesCode === 5 ? 0x81986b : speciesCode === 2 ? 0x77915d : 0x708651).multiplyScalar(range(.86, 1.09));
          treeLeaves.push({ p: at, q: orientation, size, meta, canopy, color });
          if (diagnostics.petioles.length < 96) diagnostics.petioles.push({ tree: treeIndex, root: at.toArray(), twigOrigin: parent.p.toArray(), radius: parent.r, offset: parent.r * .82, localRoot: [0, 0, 0] });
        }
        continue;
      }

      const count = children[level], radialOffset = range(0, TAU);
      const order = Array.from({ length: count }, (_, i) => i);
      for (let i = count - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (let slot = 0; slot <= count; slot++) {
        const continuation = slot === count;
        const t = continuation ? 1 : (level === 0 ? .30 : .23) + (slot + range(.10, .90)) / count * (level === 0 ? .59 : .70);
        const at = along(sec, t);
        const azimuth = radialOffset + ((order[slot] ?? 0) + range(-.15, .15)) / count * TAU;
        const angle = continuation ? range(.04, .20) : range(level === 0 ? .70 : .82, level === 0 ? 1.12 : 1.28);
        const q = at.q.clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, azimuth))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
        const crownVariation = 1 + .17 * Math.sin(azimuth + phase) + .08 * Math.sin(azimuth * 3.1 + phase);
        const length = h * lengths[level + 1] * range(.82, 1.12) * crownVariation * (continuation ? .91 : 1);
        const meta = branchMeta(job.meta, at.p, level + 1, speciesCode);
        jobs.push({ p: at.p, q, length, radius: at.r * (continuation ? 1 : level === 0 ? .59 : .65), level: level + 1, meta, continuation });
        pendingStats[continuation ? 'continuations' : 'lateralChildren'][level + 1]++;
      }
    }
    // Thin the finished topology evenly. Reaching a budget must never leave
    // the last crown sector or the upper continuation without leaves.
    if (treeLeaves.length <= foliageBudget) leaves.push(...treeLeaves);
    else for (let i = 0; i < foliageBudget; i++) leaves.push(treeLeaves[Math.floor((i + .5) * treeLeaves.length / foliageBudget)]);
    if (shrub) pendingStats.shrubs++; else { pendingStats.broadleafTrees++; pendingStats.trees++; }
    diagnostics.trees.push({ tree: treeIndex, species: speciesCode, shrub, juvenile, density, foliage: leaves.length - leafStart, foliageTriangles: (leaves.length - leafStart) * 7, barkTriangles: bark.idx.length / 3 - barkStart });
  }

  function pine(x, z, h, options = {}) {
    const juvenile = Boolean(options.juvenile), density = clamp(Number(options.density) || 1, .35, 1.2);
    treeIndex++;
    const root = new THREE.Vector3(x, terrain.height(x, z) - h * .015, z);
    const phase = range(0, TAU), meta0 = baseMeta(root, h, 1, phase);
    const tint = 0x7b7566, needleStart = needles.length, barkStart = bark.idx.length / 3;
    const budget = TREE_GROWTH_BUDGETS.spruce;
    const juvenileBudget = TREE_GROWTH_BUDGETS.juvenile;
    const primaryBudget = juvenile ? juvenileBudget.sprucePrimaryBranches : budget.primaryBranches;
    const secondaryBudget = Math.round((juvenile ? juvenileBudget.spruceSecondaryBranches : budget.secondaryBranches) * Math.min(1, density));
    const tertiaryBudget = Math.round((juvenile ? juvenileBudget.spruceTertiaryBranches : budget.tertiaryBranches) * Math.min(1, density));
    const foliageBudget = Math.min(budget.foliage, Math.round((juvenile ? juvenileBudget.spruceFoliage : budget.foliage) * density));
    growRoots(root, h, meta0, tint, phase, false);
    const trunkPath = t => root.clone().add(new THREE.Vector3(
      Math.sin(phase + t * 2.7) * h * .015 * t * t,
      h * t,
      Math.cos(phase + t * 3.2) * h * .016 * t * t,
    ));
    const trunk = emitCurve(trunkPath, h * (juvenile ? .022 : .025), .025, 16, 11, meta0, tint, 0, phase);
    let primaryCount = 0, secondaryCount = 0, tertiaryCount = 0;
    const treeNeedles = [], branchCrown = [];

    function needleShoot(sec, meta, length, count = 2, leader = false) {
      for (let k = 0; k < count; k++) {
        const t = count === 1 ? .18 : .055 + k / (count - 1) * .72;
        const at = along(sec, t);
        const direction = UP.clone().applyQuaternion(at.q);
        const q = at.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, range(0, TAU)));
        const crownHeight = clamp((at.p.y - root.y) / h, .15, 1);
        const minSize = h * lerp(.086, .037, crownHeight);
        const size = clamp(length * (count === 1 ? 1.10 : .86) * range(.94, 1.08), minSize, h * .12);
        const canopy = new THREE.Vector3(0, .45, .65).normalize();
        const foliageMeta = { ...meta, traits: [rng(), 1, meta.traits[2], meta.traits[3]] };
        treeNeedles.push({ p: at.p, q, size, meta: foliageMeta, canopy, color: new THREE.Color(leader ? 0x5b7d50 : 0x456c48).multiplyScalar(range(.89, 1.12)) });
        if (diagnostics.needleAttachments.length < 96) diagnostics.needleAttachments.push({ tree: treeIndex, root: at.p.toArray(), direction: direction.toArray(), size, localRoot: [0, 0, 0] });
      }
    }

    // Each branch has its own attachment height and radial gap; no coplanar
    // rings are completed. Lower branches extend farther and sag under weight.
    const layers = Math.max(5, Math.round((juvenile ? 7 : quality === 'high' ? 11 : 10) * Math.sqrt(Math.min(1, density))));
    for (let layer = 0; layer < layers && primaryCount < primaryBudget; layer++) {
      const height = .17 + (layer + range(.18, .72)) / layers * .78;
      const count = juvenile || density < .75 ? 3 : 3 + (rng() < .64 ? 1 : 0);
      const radialOffset = phase + layer * 2.399963 + range(-.37, .37);
      for (let slot = 0; slot < count && primaryCount < primaryBudget; slot++) {
        const t = clamp(height + range(-.019, .019), .16, .955), at = along(trunk, t);
        const azimuth = radialOffset + slot / count * TAU + range(-.17, .17);
        const direction = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
        const flank = new THREE.Vector3(-direction.z, 0, direction.x);
        const silhouette = 1 + .12 * Math.sin(azimuth + phase) + .08 * Math.sin(azimuth * 2.7 - phase);
        const length = h * (.325 * Math.pow(1 - t, .82) + .014) * range(.88, 1.12) * silhouette;
        const droop = length * range(.15, .31) * (1 - t * .45);
        const end = at.p.clone().addScaledVector(direction, length).addScaledVector(flank, length * range(-.09, .09));
        end.y -= droop;
        const b = at.p.clone().addScaledVector(direction, length * .30).addScaledVector(UP, length * .055);
        const c = at.p.clone().addScaledVector(direction, length * .77).addScaledVector(DOWN, droop * .64);
        const meta = branchMeta(meta0, at.p, 1, 1);
        const sec = emitCurve(cubic(at.p, b, c, end), h * (.008 * Math.pow(1 - t, .70) + .0012), .13, 5, 4, meta, tint, 1, azimuth);
        primaryCount++; pendingStats.lateralChildren[1]++;
        const twigCount = juvenile ? 4 + (rng() < .5 ? 1 : 0) : Math.round((7 + rng() * 2) * lerp(1, .76, clamp((t - .7) / .3, 0, 1)));
        branchCrown.push({ sec, meta, t, direction, flank, length, azimuth, twigCount });
        // The final woody extension carries its own buds in addition to the
        // lateral shoots. Three positions bridge the gaps between branches.
        needleShoot(sec.slice(2), meta, length * .34, juvenile || density < .65 ? 2 : 3);
      }
    }
    // Grow one twig round across the whole tree before the next round. This
    // makes the finite secondary budget cover every crown height and sector.
    for (let twig = 0; twig < 9 && secondaryCount < secondaryBudget; twig++) {
      for (const [branchIndex, branch] of branchCrown.entries()) {
          if (twig >= branch.twigCount || secondaryCount >= secondaryBudget) continue;
          const { sec, meta, t, direction, flank, length, azimuth, twigCount } = branch;
          const frac = .115 + (twig + range(.10, .85)) / twigCount * .86, attach = along(sec, frac);
          const side = twig % 2 ? -1 : 1;
          const twigDirection = direction.clone().multiplyScalar(.40).addScaledVector(flank, side * range(.70, .95)).normalize();
          const twigLength = Math.min(length * .51, h * .135) * range(.85, 1.15) * (.84 + .16 * Math.sin(frac * Math.PI));
          const twigEnd = attach.p.clone().addScaledVector(twigDirection, twigLength);
          twigEnd.y -= twigLength * range(.36, .68);
          const twigB = attach.p.clone().addScaledVector(twigDirection, twigLength * .38).addScaledVector(DOWN, twigLength * .04);
          const twigC = twigEnd.clone().addScaledVector(twigDirection, -twigLength * .15).addScaledVector(UP, twigLength * .32);
          const twigMeta = branchMeta(meta, attach.p, 2, 1);
          const twigSec = emitCurve(cubic(attach.p, twigB, twigC, twigEnd), h * .0019 * (1 - t * .50), .045, 3, 3, twigMeta, tint, 2, azimuth + side);
          secondaryCount++; pendingStats.lateralChildren[2]++;
          needleShoot(twigSec, twigMeta, twigLength * 1.10, juvenile || quality !== 'high' || density < .65 ? 2 : 3);
          // A short, pendent fork gives the inner bough depth instead of
          // making all foliage sit on one comb-shaped plane. The upper
          // half of these shoots turns upward as living new growth.
          if ((twig + branchIndex) % 3 === 0 && tertiaryCount < tertiaryBudget) {
            const forkAt = along(twigSec, range(.40, .65));
            const forkDirection = twigDirection.clone().multiplyScalar(.56).addScaledVector(direction, range(-.42, .48)).normalize();
            const forkLength = twigLength * range(.47, .68);
            const liveTip = t > .70;
            const forkEnd = forkAt.p.clone().addScaledVector(forkDirection, forkLength).addScaledVector(liveTip ? UP : DOWN, forkLength * (liveTip ? .22 : .75));
            const forkB = forkAt.p.clone().addScaledVector(forkDirection, forkLength * .43);
            const forkC = forkEnd.clone().addScaledVector(forkDirection, -forkLength * .24).addScaledVector(UP, forkLength * .18);
            const forkMeta = branchMeta(twigMeta, forkAt.p, 3, 1);
            const forkSec = emitCurve(cubic(forkAt.p, forkB, forkC, forkEnd), h * .00075 * (1 - t * .45), .03, 2, 3, forkMeta, tint, 3, azimuth + side * .7);
            tertiaryCount++; pendingStats.lateralChildren[3]++;
            needleShoot(forkSec, forkMeta, forkLength * 1.2, 1, liveTip);
          }
      }
    }
    // A narrow living leader preserves a strong central axis. Small upright
    // tip shoots do not close the crown into a geometric cone cap.
    const leaderStart = treeNeedles.length;
    const leaderShoots = juvenile ? 9 : 14;
    for (let i = 0; i < leaderShoots; i++) {
      const u = i / (leaderShoots - 1), at = along(trunk, .76 + u * .228);
      const azimuth = phase + i * 2.4;
      const reach = lerp(.80, .21, u);
      const direction = new THREE.Vector3(Math.cos(azimuth) * reach, 1, Math.sin(azimuth) * reach).normalize();
      const length = h * lerp(.078, .038, u) * range(.90, 1.12), end = at.p.clone().addScaledVector(direction, length);
      const leaderMeta = branchMeta(meta0, at.p, 1, 1);
      const sec = emitCurve(cubic(at.p, at.p.clone().lerp(end, .33), at.p.clone().lerp(end, .66), end), h * .00145, .03, 2, 3, leaderMeta, tint, 3, azimuth);
      needleShoot(sec, leaderMeta, length * 1.1, 2, true);
    }
    // A budget is applied over the completed crown, never by aborting growth
    // part-way up the tree. Dense seeds retain foliage at every crown height
    // and every living leader shoot.
    if (treeNeedles.length <= foliageBudget) needles.push(...treeNeedles);
    else {
      const leaderCount = treeNeedles.length - leaderStart, bodyBudget = foliageBudget - leaderCount;
      for (let i = 0; i < bodyBudget; i++) needles.push(treeNeedles[Math.floor((i + .5) * leaderStart / bodyBudget)]);
      needles.push(...treeNeedles.slice(leaderStart));
    }
    pendingStats.pines++; pendingStats.trees++;
    diagnostics.trees.push({ tree: treeIndex, species: 1, juvenile, density, primaryBranches: primaryCount, secondaryBranches: secondaryCount, tertiaryBranches: tertiaryCount, leaderShoots, foliage: needles.length - needleStart, foliageTriangles: (needles.length - needleStart) * 25, barkTriangles: bark.idx.length / 3 - barkStart });
  }

  return { deciduous, pine, diagnostics };
}
