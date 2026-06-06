import './style.css'
// Leaflet 本体の CSS。これが無いとタイルやズームボタンの配置が崩れる（忘れがちな必須 import）。
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

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
