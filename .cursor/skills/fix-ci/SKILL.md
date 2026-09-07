---
name: fix-ci
description: >-
  Investigates GitHub Actions CI failures for the latest commit on the current
  branch, fixes scoped issues using subagents, re-runs failing tests locally,
  and commits fixes. Use when CI is red, checks failed, GitHub Actions failed,
  or the user asks to fix CI, fix the build, or green the branch.
---

# Fix CI

Get the current branch green by reading the latest CI run, fixing root causes, verifying locally, and committing scoped fixes.

## Scope rules

- Fix failures **caused by this branch's changes**. Do not weaken CI, skip checks, or make unrelated edits.
- If a failure looks unrelated (flaky infra, upstream breakage), check whether merging/rebasing the base branch fixes it before editing code.
- Only commit when fixes are verified. Use gitmoji commit messages (see [Commit](#commit-fixes)).
- Never force-push to `main`/`master`. Never skip git hooks unless the user explicitly asks.

## Workflow checklist

Copy and track progress:

```
Fix CI:
- [ ] 1. Identify branch + latest commit SHA
- [ ] 2. Fetch latest CI run status and failed logs
- [ ] 3. Triage failures (local repro vs subagent)
- [ ] 4. Apply fixes (scoped to failure)
- [ ] 5. Re-run failing tests / local CI gate
- [ ] 6. Commit fixes
- [ ] 7. Confirm push triggers a new CI run (if already pushed)
```

---

## Step 1: Identify branch and commit

Run in parallel:

```bash
git branch --show-current
git rev-parse HEAD
git status -sb
```

Note whether the commit is pushed. If not pushed, CI may be stale or missing — push after fixes.

---

## Step 2: Fetch CI status and logs

Requires `gh` CLI authenticated (`gh auth status`).

**Find runs for this branch** (newest first):

```bash
gh run list --branch "$(git branch --show-current)" --limit 5
```

**Inspect the latest run** for `HEAD`:

```bash
gh run view <run-id> --json status,conclusion,jobs,url,headSha,event
```

**Read failed job logs only** (prefer this over full logs):

```bash
gh run view <run-id> --log-failed
```

If the branch has an open PR, also check:

```bash
gh pr checks --watch=false
```

For a single failing check on a PR, launch the **ci-investigator** subagent when the failure is non-obvious or log output is large:

```
Task subagent_type=ci-investigator
Prompt:
Full Repository Path: <absolute repo path>
Diff: branch changes
Change Description: <optional — only if diff unavailable>
Custom Instructions: Focus on check "<name>" for commit <sha>. Summarize root cause and minimal fix.
```

Read only the subagent summary — do not paste entire CI logs into the main thread.

---

## Step 3: Triage failures

Map each failed step to a local command. For Minnow, see [minnow-ci.md](minnow-ci.md).

| Failure signal | Typical local repro |
|----------------|---------------------|
| Typecheck | `npx tsc --noEmit` |
| Test suite | `npm test` or scoped `npm run test:<suite>` |
| Test discovery | `npm run test:check-coverage` |
| Icons | `npm run check:icons` |
| Single test file | `node test/run-all.mjs --suite <suite>` or direct `node --test` / `tsx` per `test/run-all.mjs` |
| OS-specific (matrix) | Note matrix job OS; reproduce on matching OS when possible |

**When to use subagents**

| Situation | Subagent |
|-----------|----------|
| Unclear root cause from logs | `ci-investigator` |
| Multi-file fix across unfamiliar area | `generalPurpose` (explore first) |
| Running many test commands / git ops | `shell` |
| Fix may introduce regressions | `bugbot` on uncommitted diff (optional) |

Prefer fixing directly when the failure is a single assertion, typo, or missing file.

---

## Step 4: Apply fixes

- Minimal diff — fix the failure, not drive-by refactors.
- If CI failed on **Windows, Ubuntu, and macOS**, ensure the fix is cross-platform (line endings, path separators, timing).
- Update `documentation/context.md` only when the fix changes architecture, APIs, or documented behavior.
- Do not commit fixture churn (e.g. regenerated `.db` WAL files) unless the test intentionally requires it.

---

## Step 5: Re-run failing tests

Re-run **exactly what failed in CI**, then widen if needed:

```bash
# Example: typecheck only
npx tsc --noEmit

# Example: one suite
npm run test:memory

# Example: full local gate (Minnow)
npm run test:check-coverage && npm run check:icons && npx tsc --noEmit && npm test
```

If a scoped test passes but full suite is cheap, run `npm test` before committing.

On failure after a fix, iterate — do not commit until the repro command passes.

---

## Step 6: Commit fixes

Only after local verification. Gather context in parallel:

```bash
git status
git diff
git log -5 --oneline
```

Stage relevant files, then commit with a gitmoji prefix:

| Change type | Gitmoji |
|-------------|---------|
| Bug fix for CI | 🐛 |
| Test fix | ✅ |
| Type fix | 💄 or 🩹 |
| Config/CI-adjacent code fix | 🔧 |

Use the Unicode emoji, never a colon shortcode such as `:bug:`.

Example:

```bash
git add <files>
git commit -m "$(cat <<'EOF'
🐛 Fix CI failure in memory save tool test

Align fixture path with workspace root resolution on Windows.
EOF
)"
```

Push if the branch was already pushed (so CI re-runs):

```bash
git push
```

Optionally watch the new run:

```bash
gh run watch
```

---

## Escalation

Stop and report back (do not guess) when:

- Failure is on `main` and unrelated to your branch
- Fix would require changing `.github/workflows/` or lowering CI standards
- Failure is environmental (GitHub outage, rate limit, cache poison) with no code fix
- Same test passes locally but fails only on CI after two honest repro attempts

Include: failing job name, step name, error excerpt, what you tried, and recommended next step.

---

## Additional resources

- Minnow CI job steps and scoped test commands: [minnow-ci.md](minnow-ci.md)
