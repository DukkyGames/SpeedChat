/**
 * Completion POST URL for Chat Completions vs OpenAI Responses (OpenCode Go).
 */

import { deriveResponsesPathFromChat } from '../../../src/lib/derive-messages-path.mjs';
import { shouldUseOpenAiResponses } from '../../../src/lib/openai-responses-route.mjs';
import { resolveOpenCodeZenUpstreamUrl } from '../../providers/opencode-zen.js';

/**
 * Resolve `/v1/responses` next to a chat completions path.
 *
 * @param {string} baseUrl
 * @param {string} chatCompletionsPath
 * @returns {string}
 */
export function resolveOpenAiResponsesUpstreamUrl(baseUrl, chatCompletionsPath) {
  return resolveOpenCodeZenUpstreamUrl(baseUrl, deriveResponsesPathFromChat(chatCompletionsPath));
}

/**
 * Chat completions URL, or Responses when this OpenCode Go model requires it.
 *
 * @param {string} baseUrl
 * @param {string} chatCompletionsPath
 * @param {string} modelId
 * @returns {string}
 */
export function resolveCompatibleCompletionUrl(baseUrl, chatCompletionsPath, modelId) {
  if (shouldUseOpenAiResponses(baseUrl, modelId)) {
    return resolveOpenAiResponsesUpstreamUrl(baseUrl, chatCompletionsPath);
  }
  return resolveOpenCodeZenUpstreamUrl(baseUrl, chatCompletionsPath);
}
