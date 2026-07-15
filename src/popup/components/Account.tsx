import React, { useEffect, useState } from 'react'
import {
  getStoredAuth, signIn, signUp, signOut, signInWithGoogle, type AuthState,
} from '../../firebase/auth'
import { syncNow } from '../../firebase/sync'
import { t as tr, type Lang } from '../../i18n'
import { trackSignIn, trackSignOut } from '../../analytics/track'

const FONT = "'Space Grotesk', -apple-system, sans-serif"
const GREEN = '#22c55e'

const input: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6, color: '#fff', fontSize: 12, padding: '7px 10px', fontFamily: FONT, boxSizing: 'border-box',
}
const label: React.CSSProperties = {
  color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
  display: 'block', marginBottom: 4,
}
const btn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 800,
  padding: '9px 0', cursor: 'pointer', fontFamily: FONT, letterSpacing: 0.5, width: '100%',
})

function GoogleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

export function AccountSection({ lang, mode = 'full' }: { lang: Lang; mode?: 'full' | 'banner' }) {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [ready, setReady] = useState(false)
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(true)   // banner: full-screen login modal shown by default

  useEffect(() => {
    getStoredAuth().then(a => { setAuth(a); setReady(true) })
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes.__pmAuth) return
      const a = (changes.__pmAuth.newValue as AuthState) ?? null
      setAuth(a); setWallet(a?.walletAddress ?? '')
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  async function submit() {
    setErr(''); setBusy(true)
    try {
      await (authMode === 'in' ? signIn : signUp)(email.trim(), pw)
      trackSignIn('email')
      setEmail(''); setPw('')
      syncNow().catch(() => {})
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setErr(''); setBusy(true)
    try {
      await signInWithGoogle()
      trackSignIn('google')
      syncNow().catch(() => {})
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur Google')
    } finally {
      setBusy(false)
    }
  }

  const googleBtn = (
    <button disabled={busy} onClick={google} style={{
      ...btn('#fff', '#1f1f1f'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      opacity: busy ? 0.6 : 1,
    }}>
      <GoogleGlyph /> {tr(lang, 'acc.google')}
    </button>
  )

  const orDivider = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
      {tr(lang, 'acc.or')}
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
    </div>
  )

  // Shared login/signup form (email + password)
  const loginForm = (
    <>
      <input style={input} type="email" placeholder={tr(lang, 'acc.email')} value={email}
        onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <input style={input} type="password" placeholder={tr(lang, 'acc.pw')} value={pw}
        onChange={e => setPw(e.target.value)} autoComplete="current-password"
        onKeyDown={e => e.key === 'Enter' && submit()} />
      {err && <div style={{ color: '#f87171', fontSize: 11 }}>{err}</div>}
      <button disabled={busy || !email || !pw} onClick={submit} style={{ ...btn('#fff', '#000'), opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : tr(lang, authMode === 'in' ? 'acc.signin' : 'acc.signup')}
      </button>
      <button onClick={() => { setErr(''); setAuthMode(authMode === 'in' ? 'up' : 'in') }}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
        {tr(lang, authMode === 'in' ? 'acc.toggle_up' : 'acc.toggle_in')}
      </button>
    </>
  )

  // ══════════════ BANNER (main popup view) ══════════════
  if (mode === 'banner') {
    if (!ready) return null

    if (!auth) {
      // Full-size blurred modal covering the whole popup window
      if (modalOpen) {
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(6,4,12,0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}>
            <div style={{
              position: 'relative', width: '100%', maxWidth: 300,
              background: 'rgba(16,12,26,0.96)', border: `1px solid ${GREEN}44`, borderRadius: 14,
              padding: 20, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: FONT,
              boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
            }}>
              <button onClick={() => setModalOpen(false)} title="✕" style={{
                position: 'absolute', top: 10, right: 12, background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0,
              }}>✕</button>
              <img src={chrome.runtime.getURL('assets/icons/icon48.png')} width={38} height={38}
                style={{ borderRadius: 9, alignSelf: 'center' }} alt="PaperMemes" />
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, textAlign: 'center' }}>
                {tr(lang, 'acc.welcome')}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center', lineHeight: 1.4, marginBottom: 2 }}>
                {tr(lang, 'acc.cta')}
              </div>
              {googleBtn}
              {orDivider}
              {loginForm}
            </div>
          </div>
        )
      }
      // Dismissed → small CTA to reopen the modal
      return (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', borderRadius: 10,
          background: 'rgba(34,197,94,0.08)', border: `1px solid ${GREEN}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 600 }}>{tr(lang, 'acc.cta_short')}</span>
          <button onClick={() => { setErr(''); setModalOpen(true) }} style={{
            ...btn(GREEN, '#000'), width: 'auto', padding: '6px 12px', fontSize: 10,
          }}>{tr(lang, 'acc.signin')}</button>
        </div>
      )
    }

    // Logged in → compact status strip with email + sign out
    return (
      <div style={{
        margin: '10px 14px 0', padding: '8px 12px', borderRadius: 10,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, flexShrink: 0 }} />
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {auth.email}
          </span>
        </span>
        <button onClick={() => { trackSignOut(); signOut() }} style={{
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
          color: '#f87171', fontSize: 10, fontWeight: 800, padding: '5px 10px', cursor: 'pointer',
          fontFamily: FONT, letterSpacing: 0.3, flexShrink: 0,
        }}>
          {tr(lang, 'acc.signout')}
        </button>
      </div>
    )
  }

  // ══════════════ FULL (settings modal) ══════════════
  const title = (
    <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#fff' }}>
      {tr(lang, 'acc.section')}
    </span>
  )

  if (!auth) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {title}
        {googleBtn}
        {orDivider}
        {loginForm}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {title}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: GREEN, fontSize: 10, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN }} /> {tr(lang, 'acc.synced')}
        </span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, wordBreak: 'break-all' }}>{auth.email}</div>

      <button onClick={() => { trackSignOut(); signOut() }} style={btn('rgba(239,68,68,0.12)', '#f87171')}>
        {tr(lang, 'acc.signout')}
      </button>
    </div>
  )
}
