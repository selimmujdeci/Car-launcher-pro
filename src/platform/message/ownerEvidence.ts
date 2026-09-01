import { createCommandMessage, type CommandMessage, type MessageKind } from './messageContract';

/** Owner-local, bounded diagnostics only. Each domain owns its own instance. */
export class OwnerCommandEvidence {
  private entries: CommandMessage[] = [];
  private readonly owner: string;
  private readonly capacity: number;
  constructor(owner: string, capacity = 32) { this.owner = owner; this.capacity = capacity; }
  record(input: { id: string; kind: MessageKind; name: string; source: string; target: string | null; operationId: string; correlationId: string; sessionId?: string | null; generation?: number | null; epoch?: number | null; reason?: string | null; nowMs: number; }): CommandMessage | null {
    const message = createCommandMessage({ messageId: input.id, kind: input.kind, name: input.name, source: input.source, target: input.target, createdAtMs: input.nowMs, operationId: input.operationId, correlationId: input.correlationId, causationId: input.reason, sessionId: input.sessionId ?? null, generation: input.generation ?? null, epoch: input.epoch ?? null, scopeRef: this.owner, provenance: [this.owner], attempt: 0, idempotencyKey: null, payload: null });
    if (message) { this.entries.push(message); if (this.entries.length > this.capacity) this.entries.shift(); }
    return message;
  }
  recent(): readonly CommandMessage[] { return Object.freeze([...this.entries]); }
}
