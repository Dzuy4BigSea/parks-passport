import { UserFacingError } from '../lib/theme-ai.js';
import { RULES } from './badges/rules.js';
import { NEW_RULE } from './ideas.js';

// The "Suggest with Claude" job for badge ideas (SPEC Flow 13). Runs in the background like the
// city theme job; its state lives in settings so the page can show progress. Suggestions are
// stored on each idea and applied only by the super admin.

const KEY = 'idea_ai_job';
const STALE_MS = 10 * 60 * 1000; // a job "running" longer than this died with the process
export const MAX_IDEAS = 100;

const read = (db) => {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const write = (db, job, now) => db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(KEY, JSON.stringify(job), now.toISOString());

/** The latest job: { status: 'running' | 'done' | 'error', started_at, finished_at?, suggested?, rejected?, error? } */
export function ideaJob(db, { now = new Date() } = {}) {
  const job = read(db);
  if (job?.status === 'running' && now - new Date(job.started_at) > STALE_MS) {
    return { ...job, status: 'error', error: 'The last run stopped before it finished. Try again.' };
  }
  return job;
}

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Validates the model's output against the ideas it was given. Unknown ideas, verdicts, rule
 * types and combine targets are dropped; parameters must be a flat object of short values.
 * Returns { suggestions: Map<ideaId, suggestion>, rejected }.
 */
export function cleanSuggestions(result, ideaIds) {
  const ids = new Set(ideaIds);
  const suggestions = new Map();
  let rejected = 0;
  for (const s of Array.isArray(result?.suggestions) ? result.suggestions : []) {
    const id = s?.idea_id;
    const verdict = s?.verdict;
    if (!ids.has(id) || suggestions.has(id) || !['keep', 'kill', 'combine'].includes(verdict)) { rejected++; continue; }
    const combineWith = verdict === 'combine' ? s.combine_with : 0;
    if (verdict === 'combine' && (!ids.has(combineWith) || combineWith === id)) { rejected++; continue; }
    let ruleType = verdict === 'kill' ? '' : String(s.rule_type || '');
    if (ruleType && ruleType !== NEW_RULE && !Object.hasOwn(RULES, ruleType)) ruleType = NEW_RULE;
    let params = {};
    if (ruleType && ruleType !== NEW_RULE) {
      try { params = JSON.parse(s.rule_params || '{}'); } catch { params = {}; }
      const allowed = RULES[ruleType].params;
      params = Object.fromEntries(Object.entries(params && typeof params === 'object' && !Array.isArray(params) ? params : {})
        .filter(([k, v]) => Object.hasOwn(allowed, k) && ['string', 'number'].includes(typeof v) && String(v).length <= 40));
    }
    suggestions.set(id, {
      verdict, combine_with: combineWith, reason: text(s.reason, 200), name: text(s.name, 60),
      rule_type: ruleType, rule_params: params, new_rule: ruleType === NEW_RULE ? text(s.new_rule, 300) : '',
    });
  }
  return { suggestions, rejected };
}

/**
 * Starts a job over up to MAX_IDEAS New ideas unless one is running. Returns the promise (tests
 * await it), or null when busy, off, or there's nothing to review.
 */
export function startIdeaJob(db, triager, { now = () => new Date(), log = null } = {}) {
  if (!triager?.available) return null;
  if (ideaJob(db, { now: now() })?.status === 'running') return null;
  const ideas = db.prepare("SELECT id, name, pitch FROM badge_ideas WHERE status = 'new' ORDER BY created_at, id LIMIT ?").all(MAX_IDEAS);
  if (!ideas.length) return null;
  const startedAt = now().toISOString();
  write(db, { status: 'running', started_at: startedAt }, now());
  const rules = Object.entries(RULES).map(([key, r]) => ({ key, label: r.label, params: Object.keys(r.params) }));
  const badges = db.prepare('SELECT name, rule_type, rule_params FROM badges ORDER BY sort, id').all();
  return Promise.resolve()
    .then(() => triager.suggest({ ideas, rules, badges }))
    .then((result) => {
      const { suggestions, rejected } = cleanSuggestions(result, ideas.map((i) => i.id));
      // Only ideas still New get a suggestion (the super admin may have triaged some meanwhile).
      const save = db.prepare("UPDATE badge_ideas SET ai_suggestion = ? WHERE id = ? AND status = 'new'");
      db.transaction(() => { for (const [id, s] of suggestions) save.run(JSON.stringify(s), id); })();
      write(db, { status: 'done', started_at: startedAt, finished_at: now().toISOString(), suggested: suggestions.size, rejected }, now());
    })
    .catch((err) => {
      log?.error({ err: err.message }, 'badge idea suggestions failed');
      // Only our own messages reach the page; anything else gets a fixed summary.
      const status = err?.status;
      const message = err instanceof UserFacingError ? err.message
        : status === 401 ? 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.'
          : status === 429 ? 'The Anthropic API is rate limiting requests. Try again in a few minutes.'
            : status >= 500 ? 'The Anthropic API had a problem. Try again in a few minutes.'
              : err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'The review took too long and was stopped. Try again.'
                : 'The review failed. Check the server log.';
      write(db, { status: 'error', started_at: startedAt, finished_at: now().toISOString(), error: message }, now());
    });
}
