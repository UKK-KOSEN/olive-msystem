# Webhook 通知（複数送信先・3フォーマット）完全ガイド

土壌水分センサーの異常監視通知（docs/sensor-alerts.md）は、アプリ内通知に加えて
**複数のWebhook**へ同時に送信できます。本ドキュメントではWebhookの設定・フォーマット・
各サービスの導入手順・運用上の注意を詳しく説明します。

## 1. できること

- **複数Webhookの同時送信**: Slack / Discord / MS Teams / LINE Notify / ntfy などを
  1つの設定でまとめて配信（例: 作業グループへSlack、自分宛にLINE Notify）。
- **送信形式（format）の選択**: 送信先ごとに3形式から選べます。
  - `json` — 汎用JSONオブジェクト（Slack / Discord / Teams / 自作API向け）
  - `line_notify` — LINE Notifyのフォーム形式
  - `text` — プレーンテキスト（ntfy等、そのまま表示してほしい向け）
- **カスタムHTTPヘッダー**: 認証トークンや任意ヘッダーを付与可能。
- **タイムアウト設定**: Webhookごとに秒数を指定（既定10秒）。

## 2. 設定方法

### 2-1. 管理画面
`/admin` → 「土壌センサー監視・通知」 → 「Webhook（複数設定可）」で
「＋ Webhookを追加」からエントリを追加します。

- 名前・URL・形式（JSON / LINE Notify / テキスト）・トークン（任意）を入力
- 「設定を保存」→「テスト通知を送信」で動作確認できます。
- **トークン/URLはマスク表示され、保存時に前の値が自動で復元**されるため、
  他の画面遷移や再保存で失われることはありません。

### 2-2. 設定ファイル（`backend/config/soil_moisture.yaml`）
```yaml
alerts:
  channels:
    inapp: true
    webhooks:
      - name: Slack        # 管理画面・送信履歴に表示されるラベル
        url: https://hooks.slack.com/services/XXXX/YYYY/ZZZZ
        format: json       # json | line_notify | text
        token: ""          # line_notify で使用（任意）
        headers: {}        # 任意のカスタムヘッダー（map）
        timeout: 10        # タイムアウト秒（任意・既定10）
      - name: LINE Notify
        url: https://notify-api.line.me/api/notify
        format: line_notify
        token: "xxxxxxxxxxxxxxxxxxxxxx"
      - name: ntfy
        url: https://ntfy.sh/olive-alert
        format: text
```

### 2-3. 旧設定（`webhook_url` / `webhook_token`）との互換性
旧バージョンの `channels.webhook_url` と `channels.webhook_token` は、
`webhooks` リストが空の場合に自動で1件のWebhookエントリへ変換されて動作します。
- `webhook_token` あり → `format: line_notify`
- `webhook_token` なし → `format: json`

## 3. フォーマット別の詳細仕様

全ての形式で、通知本文 `text` は次の文字列が使われます。
```
[<severity>] <title>
<body>
```
`severity` は `info`（正常・復旧） / `warning`（リマインド・水分異常・APIエラー） /
`critical`（データ停止） / `test`（テスト通知）。

### 3-1. `json`（既定）
`Content-Type: application/json` で以下のJSONをPOSTします。

```json
{
  "title": "土壌水分センサー: データ更新停止",
  "body": "最終データ: 2026-09-11T06:37:38Z（約101時間前）\nセンサー1 4.3% / センサー2 78.08%",
  "severity": "critical",
  "type": "sensor_alert",
  "service": "olive-msystem"
}
```

| フィールド | 内容 |
|-----------|------|
| `title` | 通知タイトル |
| `body` | 詳細本文（改行を含む） |
| `severity` | 重要度（info / warning / critical / test） |
| `type` | 固定値 `sensor_alert` |
| `service` | 固定値 `olive-msystem` |

### 3-2. `line_notify`
`Content-Type: application/x-www-form-urlencoded` で、`Authorization: Bearer <token>`
を付けて送信します。ボディは `message=<text>`（URLエンコード済み）。

```
POST /api/notify HTTP/1.1
Host: notify-api.line.me
Authorization: Bearer <LINE_NOTIFY_TOKEN>
Content-Type: application/x-www-form-urlencoded

message=%5Bcritical%5D%20%E3%83%87%E3%83%BC%E3%82%BF%E6%9B%B4%E6%96%B0%E5%81%9C%E6%AD%A2...
```

### 3-3. `text`
`Content-Type: text/plain; charset=utf-8` で `text` 本文をそのまま送信します。
ntfy や、そのまま文字列を表示してくれるAPI向けです。

```
POST /olive-alert HTTP/1.1
Host: ntfy.sh
Content-Type: text/plain; charset=utf-8

[critical] 土壌水分センサー: データ更新停止
最終データ: 2026-09-11T06:37:38Z（約101時間前）
```

## 4. 各サービスの導入例

### Slack
1. Slack App で [Incoming Webhook](https://api.slack.com/messaging/webhooks) を作成しURLを取得。
2. 管理画面で Webhook 追加: 形式 `JSON`、URLに `https://hooks.slack.com/services/Txx/Byy/zzz` を設定。
3. Slackでは `body` がチャンネルにそのまま投稿されます。

### Discord
1. チャンネル設定 → 連携サービス → Webhook を作成。
2. URL（`https://discord.com/api/webhooks/...`）を形式 `JSON` で設定します。

### Microsoft Teams
1. Teams チーム → チャネル → コネクタ → Incoming Webhook を追加。
2. URL を形式 `JSON` で設定します（TeamsはJSONの `title` / `text` を表示）。

### LINE Notify
1. https://notify-api.line.me/my/ でトークンを発行。
2. 形式 `LINE Notify`、URL `https://notify-api.line.me/api/notify`、トークンに発行値を設定。
3. 「テスト通知を送信」で LINE に届くことを確認。

### ntfy（お手軽・トークン不要）
1. トピック名を決める（例: `olive-alert`）。
2. 形式 `テキスト`、URL `https://ntfy.sh/<トピック名>` を設定。
3. スマホアプリで同じトピックを購読すれば通知が届きます。

## 5. カスタムヘッダーとタイムアウト

`headers` はオブジェクトで渡し、値はすべて文字列化して送信時に付与します。
（例: 自作APIでのAPIキー認証や、Webhookサービス独自のヘッダーなど。）

```yaml
- name: 自作API
  url: https://example.com/hooks/sensor
  format: json
  headers:
    X-API-Key: "my-secret"
    X-Sensor: "field-01"
  timeout: 15
```

タイムアウトは秒単位。未指定時は10秒です。設定値を超えるとそのWebhookは失敗扱いになります。

## 6. エラー処理・再送について

- 送信に失敗したWebhookは**その回の通知ではエラー扱い**（HTTP 4xx/5xx、接続・タイムアウト）。
- 監視ループ側は失敗してもアラート自体の状態遷移（リマインド・復旧通知）は
  **継続します**（1回の失敗で通知を見逃しません）。
- テスト通知（`POST /api/admin/soil-config/test-notification`）のレスポンスには
  **チャネルごとの成功/失敗と理由（detail）** が返るため、疎通確認に使えます。
- 現状、Webhookの自動再送信（リトライ）は行いません。段階リマインド
  （`remind_hours`）が実質的な再送の役割を担います。

## 7. セキュリティ上の注意

- トークンを公開リポジトリへコミットしないでください。
  設定は `backend/config/soil_moisture.yaml`（.gitignore対象）で管理します。
- 管理画面API（/api/admin/soil-config）は管理者権限でのみアクセスできます。
- 受信側のWebhook URLは**HTTPSを推奨**します（トークンや本文が平文で流れないように）。

## 8. 関連API

| メソッド他 | パス | 説明 |
|-----------|------|------|
| `GET` | `/api/sensor-alerts` | 監視状態・設定（チャネルはマスク表示）・送信履歴 |
| `POST` | `/api/admin/soil-config/test-notification` | 全有効チャネルへテスト通知（管理者） |

### テスト通知レスポンス例
```json
{
  "results": [
    { "channel": "inapp", "ok": true, "detail": null },
    { "channel": "webhook", "name": "Slack", "ok": true, "detail": null },
    { "channel": "webhook", "name": "LINE Notify", "ok": false, "detail": "HTTP 401" },
    { "channel": "line_bot", "ok": true, "detail": null }
  ]
}
```
失敗したチャネルは `detail` に原因（`HTTP <status>` / 接続エラー文）が入ります。

## 9. よくある質問

- **Webhookが届かない**
  1) テスト通知を送信し `detail` を確認（401=トークン誤り、404=URL誤り、接続エラー=URL/ネットワーク）。
  2) 設定ファイルが `soil_moisture.yaml`（gitignore）にあり、`alerts.enabled: true` であること。
  3) 通知元の監視スレッドが動いていること（`GET /api/sensor-alerts` の `enabled` を確認）。
- **トークンが画面上で `*****xxxx` としか見えない**
  仕様です。秘密情報を隠しています。値は保存時に自動復元されるためそのまま保存してください。
- **同じ内容が複数来る / 順番がバラバラ**
  各Webhookへは独立に送信されます。受信側の表示タイミング差によるものです。
- **自動リトライしてほしい**
  現状リトライはありません。多数の失敗が発生する場合は確認のうえ、運用でフォローしてください。