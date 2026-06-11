import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storage } from '../storage'
import type { AppState, Trade, CloseEvent, TokenInfo, RiskInfo } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Tabs, Btn, Divider, Badge } from '../popup/components/ui'
import { JournalPanel } from '../popup/components/JournalPanel'

// ─── URL Patterns ────────────────────────────────────────────────────────────

const URL_PATTERNS: Record<string, RegExp> = {
  photon: /photon-sol\.tinyastro\.io\/(?:en\/)?lp\/([A-Za-z0-9]{32,44})/,
  gmgn:   /gmgn\.ai\/sol\/token\/([A-Za-z0-9]{32,44})/,
  bullx:  /(?:neo\.)?bullx\.io\/terminal\?.*address=([A-Za-z0-9]{32,44})/,
  axiom:  /axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/,
  padre:  /(?:trade\.)?padre\.gg\/(?:trade\/solana\/|terminal\/)?([A-Za-z0-9]{32,44})/,
}

function detectTerminal(href = window.location.href): { terminal: string | null; mintAddress: string | null } {
  if (/(?:neo\.)?bullx\.io\/terminal/.test(href)) {
    try {
      const addr = new URL(href).searchParams.get('address')
      if (addr && addr.length >= 32) return { terminal: 'bullx', mintAddress: addr }
    } catch {}
  }
  for (const [terminal, re] of Object.entries(URL_PATTERNS)) {
    const m = href.match(re)
    if (m) return { terminal, mintAddress: m[1] }
  }
  return { terminal: null, mintAddress: null }
}

// ─── Mint resolution ─────────────────────────────────────────────────────────

const mintCache = new Map<string, string>()

async function resolveMint(addr: string): Promise<string> {
  if (!addr) return addr
  if (mintCache.has(addr)) return mintCache.get(addr)!
  if (/pump$/i.test(addr)) { mintCache.set(addr, addr); return addr }
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'RESOLVE_MINT', payload: { poolAddress: addr } }, res => {
      if (chrome.runtime.lastError || !res?.ok) { mintCache.set(addr, addr); resolve(addr); return }
      const mint = res.mint ?? addr
      mintCache.set(addr, mint)
      resolve(mint)
    })
  })
}

// ─── Price parsing ────────────────────────────────────────────────────────────

function parseVal(text: string): number | null {
  const s = text.replace(/[$,\s]/g, '')
  if (!s) return null
  const m = s.match(/^([\d.]+)([KkMmBb]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (isNaN(n)) return null
  const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }
  return n * (mult[m[2].toLowerCase()] ?? 1)
}

function scrape(selectors: string[]): number | null {
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll<HTMLElement>(sel)
      for (const el of els) {
        const v = parseVal(el.textContent?.trim() ?? '')
        if (v && v > 0) return v
      }
    } catch {}
  }
  return null
}

function scrapeText(selectors: string[]): string | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector<HTMLElement>(sel)
      const t = el?.textContent?.trim()
      if (t) return t
    } catch {}
  }
  return null
}

// ─── Adapters ────────────────────────────────────────────────────────────────

interface Adapter {
  getPrice(): number | null
  getMarketCap(): number | null
  getTokenName(): string | null
  getExtended(): { liquidity: number | null; holders: number | null; age: string | null }
}

const adapters: Record<string, Adapter> = {
  photon: {
    getPrice: () => scrape(['[class*="tokenPrice"]', '[class*="currentPrice"]', 'span[class*="Price"]', '[class*="price"]:not([class*="change"]):not([class*="percent"])']),
    getMarketCap: () => scrape(['[class*="marketCap"]', '[class*="market-cap"]', '[class*="mcap"]']),
    getTokenName: () => scrapeText(['h1', '[class*="symbol"]', '[class*="tokenName"]']),
    getExtended: () => ({
      liquidity: scrape(['[class*="liquidity"]']),
      holders: scrape(['[class*="holder"]', '[class*="Holder"]']),
      age: scrapeText(['[class*="age"]', '[class*="Age"]', '[class*="created"]']),
    }),
  },
  gmgn: {
    getPrice: () => scrape(['[class*="price"]:not([class*="change"]):not([class*="percent"])', '[data-testid*="price"]', '[class*="token-price"]']),
    getMarketCap: () => scrape(['[data-testid*="market-cap"]', '[data-testid*="marketcap"]', '[class*="market_cap"]']),
    getTokenName: () => scrapeText(['[data-testid*="token-name"]', '[class*="tokenName"]', '[class*="token-symbol"]']),
    getExtended: () => ({
      liquidity: scrape(['[class*="liquidity"]']),
      holders: scrape(['[data-testid*="holder"]', '[class*="holder"]']),
      age: scrapeText(['[data-testid*="age"]', '[class*="age"]']),
    }),
  },
  bullx: {
    getPrice: () => scrape(['[class*="current-price"]', '[class*="token-price"]', '[class*="price-value"]', '[data-field="price"]', '[data-testid="price"]']),
    getMarketCap: () => scrape(['[data-field="marketCap"]', '[data-field="market_cap"]', '[class*="market-cap-value"]', '[class*="marketcap"]']),
    getTokenName: () => scrapeText(['[class*="token-name"]', '[data-field="symbol"]']),
    getExtended: () => ({
      liquidity: scrape(['[class*="liquidity"]']),
      holders: scrape(['[class*="holder"]']),
      age: scrapeText(['[class*="age"]', '[class*="created"]']),
    }),
  },
  axiom: {
    getPrice: () => scrape(['[class*="price"]:not([class*="change"]):not([class*="diff"])', '[class*="Price"]:not([class*="Change"])', 'span[class*="current"]']),
    getMarketCap: () => scrape(['[class*="marketcap"]', '[class*="market-cap"]', '[class*="mcap"]']),
    getTokenName: () => scrapeText(['[class*="symbol"]', '[class*="token-symbol"]']),
    getExtended: () => ({
      liquidity: scrape(['[class*="liquidity"]']),
      holders: scrape(['[class*="holder"]', '[class*="Holder"]']),
      age: scrapeText(['[class*="age"]', '[class*="Age"]']),
    }),
  },
  padre: {
    getPrice: () => scrape(['[class*="price"]:not([class*="change"])', '[class*="Price"]:not([class*="Diff"])', '[class*="tokenValue"]']),
    getMarketCap: () => scrape(['[class*="stat-value"]:first-child', '[class*="marketcap"]', '[class*="market-cap"]']),
    getTokenName: () => scrapeText(['[class*="symbol"]', '[class*="token-symbol"]']),
    getExtended: () => ({
      liquidity: scrape(['[class*="liquidity"]']),
      holders: scrape(['[class*="holder"]']),
      age: scrapeText(['[class*="age"]', '[class*="created"]']),
    }),
  },
}

// ─── Trade logic ──────────────────────────────────────────────────────────────

function getLivePnL(trade: Trade, price: number): { sol: number; percent: number } {
  const liveValue = trade.tokensHeld * price
  const alreadyOut = trade.closeEvents.reduce((s, e) => s + e.solReturned, 0)
  const sol = liveValue + alreadyOut - trade.invested
  const percent = (sol / trade.invested) * 100
  return { sol, percent }
}

// ─── Main Widget ─────────────────────────────────────────────────────────────

function Widget() {
  const [state, setState] = useState<AppState>({
    balance: 50, activeTrade: null, closedTrades: [],
    tpPresets: [25, 50, 100, 200], slPresets: [-10, -20, -30, -50],
    buyPresets: [0.1, 0.5, 1, 5], currency: 'SOL', solPrice: 0,
  })
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [risk, setRisk] = useState<RiskInfo | null>(null)
  const [tab, setTab] = useState<'trade' | 'journal'>('trade')
  const [priceStale, setPriceStale] = useState(false)
  const [terminal, setTerminal] = useState<string | null>(null)
  const [mintAddress, setMintAddress] = useState<string | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const intervalRef = useRef<number | null>(null)
  const lastPriceRef = useRef<number | null>(null)
  const staleTimerRef = useRef<number | null>(null)

  // Load state
  useEffect(() => {
    Storage.get().then(setState)
    Storage.onChanged(c => setState(prev => ({ ...prev, ...c })))
  }, [])

  // Detect terminal + mint
  useEffect(() => {
    const { terminal: t, mintAddress: raw } = detectTerminal()
    if (!t || !raw) return
    setTerminal(t)
    resolveMint(raw).then(mint => {
      setMintAddress(mint)
      fetchRisk(mint)
    })
  }, [])

  // Setup DOM observer
  useEffect(() => {
    if (!terminal || !mintAddress) return
    const adapter = adapters[terminal]
    if (!adapter) return

    const poll = () => {
      const price = adapter.getPrice()
      const mc = adapter.getMarketCap()
      const name = adapter.getTokenName()
      const ext = adapter.getExtended()

      if (price && price > 0) {
        if (price !== lastPriceRef.current) {
          lastPriceRef.current = price
          setTokenInfo({
            price, marketCap: mc, tokenName: name, mintAddress,
            liquidity: ext.liquidity, holders: ext.holders, age: ext.age,
            timestamp: Date.now(),
          })
          setPriceStale(false)
          if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
          staleTimerRef.current = window.setTimeout(() => setPriceStale(true), 10_000)
        }
      }
    }

    poll()
    observerRef.current = new MutationObserver(poll)
    observerRef.current.observe(document.body, { childList: true, subtree: true, characterData: true })
    intervalRef.current = window.setInterval(poll, 3000)

    return () => {
      observerRef.current?.disconnect()
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    }
  }, [terminal, mintAddress])

  // Check TP/SL when price updates
  useEffect(() => {
    if (!tokenInfo || !state.activeTrade) return
    const trade = state.activeTrade
    const { price } = tokenInfo
    const mc = tokenInfo.marketCap ?? 0
    const { sol: pnlSol, percent: pnlPct } = getLivePnL(trade, price)

    if (trade.tp && pnlPct >= trade.tp) {
      doSell(100, price, mc, trade, state)
      notify('Take Profit !', `${trade.tokenName} +${pnlPct.toFixed(1)}%`)
    } else if (trade.tpMC && mc >= trade.tpMC) {
      doSell(100, price, mc, trade, state)
      notify('Take Profit MC !', `${trade.tokenName} MC ${fmtMC(mc)}`)
    } else if (trade.sl && pnlPct <= trade.sl) {
      doSell(100, price, mc, trade, state)
      notify('Stop Loss déclenché', `${trade.tokenName} ${pnlPct.toFixed(1)}%`)
    }
  }, [tokenInfo])

  function fetchRisk(mint: string) {
    chrome.runtime.sendMessage({ type: 'FETCH_RUGCHECK', payload: { mintAddress: mint } }, res => {
      if (!res?.ok) return
      const d = res.data
      const score = d?.score ?? 0
      const topHolder = d?.topHolders?.[0]?.pct ?? null
      setRisk({ score, topHolderPercent: topHolder ? topHolder * 100 : null, isHighRisk: score > 700 })
    })
  }

  function notify(title: string, body: string) {
    chrome.runtime.sendMessage({ type: 'NOTIFY', payload: { title, body } })
  }

  function handleBuy(amount: number) {
    if (!tokenInfo || !mintAddress || !terminal) return
    if (state.activeTrade) return
    if (state.balance < amount) return
    const { price, marketCap, tokenName } = tokenInfo
    if (!price) return

    const trade: Trade = {
      id: `trade_${Date.now()}`,
      mintAddress,
      tokenName: tokenName ?? mintAddress.slice(0, 6),
      terminal,
      entryPrice: price,
      entryMC: marketCap ?? 0,
      invested: amount,
      tokensHeld: amount / price,
      tp: null, tpMC: null, sl: null,
      status: 'active',
      openedAt: Date.now(),
      closedAt: null,
      closeEvents: [],
      pnlSOL: null,
      pnlPercent: null,
    }
    Storage.openTrade(trade, state.balance - amount)
  }

  function handleSell(percent: number) {
    if (!state.activeTrade || !tokenInfo) return
    doSell(percent, tokenInfo.price, tokenInfo.marketCap ?? 0, state.activeTrade, state)
  }

  function handleSellInitials() {
    if (!state.activeTrade || !tokenInfo) return
    const trade = state.activeTrade
    const alreadyOut = trade.closeEvents.reduce((s, e) => s + e.solReturned, 0)
    const stillNeeded = trade.invested - alreadyOut
    if (stillNeeded <= 0) return
    const tokensNeeded = stillNeeded / tokenInfo.price
    const pct = Math.min((tokensNeeded / trade.tokensHeld) * 100, 100)
    doSell(pct, tokenInfo.price, tokenInfo.marketCap ?? 0, trade, state)
  }

  function doSell(percent: number, price: number, mc: number, trade: Trade, st: AppState) {
    const tokensSold = trade.tokensHeld * (percent / 100)
    const solReturned = tokensSold * price
    const event: CloseEvent = {
      id: `report_${Date.now()}`,
      timestamp: Date.now(),
      sellPercent: percent,
      solReturned,
      priceAtClose: price,
      mcAtClose: mc,
    }
    const updatedTrade: Trade = {
      ...trade,
      tokensHeld: trade.tokensHeld * (1 - percent / 100),
      closeEvents: [...trade.closeEvents, event],
    }
    const newBalance = st.balance + solReturned

    if (percent >= 100 || updatedTrade.tokensHeld < 0.00001) {
      const totalOut = updatedTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0)
      const pnlSOL = totalOut - trade.invested
      const pnlPercent = (pnlSOL / trade.invested) * 100
      Storage.closeTrade({
        ...updatedTrade,
        status: pnlSOL >= 0 ? 'won' : 'lost',
        closedAt: Date.now(),
        pnlSOL,
        pnlPercent,
      }, newBalance)
    } else {
      Storage.partialClose(updatedTrade, newBalance)
    }
  }

  function handleSetTp(val: number | null) {
    if (!state.activeTrade) return
    Storage.set({ activeTrade: { ...state.activeTrade, tp: val, tpMC: null } })
  }

  function handleSetTpMC(val: number | null) {
    if (!state.activeTrade) return
    Storage.set({ activeTrade: { ...state.activeTrade, tpMC: val, tp: null } })
  }

  function handleSetSl(val: number | null) {
    if (!state.activeTrade) return
    Storage.set({ activeTrade: { ...state.activeTrade, sl: val } })
  }

  const { balance, activeTrade, closedTrades, currency, solPrice, buyPresets, tpPresets, slPresets } = state
  const price = tokenInfo?.price ?? null
  const mc = tokenInfo?.marketCap ?? null
  const livePnL = activeTrade && price ? getLivePnL(activeTrade, price) : null
  const liveValue = activeTrade && price ? activeTrade.tokensHeld * price : null

  function fmtCur(sol: number) {
    return currency === 'USD' && solPrice > 0
      ? `$${(sol * solPrice).toFixed(2)}`
      : `${fmtSOL(sol)} ≋`
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 280, height: '100vh',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      fontFamily: "'JetBrains Mono', monospace", color: C.text,
      display: 'flex', flexDirection: 'column', zIndex: 2147483647,
      fontSize: 12,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}`, display: 'inline-block' }} />
          <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>PAPERMEMES</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })} style={miniBtn}>
            {currency === 'SOL' ? '≋' : '$'}
          </button>
        </div>
      </div>

      {/* Balance */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Wallet Virtuel</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtCur(balance)}</div>
      </div>

      {/* Token info */}
      {tokenInfo && (
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{tokenInfo.tokenName ?? '—'}</span>
              <span style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>{terminal}</span>
            </div>
            {tokenInfo.age && <span style={{ color: C.muted, fontSize: 10 }}>{tokenInfo.age}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: priceStale ? C.yellow : C.text }}>
              {price ? fmtMC(price) : '—'}
              {priceStale && <span style={{ fontSize: 9, color: C.yellow, marginLeft: 4 }}>⚠ Prix non mis à jour</span>}
            </span>
            {tokenInfo.holders && <span style={{ color: C.muted, fontSize: 10 }}>{tokenInfo.holders} Hds</span>}
          </div>
          {mc && <div style={{ color: C.muted, fontSize: 10 }}>MC {fmtMC(mc)}</div>}
        </div>
      )}

      {/* Tabs */}
      <div style={{ flexShrink: 0, padding: '0 10px' }}>
        <Tabs tabs={['trade', 'journal']} active={tab} onChange={t => setTab(t as 'trade' | 'journal')} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {tab === 'trade' && (
          <TradeTab
            state={state}
            activeTrade={activeTrade}
            livePnL={livePnL}
            liveValue={liveValue}
            buyPresets={buyPresets}
            tpPresets={tpPresets}
            slPresets={slPresets}
            hasPrice={!!price}
            onBuy={handleBuy}
            onSell={handleSell}
            onSellInitials={handleSellInitials}
            onSetTp={handleSetTp}
            onSetTpMC={handleSetTpMC}
            onSetSl={handleSetSl}
            fmtCur={fmtCur}
          />
        )}
        {tab === 'journal' && (
          <JournalPanel closedTrades={closedTrades} currency={currency} solPrice={solPrice} />
        )}
      </div>

      {/* Risk footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 10px', flexShrink: 0 }}>
        {risk?.isHighRisk && (
          <div style={{ color: C.red, fontSize: 10, marginBottom: 2 }}>
            ■ Score risque élevé : {risk.score}/100
          </div>
        )}
        {risk?.topHolderPercent && risk.topHolderPercent > 20 && (
          <div style={{ color: C.red, fontSize: 10, marginBottom: 2 }}>
            ■ Top holder : {risk.topHolderPercent.toFixed(0)}% du supply
          </div>
        )}
        <div style={{ color: C.yellow, fontSize: 9 }}>
          ⚠ TP/SL s'exécutent uniquement si cet onglet reste ouvert.
        </div>
      </div>
    </div>
  )
}

// ─── Trade Tab ────────────────────────────────────────────────────────────────

interface TradeTabProps {
  state: AppState
  activeTrade: Trade | null
  livePnL: { sol: number; percent: number } | null
  liveValue: number | null
  buyPresets: number[]
  tpPresets: number[]
  slPresets: number[]
  hasPrice: boolean
  onBuy: (amount: number) => void
  onSell: (percent: number) => void
  onSellInitials: () => void
  onSetTp: (v: number | null) => void
  onSetTpMC: (v: number | null) => void
  onSetSl: (v: number | null) => void
  fmtCur: (sol: number) => string
}

function TradeTab({ state, activeTrade, livePnL, liveValue, buyPresets, tpPresets, slPresets, hasPrice, onBuy, onSell, onSellInitials, onSetTp, onSetTpMC, onSetSl, fmtCur }: TradeTabProps) {
  const hasPosition = !!activeTrade

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Achat rapide */}
      <div>
        <div style={sectionLabel}>Achat Rapide</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {buyPresets.map(amt => (
            <Btn
              key={amt}
              variant="green"
              size="sm"
              disabled={hasPosition || !hasPrice || state.balance < amt}
              onClick={() => onBuy(amt)}
            >
              {amt}≋
            </Btn>
          ))}
        </div>
      </div>

      <Divider />

      {/* Position ouverte */}
      {activeTrade && livePnL != null && liveValue != null ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={sectionLabel}>Position ouverte</span>
            <span style={{ color: pnlColor(livePnL.percent), fontSize: 11, fontWeight: 700 }}>
              {fmtPct(livePnL.percent)}
            </span>
          </div>
          <div style={{ color: C.muted, fontSize: 10, marginBottom: 8 }}>
            MC ENTRÉE {fmtMC(activeTrade.entryMC)}
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {[
              { label: 'INVESTI', value: fmtCur(activeTrade.invested) },
              { label: 'VALEUR LIVE', value: fmtCur(liveValue) },
              { label: 'PNL', value: fmtCur(livePnL.sol), color: pnlColor(livePnL.sol) },
              { label: 'CASHOUT', value: activeTrade.closeEvents.length > 0
                  ? fmtCur(activeTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0))
                  : '—' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.surface, borderRadius: 6, padding: '5px 4px', textAlign: 'center' }}>
                <div style={{ color: C.muted, fontSize: 8, marginBottom: 2 }}>{label}</div>
                <div style={{ color: color ?? C.text, fontSize: 10, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Sell buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 6 }}>
            {[10, 25, 50, 100].map(pct => (
              <Btn key={pct} variant="red" size="sm" onClick={() => onSell(pct)}>{pct}%</Btn>
            ))}
          </div>

          {/* Sell initials */}
          <Btn
            variant="yellow"
            style={{ width: '100%', padding: '7px 0' }}
            onClick={onSellInitials}
          >
            ⟳ SELL INITIALS — {fmtCur(activeTrade.invested)}
          </Btn>
          <div style={{ color: C.muted, fontSize: 9, textAlign: 'center', marginTop: 3 }}>
            Récupère votre mise · laisse les gains courir
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '12px 0' }}>
          {hasPrice ? 'Aucune position ouverte' : 'Chargement du prix…'}
        </div>
      )}

      <Divider />

      {/* TP / SL */}
      <div>
        <div style={sectionLabel}>TP / SL</div>
        {activeTrade ? (
          <>
            <div style={{ color: C.muted, fontSize: 9, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Take Profit</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
              {tpPresets.map(pct => (
                <Btn
                  key={pct}
                  variant="green"
                  size="sm"
                  style={{ border: activeTrade.tp === pct ? `2px solid ${C.green}` : undefined }}
                  onClick={() => onSetTp(activeTrade.tp === pct ? null : pct)}
                >
                  +{pct}%
                </Btn>
              ))}
            </div>
            <div style={{ color: C.muted, fontSize: 9, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Stop Loss</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {slPresets.map(pct => (
                <Btn
                  key={pct}
                  variant="red"
                  size="sm"
                  style={{ border: activeTrade.sl === pct ? `2px solid ${C.red}` : undefined }}
                  onClick={() => onSetSl(activeTrade.sl === pct ? null : pct)}
                >
                  {pct}%
                </Btn>
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '8px 0' }}>
            Ouvrez une position d'abord
          </div>
        )}
      </div>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  color: C.muted, fontSize: 9, textTransform: 'uppercase',
  letterSpacing: 1, marginBottom: 6, display: 'block',
}

const miniBtn: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.border}`, color: C.text,
  borderRadius: 4, fontSize: 11, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit',
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const { terminal } = detectTerminal()
if (terminal) {
  const existing = document.getElementById('papermemes-root')
  if (!existing) {
    const div = document.createElement('div')
    div.id = 'papermemes-root'
    document.body.appendChild(div)
    createRoot(div).render(<Widget />)
  }
}

export {}
