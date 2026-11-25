import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
  createBadgeEngine, countProgress, takeUnseenBadges, addMissingBadges, seedBadgesIfEmpty,
  setSourcePoints, removeSourcePoints, totalPoints, createLevels,
} from '../../src/gamification/index.js';

// The engine core against a toy app (a reading log) with no Parks Passport tables at all.

function toyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_read (id INTEGER PRIMARY KEY, user_id INTEGER, genre TEXT);
    INSERT INTO users (id, name) VALUES (1, 'Ana'), (2, 'Bo');`);
  db.exec(fs.readFileSync(new URL('../../src/gamification/schema.sql', import.meta.url), 'utf8'));
  return db;
}

const RULES = {
  books: { label: 'Read N books', params: { n: 'number' }, evaluate: ({ n }, ctx) => countProgress(ctx.books.length, n, 'books') },
  genre: { label: 'Read a genre', params: { genre: 'string' }, evaluate: ({ genre }, ctx) => ({ earned: ctx.books.some((b) => b.genre === genre) }) },
  coin: { label: 'Random', params: { probability: 'number' }, permanent: true, evaluate: ({ probability }, ctx) => ({ earned: ctx.trigger?.type === 'book' && ctx.random() < probability }) },
};
const engine = createBadgeEngine({
  rules: RULES,
  loadContext: (db, userId, { trigger = null, random = Math.random } = {}) => ({
    books: db.prepare('SELECT * FROM books_read WHERE user_id = ?').all(userId), trigger, random,
  }),
  // Toy rule: secret-genre badges stay off the board until earned.
  boardFilter: () => (b) => !b.slug.startsWith('secret-'),
});
const SEED = [
  { slug: 'first-book', name: 'First Book', rule_type: 'books', rule_params: { n: 1 }, kind: 'known' },
  { slug: 'shelf', name: 'Shelf', rule_type: 'books', rule_params: { n: 3 }, kind: 'known' },
  { slug: 'secret-poetry', name: 'Poet', rule_type: 'genre', rule_params: { genre: 'poetry' }, kind: 'hidden', hint: 'Try verse' },
  { slug: 'lucky-bookmark', name: 'Lucky Bookmark', rule_type: 'coin', rule_params: { probability: 0.5 }, kind: 'lucky', hint: 'Who knows?' },
];
const read = (db, userId, genre = 'novel') => Number(db.prepare('INSERT INTO books_read (user_id, genre) VALUES (?, ?)').run(userId, genre).lastInsertRowid);

test('core: award once, announce once, revoke unmet but keep permanent', () => {
  const db = toyDb();
  assert.equal(seedBadgesIfEmpty(db, SEED), 4);
  assert.equal(seedBadgesIfEmpty(db, SEED), 0);
  const id = read(db, 1, 'poetry');
  const got = engine.awardBadges(db, 1, { type: 'book', id }, { random: () => 0.1 }).map((b) => b.slug);
  assert.deepEqual(got, ['first-book', 'secret-poetry', 'lucky-bookmark']);
  assert.deepEqual(engine.awardBadges(db, 1, { type: 'book', id }, { random: () => 0.1 }), []); // at most once
  assert.equal(db.prepare('SELECT source_type FROM user_badges LIMIT 1').pluck().get(), 'book');
  assert.equal(takeUnseenBadges(db, 1).length, 3);
  assert.equal(takeUnseenBadges(db, 1).length, 0);

  db.prepare('DELETE FROM books_read WHERE id = ?').run(id);
  assert.deepEqual(engine.revokeUnmetBadges(db, 1).map((b) => b.slug).sort(), ['first-book', 'secret-poetry']);
  assert.deepEqual(db.prepare('SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id').pluck().all(), ['lucky-bookmark']);
});

test('core: a rule edited after the award never takes the badge away', () => {
  const db = toyDb();
  seedBadgesIfEmpty(db, SEED);
  read(db, 1);
  engine.awardBadges(db, 1, { type: 'book', id: 1 }, { random: () => 0.9 });
  db.prepare("UPDATE badges SET rule_params = '{\"n\":50}' WHERE slug = 'first-book'").run();
  assert.deepEqual(engine.revokeUnmetBadges(db, 1), []);
});

test('core: board shows progress, hides filtered badges until earned, lists disabled only when earned', () => {
  const db = toyDb();
  seedBadgesIfEmpty(db, SEED);
  read(db, 2); read(db, 2);
  db.prepare("UPDATE badges SET enabled = 0 WHERE slug = 'first-book'").run();
  const board = engine.badgeBoard(db, 2);
  assert.deepEqual(board.map((b) => [b.slug, b.state]), [['shelf', 'known'], ['lucky-bookmark', 'lucky']]);
  assert.deepEqual([board[0].progress, board[0].target, board[0].unit], [2, 3, 'books']);
  // A badge the filter hides shows once earned.
  read(db, 2, 'poetry');
  engine.awardBadges(db, 2, { type: 'book', id: 3 }, { random: () => 0.9 });
  assert.equal(engine.badgeBoard(db, 2).find((b) => b.slug === 'secret-poetry')?.state, 'earned');
  assert.equal(addMissingBadges(db, [...SEED, { slug: 'new', name: 'New', rule_type: 'books', rule_params: { n: 9 }, kind: 'known' }]), 1);
});

test('core: points ledger and levels', () => {
  const db = toyDb();
  assert.equal(setSourcePoints(db, 1, 'book', 7, [[10, 'first book'], [3, 'review']]), 13);
  setSourcePoints(db, 1, 'book', 7, [[10, 'first book']]); // replaces, never doubles
  setSourcePoints(db, 1, 'book', 8, [[5, 'another']]);
  assert.equal(totalPoints(db, 1), 15);
  assert.equal(removeSourcePoints(db, 'book', 7), 1);
  assert.equal(totalPoints(db, 1), 5);

  const levelFor = createLevels([{ name: 'Reader', min: 0 }, { name: 'Bookworm', min: 10 }]);
  assert.deepEqual(levelFor(5), { index: 0, name: 'Reader', min: 0, next: { name: 'Bookworm', min: 10 }, toNext: 5, progress: 0.5 });
  assert.equal(levelFor(12).name, 'Bookworm');
  assert.equal(levelFor(12).progress, 1);
  assert.throws(() => createLevels([{ name: 'x', min: 5 }]), /start at 0/);
});
