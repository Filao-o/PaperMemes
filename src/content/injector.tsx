import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storage } from '../storage'
import type { AppState, Trade, CloseEvent, TokenInfo, RiskInfo } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Tabs, Btn, Divider } from '../popup/components/ui'
import { JournalPanel } from '../popup/components/JournalPanel'

// ─── Parsing helpers ──────────────────────────────────────────────────────────

// Parse "$1.2K", "0.000123", "1.5M" etc.
function q(text: string | null | undefined): number | null {
  if (!text) return null
  const s = text.replace(/[$,\s]/g, '').trim()
  const m = s.match(/^([\d.]+)([KMB])$/i)
  if (m) {
    const n = parseFloat(m[1])
    const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 }
    return n * mult[m[2].toUpperCase()]
  }
  const r = parseFloat(s)
  return isNaN(r) ? null : r
}

// TreeWalker: find first text node matching regex, return its parent element
function dt(regex: RegExp, root: Element = document.body): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (regex.test((node.textContent ?? '').trim())) return node.parentElement
  }
  return null
}

// Read from Next.js __NEXT_DATA__ (used by Photon)
function It(path: string): string | null {
  try {
    const props = (window as any).__NEXT_DATA__?.props?.pageProps
    if (!props) return null
    return path.split('.').reduce((o: any, k) => o?.[k], props) ?? null
  } catch { return null }
}

// Read token name + price from document.title (universal fallback)
// Titles often look like: "BOE $0.0000123 • Photon"
function fromTitle(): { name: string | null; price: number | null } {
  const title = document.title
  const priceMatch = title.match(/\$([\d.,]+[KMBkmb]?)/i)
  return {
    name: title.match(/^([A-Z0-9$]+)/i)?.[1] ?? null,
    price: priceMatch ? q(priceMatch[1]) : null,
  }
}

// ─── URL detection ────────────────────────────────────────────────────────────

interface Detection { terminal: string | null; mintAddress: string | null }

const MINT_PATTERNS: Record<string, RegExp> = {
  photon: /photon-sol\.tinyastro\.io\/(?:en\/)?lp\/([A-Za-z0-9]{32,44})/,
  gmgn:   /gmgn\.ai\/sol\/token\/([A-Za-z0-9]{32,44})/,
  bullx:  /address=([A-Za-z0-9]{32,44})/,
  axiom:  /axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/,
  padre:  /(?:trade\.)?padre\.gg\/(?:trade\/solana\/|terminal\/)?([A-Za-z0-9]{32,44})/,
}

function detectTerminal(href = window.location.href): Detection {
  if (/(?:neo\.)?bullx\.io\/terminal/.test(href)) {
    try {
      const addr = new URL(href).searchParams.get('address')
      if (addr && addr.length >= 32) return { terminal: 'bullx', mintAddress: addr }
    } catch {}
  }
  for (const [terminal, re] of Object.entries(MINT_PATTERNS)) {
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
      if (mint !== addr) console.log(`[PaperMemes] Pool → Mint : ${mint.slice(0, 12)}…`)
      resolve(mint)
    })
  })
}

// ─── Adapters ────────────────────────────────────────────────────────────────

interface Adapter {
  getPrice(): number | null
  getMarketCap(): number | null
  getTokenName(): string | null
  getMintAddress(href?: string): string | null
  getExtended(): { liquidity: string | null; holders: number | null; age: string | null }
}

const AGE_RE = /^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|wk|mo|month|y|yr)s?$/i

function parseAge(text: string): string | null {
  const m = text.trim().match(AGE_RE)
  if (!m) return null
  const [, n, unit] = m
  const u = unit.toLowerCase()
  if (u.startsWith('s')) return `${n}s`
  if (u.startsWith('mi') || u === 'm') return `${n}m`
  if (u.startsWith('h')) return `${n}h`
  if (u.startsWith('d')) return `${n}d`
  if (u.startsWith('w')) return `${n}w`
  if (u.startsWith('mo')) return `${n}mo`
  if (u.startsWith('y')) return `${n}y`
  return null
}

function walkAge(): string | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const age = parseAge((node.textContent ?? '').trim())
    if (age) return age
  }
  return null
}

// Photon (Next.js — data in __NEXT_DATA__)
const photonAdapter: Adapter = {
  getPrice() {
    const v = It('token.price') ?? It('poolData.price') ?? It('priceUsd')
    if (v) return parseFloat(v)
    const title = fromTitle(); if (title.price) return title.price
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10}|[\d]{1,6}\.[\d]+)$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="price"][class*="current"]', '[data-value][class*="price"]', 'span[class*="tokenPrice"]', '[data-testid*="price"]', '[class*="tokenPrice"]', '[class*="currentPrice"]']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1e6) return n
      }
    }
    return null
  },
  getMarketCap() {
    const v = It('token.marketCap') ?? It('poolData.marketCap') ?? It('usdMarketCap')
    if (v) return parseFloat(v)
    const el = dt(/^\$[\d,.]+[KMB]$/i)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[data-testid*="market-cap"]', '[data-testid*="marketcap"]', '[class*="marketCap"]', '[class*="market-cap"]', '[class*="mcap"]']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    }
    return null
  },
  getTokenName() {
    const v = It('token.symbol') ?? It('token.name')
    if (v) return v
    return fromTitle().name ?? document.querySelector<HTMLElement>('h1, [class*="symbol"], [class*="tokenName"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    return href.match(/photon-sol\.tinyastro\.io\/(?:en\/)?lp\/([A-Za-z0-9]{32,44})/)?.[1] ?? null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

// GMGN (has its own API)
const GMGN_CACHE = { price: 0, marketCap: 0, name: null as string | null, ts: 0 }
const GMGN_TTL = 8000

async function fetchGmgn(mint: string) {
  if (Date.now() - GMGN_CACHE.ts < GMGN_TTL) return
  try {
    const res = await fetch(`https://gmgn.ai/defi/quotation/v1/tokens/sol/${mint}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return
    const d = (await res.json())?.data?.token
    if (d) {
      GMGN_CACHE.price = parseFloat(d.price ?? 0)
      GMGN_CACHE.marketCap = parseFloat(d.market_cap ?? 0)
      GMGN_CACHE.name = d.symbol ?? d.name ?? null
      GMGN_CACHE.ts = Date.now()
    }
  } catch {}
}

const gmgnAdapter: Adapter = {
  getPrice() {
    if (GMGN_CACHE.price > 0) return GMGN_CACHE.price
    const title = fromTitle(); if (title.price) return title.price
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10}|[\d]{1,6}\.[\d]+)$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="price"]:not([class*="change"]):not([class*="percent"])', '[data-testid*="price"]', '[class*="token-price"]']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1e6) return n
      }
    }
    return null
  },
  getMarketCap() {
    if (GMGN_CACHE.marketCap > 0) return GMGN_CACHE.marketCap
    const el = dt(/^\$[\d,.]+[KMB]$/i)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    return null
  },
  getTokenName() {
    return GMGN_CACHE.name ?? fromTitle().name ?? null
  },
  getMintAddress(href = window.location.href) {
    return href.match(/gmgn\.ai\/sol\/token\/([A-Za-z0-9]{32,44})/)?.[1] ?? null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

// BullX
const bullxAdapter: Adapter = {
  getPrice() {
    const title = fromTitle(); if (title.price) return title.price
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10}|[\d]{1,6}\.[\d]+)$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="current-price"]', '[class*="token-price"]', '[class*="price-value"]', '[data-field="price"]', '[data-testid="price"]', '.price', '[class*="stat-value"]:first-child']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1e6) return n
      }
    }
    return null
  },
  getMarketCap() {
    const el = dt(/^\$[\d,.]+[KMB]$/i)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[data-field="marketCap"]', '[data-field="market_cap"]', '[class*="market-cap-value"]', '[class*="marketcap"]']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    }
    return null
  },
  getTokenName() {
    return fromTitle().name ?? document.querySelector<HTMLElement>('[class*="token-name"], [class*="token-symbol"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    try { const a = new URL(href).searchParams.get('address'); if (a && a.length >= 32) return a } catch {}
    return null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

// Axiom
const axiomAdapter: Adapter = {
  getPrice() {
    const title = fromTitle(); if (title.price) return title.price
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10}|[\d]{1,6}\.[\d]+)$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="price"]:not([class*="change"]):not([class*="percent"])', '[class*="Price"]:not([class*="Change"])', 'span[class*="current"]']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1e6) return n
      }
    }
    return null
  },
  getMarketCap() {
    const el = dt(/^\$[\d,.]+[KMB]$/i)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="marketCap"]', '[class*="market-cap"]', '[class*="mcap"]']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    }
    return null
  },
  getTokenName() {
    return fromTitle().name ?? document.querySelector<HTMLElement>('h1, [class*="symbol"], [class*="tokenName"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    return href.match(/axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/)?.[1] ?? null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

// Padre
const MC_TEXT_RE = /(?:MC|Market\s*Cap)[:\s]*\$?([\d,.]+[KMBkmb]?)/i
const LARGE_DOLLAR_RE = /^\$[\d,]{4,}(\.\d+)?$/

const padreAdapter: Adapter = {
  getPrice() {
    const title = fromTitle(); if (title.price) return title.price
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10}|[\d]{1,6}\.[\d]+)$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="price"]:not([class*="change"])', '[class*="Price"]:not([class*="Diff"])', '[class*="tokenValue"]', '.css-1u0gsx2']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1e6) return n
      }
    }
    return null
  },
  getMarketCap() {
    for (const sel of ['.css-1u0gsx2', '[class*="mcap"]', '[class*="marketCap"]', '[class*="market-cap"]']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) {
        const t = el.textContent?.trim() ?? ''
        if (t.startsWith('$')) { const n = q(t); if (n && n > 0) return n }
      }
    }
    // TreeWalker fallback for MC label
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const t = (node.textContent ?? '').trim()
      const m = t.match(MC_TEXT_RE)
      if (m) { const n = q(m[1]); if (n && n > 100) return n }
      if (LARGE_DOLLAR_RE.test(t)) { const n = q(t); if (n && n >= 1e3 && n <= 1e9) return n }
    }
    return null
  },
  getTokenName() {
    return fromTitle().name ?? document.querySelector<HTMLElement>('[class*="symbol"], [class*="token-symbol"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    const m = href.match(/padre\.gg\/(?:trade\/solana\/|terminal\/)?([A-Za-z0-9]{32,44})/)
    if (m) return m[1]
    // Fallback: scan DOM for pump address
    const re = /([1-9A-HJ-NP-Za-km-z]{32,43}pump)/i
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const match = (node.textContent ?? '').trim().match(re)
      if (match) return match[1]
    }
    return null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

const ADAPTERS: Record<string, Adapter> = {
  photon: photonAdapter,
  gmgn: gmgnAdapter,
  bullx: bullxAdapter,
  axiom: axiomAdapter,
  padre: padreAdapter,
}

// ─── Trade logic ──────────────────────────────────────────────────────────────

function getLivePnL(trade: Trade, price: number): { sol: number; percent: number } {
  const liveValue = trade.tokensHeld * price
  const alreadyOut = trade.closeEvents.reduce((s, e) => s + e.solReturned, 0)
  const sol = liveValue + alreadyOut - trade.invested
  return { sol, percent: (sol / trade.invested) * 100 }
}

// ─── Widget component ─────────────────────────────────────────────────────────

function Widget({ initialTerminal }: { initialTerminal: string }) {
  const [state, setState] = useState<AppState>({
    balance: 50, activeTrade: null, closedTrades: [],
    tpPresets: [25, 50, 100, 200], slPresets: [-10, -20, -30, -50],
    buyPresets: [0.1, 0.5, 1, 5], currency: 'SOL', solPrice: 0,
  })
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [risk, setRisk] = useState<RiskInfo | null>(null)
  const [tab, setTab] = useState<'trade' | 'journal'>('trade')
  const [priceStale, setPriceStale] = useState(false)
  const [currentTerminal, setCurrentTerminal] = useState(initialTerminal)
  const [currentMint, setCurrentMint] = useState<string | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const intervalRef = useRef<number | null>(null)
  const staleRef = useRef<number | null>(null)
  const lastPriceRef = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // Load storage
  useEffect(() => {
    Storage.get().then(setState)
    Storage.onChanged(c => setState(prev => ({ ...prev, ...c })))
  }, [])

  // On URL change (dispatched from outside)
  useEffect(() => {
    const onUrlChange = (e: Event) => {
      const { terminal, mintAddress } = (e as CustomEvent).detail
      setCurrentTerminal(terminal)
      setCurrentMint(mintAddress)
      setTokenInfo(null)
      lastPriceRef.current = null
    }
    window.addEventListener('papermemes:urlchange', onUrlChange)
    return () => window.removeEventListener('papermemes:urlchange', onUrlChange)
  }, [])

  // Setup price polling when terminal/mint changes
  useEffect(() => {
    observerRef.current?.disconnect()
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (staleRef.current) clearTimeout(staleRef.current)

    const adapter = ADAPTERS[currentTerminal]
    if (!adapter) return

    // Fetch GMGN API in background if needed
    if (currentTerminal === 'gmgn' && currentMint) {
      fetchGmgn(currentMint)
      const gmgnInterval = setInterval(() => fetchGmgn(currentMint!), 8000)
      return () => clearInterval(gmgnInterval)
    }

    const poll = () => {
      const price = adapter.getPrice()
      const mc = adapter.getMarketCap()
      const name = adapter.getTokenName()
      const mint = currentMint ?? adapter.getMintAddress() ?? undefined
      const ext = adapter.getExtended()

      if (price && price > 0) {
        if (price !== lastPriceRef.current) {
          lastPriceRef.current = price
          setTokenInfo({ price, marketCap: mc, tokenName: name, mintAddress: mint ?? null, liquidity: null, holders: ext.holders, age: ext.age, timestamp: Date.now() })
          setPriceStale(false)
          if (staleRef.current) clearTimeout(staleRef.current)
          staleRef.current = window.setTimeout(() => setPriceStale(true), 10_000)

          // Check TP/SL
          const trade = stateRef.current.activeTrade
          if (trade && mc !== null) checkTpSl(price, mc, trade)
        }
      }
    }

    poll()
    observerRef.current = new MutationObserver(poll)
    observerRef.current.observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true })
    intervalRef.current = window.setInterval(poll, 3000)

    return () => {
      observerRef.current?.disconnect()
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (staleRef.current) clearTimeout(staleRef.current)
    }
  }, [currentTerminal, currentMint])

  // Fetch risk when mint changes
  useEffect(() => {
    if (!currentMint) return
    chrome.runtime.sendMessage({ type: 'FETCH_RUGCHECK', payload: { mintAddress: currentMint } }, res => {
      if (!res?.ok) return
      const score = res.data?.score ?? 0
      const topHolder = res.data?.topHolders?.[0]?.pct ?? null
      setRisk({ score, topHolderPercent: topHolder ? topHolder * 100 : null, isHighRisk: score > 700 })
    })
  }, [currentMint])

  function checkTpSl(price: number, mc: number, trade: Trade) {
    const { sol: _, percent: pnlPct } = getLivePnL(trade, price)
    if (trade.tp && pnlPct >= trade.tp) {
      doSell(100, price, mc, trade, stateRef.current)
      chrome.runtime.sendMessage({ type: 'NOTIFY', payload: { title: 'Take Profit !', body: `${trade.tokenName} +${pnlPct.toFixed(1)}%` } })
    } else if (trade.tpMC && mc >= trade.tpMC) {
      doSell(100, price, mc, trade, stateRef.current)
      chrome.runtime.sendMessage({ type: 'NOTIFY', payload: { title: 'Take Profit MC !', body: `${trade.tokenName} MC ${fmtMC(mc)}` } })
    } else if (trade.sl && pnlPct <= trade.sl) {
      doSell(100, price, mc, trade, stateRef.current)
      chrome.runtime.sendMessage({ type: 'NOTIFY', payload: { title: 'Stop Loss déclenché', body: `${trade.tokenName} ${pnlPct.toFixed(1)}%` } })
    }
  }

  function handleBuy(amount: number) {
    if (!tokenInfo || !currentMint) return
    if (state.activeTrade || state.balance < amount || !tokenInfo.price) return
    const trade: Trade = {
      id: `trade_${Date.now()}`,
      mintAddress: currentMint,
      tokenName: tokenInfo.tokenName ?? currentMint.slice(0, 6),
      terminal: currentTerminal,
      entryPrice: tokenInfo.price,
      entryMC: tokenInfo.marketCap ?? 0,
      invested: amount,
      tokensHeld: amount / tokenInfo.price,
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
    const pct = Math.min((stillNeeded / tokenInfo.price / trade.tokensHeld) * 100, 100)
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
    const updated: Trade = {
      ...trade,
      tokensHeld: trade.tokensHeld * (1 - percent / 100),
      closeEvents: [...trade.closeEvents, event],
    }
    const newBalance = st.balance + solReturned
    if (percent >= 100 || updated.tokensHeld < 0.00001) {
      const totalOut = updated.closeEvents.reduce((s, e) => s + e.solReturned, 0)
      const pnlSOL = totalOut - trade.invested
      Storage.closeTrade({ ...updated, status: pnlSOL >= 0 ? 'won' : 'lost', closedAt: Date.now(), pnlSOL, pnlPercent: (pnlSOL / trade.invested) * 100 }, newBalance)
    } else {
      Storage.partialClose(updated, newBalance)
    }
  }

  const { balance, activeTrade, closedTrades, currency, solPrice, buyPresets, tpPresets, slPresets } = state
  const price = tokenInfo?.price ?? null
  const mc = tokenInfo?.marketCap ?? null
  const livePnL = activeTrade && price ? getLivePnL(activeTrade, price) : null
  const liveValue = activeTrade && price ? activeTrade.tokensHeld * price : null

  function fmtCur(sol: number) {
    return currency === 'USD' && solPrice > 0 ? `$${(sol * solPrice).toFixed(2)}` : `${fmtSOL(sol)} ≋`
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 280, height: '100vh',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      fontFamily: "'JetBrains Mono', monospace", color: C.text,
      display: 'flex', flexDirection: 'column', zIndex: 2147483647, fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}`, display: 'inline-block' }} />
          <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>PAPERMEMES</span>
        </div>
        <button onClick={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })} style={miniBtn}>
          {currency === 'SOL' ? '≋ SOL' : '$ USD'}
        </button>
      </div>

      {/* Balance */}
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Wallet Virtuel</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtCur(balance)}</div>
      </div>

      {/* Token info */}
      {tokenInfo && (
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{tokenInfo.tokenName ?? '—'}</span>
              <span style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>{currentTerminal}</span>
            </div>
            {tokenInfo.age && <span style={{ color: C.muted, fontSize: 10 }}>{tokenInfo.age}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: priceStale ? C.yellow : C.text }}>
                {price ? (price < 0.01 ? `$${price.toExponential(4)}` : `$${price.toFixed(price < 1 ? 6 : 2)}`) : '—'}
              </span>
              {priceStale && <span style={{ fontSize: 9, color: C.yellow, marginLeft: 4 }}>⚠ non mis à jour</span>}
            </div>
            {tokenInfo.holders != null && <span style={{ color: C.muted, fontSize: 10 }}>{tokenInfo.holders} Hds</span>}
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
            state={state} activeTrade={activeTrade} livePnL={livePnL} liveValue={liveValue}
            buyPresets={buyPresets} tpPresets={tpPresets} slPresets={slPresets}
            hasPrice={!!price}
            onBuy={handleBuy} onSell={handleSell} onSellInitials={handleSellInitials}
            onSetTp={v => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, tp: v, tpMC: null } })}
            onSetSl={v => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, sl: v } })}
            fmtCur={fmtCur}
          />
        )}
        {tab === 'journal' && (
          <JournalPanel closedTrades={closedTrades} currency={currency} solPrice={solPrice} />
        )}
      </div>

      {/* Risk + warning footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 10px', flexShrink: 0 }}>
        {risk?.isHighRisk && <div style={{ color: C.red, fontSize: 10, marginBottom: 2 }}>■ Score risque élevé : {risk.score}/100</div>}
        {risk?.topHolderPercent != null && risk.topHolderPercent > 20 && (
          <div style={{ color: C.red, fontSize: 10, marginBottom: 2 }}>■ Top holder : {risk.topHolderPercent.toFixed(0)}% du supply</div>
        )}
        <div style={{ color: C.yellow, fontSize: 9 }}>⚠ TP/SL s'exécutent uniquement si cet onglet reste ouvert.</div>
      </div>
    </div>
  )
}

// ─── Trade Tab ────────────────────────────────────────────────────────────────

function fmtSOL(n: number): string { return n.toFixed(n < 0.01 ? 4 : 2) }

interface TradeTabProps {
  state: AppState; activeTrade: Trade | null; livePnL: { sol: number; percent: number } | null
  liveValue: number | null; buyPresets: number[]; tpPresets: number[]; slPresets: number[]
  hasPrice: boolean; onBuy: (a: number) => void; onSell: (p: number) => void
  onSellInitials: () => void; onSetTp: (v: number | null) => void; onSetSl: (v: number | null) => void
  fmtCur: (sol: number) => string
}

function TradeTab({ state, activeTrade, livePnL, liveValue, buyPresets, tpPresets, slPresets, hasPrice, onBuy, onSell, onSellInitials, onSetTp, onSetSl, fmtCur }: TradeTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={sectionLabel}>Achat Rapide</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {buyPresets.map(amt => (
            <Btn key={amt} variant="green" size="sm" disabled={!!activeTrade || !hasPrice || state.balance < amt} onClick={() => onBuy(amt)}>
              {amt}≋
            </Btn>
          ))}
        </div>
      </div>

      <Divider />

      {activeTrade && livePnL != null && liveValue != null ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={sectionLabel}>Position ouverte</span>
            <span style={{ color: pnlColor(livePnL.percent), fontSize: 11, fontWeight: 700 }}>{fmtPct(livePnL.percent)}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 10, marginBottom: 6 }}>MC ENTRÉE {fmtMC(activeTrade.entryMC)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {[
              { label: 'INVESTI', value: fmtCur(activeTrade.invested) },
              { label: 'VALEUR LIVE', value: fmtCur(liveValue) },
              { label: 'PNL', value: fmtCur(livePnL.sol), color: pnlColor(livePnL.sol) },
              { label: 'CASHOUT', value: activeTrade.closeEvents.length > 0 ? fmtCur(activeTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0)) : '—' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.surface, borderRadius: 6, padding: '5px 4px', textAlign: 'center' }}>
                <div style={{ color: C.muted, fontSize: 8, marginBottom: 2 }}>{label}</div>
                <div style={{ color: color ?? C.text, fontSize: 10, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 6 }}>
            {[10, 25, 50, 100].map(pct => (
              <Btn key={pct} variant="red" size="sm" onClick={() => onSell(pct)}>{pct}%</Btn>
            ))}
          </div>
          <Btn variant="yellow" style={{ width: '100%', padding: '7px 0' }} onClick={onSellInitials}>
            ⟳ SELL INITIALS — {fmtCur(activeTrade.invested)}
          </Btn>
          <div style={{ color: C.muted, fontSize: 9, textAlign: 'center', marginTop: 3 }}>Récupère votre mise · laisse les gains courir</div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '12px 0' }}>
          {hasPrice ? 'Aucune position ouverte' : 'Chargement du prix…'}
        </div>
      )}

      <Divider />

      <div>
        <div style={sectionLabel}>TP / SL</div>
        {activeTrade ? (
          <>
            <div style={{ color: C.muted, fontSize: 9, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Take Profit</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
              {tpPresets.map(pct => (
                <Btn key={pct} variant="green" size="sm"
                  style={{ border: activeTrade.tp === pct ? `2px solid ${C.green}` : undefined }}
                  onClick={() => onSetTp(activeTrade.tp === pct ? null : pct)}>
                  +{pct}%
                </Btn>
              ))}
            </div>
            <div style={{ color: C.muted, fontSize: 9, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Stop Loss</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {slPresets.map(pct => (
                <Btn key={pct} variant="red" size="sm"
                  style={{ border: activeTrade.sl === pct ? `2px solid ${C.red}` : undefined }}
                  onClick={() => onSetSl(activeTrade.sl === pct ? null : pct)}>
                  {pct}%
                </Btn>
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '8px 0' }}>Ouvrez une position d'abord</div>
        )}
      </div>
    </div>
  )
}

const sectionLabel: React.CSSProperties = { color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, display: 'block' }
const miniBtn: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 10, padding: '3px 7px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }

// ─── Mount + URL watcher ──────────────────────────────────────────────────────

let widgetRoot: ReturnType<typeof createRoot> | null = null
let lastMint: string | null = null

async function tryMount() {
  const { terminal, mintAddress: rawMint } = detectTerminal()

  if (!terminal || !rawMint) {
    // Not a token page — unmount if present
    const el = document.getElementById('papermemes-root')
    if (el) { widgetRoot?.unmount(); widgetRoot = null; el.remove() }
    lastMint = null
    return
  }

  const mint = await resolveMint(rawMint)

  // Same token page — nothing to do
  if (mint === lastMint && document.getElementById('papermemes-root')) return
  lastMint = mint

  // Remount with new terminal context
  const existing = document.getElementById('papermemes-root')
  if (existing) { widgetRoot?.unmount(); widgetRoot = null; existing.remove() }

  // Notify GMGN adapter to prefetch
  if (terminal === 'gmgn') fetchGmgn(mint)

  const div = document.createElement('div')
  div.id = 'papermemes-root'
  document.body.appendChild(div)
  widgetRoot = createRoot(div)
  widgetRoot.render(<Widget initialTerminal={terminal} />)

  // Dispatch mint to widget after mount
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('papermemes:urlchange', { detail: { terminal, mintAddress: mint } }))
  }, 100)
}

// Initial mount
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { tryMount(); setupUrlWatcher() })
} else {
  tryMount()
  setupUrlWatcher()
}

function setupUrlWatcher() {
  let lastHref = window.location.href

  // Patch pushState / replaceState
  const patchHistory = (method: 'pushState' | 'replaceState') => {
    const original = history[method].bind(history)
    history[method] = (...args: Parameters<typeof history.pushState>) => {
      original(...args)
      if (window.location.href !== lastHref) {
        lastHref = window.location.href
        setTimeout(tryMount, 300)
      }
    }
  }
  patchHistory('pushState')
  patchHistory('replaceState')

  window.addEventListener('popstate', () => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href
      setTimeout(tryMount, 300)
    }
  })

  // Polling fallback (1s) — catches SPAs that don't use history API
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href
      setTimeout(tryMount, 300)
    }
  }, 1000)
}

export {}
