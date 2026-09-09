/**
 * After an Issues mode pick, open the composer run-target panel.
 * Cancel (Escape / outside) does not send the issue.
 */

import { findIssueById } from '../state/issues-store.ts';
import type { ChatRunTargetChoice } from '../state/chat-worktree.ts';
import { isLocalServerAvailable } from '../tools/config.ts';
import { closeIssuesContextMenu } from './issues-context-menu.ts';
import { closeIssuesWorkflowMenu } from './issues-workflow-menu.ts';
import { closeRunTargetPicker, openRunTargetPicker } from './composer-run-target-menu.ts';

export interface PromptIssueChatRunTargetOptions {
  issueId: string;
  anchor?: HTMLElement | null;
  clientX?: number;
  clientY?: number;
  onPick: (choice: ChatRunTargetChoice) => void | Promise<void>;
}

/** Last row-menu pointer, used when the context menu has no button trigger. */
let lastMenuPoint: { x: number; y: number } | null = null;
let lastMenuAnchor: HTMLElement | null = null;

/** Remember where the issue row menu opened so the run-target panel can sit there. */
export function rememberIssueMenuAnchor(
  clientX: number,
  clientY: number,
  restoreFocus?: HTMLElement | null,
): void {
  lastMenuPoint = { x: clientX, y: clientY };
  lastMenuAnchor = restoreFocus ?? null;
}

/** Last remembered row-menu origin. */
export function lastIssueMenuOrigin(): {
  anchor: HTMLElement | null;
  clientX?: number;
  clientY?: number;
} {
  return {
    anchor: lastMenuAnchor,
    clientX: lastMenuPoint?.x,
    clientY: lastMenuPoint?.y,
  };
}

/**
 * Open the composer run-target picker, or send Local immediately when the
 * tool server is down (composer hides worktree options in that case).
 */
export function promptIssueChatRunTarget(options: PromptIssueChatRunTargetOptions): void {
  const issue = findIssueById(options.issueId);
  if (!issue) return;

  closeIssuesWorkflowMenu();
  closeIssuesContextMenu();
  closeRunTargetPicker();

  if (!isLocalServerAvailable()) {
    void options.onPick({ kind: 'local' });
    return;
  }

  const hasPoint =
    typeof options.clientX === 'number' && typeof options.clientY === 'number';
  void openRunTargetPicker({
    // Pointer origin wins so the panel sits on the context menu, not the row.
    anchor: hasPoint ? null : options.anchor,
    clientX: hasPoint ? options.clientX : undefined,
    clientY: hasPoint ? options.clientY : undefined,
    repoRoot: issue.workspacePath,
    defaultTitle: issue.title,
    defaultPath: issue.workspacePath,
    reserved: ['main', 'master'],
    onPick: options.onPick,
  });
}
