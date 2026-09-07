/**
 * Which shell window is on which workspace.
 *
 * Modelled on {@link ../preview-instance-registry.ts PreviewInstanceRegistry}: a
 * plain map plus LRU-by-focus ordering, kept free of Electron imports so it can
 * be unit-tested.
 *
 * The path key **must** match the server's, or the duplicate-open rule silently
 * stops working on Windows and macOS. Rather than write a third normalizer —
 * there are already two, the server's `normalizeWorkspacePathKey` and the
 * client's `normalize-workspace-path.ts` — the caller injects the server's.
 */

export interface ShellWindowRecord {
  /** `BrowserWindow.id`. */
  windowId: number;
  /** Absolute workspace folder, or `''` for a window still at the folder gate. */
  workspacePath: string;
  /** Stable id handed to the renderer as `viewContext.viewId`. */
  viewId: string;
  /**
   * When set, this is an app-only window (no rail, no chat). App windows share
   * a folder with the workspace window but must never satisfy "folder already
   * open" — that check exists to keep two session views off `sessions.db`.
   */
  appId?: string;
  lastFocusedAt: number;
}

export interface ShellWindowRegistryOptions {
  /** Must be the server's `normalizeWorkspacePathKey`. */
  normalizeKey: (absPath: string) => string;
}

export class ShellWindowRegistry {
  private readonly byWindowId = new Map<number, ShellWindowRecord>();
  private readonly normalizeKey: (absPath: string) => string;
  private focusCounter = 0;
  private viewCounter = 0;

  constructor(options: ShellWindowRegistryOptions) {
    this.normalizeKey = options.normalizeKey;
  }

  /** A fresh `viewId`, unique for the life of the process. */
  nextViewId(): string {
    this.viewCounter += 1;
    return `view-${this.viewCounter}`;
  }

  register(
    windowId: number,
    workspacePath: string,
    viewId: string,
    appId?: string,
  ): ShellWindowRecord {
    const record: ShellWindowRecord = {
      windowId,
      workspacePath: workspacePath ?? '',
      viewId,
      lastFocusedAt: this.nextFocus(),
    };
    if (appId) record.appId = appId;
    this.byWindowId.set(windowId, record);
    return record;
  }

  unregister(windowId: number): ShellWindowRecord | undefined {
    const record = this.byWindowId.get(windowId);
    this.byWindowId.delete(windowId);
    return record;
  }

  get(windowId: number): ShellWindowRecord | undefined {
    return this.byWindowId.get(windowId);
  }

  /**
   * Point an existing window at a different folder.
   *
   * Not used by the folder switch: `additionalArguments` are fixed at window
   * creation, so switching folders builds a replacement window and destroys the
   * old one rather than re-pointing this record.
   */
  retarget(windowId: number, workspacePath: string): ShellWindowRecord | undefined {
    const record = this.byWindowId.get(windowId);
    if (!record) return undefined;
    record.workspacePath = workspacePath ?? '';
    return record;
  }

  /**
   * The one window on this folder, if any. Enforcing "a folder opens in exactly
   * one view" is not just UX: `sessions.db` has a single global revision
   * counter, so two views owning the same chat rows would 409-thrash.
   */
  findByWorkspace(workspacePath: string): ShellWindowRecord | undefined {
    if (!workspacePath || !workspacePath.trim()) return undefined;
    const key = this.normalizeKey(workspacePath);
    for (const record of this.byWindowId.values()) {
      if (record.appId) continue;
      if (!record.workspacePath) continue;
      if (this.normalizeKey(record.workspacePath) === key) return record;
    }
    return undefined;
  }

  /** The dedicated window for this app, if any (one window per app id). */
  findAppWindow(appId: string): ShellWindowRecord | undefined {
    if (!appId) return undefined;
    for (const record of this.byWindowId.values()) {
      if (record.appId === appId) return record;
    }
    return undefined;
  }

  /**
   * True when this window is already the one view on `workspacePath`.
   * Retargeting in that case would destroy and recreate the same folder.
   */
  isWindowOnWorkspace(windowId: number, workspacePath: string): boolean {
    if (!workspacePath || !workspacePath.trim()) return false;
    const record = this.byWindowId.get(windowId);
    if (!record?.workspacePath || record.appId) return false;
    return this.normalizeKey(record.workspacePath) === this.normalizeKey(workspacePath);
  }

  markFocused(windowId: number): void {
    const record = this.byWindowId.get(windowId);
    if (record) record.lastFocusedAt = this.nextFocus();
  }

  /** Every open window, most recently focused first. */
  list(): ShellWindowRecord[] {
    return [...this.byWindowId.values()].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
  }

  mostRecentlyFocused(): ShellWindowRecord | undefined {
    return this.list()[0];
  }

  get size(): number {
    return this.byWindowId.size;
  }

  private nextFocus(): number {
    this.focusCounter += 1;
    return this.focusCounter;
  }
}
