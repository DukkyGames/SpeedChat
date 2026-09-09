/**
 * Start-from / check-out refs for New branch and Add worktree.
 *
 * `git branch -a` remote lines look like `remotes/origin/main`. The pickers
 * store `origin/main` (valid as a git start-point) and skip remote HEAD.
 */

/**
 * @typedef {{
 *   current?: string,
 *   local?: string[],
 *   remote?: string[],
 *   lockedLocal?: string[],
 * }} GitRefBranchLists
 */

/**
 * Strip the `remotes/` prefix so a tracking ref is a usable git name.
 * @param {string} raw
 * @returns {string}
 */
export function displayRemoteRef(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.startsWith('remotes/')) return trimmed.slice('remotes/'.length);
  return trimmed;
}

/**
 * Remote-tracking symbolic HEAD (`origin/HEAD` or `remotes/origin/HEAD -> …`).
 * @param {string} raw
 * @returns {boolean}
 */
export function isSkippedRemoteRef(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return true;
  if (trimmed.includes(' -> ')) return true;
  const display = displayRemoteRef(trimmed);
  const parts = display.split('/');
  return parts.length >= 2 && parts[parts.length - 1] === 'HEAD';
}

/**
 * Local branch name implied by a remote-tracking ref (`origin/foo` → `foo`).
 * @param {string} raw
 * @returns {string}
 */
export function shortLocalNameFromRemote(raw) {
  const display = displayRemoteRef(raw);
  const slash = display.indexOf('/');
  if (slash <= 0) return display;
  return display.slice(slash + 1);
}

/**
 * Whether this value came from the remote list (not a local `feature/foo`).
 * @param {string} raw
 * @param {Iterable<string>} [remoteList]
 * @returns {boolean}
 */
export function isListedRemoteRef(raw, remoteList = []) {
  const display = displayRemoteRef(raw);
  for (const entry of remoteList) {
    if (displayRemoteRef(entry) === display) return true;
  }
  return String(raw ?? '').trim().startsWith('remotes/');
}

/**
 * Local names that git will refuse to check out in a second worktree.
 * @param {GitRefBranchLists} lists
 * @returns {Set<string>}
 */
export function unavailableCheckoutNames(lists) {
  const names = new Set();
  const current = String(lists.current ?? '').trim();
  if (current && current !== 'HEAD') names.add(current);
  for (const name of lists.lockedLocal ?? []) {
    const trimmed = String(name ?? '').trim();
    if (trimmed) names.add(trimmed);
  }
  return names;
}

/**
 * Whether a select value is already checked out (this tree or another worktree).
 * @param {string} value
 * @param {GitRefBranchLists} lists
 * @returns {boolean}
 */
export function isCheckoutUnavailable(value, lists) {
  const blocked = unavailableCheckoutNames(lists);
  const trimmed = String(value ?? '').trim();
  if (blocked.has(trimmed)) return true;
  if (isListedRemoteRef(trimmed, lists.remote ?? [])) {
    return blocked.has(shortLocalNameFromRemote(trimmed));
  }
  return false;
}

/**
 * Default start-from / check-out ref: current branch, then trunk, then first usable.
 * @param {GitRefBranchLists} lists
 * @param {{ forCheckout?: boolean }} [options]
 * @returns {string}
 */
export function pickDefaultStartPoint(lists, options = {}) {
  const forCheckout = Boolean(options.forCheckout);
  const local = lists.local ?? [];
  const locked = lists.lockedLocal ?? [];
  const remote = lists.remote ?? [];
  const current = String(lists.current ?? '').trim();

  if (!forCheckout && current && current !== 'HEAD') return current;

  const blocked = forCheckout ? unavailableCheckoutNames(lists) : new Set();

  for (const name of ['main', 'master']) {
    if (blocked.has(name)) continue;
    if (local.includes(name) || locked.includes(name)) return name;
  }

  for (const name of local) {
    const trimmed = String(name ?? '').trim();
    if (trimmed && !blocked.has(trimmed)) return trimmed;
  }

  if (!forCheckout) {
    for (const name of locked) {
      const trimmed = String(name ?? '').trim();
      if (trimmed) return trimmed;
    }
  }

  for (const entry of remote) {
    if (isSkippedRemoteRef(entry)) continue;
    const display = displayRemoteRef(entry);
    if (forCheckout && isCheckoutUnavailable(display, lists)) continue;
    if (display) return display;
  }

  return forCheckout ? '' : 'HEAD';
}
