// Seeds ../data with Nicholas's known projects + every ModDeck mod. Run from app/: node tools/seed.mjs
// Re-running wipes data/tasks first (it is a fresh seed, not a merge).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, blankTask, serializeConfig, serializeTask } from '../src/lib/model.ts';

const DATA = join(process.cwd(), '..', 'data');
const config = structuredClone(DEFAULT_CONFIG);
const cat = id => config.categories.find(c => c.id === id);
const doneStage = c => c.doneStage ?? c.stages[c.stages.length - 1].id;

const files = [];
function mk(spec, parent = null, order = 1000, rootCat = null) {
  const c = parent ? rootCat : cat(spec.category);
  let stage = spec.stage ?? null;
  if (!parent && c && !stage) stage = c.stages[0].id;
  if (parent && spec.pipeline && c) stage = spec.done ? doneStage(c) : c.stages[0].id;
  const t = blankTask({
    title: spec.title, parent, order,
    category: parent ? null : (spec.category ?? null),
    horizon: spec.horizon ?? 'back-pocket', stage,
    soft: spec.soft ?? null, hard: spec.hard ?? null,
    counter: spec.counter ? { done: 0, target: spec.counter } : null,
    tags: spec.tags ?? [], links: spec.links ?? [], template: spec.template ?? null, source: spec.source ?? null,
    notes: spec.notes ?? '', done: !!spec.done && !spec.pipeline,
  });
  files.push(t);
  let o = 1000;
  for (const ch of spec.children ?? []) { mk(ch, t.id, o, c); o += 1000; }
  return t;
}

const VIDEO_STEPS = ['Plan the video (hook, rules, format)', 'Record', 'Edit', 'Thumbnail + title', 'Publish'].map(title => ({ title }));
const GAME_STEPS = ['Ingest footage', 'Sync cameras', 'Cut highlights', 'Color + audio', 'Export + deliver'].map(title => ({ title }));

// ---------- MC YouTube: every mod from ModDeck ----------
let families = [];
try {
  const j = await (await fetch('http://127.0.0.1:6767/api/projects')).json();
  families = j.families.filter(f => ['challenge', 'multiplayer'].includes(f.category));
} catch (e) { console.warn('ModDeck not reachable, skipping mod import:', e.message); }

const MOD_NOTES = {
  TwinChaos: 'One player pilots two bodies in two different-seed overworlds at once (split screen, shared health). Mod is PARKED on 1.21.1 — finish it before recording.',
  LooterSMP: 'Paper 26.2 looter-shooter SMP event plugin: rotating loot worlds + tournament. All multiplayer features verified via the Mineflayer bot harness (2026-07-13). Needs players / a server date.',
  BodySwap: 'Paper 26.2 secret-challenge body-passing game mode (my design). Full loop bot-verified 2026-07-20. Needs players / a server date.',
};
for (const f of families) {
  const built = f.versions.some(v => v.jars?.length);
  const parked = f.versions.some(v => v.badge === 'PARKED');
  const versions = f.versions.map(v => v.mcVersion).filter(Boolean).join(', ');
  const title = f.family === 'LooterSMP' ? 'LooterSMP event' : f.family === 'BodySwap' ? 'BodySwap secret challenge' : (f.displayName || f.family);
  mk({
    title, category: 'mc-youtube', horizon: 'back-pocket',
    stage: built && !parked ? 'mod-built' : 'idea',
    template: 'video', source: `moddeck:${f.family}`, tags: ['mod', f.category],
    links: f.versions[0]?.dir ? [{ label: 'Project folder', url: f.versions[0].dir }] : [],
    notes: [f.description, MOD_NOTES[f.family], versions ? `Ported to: ${versions}` : null].filter(Boolean).join('\n\n') + '\n',
    children: VIDEO_STEPS,
  });
}

// ---------- Work ----------
mk({
  title: 'BC Football 2026 season', category: 'work', horizon: 'now', stage: 'not-started', template: 'football-game', tags: ['football', 'dave'],
  notes: [
    'Season-long highlight package for Dave. Each game is its own pipeline-tracked subtask so the stage bar shows how many games are delivered / in edit / waiting on footage.',
    '',
    '**Cameras:** Dave = Sony PXW-Z280V (GPS UTC stamp hidden in the MXF headers), JT = Atomos Ninja. Use ClipSync + the ClipSync Timeline panel for the 2-cam sync.',
    '',
    'Rename the Game placeholders with opponent + date as the schedule firms up; use "+ Football game" to add more.',
  ].join('\n') + '\n',
  children: [
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Game ${i + 1}`, pipeline: true, children: GAME_STEPS })),
    { title: 'Banquet highlight reel', pipeline: true, children: [
      { title: 'Collect best plays from every game' }, { title: 'Cut the reel' }, { title: 'Music + titles' }, { title: 'Review with Dave' }, { title: 'Deliver' } ] },
  ],
});
mk({
  title: 'BC Football archive cleanup', category: 'work', horizon: 'now', stage: 'review', tags: ['football'],
  notes: '1.1 TB of unused media is quarantined on D:. 182 clips are expected to show as missing in the highlight project; the rebuild kit for the other computer is tested.\n',
  children: [
    { title: 'Open the highlight project in Premiere and confirm it relinks cleanly' },
    { title: 'Run the rebuild kit on the other computer' },
    { title: 'Delete the quarantine folder on D:' },
  ],
});

// ---------- Dev Tools ----------
mk({
  title: 'Tasker (this app)', category: 'dev-tools', horizon: 'now', stage: 'building', tags: ['tasker'],
  links: [{ label: 'App', url: 'https://greencat9-code.github.io/tasker/' }, { label: 'Data repo', url: 'https://github.com/Greencat9-Code/tasker-data' }],
  notes: 'Phase 1 shipped 2026-08-22. Ideas for later: Google Calendar overlay, recurring tasks, Obsidian vault bridge.\n',
  children: [
    { title: 'Create the fine-grained GitHub token and connect the PC' },
    { title: 'iPhone: open the URL in Safari → Share → Add to Home Screen → connect → enable notifications' },
    { title: 'Prune seeded tasks that do not apply' },
    { title: 'Rename the football Game placeholders with real opponents/dates' },
    { title: 'Phase 2: Google Calendar read-only overlay' },
    { title: 'Phase 2: recurring tasks' },
  ],
});
mk({ title: 'Flashback Studio', category: 'dev-tools', horizon: 'now', stage: 'building', tags: ['minecraft', 'flashback'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\FlashbackStudio' }],
  notes: 'Clean-room recreation of the Flashback addon: actors, skins, equipment overrides, world slices, studio timelines. MC 26.2 + Flashback 0.41.1. Scaffold + dev loop verified 2026-08-13.\n' });
mk({ title: 'ReplayMod fork (Flashback-style recorder)', category: 'dev-tools', horizon: 'on-deck', stage: 'building', tags: ['minecraft', 'replaymod'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\ReplayModFork' }],
  notes: 'GPL fork for MC 1.16.1+. Phase 1 (auto quick mode + entity fidelity) is done and unit-tested but still uncommitted.\n',
  children: [{ title: 'Commit + push phase 1 (remote is named backup, not origin)' }, { title: 'Decide on phase 2 scope' }] });
mk({ title: 'CutCaddy (CutValet for Premiere)', category: 'dev-tools', horizon: 'on-deck', stage: 'usable', tags: ['premiere'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\CutCaddy' }],
  notes: 'Engine on :4949 + CEP panel. All 9 host commands verified in Premiere 26.3.2 on 2026-08-14.\n',
  children: [{ title: 'Daily-drive it on a real edit and log pain points' }, { title: 'Polish the panel UI' }] });
mk({ title: 'ClipSync + Timeline panel', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['premiere', 'football'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\Desktop\\Clip Sync' }],
  notes: 'Two-angle clip matcher + CEP panel that places synced 2-cam timelines. e2e verified in Premiere 2026-08-04. Use it for every football game.\n' });
mk({ title: 'StemSplit', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['audio'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\StemSplit' }, { label: 'App', url: 'http://127.0.0.1:5757' }],
  notes: 'Local stem splitter (Demucs + Roformer) + BPM/key detection + Pitch&Tempo + Add-from-YouTube + Mashup Lab. Verified 2026-08-12.\n' });
mk({ title: 'Core Assets (Premiere asset library)', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['premiere'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\CoreAssets' }], notes: 'Electron engine on :3737 + UXP panel.\n' });
mk({ title: 'Animate On Twos panel', category: 'dev-tools', horizon: 'back-pocket', stage: 'building', tags: ['premiere'],
  notes: 'CEP panel that re-bakes keyframed Position/Transform into stepped "on 2s" motion. Started 2026-06-13 — confirm current state.\n' });
mk({ title: 'Figma → layered PSD export', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['figma'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\FigmaPSDExport' }] });
mk({ title: 'ReplaySync + ReplayAudio (Ish civ event)', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['minecraft', 'replaymod'],
  notes: 'ReplaySync: Premiere playhead → replay file + offset, with per-format jump mods. ReplayAudio: rebuilds game-audio + voice-chat WAV tracks from .mcpr replays. Both verified July 2026.\n' });
mk({ title: 'ModDeck', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['minecraft'],
  links: [{ label: 'Dashboard', url: 'http://127.0.0.1:6767' }], notes: 'MC project dashboard; auto-discovers mods. Tasker pulls its mod list from here.\n' });
mk({ title: 'JobScout', category: 'dev-tools', horizon: 'back-pocket', stage: 'usable', tags: ['career'],
  links: [{ label: 'Dashboard', url: 'http://127.0.0.1:4747' }], notes: 'Video-job board: 1,478 boards across 15 ATS platforms + 5 aggregate feeds, autostarts at logon.\n' });
mk({ title: 'Portfolio site: dynamic content from an external data source', category: 'dev-tools', horizon: 'back-pocket', stage: 'idea', tags: ['portfolio'],
  notes: 'ReadyMag portfolio; want video/content updates driven by an external data source instead of manual edits.\n' });

// ---------- Career ----------
mk({ title: 'Apply to 250 jobs', category: 'career', horizon: 'now', stage: 'in-progress', counter: 250, tags: ['career'],
  links: [{ label: 'JobScout dashboard', url: 'http://127.0.0.1:4747' }],
  notes: 'The 250-application push planned with Claude. Tap +1 / +5 as applications go out; the counter drives the progress bar.\n' });

// ---------- Life ----------
mk({ title: 'Custom 8-bay NAS build', category: 'life', horizon: 'on-deck', stage: 'in-progress', tags: ['hardware'],
  notes: 'Storage + Plex, 10GbE, Unraid. CWWK M8 board picked; drives to be bought later.\n',
  children: [{ title: 'Buy drives' }, { title: 'Assemble (CWWK M8, 8-bay chassis)' }, { title: 'Install + configure Unraid' }, { title: 'Plex + shares' }, { title: '10GbE networking' }] });
mk({ title: '9 Geniuses league record book', category: 'life', horizon: 'back-pocket', stage: 'todo', tags: ['fantasy'],
  links: [{ label: 'Project folder', url: 'C:\\Users\\nicho\\NineGeniuses' }],
  notes: 'ESPN fantasy record book (published artifact). Run refresh.cmd during the season to keep it current.\n',
  children: [{ title: 'Refresh after week 1' }, { title: 'Refresh after the regular season' }, { title: 'Refresh after the playoffs' }] });

// ---------- write ----------
rmSync(join(DATA, 'tasks'), { recursive: true, force: true });
mkdirSync(join(DATA, 'tasks'), { recursive: true });
mkdirSync(join(DATA, 'push'), { recursive: true });
for (const t of files) writeFileSync(join(DATA, t.path), serializeTask(t));
writeFileSync(join(DATA, 'tasker.json'), serializeConfig(config));
writeFileSync(join(DATA, 'push', '.gitkeep'), '');
// dev-only snapshot for the "Load dev seed.json" button (public/seed.json is gitignored)
writeFileSync(join(process.cwd(), 'public', 'seed.json'), JSON.stringify({ config, tasks: files }, null, 1));
console.log(`wrote ${files.length} task files (${files.filter(t => !t.parent).length} top-level, ${families.length} mods from ModDeck)`);
