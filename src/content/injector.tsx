import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storage } from '../storage'
import type { AppState, Trade, CloseEvent, TokenInfo, RiskInfo } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Tabs, Btn, Divider, SolIcon } from '../popup/components/ui'
import { JournalPanel, TradeCard } from '../popup/components/JournalPanel'

// ─── Currency toggle ──────────────────────────────────────────────────────────

function CurrencyToggle({ value, onChange }: { value: 'SOL' | 'USD'; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{
      display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      background: DS.color.surface, border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: 20, padding: 2, gap: 0, fontFamily: "'Roboto', sans-serif",
    }}>
      {(['SOL', 'USD'] as const).map(opt => (
        <div key={opt} style={{
          padding: '5px 7px', borderRadius: 10,
          fontSize: 12, fontWeight: 700, lineHeight: 1,
          background: value === opt ? DS.color.bg : 'transparent',
          color: value === opt ? DS.color.textOn : 'rgba(0,0,0,0.45)',
          transition: 'all 0.15s',
        }}>{opt}</div>
      ))}
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

let _ageCache: { val: string | null; ts: number } | null = null
function walkAge(): string | null {
  if (_ageCache && Date.now() - _ageCache.ts < 5000) return _ageCache.val
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const age = parseAge((node.textContent ?? '').trim())
    if (age) { _ageCache = { val: age, ts: Date.now() }; return age }
  }
  _ageCache = { val: null, ts: Date.now() }
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

const GMGN_CACHE = { price: 0, marketCap: 0, name: null as string | null, ts: 0, mint: '' }
const GMGN_TTL = 8000

async function fetchGmgn(mint: string) {
  if (GMGN_CACHE.mint === mint && Date.now() - GMGN_CACHE.ts < GMGN_TTL) return
  try {
    const res = await fetch(`https://gmgn.ai/defi/quotation/v1/tokens/sol/${mint}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return
    const d = (await res.json())?.data?.token
    if (d) {
      GMGN_CACHE.price = parseFloat(d.price ?? 0)
      GMGN_CACHE.marketCap = parseFloat(d.market_cap ?? 0)
      GMGN_CACHE.name = d.symbol ?? d.name ?? null
      GMGN_CACHE.mint = mint
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
  getExtended() {
    const el = document.querySelector<HTMLElement>('[data-testid="token-detail-holders-count"]')
    const holders = el ? parseInt((el.textContent ?? '').replace(/,/g, '').trim(), 10) || null : null
    return { liquidity: null, holders, age: walkAge() }
  },
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

const axiomMCCache = { value: 0, mint: '' }

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
    const mint = window.location.href.match(/axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/)?.[1] ?? ''
    if (axiomMCCache.mint !== mint) axiomMCCache.value = 0

    // Axiom changes MC element color by threshold (primaryLightBlue, primaryYellow, etc.)
    // Target the constant structural class [font-variant-numeric:tabular-nums] instead
    for (const el of document.querySelectorAll<HTMLElement>('[class*="tabular-nums"]')) {
      const n = q(el.textContent)
      if (n && n >= 1000) { axiomMCCache.value = n; axiomMCCache.mint = mint; return n }
    }
    // Fallback: text node matching $X.xK/M/B pattern
    const walked = dt(/^\$[\d,.]+[KMB]$/i)
    if (walked) { const n = q(walked.textContent); if (n && n >= 1000) { axiomMCCache.value = n; axiomMCCache.mint = mint; return n } }
    // DOM momentarily unavailable: return last known value for same token
    if (axiomMCCache.value > 0 && axiomMCCache.mint === mint) return axiomMCCache.value
    return null
  },
  getTokenName() {
    return fromTitle().name ?? document.querySelector<HTMLElement>('h1, [class*="symbol"], [class*="tokenName"]')?.textContent?.trim() ?? null
  },
  getMintAddress(href = window.location.href) {
    return href.match(/axiom\.trade\/meme\/([A-Za-z0-9]{32,44})/)?.[1] ?? null
  },
  getExtended() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const m = (node.textContent ?? '').match(/Holders\s*\((\d[\d,]*)\)/i)
      if (m) return { liquidity: null, holders: parseInt(m[1].replace(/,/g, ''), 10), age: walkAge() }
    }
    return { liquidity: null, holders: null, age: walkAge() }
  },
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
    // Parse Padre's subscript price format: $0.0₄145 → 0.00000145
    // Subscript digits ₀₁₂₃₄₅₆₇₈₉ encode the number of leading zeros after "0."
    const SUBSCRIPT_MAP: Record<string, number> = { '₀':0,'₁':1,'₂':2,'₃':3,'₄':4,'₅':5,'₆':6,'₇':7,'₈':8,'₉':9 }
    for (const el of document.querySelectorAll<HTMLElement>('[class*="monospace3"]')) {
      const t = (el.textContent ?? '').trim()
      const sub = t.match(/^\$0\.0([₀-₉])(\d+)$/)
      if (sub) {
        const zeros = SUBSCRIPT_MAP[sub[1]] ?? 0
        return parseFloat(`0.${'0'.repeat(zeros)}${sub[2]}`)
      }
      if (/[KMB]$/i.test(t)) continue
      const n = q(t); if (n && n > 0 && n < 1) return n
    }
    return null
  },
  getMarketCap() {
    // css-1u0gsx2 est la classe unique du MC sur Padre (les valeurs de table utilisent css-5ztp4i etc.)
    const el = document.querySelector<HTMLElement>('.css-1u0gsx2')
    if (el) { const n = q(el.textContent); if (n && n >= 1e3) return n }
    // Fallback: monospace3 avec préfixe $ et suffix K/M/B (les valeurs de table n'ont pas de $)
    for (const el of document.querySelectorAll<HTMLElement>('[class*="monospace3"]')) {
      const t = (el.textContent ?? '').trim()
      if (/^\$[\d.]+[KMB]$/i.test(t)) {
        const n = q(t); if (n && n >= 1e3) return n
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

const FONT = "'Space Grotesk', -apple-system, system-ui, sans-serif"
const BASE = 14
const FS = { v1: 37, v2: 17, v3: 14, v4: 14 } as const

// ─── Design System ────────────────────────────────────────────────────────────
const DS = {
  color: {
    bg:      '#000000',
    surface: '#ffffff',
    textOn:  '#ffffff',
    textOff: '#000000',
  },
  type: {
    title:    { fontSize: 38, fontWeight: 900, lineHeight: 1.05 },
    heading:  { fontSize: 20, fontWeight: 700, lineHeight: 1 },
    subtitle: { fontSize: 15, fontWeight: 600, lineHeight: 1 },
    annex:    { fontSize: 10, fontWeight: 700, lineHeight: 1 },
  },
  pad: { x: 12, y: 10 },
}

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(2)
  if (p >= 0.01) return p.toFixed(4)
  // Compter les zéros après la virgule pour afficher le bon nombre de décimales
  const decimals = Math.max(2, Math.ceil(-Math.log10(p)) + 3)
  return p.toFixed(Math.min(decimals, 10)).replace(/0+$/, '')
}

// ─── Reset Modal ─────────────────────────────────────────────────────────────

const SOL_RESET_PRESETS = [1, 2, 5, 10, 20]
const USD_RESET_PRESETS = [25, 50, 100, 200, 500]

function ResetModal({ onClose, currency, solPrice }: { onClose: () => void; currency: 'SOL' | 'USD'; solPrice: number }) {
  const [localCurrency, setLocalCurrency] = useState<'SOL' | 'USD'>(currency)
  const [amount, setAmount] = useState<number>(localCurrency === 'SOL' ? 5 : 100)
  const [custom, setCustom] = useState('')
  const [confirm, setConfirm] = useState<'full' | 'balance' | null>(null)

  const presets = localCurrency === 'SOL' ? SOL_RESET_PRESETS : USD_RESET_PRESETS
  const activeAmount = custom !== '' ? parseFloat(custom) || 0 : amount
  const activeAmountSOL = localCurrency === 'USD' && solPrice > 0 ? activeAmount / solPrice : activeAmount

  function fmtAmt(amtSOL: number) {
    if (localCurrency === 'USD' && solPrice > 0) return `$${(amtSOL * solPrice).toFixed(2)}`
    return `${amtSOL} SOL`
  }

  function switchCurrency() {
    const next = localCurrency === 'SOL' ? 'USD' : 'SOL'
    setLocalCurrency(next)
    setAmount(next === 'SOL' ? 5 : 100)
    setCustom('')
  }

  function doReset(keepHistory: boolean) {
    if (activeAmountSOL <= 0) return
    Storage.set({ balance: activeAmountSOL, activeTrade: null, ...(keepHistory ? {} : { closedTrades: [] }) })
    onClose()
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2147483647, padding: 16,
  }

  const cardStyle: React.CSSProperties = {
    background: 'rgba(10,8,18,0.92)', border: `1px solid ${C.border}`, borderRadius: 16,
    padding: 26, width: 400, display: 'flex', flexDirection: 'column', gap: 18,
    fontFamily: FONT,
  }

  if (confirm !== null) {
    const isFull = confirm === 'full'
    return (
      <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: FS.v3, letterSpacing: 0.5, color: C.red }}>⚠ CONFIRMATION</div>
          <div style={{ color: C.textSub, fontSize: FS.v2, lineHeight: 1.7 }}>
            {isFull ? (
              <>Ton solde sera réinitialisé à <span style={{ color: '#fff', fontWeight: 700 }}>{fmtAmt(activeAmountSOL)}</span> et <span style={{ color: C.red, fontWeight: 700 }}>tout l'historique sera supprimé</span>. Cette action est irrémédiable.</>
            ) : (
              <>Ton solde sera réinitialisé à <span style={{ color: '#fff', fontWeight: 700 }}>{fmtAmt(activeAmountSOL)}</span>. L'historique sera conservé. Cette action est irrémédiable.</>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => doReset(!isFull)} style={{
              width: '100%', padding: '13px 0', borderRadius: 8, fontFamily: 'inherit',
              background: C.red, border: 'none', color: '#fff',
              fontWeight: 700, fontSize: FS.v3, cursor: 'pointer',
            }}>Confirmer</button>
            <button onClick={() => setConfirm(null)} style={{
              width: '100%', padding: '11px 0', borderRadius: 8, fontFamily: 'inherit',
              background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
              fontWeight: 600, fontSize: FS.v3, cursor: 'pointer',
            }}>Retour</button>
          </div>
        </div>
      </div>
    )
  }

  const cur = localCurrency
  const isUSD = cur === 'USD'

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: FS.v2, letterSpacing: 0.5, color: '#ffffff' }}>RÉINITIALISER LE WALLET</div>
          <div onClick={switchCurrency} style={{
            display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 20, padding: 3,
          }}>
            {(['SOL', 'USD'] as const).map(opt => (
              <div key={opt} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
                background: cur === opt ? '#ffffff' : 'transparent',
                color: cur === opt ? '#111' : '#A1A1A1',
              }}>{opt}</div>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div>
          <div style={{ color: C.muted, fontSize: FS.v3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Montant ({isUSD ? 'USD' : 'SOL'})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {presets.map(p => {
              const sel = amount === p && custom === ''
              return (
                <button key={p} onClick={() => { setAmount(p); setCustom('') }} style={{
                  flex: '1 1 auto',
                  background: sel ? `${C.green}22` : 'rgba(0,0,0,0)',
                  border: `1px solid ${sel ? C.green : C.border}`,
                  borderRadius: 8, color: sel ? C.green : C.textSub,
                  fontWeight: 700, fontSize: FS.v2, padding: '9px 6px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {isUSD ? `$${p}` : p}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom input */}
        <div>
          <div style={{ color: C.muted, fontSize: FS.v3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Montant personnalisé ({isUSD ? 'USD' : 'SOL'})
          </div>
          <input
            type="text" inputMode="decimal" placeholder={isUSD ? 'ex: 250' : 'ex: 25'}
            value={custom}
            onChange={e => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setCustom(e.target.value) }}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(0,0,0,0)', border: `1px solid ${custom ? C.green : C.border}`,
              borderRadius: 8, color: C.text, fontSize: 15, fontWeight: 700,
              padding: '11px 14px', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => activeAmountSOL > 0 && setConfirm('full')} disabled={activeAmountSOL <= 0} style={{
            width: '100%', padding: '13px 0', borderRadius: 8, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: FS.v3, cursor: activeAmountSOL > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmountSOL > 0 ? 1 : 0.4,
          }}>Reset solde + historique</button>
          <button onClick={() => activeAmountSOL > 0 && setConfirm('balance')} disabled={activeAmountSOL <= 0} style={{
            width: '100%', padding: '13px 0', borderRadius: 8, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: FS.v3, cursor: activeAmountSOL > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmountSOL > 0 ? 1 : 0.4,
          }}>Reset solde uniquement</button>
          <button onClick={onClose} style={{
            width: '100%', padding: '11px 0', borderRadius: 8, fontFamily: 'inherit',
            background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
            fontWeight: 600, fontSize: FS.v3, cursor: 'pointer',
          }}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ─── Action Button ────────────────────────────────────────────────────────────

type MetalVariant = 'success' | 'error'

const BTN_COLORS: Record<MetalVariant, { bg: string; text: string }> = {
  success: { bg: '#22c55e', text: '#fff' },
  error:   { bg: '#ef4444', text: '#fff' },
}

function MetalBtn({
  variant, children, disabled, onClick, style,
}: {
  variant: MetalVariant
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  style?: React.CSSProperties
}) {
  const c = BTN_COLORS[variant]

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        background: c.bg,
        border: 'none',
        borderRadius: 10,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        color: c.text, fontWeight: 600, fontSize: FS.v2,
        padding: '10px 4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: "'Roboto', sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ─── Block connection types ───────────────────────────────────────────────────

type BlockId = 'A' | 'B' | 'C'
const SNAP_DIST = 50
const DISCONNECT_DIST = 70
const ALL_BLOCKS: BlockId[] = ['A', 'B', 'C']

// ─── DraggableBlock (controlled) ─────────────────────────────────────────────

function PmLogoFull({ height = 18 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 612 81" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <path d="M0 12V24H19.0667L38 24.1333L31.7333 26.5333C19.3333 31.4667 10.5333 39.2 5.06667 50C3.2 53.6 0 66 0 69.3333C0 70.1333 5.2 70.6667 11.8667 70.6667H23.7333L24.5333 66.4C26.4 56.8 33.6 50 44.4 47.4667L48 46.6667V58.6667V70.8L59.7333 70.4L71.3333 70V47.3333V24.6667L59.7333 24.2667L48 23.8667V12V-6.4075e-07H24H0V12Z" fill="black"/>
      <path d="M107.333 20C101.067 23.2 101.333 23.2 101.333 20.6666C101.333 19.3333 100 18.6666 97.3333 18.6666H93.3333V49.4666V80.1333L97.7333 79.7333L102 79.3333L102.133 69.3333C102.267 56.2666 102.133 56.6666 106.133 59.8666C121.733 72.1333 144.133 54.2666 138.4 34.1333C134.4 20.1333 120 13.6 107.333 20ZM120.667 26.6666C126.533 28.9333 129.2 33.2 129.333 40.5333C129.333 46 128.667 47.8666 125.733 50.9333C118.667 58.2666 106 54.9333 102.667 44.8C100.667 38.6666 102.133 34.1333 107.467 29.3333C112.4 25.0666 115.067 24.5333 120.667 26.6666Z" fill="black"/>
      <path d="M155.067 19.4667C146.533 23.7334 144.933 28.2667 151.2 30.5334C153.333 31.3334 154.667 30.9334 156.933 28.5334C162 22.9334 173.333 25.2 173.333 31.7334C173.333 34.5334 172.667 34.8 160.667 36.8C152.667 38.1334 148.133 40.9333 145.733 46.1333C142.8 52 144.4 56.8 150.533 60.9333C156.133 64.6667 161.867 64.8 168.667 61.3333C174.933 58.1333 174.667 58.1333 174.667 60.6667C174.667 62 176 62.6667 178.667 62.6667H182.667V45.3333C182.667 31.2 182.267 27.2 180.4 24.4C176 17.7334 163.6 15.3334 155.067 19.4667ZM173.067 48.2667C170.4 55.7333 160.267 58.6667 155.467 53.4667C150.933 48.5333 156.933 43.7333 169.333 42.2667C173.733 41.8667 174.667 43.4667 173.067 48.2667Z" fill="black"/>
      <path d="M208.667 18.2666C207.2 18.6666 204.933 19.8666 203.733 20.9333C201.6 22.8 201.333 22.8 200.533 20.8C200 19.4666 198.133 18.6666 195.867 18.6666H192V49.4666V80.1333L196.4 79.7333L200.667 79.3333L201.067 69.0666L201.467 58.6666L206.667 61.3333C217.6 66.9333 229.867 62.5333 235.867 51.0666C236.667 49.4666 237.333 44.4 237.333 39.7333C237.333 32.1333 236.933 30.6666 233.067 26.1333C226.8 18.5333 218.533 15.8666 208.667 18.2666ZM219.067 26.5333C224.933 28.8 228 33.3333 228 39.7333C228 50 224 54.5333 214.933 54.6666C210.267 54.6666 208.4 53.8666 205.2 50.8C202 47.4666 201.333 45.8666 201.333 40.4C201.467 33.6 202.667 31.3333 208 27.6C211.733 25.0666 214.4 24.8 219.067 26.5333Z" fill="black"/>
      <path d="M257.333 18.2667C252.133 20.4 247.467 24.9333 245.2 29.8667C236.8 48.2667 252.667 67.8667 271.733 62.8C277.333 61.3333 285.333 55.7333 285.333 53.2C285.333 52.8 283.6 51.6 281.333 50.6667C277.733 49.2 277.067 49.3333 274.933 52C272.933 54.5333 271.2 55.0667 266.133 55.0667C262.667 54.9333 258.933 54.1333 257.867 53.2C255.2 50.9333 251.867 44.5333 252.933 43.4667C253.467 43.0667 261.2 42.6667 270.4 42.6667H287.067L286.267 36C285.467 29.2 282.4 23.8667 277.2 20.2667C274.267 18.2667 260.667 16.8 257.333 18.2667ZM273.067 27.6C274.533 28.9333 276.133 31.3333 276.667 32.9333C277.467 36 277.333 36 265.467 36C252 36 250.4 34.8 256.667 28.6667C260.667 24.6667 268.933 24.1333 273.067 27.6Z" fill="black"/>
      <path d="M310 18.2666C308.533 18.6666 306.4 19.8666 305.2 20.8C303.333 22.5333 302.933 22.5333 302.267 20.6666C301.733 19.4666 299.733 18.6666 297.333 18.6666H293.333V40.6666V62.6666H298H302.667V48C302.667 34.1333 302.8 33.0666 306 30C308 27.8666 310.8 26.6666 313.333 26.6666C317.067 26.6666 317.333 26.2666 317.333 22C317.333 17.2 316.4 16.6666 310 18.2666Z" fill="black"/>
      <path d="M335.067 20C331.467 22.1333 330.667 22.2666 330.667 20.6666C330.667 19.3333 329.333 18.6666 326.667 18.6666H322.667V40.6666V62.6666H327.333H332V47.3333C332 32.6666 332.133 31.7333 335.333 28.6666C339.067 24.9333 342.133 24.5333 346 27.4666C348.4 29.2 348.667 31.3333 349.067 46L349.6 62.6666H354.133H358.667V47.3333C358.667 32.6666 358.8 31.7333 362 28.6666C365.867 24.6666 369.2 24.4 373.067 28C375.733 30.5333 376 32 376 46.6666V62.6666H380.8H385.6L385.067 44.1333C384.667 26.6666 384.533 25.3333 381.467 22.1333C375.867 16.1333 364.8 16 358.667 21.7333C356.533 23.6 355.333 24 354.933 22.9333C354.133 20.5333 347.333 17.3333 343.067 17.3333C341.067 17.3333 337.333 18.5333 335.067 20Z" fill="black"/>
      <path d="M405.6 18.2667C400.533 19.3333 393.733 27.6 392 34.5333C389.333 46 393.867 56.1333 404.133 61.3333C413.2 66 424.8 63.8667 430.667 56.4L433.467 52.6667L429.467 50.8C425.733 49.0667 425.2 49.0667 423.6 51.0667C417.733 58.8 401.333 54.4 401.333 45.0667C401.333 42.9333 402.933 42.6667 418 42.6667H434.667V38.4C434.667 32.9333 430.267 24 425.867 20.9333C422.533 18.4 411.333 16.9333 405.6 18.2667ZM420.933 27.7333C422.533 28.9333 424 31.2 424.267 32.6667C424.667 35.2 423.867 35.3333 413.067 35.7333C400 36.1333 398.4 34.8 404.667 28.6667C408.533 24.6667 416.533 24.2667 420.933 27.7333Z" fill="black"/>
      <path d="M456 18.2666C454.933 18.6666 452.933 19.8666 451.733 21.0666C449.6 22.9333 449.333 22.8 449.333 20.9333C449.333 19.3333 448.133 18.6666 445.333 18.6666H441.333V40.6666V62.6666H446H450.667V46.9333C450.667 32.1333 450.8 30.9333 453.733 28.2666C457.733 24.5333 460.667 24.5333 464.667 28.6666C467.867 31.7333 468 32.6666 468 47.3333V62.6666H472.667H477.333V46.8C477.333 31.2 477.467 30.8 480.8 28.1333C485.333 24.5333 488.533 24.5333 492 28.2666C494.4 30.8 494.667 32.9333 494.667 46.9333V62.6666H499.333H504V46C504 26.6666 502.533 22.2666 495.333 19.2C489.2 16.6666 485.6 16.8 479.6 20C474.667 22.6666 474.667 22.6666 470.4 20C466.133 17.4666 460.267 16.6666 456 18.2666Z" fill="black"/>
      <path d="M521.6 19.6C508.933 25.7333 505.467 44.6666 515.067 55.6C522.533 64.1333 531.867 66.1333 542.267 61.4666C549.333 58.2666 551.867 53.8666 548.4 51.2C545.2 48.8 544.4 48.9333 541.067 52C534.4 58.2666 520 54 520 45.7333C520 42.6666 520.133 42.6666 536 42.6666H552V36.8C552 22.2666 535.333 12.8 521.6 19.6ZM539.6 28.2666C541.333 29.8666 542.667 32.2666 542.667 33.6C542.667 35.7333 541.467 36 531.333 36C521.6 36 520 35.7333 520 33.7333C520 26.1333 533.333 22.4 539.6 28.2666Z" fill="black"/>
      <path d="M565.867 18.6667C558.4 21.6 556.133 33.3333 561.867 38.8C563.6 40.5333 568.533 42.8 572.8 44C577.067 45.2 581.067 47.2 581.867 48.4C584.133 51.8667 581.2 55.2 575.467 55.7333C571.6 56.1333 569.867 55.4667 566.8 52.4C563.6 49.2 562.4 48.8 559.467 49.7333C554.933 51.2 555.067 52.1333 560.4 57.7333C570.667 68.6667 592 63.7333 592 50.4C592 42.5333 589.333 40.2667 574.933 35.8667C568.4 34 565.6 30.2667 568.133 27.2C570.533 24.2667 578.667 24.8 582.267 28.2667C584.8 30.6667 585.733 30.9333 588.667 29.6C591.867 28.1333 592 27.8667 590 24.8C585.867 18.5333 573.733 15.4667 565.867 18.6667Z" fill="black"/>
      <path d="M597.6 22.6666C597.6 25.1999 597.867 26.2666 598.267 24.9333C598.533 23.7333 598.533 21.5999 598.267 20.2666C597.867 19.0666 597.6 20.1333 597.6 22.6666Z" fill="black"/>
      <path d="M602.667 22.9333C602.667 27.7333 603.2 27.6 604.533 22.2666C605.067 20.1333 604.8 18.6666 604 18.6666C603.333 18.6666 602.667 20.5333 602.667 22.9333Z" fill="black"/>
      <path d="M609.067 19.3333C608.133 20.2666 609.467 26.6666 610.533 26.6666C611.067 26.6666 611.333 24.8 610.933 22.6666C610.4 18.4 610.267 18.2666 609.067 19.3333Z" fill="black"/>
      <path d="M605.333 22.6667C605.333 23.3333 606 24 606.667 24C607.467 24 608 23.3333 608 22.6667C608 21.8667 607.467 21.3333 606.667 21.3333C606 21.3333 605.333 21.8667 605.333 22.6667Z" fill="black"/>
    </svg>
  )
}

function PmLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#111"/>
      <text x="14" y="20" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="900"
        fontFamily="Roboto, sans-serif" letterSpacing="-0.5">P</text>
    </svg>
  )
}

function DraggableBlock({ pos, onPosChange, onDragEnd: onExtEnd, highlightSnap, domRef, children, style, renderHandle }: {
  pos: { x: number; y: number }
  onPosChange: (p: { x: number; y: number }) => void
  onDragEnd?: () => void
  highlightSnap?: boolean
  domRef?: React.RefObject<HTMLDivElement>
  children: React.ReactNode
  style?: React.CSSProperties
  renderHandle?: (onMouseDown: (e: React.MouseEvent) => void) => React.ReactNode
}) {
  const dragging = React.useRef(false)
  const offset = React.useRef({ x: 0, y: 0 })
  const onPosChangeRef = React.useRef(onPosChange)
  onPosChangeRef.current = onPosChange
  const onExtEndRef = React.useRef(onExtEnd)
  onExtEndRef.current = onExtEnd
  const posRef = React.useRef(pos)
  posRef.current = pos

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      onPosChangeRef.current({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y })
    }
    function onUp() {
      if (dragging.current) { dragging.current = false; onExtEndRef.current?.() }
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
    }
  }, [])

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true
    offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      ref={domRef}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 2147483647, width: 300,
        ...style,
        boxShadow: highlightSnap
          ? '0 0 28px rgba(1,253,115,0.55), 0 8px 32px rgba(0,0,0,0.5)'
          : '0 8px 32px rgba(0,0,0,0.5)',
        transition: 'outline 0.1s, box-shadow 0.1s',
      }}
    >
      {renderHandle ? renderHandle(onMouseDown) : (
        <div onMouseDown={onMouseDown} style={{
          height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'grab', background: 'rgba(0,0,0,0)', borderRadius: '8px 8px 0 0',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ color: C.dim, fontSize: FS.v3, letterSpacing: 3 }}>⠿⠿⠿</span>
        </div>
      )}
      {children}
    </div>
  )
}

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
  const [showReset, setShowReset] = useState(false)
  const [priceStale, setPriceStale] = useState(false)
  const [priceDir, setPriceDir] = useState<'up' | 'down' | null>(null)
  const [mcDir, setMcDir] = useState<'up' | 'down' | null>(null)
  const [holdersDir, setHoldersDir] = useState<'up' | 'down' | null>(null)
  const [copied, setCopied] = useState(false)
  const [currentTerminal, setCurrentTerminal] = useState(initialTerminal)
  const [currentMint, setCurrentMint] = useState<string | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const intervalRef = useRef<number | null>(null)
  const staleRef = useRef<number | null>(null)
  const dirRef = useRef<number | null>(null)
  const mcDirRef = useRef<number | null>(null)
  const lastMcRef = useRef<number | null>(null)
  const prevPriceRef = useRef<number | null>(null)
  const holdersDirRef = useRef<number | null>(null)
  const prevHoldersRef = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // ── Block positions & connections ──────────────────────────────────────────
  const POSITIONS_KEY = 'papermemes_block_positions'
  const CONNS_KEY = 'papermemes_block_conns'

  const DEFAULT_POSITIONS = {
    A: { x: window.innerWidth - 316, y: 10 },
    B: { x: window.innerWidth - 316, y: 190 },
    C: { x: window.innerWidth - 316, y: 560 },
  }

  const [positions, setPositions] = useState<Record<BlockId, {x:number;y:number}>>(() => {
    try {
      const saved = localStorage.getItem(POSITIONS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Clamp positions inside viewport
        const clamped: Record<string, {x:number;y:number}> = {}
        for (const id of ALL_BLOCKS) {
          const p = parsed[id] ?? DEFAULT_POSITIONS[id]
          clamped[id] = {
            x: Math.max(0, Math.min(p.x, window.innerWidth - 310)),
            y: Math.max(0, Math.min(p.y, window.innerHeight - 44)),
          }
        }
        return clamped as Record<BlockId, {x:number;y:number}>
      }
    } catch {}
    return DEFAULT_POSITIONS
  })
  const [blockConns, setBlockConns] = useState<{upper: BlockId; lower: BlockId}[]>(() => {
    try {
      const saved = localStorage.getItem(CONNS_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return []
  })
  const [snapPreview, setSnapPreview] = useState<{upper: BlockId; lower: BlockId} | null>(null)
  const refA = useRef<HTMLDivElement>(null)
  const refB = useRef<HTMLDivElement>(null)
  const refC = useRef<HTMLDivElement>(null)
  const positionsRef = useRef(positions); positionsRef.current = positions
  const blockConnsRef = useRef(blockConns); blockConnsRef.current = blockConns
  const snapPreviewRef = useRef(snapPreview); snapPreviewRef.current = snapPreview

  const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
  function fmtClock(d: Date) {
    const day = DAY_SHORT[d.getDay()]
    const date = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${day} ${date}, ${h}:${m}`
  }

  const [clock, setClock] = useState(() => fmtClock(new Date()))
  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock(new Date())), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    Storage.get().then(setState)
    Storage.onChanged(c => setState(prev => ({ ...prev, ...c })))
  }, [])

  // SOL price — via service worker (same source as popup)
  useEffect(() => {
    const fetchPrice = () => {
      chrome.runtime.sendMessage({ type: 'FETCH_SOL_PRICE' }, res => {
        if (res?.ok && res.data > 0) {
          setSolPriceLocal(res.data)
          Storage.set({ solPrice: res.data })
        }
      })
    }
    fetchPrice()
    const t = setInterval(fetchPrice, 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onUrlChange = (e: Event) => {
      const { terminal, mintAddress } = (e as CustomEvent).detail
      setCurrentTerminal(terminal)
      setCurrentMint(mintAddress)
      setTokenInfo(null)
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

    const poll = () => {
      const price = adapter.getPrice()
      // Pour Padre (pump.fun) : supply = 1 milliard → MC = price × 1e9 (plus fiable que scraping)
      const mcFromPrice = (currentTerminal === 'padre' && price && price > 0) ? Math.round(price * 1e9) : null
      const mc = mcFromPrice ?? adapter.getMarketCap()
      const name = adapter.getTokenName()
      const mint = currentMint ?? adapter.getMintAddress() ?? undefined
      const ext = adapter.getExtended()

      if (price && price > 0) {
        if (price !== prevPriceRef.current) {
          if (prevPriceRef.current !== null) {
            const dir = price > prevPriceRef.current ? 'up' : 'down'
            setPriceDir(dir)
            if (dirRef.current) clearTimeout(dirRef.current)
            dirRef.current = window.setTimeout(() => setPriceDir(null), 1200)
          }
          prevPriceRef.current = price

          setTokenInfo({ price, marketCap: mc, tokenName: name, mintAddress: mint ?? null, liquidity: null, holders: ext.holders, age: ext.age, timestamp: Date.now() })
          setPriceStale(false)
          if (staleRef.current) clearTimeout(staleRef.current)
          staleRef.current = window.setTimeout(() => setPriceStale(true), 10_000)
          // MC direction tracking
          if (mc !== null && lastMcRef.current !== null && mc !== lastMcRef.current) {
            const dir = mc > lastMcRef.current ? 'up' : 'down'
            setMcDir(dir)
            if (mcDirRef.current) clearTimeout(mcDirRef.current)
            mcDirRef.current = window.setTimeout(() => setMcDir(null), 1200)
          }
          if (mc !== null) lastMcRef.current = mc

          // Holders direction tracking
          if (ext.holders !== null && prevHoldersRef.current !== null && ext.holders !== prevHoldersRef.current) {
            const hDir = ext.holders > prevHoldersRef.current ? 'up' : 'down'
            setHoldersDir(hDir)
            if (holdersDirRef.current) clearTimeout(holdersDirRef.current)
            holdersDirRef.current = window.setTimeout(() => setHoldersDir(null), 1200)
          }
          if (ext.holders !== null) prevHoldersRef.current = ext.holders

          const trade = stateRef.current.activeTrade
          if (trade && mc !== null) checkTpSl(price, mc, trade)
        }
      }
    }

    // GMGN: populate cache via API then poll; refresh every 8s
    let gmgnInterval: number | null = null
    if (currentTerminal === 'gmgn' && currentMint) {
      fetchGmgn(currentMint).then(() => poll())
      gmgnInterval = window.setInterval(() => fetchGmgn(currentMint!).then(() => poll()), 8000)
    }

    poll()
    let lastPollTime = 0
    observerRef.current = new MutationObserver(() => {
      const now = Date.now()
      if (now - lastPollTime >= 100) {
        lastPollTime = now
        poll()
      }
    })
    observerRef.current.observe(document.body, { childList: true, subtree: true, characterData: true })
    intervalRef.current = window.setInterval(poll, 3000)

    return () => {
      if (gmgnInterval !== null) clearInterval(gmgnInterval)
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
  const solPrice = solPriceLocal || state.solPrice
  const price = tokenInfo?.price ?? null
  const mc = tokenInfo?.marketCap ?? null
  const livePnL = activeTrade && price ? getLivePnL(activeTrade, price) : null
  const liveValue = activeTrade && price ? activeTrade.tokensHeld * price : null
  // Buy buttons: disabled only if different token open
  const buyBlocked = !!(activeTrade && activeTrade.mintAddress !== currentMint)

  function fmtCurStr(sol: number) {
    return currency === 'USD' && solPrice > 0 ? `$${(sol * solPrice).toFixed(2)}` : `${fmtSOL(sol)}`
  }

  const flashLine = priceDir === 'up' ? C.green : priceDir === 'down' ? C.red : 'transparent'

  // ── Connection helpers ─────────────────────────────────────────────────────
  function getRef(id: BlockId) { return id === 'A' ? refA : id === 'B' ? refB : refC }
  function getH(id: BlockId) { return getRef(id).current?.getBoundingClientRect().height ?? 0 }

  // Recompute positions of all blocks connected below `changedId` based on current heights
  function reanchorBelow(changedId: BlockId) {
    const conns = blockConnsRef.current
    if (!conns.some(c => c.upper === changedId)) return
    setPositions(prev => {
      const next = { ...prev }
      // Process connections iteratively (handles chains A→B→C)
      let dirty = true
      while (dirty) {
        dirty = false
        for (const c of conns) {
          const el = getRef(c.upper).current
          if (!el) continue
          const h = el.getBoundingClientRect().height
          const expectedY = next[c.upper].y + h
          if (next[c.lower].y !== expectedY || next[c.lower].x !== next[c.upper].x) {
            next[c.lower] = { x: next[c.upper].x, y: expectedY }
            dirty = true
          }
        }
      }
      return next
    })
  }

  // Watch each block's height and reanchor connected blocks below it
  useEffect(() => {
    const observers: ResizeObserver[] = []
    for (const id of ALL_BLOCKS) {
      const el = getRef(id as BlockId).current
      if (!el) continue
      const obs = new ResizeObserver(() => {
        if (blockConnsRef.current.length > 0) reanchorBelow(id as BlockId)
      })
      obs.observe(el)
      observers.push(obs)
    }
    return () => observers.forEach(o => o.disconnect())
  }, [blockConns])

  function groupBelow(id: BlockId, conns: {upper: BlockId; lower: BlockId}[]): BlockId[] {
    const g: BlockId[] = [id]
    let changed = true
    while (changed) {
      changed = false
      for (const c of conns) {
        if (g.includes(c.upper) && !g.includes(c.lower)) { g.push(c.lower); changed = true }
      }
    }
    return g
  }

  function clampPos(pos: {x:number;y:number}, h: number): {x:number;y:number} {
    return {
      x: Math.max(0, Math.min(pos.x, window.innerWidth - 310)),
      y: Math.max(0, Math.min(pos.y, window.innerHeight - Math.max(h, 44))),
    }
  }

  function handleBlockMove(id: BlockId, newPos: {x:number;y:number}) {
    const conns = blockConnsRef.current
    const group = groupBelow(id, conns)
    const targetH = getH(id)

    // dx/dy computed inside updater from CURRENT state to avoid stale-ref desync on fast drags
    setPositions(p => {
      const clamped = clampPos(newPos, targetH)
      const dx = clamped.x - p[id].x
      const dy = clamped.y - p[id].y
      const next = { ...p }
      for (const bid of group) {
        if (bid === id) {
          next[bid] = clamped
        } else {
          next[bid] = {
            x: Math.max(0, Math.min(p[bid].x + dx, window.innerWidth - 310)),
            y: Math.max(0, p[bid].y + dy),
          }
        }
      }
      return next
    })

    // Disconnect from block above if dragged too far (use ref for approximate check)
    const cur = positionsRef.current
    const above = conns.find(c => c.lower === id)?.upper ?? null
    if (above !== null) {
      const abovePos = cur[above]
      const expectedY = abovePos.y + getH(above)
      if (Math.abs(newPos.y - expectedY) > DISCONNECT_DIST || Math.abs(newPos.x - abovePos.x) > DISCONNECT_DIST) {
        setBlockConns(c => {
          const next = c.filter(v => !(v.upper === above && v.lower === id))
          try { localStorage.setItem(CONNS_KEY, JSON.stringify(next)) } catch {}
          return next
        })
      }
    }

    // Snap preview
    let preview: {upper: BlockId; lower: BlockId} | null = null
    for (const other of ALL_BLOCKS) {
      if (group.includes(other)) continue
      const op = cur[other]
      const ddx = Math.abs(newPos.x - op.x)
      if (ddx > 130) continue
      // other above id
      const dy1 = Math.abs(newPos.y - (op.y + getH(other)))
      if (dy1 < SNAP_DIST && !conns.some(c => c.upper === other && c.lower !== id)) {
        preview = { upper: other, lower: id }; break
      }
      // id above other
      const dy2 = Math.abs((newPos.y + getH(id)) - op.y)
      if (dy2 < SNAP_DIST && !conns.some(c => c.lower === other && c.upper !== id)) {
        preview = { upper: id, lower: other }; break
      }
    }
    setSnapPreview(preview)
  }

  function savePositions(pos: Record<BlockId, {x:number;y:number}>) {
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(pos)) } catch {}
  }

  function handleBlockDrop(id: BlockId) {
    const preview = snapPreviewRef.current
    if (preview) {
      const up = positionsRef.current[preview.upper]
      const snapY = up.y + getH(preview.upper)
      setPositions(p => {
        const next = { ...p, [preview.lower]: { x: up.x, y: snapY } }
        savePositions(next)
        return next
      })
      setBlockConns(c => {
        const next = [...c.filter(v => v.lower !== preview.lower), preview]
        try { localStorage.setItem(CONNS_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    } else {
      savePositions(positionsRef.current)
    }
    setSnapPreview(null)
  }

  const blockStyle: React.CSSProperties = {
    background: 'transparent',
    borderTop: 'none', borderRadius: '0 0 18px 18px', fontFamily: FONT, color: C.text, fontSize: BASE,
  }

  const blocBlur: React.CSSProperties = showReset
    ? { filter: 'blur(5px)', opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }
    : {}

  return (
    <>
      {/* Bloc A — Header + Wallet + Config */}
      <DraggableBlock
        pos={positions.A}
        onPosChange={p => handleBlockMove('A', p)}
        onDragEnd={() => handleBlockDrop('A')}
        highlightSnap={snapPreview?.upper === 'A' || snapPreview?.lower === 'A'}
        domRef={refA}
        style={{
          width: 310, borderRadius: '13px 13px 0 0', overflow: 'hidden',
          background: DS.color.bg,
          border: '1px solid rgba(255,255,255,0.12)',
          ...blocBlur,
        }}
        renderHandle={onDragStart => (
          <div
            onMouseDown={onDragStart}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: `${DS.pad.y}px ${DS.pad.x}px`,
              background: DS.color.surface, cursor: 'grab',
              fontFamily: "'Roboto', sans-serif",
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <PmLogoFull height={18} />
              <span style={{ color: '#999', ...DS.type.annex }}>v1.7.8</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
              <button
                onClick={() => setShowConfig(v => !v)}
                title="Paramètres"
                style={{
                  width: 32, height: 32,
                  background: showConfig ? C.green : DS.color.bg,
                  border: 'none', borderRadius: 10, cursor: 'pointer',
                  color: showConfig ? DS.color.bg : DS.color.textOn,
                  fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >⚙</button>
              <button
                onClick={() => setShowReset(true)}
                title="Réinitialiser le wallet"
                style={{
                  width: 32, height: 32,
                  background: DS.color.bg, border: 'none', borderRadius: 8,
                  cursor: 'pointer', color: DS.color.textOn, fontSize: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >↺</button>
            </div>
          </div>
        )}
      >
        {/* Dark wallet body */}
        <div style={{ background: DS.color.bg, fontFamily: "'Roboto', sans-serif", padding: `${DS.pad.y}px ${DS.pad.x}px 14px` }}>
          {/* Row 1: Wallet label + toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ color: DS.color.textOn, fontSize: 15, fontWeight: 600, lineHeight: 1 }}>Wallet</span>
            <CurrencyToggle
              value={currency}
              onChange={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })}
            />
          </div>
          {/* Row 2: Balance */}
          <div style={{ ...DS.type.title, color: DS.color.textOn, display: 'flex', alignItems: 'center', gap: 6 }}>
            {currency === 'SOL' ? (
              <>{fmtSOL(balance)} <SolIcon size={30} style={{ marginLeft: 2 }} /></>
            ) : solPrice > 0 ? (
              `$${(balance * solPrice).toFixed(2)}`
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.4)', ...DS.type.subtitle }}>Chargement…</span>
            )}
          </div>
          {/* Row 3: Conversion + clock */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ color: DS.color.textOn, fontSize: 14, fontWeight: 600, lineHeight: 1 }}>
              {currency === 'SOL'
                ? solPrice > 0 ? `~ $${(balance * solPrice).toFixed(2)}` : '...'
                : <>{fmtSOL(balance)} <SolIcon size={10} style={{ marginLeft: 2 }} /></>}
            </span>
            <span style={{ color: DS.color.textOn, fontSize: 14, fontWeight: 600, lineHeight: 1 }}>{clock}</span>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div style={{ background: 'rgba(0,0,0,0)', borderTop: `1px solid ${C.border}`, padding: '9px 12px', fontFamily: FONT }}>
            <ConfigPanel
              buyPresets={buyPresets}
              tpPresets={tpPresets}
              slPresets={slPresets}
              slippage={state.slippage}
              fees={state.fees}
              onSaved={() => setShowConfig(false)}
            />
          </div>
        )}
      </DraggableBlock>

      {/* Bloc B — Bloc Mid */}
      <DraggableBlock
        pos={positions.B}
        onPosChange={p => handleBlockMove('B', p)}
        onDragEnd={() => handleBlockDrop('B')}
        highlightSnap={snapPreview?.upper === 'B' || snapPreview?.lower === 'B'}
        domRef={refB}
        style={{
          width: 310, borderRadius: 13, overflow: 'hidden',
          background: DS.color.bg,
          border: '1px solid rgba(255,255,255,0.12)',
          ...blocBlur,
        }}
        renderHandle={onDragStart => (
          <div
            onMouseDown={onDragStart}
            style={{
              cursor: 'grab', background: DS.color.surface,
              padding: `${DS.pad.y}px ${DS.pad.x}px`,
              borderBottom: `7px solid ${flashLine}`,
              transition: 'border-color 0.25s ease',
            }}
          >
            {tokenInfo ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{ fontFamily: "'Roboto', sans-serif", ...DS.type.heading, color: DS.color.textOff, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'rgba(0,0,0,0.3)' }}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={handleCopyCA}
                      title="Copier l'adresse CA"
                    >{tokenInfo.tokenName?.toUpperCase() ?? '—'}</span>
                    {copied && <span style={{ color: '#006622', ...DS.type.annex, fontFamily: FONT }}>✓</span>}
                  </div>
                  <div style={{ color: 'rgba(0,0,0,0.5)', ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif", display: 'flex', alignItems: 'center', gap: 5 }}>
                    {tokenInfo.age && <span>{tokenInfo.age}</span>}
                    {tokenInfo.age && tokenInfo.holders != null && <span>•</span>}
                    {tokenInfo.holders != null && (
                      <span style={{
                        fontWeight: 700,
                        color: holdersDir === 'up' ? '#00a854' : holdersDir === 'down' ? '#d9363e' : 'rgba(0,0,0,0.5)',
                        transition: 'color 0.2s',
                      }}>{tokenInfo.holders.toLocaleString()} Holders</span>
                    )}
                  </div>
                </div>
                <div style={{ fontFamily: "'Roboto', sans-serif", ...DS.type.title, color: DS.color.textOff, lineHeight: 1 }}>
                  {mc != null ? fmtMC(mc) : '—'}
                  {priceStale && !mcDir && <span style={{ ...DS.type.subtitle, color: C.yellow, marginLeft: 4 }}>⚠</span>}
                </div>
              </div>
            ) : (
              <div style={{ color: 'rgba(0,0,0,0.35)', ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif" }}>Navigue sur un token…</div>
            )}
          </div>
        )}
      >
        {/* Dark body */}
        <div style={{ background: DS.color.bg, fontFamily: FONT, color: C.text, fontSize: BASE, padding: `${DS.pad.y}px ${DS.pad.x}px` }}>
          <TradeTabTop
            state={state} activeTrade={activeTrade} livePnL={livePnL} liveValue={liveValue}
            buyPresets={buyPresets}
            hasPrice={!!price} buyBlocked={buyBlocked}
            onBuy={handleBuy} onSell={handleSell} onSellInitials={handleSellInitials}
            fmtCurStr={fmtCurStr} currency={currency} solPrice={solPrice} price={price}
            onOpenConfig={() => setShowConfig(v => !v)}
          />
        </div>
      </DraggableBlock>

      {/* Bloc C — TP/SL + Footer (seulement si trade tab et pas config) */}
      {!showConfig && tab === 'trade' && (
        <DraggableBlock
          pos={positions.C}
          onPosChange={p => handleBlockMove('C', p)}
          onDragEnd={() => handleBlockDrop('C')}
          highlightSnap={snapPreview?.upper === 'C' || snapPreview?.lower === 'C'}
          domRef={refC}
          style={{
            width: 310, borderRadius: 13, overflow: 'hidden',
            background: DS.color.bg,
            border: '1px solid rgba(255,255,255,0.12)',
            ...blocBlur,
          }}
          renderHandle={onDragStart => (
            <div onMouseDown={onDragStart} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: `${DS.pad.y}px ${DS.pad.x}px`, background: DS.color.surface, cursor: 'grab',
              fontFamily: "'Roboto', sans-serif",
            }}>
              <span style={{ ...DS.type.heading, color: DS.color.textOff }}>TP / SL</span>
              <button
                onClick={() => setShowConfig(v => !v)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: 32, height: 32, background: DS.color.bg,
                  border: 'none', borderRadius: 10, cursor: 'pointer',
                  color: DS.color.textOn, fontSize: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>⚙</button>
            </div>
          )}
        >
          <div style={{ background: DS.color.bg, fontFamily: FONT, color: C.text, padding: `${DS.pad.y}px ${DS.pad.x}px`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeTrade ? (
              <>
                {/* TP section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ ...DS.type.subtitle, color: C.text }}>Take Profit</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {tpPresets.map(pct => {
                      const sel = activeTrade.tp === pct
                      return (
                        <button key={pct}
                          onClick={() => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, tp: sel ? null : pct, tpMC: null } })}
                          style={{
                            borderRadius: 10, padding: '10px 4px', cursor: 'pointer',
                            ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif",
                            background: sel ? C.green : 'transparent',
                            border: `1px solid ${C.green}`,
                            color: sel ? DS.color.textOff : C.green,
                          }}>
                          +{pct}%
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />

                {/* SL section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ ...DS.type.subtitle, color: C.text }}>Stop Loss</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {slPresets.map(pct => {
                      const sel = activeTrade.sl === pct
                      return (
                        <button key={pct}
                          onClick={() => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, sl: sel ? null : pct } })}
                          style={{
                            borderRadius: 10, padding: '10px 4px', cursor: 'pointer',
                            ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif",
                            background: sel ? C.red : 'transparent',
                            border: `1px solid ${C.red}`,
                            color: sel ? DS.color.textOn : C.red,
                          }}>
                          {pct}%
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', ...DS.type.subtitle, padding: '14px 0' }}>
                Ouvrez une position d'abord
              </div>
            )}

            {/* Footer */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {risk?.isHighRisk && (
                <div style={{ color: C.red, ...DS.type.annex }}>■ Score risque élevé : {risk.score}/100</div>
              )}
              {risk?.topHolderPercent != null && risk.topHolderPercent > 20 && (
                <div style={{ color: C.red, ...DS.type.annex }}>■ Top holder : {risk.topHolderPercent.toFixed(0)}% du supply</div>
              )}
              <div style={{ color: C.yellow, ...DS.type.annex }}>⚠ TP/SL actifs uniquement si cet onglet reste ouvert.</div>
            </div>
          </div>
        </DraggableBlock>
      )}

      {showReset && <ResetModal onClose={() => setShowReset(false)} currency={currency} solPrice={solPrice} />}
    </>
  )
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ buyPresets, tpPresets, slPresets, slippage, fees, onSaved }: {
  buyPresets: number[]; tpPresets: number[]; slPresets: number[]
  slippage: number; fees: number; onSaved?: () => void
}) {
  const pad = (arr: number[], n: number) => {
    const filled = arr.map(v => String(Math.abs(v)))
    while (filled.length < n) filled.push('')
    return filled.slice(0, n)
  }

  const [buyInputs, setBuyInputs] = useState<string[]>(() => pad(buyPresets, 8))
  const [tpInputs, setTpInputs] = useState<string[]>(() => pad(tpPresets, 4))
  const [slInputs, setSlInputs] = useState<string[]>(() => pad(slPresets, 4))
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
    setTimeout(() => { setSaved(false); onSaved?.() }, 1000)
  }

  const inputStyle = (filled: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0)', border: `1px solid ${filled ? C.green : C.border}`,
    borderRadius: 6, color: C.text, fontSize: FS.v3, fontWeight: 700,
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
        <div style={{ color: 'rgba(240,240,250,0.9)', fontSize: FS.v3, marginTop: 5 }}>Les valeurs sont automatiquement négatives.</div>
      </div>

      {/* Slippage & Fees */}
      <div>
        <div style={sL}>Slippage & Fees</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ color: 'rgba(240,240,250,0.9)', fontSize: FS.v2, marginBottom: 4 }}>SLIPPAGE (%)</div>
            <input type="text" inputMode="decimal" value={slip} placeholder="1"
              onChange={e => numInput(e.target.value, setSlip)}
              style={inputStyle(!!slip)} />
          </div>
          <div>
            <div style={{ color: 'rgba(240,240,250,0.9)', fontSize: FS.v2, marginBottom: 4 }}>FEES (%)</div>
            <input type="text" inputMode="decimal" value={fee} placeholder="0.25"
              onChange={e => numInput(e.target.value, setFee)}
              style={inputStyle(!!fee)} />
          </div>
        </div>
      </div>

      <button onClick={handleSave} style={{
        width: '100%', padding: '9px 0',
        background: saved ? C.green : 'rgba(0,0,0,0)',
        border: `1px solid ${C.green}`, borderRadius: 6,
        color: saved ? '#000' : C.green, fontWeight: 700, fontSize: FS.v3,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
      }}>
        {saved ? '✓ Sauvegardé' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── Trade Tab (Top part only: Achat Rapide + Position Ouverte) ───────────────

interface TradeTabTopProps {
  state: AppState; activeTrade: Trade | null; livePnL: { sol: number; percent: number } | null
  liveValue: number | null; buyPresets: number[]
  hasPrice: boolean; buyBlocked: boolean; onBuy: (a: number) => void; onSell: (p: number) => void
  onSellInitials: () => void; onOpenConfig: () => void
  fmtCurStr: (sol: number) => string; currency: 'SOL' | 'USD'; solPrice: number; price: number | null
}

function TradeTabTop({ state, activeTrade, livePnL, liveValue, buyPresets, hasPrice, buyBlocked, onBuy, onSell, onSellInitials, onOpenConfig, fmtCurStr, currency, price }: TradeTabTopProps) {
  const [pnlFlash, setPnlFlash] = useState<'up' | 'down' | null>(null)
  const [pnlFlashKey, setPnlFlashKey] = useState(0)
  const prevPnlRef = useRef<number | null>(null)

  useEffect(() => {
    const cur = livePnL?.sol ?? null
    if (cur !== null && prevPnlRef.current !== null && cur !== prevPnlRef.current) {
      setPnlFlash(cur > prevPnlRef.current ? 'up' : 'down')
      setPnlFlashKey(k => k + 1)
    }
    if (cur !== null) prevPnlRef.current = cur
  }, [livePnL?.sol])

  function AmountLabel({ sol }: { sol: number }) {
    if (currency === 'USD') return <>{fmtCurStr(sol)}</>
    return <>{fmtSOL(sol)} <SolIcon size={11} fill="#fff" style={{ marginLeft: 2 }} /></>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Quick Buy ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: "'Roboto', sans-serif", ...DS.type.subtitle, color: C.text }}>Quick Buy</span>
          <button onClick={onOpenConfig} onMouseDown={e => e.stopPropagation()} style={{ background: DS.color.surface, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, cursor: 'pointer', color: DS.color.textOff, fontSize: 18, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700 }}>⚙</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {buyPresets.map(amt => (
            <MetalBtn key={amt} variant="success"
              disabled={buyBlocked || !hasPrice || state.balance < amt}
              onClick={() => onBuy(amt)}
              style={{ width: '100%' }}
            >
              <span>{amt}</span><SolIcon size={11} fill="#FFF7F0" />
            </MetalBtn>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: C.border, margin: '4px 0' }} />

      {/* ── Open Trades ── */}
      {activeTrade && livePnL != null && liveValue != null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Header: Open Trades + PnL% */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Roboto', sans-serif", ...DS.type.subtitle, color: C.text }}>PnL (%)</span>
            <span style={{ fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 15, color: pnlColor(livePnL.percent) }}>{fmtPct(livePnL.percent)}</span>
          </div>

          {/* MC Entry / Ave. Entries */}
          {(() => {
            const entries = activeTrade.entries ?? []
            const multiEntry = entries.length > 1
            const avgMC = multiEntry
              ? entries.reduce((s, e) => s + e.entryMC * e.invested, 0) / entries.reduce((s, e) => s + e.invested, 0)
              : null
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.9)', ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif" }}>
                  MC Entry{multiEntry ? ' or Ave. Entries' : ''}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif" }}>
                  {multiEntry && avgMC != null ? fmtMC(avgMC) : fmtMC(activeTrade.entryMC)}
                </span>
              </div>
            )
          })()}

          {/* Entry rows — toutes les entries, triées par date */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...(activeTrade.entries ?? [{ entryPrice: activeTrade.entryPrice, entryMC: activeTrade.entryMC, invested: activeTrade.invested, tokensHeld: activeTrade.tokensHeld, timestamp: activeTrade.openedAt }])].sort((a, b) => a.timestamp - b.timestamp).map((entry, i) => {
              const entryPnlPct = price ? ((price / entry.entryPrice) - 1) * 100 : null
              const pctColor = entryPnlPct == null ? C.muted : entryPnlPct >= 0 ? C.green : C.red
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#111', borderRadius: 6, padding: '7px 10px',
                }}>
                  <span style={{ color: '#ffffff', ...DS.type.subtitle, fontFamily: "'Roboto', sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.35)', letterSpacing: -1 }}>——</span>
                    {fmtMC(entry.entryMC)}
                    <span style={{ color: 'rgba(255,255,255,0.35)' }}>•</span>
                    {fmtSOL(entry.invested)}<SolIcon size={10} fill="#ffffff" style={{ marginLeft: 2 }} />
                  </span>
                  <span style={{ color: pctColor, ...DS.type.subtitle, fontWeight: 700, fontFamily: "'Roboto', sans-serif" }}>
                    {entryPnlPct != null ? fmtPct(entryPnlPct) : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Stats: INVEST / LIVE / PNL / EARNS */}
          <div style={{ background: DS.color.surface, borderRadius: 10, padding: '9px 7px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[
              { label: 'Invest.', sol: activeTrade.invested },
              { label: 'Live',    sol: liveValue },
              { label: 'PnL',    sol: livePnL.sol },
              { label: 'Earns',  sol: activeTrade.closeEvents.length > 0 ? activeTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0) : null },
            ].map(({ label, sol }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: DS.color.textOff, fontFamily: "'Roboto', sans-serif" }}>{label}</span>
                <div
                  key={label === 'PnL' ? pnlFlashKey : label}
                  className={label === 'PnL' && pnlFlash ? `pm-flash-${pnlFlash}` : undefined}
                  style={{
                    background: DS.color.bg, borderRadius: 8, padding: '8px 4px',
                    width: '100%', textAlign: 'center',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                    fontSize: 14, fontWeight: 600, lineHeight: 1, color: DS.color.textOn, fontFamily: "'Roboto', sans-serif",
                  }}
                >
                  {sol != null ? <>{fmtSOL(sol)}<SolIcon size={10} fill="#fff" style={{ marginLeft: 1 }} /></> : '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Sell buttons: 10 / 25 / 50 / 100 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[10, 25, 50, 100].map(pct => (
              <MetalBtn key={pct} variant="error" onClick={() => onSell(pct)} style={{ width: '100%' }}>
                {pct}%
              </MetalBtn>
            ))}
          </div>

          {/* Sell Inits */}
          <div style={{ textAlign: 'center' }}>
            <span onClick={onSellInitials} style={{
              color: C.text, ...DS.type.subtitle, cursor: 'pointer', fontFamily: "'Roboto', sans-serif",
              borderBottom: `1px solid rgba(255,255,255,0.5)`, paddingBottom: 2,
              userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              Sell Inits <span style={{ color: 'rgba(255,255,255,0.35)', letterSpacing: -1 }}>——</span> {fmtSOL(activeTrade.invested)}<SolIcon size={10} fill="#fff" style={{ marginLeft: 0 }} />
            </span>
          </div>

        </div>
      ) : (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: FS.v4, padding: '14px 0' }}>
          {hasPrice ? 'Aucune position ouverte' : 'Chargement du prix…'}
        </div>
      )}
    </div>
  )
}

const sL: React.CSSProperties = { color: 'rgba(240,240,250,0.9)', fontSize: FS.v2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7, display: 'block' }

// ─── Mount + URL watcher ──────────────────────────────────────────────────────

let widgetRoot: ReturnType<typeof createRoot> | null = null
let lastMint: string | null = null

function injectFont() {
  if (document.getElementById('papermemes-font')) return
  const link = document.createElement('link')
  link.id = 'papermemes-font'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@700&family=Roboto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700;800&display=swap'
  document.head.appendChild(link)
  const style = document.createElement('style')
  style.textContent = `
    @keyframes pm-flash-up   { 0%{color:#fff} 35%{color:#01fd73} 100%{color:#fff} }
    @keyframes pm-flash-down { 0%{color:#fff} 35%{color:#FE0149} 100%{color:#fff} }
    .pm-flash-up   { animation: pm-flash-up   0.75s ease; }
    .pm-flash-down { animation: pm-flash-down 0.75s ease; }
  `
  document.head.appendChild(style)
}

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
  injectFont()

  const div = document.createElement('div')
  div.id = 'papermemes-root'
  document.body.appendChild(div)
  widgetRoot = createRoot(div)
  widgetRoot.render(<Widget initialTerminal={terminal} />)

  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('papermemes:urlchange', { detail: { terminal, mintAddress: mint } }))
  }, 100)
}

function scheduleRetry() {
  let attempts = 0
  const id = setInterval(() => {
    if (document.getElementById('papermemes-root') || ++attempts > 10) { clearInterval(id); return }
    tryMount()
  }, 500)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { tryMount(); setupUrlWatcher(); scheduleRetry() })
} else {
  tryMount()
  setupUrlWatcher()
  scheduleRetry()
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
