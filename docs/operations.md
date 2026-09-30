# 運用・保守 (operations)

バックエンド（FastAPI）とフロントエンド（Next.js）の起動、監視、冗長化、バックアップ、ログの運用方法です。

## 単一構成の起動と watchdog

`start.bat` は1つのバックエンド（既定値 `127.0.0.1:8000`）と1つのフロントエンド（既定値 `3001`）を起動し、各プロセスを自動再起動します。

| スクリプト | 起動するもの |
|------------|--------------|
| `run_backend.bat` | `uvicorn app.main:app`（ログは `logs/backend-uvicorn.log`） |
| `run_frontend.bat` | `next start`（ログは `logs/frontend.log`） |

初回起動時は以下をすべて自動で行います（手動構築は不要です）:

- Python 仮想環境の作成＋`requirements.txt` のインストール/更新（常に idempotent に実行）
- `frontend\node_modules` が無ければ `npm install`、`.next` が無ければ `npm run build`
- **検出エンジン (olive-p) の自動解決**: `OLIVE_P_DIR` → `external\olive-p` → 従来の `Downloads\olive-p` の順に検出し、どれも無ければ `git clone https://github.com/UKK-KOSEN/olive-vision-ai.git external\olive-p` で取得（git 未導入時は明確なエラーで停止）
- `ops\check_env.py` による環境チェック（olive-p / upscaler / ffmpeg）

手動で行う場合は以下と同等です:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
npm run build
```

`BACKEND_HOST`、`BACKEND_PORT`、`FRONTEND_PORT`、`BACKEND_URL` を設定するとポートとAPIプロキシ先を変更できます。

## アクティブ/スタンバイ冗長構成

`ops\redundant-start.bat` は、次の構成を起動します。

- active バックエンド: `http://127.0.0.1:8000`
- standby バックエンド: `http://127.0.0.1:8001`
- フロントエンド: `http://localhost:3001`
- 監視アービター: `logs\redundant-monitor.log`

```bat
ops\redundant-start.bat
```

`BACKEND_PORT`、`STANDBY_PORT`、`FRONTEND_PORT` を設定するとポートを変更できます。`FRONTEND_PORT` に応じて `BACKEND_URL` も必要に応じて設定してください。

| 変数 | 既定値 | 説明 |
|------|--------|------|
| `OLIVE_INSTANCE_ID` | `standalone` | プロセス識別子。冗長構成では `primary` / `standby` などを指定 |
| `OLIVE_INSTANCE_ROLE` | `active` | `active` または `standby`。変更後は再起動が必要 |
| `HEALTH_FAILURE_THRESHOLD` | `3` | フェイルオーバー前の連続失敗回数 |
| `BACKEND_HOST` | `127.0.0.1` | バックエンドのバインド先 |
| `BACKEND_PORT` | `8000` | primary バックエンドのポート |
| `STANDBY_PORT` | `8001` | standby バックエンドのポート |
| `FRONTEND_PORT` | `3001` | フロントエンドのポート |
| `BACKEND_URL` | primary URL | Next.js のAPIプロキシ先 |

```bat
set BACKEND_PORT=8100
set STANDBY_PORT=8101
set FRONTEND_PORT=3101
set BACKEND_URL=http://127.0.0.1:8100
ops\redundant-start.bat
```

監視アービターは active の `/api/health` を既定で10秒間隔で確認します。active が `HEALTH_FAILURE_THRESHOLD`（既定値3）回連続で到達不能またはDB利用不可になった場合、standby の `/api/health` の `can_promote`（DB読み取り可否）を確認し、primaryポートに新しい active プロセスを起動します。復旧後に元のポート構成へ自動でロールバックしません。保守時に構成を再整列する場合は一旦停止して再起動してください。

停止は次のとおりです。

```bat
ops\redundant-stop.bat
```

停止スクリプトは監視アービター、フロントエンド、両バックエンドを停止します。

### standby の動作

- `GET`、`HEAD`、`OPTIONS` 以外のAPIを `503 Service Unavailable` で拒否します。
- 解析キュー（Runner）、センサー監視スレッド、admin初期化を実行しません。
- SQLiteをread-only接続で開き、起動時のスキーマ変更を実行しません。
- active への移行は、監視アービターが primary ポートに新しい `active` プロセスを起動することで実行します。

SQLite（WAL）と `backend/data/`、`backend/uploads/`、`backend/storage/` は同一ホスト上で共有されます。この構成はバックエンドプロセス障害を対象としており、ホスト障害・ディスク障害・ネットワーク分割には対応しません。真正のホスト冗長化には、PostgreSQL等の外部DBとSMB/S3等の共有ストレージへ移行してください。

## 単一構成の死活監視

`ops\start-monitor.bat` は `ops\monitor.ps1` を起動し、`/api/health` を30秒間隔で監視します。冗長構成では `ops\redundant-start.bat` を使用してください。

`monitor.ps1` は以下のパラメータを指定できます（既定値で十分な場合はコマンドライン引数なしで起動）。

| パラメータ | 既定値 | 説明 |
|-----------|--------|------|
| `-FailureThreshold` | `3` | 再起動を実行するまでの連続失敗回数。1回だけの通信途絶（瞬間的なblip）では再起動しません |
| `-StartupGraceSec` | `30` | バックエンド起動直後の猶予秒数。この間は立ち上がり中として失敗カウントしません |

```powershell
# 例: 失敗5回で再起動・起動猶予60秒
ops\monitor.ps1 -FailureThreshold 5 -StartupGraceSec 60
```

## アプリ内DB冗長化（自動バックアップ・自動復元）

バックエンド自体が **実行中にDBのスナップショットを取り続け、破損時に自動復元する** 仕組みです
（`backend/app/db_redundancy.py`）。プロセスが落ちてもデータが失われないようにする運用レベルの
バックアップ（`ops/backup.py`）と併用してください。

- **スケジューラ**: active インスタンスだけが起動するデーモンスレッドが、起動60秒後に初回、
  その後 `DB_BACKUP_INTERVAL_MIN`（既定30分）ごとに SQLite のオンラインバックアップAPIで
  スナップショットを `backend/data/backups/` へ保存します。
- **世代管理**: `DB_BACKUP_KEEP`（既定6）世代を新しい順に保持し、超えた古いものは自動削除。
  ファイル名は `olive_msystem.<UTC時刻>.db`（例: `olive_msystem.20260928T134336Z.db`）。
- **破損時自動復元**: 起動時、DBファイルが破損（`corrupt` / `malformed` / `not a database` /
  `disk i/o error`）と判定されると、最新バックアップを自動的に書き戻して起動します
  （書き戻しは一時ファイル＋renameで原子的。バックアップがない・256MB超の場合は復元せず degraded 起動）。
- **確認方法**: `GET /api/health` の `db_backup` フィールド
  （`enabled` / `last_backup_at` / `backup_dir` / `files`）。

手動で復元操作をしたい場合の補足:

```powershell
# バックアップ一覧（新しい順）
Get-ChildItem backend\data\backups\olive_msystem.*.db | Sort-Object Name -Descending

# 復旧例: サービスを止めたうえで、選んだバックアップをDBへコピー（WALも消す）
#   Stop プロセス停止後:
#   Copy-Item backend\data\backups\olive_msystem.<時刻>.db backend\data\olive_msystem.db
#   Remove-Item backend\data\olive_msystem.db-wal, backend\data\olive_msystem.db-shm -ErrorAction SilentlyContinue
```

> 注意: `backend/data/backups/` は同じディスク上にあります。ディスクそのものが壊れた場合は
> 復元できません。ホスト外へ退避するには必ず `ops/backup.py`（任意の `--out` 先）を利用してください。

## バックアップ

`ops\backup.bat` は、SQLiteのオンラインバックアップAPIでDBをコピーし、`config` と `uploads` を `backups\<日時>\` へ保存します。**外部ディスクへ退避する**ことが目的です（前述の「アプリ内DB冗長化」とは役割が異なります）。

```bat
ops\backup.bat
```

世代数や追加オプションはPythonスクリプトで指定できます。

```powershell
py ops\backup.py --keep 10
py ops\backup.py --include-storage --verify --keep 10
py ops\backup.py --out C:\backups\olive
```

`--verify` はコピー後のDBへ `PRAGMA integrity_check` を実行します。検査結果が `ok` でない場合は終了コード1を返します。

## ログ

| ファイル | 内容 |
|----------|------|
| `backend/logs/backend.log` | アプリケーションログ（ローテーション、5MB×3） |
| `logs/backend-uvicorn.log` | uvicornの標準出力（watchdog起動時） |
| `logs/frontend.log` | Next.jsの出力 |
| `logs/monitor.log` | 単一構成の死活監視イベント |
| `logs/redundant-monitor.log` | active/standbyの監視・再起動・昇格イベント |
| `logs/backup.log` | 手動バックアップ（`ops/backup.py`）結果 |

ログは2か所に分かれます。`backend/logs/` はバックエンド自身が書くアプリログ、
`logs/`（リポジトリ直下）は watchdog / 監視 / 手動バックアップが書く運用ログです。

## 管理者パスワード

- 初回起動時に `admin` がランダムな10桁の数字パスワードで自動生成され、起動ログに表示されます。
- 固定したい場合は環境変数 `ADMIN_PASSWORD` を設定してください。
- 旧デフォルトの `admin123` は初回起動時に自動ローテーションされます。

## センサー監視の確認

- 最新の状態: `GET /api/sensor-alerts`
- 設定: `backend/config/soil_moisture.yaml` の `alerts:`（管理画面でも編集可）
- テスト送信: 管理画面「土壌センサー監視・通知」→「テスト通知を送信」
  （または `POST /api/admin/soil-config/test-notification`）

## UI確認

- フロントエンドが正しく起動しているか: http://localhost:3001 にアクセスしてログイン画面が表示されるか確認。
- ログイン後: Sidebar のナビゲーション（体調・観測履歴・カレンダー・農園マップ・お知らせ・プロフィール・アルゴリズム・FAQ）がすべてクリック可能か確認。
- 管理画面（admin）: `/admin` にアクセスし、単一ページ内の農家管理・データ管理・サイト設定・土壌監視セクションが表示されるか確認。
- エラーページ: 不正な権限で `/admin` にアクセスすると `/forbidden` にリダイレクトされるか確認。
- お知らせ: `/notifications` にアクセスし、通知一覧・未読状態・管理者の送信フォームが表示されるか確認。

## ヘルスチェック

```powershell
# 死活監視（認証不要・常に200）
curl http://127.0.0.1:8000/api/health

# レディネスチェック（active かつ DB 利用可能時にのみ200）
curl http://127.0.0.1:8000/api/health/ready

# 冗長構成: standby ヘルスチェック
curl http://127.0.0.1:8001/api/health

# レスポンス例
{"status":"ok","db_status":"ok","can_promote":true,"db_backup":{"enabled":true,"last_backup_at":"...","backup_dir":"backend/data/backups","files":3},"uptime_sec":1234.56}
```

| 項目 | 確認方法 |
|------|----------|
| プロセス生存 | `GET /api/health` が 200 を返すか |
| DB接続 | `/api/health` の `db_status` が `ok` か |
| アクティブ起動 | `/api/health/ready` が 200 を返すか |
| standby 異常 | `GET /api/health/ready`（standby ポート）が 503 を返すか確認（期待通り） |
| フェイルオーバー後 | standby の `can_promote` が `true` で、active がダウンした際に `/api/health/ready` が 200 になるか |

## アクティブ/スタンバイ（詳細）

| 項目 | active | standby |
|------|--------|---------|
| ポート | `BACKEND_PORT`（既定 8000） | `STANDBY_PORT`（既定 8001） |
| 書き込みAPI | 許可 | `503 Service Unavailable` で拒否 |
| Runner（解析キュー） | 実行 | 停止 |
| センサー監視スレッド | 実行 | 停止 |
| admin初期化 | 実行 | 停止 |
| SQLite 接続 | 読み書き | read-only |
| `GET /api/health/ready` | 200（DB利用可の場合） | 503 |
| `can_promote` | — | standby の DB読み取り可否 |

## バックアップ確認

バックアップ完了後に以下で確認できます:

```powershell
# バックアップディレクトリ一覧
ls backups\

# DB整合性確認（--verify の結果を再確認）
python -c "import sqlite3; c=sqlite3.connect('backups\<timestamp>\olive_msystem.db'); print(c.execute('PRAGMA integrity_check').fetchone())"
```

- `--verify` オプション付きでバックアップ実行した場合、コピー後のDBに対して `PRAGMA integrity_check` が実行され、結果が `ok` でない場合は終了コード1で失敗します。
- バックアップには `backups\<日時>\` ディレクトリに DB と config、uploads が保存されます。`--include-storage` を指定した場合のみ解析済みフレームの `storage` も保存されます。

## トラブルシューティング

- **standbyが起動しない**: `logs/redundant-monitor.log` と `logs/backend-standby-uvicorn.log` を確認し、DBが存在するか、`OLIVE_INSTANCE_ROLE=standby` が競合していないか確認してください。
- **フェイルオーバーしない**: active の `db_status`、standby の `can_promote`、`HEALTH_FAILURE_THRESHOLD` と監視ログを確認してください。
- **フロントエンドがactiveに接続できない**: `BACKEND_URL` がprimaryポートを指しているか、`npm run build` を再実行して `next start` を再起動してください。
- **DBが肥大化**: バックアップ後に、安全な場所で `PRAGMA wal_checkpoint(TRUNCATE)` または `VACUUM` を検討してください。
- **UIにバックエンドの状態が反映されない**: `BackendStatusBanner` が表示するステータスを確認。`/api/health` のレスポンスと `BACKEND_URL` 等の環境変数を確認してください。
- **お知らせが表示されない**: `GET /api/notifications` で通知データを確認し、`target_role` / `target_user_id` の設定を確認してください。
- **自動バックアップが作られない**: active インスタンスで起動しているか確認（standby は作成しません）。`/api/health` の `db_backup.enabled` が `true` か、`last_backup_at` が起動から60秒+30分以上経過しても `null` のままか確認してください。ログは `backend/logs/backend.log` の `db backup written:` 一行です。
- **appログが見つからない**: アプリのログは `backend/logs/backend.log`（リポジトリ直下の `logs/` には watchdog の `backend-uvicorn.log` と監視ログがあります）。
