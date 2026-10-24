/** `GET /push/public-key`. `enabled: false`: the server has no push keys, so push is off and the option is hidden. */
export interface PushPublicKey {
  enabled: boolean
  /** The `applicationServerKey` for `pushManager.subscribe`, as unpadded base64url. Null when push is off. */
  public_key: string | null
}

/** A browser registered for notifications. The keys are never returned; the endpoint tells a browser which one is its own. */
export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  created_at: string
}

/** What the browser's `subscription.toJSON()` gives, and `POST /push/subscriptions` takes as it is. */
export interface BrowserSubscription {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/** What the service worker tells the open windows (public/sw.js). */
export type ServiceWorkerMessage = { type: 'kc:open'; url: string } | { type: 'kc:push-changed' }
