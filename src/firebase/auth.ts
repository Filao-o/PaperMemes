// Firebase Authentication via the REST API (no SDK) — MV3-friendly: works in the
// popup and the service worker, no IndexedDB persistence hacks, no bundling of
// the heavy Firebase SDK. Tokens are kept in chrome.storage.local under a
// dedicated key that is explicitly excluded from the data export.
import { firebaseConfig, googleClientId } from './config'

export const AUTH_KEY = '__pmAuth'
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts'
const TOKEN = 'https://securetoken.googleapis.com/v1/token'

export interface AuthState {
  uid: string
  email: string
  idToken: string
  refreshToken: string
  expiresAt: number          // epoch ms when idToken expires
  walletAddress?: string | null
}

export async function getStoredAuth(): Promise<AuthState | null> {
  const o = await chrome.storage.local.get(AUTH_KEY)
  return (o[AUTH_KEY] as AuthState) ?? null
}

async function setStoredAuth(a: AuthState | null): Promise<void> {
  if (a) await chrome.storage.local.set({ [AUTH_KEY]: a })
  else await chrome.storage.local.remove(AUTH_KEY)
}

function friendly(code: string): string {
  const m: Record<string, string> = {
    EMAIL_EXISTS: 'Cet email est déjà utilisé.',
    INVALID_LOGIN_CREDENTIALS: 'Email ou mot de passe incorrect.',
    INVALID_PASSWORD: 'Email ou mot de passe incorrect.',
    EMAIL_NOT_FOUND: 'Email ou mot de passe incorrect.',
    WEAK_PASSWORD: 'Mot de passe trop court (min. 6 caractères).',
    INVALID_EMAIL: 'Email invalide.',
    MISSING_PASSWORD: 'Mot de passe manquant.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives, réessaie plus tard.',
  }
  return m[code] ?? code.replace(/_/g, ' ').toLowerCase()
}

async function authRequest(path: 'signUp' | 'signInWithPassword', email: string, password: string): Promise<AuthState> {
  const res = await fetch(`${IDENTITY}:${path}?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(friendly(data?.error?.message?.split(' ')[0] ?? 'AUTH_ERROR'))
  const prev = await getStoredAuth()
  const auth: AuthState = {
    uid: data.localId,
    email: data.email,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    walletAddress: prev?.walletAddress ?? null,
  }
  await setStoredAuth(auth)
  return auth
}

export function signUp(email: string, password: string) { return authRequest('signUp', email, password) }
export function signIn(email: string, password: string) { return authRequest('signInWithPassword', email, password) }
export async function signOut() { await setStoredAuth(null) }

async function persistFromIdp(data: any): Promise<AuthState> {
  const prev = await getStoredAuth()
  const auth: AuthState = {
    uid: data.localId,
    email: data.email,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    walletAddress: prev?.walletAddress ?? null,
  }
  await setStoredAuth(auth)
  return auth
}

// Google sign-in for MV3: run Google's OAuth consent via chrome.identity
// (no SDK), get a Google id_token, then exchange it with Firebase Identity
// Toolkit (signInWithIdp). Same account whether it's a first sign-up or a login.
export async function signInWithGoogle(): Promise<AuthState> {
  if (!googleClientId) throw new Error('Google non configuré (client ID manquant).')
  const redirectUri = chrome.identity.getRedirectURL()
  const nonce = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(googleClientId)}` +
    '&response_type=id_token' +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent('openid email profile')}` +
    `&nonce=${encodeURIComponent(nonce)}` +
    '&prompt=select_account'

  const redirect = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, r => {
      if (chrome.runtime.lastError || !r) {
        reject(new Error(chrome.runtime.lastError?.message || 'Connexion Google annulée.'))
      } else resolve(r)
    })
  })

  const frag = new URL(redirect).hash.slice(1)
  const idToken = new URLSearchParams(frag).get('id_token')
  if (!idToken) throw new Error('Google : id_token introuvable.')

  const res = await fetch(`${IDENTITY}:signInWithIdp?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${idToken}&providerId=google.com`,
      requestUri: redirectUri,
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(friendly(data?.error?.message?.split(' ')[0] ?? 'GOOGLE_AUTH'))
  return persistFromIdp(data)
}

// Return a valid auth with a fresh idToken, refreshing it if it is about to
// expire. Returns null if not signed in (or the refresh token was revoked).
export async function getFreshAuth(): Promise<AuthState | null> {
  const a = await getStoredAuth()
  if (!a) return null
  if (Date.now() < a.expiresAt - 60_000) return a
  try {
    const res = await fetch(`${TOKEN}?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(a.refreshToken)}`,
    })
    const d = await res.json()
    if (!res.ok) { await setStoredAuth(null); return null }
    const updated: AuthState = {
      ...a,
      idToken: d.id_token,
      refreshToken: d.refresh_token,
      expiresAt: Date.now() + Number(d.expires_in) * 1000,
    }
    await setStoredAuth(updated)
    return updated
  } catch {
    return a   // network hiccup: keep the (possibly stale) token, retry later
  }
}

export async function setWalletAddress(wallet: string | null): Promise<void> {
  const a = await getStoredAuth()
  if (!a) return
  await setStoredAuth({ ...a, walletAddress: wallet })
}
