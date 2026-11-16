import type { SentMessageInfo, Transport } from 'nodemailer';
import type MailMessage from 'nodemailer/lib/mailer/mail-message';

/**
 * Shiftstone: sends through the Gmail API as the mailbox that approved it (hello@shiftstone.ai), using an OAuth
 * refresh token limited to gmail.send. No SMTP password or service account key needed.
 *
 * NEXT_PRIVATE_SMTP_TRANSPORT=gmail-api
 * NEXT_PRIVATE_GMAIL_OAUTH=<base64 or raw JSON {client_id, client_secret, refresh_token}>
 */
type Callback = Parameters<Transport<SentMessageInfo>['send']>[1];
type GmailOAuth = { client_id: string; client_secret: string; refresh_token: string };

let cached: { token: string; until: number } | null = null;

const accessToken = async (o: GmailOAuth) => {
  if (cached && cached.until > Date.now() + 60_000) {
    return cached.token;
  }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', ...o }),
  });
  const out = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };

  if (!r.ok || !out.access_token) {
    throw new Error(`Google sign-in refused: ${out.error ?? r.status}`);
  }

  cached = { token: out.access_token, until: Date.now() + (out.expires_in ?? 3600) * 1000 };

  return out.access_token;
};

export class GmailApiTransport implements Transport<SentMessageInfo> {
  public name = 'GmailApiTransport';
  public version = '1.0.0';

  private _oauth: GmailOAuth;

  public static makeTransport(raw: string) {
    const json = raw.trim().startsWith('{') ? raw : atob(raw.trim());

    return new GmailApiTransport(JSON.parse(json) as GmailOAuth);
  }

  constructor(oauth: GmailOAuth) {
    if (!oauth.client_id || !oauth.client_secret || !oauth.refresh_token) {
      throw new Error('NEXT_PRIVATE_GMAIL_OAUTH needs client_id, client_secret and refresh_token');
    }

    this._oauth = oauth;
  }

  public send(mail: MailMessage, callback: Callback) {
    // Gmail reads Bcc from the raw message (and strips it before delivery).
    mail.message.keepBcc = true;

    mail.message.build((buildError, message) => {
      if (buildError) {
        return callback(buildError);
      }

      void accessToken(this._oauth)
        .then(async (token) =>
          fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: message.toString('base64url') }),
          }),
        )
        .then(async (r) => {
          if (!r.ok) {
            throw new Error(`Gmail send refused: ${r.status} ${(await r.text()).slice(0, 200)}`);
          }

          const sent = (await r.json()) as { id: string };

          callback(null, { messageId: sent.id, envelope: mail.message.getEnvelope() });
        })
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        .catch((error: Error) => callback(error as Parameters<Callback>[0]));
    });
  }
}
