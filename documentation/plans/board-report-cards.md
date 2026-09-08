# Board report dashboard

Confirmed shape: the end-of-run Orchestrate report is a full-width dashboard. Primary job is scan outcomes, then land git, unstick failed work, or start a follow-up chat.

## Design

- Product, Restrained. Theme follows the app. Semantic color on badges, stat tiles, and diffstats only.
- Full width (`96rem` cap), pane gutter from `.ov2__board`. It is tabular data, not prose.
- Header bar: board name, verdict, run summary, and every action (back, rerun, follow-up, commit).
- Stat tiles: merged, abandoned, skipped, runs, files, lines, integration. Zero-valued abandoned/skipped tiles are dropped.
- **Needs attention** is triage: one row per unfinished card + the failed integration check. Id, title, why, badge, and one button (Reset task / Fix and re-verify). No attempts, no patches, no evidence.
- **Tasks** is every task, one closed row: id, title, phase, run count, GitHub-style diffstat.
- Opening a row shows Runs (role, outcome, blockers, one-sentence scent) beside Files (path + `+/−` + proportion bar).
- Merged tasks get real counts from the merge commit; unmerged ones show journaled paths with no counts rather than invented zeros.
- Raw patches are not in the report — the task-detail overlay owns per-file diffs.
- Run notes and the journal stay collapsed at the bottom.

## Todos

- [x] Dashboard shell, stat tiles, attention list, task rows in `board-report.ts`
- [x] Per-task file stats + diffstat/diffbar in `report-files.ts`
- [x] `BoardReportActions.resetTask` wired to `commandResetTask`
- [x] Chrome, alignment, narrow-container behaviour in `orchestrator-boards.css`
- [x] Tests for attention rows + Reset, task-row open/close, files, and the diff bar
- [x] Update `documentation/context.md` and the boards manual
- [x] Verify in the report preview (dark, light, 1280px, 760px)
