# Board task Reset and Rewind

**Status:** Done

Two task actions so a card can be re-run from a clean slate. Retry (`board.reopened`) is unchanged: it keeps attempt history and never rewinds git.

## Decisions (confirmed)

- **Reset** never touches a merged task. It wipes one non-merged card (plus skipped dependents blocked by it): attempt history in the UI, transcript files, worktree, and attempt branch. Integration is untouched.
- **Rewind** is the merged-task action. It restores the integration worktree to that merge’s `beforeSha` and resets this task plus every later merged/started/in-flight/merge-queued card (and skipped cards blocked by that set).
- After success, cards sit **Planned**. Do not auto-start. If the board is already Running, the scheduler may pick eligible idle work on the next tick — the confirm dialog says so.
- The journal stays append-only. `task.reset` / `board.rewound` make derive treat listed cards as never-run. Attempt transcript files on disk are deleted. `journal.jsonl` is not rewritten.

## Todos

- [x] Write this plan with agreed Reset vs Rewind behavior
- [x] Add `task.reset` and `board.rewound` to the event vocabulary, types, derive fold, and `rewindCascade` helper
- [x] Implement `engine.resetTask` / `rewindFrom`, HTTP POST routes, workspace mutating gate
- [x] Client methods, danger Reset / Rewind buttons on card + detail, confirm copy
- [x] Engine / phase9 / kanban tests; update `boards.md` and `context.md`; verify in Boards UI

## Actions

| Control | When it shows | What it destroys | Git integration |
| --- | --- | --- | --- |
| **Reset** | Not merged, and the card has debris (attempts, abandoned, skipped, merge conflict, or in the merge queue) | This task plus skipped dependents blocked by it | Untouched |
| **Rewind** | Merged | This task plus later merged / started / in-flight / merge-queued work, and skipped cards blocked by that set | `git reset --hard` integration to this merge’s `beforeSha` |
| **Retry** | Unchanged | Nothing | Untouched |

Idle never-started cards keep Start / Abandon only. Merged cards hide the disabled Start / Abandon pair and show **Rewind** instead.

## Journal

- `task.reset` — `{ taskIds: string[], reason: 'user' }`
- `board.rewound` — `{ fromTaskId, beforeSha, taskIds, reason: 'user' }`

Fold wipes runtime fields only (attempts, outcome, abandoned/skipped, mergedSha, mergeConflicts, overflow, reopened) and pulls ids out of `mergeQueue`. Spec fields stay. Both events clear `finished`, `finalTest`, and `runSummary` so a finished board is not stuck quiescent.

Side effects run before the append: stop agents, abort an in-progress merge, restore integration (Rewind only), release worktrees, delete attempt branches, delete transcript files.

## Out of scope

- Physically deleting lines from `journal.jsonl`
- Auto-starting after Reset/Rewind
- Rewinding the workspace `main`/`master` branch
- Changing Retry / Abandon semantics
