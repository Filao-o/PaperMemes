import React, { useEffect, useState } from 'react'
import {
  getStoredAuth, signIn, signUp, signOut, setWalletAddress, type AuthState,
} from '../../firebase/auth'
import { syncNow } from '../../firebase/sync'
import { t as tr, type Lang } from '../../i18n'

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

export function AccountSection({ lang, mode = 'full' }: { lang: Lang; mode?: 'full' | 'banner' }) {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [ready, setReady] = useState(false)
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [wallet, setWallet] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedWallet, setSavedWallet] = useState(false)

  useEffect(() => {
    getStoredAuth().then(a => { setAuth(a); setWallet(a?.walletAddress ?? ''); setReady(true) })
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
      setEmail(''); setPw('')
      syncNow().catch(() => {})
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  async function saveWallet() {
    await setWalletAddress(wallet.trim() || null)
    setSavedWallet(true); setTimeout(() => setSavedWallet(false), 1500)
    syncNow().catch(() => {})
  }

  // Shared login/signup form (used by both the settings section and the banner)
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

    // Logged out → prominent call-to-action with the form inline
    if (!auth) {
      return (
        <div style={{
          margin: '10px 14px 0', padding: 12, borderRadius: 10,
          background: 'rgba(34,197,94,0.08)', border: `1px solid ${GREEN}55`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>
            {tr(lang, 'acc.cta')}
          </div>
          {loginForm}
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
        <button onClick={() => signOut()} style={{
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
        {loginForm}
        <button disabled title={tr(lang, 'acc.google')}
          style={{ ...btn('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.4)'), cursor: 'not-allowed' }}>
          {tr(lang, 'acc.google')}
        </button>
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

      <div>
        <label style={label}>{tr(lang, 'acc.wallet')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={input} placeholder="Ex: 7xKX…pump" value={wallet} onChange={e => setWallet(e.target.value)} />
          <button onClick={saveWallet} style={{ ...btn(savedWallet ? GREEN : '#fff', '#000'), width: 'auto', padding: '0 12px' }}>
            {savedWallet ? '✓' : tr(lang, 'acc.save_wallet')}
          </button>
        </div>
      </div>

      <button onClick={() => signOut()} style={btn('rgba(239,68,68,0.12)', '#f87171')}>
        {tr(lang, 'acc.signout')}
      </button>
    </div>
  )
}
