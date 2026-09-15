# 土壌水分センサーの異常監視・通知 (sensor alerts)

土壌水分センサー（UKK-KOSEN Cloudflare D1 API）のデータが**飛んでこない**、または
**水分値が異常**なときに、アプリ内通知と外部チャネル（Webhook / LINE Notify）へ
確実に通知するシステムです。

## 検知できる異常

| モード | 内容 | 重要度 |
|--------|------|--------|
| `stale` | データが `stale_hours`（既定6時間）以上更新されていない（センサー停止） | critical |
| `risk`  | 水分値が乾燥/過湿閾値を超えた、または健康判定が high/dry/wet | warning |
| `api_error` | HTTP/ネットワーク/認証失敗など自動取得そのものが動作しない | warning |

旧実装（`main.py` の簡易ループ）では **API接続エラーや未設定の場合に通知が出ない**
「黙ってスキップ」問題がありましたが、新実装では `api_error` も検知・通知します。

## 通知の流れ

```
監視スレッド（check_interval_minutes毎）
   → evaluate() で最新状態を判定
   → sensor_alert_state と照合（重複通知防止）
       ・異常を検知した瞬間: 即時通知（全チャネル）
       ・異常が継続: remind_hours の間隔で段階リマインド
       ・状態の種類が変わった: 新しい内容で再通知
       ・正常に戻った: 復旧通知
   → sensor_alert_events へ送信履歴を記録
```

- 状態はDB（`sensor_alert_state`）に永続化するため、**サーバー再起動でも再通知・
  重複通知は発生しません**（エスカレーション位置も継続）。
- 監視スレッドは起動直後に1回目を実行するため、再起動直後も即座に検知できます。

## 設定（`backend/config/soil_moisture.yaml` の `alerts:` セクション）

管理画面の「土壌センサー監視・通知」でも編集できます。

```yaml
alerts:
  enabled: true              # 監視スレッドの有効/無効
  check_interval_minutes: 10 # チェック間隔（分）※最小は30秒にクランプ
  stale_hours: 6             # この時間以上データが無ければ停止と判定
  dry_percent: 15            # この%未満で乾燥異常
  wet_percent: 85            # この%超で過湿異常
  notify_risk: true          # 水分値異常（risk）も通知するか
  remind_hours: [6, 24, 72, 168]  # 検知後、これらの時間経過で段階リマインド
  recover_notify: true       # 復旧時に「復旧しました」を通知するか
  channels:
    inapp: true              # アプリ内通知（お知らせ）への配信
    webhook_url: ""          # 汎用JSON Webhook（Slack/Discord/Teams等）
    webhook_token: ""        # LINE Notify トークン（指定時はLINE形式で送信）
```

## 通知チャネル

### アプリ内通知（`inapp: true`）
`notifications` テーブルへ `target_role="all"` で作成され、ダッシュボードのベル
アイコンの未読数と `/notifications` ページで確認できます。すべてのユーザーに届きます。

### Webhook（`webhook_url`）
`{title, body, severity, type: "sensor_alert", service: "olive-msystem"}`
をJSON POSTで送信します。Slack Incoming Webhook / Discord / MS Teams などで利用できます。

### LINE Notify（`webhook_token` 指定時）
`Authorization: Bearer <token>` + `message=` のフォーム形式で
LINE Notify のエンドポイント（`https://notify-api.line.me/api/notify`）へ送信する
フォーマットになります。`webhook_url` には LINE Notify のURLを指定してください。

## API

### `GET /api/sensor-alerts`
現在の監視状態（evaluation）、永続化された状態（state）、直近30件の送信履歴
（events）、設定（チャネルはマスク表示）を返します。認証済みユーザーなら誰でも取得可。

```json
{
  "enabled": true,
  "configured": true,
  "evaluation": { "mode": "stale", "severity": "critical",
                  "title": "土壌水分センサー: データ更新停止", "body": "…",
                  "measured_at": "2026-09-11T06:37:38Z", "age_hours": 100.4,
                  "sensor1": 4.3, "sensor2": 78.08, "kit_id": "shodoshima-field-01" },
  "state": { "key": "default", "mode": "stale", "opened_at": "…",
             "level": 0, "data": "{...}" },
  "events": [ { "id": 1, "mode": "stale", "severity": "open",
                "title": "…", "channels": "inapp", "created_at": "…" } ],
  "channels": { "enabled": true, "channels": { "inapp": true, "webhook_url": "*****" } }
}
```

### `POST /api/admin/soil-config/test-notification`
有効な全チャネルへテスト通知を送信します。結果（チャネル別の成功/失敗）を返し、
送信履歴にも記録されます（管理者専用）。

```json
{ "results": [ { "channel": "inapp", "ok": true, "detail": null } ], "enabled": true }
```

## LINE Notify のセットアップ例

1. https://notify-api.line.me/my/ でトークンを発行。
2. 管理画面「土壌センサー監視・通知」で:
   - Webhook URL: `https://notify-api.line.me/api/notify`
   - LINE Notifyトークン: 発行したトークン
3. 「テスト通知を送信」で LINE に届くことを確認。

## Slack のセットアップ例

1. Slack App から Incoming Webhook URL を作成。
2. 管理画面で Webhook URL にそのURLを設定（トークンは空欄）。
3. 「テスト通知を送信」で確認。

## DBテーブル

- `sensor_alert_state`: `key`(PK) / `mode` / `opened_at` / `last_sent_at` / `level`(送信済みリマインド数) / `data`
- `sensor_alert_events`: `id` / `mode` / `severity`(open/remind/recovered/test) / `title` / `body` / `channels` / `created_at`

## よくある質問

- **データはAPIには届いているのに通知が出ない**
  `alerts.enabled` が有効か、`stale_hours` / `dry_percent` / `wet_percent` の閾値を再確認。
- **アプリ内通知にしか出ない**
  Webhook URL（と必要な場合はトークン）を設定してください。
- **通知が多すぎる**
  `remind_hours` を長くする、`recover_notify: false` にする、`notify_risk: false` にする。