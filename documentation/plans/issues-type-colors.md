# Issue type colors + Feature / Improvement types

MIN-861: new types currently render grey because Settings has no color picker, and CSS only tints `bug` / `task` / `idea` / `note`.

## Todos

- [x] Seed Feature and Improvement (icons + colors) in the default taxonomy
- [x] One-shot seed for existing `taxonomy.json` files (`typeSeedRevision`) so deletes stick
- [x] Settings → Issues color column + palette picker for types
- [x] Resolve chip color in JS; tint list chips from `--issues-chip-color`
- [x] Tests, context.md, Issues manual, Settings copy

## Decisions

- Color picker lives in **Settings → Issues** (same table as icons), not a freeform color input.
- Palette: semantic `--mn-*` tokens plus the existing taxonomy hex swatches.
- Feature: rocket + purple `#9b7cb2`. Improvement: sparkles + teal `#7cb29b`.
- Existing catalogs get the two types once (`typeSeedRevision: 2`). Deleting them later is not undone on reload.
