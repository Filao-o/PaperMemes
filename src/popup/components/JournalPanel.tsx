import React, { useState } from 'react'
import type { Trade, TradeEntry, CloseEvent } from '../../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Divider, Badge } from './ui'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SolIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 313 281" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }}>
      <g clipPath="url(#jsolClip)">
        <path d="M311.318 221.057L259.66 276.558C258.537 277.764 257.178 278.725 255.669 279.382C254.159 280.039 252.53 280.378 250.884 280.377H5.99719C4.8287 280.377 3.68568 280.035 2.70855 279.393C1.73143 278.751 0.962771 277.837 0.49702 276.764C0.0312691 275.69 -0.111286 274.504 0.0868712 273.35C0.285028 272.196 0.815265 271.126 1.61243 270.27L53.3099 214.769C54.4299 213.566 55.7843 212.607 57.2893 211.95C58.7943 211.293 60.4178 210.953 62.0595 210.95H306.933C308.101 210.95 309.244 211.292 310.221 211.934C311.199 212.576 311.967 213.49 312.433 214.564C312.899 215.637 313.041 216.824 312.843 217.977C312.645 219.131 312.115 220.201 311.318 221.057ZM259.66 109.294C258.537 108.088 257.178 107.127 255.669 106.47C254.159 105.813 252.53 105.474 250.884 105.475H5.99719C4.8287 105.475 3.68568 105.817 2.70855 106.459C1.73143 107.101 0.962771 108.015 0.49702 109.088C0.0312691 110.162 -0.111286 111.348 0.0868712 112.502C0.285028 113.656 0.815265 114.726 1.61243 115.582L53.3099 171.083C54.4299 172.286 55.7843 173.245 57.2893 173.902C58.7943 174.559 60.4178 174.899 62.0595 174.902H306.933C308.101 174.902 309.244 174.56 310.221 173.918C311.199 173.276 311.967 172.362 312.433 171.288C312.899 170.215 313.041 169.028 312.843 167.875C312.645 166.721 312.115 165.651 311.318 164.795L259.66 109.294ZM5.99719 69.4267H250.884C252.53 69.4275 254.159 69.089 255.669 68.432C257.178 67.7751 258.537 66.8139 259.66 65.6082L311.318 10.1069C312.115 9.25107 312.645 8.18056 312.843 7.02695C313.041 5.87334 312.899 4.68686 312.433 3.6133C311.967 2.53974 311.199 1.62586 310.221 0.983941C309.244 0.342026 308.101 3.95314e-05 306.933 0L62.0595 0C60.4178 0.00279866 58.7943 0.34314 57.2893 0.999953C55.7843 1.65677 54.4299 2.61607 53.3099 3.81847L1.62576 59.3197C0.829361 60.1748 0.299359 61.244 0.100752 62.3964C-0.0978539 63.5488 0.0435698 64.7342 0.507679 65.8073C0.971789 66.8803 1.73841 67.7943 2.71352 68.4372C3.68863 69.0802 4.82984 69.424 5.99719 69.4267Z" fill="url(#jsolGrad)"/>
      </g>
      <defs>
        <linearGradient id="jsolGrad" x1="26.415" y1="287.059" x2="283.735" y2="-2.49574" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF"/>
          <stop offset="0.3" stopColor="#8752F3"/>
          <stop offset="0.5" stopColor="#5497D5"/>
          <stop offset="0.6" stopColor="#43B4CA"/>
          <stop offset="0.72" stopColor="#28E0B9"/>
          <stop offset="0.97" stopColor="#19FB9B"/>
        </linearGradient>
        <clipPath id="jsolClip">
          <rect width="312.93" height="280.377" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  )
}

function Val({ sol, size, currency, solPrice }: { sol: number; size?: number; currency: 'SOL' | 'USD'; solPrice: number }) {
  if (currency === 'USD' && solPrice > 0) return <>${(sol * solPrice).toFixed(2)}</>
  return <>{fmtSOL(sol)} <SolIcon size={size} /></>
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${dd}/${mm}/${yy} - ${h}:${min} ${ampm}`
}

function CopyTokenName({ trade }: { trade: Trade }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    if (!trade.mintAddress) return
    navigator.clipboard.writeText(trade.mintAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span
      onClick={handleCopy}
      title={trade.mintAddress ? 'Copier CA' : undefined}
      style={{
        color: C.text, fontWeight: 700, fontSize: 13,
        cursor: trade.mintAddress ? 'pointer' : 'default',
        borderBottom: trade.mintAddress ? `1px dashed ${C.muted}` : 'none',
      }}
    >
      {copied ? <span style={{ color: C.green }}>✓ copié</span> : trade.tokenName}
    </span>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }
const labelStyle: React.CSSProperties = { color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }
const valueStyle: React.CSSProperties = { color: C.text, fontSize: 11, fontWeight: 600 }

// ─── Detail section (Entries or Sells) ───────────────────────────────────────

function DetailSection({ title, color, rows }: {
  title: string
  color: string
  rows: { key: string; ts: number; mc: number; amount: React.ReactNode }[]
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <div style={{ background: `${color}22`, padding: '4px 12px', fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </div>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 12px', borderBottom: `1px solid ${C.border}`, background: `${color}0a` }}>
          <span style={{ color: C.muted, fontSize: 9 }}>{fmtTs(r.ts)}</span>
          <span style={{ color: C.text, fontSize: 10, fontWeight: 600 }}>{fmtMC(r.mc)}</span>
          <span style={{ color, fontSize: 10, fontWeight: 600 }}>{r.amount}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Trade card ───────────────────────────────────────────────────────────────

interface Props {
  closedTrades: Trade[]
  currency: 'SOL' | 'USD'
  solPrice: number
}

function TradeCard({ trade, currency, solPrice }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number }) {
  const [expanded, setExpanded] = useState(false)

  const V = ({ sol, size }: { sol: number; size?: number }) =>
    <Val sol={sol} size={size} currency={currency} solPrice={solPrice} />

  const color = trade.status === 'won' ? C.green : C.red
  const pnl = trade.pnlSOL ?? 0
  const pnlPct = trade.pnlPercent ?? 0

  const entries: TradeEntry[] = trade.entries?.length
    ? trade.entries
    : [{ entryPrice: trade.entryPrice, entryMC: trade.entryMC, invested: trade.invested, tokensHeld: trade.tokensHeld, timestamp: trade.openedAt }]

  const hasDetails = trade.closeEvents.length > 0

  return (
    <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <CopyTokenName trade={trade} />
          <Badge text={trade.status === 'won' ? 'WIN' : 'LOSE'} color={color} />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>MC Ave. Entries</span>
          <span style={valueStyle}>{fmtMC(trade.entryMC)}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Total Inv.</span>
          <span style={valueStyle}><V sol={trade.invested} /></span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>PNL Total</span>
          <span style={{ ...valueStyle, color: pnlColor(pnl) }}>{pnl >= 0 ? '+' : ''}<V sol={pnl} /></span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>PNL % Total</span>
          <span style={{ ...valueStyle, color: pnlColor(pnlPct) }}>{fmtPct(pnlPct)}</span>
        </div>
        <a href={`https://solscan.io/token/${trade.mintAddress}`} target="_blank" rel="noreferrer"
          style={{ color: C.muted, fontSize: 10, textDecoration: 'none', marginTop: 4 }}>
          ↗ Solscan
        </a>
      </div>

      {hasDetails && (
        <button onClick={() => setExpanded(v => !v)} style={{
          width: '100%', padding: '7px 0', background: expanded ? C.border : 'transparent',
          border: 'none', borderTop: `1px solid ${C.border}`, color: C.muted,
          fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          {expanded ? '▲ Fermer' : '▼ Détails'}
        </button>
      )}

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <DetailSection
            title="Entries" color={C.green}
            rows={entries.map((e, i) => ({ key: String(i), ts: e.timestamp, mc: e.entryMC, amount: <V sol={e.invested} size={9} /> }))}
          />
          <DetailSection
            title="Sells" color={C.red}
            rows={trade.closeEvents.map(ev => ({ key: ev.id, ts: ev.timestamp, mc: ev.mcAtClose, amount: <V sol={ev.solReturned} size={9} /> }))}
          />
        </div>
      )}
    </div>
  )
}

// ─── Journal panel ────────────────────────────────────────────────────────────

export function JournalPanel({ closedTrades, currency, solPrice }: Props) {
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnlSOL ?? 0), 0)
  const won = closedTrades.filter(t => t.status === 'won').length
  const winRate = closedTrades.length > 0 ? (won / closedTrades.length) * 100 : null

  const V = ({ sol, size }: { sol: number; size?: number }) =>
    <Val sol={sol} size={size} currency={currency} solPrice={solPrice} />

  if (closedTrades.length === 0) {
    return <div style={{ textAlign: 'center', color: C.muted, padding: '32px 0', fontSize: 12 }}>Aucun trade enregistré</div>
  }

  const lost = closedTrades.length - won

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>PNL Total</div>
          <div style={{ color: pnlColor(totalPnl), fontSize: 14, fontWeight: 700 }}><V sol={totalPnl} size={12} /></div>
          <div style={{ color: C.muted, fontSize: 9 }}>moy. <V sol={totalPnl / closedTrades.length} size={9} /></div>
        </div>
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Win Rate</div>
          <div style={{ color: winRate != null && winRate >= 50 ? C.green : C.red, fontSize: 14, fontWeight: 700 }}>
            {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          </div>
          <div style={{ color: C.muted, fontSize: 9 }}>{won}g / {lost}p</div>
        </div>
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Trades</div>
          <div style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{closedTrades.length}</div>
          <div style={{ color: C.muted, fontSize: 9 }}>{won}g / {lost}p</div>
        </div>
      </div>

      <Divider />

      <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Historique — {closedTrades.length} trade{closedTrades.length > 1 ? 's' : ''}
      </div>

      {closedTrades.map(trade => (
        <TradeCard key={trade.id} trade={trade} currency={currency} solPrice={solPrice} />
      ))}
    </div>
  )
}
