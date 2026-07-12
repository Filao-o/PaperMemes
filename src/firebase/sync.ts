// Push the local paper-trading state to Firestore under users/{uid}. Called by
// the service worker on storage changes (debounced) and by the popup after login
// / wallet edit. No-op when signed out.
import { getFreshAuth } from './auth'
import { toFields, patchUserDoc } from './firestore'

const MASK = ['email', 'walletAddress', 'balance', 'activeTrade', 'closedTrades', 'settings', 'updatedAt']

export async function syncNow(): Promise<boolean> {
  const auth = await getFreshAuth()
  if (!auth) return false
  const s = await chrome.storage.local.get(null)
  const fields = toFields({
    email: auth.email,
    walletAddress: auth.walletAddress ?? null,
    balance: s.balance ?? 0,
    activeTrade: s.activeTrade ?? null,
    closedTrades: s.closedTrades ?? [],
    settings: {
      currency: s.currency ?? 'SOL',
      fees: s.fees ?? 1,
      slippage: s.slippage ?? 50,
      buyPresets: s.buyPresets ?? [],
      tpPresets: s.tpPresets ?? [],
      slPresets: s.slPresets ?? [],
    },
  })
  fields.updatedAt = { timestampValue: new Date().toISOString() }
  await patchUserDoc(auth.uid, auth.idToken, fields, MASK)
  return true
}
