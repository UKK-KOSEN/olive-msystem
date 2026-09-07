"""
Japanese translation layer for olive-p's explain_detection output.

The olive-p `explain_detection()` function returns a structured English text
with sections like SUMMARY, LEAF ANALYSIS, FRUIT ANALYSIS, etc.
This module translates the section headers, common keywords, and leaves
numeric values untouched.
"""
from __future__ import annotations

import re
from typing import Dict

# Section header translations
SECTION_HEADERS: Dict[str, str] = {
    "SUMMARY": "概要",
    "DETECTION PARAMETERS": "検出パラメータ",
    "LEAF ANALYSIS": "葉の分析",
    "FRUIT ANALYSIS": "果実の分析",
    "ENVIRONMENTAL DATA": "環境データ",
    "DETAILED ANALYSIS": "詳細分析",
    "DETECTION SUMMARY": "検出概要",
    "HEALTH ASSESSMENT": "健康評価",
    "HEALTH STATE": "体調判定",
    "IMAGE INFO": "画像情報",
    "PIPELINE DIAGNOSTICS": "処理診断",
    "QUALITY METRICS": "品質指標",
}

# Line-level keyword translations (applied to individual lines)
KEYWORD_TRANSLATIONS: Dict[str, str] = {
    # Leaf
    "Total leaves detected": "検出された葉の合計",
    "Leaf coverage": "葉の被覆率",
    "Green coverage": "緑被率",
    "Avg leaf area": "平均葉面積",
    "Mean leaf area": "平均葉面積",
    "Curled leaves": "反りのある葉",
    "Curled leaf percentage": "葉の反り率",
    "Leaf curl index": "葉カール指数",
    "Senescence level": "老化度",
    "Leaf color stage": "葉の色の段階",
    "Average leaf hue": "平均葉の色相",
    "Average leaf saturation": "平均葉の彩度",
    "Leaf roughness": "葉の粗糙度",
    "Leaf roughness index": "葉の粗糙度指数",
    "Leaf health": "葉の健康状態",
    "Leaf size distribution": "葉サイズ分布",
    "Leaf color distribution": "葉の色分布",
    "Mean saturation": "平均彩度",
    "Mean hue": "平均色相",
    "Color consistency": "色の均一性",
    "Leaf confidence": "葉の検出信頼度",
    "Total leaf area": "葉の合計面積",
    # Fruit
    "Total fruits detected": "検出された果実の合計",
    "Fruit count": "果実数",
    "Fruit coverage": "果実の被覆率",
    "Fruit maturity": "果実の成熟度",
    "Maturity breakdown": "成熟度の内訳",
    "Wrinkled fruits": "しわのある果実",
    "Wrinkle summary": "しわの状態",
    "Smooth": "滑らか",
    "Slightly wrinkled": "ややしわあり",
    "Wrinkled": "しわあり",
    "Heavily wrinkled": "しわが強い",
    "Unreliable wrinkle count": "不確実なしわ検出数",
    "Avg fruit area": "平均果実面積",
    "Average fruit area": "平均果実面積",
    "Fruit confidence": "果実の検出信頼度",
    "Total fruit area": "果実の合計面積",
    "Fruit cover percentage": "果実被覆率",
    "Average fruit hue": "平均果実の色相",
    # Health
    "Water stress": "水分ストレス",
    "Water stress index": "水分ストレス指数",
    "Health score": "健康スコア",
    "Overall health score": "総合健康スコア",
    "Overall health": "総合健康状態",
    "Curl factor": "カール係数",
    "Wrinkle factor": "シワ係数",
    "Green coverage factor": "緑被率ファクター",
    "Saturation factor": "彩度ファクター",
    "Chlorophyll proxy": "クロロフィル指標",
    # Environment
    "Soil moisture": "土壌水分",
    "Sensor 1": "センサー1",
    "Sensor 2": "センサー2",
    "Temperature": "気温",
    "Humidity": "湿度",
    "Soil status": "土壌状態",
    # General
    "healthy green": "健康な緑色",
    "senescence": "老化",
    "flat": "平坦",
    "curled": "反りあり",
    "black": "黒（完熟）",
    "green": "緑（未熟）",
    "purple": "紫色（中間）",
    "yellow": "黄色",
    "red": "赤",
    "Multi-signal detection": "マルチシグナル検出",
    "Single signal detection": "シングルシグナル検出",
    "multi_signal": "マルチシグナル",
    "single_signal": "シングルシグナル",
    "Resolution mode": "解像度モード",
    "Image dimensions": "画像サイズ",
    "Image width": "画像幅",
    "Image height": "画像高さ",
    "Blur level": "ぼやけレベル",
    "Blur score": "ぼやけスコア",
    "Blur score (higher is sharper)": "ぼやけスコア（高いほど鮮明）",
    "Upscale applied": "アップスケール適用",
    "No upscale": "アップスケールなし",
    "Tree ID": "木のID",
    # Warning / Note
    "WARNING": "注意",
    "NOTE": "補足",
    "Note": "補足",
    "Warning": "注意",
    "Low resolution": "低解像度",
    "Image is blurry": "画像がぼやけています",
    "Few leaves detected": "検出された葉が少ないです",
    "No leaves detected": "葉が検出されませんでした",
    "No fruits detected": "果実が検出されませんでした",
    "Result may be unreliable": "結果が不確実である可能性があります",
}

# Regex patterns for value lines (label: value)
# Pattern: "label : value" or "label: value"
LABEL_PATTERN = re.compile(
    r"^(.+?)\s*[:=]\s*(.+)$"
)

# Number/unit patterns to leave untouched
NUMBER_PATTERN = re.compile(
    r"[\d.]+(?:\s*(?:px|%|°C|deg|count|items?)?)?\b"
)


def translate_explain_text(english_text: str) -> str:
    """Translate olive-p's English explain_detection output to Japanese.

    Strategy:
    1. Translate section headers (ALL CAPS lines followed by === underline)
    2. Translate known keyword labels (left side of : separator)
    3. Leave numbers, technical values, and unknown lines as-is
    """
    if not english_text:
        return english_text

    lines = english_text.split("\n")
    translated_lines = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Skip separator lines (===, ---)
        if re.match(r"^[=\-]{10,}$", stripped):
            translated_lines.append(line)
            continue

        # Translate section headers (ALL CAPS, < 60 chars, no colon)
        if re.match(r"^[A-Z][A-Z ]{2,50}$", stripped):
            upper = stripped.upper()
            # Check if next line is separator (header pattern)
            next_is_sep = (
                i + 1 < len(lines) and re.match(r"^[=\-]{10,}$", lines[i + 1].strip())
            )
            if next_is_sep or upper in SECTION_HEADERS:
                translated = SECTION_HEADERS.get(upper, stripped)
                translated_lines.append(translated)
                continue

        # Translate known keywords in value lines
        translated_line = _translate_line(stripped)
        # Preserve original indentation
        indent = len(line) - len(line.lstrip())
        translated_lines.append(" " * indent + translated_line)

    return "\n".join(translated_lines)


def _translate_line(line: str) -> str:
    """Translate a single line, preserving numeric values."""
    if not line:
        return line

    # Try to match "label : value" pattern
    m = LABEL_PATTERN.match(line)
    if m:
        label, value = m.group(1).strip(), m.group(2).strip()
        # Translate the label part
        for en, ja in KEYWORD_TRANSLATIONS.items():
            if label.lower() == en.lower():
                return f"{ja} : {value}"
        # Partial match on label
        for en, ja in KEYWORD_TRANSLATIONS.items():
            if en.lower() in label.lower():
                return line  # Don't partially translate, keep original
        return line

    # For bullet points or standalone text
    for en, ja in KEYWORD_TRANSLATIONS.items():
        if line.strip().lower().startswith(en.lower()):
            rest = line.strip()[len(en):]
            return f"{ja}{rest}"

    return line


def explain_detection_ja(result: dict) -> str | None:
    """Generate a Japanese explanation from an analysis result dict.

    This generates a farmer-friendly Japanese report directly from the
    numeric result data, avoiding dependency on olive-p's English text.
    """
    try:
        import sys
        from .config import OLIVE_P_DIR
        sys.path.insert(0, str(OLIVE_P_DIR))
        from src.runtime import explain_detection
        english_text = explain_detection(result)
        return translate_explain_text(english_text) if english_text else None
    except Exception:
        # Fallback: generate a simple Japanese report from the result dict
        return _generate_simple_report(result)


def _generate_simple_report(result: dict) -> str:
    """Generate a simple Japanese report from result dict fields."""
    lines = []

    # Summary
    lines.append("概要")
    lines.append("=" * 30)

    hs = result.get("health_state") or {}
    score = hs.get("score", 0)
    label_ja = {"happy": "健康", "good": "良好", "caution": "注意", "danger": "要管理"}.get(
        hs.get("label", ""), "不明"
    )
    lines.append(f"体調判定 : {label_ja} (スコア {score:.2f})")
    lines.append(f"メッセージ : {hs.get('message', '—')}")

    # Leaves
    lines.append("")
    lines.append("葉の分析")
    lines.append("-" * 30)
    lines.append(f"検出された葉の数 : {result.get('leaf_count', 0)} 枚")
    gc = result.get("green_coverage")
    if gc is not None:
        lines.append(f"緑被率 : {gc:.1f}%")
    lines.append(f"葉カール指数 : {result.get('leaf_curl_index', 0):.3f}")
    lines.append(f"葉の色の段階 : {_translate_leaf_stage(result.get('leaf_color_stage', ''))}")
    ls = result.get("leaf_senescence")
    if ls is not None:
        lines.append(f"老化度 : {ls:.1f}%")
    lsat = result.get("leaf_avg_saturation")
    if lsat is not None:
        lines.append(f"平均彩度 : {lsat:.1f}")

    # Fruits
    lines.append("")
    lines.append("果実の分析")
    lines.append("-" * 30)
    lines.append(f"検出された果実の数 : {result.get('fruit_count', 0)} 個")
    fm = result.get("fruit_maturity", "")
    if fm:
        lines.append(f"成熟度 : {_translate_maturity(fm)}")
    ws = result.get("wrinkled_fruit_count", 0)
    lines.append(f"しわのある果実 : {ws} 個")
    fcp = result.get("fruit_cover_pct", 0)
    if fcp:
        lines.append(f"果実被覆率 : {fcp:.1f}%")

    # Health stress
    lines.append("")
    lines.append("健康評価")
    lines.append("-" * 30)
    details = result.get("analysis_details", {})
    stress = details.get("stress", {})
    if stress:
        ws_val = stress.get("water_stress")
        if ws_val is not None:
            lines.append(f"水分ストレス : {ws_val:.3f}")
        cf = stress.get("components", {})
        if cf:
            lines.append(f"カール係数 : {cf.get('curl_factor', 0):.3f}")
            lines.append(f"シワ係数 : {cf.get('wrinkle_factor', 0):.3f}")
            lines.append(f"緑被率ファクター : {cf.get('green_coverage_factor', 0):.3f}")
            lines.append(f"彩度ファクター : {cf.get('saturation_factor', 0):.3f}")
        ohs = stress.get("overall_health_score")
        if ohs is not None:
            lines.append(f"総合健康スコア : {ohs:.3f}")

    # Warnings
    lines.append("")
    lc = result.get("leaf_count", 0)
    fc = result.get("fruit_count", 0)
    if lc == 0:
        lines.append("注意 : 葉が検出されませんでした。画像の角度や明るさを調整して再撮影してください。")
    elif lc < 2:
        lines.append("補足 : 検出された葉が少ないです。結果の信頼度が低くなる場合があります。")
    if gc is not None and gc < 5:
        lines.append("補足 : 緑被率が低いです。植物が画像全体に収まっていない可能性があります。")

    return "\n".join(lines)


def _translate_leaf_stage(stage: str) -> str:
    mapping = {
        "healthy_green": "健康な緑色",
        "yellowing": "黄色化",
        "senescent": "老化",
        "dry": "乾燥",
        "young": "若い葉",
    }
    return mapping.get(stage, stage or "—")


def _translate_maturity(maturity: str) -> str:
    mapping = {
        "green": "未熟（緑）",
        "purple": "中間（紫色）",
        "black": "完熟（黒）",
        "yellow": "黄色",
    }
    return mapping.get(maturity, maturity or "—")
