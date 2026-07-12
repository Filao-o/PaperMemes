# PaperMemes — Firebase backend

Cloud sync for the extension: each user's trading data is stored in Firestore,
keyed by their account, with an optional wallet address attached to the profile.

## Console checklist

1. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
2. **Firestore Database** (Cloud Firestore, *Standard edition*, region `eur3`),
   started in production mode.
3. **Firestore → Rules**: paste `firestore.rules` from this folder and publish.
4. **Authentication → Settings → Authorized domains** (later, when the site/extension
   auth is wired): add the Vercel domain and the extension's OAuth redirect.

The Web app config lives in `src/firebase/config.ts` (public by design).

## Data model

```
users/{uid}
  ├─ email:         string
  ├─ walletAddress: string | null      (set by the user in the popup)
  ├─ balance:       number
  ├─ activeTrade:   map | null
  ├─ closedTrades:  array<map>         (full history — snapshot)
  ├─ settings:      map                (currency, fees, slippage, presets)
  └─ updatedAt:     timestamp
```

The extension writes a **snapshot** to `users/{uid}` on every change (debounced).
When the history grows large, closed trades can be moved to a
`users/{uid}/trades/{tradeId}` sub-collection for finer querying — the rules
already cover sub-collections.

## How it works (extension side)

- `src/firebase/auth.ts` — Auth via REST (email/password), tokens in
  `chrome.storage.local` under `__pmAuth` (excluded from the JSON export).
- `src/firebase/firestore.ts` — encodes values to Firestore typed JSON, PATCHes
  the user doc with a field mask.
- `src/firebase/sync.ts` — `syncNow()` pushes the local state to Firestore.
- The **service worker** calls `syncNow()` (debounced) on trade/setting changes.
- The **popup** (Settings → Account) handles sign in / sign up, the wallet field,
  and sign out.

## TODO (next steps)

- **Google sign-in** in MV3: needs an OAuth Web client ID + the extension's
  `https://<extension-id>.chromiumapp.org/` redirect, driven via
  `chrome.identity.launchWebAuthFlow` then `signInWithCredential`-equivalent REST.
- **Vercel dashboard**: a page that reads `users/{uid}` after login and renders
  the analytics (winrate, cumulative PnL, per-terminal breakdown).
