import React, { useEffect } from 'react';
import { Category, Task } from '../lib/model';
import { StageCount } from '../lib/rollup';
import { daysBetween, fmtDate, relDays, today } from '../lib/dates';

export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  return <div className="progress"><i style={{ width: `${Math.round(pct * 100)}%`, background: color }} /></div>;
}

export function StageBar({ parts, legend = false }: { parts: StageCount[]; legend?: boolean }) {
  const total = parts.reduce((a, p) => a + p.count, 0);
  if (!total) return null;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="stagebar">
        {parts.map((p, i) => <i key={i} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} title={`${p.name}: ${p.count}`} />)}
      </div>
      {legend && <div className="legend">{parts.map((p, i) => <span key={i}><i style={{ background: p.color }} />{p.count} {p.name}</span>)}</div>}
    </div>
  );
}

export function CatBadge({ cat, small }: { cat: Category | null; small?: boolean }) {
  if (!cat) return <span className="pill">Inbox</span>;
  return <span className="pill cat" style={{ background: `${cat.color}26`, fontSize: small ? 10 : undefined }}><i className="dot" style={{ background: cat.color }} />{cat.name}</span>;
}

export function DatePills({ task, done }: { task: Task; done?: boolean }) {
  const t = today();
  const pills: React.ReactNode[] = [];
  if (task.hard) {
    const d = daysBetween(t, task.hard);
    const cls = done ? 'hard' : d < 0 ? 'over' : d <= 3 ? 'soon' : 'hard';
    pills.push(<span key="h" className={`pill ${cls}`} title={`Hard deadline ${fmtDate(task.hard, true)}`}>⚑ {fmtDate(task.hard)}{!done && d <= 7 ? ` · ${relDays(task.hard)}` : ''}</span>);
  }
  if (task.soft) {
    const d = daysBetween(t, task.soft);
    const cls = done ? 'soft' : d < 0 ? 'softover' : 'soft';
    pills.push(<span key="s" className={`pill ${cls}`} title={`Soft target ${fmtDate(task.soft, true)}`}>◔ {fmtDate(task.soft)}{!done && d <= 7 ? ` · ${relDays(task.soft)}` : ''}</span>);
  }
  return <>{pills}</>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty">{children}</div>; }

/** Small "⋯" popover menu. Items render as buttons; the popover closes after any click. */
export function Menu({ items, label = '⋯' }: { items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="iconbtn" onClick={e => { e.stopPropagation(); setOpen(o => !o); }} aria-label="menu">{label}</button>
      {open && (
        <div className="pop" onClick={e => e.stopPropagation()}>
          {items.map((it, i) => <button key={i} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>)}
        </div>
      )}
    </div>
  );
}
