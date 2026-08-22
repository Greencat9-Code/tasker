// Local-date helpers. Dates are 'YYYY-MM-DD'; datetimes are 'YYYY-MM-DDTHH:mm' (local, no tz).
export function pad(n: number) { return String(n).padStart(2, '0'); }
export function toDateStr(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function toDateTimeStr(d: Date): string { return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function today(): string { return toDateStr(new Date()); }
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (s.length > 10) { const [hh, mm] = s.slice(11, 16).split(':').map(Number); dt.setHours(hh || 0, mm || 0, 0, 0); }
  return dt;
}
export function addDays(s: string, n: number): string { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }
export function addMinutes(s: string, n: number): string { const d = parseDate(s); d.setMinutes(d.getMinutes() + n); return toDateTimeStr(d); }
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}
export function startOfWeek(s: string): string { const d = parseDate(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toDateStr(d); }
export function monthGrid(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const start = startOfWeek(toDateStr(first));
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  const lastWeek = days.slice(35);
  if (lastWeek.every(d => parseDate(d).getMonth() !== month0)) return days.slice(0, 35);
  return days;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function fmtDate(s: string | null, withYear = false): string {
  if (!s) return '';
  const d = parseDate(s);
  const showYear = withYear || d.getFullYear() !== new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${showYear ? ' ' + d.getFullYear() : ''}`;
}
export function fmtTime(s: string): string {
  const d = parseDate(s); const h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'p' : 'a'; const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`;
}
export function fmtMonth(year: number, month0: number) { return `${MONTHS_LONG[month0]} ${year}`; }
export function relDays(s: string): string {
  const n = daysBetween(today(), s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n}d overdue`;
  if (n < 14) return `in ${n}d`;
  if (n < 60) return `in ${Math.round(n / 7)}w`;
  return `in ${Math.round(n / 30)}mo`;
}
