// Hash router: #/today | #/board/<category|all> | #/calendar/<month|week>/<date> | #/settings, plus ?task=<id> overlay.
import { useSyncExternalStore } from 'react';

export type View = 'today' | 'board' | 'calendar' | 'settings';
export interface Route { view: View; parts: string[]; task: string | null }

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = h.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const view = (['today', 'board', 'calendar', 'settings'].includes(parts[0]) ? parts[0] : 'today') as View;
  const task = new URLSearchParams(query).get('task');
  return { view, parts: parts.slice(1), task };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => { current = parse(); listeners.forEach(l => l()); });

export function useRoute(): Route {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => current);
}

export function go(view: View, parts: string[] = [], task: string | null = current.task) {
  const q = task ? `?task=${encodeURIComponent(task)}` : '';
  location.hash = `/${[view, ...parts].join('/')}${q}`;
}
export function openTask(id: string) {
  const base = location.hash.replace(/^#\/?/, '').split('?')[0];
  location.hash = `/${base}?task=${encodeURIComponent(id)}`;
}
export function closeTask() {
  const base = location.hash.replace(/^#\/?/, '').split('?')[0];
  location.hash = `/${base}`;
}
