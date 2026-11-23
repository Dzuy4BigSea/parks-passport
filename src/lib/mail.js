import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * mailer.send({ to, subject, text }) -> Promise. Throws on failure.
 *  - 'outbox': writes .eml files to outboxDir (dev and tests).
 *  - 'sendgrid': SendGrid v3 API.
 * resolve() is called on every send and returns { apiKey, fromAddress, fromName, replyTo },
 * so settings saved in the admin apply immediately.
 */
export function createMailer({ transport, outboxDir, resolve, fetchImpl = fetch }) {
  if (transport === 'outbox') {
    return {
      transport,
      async send({ to, subject, text }) {
        const { fromAddress, fromName, replyTo } = resolve();
        fs.mkdirSync(outboxDir, { recursive: true });
        const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.eml`;
        const headers = [`From: ${fromName} <${fromAddress}>`, `To: ${to}`, `Subject: ${subject}`,
          ...(replyTo ? [`Reply-To: ${replyTo}`] : []), `Date: ${new Date().toUTCString()}`];
        fs.writeFileSync(path.join(outboxDir, name), `${headers.join('\n')}\n\n${text}\n`);
      },
    };
  }
  if (transport === 'sendgrid') {
    return {
      transport,
      async send({ to, subject, text }) {
        const { apiKey, fromAddress, fromName, replyTo } = resolve();
        if (!apiKey) throw new Error('No SendGrid API key: add one in Admin › Email or SENDGRID_API_KEY in .env');
        if (!fromAddress) throw new Error('No sender address: set it in Admin › Email or MAIL_FROM in .env');
        const res = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: fromAddress, name: fromName },
            ...(replyTo ? { reply_to: { email: replyTo } } : {}),
            subject,
            content: [{ type: 'text/plain', value: text }],
            tracking_settings: { click_tracking: { enable: false, enable_text: false } },
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const err = new Error(`SendGrid responded ${res.status}`);
          err.detail = detail.slice(0, 300);
          throw err;
        }
      },
    };
  }
  throw new Error(`Unknown MAIL_TRANSPORT "${transport}"`);
}
