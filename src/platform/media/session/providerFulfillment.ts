/** F3.1 — sağlayıcının niyeti karşılama kanıtı; playback veya handover yapmaz. */
import type { SourceClass } from '../authority/sourceCapabilities';
import { evaluateContinuity, type ContinuityDecision } from './sessionContinuity';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';
import type { ListeningIntent } from './listeningSession';

export type FulfillmentAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export interface ProviderFulfillmentEvidence {
  readonly provider: SourceClass;
  readonly intent: ListeningIntent;
  readonly candidates: readonly CanonicalMediaIdentity[];
  readonly observedAtMs: number;
  readonly provenance: 'PROVIDER_ADAPTER' | 'NATIVE_TIMELINE';
  readonly availability: FulfillmentAvailability;
}
export interface FulfillmentDecision { readonly decision: ContinuityDecision; readonly provider: SourceClass; readonly available: boolean; }
export function decideProviderFulfillment(input: {
  readonly intent: ListeningIntent; readonly provider: SourceClass; readonly previous: readonly CanonicalMediaIdentity[];
  readonly currentIndex: number; readonly sourceChanged: boolean; readonly evidence: ProviderFulfillmentEvidence | null;
}): FulfillmentDecision {
  const usable = input.evidence !== null && input.evidence.availability === 'AVAILABLE'
    && input.evidence.provider === input.provider && input.evidence.intent === input.intent;
  const decision = evaluateContinuity({ previous: input.previous, candidates: usable ? input.evidence!.candidates : [], currentIndex: input.currentIndex, sourceChanged: input.sourceChanged });
  return Object.freeze({ decision, provider: input.provider, available: usable });
}
