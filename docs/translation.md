# 解析レポートの日本語訳（translate_report.py）

`backend/app/translate_report.py` は、olive-p が生成する英語の解析レポート
（`explain_detection` の出力）をテンプレート翻訳方式で日本語に変換します。
数値・面積・信頼度・座標などはすべてそのまま保持し、文言のみを日本語化します。

## 設計方針

- **行単位のテンプレート翻訳**: 既知の文型を正規表現で照合し、マッチした行だけを
  翻訳します。`_RULES` リストに「正規表現 + 変換関数」のペアを並べています。
- **未知の行はそのまま保持**: どのテンプレートにも一致しない行は原文のまま出力します。
  olive-p の仕様変更で文面が変わっても、壊れた訳文を作らず安全に動作します。
- **語彙は単語辞書で一元管理**: パイプライン名・信頼度・シグナル強度・葉の状態・
  成熟度・シワ具合・フレーム位置などは辞書（`_PIPELINES` 等）で定義しています。

## エントリポイント

| 関数 | 役割 |
|------|------|
| `explain_detection_ja(result)` | olive-p の解析結果 `result` を受け取り、全文日本語レポートを返す（最優先） |
| `translate_explain_text(text)` | 英語レポート文を直接日本語化する（`explain_detection_ja` の内部利用） |
| `_generate_simple_report(result)` | 上記が失敗した時のフォールバック（簡易日本語サマリー） |

呼び出し元は `backend/app/main.py` の `_finalize()` です。API が返す観測データには
翻訳済みの `explain_text` フィールドが自動で付与されます。

## 翻訳ルールの分類（_RULES 内）

| カテゴリ | 変換関数（抜粋） |
|----------|------------------|
| セクション見出し | `_section_title()`（「検出の説明」「概要」「詳細分析」など） |
| イントロ・画像情報 | `_intro()` |
| ぼやけ警告 | `_very_blurry()` / `_moderate_blurry()` / `_sharp()` |
| 検出結果 | `_detected_kind()`（葉 n 個 / 果実 n 個 検出） |
| 0 検出 | `_none_satisfied()` |
| 物体の座標・位置 | `_frame_position()` / `_translate_position_text()` |
| 面積・信頼度 | `_area_confidence()` |
| シグナル | `_signals()` / `_translate_signal_item()`（`_SIGNAL_RE`） |
| 形状テスト | `_shape_tests()` / `_translate_shape_item()`（`_SHAPE_RE`） |
| 検出理由 | `_why()` / `_translate_reason()`（`_REASON_RE`） |
| 検出経路・補足 | `_rescue_path()` / `_boosted_path()` / `_caution()` / `_unreliable()` |
| 色分類・表面状態 | `_colour_classified()` / `_surface()` |
| 概要の集計行 | `_green_coverage()` / `_pct_breakdown()` / `_maturity_breakdown()` / `_wrinkle_breakdown()` / `_cover()` / `_curl()` |
| 詳細分析の各行 | `_leaves_detail()` / `_leaf_size()` / `_orientation()` / `_fruits_detail()` / `_maturity_pct()` / `_wrinkle_pct()` / `_canopy()` / `_light()` / `_health()` / `_factors()` |
| 信頼度低めの注意 | `_leaf_low_conf()` / `_fruit_low_conf()` |
| 何も検出されない場合 | `_nothing()` |

## 対応している語彙（単語辞書）

- `_PIPELINES` … パイプライン名（マルチシグナル / シングルシグナル）
- `_CONFIDENCE_LABELS` … 信頼度（高 / 中程度 / 低）
- `_SIGNAL_STRENGTHS` … シグナル強度（強い / 中程度 / 弱い）
- `_SIGNAL_LABELS` … シグナル種別（黄緑色 / 成熟色 / 濃色・完熟色 / ハフ円）
- `_LEAF_STAGES` … 葉の状態（健康な緑 / 濃い緑 / 黄緑 / 黄 / 老化 / 乾燥 / 不明 など）
- `_MATURITIES` … 果実の成熟度（緑（未熟）/ 黄緑（やや熟）/ 紫（中間）/ 黒（完熟））
- `_WRINKLES` … 果実のシワ（滑らか / ややシワあり / シワあり / シワが強い）
- `_ZONES` … フレーム内の位置（左上 / 中央 / 右下 など）

## ルールの追加・修正方法

1. `translate_report.py` 内で変換関数を定義します
   （例: `def _my_rule(match): ...`）。
2. `_RULES` に `_rule(pattern, replacer)` で追加します。
   - `pattern` … 行全体を照合する正規表現（`^...$` 形式）。
   - `replacer` … `re.Match` を受け取り、日本語の行を返す関数。
3. 変換関数内で数値を保持したい場合は `match.group("...")` をそのまま利用します。

```python
def _my_rule(match: re.Match) -> str:
    val = match.group("val")
    return f"新しい文言（値: {val}）"

_rule(r"^New English sentence (?P<val>[\d.]+)$", _my_rule)
```

## 動作確認

既存の観測データに翻訳を再適用する場合は、保持している観測の `result_json`
（解析結果）を `explain_detection_ja()` に通すことで `explain_text` を再生成できます。
バックエンド起動中は API レスポンスの観測データに翻訳結果が含まれます。

```python
from app.translate_report import explain_detection_ja
text = explain_detection_ja(result)  # result は解析結果の dict
```