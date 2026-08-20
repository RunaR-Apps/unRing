import * as THREE from 'three';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas        = document.getElementById('canvas');
const fileInput     = document.getElementById('file-input');
const uploadBtn     = document.getElementById('upload-btn');
const dropOpen      = document.getElementById('drop-open');
const filenameLbl   = document.getElementById('filename');
const dropOverlay   = document.getElementById('drop-overlay');
const viewport      = document.getElementById('viewport');
const sourceMonitor = document.getElementById('source-monitor');
const playPauseBtn  = document.getElementById('play-pause-btn');
const seekSlider    = document.getElementById('seek');
const timeLabel     = document.getElementById('time-label');
const srcFovSlider  = document.getElementById('src-fov');
const srcFovVal     = document.getElementById('src-fov-val');
const zoomSlider    = document.getElementById('zoom');
const zoomVal       = document.getElementById('zoom-val');
const tiltSlider    = document.getElementById('tilt');
const tiltVal       = document.getElementById('tilt-val');
const pitchSlider   = document.getElementById('pitch');
const pitchVal      = document.getElementById('pitch-val');
const rollSlider    = document.getElementById('roll');
const rollVal       = document.getElementById('roll-val');
// Export
const saveStillBtn  = document.getElementById('save-still-btn');
const exportSequenceBtn = document.getElementById('export-sequence-btn');
const exportProgress = document.getElementById('export-progress');
const exportBar     = document.getElementById('export-bar');
const exportStatus  = document.getElementById('export-status');
const importSettingsBtn = document.getElementById('import-settings-btn');
const exportSettingsBtn = document.getElementById('export-settings-btn');
const settingsInput = document.getElementById('settings-input');

const DEFAULT_FPS = 25;

// ─── Three.js setup ──────────────────────────────────────────────────────────
// preserveDrawingBuffer is required for canvas.toDataURL() and gl.readPixels()
// to work correctly outside of the rAF loop.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
camera.position.set(0, 0, 0);

// High-density sphere – camera sits at the origin and looks at the interior.
// Flipping X normals so the texture is visible from inside.
const geometry = new THREE.SphereGeometry(10, 128, 128);
geometry.scale(-1, 1, 1);

let imageTexture = null;
let sphereMesh   = null;

// Square texture canvas keeps the circular fisheye image aspect-correct.
let paddedCanvas = null;
let paddedCanvasCtx = null;

// ─── Source mode ──────────────────────────────────────────────────────────────
// 'none' | 'image' | 'sequence'
let sourceMode = 'none';

// Image / image-sequence state
let seqUrls    = [];   // Blob URLs (for revokeObjectURL on cleanup)
let seqImages  = [];   // HTMLImageElement array (one per frame)
let seqIndex   = 0;    // current frame index (0-based)
let seqPlaying = false;
let seqLastMs  = 0;    // timestamp of last frame advance (ms)
let sourceName = '';

function buildSphere(tex) {
  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.material.dispose();
  }

  const material = new THREE.MeshBasicMaterial({ map: tex });
  sphereMesh = new THREE.Mesh(geometry, material);
  scene.add(sphereMesh);
}

// ─── Resize ───────────────────────────────────────────────────────────────────
// Target aspect ratio (16:9 default, can be changed via presets)
// Assumes 1:1 pixel aspect ratio, so displayed aspect = width / height
let targetAspect = 16 / 9;

function resize() {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;

  // Letterbox/pillarbox the canvas inside the viewport to maintain aspect ratio
  let cw, ch;
  if (vw / vh > targetAspect) {
    ch = vh;
    cw = Math.round(vh * targetAspect);
  } else {
    cw = vw;
    ch = Math.round(vw / targetAspect);
  }

  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.style.position = 'absolute';
  canvas.style.left = Math.round((vw - cw) / 2) + 'px';
  canvas.style.top  = Math.round((vh - ch) / 2) + 'px';

  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

// ─── Camera state (Euler angles) ─────────────────────────────────────────────
// Slider-driven rotation (degrees → radians)
let tiltValue  = 0; // radians (horizontal drag)
let pitchValue = 0; // radians (vertical drag)
let rollOffset = 0; // radians

function applyCameraRotation() {
  // Use tilt/pitch from sliders, roll from correction slider
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(pitchValue, tiltValue, rollOffset, 'YXZ');
  q.setFromEuler(euler);
  camera.quaternion.copy(q);
  camera.updateMatrixWorld(true);
}

// ─── Drag-to-look ─────────────────────────────────────────────────────────────
const DRAG_SPEED = 0.003;
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mouseup', () => {
  dragging = false;
  canvas.style.cursor = 'grab';
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  
  // Update tilt from horizontal drag
  let newTilt = Number(tiltSlider.value) + dx * 0.1;
  newTilt = Math.max(-45, Math.min(45, newTilt));
  tiltSlider.value = newTilt;
  tiltVal.textContent = Math.round(newTilt) + '°';
  tiltValue = THREE.MathUtils.degToRad(newTilt);
  
  // Update pitch from vertical drag
  let newPitch = Number(pitchSlider.value) + dy * 0.1;
  newPitch = Math.max(-45, Math.min(45, newPitch));
  pitchSlider.value = newPitch;
  pitchVal.textContent = Math.round(newPitch) + '°';
  pitchValue = THREE.MathUtils.degToRad(newPitch);
  
  applyCameraRotation();
  renderOAll();
});

canvas.style.cursor = 'grab';

// Touch drag-to-look
let lastTouchX = 0;
let lastTouchY = 0;

canvas.addEventListener('touchstart', (e) => {
  lastTouchX = e.touches[0].clientX;
  lastTouchY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  const dx = e.touches[0].clientX - lastTouchX;
  const dy = e.touches[0].clientY - lastTouchY;
  lastTouchX = e.touches[0].clientX;
  lastTouchY = e.touches[0].clientY;
  
  // Update tilt from horizontal drag
  let newTilt = Number(tiltSlider.value) + dx * 0.1;
  newTilt = Math.max(-45, Math.min(45, newTilt));
  tiltSlider.value = newTilt;
  tiltVal.textContent = Math.round(newTilt) + '°';
  tiltValue = THREE.MathUtils.degToRad(newTilt);
  
  // Update pitch from vertical drag
  let newPitch = Number(pitchSlider.value) + dy * 0.1;
  newPitch = Math.max(-45, Math.min(45, newPitch));
  pitchSlider.value = newPitch;
  pitchVal.textContent = Math.round(newPitch) + '°';
  pitchValue = THREE.MathUtils.degToRad(newPitch);
  
  applyCameraRotation();
  renderOAll();
}, { passive: true });

// ─── Animation loop ──────────────────────────────────────────────────────────
function tick(ts) {
  requestAnimationFrame(tick);
  if (sourceMode === 'sequence' && seqPlaying && seqImages.length > 0) {
    const fps = DEFAULT_FPS;
    if (ts - seqLastMs >= 1000 / fps) {
      seqLastMs = ts;
      seqIndex = (seqIndex + 1) % seqImages.length;
      drawSeqFrame(seqIndex);
      updateSeqSeek();
    }
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(tick);

// ─── Fisheye UV remapping ────────────────────────────────────────────────────
// A circular fisheye image uses equidistant projection:
//   r_image = (θ / halfFOV) * 0.5
// where θ is the angle from the optical axis and r_image is the normalised
// radius inside the circular image (0 = centre, 0.5 = edge of circle).
//
// We bake this into the geometry's UV attribute so the GPU only has to
// do a simple texture lookup per fragment.
function buildFisheyeUVs(sourceFovDeg) {
  const halfFov = (sourceFovDeg / 2) * (Math.PI / 180); // radians
  const pos = geometry.attributes.position;
  const uv  = geometry.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const len = Math.sqrt(x * x + y * y + z * z);
    // Unit direction from camera (origin) toward this sphere vertex.
    const dx = x / len;
    const dy = y / len;
    const dz = z / len;

    // Camera looks along –Z.  Optical axis dot product = –dz.
    const cosTheta = Math.max(-1, Math.min(1, -dz));
    const theta    = Math.acos(cosTheta); // 0 = centre, π/2 = edge of 180° lens

    // Normalised radius in the circular image.
    const r = (theta / halfFov) * 0.5;

    // Azimuth in the XY plane (dx > 0 = camera-right, dy > 0 = camera-up).
    const phi = Math.atan2(dy, dx);

    uv.setXY(i, 0.5 + r * Math.cos(phi), 0.5 + r * Math.sin(phi));
  }

  uv.needsUpdate = true;
}

// Initial UV bake with the slider's default value.
buildFisheyeUVs(Number(srcFovSlider.value));

// Disable canvas pointer events initially so drop overlay is clickable
canvas.style.pointerEvents = 'none';

function roundedDegrees(value) {
  return `${Math.round(Number(value))}°`;
}

function setSliderValue(slider, value) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  slider.value = Math.max(min, Math.min(max, value));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

document.querySelectorAll('.slider-row[data-slider]').forEach(row => {
  const slider = document.getElementById(row.dataset.slider);
  const resetButton = row.querySelector('.slider-reset');
  resetButton.addEventListener('click', () => {
    setSliderValue(slider, Number(row.dataset.default));
  });
  row.querySelectorAll('.slider-step').forEach(button => {
    button.addEventListener('click', () => {
      setSliderValue(slider, Number(slider.value) + Number(button.dataset.direction));
    });
  });
});

srcFovSlider.addEventListener('input', () => {
  const v = Number(srcFovSlider.value);
  srcFovVal.textContent = roundedDegrees(v);
  buildFisheyeUVs(v);
  renderOAll();
});

zoomSlider.addEventListener('input', () => {
  const v = Number(zoomSlider.value);
  zoomVal.textContent = roundedDegrees(v);
  camera.fov = v;
  camera.updateProjectionMatrix();
  renderOAll();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const direction = e.deltaY > 0 ? 1 : -1;
  setSliderValue(zoomSlider, Number(zoomSlider.value) + direction * 2);
}, { passive: false });

tiltSlider.addEventListener('input', () => {
  const v = Number(tiltSlider.value);
  tiltVal.textContent = roundedDegrees(v);
  tiltValue = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
  renderOAll();
});

pitchSlider.addEventListener('input', () => {
  const v = Number(pitchSlider.value);
  pitchVal.textContent = roundedDegrees(v);
  pitchValue = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
  renderOAll();
});

rollSlider.addEventListener('input', () => {
  const v = Number(rollSlider.value);
  rollVal.textContent = roundedDegrees(v);
  rollOffset = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
  renderOAll();
});

function setAspectFromDimensions(width, height) {
  if (!width || !height) return;
  targetAspect = width / height;
  resize();
}

// ─── Space bar: play / pause ────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  // Ignore if the user is typing in an input/select
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  if (sourceMode === 'sequence') {
    seqPlaying = !seqPlaying;
    playPauseBtn.textContent = seqPlaying ? '⏸' : '▶';
    seqLastMs = 0;
  }
});

// ─── Transport controls ───────────────────────────────────────────────────────
playPauseBtn.addEventListener('click', () => {
  if (sourceMode !== 'sequence') return;
  seqPlaying = !seqPlaying;
  playPauseBtn.textContent = seqPlaying ? '⏸' : '▶';
  seqLastMs = 0; // reset so first advance waits a full interval
});

seekSlider.addEventListener('input', () => {
  if (sourceMode === 'sequence') {
    const idx = Math.round((seekSlider.value / 1000) * (seqImages.length - 1));
    seqIndex = Math.max(0, Math.min(seqImages.length - 1, idx));
    drawSeqFrame(seqIndex);
    updateSeqSeek();
  }
});

// ─── Image loading ───────────────────────────────────────────────────────────
function isImageFile(file) {
  return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name) ||
    file.type.startsWith('image/');
}

function cleanupSeq() {
  seqUrls.forEach(url => URL.revokeObjectURL(url));
  seqUrls = [];
  seqImages = [];
  seqIndex = 0;
  seqPlaying = false;
}

function drawSeqFrame(index) {
  const img = seqImages[index];
  if (!img) return;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const maxDim = Math.max(w, h);
  if (!paddedCanvas || paddedCanvas.width !== maxDim) {
    paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = maxDim;
    paddedCanvas.height = maxDim;
    paddedCanvasCtx = paddedCanvas.getContext('2d');
  }
  paddedCanvasCtx.fillStyle = '#000000';
  paddedCanvasCtx.fillRect(0, 0, maxDim, maxDim);
  paddedCanvasCtx.drawImage(img, (maxDim - w) / 2, (maxDim - h) / 2, w, h);
  if (imageTexture) imageTexture.needsUpdate = true;
}

function updateSeqSeek() {
  const total = seqImages.length;
  seekSlider.value = total > 1 ? Math.round((seqIndex / (total - 1)) * 1000) : 0;
  timeLabel.textContent = `Frame ${seqIndex + 1} / ${total}`;
  const imgEl = sourceMonitor.querySelector('img');
  if (imgEl && seqUrls[seqIndex]) imgEl.src = seqUrls[seqIndex];
}

function setTransportMode(mode) {
  const volRow = document.getElementById('volume-row');
  const sequence = mode === 'sequence';
  playPauseBtn.style.display = sequence ? '' : 'none';
  seekSlider.style.display = sequence ? '' : 'none';
  timeLabel.style.display = sequence ? '' : 'none';
  volRow.style.display = 'none';
}

function loadImageFile(file) {
  sourceMode = 'image';
  sourceName = file.name;
  cleanupSeq();
  const url = URL.createObjectURL(file);
  seqUrls.push(url);
  const img = new Image();
  img.onload = () => {
    seqImages = [img];
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const maxDim = Math.max(w, h);
    paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = maxDim;
    paddedCanvas.height = maxDim;
    paddedCanvasCtx = paddedCanvas.getContext('2d');
    if (imageTexture) imageTexture.dispose();
    imageTexture = new THREE.CanvasTexture(paddedCanvas);
    imageTexture.minFilter = THREE.LinearFilter;
    imageTexture.magFilter = THREE.LinearFilter;
    imageTexture.colorSpace = THREE.SRGBColorSpace;
    imageTexture.wrapS = THREE.ClampToEdgeWrapping;
    imageTexture.wrapT = THREE.ClampToEdgeWrapping;
    buildSphere(imageTexture);
    drawSeqFrame(0);
    buildFisheyeUVs(Number(srcFovSlider.value));
    setAspectFromDimensions(w, h);
    sourceMonitor.innerHTML = '';
    const imgEl = new Image();
    imgEl.src = url;
    imgEl.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    sourceMonitor.appendChild(imgEl);
    filenameLbl.textContent = file.name;
    dropOverlay.classList.add('hidden');
    canvas.style.pointerEvents = 'auto';
    setTransportMode('image');
    updateExportBtnState();
  };
  img.onerror = () => alert('Failed to load image: ' + file.name);
  img.src = url;
}

function loadImageSequence(files) {
  sourceMode = 'sequence';
  sourceName = Array.from(files)[0]?.name || 'sequence';
  cleanupSeq();
  const sorted = Array.from(files).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
  let loaded = 0;
  let failed = 0;
  seqImages = new Array(sorted.length);
  sorted.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    seqUrls.push(url);
    const img = new Image();
    img.onload = () => {
      seqImages[index] = img;
      loaded++;
      if (loaded === sorted.length) onSeqLoaded(failed);
    };
    img.onerror = () => {
      failed++;
      loaded++;
      if (loaded === sorted.length) onSeqLoaded(failed);
    };
    img.src = url;
  });
}

function onSeqLoaded(failed) {
  seqIndex  = 0;
  seqPlaying = false;
  playPauseBtn.textContent = '▶';

  if (failed > 0 || seqImages.some(frame => !frame)) {
    cleanupSeq();
    sourceMode = 'none';
    updateExportBtnState();
    alert(`Could not decode ${failed} sequence image${failed === 1 ? '' : 's'}.`);
    return;
  }

  const first = seqImages[0];
  const w = first.naturalWidth;
  const h = first.naturalHeight;
  const maxDim = Math.max(w, h);

  paddedCanvas = document.createElement('canvas');
  paddedCanvas.width  = maxDim;
  paddedCanvas.height = maxDim;
  paddedCanvasCtx = paddedCanvas.getContext('2d');

  if (imageTexture) imageTexture.dispose();
  imageTexture = new THREE.CanvasTexture(paddedCanvas);
  imageTexture.minFilter = THREE.LinearFilter;
  imageTexture.magFilter = THREE.LinearFilter;
  imageTexture.colorSpace = THREE.SRGBColorSpace;
  imageTexture.wrapS = THREE.ClampToEdgeWrapping;
  imageTexture.wrapT = THREE.ClampToEdgeWrapping;

  buildSphere(imageTexture);
  drawSeqFrame(0);
  buildFisheyeUVs(Number(srcFovSlider.value));
  setAspectFromDimensions(w, h);

  sourceMonitor.innerHTML = '';
  const imgEl = new Image();
  imgEl.src = seqUrls[0];
  imgEl.style.cssText = 'width:100%;height:100%;object-fit:contain;';
  sourceMonitor.appendChild(imgEl);

  filenameLbl.textContent = `${seqImages.length} images`;
  dropOverlay.classList.add('hidden');
  canvas.style.pointerEvents = 'auto';
  setTransportMode('sequence');
  saveStillBtn.disabled = false;
  updateExportBtnState();
  updateSeqSeek();
}

if (false) {
// ─── Export: Still Image ────────────────────────────────────────────────
// Detects the source video's frame rate by measuring the interval between two
// consecutive decoded frames using requestVideoFrameCallback.
function detectVideoFps(vid) {
  return new Promise(resolve => {
    if (typeof vid.requestVideoFrameCallback !== 'function') {
      resolve(DEFAULT_FPS);
      return;
    }

    const wasPaused = vid.paused;
    const startTime = vid.currentTime;
    let settled = false;

    const finish = (fps) => {
      if (settled) return;
      settled = true;
      if (wasPaused) {
        vid.pause();
        if (Math.abs(vid.currentTime - startTime) > 1e-3) {
          vid.currentTime = startTime;
        }
      }
      resolve(fps || DEFAULT_FPS);
    };

    const timer = setTimeout(() => finish(DEFAULT_FPS), 1200);

    const sample = () => {
      let firstTime = null;
      vid.requestVideoFrameCallback((_, meta) => {
        firstTime = meta.mediaTime;
        vid.requestVideoFrameCallback((__, meta2) => {
          clearTimeout(timer);
          const interval = meta2.mediaTime - firstTime;
          finish(interval > 0 ? Math.round(1 / interval) : DEFAULT_FPS);
        });
      });
    };

    if (wasPaused) {
      const p = vid.play();
      if (p && typeof p.then === 'function') {
        p.then(sample).catch(() => {
          clearTimeout(timer);
          finish(DEFAULT_FPS);
        });
      } else {
        sample();
      }
    } else {
      sample();
    }
  });
}

// ─── Export: Still Image ──────────────────────────────────────────────────────
saveStillBtn.addEventListener('click', () => {
  renderer.render(scene, camera);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = 'unring-still.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

// ─── Export: In/Out Markers ───────────────────────────────────────────────────
let markIn  = null;
let markOut = null;

function updateExportBtnState() {
  if (sourceMode === 'sequence') {
    exportAviBtn.disabled = seqImages.length === 0;
    return;
  }
  if (sourceMode === 'image') {
    exportAviBtn.disabled = true; // use Save Still instead
    return;
  }
  // video mode
  const hasValidMarkers = markIn !== null && markOut !== null && markOut > markIn;
  const noMarkers = markIn === null && markOut === null;
  exportAviBtn.disabled = !(videoTexture && (hasValidMarkers || noMarkers));
}

markInBtn.addEventListener('click', () => {
  if (!video.duration) return;
  markIn = video.currentTime;
  markInTime.textContent = formatTime(markIn);
  markInTime.classList.add('set');
  markInBtn.classList.add('set');
  updateScrubMarkers();
  updateExportBtnState();
});

markOutBtn.addEventListener('click', () => {
  if (!video.duration) return;
  markOut = video.currentTime;
  markOutTime.textContent = formatTime(markOut);
  markOutTime.classList.add('set');
  markOutBtn.classList.add('set');
  updateScrubMarkers();
  updateExportBtnState();
});

// ─── Export: AVI ─────────────────────────────────────────────────────────────
/**
 * Convert an RGBA Uint8Array (WebGL bottom-up) to padded BGR (AVI BI_RGB).
 * WebGL readPixels and AVI BI_RGB (positive biHeight) both use bottom-up row
 * order, so no vertical flip is required.
 */
function rgbaToBGR(rgba, width, height) {
  const rowStride = ((width * 3 + 3) & ~3);
  const out = new Uint8Array(rowStride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * rowStride + x * 3;
      out[di]     = rgba[si + 2]; // B
      out[di + 1] = rgba[si + 1]; // G
      out[di + 2] = rgba[si];     // R
    }
  }
  return out;
}

}

// ─── Settings: Get/Save/Load ──────────────────────────────────────────────────
function getSettings() {
  return {
    srcFov: Number(srcFovSlider.value),
    zoom: Number(zoomSlider.value),
    tilt: Number(tiltSlider.value),
    pitch: Number(pitchSlider.value),
    roll: Number(rollSlider.value)
  };
}

function applySettings(settings) {
  if (settings.srcFov !== undefined) {
    srcFovSlider.value = settings.srcFov;
    const v = Number(srcFovSlider.value);
    srcFovVal.textContent = roundedDegrees(v);
    buildFisheyeUVs(v);
  }
  if (settings.zoom !== undefined) {
    zoomSlider.value = settings.zoom;
    const v = Number(zoomSlider.value);
    zoomVal.textContent = roundedDegrees(v);
    camera.fov = v;
    camera.updateProjectionMatrix();
  }
  if (settings.tilt !== undefined) {
    tiltSlider.value = settings.tilt;
    const v = Number(tiltSlider.value);
    tiltVal.textContent = roundedDegrees(v);
    tiltValue = THREE.MathUtils.degToRad(v);
  }
  if (settings.pitch !== undefined) {
    pitchSlider.value = settings.pitch;
    const v = Number(pitchSlider.value);
    pitchVal.textContent = roundedDegrees(v);
    pitchValue = THREE.MathUtils.degToRad(v);
  }
  if (settings.roll !== undefined) {
    rollSlider.value = settings.roll;
    const v = Number(rollSlider.value);
    rollVal.textContent = roundedDegrees(v);
    rollOffset = THREE.MathUtils.degToRad(v);
  }
  applyCameraRotation();
  renderOAll();
}

function saveSettingsJSON() {
  const settings = getSettings();
  const json = JSON.stringify(settings, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'unring-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

exportSettingsBtn.addEventListener('click', saveSettingsJSON);

// ─── Image export ────────────────────────────────────────────────────────────
function renderCurrentFrame() {
  renderer.render(scene, camera);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the rendered image.'));
    }, 'image/png');
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function outputDigits(total) {
  return Math.max(4, String(total).length);
}

function paddedFrameName(index, total) {
  return `unring-${String(index + 1).padStart(outputDigits(total), '0')}.png`;
}

saveStillBtn.addEventListener('click', async () => {
  if (!imageTexture) return;
  try {
    const blob = await renderCurrentFrame();
    const base = sourceName.replace(/\.[^.]+$/, '') || 'unring';
    downloadBlob(blob, `${base}-unring.png`);
    exportStatus.textContent = 'Saved corrected image';
  } catch (err) {
    exportStatus.textContent = 'Export failed: ' + err.message;
  }
});

function updateExportBtnState() {
  const hasSource = Boolean(imageTexture);
  saveStillBtn.disabled = !hasSource;
  exportSettingsBtn.disabled = !hasSource;
  exportSequenceBtn.disabled = sourceMode !== 'sequence' || seqImages.length === 0;
}

async function exportImageSequence() {
  if (sourceMode !== 'sequence' || seqImages.length === 0) return;

  const total = seqImages.length;
  const selectedIndex = seqIndex;
  seqPlaying = false;
  playPauseBtn.textContent = '▶';
  exportSequenceBtn.disabled = true;
  saveStillBtn.disabled = true;
  exportSequenceBtn.textContent = 'Exporting...';
  exportProgress.hidden = false;
  exportBar.value = 0;

  try {
    for (let i = 0; i < total; i++) {
      seqIndex = i;
      drawSeqFrame(i);
      const blob = await renderCurrentFrame();
      downloadBlob(blob, paddedFrameName(i, total));
      exportBar.value = Math.round(((i + 1) / total) * 100);
      exportStatus.textContent = `Frame ${i + 1} / ${total}`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    exportStatus.textContent = `Saved ${total} corrected images`;
  } catch (err) {
    exportStatus.textContent = 'Export failed: ' + err.message;
    console.error(err);
  } finally {
    seqIndex = selectedIndex;
    drawSeqFrame(seqIndex);
    updateSeqSeek();
    exportSequenceBtn.textContent = 'Export Image Sequence';
    exportProgress.hidden = true;
    updateExportBtnState();
  }
}

exportSequenceBtn.addEventListener('click', exportImageSequence);

// ─── Upload button & file input ───────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());
dropOpen.addEventListener('click',  () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (!files.length) { fileInput.value = ''; return; }
  if (files.length > 1) {
    if (Array.from(files).every(isImageFile)) {
      loadImageSequence(files);
    } else {
      alert('When opening multiple files, all must be image files (for an image sequence).');
    }
  } else {
    const file = files[0];
    if (isImageFile(file)) loadImageFile(file);
    else alert('Unsupported file type. Please use a common image format.');
  }
  fileInput.value = '';
});

// ─── Import Settings ──────────────────────────────────────────────────────────
importSettingsBtn.addEventListener('click', () => settingsInput.click());
settingsInput.addEventListener('change', () => {
  if (settingsInput.files.length) {
    const file = settingsInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target.result);
        applySettings(settings);
      } catch (err) {
        alert('Failed to load settings: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
  settingsInput.value = '';
});

// ─── Drag-and-drop ────────────────────────────────────────────────────────────
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add('drag-over');
});

document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('drag-over');
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
  handleDroppedFiles(e.dataTransfer.files);
});

// Also listen on viewport specifically to handle drop events
viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add('drag-over');
});

viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
  handleDroppedFiles(e.dataTransfer.files);
});

function handleDroppedFiles(files) {
  if (!files || files.length === 0) return;
  if (files.length > 1) {
    if (Array.from(files).every(isImageFile)) {
      loadImageSequence(files);
    } else {
      alert('When dropping multiple files, all must be image files (for an image sequence).');
    }
  } else {
    const file = files[0];
    if (isImageFile(file)) loadImageFile(file);
    else alert('Unsupported file type. Please use a common image format.');
  }
}

// ─── Overlay Tools ───────────────────────────────────────────────────────────
const overlaySvg  = document.getElementById('overlay-svg');
const toolThreePointLineBtn = document.getElementById('tool-three-point-line-btn');
const threePointLineColorInput = document.getElementById('three-point-line-color');
const optimizeFovBtn = document.getElementById('optimize-fov-btn');

let oTools    = [];   // [{id, type, ...data}]
let oSelected = null; // id of selected tool
let oMode     = null; // 'three-point-line' | null  (creation mode)
let threePointLineColor = '#4ade80';
threePointLineColorInput.addEventListener('input', () => { threePointLineColor = threePointLineColorInput.value; });
let oDrag     = null; // active drag state
let oIdCtr    = 0;

function updateOptimizeButtonState() {
  optimizeFovBtn.disabled = oTools.filter(tool => tool.type === 'three-point-line').length < 2;
}

// SVG namespace helper
function ns(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

window.addEventListener('resize', () => renderOAll());

// ─── Creation mode ────────────────────────────────────────────────────────────
function setOMode(mode) {
  if (mode !== 'three-point-line') oPendingThreePointPixels = [];
  oMode = mode;
  overlaySvg.style.pointerEvents = mode ? 'all' : 'none';
  overlaySvg.style.cursor = mode ? 'crosshair' : '';
  toolThreePointLineBtn.classList.toggle('active-mode', mode === 'three-point-line');
}

toolThreePointLineBtn.addEventListener('click', () => setOMode(oMode === 'three-point-line' ? null : 'three-point-line'));

function getFovOptimizationScore(lines, sourceFov) {
  let score = 0;
  for (const line of lines) {
    const points = line.points.map(point => imagePixelToScreenPoint(point, sourceFov));
    if (points.some(point => !point)) return Number.POSITIVE_INFINITY;
    const { deviationPercent } = calculateThreePointStraightness(points);
    score += deviationPercent ** 2;
  }
  return score / lines.length;
}

function optimizeSourceFov() {
  const lines = oTools.filter(tool => tool.type === 'three-point-line');
  if (lines.length < 2) return;

  let lower = Number(srcFovSlider.min);
  let upper = Number(srcFovSlider.max);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let left = upper - ratio * (upper - lower);
  let right = lower + ratio * (upper - lower);
  let leftScore = getFovOptimizationScore(lines, left);
  let rightScore = getFovOptimizationScore(lines, right);

  for (let iteration = 0; iteration < 36; iteration++) {
    if (leftScore <= rightScore) {
      upper = right;
      right = left;
      rightScore = leftScore;
      left = upper - ratio * (upper - lower);
      leftScore = getFovOptimizationScore(lines, left);
    } else {
      lower = left;
      left = right;
      leftScore = rightScore;
      right = lower + ratio * (upper - lower);
      rightScore = getFovOptimizationScore(lines, right);
    }
  }

  const candidates = [lower, upper, left, right];
  const bestFov = candidates.reduce((best, candidate) =>
    getFovOptimizationScore(lines, candidate) < getFovOptimizationScore(lines, best)
      ? candidate : best
  );
  srcFovSlider.value = bestFov;
  srcFovSlider.dispatchEvent(new Event('input', { bubbles: true }));
}

optimizeFovBtn.addEventListener('click', optimizeSourceFov);

// Press Escape to cancel creation mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && oMode) {
    setOMode(null);
    clearPendingThreePointPreview();
  }
});

function svgPt(e) {
  const r = overlaySvg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function screenPointToImagePixel(point) {
  const image = seqImages[0];
  if (!image) return null;
  const rect = canvas.getBoundingClientRect();
  if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return null;

  const ndcX = ((point.x - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((point.y - rect.top) / rect.height) * 2;
  const worldRay = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
  const theta = Math.acos(Math.max(-1, Math.min(1, -worldRay.z)));
  const halfFov = THREE.MathUtils.degToRad(Number(srcFovSlider.value) / 2);
  const radius = (theta / halfFov) * 0.5;
  const phi = Math.atan2(worldRay.y, worldRay.x);
  const u = 0.5 + radius * Math.cos(phi);
  const v = 0.5 + radius * Math.sin(phi);
  const maxDim = Math.max(image.naturalWidth, image.naturalHeight);
  const offsetX = (maxDim - image.naturalWidth) / 2;
  const offsetY = (maxDim - image.naturalHeight) / 2;
  const x = u * maxDim - offsetX;
  const y = v * maxDim - offsetY;
  if (x < 0 || x > image.naturalWidth || y < 0 || y > image.naturalHeight) return null;
  return { x, y };
}

function svgPointToImagePixel(point) {
  const rect = overlaySvg.getBoundingClientRect();
  return screenPointToImagePixel({ x: point.x + rect.left, y: point.y + rect.top });
}

function imagePixelToScreenPoint(point, sourceFov = Number(srcFovSlider.value)) {
  const image = seqImages[0];
  if (!image) return null;
  const maxDim = Math.max(image.naturalWidth, image.naturalHeight);
  const offsetX = (maxDim - image.naturalWidth) / 2;
  const offsetY = (maxDim - image.naturalHeight) / 2;
  const u = (point.x + offsetX) / maxDim;
  const v = (point.y + offsetY) / maxDim;
  const halfFov = THREE.MathUtils.degToRad(sourceFov / 2);
  const radius = Math.hypot(u - 0.5, v - 0.5);
  const theta = radius / 0.5 * halfFov;
  const phi = Math.atan2(v - 0.5, u - 0.5);
  const worldRay = new THREE.Vector3(
    Math.sin(theta) * Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
    -Math.cos(theta)
  );
  const projected = worldRay.project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  const rect = canvas.getBoundingClientRect();
  const overlayRect = overlaySvg.getBoundingClientRect();
  return {
    x: rect.left + (projected.x + 1) * rect.width / 2 - overlayRect.left,
    y: rect.top + (1 - projected.y) * rect.height / 2 - overlayRect.top
  };
}

let oPendingThreePointPixels = [];

function clearPendingThreePointPreview() {
  overlaySvg.querySelector('[data-pending-three-point]')?.remove();
}

function renderPendingThreePointPreview() {
  clearPendingThreePointPreview();
  const points = oPendingThreePointPixels.map(point => imagePixelToScreenPoint(point)).filter(Boolean);
  if (!points.length) return;
  const g = ns('g', { 'data-pending-three-point': 'true', 'pointer-events': 'none' });
  if (points.length > 1) {
    g.appendChild(ns('polyline', {
      points: points.map(point => `${point.x},${point.y}`).join(' '),
      fill: 'none', stroke: threePointLineColor, 'stroke-width': 2, 'stroke-dasharray': '5 4'
    }));
  }
  points.forEach(point => g.appendChild(ns('circle', {
    cx: point.x, cy: point.y, r: 5, fill: threePointLineColor, stroke: '#111', 'stroke-width': 1.5
  })));
  overlaySvg.appendChild(g);
}

overlaySvg.addEventListener('mousedown', (e) => {
  if (!oMode || e.target !== overlaySvg) return;
  e.stopPropagation();
  if (oMode === 'three-point-line') {
    const pixel = screenPointToImagePixel({ x: e.clientX, y: e.clientY });
    if (!pixel) return;
    oPendingThreePointPixels.push(pixel);
    renderPendingThreePointPreview();
    if (oPendingThreePointPixels.length === 3) {
      addOThreePointLine(oPendingThreePointPixels);
      oPendingThreePointPixels = [];
      clearPendingThreePointPreview();
      setOMode(null);
    }
    return;
  }
});

window.addEventListener('mousemove', (e) => {
  if (oDrag) handleODrag(e);
});

window.addEventListener('mouseup', () => {
  if (oDrag) oDrag = null;
});

// ─── Drag handler ─────────────────────────────────────────────────────────────
function handleODrag(e) {
  const p    = svgPt(e);
  const tool = oTools.find(t => t.id === oDrag.toolId);
  if (!tool) return;
  if (oDrag.kind === 'line-ep') {
    if (oDrag.idx === 0) { tool.x1 = p.x; tool.y1 = p.y; }
    else                  { tool.x2 = p.x; tool.y2 = p.y; }
  } else if (oDrag.kind === 'corner') {
    const pixel = svgPointToImagePixel(p);
    if (pixel) tool.corners[oDrag.idx] = pixel;
  } else if (oDrag.kind === 'three-point-node') {
    const pixel = svgPointToImagePixel(p);
    if (pixel) tool.points[oDrag.idx] = pixel;
  } else if (oDrag.kind === 'three-point-line') {
    const pixel = svgPointToImagePixel(p);
    if (pixel) {
      const dx = pixel.x - oDrag.start.x;
      const dy = pixel.y - oDrag.start.y;
      tool.points = oDrag.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    }
  }
  renderOTool(tool);
}

// ─── Add tools ────────────────────────────────────────────────────────────────
function addOLine(x1, y1, x2, y2) {
  const tool = { id: ++oIdCtr, type: 'line', x1, y1, x2, y2, color: lineColor };
  oTools.push(tool);
  renderOTool(tool);
  selectOTool(tool.id);
}

function addOThreePointLine(points) {
  const tool = { id: ++oIdCtr, type: 'three-point-line', points: points.map(point => ({ ...point })), color: threePointLineColor };
  oTools.push(tool);
  renderOTool(tool);
  selectOTool(tool.id);
  updateOptimizeButtonState();
}

// ─── Select / deselect / remove ───────────────────────────────────────────────
function selectOTool(id) { oSelected = id; renderOAll(); }
function deselectOAll()  { oSelected = null; renderOAll(); }
function removeOTool(id) {
  overlaySvg.querySelector(`[data-tid="${id}"]`)?.remove();
  oTools = oTools.filter(t => t.id !== id);
  if (oSelected === id) oSelected = null;
  updateOptimizeButtonState();
}

overlaySvg.addEventListener('click', (e) => { if (e.target === overlaySvg) deselectOAll(); });

// ─── Render ───────────────────────────────────────────────────────────────────
function renderOAll() {
  overlaySvg.querySelectorAll('[data-tid]').forEach(el => el.remove());
  oTools.forEach(renderOTool);
}

function renderOTool(tool) {
  overlaySvg.querySelector(`[data-tid="${tool.id}"]`)?.remove();
  if (tool.type === 'line') renderOLine(tool);
  else if (tool.type === 'three-point-line') renderOThreePointLine(tool);
  else                       renderOGrid(tool);
}

function calculateThreePointStraightness(points) {
  const [start, middle, end] = points;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const deviation = Math.abs(dy * middle.x - dx * middle.y + end.x * start.y - end.y * start.x) / length;
  const deviationPercent = deviation / length * 100;
  return {
    deviationPercent,
    straight: deviationPercent <= 1
  };
}

function renderOThreePointLine(tool) {
  const screenPoints = tool.points.map(point => imagePixelToScreenPoint(point));
  if (screenPoints.some(point => !point)) return;
  const { deviationPercent, straight } = calculateThreePointStraightness(screenPoints);
  const color = straight ? '#4ade80' : (tool.color || '#4ade80');
  const g = ns('g', { 'data-tid': tool.id });
  const hit = ns('polyline', {
    points: screenPoints.map(point => `${point.x},${point.y}`).join(' '),
    fill: 'none', stroke: 'transparent', 'stroke-width': 18,
    'pointer-events': 'stroke', cursor: 'move'
  });
  hit.addEventListener('click', (e) => { e.stopPropagation(); selectOTool(tool.id); });
  hit.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const start = screenPointToImagePixel({ x: e.clientX, y: e.clientY });
    if (!start) return;
    oSelected = tool.id;
    oDrag = { kind: 'three-point-line', toolId: tool.id, start,
      points: tool.points.map(point => ({ ...point })) };
    renderOAll();
  });
  g.appendChild(hit);
  g.appendChild(ns('polyline', {
    points: screenPoints.map(point => `${point.x},${point.y}`).join(' '),
    fill: 'none', stroke: color, 'stroke-width': straight ? 3 : 2, 'pointer-events': 'none'
  }));
  screenPoints.forEach((point, index) => {
    const ep = ns('circle', { cx: point.x, cy: point.y, r: 6, fill: color,
      stroke: '#111', 'stroke-width': 1.5, cursor: 'pointer', 'pointer-events': 'all' });
    ep.addEventListener('click', (e) => { e.stopPropagation(); selectOTool(tool.id); });
    ep.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      oSelected = tool.id;
      oDrag = { kind: 'three-point-node', toolId: tool.id, idx: index };
      renderOAll();
    });
    g.appendChild(ep);
  });
  const label = ns('text', { x: screenPoints[1].x + 9, y: screenPoints[1].y - 9,
    fill: color, class: 'straightness-label' });
  label.textContent = straight
    ? `Straight · 100.0%`
    : `Straightness ${Math.max(0, 100 - deviationPercent).toFixed(1)}%`;
  g.appendChild(label);
  if (oSelected === tool.id) {
    const mx = screenPoints.reduce((sum, point) => sum + point.x, 0) / screenPoints.length;
    const my = screenPoints.reduce((sum, point) => sum + point.y, 0) / screenPoints.length;
    g.appendChild(makeORemoveBtn(mx, my, tool.id));
  }
  overlaySvg.appendChild(g);
}

// ─── Line rendering ───────────────────────────────────────────────────────────
function renderOLine(tool) {
  const sel   = oSelected === tool.id;
  const color = tool.color || '#facc15';
  const g     = ns('g', { 'data-tid': tool.id });

  // Thick transparent hit area
  const hit = ns('line', { x1: tool.x1, y1: tool.y1, x2: tool.x2, y2: tool.y2,
    stroke: 'transparent', 'stroke-width': 20, 'pointer-events': 'stroke', cursor: 'pointer' });
  hit.addEventListener('click', (e) => { e.stopPropagation(); selectOTool(tool.id); });

  // Visible line
  const vis = ns('line', { x1: tool.x1, y1: tool.y1, x2: tool.x2, y2: tool.y2,
    stroke: color, 'stroke-width': sel ? 2.5 : 1.5, 'pointer-events': 'none' });

  g.appendChild(hit);
  g.appendChild(vis);

  // Endpoint handles
  [[tool.x1, tool.y1, 0], [tool.x2, tool.y2, 1]].forEach(([cx, cy, idx]) => {
    const ep = ns('circle', { cx, cy, r: 6, fill: color,
      stroke: '#1a1a1a', 'stroke-width': 1.5, cursor: 'move', 'pointer-events': 'all' });
    ep.addEventListener('mousedown', (e) => { e.stopPropagation(); oDrag = { kind: 'line-ep', toolId: tool.id, idx }; });
    g.appendChild(ep);
  });

  // Remove button (perpendicular offset from midpoint)
  if (sel) {
    const mx = (tool.x1 + tool.x2) / 2, my = (tool.y1 + tool.y2) / 2;
    const dx = tool.x2 - tool.x1,       dy = tool.y2 - tool.y1;
    const len = Math.hypot(dx, dy) || 1;
    const bx = mx + (-dy / len) * 24, by = my + (dx / len) * 24;
    g.appendChild(makeORemoveBtn(bx, by, tool.id));
  }

  overlaySvg.appendChild(g);
}

// ─── Grid rendering ───────────────────────────────────────────────────────────
function renderOGrid(tool) {
  const sel             = oSelected === tool.id;
  const color           = tool.color || '#22d3ee';
  const screenCorners = tool.corners.map(imagePixelToScreenPoint);
  if (screenCorners.some(point => !point)) return;
  const [tl, tr, br, bl] = screenCorners;
  const { hCells, vCells } = tool;
  const g               = ns('g', { 'data-tid': tool.id });

  // Build bilinear grid path
  let d = '';
  for (let row = 0; row <= vCells; row++) {
    const v = row / vCells;
    for (let col = 0; col <= hCells; col++) {
      const p = bilerp(tl, tr, br, bl, col / hCells, v);
      d += col === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
  }
  for (let col = 0; col <= hCells; col++) {
    const u = col / hCells;
    for (let row = 0; row <= vCells; row++) {
      const p = bilerp(tl, tr, br, bl, u, row / vCells);
      d += row === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
  }

  const grid = ns('path', { d, fill: 'none',
    stroke: color, 'stroke-width': sel ? 1.5 : 1, opacity: 0.9, 'pointer-events': 'none' });

  // Invisible border for hit-testing
  const border = `M${tl.x},${tl.y} L${tr.x},${tr.y} L${br.x},${br.y} L${bl.x},${bl.y} Z`;
  const hitBorder = ns('path', { d: border, fill: 'none',
    stroke: 'transparent', 'stroke-width': 18, 'pointer-events': 'stroke', cursor: 'pointer' });
  hitBorder.addEventListener('click', (e) => { e.stopPropagation(); selectOTool(tool.id); });

  g.appendChild(grid);
  g.appendChild(hitBorder);

  // Corner handles
  screenCorners.forEach((c, idx) => {
    const ep = ns('circle', { cx: c.x, cy: c.y, r: 6,
      fill: color, stroke: '#1a1a1a', 'stroke-width': 1.5,
      cursor: 'move', 'pointer-events': 'all' });
    ep.addEventListener('mousedown', (e) => { e.stopPropagation(); oDrag = { kind: 'corner', toolId: tool.id, idx }; });
    g.appendChild(ep);
  });

  // Remove button at centroid
  if (sel) {
    const cx = screenCorners.reduce((s, c) => s + c.x, 0) / 4;
    const cy = screenCorners.reduce((s, c) => s + c.y, 0) / 4;
    g.appendChild(makeORemoveBtn(cx, cy, tool.id));
  }

  overlaySvg.appendChild(g);
}

// ─── Bilinear interpolation ───────────────────────────────────────────────────
function bilerp(tl, tr, br, bl, u, v) {
  return {
    x: (1-u)*(1-v)*tl.x + u*(1-v)*tr.x + u*v*br.x + (1-u)*v*bl.x,
    y: (1-u)*(1-v)*tl.y + u*(1-v)*tr.y + u*v*br.y + (1-u)*v*bl.y,
  };
}

// ─── Remove button ────────────────────────────────────────────────────────────
function makeORemoveBtn(cx, cy, toolId) {
  const g = ns('g', { cursor: 'pointer', 'pointer-events': 'all' });
  g.appendChild(ns('circle', { cx, cy, r: 10, fill: '#ef4444', stroke: '#fff', 'stroke-width': 1.5 }));
  const txt = ns('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: '#fff', 'font-size': '13', 'font-weight': 'bold', 'pointer-events': 'none' });
  txt.textContent = '✕';
  g.appendChild(txt);
  g.addEventListener('click', (e) => { e.stopPropagation(); removeOTool(toolId); });
  return g;
}
