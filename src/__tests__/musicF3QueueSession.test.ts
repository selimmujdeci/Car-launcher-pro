import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetPlayQueueForTest, addToQueue, createQueue, getDesiredQueue, playNext, reorder,
  type QueueEntry,
} from '../platform/media/session/playQueue';
import { matchMediaIdentity, type CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';
import { evaluateContinuity } from '../platform/media/session/sessionContinuity';
import { buildListeningProjection } from '../platform/media/session/sessionProjection';
import { parsePersistedListeningSession } from '../platform/media/session/sessionPersistence';
import { _resetListeningSessionForTest, startListeningSession } from '../platform/media/session/listeningSession';

const identity = (id: string, title = 'Parça'): CanonicalMediaIdentity => ({
  libraryId: id, providerId: id, providerNamespace: 'MEDIASTORE', contentUri: `content:///${id}`,
  title, artist: 'Sanatçı', album: 'Albüm', durationMs: 180_000, trackNumber: 1, discNumber: 1,
});
const entry = (id: string, title?: string): QueueEntry => ({
  entryId: `${id}#1`, identity: identity(id, title),
  item: { id, uri: `content:///${id}`, title: title ?? 'Parça', artist: 'Sanatçı' },
  origin: 'PROVIDER', libraryRef: null,
});

beforeEach(() => { _resetPlayQueueForTest(); _resetListeningSessionForTest(); });

describe('F3 · PlayQueue authority', () => {
  it('desired queue mutates deterministically and rejects unsupported provider operations', () => {
    expect(createQueue('LOCAL', [entry('a'), entry('b')], 1).status).toBe('APPLIED');
    expect(getDesiredQueue()).toMatchObject({ currentIndex: 1, entries: [{ item: { id: 'a' } }, { item: { id: 'b' } }] });
    expect(playNext([entry('c')]).status).toBe('APPLIED');
    expect(reorder(2, 0).status).toBe('APPLIED');
    expect(getDesiredQueue().entries.map((item) => item.item.id)).toEqual(['c', 'a', 'b']);
    expect(createQueue('YOUTUBE', [entry('y')]).status).toBe('APPLIED');
    expect(addToQueue([entry('z')])).toMatchObject({ status: 'REJECTED', failureCode: 'unsupported_capability' });
  });
});

describe('F3 · MediaIdentity ve continuity', () => {
  it('uses evidence grades and never carries ambiguous/weak candidates automatically', () => {
    expect(matchMediaIdentity(identity('a'), identity('a')).grade).toBe('EXACT');
    expect(matchMediaIdentity({ ...identity('a'), libraryId: null, providerId: null, contentUri: null },
      { ...identity('b'), libraryId: null, providerId: null, contentUri: null }).grade).toBe('STRONG');
    const broken = evaluateContinuity({ previous: [identity('a')], candidates: [identity('b', 'Başka')], currentIndex: 0, sourceChanged: true });
    expect(broken).toMatchObject({ state: 'BROKEN', resumeCandidateIndex: null });
    const carried = evaluateContinuity({ previous: [identity('a')], candidates: [identity('a')], currentIndex: 0, sourceChanged: true });
    expect(carried).toMatchObject({ state: 'CARRIED', resumeCandidateIndex: 0 });
  });
});

describe('F3 · projection ve recovery fail-closed', () => {
  it('does not call unknown observed queue matched and persisted state never claims playback', () => {
    createQueue('LOCAL', [entry('a')]);
    const queue = getDesiredQueue();
    const session = startListeningSession({ intent: 'TRACKS', source: 'LOCAL', queueId: queue.queueId, queueRevision: queue.revision, nowMs: 1 });
    expect(buildListeningProjection({ session, queue, supportsQueue: true, observedItemIds: null, observedCurrentItemId: null }))
      .toMatchObject({ alignment: 'UNKNOWN', desiredApplied: false, currentItemAgreement: 'UNKNOWN' });
    const raw = JSON.stringify({ schema: 1, sessionId: 's', intent: 'ALBUM', intentRef: 'album:a', originSource: 'LOCAL', currentSource: 'LOCAL', queueId: 'q', queueRevision: 1, entries: [entry('a')], currentIndex: 0, startedAt: 1, savedAtMs: 1, ignitionRef: null });
    expect(parsePersistedListeningSession(raw, 2)).toMatchObject({ rejection: null, playbackClaim: 'NONE' });
  });
});
