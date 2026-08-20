## 2026-08-20 - Idle WebGL loop rendered continuously
**Learning:** The active image-only workflow kept a `requestAnimationFrame` loop for sequence playback, but rendered the Three.js scene every frame even when no source was loaded or a still image was paused.
**Action:** Keep the loop for playback timing, but gate WebGL rendering behind an explicit dirty-frame request from source, camera, overlay, and sequence updates.
