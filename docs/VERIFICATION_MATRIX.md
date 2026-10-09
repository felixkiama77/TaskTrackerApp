# Verification Matrix

Maps each requirement in [`docs/specs/`](specs/) to how it is verified. Requirement text lives only in the specs.
Methods: **U** unit (Vitest) · **I** integration (Vitest, real store/scheduler with fake clock) · **E** end-to-end (Playwright driving Electron) · **M** manual · **V** screenshot review.

Status: ⬜ not started · 🟨 implemented, not fully verified · ✅ verified · ❌ failing / not implemented

## Functional requirements (`TASK_TRACKER_FUNCTIONAL_REQUIREMENTS.md`)

| ID    | Area                                                  | Methods        | Tests / evidence | Status |
| ----- | ----------------------------------------------------- | -------------- | ---------------- | ------ |
| FR-1  | Create task + validation                              | U, E           |                  | ⬜     |
| FR-2  | Frequency / recurrence                                | U              |                  | ⬜     |
| FR-3  | Repetition count                                      | U              |                  | ⬜     |
| FR-4  | Categories on creation                                | U, E           |                  | ⬜     |
| FR-5  | Reminder configuration                                | U, E           |                  | ⬜     |
| FR-6  | Create categories                                     | U, E           |                  | ⬜     |
| FR-7  | Delete category keeps tasks                           | U, I, E        |                  | ⬜     |
| FR-8  | Edit categories                                       | U, E           |                  | ⬜     |
| FR-9  | Active task display                                   | E, V           |                  | ⬜     |
| FR-10 | Multiple views                                        | E, V           |                  | ⬜     |
| FR-11 | Sort by due date                                      | U, E           |                  | ⬜     |
| FR-12 | Sort by difficulty                                    | U, E           |                  | ⬜     |
| FR-13 | Filter by category                                    | U, E           |                  | ⬜     |
| FR-14 | Today / Next 3 days / This week / Overdue / Completed | U, E           |                  | ⬜     |
| FR-15 | Edit task (incl. recurring scope)                     | U, E           |                  | ⬜     |
| FR-16 | Delete task (scope, cancels reminders)                | U, I, E        |                  | ⬜     |
| FR-17 | Complete occurrence (idempotent)                      | U, I, E        |                  | ⬜     |
| FR-18 | Completion classification                             | U              |                  | ⬜     |
| FR-19 | Archive snapshot                                      | U, I           |                  | ⬜     |
| FR-20 | 90-day retention                                      | U, I           |                  | ⬜     |
| FR-21 | Browse completed                                      | E, V           |                  | ⬜     |
| FR-22 | Native OS notifications                               | I, M           |                  | ⬜     |
| FR-23 | Reminder scheduling / reconciliation                  | U, I           |                  | ⬜     |
| FR-24 | Due-time alarms                                       | U, I, M        |                  | ⬜     |
| FR-25 | Edge alerts (blue / red)                              | E, V, M        |                  | ⬜     |
| FR-26 | Notification reliability & security                   | I, M           |                  | ⬜     |
| FR-27 | Consistent "now", local dates                         | U              |                  | ⬜     |
| FR-28 | Timed vs date-only overdue                            | U              |                  | ⬜     |
| FR-29 | Time-sensitive refresh                                | U, E           |                  | ⬜     |
| FR-30 | Calendar navigation                                   | E, V           |                  | ⬜     |
| FR-31 | Calendar status colors                                | U, E, V        |                  | ⬜     |
| FR-32 | Calendar accuracy (shared logic)                      | U, E           |                  | ⬜     |
| FR-33 | Persistence across restarts                           | I, E           |                  | ⬜     |
| FR-34 | Safe updates & migrations                             | U, I           |                  | ⬜     |
| FR-35 | Single source of truth                                | Code review, U |                  | ⬜     |
| FR-36 | Input validation feedback                             | U, E           |                  | ⬜     |
| FR-37 | Operation feedback                                    | E, V           |                  | ⬜     |
| FR-38 | Failure recovery                                      | U, I           |                  | ⬜     |

## Design acceptance checklist (`TASK_TRACKER_DESIGN_SPEC_FOR_CLAUDE.md` §12)

| Item                                                             | Methods           | Evidence | Status |
| ---------------------------------------------------------------- | ----------------- | -------- | ------ |
| Logo follows the reference                                       | V                 |          | ⬜     |
| Brand colors centralized as tokens                               | Code review       |          | ⬜     |
| Consistent across screens                                        | V                 |          | ⬜     |
| Future / today / overdue / reminder states distinct & accessible | V, contrast check |          | ⬜     |
| Create/edit covers every feature                                 | E                 |          | ⬜     |
| Completion archives with original details                        | U, E              |          | ⬜     |
| Category deletion keeps tasks                                    | U, E              |          | ⬜     |
| Calendar blue/green/red rules                                    | U, V              |          | ⬜     |
| Startup animation short / skipped when not needed                | V, M              |          | ⬜     |
| Edge alerts subtle, finite, dismissible, reduced-motion aware    | E, V              |          | ⬜     |
| Native notifications tested on packaged Windows build            | M                 |          | ⬜     |
| App icon tested in packaged build                                | M                 |          | ⬜     |
| Keyboard, focus, contrast, reduced motion                        | E, M              |          | ⬜     |
| Existing functionality preserved                                 | E                 |          | ⬜     |
