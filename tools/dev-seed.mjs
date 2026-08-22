// Builds dev/seed.json from ../data (the real files) for the dev-only "Load dev seed.json" button.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTask, parseConfig } from '../src/lib/model.ts';
const DATA = join(process.cwd(), '..', 'data');
const tasks = readdirSync(join(DATA, 'tasks')).filter(f => f.endsWith('.md')).map(f => parseTask(`tasks/${f}`, readFileSync(join(DATA, 'tasks', f), 'utf8'))).filter(Boolean);
const config = parseConfig(readFileSync(join(DATA, 'tasker.json'), 'utf8'));
mkdirSync('dev', { recursive: true });
writeFileSync('dev/seed.json', JSON.stringify({ config, tasks }, null, 1));
console.log('dev/seed.json:', tasks.length, 'tasks');
