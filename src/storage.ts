import type { AppState, Trade } from './types'

const DEFAULTS: AppState = {
  balance: 50,
  activeTrade: null,
  closedTrades: [],
  tpPresets: [10, 20, 50, 100],
  slPresets: [-10, -20, -50, -100],
  buyPresets: [0.1, 0.5, 1, 5],
  currency: 'SOL',
  solPrice: 0,
  slippage: 1,
  fees: 0.25,
  selectedPlatform: null,
  language: 'fr' as 'en' | 'fr' | 'es',
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
    await this.set({ activeTrade: trade, balance: newBalance })
  },

  async closeTrade(trade: Trade, newBalance: number): Promise<void> {
    const { closedTrades } = await this.get()
    await this.set({ activeTrade: null, balance: newBalance, closedTrades: [trade, ...closedTrades] })
  },

  async partialClose(trade: Trade, newBalance: number): Promise<void> {
    await this.set({ activeTrade: trade, balance: newBalance })
  },

  async dcaBuy(trade: Trade, newBalance: number): Promise<void> {
    await this.set({ activeTrade: trade, balance: newBalance })
  },

  onChanged(cb: (changes: Partial<AppState>) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      cb(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) as Partial<AppState>)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  },
}
