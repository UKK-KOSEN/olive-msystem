"""Interpretation of olive-p analysis results into an olive-character state."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Optional

from .config import load_settings


def health_thresholds() -> dict:
    """Return the editable state boundaries {happy, good, caution} on 0..1."""
    return (load_settings().get("health_thresholds")
            or {"happy": 0.75, "good": 0.55, "caution": 0.35})


def overall_health_score(rec: dict) -> float:
    """Extract the composite 0..1 health score from a result record.

    When soil moisture data has been integrated, the combined visual+moisture
    score takes precedence; otherwise the visual stress score is used.
    """
    ha = rec.get("health_assessment") or {}
    combined = ha.get("combined_health_score")
    if combined is not None:
        return float(combined)
    if "overall_health_score" in rec and rec["overall_health_score"] is not None:
        return float(rec["overall_health_score"])
    details = rec.get("analysis_details") or {}
    stress = details.get("stress") or {}
    score = stress.get("overall_health_score")
    if score is not None:
        return float(score)
    return 0.5


def water_stress(rec: dict) -> Optional[float]:
    if "water_stress" in rec and rec["water_stress"] is not None:
        return float(rec["water_stress"])
    details = rec.get("analysis_details") or {}
    stress = details.get("stress") or {}
    ws = stress.get("water_stress")
    return float(ws) if ws is not None else None


def _parse_epoch(value) -> Optional[float]:
    """Best-effort parse of an ISO timestamp (with offset) to epoch seconds."""
    if not value:
        return None
    text = str(value).strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.astimezone()
        return dt.timestamp()
    except (TypeError, ValueError):
        return None


def _wt(days: float) -> float:
    """Recency weight: halves every 7 days (recent data dominates, all counts)."""
    return 2.0 ** (-max(0.0, days) / 7.0)


def aggregate_health_state(rows: list[dict]) -> Optional[dict]:
    """Score the olive's current health from *all* observation data.

    Each media (video/image) contributes its latest analysis once, then the
    scores are combined with a recency-weighted mean so the number reflects
    everything we know instead of a single snapshot. Also returns the trend
    and a concrete "what to do next" advice list.

    ``rows`` are observation dicts with a parsed ``result`` (as produced by
    ``Store.list_observations``).
    """
    if not rows:
        return None

    # One point per media: keep the newest observation (by id) per video/image.
    media: dict = {}
    for o in rows:
        if o.get("video_id") is not None:
            key = ("v", o["video_id"])
        else:
            key = ("i", o.get("image_id") or o.get("filename") or o.get("id"))
        if key not in media or (o.get("id") or 0) >= (media[key].get("id") or 0):
            media[key] = o

    pts = []
    now = time.time()
    for o in media.values():
        score = overall_health_score(o.get("result") or {})
        t = _parse_epoch(o.get("observed_at"))
        if t is None:
            t = now
        pts.append({"t": t, "score": score, "obs": o})
    if not pts:
        return None

    pts.sort(key=lambda p: p["t"])
    total_w = 0.0
    wsum = 0.0
    for p in pts:
        w = _wt((now - p["t"]) / 86400.0)
        total_w += w
        wsum += w * p["score"]
    score = wsum / total_w if total_w else pts[-1]["score"]

    # Trend: newer half vs older half (needs enough points to be meaningful).
    trend = "flat"
    if len(pts) >= 4:
        half = len(pts) // 2
        old = sum(p["score"] for p in pts[:half]) / half
        new = sum(p["score"] for p in pts[half:]) / (len(pts) - half)
        diff = new - old
        if diff >= 0.03:
            trend = "up"
        elif diff <= -0.03:
            trend = "down"

    latest = pts[-1]
    latest_result = latest["obs"].get("result") or {}
    ws = water_stress(latest_result)
    wrinkled = int(latest_result.get("wrinkled_fruit_count", 0) or 0)
    # Highest recent water-stress across the last few points (safety check).
    ws_recent = [water_stress(p["obs"].get("result") or {}) for p in pts[-3:]]
    ws_recent = [w for w in ws_recent if w is not None]

    th = health_thresholds()
    if score >= th["happy"]:
        label = "happy"
        message = "全体を通して良好な状態です。このままの管理を続けてください。"
    elif score >= th["good"]:
        label = "good"
        message = "概ね良好な状態です。週1回程度の観察を続けて水分管理を維持しましょう。"
    elif score >= th["caution"]:
        label = "caution"
        message = "総合的にやや低下しています。水やり・日陰・通風の状態を確認してください。"
    else:
        label = "danger"
        message = "総合的に低下しています。灌水・剪定・土壌水分の確認を早めに行ってください。"

    advice: list[str] = []
    if label == "happy":
        advice.append("特に問題ありません。定期的な解析を続けてください。")
    elif label == "good":
        advice.append("大きな対応は不要です。水分管理を継続してください。")
    elif label == "caution":
        advice.append("水やり・日陰・通風の状態を確認し、数日内に再観測してください。")
    else:
        advice.append("灌水・剪定・土壌水分の確認を最優先で行ってください。")

    if trend == "down":
        advice.append("スコアが低下傾向です。原因（水分不足・日当たり・病害）を確認してください。")
    elif trend == "up":
        advice.append("スコアは回復傾向です。この方針を継続してください。")
    if ws_recent and max(ws_recent) >= 0.4:
        advice.append("水分ストレスが高めです。早めの灌水を優先してください。")
    elif ws_recent and max(ws_recent) >= 0.2:
        advice.append("水分ストレスがややあります。灌水タイミングを確認してください。")
    if wrinkled:
        advice.append(f"しわ果が{wrinkled}個観測されています。果実の状態を確認してください。")

    return {
        "label": label,
        "score": round(max(0.0, min(1.0, score)), 3),
        "color": HEALTH_LABELS.get(label, {}).get("color", "#facc15"),
        "message": message,
        "water_stress": round(max(ws_recent), 3) if ws_recent else None,
        "wrinkled_fruit_count": wrinkled,
        "details": f"全{len(rows)}観測・{len(pts)}メディアの集計",
        "trend": trend,
        "advice": advice,
        "period_n": len(pts),
        "total_n": len(rows),
        "latest_score": round(latest["score"], 3),
        "latest_at": latest["obs"].get("observed_at"),
    }


def health_state(rec: dict) -> dict:
    """Map an analysis result to a character state + colour + message.

    Grades on the 0..1 overall health score. Boundaries are editable from the
    admin page and default to happy>=0.75, good>=0.55, caution>=0.35.
    """
    score = overall_health_score(rec)
    ws = water_stress(rec)
    wrinkled = int(rec.get("wrinkled_fruit_count", 0) or 0)
    th = health_thresholds()
    if score >= th["happy"]:
        label, color = "happy", "#4ade80"
        message = "元気に育っています。葉・果実とも良好な状態です。"
    elif score >= th["good"]:
        label, color = "good", "#a3e635"
        message = "概ね健康ですが、もう少し様子を見てください。"
    elif score >= th["caution"]:
        label, color = "caution", "#facc15"
        message = "水分・葉の状態に注意が必要です。水やりを確認しましょう。"
    else:
        label, color = "danger", "#f87171"
        message = "体調不良が疑われます。早めに潅水や環境の見直しをしてください。"
    extra = []
    if ws is not None:
        if ws >= 0.4:
            extra.append(f"水分ストレス: {ws:.2f}")
        else:
            extra.append(f"水分ストレス: 低い ({ws:.2f})")
    if wrinkled:
        extra.append(f"しわ果: {wrinkled}個")
    ha = rec.get("health_assessment") or {}
    if ha.get("moisture_message"):
        extra.append(ha["moisture_message"])
    return {
        "label": label,
        "score": round(score, 3),
        "color": color,
        "message": message,
        "water_stress": round(ws, 3) if ws is not None else None,
        "wrinkled_fruit_count": wrinkled,
        "details": " / ".join(extra) if extra else "指標は良好",
    }


HEALTH_LABELS = {
    "happy": {"svg": "happy.svg", "ja": "健康", "color": "#4ade80"},
    "good": {"svg": "good.svg", "ja": "良好", "color": "#a3e635"},
    "caution": {"svg": "caution.svg", "ja": "注意", "color": "#facc15"},
    "danger": {"svg": "danger.svg", "ja": "要管理", "color": "#f87171"},
}
