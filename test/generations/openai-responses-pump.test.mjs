/**
 * Responses pump: /v1/responses 200 vs /v1/chat/completions 500 (MIN-855).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import http from 'node:http';
import { createGenerationState } from '../../server/generations/store.js';
import { pumpOpenAiResponsesUpstream } from '../../server/generations/openai-responses/pump.js';

/** @type {import('../../server/generations/store.js').GenerationState[]} */
const activeStates = [];

function chunksToString(state) {
  return Buffer.concat(state.chunks).toString('utf8');
}

afterEach(() => {
  for (const state of activeStates) {
    if (state.evictTimer) clearTimeout(state.evictTimer);
  }
  activeStates.length = 0;
});

describe('pumpOpenAiResponsesUpstream', () => {
  test('succeeds on /v1/responses while /v1/chat/completions returns 500', async () => {
    /** @type {string[]} */
    const postedPaths = [];
    let capturedBody = '';

    const server = http.createServer((req, res) => {
      postedPaths.push(`${req.method} ${req.url}`);
      if (req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = Buffer.concat(chunks).toString('utf8');
        if (req.url?.endsWith('/chat/completions')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
          return;
        }
        if (req.url?.endsWith('/responses')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
          );
          res.write(
            'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
          );
          res.end();
          return;
        }
        res.statusCode = 404;
        res.end('not found');
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const state = createGenerationState({
        providerId: 'opencode-go',
        body: {
          model: 'muse-spark-1.3-contributor',
          stream: true,
          messages: [
            { role: 'system', content: 'Be brief.' },
            { role: 'user', content: 'Hi' },
          ],
        },
        chatId: '11111111-1111-1111-1111-111111111111',
      });
      activeStates.push(state);

      const result = await pumpOpenAiResponsesUpstream({
        state,
        runtime: {
          profile: { baseUrl, apiKind: 'openai-v1' },
          paths: { chatCompletionsPath: '/v1/chat/completions' },
          headers: { Authorization: 'Bearer test' },
        },
        candidate: { providerId: 'opencode-go', modelId: 'muse-spark-1.3-contributor' },
        index: 0,
        idleMs: 15_000,
        maxMs: 30_000,
        canFailover: false,
      });

      assert.equal(result.outcome, 'complete');
      assert.equal(state.status, 'complete');
      assert.deepEqual(postedPaths, ['POST /v1/responses']);
      const wire = JSON.parse(capturedBody);
      assert.equal(wire.model, 'muse-spark-1.3-contributor');
      assert.equal(wire.instructions, 'Be brief.');
      assert.equal(wire.stream, true);
      assert.match(chunksToString(state), /"delta":\{"content":"ok"\}/);
      assert.match(chunksToString(state), /data: \[DONE\]/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
