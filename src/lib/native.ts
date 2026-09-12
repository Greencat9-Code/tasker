// Native (Capacitor) support: on-device local notifications, scheduled from the task data
// whenever it changes. No push server involved — works with a free Apple ID sideload.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications, LocalNotificationSchema } from '@capacitor/local-notifications';
import { BudgetData, Config, EMPTY_BUDGET, Task } from './model';
import { Tasks, isDone, rootOf } from './rollup';
import { addDays, parseDate, today } from './dates';
import { fmtMoney, upcomingBills } from './budget';

export const isNative = Capacitor.isNativePlatform();

export async function nativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNative) return 'denied';
  const s = await LocalNotifications.checkPermissions();
  return s.display === 'granted' ? 'granted' : s.display === 'denied' ? 'denied' : 'prompt';
}

export async function enableNative(config: Config, tasks: Tasks, budget: BudgetData = EMPTY_BUDGET): Promise<boolean> {
  const s = await LocalNotifications.requestPermissions();
  if (s.display !== 'granted') return false;
  await rescheduleNative(config, tasks, budget);
  return true;
}

export async function nativeTest(): Promise<void> {
  await LocalNotifications.schedule({ notifications: [{
    id: hash('test' + Date.now()), title: 'Tasker', body: 'On-device notifications are working.',
    schedule: { at: new Date(Date.now() + 5000) },
  }] });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000 + 1;
}

function label(tasks: Tasks, t: Task): string {
  const root = rootOf(tasks, t);
  return root.id === t.id ? t.title : `${t.title} (${root.title})`;
}

/**
 * Recompute the pending notification set from current data (call after every sync/change).
 * iOS caps pending local notifications at 64, so we schedule the next 7 days, closest first.
 */
export async function rescheduleNative(config: Config, tasks: Tasks, budget: BudgetData = EMPTY_BUDGET): Promise<void> {
  if (!isNative) return;
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });

  const now = Date.now();
  const t0 = today();
  const horizon = addDays(t0, 7);
  const list: LocalNotificationSchema[] = [];
  const digestHour = config.digestHour ?? 8;
  const perDay = new Map<string, { hard: string[]; soft: string[]; blocks: string[]; bills: string[] }>();
  const dayBucket = (d: string) => { let b = perDay.get(d); if (!b) { b = { hard: [], soft: [], blocks: [], bills: [] }; perDay.set(d, b); } return b; };
  for (const bill of upcomingBills(budget, t0, 7, 0)) {
    if (bill.date > horizon) continue;
    dayBucket(bill.date).bills.push(`${bill.name} ${fmtMoney(bill.amount)}${bill.autopay ? ' (auto)' : ''}`);
  }

  for (const t of Object.values(tasks)) {
    const done = isDone(tasks, config, t);
    if (!done && t.hard && t.hard >= t0 && t.hard <= horizon) {
      dayBucket(t.hard).hard.push(label(tasks, t));
      const eve = parseDate(t.hard); eve.setDate(eve.getDate() - 1); eve.setHours(18, 0, 0, 0);
      if (eve.getTime() > now) list.push({ id: hash(`eve:${t.id}:${t.hard}`), title: 'Hard deadline tomorrow', body: label(tasks, t), schedule: { at: eve } });
    }
    if (!done && t.soft && t.soft >= t0 && t.soft <= horizon) dayBucket(t.soft).soft.push(label(tasks, t));
    for (const b of t.blocks) {
      const d = b.start.slice(0, 10);
      if (d < t0 || d > horizon) continue;
      dayBucket(d).blocks.push(label(tasks, t));
      const at = parseDate(b.start); at.setMinutes(at.getMinutes() - 60);
      if (at.getTime() > now) list.push({ id: hash(`blk:${t.id}:${b.id}`), title: `Up next at ${b.start.slice(11, 16)}`, body: label(tasks, t), schedule: { at } });
    }
  }
  for (const [d, b] of perDay) {
    const at = parseDate(d); at.setHours(digestHour, 0, 0, 0);
    if (at.getTime() <= now) continue;
    const lines: string[] = [];
    if (b.hard.length) lines.push(`Due: ${b.hard.slice(0, 3).join(', ')}${b.hard.length > 3 ? '…' : ''}`);
    if (b.soft.length) lines.push(`Soft target: ${b.soft.slice(0, 3).join(', ')}${b.soft.length > 3 ? '…' : ''}`);
    if (b.blocks.length) lines.push(`Scheduled: ${b.blocks.slice(0, 3).join(', ')}${b.blocks.length > 3 ? '…' : ''}`);
    if (b.bills.length) lines.push(`Bills: ${b.bills.slice(0, 4).join(', ')}${b.bills.length > 4 ? '…' : ''}`);
    if (lines.length) list.push({ id: hash(`digest:${d}`), title: 'Tasker · today', body: lines.join('\n'), schedule: { at } });
  }
  list.sort((a, b) => (a.schedule!.at as Date).getTime() - (b.schedule!.at as Date).getTime());
  const capped = list.slice(0, 60);
  if (capped.length) await LocalNotifications.schedule({ notifications: capped });
}

let timer: number | null = null;
/** Debounced reschedule; safe to call on every store change. */
export function queueNativeReschedule(config: Config, tasks: Tasks, budget: BudgetData = EMPTY_BUDGET) {
  if (!isNative) return;
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; rescheduleNative(config, tasks, budget).catch(e => console.warn('reschedule failed', e)); }, 4000);
}
