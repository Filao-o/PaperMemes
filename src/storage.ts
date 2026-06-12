import type { AppState, Trade } from './types'

const DEFAULTS: AppState = {
  balance: 50,
  activeTrade: null,
  closedTrades: [],
  tpPresets: [25, 50, 100, 200],
  slPresets: [-10, -20, -30, -50],
  buyPresets: [0.1, 0.5, 1, 5],
  currency: 'SOL',
  solPrice: 0,
}

export const Storage = {
  async get(): Promise<AppState> {
    const data = await chrome.storage.local.get(null)
    return { ...DEFAULTS, ...data } as AppState
  },
  async set(partial: Partial<AppState>): Promise<void> {
    await chrome.storage.local.set(partial)
  },
  async openTrade(trade: Trade, newBalance: number): Promise<void> {
    await chrome.storage.local.set({ activeTrade: trade, balance: newBalance })
  },
  async closeTrade(trade: Trade, newBalance: number): Promise<void> {
    const { closedTrades = [] } = await chrome.storage.local.get('closedTrades')
    await chrome.storage.local.set({
      activeTrade: null,
      balance: newBalance,
      closedTrades: [trade, ...closedTrades],
    })
  },
  async partialClose(trade: Trade, newBalance: number): Promise<void> {
    await chrome.storage.local.set({ activeTrade: trade, balance: newBalance })
  },
  async dcaBuy(trade: Trade, newBalance: number): Promise<void> {
    await chrome.storage.local.set({ activeTrade: trade, balance: newBalance })
  },
  onChanged(cb: (changes: Partial<AppState>) => void) {
    chrome.storage.onChanged.addListener((changes) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(changes)) out[k] = v.newValue
      cb(out as Partial<AppState>)
    })
  }
}
