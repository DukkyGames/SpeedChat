/**
 * GitHub sync for Issues: the side of it that touches the network and the store.
 *
 * The decisions live in `issues/github-sync-plan.ts` and are pure. This module
 * only carries them out, which is why it never contains a "who wins" branch —
 * if you find yourself adding one here, it belongs in the planner where it can
 * be tested.
 *
 * Phase 5 of `documentation/plans/issues-app-v2.md`.
 */

import {
  ISSUES_GITHUB_MODES,
  githubLabelDiff,
  issueNeedsGithubPush,
  nextGithubLink,
  normalizeGithubMode,
  planIssueSync,
  type IssuesGithubMode,
  type RemoteIssueSnapshot,
  type SyncAction,
  type SyncFields,
} from '../issues/github-sync-plan';
import { userFacingGithubError, isLocalServerOfflineError } from '../issues/github-error';
import {
  addIssue,
  appendIssueLinks,
  collectIssues,
  findIssueById,
  isIssuesStoreLoaded,
  listIssues,
  requireIssueStatusForRole,
  scheduleSaveIssues,
  updateIssue,
} from './issues-store';
import { isClosedStatus } from '../issues/taxonomy';
import { getIssuesTaxonomySync } from './issues-taxonomy-store';
import { isLocalServerAvailable } from '../tools/config';
import { getWorkspacePath } from './workspace';

// ── Mode ─────────────────────────────────────────────────────────────────────

const MODE_STORAGE_KEY = 'minnow.issues.github.mode';
const AUTO_STORAGE_KEY = 'minnow.issues.github.auto';

let cachedMode: IssuesGithubMode | null = null;
let cachedAuto: boolean | null = null;
const modeListeners = new Set<(mode: IssuesGithubMode) => void>();
const autoListeners = new Set<(enabled: boolean) => void>();

/** The settings-gated sync mode. Retired Link + push (`link`) becomes Off. */
export function getIssuesGithubMode(): IssuesGithubMode {
  if (cachedMode) return cachedMode;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MODE_STORAGE_KEY);
  } catch {
    cachedMode = 'off';
    return cachedMode;
  }
  cachedMode = normalizeGithubMode(stored);
  // Persist the migration so Settings does not bounce back to a removed mode.
  if (stored === 'link' && cachedMode === 'off') {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, 'off');
    } catch {}
  }
  return cachedMode;
}

/** Set the mode. Off is the default and always a safe answer. */
export function setIssuesGithubMode(mode: IssuesGithubMode): void {
  const next = normalizeGithubMode(mode);
  cachedMode = next;
  try {
    localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {}
  for (const listener of [...modeListeners]) {
    try {
      listener(next);
    } catch {}
  }
}

/** Subscribe to mode changes (settings ↔ Issues chrome). */
export function subscribeIssuesGithubMode(
  listener: (mode: IssuesGithubMode) => void,
): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

/** Read the stored Auto checkbox. Ignored unless mode is Two-way mirror. */
export function getIssuesGithubAuto(): boolean {
  if (cachedAuto !== null) return cachedAuto;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(AUTO_STORAGE_KEY);
  } catch {
    cachedAuto = false;
    return cachedAuto;
  }
  cachedAuto = stored === 'true' || stored === '1';
  return cachedAuto;
}

/** Persist the Auto checkbox. Mode Off leaves this flag alone so it can come back. */
export function setIssuesGithubAuto(enabled: boolean): void {
  cachedAuto = Boolean(enabled);
  try {
    localStorage.setItem(AUTO_STORAGE_KEY, cachedAuto ? 'true' : 'false');
  } catch {}
  for (const listener of [...autoListeners]) {
    try {
      listener(cachedAuto);
    } catch {}
  }
}

/** Subscribe to Auto checkbox changes (settings ↔ background loop). */
export function subscribeIssuesGithubAuto(listener: (enabled: boolean) => void): () => void {
  autoListeners.add(listener);
  return () => {
    autoListeners.delete(listener);
  };
}

/** True when Two-way mirror and Auto are both on. The only gate that may contact GitHub unattended. */
export function githubAutoSyncActive(): boolean {
  return getIssuesGithubMode() === 'mirror' && getIssuesGithubAuto();
}

/** Every valid mode, for the settings control. */
export { ISSUES_GITHUB_MODES };

interface ForgeResponse {
  ok: boolean;
  error?: string;
  issue?: RemoteIssueSnapshot;
  issues?: RemoteIssueSnapshot[];
  number?: number;
  url?: string;
  droppedLabels?: boolean;
}

/**
 * POST /api/git for issue forge ops.
 *
 * Never throws. Never flips `localServerAvailable` — a GitHub-op failure
 * (timeout, 401, dropped socket) must not empty the file tree until restart
 * (MIN-660). Callers render `error` through `userFacingGithubError`.
 */
async function forge(op: string, args: Record<string, unknown> = {}): Promise<ForgeResponse> {
  if (!isLocalServerAvailable()) return { ok: false, error: 'server_off' };
  try {
    const res = await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...args }),
    });
    let payload: ForgeResponse | null = null;
    try {
      payload = (await res.json()) as ForgeResponse;
    } catch {
      payload = null;
    }
    if (payload && typeof payload === 'object') {
      const error =
        typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : undefined;
      if (!res.ok) return { ok: false, error: error ?? `HTTP ${res.status}` };
      return payload;
    }
    return { ok: false, error: res.ok ? 'Could not read GitHub response' : `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: isLocalServerOfflineError(message) ? 'server_off' : message };
  }
}

function localIsClosed(status: string): boolean {
  return isClosedStatus(getIssuesTaxonomySync(), status);
}

/** Closed GitHub issues map to the done-role status when taxonomy has one. */
function statusForClosedRemote(): string | undefined {
  try {
    return requireIssueStatusForRole('done');
  } catch {
    return undefined;
  }
}

/** A conflict handed back for the user to resolve. Never resolved here. */
export interface SyncConflict {
  issueId: string;
  number: number;
  url: string;
  local: SyncFields;
  remote: SyncFields;
}

export interface SyncOutcome {
  ok: boolean;
  action: SyncAction['kind'];
  error?: string;
  conflict?: SyncConflict;
  /** Set when a label did not exist on the remote and was dropped to save the push. */
  droppedLabels?: boolean;
}

/** Read the remote counterpart of a linked issue, or null when unlinked. */
async function readRemote(issueId: string): Promise<RemoteIssueSnapshot | null> {
  const issue = findIssueById(issueId);
  const number = issue?.github?.number;
  if (!number) return null;
  const res = await forge('issueView', { number });
  return res.ok && res.issue ? res.issue : null;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Sync one issue.
 *
 * Returns the conflict rather than resolving it: the brief's gate is that
 * mirror mode never silently overwrites, and a function that could choose a
 * winner here would eventually be asked to.
 */
export async function syncIssueWithGithub(issueId: string): Promise<SyncOutcome> {
  try {
    return await runIssueSync(issueId);
  } catch (err) {
    return {
      ok: false,
      action: 'noop',
      error: userFacingGithubError(err instanceof Error ? err.message : String(err)),
    };
  }
}

/** Inner sync — throws only if the issues store itself is uninitialized. */
async function runIssueSync(issueId: string): Promise<SyncOutcome> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, action: 'noop', error: 'Issue not found' };

  const mode = getIssuesGithubMode();
  const remote = await readRemote(issueId);
  const action = planIssueSync({
    mode,
    issue,
    isClosed: localIsClosed(issue.status),
    remote,
  });

  switch (action.kind) {
    case 'noop': {
      // Content already matches, but a stale watermark (legacy timestamp or a
      // leftover flag) can still show "Needs push". The remote is known equal,
      // so refresh the watermark — a no-op write that clears the caption.
      if (
        action.reason === 'Already in sync' &&
        remote &&
        issue.github &&
        issueNeedsGithubPush(issue)
      ) {
        writeLink(issueId, issue.github.number, issue.github.url ?? remote.url, remote.updatedAt);
      }
      return { ok: true, action: 'noop', error: action.reason };
    }

    case 'create': {
      const res = await forge('issueCreate', {
        title: issue.title,
        body: issue.description,
        labels: issue.labels,
      });
      if (!res.ok || !res.number) {
        return {
          ok: false,
          action: 'create',
          error: userFacingGithubError(res.error ?? 'Could not create the issue'),
        };
      }
      writeLink(issueId, res.number, res.url ?? '', undefined);
      return { ok: true, action: 'create', droppedLabels: res.droppedLabels };
    }

    case 'push': {
      const number = issue.github?.number;
      if (!number) return { ok: false, action: 'push', error: 'Not linked to a GitHub issue' };
      const res = await pushSyncedFieldsToGithub(number, action.fields, remote);
      if (!res.ok) return { ok: false, action: 'push', error: res.error };
      const after = await readRemote(issueId);
      writeLink(issueId, number, issue.github?.url ?? '', after?.updatedAt);
      return { ok: true, action: 'push', droppedLabels: res.droppedLabels };
    }

    case 'pull': {
      const number = issue.github?.number;
      if (!number || !remote) {
        return { ok: false, action: 'pull', error: 'Not linked to a GitHub issue' };
      }
      applyRemoteToIssue(issueId, action.fields);
      writeLink(issueId, number, issue.github?.url ?? remote.url, remote.updatedAt);
      return { ok: true, action: 'pull' };
    }

    case 'conflict':
      return {
        ok: false,
        action: 'conflict',
        conflict: {
          issueId,
          number: issue.github?.number ?? 0,
          url: issue.github?.url ?? '',
          local: action.local,
          remote: action.remote,
        },
      };

    default:
      return { ok: false, action: 'noop', error: 'Unrecognized sync action' };
  }
}

/** Resolve a conflict the user judged. Both branches then write the watermark. */
export async function resolveSyncConflict(
  conflict: SyncConflict,
  keep: 'local' | 'remote',
): Promise<SyncOutcome> {
  const issue = findIssueById(conflict.issueId);
  if (!issue) return { ok: false, action: 'noop', error: 'Issue not found' };

  if (keep === 'remote') {
    applyRemoteToIssue(conflict.issueId, conflict.remote);
    const after = await readRemote(conflict.issueId);
    writeLink(conflict.issueId, conflict.number, conflict.url, after?.updatedAt);
    return { ok: true, action: 'pull' };
  }

  const res = await pushSyncedFieldsToGithub(conflict.number, conflict.local, {
    labels: conflict.remote.labels,
    state: conflict.remote.closed ? 'closed' : 'open',
  });
  if (!res.ok) return { ok: false, action: 'push', error: res.error };
  const after = await readRemote(conflict.issueId);
  writeLink(conflict.issueId, conflict.number, conflict.url, after?.updatedAt);
  return { ok: true, action: 'push', droppedLabels: res.droppedLabels };
}

/**
 * Write synced fields to an existing GitHub issue.
 *
 * `gh issue edit` has no replace-all for labels, so this sends the add/remove
 * diff. Missing repo labels are created server-side before attach.
 */
async function pushSyncedFieldsToGithub(
  number: number,
  fields: SyncFields,
  remote: Pick<RemoteIssueSnapshot, 'labels' | 'state'> | null,
): Promise<{ ok: boolean; error?: string; droppedLabels?: boolean }> {
  const { add, remove } = githubLabelDiff(fields.labels, remote?.labels ?? []);
  const res = await forge('issueEdit', {
    number,
    title: fields.title,
    body: fields.body,
    addLabels: add,
    removeLabels: remove,
  });
  if (!res.ok) return { ok: false, error: userFacingGithubError(res.error) };

  if (remote && fields.closed !== (remote.state === 'closed')) {
    await forge('issueState', { number, state: fields.closed ? 'closed' : 'open' });
  }
  return { ok: true, droppedLabels: res.droppedLabels };
}

function applyRemoteToIssue(issueId: string, fields: SyncFields): void {
  const status = fields.closed ? statusForClosedRemote() : findIssueById(issueId)?.status;
  // Pulls must not look like local edits or Auto would push the same fields back.
  updateIssue(
    issueId,
    {
      title: fields.title,
      description: fields.body,
      labels: fields.labels,
      ...(status ? { status } : {}),
    },
    { skipGithubAutoSync: true },
  );
}

function writeLink(
  issueId: string,
  number: number,
  url: string,
  remoteUpdatedAt: number | undefined,
): void {
  const issue = findIssueById(issueId);
  if (!issue) return;
  // Append the git link first: it bumps updatedAt, and the watermark must be
  // captured after that bump or the sync's own bookkeeping counts as a local
  // edit and the card shows "Needs push" forever. Re-appending is a no-op
  // (appendIssueLinks dedupes by kind+ref), so this is safe on self-heal.
  const after = appendIssueLinks(issueId, {
    gitLinks: [{ kind: 'github-issue', ref: `#${number}`, url }],
  });
  if (!after) return;
  after.github = nextGithubLink({
    previous: after.github,
    number,
    url,
    localUpdatedAt: after.updatedAt,
    remoteUpdatedAt,
    now: Date.now(),
  });
  scheduleSaveIssues();
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  skipped: number;
}

// ── Import ───────────────────────────────────────────────────────────────────

/**
 * Import remote issues that are not already linked.
 *
 * Imported cards land in the Triage lane (`source: 'github'`, no `triagedAt`),
 * which is the whole reason Triage keys off source rather than status: a
 * hundred imported issues must not silently become a hundred backlog items.
 *
 * Never throws: a failed import is `{ ok: false, error }` with user-facing copy
 * so Settings can show a dialog without taking down the rest of the SPA (MIN-660).
 */
export async function importGithubIssues(options?: {
  state?: 'open' | 'closed' | 'all';
  limit?: number;
}): Promise<ImportResult> {
  try {
    if (getIssuesGithubMode() === 'off') {
      return { ok: false, error: 'GitHub sync is off', imported: 0, skipped: 0 };
    }

    if (!isIssuesStoreLoaded()) {
      return {
        ok: false,
        error: 'Issues are still loading. Try again in a moment.',
        imported: 0,
        skipped: 0,
      };
    }

    const res = await forge('issueList', {
      state: options?.state ?? 'open',
      limit: options?.limit ?? 100,
    });
    if (!res.ok || !Array.isArray(res.issues)) {
      return {
        ok: false,
        error: userFacingGithubError(res.error ?? 'Could not list issues'),
        imported: 0,
        skipped: 0,
      };
    }

    const linked = new Set(
      listIssues()
        .map((issue) => issue.github?.number)
        .filter((n): n is number => typeof n === 'number'),
    );

    let imported = 0;
    let skipped = 0;
    const workspacePath = getWorkspacePath();
    const closedStatus = statusForClosedRemote();

    for (const remote of res.issues) {
      if (linked.has(remote.number)) {
        skipped += 1;
        continue;
      }
      try {
        const card = addIssue({
          title: remote.title || `GitHub #${remote.number}`,
          description: remote.body,
          labels: remote.labels,
          workspacePath,
          source: 'github',
          ...(remote.state === 'closed' && closedStatus ? { status: closedStatus } : {}),
        });
        writeLink(card.id, remote.number, remote.url, remote.updatedAt);
        linked.add(remote.number);
        imported += 1;
      } catch {}
    }

    if (imported > 0) scheduleSaveIssues();
    return { ok: true, imported, skipped };
  } catch (err) {
    return {
      ok: false,
      error: userFacingGithubError(err instanceof Error ? err.message : String(err)),
      imported: 0,
      skipped: 0,
    };
  }
}

/** Sync every eligible issue; returns the conflicts for the user to resolve. */
export async function syncAllIssuesWithGithub(options?: {
  /** Skip unlinked cards so a poller cannot backfill creates. */
  linkedOnly?: boolean;
  /** Match Issues list scope; defaults to the current workspace. */
  scope?: 'all' | 'current_workspace';
  workspacePath?: string;
}): Promise<{
  synced: number;
  conflicts: SyncConflict[];
  errors: string[];
}> {
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  let synced = 0;

  const mode = getIssuesGithubMode();
  if (mode === 'off') return { synced, conflicts, errors };

  const issues = collectIssues({
    scope: options?.scope ?? 'current_workspace',
    workspacePath: options?.workspacePath ?? getWorkspacePath(),
    hideDone: false,
  });

  for (const issue of issues) {
    if (options?.linkedOnly && !issue.github) continue;
    const outcome = await syncIssueWithGithub(issue.id);
    if (outcome.conflict) conflicts.push(outcome.conflict);
    else if (outcome.ok && outcome.action !== 'noop') synced += 1;
    else if (!outcome.ok && outcome.error && !isLocalServerOfflineError(outcome.error)) {
      errors.push(`${issue.id}: ${outcome.error}`);
    }
  }
  return { synced, conflicts, errors };
}

/** Reset cached settings (tests). */
export function resetIssuesGithubForTests(): void {
  cachedMode = null;
  cachedAuto = null;
  modeListeners.clear();
  autoListeners.clear();
}
