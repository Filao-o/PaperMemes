// Minimal Firestore REST client — encodes JS values into Firestore's typed JSON
// and PATCHes the per-user document. RLS-equivalent security is enforced by the
// Firestore Security Rules (users can only touch users/{their-own-uid}).
import { firebaseConfig } from './config'

const DOC_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`

export function toValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null }
  const t = typeof v
  if (t === 'string') return { stringValue: v }
  if (t === 'boolean') return { booleanValue: v }
  if (t === 'number') return Number.isFinite(v) ? { doubleValue: v } : { nullValue: null }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (t === 'object') return { mapValue: { fields: toFields(v) } }
  return { nullValue: null }
}

export function toFields(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k in obj) {
    if (obj[k] !== undefined) out[k] = toValue(obj[k])
  }
  return out
}

// PATCH users/{uid} with a field mask so unlisted fields are left untouched
// (lets trade-sync and wallet-save write different fields without clobbering).
export async function patchUserDoc(
  uid: string,
  idToken: string,
  fields: Record<string, any>,
  mask: string[],
): Promise<void> {
  const q = mask.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&')
  const res = await fetch(`${DOC_BASE}/users/${uid}?${q}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`firestore ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
