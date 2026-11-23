import { activeThemeRow, addDraftMotifs, cleanMotif } from './city.js';

// The "Generate with AI" job for the city theme. It runs in the background (a web-search turn can
// take a few minutes, longer than the proxy waits), and its state lives in the settings table so
// the admin page can show progress. Results are drafts; nothing goes live without approval.

const KEY = 'theme_ai_job';
const STALE_MS = 15 * 60 * 1000; // a job "running" longer than this died with the process
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_MOTIFS = 12;

const read = (db) => {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const write = (db, job, now) => db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(KEY, JSON.stringify(job), now.toISOString());

/** The latest job: { status: 'running' | 'done' | 'error', started_at, finished_at?, added?, rejected?, suggestion?, error? } */
export function themeJob(db, { now = new Date() } = {}) {
  const job = read(db);
  if (job?.status === 'running' && now - new Date(job.started_at) > STALE_MS) {
    return { ...job, status: 'error', error: 'The last run stopped before it finished. Try again.' };
  }
  return job;
}

/** Validates the model's output into clean drafts and a suggestion (never applied automatically). */
export function cleanThemeResult(result, existingNames = []) {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const motifs = [];
  let rejected = 0;
  for (const m of Array.isArray(result?.motifs) ? result.motifs : []) {
    if (motifs.length >= MAX_MOTIFS) break;
    const clean = cleanMotif({ name: String(m?.name ?? '').slice(0, 60), blurb: String(m?.blurb ?? '').slice(0, 300), svg: m?.svg });
    if (clean.errors || taken.has(clean.motif.name.toLowerCase())) { rejected++; continue; }
    taken.add(clean.motif.name.toLowerCase());
    motifs.push(clean.motif);
  }
  const tagline = String(result?.tagline ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    motifs, rejected,
    suggestion: {
      tagline,
      accent: HEX.test(result?.accent) ? result.accent : null,
      accent_2: HEX.test(result?.accent_2) ? result.accent_2 : null,
    },
  };
}

/**
 * Starts a job unless one is running. Returns the promise (tests await it) or null when busy or
 * no generator is configured.
 */
export function startThemeJob(db, generator, { now = () => new Date(), log = null } = {}) {
  if (!generator?.available) return null;
  if (themeJob(db, { now: now() })?.status === 'running') return null;
  const theme = activeThemeRow(db);
  if (!theme) return null;
  const startedAt = now().toISOString();
  write(db, { status: 'running', started_at: startedAt }, now());
  const existing = db.prepare('SELECT name FROM city_motifs WHERE theme_id = ?').pluck().all(theme.id);
  return Promise.resolve()
    .then(() => generator.generate({ city: theme.name, existing }))
    .then((result) => {
      const { motifs, rejected, suggestion } = cleanThemeResult(result, existing);
      addDraftMotifs(db, theme.id, motifs, { now: now() });
      write(db, { status: 'done', started_at: startedAt, finished_at: now().toISOString(), added: motifs.length, rejected, suggestion }, now());
    })
    .catch((err) => {
      log?.error({ err: err.message }, 'city theme generation failed');
      // Only our own messages reach the page; API errors are summarized, never echoed raw.
      const status = err?.status;
      const message = status === 401 ? 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.'
        : status === 429 ? 'The Anthropic API is rate limiting requests. Try again in a few minutes.'
          : status >= 500 ? 'The Anthropic API had a problem. Try again in a few minutes.'
            : err instanceof Error && !status && err.message.length < 200 ? err.message : 'Generation failed. Check the server log.';
      write(db, { status: 'error', started_at: startedAt, finished_at: now().toISOString(), error: message }, now());
    });
}
