# Task Tracker sounds

Drop audio files into these folders using the exact names below. They are picked up automatically
the next time the app is built (`npm run dev` reloads them; run `npm run build` again for the
installer). No code changes are needed. Anything that hasn't been added yet simply has no custom
sound: effects stay silent and notifications use the Windows sound.

**Format:** MP3 is expected. OGG, WAV and M4A also work. File names are case-insensitive.

## `effects/` — sound effects for actions

| File name            | Plays when                                               |
| -------------------- | -------------------------------------------------------- |
| `task-created.mp3`   | A task is created                                        |
| `task-completed.mp3` | A task (or one occurrence) is marked complete            |
| `task-undone.mp3`    | A completion, skip or single-occurrence delete is undone |
| `task-deleted.mp3`   | A task, series or occurrence is deleted                  |
| `task-skipped.mp3`   | An occurrence is skipped, or "Skip all missed" is used   |
| `error.mp3`          | An action fails                                          |

Keep effects short (well under a second) and gentle; they play often.

## `notifications/` — one sound per notification kind

| File name      | Plays with                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `reminder.mp3` | Reminders before a task is due (and the "Send a test notification" button) |
| `due.mp3`      | The due-time alarm ("Task due now")                                        |
| `overdue.mp3`  | The overdue alert                                                          |
| `missed.mp3`   | The summary shown when reminders were missed while the app wasn't running  |

When a custom sound exists for a kind, that notification's Windows sound is muted so you don't hear
two sounds at once. Sounds play even while the window is hidden in the tray. A few seconds or less
works best.

## `music/` — background music rotation

Every file in this folder is a track. Tracks play one after another and loop; with **Shuffle** on
(the default) the order is random, with no track played twice in a row. Without shuffle, tracks play
in file-name order, so prefix numbers control the order: `01-morning.mp3`, `02-focus.mp3`, …
The title shown in Settings comes from the file name (`02-deep_focus.mp3` → "Deep focus").

Music is off until it's turned on in **Settings › Sound**. It pauses while the window is hidden or
minimized, and dips briefly whenever an effect or notification sound plays.

## Checking that files were found

**Settings › Sound** shows how many effects, notification sounds and tracks were found. Files whose
names don't match are listed in the developer console as "ignored", which usually means a typo.

## Notes

- Only add audio you have the rights to distribute with the app.
- Large music files make the installer larger; they're bundled with the app.
- Loudness: aim for effects and notifications roughly matched to each other, and music noticeably
  quieter (the default music volume is 30%).
