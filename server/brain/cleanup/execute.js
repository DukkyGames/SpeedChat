/**
 * Server-side Brain wiki cleanup execution — trusted agent loop over an approved plan.
 */

import { randomUUID } from 'node:crypto';
import { llmCallDeps, extractCompletionText } from '../../research/llm.js';
import {
  chatCompletionBodyToResponses,
  responsesJsonToOpenAiCompletion,
} from '../../generations/openai-responses/chat-to-responses.js';
import { resolveCompatibleCompletionUrl } from '../../generations/openai-responses/url.js';
import { shouldUseOpenAiResponses } from '../../../src/lib/openai-responses-route.mjs';
import {
  mergeOpenCodeIdentityHeaders,
  OPENCODE_SESSION_PROBE,
} from '../../providers/opencode-identity.js';
import { pruneWeakSimilarLinks } from '../lint.js';
import { applyAnchorDrift } from '../code/anchors.js';
import { loadCleanupPlan } from './persist.js';
import {
  toolBrainList,
  toolBrainReadPage,
  toolBrainSearch,
  toolBrainWritePage,
  toolManageBrain,
} from '../../tools/brain-tools.js';

/** Hard cap on model↔tool round trips. */
export const MAX_CLEANUP_TOOL_ROUNDS = 25;
/** Wall-clock budget for the whole execute run. */
export const CLEANUP_EXECUTE_TIMEOUT_MS = 8 * 60_000;
/** Per-completion timeout. */
const COMPLETION_TIMEOUT_MS = 120_000;

/** Injectable deps for tests. */
export const executeCleanupDeps = {
  getProviderRuntime: llmCallDeps.getProviderRuntime,
  fetchFn: llmCallDeps.fetchFn,
};

const SYSTEM_PROMPT = `You are a trusted Minnow server agent executing an approved Brain wiki cleanup plan.

Rules:
- Follow ONLY the plan markdown the user message provides. Do not expand scope.
- Make minimal edits required to complete each plan step.
- Read pages before rewriting them.
- For deletions, use manage_brain with action delete_page (confirmation is handled server-side).
- For bulk weak similarTo cleanup, call prune_weak_similar_links once when the plan calls for it.
- For anchor drift remediation, call apply_anchor_drift when the plan calls for it.
- When all plan steps are done, call cleanup_complete with a short summary.`;

/** OpenAI-style tool definitions exposed to the cleanup agent. */
const CLEANUP_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'brain_list',
      description: 'List wiki page tree metadata.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brain_read_page',
      description: 'Read one wiki page by path or id.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path under pages/ or page id' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brain_search',
      description: 'Hybrid search over wiki pages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brain_write_page',
      description: 'Create or update a wiki page.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['path', 'title', 'body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_brain',
      description: 'Delete a single wiki page (delete_page only).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['delete_page'] },
          path: { type: 'string' },
        },
        required: ['action', 'path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prune_weak_similar_links',
      description: 'Remove weak similarTo edges using current linking thresholds (writes).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_anchor_drift',
      description: 'Mark pages with drifted code anchors stale and queue resynthesis.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cleanup_complete',
      description: 'Signal that the cleanup plan is fully executed.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short completion summary' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * @typedef {{ message: string, tool?: string, path?: string }} CleanupLogEntry
 */

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw);
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ content: string, path?: string, done?: boolean, doneSummary?: string }>}
 */
async function dispatchCleanupTool(toolName, args) {
  const name = String(toolName ?? '').trim();

  if (name === 'brain_list') {
    const content = await toolBrainList(args);
    return { content };
  }
  if (name === 'brain_read_page') {
    const lookup = String(args.path ?? args.id ?? '').trim();
    const content = await toolBrainReadPage(args);
    return { content, path: lookup || undefined };
  }
  if (name === 'brain_search') {
    const content = await toolBrainSearch(args);
    return { content };
  }
  if (name === 'brain_write_page') {
    const relPath = String(args.path ?? '').trim();
    const content = await toolBrainWritePage(args);
    return { content, path: relPath || undefined };
  }
  if (name === 'manage_brain') {
    const action = String(args.action ?? '').trim();
    if (action !== 'delete_page') {
      return {
        content: `Error: only delete_page is allowed during cleanup execute (got "${action}").`,
      };
    }
    const relPath = String(args.path ?? '').trim();
    const content = await toolManageBrain({
      action: 'delete_page',
      path: relPath,
      confirmed: true,
    });
    return { content, path: relPath || undefined };
  }
  if (name === 'prune_weak_similar_links') {
    const report = await pruneWeakSimilarLinks({ dryRun: false });
    const content = JSON.stringify({
      applied: report.applied.length,
      removals: report.removals.length,
      edgesScanned: report.edgesScanned,
    });
    return { content };
  }
  if (name === 'apply_anchor_drift') {
    const applied = await applyAnchorDrift();
    const content = JSON.stringify({
      pagesMarked: applied.length,
      paths: applied.map((row) => row.path),
    });
    return { content };
  }
  if (name === 'cleanup_complete') {
    const summary = String(args.summary ?? '').trim() || 'Cleanup complete.';
    return { content: summary, done: true, doneSummary: summary };
  }

  return { content: `Error: tool "${name}" is not available in cleanup execute.` };
}

/**
 * @param {AbortSignal} signal
 * @param {number} timeoutMs
 */
function composeTimeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * @param {{
 *   providerId: string,
 *   model: string,
 *   messages: Array<Record<string, unknown>>,
 *   signal: AbortSignal,
 * }} params
 */
async function postChatCompletionWithTools({ providerId, model, messages, signal }) {
  const runtime = await executeCleanupDeps.getProviderRuntime(providerId);
  const url = resolveCompatibleCompletionUrl(
    runtime.profile.baseUrl,
    runtime.paths.chatCompletionsPath,
    model,
  );
  const chatBody = {
    model,
    messages,
    tools: CLEANUP_AGENT_TOOLS,
    tool_choice: 'auto',
    temperature: 0.2,
    max_tokens: 4096,
    stream: false,
  };
  const body = shouldUseOpenAiResponses(runtime.profile.baseUrl, model)
    ? chatCompletionBodyToResponses(chatBody)
    : chatBody;
  const { signal: completionSignal, cleanup } = composeTimeoutSignal(signal, COMPLETION_TIMEOUT_MS);
  try {
    const response = await executeCleanupDeps.fetchFn(url, {
      method: 'POST',
      headers: mergeOpenCodeIdentityHeaders(
        {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...runtime.headers,
        },
        { baseUrl: url, sessionId: OPENCODE_SESSION_PROBE },
      ),
      body: JSON.stringify(body),
      signal: completionSignal,
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const err = new Error(raw || `Upstream HTTP ${response.status}`);
      /** @type {Error & { status?: number }} */ (err).status = response.status;
      throw err;
    }
    const data = await response.json();
    const openaiShaped = Array.isArray(data?.choices)
      ? data
      : responsesJsonToOpenAiCompletion(data, model);
    const choices = /** @type {{ choices?: Array<{ message?: Record<string, unknown>, finish_reason?: string }> }} */ (
      openaiShaped
    ).choices;
    const first = choices?.[0];
    const message = first?.message ?? {};
    const text = extractCompletionText(openaiShaped);
    return {
      message,
      text,
      finishReason: first?.finish_reason ?? '',
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    };
  } finally {
    cleanup();
  }
}

/**
 * @param {string} planMarkdown
 * @returns {string}
 */
function buildUserPrompt(planMarkdown) {
  return [
    'Execute the following approved cleanup plan. Work step by step.',
    '',
    '---',
    planMarkdown.trim(),
    '---',
  ].join('\n');
}

/**
 * Run the cleanup agent for a persisted plan.
 * @param {{
 *   planId: string,
 *   providerId: string,
 *   modelId: string,
 *   signal?: AbortSignal,
 * }} input
 */
export async function executeBrainCleanup(input) {
  const planId = String(input.planId ?? '').trim();
  const providerId = String(input.providerId ?? '').trim();
  const modelId = String(input.modelId ?? '').trim();

  if (!planId) {
    const err = new Error('planId is required');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }
  if (!providerId || !modelId) {
    const err = new Error('providerId and modelId are required');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }

  const plan = await loadCleanupPlan(planId);
  /** @type {CleanupLogEntry[]} */
  const log = [];
  const pushLog = (entry) => {
    log.push(entry);
  };

  pushLog({ message: `Loaded cleanup plan ${plan.planId}.` });

  const { signal: runSignal, cleanup: cleanupRunTimeout } = composeTimeoutSignal(
    input.signal,
    CLEANUP_EXECUTE_TIMEOUT_MS,
  );

  /** @type {Array<Record<string, unknown>>} */
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(plan.planMarkdown) },
  ];

  let rounds = 0;
  let finalSummary = '';
  let status = 'completed';

  try {
    while (rounds < MAX_CLEANUP_TOOL_ROUNDS) {
      if (runSignal.aborted) {
        status = 'timeout';
        pushLog({ message: 'Execute timed out or was aborted.' });
        break;
      }

      const completion = await postChatCompletionWithTools({
        providerId,
        model: modelId,
        messages,
        signal: runSignal,
      });

      const assistantMsg = {
        role: 'assistant',
        content: completion.text || null,
        ...(completion.toolCalls.length > 0 ? { tool_calls: completion.toolCalls } : {}),
      };
      messages.push(assistantMsg);

      if (completion.toolCalls.length === 0) {
        finalSummary = String(completion.text ?? '').trim() || 'Cleanup agent finished without tool calls.';
        pushLog({ message: finalSummary });
        break;
      }

      let finished = false;
      for (const call of completion.toolCalls) {
        const callId = String(call.id ?? randomUUID());
        const fn = call.function ?? call;
        const toolName = String(fn.name ?? '').trim();
        const args = parseToolArgs(fn.arguments);

        pushLog({
          message: `Tool call: ${toolName}`,
          tool: toolName,
          path: typeof args.path === 'string' ? args.path : undefined,
        });

        const outcome = await dispatchCleanupTool(toolName, args);
        if (outcome.path) {
          const last = log[log.length - 1];
          if (last) last.path = outcome.path;
        }

        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: outcome.content,
        });

        if (outcome.done) {
          finished = true;
          finalSummary = outcome.doneSummary ?? outcome.content;
          pushLog({ message: finalSummary });
        }
      }

      rounds += 1;
      if (finished) break;
    }

    if (rounds >= MAX_CLEANUP_TOOL_ROUNDS && status === 'completed' && !finalSummary) {
      status = 'stopped';
      finalSummary = `Stopped after ${MAX_CLEANUP_TOOL_ROUNDS} tool rounds.`;
      pushLog({ message: finalSummary });
    }
  } catch (err) {
    status = 'error';
    const message = err instanceof Error ? err.message : String(err);
    finalSummary = message;
    pushLog({ message: `Execute failed: ${message}` });
  } finally {
    cleanupRunTimeout();
  }

  return {
    ok: status === 'completed',
    planId: plan.planId,
    status,
    log,
    result: {
      summary: finalSummary,
      rounds,
    },
  };
}
