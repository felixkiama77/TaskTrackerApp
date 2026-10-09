# Task Tracker — Final Report

Branch `desktop-overhaul` (17 commits on top of `main`; nothing pushed). Date: 2026-10-08.

Related documents:

- [`docs/specs/`](specs/) — the specifications.
- [`DECISIONS.md`](DECISIONS.md) — every product decision.
- [`VERIFICATION_MATRIX.md`](VERIFICATION_MATRIX.md) — requirement-by-requirement evidence.
- [`../README.md`](../README.md) — how to run, test and build.

## A. Functional requirement status

All 38 functional requirements (FR-1 – FR-38) are **complete and verified**. The [verification matrix](VERIFICATION_MATRIX.md) names the test or check behind each one.

The product questions in spec §14 were answered by the product owner. The answers are recorded in [`DECISIONS.md`](DECISIONS.md):

- **Repeat count:** the total number of occurrences, including the first.
- **The 29th–31st:** use the last day of shorter months.
- **"Next 3 days":** tomorrow through three days from today.
- **Week start:** follows the system locale, which gives Sunday for en-US.
- **Editing a repeating task:** only this occurrence, or this and future occurrences.
- **Deleting a repeating task:** only this occurrence, or the entire series.
- **Reminders missed while the app was closed:** summarised in one notification.
- **Reminders:** several per task, chosen from presets.
- **Completed tasks in the calendar:** shown muted.
- **Category filter:** matches any selected category.
- **Due time:** optional; a task with no time is due at the end of the day.
- **Missed repeats:** stay overdue until completed or skipped.
- **On time:** judged by calendar day.

Sound was added at the product owner's request and goes beyond the specs:

- an action sound for each event and a notification sound for each kind of notification;
- a shuffled music playlist;
- all of it chosen in Settings, with optional built-in defaults.

## B. Design compliance

The interface follows the design spec. It has:

- the measured vector logo, with pixel-aligned small sizes;
- the exact brand and status colours, defined as tokens;
- the Inter font;
- one icon family (Lucide);
- a sidebar layout with a primary "New task" button;
- progressive disclosure in the editor;
- calendar colours with a text legend;
- the specified motion timings, with reduced-motion support;
- toasts and the edge alert;
- native notifications with the specified wording.

Intentional deviations:

- **One light theme.** The spec says to implement one theme well first. The tokens are structured so a dark theme can be added later.
- **Darker secondary text on tinted surfaces.** The spec's grey `#6B7280` falls below 4.5:1 on tinted backgrounds. A darker shade, mixed from the spec's own grey and charcoal, is used there; the axe contrast scan is clean.
- **Logo proportions follow the reference image.** The stem is centred under the bar's base, which matches the reference, rather than geometrically centred under its angled top.
- **No separate tray icon.** The tray uses the pixel-aligned 16/32 px icons instead.
- **No separate notification for repeating tasks.** The spec's example "Upcoming task" message isn't a separate type; repeating tasks use the same reminder wording.
- **Compact layout.** At narrow window widths the sidebar collapses to icons, with accessible labels.

## C. Dependencies

| Package                                                      | Version                     | Licence    | Purpose                                      |
| ------------------------------------------------------------ | --------------------------- | ---------- | -------------------------------------------- |
| `zod`                                                        | 4.6.5                       | MIT        | Validation (forms, IPC, saved data)          |
| `lucide`                                                     | 1.49.0                      | ISC        | Icons                                        |
| `@fontsource-variable/inter`                                 | 5.3.0                       | OFL-1.1    | Bundled Inter font                           |
| `electron` (dev)                                             | 44.5.1                      | MIT        | Desktop runtime                              |
| `electron-builder` (dev)                                     | 26.17.0                     | MIT        | Installer, icons, fuses                      |
| `vite` (dev)                                                 | 8.3.1                       | MIT        | Build and dev server                         |
| `vite-plugin-electron` (dev)                                 | 1.1.2                       | MIT        | Builds main and preload                      |
| `typescript` (dev)                                           | 5.9.3                       | Apache-2.0 | Type checking                                |
| `vitest` (dev)                                               | 5.0.3                       | MIT        | Unit and integration tests                   |
| `@playwright/test` (dev)                                     | 1.63.0                      | Apache-2.0 | End-to-end tests driving Electron            |
| `axe-core` (dev)                                             | 4.13.0                      | MPL-2.0    | Accessibility scan (tests only, not shipped) |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` (dev) | 10.11 / 10.0 / 8.71 / 17.12 | MIT        | Linting                                      |
| `prettier` (dev)                                             | 3.9.9                       | MIT        | Formatting                                   |
| `cross-env` (dev)                                            | 10.1.0                      | MIT        | Cross-platform script variables              |

**Audit:** `npm audit --omit=dev` finds 0 vulnerabilities. The full audit finds 9, all inside electron-builder's build tooling, and none of that is shipped.

**Supply chain:** packages were installed with a one-week minimum release age.

**Removed:**

- `flatpickr`, replaced by native date and time inputs;
- `vite-plugin-electron-renderer`, which is no longer needed;
- `date-fns`, which turned out to be unnecessary.

## D. Tools used

Used:

- Playwright and Vitest for testing.
- ESLint and Prettier for code quality.
- axe-core for the accessibility scan.
- Electron's built-in Notification API.
- electron-builder for the installer, with fuses.
- The in-app browser pane, for a baseline look at the old app and for serving the interface during the legacy-import check.
- One independent security-review agent. It was read-only; its findings were all verified before fixing.

Evaluated but not used:

- The Frontend Design, Design and Context7 plugins were offered but not installed. Official documentation and the installed type definitions were used instead.
- The Playwright MCP plugin was connected but not needed, because `@playwright/test` drives Electron directly.
- No Claude Code hooks were configured; checks run with `npm run check`.
- Computer use was unnecessary: Windows icon extraction and notification events were checked through APIs instead.

## E. Exclusions and limitations

- **Reminders need the app running.** Closing the window keeps it in the tray, which is the default. After a full quit, missed reminders are summarised on the next launch.
- **The old version's tasks import only via `npm run dev`.** They sit in the development page's storage (see DECISIONS). This was verified on a copy of your profile: 4 tasks and 5 categories.
- **Windows only.** macOS and Linux build targets exist in the config but are untested.
- **Unsigned installer.** SmartScreen will warn on first run.
- **Not checked on an installed copy:** how a real notification toast looks on screen, and the taskbar and Start menu icons. Nothing was installed on this machine. Windows did accept notifications from the dev and packaged builds, and the T icon is embedded in the program and the installer.
- **Sounds are per event kind, not per individual task.** Music plays only while the window is visible.
- **Optional hardening not done:** serving the page from a custom `app://` scheme instead of `file://`, Trusted Types, and the Electron 44.7 update (released Oct 7; held back for a week as a supply-chain precaution).

## F. Test results

| Check                                        | Result                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc`                                        | Pass                                                                                                                                                                                 |
| ESLint (whole project)                       | Pass                                                                                                                                                                                 |
| Prettier                                     | Pass                                                                                                                                                                                 |
| Unit + integration (Vitest)                  | 135 / 135 pass. Tests run in US Pacific time and cover both 2026 daylight-saving changes. Some critical rules were also mutation-checked: deliberately broken to confirm tests fail. |
| End-to-end (Playwright, real Electron app)   | 19 / 19 pass                                                                                                                                                                         |
| Accessibility (axe-core, WCAG 2.1 AA)        | No serious or critical issues on any screen or the editor. Three real contrast issues found earlier were fixed.                                                                      |
| Manual: real Windows notification            | Accepted by Windows (dev build and packaged build)                                                                                                                                   |
| Manual: packaged app                         | Pass: production CSP, no menu, loads from the archive                                                                                                                                |
| Manual: fuses                                | Pass with fuses; the same test fails without them, as intended                                                                                                                       |
| Manual: legacy import (copy of real profile) | Pass: 4 tasks, 5 categories, Pacific times correct, imported only once                                                                                                               |
| Security review                              | 8 findings (1 medium, 6 low, 1 info). All fixed and tested.                                                                                                                          |

## G. Running and packaging

```bash
npm install                # once
npm run dev                # develop (also imports the old version's tasks on first run)
npm run check              # type check, lint, unit and integration tests
npm run test:e2e           # build and run the end-to-end tests
npm run build              # installer: release/0.1.0/Task-Tracker-Windows-0.1.0-Setup.exe
npm run build:inspectable  # test copy for the packaged-app check (never ship it)
npm run test:manual        # real notification, packaged app, fuses (after both builds)
```

## H. Recommended next steps

Required before sharing the app with others:

1. Run `npm run dev` once to import your old tasks. Install the 0.1.0 installer and check how a real notification looks, and the taskbar and Start menu icons.
2. Decide on code signing (needs a certificate), or accept the SmartScreen warning for personal use.
3. Add your sound files in Settings › Sound.

Optional improvements:

- Update to Electron 44.7 or newer after a week, then re-run all checks.
- Serve the page from a custom `app://` scheme, then turn off the `file://` privileges fuse.
- A dark theme that follows the system setting (the tokens are ready for it).
- Push the branch and open a pull request into `main` when you're happy with it.
