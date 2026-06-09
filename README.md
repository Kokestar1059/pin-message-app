# ①課題名
ピンメッセージ — 行った人だけが読める、位置情報メッセージアプリ

## ②課題内容（どんな作品か）
- 地図上の好きな場所にひとことメッセージを「置いて」おけるWebアプリのPoC。
- ピンの場所は地図に**常に見える**が、メッセージの本文は**その場所に実際に行くと（GPSで近接を検知して）はじめて開ける**。
- 「いつかそこに行ったら開こう」という気持ちを誘う、位置情報メッセージ／デジタル宝探しのジャンル。

## ③アプリのデプロイURL
https://kokestar1059.github.io/pin-message-app/

- スマホで開き、**位置情報を許可**して使うのがおすすめ（地図上の青い丸が現在地）。
- 地図をタップ → ひとこと入力 → 「置く」でピンを設置。ピンをタップすると、近ければ本文が開き、遠ければロック表示になります。

## ④アプリのログイン用IDまたはPassword（ある場合）
- 現状**ログイン不要**（誰でも閲覧・投稿できるPoC段階）。
- ※次のステップで Google ログイン（指定アカウントのみ許可）を導入予定。

## ⑤工夫した点・こだわった点
- **「ロック状態を保存しない」設計**：開けるかどうかはDBに持たず、「現在地とピンの距離 < しきい値」をその都度ハバーサイン計算で判定。人ごと・移動ごとに変わる情報を“その場で計算”する派生情報として扱った。
- **リアルタイム同期**：Supabase Realtime で、片方が置いたピンがもう片方の画面に即反映される。

## ⑥難しかった点・次回トライしたいこと（又は機能）
- **GPS まわり**：Geolocation は HTTPS 必須。GPS 誤差（5〜20m）を吸収する近接しきい値の調整が、現地テスト前提で悩みどころ。
- **Supabase Realtime × RLS**：購読対象テーブルの publication 有効化や、行レベルセキュリティ（RLS）の設定を間違えると「投稿は成功するのに相手に届かない」ことがあり、仕組みの理解が必要だった。


## ⑦フリー項目（感想、シェアしたいこと等なんでも）
- [感想] 「保存する状態」と「その場で計算する派生情報」を切り分ける設計の考え方が、作りながら腑に落ちた。小さなPoCでも、データモデルの判断が体験の質を決めると実感した。
- [技術スタック] vanilla JS（ES modules）+ Vite / Leaflet + OpenStreetMap / Supabase（Postgres + Realtime）/ GitHub Pages + Actions
- [参考記事]
  - 1. [Leaflet 公式ドキュメント](https://leafletjs.com/)
  - 2. [Supabase Docs](https://supabase.com/docs)
  - 3. [Vite — Deploying a Static Site (GitHub Pages)](https://vite.dev/guide/static-deploy.html)

---

## ローカルでの起動
```sh
npm install
npm run dev      # 開発サーバ（localhost、HMR）
npm run build    # 本番ビルド（dist/）
npm run preview  # ビルド結果をローカル確認
```
> Supabase の接続情報は `.env`（`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`）で設定します。テンプレートは `.env.example` を参照。
