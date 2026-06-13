import React, { useEffect, useState } from 'react'
import { Storage } from '../storage'
import type { AppState, Trade } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, Badge, SolIcon } from './components/ui'
import { TradeCard } from './components/JournalPanel'

// ─── Reset Modal ──────────────────────────────────────────────────────────────

const RESET_PRESETS = [2, 5, 10, 15, 50]

function ResetModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState(50)
  const [custom, setCustom] = useState('')
  const activeAmount = custom !== '' ? parseFloat(custom) || 0 : amount

  function handleReset(keepHistory: boolean) {
    if (activeAmount <= 0) return
    Storage.set({ balance: activeAmount, activeTrade: null, ...(keepHistory ? {} : { closedTrades: [] }) })
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 20, width: '100%', display: 'flex', flexDirection: 'column', gap: 14,
        fontFamily: "'Space Grotesk', -apple-system, sans-serif",
      }}>
        <div style={{ fontFamily: "'League Gothic', sans-serif", fontSize: 20, letterSpacing: 2, color: C.yellow }}>RÉINITIALISER LE WALLET</div>
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Montant (SOL)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RESET_PRESETS.map(p => (
              <button key={p} onClick={() => { setAmount(p); setCustom('') }} style={{
                flex: '1 1 auto',
                background: amount === p && custom === '' ? `${C.yellow}22` : C.bg,
                border: `1px solid ${amount === p && custom === '' ? C.yellow : C.border}`,
                borderRadius: 6, color: amount === p && custom === '' ? C.yellow : C.textSub,
                fontWeight: 700, fontSize: 12, padding: '7px 4px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{p}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Montant personnalisé</div>
          <input type="text" inputMode="decimal" placeholder="ex: 25" value={custom}
            onChange={e => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setCustom(e.target.value) }}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: C.bg, border: `1px solid ${custom ? C.yellow : C.border}`,
              borderRadius: 6, color: C.text, fontSize: 13, fontWeight: 700,
              padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
            }} />
        </div>
        <div style={{ color: C.muted, fontSize: 11, textAlign: 'center' }}>
          Nouveau solde : <span style={{ color: C.yellow, fontWeight: 700 }}>{activeAmount > 0 ? `${activeAmount} SOL` : '—'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => handleReset(false)} disabled={activeAmount <= 0} style={{
            width: '100%', padding: '10px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: 12, cursor: activeAmount > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmount > 0 ? 1 : 0.4,
          }}>Reset solde + historique</button>
          <button onClick={() => handleReset(true)} disabled={activeAmount <= 0} style={{
            width: '100%', padding: '10px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.yellow}20`, border: `1px solid ${C.yellow}70`, color: C.yellow,
            boxShadow: `0 0 10px ${C.yellow}35`,
            fontWeight: 700, fontSize: 12, cursor: activeAmount > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmount > 0 ? 1 : 0.4,
          }}>Reset solde uniquement</button>
          <button onClick={onClose} style={{
            width: '100%', padding: '8px 0', borderRadius: 6, fontFamily: 'inherit',
            background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
            fontWeight: 600, fontSize: 11, cursor: 'pointer',
          }}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ─── PnL Curve ────────────────────────────────────────────────────────────────

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  const t = 0.35
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = p1[0] + (p2[0] - p0[0]) * t
    const cp1y = p1[1] + (p2[1] - p0[1]) * t
    const cp2x = p2[0] - (p3[0] - p1[0]) * t
    const cp2y = p2[1] - (p3[1] - p1[1]) * t
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`
  }
  return d
}

function PnlCurve({ trades }: { trades: Trade[] }) {
  const W = 332
  const H = 68
  const PAD = { x: 8, top: 20, bottom: 8 }

  if (trades.length < 2) {
    return (
      <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, height: H, position: 'relative' }}>
        <span style={{ position: 'absolute', top: 7, left: 10, color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Courbe PNL Cumulé</span>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: C.dim, fontSize: 10 }}>Pas encore de données</span>
        </div>
      </div>
    )
  }

  const sorted = [...trades].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
  const cumulative = sorted.reduce<number[]>((acc, t) => {
    acc.push((acc[acc.length - 1] ?? 0) + (t.pnlSOL ?? 0))
    return acc
  }, [])

  const min = Math.min(0, ...cumulative)
  const max = Math.max(0, ...cumulative)
  const range = max - min || 1
  const drawH = H - PAD.top - PAD.bottom

  const pts: [number, number][] = cumulative.map((v, i) => [
    PAD.x + (i / (cumulative.length - 1)) * (W - PAD.x * 2),
    PAD.top + (1 - (v - min) / range) * drawH,
  ])

  const linePath = smoothPath(pts)
  const last = pts[pts.length - 1]
  const lastVal = cumulative[cumulative.length - 1]
  const lineColor = lastVal >= 0 ? C.green : C.red
  const gradId = `pnlFill_${lastVal >= 0 ? 'g' : 'r'}`

  const areaPath = `${linePath} L ${last[0]},${H - PAD.bottom} L ${pts[0][0]},${H - PAD.bottom} Z`

  return (
    <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'hidden', position: 'relative' }}>
      <span style={{ position: 'absolute', top: 7, left: 10, color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, zIndex: 1 }}>
        Courbe PNL Cumulé
      </span>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="3.5" fill={lineColor} />
      </svg>
    </div>
  )
}

// ─── Stat Cards ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', border: `1px solid ${C.border}`, flex: 1 }}>
      <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? C.text, fontSize: 15, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Filter Buttons ───────────────────────────────────────────────────────────

type Filter = 'ALL' | 'Active' | 'Gain' | 'Loss'
const FILTERS: Filter[] = ['ALL', 'Active', 'Gain', 'Loss']

function FilterBar({ active, onChange }: { active: Filter; onChange: (f: Filter) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
      {FILTERS.map(f => (
        <button key={f} onClick={() => onChange(f)} style={{
          padding: '6px 0', borderRadius: 6, fontFamily: 'inherit',
          background: active === f ? `${C.green}18` : C.surface,
          border: `1px solid ${active === f ? C.green : C.border}`,
          color: active === f ? C.green : C.muted,
          fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
        }}>{f}</button>
      ))}
    </div>
  )
}

function ActiveTradeRow({ trade, currency, solPrice }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number }) {
  return (
    <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.green}40`, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{trade.tokenName}</span>
        <Badge text="ACTIF" color={C.green} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 10 }}>
        <div>
          <div style={{ color: C.muted, fontSize: 9 }}>TERMINAL</div>
          <div style={{ color: C.text, fontWeight: 600 }}>{trade.terminal}</div>
        </div>
        <div>
          <div style={{ color: C.muted, fontSize: 9 }}>MC ENTRÉE</div>
          <div style={{ color: C.text, fontWeight: 600 }}>{fmtMC(trade.entryMC)}</div>
        </div>
        <div>
          <div style={{ color: C.muted, fontSize: 9 }}>INVESTI</div>
          <div style={{ color: C.text, fontWeight: 600 }}>
            {currency === 'USD' && solPrice > 0
              ? `$${(trade.invested * solPrice).toFixed(2)}`
              : <>{fmtSOL(trade.invested)} <SolIcon size={10} style={{ marginLeft: 1 }} /></>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [filter, setFilter] = useState<Filter>('ALL')

  useEffect(() => {
    Storage.get().then(setState)
    const cleanup = Storage.onChanged(changes => setState(prev => prev ? { ...prev, ...changes } : prev))
    chrome.runtime.sendMessage({ type: 'FETCH_SOL_PRICE' }, res => {
      if (res?.ok) {
        setState(prev => prev ? { ...prev, solPrice: res.data } : prev)
        Storage.set({ solPrice: res.data })
      }
    })
    return cleanup
  }, [])

  if (!state) return null

  const { balance, activeTrade, closedTrades, currency, solPrice } = state

  // Stats
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnlSOL ?? 0), 0)
  const won = closedTrades.filter(t => t.status === 'won').length
  const winRate = closedTrades.length > 0 ? (won / closedTrades.length) * 100 : null
  const best = closedTrades.reduce<Trade | null>((b, t) => !b || (t.pnlPercent ?? -Infinity) > (b.pnlPercent ?? -Infinity) ? t : b, null)

  function fmtBal(sol: number): React.ReactNode {
    if (currency === 'USD') return <>${(sol * solPrice).toFixed(2)}</>
    return <>{fmtSOL(sol)} <SolIcon size={20} /></>
  }

  function fmtPnl(sol: number): React.ReactNode {
    if (currency === 'USD' && solPrice > 0) return <>${(sol * solPrice).toFixed(2)}</>
    return <>{fmtSOL(sol)} <SolIcon size={11} /></>
  }

  // Filtered list
  const filteredTrades = filter === 'Gain'
    ? closedTrades.filter(t => t.status === 'won')
    : filter === 'Loss'
    ? closedTrades.filter(t => t.status === 'lost')
    : closedTrades

  return (
    <>
      {showReset && <ResetModal onClose={() => setShowReset(false)} />}
      <div style={{
        width: 360, minHeight: 480, background: C.bg, color: C.text,
        fontFamily: "'Space Grotesk', -apple-system, sans-serif", display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: C.green,
              boxShadow: `0 0 6px ${C.green}`, display: 'inline-block',
            }} />
            <span style={{ fontFamily: "'League Gothic', sans-serif", fontWeight: 400, fontSize: 20, letterSpacing: 3, color: C.text }}>PAPERMEMES</span>
            <span style={{ color: C.muted, fontSize: 10 }}>v1.3</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setShowReset(true)} title="Réinitialiser" style={{
              background: `${C.yellow}20`, border: `1px solid ${C.yellow}60`,
              boxShadow: `0 0 8px ${C.yellow}35`,
              borderRadius: 6, cursor: 'pointer', color: C.yellow,
              fontSize: 14, lineHeight: 1, padding: '3px 6px', fontFamily: 'inherit',
            }}>↺</button>
            <button onClick={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })} style={{
              background: `${C.green}20`, border: `1px solid ${C.green}60`,
              boxShadow: `0 0 8px ${C.green}35`,
              borderRadius: 6, color: C.green, fontSize: 10, fontWeight: 700, padding: '3px 8px',
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              {currency === 'SOL' ? <><SolIcon size={10} style={{ marginLeft: 0 }} /> SOL</> : '$ USD'}
            </button>
          </div>
        </div>

        {/* Balance */}
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
            Solde Virtuel
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text }}>{fmtBal(balance)}</div>
          {solPrice > 0 && currency === 'SOL' && (
            <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>
              ≈ ${(balance * solPrice).toFixed(2)} USD &nbsp;·&nbsp; <SolIcon size={10} />${solPrice.toFixed(0)}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '10px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* PnL Curve */}
          <PnlCurve trades={closedTrades} />

          {/* Stat Cards Row 1 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <StatCard
              label="PNL Total"
              value={<>{totalPnl >= 0 ? '+' : ''}{fmtPnl(totalPnl)}</>}
              color={pnlColor(totalPnl)}
              sub={closedTrades.length > 0 ? <>moy. {fmtSOL(totalPnl / closedTrades.length)} <SolIcon size={9} /></> : undefined}
            />
            <StatCard
              label="Win Rate"
              value={winRate != null ? `${winRate.toFixed(0)}%` : '—'}
              color={winRate != null ? (winRate >= 50 ? C.green : C.red) : C.muted}
              sub={closedTrades.length > 0 ? `${won}W / ${closedTrades.length - won}L` : 'Aucun trade'}
            />
          </div>

          {/* Stat Cards Row 2 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <StatCard
              label="Trades"
              value={closedTrades.length}
              sub={activeTrade ? '1 position active' : 'Aucune position'}
              color={C.text}
            />
            <StatCard
              label="Best"
              value={best ? fmtPct(best.pnlPercent ?? 0) : '—'}
              color={best ? C.green : C.muted}
              sub={best ? best.tokenName : 'Aucun trade'}
            />
          </div>

          {/* Trade History */}
          <div>
            <div style={{ fontFamily: "'League Gothic', sans-serif", fontSize: 14, letterSpacing: 2, color: C.textSub, marginBottom: 8 }}>
              TRADE HISTORY
            </div>
            <FilterBar active={filter} onChange={setFilter} />
          </div>

          {/* Trade List */}
          {filter === 'Active' ? (
            activeTrade ? (
              <ActiveTradeRow trade={activeTrade} currency={currency} solPrice={solPrice} />
            ) : (
              <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '16px 0' }}>
                Aucune position active
              </div>
            )
          ) : filteredTrades.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.muted, fontSize: 11, padding: '16px 0' }}>
              Aucun trade
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredTrades.map(t => (
                <TradeCard key={t.id} trade={t} currency={currency} solPrice={solPrice} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: '6px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: C.muted, fontSize: 9, letterSpacing: 1 }}>PAPERMEMES · PAPER TRADING</span>
          <span style={{ color: activeTrade ? C.green : C.muted, fontSize: 9 }}>
            {activeTrade ? '1 position ouverte' : 'Aucune position'}
          </span>
        </div>
      </div>
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontSize: 14,
  cursor: 'pointer', padding: '2px 6px', fontFamily: 'inherit',
}

export {}
