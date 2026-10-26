# unRing

> **Fisheye de-warping and rectilinear perspective correction tool for doorbell and wide-angle cameras.**

unRing transforms curved, distorted fisheye images into natural, straight-line rectilinear views using spherical Three.js projection in the browser and OpenCV mathematical remapping in Python.

---

## Features

- **Dual Editions**:
  - **Web Application**: Interactive Three.js WebGL viewport with real-time slider feedback, 3-point alignment lines, auto-FOV optimization, drag-to-look, and client-side PNG sequence export.
  - **Python Edition (`py_unring`)**: Command-line interface (`unring_cli.py`) and PyQt6 desktop application (`unring_gui.py`) powered by OpenCV and NumPy.
- **Image & Image-Sequence Support**: Accepts single photos or numbered image sequences (`.jpg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tiff`).
- **Lens Calibration**: Full control over Source FOV, Virtual Zoom (Camera FOV), Tilt, Pitch, and Roll.
- **3-Point Straightening Tool & Auto-Optimization**: Place curved reference lines along curved structures (doorframes, pillars, walls) to calculate deviation and automatically optimize the Source FOV.
- **Settings Import & Export**: Save calibration profiles to JSON files and reload them across sessions.
- **Lossless PNG Export**: Export individual high-resolution stills or batch-export numbered image sequences (`unring-0001.png`, `unring-0002.png`, etc.).

---

## Installation

### 1. Web Application (Recommended)

The web application runs locally in any modern desktop browser supporting WebGL (with software rendering fallback).

#### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or newer recommended)
- `npm` (packaged with Node.js)

#### Steps
1. Clone or download the repository:
   ```bash
   git clone https://github.com/RunaR-Apps/unRing.git
   cd unRing
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Open the displayed local URL (typically `http://localhost:5173`) in your web browser.

#### Production Build (Optional)
To build optimized static assets:
```bash
npm run build
npm run preview
```

---

### 2. Python Edition (`py_unring`)

The Python edition provides both a PyQt6 GUI and a scriptable CLI for batch de-warping.

#### Prerequisites
- Python 3.10 or newer
- `pip`

#### Steps
1. Navigate to the project root and create a virtual environment:
   ```bash
   cd unRing
   python -m venv .venv
   ```
2. Activate the virtual environment:
   - **Windows (Command Prompt / PowerShell)**:
     ```powershell
     .venv\Scripts\activate
     ```
   - **macOS / Linux**:
     ```bash
     source .venv/bin/activate
     ```
3. Install required packages:
   ```bash
   pip install -r py_unring/requirements.txt
   ```

---

## User Instructions

### Using the Web Application

#### 1. Loading Media
- **Single Image**: Drag and drop any image file (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tiff`) onto the viewport, or click **Open File** in the top navigation bar.
- **Image Sequence**: Drag and drop multiple numbered frames together, or click **Open File** and select multiple files. unRing automatically sorts frames using natural numeric ordering.

#### 2. Viewport Navigation
- **Pan / Tilt / Pitch**: Left-click and drag anywhere on the main viewport to reorient the camera view.
- **Zoom**: Scroll your mouse wheel up or down over the viewport to zoom in or out.
- **Touch**: Drag on touch-enabled screens to pan the view.

#### 3. Lens Calibration Controls
Located in the right sidebar:
- **Image & EXIF Information (`i` icon)**: Positioned at the top right above Source FOV. Displays image resolution, format, file size, aspect ratio, and extracted camera/lens EXIF parameters (Make, Model, Lens, Focal Length, 35mm equivalent, Sensor Dimensions). If lens metadata is present, it automatically calculates the Source FOV and applies it to the parameters.
- **Source FOV**: Sets the field-of-view of the input fisheye or camera lens (adjustable from 10° up to 240°, automatically populated from EXIF when available).
- **Virtual Zoom (FOV)**: Controls the perspective zoom of the corrected view (20° to 120°).
- **Tilt**: Horizontal camera rotation angle (-45° to +45°).
- **Pitch**: Vertical camera elevation angle (-45° to +45°).
- **Roll**: Rotational horizon leveling angle (-45° to +45°).
- **Step (`-` / `+`) & Reset (`↶`)**: Every slider includes fine-stepping buttons and a reset icon to restore default values.

#### 4. Overlay Tools & FOV Optimization
1. In the sidebar under **Overlay Tools**, click **Add 3-Point Line**.
2. Click three points on the viewport along a physical feature that should be straight (e.g., a vertical doorframe, pillar, or brick line).
3. The overlay displays the curvature deviation percentage:
   - Green line with `Straight`: within 1% straightness tolerance.
   - Orange line with deviation percentage: indicates residual lens distortion.
4. Add 2 or more reference lines across different regions of the frame.
5. Click **Optimize Source FOV** to automatically solve for the lens field-of-view that minimizes curvature across all lines.

#### 5. Image Sequence Playback
- Use the transport bar at the bottom of the viewport:
  - **Play / Pause**: Click `▶` / `⏸` or press the **Spacebar**.
  - **Seek Bar**: Drag the slider to jump between frames.
  - **Frame Indicator**: Displays current frame number and total count.

#### 6. Exporting
- **Export Image (PNG)**: Click to download a corrected, full-resolution PNG of the active frame.
- **Export Image Sequence**: Click to batch-render and download numbered PNGs (`unring-0001.png`, `unring-0002.png`, etc.) for every frame in the sequence.
- **Export Settings**: Saves your current calibration settings (FOV, Zoom, Tilt, Pitch, Roll) as a `.json` file.
- **Import Settings**: Click in the header to restore a saved `.json` profile.

---

### Using the Python Edition

#### 1. Desktop GUI
Launch the PyQt6 interface:
```bash
python py_unring/unring_gui.py
```
- Open files using the **Open Image(s)** button.
- Adjust sliders in real time for FOV, Zoom, Tilt, Pitch, and Balance.
- Click **Export Image** or **Export Sequence** to save results.

#### 2. Command-Line Interface (CLI)
Process images or sequences non-interactively:

```bash
# Correct a single image
python -m py_unring.unring_cli path/to/frame.jpg -o corrected.png --fov 180

# Correct an image directory / sequence
python -m py_unring.unring_cli path/to/frames/ -o path/to/output_dir/ --fov 175 --balance 0.0

# Preview the first frame correction in an OpenCV window
python -m py_unring.unring_cli path/to/frame.jpg --preview --fov 180
```

CLI options:
- `input`: One or more image file paths or a directory of images.
- `-o`, `--output`: Output file path (single image) or output folder (sequence).
- `--fov`: Lens field of view in degrees (default: `180.0`).
- `--balance`: Border balance between `0.0` (cropped, no black borders) and `1.0` (full uncropped frame).
- `--preview`: Display a side-by-side comparison window before exiting.

---

## In-App Help & Shortcuts

Press <kbd>?</kbd> or <kbd>H</kbd> in the web application (or click **Help & Shortcuts** in the top navigation bar) to open the interactive help dialog.

### Shortcuts Quick Reference

| Shortcut / Action | Description |
| :--- | :--- |
| <kbd>Space</kbd> | Play / Pause sequence playback |
| <kbd>?</kbd> or <kbd>H</kbd> | Open / Close the Help & Shortcuts modal |
| <kbd>Esc</kbd> | Close Help modal / Cancel 3-Point Line placement / Deselect tool |
| `Left Click + Drag` | Pan camera orientation (Tilt & Pitch) |
| `Mouse Wheel` | Zoom in / Zoom out (Virtual Zoom FOV) |
| `Drag Line Handles` | Reposition 3-point calibration markers |

---

## Disclaimer

**There are no rights that can be claimed about the output.**  
All processed output, images, sequences, and visual corrections produced by unRing are for **illustrative purposes only**.

The software applies optical projection models and mathematical remapping algorithms. Results are approximations intended for visualization and should not be treated as certified or forensic evidence. The software is provided "as is", without warranty of any kind, express or implied.

---

## License & Legal

All output is for illustrative purposes only. Refer to the [Disclaimer](#disclaimer) above.
