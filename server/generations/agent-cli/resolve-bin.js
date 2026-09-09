/** Resolve an agent CLI executable without invoking a shell. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyNodeRuntimeEnv } from '../../lsp/node-runtime.js';

const execFileAsync = promisify(execFile);

const DEFAULT_BINS = Object.freeze({
  claude: 'claude',
  codex: 'codex',
  'cursor-agent': 'cursor-agent',
});

function assertKind(kind) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_BINS, kind)) {
    throw new Error(`Unsupported agent CLI: ${String(kind)}`);
  }
}

/**
 * Resolve a configured CLI to a shell-free command and argv prefix.
 * Windows npm shims are converted to their node script when possible.
 * @param {{ kind: 'claude'|'codex'|'cursor-agent', binPath?: string }} input
 * @returns {Promise<{ command: string, argsPrefix: string[], display: string }>}
 */
export async function resolveAgentCliBin(input) {
  assertKind(input.kind);
  const configured = typeof input.binPath === 'string' ? input.binPath.trim() : '';
  let requested = configured || (
    process.platform === 'win32'
      ? await findAgentCliOnPath(input.kind) || DEFAULT_BINS[input.kind]
      : DEFAULT_BINS[input.kind]
  );
  if (configured && !path.isAbsolute(requested) && !/[\\/]/.test(requested)) {
    const fromPath = await findCommandOnPath(requested);
    if (!fromPath) throw new Error(`Agent CLI is not on PATH: ${requested}`);
    requested = fromPath;
  }
  if (process.platform !== 'win32' || !requested.toLowerCase().endsWith('.cmd')) {
    return { command: requested, argsPrefix: [], display: requested };
  }

  return resolveWindowsCmdShim(requested);
}

/** Convert an npm-generated Windows command shim to a shell-free Node invocation. */
export async function resolveWindowsCmdShim(requested) {
  const shim = path.resolve(requested);
  const text = await fs.readFile(shim, 'utf8').catch(() => null);
  if (!text) {
    throw new Error(`Agent CLI shim is not readable: ${requested}`);
  }
  // npm's generated shims vary: some invoke node directly, while newer ones
  // assign `%_prog%` and invoke `%~dp0\node_modules\…js`. Never execute the
  // shim through cmd; extract only a script path rooted beside the shim.
  const match =
    text.match(/"%~dp0%?[\\/]([^"\r\n]+\.[cm]?js)"?/i) ??
    text.match(/(?:node(?:\.exe)?|%_prog%)\s+"?([^"\r\n]+\.[cm]?js)"?/i);
  if (!match?.[1]) {
    throw new Error(`Cannot resolve Windows CLI shim safely: ${requested}`);
  }
  const script = match[1].replace(/[\\/]/g, path.sep);
  const resolvedScript = path.isAbsolute(script)
    ? script
    : path.resolve(path.dirname(shim), script);
  await fs.access(resolvedScript);
  const command = process.execPath;
  return {
    command,
    argsPrefix: [resolvedScript],
    display: requested,
  };
}

/** Resolve a command on PATH for diagnostics without executing it. */
async function findCommandOnPath(command) {
  if (typeof command !== 'string' || !command.trim() || /[\0\r\n]/.test(command)) return null;
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', [command.trim()], {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 64 * 1024,
    });
    const matches = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // npm places an extensionless POSIX launcher beside its Windows .cmd shim.
    return (process.platform === 'win32' ? matches.find(file => /\.(?:exe|com|cmd)$/i.test(file)) : matches[0]) ?? null;
  } catch {
    return null;
  }
}

/** Resolve a known agent command on PATH for diagnostics without executing it. */
export async function findAgentCliOnPath(kind) {
  assertKind(kind);
  return findCommandOnPath(DEFAULT_BINS[kind]);
}

export function applyAgentNodeEnv(env, command) {
  return applyNodeRuntimeEnv(env, command);
}
