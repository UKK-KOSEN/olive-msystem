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
| 通知 | 管理者から全ユーザー/特定ユーザーへ通知配信、未読バッジ |
| 土壌水分センサー | 外部API（小豆島フィールド）から土壌水分・温度・湿度を取得して表示 |
| センサー異常監視・通知 | データ停止・水分値異常・API接続エラーを検知し、アプリ内＋Webhook/LINE で通知 |
| 農家アカウント | 農家は自分のデータのみ閲覧。管理者は全農家のデータ・アカウントを管理 |

## 構成

```
olive-msystem/
├── backend/            FastAPI（Python）+ olive-p アルゴリズム
│   ├── app/
│   │   ├── main.py            # FastAPI ルート・APIエンドポイント
│   │   ├── analyzer.py        # olive-p の Analyzer / VideoProcessor をラップ
│   │   ├── translate_report.py# 解析レポートの日本語訳（テンプレート翻訳）
│   │   ├── health.py          # 体調スコア → キャラクター状態のマッピング
│   │   ├── runner.py          # 連続アップロード・解析のバックグラウンドキュー
│   │   ├── storage.py         # SQLite 永続化 (users / videos / images / observations ...)
│   │   ├── auth.py            # JWT認証・ロール判定（farmer / admin）
│   │   ├── soil_moisture.py   # 土壌水分センサーAPIとの連携
│   │   ├── sensor_alerts.py   # センサー異常の監視・通知（状態機械・エスカレーション）
│   │   ├── captured.py        # 撮影時刻の取得・解析
│   │   ├── config.py          # パス・設定・環境変数
│   │   └── models.py          # Pydantic リクエストモデル
│   ├── tools/           # 補助スクリプト（assign_sample_tree_ids.py 等）
│   ├── data/            # SQLite DB（olive_msystem.db）
│   ├── uploads/         # アップロードされた動画・画像（元ファイル）
│   ├── storage/         # 解析済みフレーム・注釈付き画像
│   └── config/          # settings.json / soil_moisture.yaml
├── ops/                # 運用スクリプト（backup / monitor / start-monitor）
├── docs/               # ドキュメント（architecture / api / operations / farm-map / sensor-alerts 等）
└── frontend/           Next.js 14（App Router）+ Tailwind CSS v3
    ├── app/
    │   ├── (app)/       # 農家・一般ユーザー向けページ群
    │   ├── (admin)/     # 管理者向けページ（/admin）
    │   ├── forbidden/   # 403 アクセス禁止ページ
    │   ├── login/       # ログイン・農家登録
    │   └── layout.tsx   # ルートレイアウト
    └── components/      # 共通コンポーネント（新規追加はここ）
```

- 解析アルゴリズムは外部プロジェクト [olive-p](C:\Users\yakit\Downloads\olive-p) の
  `src/runtime.py`（`Analyzer`）と `src/video_processor.py`（`VideoProcessor`）を
  `backend/app/analyzer.py` からインポートしてそのまま流用。
- フロントの `/api` `/storage` `/media` は `next.config.mjs` の rewrites で
  FastAPI（`127.0.0.1:8000`）へプロキシ（ブラウザは同一オリジンのみ通信）。
- `/versions`（旧ページ）は `/algorithm` へ恒久リダイレクト。

## 体調の判定

`overall_health_score`（0〜1）をもとに4段階で判定します（しきい値は管理画面から変更可）。

| スコア | ラベル | キャラクター | メッセージ |
|--------|--------|--------------|------------|
| >= 0.75 | happy | にこにこ | 元気に育っています |
| >= 0.55 | good  | ほのぼの | 概ね健康ですが見守りが必要 |
| >= 0.35 | caution | 心配 | 水分・葉の状態に注意 |
| それ以外 | danger | ぐったり | 早めに潅水や環境の見直し |

## 起動手順

### 1. バックエンド（FastAPI, ポート 8000）

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 2. フロントエンド（Next.js, ポート 3001）

```powershell
cd frontend
npm install
npm run build          # 本番ビルド（起動スクリプト利用時は必須）
npm run start -- -p 3001
```

開発中は `npm run dev -- -p 3001` でも起動できます。

ブラウザで http://localhost:3001 を開いてください。

### 一括起動（watchdog付き）

`start.bat` をダブルクリック、またはコマンドラインで実行すると
バックエンドとフロントエンドをまとめて起動します。

- `run_backend.bat` … uvicorn（8000）を監視・自動再起動
- `run_frontend.bat` … `next start -p 3001` を監視・自動再起動
- どちらも二重起動防止（既に起動中なら監視のみ）

### 運用スクリプト

- `ops\start-monitor.bat` … `ops\monitor.ps1` を起動（`/api/health` を30秒間隔で
  監視し、バックエンドが落ちたら自動復旧。ログは `logs\monitor.log`）
- `ops\backup.bat` … `ops\backup.py` でDBとデータを一貫バックアップ
  （`backups\<日時>\` へ。`python ops\backup.py --keep 10` で世代数を指定）

詳細は [docs/operations.md](docs/operations.md) を参照してください。

## アカウント（認証）

- JWT（`Authorization: Bearer <token>`）による認証。トークンは `POST /api/auth/login` で取得。
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

- `POST /login` … JWTトークン取得
- `POST /register` … 新規ユーザー登録（農家）
- `GET /me`, `PUT /profile`, `GET/PUT /preferences` … 自身の情報

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
- `GET /api/farm-map?target_user_id=4` … 農園マップ用データ（登録樹木＋最新の体調＋座標）
- `GET /api/trees/registry?target_user_id=4` ／ `POST` ／ `PUT /{id}` ／ `DELETE /{id}` … 樹木台帳CRUD（管理者は農家指定必須）

### 土壌水分・センサー監視

- `GET /api/soil-moisture/status` … センサー最新値・鮮度・API監視情報
- `GET /api/sensor-alerts` … センサー異常監視の状態・履歴
- `POST /api/admin/soil-config/test-notification` … 通知チャネルのテスト送信（管理者）
- `PUT /api/admin/soil-config` … 土壌水分・監視設定の保存

### その他

- `GET /api/notifications` `/unread-count` `/read` … 通知
- `GET /api/admin/stats` `/farmers` `/settings` … 管理者API（要admin権限）
- `GET /api/health` … 死活監視用（認証なし）

### 静的ファイル

- `GET /storage/{folder}/{file_name}` … 解析済みフレーム等の静的配信（任意の深さに対応）
- `GET /media/{file_name}` … アップロード済み動画の配信（**Range 対応 = シーク再生可**）

## 農園マップと樹木台帳

`/farm-map` は、**樹木台帳（`trees` テーブル）**に登録された樹木を畝・列のグリッド上に
配置し、各樹木の最新の体調（健康/良好/注意/要管理/未観測）を色分けして表示します。

- 台帳は農家ごとに管理（`user_id` + `tree_id` で一意）。管理画面の樹木台帳テーブルで
  登録・編集・削除、一括importが可能。**管理者は対象農家を指定**します。
- 台帳に未登録でも観測にある樹木は自動で空きセルに配置され、ワンクリックで台帳に登録できます。
- 樹木クリックで観測回数・最終観測・状態メッセージ、`/tracking?tree=` への遷移ができます。
- 動作確認用サンプル: `backend/tools/assign_sample_tree_ids.py`（未設定観測へ `A-01`〜 を付与。
  実解析で入力済みのIDは上書きしません）

詳細は [docs/farm-map.md](docs/farm-map.md) を参照してください。

## 土壌水分センサーの異常監視・通知

土壌水分センサーのデータが**飛んでこない**（停止）・水分値が**異常**・**API接続エラー**を
検知し、アプリ内通知＋Webhook（Slack/Discord等）や LINE Notify へ通知します。

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
| [docs/translation.md](docs/translation.md) | 解析レポート日本語訳の仕組み |

## 注意（セキュリティ / 運用）

- 本リポジトリに認証情報（APIキー・パスワード）をコミットしないこと。
- 土壌水分センサー等のシークレットは `backend/config/soil_moisture.yaml` で管理し、
  `.gitignore` 対象に追加してください。
- 本番運用時はフロントを `next start` の前に必ず `npm run build` で最新化すること。