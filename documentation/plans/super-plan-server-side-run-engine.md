---
name: super-plan-server-side-run-engine
overview: Rebuild Super Plan as a server-side run engine on the existing Orchestrator V2 engine — a new `server/super-plan/` namespace with a pure decision core (events/derive/plan/policy/graph), a journal at `~/.minnow/superplan/`, a split effector (headless for review/research/polish, delegated-lease for chat-visible interview/draft), journaled interactive gates replacing spec_confirm/present stages, and a chat-state projection — compressing 10 stages to 5 roles + 2 gates, then deleting the legacy renderer controller. Reliability precedes quality: Phase 0 unblocks known defects (D1/D2/D7/D8), Phases 1–2 add the pure core and headless execution additively, Phase 3 moves the renderer from controller to remote effector, Phases 4–6 add gates, projection and artifact contracts, Phase 7 deletes the old controller.
todos:
  - id: W1-A
    content: "Phase 0: Fix D1 — propagate timeoutMs/modeId through spawnSubAgent → middleware → effector-runner"
    status: pending
  - id: W1-B
    content: "Phase 0: Fix D2 — persist reviewTimeoutMs/grillEnabled/researchEnabled in normalizeSuperPlanConfig + home.js defaults"
    status: pending
  - id: W1-C
    content: "Phase 0: Fix D7 — interrupted status for zombie research runs"
    status: pending
  - id: W1-D
    content: "Phase 0: Fix D8 — stop-all pauses Super Plan instead of cancelling"
    status: pending
  - id: W2-A
    content: "Phase 1: Pure core — events.js, derive.js, plan.js, policy.js, graph.js, journal.js + purity/fold tests"
    status: pending
  - id: W3-A
    content: "Phase 2: Headless effector (effector-headless.js) + effector-split.js"
    status: pending
  - id: W3-B
    content: "Phase 2: HTTP middleware, live-events SSE channel, boot scan for non-terminal runs"
    status: pending
  - id: W3-C
    content: "Phase 2: Delete src/agents/self-healing/ and waitForSubAgent; engine-driven reconciliation tests"
    status: pending
  - id: W4-A
    content: "Phase 3: effector-delegated.js with leases (heartbeat/expiry, compare-and-set claim)"
    status: pending
  - id: W4-B
    content: "Phase 3: Renderer claim loop (src/chat/super-plan/claim-loop.ts) replacing controller.ts"
    status: pending
  - id: W5-A
    content: "Phase 4: ask-bridge.js journaled gates + gate effector + gate cards in UI"
    status: pending
  - id: W6-A
    content: "Phase 5: superPlanView projection on journal append + rebind plan library and UI"
    status: pending
  - id: W6-B
    content: "Phase 6: Per-stage report_outcome schemas and two-tier draft accept gate"
    status: pending
  - id: W6-C
    content: "Phase 6: Stable finding ids, open/resolved tracking, no-progress exit"
    status: pending
  - id: W7-A
    content: "Phase 7: Delete legacy controller pipeline (controller/stages/state/pipeline/resumable, adapters)"
    status: pending
isProject: true
---

# Super Plan rebuild — server-side run engine

**Date:** 2026-09-07
**Goal:** Move Super Plan sequencing, retries, gates and recovery onto the existing Orchestrator V2 engine so runs survive reloads/crashes, lost SSE frames cannot manifest as timeouts, recovery is automatic, and stage completion becomes a checked contract.
**Granularity:** medium

## Context

Super Plan is a 1–2 hour, 10-stage workflow executing entirely inside a renderer closure (`advanceSuperPlan`, `advancingChats`, live `Chat` refs, debounced SQLite persistence). The server has no Super Plan engine. Verified defects:

| ID | Defect | Evidence |
|----|--------|----------|
| D1 | `spawnSubAgent` drops `timeoutMs`/`modeId`; server uses static 20 min | `src/agents/orchestrator.ts:470`, `server/sub-agents/middleware.js`, `sub-agents.json:314` |
| D2 | `reviewTimeoutMs`, `grillEnabled`, `researchEnabled` never persist | `normalizeSuperPlanConfig` (`server/config/validators.js:1328`) whitelist omits them |
| D3 | Watchdog/self-healing dead code; quiet reviewer burns full wall clock | `src/agents/self-healing/*` test-only; `recordToolCallForRun` empty stub |
| D4 | `waitForSubAgent` SSE-push-only, no reconciliation | `src/agents/orchestrator.ts:539` |
| D5 | Silent stall when chat turn slot busy | `src/chat/super-plan/controller.ts:211`, `:104` |
| D6 | No resume-after-crash | `src/boot/resume-gate-boot.ts` ignores `chat.superPlan` |
| D7 | Zombie research: disk `running` forever; Retry reattaches and burns 30 min | `server/research/store.js:988` |
| D8 | "Stop all" is terminal for a 40-min pipeline | `src/chat/stop-all-agent-activity.ts:121` → `cancelSuperPlan` |
| D9 | No artifact contract; prose critique; no verification drafts addressed findings | `finalizeStreamStage` (`src/chat/super-plan/stages.ts:562`) |

**Architecture:** third engine namespace `server/super-plan/` following `server/sub-agents/` precedent — no changes to `server/orchestrator/engine.js` or `server/runner/`. Pure decision core (no I/O, no clock, no randomness — enforced by a purity test mirroring `test/orchestrator/core-purity.test.mjs`). Journal at `~/.minnow/superplan/<runId>/journal.jsonl` via `createJournalStore` (`server/orchestrator/journal-store.js`). `derive()` must expose `status`, `finished`, `stopReason` (read by `engine.js:213/:224/:426`). **Split effector:** headless (review/research/polish, in-process like `server/sub-agents/effector-runner.js`) vs delegated (interview/draft, lease-based, renderer runs `runChatTurn` with all overlays and POSTs the outcome). Sequencing server-owned; renderer is a remote effector, not a controller.

**Pipeline:** 10 stages → 5 roles + 2 gates (`interview` cond. → `gate:spec` → `research` cond. → `draft` ⇄ `review` → `polish` cond. → `gate:accept`). Median run: 4 model stages + 2 gates.

**Costs accepted:** two effector kinds; lease heartbeat protocol (10s heartbeat, 45s expiry) mitigated by `sameWork` (`engine.js:34`) + content-addressed `artifact.written`; chat-visible stages need a live renderer (CI covers headless E2E + scripted double); multi-window double-claim → 409 on `attemptId` CAS. Gate re-ask after crash accepted (prior answers remain in transcript).

**Migration:** parallel path, never big-bang. In-flight runs keep the legacy controller (`chat.superPlan` without `chat.superPlanRunId`); new runs get a runId. On-disk artifacts unchanged.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `server/super-plan/events.js` (+`.d.ts`) | Journal event vocabulary, `validateEvent` | CREATE |
| `server/super-plan/derive.js` (+`.d.ts`) | `derive(journal) → state`; exposes `status`/`finished`/`stopReason`; finding-id fnv1a | CREATE |
| `server/super-plan/plan.js` (+`.d.ts`) | `plan(state) → Desired[]`, concurrency 1, 8-line pipeline | CREATE |
| `server/super-plan/policy.js` (+`.d.ts`) | Outcome routing table (retry/skip/fail/stop) | CREATE |
| `server/super-plan/graph.js` (+`.d.ts`) | Graph descriptor, mirrors `server/sub-agents/graph.js` | CREATE |
| `server/super-plan/journal.js` | `createJournalStore({namespace:'superplan', fold: derive, validate: validateEvent})` | CREATE |
| `server/super-plan/effector-headless.js` | review/research/polish roles, modelled on `server/sub-agents/effector-runner.js` | CREATE |
| `server/super-plan/effector-delegated.js` | interview/draft leases; `inspect()` returns unexpired leases | CREATE |
| `server/super-plan/effector-split.js` | Routes by role behind one `plan()` | CREATE |
| `server/super-plan/ask-bridge.js` | `createJournaledAsk({engine, runId, attemptId, deliver})` — gate.opened/answered/expired | CREATE |
| `server/super-plan/middleware.js` | create/start/stop/resume/cancel/state/events (Last-Event-ID replay) | CREATE |
| `server/super-plan/live-events.js` | SSE live channel (research progress, gate cards, activity) | CREATE |
| `server/runtime/middlewares.js` | Boot scan wiring beside `bootAgentsRuntime()` | MODIFY |
| `server/config/validators.js` | `normalizeSuperPlanConfig` whitelist (D2) | MODIFY |
| `server/config/home.js` | Super Plan config defaults (D2) | MODIFY |
| `server/research/store.js` | `getResearchStatus` interrupted; `resolveReattachableResearchId` refuses (D7) | MODIFY |
| `src/agents/orchestrator.ts` | `spawnSubAgent` body + delete `waitForSubAgent` (D1, D4) | MODIFY |
| `server/sub-agents/middleware.js` | Parse `timeoutMs`/`modeId` onto `run.created` (D1) | MODIFY |
| `server/sub-agents/effector-runner.js` | Per-run timeout limit preferred over `typeRow.timeoutMs` (:649) (D1) | MODIFY |
| `src/chat/stop-all-agent-activity.ts` | Set `paused` instead of `cancelSuperPlan` (:121) (D8) | MODIFY |
| `src/chat/super-plan/claim-loop.ts` | Renderer lease-claim loop replacing `controller.ts` | CREATE |
| `src/chat/super-plan/plan-library.ts` | `collectSuperPlanRuns` second branch off `chat.superPlanView` | MODIFY |
| `src/ui/plan-progress-screen.ts`, `src/ui/super-plan-page.ts`, `src/ui/super-plan-chrome.ts` | `stagePosition` → `{index,total}` rename | MODIFY |
| `server/runner/sub-agent-summary-schemas.js` | Add `minnow.super-plan.review.v1` preset (`requireFindings: true`) | MODIFY |
| `src/chat/super-plan/controller.ts`, `stages.ts`, `state.ts`, `pipeline.ts`, `resumable.ts` | Legacy renderer pipeline | DELETE (Phase 7) |

## Wave Breakdown

### Wave 1 — Phase 0: Unblock (small, standalone fixes; D2 must land before Wave 2)

#### Task W1-A: Fix D1 — propagate timeoutMs/modeId through spawnSubAgent
- **Build:** Three edits: (1) `spawnSubAgent` in `src/agents/orchestrator.ts:470` — include `timeoutMs` and `modeId` in the POST body; (2) `server/sub-agents/middleware.js` — parse both from the request and journal them onto `run.created`; (3) `server/sub-agents/effector-runner.js:649` — prefer a per-run `timeoutMs` over `typeRow.timeoutMs` when computing the run limit.
- **Test:** Node test (e.g. `test/super-plan/spawn-timeout-propagation.test.mjs`): POST a sub-agent run with `timeoutMs: 30000` → assert `run.created` event in the journal carries it; assert the effector limit resolver returns 30000, not the type default.
- **Accept:** A sub-agent spawned with an explicit `timeoutMs` is killed/limited by that value, not the static 20-minute default.
- **Touches:** `src/agents/orchestrator.ts`, `server/sub-agents/middleware.js`, `server/sub-agents/effector-runner.js`, `test/sub-agents/**`, `test/super-plan/**`

#### Task W1-B: Fix D2 — persist reviewTimeoutMs/grillEnabled/researchEnabled
- **Build:** Add `reviewTimeoutMs`, `grillEnabled`, `researchEnabled` to the `normalizeSuperPlanConfig` whitelist in `server/config/validators.js:1328` and to the defaults in `server/config/home.js`. **Must land before W2-A** — the engine snapshots config into `run.created`, so a dropping normalizer would bake the bug into the journal.
- **Test:** `normalizeSuperPlanConfig({ reviewTimeoutMs: 600000, grillEnabled: false, researchEnabled: false })` round-trips all three fields (new assertions in the existing config validators test file under `test/`).
- **Accept:** Setting the three Super Plan options in `src/ui/super-plan-settings.ts` persists across an app restart.
- **Touches:** `server/config/validators.js`, `server/config/home.js`, `test/config/**`
- **Depends on:**

#### Task W1-C: Fix D7 — interrupted status for zombie research runs
- **Build:** In `server/research/store.js`: `getResearchStatus` returns `interrupted` for a disk record with `status:'running'` and no live task; `resolveReattachableResearchId` refuses `interrupted` ids. Benefits every research caller.
- **Test:** Node test: seed a research record with `status:'running'` and no live task → `getResearchStatus` returns `interrupted`; `resolveReattachableResearchId` does not return it.
- **Accept:** A crashed-while-researching run no longer offers a Retry that reattaches to a dead 30-minute poll.
- **Touches:** `server/research/store.js`, `test/research/**`

#### Task W1-D: Fix D8 — stop-all pauses Super Plan
- **Build:** In `src/chat/stop-all-agent-activity.ts:121`, replace the `cancelSuperPlan` call with setting the existing `paused` field (non-terminal), so a later resume re-plans rather than ending the run.
- **Test:** Existing stop-all test suite extended: invoking stop-all on an active Super Plan chat leaves `chat.superPlan` resumable (`paused: true`), not terminal.
- **Accept:** "Stop all agent activity" during a Super Plan leaves a resumable pipeline.
- **Touches:** `src/chat/stop-all-agent-activity.ts`, `test/**`

### Wave 2 — Phase 1: Pure core (nothing runs yet; tests only)

#### Task W2-A: Pure decision core + journal binding
- **Build:** Create `server/super-plan/events.js` (event vocabulary — lifecycle, identity, stages, artifacts, review, gates — with `validateEvent`; all events record completed facts, no `.requested`/`.pending` endings), `derive.js` (`derive(journal) → state` exposing `status`, `finished`, `stopReason`; finding resolution as set-difference across consecutive `review.recorded` rounds — no counters), `plan.js` (the 8-line `plan(state) → Desired[]` pipeline, concurrency 1; iterate-loop exits on round cap / zero blocking findings / no-progress), `policy.js` (outcome routing table: ok→accept; crashed/timeout <3 attempts→retry; interview/draft retries exhausted→fail run; research/polish/review exhausted→skip; draft rejected by accept-gate <2→retry with errors in seed; gate expired→stop), `graph.js` mirroring `server/sub-agents/graph.js`, and `journal.js` binding `createJournalStore({namespace:'superplan', fold: derive, validate: validateEvent})` with journal dir `~/.minnow/superplan/<runId>/journal.jsonl`. Ship `.d.ts` files to match every sibling module. All of `{events,derive,plan,policy}.js` must be free of I/O, `Date.now()`, `Math.random`, and `node:crypto` (finding ids are a hand-rolled fnv1a — that lands in W6-C, but keep the import ban from day one).
- **Test:** (1) `test/super-plan/core-purity.test.mjs` — AST walk copied from `test/orchestrator/core-purity.test.mjs` over the four pure modules (catches `node:crypto`/clock imports). (2) Fold/plan tables: hand-written journals → expected `plan()` output, covering fresh run; spec written; gate open (plan empty *apart from* the gate); gate answered `revise` (re-plans `interview`, not `draft`); `reviewRounds: 0`; no-progress exit; cap exit; research disabled; polish skipped; cancelled run.
- **Accept:** `node --test test/super-plan/` passes purity + fold/plan suites; no other engine code imports `server/super-plan/` yet.
- **Touches:** `server/super-plan/**`, `test/super-plan/**`

### Wave 3 — Phase 2: Headless effector, HTTP, SSE, boot

#### Task W3-A: Headless effector + split router
- **Build:** Create `server/super-plan/effector-headless.js` implementing the `Effector` contract (`{inspect, start, stop, onEnd?}`) for `review`, `research`, `polish` roles, modelled on `server/sub-agents/effector-runner.js` (in-process `runTurn`, no renderer). Create `effector-split.js` routing by role behind one `plan()` — `effector-scripted.js` (`server/orchestrator/effector-scripted.js`) proves the seam; the split effector must be swappable for it in tests.
- **Test:** Engine + `effector-scripted.js` conformance: full pipeline under scripted outcomes; crash-and-reload (`load()` twice produces no duplicate `stage.started`); reap-vanished attempt → `crashed` + replan; tick-quiescence (a finished run appends nothing on extra ticks, reusing V2's conformance assertion).
- **Accept:** A scripted full pipeline run reaches `run.finished` with correct `planPath` artifacts written, using only headless roles.
- **Touches:** `server/super-plan/effector-headless.js`, `server/super-plan/effector-split.js`, `test/super-plan/**`
- **Depends on:** W2-A

#### Task W3-B: HTTP middleware, live-events, boot scan
- **Build:** Create `server/super-plan/middleware.js` (create/start/stop/resume/cancel/state/events with `Last-Event-ID` replay, copying the shape of `server/orchestrator/middleware.js:642`) and `server/super-plan/live-events.js` (SSE live channel for research progress and activity — deliberately not journal events). Wire a boot scan in `server/runtime/middlewares.js` beside the existing `bootAgentsRuntime()`: `getEngine` every non-terminal run so `engine.js:466` re-arms timers on `load()`.
- **Test:** HTTP integration test: create → start → state → events (replay an `Last-Event-ID` and assert no duplicates); boot scan test: seed a non-terminal journal, boot, assert the engine tick re-plans the open stage without a user Resume click.
- **Accept:** `GET /api/super-plan/:runId/state` reflects a run that resumed itself after a server restart, with no SSE subscription required.
- **Touches:** `server/super-plan/middleware.js`, `server/super-plan/live-events.js`, `server/runtime/middlewares.js`, `test/super-plan/**`
- **Depends on:** W3-A

#### Task W3-C: Delete dead self-healing code and waitForSubAgent
- **Build:** Delete `src/agents/self-healing/` (D3 — dead code; timeouts are now policy-routed outcomes). Remove `waitForSubAgent` from `src/agents/orchestrator.ts` (D4) — the engine reconciles via `inspect()` on the 5s tick with no SSE dependency; update its callers to consume engine state. Also remove the empty `recordToolCallForRun` stub and unread `checkInNudgeMs` if now unreferenced.
- **Test:** `npx tsc --noEmit` passes; scoped suites covering orchestrator sub-agents pass; grep confirms zero references to `waitForSubAgent` and `self-healing`.
- **Accept:** No code path depends on SSE-push-only sub-agent completion.
- **Touches:** `src/agents/**`, `test/agents/**`, `test/orchestrator/**`
- **Depends on:** W3-B

### Wave 4 — Phase 3: Delegated effector + renderer claim loop (riskiest phase)

#### Task W4-A: Delegated effector with leases
- **Build:** Create `server/super-plan/effector-delegated.js` for `interview`/`draft` roles: `start()` records a **lease** (`attemptId`, 10s heartbeat, 45s expiry) and publishes it on the live channel; `inspect()` returns unexpired leases. Claim endpoint is compare-and-set on `attemptId` (409 on stale claim — handles multi-window double-claim). An unclaimed lease is simply re-offered next tick — **no** "chat busy → reset stage and break" path exists. Content-addressed `artifact.written` makes a duplicate draft idempotent; `sameWork` (`engine.js:34`) caps one lease per role.
- **Test:** D5 regression test: an unclaimed delegated lease → `plan()` returns the *same* desired item next tick (no stall, no stage reset). Double-claim test: two POST claims for one lease → second gets 409. Expired-lease test: heartbeat stops → lease expires → attempt reaped `crashed` → stage re-planned.
- **Accept:** Killing the renderer mid-draft leaves the engine ticking; relaunching the app re-claims and completes the draft without operator action.
- **Touches:** `server/super-plan/effector-delegated.js`, `server/super-plan/middleware.js`, `test/super-plan/**`
- **Depends on:** W3-A

#### Task W4-B: Renderer claim loop
- **Build:** Create `src/chat/super-plan/claim-loop.ts`: on boot and on stream-end, query open leases for this chat, claim via CAS, run `runChatTurn` with every existing caller overlay untouched (streaming rows, tool indicators, round-boundary steer, queue flush, titles, hidden user rows — per `src/chat/run-turn-chat.ts`), POST the outcome. Replace live-run usage of `controller.ts`'s `advanceSuperPlan`/`advancingChats` dispatch; new runs set `chat.superPlanRunId`. Legacy `chat.superPlan`-only chats keep the old controller until Phase 7 (parallel path, never big-bang).
- **Test:** Client test: claim-loop POSTs outcome and stops claiming after terminal state; a busy chat does not reset the stage (claims are retried on next stream-end). D8 regression: stop appends `run.stopped` (pause, non-terminal); a later `run.resumed` re-plans the *same* stage, not a fresh one.
- **Accept:** Start a Super Plan, kill the app during a draft, reopen — the run resumes on its own without a Resume click and the draft does not restart from zero.
- **Touches:** `src/chat/super-plan/claim-loop.ts`, `src/chat/super-plan/controller.ts`, `src/chat/super-plan/state.ts`, `src/boot/**`, `test/super-plan/**`, `test/boot/**`
- **Depends on:** W4-A

### Wave 5 — Phase 4: Interactive gates

#### Task W5-A: ask-bridge, gate effector, gate cards
- **Build:** Create `server/super-plan/ask-bridge.js` exposing `createJournaledAsk({engine, runId, attemptId, deliver})`: mint `gateId = \`${attemptId}:${index}\``; append `gate.opened` **before** delivering (crash between the two still derives an open gate); publish on the live channel; await `POST /api/super-plan/:runId/gates/:gateId/answer` which appends `gate.answered`; on abort/ask-timeout append `gate.expired` and return the runner's timeout error string. Verified: `createSubAgentEffector` already accepts `ask` (`server/sub-agents/effector-runner.js:520/:527/:794`); construct the AskCapability on the Super Plan side, no `server/runner/` changes. Implement the `role:'gate'` desired item via a zero-LLM effector (gates are attempts because the pure core receives no clock — every timeout is an effector-owned outcome). `spec_confirm` and `present` disappear as stages; `gate:spec` is also where `slug.assigned` fires. Gate cards render in the chat from the live channel. Late answers for dead gateIds are appended as facts but ignored by `derive` once the attempt ended.
- **Test:** Fold tests: gate open at crash → attempt reaped `crashed` → `plan()` re-emits the stage (re-ask semantics); late answer for dead gateId → journaled, ignored. Integration: answer endpoint appends `gate.answered` and unblocks the awaiting ask.
- **Accept:** During an interview, an Ask-Question card appears in the chat; answering it continues the pipeline; a mid-gate crash re-asks the question with prior answers in the transcript.
- **Touches:** `server/super-plan/ask-bridge.js`, `server/super-plan/effector-split.js`, `server/super-plan/middleware.js`, `src/ui/**`, `test/super-plan/**`
- **Depends on:** W4-B

### Wave 6 — Phase 5 + Phase 6: Projection, UI rebind, quality

#### Task W6-A: superPlanView projection + UI rebind
- **Build:** On journal append, the engine writes back a denormalised projection: `chat.superPlanView = {slug, displayTitle, stage, stageIndex, stageTotal, state, planPath, atMs}`. `collectSuperPlanRuns` in `src/chat/super-plan/plan-library.ts:177` gains a second branch reading `superPlanView` (legacy `chat.superPlan` branch stays until Phase 7); `stagePosition` becomes `{index,total}` from state. Update `src/ui/plan-progress-screen.ts`, `src/ui/super-plan-page.ts`, `src/ui/super-plan-chrome.ts` (field rename only). The stage-label map shrinks to five entries in `src/ui/super-plan-settings.ts`. Move the Activity collector onto the live channel (`GET /api/super-plan/:runId/events` instead of `PlanActivityCollector` journal-scraping); keep pause/resume rows emitted only when `superPlan.paused` actually flips (MIN-736).
- **Test:** Projection test: fold a journal through draft/review rounds → `superPlanView.stageIndex/stageTotal` correct. Library test: `collectSuperPlanRuns` lists both a legacy run and an engine run for the same workspace. Existing UI tests pass with the rename.
- **Accept:** The Super Plan page lists an engine-driven run with correct progress `{index,total}` after an app reload, sourced from the projection.
- **Touches:** `server/super-plan/**`, `src/chat/super-plan/plan-library.ts`, `src/ui/plan-progress-screen.ts`, `src/ui/super-plan-page.ts`, `src/ui/super-plan-chrome.ts`, `src/ui/super-plan-settings.ts`, `test/**`
- **Depends on:** W4-B

#### Task W6-B: Per-stage report_outcome + two-tier draft accept gate
- **Build:** Add a `minnow.super-plan.review.v1` preset to `server/runner/sub-agent-summary-schemas.js` with `requireFindings: true`; reuse `minnow.sub-agent.v1` for draft/polish (additive — the presets object is the intended extension point, not a fork). Two-tier draft accept: **Tier 1 always** — file written, non-empty, required headings present, sha256 differs from the prior accepted artifact; **Tier 2 only when the plan declares an executable task graph** — `parsePlan` from `server/orchestrator/core/parse-plan.js` with `formatParseErrors` fed back as the retry seed. Tier 2 stays conditional: `isExecutableOrchestratePlan` in `plan-library.ts` exists precisely because most Super Plans are prose; an unconditional gate would reject prose plans forever.
- **Test:** Review fixture plan → summary validates against `minnow.super-plan.review.v1` with findings present. Draft accept tests: prose plan passes Tier 1 with Tier 2 skipped; executable board plan with a parse error is rejected and the retry seed contains `formatParseErrors` output; identical-sha draft rejected.
- **Accept:** A review stage cannot complete without structured findings, and a broken executable plan draft is rejected with parse errors in its retry seed.
- **Touches:** `server/runner/sub-agent-summary-schemas.js`, `server/super-plan/**`, `test/super-plan/**`, `test/runner/**`
- **Depends on:** W3-A

#### Task W6-C: Stable finding ids + open/resolved tracking
- **Build:** In `derive.js`, derive a purely-computed finding id: hand-rolled `fnv1a(normalize(title) + '|' + sortedPaths.join(','))` over the existing finding shape (`title/detail/severity/paths`). **Must be hand-rolled — `node:crypto` is banned by the purity rule** (the W2-A purity test catches violations). Tracking: `open = lastReview.findings`; `resolved = union(previousRounds) − open`. Iterate loop reads `open` filtered by severity; no-progress exit compares consecutive `open` id-sets. `draft.addressed` records the draft's *claim* (`findingIds`, `dispositions`) — the final report flags where a draft claimed a fix the next review still saw.
- **Test:** Pure tests: same finding text across two rounds → identical id; changed title → different id; resolved-set equals union-of-previous minus open. No-progress fold: two consecutive reviews with equal open id-sets → `plan()` exits the iterate loop.
- **Accept:** Two consecutive reviews of an unchanged draft terminate the iterate loop via the no-progress exit instead of burning the round cap.
- **Touches:** `server/super-plan/derive.js`, `server/super-plan/plan.js`, `test/super-plan/**`
- **Depends on:** W2-A, W6-B

### Wave 7 — Phase 7: Delete legacy pipeline

#### Task W7-A: Delete legacy renderer controller
- **Build:** Delete `src/chat/super-plan/controller.ts`, `stages.ts`, `state.ts`, `pipeline.ts`, `resumable.ts`, and the legacy adapter: remove `advancingChats`, `onSuperPlanStreamEnd`, `findLastPlanSavePath`, and the final `collectSuperPlanRuns` legacy branch. Grep for stragglers (`chat.superPlan` non-`superPlanView` consumers, `SUPER_PLAN_STAGE_ORDER`). Keep `plan-slug.ts`, `spare-chat.ts`, `grill-prompt.ts`, `no-code-guard.ts` if still referenced by the claim loop / prompts.
- **Test:** `npx tsc --noEmit` clean; `npm test` scoped to `test/super-plan/`, `test/boot/`, and the plan-library suites; grep confirms zero references to the deleted symbols.
- **Accept:** No renderer-side Super Plan sequencing code remains; all runs flow through the server engine.
- **Touches:** `src/chat/super-plan/**`, `src/boot/**`, `test/**`
- **Depends on:** W5-A, W6-A, W6-B, W6-C

## Verification Checklist
- [ ] Purity test passes over `server/super-plan/{events,derive,plan,policy}.js` (no `node:crypto`, no clock, no I/O)
- [ ] Fold/plan tables cover all ten listed scenarios and pass
- [ ] Engine + scripted-effector conformance: crash-reload, reap-vanished, tick-quiescence
- [ ] D1–D9 regression tests all present and passing (D1 timeout propagation; D2 config round-trip; D5 unclaimed lease re-offer; D6 boot re-plan; D7 interrupted research; D8 stop→resume re-plans same stage)
- [ ] Integration (real runner, headless roles): review against fixture plan; research against stubbed store
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes for touched suites (`test/super-plan/`, `test/sub-agents/`, `test/research/`, `test/boot/`, plan-library suites)
- [ ] Manual E2E: start a Super Plan, kill the app during review, reopen — run resumes automatically, review does not restart from zero; run one with the window closed through a headless stage
- [ ] On-disk artifact shapes unchanged: `documentation/plans/<slug>.md`, `references/<slug>-spec.md`, `-research.md`

## Notes for Build Agents
- **Never modify `server/orchestrator/engine.js` or `server/runner/`** (exception: the additive presets entry in W6-B). `server/super-plan/` is a third instance of the engine, following the `server/sub-agents/` precedent — new graph, new journal namespace, new effector.
- **Journal events record completed facts only** — an event ending in `.requested`/`.pending` is a bug (`server/orchestrator/core/README.md`).
- **Research progress and finding.resolved are deliberately not journal events** — progress goes on the live SSE channel; resolution is a pure set-difference in `derive` (no counters invariant).
- **The pure core receives no clock** — every timeout must be an effector-owned outcome; gates are attempts, not pure-state waits.
- `derive()` must expose `status`, `finished`, `stopReason` — `engine.js` reads them directly.
- Two blocking checkpoints (`gate:spec`, `gate:accept`) use the same ask-bridge machinery via `role:'gate'` + a zero-LLM effector.
- Phase ordering is load-bearing: W1-B (config persistence) before W2-A (config snapshot into `run.created`); W3 before W4; W4 is the riskiest wave.
- In-flight legacy runs are never migrated — a chat with `chat.superPlan` and no `chat.superPlanRunId` keeps the legacy controller until W7-A deletes it. Both render into the same chat.
- This worktree may have no `node_modules` — run tests from the main checkout; ~11 pre-existing failures and no Electron build there are expected and not regressions.
- Conventions: match `server/sub-agents/` module style (`*.js` + sibling `.d.ts`); tests under `test/super-plan/` are auto-discovered by `test/run-all.mjs` with zero `package.json` edits; `npm test` mutates `test/fixtures/**` scratch homes (gitignored, no need to reset).
