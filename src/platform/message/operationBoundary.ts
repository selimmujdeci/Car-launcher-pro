import type { CommandMessage, IdempotencyClass } from './messageContract';

/** Owner-local bounded dedup; consumers must instantiate it at their own gateway. */
export class OperationBoundary {
  private readonly seen = new Map<string, number>();
  private readonly capacity: number;
  constructor(capacity = 128) { this.capacity = capacity; }
  admit(message: CommandMessage, idempotency: IdempotencyClass): 'ACCEPTED' | 'DUPLICATE' {
    if (idempotency === 'NON_IDEMPOTENT' || message.idempotencyKey === null) return 'ACCEPTED';
    if (this.seen.has(message.idempotencyKey)) return 'DUPLICATE';
    this.seen.set(message.idempotencyKey, message.createdAtMs);
    while (this.seen.size > this.capacity) this.seen.delete(this.seen.keys().next().value!);
    return 'ACCEPTED';
  }
  clear(): void { this.seen.clear(); }
}
