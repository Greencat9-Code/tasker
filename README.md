# Tasker

Personal planning board — categories with their own pipelines, a global Back Pocket → On Deck → Now → Done horizon, unlimited-depth subtasks with roll-ups, soft + hard dates, a calendar with drag-to-schedule, and push notifications. Runs as an installable PWA on desktop and iPhone.

**Live:** https://greencat9-code.github.io/tasker/

## How it works

- **No server.** The app is static (GitHub Pages). All data lives in a private GitHub repo (`tasker-data`) as one markdown file per task with YAML frontmatter, plus `tasker.json` for categories / pipelines / templates.
- **Sync** goes through the GitHub REST API with a fine-grained personal access token you paste into Settings on each device. Reads use the git tree (only changed blobs are fetched); every write is a commit. Edits queue offline and flush when online; last write wins per file.
- **Notifications** are sent by a scheduled GitHub Action in the data repo (`notify.yml`, hourly): morning digest, ~1h heads-up before scheduled work blocks, evening reminder for tomorrow's hard deadlines. Web-push subscriptions are stored in `push/<device>.json`.
- **Local mode** (Settings → "Use without GitHub") keeps everything in the browser only; connecting later uploads it.

## Model

| Concept | Meaning |
|---|---|
| Category | Work, MC YouTube, … — each owns a pipeline of stages; the last (or marked) stage = complete |
| Horizon | Back Pocket / On Deck / Now / Done — global axis on every top-level task |
| Subtask | Any depth. Plain subtasks are checkboxes; "pipeline" subtasks have their own stage (e.g. each football game) so the parent shows a stage-breakdown bar |
| Soft / Hard | Internal target vs real deadline; both show on the calendar and the Today view |
| Block | A scheduled work session (drag a task onto the calendar) |
| Counter | x of N progress on a single task (e.g. 0/250 applications) |
| Template | Outline stamped as subtasks; a task can set a default template so "+ Add" is one tap |

## Dev

```bash
npm install
npm run dev        # http://127.0.0.1:5151
npm run build
node tools/icons.mjs          # regenerate PWA icons
node tools/seed.mjs           # rebuild ../data from scratch (+ public/seed.json for dev)
```

Deploys automatically to GitHub Pages on push to `main` (`.github/workflows/deploy.yml`).
