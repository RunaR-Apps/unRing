# plan.md: unRing Project Specification

**Project Name:** unRing  
**Objective:** A web-based utility to correct fisheye lens distortion from doorbell cameras using Three.js spherical projection.

---

## 1. Project Overview
unRing solves the "edge-of-frame" distortion common in wide-angle security footage. By projecting the video onto the interior of a virtual 3D hemisphere and using a rectilinear virtual camera, users can "look around" the footage and extract undistorted views of subjects.

## 2. Technical Stack
* **3D Engine:** Three.js (WebGL)
* **Interface:** HTML5 / CSS3 / Vanilla JavaScript
* **Video Input:** HTML5 Video API + `THREE.VideoTexture`
* **Video Export:** MediaRecorder API + `canvas.captureStream()`

---

## 3. Core Mathematical Logic: The "Virtual VR Rig"
Instead of complex 2D image warping, we use a 3D geometry approach:
1.  **The Projection:** Video is mapped as a texture onto a `SphereGeometry`.
2.  **Inversion:** The geometry is inverted (Normals flipped or Scale Z = -1) so the camera sees the texture from the inside.
3.  **The View:** A `PerspectiveCamera` is placed at the origin $(0, 0, 0)$. 
4.  **The Correction:** By adjusting the `camera.fov` (Field of View) and rotating the camera, the spherical distortion is naturally neutralized into a rectilinear (flat) perspective.

---

## 4. Development Phases

### Phase 1: Environment & Media Pipeline
* [ ] Initialize Three.js scene (No lighting, `MeshBasicMaterial` only).
* [ ] Implement file uploader for `.mp4`, `.mov`, and `.webm`.
* [ ] Map video file to a `THREE.VideoTexture`.
* [ ] Create a high-density `SphereGeometry` (min 128x128 segments) and apply the video texture to the interior.

### Phase 2: Calibration & Interaction
* [ ] **Projection Alignment:** Adjust UV mapping so a 180° fisheye covers exactly half the sphere.
* [ ] **Virtual Controls:** Implement mouse/touch "drag-to-look" functionality to rotate the camera.
* [ ] **Lens Tuning:** Create sliders for:
    * **Source FOV:** Calibrate for 140° vs 180° vs 200° lenses.
    * **Virtual Zoom:** Change the `PerspectiveCamera.fov`.
    * **Roll/Tilt:** Correct for cameras mounted at odd angles.

### Phase 3: User Interface (unRing Dashboard)
* [ ] **Main Viewport:** Large WebGL canvas showing the corrected view.
* [ ] **Source Monitor:** Small 2D thumbnail of the raw, distorted footage for reference.
* [ ] **Transport Controls:** Play, Pause, Seek, and Volume.
* [ ] **Aspect Ratio Presets:** 1:1 (Ring), 4:3, and 16:9 toggles.

### Phase 4: Recording & Export
* [ ] Implement `MediaRecorder` logic to capture the WebGL canvas.
* [ ] Synchronize the start of the source video with the start of the recorder.
* [ ] Output a downloadable `.webm` or `.mp4` file of the corrected viewpoint.

---

## 5. Technical Challenges & Mitigations
| Challenge | Mitigation |
| :--- | :--- |
| **Jagged Edges** | Use high-segment count spheres and `LinearFilter` on textures. |
| **Resolution Loss** | Provide a "High Quality" render mode that increases the canvas size during export. |
| **Performance** | Only update the `VideoTexture` on `requestAnimationFrame` when the video is playing. |

---

## 6. Success Criteria
* Users can upload a Ring doorbell clip.
* Users can pan the view to an edge-distorted person and see them "flattened."
* Users can export a 10-second corrected clip of that person.