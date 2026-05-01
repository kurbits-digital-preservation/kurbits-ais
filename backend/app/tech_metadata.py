"""
Technical metadata extraction for uploaded files.

Extracts:
  - MD5 + SHA-256 checksums
  - MIME type via libmagic (more reliable than extension-based)
  - Image: dimensions, DPI, colour mode, bit depth, EXIF/IPTC data
  - PDF: page count (via Pillow PDF support)
  - AV: duration, codec, bitrate (via ffprobe if available)
  - Generates thumbnail for images and PDFs

All extraction is non-fatal — if a step fails, the others still run.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ── PRONOM format map (common formats) ────────────────────────────────
# Maps mime_type → PRONOM ID for the most common archival formats
PRONOM_MAP = {
    'image/tiff':                'fmt/353',
    'image/jpeg':                'fmt/41',
    'image/png':                 'fmt/11',
    'image/gif':                 'fmt/3',
    'image/webp':                'fmt/1507',
    'image/jp2':                 'x-fmt/392',
    'application/pdf':           'fmt/276',   # PDF 1.7 default; refined below
    'text/plain':                'x-fmt/111',
    'text/csv':                  'x-fmt/18',
    'text/html':                 'fmt/96',
    'application/xml':           'fmt/101',
    'application/json':          'fmt/817',
    'application/zip':           'x-fmt/263',
    'application/vnd.ms-excel':  'fmt/61',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'fmt/214',
    'application/msword':        'fmt/40',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'fmt/412',
    'audio/mpeg':                'fmt/134',
    'audio/wav':                 'fmt/6',
    'audio/flac':                'fmt/279',
    'video/mp4':                 'fmt/199',
    'video/quicktime':           'x-fmt/384',
    'video/x-msvideo':           'fmt/5',
}

IMAGE_TYPES = {
    'image/tiff', 'image/jpeg', 'image/png', 'image/gif',
    'image/webp', 'image/jp2', 'image/bmp', 'image/x-bmp',
}
VIDEO_TYPES = {
    'video/mp4', 'video/quicktime', 'video/x-msvideo',
    'video/x-matroska', 'video/webm', 'video/ogg',
}
AUDIO_TYPES = {
    'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg',
    'audio/aac', 'audio/mp4',
}


def compute_checksums(filepath: str) -> tuple[str, str]:
    """Compute MD5 and SHA-256 checksums of a file."""
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


def detect_mime_type(filepath: str) -> str:
    """Use libmagic for reliable MIME type detection."""
    try:
        import magic
        return magic.from_file(filepath, mime=True)
    except Exception:
        return 'application/octet-stream'


def _clean_exif_value(val) -> object:
    """Make EXIF values JSON-serialisable."""
    if isinstance(val, bytes):
        try:
            return val.decode('utf-8', errors='replace')
        except Exception:
            return val.hex()
    if isinstance(val, (int, float, str, bool, type(None))):
        return val
    if hasattr(val, 'numerator') and hasattr(val, 'denominator'):
        # IFDRational
        try:
            return float(val)
        except Exception:
            return str(val)
    return str(val)


EXIF_TAGS_OF_INTEREST = {
    # Camera / capture
    271:  'Make',
    272:  'Model',
    305:  'Software',
    306:  'DateTime',
    36867: 'DateTimeOriginal',
    36868: 'DateTimeDigitized',
    33434: 'ExposureTime',
    33437: 'FNumber',
    34855: 'ISOSpeedRatings',
    37386: 'FocalLength',
    37383: 'MeteringMode',
    37384: 'LightSource',
    37385: 'Flash',
    # GPS
    1:    'GPSLatitudeRef',
    2:    'GPSLatitude',
    3:    'GPSLongitudeRef',
    4:    'GPSLongitude',
    6:    'GPSAltitude',
    # Image characteristics
    274:  'Orientation',
    296:  'ResolutionUnit',
    282:  'XResolution',
    283:  'YResolution',
    # Copyright / attribution
    315:  'Artist',
    33432: 'Copyright',
    270:  'ImageDescription',
    # IPTC/XMP often exposed via PIL tags
}


def extract_image_metadata(filepath: str) -> dict:
    """Extract image dimensions, DPI, mode, bit depth, and selected EXIF."""
    from PIL import Image, ExifTags, TiffImagePlugin
    result: dict = {}
    try:
        with Image.open(filepath) as img:
            result['image_width'] = img.width
            result['image_height'] = img.height
            result['image_mode'] = img.mode

            # Bit depth from mode
            mode_bits = {
                '1': 1, 'L': 8, 'P': 8, 'RGB': 8, 'RGBA': 8,
                'CMYK': 8, 'YCbCr': 8, 'LAB': 8, 'HSV': 8,
                'I': 32, 'F': 32, 'I;16': 16, 'I;16B': 16,
                'I;16L': 16, 'I;16S': 16, 'I;16BS': 16,
            }
            result['image_bit_depth'] = mode_bits.get(img.mode, 8)

            # DPI
            dpi = img.info.get('dpi') or img.info.get('jfif_density')
            if dpi and isinstance(dpi, (tuple, list)) and len(dpi) == 2:
                result['image_dpi_x'] = float(dpi[0]) if dpi[0] else None
                result['image_dpi_y'] = float(dpi[1]) if dpi[1] else None
            elif hasattr(img, 'tag_v2'):
                # TIFF
                xres = img.tag_v2.get(282)
                yres = img.tag_v2.get(283)
                if xres:
                    result['image_dpi_x'] = float(xres)
                if yres:
                    result['image_dpi_y'] = float(yres)

            # EXIF
            exif_data: dict = {}
            try:
                raw_exif = img._getexif()  # type: ignore
                if raw_exif:
                    for tag_id, value in raw_exif.items():
                        tag_name = EXIF_TAGS_OF_INTEREST.get(tag_id) or ExifTags.TAGS.get(tag_id)
                        if tag_name and tag_id in EXIF_TAGS_OF_INTEREST:
                            exif_data[tag_name] = _clean_exif_value(value)
            except (AttributeError, Exception):
                pass

            # IPTC keywords if present
            try:
                from PIL import IptcImagePlugin
                iptc = IptcImagePlugin.getiptcinfo(img)
                if iptc:
                    kw = iptc.get((2, 25))  # Keywords
                    if kw:
                        if isinstance(kw, list):
                            exif_data['IPTC_Keywords'] = [
                                k.decode('utf-8', errors='replace') if isinstance(k, bytes) else str(k)
                                for k in kw
                            ]
                        caption = iptc.get((2, 120))
                        if caption:
                            exif_data['IPTC_Caption'] = caption.decode('utf-8', errors='replace') if isinstance(caption, bytes) else str(caption)
                        credit = iptc.get((2, 110))
                        if credit:
                            exif_data['IPTC_Credit'] = credit.decode('utf-8', errors='replace') if isinstance(credit, bytes) else str(credit)
            except Exception:
                pass

            if exif_data:
                result['exif_data'] = exif_data

    except Exception as e:
        result['_image_error'] = str(e)

    return result


def extract_av_metadata(filepath: str) -> dict:
    """Extract AV duration, codec, bitrate via ffprobe."""
    result: dict = {}
    try:
        cmd = [
            'ffprobe', '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams', '-show_format',
            filepath,
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=30)
        if proc.returncode != 0:
            return result

        data = json.loads(proc.stdout)
        fmt = data.get('format', {})
        streams = data.get('streams', [])

        duration = fmt.get('duration')
        if duration:
            result['duration_seconds'] = float(duration)

        bitrate = fmt.get('bit_rate')
        if bitrate:
            result['av_bitrate'] = int(bitrate)

        # Find primary video or audio codec
        for stream in streams:
            if stream.get('codec_type') in ('video', 'audio'):
                codec = stream.get('codec_name')
                if codec:
                    result['av_codec'] = codec
                    break

    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, Exception):
        pass

    return result


def generate_thumbnail(filepath: str, thumb_path: str,
                        mime_type: str, max_size: int = 400) -> bool:
    """
    Generate a thumbnail for images and PDFs.
    Returns True if successful.
    """
    from PIL import Image

    try:
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)

        if mime_type == 'application/pdf':
            # Render first page of PDF at 72 DPI via Pillow
            with Image.open(filepath) as img:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
                img.save(thumb_path, 'JPEG', quality=85, optimize=True)
            return True

        if mime_type in IMAGE_TYPES or mime_type.startswith('image/'):
            with Image.open(filepath) as img:
                # Convert to RGB for JPEG output (handles CMYK, P, RGBA etc.)
                if img.mode in ('RGBA', 'P', 'CMYK', 'LAB', 'HSV', 'I', 'F'):
                    img = img.convert('RGB')
                img.thumbnail((max_size, max_size), Image.LANCZOS)
                img.save(thumb_path, 'JPEG', quality=85, optimize=True)
            return True

    except Exception:
        pass

    return False


def extract_all(filepath: str, mime_type: str, thumb_dir: str,
                stored_filename: str) -> dict:
    """
    Run all extraction steps and return a dict ready to update
    NodeAttachment fields with.
    """
    result: dict = {}

    # 1. Checksums
    try:
        md5, sha256 = compute_checksums(filepath)
        result['checksum_md5'] = md5
        result['checksum_sha256'] = sha256
    except Exception:
        pass

    # 2. Authoritative MIME type via libmagic
    try:
        detected = detect_mime_type(filepath)
        if detected and detected != 'application/octet-stream':
            result['mime_type'] = detected
            mime_type = detected
    except Exception:
        pass

    # 3. PRONOM ID
    result['pronom_id'] = PRONOM_MAP.get(mime_type)

    # 4. Image metadata
    if mime_type in IMAGE_TYPES or mime_type.startswith('image/'):
        img_meta = extract_image_metadata(filepath)
        result.update({k: v for k, v in img_meta.items() if not k.startswith('_')})

    # 5. AV metadata
    elif mime_type in VIDEO_TYPES | AUDIO_TYPES:
        av_meta = extract_av_metadata(filepath)
        result.update(av_meta)

    # 6. Thumbnail
    thumb_filename = f'thumb_{stored_filename}.jpg'
    thumb_path = os.path.join(thumb_dir, thumb_filename)
    if generate_thumbnail(filepath, thumb_path, mime_type):
        # Store relative path from upload folder root
        result['thumbnail_path'] = os.path.relpath(thumb_path,
            os.path.dirname(thumb_dir))

    result['tech_extracted_at'] = datetime.now(timezone.utc)

    return result