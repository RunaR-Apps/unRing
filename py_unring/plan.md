# plan.md: unRing (Python Edition)

**Project Name:** unRing  
**Objective:** A desktop Python utility to "de-warp" fisheye footage from doorbell cameras using OpenCV mathematical remapping.

---

## 1. Project Architecture
The Python version treats the video as a series of arrays (NumPy). We use coordinate transformation matrices to "pull" the curved pixels into a straight, rectilinear grid.

* **Language:** Python 3.x
* **Core Library:** OpenCV (`opencv-python`)
* **Math:** NumPy
* **GUI:** PyQt6 or Tkinter (for real-time slider adjustments)
* **Video I/O:** OpenCV `VideoCapture` and `VideoWriter`

---

## 2. Core Technical Strategy
### The Remapping Model
1.  **Map Initialization:** Create a blank coordinate map (mesh) for the target "flat" image.
2.  **Gnomonic Projection:** For every pixel $(x, y)$ in the output image, calculate the corresponding polar coordinates $(\theta, \phi)$ on a virtual sphere.
3.  **Lens Calibration:** Use the **Brown-Conrady** or **Fisheye** model to map those spherical coordinates back to the distorted $(u, v)$ coordinates of the raw Ring footage.
4.  **Interpolation:** Use `cv2.remap` with `INTER_LINEAR` to fill the new image pixels smoothly.

---

## 3. Development Roadmap

### Phase 1: The Processing Engine (CLI)
* [ ] Setup Python virtual environment and install `opencv-python` and `numpy`.
* [ ] Create a script to load a single frame from a video file.
* [ ] Implement a basic `undistort` function using `cv2.fisheye.undistortImage`.
* [ ] **Key Task:** Calculate a "Camera Matrix" ($K$) and "Distortion Coefficients" ($D$) that represent a standard wide-angle lens.

### Phase 2: The Interactive UI (The "unRing" Dashboard)
* [ ] Build a window using **PyQt6** or **Tkinter**.
* [ ] Integrate a "Live Preview" canvas that updates the image as sliders move.
* [ ] **Slider Implementations:**
    * **Focal Length ($f$):** Controls the "zoom" or scale of the correction.
    * **Principal Point ($cx, cy$):** Shifts the center of the correction (useful if the person is far to the left).
    * **Distortion Strength ($k_1, k_2$):** Fine-tunes the "straightness" of lines.
    * **Rotation/Balance:** Adjusts for cameras that are tilted.

### Phase 3: Playback & Timeline
* [ ] Implement a video seek bar to choose specific frames for testing.
* [ ] Add a "Toggle Original" button to compare the distortion side-by-side.

### Phase 4: Batch Export
* [ ] Set up `cv2.VideoWriter` to handle output encoding (H.264/MP4).
* [ ] Create a "Process Video" routine that iterates through every frame, applies the map, and writes to disk.
* [ ] Add a progress bar to the UI.

---

## 4. Technical Specifications

| Feature | Implementation |
| :--- | :--- |
| **Undistortion** | `cv2.fisheye.initUndistortRectifyMap` |
| **Pixel Mapping** | `cv2.remap` |
| **GUI Framework** | PyQt6 (Recommended for high-performance canvas updates) |
| **Performance** | Use NumPy vectorization to avoid slow `for` loops over pixels. |

---

## 5. UI Layout Plan
1.  **Main Viewport:** Large OpenCV window showing the "flattened" result.
2.  **Control Panel:**
    * **File:** Load Video / Save Video.
    * **Lens Settings:** Sliders for FOV, K-coefficients, and Center Offset.
    * **Post-Process:** Crop tool (to remove the black edges created by de-warping).
3.  **Status Bar:** FPS, Frame Count, and Resolution.

---

## 6. Challenges & Mitigations
* **Speed:** Processing 4K video frame-by-frame in Python can be slow.  
  * *Mitigation:* Pre-compute the transformation map once per video (as long as settings don't change) to make `cv2.remap` run at near-real-time speeds.
* **Black Borders:** Rectilinear correction pushes the corners inward, leaving black gaps.  
  * *Mitigation:* Implement an "Auto-Crop" feature that zooms in just enough to fill the frame.