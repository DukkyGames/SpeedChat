# Shape: worktree choice on Send to chat

Confirmed 2026-09-09. Brief confirmed. Implementation in the same session.

**Register:** product. **Color:** Restrained (composer run-target panels, no per-surface override). **Fidelity:** production-ready. **Breadth:** Issues row menu + peek Send to chat / Send to background. **Time intent:** ship.

## Todos

- [x] Confirm this brief (gate for `/impeccable craft`)
- [x] Share the composer run-target panel + New worktree popover so Issues and composer stay one vocabulary
- [x] Send to chat (row + peek): mode, then run-target, then attach and seed
- [x] Send to background: same choice; attach the workflow chat before the sub-agent
- [x] Cancel / error / no-worktrees / server-down states
- [x] Tests for the choice + attach-before-run
- [x] Update `documentation/context.md` and the Issues manual

## 1. Feature summary

Sending an issue to a chat currently seeds Code with no run-target step. After the existing mode pick, the user chooses the same run target as the composer: This PC, attach an existing worktree, or New worktree (name + start-from popover). The new chat (or background parent chat) is attached before the seed or sub-agent runs.

## 2. Primary user action

Choose Local vs worktree without opening Code first.

## 3. Design direction

- **Color strategy:** Restrained. Family accent only on the existing primary Send to chat control.
- **Scene:** A developer at a large monitor, Issues list or peek, sending a card into Code; they want isolation without a second trip through the composer.
- **Anchors:** composer run-target menu, git New worktree popover, Issues workflow dropdown.
- **Theme:** Same Issues chrome and composer panels (`composer-run-target-menu`, `openGitRefNamePopover`).

Visual probes skipped: this reuses the composer vocabulary; it is not a new visual surface.

## 4. Scope

Production-ready shipped UI. List/board row menu and peek **Send to chat**, plus **Send to background**. Interactive, not a mock.

Out of scope:

- Peek Chats → New (stays General, no worktree step)
- Send to board
- Changing the composer itself beyond sharing its panels

## 5. Layout strategy

Mode first (existing submenu). Then the same run-target panel as the composer (Run on / This PC / Worktree… / New worktree). New worktree opens the existing name popover. No extra modal.

## 6. Key states

| State | What the user sees |
| --- | --- |
| This PC | Launch / spawn immediately on the main workspace |
| Worktree… | Drill-in list, or toast if none |
| New worktree | Name + start-from popover, then create + launch |
| List / create error | Same composer toasts; do not auto-run the seed |
| Escape / click-outside | Cancel; the issue is not sent |
| Closed or busy issue | Controls stay disabled |
| Local server down | Skip the picker; send as Local (composer hides worktree options) |

## 7. Interaction model

Pick mode, then the composer run-target panel. This PC launches now. Worktree… drills in. New worktree opens `openGitRefNamePopover`. Background: attach `worktreeRoot` on the workflow chat before `spawnSubAgent`. Foreground: apply the choice after `createChatWithMode` and before `sendMessageWithTools`.

## 8. Content requirements

Reuse composer strings: `Run on`, `This PC`, `Worktree…`, `New worktree`, popover title `New worktree`. Default slug from the issue title (`suggestGitRefName`).

## 9. Recommended references

- `reference/product.md` (earned familiarity)
- `reference/interaction-design.md` (menus, popover, cancel)
- `reference/harden.md` after craft (server-down, create fail, cross-window seed)

## 10. Decisions already locked

- Full composer run-target (This PC, attach existing, New worktree)
- Surfaces: row + peek Send to chat, and Send to background
- Peek Chats New is out of scope
- Mode first, then run-target panel
- Cancel does not send
