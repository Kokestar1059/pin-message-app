import './style.css'
import { supabase } from './supabase.js'

// scaffold 確認用の最小表示。Phase 2 で地図に置き換える。
document.querySelector('#app').innerHTML = `<p>ピンメッセージ — 土台 OK</p>`

// 接続確認（#5）: messages を取得してコンソールに出すだけ。Phase 2 で地図描画に置き換える。
const { data, error } = await supabase.from('messages').select('*')
if (error) {
  console.error('Supabase 接続エラー:', error)
} else {
  console.log('messages 取得 OK:', data)
}
