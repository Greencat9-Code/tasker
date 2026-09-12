import React, { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { Task } from '../lib/model';
import { childrenOf, effectiveCategory, isDone, progressOf, roots, rootOf, stageBreakdown } from '../lib/rollup';
import { moveToHorizon, setCategory } from '../lib/actions';
import { openTask } from '../lib/nav';
import { CatBadge, DatePills, Empty, ProgressBar, StageBar } from '../components/ui';
import { addDays, fmtDate, fmtTime, today } from '../lib/dates';
import { fmtMoney, upcomingBills } from '../lib/budget';

export default function Today() {
  const { config, tasks, events, budget } = useStore();
  const t = today();
  const bills = useMemo(() => upcomingBills(budget, t, 14, 31), [budget, t]);
  const week = addDays(t, 7);
  const [shuffle, setShuffle] = useState(0);
  const todayEvents = useMemo(() => events.filter(ev => ev.start.slice(0, 10) <= t && ev.end.slice(0, 10) >= t && (ev.allDay || ev.start.slice(0, 10) === t)).sort((a, b) => (a.allDay ? '0' : a.start).localeCompare(b.allDay ? '0' : b.start)), [events, t]);

  const data = useMemo(() => {
    const all = Object.values(tasks);
    const open = all.filter(x => !isDone(tasks, config, x));
    const inbox = roots(tasks).filter(x => !x.category && !isDone(tasks, config, x));
    const overdue = open.filter(x => x.hard && x.hard < t).sort((a, b) => a.hard!.localeCompare(b.hard!));
    const dueToday = open.filter(x => x.hard === t || x.soft === t);
    const slipping = open.filter(x => x.soft && x.soft < t && !(x.hard && x.hard < t)).sort((a, b) => a.soft!.localeCompare(b.soft!));
    const upcoming = open.filter(x => (x.hard && x.hard > t && x.hard <= week) || (x.soft && x.soft > t && x.soft <= week))
      .sort((a, b) => (a.hard && a.hard > t ? a.hard : a.soft!).localeCompare(b.hard && b.hard > t ? b.hard : b.soft!));
    const blocks = all.flatMap(x => x.blocks.filter(b => b.start.startsWith(t)).map(b => ({ task: x, block: b }))).sort((a, b) => a.block.start.localeCompare(b.block.start));
    const now = roots(tasks).filter(x => x.horizon === 'now' && x.category && !isDone(tasks, config, x));
    const onDeck = roots(tasks).filter(x => x.horizon === 'on-deck' && !isDone(tasks, config, x));
    const pocket = roots(tasks).filter(x => x.horizon === 'back-pocket' && !isDone(tasks, config, x));
    return { inbox, overdue, dueToday, slipping, upcoming, blocks, now, onDeck, pocket };
  }, [tasks, config, t, week]);

  const picks = useMemo(() => {
    const arr = [...data.pocket];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pocket.length, shuffle]);

  const Item = ({ task, sub }: { task: Task; sub?: string }) => {
    const cat = effectiveCategory(tasks, config, task);
    const root = rootOf(tasks, task);
    return (
      <div className="list-item" onClick={() => openTask(task.id)}>
        <i className="dot" style={{ background: cat?.color ?? 'var(--muted)' }} />
        <div className="t"><div>{task.title}</div>{(sub || root.id !== task.id) && <div className="sub">{sub ?? root.title}</div>}</div>
        <DatePills task={task} />
      </div>
    );
  };

  const empty = !data.overdue.length && !data.dueToday.length && !data.slipping.length && !data.blocks.length;

  return (
    <div className="today-view">
      <div className="panel wide">
        <div className="flex gap"><h2>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <span className="muted small">{data.now.length} active · {data.onDeck.length} on deck · {data.pocket.length} in the back pocket</span></div>
        {empty && !todayEvents.length && <div className="muted">Nothing due or scheduled today. Pick something from Now, or promote an idea.</div>}
        {data.blocks.length > 0 && <div className="list">{data.blocks.map(({ task, block }) => <Item key={block.id} task={task} sub={`${fmtTime(block.start)} – ${fmtTime(block.end)}`} />)}</div>}
        {todayEvents.length > 0 && (
          <div className="list">
            {todayEvents.map(ev => (
              <div className="list-item" key={ev.id} style={{ cursor: 'default' }} title={ev.cal}>
                <i className="dot" style={{ background: ev.color ?? 'var(--muted)' }} />
                <div className="t"><div>{ev.title}</div><div className="sub">{ev.allDay ? 'all day' : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`}{ev.location ? ` · ${ev.location}` : ''} · {ev.cal}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.inbox.length > 0 && (
        <div className="panel">
          <h3>Inbox · {data.inbox.length} to triage</h3>
          <div className="list">
            {data.inbox.map(x => (
              <div className="list-item" key={x.id}>
                <div className="t" onClick={() => openTask(x.id)}>{x.title}</div>
                <select className="mini" value="" onChange={e => { if (e.target.value) setCategory(x.id, e.target.value); }}>
                  <option value="">Move to…</option>
                  {config.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {(data.overdue.length > 0 || data.dueToday.length > 0) && (
        <div className="panel">
          <h3 style={{ color: 'var(--hard)' }}>Overdue & due today</h3>
          <div className="list">{[...data.overdue, ...data.dueToday].map(x => <Item key={x.id} task={x} />)}</div>
        </div>
      )}
      {data.slipping.length > 0 && (
        <div className="panel">
          <h3 style={{ color: 'var(--soft)' }}>Slipping soft targets</h3>
          <div className="list">{data.slipping.map(x => <Item key={x.id} task={x} />)}</div>
        </div>
      )}
      {bills.length > 0 && (
        <div className="panel">
          <h3>Payments · next 2 weeks</h3>
          <div className="list">
            {bills.map(b => (
              <div className="list-item" key={`${b.date}-${b.key}`} onClick={() => { location.hash = `#/budget/${b.date.slice(0, 7)}`; }}>
                <span className={`pill ${b.date < t ? 'over' : b.date === t ? 'soon' : ''}`}>{b.date < t ? 'overdue' : b.date === t ? 'today' : fmtDate(b.date)}</span>
                <div className="t">{b.name}{b.autopay ? <span className="muted small"> · autopay</span> : ''}</div>
                <b>{fmtMoney(b.amount)}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Next 7 days</h3>
        {data.upcoming.length ? <div className="list">{data.upcoming.map(x => <Item key={x.id} task={x} />)}</div> : <div className="muted small">No deadlines this week.</div>}
      </div>

      <div className="panel">
        <h3>Now</h3>
        {data.now.length ? data.now.map(x => <NowCard key={x.id} task={x} />) : <Empty>Nothing active. Drag something into Now on the board.</Empty>}
      </div>
      <div className="panel">
        <h3>On deck</h3>
        {data.onDeck.length ? <div className="list">{data.onDeck.map(x => <Item key={x.id} task={x} />)}</div> : <div className="muted small">Nothing queued.</div>}
      </div>
      <div className="panel">
        <div className="section-head"><h3>From the back pocket</h3><button className="btn small ghost" onClick={() => setShuffle(s => s + 1)}>shuffle</button></div>
        {picks.length ? picks.map(x => (
          <div className="list-item" key={x.id}>
            <CatBadge cat={effectiveCategory(tasks, config, x)} small />
            <div className="t" onClick={() => openTask(x.id)}>{x.title}</div>
            <button className="btn small" onClick={() => moveToHorizon(x.id, 'on-deck')}>→ On deck</button>
          </div>
        )) : <div className="muted small">Back pocket is empty.</div>}
      </div>
    </div>
  );
}

function NowCard({ task }: { task: Task }) {
  const { config, tasks } = useStore();
  const cat = effectiveCategory(tasks, config, task);
  const kids = childrenOf(tasks, task.id);
  const prog = kids.length ? progressOf(tasks, config, task) : null;
  const parts = kids.length ? stageBreakdown(tasks, config, task) : [];
  const stage = cat?.stages.find(s => s.id === task.stage);
  return (
    <div className="list-item col" style={{ alignItems: 'stretch', gap: 6 }} onClick={() => openTask(task.id)}>
      <div className="flex gap"><i className="dot" style={{ background: cat?.color }} /><span className="t">{task.title}</span>{stage && <span className="pill">{stage.name}</span>}<DatePills task={task} /></div>
      {parts.length > 0 ? <StageBar parts={parts} /> : prog ? <ProgressBar pct={prog.pct} color={cat?.color} /> : null}
    </div>
  );
}
