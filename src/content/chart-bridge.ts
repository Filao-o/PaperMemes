;(function () {
  // Runs in the MAIN world (page context) so it can reach the TradingView API.
  // Draws / updates / removes a single horizontal position line on the chart in
  // response to CustomEvents dispatched by the content script (injector).
  //
  // Two chart-access paths:
  //   • Padre  — hook window.TradingView.widget to capture the widget instance.
  //   • Axiom  — webpack-bundled TradingView with no window.TradingView; reach
  //              the chart API directly inside the live same-origin iframe.

  let tvWidget: any = null    // widget instance captured via the constructor hook (Padre)
  let currentLine: any = null // the position line currently drawn (null if none)
  let drawGen = 0             // bumped on clear / navigation to cancel stale retry chains
  let currentMint = ''        // active token mint — picks the right iframe & guards stale clears
  const LOG = (...a: any[]) => console.log('[PaperMemes bridge]', ...a)

  // ── Padre: capture the widget by hooking the constructor ─────────────────────

  function hookConstructor(): boolean {
    const tv = (window as any).TradingView
    if (!tv?.widget || tv.widget.__pm_hooked) return !!tv?.widget?.__pm_hooked
    const Orig = tv.widget
    function Hooked(this: any, options: any) {
      const instance = new Orig(options)
      LOG('widget captured via constructor hook')
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
  const hookTimer = setInterval(() => {
    if (hookConstructor() || hookAttempts++ > 100) clearInterval(hookTimer)
  }, 50)
  // TradingView may load late or be replaced — keep the hook in place.
  setInterval(() => {
    const tv = (window as any).TradingView
    if (tv?.widget && !tv.widget.__pm_hooked) hookConstructor()
  }, 2000)

  // ── Axiom: reach the chart API inside the live TradingView iframe ─────────────

  function apiFromIframe(iframe: HTMLIFrameElement): any {
    let cw: any = null
    try { cw = iframe.contentWindow } catch {}
    if (!cw) return null
    try {
      if (cw.tradingViewApi && typeof cw.tradingViewApi.activeChart === 'function') return cw.tradingViewApi
    } catch {}
    // Fallback: scan the iframe window for anything exposing the chart API.
    try {
      for (const key of Object.getOwnPropertyNames(cw)) {
        try {
          const v = cw[key]
          if (v && typeof v === 'object' && typeof v.activeChart === 'function') return v
        } catch {}
      }
    } catch {}
    return null
  }

  function symbolOf(api: any): string {
    try { return String(api.activeChart().symbol() || '') } catch { return '' }
  }

  // During SPA navigation Axiom keeps a STALE, dataless iframe (symbol
  // "UNKNOWN-…", createPositionLine throws "Value is null") in the DOM alongside
  // the live one for the current token.  Try every iframe, prefer the one whose
  // symbol matches the current mint, and accept only the iframe where
  // createPositionLine actually succeeds — never the dead chart.
  function createLineViaLiveIframe(): any {
    const iframes = Array.prototype.slice.call(
      document.querySelectorAll('iframe[id^="tradingview"]')) as HTMLIFrameElement[]
    const cands: { id: string; api: any; sym: string }[] = []
    for (const ifr of iframes) {
      const api = apiFromIframe(ifr)
      if (api) cands.push({ id: ifr.id, api, sym: symbolOf(api) })
    }
    if (!cands.length) return null

    // Rank: symbol matching the current mint first, "UNKNOWN-…" placeholder last.
    const mint = currentMint.toUpperCase()
    const rank = (s: string) =>
      mint && s.toUpperCase().includes(mint) ? 0 : (s.startsWith('UNKNOWN') ? 2 : 1)
    cands.sort((a, b) => rank(a.sym) - rank(b.sym))

    for (const { id, api, sym } of cands) {
      try {
        const line = api.activeChart().createPositionLine()
        LOG('line via live iframe', id, 'sym', sym.slice(0, 16))
        return line
      } catch {}
    }
    return null
  }

  // ── Line drawing ─────────────────────────────────────────────────────────────

  function applySetters(line: any, price: number, label: string, color: string) {
    try { line.setPrice(price) } catch {}
    try { line.setLineColor(color) } catch {}
    try { line.setLineWidth(2) } catch {}
    try { line.setQuantity(label) } catch {}
    try { line.setQuantityTextColor('#ffffff') } catch {}
    try { line.setQuantityBackgroundColor(color) } catch {}
    try { line.setQuantityBorderColor(color) } catch {}
  }

  // Create a fresh position line, or null if no chart is ready yet.
  function createLine(): any {
    // Primary: the live in-DOM iframe that actually accepts the line (Axiom).
    const viaIframe = createLineViaLiveIframe()
    if (viaIframe) return viaIframe
    // Fallback: the hooked widget instance (Padre).
    if (tvWidget) {
      let chart: any = null
      try { chart = tvWidget.chart() } catch {}
      if (!chart) { try { if (typeof tvWidget.activeChart === 'function') chart = tvWidget.activeChart() } catch {} }
      if (chart) {
        try { const line = chart.createPositionLine(); LOG('line via hooked widget'); return line } catch {}
      }
    }
    return null
  }

  // Try to draw; if the chart isn't ready yet (data still loading), retry every
  // 500ms for up to ~60s.  drawGen invalidates the chain if a clear/navigation
  // happens in between.
  function attemptDraw(price: number, label: string, color: string, attempt: number) {
    const gen = drawGen
    const retry = () => {
      if (attempt < 120) setTimeout(() => { if (drawGen === gen) attemptDraw(price, label, color, attempt + 1) }, 500)
      else LOG('gave up after', attempt, 'attempts')
    }

    let raw: any = null
    try { raw = createLine() } catch {}
    if (!raw) { retry(); return }

    // GMGN's TradingView build returns a Promise from createPositionLine();
    // Axiom/Padre return the line adapter directly.
    if (typeof raw.then === 'function') {
      Promise.resolve(raw).then((line: any) => {
        if (drawGen !== gen) { try { line?.remove() } catch {} ; return }  // superseded
        if (!line || typeof line.setPrice !== 'function') { retry(); return }
        applySetters(line, price, label, color)
        currentLine = line
        LOG('line drawn (async) on attempt', attempt)
      }).catch((e: any) => {
        LOG('async line rejected:', String(e?.message ?? '').slice(0, 60))
        retry()
      })
      return
    }

    applySetters(raw, price, label, color)
    currentLine = raw
    LOG('line drawn on attempt', attempt)
  }

  function removeLine() {
    drawGen++   // cancel any pending retry chain
    if (!currentLine) return
    try { currentLine.remove() } catch {}
    currentLine = null
    LOG('line removed')
  }

  // ── Events from the content script (injector) ────────────────────────────────

  window.addEventListener('papermemes:drawline', (e: Event) => {
    const { price, label, color } = (e as CustomEvent).detail
    LOG('drawline received, price:', price)
    // Always remove + redraw rather than updating in place.  In-place setters
    // silently no-op on a detached line (e.g. GMGN re-renders the chart between
    // buys), so a DCA would keep showing the old average / total.  Removing and
    // recreating in the SAME synchronous handler causes no visible flicker and
    // guarantees the line lands on the currently-live chart with fresh values.
    drawGen++   // cancel any pending retry chain from a previous drawline
    if (currentLine) {
      try { currentLine.remove() } catch {}
      currentLine = null
    }
    attemptDraw(price, label, color, 0)
  })

  window.addEventListener('papermemes:clearlines', (e: Event) => {
    const mint = (e as CustomEvent).detail?.mintAddress
    if (mint && mint !== currentMint) { LOG('clearlines ignored (stale mint)'); return }
    LOG('clearlines received')
    removeLine()
  })

  window.addEventListener('papermemes:urlchange', (e: Event) => {
    currentMint = (e as CustomEvent).detail?.mintAddress ?? ''
    LOG('urlchange received, mint:', currentMint)
    removeLine()
  })
})()
