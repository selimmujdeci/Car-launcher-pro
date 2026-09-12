import type {
  AccountCleanupParticipant,
  CleanupPhase,
} from './cleanupTypes';

export const MAX_CLEANUP_PARTICIPANTS = 64;

type RegisteredParticipant = {
  participant: AccountCleanupParticipant;
  order: number;
};

export class CleanupParticipantRegistry {
  private readonly entries = new Map<string, RegisteredParticipant>();
  private nextOrder = 0;

  register(participant: AccountCleanupParticipant): void {
    if (!participant.id.trim()) throw new Error('PARTICIPANT_ID_REQUIRED');
    if (!Number.isFinite(participant.priority)) {
      throw new Error('PARTICIPANT_PRIORITY_INVALID');
    }
    if (this.entries.has(participant.id)) {
      throw new Error(`DUPLICATE_PARTICIPANT_ID:${participant.id}`);
    }
    if (this.entries.size >= MAX_CLEANUP_PARTICIPANTS) {
      throw new Error('PARTICIPANT_REGISTRY_FULL');
    }
    this.entries.set(participant.id, {
      participant,
      order: this.nextOrder++,
    });
  }

  listForPhase(phase: CleanupPhase): readonly AccountCleanupParticipant[] {
    return Array.from(this.entries.values())
      .filter(({ participant }) => participant.phase === phase)
      .sort((a, b) =>
        a.participant.priority - b.participant.priority || a.order - b.order)
      .map(({ participant }) => participant);
  }

  hasVerificationParticipant(): boolean {
    return this.listForPhase('VERIFY_EMPTY').some(
      (participant) => typeof participant.verifyEmpty === 'function',
    );
  }

  hasParticipantForPhase(phase: CleanupPhase): boolean {
    return this.listForPhase(phase).length > 0;
  }

  size(): number {
    return this.entries.size;
  }
}
