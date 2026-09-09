# Minnow reliability review — September 8, 2026

This pass reviewed chat lifecycle, generation transport, sub-agent cancellation, Orchestrate rendering, Issues interactions, workspace transitions, and terminal stopping. Evidence included GitHub reports, local diagnostic logs, source review, automated regressions, and browser checks against an isolated Minnow home with the shipped fake model server. Concurrent model-router work was preserved.

## Implemented fixes

| Area | Failure and corrected behavior |
| --- | --- |
| Chat setup | A turn now claims setup, streaming state, and its abort controller before history hydration yields. Background continuations participate in the same per-chat lifecycle and Stop controls. |
| Queued follow-ups | A dequeued message is restored if another turn claims the chat first or continuation loading fails. Later queued messages remain intact. |
| Chat actions | Fork/truncate guards check the target chat, including setup. An explicit unknown Stop target cannot cancel the active chat. |
| SSE parsing | CRLF boundaries split across reads parse correctly. Providers returning SSE to a nonstreaming request produce the complete text, reasoning, tools, and metadata instead of the last delta. Tool-only completions are retained. |
| Stream interruption | Premature EOF and transient subscription failures retry the same generation once, deduplicating its retained replay. Missing terminal events surface an error. Early completion releases the stream reader. |
| Cancellation | Response-body cancellation and aborts during subscription setup cancel the backend generation. A cancelled generation cannot start a late upstream request. |
| Provider errors | HTTP 200 HTML proxy error pages are identified as failures and can use the configured provider fallback. |
| Sub-agent recovery | Repeated cancellation reconciles a persisted cancelling attempt left open after process exit, instead of returning success while it remains stuck. |
| Orchestrate status | Active retries hide the previous attempt's crash badge. A durable running attempt without a transient frame shows Running with elapsed time. See [#1164](https://github.com/HenriGrimm/Minnow/issues/1164) and [#1168](https://github.com/HenriGrimm/Minnow/issues/1168). |
| Board prompts | Builder prompts no longer direct agents to the unavailable `todo_write` tool. See [#1167](https://github.com/HenriGrimm/Minnow/issues/1167). |
| Context menus | Issues and board refreshes coalesce while a shared context menu is open, preserving its anchor and the user's selection. Issues label add/overflow/color popovers use the same dismissal-based refresh behavior, preserving typed input. See [#1160](https://github.com/HenriGrimm/Minnow/issues/1160). |
| Issues initialization | Label fields can mount before the issue store loads. Suggestions refresh when the picker opens. This fixes an observed cold-launch exception that interrupted UI initialization. |
| Keyboard shortcuts | Issue capture uses Ctrl/Cmd+I outside text inputs. Local issue shortcuts ignore modifier chords, preserving Copy. The command palette, help, and manual agree. See [#1161](https://github.com/HenriGrimm/Minnow/issues/1161). |
| Split layout | Switching preview/editor tabs preserves a chat pane collapsed by dragging. Closing and reopening the split resets it normally. See [#1137](https://github.com/HenriGrimm/Minnow/issues/1137). |
| Workspace picker | Picking a folder after the picker reloads no longer waits for an already-completed boot handoff, which left an opaque cover over a working chat. |
| Terminal stopping | Stop waits for process termination and in-memory completion with a bounded deadline, returning an error if cancellation remains unsettled. Cancellation during setup also kills a subsequently spawned child. |
| Configuration health | Startup and config health probes share cached, coalesced layout initialization. Rejected initialization can retry; normal config operations retain missing-file repair behavior. This removes repeated directory/default-file/Brain scans from health polling. |
| Typography | Issue-comment code uses the existing monospace font token. |

## Validation

- The full-suite batches completed with **9,545 passed, 3 failed, 4 skipped** (9,552 tests). The runner stopped without a final summary during its third TypeScript batch; that batch and all remaining files were rerun separately and passed. Counts use completed batch summaries only, so the interrupted partial batch is not counted twice.
- An integrated pass across 134 files passed **975/975 tests**, covering all chat and generation tests plus the changed sub-agent, board, Issues, layout, and provider tests.
- The last config/Brain, terminal, workspace, and label-interaction pass had **35 passed, 2 skipped, 0 failed**, including the new health-check cache regressions added after full-suite discovery.
- The workspace reload regression passed in its focused suite.
- A local browser chat produced `Done.`, persisted the response, and returned to the Send state. Issues loaded successfully; Copy preserved the current screen and Ctrl+I opened capture. Browser requests used the local fixture provider.
- Final TypeScript, the production build, test discovery coverage, and bundle performance budgets passed. Discovery covers 1,318 test files with three documented exclusions. No bundle budget was raised.
- Several failing UI fixtures were updated to current shipped labels, markup, folding behavior, and model API exports; production behavior was not changed to satisfy stale assertions.

## Limits and remaining observations

- [#1144](https://github.com/HenriGrimm/Minnow/issues/1144), completed board-task Thoughts missing, was not reproduced in the current transcript path. Sampled saved journals retained reasoning. A concrete affected task is still needed to establish whether another path drops it.
- The recent local context-overflow error reported 69,351 requested tokens against a 58,368-token model context. Existing recovery correctly classifies that payload; an exact-payload regression was added. This does not establish successful recovery for every real provider/model combination.
- Transparent subscription recovery is limited to one retry and retained generation history: 30 seconds for ephemeral generations, five minutes for persistent ones, and the existing 16 MB cap. Further failures remain visible to the caller.
- Browser smoke testing does not validate Electron-only browser automation or every real provider. No claim of universal compatibility or defect-free operation is made.
- Three full-suite Windows symlink tests require a host that permits creating symlinks. Path-safety checks were not weakened to bypass that requirement.
- The live WSL tests now skip when the selected environment lacks Bash or the required workspace mount. Structural quoting tests and the Windows quoted-command integration passed.
- The long-running local server showed high memory/handle use and variable config-ping latency. The initialization cache removes repeated health-check work; the cause of the process's resource growth is not established. Restart Minnow to load the backend fixes. Existing running work was not interrupted for a restart.

Raw test/build logs from this review are in the operating system's temporary directory as `minnow-review-*.log`; they are not committed artifacts. All code changes remain available for review in the working tree.
