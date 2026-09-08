import type { BoardState, TaskState } from './types';

/** Task ids currently skipped because something in `seedIds` blocked them. */
export function withSkippedDependents(state: BoardState, seedIds: Iterable<string>): string[];

/** True when Reset would have something to wipe on this card. */
export function hasRunDebris(state: BoardState, task: TaskState): boolean;

/** Tasks Reset should wipe. Refuses a merged card. */
export function resetTargets(
  state: BoardState,
  taskId: string,
): { ok: true; taskIds: string[] } | { ok: false; error: string; taskIds: string[] };

/** Integration tip to restore from a merge.succeeded index. */
export function beforeShaForMerge(
  events: readonly Record<string, unknown>[],
  mergeIndex: number,
): string | null;

/** Tasks Rewind should wipe, and the integration sha to restore. */
export function rewindCascade(
  state: BoardState,
  events: Iterable<unknown>,
  fromTaskId: string,
):
  | { ok: true; fromTaskId: string; beforeSha: string; taskIds: string[] }
  | { ok: false; error: string; taskIds: string[]; beforeSha: null };
