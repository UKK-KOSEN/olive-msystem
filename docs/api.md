# API リファレンス

ベースURL: `http://127.0.0.1:8000`
認証: 特別な指定が無い限り `Authorization: Bearer <token>` が必要。
トークンは `POST /api/auth/login` で取得（レスポンスの `token` フィールド）。

## 認証 (`/api/auth`)

| メソッド・パス | 説明 |
|----------------|------|
| `POST /api/auth/login` | ログイン `{username, password}` → JWT |
| `POST /api/auth/register` | 農家登録 |
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
| `GET /api/observations/export` | CSV/JSONエクスポート |
| `GET /api/olive/status` | 体調ステータス・推移 |
| `GET /api/calendar/observations` | カレンダー用データ |
| `GET /api/trees` | 追跡用の樹木ID一覧 |

## 農園マップ / 樹木台帳

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/farm-map?target_user_id=4` | 農園マップ用データ（登録樹木＋最新状態＋座標） |
| `GET /api/trees/registry?target_user_id=4` | 樹木台帳一覧（管理者は農家指定必須） |
| `POST /api/trees/registry` | 樹木登録 `{target_user_id, tree_id, name, variety, row_num, col_num, note}` |
| `PUT /api/trees/registry/{id}?target_user_id=4` | 樹木更新 |
| `DELETE /api/trees/registry/{id}?target_user_id=4` | 樹木削除 |
| `POST /api/trees/import` | 台帳一括登録 |

## 土壌水分・センサー監視

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/soil-moisture/status` | センサー最新値・鮮度・API監視情報（`sensor_online`, `data_age_hours` を含む） |
| `GET /api/sensor-alerts` | センサー異常監視の状態・設定・送信履歴 |
| `POST /api/admin/soil-config/test` | 土壌水分API接続テスト（管理者） |
| `POST /api/admin/soil-config/test-notification` | 通知チャネルのテスト送信（管理者） |
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
| `GET/PUT /api/admin/settings` | 判定しきい値・サイト設定 |
| `DELETE /api/admin/videos/images/observations/{id}` | 資産・観測の削除 |

## その他・静的

| メソッド・パス | 説明 |
|----------------|------|
| `GET /api/health` | 死活監視（認証なし）。`{status, db_status, uptime_sec}` |
| `GET /api/olive/status` など | 体調情報 |
| `GET /storage/{...}` | 解析済みフレーム・注釈画像の静的配信 |
| `GET /media/{file}` | 動画の Range 対応ストリーミング配信 |

## レスポンス形式

- 成功: 通常の JSON。
- エラー: `{detail: "..."}`（FastAPI標準）。
- 一覧系は `[{...}]` または `{"data": [...]}` の形式（APIにより異なる）。
  農家ユーザーには自分のデータのみ、管理者には全体が返ります。