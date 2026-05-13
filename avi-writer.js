/**
 * Encodes an array of raw BGR frames (bottom-up row order, rows padded to
 * 4-byte boundaries) into an uncompressed AVI (BI_RGB) Blob.
 *
 * @param {Uint8Array[]} bgrFrames  Array of frame pixel buffers
 * @param {number}       width      Frame width in pixels
 * @param {number}       height     Frame height in pixels
 * @param {number}       fps        Frames per second (integer)
 * @returns {Blob}
 */
export function encodeAVI(bgrFrames, width, height, fps) {
  const n          = bgrFrames.length;
  const rowPad     = ((width * 3 + 3) & ~3);   // row stride, padded to 4 bytes
  const frameBytes = rowPad * height;
  const usPerFrame = Math.round(1_000_000 / fps);

  // ── tiny binary helpers ────────────────────────────────────────────────────
  function w32(v) {
    const b = new Uint8Array(4);
    b[0] = (v >>> 0)  & 0xFF;
    b[1] = (v >>> 8)  & 0xFF;
    b[2] = (v >>> 16) & 0xFF;
    b[3] = (v >>> 24) & 0xFF;
    return b;
  }
  function w16(v) {
    const b = new Uint8Array(2);
    b[0] = v & 0xFF;
    b[1] = (v >>> 8) & 0xFF;
    return b;
  }
  function fcc(s) {
    return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
  }
  function cat(...parts) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // ── AVIMainHeader  (56 bytes) ──────────────────────────────────────────────
  const avih = cat(
    w32(usPerFrame),          // dwMicroSecPerFrame
    w32(frameBytes * fps),    // dwMaxBytesPerSec
    w32(0),                   // dwPaddingGranularity
    w32(0x10),                // dwFlags  (AVIF_HASINDEX)
    w32(n),                   // dwTotalFrames
    w32(0),                   // dwInitialFrames
    w32(1),                   // dwStreams
    w32(frameBytes),          // dwSuggestedBufferSize
    w32(width),               // dwWidth
    w32(height),              // dwHeight
    w32(0), w32(0), w32(0), w32(0) // reserved
  ); // 14 × 4 = 56 ✓

  // ── AVIStreamHeader  (56 bytes) ───────────────────────────────────────────
  const strh = cat(
    fcc('vids'),              // fccType
    w32(0),                   // fccHandler  (0 = DIB / uncompressed)
    w32(0),                   // dwFlags
    w16(0), w16(0),           // wPriority, wLanguage
    w32(0),                   // dwInitialFrames
    w32(1),                   // dwScale
    w32(fps),                 // dwRate  (fps = dwRate / dwScale)
    w32(0),                   // dwStart
    w32(n),                   // dwLength
    w32(frameBytes),          // dwSuggestedBufferSize
    w32(0xFFFFFFFF),          // dwQuality  (-1 = default)
    w32(0),                   // dwSampleSize
    w16(0), w16(0), w16(width), w16(height) // rcFrame
  ); // 56 ✓

  // ── BITMAPINFOHEADER  (40 bytes) ──────────────────────────────────────────
  const strf = cat(
    w32(40),                  // biSize
    w32(width),               // biWidth
    w32(height),              // biHeight  (positive = bottom-up, matches WebGL readPixels)
    w16(1),                   // biPlanes
    w16(24),                  // biBitCount
    w32(0),                   // biCompression  (BI_RGB)
    w32(frameBytes),          // biSizeImage
    w32(0), w32(0),           // biXPelsPerMeter, biYPelsPerMeter
    w32(0), w32(0)            // biClrUsed, biClrImportant
  ); // 40 ✓

  // ── strl LIST → hdrl LIST ─────────────────────────────────────────────────
  //  chunk(id, data) = id(4) + size(4) + data
  function chunk(id, data) {
    return cat(fcc(id), w32(data.length), data);
  }
  //  list(type, contents) = 'LIST'(4) + size(4) + type(4) + contents
  function list(type, contents) {
    return cat(fcc('LIST'), w32(contents.length + 4), fcc(type), contents);
  }

  const strlContents = cat(chunk('strh', strh), chunk('strf', strf));
  const hdrlContents = cat(chunk('avih', avih), list('strl', strlContents));
  const hdrl         = list('hdrl', hdrlContents);

  // ── movi LIST ─────────────────────────────────────────────────────────────
  // moviInnerSize = 4('movi' fcc) + n × (8 header + frameBytes data)
  const moviInnerSize = 4 + n * (8 + frameBytes);
  const moviHeader    = cat(fcc('LIST'), w32(moviInnerSize), fcc('movi'));
  // Frame chunks are appended per-frame into blobParts below.

  // ── idx1  (16 bytes per frame) ────────────────────────────────────────────
  // Offsets are measured from right after the 'movi' fourcc.
  const idxParts = [];
  for (let i = 0; i < n; i++) {
    idxParts.push(
      fcc('00dc'),
      w32(0x10),                         // AVIIF_KEYFRAME
      w32(4 + i * (8 + frameBytes)),     // offset from 'movi' data start
      w32(frameBytes)                    // chunk data size
    );
  }
  const idx1 = chunk('idx1', cat(...idxParts));

  // ── RIFF header ───────────────────────────────────────────────────────────
  // riffInner = 'AVI '(4) + hdrl + moviChunk(8 + moviInnerSize) + idx1
  const riffInnerSize = 4 + hdrl.length + (8 + moviInnerSize) + idx1.length;
  const riffHeader    = cat(fcc('RIFF'), w32(riffInnerSize), fcc('AVI '));

  // Shared per-frame chunk header (same for every frame)
  const frameChunkHdr = cat(fcc('00dc'), w32(frameBytes));

  // ── Assemble as Blob (avoids one giant allocation) ────────────────────────
  const parts = [riffHeader, hdrl, moviHeader];
  for (const frame of bgrFrames) {
    parts.push(frameChunkHdr, frame);
  }
  parts.push(idx1);

  return new Blob(parts, { type: 'video/avi' });
}
