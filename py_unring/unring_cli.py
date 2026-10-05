"""Image-only unRing command-line interface."""

import argparse
import os
import re
import sys

import cv2

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


def natural_key(path: str):
    name = os.path.basename(path).lower()
    return [int(part) if part.isdigit() else part
            for part in re.split(r"(\d+)", name)]


def collect_inputs(inputs: list[str]) -> list[str]:
    paths = []
    for input_path in inputs:
        if os.path.isdir(input_path):
            paths.extend(
                os.path.join(input_path, name)
                for name in os.listdir(input_path)
                if os.path.splitext(name)[1].lower() in IMAGE_EXTENSIONS
            )
        elif os.path.isfile(input_path):
            if os.path.splitext(input_path)[1].lower() not in IMAGE_EXTENSIONS:
                raise ValueError(f"Unsupported image type: {input_path}")
            paths.append(input_path)
        else:
            raise FileNotFoundError(f"Input not found: {input_path}")

    if not paths:
        raise ValueError("No supported images found in the input.")
    return sorted(paths, key=natural_key)


def output_paths(input_paths: list[str], output: str | None) -> list[str]:
    if len(input_paths) == 1:
        if output:
            if os.path.isdir(output):
                return [os.path.join(output, "unring-0001.png")]
            return [output]
        base, _ = os.path.splitext(input_paths[0])
        return [base + "_unring.png"]

    output_dir = output or os.path.join(
        os.path.dirname(input_paths[0]), "unring-output"
    )
    os.makedirs(output_dir, exist_ok=True)
    digits = max(4, len(str(len(input_paths))))
    return [
        os.path.join(output_dir, f"unring-{index:0{digits}d}.png")
        for index in range(1, len(input_paths) + 1)
    ]


def parse_args():
    parser = argparse.ArgumentParser(
        prog="unring",
        description="Correct fisheye distortion in one image or an image sequence.",
    )
    parser.add_argument("input", nargs="+",
                        help="Image file(s) or a directory of images")
    parser.add_argument("--output", "-o",
                        help="Output PNG path or sequence directory")
    parser.add_argument("--fov", type=float, default=180.0,
                        help="Lens field-of-view in degrees (default: 180)")
    parser.add_argument("--k1", type=float, default=-0.3)
    parser.add_argument("--k2", type=float, default=0.1)
    parser.add_argument("--k3", type=float, default=0.0)
    parser.add_argument("--k4", type=float, default=0.0)
    parser.add_argument("--balance", type=float, default=0.0,
                        help="Border balance: 0=crop, 1=full (default: 0)")
    parser.add_argument("--preview", action="store_true",
                        help="Show the first original/corrected image")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        input_paths = collect_inputs(args.input)
        first = open_image(input_paths[0])
        info = image_info(first)
        K = build_camera_matrix(info["width"], info["height"], args.fov)
        D = build_distortion_coeffs(args.k1, args.k2, args.k3, args.k4)
        map1, map2 = build_remap(
            info["width"], info["height"], K, D, balance=args.balance
        )
        destinations = output_paths(input_paths, args.output)
    except (FileNotFoundError, IOError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    total = len(input_paths)
    print(f"Processing {total} image{'s' if total != 1 else ''}")
    print(f"  {info['width']}x{info['height']}  FOV={args.fov}  balance={args.balance}")

    for index, (input_path, destination) in enumerate(
        zip(input_paths, destinations), 1
    ):
        try:
            image = first if index == 1 else open_image(input_path)
            current_info = image_info(image)
            if current_info != info:
                raise ValueError(
                    f"Image dimensions differ: {input_path} is "
                    f"{current_info['width']}x{current_info['height']}, expected "
                    f"{info['width']}x{info['height']}"
                )
            result = undistort_frame(image, map1, map2)
            os.makedirs(os.path.dirname(os.path.abspath(destination)), exist_ok=True)
            if not cv2.imwrite(destination, result):
                raise IOError(f"Could not write output: {destination}")
        except (IOError, ValueError) as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1

        if args.preview and index == 1:
            combined = cv2.hconcat([image, result])
            cv2.imshow("unRing - original | corrected", combined)
            cv2.waitKey(0)
            cv2.destroyAllWindows()

        print(f"  [{index}/{total}] {destination}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
