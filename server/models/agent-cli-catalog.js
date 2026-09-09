import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLAUDE_CODE_CLI_ID,
  CODEX_CLI_ID,
  CURSOR_AGENT_CLI_ID,
} from '../../src/models/runtime-ids.mjs';

const CURSOR_INSTALL_POSIX = 'curl https://cursor.com/install -fsS | bash';
const CURSOR_INSTALL_POWERSHELL = "irm 'https://cursor.com/install?win32=true' | iex";
const CURSOR_INSTALL_CMD =
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm \'https://cursor.com/install?win32=true\' | iex"';

export const AGENT_CLI_DEFINITIONS = Object.freeze({
  claude: Object.freeze({
    kind: 'claude',
    providerId: CLAUDE_CODE_CLI_ID,
    label: 'Claude Code',
    command: 'claude',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    versionArgs: ['--version'],
    authArgs: ['auth', 'status', '--json'],
  }),
  codex: Object.freeze({
    kind: 'codex',
    providerId: CODEX_CLI_ID,
    label: 'Codex CLI',
    command: 'codex',
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex -c cli_auth_credentials_store=file login',
    versionArgs: ['--version'],
    authArgs: ['-c', 'cli_auth_credentials_store=file', 'login', 'status'],
  }),
  cursor: Object.freeze({
    kind: 'cursor',
    providerId: CURSOR_AGENT_CLI_ID,
    label: 'Cursor Agent',
    command: 'cursor-agent',
    installCommand: CURSOR_INSTALL_POSIX,
    loginCommand: 'cursor-agent login',
    versionArgs: ['--version'],
    authArgs: ['status'],
  }),
});

function isPowerShellShell(shell) {
  return /\b(?:pwsh|powershell)(?:\.exe)?$/i.test(shell ?? '');
}

function isCmdShell(shell) {
  return /\bcmd(?:\.exe)?$/i.test(shell ?? '');
}

/**
 * Official vendor install one-liner for the given CLI and shell.
 * Cursor's curl installer is POSIX-only; native Windows needs PowerShell.
 * @param {string} kind
 * @param {{ platform?: NodeJS.Platform, shell?: string }} [options]
 */
export function getAgentCliInstallCommand(kind, options = {}) {
  const definition = getAgentCliDefinition(kind);
  if (definition.kind !== 'cursor') return definition.installCommand;
  const shell = options.shell;
  if (isPowerShellShell(shell)) return CURSOR_INSTALL_POWERSHELL;
  if (isCmdShell(shell)) return CURSOR_INSTALL_CMD;
  const platform = options.platform ?? process.platform;
  if (!shell && platform === 'win32') return CURSOR_INSTALL_POWERSHELL;
  return CURSOR_INSTALL_POSIX;
}

const PROVIDER_TO_KIND = new Map(
  Object.values(AGENT_CLI_DEFINITIONS).map((definition) => [definition.providerId, definition.kind]),
);

/** @param {unknown} kind */
export function getAgentCliDefinition(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(AGENT_CLI_DEFINITIONS, kind)) {
    throw new Error('Invalid agent CLI kind');
  }
  return AGENT_CLI_DEFINITIONS[kind];
}

/** @param {unknown} providerId */
export function agentCliKindForProviderId(providerId) {
  return typeof providerId === 'string' ? PROVIDER_TO_KIND.get(providerId) ?? null : null;
}

const CATALOGS = Object.freeze({
  claude: Object.freeze([
    Object.freeze({ id: 'sonnet', max_context_length: 200_000, reasoning: 'adaptive' }),
    Object.freeze({ id: 'opus', max_context_length: 200_000, reasoning: 'adaptive' }),
    Object.freeze({ id: 'haiku', max_context_length: 200_000, reasoning: 'none' }),
  ]),
  codex: Object.freeze([
    Object.freeze({ id: 'gpt-5.3-codex', max_context_length: 400_000, reasoning: 'adaptive' }),
  ]),
  cursor: Object.freeze([
    Object.freeze({ id: 'auto', max_context_length: 200_000, reasoning: 'none' }),
  ]),
});

const REASONING = Object.freeze({
  claude: Object.freeze({ allowed_options: ['off', 'low', 'medium', 'high', 'max'], default: 'high' }),
  codex: Object.freeze({ allowed_options: ['off', 'low', 'medium', 'high', 'max'], default: 'medium' }),
  cursor: Object.freeze({ allowed_options: [], default: 'off' }),
});

/**
 * Static, subscription-free model rows. This function never starts a CLI process.
 * @param {string} providerId
 */
export function listAgentCliModels(providerId) {
  const kind = agentCliKindForProviderId(providerId);
  if (!kind) throw new Error('Not an agent CLI provider');
  return CATALOGS[kind].map((entry) => ({
    ...entry,
    type: 'llm',
    state: 'loaded',
    owned_by: kind === 'claude' ? 'anthropic' : kind === 'codex' ? 'openai' : 'cursor',
    api: 'agent-cli-v1',
    catalogVision: kind === 'claude',
    reasoning: entry.reasoning === 'adaptive' ? REASONING[kind] : REASONING.cursor,
  }));
}

const MINNOW_REASONING_OPTIONS = new Set(['off', 'low', 'medium', 'high', 'max']);

/** @param {unknown} raw */
function normalizeCodexReasoning(raw) {
  if (!Array.isArray(raw)) return REASONING.codex;
  const options = raw
    .map((entry) => typeof entry === 'string' ? entry : entry?.effort)
    .map((value) => value === 'xhigh' ? 'max' : value)
    .filter((value) => typeof value === 'string' && MINNOW_REASONING_OPTIONS.has(value));
  const allowed_options = [...new Set(['off', ...options])];
  return {
    allowed_options: allowed_options.length > 1 ? allowed_options : REASONING.codex.allowed_options,
    default: allowed_options.includes('medium') ? 'medium' : allowed_options[1] ?? 'off',
  };
}

/**
 * Enrich Codex from its own model-metadata cache. Reading this file does not access auth data
 * or invoke the CLI, and unavailable/corrupt caches fall back to the shipped catalog.
 * @param {string} providerId
 * @param {{ env?: NodeJS.ProcessEnv, homeDir?: string }} [options]
 */
export async function listAgentCliModelsWithConfig(providerId, options = {}) {
  const staticRows = listAgentCliModels(providerId);
  if (providerId !== CODEX_CLI_ID) return staticRows;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const codexHome = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim()
    ? env.CODEX_HOME.trim()
    : path.join(homeDir, '.codex');
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(codexHome, 'models_cache.json'), 'utf8'));
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    const rows = models
      .filter((model) => model && typeof model === 'object' && model.visibility !== 'hide')
      .map((model) => {
        const id = typeof model.slug === 'string' ? model.slug.trim() : '';
        if (!id) return null;
        const context = Number(model.context_window);
        return {
          id,
          type: 'llm',
          state: 'loaded',
          owned_by: 'openai',
          api: 'agent-cli-v1',
          catalogVision: false,
          ...(Number.isFinite(context) && context > 0 ? { max_context_length: context } : {}),
          reasoning: normalizeCodexReasoning(model.supported_reasoning_levels),
          ...(Number.isFinite(model.priority) ? { priority: model.priority } : {}),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.id.localeCompare(b.id))
      .map(({ priority: _priority, ...row }) => row);
    return rows.length > 0 ? rows : staticRows;
  } catch {
    return staticRows;
  }
}

/** @param {Array<Record<string, any>>} rows */
function capabilityPatchesForRows(rows) {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        vision: row.catalogVision,
        tools: true,
        streaming: true,
        grammar: false,
        reasoning: row.reasoning.allowed_options.length > 0,
        contextLength: row.max_context_length,
        loadState: 'loaded',
        api: 'agent-cli-v1',
        sources: {
          vision: 'catalog',
          tools: 'assumed',
          streaming: 'assumed',
          grammar: 'assumed',
          reasoning: 'catalog',
          contextLength: 'catalog',
          loadState: 'catalog',
        },
        probeErrors: {},
      },
    ]),
  );
}

/** Static fallback patches for callers that cannot read the Codex model cache. */
export function agentCliCapabilityPatches(providerId) {
  return capabilityPatchesForRows(listAgentCliModels(providerId));
}

/** Model-specific patches, including cheap Codex cache metadata when available. */
export async function agentCliCapabilityPatchesWithConfig(providerId, options = {}) {
  return capabilityPatchesForRows(await listAgentCliModelsWithConfig(providerId, options));
}
