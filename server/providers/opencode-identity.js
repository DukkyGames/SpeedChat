/**
 * OpenCode Go routing identity (https://opencode.ai/docs/go/#where-can-i-use-it).
 *
 * Go expects coding-agent traffic that:
 * 1. Sends a product User-Agent, not undici / ai-sdk / node-fetch
 * 2. Sends a stable conversation id in x-opencode-session (prompt cache + routing)
 *
 * Applied to every opencode.ai host (Go and Zen share the gateway).
 */

import { createRequire } from 'node:module';
import { isOpenCodeProviderBaseUrl } from './models-dev-context.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/** Product User-Agent OpenCode can distinguish from generic HTTP libraries. */
export const MINNOW_OPENCODE_USER_AGENT = `Minnow/${version}`;

export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/** Stable id for GET /models — not a chat, but still identifies auxiliary traffic. */
export const OPENCODE_SESSION_CATALOG = 'minnow-catalog';

/** Stable id for capability-probe completions. */
export const OPENCODE_SESSION_PROBE = 'minnow-probe';

/**
 * Conversation id for one OpenCode generation.
 * Prefers the Minnow chat id so follow-up turns share a cache key.
 *
 * @param {{ chatId?: string | null, id?: string } | null | undefined} state
 * @returns {string}
 */
export function openCodeSessionIdForGeneration(state) {
  if (!state || typeof state !== 'object') return '';
  const chatId = typeof state.chatId === 'string' ? state.chatId.trim() : '';
  if (chatId) return chatId;
  const generationId = typeof state.id === 'string' ? state.id.trim() : '';
  return generationId;
}

/**
 * Copy headers and, for OpenCode hosts, stamp User-Agent and optional session.
 * Identity headers win over profile customHeaders / SDK defaults.
 *
 * @param {Record<string, string> | undefined | null} headers
 * @param {{ baseUrl?: string | null, sessionId?: string | null }} [options]
 * @returns {Record<string, string>}
 */
export function mergeOpenCodeIdentityHeaders(headers, options = {}) {
  const next = headers && typeof headers === 'object' ? { ...headers } : {};
  if (!isOpenCodeProviderBaseUrl(options.baseUrl)) return next;

  next['User-Agent'] = MINNOW_OPENCODE_USER_AGENT;
  const sessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
  if (sessionId) {
    next[OPENCODE_SESSION_HEADER] = sessionId;
  }
  return next;
}
