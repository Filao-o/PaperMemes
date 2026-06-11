chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message

  if (type === 'FETCH_RUGCHECK') {
    const { mintAddress } = payload
    fetch(`https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report`)
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (type === 'FETCH_PUMPFUN') {
    const { mintAddress } = payload
    fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`)
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (type === 'RESOLVE_MINT') {
    const { poolAddress } = payload
    fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddress}`)
      .then(r => r.json())
      .then(data => {
        const mint = data?.pairs?.[0]?.baseToken?.address
        if (mint) sendResponse({ ok: true, data: mint })
        else sendResponse({ ok: false, error: 'No mint found' })
      })
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (type === 'NOTIFY') {
    const { title, body } = payload
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icons/icon48.png',
      title,
      message: body,
    })
    sendResponse({ ok: true })
    return true
  }

  if (type === 'FETCH_SOL_PRICE') {
    fetch('https://price.jup.ag/v6/price?ids=SOL')
      .then(r => r.json())
      .then(data => {
        const price = data?.data?.SOL?.price ?? 0
        sendResponse({ ok: true, data: price })
      })
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  return false
})

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener(() => {})

export {}