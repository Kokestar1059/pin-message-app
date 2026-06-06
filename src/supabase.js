import { createClient } from '@supabase/supabase-js'

// Supabase クライアントは1個だけ作って使い回す（INSERT / Realtime も共有する）。
// publishable キー（sb_publishable_...）を使う。値は .env から読み、直書きしない（CLAUDE.md §7）。
// Vite は VITE_ 接頭辞の変数だけを import.meta.env でクライアントに露出する。
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
