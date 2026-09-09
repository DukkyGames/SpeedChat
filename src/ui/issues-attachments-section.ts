import {
  addIssueAttachment,
  removeIssueAttachment,
  scheduleSaveIssues,
} from '../state/issues-store';
import {
  deleteIssueAttachmentBytes,
  formatAttachmentSize,
  isImageAttachment,
  issueAttachmentDisplayUrl,
  uploadIssueAttachment,
} from '../state/issue-attachments-api';
import { hasExternalFileDrag } from '../attachments/external-file-drop';
import type { IssueAttachment, IssueCard } from '../types';
import { appConfirm } from './app-dialog';
import { createIcon } from './icon';
import { showToast } from './toast';

/** Called after any change so the panel re-renders from store state. */
export type AttachmentsChanged = () => void;

// ── Ingest ───────────────────────────────────────────────────────────────────

/** Upload dropped or picked files and append attachment records on the issue. */
export async function ingestIssueFiles(
  issueId: string,
  files: File[],
  onChanged: AttachmentsChanged,
): Promise<void> {
  if (files.length === 0) return;
  let added = 0;
  for (const file of files) {
    try {
      const stored = await uploadIssueAttachment(issueId, file);
      if (!stored) {
        showToast('Attachments need the local server.', 'error');
        return;
      }
      addIssueAttachment(issueId, {
        name: stored.name,
        path: stored.path,
        mime: stored.mime,
        bytes: stored.bytes,
      });
      added += 1;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not attach file', 'error');
    }
  }
  if (added > 0) {
    scheduleSaveIssues();
    showToast(added === 1 ? 'Attached 1 file' : `Attached ${added} files`, 'success');
    onChanged();
  }
}

function filesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function buildAttachmentRow(
  issue: IssueCard,
  attachment: IssueAttachment,
  onChanged: AttachmentsChanged,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'issues-attachment';

  if (isImageAttachment(attachment)) {
    const link = document.createElement('a');
    link.className = 'issues-attachment__thumb';
    link.href = issueAttachmentDisplayUrl(attachment);
    link.target = '_blank';
    link.rel = 'noreferrer';
    const img = document.createElement('img');
    img.src = issueAttachmentDisplayUrl(attachment);
    img.alt = attachment.name;
    img.loading = 'lazy';
    link.appendChild(img);
    row.appendChild(link);
  }

  const meta = document.createElement('div');
  meta.className = 'issues-attachment__meta';

  const name = document.createElement('a');
  name.className = 'issues-attachment__name';
  name.href = issueAttachmentDisplayUrl(attachment);
  name.target = '_blank';
  name.rel = 'noreferrer';
  name.textContent = attachment.name;
  meta.appendChild(name);

  const size = formatAttachmentSize(attachment.bytes);
  if (size) {
    const sizeEl = document.createElement('span');
    sizeEl.className = 'issues-attachment__size';
    sizeEl.textContent = size;
    meta.appendChild(sizeEl);
  }

  const pathEl = document.createElement('button');
  pathEl.type = 'button';
  pathEl.className = 'issues-attachment__path';
  pathEl.appendChild(createIcon('copy', { size: 12 }));
  const pathLabel = document.createElement('span');
  pathLabel.textContent = 'Copy path';
  pathEl.appendChild(pathLabel);
  pathEl.title = attachment.path;
  pathEl.addEventListener('click', () => {
    void navigator.clipboard.writeText(attachment.path).then(
      () => showToast('Copied attachment path', 'success'),
      () => showToast('Could not copy path', 'error'),
    );
  });
  meta.appendChild(pathEl);
  row.appendChild(meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'issues-attachment__remove';
  remove.setAttribute('aria-label', `Remove ${attachment.name}`);
  remove.title = `Remove ${attachment.name}`;
  remove.appendChild(createIcon('trash', { size: 13 }));
  remove.addEventListener('click', () => {
    void (async () => {
      const ok = await appConfirm(`Remove ${attachment.name}? The file is deleted.`, {
        confirmLabel: 'Remove',
        title: 'Remove attachment',
      });
      if (!ok) return;
      await deleteIssueAttachmentBytes(attachment);
      if (removeIssueAttachment(issue.id, attachment.id)) {
        scheduleSaveIssues();
        onChanged();
      }
    })();
  });
  row.appendChild(remove);

  return row;
}

// ── Render ───────────────────────────────────────────────────────────────────

/** Handle so the section header's control can open the native picker. */
export interface IssueAttachmentsHandle {
  openPicker: () => void;
}

/**
 * Build the section.
 *
 * The picker lives here but the control that opens it sits in the section
 * header, so an issue with no attachments costs one row instead of a button.
 */
export function renderIssueAttachments(
  body: HTMLElement,
  issue: IssueCard,
  onChanged: AttachmentsChanged,
): IssueAttachmentsHandle {
  const attachments = issue.attachments ?? [];

  if (attachments.length > 0) {
    const list = document.createElement('div');
    list.className = 'issues-attachments';
    for (const attachment of attachments) {
      list.appendChild(buildAttachmentRow(issue, attachment, onChanged));
    }
    body.appendChild(list);
  }

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.setAttribute('aria-hidden', 'true');
  picker.addEventListener('change', () => {
    const files = picker.files ? Array.from(picker.files) : [];
    picker.value = '';
    void ingestIssueFiles(issue.id, files, onChanged);
  });
  body.appendChild(picker);

  body.addEventListener('paste', (event) => {
    const files = filesFromClipboard(event as ClipboardEvent);
    if (files.length === 0) return;
    event.preventDefault();
    void ingestIssueFiles(issue.id, files, onChanged);
  });

  body.addEventListener('dragover', (event) => {
    if (!hasExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    body.classList.add('is-drop-target');
  });
  body.addEventListener('dragleave', () => body.classList.remove('is-drop-target'));
  body.addEventListener('drop', (event) => {
    body.classList.remove('is-drop-target');
    if (!hasExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void ingestIssueFiles(issue.id, files, onChanged);
  });

  return { openPicker: () => picker.click() };
}
