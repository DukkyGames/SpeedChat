# Muse Spark OpenCode Go Responses (MIN-855)

OpenCode Go serves Muse Spark 1.2/1.3 (and GPT 5.6 Luna / Grok 4.6) on `POST /v1/responses`. Minnow previously always posted `/v1/chat/completions`, which returned HTTP 500.

## Todos

- [x] Add OpenCode Go + Muse/Luna/Grok 4.6 Responses detection (`shouldUseOpenAiResponses`)
- [x] Derive `/v1/responses` and branch `pumpUpstream` via `resolveGenerationApi`
- [x] Map Chat Completions body (messages, tools, tool loop, reasoning) to Responses JSON
- [x] Parse Responses SSE into existing OpenAI chunks
- [x] Route capability probes and research/Brain utility completions through the same helper
- [x] Tests: id + Go URL gating, body mapping, SSE, fake-server 500-on-chat vs 200-on-responses
- [x] Update `documentation/context.md` and maintainer settings-reference

## Residual 500s

If routing is correct and OpenCode still returns 500, that is likely Meta geographic policy (limited regions) or a gateway outage. Debug dump: `~/.minnow/debug/openai-upstream-last-error.json`.
