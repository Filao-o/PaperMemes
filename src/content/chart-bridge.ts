;(function () {
  let tvWidget: any = null
  let currentLine: any = null
  let failStreak = 0
  const LOG = (...a: any[]) => console.log('[PaperMemes bridge]', ...a)

  // ── Hook TradingView.widget constructor (works when widget is on window.TradingView) ──

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

  // ── Widget detection ────────────────────────────────────────────────────────

  function isWidget(v: any): boolean {
    return !!(v && typeof v === 'object' &&
      typeof v.chart === 'function' &&
      (typeof v.onChartReady === 'function' || typeof v.activeChart === 'function'))
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

  // Walk a single fiber node's hook chain
  function checkFiberHooks(fiber: any): any {
    let hook = fiber?.memoizedState
    while (hook) {
      const v = hook.memoizedState
      if (isWidget(v)) return v
      if (v && isWidget(v.current)) return v.current          // useRef
      if (Array.isArray(v) && isWidget(v[0])) return v[0]    // useMemo
      hook = hook.next
    }
    return null
  }

  // Traverse fiber tree downward from a root element (depth-limited DFS)
  function walkFiber(fiber: any, depth: number): any {
    if (!fiber || depth <= 0) return null
    const found = checkFiberHooks(fiber)
    if (found) return found
    return walkFiber(fiber.child, depth - 1) ?? walkFiber(fiber.sibling, depth - 1)
  }

  function fiberOf(el: Element | null): any {
    if (!el) return null
    const key = Object.keys(el).find(k => /^__reactFiber/.test(k))
    return key ? (el as any)[key] : null
  }

  // Scan upward from the TradingView iframe — the component that owns the iframe
  // holds the widget ref in its hooks (works for Axiom / webpack-bundled TV)
  function scanFromIframe(): any {
    const iframe = document.querySelector('iframe[id^="tradingview"]')
    if (!iframe) return null
    let el: Element | null = iframe
    for (let i = 0; i < 30 && el && el !== document.documentElement; i++) {
      const fiber = fiberOf(el)
      if (fiber) {
        const found = walkFiber(fiber, 20)
        if (found) { LOG('found via iframe parent scan at depth', i); return found }
      }
      el = el.parentElement
    }
    return null
  }

  // Scan React fiber tree from common TradingView container selectors
  function scanReactFibers(): any {
    const selectors = [
      '#tv-chart-container',
      '[data-testid="trading-view-container"]',
      '#__next',           // Next.js root (Axiom)
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      const fiber = fiberOf(el)
      if (!fiber) continue
      const found = walkFiber(fiber, 200)
      if (found) { LOG('found via React fiber scan from', sel); return found }
    }
    // Last resort: scan from body
    const fiber = fiberOf(document.body)
    if (fiber) {
      const found = walkFiber(fiber, 100)
      if (found) { LOG('found via React fiber scan from body'); return found }
    }
    return null
  }

  function fullScan(): any {
    return scanWindow() ?? scanFromIframe() ?? scanReactFibers()
  }

  function forceRescan() {
    LOG('forcing widget rescan')
    tvWidget = null
    failStreak = 0
    tvWidget = fullScan()
  }

  function getWidget(): any {
    if (tvWidget) return tvWidget
    tvWidget = fullScan()
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

  // ── Watch for TradingView iframe changes ──────────────────────────────────

  let knownSig = ''

  new MutationObserver(() => {
    const iframe = document.querySelector('iframe[id^="tradingview"]') as HTMLIFrameElement | null
    if (!iframe) return
    const sig = `${iframe.id}|${iframe.src}`
    if (sig === knownSig) return
    knownSig = sig
    LOG('TradingView iframe changed, resetting fail streak')
    failStreak = 0
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'id'] })

  // ── Events ─────────────────────────────────────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price)
    if (currentLine) {
      try {
        applySetters(currentLine, price, label, color)
        LOG('line updated in place')
        return
      } catch {
        currentLine = null
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
