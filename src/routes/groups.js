// Groups (SPEC Flow 23). Every page of a group is a 404 to anyone who isn't in it.
import { requireUser } from '../lib/auth.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import {
  groupAllowance, myGroups, groupForMember, groupByCode, createGroup, updateGroup, regenerateGroupCode,
  joinWithCode, answerRequest, invitePal, invitesFor, answerInvite, leaveGroup, removeMember, transferOwnership,
  endGroup, memberBoard, requestsFor, invitablePals, isMember,
} from '../domain/groups.js';
import { groupsPage, groupPage, joinGroupPage } from '../views/pages/groups.js';

const HOUR = 3600_000;

export default async function groupRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const codeLimit = createRateLimiter({ limit: 20, windowMs: HOUR }); // wrong codes per IP
  const id = (v) => (/^\d{1,12}$/.test(String(v)) ? Number(v) : 0);
  const str = (v, max = 200) => String(v ?? '').slice(0, max);

  const listPage = (req, extra = {}) => groupsPage({
    csrf: req.csrfToken(), groups: myGroups(db, req.user.id), invites: invitesFor(db, req.user.id), allowance: groupAllowance(db, req.user), ...extra,
  });
  const NOTICES = {
    created: 'Your group is ready. Invite your Park Pals or share its code.', asked: 'Asked. The owner will see your request.',
    joined: "You're in.", left: 'You left the group.', ended: 'The group has ended.', declined: 'Invite declined.',
  };

  app.get('/groups', { preHandler: requireUser }, async (req, reply) => reply.page(listPage(req, { notice: NOTICES[req.query.done] || null })));

  app.post('/groups', { preHandler: requireUser }, async (req, reply) => {
    const result = createGroup(db, req.user, { name: str(req.body.name), emoji: str(req.body.emoji, 20), description: str(req.body.description, 400) }, { now: now() });
    if (result.error) return reply.callNotFound(); // locked: the form isn't offered
    if (result.errors) return reply.code(422).page(listPage(req, { errors: result.errors, values: result.values }));
    app.track(req.user.id, 'group_created');
    return reply.redirect(`/groups/${result.group.id}?done=created`, 303);
  });

  // Joining with a code: typed in, or the group's link.
  const JOIN_ERRORS = {
    not_found: "That code doesn't match a group. Check it with someone in the group.", already: "You're already in that group.",
    full: "You're in as many groups as you can be. Leave one first.", asked: "You've already asked to join that group.",
  };
  const afterJoin = (reply, group, result) => reply.redirect(result.joined ? `/groups/${group.id}?done=joined` : '/groups?done=asked', 303);

  app.post('/groups/join', { preHandler: requireUser }, async (req, reply) => {
    const code = str(req.body.code, 20);
    const group = groupByCode(db, code);
    if (!group && !codeLimit.hit(req.ip)) return reply.code(429).page(listPage(req, { joinError: 'Too many tries. Try again in an hour.', joinCode: code }));
    const result = joinWithCode(db, req.user, group, { now: now() });
    if (result.error) return reply.code(422).page(listPage(req, { joinError: JOIN_ERRORS[result.error], joinCode: code }));
    return afterJoin(reply, group, result);
  });

  const joinState = (group, user) => {
    if (!user) return 'signed-out';
    if (isMember(db, group.id, user.id)) return 'member';
    return db.prepare('SELECT 1 FROM group_requests WHERE group_id = ? AND user_id = ?').get(group.id, user.id) ? 'asked' : 'open';
  };
  app.get('/groups/join/:code', async (req, reply) => {
    const group = groupByCode(db, req.params.code);
    if (!group) return reply.callNotFound();
    return reply.page(joinGroupPage({ csrf: req.csrfToken(), group, user: req.user, state: joinState(group, req.user), here: `/groups/join/${group.code}` }));
  });
  app.post('/groups/join/:code', { preHandler: requireUser }, async (req, reply) => {
    const group = groupByCode(db, req.params.code);
    if (!group) return reply.callNotFound();
    const result = joinWithCode(db, req.user, group, { now: now() });
    if (result.error === 'already') return reply.redirect(`/groups/${group.id}`, 303);
    if (result.error) return reply.code(422).page(listPage(req, { joinError: JOIN_ERRORS[result.error] }));
    return afterJoin(reply, group, result);
  });

  // Invites from Park Pals.
  for (const action of ['accept', 'decline']) {
    app.post(`/groups/invites/:id/${action}`, { preHandler: requireUser }, async (req, reply) => {
      const result = answerInvite(db, req.user, id(req.params.id), action === 'accept', { now: now() });
      if (result.error === 'not_found') return reply.callNotFound();
      if (result.error) return reply.code(422).page(listPage(req, { notice: JOIN_ERRORS[result.error] }));
      return reply.redirect(result.joined ? `/groups/${id(req.params.id)}?done=joined` : '/groups?done=declined', 303);
    });
  }

  // One group: members only.
  const memberGroup = (req) => groupForMember(db, id(req.params.id), req.user.id);
  const showGroup = (req, group, extra = {}) => groupPage({
    csrf: req.csrfToken(), group, me: req.user, board: memberBoard(db, group.id),
    requests: group.is_owner ? requestsFor(db, group.id) : [], pals: invitablePals(db, group.id, req.user.id), baseUrl: app.config.baseUrl, ...extra,
  });
  const GROUP_NOTICES = {
    created: NOTICES.created, joined: NOTICES.joined, invited: 'Invite sent. They’ll see it in their notifications.', saved: 'Saved.',
    code: 'New code made. The old code and link no longer work.', approved: 'Approved. They’re in.', declined: 'Request declined.',
    removed: 'Removed from the group.', owner: 'They run the group now.',
  };

  app.get('/groups/:id', { preHandler: requireUser }, async (req, reply) => {
    const group = memberGroup(req);
    if (!group) return reply.callNotFound();
    return reply.page(showGroup(req, group, { notice: GROUP_NOTICES[req.query.done] || null }));
  });

  // From the Pals page: invite this pal to one of my groups.
  app.post('/groups/invite', { preHandler: requireUser }, async (req, reply) => {
    const group = groupForMember(db, id(req.body.group_id), req.user.id);
    if (!group) return reply.callNotFound();
    const result = invitePal(db, req.user, group, id(req.body.user_id), { now: now() });
    if (result.error === 'not_pal') return reply.callNotFound();
    return reply.redirect(`/pals?done=${result.ok ? 'group_invited' : 'group_already'}`, 303);
  });

  app.post('/groups/:id/invite', { preHandler: requireUser }, async (req, reply) => {
    const group = memberGroup(req);
    if (!group) return reply.callNotFound();
    const result = invitePal(db, req.user, group, id(req.body.user_id), { now: now() });
    if (result.error === 'not_pal') return reply.callNotFound();
    return reply.redirect(`/groups/${group.id}?done=invited`, 303);
  });

  app.post('/groups/:id/leave', { preHandler: requireUser }, async (req, reply) => {
    const group = memberGroup(req);
    if (!group) return reply.callNotFound();
    leaveGroup(db, req.user, group);
    return reply.redirect('/groups?done=left', 303);
  });

  // Owner only (a 404 for members, as for anyone else).
  const ownedGroup = (req) => {
    const group = memberGroup(req);
    return group?.is_owner ? group : null;
  };
  app.post('/groups/:id/settings', { preHandler: requireUser }, async (req, reply) => {
    const group = ownedGroup(req);
    if (!group) return reply.callNotFound();
    const result = updateGroup(db, group, { name: str(req.body.name), emoji: str(req.body.emoji, 20), description: str(req.body.description, 400), join_mode: str(req.body.join_mode) });
    if (result.errors) return reply.code(422).page(showGroup(req, group, { errors: result.errors, values: { ...result.values, join_mode: req.body.join_mode } }));
    return reply.redirect(`/groups/${group.id}?done=saved`, 303);
  });
  app.post('/groups/:id/code', { preHandler: requireUser }, async (req, reply) => {
    const group = ownedGroup(req);
    if (!group) return reply.callNotFound();
    regenerateGroupCode(db, group.id);
    return reply.redirect(`/groups/${group.id}?done=code#invite-h`, 303);
  });
  for (const action of ['approve', 'decline']) {
    app.post(`/groups/:id/requests/:userId/${action}`, { preHandler: requireUser }, async (req, reply) => {
      const group = ownedGroup(req);
      if (!group || !answerRequest(db, group, id(req.params.userId), action === 'approve', { now: now() })) return reply.callNotFound();
      return reply.redirect(`/groups/${group.id}?done=${action === 'approve' ? 'approved' : 'declined'}#requests`, 303);
    });
  }
  app.post('/groups/:id/members', { preHandler: requireUser }, async (req, reply) => {
    const group = ownedGroup(req);
    const userId = id(req.body.user_id);
    if (!group) return reply.callNotFound();
    const ok = req.body.action === 'owner' ? transferOwnership(db, group, userId) : removeMember(db, group, userId);
    if (!ok) return reply.callNotFound();
    return reply.redirect(`/groups/${group.id}?done=${req.body.action === 'owner' ? 'owner' : 'removed'}`, 303);
  });
  app.post('/groups/:id/end', { preHandler: requireUser }, async (req, reply) => {
    const group = ownedGroup(req);
    if (!group) return reply.callNotFound();
    endGroup(db, group, { now: now() });
    return reply.redirect('/groups?done=ended', 303);
  });
}
