"""
olive-msystem processing queue.

Handles the "continuous upload" workflow: operators drop videos into a folder
(or through the API), the runner picks up each one, reads its duration, and
analyses it at the configured timestamps, storing results.

The runner runs as a background thread inside the FastAPI process.
"""
from __future__ import annotations

import functools
import logging
import threading
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .analyzer import OliveAnalyzer
from .translate_report import explain_detection_ja
from .config import STORAGE_DIR, WORKERS
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
    """Consumes a queue of (video_id, times) jobs in the background.

    The runner is built so a single failing job (or a transient DB error) can
    never terminate the background worker: each job is isolated with its own
    try/except, the worker loop catches everything, frames within a video are
    saved independently, and videos left ``processing`` by a previous crash
    are reset to ``error`` on startup so they can be re-queued.
    """

    def __init__(self, store: Store, workers: Optional[int] = None):
        self.store = store
        self.workers = workers or max(1, int(WORKERS))
        self._queue: list[dict] = []
        self._active: dict[int, dict] = {}
        self._recent: list[dict] = []
        self._lock = threading.Lock()
        self._job_id = 0
        self._stop = threading.Event()
        self.threads: list[threading.Thread] = []
        self._recover_stuck()
        for _ in range(self.workers):
            t = threading.Thread(target=self._loop, daemon=True)
            t.start()
            self.threads.append(t)

    def _recover_stuck(self) -> None:
        """Reset videos/images stuck in ``processing`` from a previous crash.

        The queue is in-memory, so after a restart nothing will ever complete
        those jobs; without this reset the rows would stay ``processing``
        forever and the "already being analysed" guard (409) would block
        re-analysis permanently.
        """
        try:
            for rec in self.store.list_videos(status="processing"):
                try:
                    self.store.update_video(rec["id"], status="error")
                    log.warning("recovered stuck video %s -> error", rec["id"])
                except Exception:
                    log.exception("failed to recover video %s", rec.get("id"))
            for rec in self.store.list_images():
                if rec.get("status") == "processing":
                    try:
                        self.store.update_image(rec["id"], status="error")
                        log.warning("recovered stuck image %s -> error", rec["id"])
                    except Exception:
                        log.exception("failed to recover image %s", rec.get("id"))
        except Exception:
            log.exception("runner startup recovery failed (non-fatal)")

    def stop(self) -> None:
        self._stop.set()

    def _enqueue_locked(self, video_id: int, times: list[float],
                        tree_id: Optional[str], soil_manual: Optional[dict],
                        drone_mode: bool, upscale: Optional[bool]) -> dict:
        with self._lock:
            job = {
                "job_id": self._job_id,
                "video_id": video_id,
                "times": times,
                "tree_id": tree_id,
                "soil_manual": soil_manual,
                "drone_mode": drone_mode,
                "upscale": upscale,
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
            return job

    def enqueue(self, video_id: int, times: list[float], tree_id: Optional[str] = None,
                soil_manual: Optional[dict] = None, drone_mode: bool = False,
                upscale: Optional[bool] = None) -> dict:
        job = self._enqueue_locked(video_id, times, tree_id, soil_manual,
                                   drone_mode, upscale)
        try:
            self.store.update_video(video_id, status="processing")
        except Exception:
            # The job stays queued even if the status write failed; the worker
            # still processes it and the row is updated again on completion.
            log.warning("could not mark video %s as processing (job queued anyway)",
                        video_id, exc_info=True)
        return job

    def jobs(self) -> list[dict]:
        with self._lock:
            now = time.time()
            self._recent = [j for j in self._recent if now - (j.get("finished_at") or now) <= 8]
            return list(self._queue) + list(self._active.values()) + self._recent

    def _loop(self):
        while not self._stop.is_set():
            try:
                job = None
                with self._lock:
                    if self._queue:
                        job = self._queue.pop(0)
                        self._active[job["job_id"]] = job
                if job is None:
                    time.sleep(1.0)
                    continue
                self._process(job)
            except Exception:  # pragma: no cover
                # The worker loop must survive anything; never let one bad job
                # terminate the thread that processes every later job.
                log.error("runner loop survived an exception: %s",
                          traceback.format_exc())
            finally:
                if job is not None:
                    try:
                        with self._lock:
                            self._active.pop(job["job_id"], None)
                            self._recent.append(job)
                            if len(self._recent) > 20:
                                self._recent = self._recent[-20:]
                    except Exception:  # pragma: no cover
                        pass

    def _process(self, job: dict):
        try:
            self._process_inner(job)
        except Exception as exc:  # pragma: no cover
            log.error("job %s failed: %s", job.get("video_id"),
                      traceback.format_exc())
            job["status"] = "error"
            job["error"] = f"{type(exc).__name__}: {exc}"
            job["stage"] = "error"
            job["finished_at"] = time.time()
            try:
                self.store.update_video(job["video_id"], status="error")
            except Exception:
                log.warning("could not mark video %s as error after failure",
                            job.get("video_id"))

    def _process_inner(self, job: dict):
        job["status"] = "processing"
        job["started_at"] = time.time()

        def _fail(reason: str) -> None:
            job["status"] = "error"
            job["error"] = reason
            job["stage"] = "error"
            job["finished_at"] = time.time()
            try:
                self.store.update_video(job["video_id"], status="error")
            except Exception:
                log.warning("could not mark video %s as error", job.get("video_id"))

        video = None
        try:
            video = self.store.get_video(job["video_id"])
        except Exception:
            log.exception("failed to read video record")
            _fail("database read failed")
            return
        if video is None:
            _fail("video record not found")
            return
        video_path = Path(video["storage_path"])
        if not video_path.exists():
            _fail("file missing")
            return

        requested_tree_id = job.get("tree_id")
        source = f"video#{job['video_id']}" + (f":{requested_tree_id}" if requested_tree_id else "")

        def _progress(done: int, total: int, label: str | None = None):
            job["progress"] = done / max(1, total)
            job["current"] = done
            job["total"] = total
            job["stage"] = "analyzing"
            job["current_label"] = label

        # The grader is a shared/lazy object; construction reads olive-p files
        # and can fail if olive-p is momentarily broken.
        try:
            grader = _grader()
            out_dir = STORAGE_DIR / str(job["video_id"])
            out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            log.exception("analysis engine unavailable")
            _fail(f"{type(exc).__name__}: {exc}")
            return

        results = []
        try:
            results = grader.analyze_video_at_times(
                str(video_path), job["times"], str(out_dir), source,
                drone_mode=bool(job.get("drone_mode")),
                upscale=job.get("upscale"),
                progress_cb=_progress,
            )
        except Exception:
            # Analysis itself broke (video corrupt, olive-p error, hang timeout).
            log.exception("video analysis failed")
            _fail("analysis failed")
            return
        job["stage"] = "saving"
        job["current_label"] = None
        saved = 0
        total = len(job["times"]) or 1
        manual = job.get("soil_manual")
        for idx, rec in enumerate(results, start=1):
            job["progress"] = min(0.95, idx / total)
            # One bad frame must never abort the whole job: save what we can.
            try:
                if not rec.get("ok"):
                    continue
                if requested_tree_id:
                    rec["tree_id"] = requested_tree_id
                elif not rec.get("tree_id"):
                    rec["tree_id"] = None
                rec["observed_at"] = _frame_observed_at(video, rec)
                target_dt = parse_observed_at_iso(rec.get("observed_at"))
                try:
                    soil_data = build_soil_data(manual, target_time=target_dt)
                    integrate_soil(rec, soil_data)
                    rec["soil_source"] = soil_data.get("source", "none")
                except Exception:
                    # Soil enrichment is optional; never lose the frame over it.
                    rec["soil_source"] = "error"
                rec["health_state"] = health_state(rec)
                try:
                    rec["explain_text"] = explain_detection_ja(rec)
                except Exception:
                    rec["explain_text"] = None
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
            except Exception:
                log.warning("frame %s skipped due to error: %s",
                            rec.get("label"), traceback.format_exc())
        job["result"] = {
            "saved": saved,
            "requested": len(job["times"]),
            "labels": [r.get("label") for r in results if r.get("ok")],
        }
        job["status"] = "done"
        job["finished_at"] = time.time()
        job["progress"] = 1.0
        job["stage"] = None
        try:
            self.store.update_video(job["video_id"], status="done")
        except Exception:
            log.warning("could not mark video %s as done after saving",
                        job.get("video_id"))
