---
name: issues-expander-and-detail-fixes
overview: Fix three Issues-app UX defects in one commit — the detail pane not refreshing after expander apply or label edits (MIN-278), the Issues expander using the last chat's model instead of the top-bar default (MIN-275), and the expander not proposing labels/priority (MIN-276).
todos:
  - id: W1-A
    content: "Wave 1: Refresh issue detail after expander apply and label edits (MIN-278)"
    status: pending
  - id: W1-B
    content: "Wave 1: Issues expander uses top-bar default model, not active chat (MIN-275)"
    status: pending
  - id: W2-A
    content: "Wave 2: Expander proposes labels and priority in the review overlay (MIN-276)"
    status: pending
isProject: true
---

# Issues Expander & Detail Pane Fixes

**Date:** 2026-09-07
**Goal:** Land MIN-275, MIN-276, MIN-278 as one commit — three small, related Issues-app UX defects that share the expander/detail code path.
**Granularity:** medium

## Context

Three backlog Issues cards describe adjacent defects in the Issues app:

- **MIN-278** — "Issue details don't update until you switch issues": after expanding an issue (Apply) or changing a label, the open detail pane shows stale data until the user switches issues and back.
- **MIN-275** — "Issues expander uses last chat selected model instead of the top bar": the sparkles expander resolves its model from `getActiveChat()`, so it ignores the global default model (`#modelSelect` / the menubar "Default model" chip).
- **MIN-276** — "Issues Expander should also add labels and priority": the expander rewrites title + description only; labels and priority are neither shown to the model nor written on Apply.

They belong in one commit because all three touch the same small surface (`src/ui/issues-expand.ts`, the expander prompt/parse module, and the detail refresh path), share the same review-overlay UX, and are each independently verifiable with the existing happy-dom test harness. No new dependencies; no schema changes.

### Verified root causes

**MIN-278:** `updateIssue` → `touchIssuesStore()` → `emitIssuesChange()` synchronously (`src/state/issues-store.ts:1053-1056`, `:1615`). The Issues page subscribes and calls `renderIssuesPanel()` (`src/ui/issues-page.ts:1952-1954`), which refreshes the open detail only when `!isIssuesDetailEditing()` (`src/ui/issues-page.ts:1679-1681`). `isIssuesDetailEditing()` (`src/ui/issues-detail.ts:203-219`) returns `true` while the expand overlay is open or a labels field is focused. `applyExpand()` (`src/ui/issues-expand.ts:273-290`) calls `updateIssue` **while the overlay is still open**, so the emit lands inside the guarded window and the detail never re-renders. Label edits via the row/board field while the detail is open hit the same guard (labels field focused), leaving the detail pane's own labels field (a separate instance with local `currentLabels` state) stale.

**MIN-275:** `fetchExpandedIssue` (`src/ui/issues-expand-client.ts`) calls `resolveExpandPromptBinding()` (`src/ui/composer-expand-client.ts:59-64`), which resolves from `getActiveChat()` (`src/state/sessions.ts:1552`) — the last chat's per-chat model — before falling back to the default provider. The top-bar default (`#modelSelect`, `src/ui/default-model.ts` `readDefaultModelBinding`) is never consulted.

**MIN-276:** `buildExpandIssueMessages` (`src/chat/issues/expand-issue.ts`) sends only id/type/title/description/notes; the system prompt explicitly says "Do not change type, status, labels, or priority"; the XML output spec has only `<title>` and `<description>`; `ExpandedIssueDraft` carries only title/description; the overlay has only title + description inputs; `applyExpand` writes only `{ title, description }`.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `src/ui/issues-expand.ts` | Review overlay + Apply/Discard; `applyExpand`, `paintDraft`, `ensureOverlay` | MODIFY (W1-A, W2-A) |
| `src/ui/issues-labels-field.ts` | `createIssuesLabelsField` + `IssuesLabelsFieldOptions` | MODIFY (W1-A) |
| `src/ui/issues-detail.ts` | Detail pane; `isIssuesDetailEditing`, labels field call site `:669` | MODIFY (W1-A) |
| `src/ui/issues-page.ts` | List/board render; row labels field call site `:1330` | MODIFY (W1-A) |
| `src/ui/issues-expand-client.ts` | `fetchExpandedIssue`; binding resolution | MODIFY (W1-B) |
| `src/ui/composer-expand-binding.ts` | Pure binding helpers (`resolveExpandPromptBindingFromChat`) | MODIFY (W1-B) |
| `src/chat/issues/expand-issue.ts` | Prompt builder + parser (`buildExpandIssueMessages`, `parseExpandedIssue`, `mergeExpandedIssue`) | MODIFY (W2-A) |
| `test/ui/issues-expand.test.mts` | Overlay happy-dom suite | MODIFY (W1-A, W2-A) |
| `test/ui/issues-labels-field.test.mts` | Labels field happy-dom suite | MODIFY (W1-A) |
| `test/ui/composer-expand-binding.test.mts` | Pure binding tests | MODIFY (W1-B) |
| `test/issues/expand-issue.test.mts` | Prompt/parse unit tests | MODIFY (W2-A) |

## Wave Breakdown

### Wave 1 — Refresh + model binding (independent, run concurrently)

#### Task W1-A: Refresh issue detail after expander apply and label edits (MIN-278)
- **Build:**
  - `src/ui/issues-expand.ts` — in `applyExpand()`, after `closeOverlay()` and `syncExpandButtons()`, add `void import('./issues-detail').then((m) => m.refreshIssueDetailIfOpen());`. Use the **dynamic import** (same pattern as `src/ui/issues-page.ts:1386` and `:1478`) — a static import would create a cycle (`issues-detail.ts` → `issues-expand-controls.ts` → lazy `issues-expand.ts` → `issues-detail.ts`). The overlay is closed by then, so `isIssuesDetailEditing()` no longer blocks anything.
  - `src/ui/issues-labels-field.ts` — add `onBlur?: () => void` to the `IssuesLabelsFieldOptions` interface (lines 18-24). In `createIssuesLabelsField`, attach a `focusout` listener on `root` that calls `options.onBlur?.()` only when focus leaves the field **and** any labels popover: fire when `!root.contains(event.relatedTarget as Node | null)` **and** `!isIssuesLabelPopoverFocused()`. The add-flyout popover is appended to `document.body` (`src/ui/issues-label-chip.ts:80`), so `root.contains` alone is not enough — without the popover check, opening the add flyout would tear down the detail mid-interaction.
  - `src/ui/issues-detail.ts:669` — pass `onBlur: () => refreshIssueDetailIfOpen()` to the detail-variant `createIssuesLabelsField` call.
  - `src/ui/issues-page.ts:1330` — pass the same `onBlur` to the row-variant call. `refreshIssueDetailIfOpen` is already imported there (line 112); it is a no-op when no detail is open.
- **Test:**
  - `test/ui/issues-expand.test.mts` — new test: `openIssueDetail('MIN-8')`, run `startIssueExpandFromUi('MIN-8')` with the mocked fetcher, click `issuesExpandApply`, then assert the detail pane DOM reflects the new title (query `.issues-detail__title` text) **without** switching issues. Assert `findIssueById('MIN-8')?.title` is the applied title.
  - `test/ui/issues-labels-field.test.mts` — new test: pass `onBlur` spy; focus the field input, then move focus to an element outside the field and assert the spy fired once; assert it does **not** fire while focus stays inside the field.
  - Run: `node --test --test-force-exit test/ui/issues-expand.test.mts test/ui/issues-labels-field.test.mts`
- **Accept:** After Apply on the expander (or after a label change via the row field), the open detail pane updates immediately — no issue switch needed; the labels popover still opens without tearing down the detail.
- **Touches:** `src/ui/issues-expand.ts`, `src/ui/issues-labels-field.ts`, `src/ui/issues-detail.ts`, `src/ui/issues-page.ts`, `test/ui/issues-expand.test.mts`, `test/ui/issues-labels-field.test.mts`

#### Task W1-B: Issues expander uses top-bar default model, not active chat (MIN-275)
- **Build:**
  - `src/ui/composer-expand-binding.ts` — add a pure helper next to `resolveExpandPromptBindingFromChat`:
    ```ts
    /** Issues expander binding: settings override, else the global default model (top bar), else default provider. */
    export function resolveIssueExpandPromptBindingFromDefault(
      config: PromptExpanderConfig,
      defaultBinding: { providerId?: string; modelId: string },
      fallbackProviderId: string,
    ): ExpandPromptBinding {
      return resolveExpandPromptBindingFromChat(
        config,
        { providerId: defaultBinding.providerId ?? '', modelId: defaultBinding.modelId },
        fallbackProviderId,
      );
    }
    ```
    (`PromptExpanderConfig` is already imported there via `../config/prompt-expander-meta`.)
  - `src/ui/issues-expand-client.ts` — stop importing `resolveExpandPromptBinding` from `./composer-expand-client`; import `resolveIssueExpandPromptBindingFromDefault` from `./composer-expand-binding` and `readDefaultModelBinding` from `./default-model` instead. In `fetchExpandedIssue`, replace the `resolveExpandPromptBinding()` call with a local resolver:
    ```ts
    async function resolveIssueExpandPromptBinding(): Promise<ExpandPromptBinding> {
      const config = await loadPromptExpanderConfig();
      const { modelId, providerId } = readDefaultModelBinding();
      const fallbackProviderId = (await resolveProvider()).id;
      return resolveIssueExpandPromptBindingFromDefault(
        config,
        { providerId, modelId },
        fallbackProviderId,
      );
    }
    ```
    `loadPromptExpanderConfig` and `resolveProvider` are already imported in this file. `readDefaultModelBinding` reads `#modelSelect` and falls back to `''` when the select is absent (safe in happy-dom tests). **Do not touch** `resolveExpandPromptBinding` in `composer-expand-client.ts` — Code-chat prompt expansion still correctly uses the active chat's model.
- **Test:**
  - `test/ui/composer-expand-binding.test.mts` — add a `resolveIssueExpandPromptBindingFromDefault` describe block: settings override wins; default model used when settings are unset; fallback provider used when the default binding has a model but no provider.
  - Run: `node --test --test-force-exit test/ui/composer-expand-binding.test.mts`
- **Accept:** The Issues sparkles expander runs on the model shown in the top-bar "Default model" chip (or the Settings prompt-expander override), regardless of which chat was last active.
- **Touches:** `src/ui/issues-expand-client.ts`, `src/ui/composer-expand-binding.ts`, `test/ui/composer-expand-binding.test.mts`

### Wave 2 — Labels + priority in the expander

#### Task W2-A: Expander proposes labels and priority in the review overlay (MIN-276)
- **Build:**
  - `src/chat/issues/expand-issue.ts`:
    - Extend `IssueExpandSource` (the `Pick<IssueCard, …>` at line 27) with `'labels' | 'priority'`.
    - Extend `ExpandedIssueDraft` with `labels?: string[]` and `priority?: string`.
    - `buildExpandIssueMessages`: add `fieldBlock('Labels', (issue.labels ?? []).join(', '), …)` and `fieldBlock('Priority', issue.priority ?? '', …)` to the user message; change the system-prompt rule `'- Do not change type, status, labels, or priority.'` to `'- Do not change type or status. You may propose labels and a priority consistent with the card.'`; extend the XML output spec with `<labels>comma, separated</labels>` and `<priority>priority-id</priority>`.
    - `parseXmlDraft`: parse `<labels>` (split on `,`, trim, drop empties) and `<priority>` (trim). Also extend `parseJsonDraft` (`labels: string[]`, `priority: string`) and `parseLabeledDraft` (`labels:` / `priority:` lines) for robustness.
    - `mergeExpandedIssue`: accept the extended draft; fall back to `original.labels` / `original.priority` when the draft omits them. Keep the existing title/description behavior.
  - `src/ui/issues-expand.ts`:
    - Extend `ExpandRun.original` to `{ title, description, labels: string[], priority: string }` and `startIssueExpandFromUi` to capture them from the issue.
    - `ensureOverlay()` / `overlayEls()`: add a labels text input (`issuesExpandLabels`, comma-separated, `aria-label="Expanded labels"`) and a priority `<select>` (`issuesExpandPriority`) populated from `sortedPriorities(getIssuesTaxonomySync())` with a leading `''` "—" option. Import `getIssuesTaxonomySync` from `../state/issues-taxonomy-store` and `sortedPriorities` from `../issues/taxonomy`.
    - `paintDraft`: fill both controls from the draft (`labels.join(', ')`, `priority`).
    - `applyExpand`: read the controls; normalize labels via `normalizeIssueLabelsList` (import from `../issues/label-catalog`); validate priority against the taxonomy ids (fall back to `run.original.priority` when empty or not in the taxonomy); call `updateIssue(issueId, { title, description, labels, priority })`.
    - `syncApplyEnabled` stays title-driven (unchanged).
  - Do **not** add type/status controls — the "do not change type/status" invariant is preserved.
- **Test:**
  - `test/issues/expand-issue.test.mts` — new cases: `parseExpandedIssue` extracts `<labels>` and `<priority>` from XML; JSON draft with `labels` array; `mergeExpandedIssue` keeps original labels/priority when the draft omits them.
  - `test/ui/issues-expand.test.mts` — new test: seed an issue with `labels: []`, `priority: 'none'`; mocked fetcher returns a draft with `labels: ['ux', 'bug']` and `priority: 'high'`; assert the overlay inputs show them; click Apply; assert `findIssueById('MIN-8')` has those labels and priority.
  - Run: `node --test --test-force-exit test/issues/expand-issue.test.mts test/ui/issues-expand.test.mts`
- **Accept:** Expanding an issue proposes labels and a priority in the review overlay, and Apply persists them alongside title/description; type and status are never touched.
- **Touches:** `src/chat/issues/expand-issue.ts`, `src/ui/issues-expand.ts`, `test/issues/expand-issue.test.mts`, `test/ui/issues-expand.test.mts`
- **Depends on:** W1-A

## Verification Checklist

- [ ] `node --test --test-force-exit test/ui/issues-expand.test.mts test/ui/issues-labels-field.test.mts test/ui/composer-expand-binding.test.mts test/issues/expand-issue.test.mts` — all green
- [ ] `npm run test:issues` (or the issues scoped suite) — no regressions
- [ ] `npx tsc --noEmit` — clean (strict mode, no ESLint config)
- [ ] `npm run test:check-coverage` — touched files still covered by the extended suites
- [ ] Manual spot-check: expand an issue → Apply → detail pane shows the new title immediately; change a label on a row while the detail is open → detail labels update; expander runs on the top-bar default model

## Notes for Build Agents

- **Commit message convention:** `[ISS-275] [ISS-276] [ISS-278] Issues: expander labels/priority + default-model binding + detail refresh` (branch `issue/iss-n-<slug>` per the Issues git convention).
- **Cycle hazard:** `issues-expand.ts` must load `issues-detail.ts` via dynamic `import()` — a static import creates a module cycle through `issues-expand-controls.ts`.
- **Labels popover:** the add-label flyout mounts on `document.body`, so the W1-A `focusout` handler must also check `isIssuesLabelPopoverFocused()` before firing `onBlur`, or opening the flyout will tear down the detail pane.
- **Composer expander untouched:** `resolveExpandPromptBinding` in `src/ui/composer-expand-client.ts` stays as-is; only the Issues expander (`issues-expand-client.ts`) switches to the default-model binding.
- **Type/status invariant (MIN-276):** the expander may propose labels/priority but must never change type or status — no type/status fields in the overlay, and the system prompt must keep that rule.
- **Test style:** happy-dom suites in `test/ui/` set the DOM globals in `setupDom()` (see `test/ui/issues-expand.test.mts:22-45`); reuse that pattern. Run `node --test` with `--test-force-exit` (project convention).
- Match surrounding code style: no new CSS tokens, no new dependencies, no schema/persistence changes.