"""
unring_gui.py – unRing interactive GUI (Phases 2, 3 & 4)
=========================================================
Launch with:
    python unring_gui.py

Requires: PyQt6, opencv-python, numpy  (see requirements.txt)
"""

import sys
import os
import re

import cv2
import numpy as np

from PyQt6.QtCore import (
    Qt, QTimer, pyqtSignal, QObject, QThread, pyqtSlot,
)
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel, QPushButton, QSlider,
    QFileDialog, QHBoxLayout, QVBoxLayout, QGroupBox, QStatusBar,
    QProgressBar, QSizePolicy, QSplitter, QCheckBox, QDoubleSpinBox,
    QFormLayout, QToolBar, QMessageBox,
)

try:
    from .engine import (
        IMAGE_EXTENSIONS, open_image, image_info,
        build_camera_matrix, build_distortion_coeffs,
        build_remap, undistort_frame,
    )
except ImportError:
    from engine import (
        IMAGE_EXTENSIONS, open_image, image_info,
        build_camera_matrix, build_distortion_coeffs,
        build_remap, undistort_frame,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Helper: convert a BGR OpenCV frame to QPixmap
# ─────────────────────────────────────────────────────────────────────────────

def bgr_to_qpixmap(frame: np.ndarray) -> QPixmap:
    """Convert a BGR uint8 ndarray to a QPixmap (no copy where possible)."""
    h, w, ch = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888)
    return QPixmap.fromImage(img)


# ─────────────────────────────────────────────────────────────────────────────
# Background worker: full-video export
# ─────────────────────────────────────────────────────────────────────────────

class ExportWorker(QObject):
    progress   = pyqtSignal(int)          # 0-100
    status_msg = pyqtSignal(str)
    finished   = pyqtSignal(bool, str)    # success, message

    def __init__(self, image_paths: list[str], output_dir: str,
                 map1: np.ndarray, map2: np.ndarray,
                 width: int, height: int):
        super().__init__()
        self.image_paths = image_paths
        self.output_dir = output_dir
        self.map1, self.map2 = map1, map2
        self.width = width
        self.height = height
        self._cancel = False

    def cancel(self):
        self._cancel = True

    @pyqtSlot()
    def run(self):
        os.makedirs(self.output_dir, exist_ok=True)
        total = len(self.image_paths)
        digits = max(4, len(str(total)))
        idx = 0
        written_files = []
        while not self._cancel:
            if idx >= total:
                break
            frame = open_image(self.image_paths[idx])
            result = undistort_frame(frame, self.map1, self.map2)
            destination = os.path.join(
                self.output_dir, f"unring-{idx + 1:0{digits}d}.png"
            )
            if not cv2.imwrite(destination, result):
                self.finished.emit(False, f"Cannot write: {destination}")
                return
            written_files.append(destination)
            idx += 1
            pct = min(int(idx / max(total, 1) * 100), 100)
            self.progress.emit(pct)

        if self._cancel:
            for filepath in written_files:
                try:
                    if os.path.isfile(filepath):
                        os.remove(filepath)
                except OSError:
                    pass
            self.finished.emit(False, "Export cancelled.")
        else:
            self.finished.emit(True, f"Saved {total} PNG images to {self.output_dir}")


# ─────────────────────────────────────────────────────────────────────────────
# Labelled slider widget (float range, step precision)
# ─────────────────────────────────────────────────────────────────────────────

class LabelledSlider(QWidget):
    valueChanged = pyqtSignal(float)

    def __init__(self, label: str, minimum: float, maximum: float,
                 default: float, steps: int = 1000, parent=None):
        super().__init__(parent)
        self._min = minimum
        self._max = maximum
        self._steps = steps

        self._lbl_name  = QLabel(label)
        self._lbl_name.setFixedWidth(55)
        self._lbl_val   = QLabel(f"{default:.3f}")
        self._lbl_val.setFixedWidth(60)
        self._lbl_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        self._slider = QSlider(Qt.Orientation.Horizontal)
        self._slider.setRange(0, steps)
        self._slider.setValue(self._to_int(default))
        self._slider.valueChanged.connect(self._on_slider)

        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(self._lbl_name)
        row.addWidget(self._slider)
        row.addWidget(self._lbl_val)

    def _to_int(self, v: float) -> int:
        frac = (v - self._min) / (self._max - self._min)
        return int(max(0, min(self._steps, round(frac * self._steps))))

    def _to_float(self, i: int) -> float:
        return self._min + i / self._steps * (self._max - self._min)

    def _on_slider(self, i: int):
        v = self._to_float(i)
        self._lbl_val.setText(f"{v:.3f}")
        self.valueChanged.emit(v)

    def value(self) -> float:
        return self._to_float(self._slider.value())

    def setValue(self, v: float):
        self._slider.setValue(self._to_int(v))

    def blockSlider(self, block: bool):
        self._slider.blockSignals(block)


# ─────────────────────────────────────────────────────────────────────────────
# Main window
# ─────────────────────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("unRing – Fisheye Correction Studio")
        self.resize(1280, 780)

        # ── State ─────────────────────────────────────────────────────────
        self._image_paths: list[str] = []
        self._images:      list[np.ndarray] = []
        self._info:     dict             | None = None
        self._map1:     np.ndarray       | None = None
        self._map2:     np.ndarray       | None = None
        self._raw_frame: np.ndarray      | None = None
        self._src_path  = ""
        self._show_original = False
        self._maps_dirty    = True   # rebuild maps on next render

        # Export thread
        self._export_thread: QThread | None = None
        self._export_worker: ExportWorker | None = None

        self._build_ui()
        self._connect_signals()

    # ── UI construction ────────────────────────────────────────────────────

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(8, 8, 8, 8)

        # ── Left: viewport + seek bar ──────────────────────────────────
        left = QVBoxLayout()

        self._viewport = QLabel("Load an image or image sequence to begin")
        self._viewport.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._viewport.setSizePolicy(QSizePolicy.Policy.Expanding,
                                      QSizePolicy.Policy.Expanding)
        self._viewport.setMinimumSize(640, 400)
        self._viewport.setStyleSheet(
            "background:#111; color:#777; font-size:18px; border-radius:6px;"
        )
        left.addWidget(self._viewport, stretch=1)

        # Seek bar (Phase 3)
        seek_row = QHBoxLayout()
        self._btn_play = QPushButton("▶")
        self._btn_play.setFixedWidth(36)
        self._btn_play.setEnabled(False)
        self._btn_play.setCheckable(True)
        self._seek_bar = QSlider(Qt.Orientation.Horizontal)
        self._seek_bar.setRange(0, 0)
        self._seek_bar.setEnabled(False)
        self._lbl_frame = QLabel("–/–")
        self._lbl_frame.setFixedWidth(80)
        self._lbl_frame.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        seek_row.addWidget(self._btn_play)
        seek_row.addWidget(self._seek_bar)
        seek_row.addWidget(self._lbl_frame)
        left.addLayout(seek_row)

        # Compare toggle (Phase 3)
        compare_row = QHBoxLayout()
        self._chk_original = QCheckBox("Show Original")
        compare_row.addWidget(self._chk_original)
        compare_row.addStretch()
        left.addLayout(compare_row)

        root.addLayout(left, stretch=1)

        # ── Right: controls panel ──────────────────────────────────────
        right = QVBoxLayout()
        right.setSpacing(8)

        # File controls
        file_box = QGroupBox("File")
        file_lay = QVBoxLayout(file_box)
        self._btn_open = QPushButton("Open Images…")
        file_lay.addWidget(self._btn_open)
        right.addWidget(file_box)

        # Lens settings
        lens_box = QGroupBox("Lens Settings")
        lens_lay = QVBoxLayout(lens_box)

        self._sl_fov = LabelledSlider("FOV°",  60.0, 220.0, 180.0)
        self._sl_k1  = LabelledSlider("k1",   -1.0,   1.0,  -0.3)
        self._sl_k2  = LabelledSlider("k2",   -0.5,   0.5,   0.1)
        self._sl_k3  = LabelledSlider("k3",   -0.5,   0.5,   0.0)
        self._sl_k4  = LabelledSlider("k4",   -0.5,   0.5,   0.0)
        self._sl_bal = LabelledSlider("Balance", 0.0, 1.0,   0.0)

        for sl in (self._sl_fov, self._sl_k1, self._sl_k2,
                   self._sl_k3, self._sl_k4, self._sl_bal):
            lens_lay.addWidget(sl)

        right.addWidget(lens_box)

        # Principal point offset
        pp_box = QGroupBox("Principal Point Offset")
        pp_lay = QVBoxLayout(pp_box)
        self._sl_cx = LabelledSlider("cx offset", -0.3, 0.3, 0.0)
        self._sl_cy = LabelledSlider("cy offset", -0.3, 0.3, 0.0)
        pp_lay.addWidget(self._sl_cx)
        pp_lay.addWidget(self._sl_cy)
        right.addWidget(pp_box)

        # Reset button
        self._btn_reset = QPushButton("Reset to Defaults")
        right.addWidget(self._btn_reset)

        right.addStretch()

        # Export (Phase 4)
        export_box = QGroupBox("Export")
        export_lay = QVBoxLayout(export_box)
        self._btn_export = QPushButton("Export PNG Sequence…")
        self._btn_export.setEnabled(False)
        self._progress = QProgressBar()
        self._progress.setRange(0, 100)
        self._progress.setValue(0)
        self._progress.setVisible(False)
        self._btn_cancel = QPushButton("Cancel")
        self._btn_cancel.setVisible(False)
        export_lay.addWidget(self._btn_export)
        export_lay.addWidget(self._progress)
        export_lay.addWidget(self._btn_cancel)
        right.addWidget(export_box)

        right_widget = QWidget()
        right_widget.setLayout(right)
        right_widget.setFixedWidth(280)
        root.addWidget(right_widget)

        # Status bar
        self.statusBar().showMessage("Ready - open an image or image sequence to begin.")

        # Playback timer
        self._play_timer = QTimer(self)
        self._play_timer.setInterval(33)  # ~30 fps

    def _connect_signals(self):
        self._btn_open.clicked.connect(self._on_open)
        self._btn_reset.clicked.connect(self._on_reset)
        self._btn_export.clicked.connect(self._on_export)
        self._btn_cancel.clicked.connect(self._on_cancel_export)
        self._btn_play.toggled.connect(self._on_play_toggled)
        self._seek_bar.sliderMoved.connect(self._on_seek)
        self._chk_original.stateChanged.connect(self._on_toggle_original)
        self._play_timer.timeout.connect(self._on_play_tick)

        for sl in (self._sl_fov, self._sl_k1, self._sl_k2,
                   self._sl_k3, self._sl_k4, self._sl_bal,
                   self._sl_cx, self._sl_cy):
            sl.valueChanged.connect(self._on_param_changed)

    # ── Slots ──────────────────────────────────────────────────────────────

    def _on_open(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Open Images", "",
            "Image Files (*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff);;All Files (*)"
        )
        if not paths:
            return
        self._load_images(paths)

    def _natural_key(self, path: str):
        name = os.path.basename(path).lower()
        return [int(part) if part.isdigit() else part
                for part in re.split(r"(\d+)", name)]

    def _load_images(self, paths: list[str]):
        paths = sorted(paths, key=self._natural_key)
        try:
            images = [open_image(path) for path in paths]
        except IOError as e:
            QMessageBox.critical(self, "Error", str(e))
            return

        first_info = image_info(images[0])
        if any(image_info(image) != first_info for image in images[1:]):
            QMessageBox.critical(self, "Error", "All images must have the same dimensions.")
            return

        self._image_paths = paths
        self._images      = images
        self._info        = first_info
        self._src_path    = paths[0]
        self._maps_dirty = True

        total = max(len(images) - 1, 0)
        self._seek_bar.setRange(0, total)
        self._seek_bar.setValue(0)
        self._seek_bar.setEnabled(True)
        self._btn_play.setEnabled(True)
        self._btn_export.setEnabled(True)
        self._lbl_frame.setText(f"1/{len(images)}")

        fname = os.path.basename(paths[0]) if len(paths) == 1 else f"{len(paths)} images"
        self.statusBar().showMessage(
            f"{fname}  {first_info['width']}×{first_info['height']}  "
            f"{len(images)} image{'s' if len(images) != 1 else ''}"
        )

        self._load_and_render(0)

    def _on_param_changed(self, _val=None):
        self._maps_dirty = True
        self._render_current()

    def _on_reset(self):
        defaults = {
            self._sl_fov: 180.0,
            self._sl_k1:  -0.3,
            self._sl_k2:   0.1,
            self._sl_k3:   0.0,
            self._sl_k4:   0.0,
            self._sl_bal:  0.0,
            self._sl_cx:   0.0,
            self._sl_cy:   0.0,
        }
        for sl, val in defaults.items():
            sl.blockSlider(True)
            sl.setValue(val)
            sl.blockSlider(False)
        self._on_param_changed()

    def _on_seek(self, pos: int):
        if not self._images:
            return
        self._stop_playback()
        self._load_and_render(pos)

    def _on_toggle_original(self, state):
        self._show_original = bool(state)
        self._display_frame(self._raw_frame)

    def _on_play_toggled(self, checked: bool):
        if checked:
            self._btn_play.setText("⏸")
            self._play_timer.start()
        else:
            self._btn_play.setText("▶")
            self._play_timer.stop()

    def _on_play_tick(self):
        if not self._images:
            self._stop_playback()
            return
        pos = (self._seek_bar.value() + 1) % len(self._images)
        self._seek_bar.setValue(pos)
        self._load_and_render(pos)

    def _stop_playback(self):
        self._play_timer.stop()
        self._btn_play.setChecked(False)
        self._btn_play.setText("▶")

    # ── Rendering ──────────────────────────────────────────────────────────

    def _load_and_render(self, frame_idx: int):
        if not self._images:
            return
        frame = self._images[frame_idx]
        self._raw_frame = frame
        self._lbl_frame.setText(f"{frame_idx + 1}/{len(self._images)}")
        self._display_frame(frame)

    def _render_current(self):
        if self._raw_frame is not None:
            self._display_frame(self._raw_frame)

    def _build_maps_if_needed(self):
        if not self._maps_dirty or self._info is None:
            return
        w, h = self._info["width"], self._info["height"]
        K = build_camera_matrix(w, h, self._sl_fov.value())
        # Apply principal point offsets (as fraction of half-dimension)
        K[0, 2] += self._sl_cx.value() * w / 2.0
        K[1, 2] += self._sl_cy.value() * h / 2.0
        D = build_distortion_coeffs(
            self._sl_k1.value(), self._sl_k2.value(),
            self._sl_k3.value(), self._sl_k4.value()
        )
        self._map1, self._map2 = build_remap(w, h, K, D,
                                              balance=self._sl_bal.value())
        self._maps_dirty = False

    def _display_frame(self, frame: np.ndarray | None):
        if frame is None:
            return

        if self._show_original:
            display = frame
        else:
            self._build_maps_if_needed()
            if self._map1 is not None:
                display = undistort_frame(frame, self._map1, self._map2)
            else:
                display = frame

        pixmap = bgr_to_qpixmap(display)
        scaled = pixmap.scaled(
            self._viewport.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self._viewport.setPixmap(scaled)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._render_current()

    # ── Export (Phase 4) ───────────────────────────────────────────────────

    def _on_export(self):
        if not self._image_paths or self._info is None:
            return

        default_out = os.path.join(os.path.dirname(self._src_path), "unring-output")
        dst = QFileDialog.getExistingDirectory(
            self, "Choose PNG Output Directory", default_out
        )
        if not dst:
            return

        # Ensure maps are current
        self._build_maps_if_needed()

        self._btn_export.setEnabled(False)
        self._btn_open.setEnabled(False)
        self._progress.setValue(0)
        self._progress.setVisible(True)
        self._btn_cancel.setVisible(True)

        self._export_thread = QThread(self)
        self._export_worker = ExportWorker(
            image_paths=self._image_paths,
            output_dir=dst,
            map1=self._map1,
            map2=self._map2,
            width=self._info["width"],
            height=self._info["height"],
        )
        self._export_worker.moveToThread(self._export_thread)
        self._export_thread.started.connect(self._export_worker.run)
        self._export_worker.progress.connect(self._progress.setValue)
        self._export_worker.finished.connect(self._on_export_done)
        self._export_thread.start()

    @pyqtSlot()
    def _on_cancel_export(self):
        if self._export_worker:
            self._export_worker.cancel()

    @pyqtSlot(bool, str)
    def _on_export_done(self, success: bool, message: str):
        self._export_thread.quit()
        self._export_thread.wait()
        self._export_thread = None
        self._export_worker = None

        self._btn_export.setEnabled(True)
        self._btn_open.setEnabled(True)
        self._progress.setVisible(False)
        self._btn_cancel.setVisible(False)

        if success:
            QMessageBox.information(self, "Export complete", message)
        else:
            QMessageBox.warning(self, "Export", message)
        self.statusBar().showMessage(message)

    # ── Cleanup ────────────────────────────────────────────────────────────

    def closeEvent(self, event):
        self._stop_playback()
        if self._export_worker:
            self._export_worker.cancel()
        super().closeEvent(event)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("unRing")
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
