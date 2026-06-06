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

map.on('click', (e) => {
  // クリック地点の緯度経度。Leaflet が e.latlng = { lat, lng } で渡してくれる。
  const { lat, lng } = e.latlng
  console.log('クリック地点:', lat, lng)

  if (tempMarker) {
    tempMarker.setLatLng(e.latlng) // 既存の仮マーカーを移動（1個を保つ）
  } else {
    tempMarker = L.marker(e.latlng).addTo(map) // 初回だけ新規作成
  }
})
