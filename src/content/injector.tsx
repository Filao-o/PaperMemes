import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storage } from '../storage'
import type { AppState, Trade, CloseEvent, TokenInfo, RiskInfo } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Tabs, Btn, Divider } from '../popup/components/ui'
import { JournalPanel } from '../popup/components/JournalPanel'

// ─── Solana SVG icon ──────────────────────────────────────────────────────────

function SolIcon({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 16" style={{ display: 'inline', verticalAlign: 'middle', ...style }}>
      <defs>
        <linearGradient id="solG" x1="0" y1="16" x2="20" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path fill="url(#solG)" d="M2.5 13H17l1.5-2H4L2.5 13zm0-4.5H17l1.5-2H4L2.5 8.5zM4 4h13l-1.5-2H2.5L4 4z" />
    </svg>
  )
}

// ─── Currency toggle ──────────────────────────────────────────────────────────

function CurrencyToggle({ value, onChange }: { value: 'SOL' | 'USD'; onChange: () => void }) {
  const isUSD = value === 'USD'
  return (
    <div onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: !isUSD ? C.green : C.muted }}>SOL</span>
      <div style={{ width: 34, height: 18, borderRadius: 9, background: C.surface, border: `1px solid ${C.border}`, position: 'relative' }}>
        <div style={{
          position: 'absolute', top: 3, left: isUSD ? 16 : 3,
          width: 10, height: 10, borderRadius: '50%', background: C.green,
          transition: 'left 0.18s ease',
        }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: isUSD ? C.green : C.muted }}>USD</span>
    </div>
  )
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

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

function dt(regex: RegExp, root: Element = document.body): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (regex.test((node.textContent ?? '').trim())) return node.parentElement
  }
  return null
}

function It(path: string): string | null {
  try {
    const props = (window as any).__NEXT_DATA__?.props?.pageProps
    if (!props) return null
    return path.split('.').reduce((o: any, k) => o?.[k], props) ?? null
  } catch { return null }
}

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
    const fallback = setTimeout(() => { mintCache.set(addr, addr); resolve(addr) }, 3000)
    chrome.runtime.sendMessage({ type: 'RESOLVE_MINT', payload: { poolAddress: addr } }, res => {
      clearTimeout(fallback)
      if (chrome.runtime.lastError || !res?.ok) { mintCache.set(addr, addr); resolve(addr); return }
      const mint = res.data ?? addr
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
  getTokenName() { return GMGN_CACHE.name ?? fromTitle().name ?? null },
  getMintAddress(href = window.location.href) {
    return href.match(/gmgn\.ai\/sol\/token\/([A-Za-z0-9]{32,44})/)?.[1] ?? null
  },
  getExtended: () => ({ liquidity: null, holders: null, age: walkAge() }),
}

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

const MC_TEXT_RE = /(?:MC|Market\s*Cap)[:\s]*\$?([\d,.]+[KMBkmb]?)/i
const LARGE_DOLLAR_RE = /^\$[\d,]{4,}(\.\d+)?$/

function getPadreHolders(): number | null {
  // MUI tab with "Holders" label + count in parentheses: (953)
  const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]')
  for (const tab of tabs) {
    const text = tab.textContent ?? ''
    if (/holders/i.test(text)) {
      const m = text.match(/\((\d[\d,]*)\)/)
      if (m) return parseInt(m[1].replace(/,/g, ''), 10)
    }
  }
  // Fallback: scan for "(NNN)" pattern near "Holders" text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = (node.textContent ?? '').trim()
    if (/^holders$/i.test(t)) {
      // sibling or parent may have the count
      const parent = node.parentElement?.parentElement
      if (parent) {
        const m = parent.textContent?.match(/\((\d[\d,]*)\)/)
        if (m) return parseInt(m[1].replace(/,/g, ''), 10)
      }
    }
  }
  return null
}

const padreAdapter: Adapter = {
  getPrice() {
    const title = fromTitle(); if (title.price) return title.price
    // Target monospace3 elements but only sub-cent prices (not MC values like $43.7K)
    for (const el of document.querySelectorAll<HTMLElement>('[class*="monospace3"]')) {
      const t = (el.textContent ?? '').trim()
      // Price looks like $0.000042 or $1.23, MC looks like $43.7K — skip K/M/B
      if (/[KMB]$/i.test(t)) continue
      const n = q(t); if (n && n > 0 && n < 1000) return n
    }
    const el = dt(/^\$?(0\.0*[1-9][\d.]{0,10})$/)
    if (el) { const n = q(el.textContent); if (n && n > 0) return n }
    for (const sel of ['[class*="price"]:not([class*="change"])', '[class*="Price"]:not([class*="Diff"])', '[class*="tokenValue"]']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const n = q(el.textContent); if (n && n > 0 && n < 1000) return n
      }
    }
    return null
  },
  getMarketCap() {
    // 1. monospace3 avec K/M/B ($43.7K) — format le plus fiable sur Padre
    for (const el of document.querySelectorAll<HTMLElement>('[class*="monospace3"]')) {
      const t = (el.textContent ?? '').trim()
      if (/^\$[\d.]+[KMB]$/i.test(t)) {
        const n = q(t); if (n && n >= 1e3) return n
      }
    }
    // 2. css-1u0gsx2 — même classe, attrape aussi les montants bruts ($10000)
    for (const el of document.querySelectorAll<HTMLElement>('.css-1u0gsx2')) {
      const t = (el.textContent ?? '').trim()
      if (/^\$[\d,.]+[KMB]?$/.test(t)) {
        const n = q(t); if (n && n >= 1e3 && n <= 1e12) return n
      }
    }
    for (const sel of ['[class*="mcap"]', '[class*="marketCap"]', '[class*="market-cap"]', '[class*="MarketCap"]']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) { const n = q(el.textContent); if (n && n >= 1e3) return n }
    }
    // 3. TreeWalker : label MC + valeur, ou gros montant $ brut
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const t = (node.textContent ?? '').trim()
      const mLabel = t.match(MC_TEXT_RE)
      if (mLabel) { const n = q(mLabel[1]); if (n && n >= 1e3) return n }
      if (/^\$[\d,]{4,}(\.\d+)?$/.test(t)) {
        const n = q(t); if (n && n >= 1e3 && n <= 1e12) return n
      }
    }
    return null
  },
  getTokenName() {
    return fromTitle().name ?? document.querySelector<HTMLElement>('[class*="symbol"], [class*="token-symbol"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    const m = href.match(/padre\.gg\/(?:trade\/solana\/|terminal\/)?([A-Za-z0-9]{32,44})/)
    if (m) return m[1]
    const re = /([1-9A-HJ-NP-Za-km-z]{32,43}pump)/i
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const match = (node.textContent ?? '').trim().match(re)
      if (match) return match[1]
    }
    return null
  },
  getExtended: () => ({ liquidity: null, holders: getPadreHolders(), age: walkAge() }),
}

const ADAPTERS: Record<string, Adapter> = {
  photon: photonAdapter, gmgn: gmgnAdapter, bullx: bullxAdapter, axiom: axiomAdapter, padre: padreAdapter,
}

// ─── Trade logic ──────────────────────────────────────────────────────────────

function getLivePnL(trade: Trade, price: number): { sol: number; percent: number } {
  const liveValue = trade.tokensHeld * price
  const alreadyOut = trade.closeEvents.reduce((s, e) => s + e.solReturned, 0)
  const sol = liveValue + alreadyOut - trade.invested
  return { sol, percent: (sol / trade.invested) * 100 }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  })
}

// ─── Widget ───────────────────────────────────────────────────────────────────

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
const BASE = 14 // base font size (12 * 1.15 ≈ 14)

function Widget({ initialTerminal }: { initialTerminal: string }) {
  const [state, setState] = useState<AppState>({
    balance: 50, activeTrade: null, closedTrades: [],
    tpPresets: [10, 20, 50, 100], slPresets: [-10, -20, -50, -100],
    buyPresets: [0.1, 0.5, 1, 5], currency: 'SOL', solPrice: 0,
    slippage: 1, fees: 0.25,
  })
  const [solPriceLocal, setSolPriceLocal] = useState(0)
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [risk, setRisk] = useState<RiskInfo | null>(null)
  const [tab, setTab] = useState<'trade' | 'journal'>('trade')
  const [showConfig, setShowConfig] = useState(false)
  const [priceStale, setPriceStale] = useState(false)
  const [priceDir, setPriceDir] = useState<'up' | 'down' | null>(null)
  const [copied, setCopied] = useState(false)
  const [currentTerminal, setCurrentTerminal] = useState(initialTerminal)
  const [currentMint, setCurrentMint] = useState<string | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const intervalRef = useRef<number | null>(null)
  const staleRef = useRef<number | null>(null)
  const dirRef = useRef<number | null>(null)
  const lastPriceRef = useRef<number | null>(null)
  const prevPriceRef = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    Storage.get().then(setState)
    Storage.onChanged(c => setState(prev => ({ ...prev, ...c })))
  }, [])

  // SOL price — try multiple sources with open CORS
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        const data = await res.json()
        const p = parseFloat(data?.price ?? '0')
        if (p > 0) { setSolPriceLocal(p); return }
      } catch {}
      try {
        const res = await fetch('https://price.jup.ag/v6/price?ids=SOL')
        const data = await res.json()
        const p = data?.data?.SOL?.price ?? 0
        if (p > 0) setSolPriceLocal(p)
      } catch {}
    }
    fetchPrice()
    const t = setInterval(fetchPrice, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onUrlChange = (e: Event) => {
      const { terminal, mintAddress } = (e as CustomEvent).detail
      setCurrentTerminal(terminal)
      setCurrentMint(mintAddress)
      setTokenInfo(null)
      lastPriceRef.current = null
      prevPriceRef.current = null
      setPriceDir(null)
    }
    window.addEventListener('papermemes:urlchange', onUrlChange)
    return () => window.removeEventListener('papermemes:urlchange', onUrlChange)
  }, [])

  useEffect(() => {
    observerRef.current?.disconnect()
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (staleRef.current) clearTimeout(staleRef.current)

    const adapter = ADAPTERS[currentTerminal]
    if (!adapter) return

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
          // Detect direction
          if (prevPriceRef.current !== null && price !== prevPriceRef.current) {
            const dir = price > prevPriceRef.current ? 'up' : 'down'
            setPriceDir(dir)
            if (dirRef.current) clearTimeout(dirRef.current)
            dirRef.current = window.setTimeout(() => setPriceDir(null), 1200)
          }
          prevPriceRef.current = price
          lastPriceRef.current = price

          setTokenInfo({ price, marketCap: mc, tokenName: name, mintAddress: mint ?? null, liquidity: null, holders: ext.holders, age: ext.age, timestamp: Date.now() })
          setPriceStale(false)
          if (staleRef.current) clearTimeout(staleRef.current)
          staleRef.current = window.setTimeout(() => setPriceStale(true), 10_000)

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
      if (dirRef.current) clearTimeout(dirRef.current)
    }
  }, [currentTerminal, currentMint])

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
    const { percent: pnlPct } = getLivePnL(trade, price)
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
    if (!tokenInfo || !currentMint || !tokenInfo.price) return
    if (state.balance < amount) return
    const existing = state.activeTrade
    // Block if a different token is already open
    if (existing && existing.mintAddress !== currentMint) return
    if (existing && existing.mintAddress === currentMint) {
      // DCA: add to existing position, recalculate weighted average entry price and MC
      const newTokensHeld = existing.tokensHeld + amount / tokenInfo.price
      const newInvested = existing.invested + amount
      const prevEntries = existing.entries ?? [{ entryPrice: existing.entryPrice, entryMC: existing.entryMC, invested: existing.invested, tokensHeld: existing.tokensHeld, timestamp: existing.openedAt }]
      const newEntry = { entryPrice: tokenInfo.price, entryMC: tokenInfo.marketCap ?? 0, invested: amount, tokensHeld: amount / tokenInfo.price, timestamp: Date.now() }
      const allEntries = [...prevEntries, newEntry]
      const avgEntryMC = allEntries.reduce((s, e) => s + e.entryMC * e.invested, 0) / newInvested
      const updated: Trade = {
        ...existing,
        tokensHeld: newTokensHeld,
        invested: newInvested,
        entryPrice: newInvested / newTokensHeld,
        entryMC: avgEntryMC,
        entries: allEntries,
      }
      Storage.dcaBuy(updated, state.balance - amount)
    } else {
      const trade: Trade = {
        id: `trade_${Date.now()}`,
        mintAddress: currentMint,
        tokenName: tokenInfo.tokenName ?? currentMint.slice(0, 6),
        terminal: currentTerminal,
        entryPrice: tokenInfo.price,
        entryMC: tokenInfo.marketCap ?? 0,
        invested: amount,
        tokensHeld: amount / tokenInfo.price,
        entries: [{ entryPrice: tokenInfo.price, entryMC: tokenInfo.marketCap ?? 0, invested: amount, tokensHeld: amount / tokenInfo.price, timestamp: Date.now() }],
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

  function handleCopyCA() {
    if (!currentMint) return
    copyToClipboard(currentMint)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const { balance, activeTrade, closedTrades, currency, buyPresets, tpPresets, slPresets } = state
  const solPrice = solPriceLocal
  const price = tokenInfo?.price ?? null
  const mc = tokenInfo?.marketCap ?? null
  const livePnL = activeTrade && price ? getLivePnL(activeTrade, price) : null
  const liveValue = activeTrade && price ? activeTrade.tokensHeld * price : null
  // Buy buttons: disabled only if different token open
  const buyBlocked = !!(activeTrade && activeTrade.mintAddress !== currentMint)

  function fmtCurStr(sol: number) {
    return currency === 'USD' && solPrice > 0 ? `$${(sol * solPrice).toFixed(2)}` : `${fmtSOL(sol)}`
  }

  const dirBg = priceDir === 'up' ? `${C.green}18` : priceDir === 'down' ? `${C.red}18` : 'transparent'

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 290, height: '100vh',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      fontFamily: FONT, color: C.text,
      display: 'flex', flexDirection: 'column', zIndex: 2147483647, fontSize: BASE,
    }}>
      {/* 1 — Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, display: 'inline-block' }} />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>PAPERMEMES</span>
          <span style={{ color: C.muted, fontSize: 10 }}>v1.2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CurrencyToggle
            value={currency}
            onChange={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })}
          />
          <button
            onClick={() => setShowConfig(v => !v)}
            title="Paramètres"
            style={{
              background: showConfig ? C.surface : 'transparent',
              border: `1px solid ${showConfig ? C.green : C.border}`,
              borderRadius: 6, cursor: 'pointer', color: showConfig ? C.green : C.muted,
              fontSize: 14, lineHeight: 1, padding: '3px 6px',
            }}
          >⚙</button>
        </div>
      </div>

      {/* 2 — Wallet */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>Wallet Virtuel</div>
        <div style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
          {currency === 'SOL' ? (
            <><SolIcon size={18} style={{ marginRight: 2 }} />{fmtSOL(balance)}</>
          ) : solPrice > 0 ? (
            `$${(balance * solPrice).toFixed(2)}`
          ) : (
            <span style={{ color: C.muted, fontSize: 14 }}>Chargement…</span>
          )}
        </div>
        <div style={{ color: C.muted, fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
          {currency === 'SOL' ? (
            solPrice > 0 ? `≈ $${(balance * solPrice).toFixed(2)}` : '...'
          ) : (
            <><SolIcon size={10} style={{ marginRight: 2 }} />{fmtSOL(balance)}</>
          )}
        </div>
      </div>

      {/* 3 — Live Token */}
      {tokenInfo && (
        <div style={{
          padding: '8px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          background: dirBg,
          transition: 'background 0.4s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer', borderBottom: `1px dashed ${C.muted}` }}
                onClick={handleCopyCA}
                title="Copier l'adresse CA"
              >
                {tokenInfo.tokenName ?? '—'}
              </span>
              {copied && <span style={{ color: C.green, fontSize: 10 }}>✓ copié</span>}
              <span style={{ color: C.muted, fontSize: 11 }}>{currentTerminal}</span>
            </div>
            {tokenInfo.age && <span style={{ color: C.muted, fontSize: 11 }}>{tokenInfo.age}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: priceDir === 'up' ? C.green : priceDir === 'down' ? C.red : priceStale ? C.yellow : C.text }}>
                {price ? (price < 0.01 ? `$${price.toExponential(4)}` : `$${price.toFixed(price < 1 ? 6 : 2)}`) : '—'}
              </span>
              {priceStale && !priceDir && <span style={{ fontSize: 10, color: C.yellow }}>⚠</span>}
            </div>
            {tokenInfo.holders != null && (
              <span style={{ color: C.muted, fontSize: 11 }}>{tokenInfo.holders.toLocaleString()} holders</span>
            )}
          </div>
        </div>
      )}

      {/* Tabs — masqués quand config ouvert */}
      {!showConfig && (
        <div style={{ flexShrink: 0, padding: '0 12px' }}>
          <Tabs tabs={['trade', 'journal']} active={tab} onChange={t => setTab(t as 'trade' | 'journal')} />
        </div>
      )}

      {/* Contenu principal ou panneau config */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '9px 12px' }}>
        {showConfig ? (
          <ConfigPanel
            buyPresets={buyPresets}
            tpPresets={tpPresets}
            slPresets={slPresets}
            slippage={state.slippage}
            fees={state.fees}
          />
        ) : tab === 'trade' ? (
          <TradeTab
            state={state} activeTrade={activeTrade} livePnL={livePnL} liveValue={liveValue}
            buyPresets={buyPresets} tpPresets={tpPresets} slPresets={slPresets}
            hasPrice={!!price} buyBlocked={buyBlocked}
            onBuy={handleBuy} onSell={handleSell} onSellInitials={handleSellInitials}
            onSetTp={v => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, tp: v, tpMC: null } })}
            onSetSl={v => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, sl: v } })}
            fmtCurStr={fmtCurStr}
            currency={currency}
            solPrice={solPrice}
          />
        ) : (
          <JournalPanel closedTrades={closedTrades} currency={currency} solPrice={solPrice} />
        )}
      </div>

      {/* 7 — Footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '7px 12px', flexShrink: 0 }}>
        {risk?.isHighRisk && <div style={{ color: C.red, fontSize: 11, marginBottom: 2 }}>■ Score risque élevé : {risk.score}/100</div>}
        {risk?.topHolderPercent != null && risk.topHolderPercent > 20 && (
          <div style={{ color: C.red, fontSize: 11, marginBottom: 2 }}>■ Top holder : {risk.topHolderPercent.toFixed(0)}% du supply</div>
        )}
        <div style={{ color: C.yellow, fontSize: 10 }}>⚠ TP/SL s'exécutent uniquement si cet onglet reste ouvert.</div>
      </div>
    </div>
  )
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ buyPresets, tpPresets, slPresets, slippage, fees }: {
  buyPresets: number[]; tpPresets: number[]; slPresets: number[]
  slippage: number; fees: number
}) {
  const pad8 = (arr: number[], sign = 1) => {
    const filled = arr.map(v => String(Math.abs(v)))
    while (filled.length < 8) filled.push('')
    return filled.slice(0, 8)
  }
  const pad4 = (arr: number[]) => {
    const filled = arr.map(v => String(Math.abs(v)))
    while (filled.length < 4) filled.push('')
    return filled.slice(0, 4)
  }

  const [buyInputs, setBuyInputs] = useState<string[]>(() => pad8(buyPresets))
  const [tpInputs, setTpInputs] = useState<string[]>(() => pad4(tpPresets))
  const [slInputs, setSlInputs] = useState<string[]>(() => pad4(slPresets))
  const [slip, setSlip] = useState(String(slippage))
  const [fee, setFee] = useState(String(fees))
  const [saved, setSaved] = useState(false)

  function numInput(val: string, setter: (v: string) => void) {
    if (val === '' || /^\d*\.?\d*$/.test(val)) setter(val)
  }
  function gridInput(i: number, val: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return
    setter(prev => { const n = [...prev]; n[i] = val; return n })
  }

  function handleSave() {
    const buyP = buyInputs.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0)
    const tpP = tpInputs.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0)
    const slP = slInputs.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0).map(v => -v)
    const slipV = parseFloat(slip)
    const feeV = parseFloat(fee)
    Storage.set({
      buyPresets: buyP,
      tpPresets: tpP,
      slPresets: slP,
      ...(isNaN(slipV) ? {} : { slippage: slipV }),
      ...(isNaN(feeV) ? {} : { fees: feeV }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const inputStyle = (filled: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: C.surface, border: `1px solid ${filled ? C.green : C.border}`,
    borderRadius: 6, color: C.text, fontSize: 12, fontWeight: 700,
    padding: '7px 4px', textAlign: 'center', outline: 'none', fontFamily: 'inherit',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Boutons d'achat */}
      <div>
        <div style={sL}>Achat rapide (SOL)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {buyInputs.map((val, i) => (
            <input key={i} type="text" inputMode="decimal" value={val} placeholder="—"
              onChange={e => gridInput(i, e.target.value, setBuyInputs)}
              style={inputStyle(!!val)} />
          ))}
        </div>
      </div>

      {/* Take Profit */}
      <div>
        <div style={sL}>Take Profit (%)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {tpInputs.map((val, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <input type="text" inputMode="decimal" value={val} placeholder="—"
                onChange={e => gridInput(i, e.target.value, setTpInputs)}
                style={inputStyle(!!val)} />
              {val && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: C.green }}>%</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Stop Loss */}
      <div>
        <div style={sL}>Stop Loss (%)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {slInputs.map((val, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <input type="text" inputMode="decimal" value={val} placeholder="—"
                onChange={e => gridInput(i, e.target.value, setSlInputs)}
                style={{ ...inputStyle(!!val), border: `1px solid ${val ? C.red : C.border}` }} />
              {val && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: C.red }}>%</span>}
            </div>
          ))}
        </div>
        <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>Les valeurs sont automatiquement négatives.</div>
      </div>

      {/* Slippage & Fees */}
      <div>
        <div style={sL}>Slippage & Fees</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>SLIPPAGE (%)</div>
            <input type="text" inputMode="decimal" value={slip} placeholder="1"
              onChange={e => numInput(e.target.value, setSlip)}
              style={inputStyle(!!slip)} />
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>FEES (%)</div>
            <input type="text" inputMode="decimal" value={fee} placeholder="0.25"
              onChange={e => numInput(e.target.value, setFee)}
              style={inputStyle(!!fee)} />
          </div>
        </div>
      </div>

      <button onClick={handleSave} style={{
        width: '100%', padding: '9px 0',
        background: saved ? C.green : C.surface,
        border: `1px solid ${C.green}`, borderRadius: 6,
        color: saved ? '#000' : C.green, fontWeight: 700, fontSize: 12,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
      }}>
        {saved ? '✓ Sauvegardé' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── Trade Tab ────────────────────────────────────────────────────────────────

function fmtSOLLocal(n: number): string { return n.toFixed(2) }

interface TradeTabProps {
  state: AppState; activeTrade: Trade | null; livePnL: { sol: number; percent: number } | null
  liveValue: number | null; buyPresets: number[]; tpPresets: number[]; slPresets: number[]
  hasPrice: boolean; buyBlocked: boolean; onBuy: (a: number) => void; onSell: (p: number) => void
  onSellInitials: () => void; onSetTp: (v: number | null) => void; onSetSl: (v: number | null) => void
  fmtCurStr: (sol: number) => string; currency: 'SOL' | 'USD'; solPrice: number
}

function SellInitialsLink({ onSellInitials, invested, AmountLabel }: {
  onSellInitials: () => void
  invested: number
  AmountLabel: React.FC<{ sol: number }>
}) {
  const [hover, setHover] = React.useState(false)
  return (
    <div style={{ textAlign: 'center', marginTop: 4 }}>
      <span
        onClick={onSellInitials}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          color: C.yellow, fontSize: 11, cursor: 'pointer',
          textDecoration: hover ? 'underline' : 'none',
          userSelect: 'none',
        }}
      >
        ⟳ Récupérer la mise — <AmountLabel sol={invested} />
      </span>
    </div>
  )
}

function TradeTab({ state, activeTrade, livePnL, liveValue, buyPresets, tpPresets, slPresets, hasPrice, buyBlocked, onBuy, onSell, onSellInitials, onSetTp, onSetSl, fmtCurStr, currency }: TradeTabProps) {
  function AmountLabel({ sol }: { sol: number }) {
    if (currency === 'USD') return <>{fmtCurStr(sol)}</>
    return <><SolIcon size={11} style={{ marginRight: 2 }} />{fmtSOLLocal(sol)}</>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div>
        <div style={sL}>Achat Rapide</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
          {buyPresets.map(amt => (
            <Btn key={amt} variant="green" size="sm" disabled={buyBlocked || !hasPrice || state.balance < amt} onClick={() => onBuy(amt)}>
              {amt}<SolIcon size={10} style={{ marginLeft: 2 }} />
            </Btn>
          ))}
        </div>
      </div>

      <Divider />

      {activeTrade && livePnL != null && liveValue != null ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={sL}>Position ouverte</span>
            <span style={{ color: pnlColor(livePnL.percent), fontSize: 12, fontWeight: 700 }}>{fmtPct(livePnL.percent)}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 11, marginBottom: 7, display: 'flex', justifyContent: 'space-between' }}>
            <span>MC ENTRÉE {fmtMC(activeTrade.entryMC)}</span>
            {(activeTrade.entries ?? []).length > 1 && (
              <span style={{ color: C.text, fontSize: 10 }}>
                Ave. Entry · {(activeTrade.entries ?? []).length} achats
              </span>
            )}
          </div>
          {/* Lignes par entry — uniquement si DCA (2+ achats) */}
          {(activeTrade.entries ?? []).length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 9 }}>
              {(activeTrade.entries ?? []).map((entry, i) => {
                const entryPnlPct = price ? ((price / entry.entryPrice) - 1) * 100 : null
                const pctColor = entryPnlPct == null ? C.muted : entryPnlPct >= 0 ? C.green : C.red
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: C.surface, borderRadius: 6, padding: '4px 8px',
                    borderLeft: `2px solid ${pctColor}`, fontSize: 11,
                  }}>
                    <span style={{ color: C.muted }}>{fmtMC(entry.entryMC)}</span>
                    <span style={{ color: C.text }}><AmountLabel sol={entry.invested} /></span>
                    <span style={{ color: pctColor, fontWeight: 700 }}>
                      {entryPnlPct != null ? fmtPct(entryPnlPct) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 9 }}>
            {[
              { label: 'INV.', sol: activeTrade.invested },
              { label: 'LIVE', sol: liveValue },
              { label: 'PNL', sol: livePnL.sol, color: pnlColor(livePnL.sol) },
              { label: 'EARNS', sol: activeTrade.closeEvents.length > 0 ? activeTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0) : null },
            ].map(({ label, sol, color }) => (
              <div key={label} style={{ background: C.surface, borderRadius: 6, padding: '6px 4px', textAlign: 'center' }}>
                <div style={{ color: C.muted, fontSize: 9, marginBottom: 2 }}>{label}</div>
                <div style={{ color: color ?? C.text, fontSize: 11, fontWeight: 700 }}>
                  {sol !== null ? <AmountLabel sol={sol} /> : '—'}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 7 }}>
            {[10, 25, 50, 100].map(pct => (
              <Btn key={pct} variant="red" size="sm" onClick={() => onSell(pct)}>{pct}%</Btn>
            ))}
          </div>
          <SellInitialsLink onSellInitials={onSellInitials} invested={activeTrade.invested} AmountLabel={AmountLabel} />
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: 12, padding: '14px 0' }}>
          {hasPrice ? 'Aucune position ouverte' : 'Chargement du prix…'}
        </div>
      )}

      <Divider />

      <div>
        <div style={sL}>TP / SL</div>
        {activeTrade ? (
          <>
            <div style={{ color: C.muted, fontSize: 10, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>Take Profit</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 9 }}>
              {tpPresets.map(pct => (
                <Btn key={pct} variant="green" size="sm"
                  style={{ border: activeTrade.tp === pct ? `2px solid ${C.green}` : undefined }}
                  onClick={() => onSetTp(activeTrade.tp === pct ? null : pct)}>
                  +{pct}%
                </Btn>
              ))}
            </div>
            <div style={{ color: C.muted, fontSize: 10, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>Stop Loss</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
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
          <div style={{ textAlign: 'center', color: C.muted, fontSize: 12, padding: '9px 0' }}>Ouvrez une position d'abord</div>
        )}
      </div>
    </div>
  )
}

const sL: React.CSSProperties = { color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7, display: 'block' }

// ─── Mount + URL watcher ──────────────────────────────────────────────────────

let widgetRoot: ReturnType<typeof createRoot> | null = null
let lastMint: string | null = null

async function tryMount() {
  const { terminal, mintAddress: rawMint } = detectTerminal()

  if (!terminal || !rawMint) {
    const el = document.getElementById('papermemes-root')
    if (el) { widgetRoot?.unmount(); widgetRoot = null; el.remove() }
    lastMint = null
    return
  }

  const mint = await resolveMint(rawMint)

  if (mint === lastMint && document.getElementById('papermemes-root')) return
  lastMint = mint

  const existing = document.getElementById('papermemes-root')
  if (existing) { widgetRoot?.unmount(); widgetRoot = null; existing.remove() }

  if (terminal === 'gmgn') fetchGmgn(mint)

  const div = document.createElement('div')
  div.id = 'papermemes-root'
  document.body.appendChild(div)
  widgetRoot = createRoot(div)
  widgetRoot.render(<Widget initialTerminal={terminal} />)

  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('papermemes:urlchange', { detail: { terminal, mintAddress: mint } }))
  }, 100)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { tryMount(); setupUrlWatcher() })
} else {
  tryMount()
  setupUrlWatcher()
}

function setupUrlWatcher() {
  let lastHref = window.location.href

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

  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href
      setTimeout(tryMount, 300)
    }
  }, 1000)
}

export {}
