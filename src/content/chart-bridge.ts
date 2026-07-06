;(function () {
  let tvWidget: any = null
  const LOG = (...a: any[]) => console.log('[PaperMemes bridge]', ...a)

  // ── Hook TradingView.widget constructor ────────────────────────────────────

  function hookConstructor(): boolean {
    const tv = (window as any).TradingView
    if (!tv?.widget || tv.widget.__pm_hooked) return !!(tv?.widget?.__pm_hooked)
    const Orig = tv.widget
    function Hooked(this: any, options: any) {
      const instance = new Orig(options)
      LOG('widget captured via hook')
      tvWidget = instance
      return instance
    }
    Hooked.prototype = Orig.prototype
    Hooked.__pm_hooked = true
    tv.widget = Hooked
    LOG('constructor hooked')
    return true
  }

  let hookAttempts = 0
  const fastHookTimer = setInterval(() => {
    if (hookConstructor() || hookAttempts++ > 100) clearInterval(fastHookTimer)
  }, 50)

  setInterval(() => {
    const tv = (window as any).TradingView
    if (tv?.widget && !tv.widget.__pm_hooked) { LOG('re-hooking'); hookConstructor() }
  }, 2000)

  // ── Widget finders ─────────────────────────────────────────────────────────

  function isWidget(v: any): boolean {
    return !!(v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function')
  }

  function scanWindow(): any {
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const v = (window as any)[key]
        if (isWidget(v)) { LOG('found via window scan, key:', key); return v }
      } catch {}
    }
    return null
  }

  // Walk React fiber tree looking for a TradingView widget in useState/useRef hooks
  function scanReactFibers(): any {
    const root = document.querySelector('#tv-chart-container, [data-testid="trading-view-container"]') ?? document.body
    const fiberKey = Object.keys(root).find(k => /^__reactFiber/.test(k))
    if (!fiberKey) return null

    function walkFiber(fiber: any, depth: number): any {
      if (!fiber || depth <= 0) return null
      let hook = fiber.memoizedState
      while (hook) {
        const val = hook.memoizedState
        if (isWidget(val)) return val
        if (val && isWidget(val.current)) return val.current  // useRef
        hook = hook.next
      }
      return walkFiber(fiber.child, depth - 1) ?? walkFiber(fiber.sibling, depth - 1)
    }

    const found = walkFiber((root as any)[fiberKey], 40)
    if (found) LOG('found via React fiber scan')
    return found
  }

  function getWidget(): any {
    if (tvWidget) return tvWidget
    tvWidget = scanWindow() ?? scanReactFibers()
    return tvWidget
  }

  // ── Draw with individual setters + retry ───────────────────────────────────

  function applySetters(line: any, price: number, label: string, color: string) {
    try { line.setPrice(price) } catch {}
    try { line.setLineColor(color) } catch {}
    try { line.setLineWidth(2) } catch {}
    try { line.setQuantity(label) } catch {}
    try { line.setQuantityTextColor('#ffffff') } catch {}
    try { line.setQuantityBackgroundColor(color) } catch {}
    try { line.setQuantityBorderColor(color) } catch {}
  }

  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    const w = getWidget()
    if (!w) {
      LOG(`attempt ${attempt}: no widget found`)
      if (attempt < 30) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
      return
    }
    try {
      const line = w.chart().createPositionLine()
      applySetters(line, price, label, color)
      LOG('line drawn on attempt', attempt)
    } catch (e) {
      const msg = String((e as any)?.message ?? '')
      LOG(`attempt ${attempt} failed: ${msg.slice(0, 80)}`)
      if (attempt < 30) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
    }
  }

  // ── Watch for new TradingView iframe (widget recreated by SPA) ─────────────

  let knownIframeId: string | null = null
  new MutationObserver(() => {
    const iframe = document.querySelector('iframe[id^="tradingview"]') as HTMLIFrameElement | null
    if (!iframe || iframe.id === knownIframeId) return
    knownIframeId = iframe.id
    LOG('new TradingView iframe:', iframe.id, '— forcing widget rescan')
    tvWidget = null  // Reset so getWidget re-scans with updated React state
  }).observe(document.body, { childList: true, subtree: true })

  // ── Events ─────────────────────────────────────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price, 'widget:', tvWidget ? 'cached' : 'none')
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', () => LOG('clearlines (widget ref kept)'))
  window.addEventListener('papermemes:urlchange', () => LOG('urlchange (widget ref kept)'))
})()
