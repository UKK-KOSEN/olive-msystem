"""
olive-msystem processing queue.

Handles the "continuous upload" workflow: operators drop videos into a folder
(or through the API), the runner picks up each one, reads its duration, and
analyses it at the configured timestamps, storing results.

The runner runs as a background thread inside the FastAPI process.
"""
from __future__ import annotations

import functools
import json
import logging
import threading
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .analyzer import OliveAnalyzer, parse_time
from .translate_report import explain_detection_ja
from .config import STORAGE_DIR
from .health import health_state
from .soil_moisture import build_soil_data, integrate as integrate_soil, parse_observed_at_iso
from .storage import Store

log = logging.getLogger("olive-msystem.runner")


def _frame_observed_at(video: dict, rec: dict) -> Optional[str]:
    """Timestamp a video-frame observation at its actual capture moment.

    Uses the video's recorded_at (capture start) plus the frame offset, falling
    back to the upload time and finally the analysis time.
    """
    base = video.get("recorded_at") or video.get("created_at")
    if not base:
        return rec.get("observed_at")
    try:
        dt = datetime.fromisoformat(str(base).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.astimezone()
        ts = float(rec.get("timestamp_sec") or 0.0)
        return (dt + timedelta(seconds=ts)).astimezone().isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return rec.get("observed_at")


@functools.lru_cache(maxsize=4)
def _grader():
    from .config import OLIVE_P_DIR
    return OliveAnalyzer()


class Runner:
    """Consumes a queue of (video_id, times) jobs in the background."""

    def __init__(self, store: Store, workers: int = 1):
        self.store = store
        self.workers = workers
        self._queue: list[dict] = []
        self._active: dict[int, dict] = {}
        self._recent: list[dict] = []
        self._lock = threading.Lock()
        self._job_id = 0
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def enqueue(self, video_id: int, times: list[float], tree_id: Optional[str] = None,
                soil_manual: Optional[dict] = None, drone_mode: bool = False,
                upscale: Optional[bool] = None, compare: bool = False) -> dict:
        with self._lock:
            job = {
                "job_id": self._job_id,
                "video_id": video_id,
                "times": times,
                "tree_id": tree_id,
                "soil_manual": soil_manual,
                "drone_mode": drone_mode,
                "upscale": upscale,
                "compare": compare,
                "status": "queued",
                "enqueued_at": time.time(),
                "started_at": None,
                "finished_at": None,
                "result": None,
                "progress": 0.0,
                "error": None,
            }
            self._job_id += 1
            self._queue.append(job)
        self.store.update_video(video_id, status="processing")
        return job

    def jobs(self) -> list[dict]:
        with self._lock:
            now = time.time()
            self._recent = [j for j in self._recent if now - (j.get("finished_at") or now) <= 8]
            return list(self._queue) + list(self._active.values()) + self._recent

    def _loop(self):
        while True:
            job = None
            with self._lock:
                if self._queue:
                    job = self._queue.pop(0)
                    self._active[job["job_id"]] = job
            if job is None:
                time.sleep(1.0)
                continue
            self._process(job)
            with self._lock:
                self._active.pop(job["job_id"], None)
                self._recent.append(job)
                if len(self._recent) > 20:
                    self._recent = self._recent[-20:]

    def _process(self, job: dict):
        job["status"] = "processing"
        job["started_at"] = time.time()
        video = self.store.get_video(job["video_id"])
        if video is None:
            job["status"] = "error"
            job["error"] = "video record not found"
            job["finished_at"] = time.time()
            self.store.update_video(job["video_id"], status="error")
            return
        video_path = Path(video["storage_path"])
        if not video_path.exists():
            job["status"] = "error"
            job["error"] = "file missing"
            job["finished_at"] = time.time()
            self.store.update_video(job["video_id"], status="error")
            return
        grader = _grader()
        out_dir = STORAGE_DIR / str(job["video_id"])
        out_dir.mkdir(parents=True, exist_ok=True)
        requested_tree_id = job.get("tree_id")
        source = f"video#{job['video_id']}" + (f":{requested_tree_id}" if requested_tree_id else "")

        def _progress(done: int, total: int, label: str | None = None):
            job["progress"] = done / max(1, total)
            job["current"] = done
            job["total"] = total
            job["stage"] = "analyzing"
            job["current_label"] = label

        try:
            results = grader.analyze_video_at_times(
                str(video_path), job["times"], str(out_dir), source,
                drone_mode=bool(job.get("drone_mode")),
                upscale=job.get("upscale"),
                compare=bool(job.get("compare")),
                progress_cb=_progress,
            )
            job["stage"] = "saving"
            job["current_label"] = None
            saved = 0
            total = len(job["times"]) or 1
            manual = job.get("soil_manual")
            for idx, rec in enumerate(results, start=1):
                job["progress"] = min(0.95, idx / total)
                if not rec.get("ok"):
                    continue
                # Manually-specified tree id wins; otherwise keep the tree id
                # that olive-p recognised from a QR code in the frame.
                if requested_tree_id:
                    rec["tree_id"] = requested_tree_id
                elif not rec.get("tree_id"):
                    rec["tree_id"] = None
                rec["observed_at"] = _frame_observed_at(video, rec)
                target_dt = parse_observed_at_iso(rec.get("observed_at"))
                soil_data = build_soil_data(manual, target_time=target_dt)
                integrate_soil(rec, soil_data)
                rec["soil_source"] = soil_data.get("source", "none")
                rec["health_state"] = health_state(rec)
                try:
                    rec["explain_text"] = explain_detection_ja(rec)
                except Exception:
                    rec["explain_text"] = None
                # Store the frame paths as relative /storage/{video}/file URLs.
                for key in ("_frame_raw", "_frame_annotated"):
                    if rec.get(key):
                        p = Path(rec[key]).resolve()
                        try:
                            rel = p.relative_to(STORAGE_DIR.resolve())
                        except ValueError:
                            rel = Path(p.name)
                        rec[key + "_url"] = f"/storage/{rel.as_posix()}"
                self.store.add_observation("video", rec, video_id=job["video_id"])
                saved += 1
                # Store comparison (non-upscaled) observation alongside the main one
                comp = rec.pop("_comparison", None)
                if comp and comp.get("ok"):
                    comp["tree_id"] = rec.get("tree_id")
                    comp["observed_at"] = rec.get("observed_at")
                    comp["soil_moisture"] = rec.get("soil_moisture")
                    comp["soil_source"] = rec.get("soil_source")
                    comp["health_state"] = health_state(comp)
                    try:
                        comp["explain_text"] = explain_detection_ja(comp)
                    except Exception:
                        comp["explain_text"] = None
                    for key in ("_frame_raw", "_frame_annotated"):
                        if comp.get(key):
                            p = Path(comp[key]).resolve()
                            try:
                                rel = p.relative_to(STORAGE_DIR.resolve())
                            except ValueError:
                                rel = Path(p.name)
                            comp[key + "_url"] = f"/storage/{rel.as_posix()}"
                    self.store.add_observation("video", comp, video_id=job["video_id"])
                    saved += 1
            job["result"] = {
                "saved": saved,
                "requested": len(job["times"]),
                "labels": [r.get("label") for r in results if r.get("ok")],
            }
            job["status"] = "done"
            job["finished_at"] = time.time()
            job["progress"] = 1.0
            job["stage"] = None
            self.store.update_video(job["video_id"], status="done")
        except Exception as exc:  # pragma: no cover
            log.error("job failed: %s", traceback.format_exc())
            job["status"] = "error"
            job["error"] = f"{type(exc).__name__}: {exc}"
            job["stage"] = "error"
            job["finished_at"] = time.time()
            self.store.update_video(job["video_id"], status="error")
