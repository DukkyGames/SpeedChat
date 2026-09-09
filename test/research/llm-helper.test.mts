/**
 * Deep Research LLM helper — runtime resolve, timeout, retry, strip-thinking.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { getProviderRuntime } from '../../server/providers/store.js';
import { llmCallDeps } from '../../server/research/llm.js';

const MOCK_RUNTIME = {
  profile: { baseUrl: 'http://mock-provider.test' },
  paths: { chatCompletionsPath: '/v1/chat/completions' },
  headers: { Authorization: 'Bearer test-key' },
};

/** Build a JSON completion body for mocked fetch. */
function completionBody(content: string, extra?: { reasoning_content?: string }) {
  return {
    choices: [
      {
        message: {
          content,
          ...extra,
        },
      },
    ],
  };
}

describe('llmCall', () => {
  const originalFetch = globalThis.fetch;
  let runtimeCalls = 0;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    llmCallDeps.fetchFn = fetch;
    llmCallDeps.getProviderRuntime = getProviderRuntime;
    runtimeCalls = 0;
  });

  function installMockRuntime() {
    llmCallDeps.getProviderRuntime = async () => {
      runtimeCalls += 1;
      return MOCK_RUNTIME;
    };
  }

  test('resolves provider runtime and returns stripped content', async () => {
    installMockRuntime();

    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    llmCallDeps.fetchFn = (async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response(
        JSON.stringify(
          completionBody('<think>planning</think>Final answer'),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    const result = await llmCall({
      providerId: 'lm-studio-local',
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    assert.equal(runtimeCalls, 1);
    assert.equal(seenUrl, 'http://mock-provider.test/v1/chat/completions');
    assert.equal(result, 'Final answer');

    const body = JSON.parse(String(seenInit?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    assert.equal(body.temperature, 0.3);
    assert.equal(body.max_tokens, 4096);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
  });

  test('posts Muse Spark on OpenCode Go to /v1/responses', async () => {
    llmCallDeps.getProviderRuntime = async () => ({
      profile: { baseUrl: 'https://opencode.ai/zen/go' },
      paths: { chatCompletionsPath: '/v1/chat/completions' },
      headers: { Authorization: 'Bearer test-key' },
    });

    let seenUrl = '';
    let seenBody: Record<string, unknown> | undefined;
    llmCallDeps.fetchFn = (async (input, init) => {
      seenUrl = String(input);
      seenBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          object: 'response',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'spark ok' }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    const result = await llmCall({
      providerId: 'opencode-go',
      model: 'muse-spark-1.3-contributor',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    assert.equal(seenUrl, 'https://opencode.ai/zen/go/v1/responses');
    assert.equal(result, 'spark ok');
    assert.equal(seenBody?.stream, false);
    assert.equal(seenBody?.messages, undefined);
    assert.equal(
      (seenBody?.input as Array<{ content?: string }>)[0].content,
      'Hello',
    );
  });

  test('falls back to reasoning_content when content is empty', async () => {
    installMockRuntime();

    llmCallDeps.fetchFn = (async () =>
      new Response(JSON.stringify(completionBody('', { reasoning_content: 'reasoned' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    const result = await llmCall({
      providerId: 'lm-studio-local',
      model: 'test-model',
      messages: [{ role: 'user', content: 'x' }],
    });

    assert.equal(result, 'reasoned');
  });

  test('retries once on transient HTTP failure then succeeds', async () => {
    installMockRuntime();

    let calls = 0;
    llmCallDeps.fetchFn = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', { status: 503 });
      }
      return new Response(JSON.stringify(completionBody('ok after retry')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    const result = await llmCall({
      providerId: 'lm-studio-local',
      model: 'test-model',
      messages: [{ role: 'user', content: 'retry me' }],
    });

    assert.equal(calls, 2);
    assert.equal(result, 'ok after retry');
  });

  test('does not retry on non-retryable HTTP errors', async () => {
    installMockRuntime();

    let calls = 0;
    llmCallDeps.fetchFn = (async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    }) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    await assert.rejects(
      () =>
        llmCall({
          providerId: 'lm-studio-local',
          model: 'test-model',
          messages: [{ role: 'user', content: 'fail' }],
        }),
      /Upstream HTTP 400/,
    );
    assert.equal(calls, 1);
  });

  test('aborts when timeoutMs elapses', async () => {
    installMockRuntime();

    llmCallDeps.fetchFn = (async (_input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const signal = init?.signal;
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return new Response(JSON.stringify(completionBody('late')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const { llmCall } = await import('../../server/research/llm.js');
    await assert.rejects(
      () =>
        llmCall({
          providerId: 'lm-studio-local',
          model: 'test-model',
          messages: [{ role: 'user', content: 'slow' }],
          timeoutMs: 30,
        }),
      (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
    );
  });

  test('honours an external AbortSignal', async () => {
    installMockRuntime();

    llmCallDeps.fetchFn = (async (_input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return new Response(JSON.stringify(completionBody('never')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const controller = new AbortController();
    const { llmCall } = await import('../../server/research/llm.js');
    const pending = llmCall({
      providerId: 'lm-studio-local',
      model: 'test-model',
      messages: [{ role: 'user', content: 'cancel' }],
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(
      pending,
      (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
    );
  });
});

describe('extractCompletionText', () => {
  test('reads assistant message content', async () => {
    const { extractCompletionText } = await import('../../server/research/llm.js');
    assert.equal(
      extractCompletionText(completionBody('hello')),
      'hello',
    );
  });

  test('reads Responses output_text via output items', async () => {
    const { extractCompletionText } = await import('../../server/research/llm.js');
    assert.equal(
      extractCompletionText({
        object: 'response',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'from responses' }],
          },
        ],
      }),
      'from responses',
    );
  });
});
