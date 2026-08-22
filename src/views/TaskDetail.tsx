import React, { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { store, useStore } from '../lib/store';
import { HORIZONS, Horizon, Repeat, RepeatUnit, Task, Template, doneStageOf } from '../lib/model';
import { ancestors, childrenOf, countLeaves, effectiveCategory, hasChildren, isDone, progressOf, stageBreakdown } from '../lib/rollup';
import { addBlock, bumpCounter, createChild, moveToHorizon, moveToStage, nextOccurrenceDates, removeBlock, reorderWithin, reparent, setCategory, setDone, stampTemplate, updateBlock } from '../lib/actions';
import { openTask } from '../lib/nav';
import { CatBadge, DatePills, Menu, ProgressBar, StageBar } from '../components/ui';
import { addMinutes, fmtDate, fmtTime, today } from '../lib/dates';

export default function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { config, tasks } = useStore();
  const t = tasks[id];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!t) return null;
  const cat = effectiveCategory(tasks, config, t);
  const isRoot = !t.parent;
  const crumbs = ancestors(tasks, t);
  const kids = childrenOf(tasks, t.id);
  const done = isDone(tasks, config, t);
  const prog = kids.length ? progressOf(tasks, config, t) : null;
  const leaves = kids.length ? countLeaves(tasks, config, t) : null;
  const breakdown = kids.length ? stageBreakdown(tasks, config, t) : [];
  const templates = config.templates;
  const defaultTpl = templates.find(x => x.id === t.template) ?? null;

  const toggleCollapse = (cid: string) => setCollapsed(s => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  const addFromTemplate = (tpl: Template) => {
    let name: string | undefined;
    if (tpl.children.length === 1) {
      const v = window.prompt(`Name for the new "${tpl.children[0].title}"`, tpl.children[0].title);
      if (v === null) return; name = v.trim() || undefined;
    }
    stampTemplate(t.id, tpl, name);
  };

  const del = () => {
    const n = kids.length ? ` and its ${countLeaves(tasks, config, t).total} sub-items` : '';
    if (!window.confirm(`Delete "${t.title}"${n}? This removes the file from the repo (git history keeps it).`)) return;
    const parent = t.parent;
    store.deleteTask(t.id);
    if (parent) openTask(parent); else onClose();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div className="crumbs">
            <CatBadge cat={cat} small />
            {crumbs.map(a => <React.Fragment key={a.id}><span>›</span><a onClick={() => openTask(a.id)}>{a.title}</a></React.Fragment>)}
          </div>
          <div className="spacer" />
          <Menu items={[
            ...(t.parent ? [{ label: 'Make top-level task', onClick: () => reparent(t.id, null) }] : []),
            { label: t.stage ? 'Stop tracking in pipeline' : 'Track in pipeline', onClick: () => store.updateTask(t.id, { stage: t.stage ? null : (cat?.stages[0]?.id ?? null) }), disabled: isRoot },
            ...(t.repeat ? [{ label: 'Complete for good (stop repeating)', onClick: () => { store.updateTask(t.id, { repeat: null }); setTimeout(() => setDone(t.id, true), 0); } }] : []),
            { label: 'Copy repo path', onClick: () => navigator.clipboard?.writeText(t.path) },
            { label: 'Delete', onClick: del, danger: true },
          ]} />
          <button className="iconbtn" onClick={onClose} aria-label="close" style={{ fontSize: 18 }}>✕</button>
        </div>
        <div className="drawer-body">
          <TitleField task={t} />

          <div className="grid3">
            {isRoot && (
              <div className="field"><label>Category</label>
                <select value={t.category ?? ''} onChange={e => setCategory(t.id, e.target.value || null)}>
                  <option value="">Inbox</option>
                  {config.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {cat && (isRoot || t.stage) && (
              <div className="field"><label>Stage</label>
                <select value={t.stage ?? ''} onChange={e => moveToStage(t.id, e.target.value)}>
                  {cat.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {isRoot ? (
              <div className="field"><label>Horizon</label>
                <select value={t.horizon} onChange={e => moveToHorizon(t.id, e.target.value as Horizon)}>
                  {HORIZONS.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="field"><label>Status</label>
                <label className="flex gap" style={{ height: 34 }}><input type="checkbox" checked={done} onChange={e => setDone(t.id, e.target.checked)} /> {done ? 'Done' : 'Open'}</label>
              </div>
            )}
          </div>

          <div className="grid2">
            <div className="field"><label>Soft target</label>
              <input type="date" value={t.soft ?? ''} onChange={e => store.updateTask(t.id, { soft: e.target.value || null })} />
            </div>
            <div className="field"><label>Hard deadline</label>
              <input type="date" value={t.hard ?? ''} onChange={e => store.updateTask(t.id, { hard: e.target.value || null })} />
            </div>
          </div>
          <div className="flex gap wrap"><DatePills task={t} done={done} />{t.repeat && <span className="pill" title="Recurring">↻ every {t.repeat.every > 1 ? `${t.repeat.every} ${t.repeat.unit}s` : t.repeat.unit}{t.completions ? ` · done ${t.completions}×` : ''}</span>}</div>
          <RepeatField task={t} />

          {(prog || breakdown.length > 0) && (
            <div className="col" style={{ gap: 8 }}>
              <div className="flex gap"><h3>Progress</h3><span className="muted small">{leaves ? `${leaves.total - leaves.open} of ${leaves.total} done` : ''} · {Math.round((prog?.pct ?? 0) * 100)}%</span></div>
              <ProgressBar pct={prog?.pct ?? 0} color={cat?.color} />
              {breakdown.length > 0 && <StageBar parts={breakdown} legend />}
            </div>
          )}

          <CounterField task={t} />

          <div className="col" style={{ gap: 4 }}>
            <div className="section-head"><h3>Subtasks</h3>
              <select className="btn small" value={t.template ?? ''} onChange={e => store.updateTask(t.id, { template: e.target.value || null })} title="Default template for this task">
                <option value="">No default template</option>
                {templates.map(x => <option key={x.id} value={x.id}>Template: {x.name}</option>)}
              </select>
            </div>
            <div className="subtree">
              {kids.map(k => <Row key={k.id} task={k} depth={0} collapsed={collapsed} toggle={toggleCollapse} />)}
              {!kids.length && <div className="muted small" style={{ padding: '4px 0' }}>No subtasks yet.</div>}
            </div>
            <AddRow parentId={t.id} defaultTpl={defaultTpl} templates={templates} onTemplate={addFromTemplate} />
          </div>

          <BlocksField task={t} />
          <LinksField task={t} />
          <TagsField task={t} />
          <NotesField task={t} />

          <div className="muted tiny">Created {fmtDate(t.created.slice(0, 10), true)} · updated {new Date(t.updated).toLocaleString()} · <code className="k">{t.path}</code></div>
        </div>
      </div>
    </>
  );
}

function TitleField({ task }: { task: Task }) {
  const [v, setV] = useState(task.title);
  useEffect(() => setV(task.title), [task.id, task.title]);
  const commit = () => { const n = v.trim(); if (n && n !== task.title) store.updateTask(task.id, { title: n }, `Rename: ${n}`); else setV(task.title); };
  return <input className="title-input" value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function Row({ task, depth, collapsed, toggle }: { task: Task; depth: number; collapsed: Set<string>; toggle: (id: string) => void }) {
  const { config, tasks } = useStore();
  const cat = effectiveCategory(tasks, config, task);
  const kids = childrenOf(tasks, task.id);
  const siblings = childrenOf(tasks, task.parent);
  const idx = siblings.findIndex(s => s.id === task.id);
  const done = isDone(tasks, config, task);
  const prog = kids.length ? progressOf(tasks, config, task) : null;
  const isCollapsed = collapsed.has(task.id);
  const ds = doneStageOf(cat);
  const items = [
    { label: 'Open', onClick: () => openTask(task.id) },
    { label: 'Rename', onClick: () => { const v = window.prompt('Rename', task.title); if (v && v.trim()) store.updateTask(task.id, { title: v.trim() }); } },
    { label: 'Add subtask', onClick: () => { const v = window.prompt('Subtask title'); if (v && v.trim()) { createChild(task.id, v.trim()); } } },
    { label: task.stage ? 'Stop tracking in pipeline' : 'Track in pipeline', onClick: () => store.updateTask(task.id, { stage: task.stage ? null : (cat?.stages[0]?.id ?? null), done: task.stage ? task.stage === ds : false }) },
    { label: task.counter ? 'Remove counter' : 'Add counter (x of N)', onClick: () => { if (task.counter) store.updateTask(task.id, { counter: null }); else { const v = Number(window.prompt('Target count', '10')); if (v > 0) store.updateTask(task.id, { counter: { done: 0, target: v } }); } } },
    { label: 'Move up', onClick: () => reorderWithin(task.id, { prev: siblings[idx - 2], next: siblings[idx - 1] }), disabled: idx <= 0 },
    { label: 'Move down', onClick: () => reorderWithin(task.id, { prev: siblings[idx + 1], next: siblings[idx + 2] }), disabled: idx >= siblings.length - 1 },
    { label: 'Indent (nest under previous)', onClick: () => reparent(task.id, siblings[idx - 1].id), disabled: idx <= 0 },
    { label: 'Outdent', onClick: () => { const p = tasks[task.parent!]; const gs = childrenOf(tasks, p.parent); const pi = gs.findIndex(s => s.id === p.id); reparent(task.id, p.parent, { prev: gs[pi], next: gs[pi + 1] }); }, disabled: depth === 0 },
    { label: 'Delete', onClick: () => { if (window.confirm(`Delete "${task.title}"?`)) store.deleteTask(task.id); }, danger: true },
  ];
  return (
    <>
      <div className={`subrow ${done ? 'done' : ''}`} style={{ paddingLeft: 4 + depth * 18 }}>
        <span className="chev" onClick={() => kids.length && toggle(task.id)}>{kids.length ? (isCollapsed ? '▶' : '▼') : ''}</span>
        <input type="checkbox" checked={done} onChange={e => setDone(task.id, e.target.checked)} />
        <span className="t" onClick={() => openTask(task.id)} title={task.title}>{task.title}</span>
        {task.counter && <button className="pill" onClick={() => bumpCounter(task.id, 1)} title="+1">{task.counter.done}/{task.counter.target}</button>}
        <DatePills task={task} done={done} />
        {prog && <span className="mini-progress" title={`${Math.round(prog.pct * 100)}%`}><ProgressBar pct={prog.pct} color={cat?.color} /></span>}
        {task.stage && cat && (
          <select className="mini" value={task.stage} onChange={e => moveToStage(task.id, e.target.value)}>
            {cat.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <Menu items={items} />
      </div>
      {!isCollapsed && kids.map(k => <Row key={k.id} task={k} depth={depth + 1} collapsed={collapsed} toggle={toggle} />)}
    </>
  );
}

function AddRow({ parentId, defaultTpl, templates, onTemplate }: { parentId: string; defaultTpl: Template | null; templates: Template[]; onTemplate: (t: Template) => void }) {
  const [v, setV] = useState('');
  const [pipeline, setPipeline] = useState(false);
  const submit = () => { if (!v.trim()) return; createChild(parentId, v.trim(), { pipeline }); setV(''); };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="addrow">
        <input placeholder="Add subtask…" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        <label className="flex gap small muted" title="Give this subtask its own pipeline stage"><input type="checkbox" checked={pipeline} onChange={e => setPipeline(e.target.checked)} />stage</label>
        <button className="btn" onClick={submit} disabled={!v.trim()}>Add</button>
      </div>
      <div className="flex gap wrap">
        {defaultTpl && <button className="btn small primary" onClick={() => onTemplate(defaultTpl)}>+ {defaultTpl.name}</button>}
        {templates.length > 0 && (
          <select className="btn small" value="" onChange={e => { const tpl = templates.find(x => x.id === e.target.value); if (tpl) onTemplate(tpl); }}>
            <option value="">Add from template…</option>
            {templates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function RepeatField({ task }: { task: Task }) {
  const r = task.repeat;
  const preset = !r ? 'none' : r.every === 1 && r.unit === 'day' ? 'daily' : r.every === 1 && r.unit === 'week' ? 'weekly' : r.every === 2 && r.unit === 'week' ? 'biweekly' : r.every === 1 && r.unit === 'month' ? 'monthly' : 'custom';
  const set = (next: Repeat | null) => store.updateTask(task.id, { repeat: next }, `Repeat: ${task.title}`);
  const choose = (v: string) => {
    const anchor = r?.anchor ?? 'due';
    if (v === 'none') set(null);
    else if (v === 'daily') set({ every: 1, unit: 'day', anchor });
    else if (v === 'weekly') set({ every: 1, unit: 'week', anchor });
    else if (v === 'biweekly') set({ every: 2, unit: 'week', anchor });
    else if (v === 'monthly') set({ every: 1, unit: 'month', anchor });
    else set({ every: r?.every ?? 3, unit: r?.unit ?? 'day', anchor });
  };
  const next = r ? nextOccurrenceDates(task) : null;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="flex gap wrap">
        <div className="field"><label>Repeat</label>
          <select value={preset} onChange={e => choose(e.target.value)}>
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        {r && preset === 'custom' && (
          <div className="field"><label>Every</label>
            <div className="flex gap">
              <input type="number" min={1} style={{ width: 64 }} value={r.every} onChange={e => set({ ...r, every: Math.max(1, Number(e.target.value) || 1) })} />
              <select value={r.unit} onChange={e => set({ ...r, unit: e.target.value as RepeatUnit })}>
                <option value="day">days</option><option value="week">weeks</option><option value="month">months</option>
              </select>
            </div>
          </div>
        )}
        {r && (
          <div className="field"><label>Next from</label>
            <select value={r.anchor} onChange={e => set({ ...r, anchor: e.target.value as Repeat['anchor'] })}>
              <option value="due">the due date</option>
              <option value="completion">when I complete it</option>
            </select>
          </div>
        )}
      </div>
      {r && <div className="muted small">Completing this rolls it forward{next?.hard || next?.soft ? ` to ${fmtDate(next.hard ?? next.soft)}` : ''} and resets its subtasks and counters. Use the ⋯ menu to complete it for good.</div>}
    </div>
  );
}

function CounterField({ task }: { task: Task }) {
  if (!task.counter) return null;
  const c = task.counter;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="section-head"><h3>Counter</h3><button className="btn small ghost" onClick={() => store.updateTask(task.id, { counter: null })}>remove</button></div>
      <div className="counter">
        <button className="btn" onClick={() => bumpCounter(task.id, -1)}>−</button>
        <span className="big">{c.done}</span><span className="muted">/</span>
        <input type="number" style={{ width: 90 }} value={c.target} onChange={e => store.updateTask(task.id, { counter: { ...c, target: Number(e.target.value) || 0 } })} />
        <button className="btn" onClick={() => bumpCounter(task.id, 1)}>+1</button>
        <button className="btn" onClick={() => bumpCounter(task.id, 5)}>+5</button>
        <div className="spacer" />
      </div>
      <ProgressBar pct={c.target ? Math.min(1, c.done / c.target) : 0} />
    </div>
  );
}

function BlocksField({ task }: { task: Task }) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('10:00');
  const [dur, setDur] = useState(60);
  const blocks = [...task.blocks].sort((a, b) => a.start.localeCompare(b.start));
  const add = () => { const start = `${date}T${time}`; addBlock(task.id, start, addMinutes(start, dur)); setAdding(false); };
  return (
    <div className="col blocks" style={{ gap: 6 }}>
      <div className="section-head"><h3>Scheduled work</h3><button className="btn small" onClick={() => setAdding(a => !a)}>{adding ? 'cancel' : '+ block'}</button></div>
      {blocks.map(b => (
        <div className="block" key={b.id}>
          <span>{fmtDate(b.start.slice(0, 10))} · {fmtTime(b.start)}–{fmtTime(b.end)}</span>
          <div className="spacer" />
          <select className="mini" value={durationOf(b.start, b.end)} onChange={e => updateBlock(task.id, b.id, { end: addMinutes(b.start, Number(e.target.value)) })}>
            {[30, 60, 90, 120, 180, 240, 360, 480].map(m => <option key={m} value={m}>{m / 60}h</option>)}
          </select>
          <button className="iconbtn" onClick={() => removeBlock(task.id, b.id)}>✕</button>
        </div>
      ))}
      {adding && (
        <div className="flex gap wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          <select value={dur} onChange={e => setDur(Number(e.target.value))}>{[30, 60, 90, 120, 180, 240, 360, 480].map(m => <option key={m} value={m}>{m / 60}h</option>)}</select>
          <button className="btn primary small" onClick={add}>Add</button>
        </div>
      )}
      {!blocks.length && !adding && <div className="muted small">Nothing scheduled. Drag this task onto the calendar or add a block.</div>}
    </div>
  );
}
function durationOf(start: string, end: string): number {
  const a = new Date(start).getTime(); const b = new Date(end).getTime();
  const m = Math.round((b - a) / 60000);
  return [30, 60, 90, 120, 180, 240, 360, 480].includes(m) ? m : 60;
}

function LinksField({ task }: { task: Task }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const add = () => { if (!url.trim()) return; store.updateTask(task.id, { links: [...task.links, { label: label.trim() || url.trim(), url: url.trim() }] }); setLabel(''); setUrl(''); setAdding(false); };
  const isLocal = (u: string) => /^[a-zA-Z]:\\|^\\\\|^file:/.test(u);
  return (
    <div className="col links" style={{ gap: 4 }}>
      <div className="section-head"><h3>Links</h3><button className="btn small" onClick={() => setAdding(a => !a)}>{adding ? 'cancel' : '+ link'}</button></div>
      {task.links.map((l, i) => (
        <div className="link" key={i}>
          {isLocal(l.url) ? <span title={l.url}>📁 {l.label}</span> : <a href={l.url} target="_blank" rel="noreferrer" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔗 {l.label}</a>}
          {isLocal(l.url) && <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(l.url)}>copy path</button>}
          <button className="iconbtn" onClick={() => store.updateTask(task.id, { links: task.links.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      {adding && (
        <div className="flex gap wrap">
          <input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} style={{ width: 140 }} />
          <input placeholder="https://… or C:\path" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className="btn primary small" onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

function TagsField({ task }: { task: Task }) {
  const [v, setV] = useState(task.tags.join(', '));
  useEffect(() => setV(task.tags.join(', ')), [task.id, task.tags]);
  const commit = () => { const tags = v.split(',').map(s => s.trim()).filter(Boolean); if (tags.join() !== task.tags.join()) store.updateTask(task.id, { tags }); };
  return (
    <div className="field"><label>Tags (comma separated)</label>
      <input value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="mod, series-a, urgent" />
    </div>
  );
}

function NotesField({ task }: { task: Task }) {
  const [v, setV] = useState(task.notes);
  const [preview, setPreview] = useState(() => !!task.notes);
  useEffect(() => { setV(task.notes); setPreview(!!task.notes); }, [task.id]);
  useEffect(() => { setV(task.notes); }, [task.notes]);
  const commit = () => { if (v !== task.notes) store.updateTask(task.id, { notes: v }, `Notes: ${task.title}`); };
  const html = useMemo(() => (preview ? (marked.parse(v || '', { async: false }) as string) : ''), [preview, v]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="section-head"><h3>Notes</h3><button className="btn small ghost" onClick={() => { if (!preview) commit(); setPreview(p => !p); }}>{preview ? 'edit' : 'preview'}</button></div>
      {preview
        ? <div className="md" onClick={() => setPreview(false)} dangerouslySetInnerHTML={{ __html: html || '<p class="muted small">Click to add notes (markdown).</p>' }} />
        : <textarea className="notes" value={v} onChange={e => setV(e.target.value)} onBlur={commit} placeholder="Markdown notes: ideas, script beats, checklists, links…" />}
    </div>
  );
}

export function hasKids(tasks: Record<string, Task>, id: string) { return hasChildren(tasks, id); }
