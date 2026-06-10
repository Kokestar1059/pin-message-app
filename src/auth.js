// #30 認証（Google OAuth）の薄いラッパ。
// 目的: 「ログイン済みか？」「ログイン開始」「ログアウト」「状態変化の購読」を
// この1ファイルに集約し、main.js からは意味の通る関数名で呼べるようにする。
// 認証の配線（プロバイダ設定）は #29 で Supabase/Google 側に済ませた前提。

import { supabase } from './supabase.js'

// Google ログインを開始する。ここが認証の心臓。
// signInWithOAuth を呼ぶと Supabase が Google の認証ページへ画面ごとリダイレクトする。
// 認証が済むと redirectTo で指定した URL（＝このアプリ）へ戻ってくる。
//
// redirectTo の組み立て方が肝:
//   window.location.origin … 本番 https://kokestar1059.github.io / 開発 http://localhost:5173
//   import.meta.env.BASE_URL … Vite が入れる base（本番 /pin-message-app/ / 開発 /）
// この2つを足すと、本番でも開発でも「アプリのトップ URL」に正しく戻れる。
// （どちらも Supabase の Redirect URLs 許可リストに登録済み。#29 手順5）
export async function signInWithGoogle() {
  const redirectTo = window.location.origin + import.meta.env.BASE_URL
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  // ここで成功するとブラウザは Google へ遷移するので、通常この先は実行されない。
  // error が返るのは「リダイレクト前に失敗した」とき（設定不備など）。
  if (error) console.error('[auth] ログイン開始に失敗:', error.message)
}

// ログアウト。セッションを破棄する。完了後 onAuthChange に SIGNED_OUT が流れる。
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) console.error('[auth] ログアウトに失敗:', error.message)
}

// ログインユーザーの表示名（Google プロフィール名）を取り出す。
// OAuth で得たプロフィール情報は session.user.user_metadata に入る。
// Google は full_name / name を入れるので順に拾い、無ければ email にフォールバック。
export function displayName(session) {
  const meta = session.user.user_metadata ?? {}
  return meta.full_name ?? meta.name ?? session.user.email
}

// 認証状態を購読する。これ1つで「初回判定」と「以後の変化」を兼ねるのがポイント:
// onAuthStateChange は登録直後に “現在のセッション” を1回流す（INITIAL_SESSION）。
// そのうえでログイン成立 / ログアウトのたびにも発火する。
// リダイレクトで戻ってセッションが確立した瞬間も拾える（detectSessionInUrl が自動処理）。
// callback には最新の session（無ければ null）を渡す。
// 戻り値の subscription は後始末用（HMR で購読が積み増さないよう unsubscribe する）。
export function onAuthChange(callback) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return subscription
}
