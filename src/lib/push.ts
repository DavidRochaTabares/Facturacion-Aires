import { supabase } from './supabase'

// Web Push for agency staff: the browser/PWA registers its push subscription with the database; the server (push-notify) sends the alerts.
const PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'granted'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function pushState(): PushState {
  if (!PUBLIC_KEY || !('serviceWorker' in navigator)) return 'unsupported'
  // iPhone/iPad only expose push inside an app installed on the home screen
  if (isIos() && !standalone()) return 'needs-install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return Notification.permission as PushState
}

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '='))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

async function register(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }))
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('El dispositivo no entregó una suscripción válida.')
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent })
  if (error) throw new Error(error.message)
}

/** Must run from a user gesture (a click): browsers and iOS only show the permission prompt in response to one. */
export async function enablePush(): Promise<PushState> {
  if (pushState() === 'unsupported' || pushState() === 'needs-install') return pushState()
  const p = await Notification.requestPermission()
  if (p === 'granted') await register()
  return p as PushState
}

/** Keeps the stored subscription fresh for devices that already granted permission (silent; no prompt). */
export async function syncPush(): Promise<void> {
  if (pushState() === 'granted') await register()
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}
