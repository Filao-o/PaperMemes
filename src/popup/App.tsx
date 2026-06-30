import React, { useEffect, useState } from 'react'
import { Storage } from '../storage'
import type { AppState, Trade } from '../types'
import { C, fmtSOL, fmtMC, fmtPct, pnlColor, SolIcon } from './components/ui'
import { TradeCard } from './components/JournalPanel'
import { t as tr, type Lang, LANG_LABELS } from '../i18n'

const FONT = "'Space Grotesk', -apple-system, sans-serif"

// ─── Reset Modal ──────────────────────────────────────────────────────────────

const SOL_RESET_PRESETS = [1, 2, 5, 10, 20]
const USD_RESET_PRESETS = [25, 50, 100, 200, 500]

function ResetModal({ onClose, currency, solPrice, lang }: { onClose: () => void; currency: 'SOL' | 'USD'; solPrice: number; lang: Lang }) {
  const [localCurrency, setLocalCurrency] = useState<'SOL' | 'USD'>(currency)
  const [amount, setAmount] = useState(localCurrency === 'SOL' ? 5 : 100)
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
    zIndex: 9999, padding: 20,
  }

  const cardStyle: React.CSSProperties = {
    background: 'rgba(10,8,18,0.95)', border: `1px solid ${C.border}`, borderRadius: 14,
    padding: 20, width: '100%', display: 'flex', flexDirection: 'column', gap: 14,
    fontFamily: FONT,
  }

  if (confirm !== null) {
    const isFull = confirm === 'full'
    return (
      <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: C.red }}>{tr(lang, 'reset.warn_title')}</div>
          <div style={{ color: C.textSub, fontSize: 12, lineHeight: 1.65 }}>
            {isFull ? (
              <>{tr(lang, 'reset.warn_before')}<span style={{ color: '#fff', fontWeight: 700 }}>{fmtAmt(activeAmountSOL)}</span>{tr(lang, 'reset.warn_full_mid')}<span style={{ color: C.red, fontWeight: 700 }}>{tr(lang, 'reset.warn_full_red')}</span>{tr(lang, 'reset.warn_suffix')}</>
            ) : (
              <>{tr(lang, 'reset.warn_before')}<span style={{ color: '#fff', fontWeight: 700 }}>{fmtAmt(activeAmountSOL)}</span>{tr(lang, 'reset.warn_bal_mid')}</>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => doReset(!isFull)} style={{
              width: '100%', padding: '10px 0', borderRadius: 8, fontFamily: 'inherit',
              background: C.red, border: 'none', color: '#fff',
              fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}>{tr(lang, 'reset.confirm')}</button>
            <button onClick={() => setConfirm(null)} style={{
              width: '100%', padding: '8px 0', borderRadius: 8, fontFamily: 'inherit',
              background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
              fontWeight: 600, fontSize: 11, cursor: 'pointer',
            }}>{tr(lang, 'reset.back')}</button>
          </div>
        </div>
      </div>
    )
  }

  const isUSD = localCurrency === 'USD'

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: '#ffffff' }}>{tr(lang, 'reset.title')}</div>
          <div onClick={switchCurrency} style={{
            display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 20, padding: 2,
          }}>
            {(['SOL', 'USD'] as const).map(opt => (
              <div key={opt} style={{
                padding: '3px 9px', borderRadius: 16, fontSize: 10, fontWeight: 700,
                background: localCurrency === opt ? '#ffffff' : 'transparent',
                color: localCurrency === opt ? '#111' : '#A1A1A1',
              }}>{opt}</div>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {tr(lang, 'reset.amount')} ({isUSD ? 'USD' : 'SOL'})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map(p => {
              const sel = amount === p && custom === ''
              return (
                <button key={p} onClick={() => { setAmount(p); setCustom('') }} style={{
                  flex: '1 1 auto',
                  background: sel ? `${C.green}22` : 'rgba(0,0,0,0)',
                  border: `1px solid ${sel ? C.green : C.border}`,
                  borderRadius: 6, color: sel ? C.green : C.textSub,
                  fontWeight: 700, fontSize: 12, padding: '7px 4px', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {isUSD ? `$${p}` : p}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom input */}
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {tr(lang, 'reset.custom')} ({isUSD ? 'USD' : 'SOL'})
          </div>
          <input type="text" inputMode="decimal" placeholder={isUSD ? tr(lang, 'reset.placeholder_usd') : tr(lang, 'reset.placeholder_sol')} value={custom}
            onChange={e => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setCustom(e.target.value) }}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(0,0,0,0)', border: `1px solid ${custom ? C.green : C.border}`,
              borderRadius: 6, color: C.text, fontSize: 13, fontWeight: 700,
              padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
            }} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => activeAmountSOL > 0 && setConfirm('full')} disabled={activeAmountSOL <= 0} style={{
            width: '100%', padding: '10px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: 12, cursor: activeAmountSOL > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmountSOL > 0 ? 1 : 0.4,
          }}>{tr(lang, 'reset.btn_full')}</button>
          <button onClick={() => activeAmountSOL > 0 && setConfirm('balance')} disabled={activeAmountSOL <= 0} style={{
            width: '100%', padding: '10px 0', borderRadius: 6, fontFamily: 'inherit',
            background: `${C.red}18`, border: `1px solid ${C.red}60`, color: C.red,
            fontWeight: 700, fontSize: 12, cursor: activeAmountSOL > 0 ? 'pointer' : 'not-allowed',
            opacity: activeAmountSOL > 0 ? 1 : 0.4,
          }}>{tr(lang, 'reset.btn_balance')}</button>
          <button onClick={onClose} style={{
            width: '100%', padding: '8px 0', borderRadius: 6, fontFamily: 'inherit',
            background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
            fontWeight: 600, fontSize: 11, cursor: 'pointer',
          }}>{tr(lang, 'reset.cancel')}</button>
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

function PnlCurve({ trades, lang }: { trades: Trade[]; lang: Lang }) {
  const W = 332
  const H = 80
  const PAD = { x: 8, top: 24, bottom: 8 }

  return (
    <div style={{
      background: 'rgba(0,0,0,0.30)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
      overflow: 'hidden', position: 'relative', height: H,
    }}>
      <span style={{
        position: 'absolute', top: 8, left: 10, color: 'rgba(255,255,255,0.9)',
        fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, zIndex: 1,
      }}>{tr(lang, 'pnl.title')}</span>

      {trades.length < 2 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>{tr(lang, 'pnl.no_data')}</span>
        </div>
      ) : (() => {
        const sorted = [...trades].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
        const cumulative = sorted.reduce<number[]>((acc, tr_) => {
          acc.push((acc[acc.length - 1] ?? 0) + (tr_.pnlSOL ?? 0))
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
        )
      })()}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div style={{
      flex: 1, background: 'rgba(0,0,0,0.30)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
      padding: '10px 12px',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color ?? '#ffffff', fontSize: 17, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

type Filter = 'ALL' | 'Active' | 'Gain' | 'Loss'
const FILTERS: Filter[] = ['ALL', 'Active', 'Gain', 'Loss']

function FilterBar({ active, onChange, lang }: { active: Filter; onChange: (f: Filter) => void; lang: Lang }) {
  const labels: Record<Filter, string> = {
    ALL: tr(lang, 'filter.all'),
    Active: tr(lang, 'filter.active'),
    Gain: tr(lang, 'filter.gain'),
    Loss: tr(lang, 'filter.loss'),
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {FILTERS.map(f => (
        <button key={f} onClick={() => onChange(f)} style={{
          padding: '8px 0', borderRadius: 8, fontFamily: 'inherit',
          background: '#ffffff',
          border: '1px solid #ffffff',
          color: '#000000',
          fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
        }}>{labels[f]}</button>
      ))}
    </div>
  )
}

// ─── Currency Toggle (popup) ──────────────────────────────────────────────────

function CurrencyToggle({ value, onChange }: { value: 'SOL' | 'USD'; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{
      display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
      background: '#1a1a1a', border: '1px solid #333', borderRadius: 20, padding: 2,
      fontFamily: FONT,
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

// ─── Performance Calendar ─────────────────────────────────────────────────────

function CalendarModal({ trades, onClose, lang }: { trades: Trade[]; onClose: () => void; lang: Lang }) {
  const today = new Date()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const getMonday = (d: Date) => {
    const day = d.getDay()
    const diff = (day + 6) % 7
    const mon = new Date(d)
    mon.setDate(d.getDate() - diff)
    mon.setHours(0, 0, 0, 0)
    return mon
  }
  const [weekStart, setWeekStart] = useState(() => getMonday(today))

  const calLocale = tr(lang, 'cal.locale')
  const DAY_LABELS = tr(lang, 'cal.days').split(',')

  const dayMap = new Map<string, number>()
  for (const trade of trades) {
    if (!trade.closedAt) continue
    const d = new Date(trade.closedAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dayMap.set(key, (dayMap.get(key) ?? 0) + (trade.pnlSOL ?? 0))
  }

  function toKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function isSameDay(d: Date, d2: Date) {
    return d.getDate() === d2.getDate() && d.getMonth() === d2.getMonth() && d.getFullYear() === d2.getFullYear()
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })
  const weekLabel = (() => {
    const end = weekDays[6]
    const fmtD = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    return `${fmtD(weekStart)} – ${fmtD(end)} ${end.getFullYear()}`
  })()

  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7
  const monthCells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (monthCells.length % 7 !== 0) monthCells.push(null)
  const monthName = firstDay.toLocaleString(calLocale, { month: 'long', year: 'numeric' })

  function DayCell({ pnl, dayNum, isT }: { pnl?: number; dayNum: React.ReactNode; isT: boolean }) {
    const hasTrade = pnl !== undefined
    const bg = hasTrade ? (pnl! >= 0 ? `${C.green}28` : `${C.red}28`) : 'transparent'
    const border = hasTrade ? (pnl! >= 0 ? `1px solid ${C.green}60` : `1px solid ${C.red}60`) : `1px solid transparent`
    const color = hasTrade ? (pnl! >= 0 ? C.green : C.red) : C.dim
    return (
      <div title={hasTrade ? `${pnl! >= 0 ? '+' : ''}${pnl!.toFixed(3)} SOL` : undefined} style={{
        borderRadius: 6, background: bg, border,
        boxShadow: isT ? '0 0 0 1.5px #fff' : 'none',
        padding: '5px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: isT ? '#fff' : color }}>{dayNum}</span>
        {hasTrade && (
          <span style={{ fontSize: 7, fontWeight: 700, color, lineHeight: 1 }}>
            {pnl! >= 0 ? '+' : ''}{pnl!.toFixed(2)}
          </span>
        )}
      </div>
    )
  }

  const btnNav: React.CSSProperties = {
    padding: 4, background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'rgba(255,255,255,0.9)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'rgba(0,0,0,0.20)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.10)', borderRadius: 24,
        padding: 20, width: '100%', fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 12,
        color: '#fff',
      }}>

        {/* View toggle + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(0,0,0,0.20)', borderRadius: 8, padding: 4,
          }}>
            <button onClick={() => setView('week')} style={{
              borderRadius: 6, padding: '4px 16px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: view === 'week' ? '#ffffff' : 'transparent',
              color: view === 'week' ? '#000' : 'rgba(255,255,255,0.9)',
              boxShadow: view === 'week' ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
              transition: 'all 0.15s',
            }}>{tr(lang, 'cal.weekly')}</button>
            <button onClick={() => setView('month')} style={{
              borderRadius: 6, padding: '4px 16px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: view === 'month' ? '#ffffff' : 'transparent',
              color: view === 'month' ? '#000' : 'rgba(255,255,255,0.9)',
              boxShadow: view === 'month' ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
              transition: 'all 0.15s',
            }}>{tr(lang, 'cal.monthly')}</button>
          </div>
          <button onClick={onClose} style={{
            padding: 8, background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.9)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Month/week label + navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0' }}>
          <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: '#fff', textTransform: 'capitalize' }}>
            {view === 'week' ? weekLabel : monthName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button style={btnNav} onClick={() => {
              if (view === 'week') {
                const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(new Date(d))
              } else {
                const d = new Date(year, month - 1); setYear(d.getFullYear()); setMonth(d.getMonth())
              }
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button style={btnNav} onClick={() => {
              if (view === 'week') {
                const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(new Date(d))
              } else {
                const d = new Date(year, month + 1); setYear(d.getFullYear()); setMonth(d.getMonth())
              }
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>

        {/* Day labels + cells */}
        {view === 'week' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weekDays.map((d, i) => {
              const pnl = dayMap.get(toKey(d))
              const hasTrade = pnl !== undefined
              const isT = isSameDay(d, today)
              const color = hasTrade ? (pnl! >= 0 ? C.green : C.red) : C.dim
              const bg = hasTrade ? (pnl! >= 0 ? `${C.green}18` : `${C.red}18`) : 'transparent'
              const border = hasTrade
                ? `1px solid ${pnl! >= 0 ? C.green : C.red}60`
                : `1px solid ${C.border}`
              const dayName = d.toLocaleDateString(calLocale, { weekday: 'long' })
              const dayLabel = dayName.charAt(0).toUpperCase() + dayName.slice(1)
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: bg, border,
                  boxShadow: isT ? '0 0 0 1.5px #fff' : 'none',
                  borderRadius: 8, padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{dayLabel}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.9)' }}>{String(d.getDate()).padStart(2, '0')}/{String(d.getMonth() + 1).padStart(2, '0')}</span>
                  </div>
                  {hasTrade ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color }}>{pnl! >= 0 ? '+' : ''}{pnl!.toFixed(3)} SOL</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: '#000',
                        background: color, borderRadius: 4, padding: '1px 6px',
                      }}>{pnl! >= 0 ? tr(lang, 'cal.gain_badge') : tr(lang, 'cal.loss_badge')}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.9)' }}>—</span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center' }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, paddingBottom: 2 }}>{d}</div>
            ))}
            {monthCells.map((day, i) => {
              if (!day) return <div key={i} />
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isT = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
              return <DayCell key={i} pnl={dayMap.get(key)} dayNum={day} isT={isT} />
            })}
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {[{ color: C.green, label: tr(lang, 'cal.gain') }, { color: C.red, label: tr(lang, 'cal.loss') }].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: `${color}40`, border: `1px solid ${color}80` }} />
              <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Platform Selector ────────────────────────────────────────────────────────

type Platform = 'padre' | 'axiom' | 'gmgn'

const PLATFORMS: { id: Platform; label: string; logo: string; url: string }[] = [
  { id: 'gmgn',  label: 'GMGN',  logo: 'https://play-lh.googleusercontent.com/fvxA2z_aZcjhD6mcqc5pLe8dx1GkR-yZf9RQL-Nbr_mC53QgSz5yAcho2S70cQh-l2Y2SopnyBJZpQhZXv8F=w240-h480-rw', url: 'https://gmgn.ai' },
  { id: 'axiom', label: 'AXIOM', logo: 'https://axiom.trade/favicon.ico',                                                                                                                          url: 'https://axiom.trade' },
  { id: 'padre', label: 'Padre', logo: 'https://coin-images.coingecko.com/coins/images/36079/large/padre.jpg?1762307301',                                                                          url: 'https://trade.padre.gg/trenches' },
]

function PlatformSelector({ onSelect, lang }: { onSelect: (p: Platform) => void; lang: Lang }) {
  const [hovered, setHovered] = React.useState<Platform | null>(null)
  const subtitle = tr(lang, 'platform.subtitle').split('\n')

  return (
    <div style={{
      width: 360, minHeight: 480, fontFamily: FONT,
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
      border: '1px solid rgba(255,255,255,0.10)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', background: '#ffffff', borderBottom: '1px solid #e0e0e0',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: '#000000', letterSpacing: -0.3 }}>PaperMemes</span>
        <span style={{ color: '#888888', fontSize: 10 }}>v1.5</span>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 20px', gap: 22,
      }}>
        {/* Language selector */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {(Object.entries(LANG_LABELS) as [Lang, string][]).map(([l, label]) => (
            <button
              key={l}
              onClick={() => Storage.set({ language: l })}
              style={{
                padding: '4px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                background: lang === l ? '#ffffff' : 'transparent',
                border: `1px solid ${lang === l ? '#ffffff' : 'rgba(255,255,255,0.25)'}`,
                color: lang === l ? '#000000' : 'rgba(255,255,255,0.55)',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              }}
            >{label}</button>
          ))}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#ffffff', fontSize: 18, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
            {tr(lang, 'platform.title')}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 1.6 }}>
            {subtitle[0]}<br />{subtitle[1]}
          </div>
        </div>

        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {PLATFORMS.map(({ id, label, logo, url }) => {
            const isHovered = hovered === id
            return (
              <button
                key={id}
                onClick={() => { onSelect(id); chrome.tabs.create({ url }) }}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  padding: '20px 12px', borderRadius: 14, cursor: 'pointer',
                  background: isHovered ? '#ffffff' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${isHovered ? '#ffffff' : 'rgba(255,255,255,0.12)'}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                  fontFamily: FONT, transition: 'all 0.15s',
                }}
              >
                <img
                  src={logo}
                  alt={label}
                  width={48}
                  height={48}
                  style={{ borderRadius: 10, objectFit: 'contain' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <span style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.2,
                  color: isHovered ? '#000000' : '#ffffff',
                }}>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
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

  const lang = (state.language ?? 'fr') as Lang

  if (state.selectedPlatform === null) {
    return <PlatformSelector onSelect={p => Storage.set({ selectedPlatform: p })} lang={lang} />
  }

  const { balance, activeTrade, closedTrades, currency, solPrice } = state

  const totalPnl = closedTrades.reduce((s, trade) => s + (trade.pnlSOL ?? 0), 0)
  const won = closedTrades.filter(trade => trade.status === 'won').length
  const lost = closedTrades.length - won
  const winRate = closedTrades.length > 0 ? (won / closedTrades.length) * 100 : null
  const best = closedTrades.reduce<Trade | null>((b, trade) =>
    !b || (trade.pnlPercent ?? -Infinity) > (b.pnlPercent ?? -Infinity) ? trade : b, null)
  const avgPnl = closedTrades.length > 0 ? totalPnl / closedTrades.length : null

  function fmtBal(): React.ReactNode {
    if (currency === 'USD' && solPrice > 0) return `$${(balance * solPrice).toFixed(2)}`
    return <>{fmtSOL(balance)} <SolIcon size={22} style={{ marginLeft: 2 }} /></>
  }

  function fmtSub(): string {
    if (currency === 'SOL' && solPrice > 0) return `= $${(balance * solPrice).toFixed(2)}`
    if (currency === 'USD') return `${fmtSOL(balance)} SOL`
    return ''
  }

  function fmtPnlNode(sol: number): React.ReactNode {
    if (currency === 'USD' && solPrice > 0) return `$${(sol * solPrice).toFixed(2)}`
    return <>{fmtSOL(sol)} <SolIcon size={11} style={{ marginLeft: 1 }} /></>
  }

  const filteredTrades = filter === 'Gain'
    ? closedTrades.filter(trade => trade.status === 'won')
    : filter === 'Loss'
    ? closedTrades.filter(trade => trade.status === 'lost')
    : closedTrades

  return (
    <>
      {showReset && <ResetModal onClose={() => setShowReset(false)} currency={currency} solPrice={solPrice} lang={lang} />}
      {showCalendar && <CalendarModal trades={closedTrades} onClose={() => setShowCalendar(false)} lang={lang} />}
      <div style={{
        width: 360, minHeight: 480,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: C.text, fontFamily: FONT, display: 'flex', flexDirection: 'column',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: '#ffffff', borderBottom: '1px solid #e0e0e0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#000000', fontSize: 18, lineHeight: 1 }}>≡</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#000000', letterSpacing: -0.3 }}>PaperMemes</span>
            <span style={{ color: '#888888', fontSize: 10 }}>v1.5</span>
            <span style={{
              background: '#000', color: '#fff', fontSize: 9, fontWeight: 700,
              padding: '2px 7px', borderRadius: 20, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>{state.selectedPlatform}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowCalendar(true)} title="Calendar" style={{
              width: 34, height: 34, background: '#000000', border: '1px solid #333',
              borderRadius: 8, cursor: 'pointer', color: '#fff', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#ffffff">
                <path d="M216 64C229.3 64 240 74.7 240 88L240 128L400 128L400 88C400 74.7 410.7 64 424 64C437.3 64 448 74.7 448 88L448 128L480 128C515.3 128 544 156.7 544 192L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 192C96 156.7 124.7 128 160 128L192 128L192 88C192 74.7 202.7 64 216 64zM216 176L160 176C151.2 176 144 183.2 144 192L144 240L496 240L496 192C496 183.2 488.8 176 480 176L216 176zM144 288L144 480C144 488.8 151.2 496 160 496L480 496C488.8 496 496 488.8 496 480L496 288L144 288z"/>
              </svg>
            </button>
            <button onClick={() => setShowReset(true)} title="Reset" style={{
              width: 34, height: 34, background: '#000000', border: '1px solid #333',
              borderRadius: 8, cursor: 'pointer', color: '#fff', fontSize: 17,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
            }}>↺</button>
            <button onClick={() => Storage.set({ selectedPlatform: null })} title="Change platform" style={{
              width: 34, height: 34, background: '#000000', border: '1px solid #333',
              borderRadius: 8, cursor: 'pointer', color: '#fff', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Wallet ── */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              background: '#fff', color: '#111', fontWeight: 700, fontSize: 11,
              padding: '3px 10px', borderRadius: 20,
            }}>{tr(lang, 'wallet.label')}</span>
            <CurrencyToggle
              value={currency}
              onChange={() => Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })}
            />
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center' }}>
            {fmtBal()}
          </div>
          {fmtSub() && (
            <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 3 }}>{fmtSub()}</div>
          )}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, padding: '10px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

          <PnlCurve trades={closedTrades} lang={lang} />

          {/* Stats row 1 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <StatCard
              label={tr(lang, 'stats.pnl')}
              value={<>{totalPnl >= 0 ? '+' : ''}{fmtPnlNode(totalPnl)}</>}
              color={pnlColor(totalPnl)}
              sub={avgPnl != null ? <>{tr(lang, 'stats.avg')} {fmtSOL(avgPnl)} $</> : undefined}
            />
            <StatCard
              label={tr(lang, 'stats.winrate')}
              value={winRate != null ? `${winRate.toFixed(0)}%` : '—'}
              color={winRate != null ? (winRate >= 50 ? C.green : C.red) : C.muted}
              sub={closedTrades.length > 0 ? `${won}W/${lost}L` : tr(lang, 'stats.no_trade')}
            />
          </div>

          {/* Stats row 2 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <StatCard
              label={tr(lang, 'stats.trades')}
              value={closedTrades.length}
              color={C.text}
              sub={activeTrade ? tr(lang, 'stats.active_pos') : tr(lang, 'stats.no_pos')}
            />
            <StatCard
              label={tr(lang, 'stats.best')}
              value={best ? fmtPct(best.pnlPercent ?? 0) : '—'}
              color={best ? C.green : C.muted}
              sub={best ? best.tokenName : tr(lang, 'stats.no_trade')}
            />
          </div>

          {/* Trade History */}
          <div>
            <div style={{
              fontWeight: 800, fontSize: 11, letterSpacing: 2.5,
              color: '#ffffff', marginBottom: 8, textTransform: 'uppercase',
            }}>{tr(lang, 'history.title')}</div>
            <FilterBar active={filter} onChange={setFilter} lang={lang} />
          </div>

          {/* Trade List */}
          {filter === 'Active' ? (
            activeTrade ? (
              <ActiveTradeRow trade={activeTrade} currency={currency} solPrice={solPrice} lang={lang} />
            ) : (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.9)', fontSize: 11, padding: '16px 0' }}>
                {tr(lang, 'history.no_active')}
              </div>
            )
          ) : filteredTrades.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.9)', fontSize: 11, padding: '16px 0' }}>
              {tr(lang, 'history.no_trade')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredTrades.map(trade => (
                <TradeCard key={trade.id} trade={trade} currency={currency} solPrice={solPrice} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Active trade row (filter Active) ────────────────────────────────────────

function ActiveTradeRow({ trade, currency, solPrice, lang }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number; lang: Lang }) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.30)', borderRadius: 10, border: `1px solid ${C.green}50`,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{trade.tokenName}</span>
        <span style={{
          background: `${C.green}22`, color: C.green, border: `1px solid ${C.green}60`,
          borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 700,
        }}>{tr(lang, 'trade.active')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {[
          { label: tr(lang, 'trade.terminal'), val: trade.terminal },
          { label: tr(lang, 'trade.entry_mc'), val: fmtMC(trade.entryMC) },
          { label: tr(lang, 'trade.invested'), val: currency === 'USD' && solPrice > 0 ? `$${(trade.invested * solPrice).toFixed(2)}` : `${fmtSOL(trade.invested)} SOL` },
        ].map(({ label, val }) => (
          <div key={label}>
            <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 12 }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export {}
