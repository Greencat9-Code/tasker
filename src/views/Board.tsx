import React, { useMemo, useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, closestCorners } from '@dnd-kit/core';
import { useStore } from '../lib/store';
import { Category, HORIZONS, Horizon, Task } from '../lib/model';
import { Tasks, categoryById, childrenOf, countLeaves, isDone, progressOf, roots, stageBreakdown, stageColor } from '../lib/rollup';
import { moveToHorizon, moveToStage, reorderWithin, Slot } from '../lib/actions';
import { openTask } from '../lib/nav';
import { CatBadge, DatePills, ProgressBar, StageBar } from '../components/ui';

interface Column { id: string; name: string; color?: string; hint?: string }

const HZ_KEY = 'tasker.board.horizons';

export default function Board({ categoryId }: { categoryId: string }) {
  const { config, tasks } = useStore();
  const cat = categoryId === 'all' ? null : categoryById(config, categoryId);
  const mode: 'horizon' | 'stage' = cat ? 'stage' : 'horizon';
  const [hzFilter, setHzFilter] = useState<Horizon[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(HZ_KEY) || 'null'); if (Array.isArray(v)) return v; } catch { /* ignore */ }
    return ['back-pocket', 'on-deck', 'now', 'done'];
  });
  const toggleHz = (h: Horizon) => setHzFilter(f => { const n = f.includes(h) ? f.filter(x => x !== h) : [...f, h]; localStorage.setItem(HZ_KEY, JSON.stringify(n)); return n; });
  const [active, setActive] = useState<Task | null>(null);

  const columns: Column[] = useMemo(() => {
    if (cat) return cat.stages.map((s, i) => ({ id: s.id, name: s.name, color: s.color ?? stageColor(cat.color, i, cat.stages.length) }));
    return HORIZONS.map(h => ({ id: h.id, name: h.name, hint: h.hint }));
  }, [cat]);

  const cards: Record<string, Task[]> = useMemo(() => {
    const out: Record<string, Task[]> = {};
    for (const c of columns) out[c.id] = [];
    const all = roots(tasks);
    for (const t of all) {
      if (cat) {
        if (t.category !== cat.id) continue;
        if (!hzFilter.includes(t.horizon)) continue;
        const col = t.stage && out[t.stage] ? t.stage : cat.stages[0]?.id;
        if (col) out[col].push(t);
      } else {
        out[t.horizon]?.push(t);
      }
    }
    return out;
  }, [columns, tasks, cat, hzFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const onDragStart = (e: DragStartEvent) => { setActive(tasks[String(e.active.id).replace('card:', '')] ?? null); };
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const id = String(e.active.id).replace('card:', '');
    const t = tasks[id]; if (!t || !e.over) return;
    const overId = String(e.over.id);
    let colId: string; let index: number;
    if (overId.startsWith('col:')) { colId = overId.slice(4); index = cards[colId].length; }
    else {
      const overTaskId = overId.replace('card:', '');
      colId = (e.over.data.current as any)?.colId;
      const list = cards[colId];
      index = list.findIndex(x => x.id === overTaskId);
      const pointerY = ((e.activatorEvent as any)?.clientY ?? 0) + e.delta.y;
      const rect = e.over.rect;
      if (pointerY > rect.top + rect.height / 2) index += 1;
    }
    const list = cards[colId].filter(x => x.id !== id);
    const fromCol = mode === 'stage' ? (t.stage && cards[t.stage] ? t.stage : columns[0].id) : t.horizon;
    if (fromCol === colId) {
      const curIdx = cards[colId].findIndex(x => x.id === id);
      if (curIdx >= 0 && curIdx < index) index -= 1;
    }
    const slot: Slot = { prev: list[index - 1], next: list[index] };
    if (colId === fromCol) { reorderWithin(id, slot); return; }
    if (mode === 'stage') moveToStage(id, colId, slot); else moveToHorizon(id, colId as Horizon, slot);
  };

  return (
    <div className="board">
      <div className="board-head">
        <div className="chips">
          <a className={`chip ${!cat ? 'active' : ''}`} href="#/board/all">All · Horizons</a>
          {config.categories.map(c => (
            <a key={c.id} className={`chip ${cat?.id === c.id ? 'active' : ''}`} href={`#/board/${c.id}`}><i style={{ background: c.color }} />{c.name}</a>
          ))}
        </div>
        {cat && (
          <div className="chips" style={{ marginLeft: 'auto' }}>
            {HORIZONS.map(h => <button key={h.id} className={`chip ${hzFilter.includes(h.id) ? 'active' : ''}`} onClick={() => toggleHz(h.id)}>{h.name}</button>)}
          </div>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="columns">
          {columns.map(col => (
            <ColumnView key={col.id} col={col} mode={mode} cat={cat} list={cards[col.id]} tasks={tasks} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? <CardView task={active} mode={mode} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function ColumnView({ col, mode, cat, list, tasks }: { col: Column; mode: 'horizon' | 'stage'; cat: Category | null; list: Task[]; tasks: Tasks }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  void tasks; void cat;
  return (
    <div className={`column ${isOver ? 'over' : ''}`} ref={setNodeRef}>
      <div className="column-head" title={col.hint}>
        {col.color && <i className="dot" style={{ background: col.color }} />}
        {col.name} <span className="count">{list.length}</span>
      </div>
      <div className="column-body">
        {list.map(t => <DraggableCard key={t.id} task={t} colId={col.id} mode={mode} />)}
        {!list.length && <div className="muted small" style={{ padding: '8px 6px' }}>{col.hint ?? 'Drop here'}</div>}
      </div>
    </div>
  );
}

function DraggableCard({ task, colId, mode }: { task: Task; colId: string; mode: 'horizon' | 'stage' }) {
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({ id: `card:${task.id}`, data: { colId } });
  const { setNodeRef: setDrop } = useDroppable({ id: `card:${task.id}`, data: { colId } });
  const ref = (el: HTMLElement | null) => { setDrag(el); setDrop(el); };
  return (
    <div ref={ref} {...listeners} {...attributes} className={isDragging ? 'dragging' : ''} onClick={() => openTask(task.id)}>
      <CardView task={task} mode={mode} />
    </div>
  );
}

export function CardView({ task, mode, overlay }: { task: Task; mode: 'horizon' | 'stage'; overlay?: boolean }) {
  const { config, tasks } = useStore();
  const cat = categoryById(config, task.category);
  const kids = childrenOf(tasks, task.id);
  const done = isDone(tasks, config, task);
  const prog = kids.length ? progressOf(tasks, config, task) : null;
  const leaves = kids.length ? countLeaves(tasks, config, task) : null;
  const breakdown = kids.length ? stageBreakdown(tasks, config, task) : [];
  const stage = cat?.stages.find(s => s.id === task.stage);
  const hz = HORIZONS.find(h => h.id === task.horizon);
  return (
    <div className={`card ${overlay ? 'overlay' : ''} ${task.horizon === 'back-pocket' && mode === 'stage' ? 'dim' : ''}`}>
      <div className="stripe" style={{ background: cat?.color ?? 'var(--muted)' }} />
      <div className="card-title" style={done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{task.title}</div>
      <div className="card-meta">
        {mode === 'horizon' && <CatBadge cat={cat} small />}
        {mode === 'horizon' && stage && <span className="pill">{stage.name}</span>}
        {mode === 'stage' && hz && task.horizon !== 'now' && <span className="pill horizon">{hz.name}</span>}
        <DatePills task={task} done={done} />
        {task.counter && <span className="pill">{task.counter.done}/{task.counter.target}</span>}
        {task.repeat && <span className="pill" title={`Repeats every ${task.repeat.every} ${task.repeat.unit}(s)`}>↻{task.completions ? ` ${task.completions}` : ''}</span>}
        {leaves && <span className="pill">{leaves.total - leaves.open}/{leaves.total} ✓</span>}
      </div>
      {breakdown.length > 0 ? <div style={{ marginTop: 8 }}><StageBar parts={breakdown} /></div> : prog ? <ProgressBar pct={prog.pct} color={cat?.color} /> : null}
    </div>
  );
}
