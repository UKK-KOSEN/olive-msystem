# 運用・保守 (operations)

バックエンド（FastAPI）とフロントエンド（Next.js）の起動、監視、冗長化、バックアップ、ログの運用方法です。

## 単一構成の起動と watchdog

`start.bat` は1つのバックエンド（既定値 `127.0.0.1:8000`）と1つのフロントエンド（既定値 `3001`）を起動し、各プロセスを自動再起動します。

| スクリプト | 起動するもの |
|------------|--------------|
| `run_backend.bat` | `uvicorn app.main:app`（ログは `logs/backend-uvicorn.log`） |
| `run_frontend.bat` | `next start`（ログは `logs/frontend.log`） |

初回の手動構築:

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

## ヘルスチェック

```powershell
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/health/ready
curl http://127.0.0.1:8001/api/health
```

`/api/health` はliveness用で、DB読み取り結果を `db_status` と `can_promote` に記録します。`/api/health/ready` は active かつDB利用可能の場合だけ200を返し、standbyまたはDB異常時は503を返します。

## 単一構成の死活監視

`ops\start-monitor.bat` は `ops\monitor.ps1` を起動し、`/api/health` を30秒間隔で監視します。冗長構成では `ops\redundant-start.bat` を使用してください。

## バックアップ

`ops\backup.bat` は、SQLiteのオンラインバックアップAPIでDBをコピーし、`config` と `uploads` を `backups\<日時>\` へ保存します。

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
| `logs/backend.log` | アプリケーションログ（ローテーション、5MB×3） |
| `logs/backend-uvicorn.log` | uvicornの標準出力 |
| `logs/frontend.log` | Next.jsの出力 |
| `logs/monitor.log` | 単一構成の死活監視イベント |
| `logs/redundant-monitor.log` | active/standbyの監視・再起動・昇格イベント |
| `logs/backup.log` | バックアップ結果 |

## 管理者パスワード

- 初回起動時に `admin` がランダムな10桁の数字パスワードで自動生成され、起動ログに表示されます。
- 固定したい場合は環境変数 `ADMIN_PASSWORD` を設定してください。
- 旧デフォルトの `admin123` は初回起動時に自動ローテーションされます。

## センサー監視の確認

- 最新の状態: `GET /api/sensor-alerts`
- 設定: `backend/config/soil_moisture.yaml` の `alerts:`（管理画面でも編集可）
- テスト送信: 管理画面「土壌センサー監視・通知」→「テスト通知を送信」
  （または `POST /api/admin/soil-config/test-notification`）

## トラブルシューティング

- **standbyが起動しない**: `logs/redundant-monitor.log` と `logs/backend-standby-uvicorn.log` を確認し、DBが存在するか、`OLIVE_INSTANCE_ROLE=standby` が競合していないか確認してください。
- **フェイルオーバーしない**: active の `db_status`、standby の `can_promote`、`HEALTH_FAILURE_THRESHOLD` と監視ログを確認してください。
- **フロントエンドがactiveに接続できない**: `BACKEND_URL` がprimaryポートを指しているか、`npm run build` を再実行して `next start` を再起動してください。
- **DBが肥大化**: バックアップ後に、安全な場所で `PRAGMA wal_checkpoint(TRUNCATE)` または `VACUUM` を検討してください。
