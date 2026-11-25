// Group goals and team badges (SPEC Flow 24). A group works on one goal at a time; what members do
// between its start and end counts (check-ins, different parks, activity minutes). Reaching it gives
// every member at that moment the goal's team badge, kept if they leave or the group ends.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './notifications.js';

const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'group-goals.json');
export const GOAL_TEMPLATES = JSON.parse(fs.readFileSync(SEED, 'utf8'));
export const METRICS = { checkins: 'check-ins', parks: 'different parks', minutes: 'active minutes' };
const ONE = { checkins: 'check-in', parks: 'park', minutes: 'active minute' };
export const CUSTOM_BADGE = 'team-effort';
const DAYS_MAX = 120;
const TARGET_MAX = 10000;

const iso = (d) => d.toISOString();
const addDays = (d, n) => new Date(d.getTime() + n * 86400e3);

/** The group's current goal (not reached and not over), else the latest one, else null. */
export function currentGoal(db, groupId, { now = new Date() } = {}) {
  const g = db.prepare(`SELECT gg.*, b.name AS badge_name, b.art AS badge_art FROM group_goals gg LEFT JOIN badges b ON b.id = gg.badge_id
    WHERE gg.group_id = ? ORDER BY gg.id DESC LIMIT 1`).get(groupId);
  if (!g) return null;
  return { ...g, active: !g.reached_at && g.ends_at > iso(now) };
}

/** What each current member did toward a goal in its window: [{ id, display_name, amount }] and the total. */
export function goalProgress(db, goal) {
  const window = [goal.group_id, goal.starts_at, goal.reached_at || goal.ends_at];
  const members = db.prepare(`SELECT u.id, u.display_name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`).all(goal.group_id);
  let total;
  let per;
  if (goal.metric === 'minutes') {
    per = new Map(db.prepare(`SELECT l.user_id, SUM(l.minutes) FROM activity_logs l JOIN group_members gm ON gm.user_id = l.user_id AND gm.group_id = ?
      WHERE l.created_at >= ? AND l.created_at < ? GROUP BY l.user_id`).raw().all(...window));
    total = [...per.values()].reduce((a, b) => a + b, 0);
  } else if (goal.metric === 'parks') {
    per = new Map(db.prepare(`SELECT v.user_id, COUNT(DISTINCT v.park_id) FROM visits v JOIN group_members gm ON gm.user_id = v.user_id AND gm.group_id = ?
      WHERE v.created_at >= ? AND v.created_at < ? GROUP BY v.user_id`).raw().all(...window));
    // Different parks the group covered between them (two members at one park count it once).
    total = db.prepare(`SELECT COUNT(DISTINCT v.park_id) FROM visits v JOIN group_members gm ON gm.user_id = v.user_id AND gm.group_id = ?
      WHERE v.created_at >= ? AND v.created_at < ?`).pluck().get(...window);
  } else {
    per = new Map(db.prepare(`SELECT v.user_id, COUNT(*) FROM visits v JOIN group_members gm ON gm.user_id = v.user_id AND gm.group_id = ?
      WHERE v.created_at >= ? AND v.created_at < ? GROUP BY v.user_id`).raw().all(...window));
    total = [...per.values()].reduce((a, b) => a + b, 0);
  }
  const shares = members.map((m) => ({ ...m, amount: Math.round(per.get(m.id) || 0) }))
    .sort((a, b) => b.amount - a.amount || a.display_name.localeCompare(b.display_name));
  return { total: Math.round(total || 0), shares };
}

/** Enabled team badges, for a custom goal's badge. */
export const teamBadges = (db) => db.prepare('SELECT id, slug, name, art FROM badges WHERE is_group = 1 AND enabled = 1 ORDER BY name COLLATE NOCASE').all();

/**
 * The owner sets the next goal: a ready-made one (template key) or their own (metric, target, days,
 * team badge). Only when there's no goal under way. Returns { goal } | { errors } | { error: 'busy' }.
 */
export function setGoal(db, group, form, { now = new Date() } = {}) {
  const cur = currentGoal(db, group.id, { now });
  if (cur?.active) return { error: 'busy' };
  const badgeBySlug = (slug) => db.prepare('SELECT id FROM badges WHERE slug = ? AND is_group = 1').pluck().get(slug) ?? null;
  let goal;
  const tpl = GOAL_TEMPLATES.find((t) => t.key === form.template);
  if (tpl) {
    goal = { template_key: tpl.key, title: tpl.title, metric: tpl.metric, target: tpl.target, days: tpl.days, badge_id: badgeBySlug(tpl.badge) };
  } else {
    const errors = {};
    const metric = Object.hasOwn(METRICS, form.metric) ? form.metric : null;
    const target = Number(form.target);
    const days = Number(form.days);
    if (!metric) errors.metric = 'Choose what to count.';
    if (!Number.isInteger(target) || target < 1 || target > TARGET_MAX) errors.target = `Enter a whole number from 1 to ${TARGET_MAX}.`;
    if (!Number.isInteger(days) || days < 1 || days > DAYS_MAX) errors.days = `Enter a number of days from 1 to ${DAYS_MAX}.`;
    const badge = db.prepare('SELECT id FROM badges WHERE id = ? AND is_group = 1 AND enabled = 1').pluck().get(Number(form.badge_id)) ?? badgeBySlug(CUSTOM_BADGE);
    if (Object.keys(errors).length) return { errors };
    goal = { template_key: null, title: `${target} ${target === 1 ? ONE[metric] : METRICS[metric]} together in ${days} ${days === 1 ? 'day' : 'days'}`, metric, target, days, badge_id: badge };
  }
  const id = db.prepare(`INSERT INTO group_goals (group_id, template_key, title, metric, target, badge_id, starts_at, ends_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(group.id, goal.template_key, goal.title, goal.metric, goal.target, goal.badge_id,
    iso(now), iso(addDays(now, goal.days)), iso(now)).lastInsertRowid;
  return { goal: db.prepare('SELECT * FROM group_goals WHERE id = ?').get(id) };
}

/** The owner stops the goal under way (no badge). */
export const stopGoal = (db, groupId, { now = new Date() } = {}) => db.prepare(`UPDATE group_goals SET ends_at = ?
  WHERE group_id = ? AND reached_at IS NULL AND ends_at > ?`).run(iso(now), groupId, iso(now)).changes > 0;

/**
 * After a member stamps or logs an activity: any goal of theirs now reached gives every member the
 * team badge (announced on their next page, with the group's name) and a notification.
 */
export function checkGroupGoals(db, userId, { now = new Date() } = {}) {
  const goals = db.prepare(`SELECT gg.*, g.name AS group_name FROM group_goals gg JOIN member_groups g ON g.id = gg.group_id
    JOIN group_members gm ON gm.group_id = gg.group_id AND gm.user_id = ?
    WHERE gg.reached_at IS NULL AND gg.starts_at <= ? AND gg.ends_at > ?`).all(userId, iso(now), iso(now));
  const reached = [];
  for (const goal of goals) {
    if (goalProgress(db, goal).total < goal.target) continue;
    db.transaction(() => {
      if (!db.prepare('UPDATE group_goals SET reached_at = ? WHERE id = ? AND reached_at IS NULL').run(iso(now), goal.id).changes) return;
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').pluck().all(goal.group_id);
      const give = db.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, note)
        VALUES (?, ?, ?, 'group', ?, ?)`);
      for (const id of members) {
        if (goal.badge_id) give.run(id, goal.badge_id, iso(now), goal.id, goal.group_name);
        notify(db, id, { kind: 'goal_reached', text: `${goal.group_name} reached its goal: ${goal.title}!`, link: `/groups/${goal.group_id}` }, { now });
      }
      reached.push(goal);
    })();
  }
  return reached;
}

/** For the home card: the goal under way, with its total so far, or null. */
export function goalSummary(db, groupId, { now = new Date() } = {}) {
  const goal = currentGoal(db, groupId, { now });
  return goal?.active ? { ...goal, total: goalProgress(db, goal).total } : null;
}

/** A member's team badges, newest first, with the group they earned each with. */
export const teamBadgesOf = (db, userId) => db.prepare(`SELECT b.*, ub.awarded_at, ub.note AS group_name FROM user_badges ub
  JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? AND b.is_group = 1 ORDER BY ub.awarded_at DESC`).all(userId);
