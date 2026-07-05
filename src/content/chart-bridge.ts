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

  // ── Widget access ──────────────────────────────────────────────────────────
  // Never clear tvWidget in getWidget() — if it's temporarily broken
  // (tradingViewApi null while chart reloads), a retry will fix it.

  function getWidget(): any {
    if (tvWidget) return tvWidget
    // Scan window properties as fallback
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const v = (window as any)[key]
        if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') {
          LOG('widget found via scan, key:', key)
          tvWidget = v
          return v
        }
      } catch {}
    }
    return null
  }

  // ── Draw with retry ────────────────────────────────────────────────────────

  function applySetters(line: any, price: number, label: string, color: string) {
    // Call each setter individually so one missing method doesn't break the rest
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
      LOG(`attempt ${attempt}: no widget`)
      if (attempt < 30) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
      return
    }

    try {
      const line = w.chart().createPositionLine()
      applySetters(line, price, label, color)
      LOG('line drawn on attempt', attempt)
    } catch (e) {
      const msg = String((e as any)?.message ?? '')
      LOG(`attempt ${attempt} failed: ${msg}`)
      // tradingViewApi null = chart iframe still loading → just retry, don't give up
      if (attempt < 30) setTimeout(() => attemptDraw(price, label, color, attempt + 1), 500)
    }
  }

  // ── Watch for iframe replacement (new widget on SPA nav) ───────────────────

  let knownIframeId: string | null = null

  const iframeObserver = new MutationObserver(() => {
    const iframe = document.querySelector('iframe[id^="tradingview"]') as HTMLIFrameElement | null
    if (!iframe || iframe.id === knownIframeId) return
    knownIframeId = iframe.id
    LOG('new TradingView iframe:', iframe.id, '— scanning for widget')
    // The new widget will appear on window shortly after the iframe, rescan
    const poll = setInterval(() => {
      const found = (() => {
        for (const key of Object.getOwnPropertyNames(window)) {
          try {
            const v = (window as any)[key]
            if (v && typeof v === 'object' && typeof v.chart === 'function' && typeof v.onChartReady === 'function') return v
          } catch {}
        }
        return null
      })()
      if (found) { tvWidget = found; LOG('widget found after iframe change'); clearInterval(poll) }
    }, 200)
    setTimeout(() => clearInterval(poll), 10_000)
  })
  iframeObserver.observe(document.body, { childList: true, subtree: true })

  // ── Events ─────────────────────────────────────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price, 'widget:', tvWidget ? 'cached' : 'none')
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', () => {
    LOG('clearlines — keeping widget ref')
  })

  window.addEventListener('papermemes:urlchange', () => {
    LOG('urlchange — keeping widget ref')
  })
})()
