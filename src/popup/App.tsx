import React, { useEffect, useState } from 'react'
import { Storage } from '../storage'
import type { AppState, Trade } from '../types'
import { C, fmtSOL, fmtMC, pnlColor, Tabs, Divider, Badge } from './components/ui'
import { JournalPanel } from './components/JournalPanel'

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
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, color: C.text }}>Réinitialiser le wallet</div>

        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Montant (SOL)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RESET_PRESETS.map(p => (
              <button key={p} onClick={() => { setAmount(p); setCustom('') }} style={{
                flex: '1 1 auto',
                background: amount === p && custom === '' ? `${C.green}22` : C.bg,
                border: `1px solid ${amount === p && custom === '' ? C.green : C.border}`,
                borderRadius: 6, color: amount === p && custom === '' ? C.green : C.textSub,
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
              background: C.bg, border: `1px solid ${custom ? C.green : C.border}`,
              borderRadius: 6, color: C.text, fontSize: 13, fontWeight: 700,
              padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
            }} />
        </div>

        <div style={{ color: C.muted, fontSize: 11, textAlign: 'center' }}>
          Nouveau solde : <span style={{ color: C.green, fontWeight: 700 }}>{activeAmount > 0 ? `${activeAmount} SOL` : '—'}</span>
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
            background: `${C.green}18`, border: `1px solid ${C.green}60`, color: C.green,
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

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<'trade' | 'journal'>('trade')
  const [showReset, setShowReset] = useState(false)

  useEffect(() => {
    Storage.get().then(setState)
    const cleanup = Storage.onChanged(changes => setState(prev => prev ? { ...prev, ...changes } : prev))
    chrome.runtime.sendMessage({ type: 'FETCH_SOL_PRICE' }, res => {
      if (res?.ok) setState(prev => prev ? { ...prev, solPrice: res.data } : prev)
    })
    return cleanup
  }, [])

  if (!state) return null

  const { balance, activeTrade, closedTrades, currency, solPrice } = state

  function fmtBal(sol: number) {
    return currency === 'USD' ? `$${(sol * solPrice).toFixed(2)}` : `${fmtSOL(sol)} ≋`
  }

  function toggleCurrency() {
    Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })
  }

  return (
    <>
    {showReset && <ResetModal onClose={() => setShowReset(false)} />}
    <div style={{
      width: 360, minHeight: 480, background: C.bg, color: C.text,
      fontFamily: "'JetBrains Mono', monospace", display: 'flex', flexDirection: 'column',
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
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 1, color: C.text }}>PAPERMEMES</span>
          <span style={{ color: C.muted, fontSize: 10 }}>v1.2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowReset(true)} title="Réinitialiser" style={iconBtnStyle}>↺</button>
          <button
            onClick={toggleCurrency}
            style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.text, fontSize: 10, fontWeight: 700, padding: '3px 8px',
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {currency === 'SOL' ? '≋ SOL' : '$ USD'}
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
            ≈ ${(balance * solPrice).toFixed(2)} USD &nbsp;·&nbsp; ≋${solPrice.toFixed(0)}
          </div>
        )}
      </div>

      {/* Position active */}
      {activeTrade && (
        <ActiveTradeCard trade={activeTrade} currency={currency} solPrice={solPrice} />
      )}

      {/* Tabs */}
      <div style={{ padding: '0 14px' }}>
        <Tabs
          tabs={['trade', 'journal']}
          active={tab}
          onChange={t => setTab(t as 'trade' | 'journal')}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '10px 14px', overflowY: 'auto' }}>
        {tab === 'trade' && (
          activeTrade ? (
            <div style={{ textAlign: 'center', color: C.muted, padding: '24px 0', fontSize: 12 }}>
              Position ouverte sur <span style={{ color: C.text }}>{activeTrade.tokenName}</span>.<br />
              Rendez-vous sur le terminal pour gérer votre position.
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: C.muted, padding: '24px 0', fontSize: 12 }}>
              Aucune position ouverte.<br />Ouvrez un terminal pour trader.
            </div>
          )
        )}
        {tab === 'journal' && (
          <JournalPanel
            closedTrades={closedTrades}
            currency={currency}
            solPrice={solPrice}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${C.border}`, padding: '6px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: C.muted, fontSize: 9, letterSpacing: 1 }}>PAPERMEMES · PAPER TRADING</span>
        <span style={{ color: activeTrade ? C.green : C.muted, fontSize: 9 }}>
          {activeTrade ? `1 position ouverte` : 'Aucune position ouverte'}
        </span>
      </div>
    </div>
    </>
  )
}

function ActiveTradeCard({ trade, currency, solPrice }: { trade: Trade; currency: 'SOL' | 'USD'; solPrice: number }) {
  return (
    <div style={{
      margin: '8px 14px', padding: '10px', background: C.surface,
      borderRadius: 8, border: `1px solid ${C.green}30`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{trade.tokenName}</span>
          <span style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>· {trade.terminal}</span>
        </div>
        <Badge text="ACTIF" color={C.green} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
        <div>
          <span style={{ color: C.muted, fontSize: 9 }}>MC ENTRÉE</span>
          <div style={{ color: C.text, fontWeight: 600 }}>{fmtMC(trade.entryMC)}</div>
        </div>
        <div>
          <span style={{ color: C.muted, fontSize: 9 }}>INVESTI</span>
          <div style={{ color: C.text, fontWeight: 600 }}>
            {currency === 'USD'
              ? `$${(trade.invested * solPrice).toFixed(2)}`
              : `${fmtSOL(trade.invested)} ≋`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <a
          href={`https://solscan.io/token/${trade.mintAddress}`}
          target="_blank" rel="noreferrer"
          style={{ color: C.muted, fontSize: 10, textDecoration: 'none' }}
        >
          ↗ Solscan
        </a>
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontSize: 14,
  cursor: 'pointer', padding: '2px 6px', fontFamily: 'inherit',
}

export {}
