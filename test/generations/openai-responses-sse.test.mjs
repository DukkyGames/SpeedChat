/**
 * Responses SSE → OpenAI chat-completion SSE.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createResponsesSseTranslator } from '../../server/generations/openai-responses/sse-to-openai.js';

function parseDataLines(sse) {
  return sse
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload));
}

describe('createResponsesSseTranslator', () => {
  test('maps text, reasoning, and tool-call deltas', () => {
    const translator = createResponsesSseTranslator();
    const fixture = [
      'event: response.reasoning_summary_text.delta',
      'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"ping","arguments":""}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{}"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}',
      '',
    ].join('\n');

    const parts = [...translator.push(fixture), ...translator.finish()];
    const joined = parts.join('');
    const chunks = parseDataLines(joined);

    assert.equal(chunks[0].choices[0].delta.reasoning, 'think');
    assert.equal(chunks[1].choices[0].delta.content, 'Hello');
    assert.equal(chunks[2].choices[0].delta.tool_calls[0].id, 'call_1');
    assert.equal(chunks[2].choices[0].delta.tool_calls[0].function.name, 'ping');
    assert.equal(chunks[3].choices[0].delta.tool_calls[0].function.arguments, '{}');
    assert.equal(chunks[4].choices[0].finish_reason, 'tool_calls');
    assert.equal(chunks[4].usage.prompt_tokens, 2);
    assert.ok(joined.endsWith('data: [DONE]\n\n'));
  });
});
