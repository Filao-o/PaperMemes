;(function () {
  let tvWidget: any = null
  const pendingLines: Array<{ price: number; label: string; color: string }> = []
  const activeLines: any[] = []
  let flushTimer: ReturnType<typeof setInterval> | null = null
  let flushKillTimer: ReturnType<typeof setTimeout> | null = null

  // ── Hook TradingView.widget constructor ────────────────────────────────────
  // Runs at document_start so we catch the very first instantiation.
  // Also re-checked every 1s in case TradingView is loaded lazily.

  function hookConstructor(): boolean {
    const tv = (window as any).TradingView
    if (!tv?.widget || tv.widget.__pm_hooked) return !!tv?.widget?.__pm_hooked
    const Orig = tv.widget
    function Hooked(this: any, options: any) {
      const instance = new Orig(options)
      tvWidget = instance
      scheduledFlush()
      return instance
    }
    Hooked.prototype = Orig.prototype
    Hooked.__pm_hooked = true
    tv.widget = Hooked
    return true
  }

  // Initial fast-poll (catches first load)
  let hookAttempts = 0
  const fastHookTimer = setInterval(() => {
    if (hookConstructor() || hookAttempts++ > 100) clearInterval(fastHookTimer)
  }, 50)

  // Long-running check — catches cases where TradingView reloads its script
  setInterval(() => {
    const tv = (window as any).TradingView
    if (tv?.widget && !tv.widget.__pm_hooked) hookConstructor()
  }, 2000)

  // ── Widget lookup ──────────────────────────────────────────────────────────

  function isAlive(w: any): boolean {
    if (!w) return false
    try { return typeof w.chart === 'function' && typeof w.onChartReady === 'function' }
    catch { return false }
  }

  function findWidget(): any {
    if (isAlive(tvWidget)) return tvWidget

    // tvWidget is dead or null — scan window properties
    tvWidget = null
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const v = (window as any)[key]
        if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') {
          tvWidget = v
          break
        }
      } catch {}
    }
    return tvWidget
  }

  // ── Line drawing ───────────────────────────────────────────────────────────

  function drawLineOnChart(w: any, price: number, label: string, color: string) {
    // Try direct access first (chart may already be ready after SPA nav)
    let drawn = false
    try {
      const chart = w.chart()
      const line = chart.createPositionLine()
        .setPrice(price)
        .setLineColor(color)
        .setLineWidth(2)
        .setBodyText(label)
        .setBodyTextColor('#ffffff')
        .setBodyBackgroundColor(color)
        .setBodyBorderColor(color)
        .setQuantity('')
      activeLines.push(line)
      drawn = true
    } catch {}

    if (!drawn) {
      // Chart not ready yet — wait for it
      try {
        w.onChartReady(() => {
          try {
            const line = w.chart().createPositionLine()
              .setPrice(price)
              .setLineColor(color)
              .setLineWidth(2)
              .setBodyText(label)
              .setBodyTextColor('#ffffff')
              .setBodyBackgroundColor(color)
              .setBodyBorderColor(color)
              .setQuantity('')
            activeLines.push(line)
          } catch (e) {
            console.warn('[PaperMemes] createPositionLine failed:', e)
          }
        })
      } catch (e) {
        console.warn('[PaperMemes] onChartReady failed:', e)
      }
    }
  }

  function drawLine(price: number, label: string, color: string) {
    const w = findWidget()
    if (!w) {
      pendingLines.push({ price, label, color })
      startFlushPolling()
      return
    }
    drawLineOnChart(w, price, label, color)
  }

  // ── Flush pending lines ────────────────────────────────────────────────────

  function flushPending() {
    const w = findWidget()
    if (!w || pendingLines.length === 0) return
    const snapshot = pendingLines.splice(0)
    for (const p of snapshot) drawLineOnChart(w, p.price, p.label, p.color)
    stopFlushPolling()
  }

  function scheduledFlush() {
    flushPending()
    if (pendingLines.length > 0) startFlushPolling()
  }

  function startFlushPolling() {
    if (flushTimer) return
    flushTimer = setInterval(flushPending, 400)
    flushKillTimer = setTimeout(stopFlushPolling, 30_000)
  }

  function stopFlushPolling() {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (flushKillTimer) { clearTimeout(flushKillTimer); flushKillTimer = null }
  }

  // ── Remove active lines only (keep widget reference alive) ─────────────────

  function clearLines() {
    for (const line of activeLines) { try { line.remove() } catch {} }
    activeLines.length = 0
    pendingLines.length = 0
    stopFlushPolling()
    // Do NOT reset tvWidget — Padre may reuse the same widget instance across
    // SPA navigations (setSymbol instead of recreating). Clearing it would make
    // findWidget() unable to recover if the widget isn't on window.
  }

  // ── Events from injector.tsx (ISOLATED world → MAIN world via DOM) ─────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    drawLine(price, label, color)
  })

  window.addEventListener('papermemes:clearlines', () => {
    clearLines()
  })

  // On SPA navigation: clear stale lines. Keep tvWidget intact.
  window.addEventListener('papermemes:urlchange', () => {
    clearLines()
  })
})()
