# CLAUDE.md

Guidance for Claude Code when working in this repository.

## PConAir

### Electron upgrade cadence

**Every other major (~4 months, ~3 upgrades/year).** Decided 2026-09-29,
against the show calendar. This keeps the installed Electron comfortably
inside the ~6-month supported-majors window with margin for a slip, at a
cost of about 3 human smoke-tests a year (see
`docs/electron-upgrade-smoke-checklist.md`, produced by the Electron 44
migration). Schedule each upgrade in a quiet week on the show calendar,
never mid-season. See `docs/plans/2026-09-28-dependency-currency.md` for
the full rationale and the alarm that enforces this window.

### Electron code requires a characterization test

Any new or modified file under `src/main/**` that imports from `electron`
must come with a test using `tests/setup/electron-mock.ts`. The suite is
otherwise Electron-free, so an untested window manager is invisible to CI
and silently raises the cost of the next Electron upgrade. See
`docs/plans/2026-09-28-electron-44-migration.md` for the rationale.
