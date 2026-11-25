// Gary's outfits (SPEC Flow 22): Account › Gary's wardrobe and Admin › Gary (admins only; 404 otherwise).
import { requireUser } from '../lib/auth.js';
import { wardrobe, outfitFor, chooseOutfit, allOutfits, setOutfitStatus, updateOutfit, outfitBySlug } from '../domain/outfits.js';
import { wardrobePage, adminGaryPage } from '../views/pages/outfits.js';

export default async function outfitRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const badges = () => db.prepare('SELECT slug, name FROM badges ORDER BY name COLLATE NOCASE').all();

  const wardrobeView = (req, notice = null) => {
    const weather = app.weather.current(req.city);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    return wardrobePage({
      csrf: req.csrfToken(), outfits: wardrobe(db, req.user.id), chosen: user.gary_outfit || '', city: req.city, weather,
      current: outfitFor(db, { ...user, gary_outfit: null }, weather).outfit,
      badgeNames: Object.fromEntries(badges().map((b) => [b.slug, b.name])), notice,
    });
  };
  app.get('/account/gary', { preHandler: requireUser }, async (req, reply) => reply.page(wardrobeView(req, req.query.done === 'saved' ? 'Saved. Gary’s changed.' : null)));
  app.post('/account/gary', { preHandler: requireUser }, async (req, reply) => {
    if (!chooseOutfit(db, req.user.id, String(req.body.outfit || ''))) return reply.code(422).page(wardrobeView(req, 'That outfit isn’t unlocked yet.'));
    return reply.redirect('/account/gary?done=saved', 303);
  });

  app.register(async (r) => {
    r.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    const page = (req, extra = {}) => adminGaryPage({ csrf: req.csrfToken(), outfits: allOutfits(db), badges: badges(), ...extra });
    r.get('/gary', async (req, reply) => reply.page(page(req, { notice: req.query.done ? 'Saved.' : null })));
    r.post('/gary/:slug', async (req, reply) => {
      if (!outfitBySlug(db, req.params.slug)) return reply.callNotFound();
      const result = updateOutfit(db, req.params.slug, req.body, { now: now() });
      if (result.error) return reply.code(422).page(page(req, { error: result.error }));
      return reply.redirect(`/admin/gary?done=1#outfit-${req.params.slug}`, 303);
    });
    r.post('/gary/:slug/status', async (req, reply) => {
      if (!outfitBySlug(db, req.params.slug)) return reply.callNotFound();
      setOutfitStatus(db, req.params.slug, String(req.body.status || ''), { now: now() });
      return reply.redirect(`/admin/gary?done=1#outfit-${req.params.slug}`, 303);
    });
  }, { prefix: '/admin' });
}
