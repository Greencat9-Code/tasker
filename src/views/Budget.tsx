import React, { useEffect, useMemo, useState } from 'react';
import { store, useStore } from '../lib/store';
import { BudgetEntry, MonthBudget, RecurringBill, newId } from '../lib/model';
import { BillRow, addMonths, fmtMoney, monthName, monthRows, monthState, thisMonth, totalsOf, upcomingBills, yearlyOutlook } from '../lib/budget';
import { Menu, Modal } from '../components/ui';
import { fmtDate, today } from '../lib/dates';

export default function Budget({ month: monthParam }: { month?: string }) {
  const { budget } = useStore();
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : thisMonth();
  const nav = (m: string) => { location.hash = `#/budget/${m}`; };
  const st = monthState(budget, month);
  const rows = useMemo(() => monthRows(budget, month), [budget, month]);
  const totals = totalsOf(rows, st.income);
  const [manage, setManage] = useState(false);
  const t = today();
  const bills = rows.filter(r => r.kind !== 'oneoff');
  const oneoffs = rows.filter(r => r.kind === 'oneoff');
  const outlook = yearlyOutlook(budget, month);
  const upcoming = useMemo(() => upcomingBills(budget, t, 35, 31), [budget, t]);

  const saveMonth = (patch: Partial<MonthBudget>) => store.saveMonthBudget({ ...st, ...patch });
  const setRec = (id: string, patch: { paid?: boolean; skipped?: boolean; amount?: number | undefined }) =>
    saveMonth({ recurring: { ...st.recurring, [id]: { ...(st.recurring[id] ?? {}), ...patch } } });
  const setEntries = (entries: BudgetEntry[]) => saveMonth({ entries });

  const adjustAmount = (r: BillRow) => {
    const v = window.prompt(`Amount for ${r.name} in ${monthName(month)} only`, String(r.amount));
    if (v === null) return;
    const n = Number(v.replace(/[$,\s]/g, ''));
    if (Number.isFinite(n)) setRec(r.recurringId!, { amount: n === (budget.recurring.find(b => b.id === r.recurringId)?.amount) ? undefined : n });
  };

  return (
    <div className="budget-view">
      <div className="budget-head">
        <button className="btn small" onClick={() => nav(addMonths(month, -1))}>‹</button>
        <button className="btn small" onClick={() => nav(thisMonth())}>This month</button>
        <button className="btn small" onClick={() => nav(addMonths(month, 1))}>›</button>
        <h2>{monthName(month)}</h2>
        <div className="spacer" />
        <button className="btn" onClick={() => setManage(true)}>Manage recurring bills</button>
      </div>

      <div className="tiles">
        <div className="tile"><label>Planned</label><b>{fmtMoney(totals.planned)}</b><span className="muted tiny">{bills.filter(b => !b.skipped).length} bills · {oneoffs.length} one-off</span></div>
        <div className="tile"><label>Paid</label><b style={{ color: 'var(--ok)' }}>{fmtMoney(totals.paid)}</b>
          <div className="progress"><i style={{ width: `${totals.planned ? Math.min(100, (totals.paid / totals.planned) * 100) : 0}%` }} /></div>
        </div>
        <div className="tile"><label>Still to pay</label><b style={{ color: totals.remaining > 0 ? 'var(--soft)' : 'var(--muted)' }}>{fmtMoney(totals.remaining)}</b></div>
        <IncomeTile income={st.income} leftover={totals.leftover} onChange={income => saveMonth({ income })} />
      </div>

      <div className="budget-cols">
        <div className="panel">
          <div className="section-head"><h3>Bills · {monthName(month).split(' ')[0]}</h3><span className="muted small">{fmtMoney(bills.filter(b => !b.skipped).reduce((a, b) => a + b.amount, 0))}</span></div>
          {bills.map(r => (
            <div className={`bill-row ${r.skipped ? 'skipped' : ''} ${r.paid ? 'paid' : ''}`} key={r.key}>
              <input type="checkbox" checked={r.paid} disabled={r.skipped} onChange={e => setRec(r.recurringId!, { paid: e.target.checked })} />
              <div className="t">
                <div>{r.name} {r.kind === 'yearly' && <span className="pill">yearly</span>} {r.autopay && <span className="pill">autopay</span>} {r.skipped && <span className="pill">skipped</span>}</div>
                <div className="sub muted tiny">{r.category ? `${r.category} · ` : ''}{r.date < t && !r.paid && !r.skipped ? <span style={{ color: 'var(--hard)' }}>{fmtDate(r.date)} · overdue</span> : fmtDate(r.date)}</div>
              </div>
              <b className="amt">{fmtMoney(r.amount)}</b>
              <Menu items={[
                { label: 'Adjust amount this month', onClick: () => adjustAmount(r) },
                { label: r.skipped ? 'Unskip this month' : 'Skip this month', onClick: () => setRec(r.recurringId!, { skipped: !r.skipped, paid: false }) },
                { label: 'Edit recurring bills…', onClick: () => setManage(true) },
              ]} />
            </div>
          ))}
          {!bills.length && <div className="muted small">No recurring bills yet — add your monthly and yearly bills under “Manage recurring bills”.</div>}
          {outlook.length > 0 && (
            <div className="muted tiny" style={{ marginTop: 6 }}>
              Coming up yearly: {outlook.slice(0, 4).map(o => `${o.bill.name} ${fmtMoney(o.bill.amount)} (${fmtDate(o.next)})`).join(' · ')}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="section-head"><h3>One-off expenses</h3><span className="muted small">{fmtMoney(oneoffs.reduce((a, b) => a + b.amount, 0))}</span></div>
          {oneoffs.map(r => {
            const e = st.entries.find(x => x.id === r.entryId)!;
            return <OneoffRow key={r.key} entry={e} overdue={!!e.date && e.date < t && !e.paid}
              onChange={next => setEntries(st.entries.map(x => x.id === e.id ? next : x))}
              onDelete={() => setEntries(st.entries.filter(x => x.id !== e.id))} />;
          })}
          <AddOneoff month={month} onAdd={e => setEntries([...st.entries, e])} />
        </div>

        <div className="panel">
          <h3>Upcoming payments · 5 weeks</h3>
          {upcoming.length ? (
            <div className="list">
              {upcoming.map(b => (
                <div className="list-item" key={`${b.date}-${b.key}`} onClick={() => nav(b.date.slice(0, 7))}>
                  <span className={`pill ${b.date < t ? 'over' : b.date === t ? 'soon' : ''}`}>{b.date < t ? 'overdue' : b.date === t ? 'today' : fmtDate(b.date)}</span>
                  <div className="t">{b.name}{b.autopay ? <span className="muted small"> · autopay</span> : ''}</div>
                  <b>{fmtMoney(b.amount)}</b>
                </div>
              ))}
            </div>
          ) : <div className="muted small">Nothing unpaid coming up.</div>}
          <div className="muted tiny">Unpaid bills also show on the Today view and in the morning / evening notifications.</div>
        </div>
      </div>

      <ManageRecurring open={manage} onClose={() => setManage(false)} />
    </div>
  );
}

function IncomeTile({ income, leftover, onChange }: { income: number | null; leftover: number | null; onChange: (n: number | null) => void }) {
  const [v, setV] = useState(income == null ? '' : String(income));
  useEffect(() => setV(income == null ? '' : String(income)), [income]);
  const commit = () => { const n = Number(v.replace(/[$,\s]/g, '')); onChange(v.trim() === '' ? null : Number.isFinite(n) ? n : income); };
  return (
    <div className="tile">
      <label>Income this month</label>
      <input inputMode="decimal" placeholder="$" value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {leftover != null && <span className="tiny" style={{ color: leftover >= 0 ? 'var(--ok)' : 'var(--hard)' }}>{leftover >= 0 ? `${fmtMoney(leftover)} left after bills` : `${fmtMoney(-leftover)} over budget`}</span>}
    </div>
  );
}

function OneoffRow({ entry, overdue, onChange, onDelete }: { entry: BudgetEntry; overdue: boolean; onChange: (e: BudgetEntry) => void; onDelete: () => void }) {
  const [name, setName] = useState(entry.name);
  const [amount, setAmount] = useState(String(entry.amount));
  useEffect(() => { setName(entry.name); setAmount(String(entry.amount)); }, [entry.id, entry.name, entry.amount]);
  const commit = () => {
    const n = Number(amount.replace(/[$,\s]/g, ''));
    const next = { ...entry, name: name.trim() || entry.name, amount: Number.isFinite(n) ? n : entry.amount };
    if (next.name !== entry.name || next.amount !== entry.amount) onChange(next); else { setName(entry.name); setAmount(String(entry.amount)); }
  };
  return (
    <div className={`bill-row ${entry.paid ? 'paid' : ''}`}>
      <input type="checkbox" checked={entry.paid} onChange={e => onChange({ ...entry, paid: e.target.checked })} />
      <div className="t">
        <input className="bare" value={name} onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <div className="sub muted tiny flex gap">
          <input type="date" className="bare tiny" value={entry.date ?? ''} onChange={e => onChange({ ...entry, date: e.target.value || null })} style={overdue ? { color: 'var(--hard)' } : undefined} />
        </div>
      </div>
      <input className="bare amt-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <button className="iconbtn" onClick={() => { if (window.confirm(`Delete "${entry.name}"?`)) onDelete(); }}>✕</button>
    </div>
  );
}

function AddOneoff({ month, onAdd }: { month: string; onAdd: (e: BudgetEntry) => void }) {
  const defDate = month === thisMonth() ? today() : `${month}-01`;
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(defDate);
  useEffect(() => setDate(defDate), [defDate]);
  const submit = () => {
    const n = Number(amount.replace(/[$,\s]/g, ''));
    if (!name.trim() || !Number.isFinite(n)) return;
    onAdd({ id: newId(), name: name.trim(), amount: n, date: date || null, paid: false });
    setName(''); setAmount('');
  };
  return (
    <div className="flex gap wrap" style={{ marginTop: 6 }}>
      <input placeholder="Expense or upcoming payment…" value={name} onChange={e => setName(e.target.value)} style={{ flex: 2, minWidth: 140 }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <input placeholder="$" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 80 }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      <button className="btn primary small" onClick={submit} disabled={!name.trim() || !amount.trim()}>Add</button>
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ManageRecurring({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { budget } = useStore();
  const [draft, setDraft] = useState<RecurringBill[]>(budget.recurring);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (open && !dirty) setDraft(structuredClone(budget.recurring)); }, [open, budget.recurring, dirty]);
  const upd = (i: number, patch: Partial<RecurringBill>) => { setDraft(d => d.map((b, j) => j === i ? { ...b, ...patch } : b)); setDirty(true); };
  const save = () => {
    const clean = draft.filter(b => b.name.trim() && Number.isFinite(b.amount)).map(b => ({ ...b, name: b.name.trim(), day: Math.min(31, Math.max(1, b.day || 1)) }));
    store.saveRecurring(clean); setDirty(false); onClose();
  };
  const monthlyTotal = draft.filter(b => b.cadence === 'monthly').reduce((a, b) => a + (b.amount || 0), 0);
  const yearlyTotal = draft.filter(b => b.cadence === 'yearly').reduce((a, b) => a + (b.amount || 0), 0);
  return (
    <Modal open={open} onClose={() => { setDirty(false); onClose(); }} title="Recurring bills">
      <div className="muted small">Monthly bills repeat on their day every month; yearly bills land once a year. Per-month tweaks (skip, different amount, paid) live on each month, not here. {fmtMoney(monthlyTotal)}/mo + {fmtMoney(yearlyTotal)}/yr ≈ <b>{fmtMoney(monthlyTotal + yearlyTotal / 12)}/mo</b>.</div>
      <div className="col" style={{ gap: 8, maxHeight: '48vh', overflowY: 'auto' }}>
        {draft.map((b, i) => (
          <div className="cat-box" key={b.id} style={{ gap: 6 }}>
            <div className="flex gap wrap">
              <input value={b.name} placeholder="Name" onChange={e => upd(i, { name: e.target.value })} style={{ flex: 2, minWidth: 120 }} />
              <input inputMode="decimal" value={Number.isFinite(b.amount) ? String(b.amount) : ''} placeholder="$" onChange={e => { const n = Number(e.target.value.replace(/[$,\s]/g, '')); upd(i, { amount: Number.isFinite(n) ? n : (undefined as any) }); }} style={{ width: 90 }} />
              <button className="btn small danger" onClick={() => { setDraft(d => d.filter((_, j) => j !== i)); setDirty(true); }}>✕</button>
            </div>
            <div className="flex gap wrap">
              <select value={b.cadence} onChange={e => upd(i, { cadence: e.target.value as 'monthly' | 'yearly', month: e.target.value === 'yearly' ? (b.month ?? 1) : undefined })}>
                <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
              </select>
              {b.cadence === 'yearly' && (
                <select value={b.month ?? 1} onChange={e => upd(i, { month: Number(e.target.value) })}>
                  {MONTH_NAMES.map((m, j) => <option key={m} value={j + 1}>{m}</option>)}
                </select>
              )}
              <label className="small muted flex gap">day<input type="number" min={1} max={31} value={b.day} onChange={e => upd(i, { day: Number(e.target.value) || 1 })} style={{ width: 58 }} /></label>
              <input value={b.category ?? ''} placeholder="category" onChange={e => upd(i, { category: e.target.value || undefined })} style={{ width: 110 }} />
              <label className="small muted flex gap"><input type="checkbox" checked={!!b.autopay} onChange={e => upd(i, { autopay: e.target.checked })} />autopay</label>
            </div>
          </div>
        ))}
        {!draft.length && <div className="muted small">Nothing yet. Add rent, subscriptions, insurance, domain renewals…</div>}
      </div>
      <div className="flex gap wrap">
        <button className="btn" onClick={() => { setDraft(d => [...d, { id: newId(), name: '', amount: NaN as unknown as number, cadence: 'monthly', day: 1 }]); setDirty(true); }}>+ monthly bill</button>
        <button className="btn" onClick={() => { setDraft(d => [...d, { id: newId(), name: '', amount: NaN as unknown as number, cadence: 'yearly', month: new Date().getMonth() + 1, day: 1 }]); setDirty(true); }}>+ yearly bill</button>
        <div className="spacer" />
        <button className="btn" onClick={() => { setDirty(false); onClose(); }}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
