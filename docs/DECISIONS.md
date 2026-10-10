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

## Sound (requested 2026-10-08)

- **Three kinds of sound:** an action sound for each of six events (task created, completed, undo, deleted, skipped, error), a notification sound for each of four notification kinds (reminder, due now, overdue, missed summary), and background music played as a rotating playlist.
- **Adding sounds:** chosen in **Settings › Sound** with the system file picker (several files at once for music). Files are checked (real audio by content; up to 5 MB per event sound, 60 MB per track) and copied into `%APPDATA%/tasktracker/sounds`, so they work without rebuilding and the originals can be moved or deleted. Built-in defaults can also ship with the app from `src/assets/audio` (see its README); a sound chosen in Settings overrides the built-in one for that event.
- **No double sounds:** when a notification kind has a custom sound, its Windows notification is shown silently and the app plays the custom sound instead. Kinds without one keep the Windows sound.
- **Background music** is off by default, shuffles by default (no track twice in a row), pauses while the window is hidden or minimized, and dips while other sounds play.
- **Sound is never the only cue:** every event also has visible text (toast, notification or changed screen).
- **Files are only deleted when their sound is removed or replaced.** The app never sweeps the sounds folder for unreferenced files, so a damaged data file can't cause sound files to be deleted.

## Release and security (2026-10-08)

- **Version 0.1.0** is the first preview build of the new app; the installer is `Task-Tracker-Windows-0.1.0-Setup.exe`. It is not code-signed (that needs a paid certificate), so Windows SmartScreen will warn on first run.
- **Limits:** up to 2,000 tasks and 200 categories, so the app stays responsive and the data file stays a reasonable size.
- **Installed builds are locked down** with Electron fuses (no running as plain Node, no `NODE_OPTIONS`, no debugger flags, integrity-checked archive only). Development and test switches (dev server URL, fake clock, recorded notifications, scripted file picks) only work when running from source. The data-folder override (`TASK_TRACKER_USER_DATA`) is still honoured by installed builds on purpose, so the packaged app can be checked without touching real data.
- **Importing the old version's tasks** happens automatically, but only where that data lives: the old app only ever ran in development, so its tasks sit in the development page's storage (`localhost:5173`). Running `npm run dev` once imports them into `%APPDATA%\tasktracker`; the installed app then sees them too. A packaged-only install starts empty.

## School automation (2026-10-09)

The product owner wants two Claude Code routines (a weekly coursework sync from Canvas and the TCSS 380 site, and a daily school Outlook triage) to add tasks to this app. Nothing outside the app could add tasks, so the product owner chose to add a way in, along with two other changes.

| Decision                    | Choice                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Difficulty → **Priority**   | The product owner replaced Difficulty with **Priority (Low / Medium / High)**. FR-1's "difficulty level" and FR-12's "sort by difficulty" now mean priority. Existing data converts once: Easy → Low, Medium → Medium, Hard → High. The original app's Low/Normal/High priorities now map straight across. Sorting offers highest or lowest first. |
| More reminder times         | Added **6 hours before** and **12 hours before**. For an 11:59 PM deadline they land at 5:59 PM and 11:59 AM, inside the product owner's 10 AM–6 PM notification window.                                                                                                                                                                           |
| Notes and link on tasks     | Any task can have optional notes (up to 1,000 characters) and an https link, editable in the editor and shown in the task details. Only https links are accepted, and the app only opens a link stored on an existing task.                                                                                                                        |
| How routines add tasks      | A routine writes a **suggestions file** (format in [`SUGGESTED_TASKS.md`](SUGGESTED_TASKS.md)) to a Google Drive folder. Google Drive for desktop syncs it to this PC, and the app reads that folder, chosen in **Settings › Suggested tasks**. The app itself never contacts Canvas, Outlook or any other service.                                |
| When the folder is read     | At startup, after the PC wakes or unlocks, every 5 minutes while the app runs, when the folder is chosen, and on **Check now**. A file is read again only when its content changes, and the data file is only written when something changed.                                                                                                      |
| Review or add automatically | **Added automatically**, with a summary toast and a report in Settings.                                                                                                                                                                                                                                                                            |
| Conflicts with your edits   | **A field you edited is never overwritten.** Each imported task remembers the values it was last imported with. If the source changes a field you haven't touched, the task follows it; if you changed that field, your version stays and the report says so once.                                                                                 |
| Deleted, completed, skipped | A task you deleted is **never added back**. Completed or skipped tasks, and tasks you turned into repeating ones, are left alone.                                                                                                                                                                                                                  |
| Nothing is deleted          | Imports never delete tasks or categories. An item missing from a later file means nothing; it is not treated as cancelled.                                                                                                                                                                                                                         |
| Categories                  | Matched to existing categories by name, ignoring case. Unknown names are **left off, not created**, and the report lists them.                                                                                                                                                                                                                     |
| Data format version 2       | The data file moved to version 2. On first launch the version 1 file is kept as `task-tracker-data.v1-before-upgrade.json`, written once and never overwritten. Older builds of the app can't read version 2 files.                                                                                                                                |
