# API リファレンス

ベースURL: `http://127.0.0.1:8000`
認証: 特別な指定が無い限り `Authorization: Bearer <token>` が必要。
トークンは `POST /api/auth/login` / `POST /api/auth/register` で取得（レスポンスの `token` フィールド）。

> **トークンの正体**: JWT ではなく、`secrets.token_urlsafe(32)` で生成した**不透明な文字列**
> を `sessions` テーブルに保存する方式です（有効期限30日・1ユーザー1セッション）。
> ログインするたびに既存セッションは削除され新しく発行されます。
> パスワードは保存されず、PBKDF2-HMAC-SHA256 のソルト付きハッシュのみ保管します。

## 認証 (`/api/auth`)

| メソッド・パス | 説明 |
|----------------|------|
| `POST /api/auth/login` | ログイン `{username, password}` → `{token, user}` |
| `POST /api/auth/register` | 農家登録 → `{token, user}`（自動ログイン） |
| `POST /api/auth/logout` | セッション削除（`Authorization` ヘッダーからトークンを廃棄、認証不要） |
| `GET /api/auth/me` | 自分の情報 |
| `PUT /api/auth/profile` | プロフィール更新 |
| `GET /PUT /api/auth/preferences` | 表示設定 |

## 動画・画像

| メソッド・パス | 説明 |
|----------------|------|
| `POST /api/videos` | 動画アップロード（multipart） |
| `GET /api/videos` | 動画一覧 |
| `POST /api/videos/{id}/analyse` | 秒指定で解析 `{"times":[0,5]}`, `tree_id`, `soil_moisture`, `drone_mode`, `upscale` |
| `POST /api/videos/{id}/analyse-times` | `HH:MM:SS` / 秒混在で解析 |
| `GET /api/videos/{id}/observations` | 解析結果一覧 |
| `GET /api/videos/jobs` | 解析キュー状態 |
| `DELETE /api/videos/{id}` | 動画削除 |
| `POST /api/images` | 画像アップロード |
| `GET /api/images` | 画像一覧 |
| `POST /api/images/{id}/analyse` | 画像解析 |
| `GET /api/images/{id}/observations` | 画像の解析結果 |
| `DELETE /api/images/{id}` | 画像削除 |

## 観測・判定

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/observations` | 観測一覧（農家は自分のみ。`tree_id` 絞り込み可） |
| `DELETE /api/observations` | 観測一括削除 |
| `DELETE /api/observations/{observation_id}` | 観測1件削除 |
| `GET /api/observations/export` | CSV/JSONエクスポート |
| `GET /api/olive/status` | 体調ステータス・推移 |
| `GET /api/calendar/observations` | カレンダー用データ |
| `GET /api/trees` | 追跡用の樹木ID一覧（観測に登場した未登録IDも含む） |

## 農園マップ / 樹木台帳

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/farm-map?farmer_id=4` | 農園マップ用データ（登録樹木＋最新状態＋座標） |
| `GET /api/trees/registry?farmer_id=4` | 樹木台帳一覧（管理者は農家指定必須） |
| `POST /api/trees/registry?farmer_id=4` | 樹木登録 `{tree_id, name, variety, row_num, col_num, note}` |
| `PUT /api/trees/registry/{tree_id}?farmer_id=4` | 樹木更新 |
| `DELETE /api/trees/registry/{tree_id}?farmer_id=4` | 樹木削除 |
| `POST /api/trees/registry/import?farmer_id=4` | 観測済みの樹木IDを一括で台帳へ登録 |

## 土壌水分・センサー監視

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/soil-moisture/status` | センサー最新値・鮮度・API監視情報（`sensor_online`, `data_age_hours` を含む） |
| `GET /api/sensor-alerts` | センサー異常監視の状態・設定・送信履歴（チャネル秘密はマスク表示） |
| `POST /api/admin/soil-config/test` | 土壌水分API接続テスト（管理者） |
| `POST /api/admin/soil-config/test-notification` | 通知チャネルのテスト送信（管理者） |
| `POST /api/admin/soil-config/template-preview` | 通知テンプレートのサンプルプレビュー（管理者） |
| `PUT /api/admin/soil-config` | 設定保存（`alerts` セクション含む。部分保存時は既存値を保持） |

## 通知

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/notifications` | 通知一覧（ロールでフィルタ） |
| `GET /api/notifications/unread-count` | 未読数 |
| `POST /api/notifications/{id}/read` | 既読化 |
| `DELETE /api/notifications/{id}` | 通知削除 |
| `POST /api/notifications` | 通知作成（管理者） |

## 管理者 (`/api/admin`)

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/admin/stats` | ダッシュボード統計（設定・DB件数） |
| `GET/PUT /api/admin/farmers` | 農家一覧・更新 |
| `PUT /api/admin/farmers/{id}/password` | 農家パスワード変更 |
| `DELETE /api/admin/farmers/{id}` | 農家削除（動画・画像ごと削除） |
| `GET/PUT /api/admin/settings` | 判定しきい値・サイト設定 |
| `POST /api/admin/observations/clear` | 観測データの一括クリア |
| `DELETE /api/admin/videos/{id}` / `DELETE /api/admin/images/{id}` / `DELETE /api/admin/observations/{id}` | 管理者による資産・観測の削除 |

## その他・静的

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/health` | 死活監視（認証なし）。`status`、`db_status`、`role`、`ready`、`can_promote`、`db_backup`、`uptime_sec` など（下記参照） |
| `GET /api/health/ready` | レディネスチェック（active かつ DB 利用可能時に 200、そうでないとき 503） |
| `GET /api/versions` | ソフトウェアスタックのバージョン・構成・動作環境（認証なし、`/algorithm` ページで表示） |
| `GET /api/settings` | サイト表示設定（サイト名等）の公開読み取り（認証なし）。`{"site": {...}}` |
| `GET /storage/{...}` | 解析済みフレーム・注釈画像の静的配信（パストラバーサルを拒否） |
| `GET /media/{file}` | 動画の Range 対応ストリーミング配信 |

## health / ready の詳細

| エンドポイント | 用途 | 認証 | レスポンス |
|---------------|------|------|------------|
| `GET /api/health` | liveness（プロセス生存確認） | 不要 | プロセス生存・DB状態・ロール・稼働時間・DBバックアップ状態など。DB異常時でも通常は200（`status: "degraded"`） |
| `GET /api/health/ready` | readiness（サービス提供可能確認） | 不要 | 200: active 且つ DB 利用可 / 503: standby 或いは DB 異常 |

`GET /api/health` のレスポンス例:

```json
{
  "status": "ok",
  "service": "olive-msystem-backend",
  "version": "1.0.0",
  "instance_id": "standalone",
  "role": "active",
  "active": true,
  "ready": true,
  "can_promote": true,
  "write_enabled": true,
  "db_status": "ok",
  "db_path": "backend/data/olive_msystem.db",
  "db_backup": {
    "enabled": true,
    "last_backup_at": "2026-09-28T13:43:36+00:00",
    "backup_dir": "backend/data/backups",
    "files": 2
  },
  "uptime_sec": 1234,
  "timestamp": "2026-09-28T13:44:00+09:00",
  "observations": 12,
  "videos": 3,
  "images": 1
}
```

| フィールド | 説明 |
|-----------|------|
| `status` | `ok`（DB利用可）または `degraded`（DB異常でもプロセスは生存） |
| `role` / `active` | インスタンスロール（`active` / `standby`）とその判定 |
| `ready` | `active` かつDB利用可なら `true`（`/api/health/ready` の判定根拠） |
| `can_promote` | standby が DB 読み取り可能か（フェイルオーバー可否） |
| `write_enabled` | 書き込みAPIを許可しているか（standby は `false`） |
| `db_status` | `ok` / `error` |
| `db_backup` | DB冗長化の状態（`enabled` / `last_backup_at` / `backup_dir` / `files`）。`last_backup_at` は起動直後は `null` |
| `observations` / `videos` / `images` | 件数（storage の `count()`） |

- `GET /api/health/ready` は active であり DB が利用可能な場合のみ 200 を返します。

## UIプロキシに関する注意

フロントエンド（Next.js, ポート 3001）は `frontend/next.config.mjs` の `rewrites` により、以下のパスをバックエンド（FastAPI）へプロキシします。ブラウザは同一オリジン（`localhost:3001`）のみにリクエストするため、CORS は発生しません。

| フロントのパス | プロキシ先 |
|---------------|------------|
| `/api/*` | `BACKEND_URL/api/*`（既定: `http://127.0.0.1:8000/api/*`） |
| `/storage/*` | `BACKEND_URL/storage/*` |
| `/media/*` | `BACKEND_URL/media/*` |

- `BACKEND_URL` は `next.config.mjs` の `process.env.BACKEND_URL` で決定されます。環境変数を変更した場合は `npm run build` を再実行して `next start` を再起動してください。
- 旧ページ `/versions` は `/algorithm` へ恒久リダイレクト（`frontend/next.config.mjs` の `redirects`）です。
- 開発時（`npm run dev`）は `backend/app/config.py` の `CORS_ORIGINS` により `localhost:3000` / `localhost:3001` も許可されます。

## レスポンス形式

- 成功: 通常の JSON。
- エラー: `{detail: "...", code: "...", extra?: {...}}`。
  - `detail` は人間向けメッセージ（従来の FastAPI 形式のまま）。
  - `code` は機械判別用の安定コード（例: `AUTH_REQUIRED` / `VALIDATION_*` / `NOT_FOUND_*` /
    `CONFLICT_*` / `LIMIT_*` / `SERVER_*` / `UNAVAILABLE_*`）。`backend/app/errors.py` の `ERROR_CODES` 参照。
  - `extra` はエラーに付随する追加情報がある場合のみ付与（例: 上限値など）。
- 一覧系は `[{...}]` または `{"data": [...]}` の形式（APIにより異なる）。
  農家ユーザーには自分のデータのみ、管理者には全体が返ります。