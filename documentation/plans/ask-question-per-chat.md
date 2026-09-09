# Per-chat ask_question strips

Confirmed 2026-09-09. Implementation in worktree `per-chat-questions-a7f3c1e2`.

## Todos

- [x] Create git worktree from main
- [x] Make `ask-question-queue` per-chat; snapshot `chatId` at enqueue; pass `chatId` from `propose_mode_switch`
- [x] Map of question modals; park panels off the shared host; scope keydown/lock/close to the owning chat
- [x] `stopGeneration` / steer / composer queue close only that chat; stop-all still closes all
- [x] Queue + chat-scope tests for independent strips, no mixed questions, scoped stop
- [x] Update `documentation/context.md`

## 1. Feature summary

A question strip open in one chat no longer blocks or merges into another chat. Each chat owns its `ask_question` FIFO and its parked panel. Switching to chat B shows B's questions immediately; A's strip stays parked until you return.

## 2. Primary user action

Answer (or dismiss) questions on the chat that asked them, even while another chat is also waiting.

## 3. Behavior

- Per-chat queue in [`src/tools/ask-question-queue.ts`](../../src/tools/ask-question-queue.ts). `chatId` is snapshotted at enqueue.
- Concurrent modal instances in [`src/ui/question-cards-modal.ts`](../../src/ui/question-cards-modal.ts). Park detaches the panel from `#questionHost`.
- `propose_mode_switch` passes the tool-loop `chatId`.
- `stopGeneration(chatId)` closes only that chat's strip.

## 4. Out of scope

Tool-approval remains a process-wide queue.
