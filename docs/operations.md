# 運用・保守 (operations)

バックエンド（FastAPI, 8000）/ フロントエンド（Next.js, 3001）の起動、監視、
バックアップ、ログの運用方法です。

## 起動と watchdog 自動再起動

`start.bat`（または個別のバッチ）で起動できます。どちらも**二重起動防止**付きで、
プロセスが死んだら短い待機後に自動再起動します。

| スクリプト | 起動するもの |
|------------|--------------|
| `run_backend.bat` | `uvicorn app.main:app --host 127.0.0.1 --port 8000`（ログは `logs/backend-uvicorn.log`） |
| `run_frontend.bat` | `next start -p 3001`（ログは `logs/frontend.log`） |

初回の手動構築:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
npm run build      # next start の前に必ず最新化
```

## 死活監視・自動復旧 (`ops/monitor.ps1`)

`ops/start-monitor.bat` で起動すると、`http://127.0.0.1:8000/api/health` を
30秒間隔でポーリングします。

- バックエンドが応答しない（HTTP 200以外 / 例外）とき、`run_backend.bat` を
  起動して自動復旧を試みます。
- 復旧・異常は `logs/monitor.log` に記録されます。
- 後付けの冗長化（watchdog）であり、`run_backend.bat` 自身の再起動ループと
  組み合わせてダブルガードになります。

```powershell
.\ops\start-monitor.bat        # 起動
Get-Content logs\monitor.log   # 稼働確認
```

## バックアップ (`ops/backup.py` / `ops/backup.bat`)

SQLite を WAL 配下で安全にオンライン一貫バックアップし、`config` / `uploads` /
`storage` をコピーします。

```powershell
.\ops\backup.bat                 # 既定（保持5世代）でバックアップ
python ops\backup.py --keep 10   # 保持10世代
python ops\backup.py --out C:\backups\olive
```

- 出力先: `backups\<YYYYMMDD_HHMM>\\`（`logs/backup.log` に結果を記録）
- SQLite は `VACUUM INTO` 相当の sqlite backup API で、稼働中にコピーしても
  一貫性が保証されます。

## ログ

| ファイル | 内容 |
|----------|------|
| `logs/backend.log` | アプリケーションログ（ローテーション、5MB×3）。例外トレース含む |
| `logs/backend-uvicorn.log` | uvicorn の標準出力（watchdog 起動時） |
| `logs/frontend.log` | Next.js の出力 |
| `logs/monitor.log` | 死活監視・自動復旧イベント |
| `logs/backup.log` | バックアップ結果 |

## ヘルスチェック

```powershell
curl http://127.0.0.1:8000/api/health
# {"status":"ok","service":"olive-msystem-backend","db_status":"ok","uptime_sec":…,"timestamp":"…"}
```

`status` は DB が読み取れる場合は `ok`、読めなければ `degraded` を返します。

## 管理者パスワード

- 初回起動時に `admin` がランダムな10桁の数字パスワードで自動生成され、起動ログに表示されます。
- 固定したい場合は環境変数 `ADMIN_PASSWORD` を設定（この場合はランダム化されません）。
- 旧デフォルトの `admin123` は初回起動時に自動ローテーションされます。

## センサー監視の確認

- 最新の状態: `GET /api/sensor-alerts`
- 設定: `backend/config/soil_moisture.yaml` の `alerts:`（管理画面でも編集可）
- テスト送信: 管理画面「土壌センサー監視・通知」→「テスト通知を送信」
  （または `POST /api/admin/soil-config/test-notification`）

## トラブルシューティング

- **センサーのデータが来ない** → `GET /api/soil-moisture/status` の
  `source` と `data_age_hours` を確認。`source=error` ならキー/URL/ネットワーク、
  age が大きいならセンサー本体の電源・通信を確認。
- **通知が来ない** → `alerts.enabled` と各チャネル設定、`logs/backend.log` の
  "sensor alert" ログを確認。テスト送信を実行。
- **DB が肥大化** → `ops/backup.bat` 後に不要なら、管理画面のデータ削除、
  または安全な場所で `PRAGMA wal_checkpoint(TRUNCATE)` / `VACUUM` を実施。
- **起動直後に何度も通知** → 再通知ではなく過去の履歴追加の可能性。
  `sensor_alert_state` の `level`/`last_sent_at` を確認（重複抑制はDB永続）。