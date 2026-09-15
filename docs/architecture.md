# システム構成 (architecture)

olive-msystem は **FastAPI (Python)** バックエンド + **Next.js 14 (App Router)** フロントエンドの2層構成です。

## 全体像

```
ブラウザ
   │  http://localhost:3001
   ▼
Next.js (frontend, ポート 3001)
   │   next.config.mjs の rewrites で /api /storage /media をプロキシ
   ▼
FastAPI (backend, ポート 8000)
   ├── 解析キュー (Runner: バックグラウンドスレッド)
   │     ・動画/画像のアップロード解析を順次実行
   │     ・olive-p の Analyzer / VideoProcessor を流用
   ├── センサー監視スレッド (sensor_alerts)
   │     ・土壌水分センサーの異常検知（停止/水分値異常/APIエラー）
   │     ・検知 → リマインド → 復旧通知をDBとWebhookへ送信
   └── SQLite (backend/data/olive_msystem.db)
```

## バックエンド (`backend/app`)

| モジュール | 役割 |
|------------|------|
| `main.py` | FastAPI アプリ本体・全APIエンドポイント・バックグラウンドスレッド起動 |
| `analyzer.py` | olive-p の解析器をラップ（`Analyzer` / `VideoProcessor` / upscale） |
| `translate_report.py` | 解析レポートの日本語訳（テンプレート翻訳規則） |
| `health.py` | `overall_health_score` → happy/good/caution/danger の4状態マッピング |
| `runner.py` | 解析ジョブのバックグラウンドキュー（1ワーカー） |
| `storage.py` | SQLite 永続化（テーブル管理・CRUD・認証ハッシュ） |
| `auth.py` | JWT認証・ロール判定（farmer / admin） |
| `soil_moisture.py` | 土壌水分センサーAPIクライアント・最新値の取得と土壌健康評価 |
| `sensor_alerts.py` | センサー異常の監視・通知（状態機械・エスカレーション・チャネル送信） |
| `captured.py` | 撮影時刻（観測日時）の抽出・判定 |
| `config.py` | 各種パス・設定・環境変数の解決 |
| `models.py` | Pydantic リクエストモデル |

## SQLite テーブル

| テーブル | 説明 |
|----------|------|
| `users` | ユーザー（role: farmer/admin、farm_name 等） |
| `sessions` | JWTセッション |
| `videos` / `images` | アップロード資産（メタ情報、storage_path は相対パス） |
| `observations` | 解析結果（時刻・ラベル・スコア・結果JSON・注釈画像パス） |
| `trees` | 農園マップ用の樹木台帳（user_id + tree_id で一意、畝/列/品種） |
| `notifications` | アプリ内通知（target_role/target_user_id で配信先を制御） |
| `sensor_alert_state` | センサー異常監視の現在状態（重複通知防止・エスカレーション位置） |
| `sensor_alert_events` | センサー異常通知の送信履歴 |

DB は WAL モードで運用しており、稼働中のバックアップ（`ops/backup.py`）と
読み書きの競合に安全です。

## 認証と権限

- JWT（`Authorization: Bearer <token>`）。トークンは `POST /api/auth/login` で取得。
- ロール:
  - **farmer**: 原則自分のデータのみ取得・編集。`?target_user_id` 等は管理者のみ。
  - **admin**: `/api/admin/*` と `/admin` ページへアクセス可能。
- アクセス制御は `auth.py` の `get_current_user` / `require_admin` で行う。

## 通知の仕組み

1. `store.add_notification(title, body, created_by, target_role, target_user_id)` で `notifications` に挿入。
2. 一覧API `GET /api/notifications` はロール/ユーザーでフィルタして返却。
3. フロントは未読数をヘッダーのベルアイコンで表示し、クリックで `/notifications` へ。

センサー異常の通知（`sensor_alerts.py`）はこの通知テーブル（アプリ内チャネル）と
Webhook（LINE Notify / Slack 等）の両方へ一貫して送信します。

## センサー異常監視（状態機械）

監視スレッドが設定間隔で `evaluate()` を実行し、現在の状態 (`sensor_alert_state`) と
照合して状態遷移を判定します。

- `ok` / `unconfigured`: 正常（通知なし）
- `stale`: データが `stale_hours` 以上更新されていない（**critical**）
- `risk`: 水分値が乾燥/過湿閾値を下回る/上回る、または健康リスク high/dry/wet（**warning**）
- `api_error`: 自動取得そのものが失敗（APIキー・URL・ネットワーク）（**warning**）

遷移規則:

| 遷移 | 動作 |
|------|------|
| 正常 → 異常 | **即時通知**（全チャネル）、`opened_at` 記録 |
| 異常継続 | `remind_hours` のスケジュールに従い段階リマインド（1回/監視時） |
| 異常の種類変更 | 新しい内容で再通知（状態リセット） |
| 異常 → 正常 | **復旧通知**（`recover_notify: true` の場合） |

状態はDBに永続化されるため、サーバー再起動しても再通知・重複通知になりません。

## フロントエンド (`frontend`)

```
app/
├── (app)/          農家・一般向けページ
│   ├── page.tsx    # ダッシュボード（アップロード/解析/プレビュー/土壌状態カード）
│   ├── olive/      # オリーブ体調キャラクター
│   ├── images/     # 画像解析
│   ├── tracking/   # 観測履歴・トレンド（?tree= で樹木ID絞り込み可）
│   ├── calendar/   # カレンダー
│   ├── farm-map/   # 農園マップ（樹木台帳 + 観測結果）
│   ├── notifications/ # 通知一覧
│   ├── profile/    # プロフィール・表示設定
│   ├── algorithm/  # 仕組み説明・構成・バージョン
│   └── faq/        # FAQ
├── (admin)/admin/  # 管理ダッシュボード（農家・データ・設定・土壌監視）
├── login/          # ログイン・農家登録
└── forbidden/      # 403
```

- API 呼び出しは `lib/api.ts` に集約（型定義＋fetchラッパー）。
- 認証状態は `lib/auth.ts`、サイトブランドは `lib/site.ts` で管理。

## データ保存先

| 項目 | 場所 |
|------|------|
| SQLite DB | `backend/data/olive_msystem.db`（WAL） |
| アップロード済み動画・画像 | `backend/uploads/` |
| 解析済みフレーム・注釈画像 | `backend/storage/<id>/` |
| アプリ設定 | `backend/config/settings.json` |
| 土壌水分センサー設定 | `backend/config/soil_moisture.yaml`（APIキー含む＝コミット禁止） |
| ログ | `logs/`（backend.log / backend-uvicorn.log / frontend.log / monitor.log / backup.log） |

## 冗長化・運用

- `run_backend.bat` / `run_frontend.bat`: watchdog による自動再起動（二重起動防止）。
- `ops/monitor.ps1` + `ops/start-monitor.bat`: `/api/health` を定期的に監視し、
  応答が無い場合に自動再起動＋復旧イベントを `logs/monitor.log` へ記録。
- `ops/backup.py` + `ops/backup.bat`: SQLite のオンライン一貫バックアップと
  config/uploads/storage のコピー（保持数指定可）。

詳細は [operations.md](operations.md) を参照してください。