/**
 * ARCH-03/F1–F3 — shared vocabulary, not a bus and not an owner.
 * Domain gateways retain execution, retry, lifecycle and truth ownership.
 */
export type MessageKind = 'COMMAND' | 'EVENT' | 'QUERY' | 'REQUEST' | 'RESULT' | 'ACK' | 'NOTIFICATION';
export type MessageOutcome = 'SUCCESS' | 'PARTIAL' | 'REJECTED' | 'UNSUPPORTED' | 'BLOCKED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'STALE' | 'DUPLICATE' | 'UNKNOWN_OUTCOME';
export type IdempotencyClass = 'IDEMPOTENT' | 'NON_IDEMPOTENT' | 'CONDITIONALLY_IDEMPOTENT' | 'UNKNOWN';

export interface CommandMessage<T = unknown> {
  readonly messageId: string;
  readonly kind: MessageKind;
  readonly name: string;
  readonly source: string;
  readonly target: string | null;
  readonly createdAtMs: number;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly operationId: string | null;
  readonly sessionId: string | null;
  readonly generation: number | null;
  readonly epoch: number | null;
  readonly scopeRef: string | null;
  readonly provenance: readonly string[];
  readonly attempt: number;
  readonly idempotencyKey: string | null;
  readonly payload: T | null;
}

export interface MessageInput<T = unknown> extends Omit<CommandMessage<T>, 'correlationId' | 'causationId' | 'operationId' | 'sessionId' | 'generation' | 'epoch' | 'scopeRef' | 'idempotencyKey' | 'payload'> {
  readonly correlationId?: string | null; readonly causationId?: string | null; readonly operationId?: string | null;
  readonly sessionId?: string | null; readonly generation?: number | null; readonly epoch?: number | null;
  readonly scopeRef?: string | null; readonly idempotencyKey?: string | null; readonly payload?: T | null;
}

const NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}$/;
const text = (v: unknown): string | null => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 96 ? v.trim() : null;
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;

/** Pure validation/freeze. IDs and time are supplied by the invoking runtime owner. */
export function createCommandMessage<T>(input: MessageInput<T>): CommandMessage<T> | null {
  const messageId = text(input.messageId); const source = text(input.source); const name = text(input.name);
  const createdAtMs = num(input.createdAtMs); const attempt = num(input.attempt);
  if (!messageId || !source || !name || !NAME.test(name) || createdAtMs === null || createdAtMs < 0 || attempt === null || attempt < 0) return null;
  if ((input.kind === 'COMMAND' || input.kind === 'REQUEST') && text(input.target) === null) return null;
  if (input.kind === 'EVENT' && input.target !== null && input.target !== undefined) return null; // events never address a side-effect owner
  return Object.freeze({
    messageId, kind: input.kind, name, source, target: text(input.target), createdAtMs,
    correlationId: text(input.correlationId), causationId: text(input.causationId), operationId: text(input.operationId),
    sessionId: text(input.sessionId), generation: num(input.generation), epoch: num(input.epoch), scopeRef: text(input.scopeRef),
    provenance: Object.freeze((input.provenance ?? []).map(text).filter((x): x is string => x !== null).slice(0, 8)),
    attempt, idempotencyKey: text(input.idempotencyKey), payload: input.payload ?? null,
  });
}

/** A result is valid only when it explicitly joins the originating operation/correlation. */
export function resultMatchesRequest(request: CommandMessage, result: CommandMessage): boolean {
  if (!['COMMAND', 'REQUEST'].includes(request.kind) || !['RESULT', 'ACK'].includes(result.kind)) return false;
  const key = request.correlationId ?? request.operationId ?? request.messageId;
  return result.correlationId === key && (request.operationId === null || result.operationId === request.operationId);
}

export interface CompletionGateInput { readonly request: CommandMessage; readonly completion: CommandMessage; readonly currentGeneration?: number | null; readonly currentEpoch?: number | null; readonly cancelled?: boolean; readonly superseded?: boolean; }
/** Shared decision semantics; it mutates no owner state and creates no global epoch. */
export function gateCompletion(input: CompletionGateInput): MessageOutcome | 'ACCEPTED' {
  if (!resultMatchesRequest(input.request, input.completion)) return 'STALE';
  if (input.cancelled) return 'CANCELLED';
  if (input.superseded) return 'STALE';
  if (input.currentGeneration !== undefined && input.request.generation !== null && input.request.generation !== input.currentGeneration) return 'STALE';
  if (input.currentEpoch !== undefined && input.request.epoch !== null && input.request.epoch !== input.currentEpoch) return 'STALE';
  return 'ACCEPTED';
}

export function retryAllowed(idempotency: IdempotencyClass, outcome: MessageOutcome): boolean {
  return idempotency !== 'NON_IDEMPOTENT' && outcome === 'FAILED';
}

export function aggregateOutcomes(outcomes: readonly MessageOutcome[]): MessageOutcome {
  if (outcomes.length === 0) return 'UNKNOWN_OUTCOME';
  if (outcomes.every((o) => o === 'SUCCESS')) return 'SUCCESS';
  if (outcomes.some((o) => o === 'SUCCESS')) return 'PARTIAL';
  if (outcomes.every((o) => o === 'CANCELLED')) return 'CANCELLED';
  return outcomes[0] ?? 'UNKNOWN_OUTCOME';
}
