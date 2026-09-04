/**
 * Read-only UI port for the canonical native authority snapshot.
 * Components consume this port, never the native bridge or a provider directly.
 */
import { getSnapshot, subscribe } from './nativeAuthorityBridge';
import type { NativeAuthoritySnapshot } from '../../nativePlugin';
import { markMusicSnapshotReceived } from '../musicUiPerf';

export function getMusicCanonicalSnapshot(): NativeAuthoritySnapshot {
  return getSnapshot();
}

export function subscribeMusicCanonicalSnapshot(listener: () => void): () => void {
  return subscribe(() => { markMusicSnapshotReceived(); listener(); });
}
