import React, { useMemo, useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, pointerWithin } from '@dnd-kit/core';
import { store, useStore } from '../lib/store';
import { Block, CalEvent, Task } from '../lib/model';
import { effectiveCategory, isDone, rootOf } from '../lib/rollup';
import { addBlock, occurrencesBetween, updateBlock } from '../lib/actions';
import { go, openTask, useRoute } from '../lib/nav';
import { CatBadge, DatePills } from '../components/ui';
import { WEEKDAYS, addDays, addMinutes, fmtMonth, fmtTime, monthGrid, pad, parseDate, startOfWeek, toDateStr, today, fmtDate } from '../lib/dates';

type DropMode = 'block' | 'soft' | 'hard';
interface TaskItem { kind: 'hard' | 'soft' | 'block'; task: Task; block?: Block; done: boolean }
interface GhostItem { kind: 'ghost'; task: Task; ghost: 'hard' | 'soft'; date: string }
interface GcalItem { kind: 'gcal'; event: CalEvent; date: string }
type Item = TaskItem | GhostItem | GcalItem;
const GCAL_KEY = 'tasker.cal.gcal';
function sortKey(it: Item): string {
  if (it.kind === 'block') return '3' + it.block!.start;
  if (it.kind === 'gcal') return it.event.allDay ? '0' + it.event.title : '3' + it.event.start;
  if (it.kind === 'hard') return '1'; if (it.kind === 'soft') return '2'; return '4';
}
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);   // 6am .. 11pm
const HOUR_PX = 44;

export default function Calendar() {
  const { config, tasks, events } = useStore();
  const route = useRoute();
  const mode: 'month' | 'week' = route.parts[0] === 'week' ? 'week' : 'month';
  const anchor = route.parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(route.parts[1]) ? route.parts[1] : today();
  const [dropMode, setDropMode] = useState<DropMode>('block');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<{ label: string; color: string } | null>(null);
  const [showGcal, setShowGcal] = useState(() => localStorage.getItem(GCAL_KEY) !== '0');
  const toggleGcal = () => setShowGcal(v => { localStorage.setItem(GCAL_KEY, v ? '0' : '1'); return !v; });

  // visible range (for recurring previews + calendar overlay)
  const range = useMemo(() => {
    if (mode === 'week') { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 6) }; }
    const d = parseDate(anchor); const days = monthGrid(d.getFullYear(), d.getMonth()); return { from: days[0], to: days[days.length - 1] };
  }, [mode, anchor]);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const push = (d: string, it: Item) => { const l = m.get(d) ?? []; l.push(it); m.set(d, l); };
    for (const t of Object.values(tasks)) {
      const done = isDone(tasks, config, t);
      if (t.hard) push(t.hard, { kind: 'hard', task: t, done });
      if (t.soft) push(t.soft, { kind: 'soft', task: t, done });
      for (const b of t.blocks) push(b.start.slice(0, 10), { kind: 'block', task: t, block: b, done });
      if (t.repeat && !done) for (const d of occurrencesBetween(t, range.from, range.to)) push(d, { kind: 'ghost', task: t, ghost: t.hard ? 'hard' : 'soft', date: d });
    }
    if (showGcal) for (const ev of events) {
      const s = ev.start.slice(0, 10); const e = ev.allDay ? ev.end.slice(0, 10) : ev.end.slice(0, 10);
      if (e < range.from || s > range.to) continue;
      if (ev.allDay) { for (let d = s; d <= e && d <= range.to; d = addDays(d, 1)) if (d >= range.from) push(d, { kind: 'gcal', event: ev, date: d }); }
      else push(s, { kind: 'gcal', event: ev, date: s });
    }
    for (const l of m.values()) l.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return m;
  }, [tasks, config, events, showGcal, range]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Task[] = [];
    for (const t of Object.values(tasks)) {
      if (isDone(tasks, config, t)) continue;
      if (q) { if (t.title.toLowerCase().includes(q)) out.push(t); continue; }
      const root = rootOf(tasks, t);
      if (root.horizon !== 'now' && root.horizon !== 'on-deck') continue;
      if (!t.parent || t.stage) out.push(t);
    }
    return out.sort((a, b) => (a.hard ?? '9').localeCompare(b.hard ?? '9') || (a.soft ?? '9').localeCompare(b.soft ?? '9') || a.title.localeCompare(b.title)).slice(0, 80);
  }, [tasks, config, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const colorOf = (t: Task) => effectiveCategory(tasks, config, t)?.color ?? '#8b95a5';

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id); const parts = id.split(':');
    const t = tasks[parts[1]]; if (!t) return;
    setActive({ label: t.title, color: colorOf(t) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    if (!e.over) return;
    const [aKind, taskId, blockId] = String(e.active.id).split(':');
    const over = String(e.over.id);
    const t = tasks[taskId]; if (!t) return;
    let date: string; let hour: number | null = null;
    if (over.startsWith('day:') || over.startsWith('allday:')) date = over.split(':')[1];
    else if (over.startsWith('slot:')) { const s = over.slice(5); date = s.slice(0, 10); hour = Number(s.slice(11, 13)); }
    else return;
    if (aKind === 'task') {
      const m: DropMode = hour !== null ? 'block' : (over.startsWith('allday:') && dropMode === 'block' ? 'soft' : dropMode);
      if (m === 'block') { const start = `${date}T${pad(hour ?? 10)}:00`; addBlock(t.id, start, addMinutes(start, 60)); }
      else store.updateTask(t.id, { [m]: date } as Partial<Task>, `${m} date: ${t.title}`);
    } else if (aKind === 'hard' || aKind === 'soft') {
      store.updateTask(t.id, { [aKind]: date } as Partial<Task>, `${aKind} date: ${t.title}`);
    } else if (aKind === 'block') {
      const b = t.blocks.find(x => x.id === blockId); if (!b) return;
      const mins = Math.round((parseDate(b.end).getTime() - parseDate(b.start).getTime()) / 60000);
      const time = hour !== null ? `${pad(hour)}:00` : b.start.slice(11, 16);
      const start = `${date}T${time}`;
      updateBlock(t.id, b.id, { start, end: addMinutes(start, mins) });
    }
  };

  const shift = (n: number) => {
    if (mode === 'week') go('calendar', ['week', addDays(anchor, 7 * n)]);
    else { const d = parseDate(anchor); d.setDate(1); d.setMonth(d.getMonth() + n); go('calendar', ['month', toDateStr(d)]); }
  };
  const d = parseDate(anchor);
  const title = mode === 'month' ? fmtMonth(d.getFullYear(), d.getMonth()) : `Week of ${fmtDate(startOfWeek(anchor), true)}`;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="cal">
        <div className="cal-main">
          <div className="cal-head">
            <button className="btn small" onClick={() => shift(-1)}>‹</button>
            <button className="btn small" onClick={() => go('calendar', [mode, today()])}>Today</button>
            <button className="btn small" onClick={() => shift(1)}>›</button>
            <h2>{title}</h2>
            <div className="spacer" />
            <div className="chips">
              <a className={`chip ${mode === 'month' ? 'active' : ''}`} href={`#/calendar/month/${anchor}`}>Month</a>
              <a className={`chip ${mode === 'week' ? 'active' : ''}`} href={`#/calendar/week/${anchor}`}>Week</a>
              {events.length > 0 && <button className={`chip ${showGcal ? 'active' : ''}`} onClick={toggleGcal} title="Google Calendar overlay (read-only)">📅 Google</button>}
            </div>
          </div>
          {mode === 'month' ? <MonthView anchor={anchor} byDay={byDay} colorOf={colorOf} /> : <WeekView anchor={anchor} byDay={byDay} colorOf={colorOf} />}
        </div>
        <aside className="cal-side">
          <div className="side-head">
            <div className="flex gap"><h3 style={{ flex: 1 }}>Drag onto calendar</h3></div>
            <div className="flex gap">
              <span className="small muted">Drop sets</span>
              <select value={dropMode} onChange={e => setDropMode(e.target.value as DropMode)} style={{ flex: 1 }}>
                <option value="block">a work block (1h)</option>
                <option value="soft">the soft target</option>
                <option value="hard">the hard deadline</option>
              </select>
            </div>
            <input placeholder="Search all tasks…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="side-list">
            {candidates.map(t => <SideItem key={t.id} task={t} />)}
            {!candidates.length && <div className="muted small" style={{ padding: 8 }}>Nothing in Now / On Deck. Search to find anything.</div>}
          </div>
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <div className="side-item" style={{ borderLeft: `3px solid ${active.color}`, boxShadow: '0 10px 30px rgba(0,0,0,.6)', maxWidth: 240 }}>{active.label}</div>}
      </DragOverlay>
    </DndContext>
  );
}

function SideItem({ task }: { task: Task }) {
  const { config, tasks } = useStore();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` });
  const cat = effectiveCategory(tasks, config, task);
  const root = rootOf(tasks, task);
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="side-item" style={{ opacity: isDragging ? .4 : 1, borderLeft: `3px solid ${cat?.color ?? 'var(--muted)'}` }} onClick={() => openTask(task.id)}>
      <div>{task.title}</div>
      <div className="card-meta">
        {root.id !== task.id && <span className="pill">{root.title}</span>}
        <DatePills task={task} />
      </div>
    </div>
  );
}

function Chip({ item, colorOf }: { item: Item; colorOf: (t: Task) => string }) {
  if (item.kind === 'ghost') {
    return <div className={`cal-chip ghost ${item.ghost}`} title={`Next occurrence of ${item.task.title} (repeats)`} onClick={() => openTask(item.task.id)}>↻ {item.task.title}</div>;
  }
  if (item.kind === 'gcal') {
    const ev = item.event;
    return <div className="cal-chip gcal" style={{ borderLeftColor: ev.color }} title={`${ev.cal}: ${ev.title}${ev.location ? ' @ ' + ev.location : ''}`}>{ev.allDay ? '' : fmtTime(ev.start) + ' '}{ev.title}</div>;
  }
  return <DragChip item={item} colorOf={colorOf} />;
}

function DragChip({ item, colorOf }: { item: TaskItem; colorOf: (t: Task) => string }) {
  const id = item.kind === 'block' ? `block:${item.task.id}:${item.block!.id}` : `${item.kind}:${item.task.id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  const label = item.kind === 'block' ? `${fmtTime(item.block!.start)} ${item.task.title}` : item.task.title;
  const icon = item.kind === 'hard' ? '⚑ ' : item.kind === 'soft' ? '◔ ' : '';
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`cal-chip ${item.kind} ${item.done ? 'done' : ''}`}
      style={{ opacity: isDragging ? .4 : 1, borderLeftColor: item.kind === 'block' ? colorOf(item.task) : undefined }}
      title={`${item.kind === 'hard' ? 'Hard deadline' : item.kind === 'soft' ? 'Soft target' : 'Work block'}: ${item.task.title}`}
      onClick={() => openTask(item.task.id)}>
      {icon}{label}
    </div>
  );
}

function MonthView({ anchor, byDay, colorOf }: { anchor: string; byDay: Map<string, Item[]>; colorOf: (t: Task) => string }) {
  const d = parseDate(anchor);
  const days = monthGrid(d.getFullYear(), d.getMonth());
  const t = today();
  return (
    <>
      <div className="cal-dow">{WEEKDAYS.map(w => <div key={w}>{w}</div>)}</div>
      <div className="cal-grid">
        {days.map(day => <DayCell key={day} day={day} other={parseDate(day).getMonth() !== d.getMonth()} isToday={day === t} items={byDay.get(day) ?? []} colorOf={colorOf} />)}
      </div>
    </>
  );
}

function DayCell({ day, other, isToday, items, colorOf }: { day: string; other: boolean; isToday: boolean; items: Item[]; colorOf: (t: Task) => string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 4);
  return (
    <div ref={setNodeRef} className={`cal-day ${other ? 'other' : ''} ${isToday ? 'today' : ''} ${isOver ? 'over' : ''}`}>
      <div className="cal-daynum"><b>{parseDate(day).getDate()}</b><a className="tiny" href={`#/calendar/week/${day}`} title="Open week">wk</a></div>
      {shown.map((it, i) => <Chip key={i} item={it} colorOf={colorOf} />)}
      {items.length > 4 && !expanded && <span className="cal-more" onClick={() => setExpanded(true)}>+{items.length - 4} more</span>}
    </div>
  );
}

function WeekView({ anchor, byDay, colorOf }: { anchor: string; byDay: Map<string, Item[]>; colorOf: (t: Task) => string }) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const t = today();
  return (
    <div className="week">
      <div className="week-head" />
      {days.map(day => <div key={day} className={`week-head ${day === t ? 'today' : ''}`}>{WEEKDAYS[(parseDate(day).getDay() + 6) % 7]} {parseDate(day).getDate()}</div>)}
      <div className="week-allday" />
      {days.map(day => <AllDay key={day} day={day} items={(byDay.get(day) ?? []).filter(i => i.kind !== 'block' && !(i.kind === 'gcal' && !i.event.allDay))} colorOf={colorOf} />)}
      <div>{HOURS.map(h => <div key={h} className="week-time">{h % 12 === 0 ? 12 : h % 12}{h >= 12 ? 'p' : 'a'}</div>)}</div>
      {days.map(day => <DayColumn key={day} day={day} items={(byDay.get(day) ?? []).filter(i => i.kind === 'block' || (i.kind === 'gcal' && !i.event.allDay))} colorOf={colorOf} />)}
    </div>
  );
}

function AllDay({ day, items, colorOf }: { day: string; items: Item[]; colorOf: (t: Task) => string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday:${day}` });
  return <div ref={setNodeRef} className={`week-allday ${isOver ? 'over' : ''}`} style={isOver ? { background: 'rgba(79,140,255,.15)' } : undefined}>{items.map((it, i) => <Chip key={i} item={it} colorOf={colorOf} />)}</div>;
}

function DayColumn({ day, items, colorOf }: { day: string; items: Item[]; colorOf: (t: Task) => string }) {
  return (
    <div className="week-col" style={{ height: HOURS.length * HOUR_PX }}>
      {HOURS.map(h => <Slot key={h} id={`slot:${day}T${pad(h)}:00`} />)}
      {items.map((it, i) => it.kind === 'gcal' ? <GcalBlock key={i} event={it.event} /> : it.kind === 'block' ? <WeekBlock key={i} item={it} color={colorOf(it.task)} /> : null)}
    </div>
  );
}
function GcalBlock({ event }: { event: CalEvent }) {
  const s = parseDate(event.start); const e = parseDate(event.end);
  const top = ((s.getHours() + s.getMinutes() / 60) - HOURS[0]) * HOUR_PX;
  const height = Math.max(18, ((e.getTime() - s.getTime()) / 3600000) * HOUR_PX - 2);
  return (
    <div className="week-block gcal" style={{ top, height, borderColor: event.color, color: event.color }} title={`${event.cal}: ${event.title}${event.location ? ' @ ' + event.location : ''}`}>
      <b>{fmtTime(event.start)}</b> {event.title}
    </div>
  );
}
function Slot({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`week-hour ${isOver ? 'over' : ''}`} />;
}
function WeekBlock({ item, color }: { item: TaskItem; color: string }) {
  const b = item.block!;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `block:${item.task.id}:${b.id}` });
  const s = parseDate(b.start); const e = parseDate(b.end);
  const top = ((s.getHours() + s.getMinutes() / 60) - HOURS[0]) * HOUR_PX;
  const height = Math.max(22, ((e.getTime() - s.getTime()) / 3600000) * HOUR_PX - 2);
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="week-block" onClick={() => openTask(item.task.id)}
      style={{ top, height, background: color, opacity: isDragging ? .4 : (item.done ? .5 : .9) }} title={item.task.title}>
      <b>{fmtTime(b.start)}</b> {item.task.title}
    </div>
  );
}
