// Groups (SPEC Flow 23): a gym, a running club, a class. Members see each other's display names and
// counts (parks stamped, check-ins, badges, level), never locations, photos, reviews or visits.
// Creating a group is unlocked by 10 GPS check-ins (the Troop Leader badge) or by an admin.
import crypto from 'node:crypto';
import { notify } from './notifications.js';
import { normalizeCode } from './pals.js';
import { areFriends } from './visibility.js';
import { totalPoints } from '../gamification/points.js';
import { levelFor } from './levels.js';

export const TROOP_LEADER_GPS = 10; // check-ins by GPS that unlock creating groups
export const CREATE_EARNED = 3; // groups a Troop Leader can start
export const JOIN_BASE = 5; // groups anyone can be in
export const JOIN_UNLOCK_GPS = 25; // ...and after this many GPS check-ins
export const JOIN_UNLOCKED = 10;
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 200;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // as friend codes: no 0/O, 1/I/L
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
const iso = (now) => now.toISOString();
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const gpsCheckins = (db, userId) => db.prepare("SELECT COUNT(*) FROM visits WHERE user_id = ? AND method = 'gps'").pluck().get(userId);

/** What this member may do: { gps, canCreate, createLimit, owned, joinLimit, joined }. */
export function groupAllowance(db, user) {
  const row = db.prepare('SELECT group_create_limit, group_join_limit FROM users WHERE id = ?').get(user.id) || {};
  const gps = gpsCheckins(db, user.id);
  const createLimit = row.group_create_limit ?? (gps >= TROOP_LEADER_GPS ? CREATE_EARNED : 0);
  const joinLimit = row.group_join_limit ?? (gps >= JOIN_UNLOCK_GPS ? JOIN_UNLOCKED : JOIN_BASE);
  const owned = db.prepare('SELECT COUNT(*) FROM member_groups WHERE owner_id = ?').pluck().get(user.id);
  const joined = db.prepare('SELECT COUNT(*) FROM group_members WHERE user_id = ?').pluck().get(user.id);
  return { gps, createLimit, owned, canCreate: owned < createLimit && joined < joinLimit, joinLimit, joined };
}

/** The member's groups, for the groups page and the home card. */
export const myGroups = (db, userId) => db.prepare(`SELECT g.*, (g.owner_id = ?) AS is_owner,
    (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
    (SELECT COUNT(*) FROM group_requests r WHERE r.group_id = g.id) AS requests
  FROM group_members gm JOIN member_groups g ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY g.name COLLATE NOCASE`).all(userId, userId);

/** A group this member is in (else null: the page is a 404 for anyone else). */
export const groupForMember = (db, groupId, userId) => db.prepare(`SELECT g.*, (g.owner_id = ?) AS is_owner FROM member_groups g
  JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ? WHERE g.id = ?`).get(userId, userId, groupId) || null;

export const isMember = (db, groupId, userId) => Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId));

export const groupByCode = (db, input) => {
  const code = normalizeCode(input);
  return code ? db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members
    FROM member_groups g WHERE g.code = ?`).get(code) || null : null;
};

function validate({ name, emoji, description }) {
  const errors = {};
  const n = clean(name);
  if (!n) errors.name = 'Give your group a name.';
  else if (n.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer.`;
  const e = clean(emoji) || '🌳';
  if ([...e].length > 4 || /[<>&"]/.test(e)) errors.emoji = 'Use one emoji.';
  const d = clean(description);
  if (d.length > DESCRIPTION_MAX) errors.description = `Use ${DESCRIPTION_MAX} characters or fewer.`;
  return { errors, values: { name: n, emoji: e, description: d } };
}

function uniqueCode(db) {
  for (let i = 0; i < 20; i += 1) {
    const code = newCode();
    if (!db.prepare('SELECT 1 FROM member_groups WHERE code = ?').get(code)) return code;
  }
  throw new Error('could not make a group code');
}

/** Starts a group with this member as owner. Returns { group } or { errors } or { error: 'locked' }. */
export function createGroup(db, user, form, { now = new Date() } = {}) {
  const allowance = groupAllowance(db, user);
  if (!allowance.canCreate) return { error: 'locked' };
  const { errors, values } = validate(form);
  if (Object.keys(errors).length) return { errors, values };
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO member_groups (name, emoji, description, owner_id, code, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(values.name, values.emoji, values.description, user.id, uniqueCode(db), iso(now)).lastInsertRowid;
    db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, user.id, iso(now));
    return { group: db.prepare('SELECT * FROM member_groups WHERE id = ?').get(id) };
  })();
}

/** Owner: name, emoji, description, and what the code does. */
export function updateGroup(db, group, form) {
  const { errors, values } = validate(form);
  if (Object.keys(errors).length) return { errors, values };
  const mode = form.join_mode === 'open' ? 'open' : 'ask';
  db.prepare('UPDATE member_groups SET name = ?, emoji = ?, description = ?, join_mode = ? WHERE id = ?')
    .run(values.name, values.emoji, values.description, mode, group.id);
  return { ok: true };
}

export const regenerateGroupCode = (db, groupId) => db.prepare('UPDATE member_groups SET code = ? WHERE id = ?').run(uniqueCode(db), groupId);

function addMember(db, groupId, userId, now) {
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(groupId, userId, iso(now));
  db.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  db.prepare('DELETE FROM group_invites WHERE group_id = ? AND to_user = ?').run(groupId, userId);
}

const roomFor = (db, user) => {
  const a = groupAllowance(db, user);
  return a.joined < a.joinLimit;
};

/**
 * With a group's code (typed, or its link): joins at once ("Anyone with the code joins") or asks the
 * owner ("Ask me first"). Returns { joined } | { asked } | { error: 'not_found' | 'already' | 'full' | 'asked' }.
 */
export function joinWithCode(db, user, group, { now = new Date() } = {}) {
  if (!group) return { error: 'not_found' };
  if (isMember(db, group.id, user.id)) return { error: 'already' };
  if (!roomFor(db, user)) return { error: 'full' };
  if (group.join_mode === 'open') {
    addMember(db, group.id, user.id, now);
    if (group.owner_id) notify(db, group.owner_id, { kind: 'group_joined', text: `{actor} joined ${group.name}.`, link: `/groups/${group.id}`, actorId: user.id }, { now });
    return { joined: true };
  }
  if (db.prepare('SELECT 1 FROM group_requests WHERE group_id = ? AND user_id = ?').get(group.id, user.id)) return { error: 'asked' };
  db.prepare('INSERT INTO group_requests (group_id, user_id, created_at) VALUES (?, ?, ?)').run(group.id, user.id, iso(now));
  if (group.owner_id) notify(db, group.owner_id, { kind: 'group_request', text: `{actor} asked to join ${group.name}.`, link: `/groups/${group.id}#requests`, actorId: user.id }, { now });
  return { asked: true };
}

/** Owner answers an "ask to join". Returns true if there was such a request. */
export function answerRequest(db, group, userId, approve, { now = new Date() } = {}) {
  if (!db.prepare('SELECT 1 FROM group_requests WHERE group_id = ? AND user_id = ?').get(group.id, userId)) return false;
  if (approve && roomFor(db, { id: userId })) {
    addMember(db, group.id, userId, now);
    notify(db, userId, { kind: 'group_joined', text: `You're in ${group.name}.`, link: `/groups/${group.id}` }, { now });
  } else {
    db.prepare('DELETE FROM group_requests WHERE group_id = ? AND user_id = ?').run(group.id, userId);
  }
  return true;
}

/** A member invites one of their Park Pals. Returns { ok } | { error: 'not_pal' | 'already' | 'invited' }. */
export function invitePal(db, from, group, palId, { now = new Date() } = {}) {
  if (!areFriends(db, from.id, palId)) return { error: 'not_pal' };
  if (isMember(db, group.id, palId)) return { error: 'already' };
  const { changes } = db.prepare('INSERT OR IGNORE INTO group_invites (group_id, to_user, from_user, created_at) VALUES (?, ?, ?, ?)')
    .run(group.id, palId, from.id, iso(now));
  if (!changes) return { error: 'invited' };
  notify(db, palId, { kind: 'group_invite', text: `{actor} invited you to join ${group.name}.`, link: '/groups#invites', actorId: from.id }, { now });
  return { ok: true };
}

export const invitesFor = (db, userId) => db.prepare(`SELECT g.id, g.name, g.emoji, g.description, u.display_name AS from_name,
    (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members
  FROM group_invites i JOIN member_groups g ON g.id = i.group_id JOIN users u ON u.id = i.from_user
  WHERE i.to_user = ? ORDER BY i.created_at DESC`).all(userId);

/** Accept or decline an invite. Declining tells nobody. Returns { joined } | { declined } | { error }. */
export function answerInvite(db, user, groupId, accept, { now = new Date() } = {}) {
  const invite = db.prepare('SELECT * FROM group_invites WHERE group_id = ? AND to_user = ?').get(groupId, user.id);
  if (!invite) return { error: 'not_found' };
  if (!accept) {
    db.prepare('DELETE FROM group_invites WHERE group_id = ? AND to_user = ?').run(groupId, user.id);
    return { declined: true };
  }
  if (!roomFor(db, user)) return { error: 'full' };
  addMember(db, groupId, user.id, now);
  return { joined: true };
}

/** Leaving: an owner hands the group to the longest-standing member; the last one out ends it. */
export function leaveGroup(db, user, group) {
  db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, user.id);
    if (group.owner_id === user.id) handOn(db, group.id, user.id);
  })();
}

function handOn(db, groupId, leaverId) {
  const next = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? ORDER BY joined_at, user_id LIMIT 1').pluck().get(groupId, leaverId);
  if (next) db.prepare('UPDATE member_groups SET owner_id = ? WHERE id = ?').run(next, groupId);
  else db.prepare('DELETE FROM member_groups WHERE id = ?').run(groupId);
}

/** Before an account is deleted: groups it owns pass to their longest-standing member, or end. */
export function handOnGroupsOf(db, userId) {
  for (const id of db.prepare('SELECT id FROM member_groups WHERE owner_id = ?').pluck().all(userId)) handOn(db, id, userId);
}

export const removeMember = (db, group, userId) => (userId !== group.owner_id
  && db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, userId).changes > 0);

export function transferOwnership(db, group, userId) {
  if (!isMember(db, group.id, userId) || userId === group.owner_id) return false;
  db.prepare('UPDATE member_groups SET owner_id = ? WHERE id = ?').run(userId, group.id);
  return true;
}

/** The owner ends the group. Members keep any badges it earned (M36), and hear it ended. */
export function endGroup(db, group, { now = new Date() } = {}) {
  db.transaction(() => {
    for (const id of db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?').pluck().all(group.id, group.owner_id)) {
      notify(db, id, { kind: 'group_ended', text: `${group.name} has ended. Any badges you earned together are yours to keep.`, link: '/groups' }, { now });
    }
    db.prepare('DELETE FROM member_groups WHERE id = ?').run(group.id);
  })();
}

/**
 * The group page's people: display names and counts only (parks stamped, check-ins, badges,
 * level), best first. No locations, photos, reviews or visits, whatever anyone's visibility.
 */
export function memberBoard(db, groupId) {
  return db.prepare(`SELECT u.id, u.display_name, u.handle, gm.joined_at,
      (SELECT COUNT(DISTINCT v.park_id) FROM visits v WHERE v.user_id = u.id) AS parks,
      (SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id) AS checkins,
      (SELECT COUNT(*) FROM user_badges ub WHERE ub.user_id = u.id) AS badges
    FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`).all(groupId)
    .map((m) => ({ ...m, level: levelFor(totalPoints(db, m.id)).name }))
    .sort((a, b) => b.parks - a.parks || b.checkins - a.checkins || a.display_name.localeCompare(b.display_name));
}

export const requestsFor = (db, groupId) => db.prepare(`SELECT u.id, u.display_name, r.created_at FROM group_requests r
  JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.created_at`).all(groupId);

/** Pals this member could invite to this group (not in it, not already invited). */
export const invitablePals = (db, groupId, userId) => db.prepare(`SELECT u.id, u.display_name FROM users u
  WHERE u.id IN (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)
    AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
    AND u.id NOT IN (SELECT to_user FROM group_invites WHERE group_id = ?)
  ORDER BY u.display_name COLLATE NOCASE`).all(userId, userId, groupId, groupId);

/** Admin › Members: set (or clear, with null) a member's group limits. */
export function setGroupLimits(db, userId, { create, join }) {
  const n = (v) => {
    const s = String(v ?? '').trim();
    if (s === '') return { value: null };
    const x = Number(s);
    return Number.isInteger(x) && x >= 0 && x <= 50 ? { value: x } : { error: 'Enter a whole number from 0 to 50, or leave it empty.' };
  };
  const c = n(create);
  const j = n(join);
  const errors = {};
  if (c.error) errors.group_create_limit = c.error;
  if (j.error) errors.group_join_limit = j.error;
  if (Object.keys(errors).length) return { errors };
  db.prepare('UPDATE users SET group_create_limit = ?, group_join_limit = ? WHERE id = ?').run(c.value, j.value, userId);
  return { ok: true };
}
