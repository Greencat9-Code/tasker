// Budget composition: recurring bills + per-month state → rows, totals, upcoming payments.
import { BudgetData, MonthBudget, RecurringBill } from './model';
import { addDays, pad, today } from './dates';

export function thisMonth(): string { return today().slice(0, 7); }
export function addMonths(month: string, n: number): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthName(month: string): string {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
export function lastDayOf(month: string): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
}
export function clampedDate(month: string, day: number): string {
  return `${month}-${pad(Math.min(Math.max(1, day), lastDayOf(month)))}`;
}
export function appliesTo(b: RecurringBill, month: string): boolean {
  if (b.start && month < b.start) return false;
  if (b.end && month > b.end) return false;
  if (b.cadence === 'yearly') return Number(month.slice(5, 7)) === (b.month ?? 1);
  return true;
}

export interface BillRow {
  key: string;
  kind: 'monthly' | 'yearly' | 'oneoff';
  name: string;
  amount: number;
  date: string;             // 'YYYY-MM-DD'
  paid: boolean;
  skipped: boolean;
  category?: string;
  autopay?: boolean;
  recurringId?: string;
  entryId?: string;
}

export function monthState(budget: BudgetData, month: string): MonthBudget {
  return budget.months[month] ?? { month, income: null, entries: [], recurring: {} };
}

export function monthRows(budget: BudgetData, month: string): BillRow[] {
  const st = monthState(budget, month);
  const rows: BillRow[] = [];
  for (const b of budget.recurring) {
    if (!appliesTo(b, month)) continue;
    const ov = st.recurring[b.id] ?? {};
    rows.push({
      key: `r:${b.id}`, kind: b.cadence, name: b.name,
      amount: Number.isFinite(ov.amount as number) ? (ov.amount as number) : b.amount,
      date: clampedDate(month, b.day), paid: !!ov.paid, skipped: !!ov.skipped,
      category: b.category, autopay: b.autopay, recurringId: b.id,
    });
  }
  for (const e of st.entries) {
    rows.push({ key: `e:${e.id}`, kind: 'oneoff', name: e.name, amount: e.amount, date: e.date ?? `${month}-01`, paid: e.paid, skipped: false, category: e.category, entryId: e.id });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export interface Totals { planned: number; paid: number; remaining: number; income: number | null; leftover: number | null }
export function totalsOf(rows: BillRow[], income: number | null): Totals {
  const live = rows.filter(r => !r.skipped);
  const planned = live.reduce((a, r) => a + r.amount, 0);
  const paid = live.filter(r => r.paid).reduce((a, r) => a + r.amount, 0);
  return { planned, paid, remaining: planned - paid, income, leftover: income == null ? null : income - planned };
}

/** Unpaid bills from `overdueDays` back through `days` ahead, across month boundaries. */
export function upcomingBills(budget: BudgetData, from = today(), days = 35, overdueDays = 31): BillRow[] {
  const lo = addDays(from, -overdueDays);
  const hi = addDays(from, days);
  const out: BillRow[] = [];
  for (let m = lo.slice(0, 7); m <= hi.slice(0, 7); m = addMonths(m, 1)) {
    for (const r of monthRows(budget, m)) {
      if (r.skipped || r.paid) continue;
      if (r.date >= lo && r.date <= hi) out.push(r);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next occurrence of each yearly bill that is NOT in the shown month (so they're never a surprise). */
export function yearlyOutlook(budget: BudgetData, month: string): { bill: RecurringBill; next: string }[] {
  const out: { bill: RecurringBill; next: string }[] = [];
  for (const b of budget.recurring) {
    if (b.cadence !== 'yearly' || appliesTo(b, month)) continue;
    for (let i = 1; i <= 12; i++) {
      const m = addMonths(month, i);
      if (appliesTo(b, m)) { out.push({ bill: b, next: clampedDate(m, b.day) }); break; }
    }
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}

export function fmtMoney(n: number): string {
  const opts = Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return '$' + n.toLocaleString('en-US', opts);
}
