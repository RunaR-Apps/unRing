"""
engine.py – unRing core processing engine
==========================================
Builds the fisheye-to-rectilinear remapping tables and applies them
to frames using cv2.remap.  All heavy maths lives here so the CLI
and future GUI can share the same logic.
"""

import math
import numpy as np
import cv2


# ─────────────────────────────────────────────────────────────────────────────
# Lens model helpers
# ─────────────────────────────────────────────────────────────────────────────

def build_camera_matrix(width: int, height: int, fov_deg: float) -> np.ndarray:
    """
    Build a pinhole-style camera intrinsic matrix K for a fisheye lens.

    The focal length is derived from the stated field-of-view so that the
    full FOV circle just fits inside the shorter image dimension.

        f = (min_dim / 2) / tan(FOV/2)

    Parameters
    ----------
    width, height : int  – frame dimensions in pixels
    fov_deg       : float – diagonal / horizontal FOV of the source lens (e.g. 180)

    Returns
    -------
    K : (3, 3) float64 ndarray
    """
    fov_rad = math.radians(fov_deg)
    # Use the shorter dimension so the fisheye circle is fully covered
    min_dim = min(width, height)
    f = (min_dim / 2.0) / math.tan(fov_rad / 2.0)
    cx = width  / 2.0
    cy = height / 2.0
    K = np.array([[f,  0., cx],
                  [0., f,  cy],
                  [0., 0., 1.]], dtype=np.float64)
    return K


def build_distortion_coeffs(k1: float = -0.3,
                             k2: float =  0.1,
                             k3: float =  0.0,
                             k4: float =  0.0) -> np.ndarray:
    """
    Build the 4-element distortion coefficient vector for cv2.fisheye.
    OpenCV's fisheye model uses  [k1, k2, k3, k4]  (all radial).

    Sensible starting defaults for a ~180° doorbell lens:
        k1 ≈ -0.30  (negative = barrel distortion, which fisheye lenses have)
        k2 ≈  0.10
        k3, k4 = 0

    Users can tune these via CLI flags or GUI sliders.
    """
    return np.array([k1, k2, k3, k4], dtype=np.float64)


# ─────────────────────────────────────────────────────────────────────────────
# Remap builder
# ─────────────────────────────────────────────────────────────────────────────

def build_remap(width: int, height: int,
                K: np.ndarray, D: np.ndarray,
                balance: float = 0.0,
                out_width: int  = None,
                out_height: int = None):
    """
    Pre-compute the (map1, map2) pixel-coordinate tables for cv2.remap.

    Parameters
    ----------
    width, height        – source frame size
    K                    – camera matrix  (3×3)
    D                    – distortion coefficients  (4,)
    balance              – 0.0 = no black borders (crops), 1.0 = keep every pixel
    out_width/out_height – desired output size; defaults to input size

    Returns
    -------
    (map1, map2) – arrays suitable for cv2.remap
    """
    if out_width  is None: out_width  = width
    if out_height is None: out_height = height

    dim_src = (width, height)
    dim_dst = (out_width, out_height)

    # Estimate the undistorted (new) camera matrix for the output view
    K_new = cv2.fisheye.estimateNewCameraMatrixForUndistortRectify(
        K, D, dim_src, np.eye(3),
        balance=balance,
        new_size=dim_dst,
        fov_scale=1.0
    )

    map1, map2 = cv2.fisheye.initUndistortRectifyMap(
        K, D,
        R=np.eye(3),
        P=K_new,
        size=dim_dst,
        m1type=cv2.CV_16SC2
    )
    return map1, map2


# ─────────────────────────────────────────────────────────────────────────────
# Frame-level operations
# ─────────────────────────────────────────────────────────────────────────────

def undistort_frame(frame: np.ndarray,
                    map1: np.ndarray,
                    map2: np.ndarray) -> np.ndarray:
    """Apply pre-computed remap tables to a single BGR frame."""
    return cv2.remap(frame, map1, map2,
                     interpolation=cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT,
                     borderValue=(0, 0, 0))


# ─────────────────────────────────────────────────────────────────────────────
# Video helpers
# ─────────────────────────────────────────────────────────────────────────────

def open_video(path: str) -> cv2.VideoCapture:
    """Open a video file and raise if it fails."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {path}")
    return cap


def read_frame(cap: cv2.VideoCapture, frame_index: int = 0) -> np.ndarray:
    """Seek to frame_index and return that frame as a BGR ndarray."""
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if not ok:
        raise IOError(f"Could not read frame {frame_index} from video.")
    return frame


def video_info(cap: cv2.VideoCapture) -> dict:
    """Return a dict of basic video metadata."""
    return {
        "width":  int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps":    cap.get(cv2.CAP_PROP_FPS),
        "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    }
