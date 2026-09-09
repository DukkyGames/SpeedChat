/**
 * Per-chat worktree helpers (MIN-276) — attach/detach, labels, managed-slot detection.
 *
 * Chat-scoped workspace resolution used to live in the V1 board engine's
 * `worktree-isolation.ts`. That file is gone; these helpers stay because they
 * are about a chat's own worktree / sandbox, not a board slot.
 */

import { isPlaceholderChatName } from '../chat/titles/placeholder.ts';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { sanitizePathSegment } from '../lib/sanitize-path-segment.mjs';
import { isMinnowSandboxWorkspacePath } from '../lib/workspace-sandbox.ts';
import {
  GIT_REF_FALLBACK_WORKTREE,
  slugifyGitRefName,
  suggestGitRefName,
} from '../lib/git-branch-slug.mjs';
import { worktreePathsEqual } from '../lib/worktree-list-parse.ts';
import { gitBranches } from './git-api.ts';
import { getWorkspacePath } from './workspace.ts';
import {
  createChatWorktree,
  removeChatWorktree,
} from './worktree-service.ts';
import type { Chat, ChatGroup } from '../types.ts';

/**
 * Sanitize an id fragment into a safe git ref / path segment.
 * Same rules as the server worktree path helper.
 */
export function sanitizeRefFragment(raw: string | number): string {
  return sanitizePathSegment(raw);
}

/**
 * Tool workspace root for a chat: isolated worktree when present, otherwise the
 * chat's bound sandbox (~/.minnow/workspace or ~/.minnow/chats) or leftover
 * board-folder workspace. Plain Code chats without a worktree return undefined
 * so callers fall back to the live top-bar workspace.
 *
 * Does not look up V1 board-task `worktreePath` — that engine is gone. Chats
 * that still have `worktreeRoot` stamped keep using it.
 */
export function resolveChatToolWorkspaceRoot(
  chat: Pick<Chat, 'worktreeRoot' | 'boardGroupId' | 'workspacePath'>,
  groups?: ChatGroup[],
): string | undefined {
  const direct = resolveChatWorktreeRoot(chat, groups);
  if (direct) return direct;

  const ws = chat.workspacePath?.trim();
  if (!ws) return undefined;
  const normalized = normalizeWorkspacePath(ws);

  if (chat.boardGroupId?.trim()) return normalized;
  if (isMinnowSandboxWorkspacePath(normalized)) return normalized;
  return undefined;
}

/**
 * Direct chat worktree path (no leftover board-task fallback).
 * A worktreeRoot that is only a case/slash variant of the Code workspace is
 * treated as Local so path-normalization drift cannot stick a chat in
 * “Worktree” mode on the principal checkout (MIN-780).
 */
export function resolveChatWorktreeRoot(
  chat: Pick<Chat, 'worktreeRoot'>,
  _groups?: ChatGroup[],
): string | undefined {
  const direct = chat.worktreeRoot?.trim();
  if (!direct) return undefined;
  const ws = getWorkspacePath().trim();
  if (ws && worktreePathsEqual(direct, ws)) return undefined;
  return direct;
}

/** True when the chat runs tools inside an isolated git worktree. */
export function isChatWorktreeMode(chat: Pick<Chat, 'worktreeRoot'>): boolean {
  return Boolean(resolveChatWorktreeRoot(chat));
}

/** Short label for the composer run-target button. */
export function formatComposerRunTargetLabel(chat: Pick<Chat, 'worktreeRoot'>): string {
  return isChatWorktreeMode(chat) ? 'Worktree' : 'Local';
}

/** Short label for the composer branch button. */
export function formatComposerBranchLabel(branch?: string): string {
  const name = branch?.trim();
  return name || 'Branch';
}

/**
 * Chat title usable as a git-ref source. Placeholder "New chat" is skipped so
 * the default falls through to the workspace folder slug (MIN-659).
 */
export function chatTitleForGitRef(chat: Pick<Chat, 'name'>): string {
  const title = chat.name?.trim() ?? '';
  if (!title || isPlaceholderChatName(title)) return '';
  return title;
}

/**
 * Default branch name for a new managed chat worktree: chat title, else folder
 * basename — never the current checkout or an opaque chat id.
 */
export function suggestChatWorktreeBranchName(
  chat: Pick<Chat, 'name' | 'workspacePath' | 'gitBranch'>,
  workspacePath = '',
): string {
  return suggestGitRefName({
    title: chatTitleForGitRef(chat),
    path: chat.workspacePath?.trim() || workspacePath,
    fallback: GIT_REF_FALLBACK_WORKTREE,
    reserved: [chat.gitBranch, 'main', 'master'],
  });
}

/**
 * Expected managed slot path pattern: ~/.minnow/worktrees/<repo>/chat/<chatId>.
 * Used to decide whether delete should remove the worktree.
 */
export function isManagedChatWorktreePath(
  chatId: string,
  worktreePath: string,
): boolean {
  const slot = sanitizeRefFragment(chatId);
  const wt = worktreePath.trim().replace(/\\/g, '/');
  if (!slot || !wt) return false;
  return wt.includes('/worktrees/') && wt.endsWith(`/chat/${slot}`);
}

/** Detach a chat from its worktree; remove the managed slot when Minnow created it. */
export async function detachChatWorktree(chat: Chat): Promise<void> {
  const managed = chat.chatWorktreeManaged === true;
  const wt = chat.worktreeRoot?.trim();
  if (managed) {
    await removeChatWorktree({ chatId: chat.id });
  }
  delete chat.worktreeRoot;
  delete chat.chatWorktreeManaged;
  if (!managed && wt) {
  }
}

/** Point the chat at a worktree path + branch (existing attachment). */
export function attachChatToWorktree(
  chat: Chat,
  worktreePath: string,
  branch?: string,
): void {
  const path = normalizeWorkspacePath(worktreePath);
  chat.worktreeRoot = path;
  if (branch?.trim()) chat.gitBranch = branch.trim();
  chat.chatWorktreeManaged = isManagedChatWorktreePath(chat.id, path);
}

/** Create a fresh managed worktree for this chat on `branch`. */
export async function createManagedChatWorktree(
  chat: Chat,
  branch: string,
  baseRef?: string,
  checkoutExisting?: boolean,
): Promise<{ ok: boolean; error?: string }> {
  // Checkout-existing keeps origin/foo as-is; new branches still get a git-safe slug.
  const branchName = checkoutExisting
    ? branch.trim()
    : slugifyGitRefName(branch, GIT_REF_FALLBACK_WORKTREE);
  const res = await createChatWorktree({
    chatId: chat.id,
    branch: branchName,
    baseRef,
    checkoutExisting,
  });
  if (!res.ok || !res.path) {
    return { ok: false, error: res.error ?? res.output ?? 'Could not create worktree' };
  }
  chat.worktreeRoot = res.path;
  chat.gitBranch = (res.branch ?? branchName).trim();
  chat.chatWorktreeManaged = true;
  return { ok: true };
}

/** Switch chat back to the main Code workspace (Local target). */
export async function setChatRunTargetLocal(chat: Chat): Promise<void> {
  await detachChatWorktree(chat);
  const res = await gitBranches(composerGitRepoRoot());
  if (res.ok && res.current?.trim()) {
    chat.gitBranch = res.current.trim();
  } else {
    delete chat.gitBranch;
  }
}

/** Best-effort cleanup when a chat is deleted. */
export async function cleanupChatWorktreeOnDelete(chat: Chat): Promise<void> {
  if (!chat.chatWorktreeManaged) return;
  await removeChatWorktree({ chatId: chat.id });
}

/** Workspace root used for branch listing (always the Code workspace). */
export function composerGitRepoRoot(): string {
  return getWorkspacePath().trim();
}
