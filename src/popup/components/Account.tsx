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

export function AccountSection({ lang }: { lang: Lang }) {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [wallet, setWallet] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedWallet, setSavedWallet] = useState(false)

  useEffect(() => {
    getStoredAuth().then(a => { setAuth(a); setWallet(a?.walletAddress ?? '') })
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
      await (mode === 'in' ? signIn : signUp)(email.trim(), pw)
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

  const title = (
    <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#fff' }}>
      {tr(lang, 'acc.section')}
    </span>
  )

  // ── Signed out: login / signup ──
  if (!auth) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {title}
        <input style={input} type="email" placeholder={tr(lang, 'acc.email')} value={email}
          onChange={e => setEmail(e.target.value)} autoComplete="username" />
        <input style={input} type="password" placeholder={tr(lang, 'acc.pw')} value={pw}
          onChange={e => setPw(e.target.value)} autoComplete="current-password"
          onKeyDown={e => e.key === 'Enter' && submit()} />
        {err && <div style={{ color: '#f87171', fontSize: 11 }}>{err}</div>}
        <button disabled={busy || !email || !pw} onClick={submit} style={{ ...btn('#fff', '#000'), opacity: busy ? 0.6 : 1 }}>
          {busy ? '…' : tr(lang, mode === 'in' ? 'acc.signin' : 'acc.signup')}
        </button>
        <button onClick={() => { setErr(''); setMode(mode === 'in' ? 'up' : 'in') }}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
          {tr(lang, mode === 'in' ? 'acc.toggle_up' : 'acc.toggle_in')}
        </button>
        <button disabled title={tr(lang, 'acc.google')}
          style={{ ...btn('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.4)'), cursor: 'not-allowed' }}>
          {tr(lang, 'acc.google')}
        </button>
      </div>
    )
  }

  // ── Signed in: account + wallet ──
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
