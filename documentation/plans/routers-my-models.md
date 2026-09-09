# Routers: My Models and on-demand load/unload

**Status:** implemented  
**Register:** product

## Goal

Models → Routers lists **My Models** (not `llama.cpp (local)` / `mlx-lm (local)`), with every loadable library row. When a router assigns a My Models entry, Minnow loads that serve and unloads others **only after in-flight local generations finish**.

## Todos

- [x] Router editor: My Models provider first, omit llama-cpp/mlx catalogs, list loadable library rows, remap legacy entries
- [x] Treat minnow-library entries as available from the cached library, with loaded/not-loaded/waiting reasons
- [x] Router generation: mutex + wait for idle local work, then resolveLibraryAttemptBinding; harden admitServe against busy victims
- [x] Emit minnow_router phase loading and show Loading model… on chat plus live router cards
- [x] UI/availability/generation tests; context.md, models manual

## Behavior

- Editor provider dropdown: **My Models** first, then other enabled providers; `llama-cpp-local` / `mlx-lm-local` omitted.
- Entries persist `minnow-library` + `gguf:` / `mlx:` ids. Legacy llama.cpp / MLX pairs remap when the library row can be matched.
- Unloaded library rows stay eligible (`Available · not loaded`). Live copy shows **Loading** / **Waiting for GPU** during bind.
- Bind path waits for in-flight llama.cpp / MLX generations, then `startServe` / `admitServe`. Busy victims are not killed; idle TTL is unchanged.
- Chat stream status maps `minnow_router.phase` `loading` / `waiting` to **Loading model…**.
