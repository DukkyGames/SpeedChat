# Issue labels

Confirmed design brief (2026-09-05). Production pass for colored, compact issue labels.

## Todos

- [x] Confirm this brief
- [x] Workspace label catalog (name → swatch), persist with issues state, migrate existing names
- [x] Dedicated 10-swatch tokens in `tokens.css`; Linear tint recipe in `issues.css`
- [x] Shared chip: color, ×, right-click swatches. List / peek / board
- [x] List: nowrap, max 3, **+N** popover, **+** add. Kill wrap and the dashed placeholder
- [x] Tests, Issues manual, `documentation/context.md`
- [ ] Browser-verify list, peek, board, recolor, overflow (no in-session browser MCP; Electron desktop is running)

---

## 1. Feature summary

Issue labels become a **workspace catalog**: each name has one color, used on every issue that carries it. The list stays **one row height**; you scan color, then name. Adding and overflowing stay quiet: a **+** chip and a **+N** popover, not a dashed field and wrapping stack on every row.

## 2. Primary user action

Scan the list and know, without opening a peek, what kind of work a row is.

## 3. Design direction

- **Color strategy:** Full palette **on chips only**. Issues chrome stays Restrained. Label hues are a dedicated 10-swatch set, not `--mn-success` / `--mn-warning` / `--mn-danger`.
- **Scene:** A developer triaging a long list at a desk at night on swamp-dark, scanning for UX vs API vs AUTH in one pass. Theme follows the app.
- **Anchors:** **Linear** (winner: soft tinted pills, readable text, dense rows). GitHub for name-only sync. Existing Minnow type chips for radius and focus vocabulary.
- **Visual probes:** skipped. Refinement of existing chips; Linear already confirmed.

## 4. Scope

- **Fidelity:** production-ready
- **Breadth:** list, peek, and board cards share one chip. Compact overflow is list and board.
- **Interactivity:** add, remove, recolor, overflow popover
- **Out of this pass:** GitHub label-color sync, Labels settings page, agent tools that set color, in-place rename, group-by-label header color

## 5. Layout strategy

**List:** one nowrap line, up to 3 chips, **+N**, then **+**. Chips hug label text (centered); ellipsize only in peek/detail and board when a name exceeds ~9rem.

**Peek:** full set, wrapping allowed. Same chips and **+**.

**Board:** same chips (up to 3 + **+N**). No inline add.

**Chip:** soft fill via `color-mix` of the swatch into `--mn-bg`, hairline border, text mixed toward `--mn-fg`. Uppercase, 10px, existing radius.

## 6. Interaction model

- **+** opens a typeahead popover (Enter / comma commit). The flyout stays open and focused after each add so the next name can be typed immediately; click-away or Escape dismisses it.
- **+N** opens a popover of the rest. Does not expand the row.
- **×** removes from that issue. Catalog color stays.
- **Right-click a chip** opens the 10-swatch picker. Changing UX recolors every UX chip.
- Recolor does **not** bump `issue.updatedAt` (GitHub "Needs push" must stay honest).
- Clicking a chip does not filter the list.

## 7. Defaults

- New labels get the next unused swatch (least-used, palette order, when all 10 are taken).
- Existing names migrate once, sorted by name, first-unused assignment.
- Removing the last use of a label keeps its catalog color.
- GitHub sync stays names only. Missing GitHub repo labels are created on push so the name actually lands.
