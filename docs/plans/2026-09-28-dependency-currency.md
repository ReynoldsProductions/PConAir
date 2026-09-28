# Dependency Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for PConAir to drift 573 days outside Electron's support window again, without adding upkeep nobody will do.

**Architecture:** Three layers, in strict dependency order. **Layer 1** is a test gate that runs on every PR — the prerequisite, because dependency automation on a repo with no CI produces bumps nobody can validate, which is worse than no automation. **Layer 2** is grouped automated dependency PRs. **Layer 3** is a staleness alarm that opens a dated issue when the installed Electron falls outside the supported line — the piece that specifically addresses *this* failure, because the failure mode was silence. Layer 1 is worth landing immediately; Layers 2 and 3 are better after Phase 0 of the Electron migration, since until the Electron test net exists a green CI run on an Electron bump does not mean much.

**Tech Stack:** GitHub Actions · Dependabot (or Renovate) · Node 20 (→ 24 with the migration) · Vitest 2 · TypeScript 5.3

**Spec:** The **Findings** section below. Companion document to [`2026-09-28-electron-44-migration.md`](./2026-09-28-electron-44-migration.md) — that plan digs the project out of the hole; this one keeps it out.

---

## Global Constraints

- **Do not add a mechanism that needs a human to remember something.** The current state is the proof that does not work. Every layer here either blocks a merge or opens an issue by itself.
- **Layer 1 before Layers 2 and 3.** Non-negotiable ordering, for the reason in Architecture.
- **Keep CI fast.** A gate that takes ten minutes gets bypassed. Target under three.
- **No change to `forge.config.ts` packaging or the `node_modules` layout** in this plan. npm workspaces would fix the companion-module install gap more elegantly, but it changes module resolution and could affect Forge's webpack build — out of scope here, noted as a follow-up.
- **The alarm must be dated and actionable**, not a generic "deps are old" nag. It states which major is installed, which are supported, and how many days out of support.

---

## Findings

Measured on 2026-09-28 at `main` = `4c07bfb`.

### Electron's release train is a metronome

Computed from Electron's own `releases.json`, majors 29–44:

| Interval | Days |
|---|---|
| Mean days between stable majors | **62** (~8.9 weeks) |
| Observed range | 49–92 |
| Support window (latest 3 majors) | **~6 months** |

Sixteen consecutive majors, never more than 92 days apart. This is predictable, which is what makes it automatable.

### How far out we actually went

- Electron 32 shipped **2024-08-19**
- It fell out of support on **2025-03-04**, the day Electron 35 shipped
- As of 2026-09-28 that is **573 days unsupported** — about 19 months

### Why nobody noticed: nothing can notice

| Mechanism | Status on 2026-09-28 |
|---|---|
| CI running the 1218 tests on pull requests | **none** |
| CI on push to `main` | **none** |
| Any workflow at all | one — `build-release.yml`, triggered only by `v*` tags and `workflow_dispatch` |
| Dependabot / Renovate | **not configured** |
| Branch protection on `main` | **none** (`/branches/main/protection` returns 404) |

PR #61 merged on 2026-09-28 with zero automated checks; its tests were run by hand. So "are we behind?" was unanswerable until someone thought to ask, and silence read as health.

**This is the root cause.** Not neglect — absence of a mechanism. Every layer below adds one.

### A fresh clone cannot even run the suite

`packages/companion-module-pconair` is a separate, non-workspace package with its own `package-lock.json`. Root `npm ci` does not install its dependencies, so `tests/companion-defs.test.ts` fails to **load** — not fail, *load* — with `Failed to load url @companion-module/base`. Any CI job added without fixing this is red on its first run. Layer 1 fixes it.

---

## File Structure

| File | Layer | Responsibility |
|---|---|---|
| `.github/workflows/ci.yml` | 1 | Typecheck + test on every PR and every push to `main`. |
| `package.json` (`install:companion` script) | 1 | Installs the companion sub-package deps, so CI and fresh clones can both run the suite. |
| `.github/dependabot.yml` | 2 | Monthly grouped dependency PRs. Electron and the four Forge packages in one group. |
| `.github/workflows/dependency-currency.yml` | 3 | Monthly scheduled support-window check. |
| `scripts/check-electron-support.js` | 3 | The check itself: compares installed Electron major against the supported line and opens or updates a dated issue. |
| `CLAUDE.md` (one added rule) | 4 | Keeps the Electron test net from rotting as new window-manager code lands. |

---

## Agent Roster

| Agent type | Tasks | Why |
|---|---|---|
| `claude` | 1, 2, 3, 5 | Needs `Write`/`Edit`/`Bash` to add workflows and run the suite locally. |
| `general-purpose` | 4 | Needs `WebFetch` to confirm Dependabot's current grouping schema before writing the config, rather than trusting recollection of an evolving format. |
| **Human** | the cadence decision in Task 6 | Depends on the show calendar, which is not in the repo. |

**Agent briefing rule:** every dispatched agent reads this file and `docs/plans/2026-09-28-electron-44-migration.md` first.

---

## Test Strategy

The layers here *are* test infrastructure, so "testing the tests" needs to stay proportionate:

1. **Layer 1 is verified by using it.** Open the PR that adds it; the PR's own checks must run and pass. That is the test. Additionally, deliberately push a commit with a known type error to a scratch branch and confirm the gate goes red — an untested gate is an assumption.
2. **Layer 3 is verified by lying to it.** Run `scripts/check-electron-support.js` locally with a forced-old and a forced-current version and confirm it alarms in the first case and stays quiet in the second. Task 5 includes both runs. A monitor that cannot fail is not a monitor.
3. **Layer 2 needs no test** — a Dependabot PR either appears or does not, and its own CI run is the check.

---

## Layer 1 — A test gate that runs

### Task 1: Add the companion-module install script

**Agent:** `claude` · **Files:** Modify `package.json`

- [ ] **Step 1: Reproduce the failure a fresh clone sees**

```bash
rm -rf packages/companion-module-pconair/node_modules
npx vitest run tests/companion-defs.test.ts
```

Expected: `Failed to load url @companion-module/base`.

- [ ] **Step 2: Add the script**

```json
"install:companion": "npm ci --prefix packages/companion-module-pconair"
```

Placed after `test:watch` in `scripts`. A separate script rather than chained into `postinstall`: nesting `npm ci` inside a root `npm ci` leaks `npm_config_*` into the child and is a known source of confusing failures.

- [ ] **Step 3: Confirm it fixes the load failure**

```bash
npm run install:companion
npx vitest run tests/companion-defs.test.ts
```

Expected: passes.

- [ ] **Step 4: Full suite**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: 80 files, 1218 tests passing (plus any Phase 0 additions).

- [ ] **Step 5: Commit** — `build: add install:companion so a fresh clone can run the suite`

### Task 2: Add the CI workflow

**Agent:** `claude` · **Files:** Create `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a required-status-check named `test` that Task 3 can point branch protection at.

- [ ] **Step 1: Write the workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

# A second push to the same branch cancels the first — PR iteration should not
# queue up stale runs.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      # No test imports `electron`, and the TypeScript types ship inside the
      # npm package (node_modules/electron/electron.d.ts, ~1MB), not the
      # downloaded binary. Skipping the ~100MB binary costs nothing here and
      # saves most of the install time. Revisit if a test ever needs to launch
      # Electron for real.
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          # Keep in step with build-release.yml. The Electron 44 migration
          # (docs/plans/2026-09-28-electron-44-migration.md, Task 12) moves
          # every pin here to 24 at once.
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            package-lock.json
            packages/companion-module-pconair/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Install companion module dependencies
        # packages/companion-module-pconair is a separate, non-workspace
        # package, so root `npm ci` does not install its deps and
        # tests/companion-defs.test.ts fails to LOAD with
        # "Failed to load url @companion-module/base".
        run: npm run install:companion

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Test
        run: npx vitest run
```

- [ ] **Step 2: Verify the commands locally, exactly as CI runs them**

```bash
npm ci && npm run install:companion && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 3: Commit and open a PR.** The PR's own checks are the verification — confirm the `test` job appears and goes green.

- [ ] **Step 4: Prove the gate can fail**

On a scratch branch, introduce a deliberate type error, push, and confirm CI goes red:

```bash
git checkout -b scratch/verify-ci-fails
printf '\nconst broken: number = "not a number";\n' >> src/shared/types.ts
git commit -am "test: deliberately break the typecheck to verify CI fails"
git push origin scratch/verify-ci-fails
```

Open a PR from it, confirm red, then **delete the branch and close the PR without merging**. An untested gate is an assumption.

- [ ] **Step 5: Merge the CI PR.**

### Task 3: Require the check

**Agent:** `claude` (or via the GitHub UI)

- [ ] **Step 1: Enable branch protection on `main` requiring the `test` check**

```bash
gh api -X PUT repos/ReynoldsProductions/PConAir/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=test' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews=' \
  -f 'restrictions='
```

`enforce_admins=false` is deliberate: this is a small team shipping a live-production tool, and you need an escape hatch to force-push a fix during a show. The gate is there to catch inattention, not to fight you at 8pm on a show night.

- [ ] **Step 2: Verify**

```bash
gh api repos/ReynoldsProductions/PConAir/branches/main/protection --jq '.required_status_checks.contexts'
```

Expected: `["test"]`.

---

## Layer 2 — Automated dependency PRs

### Task 4: Dependabot, grouped

**Agent:** `general-purpose` (confirm the current grouping schema before writing — the format has changed across Dependabot versions)

**Files:** Create `.github/dependabot.yml`

**Prerequisite:** Layer 1 merged and green.

- [ ] **Step 1: Confirm the schema.** Fetch GitHub's current `dependabot.yml` reference and verify the `groups` key spelling and options rather than assuming.

- [ ] **Step 2: Write the config**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    open-pull-requests-limit: 3
    groups:
      # Electron and Forge MUST move together: Forge has to understand the
      # Electron version it is packaging, so a lone electron bump produces a
      # broken build and a lone Forge bump produces churn. One PR, both.
      electron-platform:
        patterns:
          - electron
          - "@electron-forge/*"
      # Everything else, batched so review is one PR rather than fifteen.
      dev-dependencies:
        dependency-type: development
        exclude-patterns:
          - electron
          - "@electron-forge/*"
    labels:
      - dependencies

  - package-ecosystem: npm
    directory: /packages/companion-module-pconair
    schedule:
      interval: monthly
    open-pull-requests-limit: 2
    labels:
      - dependencies

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    labels:
      - dependencies
```

- [ ] **Step 3: Commit and merge.** Confirm within a day that Dependabot has run (repo → Insights → Dependency graph → Dependabot) and that any PR it opens carries the CI check from Layer 1.

- [ ] **Step 4: Triage the first batch.** The first run after 573 days of drift will open the maximum number of PRs. Expect noise once; merge what is green, close what is not, and note anything needing manual work.

**Note on the Electron group:** Dependabot will offer Electron 33, 34, 35… one major at a time, and each will be a large PR. **Do not merge those blind.** Until the migration plan's Phase 0 test net exists, a green CI on an Electron major bump means only "the Express layer still works." Treat Electron-group PRs as a *signal to schedule the upgrade*, not as something to merge on sight.

---

## Layer 3 — The staleness alarm

This is the layer that addresses the actual failure. Layers 1 and 2 would have made the upgrade *easier*; only this one makes the drift *visible*.

### Task 5: Support-window check

**Agent:** `claude` · **Files:** Create `scripts/check-electron-support.js`, `.github/workflows/dependency-currency.yml`

- [ ] **Step 1: Write the check script**

```js
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
```

- [ ] **Step 2: Prove it alarms — feed it an old version**

```bash
cp package-lock.json /tmp/lock-backup.json
node -e "
const fs=require('fs');const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
l.packages['node_modules/electron'].version='32.3.3';
fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2));
"
GH_TOKEN=dummy node scripts/check-electron-support.js
```

Expected: it computes "out of support" and *attempts* the `gh` call (which fails with a dummy token — that is fine; you are verifying the detection and the body text, not the API call). Confirm the printed body shows the right majors and day count.

- [ ] **Step 3: Prove it stays quiet — feed it a current version**

```bash
node -e "
const fs=require('fs');const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
l.packages['node_modules/electron'].version='44.4.5';
fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2));
"
node scripts/check-electron-support.js
```

Expected: `OK: Electron 44.4.5 is inside the supported line (42-44).` and no `gh` call.

- [ ] **Step 4: Restore the lockfile**

```bash
cp /tmp/lock-backup.json package-lock.json
git diff --exit-code package-lock.json && echo "lockfile restored cleanly"
```

- [ ] **Step 5: Write the workflow**

```yaml
name: Dependency currency

on:
  schedule:
    # 09:00 UTC on the 1st of each month. Monthly, not weekly: the thing being
    # watched moves every ~62 days, so a weekly check is eleven redundant runs
    # for every useful one, and noise is how alarms get ignored.
    - cron: '0 9 1 * *'
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  electron-support-window:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Check the Electron support window
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/check-electron-support.js
```

- [ ] **Step 6: Commit, merge, then trigger it once by hand**

```bash
gh workflow run "Dependency currency"
gh run list --workflow "Dependency currency" --limit 1
```

While still on Electron 32 this should open a real issue reporting ~573 days out of support. That issue is the proof the alarm works — leave it open until the migration lands.

---

## Layer 4 — Keep the net from rotting

### Task 6: Cadence policy and a review rule

**Agent:** `claude` for the edit; **the cadence number is a human decision**

- [ ] **Step 1: Pick the cadence.** The recurring cost is not code — it is the human smoke checklist (`docs/electron-upgrade-smoke-checklist.md`, produced by the migration plan's Task 17). Size the cadence to that:

| Cadence | Upgrades/year | Smoke tests/year | Margin inside the 6-month window |
|---|---|---|---|
| Every major (~62 days) | ~6 | ~6 | Always current |
| **Every other major (~4 months)** | **~3** | **~3** | **Comfortable — recommended** |
| Every third major (~6 months) | ~2 | ~2 | None; one slip and you are out |

Recommended: **every other major**, scheduled in a quiet week on the show calendar, never mid-season.

- [ ] **Step 2: Add the review rule to `CLAUDE.md`**

The Electron test net only keeps working if new code joins it. Add under a "PConAir" heading:

```markdown
### Electron code requires a characterization test
Any new or modified file under `src/main/**` that imports from `electron`
must come with a test using `tests/setup/electron-mock.ts`. The suite is
otherwise Electron-free, so an untested window manager is invisible to CI and
silently raises the cost of the next Electron upgrade. See
`docs/plans/2026-09-28-electron-44-migration.md` for the rationale.
```

- [ ] **Step 3: Commit** — `docs: add Electron upgrade cadence and characterization-test rule`

---

## What this cannot fix

Stated plainly, because a plan that claims to solve everything is not trustworthy:

- **The human smoke test stays manual.** Real displays, a real Google login, a real DMG. Roughly 30–60 minutes per upgrade, and it is the irreducible cost. Automating it (Playwright + a signed build + a Google test account) would cost more to build and maintain than it saves at this cadence.
- **Automation cannot resolve a show-schedule conflict.** "We're mid-season, I'm not touching it" is a legitimate answer. The alarm's job is to make that a *decision with a date attached* rather than an oversight.
- **Layer 2 will be noisy on first run** after 573 days of drift. Budget one triage session.
- **`enforce_admins=false` means the gate is bypassable.** That is intentional for a live-production tool. It protects against inattention, not against a deliberate override.
- **None of this covers the OBS side.** OBS's bundled CEF renders your browser sources and is entirely outside this repo. Your render pages are deliberately ES5-safe with no build step (`plan_approved.md:42`), which is what makes them immune — that constraint is load-bearing and worth defending in review.

---

## Open Questions for the Handoff

1. **Cadence — every other major, or something else?** Needs the show calendar. Everything else here is mechanical.
2. **Dependabot or Renovate?** Dependabot is built in and zero-setup; Renovate has better grouping and an auto-merge policy engine. Dependabot is the right first move; revisit only if the grouping proves too blunt.
3. **Should `main` require review as well as CI?** This plan requires only the `test` check. On a one-maintainer repo a review requirement mostly means self-approval, which adds friction without adding a second pair of eyes. Worth revisiting if anyone else starts committing.
4. **npm workspaces for `packages/companion-module-pconair`?** It would remove the `install:companion` step entirely, but it changes `node_modules` layout and could affect Forge's webpack resolution and the asar bundle. Deliberately out of scope — worth its own spike.
