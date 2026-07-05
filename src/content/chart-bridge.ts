;(function () {
  let tvWidget: any = null
  const pendingLines: Array<{ price: number; label: string; color: string }> = []
  const activeLines: any[] = []

  // ── Hook TradingView.widget constructor ────────────────────────────────────

  function hookConstructor() {
    const tv = (window as any).TradingView
    if (!tv?.widget || tv.widget.__pm_hooked) return false
    const Orig = tv.widget
    function Hooked(this: any, options: any) {
      const instance = new Orig(options)
      tvWidget = instance
      flushPending()
      return instance
    }
    Hooked.prototype = Orig.prototype
    Hooked.__pm_hooked = true
    tv.widget = Hooked
    return true
  }

  // Poll until TradingView is available (it loads via <script> after page parse)
  let attempts = 0
  const hookTimer = setInterval(() => {
    if (hookConstructor() || attempts++ > 200) clearInterval(hookTimer)
  }, 50)

  // ── Fallback: scan window for existing widget ──────────────────────────────

  function findWidget(): any {
    if (tvWidget) return tvWidget
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const v = (window as any)[key]
        if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') {
          tvWidget = v
          return v
        }
      } catch { /* skip non-accessible props */ }
    }
    return null
  }

  // ── Draw a position line ───────────────────────────────────────────────────

  function drawLine(price: number, label: string, color: string) {
    const w = findWidget()
    if (!w) {
      pendingLines.push({ price, label, color })
      return
    }
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

  function flushPending() {
    while (pendingLines.length) {
      const p = pendingLines.shift()!
      drawLine(p.price, p.label, p.color)
    }
  }

  // ── Remove all lines ───────────────────────────────────────────────────────

  function clearLines() {
    for (const line of activeLines) {
      try { line.remove() } catch {}
    }
    activeLines.length = 0
  }

  // ── Event listeners (from content script / ISOLATED world) ─────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    drawLine(price, label, color)
  })

  window.addEventListener('papermemes:clearlines', () => {
    clearLines()
  })
})()
