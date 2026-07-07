;(function () {
  let tvWidget: any = null
  let currentLine: any = null
  let failStreak = 0
  let drawGen = 0   // incremented on cancel/clear; invalidates stale callbacks
  let currentMint = ''
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
    drawGen++           // invalidate any pending onChartReady / retry callbacks
    if (!currentLine) return
    try { currentLine.remove() } catch {}
    currentLine = null
    LOG('line removed')
  }

  // ── Draw with retry + onChartReady fallback ────────────────────────────────

  function drawLine(w: any, price: number, label: string, color: string): boolean {
    const line = w.chart().createPositionLine()
    applySetters(line, price, label, color)
    currentLine = line
    failStreak = 0
    return true
  }

  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    const gen = drawGen   // capture; stale if removeLine() was called since

    if (failStreak >= 3) forceRescan()

    const w = getWidget()
    if (!w) {
      LOG(`attempt ${attempt}: no widget`)
      if (attempt < 40) setTimeout(() => {
        if (drawGen === gen) attemptDraw(price, label, color, attempt + 1)
      }, 500)
      return
    }

    try {
      drawLine(w, price, label, color)
      LOG('line drawn on attempt', attempt)
    } catch (e) {
      const msg = String((e as any)?.message ?? '').slice(0, 80)
      failStreak++
      LOG(`attempt ${attempt} failed (streak ${failStreak}): ${msg}`)

      // On attempt 0 register onChartReady as a fast path — fires immediately if
      // the chart is already ready, and gives us a free draw without waiting 500ms.
      // Do NOT start a new retry chain inside the callback: Chain A (below) is
      // already retrying every 500ms, and a parallel Chain B would corrupt
      // the shared failStreak counter causing chaos.
      // On Axiom, onChartReady fires synchronously (before the TV internal API is
      // truly ready). Start a fast 50ms poll inside the callback so we draw the
      // instant _innerAPI() becomes non-null — typically < 1s after the callback.
      if (attempt === 0) {
        try {
          w.onChartReady(() => {
            LOG('onChartReady fired — starting fast poll')
            let ticks = 0
            const poll = setInterval(() => {
              ticks++
              if (ticks > 200 || currentLine || drawGen !== gen) {
                clearInterval(poll)
                return
              }
              const fresh = getWidget()
              if (!fresh) return
              try {
                drawLine(fresh, price, label, color)
                LOG('line drawn via onChartReady poll, tick', ticks)
                clearInterval(poll)
              } catch {}
            }, 50)
          })
          LOG('onChartReady registered')
        } catch {
          LOG('onChartReady not available on this widget')
        }
      }

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
    tvWidget = null   // stale after SPA navigation; force rescan on next buy
    failStreak = 0
  })
})()
