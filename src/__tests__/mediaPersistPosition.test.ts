/**
 * mediaPersistPosition.test.ts — "açılışta devam" konumu.
 *
 * Saha 2026-09-23 (telefon): müzik 80. saniyede çalarken uygulama kapatıldı;
 * açılışta aynı parça 0'dan başladı. Kök: periyodik kayıt olay itişli anlık
 * görüntüyü kullanıyordu ve native çalma SÜRERKEN konum itmez → kaydedilen
 * konum parça başındaki değerde kalıyordu.
 *
 * Kilit: kayıt anında konum native'den TAZE okunur; taze okuma olmazsa son
 * bilinen görüntüyle kuyruk yine kaydedilir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Snap = Record<string, unknown>;
const bridge: { pushed: Snap; fresh: Snap } = { pushed: {}, fresh: {} };

vi.mock('../platform/media/authority/nativeAuthorityBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/media/authority/nativeAuthorityBridge')>();
  return {
    ...actual,
    getSnapshot: () => bridge.pushed,
    refreshSnapshot: async () => bridge.fresh,
    startNativeAuthority: async () => {},
    stopNativeAuthority: () => {},
    subscribe: () => () => {},
  };
});

const base: Snap = { authorityAvailable: true, activeSource: 'LOCAL', playing: true, currentIndex: 0, queueLength: 1 };
const item = { id: 'a', uri: 'content://media/external/audio/media/1', title: 'A', artist: 'X' };

async function persistOnce(): Promise<{ positionMs?: number; items?: unknown[] }> {
  const runtime = await import('../platform/media/authority/mediaAuthorityRuntime');
  const recovery = await import('../platform/media/authority/mediaRecovery');
  runtime.__resetRuntimeForTest();
  runtime.noteQueue('LOCAL', [item], 0);
  await runtime.__persistNowForTest();
  return JSON.parse(recovery.readPersistedRaw() ?? '{}') as { positionMs?: number; items?: unknown[] };
}

describe('açılışta devam — kalıcı konum', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* yoksay */ } });

  it('🔒 kayıt TAZE konumu yazar; olay itişli görüntüdeki bayat 0 YAZILMAZ', async () => {
    bridge.pushed = { ...base, positionMs: 0 };        // son itilen olay: parça başı
    bridge.fresh = { ...base, positionMs: 80_000 };    // native'in gerçek konumu
    expect((await persistOnce()).positionMs).toBe(80_000);
  });

  it('taze okuma yoksa kuyruk yine kaydedilir (son bilinen görüntüyle)', async () => {
    bridge.pushed = { ...base, positionMs: 12_000 };
    bridge.fresh = { authorityAvailable: false };
    const saved = await persistOnce();
    expect(saved.items).toHaveLength(1);
    expect(saved.positionMs).toBe(12_000);
  });
});
