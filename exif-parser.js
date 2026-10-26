/**
 * Lightweight browser & Node EXIF parser and lens FOV calculator.
 * Zero external dependencies.
 */

// Common EXIF Tag IDs
const TAGS = {
  0x010F: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011A: 'XResolution',
  0x011B: 'YResolution',
  0x0128: 'ResolutionUnit',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x8298: 'Copyright',
  0x8769: 'ExifIFDPointer',
  // Exif SubIFD
  0x829A: 'ExposureTime',
  0x829D: 'FNumber',
  0x8827: 'ISO',
  0x9003: 'DateTimeOriginal',
  0x920A: 'FocalLength',
  0x9209: 'Flash',
  0xA002: 'PixelXDimension',
  0xA003: 'PixelYDimension',
  0xA20E: 'FocalPlaneXResolution',
  0xA20F: 'FocalPlaneYResolution',
  0xA210: 'FocalPlaneResolutionUnit',
  0xA405: 'FocalLengthIn35mmFilm',
  0xA432: 'LensSpecification',
  0xA433: 'LensMake',
  0xA434: 'LensModel',
};

/**
 * Parses raw TIFF data starting at offset in an ArrayBuffer.
 */
export function parseTiff(buffer, offset = 0, length = buffer.byteLength - offset) {
  if (offset + 8 > buffer.byteLength) return null;
  const view = new DataView(buffer, offset, length);

  const byteOrder = view.getUint16(0);
  let littleEndian = false;
  if (byteOrder === 0x4949) {
    littleEndian = true;
  } else if (byteOrder === 0x4D4D) {
    littleEndian = false;
  } else {
    return null;
  }

  if (view.getUint16(2, littleEndian) !== 42) return null;

  const firstIfdOffset = view.getUint32(4, littleEndian);
  if (firstIfdOffset >= view.byteLength) return null;

  const rawTags = {};

  function readEntry(entryOffset) {
    if (entryOffset + 12 > view.byteLength) return null;
    const tagId = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valOffsetField = entryOffset + 8;

    function getOffset() {
      return view.getUint32(valOffsetField, littleEndian);
    }

    let val = null;
    try {
      if (type === 1) { // BYTE
        if (count === 1) val = view.getUint8(valOffsetField);
        else {
          const off = count <= 4 ? valOffsetField : getOffset();
          val = [];
          for (let i = 0; i < count && off + i < view.byteLength; i++) {
            val.push(view.getUint8(off + i));
          }
        }
      } else if (type === 2) { // ASCII string
        const off = count <= 4 ? valOffsetField : getOffset();
        const chars = [];
        for (let i = 0; i < count && off + i < view.byteLength; i++) {
          const code = view.getUint8(off + i);
          if (code === 0) break;
          chars.push(String.fromCharCode(code));
        }
        val = chars.join('').trim();
      } else if (type === 3) { // SHORT (uint16)
        if (count === 1) val = view.getUint16(valOffsetField, littleEndian);
        else {
          const off = count <= 2 ? valOffsetField : getOffset();
          val = [];
          for (let i = 0; i < count && off + i * 2 + 1 < view.byteLength; i++) {
            val.push(view.getUint16(off + i * 2, littleEndian));
          }
        }
      } else if (type === 4) { // LONG (uint32)
        if (count === 1) val = view.getUint32(valOffsetField, littleEndian);
        else {
          const off = getOffset();
          val = [];
          for (let i = 0; i < count && off + i * 4 + 3 < view.byteLength; i++) {
            val.push(view.getUint32(off + i * 4, littleEndian));
          }
        }
      } else if (type === 5) { // RATIONAL (uint32 num, uint32 den)
        const off = getOffset();
        function readRat(pos) {
          if (pos + 7 >= view.byteLength) return 0;
          const num = view.getUint32(pos, littleEndian);
          const den = view.getUint32(pos + 4, littleEndian);
          return den === 0 ? 0 : num / den;
        }
        if (count === 1) val = readRat(off);
        else {
          val = [];
          for (let i = 0; i < count; i++) val.push(readRat(off + i * 8));
        }
      } else if (type === 7) { // UNDEFINED (raw bytes)
        const off = count <= 4 ? valOffsetField : getOffset();
        val = [];
        for (let i = 0; i < count && off + i < view.byteLength; i++) {
          val.push(view.getUint8(off + i));
        }
      } else if (type === 9) { // SLONG (int32)
        if (count === 1) val = view.getInt32(valOffsetField, littleEndian);
        else {
          const off = getOffset();
          val = [];
          for (let i = 0; i < count && off + i * 4 + 3 < view.byteLength; i++) {
            val.push(view.getInt32(off + i * 4, littleEndian));
          }
        }
      } else if (type === 10) { // SRATIONAL (int32 num, int32 den)
        const off = getOffset();
        function readSRat(pos) {
          if (pos + 7 >= view.byteLength) return 0;
          const num = view.getInt32(pos, littleEndian);
          const den = view.getInt32(pos + 4, littleEndian);
          return den === 0 ? 0 : num / den;
        }
        if (count === 1) val = readSRat(off);
        else {
          val = [];
          for (let i = 0; i < count; i++) val.push(readSRat(off + i * 8));
        }
      }
    } catch (_) {}

    return { tagId, val };
  }

  function readDirectory(dirOffset) {
    if (dirOffset + 2 > view.byteLength) return;
    const numEntries = view.getUint16(dirOffset, littleEndian);
    let entryOffset = dirOffset + 2;
    for (let i = 0; i < numEntries; i++) {
      const res = readEntry(entryOffset);
      if (res && res.val !== null && res.val !== undefined) {
        rawTags[res.tagId] = res.val;
      }
      entryOffset += 12;
    }

    if (rawTags[0x8769]) {
      const subOffset = Number(rawTags[0x8769]);
      if (subOffset < view.byteLength && subOffset !== dirOffset) {
        const subEntries = view.getUint16(subOffset, littleEndian);
        let subEntryOffset = subOffset + 2;
        for (let j = 0; j < subEntries; j++) {
          const subRes = readEntry(subEntryOffset);
          if (subRes && subRes.val !== null && subRes.val !== undefined) {
            rawTags[subRes.tagId] = subRes.val;
          }
          subEntryOffset += 12;
        }
      }
    }
  }

  readDirectory(firstIfdOffset);

  // Map to friendly names
  const result = {};
  for (const [tagIdStr, val] of Object.entries(rawTags)) {
    const id = Number(tagIdStr);
    const name = TAGS[id] || `Tag_0x${id.toString(16).toUpperCase()}`;
    result[name] = val;
  }
  return result;
}

/**
 * Extracts EXIF metadata dictionary from an image ArrayBuffer (JPEG, TIFF, WebP, PNG).
 */
export function extractExif(buffer) {
  if (!buffer || buffer.byteLength < 16) return null;
  const view = new DataView(buffer);

  // 1. JPEG (0xFFD8)
  if (view.getUint16(0) === 0xFFD8) {
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      offset += 2;
      if (marker === 0xFFDA || marker === 0xFFD9) break; // Start of Scan or End of Image

      const len = view.getUint16(offset);
      if (marker === 0xFFE1 && offset + 2 + 6 <= view.byteLength) { // APP1 Exif
        const exifSig = view.getUint32(offset + 2);
        const exifZero = view.getUint16(offset + 6);
        if (exifSig === 0x45786966 && exifZero === 0x0000) { // "Exif\0\0"
          const tiffStart = offset + 8;
          const tiffLen = len - 8;
          return parseTiff(buffer, tiffStart, Math.min(tiffLen, buffer.byteLength - tiffStart));
        }
      }
      offset += len;
    }
    return null;
  }

  // 2. TIFF (0x4949 or 0x4D4D)
  const header = view.getUint16(0);
  if (header === 0x4949 || header === 0x4D4D) {
    return parseTiff(buffer, 0, buffer.byteLength);
  }

  // 3. WebP (RIFF .... WEBP)
  if (view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    let offset = 12;
    while (offset + 8 < view.byteLength) {
      const chunkType = view.getUint32(offset);
      const chunkSize = view.getUint32(offset + 4, true);
      offset += 8;
      if (chunkType === 0x45584946) { // 'EXIF'
        // May start with Exif\0\0
        let tiffStart = offset;
        let tiffLen = chunkSize;
        if (chunkSize >= 6 && view.getUint32(offset) === 0x45786966 && view.getUint16(offset + 4) === 0x0000) {
          tiffStart += 6;
          tiffLen -= 6;
        }
        return parseTiff(buffer, tiffStart, Math.min(tiffLen, buffer.byteLength - tiffStart));
      }
      offset += (chunkSize + (chunkSize & 1)); // Padded to even bytes
    }
    return null;
  }

  // 4. PNG (0x89504E47)
  if (view.getUint32(0) === 0x89504E47) {
    let offset = 8;
    while (offset + 8 < view.byteLength) {
      const length = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      offset += 8;
      if (type === 0x65584966) { // 'eXIf' chunk
        return parseTiff(buffer, offset, Math.min(length, buffer.byteLength - offset));
      }
      offset += length + 4; // Skip data + CRC
    }
    return null;
  }

  return null;
}

/**
 * Calculates sensor dimensions and lens FOV from image dimensions and EXIF.
 *
 * @param {number} width Image pixel width
 * @param {number} height Image pixel height
 * @param {object} exif Parsed EXIF tags
 * @returns {object} Derived parameters and calculated FOV
 */
export function calculateLensFov(width, height, exif) {
  if (!width || !height) return null;

  const aspect = Math.max(width, height) / Math.min(width, height);
  const D35 = 43.2666; // 35mm full-frame sensor diagonal in mm

  let focalLength = exif?.FocalLength ? Number(exif.FocalLength) : null;
  let focalLength35mm = exif?.FocalLengthIn35mmFilm ? Number(exif.FocalLengthIn35mmFilm) : null;

  let sensorWidth = null;
  let sensorHeight = null;
  let sensorDiag = null;
  let sensorSource = null;

  // 1. Check FocalPlaneXResolution / FocalPlaneYResolution
  if (exif?.FocalPlaneXResolution && exif?.FocalPlaneYResolution && exif?.FocalPlaneXResolution > 0) {
    const unit = Number(exif.FocalPlaneResolutionUnit) || 2; // Default: 2 = inches
    let unitScaleMm = 25.4; // inches to mm
    if (unit === 3) unitScaleMm = 10;     // centimeters
    else if (unit === 4) unitScaleMm = 1;  // millimeters
    else if (unit === 5) unitScaleMm = 0.001; // micrometers

    const pxW = Number(exif.PixelXDimension) || width;
    const pxH = Number(exif.PixelYDimension) || height;

    sensorWidth = (pxW / Number(exif.FocalPlaneXResolution)) * unitScaleMm;
    sensorHeight = (pxH / Number(exif.FocalPlaneYResolution)) * unitScaleMm;
    sensorDiag = Math.hypot(sensorWidth, sensorHeight);
    sensorSource = 'Focal Plane Resolution';
  }

  // 2. If no sensor resolution, estimate sensor from 35mm equivalent
  if ((!sensorWidth || !sensorHeight) && focalLength35mm) {
    const h35 = D35 / Math.sqrt(aspect * aspect + 1);
    const w35 = aspect * h35;

    if (focalLength && focalLength > 0) {
      const cropFactor = focalLength35mm / focalLength;
      sensorWidth = w35 / cropFactor;
      sensorHeight = h35 / cropFactor;
      sensorDiag = D35 / cropFactor;
      sensorSource = `Derived from 35mm eq (${focalLength35mm}mm) & focal length (${focalLength}mm)`;
    } else {
      sensorWidth = w35;
      sensorHeight = h35;
      sensorDiag = D35;
      sensorSource = '35mm Film Equivalent';
    }
  }

  // 3. Fallback: If only focal length is known and camera model matches common sizes
  if (!sensorWidth && focalLength && exif?.Model) {
    const model = (exif.Make + ' ' + exif.Model).toLowerCase();
    let crop = null;
    if (model.includes('iphone') || model.includes('pixel') || model.includes('galaxy')) {
      crop = 6.0; // typical smartphone sensor ~1/2.5" to 1/1.3"
    } else if (model.includes('gopro') || model.includes('hero') || model.includes('ring')) {
      crop = 5.6; // action / doorbell cam ~1/2.3"
    }
    if (crop) {
      const h35 = D35 / Math.sqrt(aspect * aspect + 1);
      const w35 = aspect * h35;
      sensorWidth = w35 / crop;
      sensorHeight = h35 / crop;
      sensorDiag = D35 / crop;
      focalLength35mm = focalLength * crop;
      sensorSource = `Estimated for ${exif.Model} (crop factor ~${crop})`;
    }
  }

  // Compute FOVs
  let calculatedFov = null;
  let fovType = 'rectilinear';
  let derivation = '';

  const maxSensorDim = sensorWidth && sensorHeight ? Math.max(sensorWidth, sensorHeight) : null;

  if (focalLength35mm && focalLength35mm > 0) {
    const h35 = D35 / Math.sqrt(aspect * aspect + 1);
    const w35 = aspect * h35; // dimension along the longest axis in 35mm frame

    // Check if lens is fisheye:
    const lensText = ((exif?.LensModel || '') + ' ' + (exif?.Model || '')).toLowerCase();
    const isFisheye = lensText.includes('fisheye') || lensText.includes('circular') || focalLength35mm <= 12;

    if (isFisheye) {
      // Equidistant fisheye: FOV = (w35 / f35) * (180 / π)
      calculatedFov = (w35 / focalLength35mm) * (180 / Math.PI);
      fovType = 'fisheye';
      derivation = `Equidistant fisheye model from 35mm equivalent (${focalLength35mm}mm)`;
    } else {
      // Rectilinear: FOV = 2 * atan(w35 / (2 * f35)) * (180 / π)
      calculatedFov = 2 * Math.atan(w35 / (2 * focalLength35mm)) * (180 / Math.PI);
      fovType = 'rectilinear';
      derivation = `Rectilinear model from 35mm equivalent (${focalLength35mm}mm)`;
    }
  } else if (focalLength && maxSensorDim && focalLength > 0) {
    calculatedFov = 2 * Math.atan(maxSensorDim / (2 * focalLength)) * (180 / Math.PI);
    fovType = 'rectilinear';
    derivation = `From sensor dimension (${maxSensorDim.toFixed(2)}mm) and focal length (${focalLength}mm)`;
  }

  return {
    focalLength,
    focalLength35mm,
    sensorWidth,
    sensorHeight,
    sensorDiag,
    sensorSource,
    calculatedFov: calculatedFov ? Math.round(calculatedFov * 10) / 10 : null,
    fovType,
    derivation,
  };
}
