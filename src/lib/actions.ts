// Higher-level task operations that encode the stage / horizon / done rules.
import { Horizon, Repeat, Task, Template, TemplateNode, doneStageOf, nowIso, newId } from './model';
import { store } from './store';
import { Tasks, childrenOf, effectiveCategory, orderBetween, rootOf } from './rollup';
import { addDays, daysBetween, parseDate, toDateStr, today } from './dates';

// ---------- recurrence ----------
export function addInterval(date: string, r: Repeat): string {
  if (r.unit === 'day') return addDays(date, r.every);
  if (r.unit === 'week') return addDays(date, 7 * r.every);
  const d = parseDate(date); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + r.every);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDateStr(d);
}
/** Dates for the next occurrence of a recurring task (from today). */
export function nextOccurrenceDates(t: Task, from = today()): { soft: string | null; hard: string | null } {
  const r = t.repeat!;
  const primary = t.hard ?? t.soft;
  if (!primary) return { soft: addInterval(from, r), hard: null };
  let next = addInterval(r.anchor === 'completion' ? from : primary, r);
  let guard = 0;
  while (next <= from && guard++ < 500) next = addInterval(next, r);
  const delta = daysBetween(primary, next);
  return { soft: t.soft ? addDays(t.soft, delta) : null, hard: t.hard ? addDays(t.hard, delta) : null };
}
/** Future occurrences of the primary date inside [from, to] (for calendar previews). */
export function occurrencesBetween(t: Task, from: string, to: string, max = 24): string[] {
  const primary = t.hard ?? t.soft;
  if (!t.repeat || !primary) return [];
  const out: string[] = [];
  let d = addInterval(primary, t.repeat);
  let guard = 0;
  while (d <= to && guard++ < 1000) { if (d >= from) { out.push(d); if (out.length >= max) break; } d = addInterval(d, t.repeat); }
  return out;
}
/** Completing a recurring task rolls it forward instead of finishing it. */
export function rollForward(id: string) {
  const t = st().tasks[id]; if (!t || !t.repeat) return;
  const { soft, hard } = nextOccurrenceDates(t);
  const c = cat(t); const first = c?.stages[0]?.id ?? null; const ds = doneStageOf(c);
  const patches: { id: string; patch: Partial<Task> }[] = [{ id, patch: {
    soft, hard, done: false, completed: null, completions: (t.completions || 0) + 1,
    stage: t.stage ? (t.parent || t.stage === ds ? first : t.stage) : null,
    counter: t.counter ? { ...t.counter, done: 0 } : null,
    blocks: t.blocks.filter(b => b.start.slice(0, 10) >= today()),
    horizon: !t.parent && t.horizon === 'done' ? 'now' : t.horizon,
  } }];
  for (const d of descendantsOf(st().tasks, id)) {
    patches.push({ id: d.id, patch: { done: false, completed: null, stage: d.stage ? first : null, counter: d.counter ? { ...d.counter, done: 0 } : null } });
  }
  store.updateMany(patches, `Recur: ${t.title} → ${hard ?? soft}`);
}

function st() { return store.state; }
function cat(t: Task) { return effectiveCategory(st().tasks, st().config, t); }

export interface Slot { prev?: Task; next?: Task }
function orderFor(slot?: Slot): number | undefined {
  if (!slot) return undefined;
  return orderBetween(slot.prev?.order, slot.next?.order);
}
function lastOrder(tasks: Tasks, parent: string | null): number {
  const kids = childrenOf(tasks, parent);
  return kids.length ? kids[kids.length - 1].order + 1000 : 1000;
}

/** Drag a root card into a horizon column. */
export function moveToHorizon(id: string, horizon: Horizon, slot?: Slot) {
  const t = st().tasks[id]; if (!t) return;
  const c = cat(t); const ds = doneStageOf(c);
  if (horizon === 'done' && t.repeat) { rollForward(id); return; }
  const patch: Partial<Task> = { horizon };
  const o = orderFor(slot); if (o !== undefined) patch.order = o;
  if (horizon === 'done') {
    if (ds) patch.stage = ds;
    patch.done = true; patch.completed = t.completed ?? nowIso();
  } else if (t.horizon === 'done' || t.done) {
    patch.done = false; patch.completed = null;
    if (c && ds && t.stage === ds) patch.stage = c.stages[Math.max(0, c.stages.length - 2)]?.id ?? c.stages[0].id;
  }
  store.updateTask(id, patch, `Move to ${horizon}: ${t.title}`);
}

/** Drag a card into a pipeline stage column (roots and pipeline-tracked subtasks). */
export function moveToStage(id: string, stageId: string, slot?: Slot) {
  const t = st().tasks[id]; if (!t) return;
  const c = cat(t); const ds = doneStageOf(c);
  if (stageId === ds && t.repeat) { rollForward(id); return; }
  const patch: Partial<Task> = { stage: stageId };
  const o = orderFor(slot); if (o !== undefined) patch.order = o;
  if (!t.parent) {
    if (stageId === ds) { patch.horizon = 'done'; patch.done = true; patch.completed = t.completed ?? nowIso(); }
    else if (t.horizon === 'done') { patch.horizon = 'now'; patch.done = false; patch.completed = null; }
  } else {
    patch.done = stageId === ds;
    patch.completed = stageId === ds ? (t.completed ?? nowIso()) : null;
  }
  store.updateTask(id, patch, `Stage ${stageId}: ${t.title}`);
}

export function setDone(id: string, done: boolean) {
  const t = st().tasks[id]; if (!t) return;
  if (done && t.repeat) { rollForward(id); return; }
  const c = cat(t); const ds = doneStageOf(c);
  if (!t.parent) { moveToHorizon(id, done ? 'done' : 'now'); return; }
  if (t.stage && c && ds) { moveToStage(id, done ? ds : c.stages[0].id); return; }
  store.updateTask(id, { done, completed: done ? nowIso() : null }, `${done ? 'Complete' : 'Reopen'}: ${t.title}`);
}

export function reorderWithin(id: string, slot: Slot) {
  const o = orderFor(slot); if (o === undefined) return;
  const t = st().tasks[id]; if (!t) return;
  store.updateTask(id, { order: o }, `Reorder: ${t.title}`);
}

export function createRoot(title: string, category: string | null, horizon: Horizon = 'back-pocket', extra: Partial<Task> = {}): Task {
  const c = st().config.categories.find(x => x.id === category);
  return store.createTask({
    title, category, horizon, stage: c?.stages[0]?.id ?? null,
    order: lastOrder(st().tasks, null), ...extra,
  });
}

export function createChild(parentId: string, title: string, opts: { pipeline?: boolean; counter?: number } = {}): Task {
  const parent = st().tasks[parentId];
  const c = parent ? cat(parent) : null;
  return store.createTask({
    title, parent: parentId, order: lastOrder(st().tasks, parentId),
    stage: opts.pipeline && c ? c.stages[0].id : null,
    counter: opts.counter ? { done: 0, target: opts.counter } : null,
  });
}

export function stampTemplate(parentId: string, tpl: Template, titleOverride?: string) {
  const created: Task[] = [];
  const walk = (nodes: TemplateNode[], pid: string, isTop: boolean) => {
    const parent = st().tasks[pid];
    const c = parent ? cat(parent) : null;
    let order = lastOrder(st().tasks, pid);
    for (const n of nodes) {
      const title = isTop && titleOverride && nodes.length === 1 ? titleOverride : n.title;
      const t = store.createTask({
        title, parent: pid, order, stage: n.pipeline && c ? c.stages[0].id : null,
        counter: n.counter ? { done: 0, target: n.counter } : null,
      });
      order += 1000;
      created.push(t);
      if (n.children?.length) walk(n.children, t.id, false);
    }
  };
  walk(tpl.children, parentId, true);
  return created;
}

/** Change a root's category; remap the stage into the new pipeline by position. */
export function setCategory(id: string, categoryId: string | null) {
  const t = st().tasks[id]; if (!t) return;
  const old = cat(t);
  const next = st().config.categories.find(c => c.id === categoryId) ?? null;
  let stage: string | null = null;
  if (next) {
    const idx = old ? old.stages.findIndex(s => s.id === t.stage) : -1;
    stage = next.stages[Math.max(0, Math.min(idx, next.stages.length - 1))]?.id ?? null;
    if (t.horizon === 'done') stage = doneStageOf(next);
  }
  const patches = [{ id, patch: { category: categoryId, stage } as Partial<Task> }];
  // pipeline-tracked descendants get remapped too
  for (const d of descendantsOf(st().tasks, id)) {
    if (!d.stage) continue;
    const idx = old ? old.stages.findIndex(s => s.id === d.stage) : -1;
    const s = next ? (next.stages[Math.max(0, Math.min(idx, next.stages.length - 1))]?.id ?? null) : null;
    patches.push({ id: d.id, patch: { stage: s } });
  }
  store.updateMany(patches, `Category ${categoryId ?? 'none'}: ${t.title}`);
}
function descendantsOf(tasks: Tasks, id: string): Task[] {
  const out: Task[] = [];
  const walk = (pid: string) => { for (const c of childrenOf(tasks, pid)) { out.push(c); walk(c.id); } };
  walk(id); return out;
}

/** Re-parent a node (indent / outdent / move into another task). */
export function reparent(id: string, newParent: string | null, slot?: Slot) {
  const t = st().tasks[id]; if (!t) return;
  if (newParent === id) return;
  if (newParent && descendantsOf(st().tasks, id).some(d => d.id === newParent)) return;   // no cycles
  const patch: Partial<Task> = { parent: newParent, order: orderFor(slot) ?? lastOrder(st().tasks, newParent) };
  if (newParent) {
    // becoming a child: inherit category from the new root
    const root = rootOf(st().tasks, st().tasks[newParent]);
    patch.category = null;
    if (!t.parent && t.category && t.category !== root.category) patch.stage = null;
  } else {
    // becoming a root: take the old root's category and a sensible horizon
    const root = rootOf(st().tasks, t);
    patch.category = t.category ?? root.category;
    patch.horizon = root.horizon === 'done' ? 'now' : root.horizon;
  }
  store.updateTask(id, patch, `Move: ${t.title}`);
}

export function addBlock(id: string, start: string, end: string) {
  const t = st().tasks[id]; if (!t) return;
  store.updateTask(id, { blocks: [...t.blocks, { id: newId(), start, end }] }, `Schedule: ${t.title}`);
}
export function updateBlock(id: string, blockId: string, patch: { start?: string; end?: string }) {
  const t = st().tasks[id]; if (!t) return;
  store.updateTask(id, { blocks: t.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) }, `Reschedule: ${t.title}`);
}
export function removeBlock(id: string, blockId: string) {
  const t = st().tasks[id]; if (!t) return;
  store.updateTask(id, { blocks: t.blocks.filter(b => b.id !== blockId) }, `Unschedule: ${t.title}`);
}

export function bumpCounter(id: string, delta: number) {
  const t = st().tasks[id]; if (!t || !t.counter) return;
  const done = Math.max(0, Math.min(t.counter.target || Infinity, t.counter.done + delta));
  store.updateTask(id, { counter: { ...t.counter, done } }, `Counter ${done}/${t.counter.target}: ${t.title}`);
}
