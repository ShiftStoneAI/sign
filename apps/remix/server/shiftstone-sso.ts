/**
 * Shiftstone: sign in through admin.shiftstone.ai (Wen, 2026-11-16). The admin vouches for the person with a one-minute
 * token and sends them to
 *
 *   GET /api/shiftstone/sso?t=<token>[&envelope=<envelopeId> | &next=<relative path>]
 *
 * token = base64url(JSON {email, name, exp}) + "." + base64url(HMAC-SHA256(SHIFTSTONE_SSO_SECRET, first part)), the
 * same shape as the admin's Taste Vault handoff (workshop: src/lib/apps.ts). Only emails on SHIFTSTONE_SSO_EMAILS get
 * in. A first visit creates the account (verified, no password) in the shared organisation (SHIFTSTONE_ORG_ID, else
 * the oldest shared one). Without SHIFTSTONE_SSO_SECRET the route answers 404.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { onAuthorize } from '@documenso/auth/server/lib/utils/authorizer';
import type { HonoAuthContext } from '@documenso/auth/server/types/context';
import { addUserToOrganisation } from '@documenso/lib/server-only/organisation/accept-organisation-invitation';
import { createAdminUser } from '@documenso/lib/server-only/user/create-admin-user';
import { extractRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, EnvelopeType, OrganisationMemberRole, OrganisationType } from '@prisma/client';
import { Hono } from 'hono';

type Claims = { email: string; name: string; exp: number };

/** The token's claims, or null if it's forged, malformed or expired. Exported for tests. */
export const verifySsoToken = (token: string, secret: string, now = Date.now()): Claims | null => {
  const [body, sig, extra] = token.split('.');

  if (!body || !sig || extra !== undefined) {
    return null;
  }

  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');

  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return null;
  }

  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Claims>;

    // One minute, as issued; anything further out than two is not a token the admin made.
    if (typeof c.email !== 'string' || typeof c.exp !== 'number' || c.exp < now || c.exp > now + 120_000) {
      return null;
    }

    return { email: c.email.trim().toLowerCase(), name: typeof c.name === 'string' ? c.name : '', exp: c.exp };
  } catch {
    return null;
  }
};

/** A same-site path to land on: starts with one "/", no scheme or host. */
export const safeNext = (next: string | undefined) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null;

const allowed = () =>
  (process.env.SHIFTSTONE_SSO_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** The organisation everyone works in, with its first team. */
export const sharedOrganisation = async () =>
  prisma.organisation.findFirst({
    where: process.env.SHIFTSTONE_ORG_ID
      ? { id: process.env.SHIFTSTONE_ORG_ID }
      : { type: OrganisationType.ORGANISATION },
    orderBy: { createdAt: 'asc' },
    include: { teams: { orderBy: { id: 'asc' }, take: 1 }, groups: true },
  });

const page = (title: string, text: string, status: 403 | 404) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#e9ebe8;color:#111;display:grid;place-items:center;min-height:100dvh;margin:0;padding:16px">
<main style="max-width:420px;text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></main>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

export const shiftstoneSsoRoute = new Hono<HonoAuthContext>()
  .use('*', async (c, next) => {
    c.set('requestMetadata', extractRequestMetadata(c.req.raw));
    await next();
  })
  .get('/', async (c) => {
    const secret = process.env.SHIFTSTONE_SSO_SECRET;

    if (!secret || secret.length < 32) {
      return c.text('Not found', 404);
    }

    const admin = (process.env.SHIFTSTONE_ADMIN_URL ?? 'https://admin.shiftstone.ai').replace(/\/+$/, '');
    const again = `Open Sign again from <a href="${admin}/admin/apps/sign" style="color:#0b6b63">the admin</a>.`;
    const claims = verifySsoToken(c.req.query('t') ?? '', secret);

    if (!claims) {
      return page('That link has expired', `Sign-in links from the admin last one minute. ${again}`, 403);
    }

    if (!allowed().includes(claims.email)) {
      return page('No access to Sign', 'Sign is open to the Shiftstone team. Ask Wen if you need it.', 403);
    }

    const org = await sharedOrganisation();

    if (!org) {
      return page('Sign isn’t set up yet', 'There is no shared organisation to join.', 404);
    }

    let user = await prisma.user.findFirst({ where: { email: claims.email } });

    if (!user) {
      user = await createAdminUser({ email: claims.email, name: claims.name || claims.email.split('@')[0] });
    }

    if (user.disabled) {
      return page('Account disabled', 'Your Sign account is switched off. Ask Wen.', 403);
    }

    const member = await prisma.organisationMember.findFirst({ where: { organisationId: org.id, userId: user.id } });

    if (!member) {
      await addUserToOrganisation({
        userId: user.id,
        organisationId: org.id,
        organisationGroups: org.groups,
        organisationMemberRole: OrganisationMemberRole.MEMBER,
        bypassEmail: true,
      });
    }

    await onAuthorize({ userId: user.id }, c);

    const team = org.teams[0];
    let to = safeNext(c.req.query('next')) ?? (team ? `/t/${team.url}/documents` : '/');
    const envelopeId = c.req.query('envelope');

    if (envelopeId && /^envelope_[a-z0-9]+$/.test(envelopeId)) {
      const envelope = await prisma.envelope.findFirst({
        where: { id: envelopeId },
        select: { id: true, type: true, status: true, team: { select: { url: true } } },
      });

      if (envelope) {
        const kind = envelope.type === EnvelopeType.TEMPLATE ? 'templates' : 'documents';
        to = `/t/${envelope.team.url}/${kind}/${envelope.id}${envelope.status === DocumentStatus.DRAFT ? '/edit' : ''}`;
      }
    }

    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');

    return c.redirect(to, 302);
  });
