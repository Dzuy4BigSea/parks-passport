import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * mailer.send({ to, subject, text }) -> Promise. Throws on failure.
 *  - 'outbox': writes .eml files to outboxDir (dev and tests).
 *  - 'sendgrid': SendGrid v3 API.
 */
export function createMailer({ transport, outboxDir, sendgridApiKey, from, fetchImpl = fetch }) {
  if (transport === 'outbox') {
    return {
      transport,
      async send({ to, subject, text }) {
        fs.mkdirSync(outboxDir, { recursive: true });
        const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.eml`;
        const eml = `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${new Date().toUTCString()}\n\n${text}\n`;
        fs.writeFileSync(path.join(outboxDir, name), eml);
      },
    };
  }
  if (transport === 'sendgrid') {
    if (!sendgridApiKey) {
      // Start anyway; the app shows "Couldn't send email" until the key is set.
      console.warn('SENDGRID_API_KEY is not set: emails will fail until it is.');
      return { transport, async send() { throw new Error('SENDGRID_API_KEY is not set'); } };
    }
    return {
      transport,
      async send({ to, subject, text }) {
        const res = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sendgridApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from, name: 'Parks Passport' },
            subject,
            content: [{ type: 'text/plain', value: text }],
            tracking_settings: { click_tracking: { enable: false, enable_text: false } },
          }),
        });
        if (!res.ok) throw new Error(`SendGrid responded ${res.status}`);
      },
    };
  }
  throw new Error(`Unknown MAIL_TRANSPORT "${transport}"`);
}
