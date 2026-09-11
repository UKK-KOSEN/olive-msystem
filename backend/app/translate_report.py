"""
Japanese translation layer for olive-p's explain_detection output.

olive-p generates a structured English report via ``src.runtime.explain_detection``.
This module translates that report into Japanese while keeping every number,
measurement and detected object intact.  Each known sentence template is mapped
to a full-line rule; lines that do not match any template are left untouched,
so a future olive-p change degrades gracefully instead of corrupting output.
"""
from __future__ import annotations

import re
from typing import Callable, Dict

# ---------------------------------------------------------------------------
# Word-level dictionaries
# ---------------------------------------------------------------------------

_PIPELINES: Dict[str, str] = {
    "multi_signal": "マルチシグナル",
    "single_signal": "シングルシグナル",
}

_CONFIDENCE_LABELS: Dict[str, str] = {
    "high": "高",
    "moderate": "中程度",
    "low": "低",
}

_SIGNAL_STRENGTHS: Dict[str, str] = {
    "strong": "強い",
    "moderate": "中程度",
    "weak": "弱い",
}

_SIGNAL_LABELS: Dict[str, str] = {
    "yellow-green colour": "黄緑色",
    "ripe colour": "成熟色",
    "dark/over-ripe colour": "濃色・完熟色",
    "round Hough circle": "ハフ円（円形検出）",
}

_LEAF_STAGES: Dict[str, str] = {
    "healthy_green": "健康な緑",
    "dark_green": "濃い緑",
    "green": "緑",
    "yellow_green": "黄緑",
    "yellow": "黄",
    "senescent": "老化",
    "dry": "乾燥",
    "unknown": "不明",
}

_MATURITIES: Dict[str, str] = {
    "green": "緑（未熟）",
    "yellow_green": "黄緑（やや熟）",
    "purple": "紫（中間）",
    "black": "黒（完熟）",
    "yellow": "黄",
    "unknown": "不明",
}

_WRINKLES: Dict[str, str] = {
    "smooth": "滑らか",
    "slightly_wrinkled": "ややシワあり",
    "wrinkled": "シワあり",
    "heavily_wrinkled": "シワが強い",
}

_ZONES: Dict[str, str] = {
    "top-left": "左上",
    "top-right": "右上",
    "top centre": "中央上",
    "middle-left": "左中央",
    "middle-right": "右中央",
    "middle centre": "中央",
    "bottom-left": "左下",
    "bottom-right": "右下",
    "bottom centre": "中央下",
}


def _translate_maturity(maturity: str) -> str:
    return _MATURITIES.get(maturity, maturity)


def _translate_leaf_stage(stage: str) -> str:
    return _LEAF_STAGES.get(stage, stage)


def _translate_wrinkle(wrinkle: str) -> str:
    return _WRINKLES.get(wrinkle, wrinkle)


def _translate_pipeline(pipeline: str) -> str:
    return _PIPELINES.get(pipeline, pipeline)


def _lookup(mapping: Dict[str, str], value: str, fallback: str = "") -> str:
    return mapping.get(value, value if value else fallback)


# ---------------------------------------------------------------------------
# Full-line template rules
# ---------------------------------------------------------------------------

_RULES: list[tuple[re.Pattern, Callable]] = []


def _rule(pattern: str, replacer: Callable, flags: int = 0) -> None:
    _RULES.append((re.compile(pattern, flags), replacer))


def _section_title(title: str) -> Callable:
    def replacer(match: re.Match) -> str:
        return title
    return replacer


# Section headers
_rule(r"(?m)^DETECTION EXPLANATION$", _section_title("検出の説明"))
_rule(r"(?m)^SUMMARY$", _section_title("概要"))
_rule(r"(?m)^DETAILED ANALYSIS$", _section_title("詳細分析"))


def _intro(match: re.Match) -> str:
    w, h, mode = match.group(1), match.group(2), match.group(3)
    size = f"{w}x{h} の画像" if w != "None" and h != "None" else "画像（サイズ不明）"
    return f"{size}を「{_translate_pipeline(mode)}」パイプラインで解析しました。"


_rule(r"(?m)^Analysed a (.+?)x(.+?) image using the '([^']+)' pipeline\.$", _intro)


def _very_blurry(match: re.Match) -> str:
    return (
        f"警告: 画像は非常にぼやけています（ぼやけ指標 {match.group(1)}）。"
        "ぼやけの影響でエッジの情報が弱まるため、アンシャープマスクによる補正を適用し、"
        "エッジ位置補正は省略して色の一貫性を重視しました。"
    )


_rule(
    r"(?m)^WARNING: the frame is very blurry \(Laplacian variance ([\d.]+)\)\. "
    r"Blur weakens edge evidence, so the pipeline applied unsharp-mask deblurring, "
    r"skipped edge-snapping refinement, and relied more on colour consistency than edges\.$",
    _very_blurry,
)


def _moderate_blurry(match: re.Match) -> str:
    return (
        f"補足: 画像はややぼやけています（ぼやけ指標 {match.group(1)}）。"
        "信頼度の算出ではエッジの情報を低く評価しました。"
    )


_rule(
    r"(?m)^NOTE: the frame is moderately blurry \(Laplacian variance ([\d.]+)\)\. "
    r"Edge evidence was down-weighted in confidence scoring\.$",
    _moderate_blurry,
)


def _sharp(match: re.Match) -> str:
    return (
        f"画像は鮮明です（ぼやけ指標 {match.group(1)}）。"
        "エッジの一致度を信頼度の根拠として使用しました。"
    )


_rule(
    r"(?m)^The frame is sharp \(Laplacian variance ([\d.]+)\), "
    r"so edge alignment was a trusted signal for confidence\.$",
    _sharp,
)


def _detected_kind(kind_ja: str, note_ja: str) -> Callable:
    def replacer(match: re.Match) -> str:
        return f"- {kind_ja}: {match.group(1)} 個検出（{note_ja}）。"
    return replacer


_rule(
    r"(?m)^- Leaves: (\d+) object\(s\) detected "
    r"\(leaf hue/saturation range \+ vegetation-index agreement \+ size/shape tests\)\.$",
    _detected_kind("葉", "葉の色相・彩度の範囲と植生指数の一致、サイズ・形状テストによる判定"),
)
_rule(
    r"(?m)^- Fruits: (\d+) object\(s\) detected "
    r"\(yellow-green/ripe HSV bands \+ LAB b-channel \+ size/shape/circularity tests\)\.$",
    _detected_kind("果実", "黄緑色・成熟色のHSV帯とLAB bチャンネル、サイズ・形状・円形度テストによる判定"),
)


def _none_satisfied(kind_ja: str) -> Callable:
    def replacer(_match: re.Match) -> str:
        return f"  最小面積・形状・色のテストを満たす{kind_ja}がなく、検出結果はありません。"
    return replacer


_rule(
    r"(?m)^  No leaves passed the minimum area/shape/colour tests, "
    r"so the mask had nothing to report\.$",
    _none_satisfied("葉"),
)
_rule(
    r"(?m)^  No fruits passed the minimum area/shape/colour tests, "
    r"so the mask had nothing to report\.$",
    _none_satisfied("果実"),
)


def _frame_position(match: re.Match) -> str:
    indent, num = match.group(1), match.group(2)
    if match.group(3) is not None:
        x, y = match.group(3), match.group(4)
        where = f"（座標 {x},{y}）"
    else:
        where = ""
    position = match.group(5)
    if position == "position unknown.":
        return f"{indent}#{num}{where} 位置不明。"
    return f"{indent}#{num}{where} {_translate_position_text(position)}"


def _translate_position_text(text: str) -> str:
    m = re.match(
        r"^([a-z]+(?:-[a-z]+| centre)) of the frame \(x (-?[\d.]+)%, y (-?[\d.]+)%\)(.*)\.$",
        text,
    )
    if not m:
        return text
    zone = _lookup(_ZONES, m.group(1), m.group(1))
    px, py = m.group(2), m.group(3)
    edge = m.group(4)
    suffix = "（フレーム端に接しているため一部が切れています）" if edge else ""
    return f"フレーム{zone}（x {px}%、y {py}%）{suffix}"


_rule(
    r"(?m)^(\s*)#(\d+)(?: at \((-?\d+),(-?\d+)\))?\s*(.+\.)$",
    _frame_position,
)


def _area_confidence(match: re.Match) -> str:
    indent, area, conf = match.group(1), match.group(2), match.group(3)
    label = _lookup(_CONFIDENCE_LABELS, match.group(4), match.group(4))
    return f"{indent}面積 {area}px、信頼度 {conf}%（{label}）。"


_rule(r"(?m)^(\s*)area=(-?\d+)px, confidence ([\d.]+)%? \(([a-z]+)\)\.$", _area_confidence)


def _signals(match: re.Match) -> str:
    indent = match.group(1)
    parts = [_translate_signal_item(p.strip()) for p in match.group(2).split(";")]
    return f"{indent}シグナル: {'; '.join(parts)}"


_SIGNAL_RE = re.compile(
    r"^(?P<label>.+?) (?P<value>[\d.]+) "
    r"\((?:threshold (?P<thr>[\d.]+)\) -> (?P<strength>[a-z]+)"
    r"|below threshold (?P<below>[\d.]+)\))$"
)


def _translate_signal_item(item: str) -> str:
    m = _SIGNAL_RE.match(item)
    if not m:
        return item
    label = _lookup(_SIGNAL_LABELS, m.group("label"), m.group("label"))
    value = m.group("value")
    if m.group("strength"):
        strength = _lookup(_SIGNAL_STRENGTHS, m.group("strength"), m.group("strength"))
        return f"{label} {value}（基準 {m.group('thr')}）→ {strength}"
    return f"{label} {value}（基準 {m.group('below')} 未満）"


_rule(r"(?m)^(\s*)signals: (.*)$", _signals)


def _shape_tests(match: re.Match) -> str:
    indent = match.group(1)
    parts = [_translate_shape_item(p.strip()) for p in match.group(2).split(";")]
    return f"{indent}形状・表面テスト合格: {'; '.join(parts)}"


_SHAPE_RE = re.compile(
    r"^(?:size (-?\d+)px \(allowed (-?\d+)-(-?\d+)\)"
    r"|circularity ([\d.]+) \(need >= ([\d.]+)\)( - MARGINAL)?"
    r"|solidity ([\d.]+) \(need >= ([\d.]+)\)"
    r"|ellipse axis ratio ([\d.]+) \(need <= ([\d.]+)\)"
    r"|surface smoothness ([\d.]+) \(need <= ([\d.]+), lower is smoother\))$"
)


def _translate_shape_item(item: str) -> str:
    m = _SHAPE_RE.match(item)
    if not m:
        return item
    if m.group(1) is not None:
        return f"サイズ {m.group(1)}px（許容 {m.group(2)}〜{m.group(3)}px）"
    if m.group(4) is not None:
        suffix = "（僅差）" if m.group(6) else ""
        return f"円形度 {m.group(4)}（基準 ≥ {m.group(5)}）{suffix}"
    if m.group(7) is not None:
        return f"充実度 {m.group(7)}（基準 ≥ {m.group(8)}）"
    if m.group(9) is not None:
        return f"楕円軸比 {m.group(9)}（基準 ≤ {m.group(10)}）"
    return f"表面の滑らかさ {m.group(11)}（基準 ≤ {m.group(12)}、低いほど滑らか）"


_rule(r"(?m)^(\s*)shape/surface tests passed: (.*)$", _shape_tests)


def _why(match: re.Match) -> str:
    indent = match.group(1)
    body = match.group(2).rstrip(".")
    parts = [_translate_reason(p.strip()) for p in body.split(";")]
    return f"{indent}理由: {'; '.join(parts)}。"


_REASON_RE = re.compile(
    r"^(?:colour is uniform within the region \(consistency ([\d.]+)\)"
    r"|colour is somewhat uniform \(consistency ([\d.]+)\)"
    r"|boundary aligns with real image edges \(edge density ([\d.]+)\)"
    r"|boundary partially follows image edges \(edge density ([\d.]+)\)"
    r"|shape is elongated like a leaf \(aspect ([\d.]+)\))$"
)


def _translate_reason(reason: str) -> str:
    if reason == "matched the leaf colour/vegetation-index bands.":
        return "葉の色・植生指数の帯域に一致しました。"
    m = _REASON_RE.match(reason)
    if not m:
        return reason
    if m.group(1) is not None:
        return f"領域内の色が一様（整合度 {m.group(1)}）"
    if m.group(2) is not None:
        return f"領域内の色がやや一様（整合度 {m.group(2)}）"
    if m.group(3) is not None:
        return f"境界が実際の画像エッジと一致（エッジ密度 {m.group(3)}）"
    if m.group(4) is not None:
        return f"境界が画像エッジに部分的に一致（エッジ密度 {m.group(4)}）"
    return f"葉のように細長い形状（縦横比 {m.group(5)}）"


_rule(r"(?m)^(\s*)why: (.*)$", _why)


def _caution(_match: re.Match) -> str:
    return "  注意: この領域を裏付ける強いシグナルがなかったため、信頼度を半分にしました。"


_rule(
    r"(?m)^(\s*)caution: no strong signal backed this blob, "
    r"so its confidence was halved$",
    _caution,
)


def _rescue_path(_match: re.Match) -> str:
    return (
        "  検出経路: ハフ円が重ならず、丸く滑らかな果実サイズの形状のみで判定"
        "（自己判定による救済）。"
    )


_rule(
    r"(?m)^(\s*)detection path: no Hough circle overlapped it, "
    r"so it was kept only by its round, smooth, fruit-sized shape "
    r"\(self-evident rescue\)$",
    _rescue_path,
)


def _boosted_path(_match: re.Match) -> str:
    return "  検出経路: ハフ円が領域に重なったため、葉に囲まれていても円形の果実として判定しました。"


_rule(
    r"(?m)^(\s*)detection path: a Hough circle overlapped the blob, "
    r"so it was boosted as a round fruit even where foliage surrounds it$",
    _boosted_path,
)


def _colour_classified(match: re.Match) -> str:
    indent, maturity, hue = match.group(1), match.group(2), match.group(3)
    return f"{indent}色分類: {_translate_maturity(maturity)}の果実（色相 {hue}）。"


_rule(
    r"(?m)^(\s*)colour classified as a ([a-z_]+) fruit \(hue ([\d.]+)\)\.$",
    _colour_classified,
)


def _surface(match: re.Match) -> str:
    indent, wrinkle, score = match.group(1), match.group(2), match.group(3)
    return f"{indent}表面の状態: {_translate_wrinkle(wrinkle)}（シワスコア {score}）。"


_rule(
    r"(?m)^(\s*)surface shows ([a-z_]+) texture \(wrinkle score ([\d.]+)\)\.$",
    _surface,
)


def _green_coverage(match: re.Match) -> str:
    gc, stage, sens, mat = match.groups()
    return (
        f"  葉の被覆率: フレーム全体の {gc}%。"
        f"葉の色: 「{_translate_leaf_stage(stage)}」（老化度 {sens}）、"
        f"果実の成熟度: 「{_translate_maturity(mat)}」。"
    )


_rule(
    r"(?m)^  Green coverage is ([\d.]+)% of the frame; leaf colour classified as '([^']+)' "
    r"\(senescence '([^']+)'\) and fruit maturity as '([^']+)'\.$",
    _green_coverage,
)


def _pct_breakdown(match: re.Match, mapping: Dict[str, str], label_ja: str) -> str:
    raw = match.group(1)
    parts = []
    for item in raw.split(","):
        item = item.strip()
        m = re.match(r"^(\d+) ([a-z_]+)$", item)
        if m:
            parts.append(f"{_lookup(mapping, m.group(2), m.group(2))} {m.group(1)} 個")
        else:
            parts.append(item)
    return f"  {label_ja}: {'、'.join(parts)}。"


def _maturity_breakdown(match: re.Match) -> str:
    return _pct_breakdown(match, _MATURITIES, "果実の成熟度内訳")


_rule(r"(?m)^  Fruit maturity breakdown: (.+)\.$", _maturity_breakdown)


def _wrinkle_breakdown(match: re.Match) -> str:
    return _pct_breakdown(match, _WRINKLES, "果実の表面状態内訳")


_rule(r"(?m)^  Fruit wrinkle breakdown: (.+)\.$", _wrinkle_breakdown)


def _cover(match: re.Match) -> str:
    pct, total = match.group(1), match.group(2)
    return f"  果実マスクの被覆: フレーム全体の {pct}%（合計 {total}px）。"


_rule(r"(?m)^  Fruit mask covers ([\d.]+)% of the frame \((-?\d+) px in total\)\.$", _cover)


def _unreliable(match: re.Match) -> str:
    return f"  （物体が小さく、{match.group(1)} 件の表面状態の判定は信頼性が低いです）"


_rule(r"(?m)^  \((-?\d+) wrinkle label\(s\) unreliable due to small object size\)$", _unreliable)


def _curl(match: re.Match) -> str:
    return f"  葉のカール指数: {match.group(1)}（葉の {match.group(2)}% が 0.25 以上カール）"


_rule(
    r"(?m)^  Leaf curl index: ([\d.]+)  \(([\d.]+)% of leaves curled ≥0\.25\)$",
    _curl,
)

# --- Detailed analysis -----------------------------------------------------

def _leaves_detail(match: re.Match) -> str:
    g, y, mh, sh = match.groups()
    return f"  葉: 緑 {g}%、黄 {y}%（色相平均 {mh}、標準偏差 {sh}）"


_rule(
    r"(?m)^  Leaves: ([\d.]+)% green, ([\d.]+)% yellow  "
    r"\(hue μ=([\d.]+) σ=([\d.]+)\)$",
    _leaves_detail,
)


def _leaf_size(match: re.Match) -> str:
    s1, s2, s3, ma, med = match.groups()
    return f"    サイズ: 小 {s1}・中 {s2}・大 {s3}（面積平均 {ma}、中央値 {med}）"


_rule(
    r"(?m)^    size: (\d+) small, (\d+) medium, (\d+) large  "
    r"\(area μ=(-?\d+) median=(-?\d+)\)$",
    _leaf_size,
)


def _orientation(match: re.Match) -> str:
    ma, sa, d = match.groups()
    return f"    向き: 角度平均 {ma}°（標準偏差 {sa}°）、下垂 {d}%"


_rule(
    r"(?m)^    orientation: angle μ=([\d.]+)° σ=([\d.]+)°  drooping=([\d.]+)%$",
    _orientation,
)


def _fruits_detail(match: re.Match) -> str:
    s1, s2, s3, ma, sa = match.groups()
    return f"  果実: 小 {s1}・中 {s2}・大 {s3}（面積平均 {ma}、標準偏差 {sa}）"


_rule(
    r"(?m)^  Fruits: (\d+) small, (\d+) medium, (\d+) large  "
    r"\(area μ=(-?\d+) σ=(-?\d+)\)$",
    _fruits_detail,
)


def _pct_list(match: re.Match, mapping: Dict[str, str], label_ja: str) -> str:
    indent = match.group(1)
    raw = match.group(2)
    parts = []
    for item in raw.split(","):
        item = item.strip()
        m = re.match(r"^([\d.]+)% ([a-z_]+)$", item)
        if m:
            parts.append(f"{_lookup(mapping, m.group(2), m.group(2))} {m.group(1)}%")
        else:
            parts.append(item)
    return f"{indent}{label_ja}: {'、'.join(parts)}"


def _maturity_pct(match: re.Match) -> str:
    return _pct_list(match, _MATURITIES, "成熟度")


_rule(r"(?m)^(\s*)maturity: (.+)$", _maturity_pct)


def _wrinkle_pct(match: re.Match) -> str:
    return _pct_list(match, _WRINKLES, "表面状態")


_rule(r"(?m)^(\s*)wrinkle: (.+)$", _wrinkle_pct)


def _canopy(match: re.Match) -> str:
    f, t, mid, b = match.groups()
    return f"  樹冠: 被覆率 {f}%、分布: 上 {t}%・中 {mid}%・下 {b}%"


_rule(
    r"(?m)^  Canopy: ([\d.]+)% full  distribution: top=(\d+)% mid=(\d+)% bottom=(\d+)%$",
    _canopy,
)


def _light(match: re.Match) -> str:
    return f"    光の透過率: {match.group(1)}、葉の明るさ: {match.group(2)}"


_rule(r"(?m)^    light penetration: ([\d.]+)  leaf brightness: ([\d.]+)$", _light)


def _health(match: re.Match) -> str:
    o, ws, ch = match.groups()
    return f"  健康状態: 総合 {o}、水分ストレス {ws}、クロロフィル {ch}"


_rule(
    r"(?m)^  Health: overall=([\d.]+)  water_stress=([\d.]+)  chlorophyll=([\d.]+)$",
    _health,
)


def _factors(match: re.Match) -> str:
    g, c, w, s = match.groups()
    return f"    因子: 緑 {g}・カール {c}・シワ {w}・彩度 {s}"


_rule(
    r"(?m)^    factors: green=([\d.]+) curl=([\d.]+) wrinkle=([\d.]+) saturation=([\d.]+)$",
    _factors,
)


def _leaf_low_conf(_match: re.Match) -> str:
    return (
        "  葉の検出信頼度が低いです。より明るく鮮明な画像、または背景除去モード"
        "（kmeans/grabcut）で撮影してください。"
    )


_rule(
    r"(?m)^  Leaf detections are low-confidence: try brighter or sharper images, "
    r"or a foreground-aware mode \(kmeans/grabcut\) to remove background\.$",
    _leaf_low_conf,
)


def _fruit_low_conf(_match: re.Match) -> str:
    return "  果実の検出信頼度が低いです。ズームやピント調整、検出モードの変更をご検討ください。"


_rule(
    r"(?m)^  Fruit detections are low-confidence: consider more zoom, better focus, "
    r"or switching the detection mode\.$",
    _fruit_low_conf,
)


def _nothing(match: re.Match) -> str:
    return (
        "  何も検出されませんでした。考えられる原因: 画像の強いぼやけ、コントラスト不足、"
        "背景マスクの適用過剰、カメラに合わない閾値設定。"
    )


_rule(
    r"(?m)^  Nothing was detected\. Common causes: very blurry frame, low contrast, "
    r"background masking too aggressive, or thresholds mismatched to this camera\.$",
    _nothing,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_lowercases = {
    "green": "緑",
    "small": "小",
    "medium": "中",
    "large": "大",
}


def translate_explain_text(english_text: str) -> str:
    """Translate olive-p's English explain_detection output to Japanese.

    Known sentence templates are replaced line by line.  Lines that do not
    match any template are returned unchanged, so the output never drops or
    corrupts data even when olive-p adds new wording.
    """
    if not english_text:
        return english_text
    translated = english_text
    for pattern, replacer in _RULES:
        translated = pattern.sub(replacer, translated)
    return translated


def explain_detection_ja(result: dict) -> str | None:
    """Produce a Japanese explanation for an analysis result.

    Prefers translating olive-p's full prose report verbatim; falls back to a
    compact Japanese summary when the report cannot be generated.
    """
    try:
        from .analyzer import explain_detection as _olive_explain
        raw = _olive_explain(result)
    except Exception:
        return _generate_simple_report(result)
    try:
        translated = translate_explain_text(raw)
    except Exception:
        return _generate_simple_report(result)
    return translated


# ---------------------------------------------------------------------------
# Fallback: compact summary report
# ---------------------------------------------------------------------------

def _generate_simple_report(result: dict) -> str:
    """Generate a simple Japanese report from result dict fields."""
    lines = []

    # Summary
    lines.append("■ 概要")
    lines.append("")

    hs = result.get("health_state") or {}
    score = hs.get("score", 0)
    label_ja = {"happy": "健康", "good": "良好", "caution": "注意", "danger": "要管理"}.get(
        hs.get("label", ""), "不明"
    )
    lines.append(f"体調判定 : {label_ja}（スコア {score:.2f}）")
    msg = hs.get("message")
    if msg:
        lines.append(f"メッセージ : {msg}")

    # Detection mode / resolution
    pipeline = result.get("pipeline") or result.get("analysis_details", {}).get("pipeline", "")
    if pipeline:
        lines.append(f"解析方式 : {_translate_pipeline(pipeline)}")
    if result.get("upscaled"):
        model = result.get("upscale_model") or "realesrgan-x4plus"
        lines.append(f"高解像度化 : あり（{model}）")

    # Leaves
    lines.append("")
    lines.append("■ 葉の分析")
    lc = result.get("leaf_count", 0)
    lines.append(f"検出数 : {lc} 枚")
    gc = result.get("green_coverage")
    if gc is not None:
        lines.append(f"緑被率 : {gc:.1f}%")
    lines.append(f"カール指数 : {result.get('leaf_curl_index', 0):.3f}")
    stage = result.get("leaf_color_stage", "")
    if stage:
        lines.append(f"色の段階 : {_translate_leaf_stage(stage)}")
    ls = result.get("leaf_senescence")
    if ls is not None:
        lines.append(f"老化度 : {ls:.1f}%")
    lsat = result.get("leaf_avg_saturation")
    if lsat is not None:
        lines.append(f"平均彩度 : {lsat:.1f}")

    # Fruits
    lines.append("")
    lines.append("■ 果実の分析")
    fc = result.get("fruit_count", 0)
    lines.append(f"検出数 : {fc} 個")
    fm = result.get("fruit_maturity", "")
    if fm:
        lines.append(f"成熟度 : {_translate_maturity(fm)}")
    ws = result.get("wrinkled_fruit_count", 0)
    if ws:
        lines.append(f"しわのある果実 : {ws} 個")
    fcp = result.get("fruit_cover_pct", 0)
    if fcp:
        lines.append(f"果実被覆率 : {fcp:.1f}%")

    # Health stress
    lines.append("")
    lines.append("■ 健康評価")
    details = result.get("analysis_details", {})
    stress = details.get("stress", {})
    if stress:
        ohs = stress.get("overall_health_score")
        if ohs is not None:
            lines.append(f"総合健康スコア : {ohs:.3f}")
        ws_val = stress.get("water_stress")
        if ws_val is not None:
            lines.append(f"水分ストレス : {ws_val:.3f}")
        cf = stress.get("components", {})
        if cf:
            lines.append(f"カール係数 : {cf.get('curl_factor', 0):.3f}")
            lines.append(f"シワ係数 : {cf.get('wrinkle_factor', 0):.3f}")
            lines.append(f"緑被率ファクター : {cf.get('green_coverage_factor', 0):.3f}")
            lines.append(f"彩度ファクター : {cf.get('saturation_factor', 0):.3f}")
    else:
        overall = result.get("overall_health_score")
        if overall is not None:
            lines.append(f"総合健康スコア : {overall:.3f}")
        ws_val = result.get("water_stress")
        if ws_val is not None:
            lines.append(f"水分ストレス : {ws_val:.3f}")

    # Warnings
    warnings = []
    if lc == 0:
        warnings.append("注意 : 葉が検出されませんでした。画像の角度や明るさを調整して再撮影してください。")
    elif lc < 2:
        warnings.append("補足 : 検出された葉が少ないです。結果の信頼度が低くなる場合があります。")
    if gc is not None and gc < 5:
        warnings.append("補足 : 緑被率が低いです。植物が画像全体に収まっていない可能性があります。")
    if fc == 0:
        warnings.append("補足 : 果実が検出されませんでした。時期や撮影角度にご注意ください。")
    if warnings:
        lines.append("")
        lines.extend(warnings)

    return "\n".join(lines)