/**
 * In-memory event bus for restore job SSE streams.
 *
 * Keyed by jobId. Buffers all published events so that late subscribers
 * (SSE clients that connect after the orchestrator has already emitted events)
 * receive a full replay on subscribe. Source: T5 §6.2.
 */

import type { RestoreSseEvent } from './types.js';

type Listener = (event: RestoreSseEvent) => void;

const _listeners = new Map<string, Set<Listener>>();
const _buffers = new Map<string, RestoreSseEvent[]>();

/**
 * Subscribe to events for a given jobId.
 * Replays all previously buffered events synchronously before returning.
 * Returns an unsubscribe function.
 */
export function subscribe(jobId: string, fn: Listener): () => void {
  for (const ev of (_buffers.get(jobId) ?? [])) {
    fn(ev);
  }

  if (!_listeners.has(jobId)) _listeners.set(jobId, new Set());
  _listeners.get(jobId)!.add(fn);

  return () => {
    _listeners.get(jobId)?.delete(fn);
    if ((_listeners.get(jobId)?.size ?? 0) === 0) _listeners.delete(jobId);
  };
}

/** Publish an event: buffers it and notifies all live subscribers. */
export function publish(jobId: string, event: RestoreSseEvent): void {
  if (!_buffers.has(jobId)) _buffers.set(jobId, []);
  _buffers.get(jobId)!.push(event);
  _listeners.get(jobId)?.forEach((fn) => fn(event));
}

/** Remove all state for a job (call after job is fully complete). */
export function clearJob(jobId: string): void {
  _listeners.delete(jobId);
  _buffers.delete(jobId);
}

/** For testing only: reset all bus state. */
export function _clearAll(): void {
  _listeners.clear();
  _buffers.clear();
}
