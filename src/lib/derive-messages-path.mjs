/**
 * Derive Anthropic Messages API path from the configured chat completions path.
 * E.g. `/zen/v1/chat/completions` → `/zen/v1/messages`, `/v1/chat/completions` → `/v1/messages`.
 *
 * @param {string} chatCompletionsPath
 * @returns {string}
 */
export function deriveMessagesPathFromChat(chatCompletionsPath) {
  const chat = String(chatCompletionsPath || '/v1/chat/completions').trim();
  if (!chat.startsWith('/')) {
    return '/v1/messages';
  }
  if (chat.endsWith('/messages')) {
    return chat;
  }
  if (chat.endsWith('/chat/completions')) {
    return `${chat.slice(0, -'/chat/completions'.length)}/messages`;
  }
  const lastSlash = chat.lastIndexOf('/');
  if (lastSlash > 0) {
    return `${chat.slice(0, lastSlash)}/messages`;
  }
  return '/v1/messages';
}

/**
 * Derive OpenAI Responses API path from the configured chat completions path.
 * E.g. `/zen/go/v1/chat/completions` → `/zen/go/v1/responses`, `/v1/chat/completions` → `/v1/responses`.
 *
 * @param {string} chatCompletionsPath
 * @returns {string}
 */
export function deriveResponsesPathFromChat(chatCompletionsPath) {
  const chat = String(chatCompletionsPath || '/v1/chat/completions').trim();
  if (!chat.startsWith('/')) {
    return '/v1/responses';
  }
  if (chat.endsWith('/responses')) {
    return chat;
  }
  if (chat.endsWith('/chat/completions')) {
    return `${chat.slice(0, -'/chat/completions'.length)}/responses`;
  }
  const lastSlash = chat.lastIndexOf('/');
  if (lastSlash > 0) {
    return `${chat.slice(0, lastSlash)}/responses`;
  }
  return '/v1/responses';
}
