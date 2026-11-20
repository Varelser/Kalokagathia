#!/usr/bin/env python3
"""flip-compare.py — FLIP-like perceptual image comparison (Phase DA2).

Compares a reference image against a test image of the SAME dimensions and
reports a perceptual error approximation inspired by FLIP (NVIDIA /
Andersson et al.), plus a per-pixel error map.

IMPORTANT — this is an APPROXIMATION, not a reimplementation of FLIP:
  * Real FLIP works in a perceptually uniform colour space, applies a
    contrast sensitivity function (CSF) with spatial filtering tuned to
    viewing conditions (pixels per degree), and models feature/edge
    detection. None of that is reproduced here.
  * What this tool does instead:
      1. sRGB values are linearised (sRGB EOTF).
      2. Linear RGB is split into luminance (Y) and two opponent chroma
         channels (R-G, (R+G)/2-B).
      3. Channels pass through a cube-root perceptual compression
         (L*-like for Y, sign-preserving cube root for chroma).
      4. Per-pixel error = sqrt( dL^2 + 0.6 * (dO1^2 + dO2^2) ),
         clamped to [0, 1]. 0 = identical, 1 = maximally different.
    The numbers are therefore useful as a RELATIVE regression gate
    (same fixed pose, before/after), not as absolute FLIP scores and
    not comparable to published FLIP values.

Inputs: PNG (8-bit, colour types 0/2/3/4/6, non-interlaced) or binary
PNM (P5/P6). Alpha, when present, is composited over black.

Backends: uses PIL + numpy when importable (fast path); otherwise falls
back to a pure-standard-library decoder/statistics path (slower, same
math). Force the pure path with --pure-python or FLIP_COMPARE_PURE=1.

Usage:
    python3 scripts/flip-compare.py REF.png TEST.png \
        [--error-map errormap.png] [--json result.json] \
        [--threshold-p99 0.05] [--pure-python]

Exit codes: 0 = ok (and p99 <= threshold when given),
            1 = p99 exceeded --threshold-p99,
            2 = usage / IO / dimension-mismatch error.

Output JSON fields: width, height, backend, mean, p50, p95, p99, max,
pixelsAbove (fraction of pixels with error > 0.1), paths.
"""

import json
import math
import os
import struct
import sys
import zlib

# --------------------------------------------------------------------------
# Image loading
# --------------------------------------------------------------------------

def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def load_png_pure(path):
    """Minimal pure-stdlib PNG decoder.

    Supports 8-bit (and 16-bit, truncated to high byte) non-interlaced
    PNGs of colour types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha),
    6 (RGBA). Returns (width, height, rows) where rows is a list of
    bytearray, one per row, 3 bytes per pixel (RGB).
    """
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG file")
    pos = 8
    idat = bytearray()
    palette = None
    trns = None
    width = height = bit_depth = colour_type = interlace = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            (width, height, bit_depth, colour_type, _comp,
             _filt, interlace) = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"PLTE":
            palette = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat.extend(chunk)
        elif ctype == b"IEND":
            break
    if interlace != 0:
        raise ValueError(f"{path}: interlaced PNG not supported by pure path")
    if bit_depth not in (8, 16):
        raise ValueError(f"{path}: unsupported bit depth {bit_depth}")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour_type]
    step = 2 if bit_depth == 16 else 1
    bpp = channels * step          # bytes per pixel in raw scanlines
    stride = width * bpp
    raw = zlib.decompress(bytes(idat))
    rows_raw = []
    prev = bytearray(stride)
    off = 0
    for _y in range(height):
        ftype = raw[off]
        line = bytearray(raw[off + 1:off + 1 + stride])
        off += 1 + stride
        if ftype == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + _paeth(a, b, c)) & 0xFF
        elif ftype != 0:
            raise ValueError(f"{path}: unknown PNG filter {ftype}")
        rows_raw.append(line)
        prev = line

    # Normalise to RGB rows (alpha composited over black).
    rows = []
    for line in rows_raw:
        out = bytearray(width * 3)
        for x in range(width):
            src = x * bpp
            if colour_type == 0:
                v = line[src]
                out[x * 3:x * 3 + 3] = bytes((v, v, v))
            elif colour_type == 2:
                if step == 2:
                    out[x * 3:x * 3 + 3] = bytes(
                        (line[src], line[src + 2], line[src + 4]))
                else:
                    out[x * 3:x * 3 + 3] = line[src:src + 3]
            elif colour_type == 3:
                idx = line[src]
                base = idx * 3
                r, g, b = palette[base], palette[base + 1], palette[base + 2]
                a = trns[idx] if trns and idx < len(trns) else 255
                out[x * 3:x * 3 + 3] = bytes(
                    (r * a // 255, g * a // 255, b * a // 255))
            elif colour_type == 4:
                v = line[src]
                a = line[src + step]
                out[x * 3:x * 3 + 3] = bytes(
                    (v * a // 255, v * a // 255, v * a // 255))
            elif colour_type == 6:
                if step == 2:
                    r, g, b, a = (line[src], line[src + 2],
                                  line[src + 4], line[src + 6])
                else:
                    r, g, b, a = (line[src], line[src + 1],
                                  line[src + 2], line[src + 3])
                out[x * 3:x * 3 + 3] = bytes(
                    (r * a // 255, g * a // 255, b * a // 255))
        rows.append(out)
    return width, height, rows


def load_pnm_pure(path):
    """Binary PGM (P5) / PPM (P6), maxval 255 only."""
    with open(path, "rb") as fh:
        data = fh.read()
    tokens = []
    i = 0
    while len(tokens) < 4:
        while i < len(data) and data[i:i + 1].isspace():
            i += 1
        if data[i:i + 1] == b"#":
            while i < len(data) and data[i:i + 1] != b"\n":
                i += 1
            continue
        j = i
        while j < len(data) and not data[j:j + 1].isspace():
            j += 1
        tokens.append(data[i:j])
        i = j
    i += 1  # single whitespace before raster
    magic = tokens[0]
    width, height, maxval = int(tokens[1]), int(tokens[2]), int(tokens[3])
    if maxval != 255:
        raise ValueError(f"{path}: PNM maxval must be 255")
    raster = data[i:]
    rows = []
    if magic == b"P6":
        stride = width * 3
        for y in range(height):
            rows.append(bytearray(raster[y * stride:(y + 1) * stride]))
    elif magic == b"P5":
        for y in range(height):
            line = raster[y * width:(y + 1) * width]
            out = bytearray(width * 3)
            for x, v in enumerate(line):
                out[x * 3:x * 3 + 3] = bytes((v, v, v))
            rows.append(out)
    else:
        raise ValueError(f"{path}: unsupported PNM magic {magic!r}")
    return width, height, rows


def load_image_pure(path):
    with open(path, "rb") as fh:
        magic = fh.read(8)
    if magic[:4] == b"\x89PNG":
        return load_png_pure(path)
    if magic[:2] in (b"P5", b"P6"):
        return load_pnm_pure(path)
    raise ValueError(f"{path}: pure path supports PNG / P5 / P6 only")


def load_image_fast(path):
    """PIL + numpy path. Returns (width, height, uint8 array HxWx3)."""
    from PIL import Image
    import numpy as np
    with Image.open(path) as im:
        if im.mode in ("RGBA", "LA", "PA") or (
                im.mode == "P" and "transparency" in im.info):
            rgba = np.asarray(im.convert("RGBA"), dtype=np.float32)
            rgb = rgba[..., :3] * (rgba[..., 3:4] / 255.0)
            arr = rgb.astype(np.uint8)
        else:
            arr = np.asarray(im.convert("RGB"))
    return arr.shape[1], arr.shape[0], arr


def write_png_gray_pure(path, width, height, rows):
    """Write an 8-bit grayscale PNG using only the stdlib."""
    def chunk(ctype, payload):
        crc = zlib.crc32(ctype + payload) & 0xFFFFFFFF
        return (struct.pack(">I", len(payload)) + ctype + payload
                + struct.pack(">I", crc))
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


# --------------------------------------------------------------------------
# Perceptual error (FLIP approximation — see module docstring)
# --------------------------------------------------------------------------

def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _cbrt(x):
    return math.copysign(abs(x) ** (1.0 / 3.0), x)


def _pixel_error(r1, g1, b1, r2, g2, b2):
    lr1, lg1, lb1 = (_srgb_to_linear(r1 / 255.0),
                     _srgb_to_linear(g1 / 255.0),
                     _srgb_to_linear(b1 / 255.0))
    lr2, lg2, lb2 = (_srgb_to_linear(r2 / 255.0),
                     _srgb_to_linear(g2 / 255.0),
                     _srgb_to_linear(b2 / 255.0))
    y1 = 0.2126 * lr1 + 0.7152 * lg1 + 0.0722 * lb1
    y2 = 0.2126 * lr2 + 0.7152 * lg2 + 0.0722 * lb2
    dl = _cbrt(y1) - _cbrt(y2)
    do1 = _cbrt(lr1 - lg1) - _cbrt(lr2 - lg2)
    do2 = _cbrt(0.5 * (lr1 + lg1) - lb1) - _cbrt(0.5 * (lr2 + lg2) - lb2)
    err = math.sqrt(dl * dl + 0.6 * (do1 * do1 + do2 * do2))
    return 1.0 if err > 1.0 else err


def compare_pure(ref, test):
    """ref/test: (w, h, rows). Returns (stats dict, error rows uint8)."""
    w, h, ref_rows = ref
    _, _, test_rows = test
    errors = []
    err_rows = []
    above = 0
    total = w * h
    for y in range(h):
        rrow, trow = ref_rows[y], test_rows[y]
        erow = bytearray(w)
        for x in range(w):
            i = x * 3
            e = _pixel_error(rrow[i], rrow[i + 1], rrow[i + 2],
                             trow[i], trow[i + 1], trow[i + 2])
            errors.append(e)
            if e > 0.1:
                above += 1
            erow[x] = int(e * 255.0 + 0.5)
        err_rows.append(erow)
    errors.sort()
    stats = _stats(errors, above, total)
    return stats, err_rows


def compare_fast(ref_arr, test_arr):
    import numpy as np
    a = ref_arr.astype(np.float32) / 255.0
    b = test_arr.astype(np.float32) / 255.0

    def lin(c):
        return np.where(c <= 0.04045, c / 12.92,
                        ((c + 0.055) / 1.055) ** 2.4)
    la, lb = lin(a), lin(b)
    y1 = 0.2126 * la[..., 0] + 0.7152 * la[..., 1] + 0.0722 * la[..., 2]
    y2 = 0.2126 * lb[..., 0] + 0.7152 * lb[..., 1] + 0.0722 * lb[..., 2]
    dl = np.cbrt(y1) - np.cbrt(y2)
    do1 = np.cbrt(la[..., 0] - la[..., 1]) - np.cbrt(lb[..., 0] - lb[..., 1])
    do2 = (np.cbrt(0.5 * (la[..., 0] + la[..., 1]) - la[..., 2])
           - np.cbrt(0.5 * (lb[..., 0] + lb[..., 1]) - lb[..., 2]))
    err = np.sqrt(dl * dl + 0.6 * (do1 * do1 + do2 * do2))
    np.clip(err, 0.0, 1.0, out=err)
    flat = np.sort(err, axis=None)
    stats = _stats(flat.tolist(), int((err > 0.1).sum()), err.size)
    err_rows = [bytearray(row) for row in
                (err * 255.0 + 0.5).astype(np.uint8).tolist()]
    return stats, err_rows


def _percentile(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1,
              max(0, math.ceil(q * len(sorted_vals)) - 1))
    return sorted_vals[idx]


def _stats(sorted_errors, above, total):
    return {
        "mean": sum(sorted_errors) / total if total else 0.0,
        "p50": _percentile(sorted_errors, 0.50),
        "p95": _percentile(sorted_errors, 0.95),
        "p99": _percentile(sorted_errors, 0.99),
        "max": sorted_errors[-1] if sorted_errors else 0.0,
        "pixelsAbove01": (above / total) if total else 0.0,
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv):
    args = []
    opts = {}
    value_opts = ("error-map", "json", "threshold-p99")
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            opts[k] = v
        elif a.startswith("--") and a[2:] in value_opts:
            opts[a[2:]] = argv[i + 1]
            i += 1
        elif a.startswith("--"):
            opts[a[2:]] = True
        else:
            args.append(a)
        i += 1
    if len(args) != 2:
        print(__doc__.split("Usage:")[1].split("Exit codes")[0].strip(),
              file=sys.stderr)
        print("usage: flip-compare.py REF TEST [options]", file=sys.stderr)
        return 2
    ref_path, test_path = args

    use_pure = bool(opts.get("pure-python")) or \
        os.environ.get("FLIP_COMPARE_PURE") == "1"
    backend = "pure-python"
    ref_img = test_img = None
    if not use_pure:
        try:
            rw, rh, ref_arr = load_image_fast(ref_path)
            tw, th, test_arr = load_image_fast(test_path)
            backend = "pil+numpy"
        except ImportError:
            use_pure = True
    if use_pure:
        try:
            ref_img = load_image_pure(ref_path)
            test_img = load_image_pure(test_path)
            rw, rh = ref_img[0], ref_img[1]
            tw, th = test_img[0], test_img[1]
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    elif rw != tw or rh != th:
        pass  # handled below with the dimension check

    if rw != tw or rh != th:
        print(f"error: dimension mismatch: ref {rw}x{rh} vs test {tw}x{th}",
              file=sys.stderr)
        return 2

    if backend == "pil+numpy":
        stats, err_rows = compare_fast(ref_arr, test_arr)
    else:
        stats, err_rows = compare_pure(ref_img, test_img)

    result = {
        "tool": "flip-compare (FLIP approximation, not FLIP itself)",
        "reference": ref_path,
        "test": test_path,
        "width": rw,
        "height": rh,
        "backend": backend,
        **{k: round(v, 6) for k, v in stats.items()},
    }

    err_map_path = opts.get("error-map")
    if err_map_path:
        try:
            from PIL import Image
            import numpy as np
            Image.fromarray(
                np.array([list(r) for r in err_rows], dtype=np.uint8),
                mode="L").save(err_map_path)
        except ImportError:
            write_png_gray_pure(err_map_path, rw, rh, err_rows)
        result["errorMap"] = err_map_path

    print(json.dumps(result, indent=2))
    if opts.get("json"):
        with open(opts["json"], "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
            fh.write("\n")

    threshold = opts.get("threshold-p99")
    if threshold is not None and stats["p99"] > float(threshold):
        print(f"FAIL: p99 {stats['p99']:.6f} > threshold {threshold}",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
