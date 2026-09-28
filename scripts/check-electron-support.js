#!/usr/bin/env node
// Compares the installed Electron major against Electron's supported line
// (the latest three majors) and opens or updates a dated GitHub issue when we
// fall outside it. Run monthly by .github/workflows/dependency-currency.yml.
//
// Exits 0 whether or not we are in support — this reports, it does not gate.
// A red scheduled job is easy to ignore; a dated issue is not.
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const SUPPORTED_MAJORS = 3; // Electron supports the latest three majors.
const MARKER = '<!-- electron-support-window-check -->';

function installedMajor() {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const entry = lock.packages && lock.packages['node_modules/electron'];
  if (!entry || !entry.version) throw new Error('electron not found in package-lock.json');
  return { major: Number(entry.version.split('.')[0]), version: entry.version };
}

async function releaseIndex() {
  const res = await fetch('https://releases.electronjs.org/releases.json');
  if (!res.ok) throw new Error(`releases.json returned ${res.status}`);
  const all = await res.json();
  const firstStable = new Map();
  for (const r of all) {
    const v = String(r.version);
    if (v.includes('-')) continue; // skip alpha/beta
    const major = Number(v.split('.')[0]);
    const date = new Date(r.date || r.published_at || 0);
    const prev = firstStable.get(major);
    if (!prev || date < prev) firstStable.set(major, date);
  }
  return firstStable;
}

function upsertIssue(title, body) {
  const existing = JSON.parse(
    execFileSync('gh', ['issue', 'list', '--state', 'open', '--limit', '100',
                        '--json', 'number,body'], { encoding: 'utf8' })
  ).find((i) => i.body && i.body.includes(MARKER));

  if (existing) {
    execFileSync('gh', ['issue', 'comment', String(existing.number), '--body', body],
                 { stdio: 'inherit' });
    console.log(`Updated existing issue #${existing.number}`);
  } else {
    execFileSync('gh', ['issue', 'create', '--title', title, '--body', body],
                 { stdio: 'inherit' });
    console.log('Opened a new issue');
  }
}

(async () => {
  const { major, version } = installedMajor();
  const firstStable = await releaseIndex();
  const latest = Math.max(...firstStable.keys());
  const oldestSupported = latest - (SUPPORTED_MAJORS - 1);

  if (major >= oldestSupported) {
    console.log(`OK: Electron ${version} is inside the supported line (${oldestSupported}-${latest}).`);
    return;
  }

  // The day we fell out of support is the day (major + SUPPORTED_MAJORS) shipped.
  const fellOutAt = firstStable.get(major + SUPPORTED_MAJORS);
  const daysOut = fellOutAt
    ? Math.round((Date.now() - fellOutAt.getTime()) / 86400000)
    : null;

  const body = [
    MARKER,
    `**Electron ${version} is outside the supported line.**`,
    '',
    `| | |`,
    `|---|---|`,
    `| Installed | ${version} (major ${major}) |`,
    `| Supported majors | ${oldestSupported}–${latest} |`,
    `| Majors behind | ${latest - major} |`,
    fellOutAt ? `| Unsupported since | ${fellOutAt.toISOString().slice(0, 10)} |` : null,
    daysOut !== null ? `| Days unsupported | ${daysOut} |` : null,
    '',
    'An unsupported Electron receives no security backports. See',
    '`docs/plans/2026-09-28-electron-44-migration.md` for the upgrade procedure',
    'and `docs/plans/2026-09-28-dependency-currency.md` for the cadence policy.',
    '',
    `_Checked ${new Date().toISOString().slice(0, 10)} by the dependency-currency workflow._`,
    // Drop only the omitted conditional rows. NOT .filter(Boolean) — that
    // would also strip the intentional '' blank lines and collapse the
    // markdown table into the paragraph above it.
  ].filter((line) => line !== null).join('\n');

  // Printed as well as filed, so the local verification runs in Task 5
  // Steps 2-3 can inspect the computation without touching the GitHub API.
  console.log(body);
  upsertIssue(`Electron ${major} is out of support (${latest - major} majors behind)`, body);
})().catch((err) => {
  console.error(`Support-window check failed: ${err.message}`);
  process.exit(1);
});
