import React, { useState } from 'react';
import { store, useStore } from './lib/store';
import { go, useRoute, View } from './lib/nav';
import Board from './views/Board';
import Calendar from './views/Calendar';
import Today from './views/Today';
import Settings from './views/Settings';
import TaskDetail from './views/TaskDetail';
import { Modal } from './components/ui';
import { createRoot } from './lib/actions';
import { Horizon, HORIZONS } from './lib/model';
import { closeTask, openTask } from './lib/nav';

const NAV: { view: View; label: string; icon: string }[] = [
  { view: 'today', label: 'Today', icon: '☀️' },
  { view: 'board', label: 'Board', icon: '🗂️' },
  { view: 'calendar', label: 'Calendar', icon: '📅' },
  { view: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const state = useStore();
  const route = useRoute();
  const [quick, setQuick] = useState(false);

  if (!state.ready) return <div className="empty" style={{ margin: 40 }}>Loading…</div>;
  const unconfigured = !state.settings;
  const view: View = unconfigured ? 'settings' : route.view;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><i />Tasker</div>
        <nav className="nav">
          {NAV.map(n => <a key={n.view} href={`#/${n.view}`} className={view === n.view ? 'active' : ''}>{n.label}</a>)}
        </nav>
        <div className="spacer" />
        <SyncIndicator />
      </header>
      <main className="main">
        {view === 'today' && <Today />}
        {view === 'board' && <Board categoryId={route.parts[0] ?? 'all'} />}
        {view === 'calendar' && <Calendar />}
        {view === 'settings' && <Settings />}
      </main>
      <nav className="bottomnav">
        {NAV.map(n => <a key={n.view} href={`#/${n.view}`} className={view === n.view ? 'active' : ''}><span>{n.icon}</span>{n.label}</a>)}
      </nav>
      {!unconfigured && view !== 'settings' && <button className="fab" onClick={() => setQuick(true)} aria-label="Add task">+</button>}
      {route.task && state.tasks[route.task] && <TaskDetail id={route.task} onClose={closeTask} />}
      <QuickAdd open={quick} onClose={() => setQuick(false)} defaultCategory={route.view === 'board' && route.parts[0] && route.parts[0] !== 'all' ? route.parts[0] : null} />
    </div>
  );
}

function SyncIndicator() {
  const { sync } = useStore();
  const label = sync.status === 'syncing' ? 'Syncing' : sync.status === 'offline' ? 'Offline' : sync.status === 'error' ? 'Sync error' : sync.status === 'unconfigured' ? 'Not connected' : sync.status === 'local' ? 'Local only' : sync.pending ? `${sync.pending} pending` : 'Synced';
  return (
    <div className={`sync ${sync.status}`} title={sync.error ?? (sync.lastPull ? `Last pull ${new Date(sync.lastPull).toLocaleTimeString()}` : '')} onClick={() => { store.pull(true); store.flush(); }}>
      <i />{label}
    </div>
  );
}

function QuickAdd({ open, onClose, defaultCategory }: { open: boolean; onClose: () => void; defaultCategory: string | null }) {
  const { config } = useStore();
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState<string>(defaultCategory ?? '');
  const [horizon, setHorizon] = useState<Horizon>('back-pocket');
  const [soft, setSoft] = useState('');
  const [hard, setHard] = useState('');
  const [openDetail, setOpenDetail] = useState(false);
  React.useEffect(() => { if (open) { setCat(defaultCategory ?? ''); setTitle(''); setSoft(''); setHard(''); setHorizon('back-pocket'); } }, [open, defaultCategory]);

  const submit = () => {
    if (!title.trim()) return;
    const t = createRoot(title.trim(), cat || null, horizon, { soft: soft || null, hard: hard || null });
    onClose();
    if (openDetail) openTask(t.id);
  };
  return (
    <Modal open={open} onClose={onClose} title="New task">
      <input autoFocus placeholder="What is it?" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <div className="grid2">
        <div className="field"><label>Category</label>
          <select value={cat} onChange={e => setCat(e.target.value)}>
            <option value="">Inbox (decide later)</option>
            {config.categories.map(c => <option key={c.id} value={c.id}>{c.icon ? c.icon + ' ' : ''}{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Horizon</label>
          <select value={horizon} onChange={e => setHorizon(e.target.value as Horizon)}>
            {HORIZONS.filter(h => h.id !== 'done').map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Soft target</label><input type="date" value={soft} onChange={e => setSoft(e.target.value)} /></div>
        <div className="field"><label>Hard deadline</label><input type="date" value={hard} onChange={e => setHard(e.target.value)} /></div>
      </div>
      <label className="flex gap small muted"><input type="checkbox" checked={openDetail} onChange={e => setOpenDetail(e.target.checked)} /> Open details after creating</label>
      <div className="flex gap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!title.trim()}>Add</button>
      </div>
    </Modal>
  );
}

export function useGo() { return go; }
