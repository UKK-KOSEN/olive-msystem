# システム構成 (architecture)

olive-msystem は **FastAPI (Python)** バックエンド + **Next.js 15 (App Router) / React 19** フロントエンドの2層構成です。

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
   ├── DBバックアップスレッド (db_redundancy)
   │     ・active インスタンスが SQLite をオンラインバックアップ
   │     ・破損時の最新バックアップからの自動復元
   └── SQLite (backend/data/olive_msystem.db) + backend/data/backups/
```

## バックエンド (`backend/app`)

| モジュール | 役割 |
|------------|------|
| `main.py` | FastAPI アプリ本体・全APIエンドポイント・エラーハンドラ・バックグラウンドスレッド（Runner / センサー監視 / DBバックアップ）起動 |
| `analyzer.py` | olive-p の解析器をラップ（`Analyzer` / `VideoProcessor` / upscale） |
| `translate_report.py` | 解析レポートの日本語訳（テンプレート翻訳規則） |
| `health.py` | `overall_health_score` → happy/good/caution/danger の4状態マッピング |
| `runner.py` | 解析ジョブのバックグラウンドキュー（`WORKERS` 個のワーカー） |
| `storage.py` | SQLite 永続化（テーブル管理・CRUD・パスワードハッシュ・セッション管理） |
| `auth.py` | トークン認証（SQLiteセッション）・ロール判定（farmer / admin） |
| `errors.py` | 機械判別可能なAPIエラーコード（`ERROR_CODES` / `app_error` / `error_body`） |
| `soil_moisture.py` | 土壌水分センサーAPIクライアント・最新値の取得と土壌健康評価 |
| `sensor_alerts.py` | センサー異常の監視・通知（状態機械・エスカレーション・チャネル送信） |
| `captured.py` | 撮影時刻（観測日時）の抽出・判定 |
| `config.py` | 各種パス・設定・環境変数の解決 |
| `db_redundancy.py` | SQLiteオンラインバックアップ・世代ローテーション・破損時自動復元 |
| `models.py` | Pydantic リクエストモデル |

## SQLite テーブル

| テーブル | 説明 |
|----------|------|
| `users` | ユーザー（role: farmer/admin、farm_name 等）。パスワードは Argon2id（PHC形式、`argon2-cffi`）でハッシュ保存。Argon2 未導入環境では PBKDF2-HMAC-SHA256（20万反復・塩付き）へフォールバックし、既存 `pbkdf2$...` ハッシュも検証可能 |
| `sessions` | セッショントークン（不透明なBearerトークン・有効30日・1ユーザー1セッション）。保存時は SHA-256 でハッシュ化（旧セッションは生トークン照合でフォールバック） |
| `videos` / `images` | アップロード資産（メタ情報、storage_path は相対パス） |
| `observations` | 解析結果（時刻・ラベル・スコア・結果JSON・注釈画像パス） |
| `trees` | 農園マップ用の樹木台帳（user_id + tree_id で一意、畝/列/品種） |
| `notifications` | アプリ内通知（target_role/target_user_id で配信先を制御） |
| `sensor_alert_state` | センサー異常監視の現在状態（重複通知防止・エスカレーション位置） |
| `sensor_alert_events` | センサー異常通知の送信履歴 |

DB は WAL モードで運用しており、稼働中のバックアップ（`ops/backup.py`）と
読み書きの競合に安全です。さらに active インスタンスは `backend/app/db_redundancy.py` の
スケジューラにより `DB_BACKUP_INTERVAL_MIN`（既定30分）ごとに一貫性のあるスナップショットを
`backend/data/backups/` へ世代ローテーション保存し、起動時にDB破損を検出した場合は
最新バックアップへ自動復元します（詳細は後述の「DB冗長化」を参照）。

## 認証と権限

- **不透明なBearerトークン**（`Authorization: Bearer <token>`）。JWTではありません。
  トークンは `POST /api/auth/login`（または `POST /api/auth/register`）のレスポンスの
  `token` フィールドで取得します。トークン本体は `secrets.token_urlsafe(32)` で生成される
  ランダム文字列で、`sessions` テーブルには **SHA-256 ハッシュ**にして保存されます（DB漏えい時に
  トークンがそのまま使われないための対策。更新前からある従来セッションは生トークン照合で有効）。
- トークンの有効期限は30日。ログインするたびにそのユーザーの**既存セッションを削除**して
  新しく発行するため、1ユーザーにつき常に1つの有効なセッションです。
  明示的に `POST /api/auth/logout` でも削除できます（ヘッダーに `Authorization` 不要）。
- **ログイン試行の制限**: IP＋ユーザー名単位の `_RateGuard`（in-memory・threadsafe）で、
  15分間に5回失敗すると15分間ロックし `429 AUTH_LOCKED` を返します。存在しないユーザー名でも
  ダミーハッシュ検証で応答を時間的に対称化します。新規登録はIP単位で1時間8回まで
  （`429 LIMIT_REGISTRATION`）。
- **パスワード変更時のセッション破棄**: 自分のパスワード変更は他のセッションを破棄（現行維持）、
  admin による農家パスワードリセットはその農家の全セッションを破棄します。
- ロール:
  - **farmer**: 原則自分のデータのみ取得・編集。通知の `target_user_id` や樹木APIの `farmer_id` など、管理者向けスコープ指定は権限制約に従います。
  - **admin**: `/api/admin/*` と `/admin` ページへアクセス可能。
- アクセス制御は `auth.py` の `get_current_user` / `require_admin` で行う。

## 通知の仕組み

1. `store.add_notification(title, body, created_by, target_role, target_user_id)` で `notifications` に挿入。
2. 一覧API `GET /api/notifications` はロール/ユーザーでフィルタして返却。
3. フロントは `NotificationsList` で通知一覧と未読数を取得し、`showBadge` を有効化した場合に未読バナーを表示します。

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

## DB冗長化（オンラインバックアップと破損復元）

`backend/app/db_redundancy.py` が、稼働中DBの一貫性のあるスナップショットを管理します。

- **スケジューラ**: active インスタンスだけがデーモンスレッド（`db-backup-scheduler`）を起動します。
  起動60秒後の初回実行後、`DB_BACKUP_INTERVAL_MIN`（既定30分）ごとに SQLite の
  オンラインバックアップAPI（`src.backup()`）で `backend/data/backups/` へ保存します。
  ファイル名は `olive_msystem.<UTC時刻>.db` 形式（例: `olive_msystem.20260928T134336Z.db`）。
- **世代ローテーション**: `DB_BACKUP_KEEP`（既定6）を超えた古い世代は自動削除されます。
  `list_backups()` は新しい順に返します。
- **破損時自動復元**: 起動時の `_open_store_with_retries()` で、DBファイルが破損
  （`corrupt` / `malformed` / `not a database` / `disk i/o error` など）と判定された場合、
  最新バックアップを一時ファイル経由で原子的に書き戻します（WAL/SHMは破棄）。
  バックアップがない・256MB超などの安全ガードを満たさない場合は復元せず degraded 起動します。
- **状態確認**: `/api/health` の `db_backup` フィールドに
  `{enabled, last_backup_at, backup_dir, files}` が含まれます。

注意: 本機能は**プロセス・DBファイル単位の障害**向けです。ディスク破損は `backend/data/`
自体が生き残っていないと復元できません。このため手動の夜間バックアップ（`ops/backup.py`）と
併用してください（[docs/operations.md](operations.md)）。

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
- 認証状態は `lib/auth.tsx`、サイトブランドは `lib/site.tsx` で管理。

## データ保存先

| 項目 | 場所 |
|------|------|
| SQLite DB | `backend/data/olive_msystem.db`（WAL） |
| DBオンラインバックアップ | `backend/data/backups/`（`olive_msystem.<UTC時刻>.db`、`DB_BACKUP_KEEP` 世代） |
| アップロード済み動画・画像 | `backend/uploads/` |
| 解析済みフレーム・注釈画像 | `backend/storage/<id>/` |
| アプリ設定 | `backend/config/settings.json` |
| 土壌水分センサー設定 | `backend/config/soil_moisture.yaml`（APIキー含む＝コミット禁止） |
| アプリログ | `backend/logs/backend.log`（5MB×3ローテーション） |
| watchdog・監視ログ | `logs/`（backend-uvicorn / frontend / monitor / redundant-monitor / backup）.log |

## UI/UX構成

フロントエンドの画面構成とナビゲーションは以下のとおりです。

### レイアウト要素

| 要素 | コンポーネント | 設置場所 | 説明 |
|------|----------------|----------|------|
| サイドバー（農家向け） | `frontend/components/Sidebar.tsx` | 左側固定 | 農家向けページへのナビゲーション（体調、観測、カレンダー、マップ、お知らせ、プロフィール、アルゴリズム、FAQ） |
| サイドバー（管理者向け） | `frontend/components/AdminSidebar.tsx` | 左側固定 | 管理ダッシュボードとシステム構成へのナビゲーション |
| タスクバー | `frontend/components/TaskBar.tsx` | 右下固定 | 動画・画像解析ジョブの進捗と完了・エラー状態 |
| バックエンド状態バナー | `frontend/components/BackendStatusBanner.tsx` | 右上固定 | バックエンド接続障害時の復旧導線 |
| エラー通知 | `frontend/components/ErrorNotice.tsx` | 各ページ | 取得エラーの表示と再試行 |
| ページヘッダー | `frontend/components/PageHeader.tsx` | 各ページ上部 | タイトルと説明文 |
| スナックバー | `frontend/components/Snackbar.tsx` | 各ページ | 一時的な操作結果通知 |
| 健康ゲージ | `frontend/components/HealthGauge.tsx` | `/olive`、観測詳細、`FarmerHome` | 体調スコアの円形表示 |
| 高精細バッジ | `frontend/components/UpscaledBadge.tsx` | 解析結果 | 高精細アップスケール適用済み表示 |

### 認証とルーティング

- `/login` と `/forbidden` は認証・権限ゲート外の公開ページ。農家登録は `/login` の「農家登録」モードから利用します。
- `(app)` 配下は `app/(app)/layout.tsx` が認証チェックを行い、未認証なら `/login` へリダイレクト。
- `(admin)` 配下は `app/(admin)/layout.tsx` が認証＋管理者ロールチェックを行い、無効なら `/forbidden` へリダイレクト。
- 読み込み中は各 layout でスピナー表示（`aria-busy`, `aria-live="polite"` 対応）。

### ナビゲーション導線

```
/login → ログイン/農家登録
        ↓（認証後）
/app layout → Sidebar + TaskBar + BackendStatusBanner
  ├─ /              ダッシュボード（アップロード/解析/プレビュー/土壌状態）
  ├─ /olive         オリーブ体調キャラクター
  ├─ /images        画像解析
  ├─ /tracking      観測履歴・トレンド（?tree= で絞り込み）
  ├─ /calendar      カレンダー
  ├─ /farm-map      農園マップ
  ├─ /notifications お知らせ一覧（未読バナーは任意）
  ├─ /profile       プロフィール・設定
  ├─ /algorithm     仕組み説明・構成・バージョン（旧 /versions → リダイレクト）
  ├─ /faq           FAQ
  └─ /forbidden     403 アクセス禁止

/admin layout → AdminSidebar + BackendStatusBanner
  └─ /admin         管理ダッシュボード（農家・データ・設定・土壌監視の各セクション）
```

### レスポンシブ対応

- サイドバーは画面幅に応じて展開/折りたたみ。
- マップ・表・カード類は `grid`, `flex`, `overflow-x-auto` でレスポンシブ対応。
- 農園マップの SVG は `viewBox` で `w-full h-auto` により幅適応。

## Documentation Index（ドキュメントとUIルート・コードの対応表）

| UIルート | ドキュメント | 主なコードファイル | 説明 |
|----------|-------------|-------------------|------|
| `/login` | （本README） | `frontend/app/login/page.tsx`, `frontend/lib/auth.tsx` | ログイン・農家登録 |
| `/` | README（ダッシュボード） | `frontend/app/(app)/page.tsx` | ダッシュボード（アップロード/解析/プレビュー/土壌状態） |
| `/olive` | README（体調確認） | `frontend/app/(app)/olive/page.tsx` | オリーブ体調キャラクター |
| `/images` | README（画像解析） | `frontend/app/(app)/images/page.tsx` | 画像解析 |
| `/tracking` | README（観測履歴） | `frontend/app/(app)/tracking/page.tsx`, `frontend/components/ObservationDetail.tsx` | 観測履歴・トレンド |
| `/calendar` | README（カレンダー） | `frontend/app/(app)/calendar/page.tsx` | カレンダー |
| `/farm-map` | [docs/farm-map.md](farm-map.md) | `frontend/app/(app)/farm-map/page.tsx` | 農園マップと樹木台帳 |
| `/notifications` | [docs/sensor-alerts.md](sensor-alerts.md) | `frontend/components/Notifications.tsx`, `frontend/app/(app)/notifications/page.tsx` | アプリ内通知（`showBadge` 有効時は未読バナー） |
| `/profile` | README（プロフィール） | `frontend/app/(app)/profile/page.tsx` | プロフィール・表示設定 |
| `/algorithm` | README（アルゴリズム） | `frontend/app/(app)/algorithm/page.tsx` | 仕組み説明・構成 |
| `/faq` | README（FAQ） | `frontend/app/(app)/faq/page.tsx` | よくある質問 |
| `/admin` | [docs/api.md](api.md), [docs/operations.md](operations.md) | `frontend/app/(admin)/admin/page.tsx`, `frontend/components/AdminSidebar.tsx` | 管理ダッシュボード（単一ルート内のセクション構成） |
| `/forbidden` | （エラーページ） | `frontend/app/forbidden/page.tsx` | 403 アクセス禁止 |
| `/api/health` | [docs/api.md](api.md) | `backend/app/main.py` | 死活監視（liveness） |
| `/api/health/ready` | [docs/api.md](api.md) | `backend/app/main.py` | レディネスチェック |
| 全API | [docs/api.md](api.md) | `backend/app/main.py`, `frontend/lib/api.ts` | APIリファレンス |
| 冗長構成 | [docs/operations.md](operations.md) | `ops/redundant-monitor.ps1`, `ops/monitor.ps1` | active/standby 監視・フェイルオーバー |
| 手動バックアップ | [docs/operations.md](operations.md) | `ops/backup.py` | SQLiteオンラインバックアップ（config/uploads/storage 含む） |
| DB冗長化（自動） | [docs/operations.md](operations.md) | `backend/app/db_redundancy.py` | 定期スナップショット・世代ローテーション・破損復元 |

## 冗長化・運用

- `run_backend.bat` / `run_frontend.bat`: watchdog による自動再起動（二重起動防止）。
- `ops/redundant-monitor.ps1` + `ops\redundant-start.bat`: active（既定8000）と standby（既定8001）を監視し、active の到達不能またはDB利用不可が閾値回数続いた場合、primaryポートに新しい active プロセスを起動する。standbyは別ポートで待機を継続する。
- standby は書き込みAPIを拒否し、Runner・センサー監視スレッド・管理データ初期化を停止し、SQLiteをread-onlyで開く。
- `/api/health` は `role`、`ready`、`can_promote` を返し、`/api/health/ready` は active 且つDB利用可能の場合だけ200を返す。
- SQLite（WAL）と `backend/data/`、`backend/uploads/`、`backend/storage/` は同一ホスト上で2プロセスが共有する。このため冗長化の対象はバックエンドプロセス障害であり、ホスト障害・ディスク障害には対応しない。
- `ops/monitor.ps1` + `ops/start-monitor.bat`: 単一バックエンド構成向けの `/api/health` 監視
  （`-FailureThreshold`（連続失敗閾値）と `-StartupGraceSec`（起動猶予）を指定可能）。
- `ops/backup.py` + `ops/backup.bat`: SQLite のオンライン一貫バックアップと config/uploads/storage のコピー（`--verify` で整合性確認）。
- `backend/app/db_redundancy.py`: active インスタンスが定期実行する DB オンラインバックアップ
  （`DB_BACKUP_INTERVAL_MIN` / `DB_BACKUP_KEEP`）と、起動時の破損検出に伴う自動復元。

真正のホスト冗長化が必要な場合は、SQLiteを外部DBへ、ローカルファイルをSMB/S3等の共有ストレージへ移行する。

詳細は [operations.md](operations.md) を参照してください。