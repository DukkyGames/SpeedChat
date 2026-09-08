/**
 * Reset / Rewind cascade: which cards a wipe touches, with no I/O.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { derive } from '../../server/orchestrator/core/derive.js';
import {
  hasRunDebris,
  resetTargets,
  rewindCascade,
} from '../../server/orchestrator/core/rewind.js';

function journal(...events) {
  return events.map((e, i) => ({ ...e, seq: i + 1, ts: 1_700_000_000_000 + i }));
}

const TASKS = [
  { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a'], build: 'b', test: 't', accept: 'x' },
  { id: 'W1-B', title: 'B', wave: 1, dependsOn: [], touches: ['b'], build: 'b', test: 't', accept: 'x' },
  { id: 'W2-C', title: 'C', wave: 2, dependsOn: ['W1-A'], touches: ['c'], build: 'b', test: 't', accept: 'x' },
];

const created = () =>
  makeEvent('board.created', {
    boardId: 'b1',
    planPath: 'plan.md',
    name: 'demo',
    tasks: TASKS,
    waves: [{ n: 1, name: 'One' }, { n: 2, name: 'Two' }],
  });

describe('resetTargets', () => {
  it('refuses a merged card', () => {
    const events = journal(
      created(),
      makeEvent('merge.succeeded', { taskId: 'W1-A', sha: 'sha-a', beforeSha: 'sha-0' }),
    );
    const state = derive(events);
    const result = resetTargets(state, 'W1-A');
    assert.equal(result.ok, false);
    assert.match(result.error, /Rewind/);
  });

  it('includes skipped dependents blocked by the card', () => {
    const events = journal(
      created(),
      makeEvent('task.abandoned', { taskId: 'W1-A', reason: 'builder-failed-twice' }),
      makeEvent('task.skipped', { taskId: 'W2-C', blockedBy: 'W1-A' }),
    );
    const state = derive(events);
    const result = resetTargets(state, 'W1-A');
    assert.equal(result.ok, true);
    assert.deepEqual(result.taskIds, ['W1-A', 'W2-C']);
  });

  it('hasRunDebris is false on a never-started idle card', () => {
    const state = derive(journal(created()));
    assert.equal(hasRunDebris(state, state.tasks.get('W1-A')), false);
    assert.equal(hasRunDebris(state, state.tasks.get('W1-B')), false);
  });

  it('hasRunDebris is true on an abandoned card', () => {
    const state = derive(
      journal(created(), makeEvent('task.abandoned', { taskId: 'W1-A', reason: 'user' })),
    );
    assert.equal(hasRunDebris(state, state.tasks.get('W1-A')), true);
    assert.equal(hasRunDebris(state, state.tasks.get('W1-B')), false);
  });
});

describe('rewindCascade', () => {
  it('includes later merges and keeps earlier ones out of the wipe set', () => {
    const events = journal(
      created(),
      makeEvent('merge.succeeded', { taskId: 'W1-A', sha: 'sha-a', beforeSha: 'sha-0' }),
      makeEvent('merge.succeeded', { taskId: 'W1-B', sha: 'sha-b', beforeSha: 'sha-a' }),
    );
    const state = derive(events);
    const result = rewindCascade(state, events, 'W1-A');
    assert.equal(result.ok, true);
    assert.equal(result.beforeSha, 'sha-0');
    assert.deepEqual(result.taskIds, ['W1-A', 'W1-B']);

    const onlyB = rewindCascade(state, events, 'W1-B');
    assert.equal(onlyB.ok, true);
    assert.equal(onlyB.beforeSha, 'sha-a');
    assert.deepEqual(onlyB.taskIds, ['W1-B']);
  });

  it('includes a task that started after this merge', () => {
    const events = journal(
      created(),
      makeEvent('merge.succeeded', { taskId: 'W1-A', sha: 'sha-a', beforeSha: 'sha-0' }),
      makeEvent('task.attempt.started', {
        taskId: 'W1-B',
        attemptId: 'b1',
        role: 'builder',
      }),
    );
    const state = derive(events);
    const result = rewindCascade(state, events, 'W1-A');
    assert.equal(result.ok, true);
    assert.ok(result.taskIds.includes('W1-B'));
  });

  it('includes currently in-flight work and skipped dependents', () => {
    const events = journal(
      created(),
      makeEvent('merge.succeeded', { taskId: 'W1-A', sha: 'sha-a', beforeSha: 'sha-0' }),
      makeEvent('task.attempt.started', {
        taskId: 'W1-B',
        attemptId: 'b1',
        role: 'builder',
      }),
      makeEvent('task.skipped', { taskId: 'W2-C', blockedBy: 'W1-B' }),
    );
    const state = derive(events);
    const result = rewindCascade(state, events, 'W1-A');
    assert.equal(result.ok, true);
    assert.deepEqual(result.taskIds, ['W1-A', 'W1-B', 'W2-C']);
  });

  it('falls back to the previous merge sha when beforeSha is missing', () => {
    const events = journal(
      created(),
      makeEvent('merge.succeeded', { taskId: 'W1-A', sha: 'sha-a', beforeSha: 'sha-0' }),
      makeEvent('merge.succeeded', { taskId: 'W1-B', sha: 'sha-b' }),
    );
    const state = derive(events);
    const result = rewindCascade(state, events, 'W1-B');
    assert.equal(result.ok, true);
    assert.equal(result.beforeSha, 'sha-a');
  });

  it('refuses a card that is not merged', () => {
    const events = journal(created());
    const state = derive(events);
    const result = rewindCascade(state, events, 'W1-A');
    assert.equal(result.ok, false);
    assert.match(result.error, /Reset/);
  });
});
