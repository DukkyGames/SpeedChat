import { parseIssueCodeRefPaste } from '../state/issue-code-ref-parse';

/** What a paste should become. `passthrough` lets the browser do its thing. */
export type PastePlan =
  | { kind: 'passthrough' }
  | { kind: 'text'; text: string }
  | { kind: 'github'; url: string; label: string }
  | { kind: 'code-ref'; text: string }
  | { kind: 'stack-trace'; text: string; paths: string[] }
  | { kind: 'image'; file: File };

const GITHUB_URL_RE =
  /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/#?].*)?$/i;

const TRACE_PATH_RE =
  /(?:at\s+.*?\(|at\s+|^\s*|[\s(])((?:[A-Za-z]:)?[\w./\\-]+\.[A-Za-z]{1,5}):(\d+)(?::(\d+))?/gm;

/** Minimum matching lines before a paste is treated as a stack trace. */
const TRACE_MIN_LINES = 3;

function filesFrom(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const out: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

/** Unique workspace-relative paths a trace mentions, most-referenced first. */
export function extractTracePaths(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(TRACE_PATH_RE)) {
    const path = match[1].replace(/\\/g, '/');
    const line = match[2];
    if (path.startsWith('node:') || path.includes('node_modules/')) continue;
    const key = `${path}:${line}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

/** Decide what a paste should become. Pure and synchronous. */
export function classifyPaste(dataTransfer: DataTransfer | null): PastePlan {
  const images = filesFrom(dataTransfer).filter((file) => file.type.startsWith('image/'));
  if (images.length > 0) return { kind: 'image', file: images[0] };

  const text = dataTransfer?.getData('text/plain') ?? '';
  if (!text.trim()) return { kind: 'passthrough' };

  const single = text.trim();
  if (!single.includes('\n')) {
    const gh = GITHUB_URL_RE.exec(single);
    if (gh) {
      const [, owner, repo, kind, number] = gh;
      return {
        kind: 'github',
        url: single,
        label: `${owner}/${repo}#${number}${kind === 'pull' ? ' (PR)' : ''}`,
      };
    }

    if (/^[\w./\\-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/.test(single)) {
      const parsed = parseIssueCodeRefPaste(single);
      if (parsed.ok && parsed.ref.startLine) {
        return { kind: 'code-ref', text: `@${single.replace(/\\/g, '/')}` };
      }
    }
  }

  const paths = extractTracePaths(text);
  const lineCount = text.split('\n').filter((line) => line.trim()).length;
  if (paths.length > 0 && lineCount >= TRACE_MIN_LINES) {
    return { kind: 'stack-trace', text, paths };
  }

  return { kind: 'passthrough' };
}

export interface PasteContext {
  issueId?: string;
  onAttachment?: (attachment: import('../state/issue-attachments-api').StoredAttachment) => void;
  /** Insert markdown at the caret and commit. */
  insertText: (text: string) => void;
}

/** Fence a block of text, choosing a fence longer than anything inside it. */
function fence(text: string): string {
  const marker = text.includes('```') ? '````' : '```';
  return `${marker}\n${text.replace(/\s+$/, '')}\n${marker}\n`;
}

/** Carry out a plan. */
export async function applyPaste(plan: PastePlan, ctx: PasteContext): Promise<boolean> {
  switch (plan.kind) {
    case 'github':
      ctx.insertText(`[${plan.label}](${plan.url})`);
      return true;

    case 'code-ref':
      ctx.insertText(`${plan.text} `);
      return true;

    case 'stack-trace': {
      const { appConfirm } = await import('./app-dialog');
      const files = plan.paths.slice(0, 6);
      const ok = await appConfirm(
        `This looks like a stack trace. Add ${files.length} code ${
          files.length === 1 ? 'reference' : 'references'
        } alongside it?\n\n${files.join('\n')}`,
        { confirmLabel: 'Add references', cancelLabel: 'Paste as-is', title: 'Stack trace' },
      );
      if (!ok) {
        ctx.insertText(fence(plan.text));
        return true;
      }
      const refs = files.map((path) => `- @${path}`).join('\n');
      ctx.insertText(`${fence(plan.text)}\n${refs}\n`);
      return true;
    }

    case 'image': {
      if (!ctx.issueId) return false;
      const api = await import('../state/issue-attachments-api');
      const store = await import('../state/issues-store');
      const { showToast } = await import('./toast');
      try {
        const stored = await api.uploadIssueAttachment(
          ctx.issueId,
          plan.file,
          plan.file.name || 'pasted-image.png',
        );
        if (!stored) {
          showToast('Attachments need the local server.', 'error');
          return false;
        }
        // Inserting commits the editor before the attachment event can remount it.
        ctx.insertText(
          `![${stored.name.replace(/[\[\]]/g, '')}](${api.issueAttachmentUrl(stored)})\n`,
        );
        if (ctx.onAttachment) ctx.onAttachment(stored);
        else store.addIssueAttachment(ctx.issueId, {
          name: stored.name,
          path: stored.path,
          mime: stored.mime,
          bytes: stored.bytes,
        });
        store.scheduleSaveIssues();
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not attach image', 'error');
        return false;
      }
    }

    case 'text':
      ctx.insertText(plan.text);
      return true;

    default:
      return false;
  }
}

/** Editor entry point: classify synchronously, prevent the default when there is something to do, then apply. */
export function transformPaste(event: ClipboardEvent, ctx: PasteContext): boolean {
  const plan = classifyPaste(event.clipboardData);
  if (plan.kind === 'passthrough') return false;
  event.preventDefault();
  void applyPaste(plan, ctx);
  return true;
}
