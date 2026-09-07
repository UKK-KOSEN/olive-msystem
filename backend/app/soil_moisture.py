"""
Soil moisture integration for olive-msystem.

Two sources are supported:
  1. Automatic:  use olive-p's SoilMoistureClient to fetch live sensor data
                 from the UKK-KOSEN Cloudflare D1 API. Active only when a
                 soil_moisture.yaml config file exists.
  2. Manual:     the operator supplies sensor readings through the API; these
                 are run through the same moisture-health assessment.

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

import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

from .config import OLIVE_P_DIR, SOIL_MOISTURE_CONFIG_PATH


def parse_observed_at_iso(observed_at: Optional[str]) -> Optional[datetime]:
    """Parse ISO *observed_at* string to a naive local-time datetime.

    This is needed by ``get_moisture_at_time`` which expects a naive
    ``datetime`` in the local timezone.
    """
    if not observed_at:
        return None
    try:
        dt = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


def _import_olive_soil():
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
    config = SOIL_MOISTURE_CONFIG_PATH
    auto_ok = False
    data = None
    if config and config.exists():
        try:
            raw = yaml.safe_load(config.read_text(encoding="utf-8")) or {}
            client = sm.SoilMoistureClient(raw)
            if target_time is not None:
                data = client.get_moisture_at_time(target_time)
            else:
                data = client.get_latest()
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
    data = {
        "sensor1_moisture_percent": s1,
        "sensor2_moisture_percent": s2,
        "temperature": manual.get("temperature"),
        "humidity": manual.get("humidity"),
    }
    health = _health_of_client(sm, data)
    return {
        "source": "manual" if (s1 is not None or s2 is not None) else "none",
        "soil_moisture": {
            "sensor1_moisture_percent": s1,
            "sensor2_moisture_percent": s2,
            "temperature": manual.get("temperature"),
            "humidity": manual.get("humidity"),
            "measured_at": manual.get("measured_at"),
            "health": health,
        },
        "health": health,
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
