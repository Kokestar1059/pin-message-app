import { defineConfig } from 'vite'

// GitHub Pages はリポジトリ名のサブパス配下で配信される
// （公開 URL: https://kokestar1059.github.io/pin-message-app/）。
// base を付けないとアセットを /assets/... の絶対パスで探しに行き 404 になるため、
// リポジトリ名で前置きして /pin-message-app/assets/... に解決させる。
export default defineConfig({
  base: '/pin-message-app/',
})
