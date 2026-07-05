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
      LOG('widget created via constructor hook')
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

  // Long-running re-hook check (handles TradingView script reloads)
  setInterval(() => {
    const tv = (window as any).TradingView
    if (tv?.widget && !tv.widget.__pm_hooked) {
      LOG('TradingView reloaded, re-hooking')
      hookConstructor()
    }
  }, 2000)

  // ── Widget scan ────────────────────────────────────────────────────────────

  function scanWindow(): any {
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const v = (window as any)[key]
        if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') {
          LOG('widget found via scan, key:', key)
          return v
        }
      } catch {}
    }
    return null
  }

  function getWidget(): any {
    if (tvWidget) {
      // Verify still alive with a real call
      try { tvWidget.chart(); return tvWidget } catch {}
      // chart() threw — widget is dead
      LOG('cached widget dead, rescanning')
      tvWidget = null
    }
    tvWidget = scanWindow()
    return tvWidget
  }

  // ── Draw with retry ────────────────────────────────────────────────────────

  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    const w = getWidget()
    if (!w) {
      LOG(`attempt ${attempt}: no widget found`)
      if (attempt < 20) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
      return
    }

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
      LOG('line drawn via chart()')
      return
    } catch (e1) {
      LOG(`attempt ${attempt}: chart() failed (${(e1 as any)?.message}), trying onChartReady`)
    }

    try {
      w.onChartReady(() => {
        try {
          w.chart().createPositionLine()
            .setPrice(price)
            .setLineColor(color)
            .setLineWidth(2)
            .setBodyText(label)
            .setBodyTextColor('#ffffff')
            .setBodyBackgroundColor(color)
            .setBodyBorderColor(color)
            .setQuantity('')
          LOG('line drawn via onChartReady')
        } catch (e) {
          LOG('createPositionLine inside onChartReady failed:', e)
          if (attempt < 20) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
        }
      })
    } catch (e2) {
      LOG(`attempt ${attempt}: onChartReady failed (${(e2 as any)?.message})`)
      if (attempt < 20) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price, 'widget:', tvWidget ? 'cached' : 'none')
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', () => {
    LOG('clearlines received')
    // Don't touch tvWidget — keep reference alive for next draw
  })

  window.addEventListener('papermemes:urlchange', () => {
    LOG('urlchange received')
    // Don't touch tvWidget
  })
})()
