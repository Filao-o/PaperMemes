export interface TradeEntry {
  entryPrice: number
  entryMC: number
  invested: number
  tokensHeld: number
  timestamp: number
}

export interface Trade {
  id: string
  mintAddress: string
  tokenName: string
  terminal: string
  entryPrice: number
  entryMC: number
  invested: number
  tokensHeld: number
  entries?: TradeEntry[]
  tp: number | null
  tpMC: number | null
  sl: number | null
  status: 'active' | 'won' | 'lost' | 'closed'
  openedAt: number
  closedAt: number | null
  closeEvents: CloseEvent[]
  pnlSOL: number | null
  pnlPercent: number | null
}

export interface CloseEvent {
  id: string
  timestamp: number
  sellPercent: number
  solReturned: number
  priceAtClose: number
  mcAtClose: number
}

export interface AppState {
  balance: number
  activeTrade: Trade | null
  closedTrades: Trade[]
  tpPresets: number[]
  slPresets: number[]
  buyPresets: number[]
  currency: 'SOL' | 'USD'
  solPrice: number
  slippage: number
  fees: number
}

export interface TokenInfo {
  price: number
  marketCap: number | null
  tokenName: string | null
  mintAddress: string | null
  liquidity: number | null
  holders: number | null
  age: string | null
  timestamp: number
}

export interface RiskInfo {
  score: number
  topHolderPercent: number | null
  isHighRisk: boolean
}
