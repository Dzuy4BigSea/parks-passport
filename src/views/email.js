import { html } from './html.js';
import { EMAIL_KINDS } from '../domain/email-copy.js';

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
        <p style="margin:0 0 6px;">An independent project. Not affiliated with any city government.</p>
        <p style="margin:0 0 14px;"><a href="${baseUrl}/" style="color:${C.aquaInk};">${host}</a> &middot; <a href="${baseUrl}/privacy" style="color:${C.aquaInk};">Privacy</a></p>
        <p style="margin:0;padding-top:12px;border-top:1px solid ${C.line};font:12px/1.6 ${FONT};color:${C.muted};">&copy; ${new Date().getFullYear()} Parks Passport &middot; <a href="https://bigsea.co" style="color:${C.muted};text-decoration:none;">Purpose built by&nbsp;<img src="${baseUrl}/brand/bigsea-logo.png" width="54" height="15" alt="Big Sea" style="display:inline-block;vertical-align:middle;border:0;height:15px;width:54px;opacity:0.75;"></a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`);
}

// Member emails: wording from Admin › Email › Messages (domain/email-copy.js), defaults otherwise.
// {name} and {inviter} placeholders; values are escaped later with everything else.
const fill = (text, vars) => String(text).replace(/\{(name|inviter)\}/g, (_, k) => vars[k] ?? '');
// Blank lines split paragraphs; single line breaks stay as <br>. Everything is escaped.
const paragraphsOf = (body, vars) => fill(body, vars).split(/\n{2,}/).map((para) => {
  const lines = para.split('\n');
  return html`${lines.map((l, i) => (i ? html`<br>${l}` : l))}`;
});

/** { subject, text, html } for one member email. copy = { subject, preheader, heading, body, button, note }. */
export function memberEmail({ kind, copy, baseUrl, tagline, name, url, inviter = '' }) {
  const def = EMAIL_KINDS[kind];
  const c = { ...def.defaults, ...copy };
  const vars = { name, inviter };
  const note = fill(c.note, vars);
  return {
    subject: fill(c.subject, vars),
    // Plain text: the link is the first URL, so text-only mail apps and tests find it.
    text: `${fill(c.body, vars)}\n\n${c.button}:\n${url}\n${note ? `\n${note}\n` : ''}`,
    html: emailLayout({
      baseUrl, tagline, preheader: fill(c.preheader, vars), heading: fill(c.heading, vars),
      paragraphs: paragraphsOf(c.body, vars), button: { label: c.button, url, danger: def.danger }, note,
    }),
  };
}

// Shortcuts used by the auth routes and tests; `copy` defaults to the shipped wording.
export const magicLinkEmail = ({ subject, copy = {}, ...o }) => memberEmail({ ...o, kind: 'magic_link', copy: { subject, ...copy } });
export const passwordResetEmail = ({ subject, copy = {}, ...o }) => memberEmail({ ...o, kind: 'password_reset', copy: { subject, ...copy } });
export const deleteAccountEmail = ({ subject, copy = {}, ...o }) => memberEmail({ ...o, kind: 'delete_account', copy: { subject, ...copy } });

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
