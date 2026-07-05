import React, { useState } from 'react'
import type { Trade, TradeEntry, CloseEvent } from '../../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Divider, Badge, SolIcon } from './ui'
import { t as tr, type Lang } from '../../i18n'

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

function CopyTokenName({ trade, lang }: { trade: Trade; lang: Lang }) {
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
      title={trade.mintAddress ? tr(lang, 'w.copy_ca') : undefined}
      style={{
        color: C.text, fontWeight: 700, fontSize: 13,
        cursor: trade.mintAddress ? 'pointer' : 'default',
        borderBottom: trade.mintAddress ? `1px dashed ${C.muted}` : 'none',
      }}
    >
      {copied ? <span style={{ color: C.green }}>{tr(lang, 'journal.copied')}</span> : trade.tokenName}
    </span>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }
const labelStyle: React.CSSProperties = { color: C.textSub, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }
const valueStyle: React.CSSProperties = { color: '#ffffff', fontSize: 12, fontWeight: 600 }

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
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10 }}>{fmtTs(r.ts)}</span>
          <span style={{ color: C.text, fontSize: 11, fontWeight: 600 }}>{fmtMC(r.mc)}</span>
          <span style={{ color, fontSize: 11, fontWeight: 600 }}>{r.amount}</span>
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
  lang: Lang
}

export function TradeCard({ trade, currency, solPrice, lang }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number; lang: Lang }) {
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
    <div style={{ background: 'rgba(0,0,0,0.30)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Token name + badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <CopyTokenName trade={trade} lang={lang} />
          <span style={{
            background: color, color: '#000',
            borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 800,
            letterSpacing: 0.5,
          }}>{trade.status === 'won' ? tr(lang, 'journal.win') : tr(lang, 'journal.loss')}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>{tr(lang, 'journal.mc_avg')}</span>
          <span style={valueStyle}>{fmtMC(trade.entryMC)}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>{tr(lang, 'journal.total_inv')}</span>
          <span style={valueStyle}><V sol={trade.invested} /></span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>{tr(lang, 'journal.pnl_total')}</span>
          <span style={{ ...valueStyle, color: pnlColor(pnl) }}>{pnl >= 0 ? '+' : ''}<V sol={pnl} /></span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>{tr(lang, 'journal.pnl_pct')}</span>
          <span style={{ ...valueStyle, color: pnlColor(pnlPct) }}>{fmtPct(pnlPct)}</span>
        </div>
        {trade.note && (
          <div style={{
            marginTop: 4, padding: '5px 9px',
            background: 'rgba(255,255,255,0.04)', borderRadius: 6,
            borderLeft: `2px solid rgba(255,255,255,0.2)`,
            color: 'rgba(255,255,255,0.65)', fontSize: 11, lineHeight: 1.5, fontStyle: 'italic',
          }}>
            {trade.note}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <a href={`https://solscan.io/token/${trade.mintAddress}`} target="_blank" rel="noreferrer"
            style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, textDecoration: 'none' }}>
            Solscan
          </a>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>{fmtTs(trade.openedAt)}</span>
        </div>
      </div>

      <button onClick={() => setExpanded(v => !v)} style={{
        width: '100%', padding: '8px 0', background: expanded ? C.border : 'transparent',
        border: 'none', borderTop: `1px solid ${C.border}`, color: 'rgba(255,255,255,0.9)',
        fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        {expanded ? tr(lang, 'journal.collapse') : tr(lang, 'journal.details')}
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <DetailSection
            title={tr(lang, 'journal.entries')} color={C.green}
            rows={entries.map((e, i) => ({ key: String(i), ts: e.timestamp, mc: e.entryMC, amount: <V sol={e.invested} size={9} /> }))}
          />
          <DetailSection
            title={tr(lang, 'journal.sells')} color={C.red}
            rows={trade.closeEvents.map(ev => ({ key: ev.id, ts: ev.timestamp, mc: ev.mcAtClose, amount: <V sol={ev.solReturned} size={9} /> }))}
          />
        </div>
      )}
    </div>
  )
}

// ─── Journal panel ────────────────────────────────────────────────────────────

export function JournalPanel({ closedTrades, currency, solPrice, lang }: Props) {
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnlSOL ?? 0), 0)
  const won = closedTrades.filter(t => t.status === 'won').length
  const winRate = closedTrades.length > 0 ? (won / closedTrades.length) * 100 : null

  const V = ({ sol, size }: { sol: number; size?: number }) =>
    <Val sol={sol} size={size} currency={currency} solPrice={solPrice} />

  if (closedTrades.length === 0) {
    return <div style={{ textAlign: 'center', color: C.muted, padding: '32px 0', fontSize: 12 }}>{tr(lang, 'journal.no_trade')}</div>
  }

  const lost = closedTrades.length - won

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ background: 'rgba(0,0,0,0.30)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.10)' }}>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{tr(lang, 'journal.pnl_total')}</div>
          <div style={{ color: pnlColor(totalPnl), fontSize: 14, fontWeight: 700 }}><V sol={totalPnl} size={12} /></div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10 }}>{tr(lang, 'stats.avg')} <V sol={totalPnl / closedTrades.length} size={9} /></div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.30)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.10)' }}>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{tr(lang, 'stats.winrate')}</div>
          <div style={{ color: winRate != null && winRate >= 50 ? C.green : C.red, fontSize: 14, fontWeight: 700 }}>
            {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10 }}>{tr(lang, 'journal.wins_losses', { won, lost })}</div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.30)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.10)' }}>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{tr(lang, 'stats.trades')}</div>
          <div style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{closedTrades.length}</div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10 }}>{tr(lang, 'journal.wins_losses', { won, lost })}</div>
        </div>
      </div>

      <Divider />

      <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
        {tr(lang, 'journal.history')} — {closedTrades.length} trade{closedTrades.length > 1 ? 's' : ''}
      </div>

      {closedTrades.map(trade => (
        <TradeCard key={trade.id} trade={trade} currency={currency} solPrice={solPrice} lang={lang} />
      ))}
    </div>
  )
}
