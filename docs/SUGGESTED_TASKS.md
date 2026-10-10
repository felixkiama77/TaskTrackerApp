# Suggested-tasks file format

How a Claude Code routine (or anything else) hands tasks to Task Tracker. The app reads every `.json` file placed directly in the folder chosen in **Settings › Suggested tasks**. What it does with them is decided in [`DECISIONS.md`](DECISIONS.md#school-automation-2026-10-09); the code is `src/domain/suggestions.ts`.

## Writing files

- Write one file per routine and **replace it on every run**, for example `weekly-coursework.json` and `school-email.json`. Include every item that is still relevant; leaving one out does nothing.
- A file is processed again only when its content changes, and importing the same item twice changes nothing.
- Keep each file under 1 MB and 300 suggestions. Only the first 50 `.json` files in the folder are read; subfolders and files starting with `.` are ignored.

## Shape

```json
{
  "format": "task-tracker-suggestions",
  "version": 1,
  "origin": "Weekly coursework sync",
  "generatedAt": "2026-10-11T17:07:00-07:00",
  "suggestions": [
    {
      "system": "tcss380-site",
      "externalId": "2026au/week-3/lab-2",
      "title": "Lab 2: Erlang recursion",
      "notes": "Week 3 lab. Submit on Canvas.",
      "link": "https://cfb3.github.io/TCSS380-26-AUTUMN/erlang/lab-2/",
      "dueDate": "2026-10-18",
      "dueTime": "23:59",
      "priority": "medium",
      "categories": ["School", "TCSS 380"],
      "reminders": [720, 360]
    }
  ]
}
```

| Field                   | Required | Rules                                                                                                                                                                                                                     |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`, `version`     | yes      | Exactly `"task-tracker-suggestions"` and `1`. Anything else and the whole file is rejected, with nothing changed.                                                                                                         |
| `origin`                | yes      | Shown in reports and in the task details ("Added by …"). Up to 100 characters.                                                                                                                                            |
| `generatedAt`           | yes      | ISO timestamp.                                                                                                                                                                                                            |
| `system` + `externalId` | yes      | Together they identify the item for good. `system` is lowercase letters, digits and dashes (e.g. `canvas`, `tcss380-site`, `outlook`, `study-group`). Never reuse an id for a different item.                             |
| `title`                 | yes      | Up to 200 characters.                                                                                                                                                                                                     |
| `dueDate`               | yes      | Local calendar date, `YYYY-MM-DD`.                                                                                                                                                                                        |
| `dueTime`               | no       | Local time `HH:MM` (24-hour), or `null` / left out for "due by the end of the day".                                                                                                                                       |
| `notes`                 | no       | Plain text, up to 1,000 characters. A short summary only; never paste whole emails.                                                                                                                                       |
| `link`                  | no       | Must start with `https://`.                                                                                                                                                                                               |
| `priority`              | no       | `"low"`, `"medium"` (the default) or `"high"`.                                                                                                                                                                            |
| `categories`            | no       | Existing category names (case doesn't matter). Unknown names are left off and reported, never created.                                                                                                                    |
| `reminders`             | no       | Minutes before the due time, from `0` (at the due time), `5`, `15`, `30`, `60`, `120`, `360`, `720`, `1440` and `2880`. Without a due time they count back from the "Reminder time for tasks without a due time" setting. |

An invalid suggestion is skipped on its own and reported; the rest of the file is still used.

Every suggestion becomes a one-time task. Dates and times are the computer's local time (US Pacific for the product owner).
