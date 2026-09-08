---
name: markdown-link-spa-crash
overview: Stop markdown preview links from navigating the SPA (hash router or full reload) by intercepting clicks, scrolling in-document headings, opening workspace files in the viewer, and sending http(s) URLs to the in-app browser.
todos:
  - id: core
    content: "Add markdown href classifier, GitHub-style heading IDs, and capture-phase click router"
    status: completed
  - id: wire
    content: "Wire renderer, file viewer (primary + secondary), and boot init"
    status: completed
  - id: tests
    content: "Unit-test classify/resolve/heading IDs and click intercept (hash unchanged, relative preventDefault)"
    status: completed
  - id: docs
    content: "Document markdown link routing in documentation/context.md"
    status: completed
isProject: false
---

# Markdown links crash the SPA

**Date:** 2026-09-07
**Goal:** Clicking a link in a markdown file (file viewer preview, and other `msg-bubble--md` surfaces) must not reload or unmount Minnow.

## Why it looks like a crash

Health & diagnostics stay empty because nothing throws. The browser leaves the current shell:

1. **In-document hashes** like `[Overview](#overview)` become `<a href="#overview">`. Minnow routes on `location.hash`. `#overview` is not `#/app/…`, so `parseOsHash` returns the workspace gate and `applyRouteFromHash` remounts the UI.
2. **Relative files** like `[setup](contributor/setup-from-source.md)` become `<a href="contributor/setup-from-source.md">`. The click loads that path on the tool-server origin; Vite serves `index.html` and the SPA **fully reloads**.

Chat http(s) links are already intercepted (`minnow-browser-links.ts`) but only inside chat roots, and only for `http(s)`. File-viewer preview uses `.msg-bubble` **outside** those roots, so it gets neither handler.

## Intended click behavior

| Href | Action |
|------|--------|
| `#/…` or `#brain-wiki/…` | Leave to existing in-app hash routing |
| `#heading` (anything else) | `preventDefault`, scroll to that heading in the markdown root. Do **not** change `location.hash`. |
| Workspace-relative path (`.md`, `.ts`, …) | `preventDefault`, open in the file viewer (resolve against the current file's directory). `#L12` / `#L12-L20` open as code at that range; other fragments scroll after preview mount. |
| `http(s):` | `preventDefault`, open in the Minnow preview browser (same as chat). |
| `mailto:` / `tel:` | Do not intercept |
| `javascript:` / `data:` / `file:` / path escape (`..` above workspace root) | `preventDefault`, ignore |

Fallback: non-in-app anchors also get `target="_blank"` so a missed handler opens a new tab instead of replacing this window.

## Files

| File | Action |
|------|--------|
| `src/markdown/links.ts` | Classifier, heading IDs, click router, `initMarkdownLinkRouting` |
| `src/markdown/renderer.ts` | Decorate DOM after each paint |
| `src/ui/file-viewer.ts` | `data-md-source-path` + pending heading scroll |
| `src/ui/file-viewer-secondary-slot.ts` | Same for the split pane |
| `src/main.ts` | Install the capture listener at boot |
| `test/markdown/links.test.mts` | Pure + happy-dom click tests |
| `documentation/context.md` | File-viewer markdown link routing |

## Non-goals

- Rewriting product-wiki documentation navigation (`#/wiki/…` stays as-is).
- Changing Issues WYSIWYG link chips.
- Fetching the network to see if a relative file exists before opening (viewer error state is enough).
