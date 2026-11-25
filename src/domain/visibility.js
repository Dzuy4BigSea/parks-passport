export const VISIBILITY = ['private', 'pals', 'public'];
export const VISIBILITY_LABELS = {
  private: 'Only me',
  pals: 'My Park Pals',
  public: 'Anyone with the link',
};

export const areFriends = (db, a, b) => {
  if (!a || !b || a === b) return false;
  const [x, y] = a < b ? [a, b] : [b, a];
  return Boolean(db.prepare('SELECT 1 FROM pal_links WHERE user_a = ? AND user_b = ?').get(x, y));
};

/**
 * The one visibility rule. viewerId may be null (signed out).
 *  private: owner only · pals: owner and accepted pals · public: anyone.
 * Visits and badges use the owner's passport visibility (users.default_visibility);
 * photos and review comments carry their own (M7).
 */
export function canSee({ viewerId, ownerId, visibility, isPal }) {
  if (viewerId && viewerId === ownerId) return true;
  if (visibility === 'public') return true;
  if (visibility === 'pals') return Boolean(viewerId) && Boolean(isPal);
  return false;
}

// Convenience: canSee with the pal check done against the DB.
export const canViewOwner = (db, viewerId, ownerId, visibility) =>
  canSee({ viewerId, ownerId, visibility, isPal: visibility === 'pals' && areFriends(db, viewerId, ownerId) });

/**
 * Adds face: whether the viewer may see each person's profile photo (the same rule as their
 * passport, which /avatars/ enforces too). Rows need default_visibility and the person's id
 * under idKey.
 */
export const withFaces = (db, viewerId, rows, idKey = 'id') =>
  rows.map((r) => ({ ...r, face: canViewOwner(db, viewerId, r[idKey], r.default_visibility) }));
