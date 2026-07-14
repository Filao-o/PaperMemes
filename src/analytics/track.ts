// GA4 Measurement Protocol — MV3-friendly analytics (no external SDK).
// All events are fire-and-forget: failures are silently swallowed so tracking
// never breaks the app. Client ID is persisted in chrome.storage.local.

const MEASUREMENT_ID = 'G-7QQ41GV4FD'
const API_SECRET     = 'Gv8niNyeR5CqKx3VOcx-4w'
const DEBUG          = false  // mettre true localement pour voir les events dans la console
const ENDPOINT       = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`
const DEBUG_ENDPOINT = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`
const CLIENT_KEY     = '__pmGaClient'

// ─── Client ID ───────────────────────────────────────────────────────────────

let _clientId: string | null = null

async function getClientId(): Promise<string> {
  if (_clientId) return _clientId
  const s = await chrome.storage.local.get(CLIENT_KEY)
  if (s[CLIENT_KEY]) { _clientId = s[CLIENT_KEY]; return _clientId! }
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [CLIENT_KEY]: id })
  _clientId = id
  return id
}

// ─── Core send ───────────────────────────────────────────────────────────────

async function send(name: string, params: Record<string, string | number | boolean> = {}): Promise<void> {
  try {
    const client_id = await getClientId()
    const body = JSON.stringify({
      client_id,
      events: [{ name, params: { engagement_time_msec: 100, ...params } }],
    })
    if (DEBUG) {
      const res = await fetch(DEBUG_ENDPOINT, { method: 'POST', body })
      const json = await res.json()
      console.log(`[PM Analytics] ${name}`, params, json)
    } else {
      await fetch(ENDPOINT, { method: 'POST', body })
    }
  } catch {
    // never throw — tracking must never break the app
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Popup ouvert */
export const trackExtensionOpened = () =>
  send('extension_opened')

/** Plateforme sélectionnée au premier lancement */
export const trackPlatformSelected = (terminal: string) =>
  send('platform_selected', { terminal })

/** Onglet du popup consulté */
export const trackTabViewed = (tab: 'stats' | 'history' | 'calendar' | 'pnl' | 'journal') =>
  send('tab_viewed', { tab })

/** Connexion réussie */
export const trackSignIn = (method: 'google' | 'email') =>
  send('sign_in', { method })

/** Déconnexion */
export const trackSignOut = () =>
  send('sign_out')

/** Trade paper ouvert */
export const trackTradeOpened = (terminal: string, invested_sol: number) =>
  send('trade_opened', { terminal, invested_sol })

/** Trade paper fermé */
export const trackTradeClosed = (params: {
  terminal: string
  status: 'won' | 'lost'
  pnl_percent: number
  duration_min: number
}) => send('trade_closed', params)

/** Vente partielle */
export const trackPartialSell = (percent: 10 | 25 | 50 | 100) =>
  send('partial_sell', { percent })

/** Vendre Init. utilisé */
export const trackSellInit = () =>
  send('sell_init_used')

/** TP déclenché automatiquement */
export const trackTpTriggered = (terminal: string, pnl_percent: number) =>
  send('tp_triggered', { terminal, pnl_percent })

/** SL déclenché automatiquement */
export const trackSlTriggered = (terminal: string, pnl_percent: number) =>
  send('sl_triggered', { terminal, pnl_percent })

/** Preset d'achat rapide utilisé */
export const trackBuyPresetUsed = (preset_sol: number, terminal: string) =>
  send('buy_preset_used', { preset_sol, terminal })

/** Langue changée */
export const trackLanguageChanged = (lang: string) =>
  send('language_changed', { lang })

/** Widget déplacé */
export const trackWidgetMoved = () =>
  send('widget_moved')

/** Reset wallet */
export const trackWalletReset = (type: 'balance_only' | 'full') =>
  send('wallet_reset', { type })
