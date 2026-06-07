import './style.css'
// Leaflet 本体の CSS。これが無いとタイルやズームボタンの配置が崩れる（忘れがちな必須 import）。
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// --- Leaflet マーカーアイコンの修正（Vite 定番の罠） ---
// Leaflet は marker-icon.png 等を相対パスで「自動検出」して読むが、Vite はビルド時に
// 画像をハッシュ付きの名前に置き換えるため、その自動検出パスがズレて 404 になり、
// ピンが表示されない（クリックは効くが見えない）。対処は「画像を import して Vite に
// 正しい URL を解決させ、それをデフォルトアイコンに渡す」こと。
// ※ Vite では画像を import すると、変数にはビルド後の正しい URL 文字列が入る。
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
// Supabase クライアント（src/supabase.js で1個だけ生成して使い回す）。投稿の保存に使う。
import { supabase } from './supabase.js'

// 公式定石: デフォルトアイコン（Icon.Default）の「画像URLだけ」を import した正しい URL に差し替える。
// サイズ・アンカー等は Leaflet 既定値のままで良いので指定しない（mergeOptions は渡した分だけ上書き）。
// delete _getIconUrl: Icon.Default は本来「相対パスから URL を自動生成」する独自メソッドを持つ。
// これを消して基底 Icon の挙動（options の iconUrl 等をそのまま使う）に戻すことで、import した URL が確実に効く。
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

// 初期表示の中心とズーム。2人で使う PoC なので暫定で日本（東京駅）。現地で調整する前提。
const INITIAL_CENTER = [35.681236, 139.767125]
const INITIAL_ZOOM = 13

// index.html の <div id="map"> に地図を割り当て、初期の中心・ズームを設定する。
const map = L.map('map').setView(INITIAL_CENTER, INITIAL_ZOOM)

// OSM のタイルを地図に重ねる。attribution（著作権表示）は OSM 利用上のマナーで必須。
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map)

// --- #7 地図クリックで座標取得 → 仮マーカー ---
// 仮マーカーは「常に1個だけ」をモジュール変数で持ち回す。クリックのたびに新規作成すると
// ピンが増え続けるので、既にあれば setLatLng で“移動”させ、無いときだけ新規作成する。
// （この仮マーカーは「これから置く場所」のプレビュー。保存＝INSERT は #9 で行う。）
let tempMarker = null

// --- #10 保存済みピンの描画 ---
// id → Leaflet マーカーの対応表。配列ではなく Map を使うのは「id で引ける」ようにするため。
// これは #11（Realtime）への布石: INSERT が飛んできたとき「もう描いた id か？」を判定したり、
// 将来その id のマーカーを更新/削除したくなったときに O(1) で引ける。
const markersById = new Map()

// --- #8 投稿モーダル ---
// 見た目は ui-designer が index.html / style.css に用意済み。ここでは DOM 契約（ID）に従って
// 要素を掴み、開閉と後始末のロジックだけを書く。開閉は #post-modal の hidden 属性で行う約束。
const modal = document.getElementById('post-modal')
const overlay = modal.querySelector('.modal__overlay')
const nameInput = document.getElementById('post-name')
const textInput = document.getElementById('post-text')
const submitBtn = document.getElementById('post-submit')
const cancelBtn = document.getElementById('post-cancel')

function openModal() {
  modal.hidden = false
  nameInput.focus() // すぐ打てるように名前欄へフォーカス
}

function closeModal() {
  modal.hidden = true
}

// 仮ピンを地図から消して参照も捨てる（後始末の中核）。
function removeTempMarker() {
  if (tempMarker) {
    tempMarker.remove()
    tempMarker = null
  }
}

// 投稿をやめたときの後始末: モーダルを閉じ、仮ピンを消し、入力欄もクリアする。
function cancelPost() {
  closeModal()
  removeTempMarker()
  nameInput.value = ''
  textInput.value = ''
}

map.on('click', (e) => {
  // クリック地点に仮ピンを置き（移動 or 新規）、続けて投稿モーダルを開く。
  if (tempMarker) {
    tempMarker.setLatLng(e.latlng) // 既存の仮マーカーを移動（1個を保つ）
  } else {
    tempMarker = L.marker(e.latlng).addTo(map) // 初回だけ新規作成
  }
  openModal()
})

// キャンセル／オーバーレイ（カード外の暗い部分）クリックで投稿を取りやめる。
cancelBtn.addEventListener('click', cancelPost)
overlay.addEventListener('click', cancelPost)

// Esc キーでも閉じる。モーダルは aria-modal を名乗っているので、キーボードでも閉じられる
// 状態に揃える（開いているときだけ反応させる）。
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) cancelPost()
})

// 「ここに置く」ボタン。入力内容を Supabase に保存する。
// 骨格は「習ったチャットの保存」と同じで、座標 lat/lng を足しただけ（CLAUDE.md §5 原則2）。
submitBtn.addEventListener('click', async () => {
  // 仮ピン無しでこのボタンが押される経路は現状ないが、将来の改修に備えた防御。
  if (!tempMarker) return

  const userName = nameInput.value.trim()
  const text = textInput.value.trim()
  // 名前・メッセージが空なら何もしない（最小ガード。UI での明示は #16 で調整）。
  if (!userName || !text) return

  // 仮ピンの座標が、これから保存するメッセージの場所になる。
  const { lat, lng } = tempMarker.getLatLng()

  // 二重送信防止: 保存中はボタンを無効化する。
  submitBtn.disabled = true
  // INSERT。カラム名は §4 のデータモデルに合わせる（user_name は snake_case）。
  // id / created_at は Postgres が自動付与するので渡さない。
  const { error } = await supabase
    .from('messages')
    .insert({ user_name: userName, text, lat, lng })
  submitBtn.disabled = false

  if (error) {
    // 失敗時はモーダルを開いたまま、やり直せるように知らせる（PoC は alert で最小限）。
    console.error('保存に失敗:', error.message)
    alert('保存に失敗しました。通信状況を確認してもう一度お試しください。')
    return
  }

  // 成功時のみ後始末。保存済みピンが地図に出るのは #10（SELECT 描画）/ #11（Realtime）。
  cancelPost()
})

// --- #10 起動時に保存済みピンを全件 SELECT → 地図に描画 ---
// 骨格は #5 の「SELECT で取得確認」と同じ。変わるのは出力先が console → 地図のマーカーだけ
// （CLAUDE.md §5 原則2）。ロックの開閉判定・近接チェックはまだ書かない（§2 Non-Goal）。
// ここでは「並べるだけ」。text の中身（メッセージ本文）も popup には出さない:
// 「その場所に行った人だけが読める」が体験の核なので、近接解錠は後続 Issue で扱う。
async function loadMessages() {
  // 全件 SELECT。INSERT と同じ messages テーブルが相手（型はチャットに lat/lng を足しただけ）。
  const { data, error } = await supabase.from('messages').select('*')

  if (error) {
    // 取得失敗時は地図を白紙のまま残し、原因をコンソールに出す（PoC は最小限）。
    console.error('ピンの読み込みに失敗:', error.message)
    return
  }

  // 各行をマーカーにして地図に乗せ、id → marker を対応表に登録する。
  // 緯度経度は Leaflet の [lat, lng] 順で渡す（地図クリック時の e.latlng と同じ並び）。
  for (const row of data) {
    const marker = L.marker([row.lat, row.lng]).addTo(map)
    markersById.set(row.id, marker)
  }
}

// 起動時に1回だけ呼ぶ。async だが「投げっぱなし」でよい（描画完了を待つ相手がいない）。
loadMessages()
