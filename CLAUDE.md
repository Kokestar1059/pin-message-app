# CLAUDE.md — ピンメッセージ（仮称）

このファイルは Claude Code が**毎セッション読み込む**「プロジェクトの確定事項と恒久ルール」です。
設計の経緯・詳細な背景は [spec_pin_message_app.md](spec_pin_message_app.md)（**単一の真実の源**）を参照してください。

---

## 1. このプロジェクトは何か

特定の場所にテキストメッセージを「置いて」おき、**その場所に物理的に行った人だけが開ける**ウェブアプリ。
位置情報メッセージ／デジタル宝探しのジャンル。2人（自分とパートナー）で使う **PoC**。

体験のコア:
- 投稿者は地図上の任意の場所にピンを立て、ひとことメッセージを添えて置く。
- ピンの場所は地図に**常に見える**（隠さない）。「いつかそこへ行ったら開こう」という気持ちを誘発するため。
- 受信者はその場所に実際に行くと、GPS で近接が検知され、ロックが外れてメッセージを読める。

---

## 2. スコープと Non-Goals

2人・**認証なし**の PoC。以下は**勝手に作らない**（必要だと思ったら必ず提案して確認を取る）:

- ユーザー認証・ログイン・サインアップ
- 「一度開けたら永久に読める」永続化（v2 で localStorage を想定）
- サーバ側での距離判定 / PostGIS（v2 候補）
- React 化（v2）
- 通知・友達機能・複数ルーム・画像添付などの追加機能
- 早すぎる抽象化（状態管理ライブラリ導入などの汎用化）

---

## 3. 技術スタック（確定事項）

| 領域 | 採用 |
|------|------|
| 言語/構成 | **vanilla JS（ES モジュール）+ Vite**。React は v2 に回す |
| 地図 | **Leaflet + OpenStreetMap**（API キー・課金・カード登録なしで完全無料） |
| BaaS | **Supabase（Postgres + Realtime）**、`@supabase/supabase-js` |
| ホスティング | **public リポジトリ + GitHub Pages**（HTTPS。Geolocation 要件を満たす） |

**ルール:**
- **依存追加は上記スタックに限定**。それ以外を入れたくなったら、**入れる前に必ず相談**する。
- **jQuery は使わない**。vanilla JS（ES モジュール）で書く。
- **ライブラリを使うときは context7 で最新を裏取りしてから使う**（Leaflet / supabase-js / Vite など）。
  記憶に頼らず、最新の API・バージョン・推奨手順を確認してから実装する。

---

## 4. データモデル（Supabase）

テーブル `messages`:

| カラム | 型 | 備考 |
|--------|------|------|
| `id` | `uuid` default `gen_random_uuid()` | 主キー |
| `user_name` | `text` | 投稿者名 |
| `text` | `text` | ひとことメッセージ |
| `lat` | `float8` | ピンの緯度（地図クリックで取得） |
| `lng` | `float8` | ピンの経度 |
| `created_at` | `timestamptz` default `now()` | Postgres が自動付与 |

**ロックの開閉状態はこのテーブルに持たせない**（§5 原則1）。

---

## 5. 重要原則

1. **ロック状態は保存しない**（その場で計算する派生情報）。
   `unlocked = distance(現在地, ピン) < THRESHOLD` を**毎回その場で計算**する。
   保存するのはピンの中身（`user_name / text / lat / lng`）だけ。開けるか否かは人ごと・移動ごとに変わるので計算で出す。
2. **骨格は「習ったチャット」**。チャットの 1 件 `{ userName, text }` に座標を足しただけ。
   保存（INSERT）と受信（Realtime 購読）の型はチャットと同じ。**変わるのは「表示先がリスト → 地図」だけ**。
3. **まず再ロック方式で作る**。「離れたら再ロック」は記録不要で 1 行の距離計算だけ。
   「永久に見られる」は過去の事実を記録する一手間が増えるので v2。

---

## 6. 実装の要点

- **Geolocation**: `navigator.geolocation.getCurrentPosition(success, error, options)`。コールバック型。
  **HTTPS 必須**（localhost は可）。許可ダイアログが出る。連続追従が要れば `watchPosition` を検討。
- **距離判定（ハバーサイン）**: 2 点の緯度経度から距離を出す関数を 1 個用意して使い回す。
  `THRESHOLD` は **30〜50m から開始**（GPS 誤差 5〜20m を吸収。**現地で調整する前提の暫定値**）。
- **Supabase Realtime + RLS（最大の落とし穴）**:
  - 購読: `supabase.channel(...).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, cb).subscribe()`
  - 対象テーブルを **Realtime publication に追加**（ダッシュボードで有効化）する。
  - **RLS を有効化** + anon ロールに SELECT/INSERT を許す緩いポリシー（PoC 用。本番では絞る）。
  - **Realtime は RLS に従う**。SELECT ポリシーが届けたい行をカバーしないとリアルタイムが飛んでこない
    （「INSERT は成功するのに相手の画面に出ない」症状の主因）。
- **Supabase キー**: **publishable キー（`sb_publishable_...`）を使う**（レガシー anon キーではなく推奨の新方式。
  権限は anon と同等の低権限）。クライアント生成は env 経由:
  ```js
  import { createClient } from '@supabase/supabase-js'
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  )
  ```

PoC 用 RLS ポリシー（参考）:
```sql
alter table messages enable row level security;
create policy "anon can read"   on messages for select to anon using (true);
create policy "anon can insert" on messages for insert to anon with check (true);
```

---

## 7. 秘密情報の扱い（public リポジトリ前提）

- このリポジトリは **public**。**コードは世界に見える前提**で書く。
- **publishable キーはクライアント（ブラウザ）に出る設計**なので、混入しても致命的ではない（RLS で守る）。
  それでも値はハードコードせず `.env`（`VITE_SUPABASE_*`）で扱う。
- **`service_role`（秘密）キーは絶対にコミット・クライアント同梱しない**。漏れると RLS を貫通し全データ操作が可能。
- `.env` は `.gitignore` 済み。テンプレートとして `.env.example`（値なし）をコミットする。
- **pre-commit で gitleaks が走る**（`.githooks/pre-commit`、`core.hooksPath` で有効化）。
  秘密混入を検知したらコミットを止める。誤検知は `.gitleaks.toml` の allowlist で除外する。

---

## 8. コマンド

> scaffold（Vite 立ち上げ）後に実コマンドへ更新する。現時点は Vite vanilla の想定値。

- `npm run dev` — 開発サーバ（localhost、HMR）
- `npm run build` — 本番ビルド（`dist/`）
- `npm run preview` — ビルド結果をローカル確認

---

## 9. ディレクトリ構成

> scaffold 後に確定したら追記する。

---

## 10. デプロイ

- **public リポジトリ + GitHub Pages**。Vite を build して `dist/` を配信。
- GitHub Actions でビルド＆ Pages デプロイ（`vite.config` の `base` をリポジトリ名に合わせる点に注意）。
- HTTPS を提供するので Geolocation 要件を満たす。

---

## 11. 働き方の約束

- 開発者は**学習中**。コードを一気に吐かず、**判断の理由を説明しながら**進める。
- **小さく・レビュー可能な単位**で進める。1 ステップごとに止めて確認を取る。
- 学習機会のある箇所は、可能なら**本人に書かせてレビューする**スタイルを優先（完成コード丸投げより、ヒントと Q&A）。
- **過剰実装しない**。2人・認証なしの PoC。§2 の Non-Goals を勝手に作らない。
- **新しい依存を入れる前に相談**する（§3 のスタック以外）。
- 既存ファイルの大規模リファクタや、認証・永続化・React 化を勝手に始めない（提案して確認を取る）。
- API キー等の秘密をコードに直書きしない。env で扱う。

---

## 12. 情報の置き場所ルール

更新情報は性質で住み分ける。**迷ったら上から判定**:

1. 始まりと終わりのある**作業**か？ → **GitHub Issue**（作業・進捗・バグ・調査結果・現地テスト記録・v2 アイデア）
2. このリポジトリで今後毎回守るべき**ルール／確定事項**か？ → **CLAUDE.md**（技術選定・原則・規約・働き方）
3. リポジトリに縛られない、開発者と Claude の**協働の文脈・好み**か？ → **Claude メモリ**

**約束:**
- **CLAUDE.md は勝手に書き換えない**。更新提案 → 確認 → コミットの順を守る。
- 作業中に出た「決定」は、恒久ルールなら CLAUDE.md へ昇格を提案、作業固有なら Issue コメントに残して close。

---

## 13. タスク管理（GitHub Issue）

- 仕様書 §9 のビルド順（土台 → 地図 → 投稿 → 表示と同期 → GPS とロック → 仕上げ+デプロイ → 実地テスト）を Issue 化して進める。
- ラベル方針: `setup` / `feature` / `bug` / `deploy` / `v2` / `chore`。
- 1 Issue = 1 まとまった作業。完了したら close。決定や詰まりはコメントに記録する。
