;(function () {
  let tvWidget: any = null
  const pendingLines: Array<{ price: number; label: string; color: string }> = []
  const activeLines: any[] = []
  let flushTimer: ReturnType<typeof setInterval> | null = null
  let flushKillTimer: ReturnType<typeof setTimeout> | null = null

  // ── Hook TradingView.widget constructor ────────────────────────────────────

  function hookConstructor() {
    const tv = (window as any).TradingView
    if (!tv?.widget || tv.widget.__pm_hooked) return false
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

  let hookAttempts = 0
  const hookTimer = setInterval(() => {
    if (hookConstructor() || hookAttempts++ > 200) clearInterval(hookTimer)
  }, 50)

  // ── Widget lookup ──────────────────────────────────────────────────────────

  function isAlive(w: any): boolean {
    if (!w) return false
    try {
      return typeof w.chart === 'function' && typeof w.onChartReady === 'function'
    } catch {
      return false
    }
  }

  function findWidget(): any {
    if (!isAlive(tvWidget)) {
      tvWidget = null
      // Scan window properties for a live widget instance
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          const v = (window as any)[key]
          if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') {
            tvWidget = v
            break
          }
        } catch { /* non-accessible property */ }
      }
    }
    return tvWidget
  }

  // ── Flush pending lines (with polling fallback) ────────────────────────────

  function flushPending() {
    const w = findWidget()
    if (!w || pendingLines.length === 0) return
    const snapshot = pendingLines.splice(0)
    for (const p of snapshot) {
      applyLine(w, p.price, p.label, p.color)
    }
  }

  function scheduledFlush() {
    flushPending()
    // If lines are still pending, keep polling until widget is ready
    if (pendingLines.length > 0 && !flushTimer) startFlushPolling()
  }

  function startFlushPolling() {
    if (flushTimer) return
    flushTimer = setInterval(() => {
      flushPending()
      if (pendingLines.length === 0) stopFlushPolling()
    }, 400)
    // Hard stop after 30s to avoid eternal polling
    flushKillTimer = setTimeout(stopFlushPolling, 30_000)
  }

  function stopFlushPolling() {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (flushKillTimer) { clearTimeout(flushKillTimer); flushKillTimer = null }
  }

  // ── Draw a single position line ────────────────────────────────────────────

  function applyLine(w: any, price: number, label: string, color: string) {
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

  function drawLine(price: number, label: string, color: string) {
    const w = findWidget()
    if (!w) {
      pendingLines.push({ price, label, color })
      startFlushPolling()
      return
    }
    applyLine(w, price, label, color)
  }

  // ── Remove all active lines and reset widget reference ─────────────────────

  function reset() {
    for (const line of activeLines) {
      try { line.remove() } catch {}
    }
    activeLines.length = 0
    pendingLines.length = 0
    stopFlushPolling()
    tvWidget = null  // Force re-scan on next drawline
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  // Called by injector.tsx on buy
  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    drawLine(price, label, color)
  })

  // Called by injector.tsx on full close
  window.addEventListener('papermemes:clearlines', () => {
    reset()
  })

  // Called by injector.tsx on SPA navigation (new token)
  window.addEventListener('papermemes:urlchange', () => {
    reset()
  })
})()
