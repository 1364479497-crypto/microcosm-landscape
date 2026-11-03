# Runtime dependencies

Three.js is pinned to **0.187.0**, including the core and addons. Source: the official npm `three@0.187.0` distribution, under its included MIT license.

Upstream tarball SHA-256:

`ff540832ded0cfe919764d24a3d88f3e2a05f23303f876423e4f893841e90728`

The only local dependency patch is in `vendor/three/examples/jsm/controls/OrbitControls.js`: guard `releasePointerCapture(event.pointerId)` with `hasPointerCapture(event.pointerId)` in the normal pointer-up/cancel path. This retains the scene's existing lost-capture protection without changing camera mathematics.

- Original upstream OrbitControls SHA-256: recorded in `dependency-patches.json`.
- Patched runtime file hashes: `runtime-manifest.json`.

This repository contains only the official library files that the playable scene actually loads, with package metadata and license. Unused examples, build variants and source trees are omitted.
