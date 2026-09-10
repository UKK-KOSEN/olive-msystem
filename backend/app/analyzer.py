"""
olive-msystem analysis engine.

This module re-uses the exact detection algorithm from the olive-p project
(src/runtime.Analyzer and src/video_processor.VideoProcessor). The difference
vs. the original CLI is that instead of analysing a video only from the
beginning, the operator *chooses* the timestamps at which frames should be
extracted, analysed and saved.

The video is opened once, the requested timestamps are sorted, and the capture
position is seeked to each one before calling the (unchanged) Analyzer. The
annotated frame, a JSON result and a thumbnail are written to storage.
"""
from __future__ import annotations

import json
import math
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

# Make the olive-p sources importable.
from .config import OLIVE_P_DIR


def _import_olive_runtime():
    """Import olive-p modules; raise a helpful error if they cannot be found."""
    sys.path.insert(0, str(OLIVE_P_DIR))
    try:
        from src.runtime import Analyzer, load_runtime_config, explain_detection  # noqa: F401
        from src.video_processor import VideoProcessor  # noqa: F401
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Could not import olive-p backend modules. Set OLIVE_P_DIR to the "
            "correct olive-p path. Original error: %s" % exc
        ) from exc
    return sys.modules["src.runtime"], sys.modules["src.video_processor"]


def parse_time(value: str) -> float:
    """Convert a time spec to seconds.

    Accepts:
      - HH:MM:SS  (e.g. "00:01:30")
      - MM:SS     (e.g. "01:30")
      - SS        (e.g. "90")
      - a float number treated as seconds
    """
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        raise ValueError("empty time spec")
    if text.isdigit():
        return float(text)
    # Allow a decimal fraction on the last component (e.g. "90.5", "00:01:30.5").
    if text.rstrip(".").replace(".", "", 1).isdigit():
        return float(text)
    parts = text.split(":")
    if len(parts) > 3 or not all(
        (p.isdigit() or (p.rstrip(".").replace(".", "", 1).isdigit() and p.find(".") >= 0))
        for p in parts
    ):
        raise ValueError(f"invalid time spec: {value!r}")
    secs = 0.0
    for n in parts:
        secs = secs * 60 + float(n)
    return float(secs)


class OliveAnalyzer:
    """Thin facade over olive-p's Analyzer + VideoProcessor."""

    def __init__(self):
        runtime, video = _import_olive_runtime()
        self._runtime = runtime
        self._Analyzer = runtime.Analyzer
        self._VideoProcessor = video.VideoProcessor
        self.config_path = OLIVE_P_DIR / "config" / "runtime.yaml"
        self.config_path = self.config_path if self.config_path.exists() else None

    def _new_analyzer(self, drone_mode: bool = False):
        config = self._runtime.load_runtime_config(self.config_path)
        return self._Analyzer(config, resolution_mode="auto", drone_mode=drone_mode)

    # ---- image analysis ---------------------------------------------------
    def analyze_image(self, image_bgr, source: str, drone_mode: bool = False):
        """Run the olive-p algorithm on a single BGR frame.

        Returns the full result dict (with numpy masks intact for drawing)
        plus the annotated BGR image.
        """
        analyzer = self._new_analyzer(drone_mode=drone_mode)
        return analyzer.analyze(image_bgr, source)

    def analyze_image_file(self, image_path: str, output_dir: str, source: str,
                           drone_mode: bool = False) -> dict:
        """Analyse a single still image file and write annotated/raw copies.

        Returns a JSON-serialisable record (mirrors the per-time records
        produced by analyze_video_at_times, with label 'image').
        """
        import cv2
        frame = cv2.imread(str(image_path))
        if frame is None:
            raise RuntimeError(f"could not read image: {image_path}")
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        raw_path = out / "image_raw.jpg"
        annotated_path = out / "annotated.jpg"
        _imwrite(raw_path, frame)
        result, annotated = self.analyze_image(frame, source, drone_mode=drone_mode)
        _imwrite(annotated_path, annotated)
        rec = {k: v for k, v in result.items() if not isinstance(v, np.ndarray)}
        rec["_frame_raw"] = str(raw_path)
        rec["_frame_annotated"] = str(annotated_path)
        rec["timestamp_sec"] = 0.0
        rec["label"] = "image"
        rec["source"] = source
        rec["ok"] = True
        return rec

    # ---- video info -------------------------------------------------------
    def video_info(self, video_path: str) -> dict:
        processor = self._VideoProcessor(str(video_path), _noop_logger())
        try:
            stats = processor.get_statistics()
            return {
                "fps": stats["fps"],
                "frame_count": stats["frame_count"],
                "width": stats["width"],
                "height": stats["height"],
                "duration_seconds": stats["duration_seconds"],
                "file_path": stats["file_path"],
            }
        finally:
            processor.close()

    # ---- time-specified video analysis ------------------------------------
    def analyze_video_at_times(self, video_path: str, times: list[float],
                               output_dir: str, source: str,
                               drone_mode: bool = False) -> list[dict]:
        """Analyse the video at the given timestamps (in seconds).

        For each requested timestamp a frame is seeked, analysed with the
        olive-p algorithm, and written to ``output_dir`` as:
          - annotated_<HH-MM-SS>.jpg   (debug annotation)
          - frame_<HH-MM-SS>.jpg       (raw frame)
          - a JSON record in the returned list.

        Returns a list of per-time result dicts (JSON-serialisable).
        """
        processor = self._VideoProcessor(str(video_path), _noop_logger())
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        sorted_times = sorted(times)
        results = []
        try:
            for t in sorted_times:
                frame = processor.get_frame_at_time(t)
                if frame is None:
                    results.append({
                        "ok": False, "timestamp": t, "error": "out of range",
                    })
                    continue
                label = _format_ts(t)
                raw_path = out / f"frame_{label}.jpg"
                _imwrite(raw_path, frame)
                try:
                    result, annotated = self.analyze_image(frame, f"{source}@{label}")
                except Exception as exc:  # pragma: no cover
                    results.append({
                        "ok": False, "timestamp": t, "label": label,
                        "error": f"{type(exc).__name__}: {exc}",
                    })
                    continue
                annotated_path = out / f"annotated_{label}.jpg"
                _imwrite(annotated_path, annotated)
                # Build a JSON-serialisable record.
                rec = {k: v for k, v in result.items() if not isinstance(v, np.ndarray)}
                rec["_frame_raw"] = str(raw_path)
                rec["_frame_annotated"] = str(annotated_path)
                rec["timestamp_sec"] = t
                rec["label"] = label
                rec["ok"] = True
                results.append(rec)
        finally:
            processor.close()
        return results


def _imwrite(path, image) -> None:
    import cv2
    cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 90])


def _format_ts(seconds: float) -> str:
    total = int(round(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}-{m:02d}-{s:02d}"


class _noop_logger:
    @staticmethod
    def info(*args, **kwargs): ...
    @staticmethod
    def warning(*args, **kwargs): ...
    @staticmethod
    def error(*args, **kwargs): ...
    @staticmethod
    def debug(*args, **kwargs): ...


def explain_detection(result: dict) -> str:
    """Wrap olive-p's explain_detection for use in the dashboard."""
    runtime, _ = _import_olive_runtime()
    return runtime.explain_detection(result)
