;(function () {
  let tvWidget: any = null
  let currentLine: any = null   // reference to the active buy line
  let failStreak = 0            // consecutive chart() failures
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
      failStreak = 0
      return instance
    }
    Hooked.prototype = Orig.prototype
    Hooked.__pm_hooked = true
    tv.widget = Hooked
    LOG('constructor hooked')
    return true
  }

  let hookAttempts = 0
  const fastTimer = setInterval(() => {
    if (hookConstructor() || hookAttempts++ > 100) clearInterval(fastTimer)
  }, 50)

  setInterval(() => {
    const tv = (window as any).TradingView
    if (tv?.widget && !tv.widget.__pm_hooked) hookConstructor()
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

  // Traverse React fiber tree (for widgets stored in useState / useRef)
  function scanReactFibers(): any {
    const root = document.querySelector('#tv-chart-container, [data-testid="trading-view-container"]') ?? document.body
    if (!root) return null
    const fiberKey = Object.keys(root).find(k => /^__reactFiber/.test(k))
    if (!fiberKey) return null

    function walk(fiber: any, depth: number): any {
      if (!fiber || depth <= 0) return null
      let hook = fiber.memoizedState
      while (hook) {
        const v = hook.memoizedState
        if (isWidget(v)) return v
        if (v && isWidget(v.current)) return v.current  // useRef
        hook = hook.next
      }
      return walk(fiber.child, depth - 1) ?? walk(fiber.sibling, depth - 1)
    }

    const found = walk((root as any)[fiberKey], 50)
    if (found) LOG('found via React fiber scan')
    return found
  }

  function forceRescan() {
    LOG('forcing widget rescan')
    tvWidget = null
    failStreak = 0
    tvWidget = scanWindow() ?? scanReactFibers()
  }

  function getWidget(): any {
    if (tvWidget) return tvWidget
    tvWidget = scanWindow() ?? scanReactFibers()
    return tvWidget
  }

  // ── Line management ────────────────────────────────────────────────────────

  function applySetters(line: any, price: number, label: string, color: string) {
    try { line.setPrice(price) } catch {}
    try { line.setLineColor(color) } catch {}
    try { line.setLineWidth(2) } catch {}
    try { line.setQuantity(label) } catch {}
    try { line.setQuantityTextColor('#ffffff') } catch {}
    try { line.setQuantityBackgroundColor(color) } catch {}
    try { line.setQuantityBorderColor(color) } catch {}
  }

  function removeLine() {
    if (!currentLine) return
    try { currentLine.remove() } catch {}
    currentLine = null
    LOG('line removed')
  }

  // ── Draw with retry ────────────────────────────────────────────────────────

  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    // After 3 consecutive failures on the same widget, force a rescan
    if (failStreak >= 3) forceRescan()

    const w = getWidget()
    if (!w) {
      LOG(`attempt ${attempt}: no widget`)
      if (attempt < 40) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
      return
    }

    try {
      const line = w.chart().createPositionLine()
      applySetters(line, price, label, color)
      currentLine = line
      failStreak = 0
      LOG('line drawn on attempt', attempt)
    } catch (e) {
      failStreak++
      LOG(`attempt ${attempt} failed (streak ${failStreak}): ${String((e as any)?.message ?? '').slice(0, 80)}`)
      if (attempt < 40) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
    }
  }

  // ── Watch for TradingView iframe changes (id or src) ──────────────────────

  let knownSig = ''  // "id|src" signature

  new MutationObserver(() => {
    const iframe = document.querySelector('iframe[id^="tradingview"]') as HTMLIFrameElement | null
    if (!iframe) return
    const sig = `${iframe.id}|${iframe.src}`
    if (sig === knownSig) return
    knownSig = sig
    LOG('TradingView iframe changed, resetting fail streak')
    failStreak = 0  // Don't null tvWidget — the constructor hook updates it; nulling here causes a race
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'id'] })

  // ── Events ─────────────────────────────────────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price)
    if (currentLine) {
      // Update existing line in place (DCA case) — avoids visual flicker
      try {
        applySetters(currentLine, price, label, color)
        LOG('line updated in place')
        return
      } catch {
        currentLine = null  // Line is dead, fall through to full redraw
      }
    }
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', () => {
    LOG('clearlines received')
    removeLine()
  })

  window.addEventListener('papermemes:urlchange', () => {
    LOG('urlchange received')
    removeLine()
  })
})()
