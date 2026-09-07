# olive-msystem

オリーブの体調（健康状態）を、**オリーブキャラクターの表情**で客観的に見える化するWebダッシュボード。

-olive-p の解析アルゴリズムをそのまま利用しつつ、
- 動画の**指定した時刻**でフレーム抽出 → 解析 → 保存
- 動画の**連続アップロード**（キューでバックグラウンド解析）に対応

## 構成

```
olive-msystem/
├── backend/            FastAPI (Python) + olive-p アルゴリズム
│   └── app/
│       ├── analyzer.py      # olive-p の Analyzer / VideoProcessor をラップ
│       ├── health.py        # 体調スコア → キャラクター状態のマッピング
│       ├── runner.py        # 連続アップロード・解析のバックグラウンドキュー
│       ├── storage.py       # SQLite 永続化 (videos / observations)
│       └── main.py          # FastAPI ルート
└── frontend/           Next.js 14 (App Router) + Tailwind CSS v3
    └── app/
        ├── page.tsx         # ダッシュボード（アップロード・解析・結果）
        └── olive/page.tsx   # オリーブキャラクター体調ページ
```

- 解析アルゴリズムは `C:\Users\yakit\Downloads\olive-p` の
  `src/runtime.py`（`Analyzer`）と `src/video_processor.py`（`VideoProcessor`）を
  `backend/app/analyzer.py` からインポートしてそのまま流用。
- フロントの `/api` と `/storage` は `next.config.mjs` の rewrites で
  FastAPI（`127.0.0.1:8000`）へプロキシ。

## 体調の判定

`overall_health_score`（0〜1）をもとに4段階で判定します。

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

### 2. フロントエンド（Next.js, ポート 3000）

```powershell
cd frontend
npm install
npm run dev -- -p 3000
```

ブラウザで http://localhost:3000 を開いてください。

### 一括起動

`start.bat` をダブルクリックするか、コマンドラインで実行すると
バックエンドとフロントエンドをまとめて起動します。

## 主なAPI

- `GET /api/health` … ヘルスチェック
- `POST /api/videos` … 動画アップロード（multipart）
- `POST /api/videos/{id}/analyse` … 数値時刻（秒）で解析 `{"times":[0,5,10]}`
- `POST /api/videos/{id}/analyse-times` … 人が読める形式の時刻指定で解析
  `{"times":["00:00:15","00:01:00","90"]}`
- `GET /api/videos/{id}/observations` … 解析結果一覧
- `GET /api/olive/status` … 最新の体調（キャラクター表示用）
- `GET /storage/...` … 保存された注釈付きフレーム等の静的配信

## データ保存先

- SQLite DB: `backend/app/data/olive_mstore.db`
- フレーム画像: `backend/storage/<video_id>/...`
