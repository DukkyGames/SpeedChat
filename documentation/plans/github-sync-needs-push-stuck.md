---
name: github-sync-needs-push-stuck
overview: Fix the Issues GitHub sync "Needs push" indicator so it reflects only GitHub-shaped field changes (title/description/labels/closed) instead of any updatedAt bump, and make a sync self-heal stale watermarks so the caption clears even when content is already equal.
todos:
  - id: W1-A
    content: "Wave 1: Add localDirty flag semantics to IssueGithubLink and the pure sync planner"
    status: pending
  - id: W1-B
    content: "Wave 1: Update pure tests for the localDirty watermark semantics"
    status: pending
  - id: W2-A
    content: "Wave 2: Set localDirty in updateIssue and carry it through parseIssueGithubLink"
    status: pending
  - id: W2-B
    content: "Wave 2: Reorder writeLink watermark capture and self-heal stale watermarks on noop sync"
    status: pending
  - id: W2-C
    content: "Wave 2: Integration and regression tests for the dirty-flag lifecycle"
    status: pending
isProject: true
---

# GitHub Sync "Needs push" Never Clears

**Date:** 2026-09-08
**Goal:** Make the "Needs push" caption on linked Issues reflect real unsynced GitHub-shaped edits, and ensure a successful sync (manual, Sync all, or auto-poll) always clears it.
**Granularity:** medium

## Context

MIN-287: every linked issue shows "Needs push" even when content is already synced, and clicking **Sync** does not clear it.

Root cause is a timestamp heuristic that conflates "any store write" with "a GitHub-shaped edit":

1. `issueNeedsGithubPush` (`src/issues/github-sync-plan.ts:182`) returns `issue.updatedAt > (link.localUpdatedAt ?? link.syncedAt)`.
2. `updateIssue` (`src/state/issues-store.ts:1614`) bumps `issue.updatedAt = nowMs` on **every** patch — rank reorder, assignee, notes, triage, project, parent, chat links — even when no synced field changed. The `githubSyncedFieldsChanged` check at line 1617 only gates the auto-sync notify, not the bump. So any of those edits flags the card "Needs push".
3. The sync itself poisons the watermark: `writeLink` (`src/state/issues-github.ts:391`) captures `localUpdatedAt` **before** `appendIssueLinks` appends the `github-issue` git link, which bumps `updatedAt` (first push/import only). The sync's own bookkeeping looks like a local edit.
4. Sync can never heal it: when content fields are equal, `planIssueSync` returns `noop` ("Already in sync") and `runIssueSync` does not refresh the watermark. The caption sticks at "Needs push" forever.

Fix (confirmed with user): an explicit `localDirty` flag on `IssueGithubLink`, set only when GitHub-shaped fields actually change; `nextGithubLink` always writes `localDirty: false` on successful sync; a `noop` sync with equal content self-heals a stale watermark (no data migration — existing stuck cards heal on their next sync/auto-poll); non-synced edits (rank, assignee, notes, triage, …) no longer flag the card; "Needs push" still shows when sync mode is Off (no affordance change).

Conflict detection (`hasLocalChanged`) switches to the same flag when present, so a rank reorder no longer turns a remote-only edit into a spurious conflict. Legacy links (no `localDirty`) keep the timestamp fallback until their first successful sync converts them.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `src/types.ts` | `IssueGithubLink` interface (~line 870) | MODIFY — add `localDirty?: boolean` |
| `src/issues/github-sync-plan.ts` | Pure sync decisions; `issueNeedsGithubPush`, `hasLocalChanged`, `nextGithubLink` | MODIFY — flag-first semantics, always-clear on sync |
| `src/state/issues-store.ts` | `updateIssue` (line 1533), `parseIssueGithubLink` (line 572), `NORMALIZED_GITHUB_KEYS` (line 556) | MODIFY — set flag on synced-field writes; carry flag through parse |
| `src/state/issues-github.ts` | `writeLink` (~line 391), `runIssueSync` (~line 140) | MODIFY — watermark after link append; noop self-heal |
| `test/issues/github-sync-plan.test.mts` | Pure planner tests | MODIFY — `nextGithubLink` deepEqual, flag cases |
| `test/issues/github-sync-status.test.mts` | Caption tests | MODIFY — flag cases |
| `test/issues/github-sync-push.test.mts` | Push flow with mocked forge fetch | MODIFY — flag cleared after push; rank bump does not push |
| `test/issues/github-auto-sync.test.mts` | Auto loop tests | MODIFY — noop self-heal coverage |
| `test/issues/github-import.test.mts` | Import flow | MODIFY — imported cards not flagged |
| `test/issues/github-sync-dirty-flag.test.mts` | New end-to-end flag lifecycle | CREATE |

Persistence is safe without a schema bump: both the client (`parseIssueGithubLink` → `preserveUnknownKeys`) and the server (`ensureIssueCard` → `preserveUnknownKeys`) keep unknown keys on `github`. `localDirty` is an optional field; do **not** touch `ISSUES_COMPAT_VERSION` or `schemaRevision`.

## Wave Breakdown

### Wave 1 — Pure semantics (no I/O)

Tasks here run concurrently unless they declare `Depends on:`.

#### Task W1-A: Add `localDirty` to `IssueGithubLink` and the pure planner
- **Build:**
  - In `src/types.ts`, add `localDirty?: boolean` to `IssueGithubLink` (after `localUpdatedAt`, ~line 880) with a doc comment: "True when a GitHub-shaped field (title/description/labels/closed) changed locally since the last successful sync. Absent = legacy link, fall back to timestamps."
  - In `src/issues/github-sync-plan.ts`:
    - Change `issueNeedsGithubPush(issue)` (line 182): unlinked → `false`; `link.localDirty === true` → `true`; `link.localDirty === false` → `false`; `link.localDirty === undefined` → keep the existing `hasLocalChanged` timestamp fallback.
    - Change `hasLocalChanged(issue, link)` (line 176): same flag-first pattern — `link.localDirty !== undefined` → `link.localDirty === true`; else `issue.updatedAt > (link.localUpdatedAt ?? link.syncedAt)`.
    - Change `nextGithubLink` (line 198): always write `localDirty: false` on the returned link (it is only called after a successful sync/import). Keep `repo`/`remoteUpdatedAt` conditional behavior unchanged.
  - Do **not** change `planIssueSync`, `syncFieldsEqual`, `githubLabelDiff`, or `hasRemoteChanged` — they are correct as-is.
- **Test:** `npx tsc --noEmit` passes. Run `node --import ./test/test-loader.mjs --test test/issues/github-sync-plan.test.mts` — the `nextGithubLink` deepEqual at line 273 fails until W1-B updates it; that is expected mid-wave, so gate this task's Test on the W1-B update or run the suite after W1-B.
- **Accept:** `issueNeedsGithubPush` returns `true` only when `localDirty === true` (or legacy timestamp says so), and every `nextGithubLink` result carries `localDirty: false`.
- **Touches:** `src/types.ts`, `src/issues/github-sync-plan.ts`
- **Depends on:** (none)

#### Task W1-B: Update pure tests for the new watermark semantics
- **Build:**
  - In `test/issues/github-sync-plan.test.mts`:
    - Update the `watermark` deepEqual (line 273) to include `localDirty: false` in the expected object.
    - In the `issueNeedsGithubPush` describe (line 300), add: `localDirty: true` → `true` even when `updatedAt === syncedAt`; `localDirty: false` → `false` even when `updatedAt` is after the watermark; absent flag + `updatedAt` after watermark → `true` (legacy fallback).
    - Add a `planIssueSync` case proving a non-synced bump does not conflict: link with `localDirty: false`, `updatedAt` after watermark, remote with newer `updatedAt` and differing content → action is `pull`, not `conflict`.
  - In `test/issues/github-sync-status.test.mts`, add: `localDirty: true` → `'Needs push'`; `localDirty: false` with `updatedAt` after watermark → `synced …` caption.
- **Test:** `node --import ./test/test-loader.mjs --test test/issues/github-sync-plan.test.mts test/issues/github-sync-status.test.mts` — all pass, including the pre-existing timestamp-fallback cases (they still hold because the helpers omit `localDirty`).
- **Accept:** Both pure test files pass with the new flag cases; no test asserts the old "any updatedAt bump means Needs push" behavior.
- **Touches:** `test/issues/github-sync-plan.test.mts`, `test/issues/github-sync-status.test.mts`
- **Depends on:** W1-A

### Wave 2 — Store, orchestration, and integration tests

#### Task W2-A: Set `localDirty` in `updateIssue` and carry it through parse
- **Build:**
  - In `src/state/issues-store.ts` `updateIssue` (line 1533), at the existing `githubSyncedFieldsChanged` branch (line 1617): when `!options?.skipGithubAutoSync && githubSyncedFieldsChanged(beforeSynced, afterSynced)` and `issue.github` exists, set `issue.github.localDirty = true` **before** `notifyGithubSyncedFieldWrite(issueId)`. Keep the notify call. `skipGithubAutoSync` (pulls via `applyRemoteToIssue`) must never set the flag.
  - In `parseIssueGithubLink` (line 572): add `if (typeof row.localDirty === 'boolean') out.localDirty = row.localDirty;` and add `'localDirty'` to `NORMALIZED_GITHUB_KEYS` (line 556).
  - Do **not** set the flag in `appendIssueLinks` or `addIssue` — they never change synced fields.
- **Test:** `node --import ./test/test-loader.mjs --test test/issues/github-sync-dirty-flag.test.mts` (after W2-C lands) plus `npx tsc --noEmit`. Interim: assert via a scratch happy-dom/tsx probe that `updateIssue({ rank })` leaves `github.localDirty` unset while `updateIssue({ title })` sets it.
- **Accept:** Editing title/description/labels/status on a linked card sets `github.localDirty = true`; editing rank/assignee/notes/triage/project/chatIds does not; a pull (`skipGithubAutoSync`) does not.
- **Touches:** `src/state/issues-store.ts`
- **Depends on:** W1-A

#### Task W2-B: Reorder `writeLink` watermark capture and self-heal on noop sync
- **Build:**
  - In `src/state/issues-github.ts` `writeLink` (~line 391): call `appendIssueLinks(issueId, { gitLinks: [...] })` **first**, then re-read the card with `findIssueById(issueId)` and set `fresh.github = nextGithubLink({ previous: fresh.github, number, url, localUpdatedAt: fresh.updatedAt, remoteUpdatedAt, now: Date.now() })`. Keep `scheduleSaveIssues()`. This captures the watermark after the link-append bump so the sync's own bookkeeping no longer counts as a local edit, and `nextGithubLink` clears `localDirty`.
  - In `runIssueSync` (~line 140), `case 'noop':` — when `action.reason === 'Already in sync'`, `remote` is non-null, and `issueNeedsGithubPush(issue)` is true (stale flag or legacy timestamp), call `writeLink(issueId, issue.github?.number ?? remote.number, issue.github?.url ?? remote.url, remote.updatedAt)` to refresh the watermark and clear the flag. Return the same `{ ok: true, action: 'noop', error: action.reason }` either way. Do **not** self-heal on the `'GitHub sync is off'` noop (no network in off mode).
  - `syncIssueWithGithub`, `resolveSyncConflict`, `syncAllIssuesWithGithub`, `importGithubIssues` need no changes — they all funnel through `writeLink`/`runIssueSync`.
- **Test:** `node --import ./test/test-loader.mjs --test test/issues/github-sync-push.test.mts test/issues/github-auto-sync.test.mts test/issues/github-import.test.mts test/issues/github-sync-dirty-flag.test.mts` — all pass (W2-C adds the new coverage).
- **Accept:** After a successful push/pull/import, `issue.github.localDirty` is `false` and `localUpdatedAt >= updatedAt`; a manual Sync or auto-poll on a card with equal content but a stale watermark flips the caption from "Needs push" to "synced …".
- **Touches:** `src/state/issues-github.ts`
- **Depends on:** W1-A, W2-A

#### Task W2-C: Integration and regression tests for the dirty-flag lifecycle
- **Build:**
  - Create `test/issues/github-sync-dirty-flag.test.mts` following the mocked-fetch pattern in `test/issues/github-sync-push.test.mts` (stub `localStorage`, `setIssuesStateForTests`, `setIssuesGithubMode('mirror')`, `setLocalServerAvailableForTests(true)`, fake `fetch` answering `issueView`/`issueEdit`/`issueState`/`issueCreate`). Cover:
    1. `updateIssue({ title })` on a linked card sets `github.localDirty = true` and `githubSyncCaption` returns `'Needs push'`.
    2. `updateIssue({ rank })` / `updateIssue({ assignee })` leaves the flag unset and the caption stays `synced …`.
    3. `syncIssueWithGithub` with equal content and a stale `localDirty: true` → returns `noop`, clears the flag, caption becomes `synced …` (self-heal, no `issueEdit` call).
    4. `syncIssueWithGithub` with differing content → `push`, flag cleared, watermark `localUpdatedAt >= updatedAt`.
    5. Remote-only change with `localDirty: false` → `pull` (not conflict), flag stays clear.
    6. `applyRemoteToIssue` path (pull) does not set the flag.
  - In `test/issues/github-sync-push.test.mts`: assert the post-push link has `localDirty: false`; add a case where a rank-only bump does not trigger `issueEdit` (noop).
  - In `test/issues/github-auto-sync.test.mts`: assert the linked-only poll pass heals a stale flag without surfacing a conflict or error.
  - In `test/issues/github-import.test.mts`: assert imported cards end with `localDirty: false` and caption `synced …`.
- **Test:** `npm run test:issues` passes (this suite globs `test/issues/**`); then `npm test` for the full suite.
- **Accept:** The new file and the updated existing files all pass; the full issues suite is green.
- **Touches:** `test/issues/github-sync-dirty-flag.test.mts`, `test/issues/github-sync-push.test.mts`, `test/issues/github-auto-sync.test.mts`, `test/issues/github-import.test.mts`
- **Depends on:** W2-A, W2-B

## Verification Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run test:issues` passes
- [ ] `npm test` passes (full suite; note pre-existing unrelated failures on `main` per AGENTS.md — scope to the issues area)
- [ ] Manual: open a linked issue that shows "Needs push" with equal content → click **Sync** → caption flips to `synced …` and stays after reload
- [ ] Manual: reorder a card (rank) → caption stays `synced …`; edit the title → caption flips to "Needs push" → Sync clears it

## Notes for Build Agents

- **Keep the planner pure.** `src/issues/github-sync-plan.ts` is deliberately I/O-free and exhaustively tested — all network/store work stays in `src/state/issues-github.ts` and `issues-store.ts`. Do not add fetch/store imports to the planner.
- **`nextGithubLink` always writes `localDirty: false` explicitly** — that is what converts legacy links (no flag) to flag mode after their first successful sync. Omitting it would leave them on the timestamp fallback forever and the bug would resurface after any rank/assignee edit.
- **`updateIssue` flag rule:** set `localDirty: true` only when `githubSyncedFieldsChanged(beforeSynced, afterSynced)` is true, `skipGithubAutoSync` is falsy, and `issue.github` exists. Pulls (`applyRemoteToIssue`) pass `skipGithubAutoSync: true` — a remote→local write must never look dirty.
- **No schema bump.** `localDirty` is optional; `preserveUnknownKeys` on both client (`parseIssueGithubLink`) and server (`ensureIssueCard`) round-trips it. Do not touch `ISSUES_COMPAT_VERSION` / `schemaRevision`.
- **Caption and CSS need no changes.** `githubSyncCaption` and the `is-needs-push` class read `issueNeedsGithubPush`; the fix is entirely upstream of them.
- **Self-heal scope:** only the `'Already in sync'` noop heals (it has a non-null `remote`). The `'GitHub sync is off'` noop must stay a pure no-op — no network, no watermark write.
- **Test conventions:** pure tests import from `src/issues/github-sync-plan.ts` directly; integration tests stub `globalThis.fetch` for `/api/git` ops and use `setIssuesStateForTests` + `resetIssuesGithubForTests` + `setLocalServerAvailableForTests` (see `test/issues/github-sync-push.test.mts` for the exact harness). Run single files with `node --import ./test/test-loader.mjs --test <file>`.