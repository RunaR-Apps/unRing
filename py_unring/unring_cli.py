"""
unring_cli.py – unRing Phase 1 command-line interface
======================================================
Usage examples:

  # Save a single undistorted frame (default: frame 0)
  python unring_cli.py video.mp4 --output frame_out.jpg

  # Use a 140-degree lens profile, custom k1/k2
  python unring_cli.py video.mp4 --fov 140 --k1 -0.2 --k2 0.05

  # Show a live preview window (press any key to close)
  python unring_cli.py video.mp4 --preview

  # Process the full video to disk
  python unring_cli.py video.mp4 --process --output corrected.mp4
"""

import argparse
import sys
import os
import cv2

from engine import (
    open_video, read_frame, video_info,
    build_camera_matrix, build_distortion_coeffs,
    build_remap, undistort_frame,
)


# ─────────────────────────────────────────────────────────────────────────────
# CLI argument definition
# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        prog="unring",
        description="De-warp fisheye / doorbell-camera footage using OpenCV.",
    )
    p.add_argument("input",          help="Path to input video file (.mp4 / .mov / .webm)")
    p.add_argument("--output", "-o", help="Path for output image or video",
                   default=None)
    p.add_argument("--fov",          help="Lens field-of-view in degrees (default 180)",
                   type=float, default=180.0)
    p.add_argument("--k1",           help="Fisheye distortion coefficient k1 (default -0.3)",
                   type=float, default=-0.3)
    p.add_argument("--k2",           help="Fisheye distortion coefficient k2 (default 0.1)",
                   type=float, default=0.1)
    p.add_argument("--k3",           help="Fisheye distortion coefficient k3 (default 0.0)",
                   type=float, default=0.0)
    p.add_argument("--k4",           help="Fisheye distortion coefficient k4 (default 0.0)",
                   type=float, default=0.0)
    p.add_argument("--balance",      help="Border balance 0=crop 1=full (default 0.0)",
                   type=float, default=0.0)
    p.add_argument("--frame",        help="Frame index to extract (default 0)",
                   type=int, default=0)
    p.add_argument("--preview",      action="store_true",
                   help="Show an OpenCV preview window (press any key to close)")
    p.add_argument("--process",      action="store_true",
                   help="Process the entire video and write to --output")
    return p.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
# Single-frame mode
# ─────────────────────────────────────────────────────────────────────────────

def run_single_frame(cap, info, map1, map2, args):
    frame = read_frame(cap, args.frame)
    result = undistort_frame(frame, map1, map2)

    if args.preview:
        # Show original and corrected side by side
        combined = cv2.hconcat([frame, result])
        win_title = "unRing – original | corrected  (any key to close)"
        cv2.imshow(win_title, combined)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    if args.output:
        cv2.imwrite(args.output, result)
        print(f"Saved: {args.output}")
    elif not args.preview:
        # Default: save next to input
        base, _ = os.path.splitext(args.input)
        out_path = base + "_unring.jpg"
        cv2.imwrite(out_path, result)
        print(f"Saved: {out_path}")


# ─────────────────────────────────────────────────────────────────────────────
# Full-video processing mode
# ─────────────────────────────────────────────────────────────────────────────

def run_full_video(cap, info, map1, map2, args):
    if args.output:
        out_path = args.output
    else:
        base, _ = os.path.splitext(args.input)
        out_path = base + "_unring.mp4"

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        out_path, fourcc, info["fps"],
        (info["width"], info["height"])
    )
    if not writer.isOpened():
        print(f"Error: could not open VideoWriter for {out_path}", file=sys.stderr)
        sys.exit(1)

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    total = info["frames"]
    idx   = 0

    print(f"Processing {total} frames → {out_path}")
    print(f"  {info['width']}×{info['height']}  {info['fps']:.2f} fps")
    print()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        result = undistort_frame(frame, map1, map2)
        writer.write(result)
        idx += 1

        # Simple text progress bar
        pct = idx / max(total, 1) * 100
        bar = "#" * (idx * 40 // max(total, 1))
        print(f"\r  [{bar:<40}] {pct:5.1f}%  frame {idx}/{total}", end="", flush=True)

    writer.release()
    print(f"\nDone. Saved: {out_path}")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Validate input file exists
    if not os.path.isfile(args.input):
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    cap  = open_video(args.input)
    info = video_info(cap)

    print(f"Loaded: {args.input}")
    print(f"  {info['width']}×{info['height']}  {info['fps']:.2f} fps  "
          f"{info['frames']} frames")
    print(f"  FOV={args.fov}°  k1={args.k1}  k2={args.k2}  "
          f"k3={args.k3}  k4={args.k4}  balance={args.balance}")
    print()

    # Build lens model
    K = build_camera_matrix(info["width"], info["height"], args.fov)
    D = build_distortion_coeffs(args.k1, args.k2, args.k3, args.k4)

    print("Camera matrix K:")
    print(K)
    print()
    print(f"Distortion coefficients D: {D.ravel()}")
    print()

    # Pre-compute remap tables (expensive – done only once)
    map1, map2 = build_remap(info["width"], info["height"], K, D,
                              balance=args.balance)
    print("Remap tables built.")

    if args.process:
        run_full_video(cap, info, map1, map2, args)
    else:
        run_single_frame(cap, info, map1, map2, args)

    cap.release()


if __name__ == "__main__":
    main()
