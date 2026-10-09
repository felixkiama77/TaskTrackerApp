# Task Tracker — Functional Requirements Specification

**Document type:** Product and functional requirements  
**Purpose:** Define the expected behavior of the Task Tracker desktop application  
**Audience:** Claude Code, developers, and testers  
**Status:** Implementation reference; unresolved decisions should be confirmed with the product owner

---

## 1. Product Goal

Build a dependable desktop Task Tracker that lets users create and organize tasks, schedule one-time and recurring due dates, receive reminders, review tasks in list and calendar views, and preserve a history of completed work.

This document describes **what the application must do**. Visual styling, branding, layout, typography, colors, and animation aesthetics are defined in the separate design specification. The two documents should be used together.

## 2. Core Concepts and Terminology

To keep behavior consistent, distinguish the following concepts:

- **Task definition:** The task's title and configuration, such as difficulty, categories, recurrence rule, and reminder preferences.
- **Occurrence:** One scheduled instance of a task definition, with its own due date/time and completion state.
- **Active task/occurrence:** Work that has not been completed and has not been archived.
- **Completed occurrence:** A particular instance that the user marked complete.
- **Archive record:** A historical record of a completed occurrence, including a snapshot of the original task details and its completion information.
- **Category:** A user-created label that can be assigned to one or more tasks. A task may belong to multiple categories.
- **Reminder:** A notification scheduled before or at a configured point relative to an occurrence's due date/time.
- **Due-date alarm:** A notification associated with the due time itself, if the user has enabled it.
- **Overdue:** An incomplete occurrence whose due date/time has passed. If no due time is specified, use the agreed end-of-day rule for its due date.

**Important implementation principle:** A recurring task can have multiple occurrences over time. Completing one occurrence must not erase its history or accidentally end the recurring schedule.

## 3. Task Creation

### FR-1 — Create a task

The user must be able to create a task by entering its required information and saving it.

Required fields:

1. **Name/title** — required; must not be blank after trimming whitespace.
2. **Due date** — required.
3. **Difficulty level** — required; provide a clear, consistent set of difficulty options.

The application should validate input and explain errors clearly. Invalid data must not be silently saved.

### FR-2 — Frequency and recurrence

The user must be able to configure how often a task occurs. At minimum, support:

- **Daily** — an occurrence each day according to the chosen recurrence behavior.
- **Multiple times per week** — allow the user to specify which days of the week the task should occur, or another clearly explained schedule that genuinely supports multiple occurrences per week.
- **Monthly** — an occurrence once per month.

Do not interpret “frequency” and “repetition count” as the same field. Frequency determines the schedule; repetition count determines how many future occurrences or repeats are generated.

The interface and data model must make the recurrence behavior understandable. In particular, clarify whether the initial due date counts as the first occurrence when calculating a finite repetition count.

Monthly recurrence needs a consistent rule for months that do not contain the original day number. For example, a task scheduled for the 31st needs predictable behavior in shorter months. Choose and document a safe default, and ask the product owner if the choice materially affects the user experience.

### FR-3 — Repetition count

The user must be able to set how many times a recurring task repeats.

The implementation must define and clearly communicate whether the configured number means:
- the total number of occurrences, including the first scheduled occurrence; or
- the number of additional occurrences after the first.

Do not silently switch interpretations between the UI, scheduler, and stored data. Ask the product owner to confirm this behavior before finalizing recurrence logic.

If the app supports an indefinite recurring schedule, make that option explicit rather than interpreting a missing number ambiguously.

### FR-4 — Categories on creation

The user must be able to assign one or more existing categories to a task during creation.

- Multiple categories may be assigned to a single task.
- A task may have no category if the user chooses.
- The category picker should make assigned categories clear.
- Duplicate category assignments must be prevented.

### FR-5 — Reminder configuration on creation

The user must be able to configure whether reminders are enabled for a task and when they should occur.

At minimum, support:
- No reminder.
- A reminder at a user-selected lead time before the due date/time.
- A due-time alarm, when enabled.

Where appropriate, allow more than one reminder for an occurrence, but do not add unnecessary complexity without confirming the intended interaction.

Persist reminder preferences and ensure they apply consistently to future recurring occurrences unless the user changes the task configuration.

## 4. Category Management

### FR-6 — Create categories

The user must be able to create new categories with a name.

- Reject blank category names.
- Prevent confusing duplicate category names, using a documented case-sensitivity policy.
- Make newly created categories available in task creation, editing, filtering, and list views.

### FR-7 — Delete categories without deleting tasks

The user must be able to delete a category.

**Critical rule:** Deleting a category must not delete any task or completed archive record associated with it.

When a category is deleted:
- Remove the category from the category collection.
- Remove that category association from affected active tasks and future occurrences as appropriate.
- Preserve the task itself and all other category assignments.
- Preserve completed archive records and their historical information.
- Do not leave broken references to the deleted category.

If archive records retain a snapshot of the category names at completion time, preserve that historical snapshot even after the live category is deleted.

If confirmation is used, explain that the category will be removed but its tasks will remain.

### FR-8 — Edit categories

If category editing is supported, changing a category's name should update its live references without duplicating or losing tasks. Preserve archive snapshots if historical records are intended to show the names as they were when completed.

## 5. Task List Views, Sorting, and Filtering

### FR-9 — Display active tasks

The application must provide a view of active, incomplete task occurrences.

Each task entry should make the important information easy to understand, including:
- Task name.
- Due date and time, where configured.
- Difficulty.
- Category or categories.
- Recurrence information when useful.
- Reminder status when useful.
- A clear way to complete, edit, or delete the task.

Do not show a completed occurrence as active after completion. Recurring tasks may still have a separate next occurrence.

### FR-10 — Multiple ways to view tasks

The application should support multiple useful ways of displaying tasks. At minimum, provide a standard task list and a calendar view (defined in Section 10). Additional list presentation modes, such as compact and detailed views, may be implemented if they fit the existing architecture and improve usability.

Do not add view modes that merely duplicate existing functionality without a clear benefit.

### FR-11 — Sort by due date

The user must be able to sort the active task list by due date/time in ascending or descending order, or otherwise switch between soonest-first and latest-first ordering.

Define how tasks without a due time are ordered relative to tasks with a due time on the same date.

### FR-12 — Sort by difficulty

The user must be able to sort tasks by difficulty using a consistent, documented difficulty order. The selected sort order should be clear in the UI.

### FR-13 — Filter by category

The user must be able to isolate tasks belonging to selected categories.

- A task with multiple categories must be discoverable under each of its assigned categories.
- If multiple categories can be selected simultaneously, define whether the filter means “matches any selected category” or “matches all selected categories.” Use a clear UI label and ask the product owner if this choice is not obvious.
- Removing a category must not break the filter system.

### FR-14 — Time and status filters

Provide dedicated filters for:

1. **Today** — incomplete occurrences due on the current local calendar date.
2. **Next 3 days** — incomplete occurrences due within the next three calendar days, excluding today if the product owner prefers that interpretation. Confirm the intended boundary before finalizing.
3. **This week** — incomplete occurrences due in the current local calendar week. Define the first day of the week consistently and preferably make it match the user's locale.
4. **Overdue** — incomplete occurrences whose due date/time has passed.
5. **Completed** — completed occurrences from the archive, with history available.

The UI must clearly indicate the active filter and offer a way to return to the unfiltered active list.

Do not count the same occurrence twice in a single view. Define date boundaries using local calendar dates consistently rather than relying on arbitrary rolling 24-hour windows for calendar-based filters.

## 6. Task Editing and Deletion

### FR-15 — Edit a task

The user must be able to edit every configurable task property after creation, including:
- Name.
- Due date and time.
- Difficulty.
- Frequency and recurrence days.
- Repetition count or indefinite recurrence.
- Categories.
- Reminder settings.
- Due-time alarm settings.

Editing must validate the updated information before saving. Cancelling an edit must discard unsaved changes.

For recurring tasks, determine whether an edit applies to:
- only the selected occurrence;
- the selected and future occurrences; or
- the entire recurring series.

Do not silently apply a change to past archive records. Ask the product owner how recurring-series edits should work before implementing behavior that could alter many future occurrences.

### FR-16 — Delete a task

The user must be able to delete an active task or recurrence according to a clearly defined scope.

- Ask for confirmation when deletion is destructive or affects a recurring series.
- Cancel pending reminders and scheduled work for deleted occurrences.
- Avoid deleting unrelated tasks or archive records.
- Clearly distinguish deleting one occurrence from deleting an entire recurring series if both actions are supported.

The product owner should confirm whether deleting an active task also deletes its future occurrences.

## 7. Completing Tasks and Archive

### FR-17 — Complete an occurrence

The user must be able to mark an active occurrence complete.

On completion:
1. Remove that occurrence from active task views.
2. Create an archive record.
3. Capture a completion timestamp.
4. Capture the original scheduled due date/time.
5. Preserve the original task details and relevant recurrence information.
6. Classify completion as early, on time, or overdue.
7. Cancel reminders and alarms that are no longer relevant to that occurrence.
8. Continue the recurrence schedule when more occurrences remain.

Completing an occurrence must be a safe, consistent operation. Avoid creating duplicate archive records if a user clicks the completion control twice or an event is processed more than once.

### FR-18 — Completion classification

Store enough information to show whether an occurrence was completed:
- **Early** — completed before its due date/time.
- **On time** — completed at the due date/time, or within a precisely defined on-time boundary.
- **Overdue** — completed after its due date/time.

The application must use a consistent rule for tasks with a due time and for tasks with only a due date.

Ask the product owner to confirm the exact boundary behavior. Do not use inconsistent classification rules in the archive and calendar.

### FR-19 — Preserve the original task information

Archive records must retain a historical snapshot of the completed occurrence, including its original:
- Name.
- Due date/time.
- Difficulty.
- Frequency and recurrence details.
- Repetition configuration where applicable.
- Category names or category snapshot.
- Reminder configuration where useful.
- Completion timestamp.
- Completion classification.

Do not rely exclusively on a live task record that may later be edited or deleted. The historical record must remain meaningful even if the original task definition changes.

### FR-20 — Retain archive records for approximately 90 days

Completed occurrences must remain archived for approximately 90 days from completion.

- Calculate expiration from the completion timestamp.
- Remove expired archive records automatically at a safe point, such as application startup and periodic maintenance while the app is running.
- Do not remove active tasks during archive cleanup.
- Make cleanup idempotent so it can run more than once safely.
- Do not delete a record before its retention period has elapsed.

The exact day-boundary and cleanup timing should be documented.

### FR-21 — Browse completed tasks

The user must be able to view completed tasks from the past, including:
- Original task details.
- Original due date/time.
- Completion timestamp.
- Early/on-time/overdue classification.

If useful, allow sorting or filtering by completion date and category. Completed occurrences must remain separate historical entries, even when they belong to the same recurring task.

## 8. Native Notifications and Reminder Scheduling

### FR-22 — Native OS notifications

The application must use native operating-system notifications for configured reminders and due-time alarms where supported.

Prefer Electron's built-in Notification API rather than adding a separate package without a specific need.

Notifications should communicate the task name and the reason for the notification. Reminder notifications and overdue-related alerts must be distinguishable.

### FR-23 — Reminder scheduling

Schedule reminders relative to each occurrence's due date/time and configured reminder preferences.

- Do not schedule reminders when reminders are disabled.
- Reconcile scheduled reminders after task edits, deletions, recurrence changes, and application restarts.
- Prevent duplicate delivery of the same reminder.
- Do not deliver reminders for deleted or completed occurrences.
- Handle missed reminder times after the application has been closed or suspended according to a documented policy.
- Handle system sleep/wake and clock changes as reliably as the platform permits.

Do not promise delivery while the application is completely closed unless a verified operating-system mechanism supports it. Explain any limitations to the product owner.

### FR-24 — Due-time alarms

If enabled, deliver a native notification at the occurrence's due time.

After the due time passes, an incomplete occurrence should become overdue according to the application's date/time rules.

Avoid repeatedly sending due-time alarms unless a repeat policy is explicitly configured.

### FR-25 — Visual edge alerts

In addition to native notifications, display a subtle flashing line around the application content/window edges:
- **Blue:** reminder.
- **Red:** overdue.

The indicator must be subtle, non-blocking, dismissible or time-limited, and compatible with reduced-motion preferences.

Use a reliable implementation supported by the current Electron architecture. Prefer an in-window visual indicator if a genuine operating-system window-edge effect would require intrusive changes.

Define when the alert begins, how long it remains active, and what dismisses it. Avoid a continuously flashing red border that becomes distracting.

### FR-26 — Notification reliability and security

- Keep privileged notification operations in the Electron main process where appropriate.
- Use a narrow, validated IPC interface if the renderer requests notifications.
- Preserve context isolation and existing security protections.
- Handle notification errors without crashing the application.
- Keep enough scheduling state to prevent duplicates after restarts.
- Use a testable scheduler abstraction so reminder logic can be tested without waiting for real clock time.

## 9. Date, Time, and Overdue Rules

### FR-27 — One consistent definition of “now”

Use the computer's local time zone for the current-date filters and calendar display unless the product owner explicitly chooses another behavior.

Store timestamps in a consistent format, such as ISO timestamps or numeric epoch values, and distinguish absolute timestamps from date-only values.

Do not parse date-only strings as UTC accidentally if the intended meaning is a local calendar date.

### FR-28 — Tasks with and without due times

A task has a required due date. Decide whether due time is optional based on the current design and product owner's preference.

If a task has a due time, it becomes overdue once that time has passed and it remains incomplete.

If a task has only a due date, use a documented end-of-day rule in the local time zone. Do not mark it overdue at the beginning of its due date.

### FR-29 — Recalculate time-sensitive status

Today, overdue, calendar color, and reminder status should reflect the passage of time even when the user does not edit a task.

Use an efficient mechanism to refresh time-sensitive status while the application is open. Avoid excessive timers or repeated full-database operations.

On application startup or resume, recalculate status and reconcile pending reminders.

## 10. Calendar View

### FR-30 — Calendar navigation

Provide a calendar mode that lets the user navigate through dates and inspect scheduled task occurrences.

At minimum, users must be able to move between calendar periods and identify the date on which each task occurrence is due.

The calendar must represent recurring occurrences, not just the original task definition.

Clicking a calendar entry should allow the user to inspect the task and access appropriate actions.

### FR-31 — Calendar status colors

Use these rules consistently:

- **Blue:** occurrence due in the future and not overdue.
- **Green:** occurrence due today that has not passed its due time.
- **Red:** occurrence is overdue.

An overdue occurrence must appear on its original scheduled due date in the calendar and be colored red, even if the user is viewing a previous date.

A task due today must change from green to red after its due time passes if it remains incomplete.

For tasks with a date but no due time, apply the agreed end-of-day rule.

Completed occurrences should be visually distinguishable from active occurrences. Their appearance must not make them look like active overdue tasks. Confirm the completed-task calendar presentation with the product owner if it is not already specified in the design plan.

### FR-32 — Calendar accuracy

The calendar must use the same underlying occurrence, date, and overdue logic as the task list.

Avoid a situation where a task is red in the list but green or blue in the calendar.

Date navigation must not change task data. Displaying a historical date must not make an overdue occurrence appear on a later date instead of its original due date.

## 11. Data Integrity and Persistence

### FR-33 — Persistence

Task definitions, recurrence rules, categories, reminder preferences, occurrence state, and archive records must persist across application restarts.

Use the project's existing storage architecture if it is suitable. Do not introduce a new database or cloud service without a clear need.

### FR-34 — Safe updates and migrations

If the data model changes:
- Validate persisted data when loading it.
- Handle missing or invalid values gracefully.
- Migrate older data safely when needed.
- Avoid silently deleting user data.
- Keep task, occurrence, and archive relationships consistent.

### FR-35 — Single source of truth

The list view, filters, calendar, notifications, and archive must derive from consistent task and occurrence data.

Avoid storing independently calculated statuses in several places unless there is a clear reason and a reliable synchronization strategy.

## 12. Error Handling and User Feedback

### FR-36 — Input validation

Provide clear feedback when required fields are missing or invalid. Prevent invalid data from entering the task store.

### FR-37 — Operation feedback

Provide clear confirmation or status feedback after important actions, including:
- Task creation and editing.
- Task completion.
- Task deletion.
- Category creation and deletion.
- Reminder configuration changes.

Do not rely exclusively on transient animations to communicate whether an operation succeeded.

### FR-38 — Failure recovery

Handle persistence failures, invalid stored data, notification failures, and recurrence-generation errors without silently corrupting data.

Log useful diagnostic information without exposing sensitive data. Give the user a comprehensible message when an operation cannot be completed.

## 13. Quality Assurance and Acceptance Criteria

The application is not complete merely because it launches or compiles.

Before marking a feature complete, verify its behavior.

### Core acceptance checklist

- [ ] Create a task with a name, due date, difficulty, frequency, repetition count, categories, and reminder settings.
- [ ] Create daily, multiple-times-per-week, and monthly recurrence schedules.
- [ ] Edit every task property.
- [ ] Create categories and assign multiple categories to tasks.
- [ ] Delete a category without deleting its tasks or historical archive data.
- [ ] Sort tasks by due date/time and difficulty.
- [ ] Filter by category, Today, Next 3 days, This week, Overdue, and Completed.
- [ ] Complete an occurrence and remove it from active views.
- [ ] Preserve original task details and completion classification in the archive.
- [ ] Expire archive records after approximately 90 days without affecting active tasks.
- [ ] Display recurring occurrences accurately in the calendar.
- [ ] Display future occurrences in blue, current non-overdue occurrences in green, and overdue occurrences in red.
- [ ] Show overdue occurrences on their original due dates.
- [ ] Deliver native reminders and due-time alarms where supported.
- [ ] Prevent duplicate or obsolete notifications.
- [ ] Display the blue reminder and red overdue edge indicator.
- [ ] Preserve data across application restarts.
- [ ] Handle date/time boundaries and recurrence edge cases consistently.
- [ ] Verify important user flows with automated tests where feasible.
- [ ] Report unsupported or unverified behavior honestly.

### Testing recommendations

Use unit tests for recurrence, date boundaries, sorting, filtering, archive retention, and completion classification.

Use integration tests for persistence, category deletion, occurrence generation, and reminder reconciliation.

Use end-to-end tests for important user journeys and visual regression checks where the existing architecture supports them.

Use controlled clocks or mocked scheduling adapters to test reminders and overdue transitions deterministically.

## 14. Product Decisions That Require Clarification

Before finalizing behavior that materially affects users, ask the product owner to resolve these questions. Recommend a default and explain the trade-offs.

1. **Due time:** Is due time optional, with date-only tasks becoming overdue at the end of the due date?
2. **Repetition count:** Does the count include the initial occurrence, or mean additional repeats after it?
3. **Multiple times per week:** Should users select specific weekdays, or should another recurrence interface be offered?
4. **Monthly recurrence:** How should a task due on the 29th, 30th, or 31st behave in shorter months?
5. **Next 3 days:** Does this include today, or mean the next three full calendar days after today?
6. **Week boundary:** Should the week begin on Sunday or Monday, based on locale or a user setting?
7. **Recurring-task edits:** Should changes apply to the current occurrence, future occurrences, or the entire series?
8. **Recurring-task deletion:** Should users be able to delete one occurrence or the entire series?
9. **Missed reminders:** If the application was closed at reminder time, should it show a late notification on next launch, skip it, or ask the user?
10. **Reminder options:** Which preset lead times should be offered, and should users be able to configure multiple reminders per occurrence?
11. **Completed tasks in calendar:** Should completed occurrences remain visible, and if so, how should they be styled?
12. **Category filters:** When several categories are selected, should a task match any selected category or all selected categories?

Do not block unrelated implementation work while waiting for answers. Implement independent, low-risk work first, but do not finalize ambiguous behavior that could cause data loss or major user-experience differences.

## 15. Instructions for Claude Code

Use this document alongside `TASK_TRACKER_DESIGN_SPEC_FOR_CLAUDE.md`, which defines the visual design and UI expectations.

First inspect the current codebase and report which requirements are already implemented, incomplete, or incompatible with the current architecture.

Do not blindly rewrite the application. Preserve working functionality, protect user data, and implement the requirements in reviewable phases.

Use compatible tools and libraries only where they add meaningful value. Test the behavior, document decisions, and ask the product owner for clarification when needed.

At the end of implementation, provide a requirement-by-requirement status report, test results, known limitations, and a list of decisions or requirements that remain unresolved.

**The goal is a reliable, consistent, maintainable Task Tracker whose task list, recurrence system, reminders, calendar, and archive all agree about the same underlying task occurrences.**
