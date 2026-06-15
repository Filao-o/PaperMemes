import React, { useState } from 'react'
import type { Trade, TradeEntry, CloseEvent } from '../../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Divider, Badge, SolIcon } from './ui'

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
const labelStyle: React.CSSProperties = { color: C.textSub, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }
const valueStyle: React.CSSProperties = { color: '#ffffff', fontSize: 11, fontWeight: 600 }

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

export function TradeCard({ trade, currency, solPrice }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number }) {
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
    <div style={{ background: 'rgb(17, 17, 17)', borderRadius: 10, border: '1px solid #ffffff', overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Token name + badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <CopyTokenName trade={trade} />
          <span style={{
            background: color, color: '#000',
            borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 800,
            letterSpacing: 0.5,
          }}>{trade.status === 'won' ? 'WIN' : 'LOSS'}</span>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <a href={`https://solscan.io/token/${trade.mintAddress}`} target="_blank" rel="noreferrer"
            style={{ color: C.muted, fontSize: 10, textDecoration: 'none' }}>
            Solscan
          </a>
          <span style={{ color: C.dim, fontSize: 10 }}>{fmtTs(trade.openedAt)}</span>
        </div>
      </div>

      <button onClick={() => setExpanded(v => !v)} style={{
        width: '100%', padding: '8px 0', background: expanded ? C.border : 'transparent',
        border: 'none', borderTop: `1px solid ${C.border}`, color: C.muted,
        fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        {expanded ? '▲ Fermer' : '▼ Details'}
      </button>

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
        <div style={{ background: 'rgb(17, 17, 17)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>PNL Total</div>
          <div style={{ color: pnlColor(totalPnl), fontSize: 14, fontWeight: 700 }}><V sol={totalPnl} size={12} /></div>
          <div style={{ color: C.muted, fontSize: 9 }}>moy. <V sol={totalPnl / closedTrades.length} size={9} /></div>
        </div>
        <div style={{ background: 'rgb(17, 17, 17)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Win Rate</div>
          <div style={{ color: winRate != null && winRate >= 50 ? C.green : C.red, fontSize: 14, fontWeight: 700 }}>
            {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          </div>
          <div style={{ color: C.muted, fontSize: 9 }}>{won}g / {lost}p</div>
        </div>
        <div style={{ background: 'rgb(17, 17, 17)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Trades</div>
          <div style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{closedTrades.length}</div>
          <div style={{ color: C.muted, fontSize: 9 }}>{won}g / {lost}p</div>
        </div>
      </div>

      <Divider />

      <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Historique — {closedTrades.length} trade{closedTrades.length > 1 ? 's' : ''}
      </div>

      {[...closedTrades].reverse().map(trade => (
        <TradeCard key={trade.id} trade={trade} currency={currency} solPrice={solPrice} />
      ))}
    </div>
  )
}
