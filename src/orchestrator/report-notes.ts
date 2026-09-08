import { setAssistantBubbleContent } from '../markdown/renderer.ts';
import { el } from './dom';
import { renderReportEvidence, reportBadge, reportDisclosure } from './report-evidence';

interface ReportSection {
  title: string;
  body: string;
}

interface ParsedField {
  key: string;
  value: string;
}

const STRUCTURED_HEADINGS = new Set([
  'summary',
  'shipped',
  'abandoned',
  'skipped',
  'merge conflicts',
  'touches overflow',
  'final test',
  'cross-task patterns',
]);

/** Drop the report title and board name; the dashboard header already shows them. */
function stripReportHeader(markdown: string): string {
  let text = markdown.replace(/^\uFEFF/, '').trim();
  text = text.replace(/^#\s*End-of-run report\s*\n+/i, '');
  text = text.replace(/^\*\*([^*]+)\*\*\s*\n+/, '');
  return text.trim();
}

function splitReportSections(markdown: string): ReportSection[] {
  const trimmed = stripReportHeader(markdown);
  if (!trimmed) return [];
  const parts = trimmed.split(/\n(?=##\s+)/);
  const sections: ReportSection[] = [];
  for (const part of parts) {
    const match = part.match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
    if (!match) {
      if (sections.length === 0 && part.trim()) {
        sections.push({ title: 'Notes', body: part.trim() });
      }
      continue;
    }
    sections.push({ title: match[1].trim(), body: match[2].trim() });
  }
  return sections;
}

function looksStructuredReport(markdown: string): boolean {
  const sections = splitReportSections(markdown);
  if (!sections.length) return false;
  return sections.some((section) => STRUCTURED_HEADINGS.has(section.title.toLowerCase()));
}

function appendProse(parent: HTMLElement, markdown: string): void {
  const text = markdown.trim();
  if (!text || text === '_None._') return;
  const prose = el('div', 'ov2-spec__prose');
  setAssistantBubbleContent(prose, text, { modeId: 'orchestrate' });
  parent.appendChild(prose);
}

function appendField(parent: HTMLElement, key: string, value: string): void {
  const row = el('div', 'ov2-report-evidence__field');
  row.appendChild(el('dt', '', key));
  const body = el('dd', '');
  body.textContent = value;
  row.appendChild(body);
  parent.appendChild(row);
}

function appendEvidenceField(parent: HTMLElement, key: string, value: unknown): void {
  const row = el('div', 'ov2-report-evidence__field');
  row.appendChild(el('dt', '', key));
  const body = el('dd', '');
  body.appendChild(renderReportEvidence(value));
  row.appendChild(body);
  parent.appendChild(row);
}

function parseFieldLines(text: string): { fields: ParsedField[]; remainder: string } {
  const fields: ParsedField[] = [];
  const lines = text.split(/\r?\n/);
  const prose: string[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index >= lines.length) break;
    const line = lines[index];
    const match = line.match(/^([A-Za-z][A-Za-z0-9 /_-]*):\s*(.*)$/);
    if (!match) {
      prose.push(...lines.slice(index));
      break;
    }
    const key = match[1].trim();
    let value = match[2].trim();
    if (!value) {
      let peek = index + 1;
      while (peek < lines.length && !lines[peek].trim()) peek += 1;
      if (peek < lines.length && /^```/.test(lines[peek].trim())) {
        index = peek;
        const fenceLines: string[] = [];
        fenceLines.push(lines[index]);
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
          fenceLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          fenceLines.push(lines[index]);
          index += 1;
        }
        value = fenceLines.join('\n');
        fields.push({ key, value });
        continue;
      }
    }
    fields.push({ key, value });
    index += 1;
  }
  return { fields, remainder: prose.join('\n').trim() };
}

function parseJsonFence(value: string): unknown | null {
  const match = value.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function renderSectionShell(title: string): HTMLElement {
  const section = el('section', 'ov2-report-notes__section');
  section.appendChild(el('h5', 'ov2-report-task__subhead', title));
  return section;
}

function renderSummarySection(body: string): HTMLElement {
  const section = renderSectionShell('Summary');
  if (!body || body === '_None._') {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'No summary recorded.'));
    return section;
  }
  const lede = el('p', 'ov2-report-notes__lede', body.replace(/\s+/g, ' ').trim());
  section.appendChild(lede);
  return section;
}

function renderShippedSection(body: string): HTMLElement {
  const section = renderSectionShell('Shipped');
  if (!body || body === '_None._') {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'Nothing merged this run.'));
    return section;
  }
  const list = el('ul', 'ov2-report-notes__shipped');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('-')) continue;
    const item = trimmed.slice(1).trim();
    const match = item.match(/^\*\*([^*]+)\*\*\s*(?:—|-)\s*(.+)$/);
    const row = el('li', 'ov2-report-notes__shipped-row');
    if (match) {
      row.appendChild(el('span', 'ov2-report-card__id', match[1].trim()));
      row.appendChild(el('span', 'ov2-report-notes__shipped-title', match[2].trim()));
    } else {
      row.appendChild(el('span', 'ov2-report-notes__shipped-title', item));
    }
    list.appendChild(row);
  }
  if (!list.childElementCount) appendProse(section, body);
  else section.appendChild(list);
  return section;
}

function renderAbandonedTask(taskId: string, body: string): HTMLElement {
  const card = el('article', 'ov2-report-notes__task');
  const head = el('div', 'ov2-report-notes__task-head');
  head.appendChild(el('span', 'ov2-report-card__id', taskId));
  card.appendChild(head);

  const { fields, remainder } = parseFieldLines(body);
  const fieldsRoot = el('dl', 'ov2-report-evidence__fields');
  for (const field of fields) {
    const key = field.key.toLowerCase();
    if (key === 'outcome' || key === 'phase') {
      head.appendChild(reportBadge(field.value.toLowerCase()));
      continue;
    }
    if (key === 'evidence') {
      const parsed = parseJsonFence(field.value);
      if (parsed != null) appendEvidenceField(fieldsRoot, field.key, parsed);
      else if (field.value.trim()) appendField(fieldsRoot, field.key, field.value);
      continue;
    }
    if (key === 'attempts' && field.value.startsWith('```')) {
      const parsed = parseJsonFence(field.value);
      if (parsed != null) appendEvidenceField(fieldsRoot, field.key, parsed);
      continue;
    }
    if (field.value.startsWith('```')) {
      const parsed = parseJsonFence(field.value);
      if (parsed != null) appendEvidenceField(fieldsRoot, field.key, parsed);
      else appendField(fieldsRoot, field.key, field.value);
      continue;
    }
    appendField(fieldsRoot, field.key, field.value);
  }
  if (fieldsRoot.childElementCount) card.appendChild(fieldsRoot);
  if (remainder) {
    const extra = el('div', 'ov2-report-notes__task-extra');
    appendProse(extra, remainder);
    card.appendChild(extra);
  }
  return card;
}

function renderAbandonedSection(body: string): HTMLElement {
  const section = renderSectionShell('Abandoned');
  if (!body || body === '_None._') {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'No abandoned tasks.'));
    return section;
  }
  const chunks = body.split(/\n(?=###\s+)/);
  const stack = el('div', 'ov2-report-notes__tasks');
  let parsedTasks = 0;
  for (const chunk of chunks) {
    const match = chunk.match(/^###\s+([^\n]+)\n?([\s\S]*)$/);
    if (!match) continue;
    stack.appendChild(renderAbandonedTask(match[1].trim(), match[2].trim()));
    parsedTasks += 1;
  }
  if (parsedTasks > 0) {
    section.appendChild(stack);
    return section;
  }
  appendProse(section, body);
  return section;
}

function renderSkippedSection(body: string): HTMLElement {
  const section = renderSectionShell('Skipped');
  if (!body || body === '_None._') {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'No skipped tasks.'));
    return section;
  }
  appendProse(section, body);
  return section;
}

function renderFinalTestSection(body: string): HTMLElement {
  const section = renderSectionShell('Final test');
  if (!body || body === '_None._' || /not run/i.test(body)) {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'Final integration test was not run.'));
    return section;
  }
  const { fields, remainder } = parseFieldLines(body);
  if (fields.length) {
    const fieldsRoot = el('dl', 'ov2-report-evidence__fields');
    for (const field of fields) {
      if (field.key.toLowerCase() === 'outcome') {
        const row = el('div', 'ov2-report-evidence__field');
        row.appendChild(el('dt', '', field.key));
        const value = el('dd', '');
        value.appendChild(reportBadge(field.value.toLowerCase()));
        row.appendChild(value);
        fieldsRoot.appendChild(row);
        continue;
      }
      if (field.value.startsWith('```')) {
        section.appendChild(
          reportDisclosure('View reproduction command', () => {
            const pre = el('pre', 'ov2-report-evidence__log', field.value.replace(/^```[^\n]*\n?|```\s*$/g, ''));
            pre.tabIndex = 0;
            return pre;
          }),
        );
        continue;
      }
      appendField(fieldsRoot, field.key, field.value);
    }
    if (fieldsRoot.childElementCount) section.appendChild(fieldsRoot);
    if (remainder) appendProse(section, remainder);
    return section;
  }
  appendProse(section, body);
  return section;
}

function renderGenericSection(title: string, body: string): HTMLElement {
  const section = renderSectionShell(title);
  if (!body || body === '_None._') {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'None.'));
    return section;
  }
  appendProse(section, body);
  return section;
}

function renderStructuredSection(section: ReportSection): HTMLElement {
  const key = section.title.toLowerCase();
  if (key === 'summary') return renderSummarySection(section.body);
  if (key === 'shipped') return renderShippedSection(section.body);
  if (key === 'abandoned') return renderAbandonedSection(section.body);
  if (key === 'skipped') return renderSkippedSection(section.body);
  if (key === 'final test') return renderFinalTestSection(section.body);
  return renderGenericSection(section.title, section.body);
}

/** Legacy path: prose plus JSON fences rendered as structured evidence. */
function renderLegacyRunNotes(markdown: string): HTMLElement {
  const body = el('div', 'ov2-report-notes__legacy');
  const fence = /^```json\s*\r?\n([\s\S]*?)^```\s*$/gim;
  let cursor = 0;
  const prose = (text: string): void => {
    if (!text.trim()) return;
    appendProse(body, text);
  };
  for (const match of markdown.matchAll(fence)) {
    prose(markdown.slice(cursor, match.index));
    try {
      body.appendChild(renderReportEvidence(JSON.parse(match[1])));
      body.appendChild(
        reportDisclosure('View raw evidence', () => el('pre', 'ov2-report-evidence__log', match[1])),
      );
    } catch {
      body.appendChild(
        reportDisclosure('View recorded evidence', () => el('pre', 'ov2-report-evidence__log', match[1])),
      );
    }
    cursor = match.index! + match[0].length;
  }
  prose(markdown.slice(cursor));
  return body;
}

/** Turn saved end-of-run markdown into task-summary-style sections inside Run notes. */
export function renderRunNotesMarkdown(markdown: string): HTMLElement {
  const root = el('div', 'ov2-report-notes__content');
  if (looksStructuredReport(markdown)) {
    for (const section of splitReportSections(markdown)) {
      root.appendChild(renderStructuredSection(section));
    }
    return root;
  }
  root.appendChild(renderLegacyRunNotes(markdown));
  return root;
}
