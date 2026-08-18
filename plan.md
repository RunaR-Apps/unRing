# unRing Image-Only Export Plan

**Objective:** Replace video-file output with corrected still images. Support a
single image input and numbered image sequences as input, with one numbered
corrected image per input frame as output.

## Product Contract

- Accepted inputs: common raster images (`jpg`, `jpeg`, `png`, `webp`, `gif`,
  `bmp`, and `tiff` where the browser supports decoding), either one file or
  multiple files selected/dropped together.
- A single image produces one downloadable corrected PNG.
- A sequence produces one corrected PNG per source image. Output names use a
  stable zero-padded frame number, for example `unring-0001.png`,
  `unring-0002.png`.
- Sequence order is determined by natural numeric filename sorting, with the
  original file order used only as a tie-breaker. The displayed sequence must
  use the same order as export.
- No video input, video playback, video markers, audio controls, AVI encoder,
  `MediaRecorder`, or video output remains in the image-only workflow.
- Export uses the current lens, camera, aspect-ratio, and overlay settings for
  every output image.

## Implementation Steps

### 1. Consolidate Image Source State

- Keep the existing Three.js fisheye projection and canvas-texture path.
- Make `image` and `sequence` the only source modes; remove video-specific
  state, event listeners, FPS detection, and padded-video drawing code.
- Extract shared frame preparation into one helper that centers an image on the
  square texture canvas, updates the texture, and applies the source aspect.
- Validate that all sequence frames decode and have compatible dimensions;
  report failed files instead of silently shifting the sequence.
- Revoke every object URL when replacing or clearing a source.

### 2. Update Input and Sequence Rules

- Remove video MIME types and extensions from the file picker, drop handling,
  validation, and instructional text.
- Keep single-image loading and multiple-image loading as separate paths.
- Sort sequence files once at load time using natural numeric ordering and keep
  the sorted file metadata alongside the decoded images.
- Show frame count and the current frame number in the source label and
  transport area.
- Retain play/pause and seek for sequences only, using a documented default
  sequence rate for preview. Preview playback rate must not affect output
  naming or frame count.

### 3. Replace Video Export with Image Export

- Rename the export control and functions from AVI/video terminology to image
  sequence terminology.
- Implement a shared `renderCurrentFrame()` routine that renders the current
  Three.js scene at the configured export dimensions and returns a PNG blob.
- Single-image export renders once and downloads `unring.png` (or a filename
  derived from the source image).
- Sequence export iterates the sorted decoded frames, renders each one, and
  downloads numbered PNG files with enough zero padding for the sequence count.
- Use the browser download mechanism for each PNG. If browser download
  throttling becomes a problem for large sequences, add a ZIP option using a
  maintained archive library rather than reintroducing a video container.
- Preserve export progress, cancellation/disabled state, and settings export;
  restore the selected frame after export completes.
- Delete `avi-writer.js` and its import once no code references it.

### 4. Simplify the Interface

- Replace the Export section's AVI button and video marker controls with:
  `Save Image` for a single source and `Export Image Sequence` for multiple
  images.
- Hide or remove volume and time-based video controls. Sequence controls should
  show frame position rather than seconds.
- Change labels, empty states, file filters, and error messages to describe
  images only.
- Keep the raw source monitor and corrected WebGL preview synchronized with the
  selected image.

### 5. Align the Python Edition

- Replace `cv2.VideoCapture` input with `cv2.imread` for one image and a sorted
  list of image paths for sequences.
- Reuse the existing remap construction and `undistort_frame` for each image.
- Replace `cv2.VideoWriter` and the video export worker with numbered image
  writes using `cv2.imwrite`, including output-directory creation and progress.
- Update the Python CLI flags, GUI labels, file dialogs, status text, and help
  examples so they no longer promise video processing.
- Define whether Python outputs PNG only or preserves a chosen image format;
  default to PNG for consistent lossless export.

## Validation Plan

- Browser build passes with no references to video input, AVI, or
  `MediaRecorder`.
- Load one JPEG and verify the preview, raw monitor, settings, and one PNG
  download.
- Load a deliberately mixed-name sequence such as `frame2.png`,
  `frame10.png`, and `frame01.png`; verify natural order, frame count, and
  output names.
- Verify every exported sequence image has the same dimensions, correct
  orientation, and the active camera/lens settings.
- Verify replacing a source does not display stale frames or leak object URLs.
- Verify unsupported files and partially undecodable sequences produce a clear
  error and do not enable export.
- Run Python image and sequence tests for dimensions, ordering, output count,
  and cancellation/error handling after the Python edition is migrated.

## Completion Criteria

- The application accepts only single images or numbered image sequences.
- A single input exports one corrected PNG.
- A sequence exports exactly one correctly numbered PNG for each valid input
  image, in natural numeric order.
- No video output code, UI, documentation, or dependency remains on the active
  image-only path.
