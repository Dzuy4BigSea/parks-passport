// Gamification engine: badges (rule-based, known / hidden / lucky), a points ledger and levels.
// Domain-free: the app supplies rule types, a context loader, point values and level names.
// Tables it uses: schema.sql. Parks Passport's adapter lives in src/domain/badges/, points.js and
// levels.js. The reusable template repo (PLAN M15) starts from this folder.
export { createBadgeEngine, countProgress, takeUnseenBadges, addMissingBadges, seedBadgesIfEmpty } from './badges.js';
export { setSourcePoints, removeSourcePoints, totalPoints } from './points.js';
export { createLevels } from './levels.js';
