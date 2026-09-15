# 農園マップと樹木台帳 (farm-map / tree registry)

`/farm-map` は、**樹木台帳（レジストリ）**に登録された樹木を農園の地図上に配置し、
各樹木の最新の体調（健康/良好/注意/要管理/未観測）を色分けして表示します。

## 樹木台帳 (trees テーブル)

`backend/app/storage.py` の `trees` テーブルが樹木を管理します。

| カラム | 説明 |
|--------|------|
| `id` | PK |
| `user_id` | どの農家の樹木か（必須） |
| `tree_id` | 樹木ID（同じ農家内で一意。観測データと突合に利用） |
| `name` | 樹木名（任意） |
| `variety` | 品種（任意） |
| `row_num` / `col_num` | 畝/列（地図上の固定配置に使用） |
| `note` | 備考 |

登録・編集・削除は管理画面の「農園マップ」（樹木台帳テーブル）または API で行います。
**管理者は必ず `target_user_id` で対象農家を指定**する必要があります（`/api/trees/registry`）。

### API

| メソッド/パス | 説明 |
|---------------|------|
| `GET /api/trees/registry?target_user_id=4` | 農家4の樹木台帳一覧 |
| `POST /api/trees/registry` | 樹木登録（`{target_user_id, tree_id, name, variety, row_num, col_num, note}`） |
| `PUT /api/trees/registry/{tree_id}?target_user_id=4` | 更新（tree_id / row_num / col_num 等） |
| `DELETE /api/trees/registry/{tree_id}?target_user_id=4` | 削除 |
| `POST /api/trees/import` | まとめて登録（配列） |
| `GET /api/farm-map?target_user_id=4` | 農園マップ用データ（登録樹木＋観測状態） |

認証: 農家は自分の分のみ操作可。管理者は `target_user_id` 指定が必要。

### 農園マップの表示規則

- **台帳に登録済みの樹木**は `row_num` / `col_num` から決定的に計算した固定座標に
  配置されます。
  - 座標は `x = 70 + (col-1)*118 + 59`、`y = 70 + (row-1)*130 + 65` のグリッド。
- **観測にはあるが台帳に未登録の樹木**は、自動的に空きセルへ配置され
  `registered: false` とマークされ、ワンクリックで台帳へ自動登録できます。
- 各樹木は最新観測の体調で色分け（happy=緑 / good=黄緑 / caution=黄 / danger=赤 /
  未観測=グレー破線）。クリックで観測回数・最終観測日時・状態メッセージを表示し、
  「観測履歴へ」リンクは `/tracking?tree=<tree_id>` に遷移します。

## サンプルデータの付与

動作確認用のサンプルとして、農家アカウントの `tree_id` 未設定観測に `A-01`〜`A-16` の
デモIDを振るスクリプトがあります。

```powershell
cd backend
.\.venv\Scripts\python.exe tools\assign_sample_tree_ids.py
```

このスクリプトは何度でも再実行でき、実解析で入力済みのIDは上書きしません
（実稼働のtree_idはそのまま）。なお `A-01`〜`A-16` は樹木台帳（`POST /api/trees/import` 等）に
別途登録することで地図上に固定配置されます。

## フロントの画面要素

- 地図（樹木ノード + クリックで詳細パネル）
- 樹木台帳テーブル（登録/編集/削除、新規登録モーダル、一括import）
- 集計カード（総樹木数 / 要管理・注意の本数）
- 「注意・要管理のみ強調」フィルタ
- 表示モード切り替え: あなたの農園 / 管理者は農家切り替え