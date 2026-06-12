import React from 'react'

export const C = {
  bg: '#0a0b0d',
  surface: '#111318',
  border: '#1e293b',
  borderHi: '#2d3f55',
  green: '#00ff88',
  red: '#ff3b5c',
  yellow: '#f59e0b',
  text: '#e2e8f0',
  textSub: '#94a3b8',
  muted: '#64748b',
  dim: '#475569',
}

export function fmtSOL(n: number): string {
  return n.toFixed(n < 0.01 ? 4 : 2)
}

export function fmtMC(n: number): string {
  if (n >= 1e9) return `$${(Math.floor(n / 1e8) / 10).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1e6) return `$${(Math.floor(n / 1e5) / 10).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `$${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}K`
  return `$${Math.round(n)}`
}

export function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function pnlColor(n: number): string {
  return n > 0 ? C.green : n < 0 ? C.red : C.textSub
}

interface RowProps { label: string; value: React.ReactNode; color?: string }
export function Row({ label, value, color }: RowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      <span style={{ color: color ?? C.text, fontSize: 12, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'green' | 'red' | 'dim' | 'yellow'
  size?: 'sm' | 'md'
}
export function Btn({ variant = 'dim', size = 'md', style, children, ...rest }: BtnProps) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    green:  { bg: `${C.green}18`, text: C.green,   border: `${C.green}60` },
    red:    { bg: `${C.red}18`,   text: C.red,     border: `${C.red}60`   },
    yellow: { bg: `${C.yellow}18`,text: C.yellow,  border: `${C.yellow}60`},
    dim:    { bg: C.surface,      text: C.textSub, border: C.border       },
  }
  const v = colors[variant]
  return (
    <button
      style={{
        background: v.bg, color: v.text, border: `1px solid ${v.border}`,
        borderRadius: 6, padding: size === 'sm' ? '4px 8px' : '6px 12px',
        fontSize: size === 'sm' ? 10 : 11, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'inherit', letterSpacing: 0.5,
        opacity: rest.disabled ? 0.4 : 1,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

interface TabsProps { tabs: string[]; active: string; onChange: (t: string) => void }
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            flex: 1, background: 'none', border: 'none', borderBottom: active === t ? `2px solid ${C.green}` : '2px solid transparent',
            color: active === t ? C.green : C.muted, padding: '8px 0', fontSize: 11,
            fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}60`,
      borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
    }}>{text}</span>
  )
}
