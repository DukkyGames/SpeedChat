import { isTriageStatus } from '../../issues/taxonomy.ts';
import { getIssuesTaxonomySync } from '../../state/issues-taxonomy-store.ts';
import type { IssueCard } from '../../types.ts';

/** Build the task envelope for the issue-writer sub-agent (pure; testable). */
export function buildIssueExpandTask(issue: IssueCard): string {
  const taxonomy = getIssuesTaxonomySync();
  const triageStatusId = taxonomy.statuses.find((s) => s.role === 'triage')?.id ?? issue.status;
  const noteBody =
    issue.description?.trim() ||
    issue.notes?.trim() ||
    issue.title.trim() ||
    '(empty note)';

  return [
    'Expand this triage note into a structured issue. Read-only exploration; no file writes.',
    '',
    `Issue id: ${issue.id}`,
    `Current title: ${issue.title}`,
    `Current type: ${issue.type}`,
    `Status must remain: ${triageStatusId}`,
    '',
    'Raw note / description:',
    noteBody,
    '',
    'Do the following:',
    '1. Classify as bug, task, idea, feature, or improvement (keep note only if it truly is a note).',
    '2. Write a crisp title and structured markdown description',
    '   (repro steps for bugs; motivation + acceptance for tasks).',
    '3. Locate the most relevant files/lines in the workspace when applicable.',
    '4. Call issue_update with title, description, type (and labels if useful).',
    '5. Call issue_link with any code_refs you found (path + start_line/end_line + short snippet).',
    '6. Do NOT change status away from triage — leave it for human review.',
    '',
    'Return a one-paragraph summary of what you wrote.',
  ].join('\n');
}

/** True when Expand with agent should be offered (triage capture). */
export function canExpandIssueWithAgent(issue: IssueCard): boolean {
  return isTriageStatus(getIssuesTaxonomySync(), issue.status);
}
