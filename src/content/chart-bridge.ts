;(function () {
  let tvWidget: any = null
  let currentLine: any = null
  let failStreak = 0
  let drawGen = 0   // incremented on cancel/clear; invalidates stale callbacks
  let currentMint = ''
  let chartReadyCbOn: any = null  // which widget we last registered onChartReady on
  let pendingDraw: { price: number; label: string; color: string; gen: number } | null = null
  const LOG = (...a: any[]) => console.log('[PaperMemes bridge]', ...a)

  // ── Hook TradingView.widget constructor (Padre / window.TradingView builds) ──

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

  // ── Prototype patch (Axiom / webpack builds) ────────────────────────────────
  // We can't hook the constructor of a webpack-bundled TradingView widget, but
  // once we've seen ANY widget instance we can patch its prototype's
  // onChartReady.  Axiom calls widget.onChartReady(...) on every widget it
  // creates (including after SPA navigation), so the patch captures each fresh
  // live instance at the exact moment its chart becomes genuinely ready —
  // no polling, no stale references.

  let capturedAt = 0

  function onWidgetReady(w: any) {
    tvWidget = w
    failStreak = 0
    capturedAt = Date.now()
    LOG('live widget captured via prototype onChartReady')
    const p = pendingDraw
    if (!p || p.gen !== drawGen) return
    try {
      drawLine(w, p.price, p.label, p.color)
      LOG('pending line drawn via prototype capture')
      pendingDraw = null
    } catch (e) {
      LOG('prototype-capture draw failed:', String((e as any)?.message ?? '').slice(0, 60))
    }
  }

  function patchPrototype(w: any) {
    let proto = w
    // walk the prototype chain to find where onChartReady actually lives
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'onChartReady')) {
      proto = Object.getPrototypeOf(proto)
    }
    if (!proto || proto.__pm_ready_patched) return
    const orig = proto.onChartReady
    if (typeof orig !== 'function') return
    proto.__pm_ready_patched = true
    proto.onChartReady = function (this: any, cb: any) {
      const self = this
      return orig.call(this, function (this: any, ...args: any[]) {
        try { onWidgetReady(self) } catch {}
        return typeof cb === 'function' ? cb.apply(this, args) : undefined
      })
    }
    LOG('widget prototype onChartReady patched')
  }

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

  // Walk DOM upward from the TradingView iframe — the owning React component
  // holds the widget in its hooks (works for Axiom / webpack-bundled TradingView)
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

  function scanReactFibers(): any {
    for (const sel of ['#tv-chart-container', '[data-testid="trading-view-container"]', '#__next']) {
      const fiber = fiberOf(document.querySelector(sel))
      if (!fiber) continue
      const found = walkFiber(fiber, 200)
      if (found) { LOG('found via React fiber scan from', sel); return found }
    }
    const bodyFiber = fiberOf(document.body)
    if (bodyFiber) {
      const found = walkFiber(bodyFiber, 100)
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
    if (tvWidget) { patchPrototype(tvWidget); return tvWidget }
    tvWidget = fullScan()
    if (tvWidget) patchPrototype(tvWidget)
    return tvWidget
  }

  // Background: find any widget instance early just to get the prototype patched
  // BEFORE the user takes a position (and before Axiom re-creates the widget on
  // SPA navigation).  Stops once a prototype has been patched.
  let protoScanTicks = 0
  const protoScanTimer = setInterval(() => {
    protoScanTicks++
    if (protoScanTicks > 150) { clearInterval(protoScanTimer); return }  // ~5 min
    const w = tvWidget ?? fullScan()
    if (!w) return
    patchPrototype(w)
    clearInterval(protoScanTimer)
  }, 2000)

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
    drawGen++           // invalidate any pending onChartReady / retry callbacks
    chartReadyCbOn = null  // allow re-registration on next draw
    if (!currentLine) return
    try { currentLine.remove() } catch {}
    currentLine = null
    LOG('line removed')
  }

  // ── Draw with retry + onChartReady fallback ────────────────────────────────

  function drawLine(w: any, price: number, label: string, color: string): boolean {
    let chartObj: any
    try {
      chartObj = w.chart()
    } catch (e) {
      // Some TV builds expose activeChart() instead of (or in addition to) chart()
      if (typeof w.activeChart === 'function') {
        chartObj = w.activeChart()
      } else {
        throw e
      }
    }
    const line = chartObj.createPositionLine()
    applySetters(line, price, label, color)
    currentLine = line
    failStreak = 0
    pendingDraw = null
    return true
  }

  // Register a no-op onChartReady on each new widget we encounter.  The call
  // goes through the patched prototype, so when it fires (sync or async) the
  // wrapper runs onWidgetReady() → captures the instance and draws pendingDraw.
  function ensureChartReadyCb(w: any) {
    if (chartReadyCbOn === w) return   // already registered on this widget
    chartReadyCbOn = w
    try {
      w.onChartReady(() => {})
      LOG('onChartReady registered on widget')
    } catch {
      LOG('onChartReady not available on this widget')
    }
  }

  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    const gen = drawGen   // capture; stale if removeLine() was called since

    if (failStreak >= 3) forceRescan()

    const w = getWidget()
    if (!w) {
      LOG(`attempt ${attempt}: no widget`)
      if (attempt < 120) setTimeout(() => {
        if (drawGen === gen) attemptDraw(price, label, color, attempt + 1)
      }, 500)
      return
    }

    ensureChartReadyCb(w)

    try {
      drawLine(w, price, label, color)
      LOG('line drawn on attempt', attempt)
    } catch (e) {
      const msg = String((e as any)?.message ?? '').slice(0, 80)
      failStreak++
      LOG(`attempt ${attempt} failed (streak ${failStreak}): ${msg}`)

      if (attempt < 120) setTimeout(() => {
        if (drawGen === gen) attemptDraw(price, label, color, attempt + 1)
      }, 500)
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
    // Remember the request: if the prototype patch captures a freshly-ready
    // widget while the retry loop is still failing, it draws this immediately.
    pendingDraw = { price, label, color, gen: drawGen }
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', (e: Event) => {
    const mint = (e as CustomEvent).detail?.mintAddress
    if (mint && mint !== currentMint) {
      LOG('clearlines ignored (stale mint)')
      return
    }
    LOG('clearlines received')
    removeLine()
  })

  window.addEventListener('papermemes:urlchange', (e: Event) => {
    currentMint = (e as CustomEvent).detail?.mintAddress ?? ''
    LOG('urlchange received, mint:', currentMint)
    removeLine()
    // Widget from the previous token is stale — but if the prototype patch just
    // captured a fresh one (new token's chart became ready before this event
    // arrived), keep it.
    if (Date.now() - capturedAt > 3000) tvWidget = null
    failStreak = 0
    chartReadyCbOn = null // allow registration on whatever widget appears next
  })
})()
