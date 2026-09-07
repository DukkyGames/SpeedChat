---
name: streaming-partial-message-display
overview: Live assistant prose was stuck on the first token because UI deltas were derived from a leading-only persist throttle. Flush the latest snapshot on a microtask (and when a tool call starts) so the bubble keeps up during the stream.
todos:
  - id: live-delta-emit
    content: Emit coalesced live TurnEvent delta from onDelta (microtask, latest snapshot); flush on tool_streaming and stream end
    status: done
  - id: emit-progress-trailing
    content: Make emitProgress leading+trailing; cancel trailing timer on settled force emits
    status: done
  - id: painter-immediate-flush
    content: On tool_streaming/tool_call, flush pending assistant markdown immediately without cancelling pending text
    status: done
  - id: tests
    content: Burst-prose and prose-then-tool-args runner tests; painter test that tool_streaming flushes latest lastDelta
    status: done
  - id: docs
    content: Update documentation/context.md stream-paint section and runner README
    status: done
---

# Fix streaming messages stuck on the first token

## Symptom

On some providers the bubble paints the first word, then sits until the generation finishes. During a tool call that can last the whole argument stream (`Calling Save file…`); on a plain reply it sits until the completion ends. Then the full sentence appears at once.

## Cause

`TurnEvent.delta` was only created from `onMessagesChange`, and stream-time `emitProgress` was a **leading-only** 80ms throttle. A token burst in one `read()` emitted the first word and dropped the rest. Later chunks were often `tool_calls` argument fragments, so the latest prose never reached the painter until stream end.

## Fix

- Live `delta` from `onDelta` via a microtask (latest snapshot wins); flush immediately on `tool_streaming` and stream end.
- `emitProgress` stays the persist throttle, now leading+trailing. Settled force emits cancel the trailing timer.
- Painter `tool_streaming` / `tool_call` pass `immediate: true` into `scheduleAssistantBubbleRender` so pending markdown is not left under **Calling…**.

## Tests

- `test/runner/turn-event.test.mjs` — burst prose; prose then long tool-arg fragments.
- `test/chat/run-turn-chat-paint.test.mts` — `tool_streaming` flushes the latest `lastDelta`.
