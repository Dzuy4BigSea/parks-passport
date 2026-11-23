import { html } from './html.js';

// Branded transactional emails (Gulf Pop). Email clients ignore most modern CSS, so this is a
// table layout with inline styles, web-safe fonts, solid colors (no gradients) and a PNG logo
// from the site. Every email also has a plain-text version, sent first.

const C = {
  sand: '#f6f1e7', ink: '#0e2a33', muted: '#4a5f66', line: '#e2d9c8',
  aqua: '#00b3a4', aquaInk: '#00756c', pink: '#ff4d88', pinkInk: '#c8155a', sun: '#ffc83d',
};
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Bricolage Grotesque', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * layout({ baseUrl, preheader, heading, paragraphs, button: { label, url, danger? }, note, tagline }) -> HTML string.
 * `paragraphs` are plain strings (escaped); `button.url` is shown again as a copyable link.
 */
export function emailLayout({ baseUrl, preheader, heading, paragraphs = [], button = null, note = '', tagline = '' }) {
  const host = (() => { try { return new URL(baseUrl).host; } catch { return 'Parks Passport'; } })();
  // Destructive actions get the deep pink with white text (5.7:1); everything else the bright pink with ink.
  const btnBg = button?.danger ? C.pinkInk : C.pink;
  const btnInk = button?.danger ? '#ffffff' : C.ink;
  const p = (text, extra = '') => html`<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${C.ink};${extra}">${text}</p>`;
  return String(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${C.sand};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.sand};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.sand};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 18px;">
        <a href="${baseUrl}/" style="text-decoration:none;color:${C.ink};">
          <img src="${baseUrl}/icons/icon-192.png" width="40" height="40" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:12px;">
          <span style="display:inline-block;vertical-align:middle;margin-left:10px;font:800 20px/1 ${DISPLAY};color:${C.ink};letter-spacing:-0.3px;">Parks Passport</span>
        </a>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${C.line};border-radius:20px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td height="6" style="height:6px;line-height:6px;font-size:0;background:${C.aqua};width:34%;">&nbsp;</td>
            <td height="6" style="height:6px;line-height:6px;font-size:0;background:${C.pink};width:33%;">&nbsp;</td>
            <td height="6" style="height:6px;line-height:6px;font-size:0;background:${C.sun};width:33%;">&nbsp;</td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:28px 28px 8px;">
            <h1 style="margin:0 0 16px;font:800 26px/1.2 ${DISPLAY};color:${C.ink};letter-spacing:-0.4px;">${heading}</h1>
            ${paragraphs.map((t) => p(t))}
            ${button ? html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
              <tr><td align="center" bgcolor="${btnBg}" style="border-radius:999px;background:${btnBg};">
                <a href="${button.url}" style="display:inline-block;padding:14px 28px;font:700 16px/1 ${FONT};color:${btnInk};text-decoration:none;border-radius:999px;">${button.label}${button.danger ? '' : html`&nbsp;&rarr;`}</a>
              </td></tr>
            </table>
            <p style="margin:0 0 6px;font:13px/1.5 ${FONT};color:${C.muted};">Button not working? Copy this link into your browser:</p>
            <p style="margin:0 0 20px;font:13px/1.5 ${FONT};word-break:break-all;"><a href="${button.url}" style="color:${C.aquaInk};">${button.url}</a></p>` : ''}
            ${note ? html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
              <tr><td style="background:#fff6dc;border-radius:12px;padding:12px 14px;font:14px/1.5 ${FONT};color:${C.ink};">${note}</td></tr>
            </table>` : ''}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 8px 0;font:13px/1.6 ${FONT};color:${C.muted};">
        ${tagline ? html`<p style="margin:0 0 6px;font-weight:700;color:${C.ink};">Made for the ${tagline}.</p>` : ''}
        <p style="margin:0 0 6px;">An independent project. Not affiliated with the City of St. Petersburg.</p>
        <p style="margin:0 0 14px;"><a href="${baseUrl}/" style="color:${C.aquaInk};">${host}</a> &middot; <a href="${baseUrl}/privacy" style="color:${C.aquaInk};">Privacy</a></p>
        <p style="margin:0;padding-top:12px;border-top:1px solid ${C.line};font:12px/1.6 ${FONT};color:${C.muted};">&copy; ${new Date().getFullYear()} Parks Passport &middot; Purpose built by <a href="https://bigsea.co" style="font:800 15px/1 ${DISPLAY};letter-spacing:-0.4px;color:${C.ink};text-decoration:none;">big sea</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`);
}

const EXPIRES = 'This link works once and expires in 15 minutes.';

// Each builder returns { subject, text, html }. The text versions keep the link as the first URL.
export function magicLinkEmail({ baseUrl, subject, name, url, tagline }) {
  return {
    subject,
    text: `Hi ${name},\n\nSign in to Parks Passport:\n${url}\n\n${EXPIRES} If you didn't ask for it, ignore this email.\n`,
    html: emailLayout({
      baseUrl, tagline, preheader: 'Your one-tap sign-in link. It expires in 15 minutes.',
      heading: 'Your sign-in link',
      paragraphs: [`Hi ${name},`, 'Tap the button to sign in to your passport. No password needed.'],
      button: { label: 'Sign in to Parks Passport', url },
      note: `${EXPIRES} If you didn't ask for it, you can ignore this email.`,
    }),
  };
}

export function passwordResetEmail({ baseUrl, subject, name, url, tagline }) {
  return {
    subject,
    text: `Hi ${name},\n\nChoose a new password:\n${url}\n\n${EXPIRES} If you didn't ask for it, ignore this email; your password hasn't changed.\n`,
    html: emailLayout({
      baseUrl, tagline, preheader: 'Choose a new password. The link expires in 15 minutes.',
      heading: 'Reset your password',
      paragraphs: [`Hi ${name},`, 'Tap the button to choose a new password for your passport.'],
      button: { label: 'Choose a new password', url },
      note: `${EXPIRES} If you didn't ask for it, ignore this email; your password hasn't changed.`,
    }),
  };
}

export function deleteAccountEmail({ baseUrl, subject, name, url, tagline }) {
  return {
    subject,
    text: `Hi ${name},\n\nTo permanently delete your account and everything in it, open:\n${url}\n\n${EXPIRES} If you didn't ask for this, ignore this email.\n`,
    html: emailLayout({
      baseUrl, tagline, preheader: 'Confirm deleting your Parks Passport account.',
      heading: 'Confirm deleting your account',
      paragraphs: [`Hi ${name},`, 'This permanently deletes your account and everything in it: stamps, photos, ratings, badges and Park Pals. It can\'t be undone.'],
      button: { label: 'Yes, delete my account', url, danger: true },
      note: `${EXPIRES} If you didn't ask for this, ignore this email and your account stays as it is.`,
    }),
  };
}

export function testEmail({ baseUrl, fromName, fromAddress, tagline }) {
  return {
    subject: `${fromName}: test email`,
    text: `This is a test from Parks Passport's admin. If you're reading it, email sending works.\n\nSender: ${fromName} <${fromAddress}>\n`,
    html: emailLayout({
      baseUrl, tagline, preheader: 'Email sending works.',
      heading: 'Email sending works 🎉',
      paragraphs: ['This is a test from the Parks Passport admin. If you\'re reading it, sign-in links, password resets and account emails will reach people too.',
        `Sender: ${fromName} <${fromAddress}>`],
    }),
  };
}
