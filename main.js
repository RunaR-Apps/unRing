import * as THREE from 'three';
import { encodeAVI } from './avi-writer.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas        = document.getElementById('canvas');
const video         = document.getElementById('video');
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
const volSlider     = document.getElementById('vol-slider');
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
const markInBtn     = document.getElementById('mark-in-btn');
const markOutBtn    = document.getElementById('mark-out-btn');
const markInTime    = document.getElementById('mark-in-time');
const markOutTime   = document.getElementById('mark-out-time');
const exportFpsEl   = document.getElementById('export-fps');
const exportAviBtn  = document.getElementById('export-avi-btn');
const exportProgress = document.getElementById('export-progress');
const exportBar     = document.getElementById('export-bar');
const exportStatus  = document.getElementById('export-status');
const importSettingsBtn = document.getElementById('import-settings-btn');
const settingsInput = document.getElementById('settings-input');

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

let videoTexture = null;
let sphereMesh   = null;

// Padded canvas for non-square videos (1:1 aspect with black borders)
let paddedCanvas = null;
let paddedCanvasCtx = null;

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
}, { passive: true });

// ─── Animation loop ──────────────────────────────────────────────────────────
function tick() {
  requestAnimationFrame(tick);
  if (videoTexture && paddedCanvas && !video.paused && !video.ended) {
    // Update padded canvas with current video frame
    const w = video.videoWidth;
    const h = video.videoHeight;
    const maxDim = Math.max(w, h);
    paddedCanvasCtx.fillStyle = '#000000';
    paddedCanvasCtx.fillRect(0, 0, maxDim, maxDim);
    const x = (maxDim - w) / 2;
    const y = (maxDim - h) / 2;
    paddedCanvasCtx.drawImage(video, x, y, w, h);
    videoTexture.needsUpdate = true;
    updateSeek();
  }
  renderer.render(scene, camera);
}
tick();

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

srcFovSlider.addEventListener('input', () => {
  const v = Number(srcFovSlider.value);
  srcFovVal.textContent = v + '°';
  buildFisheyeUVs(v);
});

zoomSlider.addEventListener('input', () => {
  const v = Number(zoomSlider.value);
  zoomVal.textContent = v + '°';
  camera.fov = v;
  camera.updateProjectionMatrix();
});

tiltSlider.addEventListener('input', () => {
  const v = Number(tiltSlider.value);
  tiltVal.textContent = v + '°';
  tiltValue = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
});

pitchSlider.addEventListener('input', () => {
  const v = Number(pitchSlider.value);
  pitchVal.textContent = v + '°';
  pitchValue = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
});

rollSlider.addEventListener('input', () => {
  const v = Number(rollSlider.value);
  rollVal.textContent = v + '°';
  rollOffset = THREE.MathUtils.degToRad(v);
  applyCameraRotation();
});

// ─── Aspect ratio presets ─────────────────────────────────────────────────────
document.querySelectorAll('#aspect-btns button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#aspect-btns button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    targetAspect = Number(btn.dataset.aspect);
    resize();
  });
});

// ─── Transport controls ───────────────────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function updateSeek() {
  if (!video.duration) return;
  const pct = video.currentTime / video.duration;
  seekSlider.value = Math.round(pct * 1000);
  timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

playPauseBtn.addEventListener('click', () => {
  if (video.paused) { video.play(); }
  else              { video.pause(); }
});

video.addEventListener('play',  () => { playPauseBtn.textContent = '⏸'; });
video.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });
video.addEventListener('ended', () => { playPauseBtn.textContent = '▶'; });

seekSlider.addEventListener('input', () => {
  if (!video.duration) return;
  video.currentTime = (seekSlider.value / 1000) * video.duration;
});

volSlider.addEventListener('input', () => {
  video.volume = Number(volSlider.value);
});

// ─── File loading ─────────────────────────────────────────────────────────────
function loadVideoFile(file) {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(file.type) && !file.name.match(/\.(mp4|mov|webm)$/i)) {
    alert('Unsupported file type. Please use .mp4, .mov, or .webm.');
    return;
  }

  if (video.src) URL.revokeObjectURL(video.src);

  video.src = URL.createObjectURL(file);
  video.load();

  video.addEventListener('canplay', onCanPlay, { once: true });

  filenameLbl.textContent = file.name;
  dropOverlay.classList.add('hidden');
  canvas.style.pointerEvents = 'auto'; // Re-enable canvas interaction when video loads
}

function onCanPlay() {
  if (videoTexture) videoTexture.dispose();

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const maxDim = Math.max(vw, vh);

  // Create or resize padded canvas to 1:1 aspect
  if (!paddedCanvas || paddedCanvas.width !== maxDim) {
    paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = maxDim;
    paddedCanvas.height = maxDim;
    paddedCanvasCtx = paddedCanvas.getContext('2d');
  }

  // Draw video centered with black padding on square canvas
  paddedCanvasCtx.fillStyle = '#000000';
  paddedCanvasCtx.fillRect(0, 0, maxDim, maxDim);
  const x = (maxDim - vw) / 2;
  const y = (maxDim - vh) / 2;
  paddedCanvasCtx.drawImage(video, x, y, vw, vh);

  // Use canvas texture instead of video texture for proper 1:1 aspect padding
  videoTexture = new THREE.CanvasTexture(paddedCanvas);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.colorSpace = THREE.SRGBColorSpace;

  buildSphere(videoTexture);

  // Clamp so out-of-circle vertices sample the black border, not wrap-around.
  videoTexture.wrapS = THREE.ClampToEdgeWrapping;
  videoTexture.wrapT = THREE.ClampToEdgeWrapping;

  // Set output aspect ratio based on user selection (default 1:1 now)
  targetAspect = 1;
  resize();

  // UV bake is already applied to the geometry; re-bake in case FOV changed.
  buildFisheyeUVs(Number(srcFovSlider.value));

  // Mirror video into source monitor
  sourceMonitor.innerHTML = '';
  const mirrorVid = video.cloneNode(false);
  mirrorVid.style.cssText = 'width:100%;height:100%;object-fit:contain;';
  mirrorVid.src = video.src;
  mirrorVid.currentTime = video.currentTime;
  mirrorVid.muted = true;
  mirrorVid.autoplay = false;
  // Sync mirror with main video
  video.addEventListener('play',  () => mirrorVid.play());
  video.addEventListener('pause', () => mirrorVid.pause());
  video.addEventListener('seeked', () => { mirrorVid.currentTime = video.currentTime; });
  sourceMonitor.appendChild(mirrorVid);

  video.play();

  // Update seek bar range now we know duration
  video.addEventListener('loadedmetadata', updateSeek);
  updateSeek();

  // Enable export controls now that a video is loaded
  saveStillBtn.disabled = false;
  updateExportBtnState();

  // Auto-detect source fps via requestVideoFrameCallback (two-frame interval)
  detectVideoFps(video).then(fps => {
    if (!fps) return;
    const opts  = Array.from(exportFpsEl.options).map(o => Number(o.value));
    const nearest = opts.reduce((a, b) => Math.abs(b - fps) < Math.abs(a - fps) ? b : a);
    exportFpsEl.value = String(nearest);
  });
}

// ─── Export: Still Image ────────────────────────────────────────────────
// Detects the source video's frame rate by measuring the interval between two
// consecutive decoded frames using requestVideoFrameCallback.
function detectVideoFps(vid) {
  return new Promise(resolve => {
    if (typeof vid.requestVideoFrameCallback !== 'function') {
      resolve(null);
      return;
    }
    let firstTime = null;
    vid.requestVideoFrameCallback((_, meta) => {
      firstTime = meta.mediaTime;
      vid.requestVideoFrameCallback((__, meta2) => {
        const interval = meta2.mediaTime - firstTime;
        resolve(interval > 0 ? Math.round(1 / interval) : null);
      });
    });
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
  // Enable export if: (1) both markers set and valid, OR (2) no markers set (full video)
  const hasValidMarkers = markIn !== null && markOut !== null && markOut > markIn;
  const noMarkers = markIn === null && markOut === null;
  exportAviBtn.disabled = !(videoTexture && (hasValidMarkers || noMarkers));
}

markInBtn.addEventListener('click', () => {
  markIn = video.currentTime;
  markInTime.textContent = formatTime(markIn);
  markInTime.classList.add('set');
  markInBtn.classList.add('set');
  updateExportBtnState();
});

markOutBtn.addEventListener('click', () => {
  markOut = video.currentTime;
  markOutTime.textContent = formatTime(markOut);
  markOutTime.classList.add('set');
  markOutBtn.classList.add('set');
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
    srcFovVal.textContent = v + '°';
    buildFisheyeUVs(v);
  }
  if (settings.zoom !== undefined) {
    zoomSlider.value = settings.zoom;
    const v = Number(zoomSlider.value);
    zoomVal.textContent = v + '°';
    camera.fov = v;
    camera.updateProjectionMatrix();
  }
  if (settings.tilt !== undefined) {
    tiltSlider.value = settings.tilt;
    const v = Number(tiltSlider.value);
    tiltVal.textContent = v + '°';
    tiltValue = THREE.MathUtils.degToRad(v);
  }
  if (settings.pitch !== undefined) {
    pitchSlider.value = settings.pitch;
    const v = Number(pitchSlider.value);
    pitchVal.textContent = v + '°';
    pitchValue = THREE.MathUtils.degToRad(v);
  }
  if (settings.roll !== undefined) {
    rollSlider.value = settings.roll;
    const v = Number(rollSlider.value);
    rollVal.textContent = v + '°';
    rollOffset = THREE.MathUtils.degToRad(v);
  }
  applyCameraRotation();
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

exportAviBtn.addEventListener('click', async () => {
  // Determine export range: use markers if set, otherwise full video
  let startTime, endTime;
  if (markIn !== null && markOut !== null && markOut > markIn) {
    startTime = markIn;
    endTime = markOut;
  } else if (markIn === null && markOut === null) {
    startTime = 0;
    endTime = video.duration;
  } else {
    return;
  }

  const fps        = Number(exportFpsEl.value);
  const dt         = 1 / fps;
  const gl         = renderer.getContext();
  const w          = renderer.domElement.width;
  const h          = renderer.domElement.height;
  const totalFrames = Math.ceil((endTime - startTime) * fps);
  const wasPlaying  = !video.paused;

  // Lock UI during export
  exportAviBtn.disabled  = true;
  exportAviBtn.textContent = 'Exporting...';

  const bgrFrames = [];

  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = startTime + i * dt;
      if (t > endTime) break;

      video.currentTime = t;
      await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));

      // Redraw the current video frame onto the padded canvas
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const maxDim = Math.max(vw, vh);
      paddedCanvasCtx.fillStyle = '#000000';
      paddedCanvasCtx.fillRect(0, 0, maxDim, maxDim);
      const px = (maxDim - vw) / 2;
      const py = (maxDim - vh) / 2;
      paddedCanvasCtx.drawImage(video, px, py, vw, vh);

      videoTexture.needsUpdate = true;
      renderer.render(scene, camera);

      const rgba = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      bgrFrames.push(rgbaToBGR(rgba, w, h));

      const pct = Math.round(((i + 1) / totalFrames) * 100);
      exportBar.value       = pct;
      exportStatus.textContent = `Frame ${i + 1} / ${totalFrames}`;

      // Yield to keep the UI responsive
      await new Promise(r => setTimeout(r, 0));
    }

    exportStatus.textContent = 'Building AVI…';
    await new Promise(r => setTimeout(r, 0));

    const blob = encodeAVI(bgrFrames, w, h, fps);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'unring-export.avi';
    a.click();
    URL.revokeObjectURL(url);

    // Also save settings
    saveSettingsJSON();

    exportStatus.textContent = `Done — ${totalFrames} frames, ${(blob.size / 1e6).toFixed(1)} MB`;
  } catch (err) {
    exportStatus.textContent = 'Export failed: ' + err.message;
    console.error(err);
  } finally {
    exportAviBtn.textContent = 'Export AVI (Uncompressed)';
    updateExportBtnState();
    if (wasPlaying) video.play();
  }
});

// ─── Upload button & file input ───────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());
dropOpen.addEventListener('click',  () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) loadVideoFile(fileInput.files[0]);
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
  const file = e.dataTransfer.files[0];
  if (file) loadVideoFile(file);
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
  const file = e.dataTransfer.files[0];
  if (file) loadVideoFile(file);
});
