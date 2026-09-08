# Attempt report scan

Confirmed shape: verdict first, keep agent prose collapsed, quieter Changes/Evidence. Same pattern on the end-of-run report and the task-card Work list.

## Design

- Product, Restrained. Theme follows the app. Semantic color on outcome badges only.
- Scene: reviewing an abandoned board run, deciding retry vs ignore.
- Journal fields only for the verdict (outcome, abandon reason, blockers, needs, file counts, test output present). Do not parse the Builder paragraph.
- First sentence (or ~140 characters) as scent. Full write-up behind a disclosure, closed by default.
- Files as a compact path list. Patch and long logs stay disclosures. Hide patch-size noise (`originalLength`).
- No nested cards, no KPI tiles, no left stripes, no agent-prompt rewrite.

## Todos

- [x] Pure scan helpers (`summaryScent`, abandon-reason copy, evidence facts)
- [x] Verdict line + collapsed write-up on `article.ov2-report-attempt`
- [x] Quieter Changes / Evidence in `report-evidence.ts`
- [x] Match the Work-list summary on the task card
- [x] CSS: facts, scent, blockers, file paths, write-up disclosure
- [x] Tests for collapse, blockers, file lists, Work list
- [x] Update `documentation/context.md`
- [x] Verify pass, fail, abandoned, empty, truncated
