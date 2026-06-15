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
      background: '#1a1a1a', border: '1px solid #333',
      borderRadius: 20, padding: 2, gap: 0, fontFamily: "'Roboto', sans-serif",
    }}>
      {(['SOL', 'USD'] as const).map(opt => (
        <div key={opt} style={{
          padding: '4px 11px', borderRadius: 16, fontSize: 11, fontWeight: 700,
          background: value === opt ? '#ffffff' : 'transparent',
          color: value === opt ? '#111' : '#A1A1A1',
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

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(2)
  if (p >= 0.01) return p.toFixed(4)
  // Compter les zéros après la virgule pour afficher le bon nombre de décimales
  const decimals = Math.max(2, Math.ceil(-Math.log10(p)) + 3)
  return p.toFixed(Math.min(decimals, 10)).replace(/0+$/, '')
}

// ─── Reset Modal ─────────────────────────────────────────────────────────────

const RESET_PRESETS = [2, 5, 10, 15, 50]

function ResetModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<number>(50)
  const [custom, setCustom] = useState('')

  const activeAmount = custom !== '' ? parseFloat(custom) || 0 : amount

  function handleReset(keepHistory: boolean) {
    if (activeAmount <= 0) return
    Storage.set({
      balance: activeAmount,
      activeTrade: null,
      ...(keepHistory ? {} : { closedTrades: [] }),
    })
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2147483647, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'rgba(0,0,0,0)', border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 18, width: 280, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: C.yellow }}>RÉINITIALISER LE WALLET</div>

        {/* Presets */}
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Montant (SOL)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RESET_PRESETS.map(p => (
              <button key={p} onClick={() => { setAmount(p); setCustom('') }} style={{
                flex: '1 1 auto',
                background: amount === p && custom === '' ? `${C.yellow}22` : 'rgba(0,0,0,0)',
                border: `1px solid ${amount === p && custom === '' ? C.yellow : C.border}`,
                borderRadius: 6, color: amount === p && custom === '' ? C.yellow : C.textSub,
                fontWeight: 700, fontSize: 12, padding: '6px 4px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{p}</button>
            ))}
          </div>
        </div>

        {/* Custom input */}
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Montant personnalisé</div>
          <input
            type="text" inputMode="decimal" placeholder="ex: 25"
            value={custom}
            onChange={e => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setCustom(e.target.value) }}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(0,0,0,0)', border: `1px solid ${custom ? C.yellow : C.border}`,
              borderRadius: 6, color: C.text, fontSize: 13, fontWeight: 700,
              padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Résumé */}
        <div style={{ color: C.muted, fontSize: 11, textAlign: 'center' }}>
          Nouveau solde : <span style={{ color: C.yellow, fontWeight: 700 }}>{activeAmount > 0 ? `${activeAmount} SOL` : '—'}</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => handleReset(false)} disabled={activeAmount <= 0} style={{
            width: '100%', padding: '9px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: 12, cursor: activeAmount > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmount > 0 ? 1 : 0.4,
          }}>Reset solde + historique</button>
          <button onClick={() => handleReset(true)} disabled={activeAmount <= 0} style={{
            width: '100%', padding: '9px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.yellow}20`, border: `1px solid ${C.yellow}70`, color: C.yellow,
            boxShadow: `0 0 10px ${C.yellow}35`,
            fontWeight: 700, fontSize: 12, cursor: activeAmount > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmount > 0 ? 1 : 0.4,
          }}>Reset solde uniquement</button>
          <button onClick={onClose} style={{
            width: '100%', padding: '7px 0', borderRadius: 6, fontFamily: 'inherit',
            background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
            fontWeight: 600, fontSize: 11, cursor: 'pointer',
          }}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ─── Block connection types ───────────────────────────────────────────────────

type BlockId = 'A' | 'B' | 'C'
const SNAP_DIST = 50
const DISCONNECT_DIST = 70
const ALL_BLOCKS: BlockId[] = ['A', 'B', 'C']

// ─── DraggableBlock (controlled) ─────────────────────────────────────────────

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
          <span style={{ color: C.dim, fontSize: 10, letterSpacing: 3 }}>⠿⠿⠿</span>
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

  const [positions, setPositions] = useState<Record<BlockId, {x:number;y:number}>>(() => {
    try {
      const saved = localStorage.getItem(POSITIONS_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return {
      A: { x: window.innerWidth - 316, y: 10 },
      B: { x: window.innerWidth - 316, y: 190 },
      C: { x: window.innerWidth - 316, y: 560 },
    }
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

  const [clock, setClock] = useState(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  })
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setClock(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)
    }, 30_000)
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

    if (currentTerminal === 'gmgn' && currentMint) {
      fetchGmgn(currentMint)
      const gmgnInterval = setInterval(() => fetchGmgn(currentMint!), 8000)
      return () => clearInterval(gmgnInterval)
    }

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

  function handleBlockMove(id: BlockId, newPos: {x:number;y:number}) {
    const conns = blockConnsRef.current
    const prev = positionsRef.current
    const dx = newPos.x - prev[id].x
    const dy = newPos.y - prev[id].y
    const group = groupBelow(id, conns)

    setPositions(p => {
      const next = { ...p }
      for (const bid of group) next[bid] = { x: p[bid].x + dx, y: p[bid].y + dy }
      return next
    })

    // Disconnect from block above if dragged too far
    const above = conns.find(c => c.lower === id)?.upper ?? null
    if (above !== null) {
      const abovePos = prev[above]
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
      const op = prev[other]
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

  return (
    <>
      {showReset && <ResetModal onClose={() => setShowReset(false)} />}

      {/* Bloc A — Header + Wallet + Config */}
      <DraggableBlock
        pos={positions.A}
        onPosChange={p => handleBlockMove('A', p)}
        onDragEnd={() => handleBlockDrop('A')}
        highlightSnap={snapPreview?.upper === 'A' || snapPreview?.lower === 'A'}
        domRef={refA}
        style={{
          width: 310, borderRadius: 18, overflow: 'hidden',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
        renderHandle={onDragStart => (
          /* White header — sert aussi de zone de drag */
          <div
            onMouseDown={onDragStart}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: '#ffffff', cursor: 'grab',
              fontFamily: "'Roboto', sans-serif",
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PmLogo size={26} />
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111', letterSpacing: -0.3 }}>PaperMemes</span>
              <span style={{ color: '#A1A1A1', fontSize: 11 }}>v1.3</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
              <button
                onClick={() => setShowConfig(v => !v)}
                title="Paramètres"
                style={{
                  width: 32, height: 32,
                  background: showConfig ? C.yellow : '#111',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: showConfig ? '#000' : '#fff',
                  fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >⚙</button>
              <button
                onClick={() => setShowReset(true)}
                title="Réinitialiser le wallet"
                style={{
                  width: 32, height: 32,
                  background: '#111', border: 'none', borderRadius: 8,
                  cursor: 'pointer', color: '#fff', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >↺</button>
            </div>
          </div>
        )}
      >
        {/* Dark wallet body */}
        <div style={{ background: '#111', fontFamily: "'Roboto', sans-serif", padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              background: '#fff', color: '#111', fontWeight: 700, fontSize: 12,
              padding: '3px 10px', borderRadius: 20,
            }}>Wallet</span>
            <CurrencyToggle
              value={currency}
              onChange={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })}
            />
          </div>
          <div style={{ fontSize: 33, fontWeight: 900, color: '#fff', display: 'flex', alignItems: 'center', gap: 2 }}>
            {currency === 'SOL' ? (
              <>{fmtSOL(balance)} <SolIcon size={22} style={{ marginLeft: 2 }} /></>
            ) : solPrice > 0 ? (
              `$${(balance * solPrice).toFixed(2)}`
            ) : (
              <span style={{ color: '#A1A1A1', fontSize: 16 }}>Chargement…</span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#A1A1A1', fontSize: 15, marginBottom: 4 }}>
              {currency === 'SOL'
                ? solPrice > 0 ? `= $${(balance * solPrice).toFixed(2)}` : '...'
                : <>{fmtSOL(balance)} <SolIcon size={11} style={{ marginLeft: 2 }} /></>}
            </span>
            <span style={{ color: '#A1A1A1', fontSize: 13 }}>{clock}</span>
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
          width: 310, borderRadius: 18, overflow: 'hidden',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
        renderHandle={onDragStart => (
          <div
            onMouseDown={onDragStart}
            style={{
              cursor: 'grab', background: '#ffffff',
              padding: '10px 14px',
              borderBottom: `7px solid ${flashLine}`,
              transition: 'border-color 0.25s ease',
            }}
          >
            {tokenInfo ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{ fontFamily: "'Roboto Mono', monospace", fontWeight: 700, fontSize: 16, color: '#111', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: '#A1A1A1' }}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={handleCopyCA}
                      title="Copier l'adresse CA"
                    >{tokenInfo.tokenName?.toUpperCase() ?? '—'}</span>
                    {copied && <span style={{ color: '#006622', fontSize: 10, fontFamily: FONT }}>✓</span>}
                  </div>
                  <div style={{ color: '#555', fontSize: 12, fontFamily: "'Roboto', sans-serif", marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {tokenInfo.age && <span>{tokenInfo.age}</span>}
                    {tokenInfo.age && tokenInfo.holders != null && <span>•</span>}
                    {tokenInfo.holders != null && (
                      <span style={{
                        fontWeight: 700,
                        color: holdersDir === 'up' ? C.green : holdersDir === 'down' ? C.red : '#555',
                        transition: 'color 0.2s',
                      }}>{tokenInfo.holders.toLocaleString()} holders</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Roboto', sans-serif", fontWeight: 900, fontSize: 35, color: '#111', lineHeight: 1, marginTop: 6 }}>
                    {mc != null ? fmtMC(mc) : '—'}
                    {priceStale && !mcDir && <span style={{ fontSize: 11, color: C.yellow, marginLeft: 4 }}>⚠</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#A1A1A1', fontSize: 12, fontFamily: "'Roboto', sans-serif" }}>Navigue sur un token…</div>
            )}
          </div>
        )}
      >
        {/* Dark body */}
        <div style={{ background: 'rgba(0,0,0,0)', fontFamily: FONT, color: C.text, fontSize: BASE, padding: '10px 12px' }}>
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
            width: 310, borderRadius: 18, overflow: 'hidden',
            background: 'rgba(0,0,0,0.20)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
          renderHandle={onDragStart => (
            <div onMouseDown={onDragStart} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: '#ffffff', cursor: 'grab',
              fontFamily: "'Roboto', sans-serif",
            }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>Take Profit / Stop Loss</span>
              <button
                onClick={() => setShowConfig(v => !v)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: 32, height: 32, background: showConfig ? C.yellow : '#111',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: showConfig ? '#000' : '#fff', fontSize: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>⚙</button>
            </div>
          )}
        >
          <div style={{ background: 'rgba(0,0,0,0)', fontFamily: FONT, color: C.text, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeTrade ? (
              <>
                {/* TP section */}
                <div style={{ background: 'rgba(0,0,0,0)', borderRadius: 12, padding: '10px 10px 12px' }}>
                  <div style={{ display: 'inline-block', background: '#ffffff', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#111', marginBottom: 8, fontFamily: "'Roboto', sans-serif" }}>TP</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {tpPresets.map(pct => (
                      <button key={pct}
                        onClick={() => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, tp: activeTrade.tp === pct ? null : pct, tpMC: null } })}
                        style={{
                          background: 'linear-gradient(160deg, #5dffaa 0%, #01fd73 45%, #00c057 100%)',
                          border: activeTrade.tp === pct ? '2px solid #fff' : '2px solid transparent',
                          borderRadius: 10, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13,
                          padding: '10px 4px', fontFamily: "'Roboto', sans-serif",
                          boxShadow: activeTrade.tp === pct
                            ? 'inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 2px #01fd73'
                            : 'inset 0 1px 0 rgba(255,255,255,0.3)',
                          opacity: activeTrade.tp === pct ? 1 : 0.75,
                        }}>
                        +{pct}%
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ height: 1, background: C.border }} />

                {/* SL section */}
                <div style={{ background: 'rgba(0,0,0,0)', borderRadius: 12, padding: '10px 10px 12px' }}>
                  <div style={{ display: 'inline-block', background: '#ffffff', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#111', marginBottom: 8, fontFamily: "'Roboto', sans-serif" }}>SL</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {slPresets.map(pct => (
                      <button key={pct}
                        onClick={() => state.activeTrade && Storage.set({ activeTrade: { ...state.activeTrade, sl: activeTrade.sl === pct ? null : pct } })}
                        style={{
                          background: 'linear-gradient(160deg, #ff5580 0%, #FE0149 45%, #c4003a 100%)',
                          border: activeTrade.sl === pct ? '2px solid #fff' : '2px solid transparent',
                          borderRadius: 10, cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: 13,
                          padding: '10px 4px', fontFamily: "'Roboto', sans-serif",
                          boxShadow: activeTrade.sl === pct
                            ? 'inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 2px #FE0149'
                            : 'inset 0 1px 0 rgba(255,255,255,0.25)',
                          opacity: activeTrade.sl === pct ? 1 : 0.75,
                        }}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: C.muted, fontSize: 12, padding: '14px 0' }}>Ouvrez une position d'abord</div>
            )}

            {/* Footer */}
            <div style={{ borderTop: `1px solid ${C.border}`, padding: '7px 12px' }}>
              {risk?.isHighRisk && <div style={{ color: C.red, fontSize: 11, marginBottom: 2 }}>■ Score risque élevé : {risk.score}/100</div>}
              {risk?.topHolderPercent != null && risk.topHolderPercent > 20 && (
                <div style={{ color: C.red, fontSize: 11, marginBottom: 2 }}>■ Top holder : {risk.topHolderPercent.toFixed(0)}% du supply</div>
              )}
              <div style={{ color: C.yellow, fontSize: 10 }}>⚠ TP/SL s'exécutent uniquement si cet onglet reste ouvert.</div>
            </div>
          </div>
        </DraggableBlock>
      )}
    </>
  )
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ buyPresets, tpPresets, slPresets, slippage, fees }: {
  buyPresets: number[]; tpPresets: number[]; slPresets: number[]
  slippage: number; fees: number
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
    setTimeout(() => setSaved(false), 1500)
  }

  const inputStyle = (filled: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0)', border: `1px solid ${filled ? C.green : C.border}`,
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
        background: saved ? C.green : 'rgba(0,0,0,0)',
        border: `1px solid ${C.green}`, borderRadius: 6,
        color: saved ? '#000' : C.green, fontWeight: 700, fontSize: 12,
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
  function AmountLabel({ sol }: { sol: number }) {
    if (currency === 'USD') return <>{fmtCurStr(sol)}</>
    return <>{fmtSOL(sol)} <SolIcon size={11} fill="#fff" style={{ marginLeft: 2 }} /></>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Quick Buy ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 13, color: C.text }}>Quick Buy</span>
          <button onClick={onOpenConfig} onMouseDown={e => e.stopPropagation()} style={{ background: '#ffffff', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#111', fontSize: 13, padding: '2px 7px', lineHeight: 1, fontWeight: 700 }}>⚙</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {buyPresets.map(amt => (
            <button key={amt}
              disabled={buyBlocked || !hasPrice || state.balance < amt}
              onClick={() => onBuy(amt)}
              style={{
                background: buyBlocked || !hasPrice || state.balance < amt
                  ? '#1a2e1f'
                  : 'linear-gradient(160deg, #5dffaa 0%, #01fd73 45%, #00c057 100%)',
                border: 'none', borderRadius: 10, cursor: 'pointer',
                color: '#000', fontWeight: 700, fontSize: 13,
                padding: '10px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 4, opacity: buyBlocked || !hasPrice || state.balance < amt ? 0.4 : 1,
                fontFamily: "'Roboto', sans-serif",
                boxShadow: buyBlocked || !hasPrice || state.balance < amt ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.3)',
              }}>
              {amt} <SolIcon size={11} fill="#000" style={{ marginLeft: 0 }} />
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: C.border, margin: '4px 0' }} />

      {/* ── Open Trades ── */}
      {activeTrade && livePnL != null && liveValue != null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Header: Open Trades + PnL% */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 13, color: C.text }}>Open Trades</span>
            <span style={{ fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 16, color: pnlColor(livePnL.percent) }}>{fmtPct(livePnL.percent)}</span>
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
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600, fontFamily: "'Roboto', sans-serif" }}>
                  {multiEntry ? 'Ave. Entries' : 'MC Entry'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 700, fontSize: 14, fontFamily: "'Roboto', sans-serif" }}>
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
                  background: '#111111', borderTop: '3px solid #ffffff', borderRadius: 0,
                  padding: '7px 10px', fontSize: 13,
                }}>
                  <span style={{ color: '#ffffff', fontWeight: 600, fontFamily: "'Roboto', sans-serif" }}>
                    {fmtMC(entry.entryMC)} <span style={{ color: '#A1A1A1' }}>•</span> {fmtSOL(entry.invested)}<SolIcon size={10} fill="#ffffff" style={{ marginLeft: 2 }} />
                  </span>
                  <span style={{ color: pctColor, fontWeight: 700, fontFamily: "'Roboto', sans-serif", fontSize: 13 }}>
                    {entryPnlPct != null ? fmtPct(entryPnlPct) : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Stats: INVEST / LIVE / PNL / EARNS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }}>
            {[
              { label: 'INVEST.', sol: activeTrade.invested },
              { label: 'LIVE', sol: liveValue },
              { label: 'PNL', sol: livePnL.sol, color: pnlColor(livePnL.sol) },
              { label: 'EARNS', sol: activeTrade.closeEvents.length > 0 ? activeTrade.closeEvents.reduce((s, e) => s + e.solReturned, 0) : null },
            ].map(({ label, sol, color }, idx) => (
              <div key={label} style={{
                background: '#ffffff', padding: '6px 4px', textAlign: 'center',
                borderLeft: idx > 0 ? '1px solid #ddd' : undefined,
              }}>
                <div style={{ color: '#111', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginBottom: 3, fontFamily: "'Roboto', sans-serif" }}>{label}</div>
                <div style={{ color: color ?? '#111', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, fontFamily: "'Roboto', sans-serif" }}>
                  {sol != null ? <>{fmtSOL(sol)}<SolIcon size={10} fill="#111" style={{ marginLeft: 1 }} /></> : '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Sell buttons: 10 / 25 / 50 / 100 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[10, 25, 50, 100].map(pct => (
              <button key={pct} onClick={() => onSell(pct)} style={{
                background: 'linear-gradient(160deg, #ff5580 0%, #FE0149 45%, #c4003a 100%)',
                border: 'none', borderRadius: 10, cursor: 'pointer',
                color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 4px',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
                fontFamily: "'Roboto', sans-serif",
              }}>{pct}%</button>
            ))}
          </div>

          {/* Sell Inits */}
          <div style={{ textAlign: 'center' }}>
            <span onClick={onSellInitials} style={{
              color: C.text, fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif",
              borderBottom: `1px solid ${C.text}`, paddingBottom: 1,
              userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              Sell Inits. — {fmtSOL(activeTrade.invested)}<SolIcon size={10} fill="#fff" style={{ marginLeft: 0 }} />
            </span>
          </div>

        </div>
      ) : (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: 12, padding: '14px 0' }}>
          {hasPrice ? 'Aucune position ouverte' : 'Chargement du prix…'}
        </div>
      )}
    </div>
  )
}

const sL: React.CSSProperties = { color: 'rgba(240,240,250,0.45)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7, display: 'block' }

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
