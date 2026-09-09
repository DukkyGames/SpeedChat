/**
 * Child env for spawning bundled Impeccable scripts via process.execPath.
 * Packaged Electron must set ELECTRON_RUN_AS_NODE so the child is Node, not a
 * second app instance (which would open the script path as a workspace).
 */

import { applyNodeRuntimeEnv } from '../lsp/node-runtime.js';

/**
 * Env for impeccable CLI / context-loader children.
 * @param {string} workspaceRoot Active workspace (IMPECCABLE_CONTEXT_DIR)
 * @returns {NodeJS.ProcessEnv}
 */
export function buildImpeccableSpawnEnv(workspaceRoot) {
  return applyNodeRuntimeEnv(
    { ...process.env, IMPECCABLE_CONTEXT_DIR: workspaceRoot },
    process.execPath,
  );
}
