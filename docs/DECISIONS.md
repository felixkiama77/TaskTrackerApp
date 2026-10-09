# Task Tracker — Product & Engineering Decisions

The specifications live in [`docs/specs/`](specs/) and remain the source of truth:
`TASK_TRACKER_FUNCTIONAL_REQUIREMENTS.md` (behavior) and `TASK_TRACKER_DESIGN_SPEC_FOR_CLAUDE.md` (visual design).
This file records only the answers to questions those documents left open, so it never restates requirements.

Decided with the product owner on 2026-10-08.

## Answers to Functional Spec §14

| #   | Question                       | Decision                                                                                                                                                                                           |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Due time optional?             | Optional. A date-only occurrence is due at the **end of its local calendar day** and becomes overdue at 00:00 of the following day.                                                                |
| 2   | Repetition count               | **Total occurrences, including the first.** "Ends after 5 occurrences" = the due date + 4 more. "Never ends" is an explicit option.                                                                |
| 3   | Multiple times per week        | User selects **specific weekdays** (one or more). One selected day = weekly. If the start date is not a selected weekday, the first occurrence is the next selected weekday on or after it.        |
| 4   | Monthly on 29th–31st           | **Clamp to the month's last day** (Jan 31 → Feb 28/29 → Mar 31). The original anchor day is kept for later months.                                                                                 |
| 5   | "Next 3 days"                  | **Tomorrow through 3 days from today** (excludes today).                                                                                                                                           |
| 6   | Week start                     | Follows the **OS locale** (`Intl.Locale` week info, Monday fallback); overridable in Settings. The product owner is in US Pacific time with an en-US locale, so weeks start on Sunday by default.  |
| 7   | Recurring edits                | **"Only this occurrence"** or **"This and future"**. "This and future" splits the series at the selected occurrence so earlier history stays with the old rule. Archive records are never changed. |
| 8   | Recurring deletion             | **"Only this occurrence"** (recorded as skipped) or **"Entire series"** (all remaining occurrences). Archive records are always kept.                                                              |
| 9   | Missed reminders while closed  | On next launch, **one summary notification** ("N reminders were missed…"); stale reminders are not replayed individually. Anything now overdue gets the normal overdue cue.                        |
| 10  | Reminder options               | **Multiple reminders per task** from presets: at due time (the due-time alarm), 5/15/30 min, 1 h, 2 h, 1 day, 2 days before. They apply to every occurrence.                                       |
| 11  | Completed in calendar          | Shown **muted with a check icon**, never in red/green/blue status colors, behind a "Show completed" toggle (on by default). They disappear when their archive record expires.                      |
| 12  | Category filter (multi-select) | Matches **any** selected category; the UI labels it "Matching any of".                                                                                                                             |

## Other behavior rules

- **Missed recurring occurrences:** every missed occurrence stays overdue on its own date until completed or skipped. "Skip" and "Skip all missed" actions prevent pile-ups.
- **Completion classification (FR-18), by calendar day:** _Early_ = completed on a local day before the due date. _On time_ = completed on the due date, at or before the due time (end of day if no time). _Overdue_ = after that. The same rule is used everywhere, including the archive and calendar.
- **Difficulty** replaces the legacy "Priority": Easy / Medium / Hard (sort order Easy < Medium < Hard). Legacy data maps Low → Easy, Normal → Medium, High → Hard.
- **Category names** are unique case-insensitively after trimming whitespace; blank names are rejected.
- **Sorting:** by due date/time, a date-only occurrence sorts after timed occurrences on the same date (it is due at end of day). Difficulty sort breaks ties by due date/time.
- **Archive retention (FR-20):** a record is removed once `completedAt + 90 days` has passed. Cleanup runs at startup and hourly. Completed-occurrence keys are stored on the task separately from archive records, so an expired archive record never makes a completed occurrence reappear as overdue.
- **Undo:** completing an occurrence offers Undo for about 6 seconds.
- **Theme:** light theme first, built on tokens so a dark theme can be added later.

## Engineering decisions

| Decision      | Choice                                                                             | Reason                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Vanilla TypeScript with a small typed component layer                              | Keeps the existing approach; no framework migration.                                                                                              |
| Toolchain     | Electron 44, Vite 8, vite-plugin-electron 1.x, electron-builder 26                 | Electron 30 was end-of-life; audit went from 24 issues to build-time-only ones.                                                                   |
| Persistence   | Versioned JSON file in `userData`, owned by the main process; narrow validated IPC | The main process needs the data to schedule reminders; atomic writes and backups. Legacy `localStorage` data is imported once and left untouched. |
| Data folder   | Pinned to `%APPDATA%/tasktracker`                                                  | Stable across product-name changes; this is where existing data lives.                                                                            |
| Window close  | Hides to the system tray; reminders keep running; Quit from the tray menu          | Reminders only fire while the process runs. Configurable in Settings, with optional "Start at login" (off by default).                            |
| Date inputs   | Native `<input type="date">` / `<input type="time">` replace flatpickr             | Produces local date strings (avoids the UTC parsing trap in FR-27), keyboard accessible, no unmaintained dependency.                              |
| Notifications | Electron's built-in `Notification` API in the main process                         | Per FR-22; no extra package.                                                                                                                      |

## Additional rules set during implementation

- **Time zone:** all date logic uses the computer's local zone (FR-27). Unit tests pin `America/Los_Angeles`, the product owner's zone, so daylight-saving cases (Mar 8 / Nov 1, 2026) are exercised deterministically.
- **Reminders for tasks without a due time** are measured from the "date-only reminder time" setting (default 9:00 AM) on the due date.
- **Overdue alerts** (OS notification + red edge pulse) fire once per occurrence, only for tasks that have at least one reminder: 15 minutes after a timed deadline (so they don't collide with the due-time alarm), or the morning after a date-only due date at the date-only reminder time (so nobody is woken at midnight).
- **"This and future" with a repeat count:** the count describes the whole series, so the new part of a split series gets the remaining occurrences.
- **Legacy tasks that were already complete** are imported into the archive with classification "unknown", because the old app never recorded when they were completed.
- **Dependencies:** date-fns was evaluated and removed — calendar arithmetic is done on `YYYY-MM-DD` values via UTC math (immune to DST) and formatting uses the built-in `Intl` APIs.
