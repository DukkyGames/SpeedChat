import { el } from './dom';

const labels: Record<string, string> = {
  attemptId: 'Attempt ID', seedKind: 'Starting point', testOutput: 'Test output',
  worktree: 'Worktree', diff: 'Changes', files: 'Changed files', needs: 'Requirements',
  by: 'Stopped by', ended: 'Finished', truncated: 'Output truncated',
};

function label(key: string): string {
  const text = labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isPlainValue(item: unknown): item is string | number | boolean {
  return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean';
}

/** Compact list for paths and short evidence strings. Numbered dumps hide the scan. */
function renderStringList(values: string[], className: string): HTMLElement {
  const list = el('ul', className);
  for (const value of values) {
    const row = el('li', '');
    row.textContent = value;
    list.appendChild(row);
  }
  return list;
}

function patchDisclosureTitle(record: Record<string, unknown>): string {
  const truncated = record.truncated === true;
  const length = typeof record.originalLength === 'number' ? record.originalLength : null;
  if (truncated && length != null) return `View patch (${length} characters, truncated)`;
  if (truncated) return 'View truncated patch';
  if (length != null && length > 4000) return `View patch (${length} characters)`;
  return 'View patch';
}

/** Native disclosures keep large logs out of the reading path and DOM until opened. */
export function reportDisclosure(title: string, content: () => HTMLElement): HTMLDetailsElement {
  const details = el('details', 'ov2-report-disclosure');
  details.appendChild(el('summary', '', title));
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    details.appendChild(content());
  });
  return details;
}

export function reportBadge(value: string): HTMLElement {
  const badge = el('span', 'ov2-report-badge', label(value));
  badge.dataset.status = value;
  return badge;
}

function renderDiffEvidence(diff: Record<string, unknown>, depth: number): HTMLElement {
  const root = el('div', 'ov2-report-evidence ov2-report-evidence--diff');
  const files = Array.isArray(diff.files) ? diff.files.filter((item): item is string => typeof item === 'string') : [];
  if (files.length) root.appendChild(renderStringList(files, 'ov2-report-files'));
  if (diff.patch != null && diff.patch !== '') {
    root.appendChild(reportDisclosure(patchDisclosureTitle(diff), () => {
      const pre = el('pre', 'ov2-report-evidence__log', String(diff.patch));
      pre.tabIndex = 0;
      return pre;
    }));
  } else if (diff.truncated === true) {
    root.appendChild(el('p', 'ov2-report-screen__quiet', 'Patch truncated.'));
  }
  const rest = { ...diff };
  delete rest.files;
  delete rest.patch;
  delete rest.truncated;
  delete rest.originalLength;
  if (Object.keys(rest).length) root.appendChild(renderReportEvidence(rest, depth + 1));
  if (!root.childElementCount) root.appendChild(el('p', 'ov2-report-screen__quiet', 'No diff recorded.'));
  return root;
}

function appendFieldValue(body: HTMLElement, key: string, item: unknown, depth: number): void {
  if (key === 'outcome' && typeof item === 'string') {
    body.appendChild(reportBadge(item));
    return;
  }
  if (key === 'attempts' && Array.isArray(item)) {
    item.forEach((attempt, index) => {
      const record = attempt && typeof attempt === 'object' ? attempt : {};
      body.appendChild(reportDisclosure(
        `${index + 1}. ${label(String(record.role || 'Attempt'))} · ${label(String(record.outcome || (record.ended ? 'Ended' : 'In progress')))}`,
        () => renderReportEvidence(attempt, depth + 1),
      ));
    });
    return;
  }
  if (key === 'diff' && item && typeof item === 'object' && !Array.isArray(item)) {
    body.appendChild(renderDiffEvidence(item as Record<string, unknown>, depth));
    return;
  }
  if ((key === 'files' || key === 'blockers' || key === 'needs') && Array.isArray(item) && item.every((entry) => typeof entry === 'string')) {
    body.appendChild(renderStringList(item as string[], key === 'files' ? 'ov2-report-files' : 'ov2-report-evidence__values'));
    return;
  }
  if (['patch', 'testOutput', 'worktree', 'attemptId'].includes(key) || (typeof item === 'string' && item.length > 1200)) {
    body.appendChild(reportDisclosure(`View ${label(key).toLowerCase()}`, () => {
      const pre = el('pre', 'ov2-report-evidence__log', String(item));
      pre.tabIndex = 0;
      return pre;
    }));
    return;
  }
  if (typeof item === 'object') {
    body.appendChild(renderReportEvidence(item, depth + 1));
    return;
  }
  body.textContent = typeof item === 'boolean' ? (item ? 'Yes' : 'No') : String(item);
}

/** Evidence is untrusted journal/model data; render values as text, never HTML. */
export function renderReportEvidence(value: unknown, depth = 0): HTMLElement {
  const root = el('div', 'ov2-report-evidence');
  if (value == null) return el('p', 'ov2-report-screen__quiet', 'No evidence recorded.');
  if (typeof value !== 'object' || depth > 8) {
    root.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    return root;
  }
  if (Array.isArray(value)) {
    if (value.length && value.every(isPlainValue)) {
      root.appendChild(renderStringList(value.map(String), 'ov2-report-evidence__values'));
      return root;
    }
    const list = el('ol', 'ov2-report-evidence__list');
    value.forEach((item) => {
      const row = el('li', '');
      row.appendChild(renderReportEvidence(item, depth + 1));
      list.appendChild(row);
    });
    root.appendChild(list);
    return root;
  }
  const record = value as Record<string, unknown>;
  if (depth === 0 && (Array.isArray(record.files) || record.patch != null) && record.diff == null
      && Object.keys(record).every((key) => ['files', 'patch', 'truncated', 'originalLength'].includes(key))) {
    return renderDiffEvidence(record, depth);
  }
  const fields = el('dl', 'ov2-report-evidence__fields');
  for (const [key, item] of Object.entries(record)) {
    if (item == null || item === '' || (Array.isArray(item) && !item.length)) continue;
    if (key === 'originalLength') continue;
    if (key === 'truncated' && record.patch != null) continue;
    const row = el('div', 'ov2-report-evidence__field');
    row.appendChild(el('dt', '', label(key)));
    const body = el('dd', '');
    appendFieldValue(body, key, item, depth);
    row.appendChild(body);
    fields.appendChild(row);
  }
  root.appendChild(fields);
  if (!fields.childElementCount) root.appendChild(el('p', 'ov2-report-screen__quiet', 'No additional evidence recorded.'));
  return root;
}
