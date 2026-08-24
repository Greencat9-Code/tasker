// Central store: local-first state, GitHub sync (pull + queued writes), persistence.
import { useSyncExternalStore } from 'react';
import { GitHub, GitHubError } from './github';
import { kvGet, kvSet, kvClear } from './idb';
import { queueNativeReschedule } from './native';
import { CalEvent, Config, DEFAULT_CONFIG, Task, blankTask, nowIso, parseConfig, parseTask, serializeConfig, serializeTask, newId } from './model';

export interface Settings {
  token: string; owner: string; repo: string; branch: string;
  deviceId: string; deviceName: string;
  /** local-only mode: no GitHub, data lives in this browser's IndexedDB */
  local?: boolean;
}
export type SyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error' | 'local';
export interface SyncInfo { status: SyncStatus; error?: string; lastPull?: number; pending: number }

export interface State {
  ready: boolean;
  settings: Settings | null;
  config: Config;
  tasks: Record<string, Task>;
  events: CalEvent[];          // read-only external calendar overlay
  sync: SyncInfo;
}

interface Op { path: string; kind: 'put' | 'del'; content?: string; message: string }
interface Persisted { config: Config; tasks: Record<string, Task>; events?: CalEvent[]; files: Record<string, string>; pending: Op[]; headSha: string | null }

const CONFIG_PATH = 'tasker.json';
const EVENTS_PATH = 'calendar/events.json';
const SETTINGS_KEY = 'tasker.settings';

type Listener = () => void;

class Store {
  state: State = { ready: false, settings: null, config: DEFAULT_CONFIG, tasks: {}, events: [], sync: { status: 'unconfigured', pending: 0 } };
  private files: Record<string, string> = {};
  private pending: Op[] = [];
  private headSha: string | null = null;
  private listeners = new Set<Listener>();
  private gh: GitHub | null = null;
  private lock: Promise<void> = Promise.resolve();
  private flushTimer: number | null = null;
  private persistTimer: number | null = null;
  private pollTimer: number | null = null;

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = () => this.state;
  private emit(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private setSync(patch: Partial<SyncInfo>) {
    this.emit({ sync: { ...this.state.sync, ...patch, pending: this.pending.length } });
  }

  // ---------- lifecycle ----------
  async init() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const settings: Settings | null = raw ? JSON.parse(raw) : null;
    const persisted = await kvGet<Persisted>('state');
    if (persisted) {
      this.files = persisted.files ?? {};
      this.pending = persisted.pending ?? [];
      this.headSha = persisted.headSha ?? null;
    }
    this.emit({
      ready: true, settings,
      config: persisted?.config ?? DEFAULT_CONFIG,
      // fill in fields added after the cache was written (e.g. repeat / completions)
      tasks: Object.fromEntries(Object.entries(persisted?.tasks ?? {}).map(([id, t]) => [id, { ...blankTask({ title: t.title }), ...t, completions: t.completions || 0, repeat: t.repeat ?? null, blocks: t.blocks ?? [], tags: t.tags ?? [], links: t.links ?? [] }])),
      events: persisted?.events ?? [],
      sync: { status: settings?.local ? 'local' : settings ? 'idle' : 'unconfigured', pending: this.pending.length },
    });
    if (settings?.local) { this.pending = []; }
    else if (settings) {
      this.gh = new GitHub(settings.token, settings.owner, settings.repo, settings.branch || 'main');
      this.pull().then(() => this.scheduleFlush(0));
      this.startPolling();
    }
    window.addEventListener('online', () => { this.scheduleFlush(0); this.pull(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.pull(); });
  }

  async configure(s: Omit<Settings, 'deviceId' | 'deviceName'> & Partial<Settings>): Promise<string> {
    const settings: Settings = {
      token: s.token.trim(), owner: s.owner.trim(), repo: s.repo.trim(), branch: (s.branch || 'main').trim(),
      deviceId: s.deviceId ?? this.state.settings?.deviceId ?? newId(),
      deviceName: s.deviceName ?? this.state.settings?.deviceName ?? guessDeviceName(),
    };
    const gh = new GitHub(settings.token, settings.owner, settings.repo, settings.branch);
    const login = await gh.whoami();           // throws on bad token
    await gh.headSha();                        // throws if repo/branch unreachable
    const wasLocal = !!this.state.settings?.local;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.gh = gh;
    this.emit({ settings, sync: { status: 'idle', pending: this.pending.length } });
    this.headSha = null;
    if (wasLocal) {
      // carry local-only data up to the repo: queue every file before the first pull so it is not dropped
      this.files = {};
      this.enqueue({ path: CONFIG_PATH, kind: 'put', content: serializeConfig(this.state.config), message: 'Import local config' });
      for (const t of Object.values(this.state.tasks)) this.enqueue({ path: t.path, kind: 'put', content: serializeTask(t), message: `Import: ${t.title}` });
    }
    await this.pull(true);
    this.scheduleFlush(0);
    this.startPolling();
    return login;
  }

  /** Use Tasker without GitHub: data stays in this browser only (can connect later and it uploads). */
  configureLocal(deviceName?: string) {
    const settings: Settings = {
      token: '', owner: '', repo: '', branch: 'main', local: true,
      deviceId: this.state.settings?.deviceId ?? newId(), deviceName: deviceName ?? guessDeviceName(),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.gh = null; this.pending = [];
    this.emit({ settings, sync: { status: 'local', pending: 0 } });
    this.persist();
  }

  /** Replace everything with an exported/seeded snapshot { config, tasks: Task[] }. */
  importData(data: { config?: Config; tasks?: Task[] }) {
    const tasks: Record<string, Task> = {};
    for (const t of data.tasks ?? []) if (t && t.id && t.path && t.title) tasks[t.id] = { ...blankTask({ title: t.title }), ...t };
    const config = data.config ? parseConfig(JSON.stringify(data.config)) : this.state.config;
    this.emit({ tasks, config });
    this.enqueue({ path: CONFIG_PATH, kind: 'put', content: serializeConfig(config), message: 'Import config' });
    for (const t of Object.values(tasks)) this.enqueue({ path: t.path, kind: 'put', content: serializeTask(t), message: `Import: ${t.title}` });
    this.persist();
  }

  async disconnectAndWipe() {
    localStorage.removeItem(SETTINGS_KEY);
    await kvClear();
    location.reload();
  }

  private startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible') this.pull(); }, 90_000);
  }

  private persist() {
    queueNativeReschedule(this.state.config, this.state.tasks);
    if (this.persistTimer) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      const p: Persisted = { config: this.state.config, tasks: this.state.tasks, events: this.state.events, files: this.files, pending: this.pending, headSha: this.headSha };
      kvSet('state', p).catch(e => console.warn('persist failed', e));
    }, 300);
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(() => undefined, () => undefined);
    return run;
  }

  // ---------- pull ----------
  pull(force = false): Promise<void> {
    if (!this.gh || !navigator.onLine) return Promise.resolve();
    const gh = this.gh;
    return this.withLock(async () => {
      try {
        this.setSync({ status: 'syncing' });
        const head = await gh.headSha();
        if (!force && head === this.headSha) { this.setSync({ status: 'idle', lastPull: Date.now(), error: undefined }); return; }
        const tree = (await gh.tree(head)).filter(e => (e.path.startsWith('tasks/') && e.path.endsWith('.md')) || e.path === CONFIG_PATH || e.path === EVENTS_PATH);
        const pendingPaths = new Set(this.pending.map(o => o.path));
        const changed = tree.filter(e => this.files[e.path] !== e.sha && !pendingPaths.has(e.path));
        const fetched: { path: string; text: string }[] = [];
        let i = 0;
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (i < changed.length) { const e = changed[i++]; fetched.push({ path: e.path, text: await gh.blob(e.sha) }); }
        }));
        const tasks = { ...this.state.tasks };
        let config = this.state.config;
        let events = this.state.events;
        for (const f of fetched) {
          if (f.path === CONFIG_PATH) { config = parseConfig(f.text); continue; }
          if (f.path === EVENTS_PATH) { try { const j = JSON.parse(f.text); events = Array.isArray(j.events) ? j.events : []; } catch { /* keep old */ } continue; }
          const t = parseTask(f.path, f.text);
          if (t) {
            // a task id can only live in one file; drop stale duplicates (e.g. after a rename)
            for (const other of Object.values(tasks)) if (other.id === t.id && other.path !== t.path) delete tasks[other.id];
            tasks[t.id] = t;
          }
        }
        const treePaths = new Set(tree.map(e => e.path));
        for (const t of Object.values(tasks)) if (!treePaths.has(t.path) && !pendingPaths.has(t.path)) delete tasks[t.id];
        const files: Record<string, string> = {};
        for (const e of tree) files[e.path] = e.sha;
        this.files = files;
        this.headSha = head;
        if (!treePaths.has(EVENTS_PATH)) events = [];
        this.emit({ tasks, config, events });
        this.setSync({ status: 'idle', lastPull: Date.now(), error: undefined });
        this.persist();
      } catch (e: any) {
        this.setSync({ status: navigator.onLine ? 'error' : 'offline', error: e?.message ?? String(e) });
      }
    });
  }

  // ---------- write queue ----------
  private enqueue(op: Op) {
    if (this.state.settings?.local) { this.persist(); return; }   // local mode: nothing to push
    const idx = this.pending.findIndex(o => o.path === op.path);
    if (idx >= 0) {
      const prev = this.pending[idx];
      if (op.kind === 'del' && prev.kind === 'put' && !this.files[op.path]) { this.pending.splice(idx, 1); }  // never reached remote
      else this.pending[idx] = op;
    } else this.pending.push(op);
    this.setSync({});
    this.persist();
    this.scheduleFlush(1500);
  }
  private scheduleFlush(ms: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => { this.flushTimer = null; this.flush(); }, ms);
  }
  flush(): Promise<void> {
    if (!this.gh || !this.pending.length || !navigator.onLine) return Promise.resolve();
    const gh = this.gh;
    return this.withLock(async () => {
      this.setSync({ status: 'syncing' });
      while (this.pending.length) {
        const op = this.pending[0];
        try {
          await this.apply(gh, op);
          this.pending.shift();
          this.setSync({});
          this.persist();
        } catch (e: any) {
          this.setSync({ status: navigator.onLine ? 'error' : 'offline', error: e?.message ?? String(e) });
          this.scheduleFlush(15_000);
          return;
        }
      }
      // after our own writes the head moved; refresh it cheaply so the next pull is a no-op
      try { this.headSha = await gh.headSha(); } catch { /* ignore */ }
      this.setSync({ status: 'idle', error: undefined });
      this.persist();
    });
  }
  private async apply(gh: GitHub, op: Op) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = this.files[op.path] ?? null;
      try {
        if (op.kind === 'put') {
          const newSha = await gh.put(op.path, op.content ?? '', sha, op.message);
          this.files[op.path] = newSha;
        } else {
          if (!sha) return;
          await gh.delete(op.path, sha, op.message);
          delete this.files[op.path];
        }
        return;
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422 || e.status === 404)) {
          // stale sha (edited elsewhere) or branch race: refetch and retry, local wins
          const fresh = await gh.fileSha(op.path);
          if (fresh) this.files[op.path] = fresh; else delete this.files[op.path];
          if (op.kind === 'del' && !fresh) return;
          continue;
        }
        throw e;
      }
    }
    throw new Error(`Gave up writing ${op.path}`);
  }

  // ---------- task actions ----------
  private commitTask(t: Task, message: string) {
    const tasks = { ...this.state.tasks, [t.id]: t };
    this.emit({ tasks });
    this.enqueue({ path: t.path, kind: 'put', content: serializeTask(t), message });
  }
  createTask(partial: Partial<Task> & { title: string }): Task {
    const t = blankTask(partial);
    this.commitTask(t, `Add: ${t.title}`);
    return t;
  }
  updateTask(id: string, patch: Partial<Task>, message?: string): Task | null {
    const cur = this.state.tasks[id];
    if (!cur) return null;
    const next: Task = { ...cur, ...patch, id: cur.id, path: cur.path, updated: nowIso() };
    this.commitTask(next, message ?? `Update: ${next.title}`);
    return next;
  }
  /** Batch several updates into one emit (still one commit per file). */
  updateMany(patches: { id: string; patch: Partial<Task> }[], message: string) {
    const tasks = { ...this.state.tasks };
    for (const { id, patch } of patches) {
      const cur = tasks[id]; if (!cur) continue;
      tasks[id] = { ...cur, ...patch, id: cur.id, path: cur.path, updated: nowIso() };
    }
    this.emit({ tasks });
    for (const { id } of patches) { const t = tasks[id]; if (t) this.enqueue({ path: t.path, kind: 'put', content: serializeTask(t), message }); }
  }
  deleteTask(id: string) {
    const tasks = { ...this.state.tasks };
    const victims: Task[] = [];
    const walk = (pid: string) => { for (const t of Object.values(tasks)) if (t.parent === pid) { victims.push(t); walk(t.id); } };
    const root = tasks[id]; if (!root) return;
    victims.push(root); walk(id);
    for (const v of victims) delete tasks[v.id];
    this.emit({ tasks });
    for (const v of victims) this.enqueue({ path: v.path, kind: 'del', message: `Delete: ${v.title}` });
  }
  setConfig(config: Config) {
    this.emit({ config });
    this.enqueue({ path: CONFIG_PATH, kind: 'put', content: serializeConfig(config), message: 'Update config' });
  }
  putFile(path: string, content: string, message: string) { this.enqueue({ path, kind: 'put', content, message }); }
  get github() { return this.gh; }
}

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Device';
}

export const store = new Store();
export function useStore(): State { return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot); }
