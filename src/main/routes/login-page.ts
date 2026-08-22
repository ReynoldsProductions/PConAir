/**
 * Shared markup for the three server-rendered PIN sign-in pages (operator,
 * admin, web remote).
 *
 * These used to be three near-identical copies of the same inline CSS that had
 * drifted apart: operator was light while admin and remote were dark, so a
 * light app was reached through a dark door. They render light here, matching
 * the web UIs' default theme.
 *
 * Deliberately light-only: the pages are served before any session exists, and
 * the remote's CSP (`script-src 'self'`) rules out the inline snippet the other
 * UIs use to read a stored theme preference. A brief light sign-in screen ahead
 * of a dark console is a smaller wart than an unstyled flash or a CSP hole.
 */

export interface LoginPageOptions {
  /** Browser tab title. */
  title: string;
  /** Heading shown above the form. */
  heading: string;
  /** Short explanatory line under the heading. */
  intro: string;
  /** Form POST target, e.g. `/auth/admin/browser`. */
  action: string;
  /** Visible label for the PIN field, e.g. 'Admin PIN'. */
  pinLabel: string;
  /** Error/hint text shown above the form. Escaped here — pass it raw. */
  message?: string;
  /** Optional `next` hidden field, used by the remote to return to /remote/. */
  next?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGIN_CSS = `
    body { font-family: system-ui, sans-serif; background: #fbf8f6; color: #333; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .box { background: #fff; border: 1px solid #dfe0e1; border-radius: 4px; padding: 28px 32px; max-width: 22rem; width: 100%; box-sizing: border-box; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
    p.sub { font-size: 13px; color: #757575; margin: 0 0 20px; line-height: 1.45; }
    .err { color: #921100; font-size: 13px; margin: 0 0 14px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 16px; border: 1px solid #dfe0e1; border-radius: 4px; margin-bottom: 16px; }
    button { width: 100%; padding: 10px 16px; font-size: 14px; font-weight: 600; border: none; border-radius: 4px; background: #333; color: #fff; cursor: pointer; }
    button:hover { background: #000; }`;

export function renderLoginPage(opts: LoginPageOptions): string {
  const msg = opts.message ? `<p class="err">${escapeHtml(opts.message)}</p>` : '';
  const nextField = opts.next
    ? `<input type="hidden" name="next" value="${escapeHtml(opts.next)}" />\n      `
    : '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  <style>${LOGIN_CSS}
  </style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(opts.heading)}</h1>
    <p class="sub">${escapeHtml(opts.intro)}</p>
    ${msg}
    <form method="post" action="${escapeHtml(opts.action)}" autocomplete="off">
      ${nextField}<label for="pin">${escapeHtml(opts.pinLabel)}</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" required autofocus />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}
