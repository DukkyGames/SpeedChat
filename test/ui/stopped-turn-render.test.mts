/**
 * renderChatFromHistory shows the stop on a turn cut short mid tool batch.
 *
 * Stop that lands after `round_end` has no partial prose to persist, so the flag
 * rides the assistant tool-call row instead. A row with prose chips its own bubble;
 * a tool-only row paints no bubble, so the label needs a row of its own.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { renderChatFromHistory } from '../../src/ui/messages.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, Message } from '../../src/types.ts';

function mountChatArea(): HTMLElement {
  document.body.replaceChildren();
  const viewport = document.createElement('div');
  viewport.className = 'chat-viewport';
  const area = document.createElement('main');
  area.id = 'chatArea';
  viewport.appendChild(area);
  document.body.appendChild(viewport);
  document.body.appendChild(
    Object.assign(document.createElement('div'), { id: 'mainColumn' }),
  );
  return area;
}

function seedChat(history: Message[]): Chat {
  const chat = createEmptyChatObject('m1', '/tmp/ws');
  chat.modeId = 'general';
  chat.history = history;
  setSessionStateForTests({
    version: 6,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

function stoppedToolTurn(prose: string | null): Message[] {
  return [
    { role: 'user', content: 'refactor auth' },
    {
      role: 'assistant',
      content: prose,
      stopped: true,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"auth.ts"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'export const a = 1;' },
  ];
}

describe('stopped turn render', () => {
  afterEach(() => {
    document.body.replaceChildren();
    setSessionStateForTests(null);
  });

  test('tool-call row with prose chips its own bubble', () => {
    const area = mountChatArea();
    renderChatFromHistory(seedChat(stoppedToolTurn('Reading the module first.')));

    const rows = area.querySelectorAll('.msg.assistant.msg--stopped');
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent ?? '', /Reading the module first/);
    assert.equal(
      rows[0].querySelector('.msg-stopped-chip')?.textContent,
      'Generation stopped',
    );
  });

  test('tool-only row gets a standalone label under the tool cards', () => {
    const area = mountChatArea();
    renderChatFromHistory(seedChat(stoppedToolTurn(null)));

    const marker = area.querySelector('.msg.assistant.msg--stopped');
    assert.ok(marker, 'stopped label should render for a tool-only round');
    assert.equal(
      marker.querySelector('.msg-stopped-chip')?.textContent,
      'Generation stopped',
    );
    const toolCard = area.querySelector('.tool-call-msg');
    assert.ok(toolCard, 'tool card should still render');
    assert.equal(
      toolCard.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING,
      Node.DOCUMENT_POSITION_FOLLOWING,
      'label sits after the tool card the stop cut short',
    );
    assert.equal(
      marker.querySelector('.tool-call-msg'),
      null,
      'label is its own row, not injected into the tool card',
    );
  });

  test('an unstopped tool turn paints no label', () => {
    const area = mountChatArea();
    const history = stoppedToolTurn('All good.');
    delete (history[1] as { stopped?: boolean }).stopped;
    renderChatFromHistory(seedChat(history));

    assert.equal(area.querySelector('.msg--stopped'), null);
  });
});
