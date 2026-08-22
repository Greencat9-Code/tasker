import React, { useEffect, useState } from 'react';
import { store, useStore } from '../lib/store';
import { Category, Config, Template, newId, slugify } from '../lib/model';
import { parseOutline, toOutline } from '../lib/templates';
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, localTestNotification, pushSupported, sendTestPush } from '../lib/push';
import { createRoot, stampTemplate } from '../lib/actions';
import { rootOf } from '../lib/rollup';

export default function Settings() {
  const state = useStore();
  return (
    <div className="settings">
      <Connection />
      {state.settings && <>
        <Notifications />
        <GoogleCalendar />
        <Categories />
        <Templates />
        <ModDeck />
        <Obsidian />
        <DataTools />
      </>}
    </div>
  );
}

function Connection() {
  const { settings, sync } = useStore();
  const [owner, setOwner] = useState(settings?.owner ?? 'Greencat9-Code');
  const [repo, setRepo] = useState(settings?.repo ?? 'tasker-data');
  const [branch, setBranch] = useState(settings?.branch ?? 'main');
  const [token, setToken] = useState(settings?.token ?? '');
  const [device, setDevice] = useState(settings?.deviceName ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const connect = async () => {
    setBusy(true); setMsg(null);
    try {
      const login = await store.configure({ owner, repo, branch, token, deviceName: device || undefined });
      setMsg({ ok: true, text: `Connected as ${login}. Tasks loaded.` });
    } catch (e: any) { setMsg({ ok: false, text: e?.message ?? String(e) }); }
    setBusy(false);
  };
  return (
    <div className="panel">
      <h2>GitHub connection</h2>
      {!settings && (
        <div className="banner">
          Tasker stores everything as markdown files in a private GitHub repo and syncs through the GitHub API. Create a <b>fine-grained personal access token</b> at
          github.com → Settings → Developer settings → Personal access tokens → Fine-grained → <i>Generate new token</i>: repository access = <b>only {repo}</b>,
          permissions = <b>Contents: Read and write</b> (and <b>Actions: Read and write</b> if you want the "send test push" button). Paste it below. It stays on this device only.
        </div>
      )}
      <div className="grid3">
        <div className="field"><label>Owner</label><input value={owner} onChange={e => setOwner(e.target.value)} /></div>
        <div className="field"><label>Repo</label><input value={repo} onChange={e => setRepo(e.target.value)} /></div>
        <div className="field"><label>Branch</label><input value={branch} onChange={e => setBranch(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label>Token</label><input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" /></div>
        <div className="field"><label>This device's name</label><input value={device} onChange={e => setDevice(e.target.value)} placeholder="e.g. iPhone, Desktop" /></div>
      </div>
      {settings?.local && <div className="banner">Local mode: tasks live only in this browser. Connect a repo below at any time and everything here is uploaded.</div>}
      <div className="flex gap wrap">
        <button className="btn primary" onClick={connect} disabled={busy || !token || !owner || !repo}>{busy ? 'Connecting…' : settings && !settings.local ? 'Reconnect' : 'Connect'}</button>
        {(!settings || settings.local) && <button className="btn" onClick={() => store.configureLocal(device || undefined)} disabled={!!settings?.local}>{settings?.local ? 'Using local mode' : 'Use without GitHub (local only)'}</button>}
        {settings && !settings.local && <button className="btn" onClick={() => { store.pull(true); store.flush(); }}>Sync now</button>}
        {settings && <button className="btn danger" onClick={() => { if (window.confirm('Disconnect and wipe the local cache? Nothing on GitHub is deleted.')) store.disconnectAndWipe(); }}>Disconnect & wipe local</button>}
        <span className="muted small">{sync.status}{sync.pending ? ` · ${sync.pending} pending write${sync.pending > 1 ? 's' : ''}` : ''}{sync.error ? ` · ${sync.error}` : ''}</span>
      </div>
      {msg && <div className={`banner ${msg.ok ? '' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}

function Notifications() {
  const { config } = useStore();
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  useEffect(() => { currentSubscription().then(setSub).catch(() => undefined); }, []);
  const supported = pushSupported();
  const needsInstall = isIOS() && !isStandalone();
  const run = async (fn: () => Promise<void>, ok: string) => { setMsg(null); try { await fn(); setMsg(ok); setSub(await currentSubscription()); if ('Notification' in window) setPerm(Notification.permission); } catch (e: any) { setMsg(e?.message ?? String(e)); } };
  return (
    <div className="panel">
      <h2>Notifications</h2>
      <div className="muted small">A scheduled GitHub Action in the data repo sends a morning digest (overdue, due today, today's work blocks, due tomorrow), a heads-up ~1h before each scheduled block, and an evening reminder for tomorrow's hard deadlines.</div>
      {needsInstall && <div className="banner">On iPhone, notifications only work after you add Tasker to the Home Screen: tap Share → <b>Add to Home Screen</b>, then open it from there and enable below.</div>}
      {!supported && !needsInstall && <div className="banner err">This browser does not support web push.</div>}
      <div className="flex gap wrap">
        {sub ? <button className="btn" onClick={() => run(disablePush, 'Notifications disabled on this device.')}>Disable on this device</button>
             : <button className="btn primary" disabled={!supported} onClick={() => run(enablePush, 'Enabled. Subscription saved to the repo.')}>Enable on this device</button>}
        <button className="btn" disabled={perm !== 'granted'} onClick={() => run(localTestNotification, 'Local test shown.')}>Test (local)</button>
        <button className="btn" disabled={!sub} onClick={() => run(sendTestPush, 'Test push requested — arrives in ~30s if the workflow runs.')}>Send test push</button>
        <span className="muted small">permission: {perm}{sub ? ' · subscribed' : ''}</span>
      </div>
      <div className="flex gap wrap">
        <span className="small muted">Digest hour</span>
        <select value={config.digestHour ?? 8} onChange={e => store.setConfig({ ...config, digestHour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h % 12 === 0 ? 12 : h % 12}{h >= 12 ? ' pm' : ' am'}</option>)}
        </select>
        <span className="small muted">Timezone</span>
        <input value={config.timezone ?? 'America/Chicago'} onChange={e => store.setConfig({ ...config, timezone: e.target.value })} style={{ width: 180 }} />
      </div>
      {msg && <div className="banner">{msg}</div>}
    </div>
  );
}

function Categories() {
  const { config, tasks } = useStore();
  const [draft, setDraft] = useState<Config>(config);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(config); }, [config, dirty]);
  const upd = (f: (c: Config) => Config) => { setDraft(d => f(structuredClone(d))); setDirty(true); };
  const usage = (catId: string) => Object.values(tasks).filter(t => !t.parent && t.category === catId).length;
  const save = () => { store.setConfig(draft); setDirty(false); };
  return (
    <div className="panel">
      <div className="section-head"><h2>Categories & pipelines</h2>{dirty && <button className="btn primary" onClick={save}>Save</button>}{dirty && <button className="btn" onClick={() => { setDraft(config); setDirty(false); }}>Discard</button>}</div>
      <div className="muted small">Each category has its own pipeline of stages. The last stage (or the one you mark) counts as complete. Stage ids are stable once created, so renaming is safe.</div>
      {draft.categories.map((c, ci) => (
        <div className="cat-box" key={c.id}>
          <div className="flex gap wrap">
            <input type="color" value={c.color} onChange={e => upd(d => { d.categories[ci].color = e.target.value; return d; })} style={{ width: 40, padding: 2, height: 34 }} />
            <input value={c.icon ?? ''} onChange={e => upd(d => { d.categories[ci].icon = e.target.value; return d; })} style={{ width: 50 }} placeholder="icon" />
            <input value={c.name} onChange={e => upd(d => { d.categories[ci].name = e.target.value; return d; })} style={{ flex: 1 }} />
            <span className="muted small">{usage(c.id)} tasks</span>
            <button className="btn small" disabled={ci === 0} onClick={() => upd(d => { const [x] = d.categories.splice(ci, 1); d.categories.splice(ci - 1, 0, x); return d; })}>↑</button>
            <button className="btn small" disabled={ci === draft.categories.length - 1} onClick={() => upd(d => { const [x] = d.categories.splice(ci, 1); d.categories.splice(ci + 1, 0, x); return d; })}>↓</button>
            <button className="btn small danger" disabled={usage(c.id) > 0} title={usage(c.id) ? 'Move its tasks first' : 'Delete category'} onClick={() => upd(d => { d.categories.splice(ci, 1); return d; })}>✕</button>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {c.stages.map((s, si) => (
              <div className="stage-row" key={s.id}>
                <span className="muted tiny" style={{ width: 18, textAlign: 'right' }}>{si + 1}</span>
                <input value={s.name} onChange={e => upd(d => { d.categories[ci].stages[si].name = e.target.value; return d; })} />
                <label className="small muted flex gap" title="Counts as complete"><input type="radio" name={`done-${c.id}`} checked={(c.doneStage ?? c.stages[c.stages.length - 1].id) === s.id} onChange={() => upd(d => { d.categories[ci].doneStage = s.id; return d; })} />done</label>
                <button className="btn small" disabled={si === 0} onClick={() => upd(d => { const st = d.categories[ci].stages; const [x] = st.splice(si, 1); st.splice(si - 1, 0, x); return d; })}>↑</button>
                <button className="btn small" disabled={si === c.stages.length - 1} onClick={() => upd(d => { const st = d.categories[ci].stages; const [x] = st.splice(si, 1); st.splice(si + 1, 0, x); return d; })}>↓</button>
                <button className="btn small" disabled={c.stages.length <= 1} onClick={() => upd(d => { d.categories[ci].stages.splice(si, 1); return d; })}>✕</button>
              </div>
            ))}
            <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => upd(d => { const name = `Stage ${d.categories[ci].stages.length + 1}`; d.categories[ci].stages.push({ id: `${slugify(name)}-${newId().slice(0, 4)}`, name }); return d; })}>+ stage</button>
          </div>
        </div>
      ))}
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => upd(d => { const cat: Category = { id: `cat-${newId().slice(0, 6)}`, name: 'New category', color: '#888888', stages: [{ id: 'todo', name: 'To do' }, { id: 'in-progress', name: 'In progress' }, { id: 'done', name: 'Done' }] }; d.categories.push(cat); return d; })}>+ category</button>
    </div>
  );
}

function Templates() {
  const { config } = useStore();
  const [draft, setDraft] = useState<Template[]>(config.templates);
  const [text, setText] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setDraft(config.templates); setText(Object.fromEntries(config.templates.map(t => [t.id, toOutline(t.children)]))); } }, [config.templates, dirty]);
  const upd = (f: (t: Template[]) => Template[]) => { setDraft(d => f(structuredClone(d))); setDirty(true); };
  const save = () => {
    const next = draft.map(t => ({ ...t, children: parseOutline(text[t.id] ?? toOutline(t.children)) }));
    store.setConfig({ ...config, templates: next }); setDirty(false);
  };
  return (
    <div className="panel">
      <div className="section-head"><h2>Templates</h2>{dirty && <button className="btn primary" onClick={save}>Save</button>}{dirty && <button className="btn" onClick={() => setDirty(false)}>Discard</button>}</div>
      <div className="muted small">One line per subtask, indent with two spaces to nest. End a line with <code className="k">*</code> to give that node its own pipeline stage (e.g. each game), or <code className="k">(0/250)</code> for a counter. A task can pick a default template so "+ Add" stamps it in one tap.</div>
      {draft.map((t, i) => (
        <div className="cat-box" key={t.id}>
          <div className="flex gap wrap">
            <input value={t.name} onChange={e => upd(d => { d[i].name = e.target.value; return d; })} style={{ flex: 1 }} />
            <select value={t.category ?? ''} onChange={e => upd(d => { d[i].category = e.target.value || null; return d; })}>
              <option value="">Any category</option>
              {config.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn small danger" onClick={() => upd(d => { d.splice(i, 1); return d; })}>✕</button>
          </div>
          <textarea className="outline" value={text[t.id] ?? toOutline(t.children)} onChange={e => { setText(x => ({ ...x, [t.id]: e.target.value })); setDirty(true); }} />
        </div>
      ))}
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { const id = `tpl-${newId().slice(0, 6)}`; upd(d => { d.push({ id, name: 'New template', category: null, children: [{ title: 'Step 1' }, { title: 'Step 2' }] }); return d; }); setText(x => ({ ...x, [id]: 'Step 1\nStep 2\n' })); }}>+ template</button>
    </div>
  );
}

function ModDeck() {
  const { config, tasks } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:6767/api/projects');
      const j = await res.json();
      const cat = config.categories.find(c => c.id === 'mc-youtube') ?? config.categories[0];
      const existing = new Set(Object.values(tasks).map(t => t.source).filter(Boolean));
      const tpl = config.templates.find(t => t.id === 'video') ?? null;
      let added = 0;
      for (const f of j.families as any[]) {
        if (!['challenge', 'multiplayer'].includes(f.category)) continue;
        const src = `moddeck:${f.family}`;
        if (existing.has(src)) continue;
        const built = f.versions.some((v: any) => v.jars?.length);
        const stage = (built ? cat.stages.find(s => s.id === 'mod-built') : null) ?? cat.stages[0];
        const versions = f.versions.map((v: any) => v.mcVersion).filter(Boolean).join(', ');
        const t = createRoot(f.displayName || f.family, cat.id, 'back-pocket', {
          stage: stage.id, source: src, template: tpl?.id ?? null, tags: ['mod', f.category],
          notes: `${f.description ?? ''}\n\n${versions ? `Ported to: ${versions}` : ''}\n`.trim() + '\n',
          links: f.versions[0]?.dir ? [{ label: 'Project folder', url: f.versions[0].dir }] : [],
        });
        if (tpl) stampTemplate(t.id, tpl);
        added++;
      }
      setMsg(`ModDeck sync: ${added} new mod${added === 1 ? '' : 's'} added to ${cat.name}.`);
    } catch (e: any) { setMsg(`Could not reach ModDeck (is it running on this PC?): ${e?.message ?? e}`); }
    setBusy(false);
  };
  const linked = Object.values(tasks).filter(t => t.source?.startsWith('moddeck:')).length;
  return (
    <div className="panel">
      <h2>ModDeck</h2>
      <div className="muted small">Pulls every challenge / multiplayer mod from ModDeck (127.0.0.1:6767) into MC YouTube as a Back Pocket idea with the Video production subtasks. Only works on the PC running ModDeck. {linked} mod tasks linked so far.</div>
      <div className="flex gap"><button className="btn" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync from ModDeck'}</button></div>
      {msg && <div className="banner">{msg}</div>}
    </div>
  );
}

function GoogleCalendar() {
  const { events, settings } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const cals = [...new Set(events.map(e => e.cal))];
  const refresh = async () => {
    setMsg(null);
    try { const gh = store.github; if (!gh) throw new Error('Connect GitHub first.'); await gh.dispatchWorkflow('notify.yml', { mode: 'gcal' }); setMsg('Refresh requested — the overlay updates within a minute or two (then pull).'); }
    catch (e: any) { setMsg(e?.message ?? String(e)); }
  };
  return (
    <div className="panel">
      <h2>Google Calendar overlay</h2>
      <div className="muted small">
        Read-only: your Google events show on the Calendar and Today views so you can see free time next to your deadlines. The hourly workflow in the data repo fetches each calendar's
        <b> secret iCal address</b> (Google Calendar → Settings → pick a calendar → <i>Integrate calendar</i> → "Secret address in iCal format") and writes <code className="k">calendar/events.json</code>.
        Nothing leaves GitHub; the addresses are stored as the repo secret <code className="k">GCAL_ICS_URLS</code> — one per line, optionally <code className="k">Name|#color|url</code>. Set it with:
      </div>
      <pre className="md" style={{ margin: 0 }}><code>gh secret set GCAL_ICS_URLS -R {settings?.owner || 'Greencat9-Code'}/{settings?.repo || 'tasker-data'}</code></pre>
      <div className="flex gap wrap">
        <button className="btn" onClick={refresh} disabled={!settings || settings.local}>Refresh overlay now</button>
        <span className="muted small">{events.length ? `${events.length} events from ${cals.join(', ')}` : 'No events loaded yet.'}</span>
      </div>
      {msg && <div className="banner">{msg}</div>}
    </div>
  );
}

function Obsidian() {
  return (
    <div className="panel">
      <h2>Obsidian</h2>
      <div className="muted small">
        Every task is a markdown note, so the data repo can live inside your vault: a clone at <code className="k">…\Nicholas' Giga Vault\Tasker</code> makes tasks editable in Obsidian (and via Obsidian Sync on the phone).
        <code className="k">C:\Users\nicho\Tasker\tools\vault-sync.cmd</code> commits vault edits, pulls what the app wrote and pushes — run it on a schedule (every 5 min) so both directions stay current.
        New notes dropped into <code className="k">Tasker/tasks/</code> without frontmatter show up in the Inbox (title = first heading or file name); the app adds the frontmatter on first edit.
        Frontmatter keys worth knowing: <code className="k">soft</code>, <code className="k">hard</code> (YYYY-MM-DD), <code className="k">horizon</code>, <code className="k">stage</code>, <code className="k">tags</code>, <code className="k">repeat</code>.
      </div>
    </div>
  );
}

function DataTools() {
  const { tasks, config } = useStore();
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ config, tasks: Object.values(tasks) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tasker-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  const orphans = Object.values(tasks).filter(t => t.parent && !tasks[t.parent]);
  const [importing, setImporting] = useState(false);
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const doImport = (text: string) => {
    try {
      const j = JSON.parse(text);
      if (!Array.isArray(j.tasks)) throw new Error('Expected { config, tasks: [...] }');
      if (!window.confirm(`Replace the current ${Object.keys(tasks).length} tasks with ${j.tasks.length} imported tasks?`)) return;
      store.importData(j); setImporting(false); setRaw(''); setMsg(`Imported ${j.tasks.length} tasks.`);
    } catch (e: any) { setMsg(`Import failed: ${e?.message ?? e}`); }
  };
  const loadSeed = async () => { try { const r = await fetch('./seed.json'); if (!r.ok) throw new Error(`${r.status}`); doImport(await r.text()); } catch (e: any) { setMsg(`No seed.json available (${e?.message ?? e}).`); } };
  return (
    <div className="panel">
      <h2>Data</h2>
      <div className="muted small">{Object.keys(tasks).length} task files · {Object.values(tasks).filter(t => !t.parent).length} top-level · {orphans.length} orphaned (parent missing — shown as top-level)</div>
      <div className="flex gap wrap">
        <button className="btn" onClick={exportJson}>Export JSON</button>
        <button className="btn" onClick={() => setImporting(i => !i)}>{importing ? 'Cancel import' : 'Import JSON'}</button>
        {import.meta.env.DEV && <button className="btn" onClick={loadSeed}>Load dev seed.json</button>}
        <button className="btn" onClick={() => store.pull(true)}>Force full re-pull</button>
        {orphans.length > 0 && <button className="btn" onClick={() => { for (const o of orphans) store.updateTask(o.id, { parent: null, category: o.category ?? rootOf(tasks, o).category, horizon: 'back-pocket' }); }}>Promote orphans to top-level</button>}
      </div>
      {importing && (
        <div className="col" style={{ gap: 6 }}>
          <textarea className="outline" value={raw} onChange={e => setRaw(e.target.value)} placeholder='Paste an export: { "config": {...}, "tasks": [...] }' />
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => doImport(raw)} disabled={!raw.trim()}>Import</button>
        </div>
      )}
      {msg && <div className="banner">{msg}</div>}
    </div>
  );
}
