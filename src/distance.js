// ハバーサイン距離（#14）
// 2点の緯度経度から、地表に沿った距離をメートルで返す純粋関数。
// 「純粋」= 同じ入力なら必ず同じ出力。DOM も Supabase も時刻も触らない。
// だから単体で動作確認でき、近接ロック解除（#15）からも安心して呼べる。
//
// なぜ三平方の定理ではダメか:
//  - 地球は球。経度1度の実距離は緯度で変わる（赤道で約111km、極へ近づくほど0に縮む）。
//  - 地表の最短距離は平面の直線ではなく球面上の弧（大円距離）。
// ハバーサイン公式はこの弧長を緯度経度から正しく求める定番。GPS 誤差が数十mある
// PoC の近接判定（しきい値 数十m）には精度も十分。

// 地球の平均半径（メートル）。最後にこの半径を掛けて「角度 → 実距離」に変換する。
const EARTH_RADIUS_M = 6371000

// 度（degree）→ ラジアン（radian）変換。
// Math.sin / Math.cos などはラジアンを前提に動くので、緯度経度（度）は必ず変換してから渡す。
// 1周 = 360度 = 2π ラジアン なので、度 × (π / 180) でラジアンになる。
function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

/**
 * 2点間の距離をメートルで返す（ハバーサイン公式）。
 * 引数は度（地図クリックや Geolocation で得られる生の緯度経度をそのまま渡せる）。
 *
 * @param {number} lat1 1点目の緯度
 * @param {number} lng1 1点目の経度
 * @param {number} lat2 2点目の緯度
 * @param {number} lng2 2点目の経度
 * @returns {number} 距離（メートル）
 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  // 2点の「緯度の差」「経度の差」をラジアンにする。式が扱うのは座標そのものではなく“差”。
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  // 緯度はそれぞれラジアンで使う（経度差の効きを cos で補正するため。下の a の第2項）。
  const rLat1 = toRadians(lat1)
  const rLat2 = toRadians(lat2)

  // ハバーサイン公式の中核 a:
  //   a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
  // 直感: 第1項が南北方向のずれ、第2項が東西方向のずれ。
  //   cos(lat1)·cos(lat2) が「高緯度ほど経度差は実距離として小さい」を吸収する補正。
  // ** は累乗（sin(x) ** 2 は sin(x) の2乗 = sin²(x)）。
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2

  // a（0〜1）を中心角 c（ラジアン）に変換する。atan2 を使うのは数値的に安定だから（定番形）。
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  // 中心角（ラジアン） × 地球半径（m）= 弧の長さ（m）= 求める距離。
  return EARTH_RADIUS_M * c
}
