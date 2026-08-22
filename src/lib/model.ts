// Tasker data model + markdown/frontmatter (de)serialisation.
import yaml from 'js-yaml';

export type Horizon = 'back-pocket' | 'on-deck' | 'now' | 'done';
export const HORIZONS: { id: Horizon; name: string; hint: string }[] = [
  { id: 'back-pocket', name: 'Back Pocket', hint: 'Ideas and someday projects' },
  { id: 'on-deck', name: 'On Deck', hint: 'Next up: committed, not started' },
  { id: 'now', name: 'Now', hint: 'Actively working on' },
  { id: 'done', name: 'Done', hint: 'Shipped / finished' },
];
export const HORIZON_IDS: Horizon[] = ['back-pocket', 'on-deck', 'now', 'done'];

export interface Stage { id: string; name: string; color?: string }
export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  stages: Stage[];
  /** stage id that counts as complete; defaults to the last stage */
  doneStage?: string;
}
export interface TemplateNode { title: string; pipeline?: boolean; children?: TemplateNode[]; counter?: number }
export interface Template { id: string; name: string; category?: string | null; children: TemplateNode[] }

export interface Config {
  version: 1;
  categories: Category[];
  templates: Template[];
  digestHour?: number;          // local hour for the morning push digest
  timezone?: string;
}

export interface Block { id: string; start: string; end: string }   // local 'YYYY-MM-DDTHH:mm'
export interface Link { label: string; url: string }
export interface Counter { done: number; target: number }

export interface Task {
  id: string;
  path: string;                 // repo path of the markdown file
  title: string;
  category: string | null;      // only set on roots; children inherit
  stage: string | null;         // stage id from the effective category pipeline; null = plain checkbox node
  horizon: Horizon;             // meaningful on roots
  parent: string | null;
  order: number;
  soft: string | null;          // 'YYYY-MM-DD' soft / internal target
  hard: string | null;          // 'YYYY-MM-DD' hard deadline
  blocks: Block[];
  done: boolean;
  completed: string | null;
  counter: Counter | null;
  tags: string[];
  links: Link[];
  template: string | null;      // template id used by "+ Add" on this node
  source: string | null;        // e.g. 'moddeck:FreddyCraft' for imported items
  created: string;
  updated: string;
  notes: string;
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  digestHour: 8,
  timezone: 'America/Chicago',
  categories: [
    { id: 'work', name: 'Work', color: '#4f8cff', icon: '🎬', stages: [
      { id: 'not-started', name: 'Not started' }, { id: 'footage-in', name: 'Footage in' },
      { id: 'editing', name: 'Editing' }, { id: 'review', name: 'Review' }, { id: 'delivered', name: 'Delivered' } ] },
    { id: 'mc-youtube', name: 'MC YouTube', color: '#5ec269', icon: '⛏️', stages: [
      { id: 'idea', name: 'Idea' }, { id: 'mod-built', name: 'Mod built' }, { id: 'recorded', name: 'Recorded' },
      { id: 'edited', name: 'Edited' }, { id: 'published', name: 'Published' } ] },
    { id: 'video-essay', name: 'Video Essay YT', color: '#c77dff', icon: '🎙️', stages: [
      { id: 'idea', name: 'Idea' }, { id: 'research', name: 'Research' }, { id: 'script', name: 'Script' },
      { id: 'record', name: 'Record' }, { id: 'edit', name: 'Edit' }, { id: 'published', name: 'Published' } ] },
    { id: 'dev-tools', name: 'Dev Tools', color: '#ff9f43', icon: '🛠️', stages: [
      { id: 'idea', name: 'Idea' }, { id: 'building', name: 'Building' }, { id: 'usable', name: 'Usable' },
      { id: 'polished', name: 'Polished' }, { id: 'shipped', name: 'Shipped' } ] },
    { id: 'career', name: 'Career', color: '#ff6b81', icon: '💼', stages: [
      { id: 'todo', name: 'To do' }, { id: 'in-progress', name: 'In progress' }, { id: 'done', name: 'Done' } ] },
    { id: 'life', name: 'Life', color: '#48dbfb', icon: '🏠', stages: [
      { id: 'todo', name: 'To do' }, { id: 'in-progress', name: 'In progress' }, { id: 'done', name: 'Done' } ] },
  ],
  templates: [
    { id: 'video', name: 'Video production', category: 'mc-youtube', children: [
      { title: 'Plan the video (hook, rules, format)' }, { title: 'Record' }, { title: 'Edit' },
      { title: 'Thumbnail + title' }, { title: 'Publish' } ] },
    { id: 'football-game', name: 'Football game', category: 'work', children: [
      { title: 'Game', pipeline: true, children: [
        { title: 'Ingest footage' }, { title: 'Sync cameras' }, { title: 'Cut highlights' },
        { title: 'Color + audio' }, { title: 'Export + deliver' } ] } ] },
  ],
};

// ---------- helpers ----------
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
}
export function taskPath(title: string, id: string): string {
  return `tasks/${slugify(title)}-${id}.md`;
}
export function nowIso(): string { return new Date().toISOString(); }

export function blankTask(partial: Partial<Task> & { title: string }): Task {
  const id = partial.id ?? newId();
  const base: Task = {
    id, path: partial.path ?? taskPath(partial.title, id), title: partial.title,
    category: null, stage: null, horizon: 'back-pocket', parent: null, order: 0,
    soft: null, hard: null, blocks: [], done: false, completed: null, counter: null,
    tags: [], links: [], template: null, source: null,
    created: nowIso(), updated: nowIso(), notes: '',
  };
  return { ...base, ...partial, id, path: base.path };
}

// ---------- markdown <-> task ----------
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseTask(path: string, text: string): Task | null {
  const m = text.match(FM_RE);
  if (!m) return null;
  let fm: any;
  try { fm = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) ?? {}; } catch { return null; }
  if (!fm || typeof fm !== 'object') return null;
  const idFromPath = path.match(/-([a-z0-9]{6,12})\.md$/)?.[1];
  const id = String(fm.id ?? idFromPath ?? '');
  if (!id) return null;
  const str = (v: any) => (v === undefined || v === null || v === '' ? null : String(v));
  const hz = String(fm.horizon ?? 'back-pocket') as Horizon;
  return {
    id, path,
    title: String(fm.title ?? path.replace(/^tasks\//, '').replace(/\.md$/, '')),
    category: str(fm.category),
    stage: str(fm.stage),
    horizon: (HORIZON_IDS as string[]).includes(hz) ? hz : 'back-pocket',
    parent: str(fm.parent),
    order: Number(fm.order ?? 0) || 0,
    soft: str(fm.soft), hard: str(fm.hard),
    blocks: Array.isArray(fm.blocks)
      ? fm.blocks.filter((b: any) => b && b.start && b.end).map((b: any) => ({ id: String(b.id ?? newId()), start: String(b.start), end: String(b.end) }))
      : [],
    done: !!fm.done,
    completed: str(fm.completed),
    counter: fm.counter && typeof fm.counter === 'object'
      ? { done: Number(fm.counter.done) || 0, target: Number(fm.counter.target) || 0 }
      : null,
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    links: Array.isArray(fm.links)
      ? fm.links.filter((l: any) => l && l.url).map((l: any) => ({ label: String(l.label ?? l.url), url: String(l.url) }))
      : [],
    template: str(fm.template),
    source: str(fm.source),
    created: str(fm.created) ?? nowIso(),
    updated: str(fm.updated) ?? nowIso(),
    notes: m[2].replace(/^\r?\n/, ''),
  };
}

export function serializeTask(t: Task): string {
  const fm: Record<string, unknown> = { id: t.id, title: t.title };
  if (t.category) fm.category = t.category;
  if (t.stage) fm.stage = t.stage;
  if (!t.parent) fm.horizon = t.horizon;
  if (t.parent) fm.parent = t.parent;
  fm.order = t.order;
  if (t.soft) fm.soft = t.soft;
  if (t.hard) fm.hard = t.hard;
  if (t.blocks.length) fm.blocks = t.blocks;
  if (t.done) fm.done = true;
  if (t.completed) fm.completed = t.completed;
  if (t.counter) fm.counter = t.counter;
  if (t.tags.length) fm.tags = t.tags;
  if (t.links.length) fm.links = t.links;
  if (t.template) fm.template = t.template;
  if (t.source) fm.source = t.source;
  fm.created = t.created;
  fm.updated = t.updated;
  const y = yaml.dump(fm, { lineWidth: -1, noRefs: true, quotingType: '"' });
  return `---\n${y}---\n\n${t.notes ?? ''}`.replace(/\s*$/, '\n');
}

export function parseConfig(text: string): Config {
  try {
    const c = JSON.parse(text);
    if (c && Array.isArray(c.categories)) return { ...DEFAULT_CONFIG, ...c, templates: c.templates ?? [] };
  } catch { /* fall through */ }
  return DEFAULT_CONFIG;
}
export function serializeConfig(c: Config): string { return JSON.stringify(c, null, 2) + '\n'; }

export function doneStageOf(cat: Category | undefined | null): string | null {
  if (!cat || !cat.stages.length) return null;
  return cat.doneStage ?? cat.stages[cat.stages.length - 1].id;
}
