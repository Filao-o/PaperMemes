import React, { useEffect, useState } from 'react'
import { Storage } from '../storage'
import type { AppState, Trade } from '../types'
import { C, fmtSOL, fmtMC, pnlColor, Tabs, Divider, Badge } from './components/ui'
import { JournalPanel } from './components/JournalPanel'

const DEFAULTS: AppState = {
  balance: 50, activeTrade: null, closedTrades: [],
  tpPresets: [25, 50, 100, 200], slPresets: [-10, -20, -30, -50],
  buyPresets: [0.1, 0.5, 1, 5], currency: 'SOL', solPrice: 0,
}

export function App() {
  const [state, setState] = useState<AppState>(DEFAULTS)
  const [tab, setTab] = useState<'trade' | 'journal'>('trade')

  useEffect(() => {
    Storage.get().then(setState)
    Storage.onChanged(changes => setState(prev => ({ ...prev, ...changes })))

    chrome.runtime.sendMessage({ type: 'FETCH_SOL_PRICE' }, res => {
      if (res?.ok) setState(prev => ({ ...prev, solPrice: res.data }))
    })
  }, [])

  const { balance, activeTrade, closedTrades, currency, solPrice } = state

  function fmtBal(sol: number) {
    return currency === 'USD' ? `$${(sol * solPrice).toFixed(2)}` : `${fmtSOL(sol)} ≋`
  }

  function toggleCurrency() {
    Storage.set({ currency: currency === 'SOL' ? 'USD' : 'SOL' })
  }

  function resetBalance() {
    if (!confirm('Réinitialiser le solde à 50 SOL ?')) return
    Storage.set({ balance: 50, activeTrade: null, closedTrades: [] })
  }

  return (
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
          <button onClick={resetBalance} title="Réinitialiser" style={iconBtnStyle}>↺</button>
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
