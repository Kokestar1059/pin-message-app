import './style.css'
// Leaflet 本体の CSS。これが無いとタイルやズームボタンの配置が崩れる（忘れがちな必須 import）。
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Supabase クライアント（src/supabase.js で1個だけ生成して使い回す）。投稿の保存に使う。
import { supabase } from './supabase.js'
// #14 のハバーサイン距離関数。#15 の近接判定（現在地 ↔ ピン）で使う。
import { distanceMeters } from './distance.js'

// 初期表示の中心とズーム。少人数で使う PoC なので暫定で日本（東京駅）。現地で調整する前提。
const INITIAL_CENTER = [35.681236, 139.767125]
const INITIAL_ZOOM = 13

// --- #15 近接ロック解除のしきい値 ---
// 現在地とピンの距離がこの値（メートル）未満なら本文を開く。CLAUDE.md §6 の通り
// 30〜50m から開始（GPS 誤差 5〜20m を吸収）。現地で調整する前提の暫定値（#16/#18）。
const THRESHOLD_M = 50

// index.html の <div id="map"> に地図を割り当て、初期の中心・ズームを設定する。
const map = L.map('map').setView(INITIAL_CENTER, INITIAL_ZOOM)

// OSM のタイルを地図に重ねる。attribution（著作権表示）は OSM 利用上のマナーで必須。
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map)

// --- #16 ピンの見た目（ミニマル刷新） ---
// メッセージピンは既定の雫アイコン（L.Icon.Default の画像）をやめ、L.divIcon に切り替える。
// 狙い: 見た目を CSS（.pin-marker / ui-designer 所有）に持たせ、ロジックは「型」だけ持つ
// （§14 の役割分担）。divIcon は className を渡すと既定の白い四角スタイル（leaflet-div-icon）を
// 名乗らないので、.pin-marker だけが効く。これで marker-icon.png の Vite 画像URL解決ハックも不要に。
// iconSize/iconAnchor: 18×18 の箱を、その中心 [9,9] が座標に来るよう置く（中央寄せの点）。
const pinIcon = L.divIcon({ className: 'pin-marker', iconSize: [18, 18], iconAnchor: [9, 9] })
// 投稿前の仮ピンは「まだ確定していない下書き」。同じ型に --draft を足し、CSS で控えめに見せ分ける。
const draftPinIcon = L.divIcon({
  className: 'pin-marker pin-marker--draft',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

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

// 1行（messages の1レコード）を地図のマーカーにして登録する共通関数。
// SELECT（#10 起動時の全件描画）と Realtime（#11 新規 INSERT）の両方から呼ぶ。
// 重複防止: 既に同じ id を描いていたら何もしない。これにより「起動時 SELECT と
// 購読が同じ行を二重に届けても1回しか描かない」が保証され、両者の到着順を気にせず済む。
// markersById を Map にした布石（id で O(1) 参照）がここで効く。
function addMarker(row) {
  if (markersById.has(row.id)) return
  // 緯度経度は Leaflet の [lat, lng] 順（地図クリック時の e.latlng と同じ並び）。
  const marker = L.marker([row.lat, row.lng], { icon: pinIcon }).addTo(map)
  // #15 タップ処理は1か所（onMarkerTap）に集約する（Issue #15 コメントの指示）。
  // row をクロージャで閉じ込めるので、このマーカーがどの行かを onMarkerTap が知れる。
  // 将来 #32（自分のピン → 管理モーダル）の分岐も onMarkerTap に足すだけで済む。
  marker.on('click', () => onMarkerTap(row))
  markersById.set(row.id, marker)
}

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
    tempMarker = L.marker(e.latlng, { icon: draftPinIcon }).addTo(map) // 初回だけ新規作成
  }
  openModal()
})

// キャンセル／オーバーレイ（カード外の暗い部分）クリックで投稿を取りやめる。
cancelBtn.addEventListener('click', cancelPost)
overlay.addEventListener('click', cancelPost)

// Esc キーでも閉じる。モーダルは aria-modal を名乗っているので、キーボードでも閉じられる
// 状態に揃える（開いているときだけ反応させる）。
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!modal.hidden) cancelPost() // 投稿モーダル
  if (!viewModal.hidden) closeViewModal() // 閲覧モーダル（#15）
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

// --- #15 閲覧モーダル（マーカータップ → 近ければ本文 / 遠ければロック） ---
// 見た目は ui-designer が用意済み（index.html / style.css）。ここでは DOM 契約（ID）に従って
// 要素を掴み、3状態のどれを見せるかの「ロジック」だけを書く。
// 大原則（CLAUDE.md §5 原則1）: ロック状態は保存しない。タップのたびに現在地との距離を
// その場で計算して開閉を決める。保存するのはピンの中身（user_name / text / lat / lng）だけ。
const viewModal = document.getElementById('view-modal')
const viewOverlay = viewModal.querySelector('.modal__overlay')
const viewName = document.getElementById('view-name')
const viewUnlocked = document.getElementById('view-unlocked') // 解錠状態（近い）
const viewText = document.getElementById('view-text') // 本文（解錠時のみ埋める）
const viewLocked = document.getElementById('view-locked') // ロック状態（遠い）
const viewNoLocation = document.getElementById('view-nolocation') // 現在地が無い状態
const viewCloseBtn = document.getElementById('view-close')

function closeViewModal() {
  viewModal.hidden = true
}

// マーカータップの単一の入口。row はそのピンの行（{id, user_name, text, lat, lng, ...}）。
// いまは認証前（#31 未実装）なので「閲覧者フロー」だけ。認証導入後は、ここで
// row.user_id === 自分.id を見て #32 の管理モーダル（距離に関係なく編集/削除）へ分岐する。
function onMarkerTap(row) {
  // 投稿者名はどの状態でも常に見せる（誰が置いたかは隠さない。隠すのは本文だけ）。
  viewName.textContent = row.user_name

  // まず3状態をすべて隠してから、これと決めた1つだけを見せる（取り違え防止）。
  viewUnlocked.hidden = true
  viewLocked.hidden = true
  viewNoLocation.hidden = true

  if (myLocation === null) {
    // 現在地が未取得（許可待ち / 取得失敗）。ここで距離計算に入ると NaN < THRESHOLD が
    // 常に false になり「永久ロック」する（#14 レビューの指摘）。だから距離判定の前に弾く。
    viewNoLocation.hidden = false
  } else {
    // 現在地 ↔ ピンの距離をその場で計算（保存しない派生情報）。
    const distance = distanceMeters(myLocation[0], myLocation[1], row.lat, row.lng)

    if (distance < THRESHOLD_M) {
      // 近い → 解錠。本文（ことば）を見せる（見出しは置かず、ことばそのものを主役に）。
      viewText.textContent = row.text
      viewUnlocked.hidden = false
    } else {
      // 遠い → ロック。残り距離は出さない（#16）。位置は地図のピン＋現在地で分かるし、
      // 「あと◯m」の計器表示は手紙を辿る体験の情緒を壊す。状態（まだ・ここに在る）だけ静かに見せる。
      viewLocked.hidden = false
    }
  }

  viewModal.hidden = false
}

// 閉じる: ボタン / オーバーレイ（カード外）クリック。
viewCloseBtn.addEventListener('click', closeViewModal)
viewOverlay.addEventListener('click', closeViewModal)

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

  // 各行をマーカーにして地図に乗せる（生成・登録・重複防止は addMarker に集約）。
  for (const row of data) {
    addMarker(row)
  }
}

// 起動時に1回だけ呼ぶ。async だが「投げっぱなし」でよい（描画完了を待つ相手がいない）。
loadMessages()

// --- #11 Realtime 購読で新規ピンを即反映 ---
// 骨格は「習ったチャットの Realtime 購読」と同じ（CLAUDE.md §5 原則2）。変わるのは
// 受信時の出力先がリスト追加 → 地図マーカー（= addMarker）だけ。
// 受信 payload の new に新規行（{id, user_name, text, lat, lng, created_at}）が入る。
// 自分の INSERT もこの購読経由で1回だけ届く（送信側でローカル描画していないので二重にならない）。
// 注意: 出ないときは Supabase 側の Realtime publication 有効化と RLS の SELECT ポリシーを疑う
// （Realtime は RLS に従う / CLAUDE.md §6）。
// channel を変数に保持する理由: npm run dev の HMR でこのモジュールが再評価されるたび、
// 古い購読が残ったまま新しい購読が積み増すのを防ぐため。下の import.meta.hot で後始末する。
const messagesChannel = supabase
  .channel('messages-inserts')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages' },
    (payload) => addMarker(payload.new),
  )
  // subscribe のコールバックで購読状態を見える化する。Realtime 最大の落とし穴
  //「INSERT は成功するのに相手に出ない」は publication 未有効化 / RLS 不足で起き、
  // 無言だと切り分けにくい。SUBSCRIBED 以外（CHANNEL_ERROR / TIMED_OUT）をログに出す。
  .subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      console.log('[realtime] messages を購読開始')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error('[realtime] 購読に失敗:', status, err?.message ?? '')
    }
  })

// --- #13 Geolocation で現在地取得 + 現在地マーカー ---
// 自分の現在地を地図に出す。これは Supabase/チャット骨格とは無関係の「ブラウザ標準 API」。
// 押さえる点が3つ:
//  1) コールバック型: getCurrentPosition(success, error, options)。Promise ではないので await
//     できない。成功は success、失敗は error コールバックに分岐して届く（保存/購読の async とは別物）。
//  2) HTTPS 必須（localhost は例外で可）。npm run dev は localhost、本番は GitHub Pages の HTTPS
//     （#17）で満たす。http の本番では呼んでも拒否される。
//  3) 取得は1回だけ（getCurrentPosition）。移動に追従させたい近接ロック解除（#15）は、そのとき
//     watchPosition を検討する。#13 は「現在地を出す」だけなので1回で十分。

// 現在地マーカーは「常に1個」をモジュール変数で持つ（仮ピン tempMarker と同じ発想）。
// 取得し直したら setLatLng で“移動”させ、増やさない。
let myLocationMarker = null

// #15 近接判定で使う「最新の現在地座標」[lat, lng]。watchPosition が更新する。
// null = まだ一度も取れていない（許可待ち / 失敗）。onMarkerTap はこれが null なら
// 距離計算に入らず「現在地なし」状態を出す（NaN による永久ロックを避ける）。
let myLocation = null

// 取得成功: 緯度経度を受け取り、現在地マーカーを置く（or 移動）。
// メッセージピン（#16 で墨の点 divIcon = .pin-marker に刷新）と一目で区別するため、
// 現在地は色相を変えた circleMarker（青い丸）にする。
// circleMarker の色・半径は JS 内で完結する（CSS 不要）ので main.js（ロジック側）に収まる。
function showMyLocation(position) {
  // 緯度経度は position.coords に入る。Leaflet は [lat, lng] 順なので並べ替えて使う。
  const { latitude, longitude } = position.coords
  const latlng = [latitude, longitude]

  // #15 近接判定が読む最新座標を更新（watchPosition が動くたびここが呼ばれ、追従する）。
  myLocation = latlng

  if (myLocationMarker) {
    myLocationMarker.setLatLng(latlng) // 既存を移動（1個を保つ）
  } else {
    // radius はピクセル単位。色で「現在地」を表す（Google マップ風の青）。
    myLocationMarker = L.circleMarker(latlng, {
      radius: 8,
      color: '#1a73e8', // 枠線
      fillColor: '#1a73e8', // 塗り
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map)

    // 初回取得時のみ自分が画面内に来るよう地図を寄せる（ズームは維持）。
    // 再取得でユーザーのパン/ズーム操作を奪わないよう、リセンタリングは初回だけに限定する
    // （#15 で watchPosition に切り替えても追従中に視点を奪わない布石）。
    map.setView(latlng, map.getZoom())
  }
}

// 取得失敗: error.code で原因を分岐。PoC なので「拒否」だけ alert で気づかせ、他は console に留める。
// 定数（PERMISSION_DENIED など）は error オブジェクト自身が持つので error.PERMISSION_DENIED で比較できる。
function onLocationError(error) {
  if (error.code === error.PERMISSION_DENIED) {
    console.warn('[geolocation] 位置情報が拒否されました')
    alert(
      '位置情報が使えないと、現地に行ってもメッセージを開けません。ブラウザの許可をご確認ください。',
    )
  } else if (error.code === error.POSITION_UNAVAILABLE) {
    console.error('[geolocation] 現在地を取得できませんでした（電波 / GPS）')
  } else if (error.code === error.TIMEOUT) {
    console.error('[geolocation] 現在地の取得がタイムアウトしました')
  }
}

// #15: 起動時に watchPosition で「追従」を開始する（#13 の getCurrentPosition 1回から変更）。
// 近接ロック解除は「現地に着いてタップしたら最新の現在地で判定」が要なので、移動に合わせて
// myLocation を更新し続ける必要がある。watchPosition は位置が変わるたび success を呼ぶ。
// 戻り値は watch id で、clearWatch で止められる（HMR の後始末で使う）。
//  enableHighAccuracy: GPS を優先（近接判定の精度に効く。バッテリーは食う）。
//  timeout: 1回あたりの取得上限（10 秒）。
//  maximumAge: 0 でキャッシュの古い位置を使い回さず毎回新しく取る。
let geoWatchId = null
if ('geolocation' in navigator) {
  geoWatchId = navigator.geolocation.watchPosition(showMyLocation, onLocationError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  })
} else {
  console.error('[geolocation] このブラウザは位置情報に対応していません')
}

// HMR 時の後始末（開発時のみ。本番ビルドではこのブロックは取り除かれる）。
// 古い購読を解除し、現在地マーカーも消してから新モジュールが張り直すことで、
// チャンネル・マーカーの積み増しを防ぐ（マーカーを増やさない既存思想と揃える）。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    supabase.removeChannel(messagesChannel)
    myLocationMarker?.remove()
    // watchPosition は止めないとモジュール再評価のたびに監視が積み増す。clearWatch で解除。
    if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId)
  })
}
