// Web Push subscription management. The data repo's notify workflow sends the pushes.
import { store } from './store';

export const VAPID_PUBLIC_KEY = 'BD3_vaMsQxg0iO6ooFiFJ1H8eZoQ_wYL2ey9JPNdnp-lAgQQxJD3mGPg1mGjGUEUJizKUeVVO-CZq0K5CBkwt6s';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
export function isIOS(): boolean { return /iPhone|iPad|iPod/.test(navigator.userAgent); }

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Push is not supported in this browser.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  const s = store.state.settings;
  if (!s) throw new Error('Connect GitHub first.');
  const record = { deviceId: s.deviceId, deviceName: s.deviceName, subscription: sub.toJSON(), created: new Date().toISOString(), ua: navigator.userAgent };
  store.putFile(`push/${s.deviceId}.json`, JSON.stringify(record, null, 2) + '\n', `Push: register ${s.deviceName}`);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe();
  const s = store.state.settings;
  if (s) store.putFile(`push/${s.deviceId}.json`, JSON.stringify({ deviceId: s.deviceId, deviceName: s.deviceName, subscription: null, disabled: true }, null, 2) + '\n', `Push: unregister ${s.deviceName}`);
}

export async function sendTestPush(): Promise<void> {
  const gh = store.github;
  if (!gh) throw new Error('Connect GitHub first.');
  await gh.dispatchWorkflow('notify.yml', { mode: 'test' });
}

export async function localTestNotification(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Tasker', { body: 'Notifications are working on this device.', icon: './icons/icon-192.png' });
}
