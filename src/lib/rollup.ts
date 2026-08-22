// Derived data: tree navigation, completion roll-ups, stage breakdowns.
import { Category, Config, Task, doneStageOf } from './model';

export type Tasks = Record<string, Task>;

export function categoryById(config: Config, id: string | null | undefined): Category | null {
  if (!id) return null;
  return config.categories.find(c => c.id === id) ?? null;
}

export function rootOf(tasks: Tasks, t: Task): Task {
  let cur = t;
  const seen = new Set<string>();
  while (cur.parent && tasks[cur.parent] && !seen.has(cur.id)) { seen.add(cur.id); cur = tasks[cur.parent]; }
  return cur;
}
export function effectiveCategoryId(tasks: Tasks, t: Task): string | null {
  let cur: Task | undefined = t;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.category) return cur.category;
    seen.add(cur.id);
    cur = cur.parent ? tasks[cur.parent] : undefined;
  }
  return null;
}
export function effectiveCategory(tasks: Tasks, config: Config, t: Task): Category | null {
  return categoryById(config, effectiveCategoryId(tasks, t));
}
export function depthOf(tasks: Tasks, t: Task): number {
  let d = 0; let cur = t; const seen = new Set<string>();
  while (cur.parent && tasks[cur.parent] && !seen.has(cur.id)) { seen.add(cur.id); cur = tasks[cur.parent]; d++; }
  return d;
}
export function ancestors(tasks: Tasks, t: Task): Task[] {
  const out: Task[] = []; let cur = t; const seen = new Set<string>();
  while (cur.parent && tasks[cur.parent] && !seen.has(cur.id)) { seen.add(cur.id); cur = tasks[cur.parent]; out.unshift(cur); }
  return out;
}

const byOrder = (a: Task, b: Task) => (a.order - b.order) || a.created.localeCompare(b.created);

export function childrenOf(tasks: Tasks, id: string | null): Task[] {
  const out: Task[] = [];
  for (const t of Object.values(tasks)) if (t.parent === id) out.push(t);
  return out.sort(byOrder);
}
export function roots(tasks: Tasks): Task[] {
  return Object.values(tasks).filter(t => !t.parent || !tasks[t.parent]).sort(byOrder);
}
export function descendants(tasks: Tasks, id: string): Task[] {
  const out: Task[] = [];
  const walk = (pid: string) => { for (const c of childrenOf(tasks, pid)) { out.push(c); walk(c.id); } };
  walk(id);
  return out;
}
export function hasChildren(tasks: Tasks, id: string): boolean {
  for (const t of Object.values(tasks)) if (t.parent === id) return true;
  return false;
}

/** A node is complete when its pipeline stage is the done stage, or (checkbox node) done=true, or a root in the Done horizon. */
export function isDone(tasks: Tasks, config: Config, t: Task): boolean {
  if (!t.parent && t.horizon === 'done') return true;
  if (t.stage) {
    const cat = effectiveCategory(tasks, config, t);
    const ds = doneStageOf(cat);
    if (ds) return t.stage === ds;
  }
  if (t.counter && t.counter.target > 0 && !t.done) return t.counter.done >= t.counter.target;
  return t.done;
}

export interface Progress { done: number; total: number; pct: number }
/** Leaf-weighted completion: every leaf counts 1; counters count fractionally. */
export function progressOf(tasks: Tasks, config: Config, t: Task): Progress {
  const kids = childrenOf(tasks, t.id);
  if (!kids.length) {
    if (t.counter && t.counter.target > 0) {
      const f = Math.min(1, t.counter.done / t.counter.target);
      return { done: f, total: 1, pct: f };
    }
    const d = isDone(tasks, config, t) ? 1 : 0;
    return { done: d, total: 1, pct: d };
  }
  let done = 0, total = 0;
  for (const k of kids) {
    if (!hasChildren(tasks, k.id) && isDone(tasks, config, k)) { done += 1; total += 1; continue; }
    const p = progressOf(tasks, config, k);
    // a parent marked done counts as fully complete regardless of its leaves
    if (isDone(tasks, config, k)) { done += p.total; total += p.total; } else { done += p.done; total += p.total; }
  }
  return { done, total, pct: total ? done / total : 0 };
}

export interface StageCount { stageId: string | 'none'; name: string; color: string; count: number }
/** Direct-child breakdown by pipeline stage (checkbox children fall into done / not done buckets). */
export function stageBreakdown(tasks: Tasks, config: Config, t: Task): StageCount[] {
  const cat = effectiveCategory(tasks, config, t);
  const kids = childrenOf(tasks, t.id);
  if (!kids.length || !cat) return [];
  const counts = new Map<string, number>();
  let plainDone = 0, plainOpen = 0;
  for (const k of kids) {
    if (k.stage && cat.stages.some(s => s.id === k.stage)) counts.set(k.stage, (counts.get(k.stage) ?? 0) + 1);
    else if (isDone(tasks, config, k)) plainDone++; else plainOpen++;
  }
  if (!counts.size) return [];
  const n = cat.stages.length;
  const out: StageCount[] = cat.stages.map((s, i) => ({
    stageId: s.id, name: s.name, color: s.color ?? stageColor(cat.color, i, n), count: counts.get(s.id) ?? 0,
  }));
  if (plainOpen) out.unshift({ stageId: 'none', name: 'Open', color: 'rgba(255,255,255,.15)', count: plainOpen });
  if (plainDone) out.push({ stageId: 'none', name: 'Done', color: cat.color, count: plainDone });
  return out.filter(s => s.count > 0);
}

/** Stage colour ramps from dim to the category colour across the pipeline. */
export function stageColor(catColor: string, index: number, total: number): string {
  const t = total <= 1 ? 1 : index / (total - 1);
  const alpha = 0.25 + 0.75 * t;
  return hexToRgba(catColor, alpha);
}
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Fractional ordering: a number strictly between prev and next (either may be undefined). */
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return (next as number) - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

export function countLeaves(tasks: Tasks, config: Config, t: Task): { open: number; total: number } {
  const ds = descendants(tasks, t.id).filter(d => !hasChildren(tasks, d.id));
  const open = ds.filter(d => !isDone(tasks, config, d)).length;
  return { open, total: ds.length };
}
