"""
Soil moisture integration for olive-msystem.

Two sources are supported:
  1. Automatic:  fetch sensor readings from the official UKK-KOSEN soil
                 moisture API (https://soil-moisture-pages-ddl.pages.dev)
                 using a Bearer API key.  Active only when a
                 soil_moisture.yaml config file exists.
  2. Manual:     the operator supplies sensor readings through the API; these
                 are run through the same moisture-health assessment.

The automatic fetcher is implemented here (not in olive-p) so it matches the
official API contract exactly:

  * Authorization: Bearer <API_KEY> (not X-Sensor-Api-Key).
  * /api/sensor/latest  -> single newest record.
  * /api/sensor/history -> {"data": [...]} newest-first.
  * /api/kits           -> {"data": [{kit_id, name}]}.

Both paths produce a dict compatible with
olive-p src.runtime.integrate_soil_moisture()::

    {
        "soil_moisture": {
            "sensor1_moisture_percent": ...,
            "sensor2_moisture_percent": ...,
            "temperature": ...,
            "humidity": ...,
            "measured_at": ...,
            "health": {"risk": ..., "message": ..., "weight": ..., "score": ...},
        }
    }
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import yaml

from .config import OLIVE_P_DIR, SOIL_MOISTURE_CONFIG_PATH

DEFAULT_BASE_URL = "https://soil-moisture-pages-ddl.pages.dev"


def parse_observed_at_iso(observed_at: Optional[str]) -> Optional[datetime]:
    """Parse an ISO *observed_at* string to a timezone-aware datetime (UTC-soon).

    The capture timestamp of a video frame / image.  Returns ``None`` when it
    cannot be parsed.
    """
    if not observed_at:
        return None
    try:
        dt = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
        return dt.astimezone()
    except (ValueError, TypeError):
        return None


def _parse_api_ts(value: Any) -> Optional[datetime]:
    """Parse a UTC ISO timestamp from the API (e.g. ``2026-09-01T03:00:00Z``)."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt
    except (ValueError, TypeError):
        return None


@dataclass
class SoilMoistureFetcher:
    """Minimal, official-spec client for the UKK-KOSEN soil moisture API."""

    base_url: str = DEFAULT_BASE_URL
    api_key: str = ""
    default_kit_id: str = "default"
    timeout: float = 10
    max_retries: int = 3
    _cache: dict = field(default_factory=dict)
    # --- access monitoring counters (class-level, shared) ---
    _req_count: int = 0
    _err_count: int = 0
    _last_req_at: Optional[str] = None
    _last_err_at: Optional[str] = None
    _last_err_msg: Optional[str] = None

    def get_access_stats(self) -> dict:
        return {
            "request_count": self._req_count,
            "error_count": self._err_count,
            "last_request_at": self._last_req_at,
            "last_error_at": self._last_err_at,
            "last_error_msg": self._last_err_msg,
        }

    def _get(self, endpoint: str, params: Optional[dict] = None) -> Any:
        if not self.api_key:
            raise RuntimeError("soil moisture API key is not configured")
        params = {k: v for k, v in (params or {}).items() if v is not None}
        url = self.base_url.rstrip("/") + endpoint
        if params:
            # Normalise kit id casing as the API does.
            query = urllib.parse.urlencode(params)
            url += "?" + query

        # Small TTL cache so repeated calls for the same endpoint reuse data.
        key = url + "|" + self.api_key
        cached = self._cache.get(key)
        if cached and time.time() - cached[0] < 60:
            return cached[1]

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Authorization": "Bearer " + self.api_key,
        }
        for attempt in range(self.max_retries):
            req = urllib.request.Request(url, headers=headers, method="GET")
            try:
                self._req_count += 1
                self._last_req_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    self._cache[key] = (time.time(), data)
                    return data
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < self.max_retries - 1:
                    wait = float(e.headers.get("Retry-After", "1") or 1)
                    time.sleep(min(wait, 10))
                    continue
                self._err_count += 1
                self._last_err_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                self._last_err_msg = f"HTTP {e.code}: {e.reason}"
                raise RuntimeError(f"API error {e.code}: {e.reason}") from e
            except urllib.error.URLError as e:
                if attempt < self.max_retries - 1:
                    time.sleep(0.5)
                    continue
                self._err_count += 1
                self._last_err_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                self._last_err_msg = f"Network: {e.reason}"
                raise RuntimeError(f"Network error: {e.reason}") from e
        raise RuntimeError("soil moisture API request failed")

    def get_latest(self, kit_id: Optional[str] = None) -> Optional[dict]:
        kit_id = (kit_id or self.default_kit_id).lower()
        return self._get("/api/sensor/latest", {"kit_id": kit_id})

    def get_history(
        self,
        kit_id: Optional[str] = None,
        hours: int = 24,
        interval: str = "",
        limit: int = 100,
    ) -> list[dict]:
        kit_id = (kit_id or self.default_kit_id).lower()
        params = {
            "kit_id": kit_id,
            "hours": str(hours),
            "limit": str(limit),
        }
        if interval:
            params["interval"] = interval
        result = self._get("/api/sensor/history", params)
        if isinstance(result, dict) and "data" in result:
            return result["data"]
        return result if isinstance(result, list) else []

    def get_kits(self) -> list[dict]:
        result = self._get("/api/kits")
        if isinstance(result, dict) and "data" in result:
            return result["data"]
        return result if isinstance(result, list) else []

    def get_latest_at(
        self,
        target_time: datetime,
        kit_id: Optional[str] = None,
        window_hours: float = 2.0,
    ) -> Optional[dict]:
        """Return the record whose timestamp is closest to ``target_time``.

        Fetches the recent history (a window around the capture time) and picks
        the record with the smallest absolute time difference.  This mirrors the
        old olive-p ``get_moisture_at_time`` behaviour but uses timestamps the
        official API actually returns.
        """
        kit_id = (kit_id or self.default_kit_id).lower()
        target_aware = target_time if target_time.tzinfo else target_time.astimezone()
        target_local = target_aware.astimezone().replace(tzinfo=None)
        start = target_local - timedelta(hours=window_hours)
        hours_back = max(1, int((datetime.now() - start).total_seconds() / 3600) + 1)

        try:
            records = self.get_history(
                kit_id=kit_id, hours=hours_back, limit=200
            )
        except Exception:
            return None
        if not records:
            return None

        best = None
        best_diff = timedelta(hours=999)
        for rec in records:
            ts = _parse_api_ts(rec.get("measured_at") or rec.get("timestamp"))
            if ts is None:
                continue
            local = ts.astimezone().replace(tzinfo=None)
            diff = abs(local - target_local)
            if diff < best_diff:
                best_diff = diff
                best = rec
        return best


def _load_auto_config() -> Optional[dict]:
    """Read soil_moisture.yaml (if it exists) and return its contents."""
    if not SOIL_MOISTURE_CONFIG_PATH.exists():
        return None
    try:
        raw = yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


_active_fetcher: Optional[SoilMoistureFetcher] = None


def _make_fetcher(config: Optional[dict]) -> SoilMoistureFetcher:
    global _active_fetcher
    config = config or {}
    # Prefer SOIL_API_KEY env var (official recommendation) over the yaml key,
    # so the secret never needs to be committed to the repository.
    api_key = config.get("api_key") or ""
    env_key = os.environ.get("SOIL_API_KEY") or ""
    if env_key:
        api_key = env_key
    _active_fetcher = SoilMoistureFetcher(
        base_url=config.get("api_base_url", DEFAULT_BASE_URL),
        api_key=api_key,
        default_kit_id=config.get("default_kit_id", "default"),
        timeout=float(config.get("timeout", 10)),
        max_retries=int(config.get("max_retries", 3)),
    )
    return _active_fetcher


def get_fetcher_stats() -> dict:
    """Return API access monitoring stats from the active fetcher."""
    if _active_fetcher is None:
        return {"request_count": 0, "error_count": 0, "last_request_at": None, "last_error_at": None, "last_error_msg": None}
    return _active_fetcher.get_access_stats()


def _import_olive_soil():
    """Import olive-p's soil_moisture module (for health assessment only)."""
    sys.path.insert(0, str(OLIVE_P_DIR))
    try:
        from src import soil_moisture as sm
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            f"Could not import olive-p soil_moisture module: {exc}"
        ) from exc
    return sm


def _health_of_client(sm, data: dict) -> dict:
    """Produce the {risk,message,weight,score} health assessment."""
    try:
        return sm.assess_moisture_health(data)
    except Exception:  # pragma: no cover
        return {"risk": "unknown", "message": "土壌水分データなし", "weight": 0.0, "score": 0.5}


def build_soil_data(manual: Optional[dict],
                    target_time: Optional[datetime] = None) -> dict:
    """Return a soil_data dict (auto-fetch, falling back to manual values).

    Args:
        manual: Optional operator-supplied readings:
            {sensor1_moisture_percent, sensor2_moisture_percent,
             temperature, humidity, measured_at}
        target_time: When provided, the soil moisture reading *closest* to
            this timestamp is used instead of the latest value.  This is
            the capture time of the video frame / image being analysed.
    """
    sm = _import_olive_soil()
    config = _load_auto_config()
    auto_ok = False
    data = None
    if config is not None:
        fetcher = _make_fetcher(config)
        try:
            if target_time is not None:
                data = fetcher.get_latest_at(target_time)
            else:
                data = fetcher.get_latest()
            if data:
                auto_ok = True
        except Exception:
            data = None
            auto_ok = False

    if auto_ok and data:
        health = _health_of_client(sm, data)
        s1 = data.get("sensor1_moisture_percent")
        s2 = data.get("sensor2_moisture_percent")
        return {
            "source": "api",
            "soil_moisture": {
                "sensor1_moisture_percent": s1,
                "sensor2_moisture_percent": s2,
                "temperature": data.get("temperature"),
                "humidity": data.get("humidity"),
                "measured_at": data.get("measured_at") or data.get("timestamp"),
                "health": health,
            },
            "health": health,
        }

    # ---- manual fallback --------------------------------------------------
    manual = manual or {}
    s1 = manual.get("sensor1_moisture_percent")
    s2 = manual.get("sensor2_moisture_percent")
    mdata = {
        "sensor1_moisture_percent": s1,
        "sensor2_moisture_percent": s2,
        "temperature": manual.get("temperature"),
        "humidity": manual.get("humidity"),
    }
    mhealth = _health_of_client(sm, mdata)
    return {
        "source": "manual" if (s1 is not None or s2 is not None) else "none",
        "soil_moisture": {
            "sensor1_moisture_percent": s1,
            "sensor2_moisture_percent": s2,
            "temperature": manual.get("temperature"),
            "humidity": manual.get("humidity"),
            "measured_at": manual.get("measured_at"),
            "health": mhealth,
        },
        "health": mhealth,
    }


def _import_olive_runtime():
    sys.path.insert(0, str(OLIVE_P_DIR))
    try:
        from src import runtime
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            f"Could not import olive-p runtime module: {exc}"
        ) from exc
    return runtime


def integrate(result: dict, soil_data: dict) -> dict:
    """Apply a soil_data dict to an analysis result (via olive-p helper)."""
    rt = _import_olive_runtime()
    return rt.integrate_soil_moisture(result, soil_data)
