import React, { useState } from 'react'
import type { Trade } from '../../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Row, Badge, Divider } from './ui'

interface Props {
  closedTrades: Trade[]
  currency: 'SOL' | 'USD'
  solPrice: number
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
      title={trade.mintAddress ? `Copier CA: ${trade.mintAddress}` : undefined}
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

export function JournalPanel({ closedTrades, currency, solPrice }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnlSOL ?? 0), 0)
  const won = closedTrades.filter(t => t.status === 'won').length
  const winRate = closedTrades.length > 0 ? (won / closedTrades.length) * 100 : null
  const bestTrade = closedTrades.reduce<Trade | null>((best, t) =>
    (t.pnlPercent ?? -Infinity) > (best?.pnlPercent ?? -Infinity) ? t : best, null)

  function fmtVal(sol: number) {
    if (currency === 'USD') return `$${(sol * solPrice).toFixed(2)}`
    return `${fmtSOL(sol)} ≋`
  }

  if (closedTrades.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: C.muted, padding: '32px 0', fontSize: 12 }}>
        Aucun trade enregistré
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Stats globales */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>PNL Total</div>
          <div style={{ color: pnlColor(totalPnl), fontSize: 14, fontWeight: 700 }}>{fmtVal(totalPnl)}</div>
          {closedTrades.length > 0 && (
            <div style={{ color: C.muted, fontSize: 9 }}>
              moy. {fmtVal(totalPnl / closedTrades.length)} / trade
            </div>
          )}
        </div>
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Win Rate</div>
          <div style={{ color: winRate != null && winRate >= 50 ? C.green : C.red, fontSize: 14, fontWeight: 700 }}>
            {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          </div>
          <div style={{ color: C.muted, fontSize: 9 }}>{won}g / {closedTrades.length}f</div>
        </div>
      </div>

      {bestTrade && (
        <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}` }}>
          <Row label="Best Trade" value={
            <span style={{ color: C.green }}>{bestTrade.tokenName} {fmtPct(bestTrade.pnlPercent ?? 0)}</span>
          } />
        </div>
      )}

      <Divider />

      <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Historique — {closedTrades.length} trade{closedTrades.length > 1 ? 's' : ''}
      </div>

      {closedTrades.map(trade => {
        const isExpanded = expanded === trade.id
        const color = trade.status === 'won' ? C.green : C.red
        return (
          <div key={trade.id} style={{
            background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <CopyTokenName trade={trade} />
                <Badge text={trade.status === 'won' ? 'GAIN' : 'PERTE'} color={color} />
              </div>
              <Row label="MC Entrée Moy" value={fmtMC(trade.entryMC)} />
              <Row label="Investi" value={`${fmtSOL(trade.invested)} ≋`} />
              {trade.pnlSOL != null && (
                <Row
                  label="PNL"
                  value={`${fmtVal(trade.pnlSOL)} (${fmtPct(trade.pnlPercent ?? 0)})`}
                  color={pnlColor(trade.pnlSOL)}
                />
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <a
                  href={`https://solscan.io/token/${trade.mintAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.muted, fontSize: 10, textDecoration: 'none' }}
                >
                  ↗ Solscan
                </a>
              </div>
              {trade.closeEvents.length > 0 && (
                <button
                  onClick={() => setExpanded(isExpanded ? null : trade.id)}
                  style={{
                    background: 'none', border: 'none', color: C.muted, fontSize: 10,
                    cursor: 'pointer', padding: '4px 0 0', fontFamily: 'inherit',
                  }}
                >
                  {isExpanded ? '▲' : '▼'} {trade.closeEvents.length} fermeture{trade.closeEvents.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {trade.closeEvents.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted }}>
                    <span>{fmtMC(ev.mcAtClose)}</span>
                    <span>Vente {ev.sellPercent.toFixed(0)}%</span>
                    <span style={{ color: C.green }}>+{fmtSOL(ev.solReturned)} ≋</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
