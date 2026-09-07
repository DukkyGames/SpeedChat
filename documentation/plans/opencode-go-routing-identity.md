# OpenCode Go routing identity

OpenCode Go now requires clients to identify as a coding agent and send a stable session header. See https://opencode.ai/docs/go/#where-can-i-use-it

## Todos

- [x] Add `mergeOpenCodeIdentityHeaders` (User-Agent `Minnow/<version>`, `x-opencode-session`)
- [x] Stamp User-Agent on all OpenCode auth/runtime headers (catalog, probes, generations)
- [x] Send stable `x-opencode-session` from chat id (fallback: generation id)
- [x] Cover OpenAI chat/completions and Anthropic Messages (AI SDK fetch wrap)
- [x] Pass `chatId` through in-process generations and sub-agent streams
- [x] Tests + `documentation/context.md`
