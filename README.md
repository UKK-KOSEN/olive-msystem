# olive-msystem

オリーブの体調（健康状態）を、**オリーブキャラクターの表情**で客観的に見える化するWebダッシュボード。

- [olive-p](../olive-p) の解析アルゴリズムをそのまま利用しつつ、動画・画像の解析結果を保存・閲覧できる
- 動画の**指定した時刻**でフレーム抽出 → 解析 → 保存
- 動画の**連続アップロード**（キューでバックグラウンド解析）に対応
- 解析レポートは各項目を**日本語に翻訳**して表示（`backend/app/translate_report.py`）

## 主な機能

| 機能 | 説明 |
|------|------|
| 動画・画像アップロード | 動画は複数同時アップロード、キューで解析。画像は単発解析 |
| 高解像度解析（4倍） | 解析前フレームをReal-ESRGAN（動画は `realesr-animevideov3`）で4倍アップスケール |
| 指定時刻解析 | 秒 `90` / 時刻 `00:01:30` / CSV `0,5,10` で解析時刻を指定 |
| 体調判定 | `overall_health_score` から happy / good / caution / danger の4段階 |
| 解析レポート日本語訳 | olive-p の英語レポート全文をテンプレート翻訳規則で日本語化 |
| 動画プレビュー再生 | Range 対応ストリーミング（`/media`）でブラウザの `<video>` 再生・シーク対応 |
| カレンダー・推移 | 観測履歴をカレンダー/グラフで閲覧、トレンド判定 |
| 農園マップ | 樹木台帳（レジストリ）で畝・列に樹木を配置し、体調を地図上に色分け表示 |
| 通知 | 管理者から全ユーザー/特定ユーザーへ通知配信、通知一覧 |
| 土壌水分センサー | 外部API（小豆島フィールド）から土壌水分・温度・湿度を取得して表示 |
| センサー異常監視・通知 | データ停止・水分値異常・API接続エラーを検知し、アプリ内＋Webhook/LINE で通知 |
| アクティブ/スタンバイ冗長運用 | バックエンドを主・待機の2プロセスで起動し、主系障害時に主ポートで後継activeを起動 |
| DB冗長化 | activeインスタンスが `DB_BACKUP_INTERVAL_MIN` ごとにSQLiteをオンラインバックアップ（世代ローテーション）。起動時にDB破損を検出したら最新バックアップへ自動復元 |
| 農家アカウント | 農家は自分のデータのみ閲覧。管理者は全農家のデータ・アカウントを管理 |
| 永不停止化（バックエンド） | DB・解析エンジンの一時障害でdegraded起動＋自動復旧。解析キューは永不停止ループ、解析フレーム単位の失敗分離、アップロードはチャンク書込（OOM対策）、SQLite busy_timeout |
| エラー耐性化（フロントエンド） | ルート/ページ毎のエラーバウンダリ、非JSONレスポンス拒否（白画面化防止）、SDK的なAPIクライアントによる冪等なエラーハンドリング、watchdogの指数的バックオフ＋クラッシュループ検知 |
| APIエラーコード | 全APIレスポンスに機械判別可能な `code`（AUTH_* / VALIDATION_* / NOT_FOUND_* / CONFLICT_* / LIMIT_* / SERVER_* / UNAVAILABLE_*）を付与。フロントは `ApiError.code` で判別可能 |

## 構成

```
olive-msystem/
├── backend/            FastAPI（Python）+ olive-p アルゴリズム
│   ├── app/
│   │   ├── main.py            # FastAPI ルート・APIエンドポイント・エラーハンドラ・各スレッド起動
│   │   ├── analyzer.py        # olive-p の Analyzer / VideoProcessor をラップ
│   │   ├── errors.py          # 機械判別可能なAPIエラーコード（ERROR_CODES）とエラー形式
│   │   ├── translate_report.py# 解析レポートの日本語訳（テンプレート翻訳）
│   │   ├── health.py          # 体調スコア → キャラクター状態のマッピング
│   │   ├── runner.py          # 連続アップロード・解析のバックグラウンドキュー
│   │   ├── storage.py         # SQLite 永続化 (users / sessions / videos / images / observations ...)
│   │   ├── auth.py            # トークン認証（SQLiteセッション）・ロール判定（farmer / admin）
│   │   ├── soil_moisture.py   # 土壌水分センサーAPIとの連携
│   │   ├── sensor_alerts.py   # センサー異常の監視・通知（状態機械・エスカレーション）
│   │   ├── captured.py        # 撮影時刻の取得・解析
│   │   ├── config.py          # パス・設定・環境変数
│   │   ├── db_redundancy.py   # SQLiteオンラインバックアップ・世代ローテーション・破損時自動復元
│   │   └── models.py          # Pydantic リクエストモデル
│   ├── tools/           # 補助スクリプト（assign_sample_tree_ids.py 等）
│   ├── data/            # SQLite DB（olive_msystem.db）+ backups/（DB自動バックアップ）
│   ├── uploads/         # アップロードされた動画・画像（元ファイル）
│   ├── storage/         # 解析済みフレーム・注釈付き画像
│   ├── logs/            # アプリログ（backend.log）
│   └── config/          # settings.json / soil_moisture.yaml
├── ops/                # 運用スクリプト（backup / monitor / redundant-*）
├── docs/               # ドキュメント（architecture / api / operations / farm-map / sensor-alerts 等）
├── logs/               # watchdog / 監視ログ（backend-uvicorn / frontend / monitor / backup 等）
└── frontend/           Next.js 15（App Router）+ React 19 + Tailwind CSS v3
    ├── app/
    │   ├── (app)/       # 農家・一般ユーザー向けページ群
    │   ├── (admin)/     # 管理者向けページ（/admin）
    │   ├── forbidden/   # 403 アクセス禁止ページ
    │   ├── login/       # ログイン・農家登録
    │   ├── global-error.tsx # ルートエラーバウンダリ（予期せぬ例外時の白画面防止）
    │   └── layout.tsx   # ルートレイアウト
    └── components/      # 共通コンポーネント（新規追加はここ）
```

- 解析アルゴリズムは外部プロジェクト [olive-p](C:\Users\yakit\Downloads\olive-p) の
  `src/runtime.py`（`Analyzer`）と `src/video_processor.py`（`VideoProcessor`）を
  `backend/app/analyzer.py` からインポートしてそのまま流用。
- フロントの `/api` `/storage` `/media` は `next.config.mjs` の rewrites で
  FastAPI（既定値 `127.0.0.1:8000`、`BACKEND_URL` で変更可）へプロキシ。
- `/versions`（旧ページ）は `/algorithm` へ恒久リダイレクト。

## エラーコード

すべてのAPIエラーは、人間向け `detail`（従来どおり）に加えて
**機械判別可能な `code`** をJSONボディで返します（`backend/app/errors.py` の `ERROR_CODES`）。

| 分類 | コード例 | 状態 |
|------|---------|------|
| 認証・認可 | `AUTH_REQUIRED` / `AUTH_BAD_CREDENTIALS` / `AUTH_FORBIDDEN` / `AUTH_USERNAME_TAKEN` / `AUTH_ACCOUNT_DISABLED` / `AUTH_LOCKED`（試行超過で一時ロック） / `LIMIT_REGISTRATION`（登録回数超過） | 401 / 403 / 429 |
| 入力検証 | `VALIDATION_PASSWORD` / `VALIDATION_FARM_TREES` / `VALIDATION_UNSUPPORTED_VIDEO` / `VALIDATION_NO_TIMES` / `VALIDATION_OBSERVATIONS_LIMIT` 等 | 400 / 422 |
| 存在しない | `NOT_FOUND_VIDEO` / `NOT_FOUND_IMAGE` / `NOT_FOUND_OBSERVATION` / `NOT_FOUND_TREE` / `NOT_FOUND_FARMER` 等 | 404 |
| 競合・状態 | `CONFLICT_VIDEO_ANALYZING`（解析中） / `CONFLICT_TREE_ID`（重複ID） | 409 |
| 上限超過 | `LIMIT_UPLOAD_TOO_LARGE` | 413 |
| サーバー / 利用不可 | `SERVER_INTERNAL` / `SERVER_UPLOAD_WRITE` / `UNAVAILABLE_DATABASE` / `UNAVAILABLE_BACKEND` | 500 / 503 |

- フロントエンドは `ApiError.code` で受け取り、`detail` ベースの既存処理もそのまま維持。
- エラーハンドリングは従来どおり（重複しない追加方式）。コードは公開後に変更しないこと（外部連携が依存しうる）。

## 体調の判定

`overall_health_score`（0〜1）をもとに4段階で判定します（しきい値は管理画面から変更可）。

| スコア | ラベル | キャラクター | メッセージ |
|--------|--------|--------------|------------|
| >= 0.75 | happy | にこにこ | 元気に育っています |
| >= 0.55 | good  | ほのぼの | 概ね健康ですが見守りが必要 |
| >= 0.35 | caution | 心配 | 水分・葉の状態に注意 |
| それ以外 | danger | ぐったり | 早めに潅水や環境の見直し |

## Getting Started（クイックスタート）

1. **起動**: `start.bat` を実行するだけで、Python仮想環境・npmパッケージのインストール/更新、フロントエンドのビルド（`.next` が無い場合）、検出エンジン（olive-p / upscaler / ffmpeg）の確認をすべて自動で行い、バックエンドとフロントエンドの watchdog を起動します。olive-p が見つからない場合は初回起動時に `external\olive-p` へ自動クローンします（`OLIVE_P_DIR` 指定がある場合はそれが最優先）。
2. **アクセス**: ブラウザで http://localhost:3001 を開いてください。
3. **ログイン**: 管理者は初回起動時にランダムな10桁数字パスワードで作成されます（ログ確認 or `ADMIN_PASSWORD` 環境変数で固定）。

## 開発起動

### 方法A: 一括起動（推奨）

```powershell
start.bat
```

バックエンドとフロントエンドの watchdog が自動で起動・監視します。

### 方法B: 手動起動

```powershell
# バックエンド（別ターミナル）
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# フロントエンド（別ターミナル）
cd frontend
npm install
npm run dev -- -p 3001
```

### 方法C: 冗長構成（active/standby）

```powershell
ops\redundant-start.bat
```

- active: `127.0.0.1:8000` / standby: `127.0.0.1:8001` / frontend: `localhost:3001`
- `ops\redundant-monitor.ps1` がヘルスを監視し、active 障害時に standby を昇格させます。
- データベースは WAL モードで動作し、active インスタンスが `DB_BACKUP_INTERVAL_MIN`（既定30分）ごとに一貫性のあるスナップショットを `backend/data/backups/` へ世代ローテーション保存します。DB が破損した場合、起動時に最新バックアップから自動復元します（状態は `/api/health` の `db_backup` で確認できます）。

## 環境変数

| 変数 | 既定値 | 説明 |
|------|--------|------|
| `BACKEND_HOST` | `127.0.0.1` | バックエンドのバインド先ホスト |
| `BACKEND_PORT` | `8000` | バックエンドのポート |
| `FRONTEND_PORT` | `3001` | フロントエンドのポート |
| `BACKEND_URL` | `http://127.0.0.1:8000` | Next.js の API プロキシ先（`next.config.mjs` rewrites） |
| `MAX_UPLOAD_MB` | `2048` | アップロード1ファイルの容量上限（MB）。超過は `413 LIMIT_UPLOAD_TOO_LARGE` |
| `WORKERS` | `2` | 解析キュー（runner）の並列ワーカー数 |
| `OLIVE_P_DIR` | （環境依存） | olive-p 解析エンジンのパス（未指定時は `external\olive-p` → 従来の `Downloads\olive-p` の順に自動検出、見つからなければ `start.bat` が `external\olive-p` へ自動クローン） |
| `ADMIN_PASSWORD` | （ランダム10桁） | 管理者パスワードの固定（未設定時は初回起動時にランダム生成） |
| `OLIVE_INSTANCE_ID` | `standalone` | 冗長構成でのプロセス識別子（`primary` / `standby` 等） |
| `OLIVE_INSTANCE_ROLE` | `active` | 冗長構成でのロール（`active` / `standby`） |
| `HEALTH_FAILURE_THRESHOLD` | `3` | フェイルオーバー前の連続失敗回数 |
| `STANDBY_PORT` | `8001` | standby バックエンドのポート（冗長構成時） |
| `DB_BACKUP_INTERVAL_MIN` | `30` | active インスタンスが SQLite をオンラインバックアップする間隔（分） |
| `DB_BACKUP_KEEP` | `6` | 保持するバックアップ世代数（`backend/data/backups/` にローテーション保存） |

## フロント・バックエンドのポートとプロキシ

| 層 | ポート | アクセス元 |
|----|--------|------------|
| フロントエンド（Next.js） | 3001 | ブラウザ（http://localhost:3001） |
| バックエンド（FastAPI） | 8000 | フロントエンドのプロキシ経由 |
| standby バックエンド | 8001 | ヘルスチェック専用（書き込み拒否） |

### プロキシ構成

`frontend/next.config.mjs` の `rewrites` により、フロントエンドからの以下のパスがバックエンドへプロキシされます：

| フロントのパス | プロキシ先 |
|---------------|------------|
| `/api/*` | `BACKEND_URL/api/*` |
| `/storage/*` | `BACKEND_URL/storage/*` |
| `/media/*` | `BACKEND_URL/media/*` |

- `/versions`（旧ページ）は `/algorithm` へ恒久リダイレクト。
- 開発中は CORS により `localhost:3000` / `localhost:3001` も許可されます（`backend/app/config.py` の `CORS_ORIGINS`）。

## 永不停止化とエラー耐性

単一コンポーネントの一時障害でシステム全体が止まらないよう、段階的に耐性を実装しています。

### バックエンド（永不停止化）

- **degraded起動＋自動復旧**: 起動時にDB・解析エンジン（grader/seed）・初期データが
  使えない場合でもプロセスは起動し、利用可能になった時点で自動復旧します
  （`/api/health` の `degraded` フラグ、`/api/health/ready` で監視）。
- **解析キュー（runner）**: 永不停止ループ。起動時に途中で残った `pending` ジョブを
  `stuck`（クラッシュループ）から自動リカバリし、ジョブ単位の例外も無限再試行しません。
- **フレーム単位の失敗分離**: 動画の1フレーム解析失敗が他のフレームやジョブ全体を
  巻き込まないよう、フレームごとにガードしてスコアを算出。
- **アップロードのチャンク書込**: 巨大ファイルでもメモリを一括消費せずチャンク毎に書込
  （OOM対策）。容量超過は `413 LIMIT_UPLOAD_TOO_LARGE` で当該ファイルのみ拒否。
- **SQLite `busy_timeout`**: 同時書き込み時にロックエラーで落ちず待機します。
- **DB自動バックアップと破損復元**: active インスタンスが `DB_BACKUP_INTERVAL_MIN` ごとに
  SQLite のオンラインバックアップを `backend/data/backups/` へ世代ローテーション保存し、
  起動時にDB破損を検出したら最新バックアップへ自動復元します（状態は `/api/health` の `db_backup`）。
- 詳細は [docs/operations.md](docs/operations.md) を参照してください。

### フロントエンド（エラー耐性）

- **ルート/ページ毎のエラーバウンダリ**: `app/global-error.tsx` と各 `error.tsx` により、
  予期せぬ例外でも白画面にならず、リトライやログイン画面へ誘導します。
- **非JSONレスポンス拒否**: プロキシ経由でHTML等が返った場合に JSON と誤認せず明示エラー
  （白画面化防止、`frontend/lib/api.ts`）。
- **API再試行（idempotent限定）**: 冪等なリクエスト（GET/HEAD/OPTIONS）のみ、`408` / `429` / `5xx` /
  タイムアウト時に指数的バックオフ＋ジッターで最大3回再試行します（`RETRY_ATTEMPTS=3`、
  `250ms×2^n`、上限2秒）。**POST/PUT/DELETE は二重送信を防ぐため再試行しません**。
- **watchdog**: `run_backend.bat` / `run_frontend.bat`（`start.bat` から同時起動）が
  プロセスを監視し、クラッシュ時は指数的バックオフで再起動。クラッシュループ検知（10秒未満の
  即死を連続15回で60秒待機）と前提チェック（venv存在確認等）付き。

## 検証コマンド

```powershell
# バックエンド ヘルスチェック（認証なし）
curl http://127.0.0.1:8000/api/health

# バックエンド レディネスチェック（active かつ DB 利用可能時に 200）
curl http://127.0.0.1:8000/api/health/ready

# 冗長構成: standby ヘルスチェック
curl http://127.0.0.1:8001/api/health

# API 認証テスト（Bearer トークンが必要）
$token = (curl http://127.0.0.1:8000/api/auth/login -Method POST -Body '{"username":"admin","password":"xxx"}' -ContentType 'application/json' | ConvertFrom-Json).token
curl http://127.0.0.1:8000/api/auth/me -H "Authorization: Bearer $token"

# フロントエンド アクセス確認
curl http://localhost:3001
```

## 主要UI導線

| 導線 | ルート | 説明 |
|------|--------|------|
| ログイン → ダッシュボード | `/login` → `/` | ログイン後にダッシュボードへ |
| ダッシュボード → 解析実行 | `/` → 動画アップロード → 解析実行 | 動画アップロードと解析の実行 |
| 体調確認 | `/olive` | オリーブキャラクターの体調スコアと状態 |
| 観測履歴 | `/tracking` | 観測記録の一覧・絞り込み・エクスポート |
| カレンダー | `/calendar` | 日別の体調をカレンダーで閲覧 |
| 農園マップ | `/farm-map` | 樹木台帳と体調の地図表示 |
| お知らせ | `/notifications` | 通知一覧 |
| プロフィール | `/profile` | 農園情報・パスワード・設定 |
| アルゴリズム | `/algorithm` | 検出アルゴリズム・システム構成 |
| FAQ | `/faq` | よくある質問 |
| 管理画面 | `/admin` | 管理者向け（農家管理・データ・設定） |
| エラーページ | `/forbidden` | 403 アクセス禁止 |

Sidebar のナビゲーション（`frontend/components/Sidebar.tsx`）により、農家向けページへの導線が提供されます。管理者向けには `AdminSidebar.tsx` を使用します。

## 運用スクリプト

- `ops\start-monitor.bat` … `ops\monitor.ps1` を起動（`/api/health` を30秒間隔で
  監視し、バックエンドが落ちたら自動復旧。ログは `logs\monitor.log`。
  `-FailureThreshold`・`-StartupGraceSec` で再起動閾値と起動猶予を調整可）
- `ops\backup.bat` … `ops\backup.py` でDBとデータを一貫バックアップ
  （`backups\<日時>\` へ。`python ops\backup.py --keep 10 --verify` で整合性確認）
- `ops\redundant-monitor.ps1` … active/standbyのヘルス監視、再起動、昇格
- `ops\redundant-start.bat` … 主系（8000）と待機系（8001）を起動し、主系障害時に主ポートで後継activeを起動
- `ops\redundant-stop.bat` … 冗長構成のバックエンド2ノードとフロントエンドを停止

待機系はAPIの書き込みを拒否し、解析キューとセンサー監視スレッドを起動しません。SQLiteとローカルファイルは同一ホスト内で共有されるため、この構成はプロセス障害向けの冗長化です。ホスト障害にも対応するには、外部DBと共有ストレージへ移行してください。

詳細は [docs/operations.md](docs/operations.md) を参照してください。

## アカウント（認証）

- **Bearerトークン**（`Authorization: Bearer <token>`）による認証。**JWTではなく**、
  ログイン時に発行される**不透明なセッショントークン**（`sessions` テーブルに保存、有効期限30日）です。
  トークンは `POST /api/auth/login`（または `POST /api/auth/register`）のレスポンス `token` で取得。
  ログインのたびに既存セッションが置き換わり、1ユーザーにつき1つの有効なセッションになります。
  明示的なログアウトは `POST /api/auth/logout`。
- **パスワード保管**: 平文では保存せず、**Argon2id**（PHC形式、`argon2-cffi`）でハッシュ化します。
  Argon2 が使えない環境では PBKDF2-HMAC-SHA256（20万反復・塩付き）へフォールバックし、既存の `pbkdf2$...` ハッシュもそのまま検証できます。
- **セッショントークンは SHA-256 でハッシュしてからDBに保存**します（DB漏えい時にトークンがそのまま使われないよう対策）。
  更新前からある従来のセッションも、生トークン照合のフォールバックにより引き続き有効です。
- **ログイン試行の制限**: アカウントごと（IP＋ユーザー名単位）に15分間で5回失敗すると15分間ロックされ `429 AUTH_LOCKED` を返します。
  存在しないユーザー名でもダミーハッシュ検証で応答時間を均等化し、ユーザー名の存在を推測されにくくしています。
  新規登録はIP単位で1時間8回まで（超過時 `429 LIMIT_REGISTRATION`）。
- **セッションの無効化**: 自分のパスワード変更時は他のセッションをすべて破棄（現在のセッションは維持）、
  管理者による農家のパスワードリセット時はその農家の全セッションを破棄します。
- ロールは **farmer**（農家）と **admin**（管理者）。
  - 農家は自分のデータのみ閲覧・編集可能。
  - 管理者のみ `/admin` と `/api/admin/*` にアクセス可能。それ以外のロールが `/admin` を開いた場合は `/forbidden`（403ページ）へ誘導。
- **初期管理者**: 初回起動時に `admin` ユーザーが自動生成されます。
  - パスワードはランダムな10桁の数字で、起動時のサーバーログに表示されます。
  - 環境変数 `ADMIN_PASSWORD` を設定するとそのパスワードで固定できます。
  - 旧デフォルトの `admin123` は初回起動時に自動ローテーションされます。

## データ保存先

| 項目 | 場所 |
|------|------|
| SQLite DB | `backend/data/olive_msystem.db` |
| DB自動バックアップ | `backend/data/backups/`（`olive_msystem.<UTC時刻>.db`、`DB_BACKUP_KEEP` 世代） |
| アップロード済み動画・画像 | `backend/uploads/` |
| 解析済みフレーム・注釈画像 | `backend/storage/<video_id>/` など |
| アプリ設定（しきい値・サイト名等） | `backend/config/settings.json` |
| 土壌水分センサー設定 | `backend/config/soil_moisture.yaml` |

## ページ（フロントエンド）

| ルート | ページ | アクセス |
|--------|--------|----------|
| `/` | ダッシュボード（アップロード・解析・動画プレビュー・結果テーブル・土壌状態カード） | ログイン後 |
| `/olive` | オリーブキャラクターの体調 | ログイン後 |
| `/images` | 画像解析 | ログイン後 |
| `/tracking` | 観測履歴・トレンド検索（`?tree=` で樹木ID絞り込み） | ログイン後 |
| `/calendar` | カレンダー表示 | ログイン後 |
| `/farm-map` | 農園マップ（樹木台帳＋体調の地図表示） | ログイン後 |
| `/notifications` | 通知一覧 | ログイン後 |
| `/profile` | プロフィール・表示設定 | ログイン後 |
| `/algorithm` | 検出アルゴリズム・システム構成・バージョン | ログイン後 |
| `/faq` | FAQ | ログイン後 |
| `/admin` | 管理ダッシュボード・農家管理・データ管理・土壌センサー監視設定 | 管理者のみ |
| `/forbidden` | 403 アクセス禁止 | 権限なし |
| `/login` | ログイン・農家登録 | 公開 |

## 主なAPI

### 認証 (`/api/auth`)

- `POST /api/auth/login` … ログイン → `{token, user}`（Bearerセッショントークン）
- `POST /api/auth/register` … 新規ユーザー登録（農家、自動ログイン）
- `POST /api/auth/logout` … セッション削除
- `GET /api/auth/me`, `PUT /api/auth/profile`, `GET/PUT /api/auth/preferences` … 自身の情報

### 動画 (`/api/videos`)

- `POST /api/videos` … 動画アップロード（multipart）
- `GET /api/videos` … 動画一覧（`storage_path` は `/media/<file>` 形式）
- `POST /api/videos/{id}/analyse` … 数値時刻（秒）で解析 `{"times":[0,5,10]}`
- `POST /api/videos/{id}/analyse-times` … 時:分:秒で解析 `{"times":["00:00:15","90"]}`
- `GET /api/videos/{id}/observations` … 解析結果一覧
- `GET /api/videos/jobs` … 解析キューの状態（進捗）
- `DELETE /api/videos/{id}` … 動画削除

### 画像 (`/api/images`)

- `POST /api/images` … 画像アップロード
- `GET /api/images` … 画像一覧
- `POST /api/images/{id}/analyse` … 画像解析
- `GET /api/images/{id}/observations` … 解析結果
- `DELETE /api/images/{id}` … 画像削除

### 観測・判定

- `GET /api/observations` … 観測一覧（農家は自分のみ）
- `DELETE /api/observations` … 観測一括削除
- `GET /api/observations/export` … CSV/JSONエクスポート
- `GET /api/olive/status` … 体調ステータス（最新判定・推移）
- `GET /api/calendar/observations` … カレンダー用データ
- `GET /api/trees` … 樹木ID一覧（追跡用）
- `GET /api/farm-map?farmer_id=4` … 農園マップ用データ（登録樹木＋最新の体調＋座標）
- `GET /api/trees/registry?farmer_id=4` ／ `POST /api/trees/registry?farmer_id=4` ／ `PUT /api/trees/registry/{tree_id}?farmer_id=4` ／ `DELETE /api/trees/registry/{tree_id}?farmer_id=4` … 樹木台帳CRUD（管理者は農家指定必須）
- `POST /api/trees/registry/import?farmer_id=4` … 観測済みの樹木IDを一括で台帳へ登録

### 土壌水分・センサー監視

- `GET /api/soil-moisture/status` … センサー最新値・鮮度・API監視情報
- `GET /api/sensor-alerts` … センサー異常監視の状態・履歴
- `POST /api/admin/soil-config/test-notification` … 通知チャネルのテスト送信（管理者）
- `PUT /api/admin/soil-config` … 土壌水分・監視設定の保存

### その他

- `GET /api/notifications` `/unread-count` `/read` … 通知
- `GET /api/admin/stats` `/farmers` `/settings` … 管理者API（要admin権限）
- `PUT /api/admin/farmers/{id}/password` / `DELETE /api/admin/farmers/{id}` … 農家パスワード変更・削除（管理者）
- `POST /api/admin/observations/clear` … 観測データ一括クリア（管理者）
- `GET /api/versions` … ソフトウェアスタックの構成・バージョン（認証なし）
- `GET /api/settings` … サイト表示設定の公開読み取り（認証なし）
- `GET /api/health` … 死活監視用（認証なし、DB状態・ロール・`db_backup`・件数を含む）
- `GET /api/health/ready` … レディネス監視用（active 且つDB利用可能な場合のみ200）

### 静的ファイル

- `GET /storage/{folder}/{file_name}` … 解析済みフレーム等の静的配信（任意の深さに対応）
- `GET /media/{file_name}` … アップロード済み動画の配信（**Range 対応 = シーク再生可**）

## 農園マップと樹木台帳

`/farm-map` は、**樹木台帳（`trees` テーブル）**に登録された樹木を畝・列のグリッド上に
配置し、各樹木の最新の体調（健康/良好/注意/要管理/未観測）を色分けして表示します。
表示グリッドは **畝2行 × 3列**（`COLS=3`）が基準で、台帳の `row_num` / `col_num` から
決定的な座標 (`x = 70 + (col-1)*118 + 59` / `y = 70 + (row-1)*130 + 65`) に配置されます。

- 台帳は農家ごとに管理（`user_id` + `tree_id` で一意）。管理画面の樹木台帳テーブルで
  登録・編集・削除、一括importが可能。**管理者は対象農家を指定**します。
- 台帳に未登録でも観測にある樹木は自動的に空きセルへ配置されます。ノードを選択して詳細パネルを開き、「樹木を登録」から台帳へ登録できます。
- 樹木クリックで観測回数・最終観測・状態メッセージ、`/tracking?tree=` への遷移ができます。
- 動作確認用サンプル: `backend/tools/assign_sample_tree_ids.py`（未設定観測へ `A-01`〜 を付与。
  実解析で入力済みのIDは上書きしません）

詳細は [docs/farm-map.md](docs/farm-map.md) を参照してください。

## 土壌水分センサーの異常監視・通知

土壌水分センサーのデータが**飛んでこない**（停止）・水分値が**異常**・**API接続エラー**を
検知し、アプリ内通知＋Webhook（Slack/Discord等）や LINE Notify / LINE BOT へ通知します。

- 検知した瞬間に即時通知 → `remind_hours` の間隔で段階リマインド → 復旧時に「復旧しました」通知
- 状態はDBに永続化され、サーバー再起動でも重複通知・再通知は発生しません
- 設定・閾値は管理画面「土壌センサー監視・通知」または `backend/config/soil_moisture.yaml` の `alerts:`
- 「テスト通知を送信」ボタンで各チャネルへの到達を確認できます

詳細は [docs/sensor-alerts.md](docs/sensor-alerts.md) を参照してください。

## 解析レポートの日本語訳

`backend/app/translate_report.py` が olive-p の英語レポートを全文日本語化します。
「セクション見出し・検出個体・信頼度・シグナル・理由・色分類・集計・警告」など
約30種の行テンプレート規則で翻訳し、数値はそのまま保持します。
未知の行はそのまま残すため、olive-p の仕様変更にも安全です。
詳細は [docs/translation.md](docs/translation.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [docs/architecture.md](docs/architecture.md) | システム構成・モジュール・DB・認証・通知・監視の全体像 |
| [docs/api.md](docs/api.md) | APIエンドポイント一覧・形式 |
| [docs/operations.md](docs/operations.md) | 起動・自動再起動・死活監視・バックアップ・ログ・トラブルシューティング |
| [docs/farm-map.md](docs/farm-map.md) | 農園マップと樹木台帳の使い方 |
| [docs/sensor-alerts.md](docs/sensor-alerts.md) | 土壌水分センサー異常監視・通知の設定と仕組み |
| [docs/webhooks.md](docs/webhooks.md) | Webhook通知の詳細仕様・送信フォーマット・各サービス設定例 |
| [docs/translation.md](docs/translation.md) | 解析レポート日本語訳の仕組み |

## 注意（セキュリティ / 運用）

- 本リポジトリに認証情報（APIキー・パスワード）をコミットしないこと。
- 土壌水分センサー等のシークレットは `backend/config/soil_moisture.yaml` で管理し、
  `.gitignore` 対象に追加してください。
- 本番運用時はフロントを `next start` の前に必ず `npm run build` で最新化すること。