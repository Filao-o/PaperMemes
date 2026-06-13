import React from 'react'

export function SolIcon({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 313 281" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 3, ...style }}>
      <g clipPath="url(#uiSolClip)">
        <path d="M311.318 221.057L259.66 276.558C258.537 277.764 257.178 278.725 255.669 279.382C254.159 280.039 252.53 280.378 250.884 280.377H5.99719C4.8287 280.377 3.68568 280.035 2.70855 279.393C1.73143 278.751 0.962771 277.837 0.49702 276.764C0.0312691 275.69 -0.111286 274.504 0.0868712 273.35C0.285028 272.196 0.815265 271.126 1.61243 270.27L53.3099 214.769C54.4299 213.566 55.7843 212.607 57.2893 211.95C58.7943 211.293 60.4178 210.953 62.0595 210.95H306.933C308.101 210.95 309.244 211.292 310.221 211.934C311.199 212.576 311.967 213.49 312.433 214.564C312.899 215.637 313.041 216.824 312.843 217.977C312.645 219.131 312.115 220.201 311.318 221.057ZM259.66 109.294C258.537 108.088 257.178 107.127 255.669 106.47C254.159 105.813 252.53 105.474 250.884 105.475H5.99719C4.8287 105.475 3.68568 105.817 2.70855 106.459C1.73143 107.101 0.962771 108.015 0.49702 109.088C0.0312691 110.162 -0.111286 111.348 0.0868712 112.502C0.285028 113.656 0.815265 114.726 1.61243 115.582L53.3099 171.083C54.4299 172.286 55.7843 173.245 57.2893 173.902C58.7943 174.559 60.4178 174.899 62.0595 174.902H306.933C308.101 174.902 309.244 174.56 310.221 173.918C311.199 173.276 311.967 172.362 312.433 171.288C312.899 170.215 313.041 169.028 312.843 167.875C312.645 166.721 312.115 165.651 311.318 164.795L259.66 109.294ZM5.99719 69.4267H250.884C252.53 69.4275 254.159 69.089 255.669 68.432C257.178 67.7751 258.537 66.8139 259.66 65.6082L311.318 10.1069C312.115 9.25107 312.645 8.18056 312.843 7.02695C313.041 5.87334 312.899 4.68686 312.433 3.6133C311.967 2.53974 311.199 1.62586 310.221 0.983941C309.244 0.342026 308.101 3.95314e-05 306.933 0L62.0595 0C60.4178 0.00279866 58.7943 0.34314 57.2893 0.999953C55.7843 1.65677 54.4299 2.61607 53.3099 3.81847L1.62576 59.3197C0.829361 60.1748 0.299359 61.244 0.100752 62.3964C-0.0978539 63.5488 0.0435698 64.7342 0.507679 65.8073C0.971789 66.8803 1.73841 67.7943 2.71352 68.4372C3.68863 69.0802 4.82984 69.424 5.99719 69.4267Z" fill="url(#uiSolGrad)"/>
      </g>
      <defs>
        <linearGradient id="uiSolGrad" x1="26.415" y1="287.059" x2="283.735" y2="-2.49574" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF"/>
          <stop offset="0.3" stopColor="#8752F3"/>
          <stop offset="0.5" stopColor="#5497D5"/>
          <stop offset="0.6" stopColor="#43B4CA"/>
          <stop offset="0.72" stopColor="#28E0B9"/>
          <stop offset="0.97" stopColor="#19FB9B"/>
        </linearGradient>
        <clipPath id="uiSolClip">
          <rect width="312.93" height="280.377" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  )
}

export const C = {
  bg: '#060608',
  surface: '#0e0e12',
  border: '#1c1c26',
  borderHi: '#2a2a38',
  yellow: '#EEFF00',
  green: '#00ff88',
  red: '#ff3b5c',
  text: '#f0f0fa',
  textSub: '#8888a8',
  muted: '#55556a',
  dim: '#33333f',
}

export function fmtSOL(n: number): string {
  return n.toFixed(2)
}

const MC_TIERS = [
  { threshold: 1e9, divisor: 1e8, suffix: 'B' },
  { threshold: 1e6, divisor: 1e5, suffix: 'M' },
  { threshold: 1e3, divisor: 100, suffix: 'K' },
]

export function fmtMC(n: number): string {
  const tier = MC_TIERS.find(t => n >= t.threshold)
  if (!tier) return `$${Math.round(n)}`
  return `$${(Math.floor(n / tier.divisor) / 10).toFixed(1).replace(/\.0$/, '')}${tier.suffix}`
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
const BTN_COLORS: Record<string, { bg: string; text: string; border: string; shadow: string }> = {
  yellow: { bg: `${C.yellow}30`, text: C.yellow,  border: `${C.yellow}70`, shadow: `0 0 12px ${C.yellow}50, 0 0 4px ${C.yellow}80` },
  green:  { bg: `${C.green}30`,  text: C.green,   border: `${C.green}70`,  shadow: `0 0 12px ${C.green}45, 0 0 4px ${C.green}70`   },
  red:    { bg: `${C.red}30`,    text: C.red,     border: `${C.red}70`,    shadow: `0 0 12px ${C.red}45, 0 0 4px ${C.red}70`       },
  dim:    { bg: C.surface,       text: C.textSub, border: C.border,        shadow: 'none'                                           },
}

export function Btn({ variant = 'dim', size = 'md', style, children, ...rest }: BtnProps) {
  const v = BTN_COLORS[variant]
  return (
    <button
      style={{
        background: v.bg, color: v.text, border: `1px solid ${v.border}`,
        boxShadow: rest.disabled ? 'none' : v.shadow,
        borderRadius: 8, padding: size === 'sm' ? '5px 8px' : '7px 14px',
        fontSize: size === 'sm' ? 10 : 11, fontWeight: 700, cursor: 'pointer',
        fontFamily: 'inherit', letterSpacing: 0.5,
        opacity: rest.disabled ? 0.35 : 1,
        transition: 'opacity 0.15s',
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
            flex: 1, background: 'none', border: 'none', borderBottom: active === t ? `2px solid ${C.yellow}` : '2px solid transparent',
            color: active === t ? C.yellow : C.muted, padding: '8px 0', fontSize: 11,
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
