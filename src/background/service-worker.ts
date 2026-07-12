async function fetchJSON(url: string): Promise<unknown> {
  const r = await fetch(url)
  return r.json()
}

const handlers: Record<string, (payload: any) => Promise<{ ok: boolean; data?: unknown; error?: string }>> = {
  async FETCH_RUGCHECK({ mintAddress }) {
    const data = await fetchJSON(`https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report`)
    return { ok: true, data }
  },
  async FETCH_PUMPFUN({ mintAddress }) {
    const data = await fetchJSON(`https://frontend-api.pump.fun/coins/${mintAddress}`)
    return { ok: true, data }
  },
  async RESOLVE_MINT({ poolAddress }) {
    const data: any = await fetchJSON(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`)
    const mint = data?.pairs?.[0]?.baseToken?.address
    if (!mint) return { ok: false, error: 'No mint found' }
    return { ok: true, data: mint }
  },
  async FETCH_SOL_PRICE() {
    const data: any = await fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
    return { ok: true, data: parseFloat(data?.price ?? '0') }
  },
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message

  if (type === 'NOTIFY') {
    const { title, body } = payload
    chrome.notifications.create({ type: 'basic', iconUrl: 'assets/icons/icon48.png', title, message: body })
    sendResponse({ ok: true })
    return true
  }

  const handler = handlers[type]
  if (!handler) return false

  handler(payload ?? {})
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err.message }))
  return true
})

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener(() => {})

// ── Firebase cloud sync ───────────────────────────────────────────────────────
// Push trading data to Firestore whenever it changes (debounced), so the user's
// account always reflects their latest trades — even with the popup closed.
import { syncNow } from '../firebase/sync'
import { AUTH_KEY } from '../firebase/auth'

const SYNC_KEYS = ['balance', 'activeTrade', 'closedTrades', 'currency', 'fees', 'slippage', 'buyPresets', 'tpPresets', 'slPresets']
let syncTimer: ReturnType<typeof setTimeout> | undefined

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const keys = Object.keys(changes)
  // Sync on trade/setting changes, and immediately when the user signs in.
  const signedIn = keys.includes(AUTH_KEY) && !!changes[AUTH_KEY].newValue
  if (!signedIn && !keys.some(k => SYNC_KEYS.includes(k))) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncNow().catch(e => console.warn('[PaperMemes sync]', e?.message ?? e))
  }, signedIn ? 200 : 1500)
})

export {}
