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

/** Evidence is untrusted journal/model data; render values as text, never HTML. */
export function renderReportEvidence(value: unknown, depth = 0): HTMLElement {
  const root = el('div', 'ov2-report-evidence');
  if (value == null) return el('p', 'ov2-report-screen__quiet', 'No evidence recorded.');
  if (typeof value !== 'object' || depth > 8) {
    root.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    return root;
  }
  if (Array.isArray(value)) {
    const list = el('ol', 'ov2-report-evidence__list');
    value.forEach((item) => {
      const row = el('li', '');
      row.appendChild(renderReportEvidence(item, depth + 1));
      list.appendChild(row);
    });
    root.appendChild(list);
    return root;
  }
  const fields = el('dl', 'ov2-report-evidence__fields');
  for (const [key, item] of Object.entries(value)) {
    if (item == null || item === '' || (Array.isArray(item) && !item.length)) continue;
    const row = el('div', 'ov2-report-evidence__field');
    row.appendChild(el('dt', '', label(key)));
    const body = el('dd', '');
    if (key === 'outcome' && typeof item === 'string') body.appendChild(reportBadge(item));
    else if (key === 'attempts' && Array.isArray(item)) {
      item.forEach((attempt, index) => {
        const record = attempt && typeof attempt === 'object' ? attempt : {};
        body.appendChild(reportDisclosure(
          `${index + 1}. ${label(String(record.role || 'Attempt'))} · ${label(String(record.outcome || (record.ended ? 'Ended' : 'In progress')))}`,
          () => renderReportEvidence(attempt, depth + 1),
        ));
      });
    } else if (['patch', 'testOutput', 'worktree', 'attemptId'].includes(key) || (typeof item === 'string' && item.length > 1200)) {
      body.appendChild(reportDisclosure(`View ${label(key).toLowerCase()}`, () => {
        const pre = el('pre', 'ov2-report-evidence__log', String(item));
        pre.tabIndex = 0;
        return pre;
      }));
    } else if (typeof item === 'object') body.appendChild(renderReportEvidence(item, depth + 1));
    else body.textContent = typeof item === 'boolean' ? (item ? 'Yes' : 'No') : String(item);
    row.appendChild(body);
    fields.appendChild(row);
  }
  root.appendChild(fields);
  if (!fields.childElementCount) root.appendChild(el('p', 'ov2-report-screen__quiet', 'No additional evidence recorded.'));
  return root;
}
