/**
 * Shiftstone: an admin API for StoneBot (Wen, 2026-11-16), so people, organisations and API tokens can be managed
 * without the web admin. Mounted at /api/shiftstone/admin. Every request needs
 * `Authorization: Bearer $SHIFTSTONE_ADMIN_TOKEN`; without that env var the whole API answers 404.
 *
 *   GET    /users                      everyone: id, email, name, admin, verified, password set, disabled, organisations
 *   POST   /users                      { email, name, admin?, organisationId?, role? } creates the account and emails the
 *                                      "an administrator created your account" link to set a password. With
 *                                      organisationId they join that organisation (role ADMIN|MANAGER|MEMBER, default
 *                                      MEMBER); without it they get their own personal organisation.
 *   PATCH  /users/:id                  { admin?, disabled?, name? }
 *   GET    /orgs                       organisations with plan, teams and members
 *   POST   /orgs                       { name, ownerEmail, plan? } a shared organisation + one team (plan default enterprise)
 *   PATCH  /orgs/:id                   { plan } applies a plan's limits and features (enterprise = no limits)
 *   POST   /orgs/:id/members           { email, role? } adds an existing user (no email sent)
 *   POST   /tokens                     { email, teamId?, name, expiresIn? } a public API (v2) token for that user's team,
 *                                      shown once. expiresIn: ONE_WEEK | ONE_MONTH | THREE_MONTHS | SIX_MONTHS | ONE_YEAR.
 *
 * Documents themselves go through Documenso's own public API (/api/v2) with a token from POST /tokens.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { jobsClient } from '@documenso/lib/jobs/client';
import { addUserToOrganisation } from '@documenso/lib/server-only/organisation/accept-organisation-invitation';
import {
  createOrganisation,
  createOrganisationClaimUpsertData,
  createPersonalOrganisation,
} from '@documenso/lib/server-only/organisation/create-organisation';
import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { getSubscriptionClaim } from '@documenso/lib/server-only/subscription/get-subscription-claim';
import { createTeam } from '@documenso/lib/server-only/team/create-team';
import { createAdminUser } from '@documenso/lib/server-only/user/create-admin-user';
import { INTERNAL_CLAIM_ID } from '@documenso/lib/types/subscription';
import { alphaid } from '@documenso/lib/universal/id';
import { prisma } from '@documenso/prisma';
import { OrganisationMemberRole, OrganisationType, Role } from '@prisma/client';
import { Hono } from 'hono';

const sha = (s: string) => createHash('sha256').update(s).digest();

const ROLES = Object.values(OrganisationMemberRole) as string[];
const PLANS = Object.values(INTERNAL_CLAIM_ID) as string[];
const EXPIRY = ['ONE_WEEK', 'ONE_MONTH', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR'];

// Our own service accounts (serviceaccount@, deleted-account@ on the app's host) stay out of the lists.
const isServiceAccount = (email: string) =>
  email.endsWith(`@${new URL(process.env.NEXT_PUBLIC_WEBAPP_URL ?? 'http://localhost').hostname}`);

const userView = async (id: number) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { organisationMember: { include: { organisation: { select: { id: true, name: true, type: true } } } } },
  });

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    admin: u.roles.includes(Role.ADMIN),
    verified: !!u.emailVerified,
    passwordSet: !!u.password,
    disabled: u.disabled,
    organisations: u.organisationMember.map((m) => m.organisation),
  };
};

const applyPlan = async (organisationId: string, plan: string) => {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  const claim = await getSubscriptionClaim(plan);

  await prisma.organisationClaim.update({
    where: { id: org.organisationClaimId },
    data: { ...createOrganisationClaimUpsertData(claim), originalSubscriptionClaimId: claim.id },
  });
};

const groupsOf = async (organisationId: string) => prisma.organisationGroup.findMany({ where: { organisationId } });

export const shiftstoneAdminRoute = new Hono()
  .use('*', async (c, next) => {
    const secret = process.env.SHIFTSTONE_ADMIN_TOKEN;

    if (!secret) {
      return c.text('Not found', 404);
    }

    const given = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');

    if (!timingSafeEqual(sha(given), sha(secret))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  })

  .get('/users', async (c) => {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, email: true } });

    return c.json(await Promise.all(users.filter((u) => !isServiceAccount(u.email)).map((u) => userView(u.id))));
  })

  .post('/users', async (c) => {
    const body = await c.req.json<{
      email?: string;
      name?: string;
      admin?: boolean;
      organisationId?: string;
      role?: string;
    }>();
    const email = body.email?.trim().toLowerCase();

    if (!email || !email.includes('@') || !body.name?.trim()) {
      return c.json({ error: 'email and name are required' }, 400);
    }

    const role = (body.role ?? 'MEMBER').toUpperCase();

    if (!ROLES.includes(role)) {
      return c.json({ error: `role must be one of ${ROLES.join(', ')}` }, 400);
    }

    if (body.organisationId && !(await prisma.organisation.findUnique({ where: { id: body.organisationId } }))) {
      return c.json({ error: 'organisation not found' }, 404);
    }

    if (await prisma.user.findFirst({ where: { email } })) {
      return c.json({ error: 'a user with this email already exists' }, 409);
    }

    const user = await createAdminUser({ email, name: body.name.trim() });

    if (body.organisationId) {
      await addUserToOrganisation({
        userId: user.id,
        organisationId: body.organisationId,
        organisationGroups: await groupsOf(body.organisationId),
        organisationMemberRole: role as OrganisationMemberRole,
        bypassEmail: true,
      });
    } else {
      await createPersonalOrganisation({ userId: user.id, throwErrorOnOrganisationCreationFailure: true });
    }

    if (body.admin) {
      await prisma.user.update({ where: { id: user.id }, data: { roles: [Role.USER, Role.ADMIN] } });
    }

    await jobsClient.triggerJob({ name: 'send.admin.user.created.email', payload: { userId: user.id } });

    return c.json(await userView(user.id), 201);
  })

  .patch('/users/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ admin?: boolean; disabled?: boolean; name?: string }>();
    const user = Number.isInteger(id) ? await prisma.user.findUnique({ where: { id } }) : null;

    if (!user) {
      return c.json({ error: 'user not found' }, 404);
    }

    await prisma.user.update({
      where: { id },
      data: {
        ...(body.admin === undefined ? {} : { roles: body.admin ? [Role.USER, Role.ADMIN] : [Role.USER] }),
        ...(body.disabled === undefined ? {} : { disabled: body.disabled }),
        ...(body.name ? { name: body.name.trim() } : {}),
      },
    });

    if (body.disabled) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    return c.json(await userView(id));
  })

  .get('/orgs', async (c) => {
    const orgs = await prisma.organisation.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        organisationClaim: true,
        teams: { select: { id: true, name: true, url: true } },
        owner: { select: { email: true } },
        members: { include: { user: { select: { id: true, email: true } } } },
      },
    });

    return c.json(
      orgs
        .filter((o) => !isServiceAccount(o.owner.email))
        .map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          owner: o.owner.email,
          plan: o.organisationClaim.originalSubscriptionClaimId,
          memberLimit: o.organisationClaim.memberCount,
          teams: o.teams,
          members: o.members.map((m) => m.user),
        })),
    );
  })

  .post('/orgs', async (c) => {
    const body = await c.req.json<{ name?: string; ownerEmail?: string; plan?: string }>();
    const plan = body.plan ?? INTERNAL_CLAIM_ID.ENTERPRISE;
    const owner = body.ownerEmail
      ? await prisma.user.findFirst({ where: { email: body.ownerEmail.toLowerCase() } })
      : null;

    if (!body.name?.trim() || !owner) {
      return c.json({ error: 'name and an existing ownerEmail are required' }, 400);
    }

    if (!PLANS.includes(plan)) {
      return c.json({ error: `plan must be one of ${PLANS.join(', ')}` }, 400);
    }

    const organisation = await createOrganisation({
      userId: owner.id,
      name: body.name.trim(),
      type: OrganisationType.ORGANISATION,
      claim: await getSubscriptionClaim(plan),
    });

    const teamUrl = `${
      body.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'team'
    }-${alphaid(4).toLowerCase()}`;

    await createTeam({
      userId: owner.id,
      teamName: body.name.trim(),
      teamUrl,
      organisationId: organisation.id,
      inheritMembers: true,
    });

    return c.json({ id: organisation.id, name: organisation.name, plan, teamUrl }, 201);
  })

  .patch('/orgs/:id', async (c) => {
    const { plan } = await c.req.json<{ plan?: string }>();

    if (!plan || !PLANS.includes(plan)) {
      return c.json({ error: `plan must be one of ${PLANS.join(', ')}` }, 400);
    }

    if (!(await prisma.organisation.findUnique({ where: { id: c.req.param('id') } }))) {
      return c.json({ error: 'organisation not found' }, 404);
    }

    await applyPlan(c.req.param('id'), plan);

    return c.json({ id: c.req.param('id'), plan });
  })

  .post('/orgs/:id/members', async (c) => {
    const organisationId = c.req.param('id');
    const body = await c.req.json<{ email?: string; role?: string }>();
    const role = (body.role ?? 'MEMBER').toUpperCase();
    const user = body.email ? await prisma.user.findFirst({ where: { email: body.email.toLowerCase() } }) : null;

    if (!user) {
      return c.json({ error: 'user not found (create them first)' }, 404);
    }

    if (!ROLES.includes(role)) {
      return c.json({ error: `role must be one of ${ROLES.join(', ')}` }, 400);
    }

    if (await prisma.organisationMember.findFirst({ where: { organisationId, userId: user.id } })) {
      return c.json({ error: 'already a member' }, 409);
    }

    await addUserToOrganisation({
      userId: user.id,
      organisationId,
      organisationGroups: await groupsOf(organisationId),
      organisationMemberRole: role as OrganisationMemberRole,
      bypassEmail: true,
    });

    return c.json(await userView(user.id), 201);
  })

  .post('/tokens', async (c) => {
    const body = await c.req.json<{ email?: string; teamId?: number; name?: string; expiresIn?: string | null }>();
    const user = body.email ? await prisma.user.findFirst({ where: { email: body.email.toLowerCase() } }) : null;

    if (!user || !body.name?.trim()) {
      return c.json({ error: 'an existing email and a token name are required' }, 400);
    }

    if (body.expiresIn && !EXPIRY.includes(body.expiresIn)) {
      return c.json({ error: `expiresIn must be one of ${EXPIRY.join(', ')} (or null for none)` }, 400);
    }

    const teamId =
      body.teamId ??
      (
        await prisma.team.findFirst({
          where: { organisation: { members: { some: { userId: user.id } } } },
          orderBy: { createdAt: 'asc' },
        })
      )?.id;

    if (!teamId) {
      return c.json({ error: 'this user has no team' }, 404);
    }

    const token = await createApiToken({
      userId: user.id,
      teamId,
      tokenName: body.name.trim(),
      expiresIn: body.expiresIn ?? null,
    });

    return c.json({ id: token.id, teamId, token: token.token }, 201);
  });
