# Worktree and branch start-from picker

Implementation plan for choosing the start ref (or checking out an existing branch) when creating a worktree or branch.

## Todos

- [x] Add Start from / Check out row to git-panel-name-popover; load gitBranches; extend onSubmit; CSS + comments
- [x] worktreeAdd + createChatWorktree: baseRef new-from vs checkoutExisting (local and remote --track)
- [x] Pass cwd and result fields from git-panel, scc-refs, composer, git-graph (fixed SHA), SCC New branch command
- [x] Popover, git-api, chat-worktree tests; context.md, code.md

## 1. Feature summary

New branch and Add worktree no longer always fork HEAD. The shared name popover adds a start-from select of local and remote-tracking refs (default: the current branch). Worktrees also offer Check out to attach an existing branch instead of creating one.

## 2. Behavior

- **New branch:** name + Start from. `git checkout -b` with `startPoint`.
- **Add / New worktree:** New from (name + start point) or Check out (existing ref; remotes use `--track -b`).
- **Git graph Create Branch:** still pins the clicked commit; no start-from select.
- Board-task isolation worktrees are unchanged.

## 3. Files

- [`src/ui/git-panel-name-popover.ts`](../../src/ui/git-panel-name-popover.ts)
- [`src/lib/git-ref-start.mjs`](../../src/lib/git-ref-start.mjs)
- [`server/git/git-ops.js`](../../server/git/git-ops.js) `worktreeAdd`
- [`server/worktree/worktree-ops.js`](../../server/worktree/worktree-ops.js) `createChatWorktree`
