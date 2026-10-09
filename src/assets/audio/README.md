# Task Tracker sounds

There are two ways to give Task Tracker sounds:

1. **In the app (the usual way):** open **Settings › Sound**. Each notification and action has its
   own **Choose file…** button (plus **Play** to preview and **Remove**), and **Add tracks…** adds
   background music. You can select several music files at once. Chosen files are copied into
   `%APPDATA%\tasktracker\sounds`, work immediately, and survive app updates. No code or rebuild needed.
2. **Built-in defaults (for shipping sounds inside the installer):** drop files into the folders
   below using the exact names listed, then rebuild (`npm run dev` picks them up; run
   `npm run build` for the installer). Anything chosen in Settings overrides the built-in file
   for that event; built-in music tracks play alongside any added in Settings.

Anything without a sound simply stays silent (actions) or uses the Windows sound (notifications).

**Formats:** MP3 is expected; OGG, WAV and M4A also work. Files are checked when chosen in Settings:
they must really be audio (not just named `.mp3`), up to 5 MB for event sounds and 60 MB per music
track.

## `effects/` — action sounds

| File name            | Plays when                                               |
| -------------------- | -------------------------------------------------------- |
| `task-created.mp3`   | A task is created                                        |
| `task-completed.mp3` | A task (or one occurrence) is marked complete            |
| `task-undone.mp3`    | A completion, skip or single-occurrence delete is undone |
| `task-deleted.mp3`   | A task, series or occurrence is deleted                  |
| `task-skipped.mp3`   | An occurrence is skipped, or "Skip all missed" is used   |
| `error.mp3`          | An action fails                                          |

Keep these short (well under a second) and gentle; they play often.

## `notifications/` — one sound per notification kind

| File name      | Plays with                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `reminder.mp3` | Reminders before a task is due (and the "Send a test notification" button) |
| `due.mp3`      | The due-time alarm ("Task due now")                                        |
| `overdue.mp3`  | The overdue alert                                                          |
| `missed.mp3`   | The summary shown when reminders were missed while the app wasn't running  |

When a custom sound exists for a kind, that notification's Windows sound is muted so the two never
play together. Sounds play even while the window is hidden in the tray. A few seconds or less works best.

## `music/` — background music rotation

Every file here is a track. Tracks play one after another and loop. With **Shuffle** on (the
default) the order is random and no track plays twice in a row; without it, built-in tracks play in
file-name order (prefix numbers control it: `01-morning.mp3`, `02-focus.mp3`, …), followed by tracks
added in Settings in the order they were added. Titles come from the file names
(`02-deep_focus.mp3` → "Deep focus").

Music is off until it's turned on in **Settings › Sound**. It pauses while the window is hidden or
minimized, and dips briefly whenever an action or notification sound plays.

## Checking that built-in files were found

**Settings › Sound** shows "Built-in sound" for each event that has one. Files whose names don't match
an event are listed in the developer console as ignored, which usually means a typo.

## Notes

- Only use audio you have the rights to use (and, for built-in files, to distribute with the app).
- Built-in music makes the installer larger; music added in Settings doesn't.
- Loudness: aim for action and notification sounds roughly matched to each other, and music noticeably
  quieter (the default music volume is 30%).
