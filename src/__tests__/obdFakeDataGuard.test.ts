/**
 * obdFakeDataGuard.test.ts — SAHTE VERİ YASAĞI kilidi (saha 2026-07-17).
 *
 * SAHA ŞİKAYETİ: kullanıcı araçta DEĞİL, OBD bağlı DEĞİL — gösterge "345 km menzil +
 * yarı dolu yakıt" gösteriyordu.
 *
 * KÖK: `canSnapshotService` son bilinen CAN anlık görüntüsünü **12 saate kadar**
 * (STALE_STATIC_MS) geri yükler ve patch'e `source = 'real'` DAMGASI VURUR ("UI idle'da
 * takılı kalmasın" niyetiyle). obdService bunu modül yüklenirken `_current`'a uygular:
 *   `let _current = { ...INITIAL, ...hydrateCanSnapshotSync() }`
 * → dün akmış yakıt, bugün CANLI görünür. `source === 'real'` kontrolü bunu ELEYEMEZ.
 *
 * AYIRT EDİCİ: `dataFresh` + `lastSeenMs`. Hydration `_merge`'i BYPASS ettiği için bu iki
 * alan dokunulmaz kalır (dataFresh=false, lastSeenMs=0) → kurtarılmış değer ile canlı ölçüm
 * tam olarak buradan ayrılır.
 */
import { describe, it, expect } from 'vitest';
import { isObdReadingLive } from '../platform/vehicleStatusModel';

describe('isObdReadingLive — kurtarılmış snapshot canlı SAYILMAZ', () => {
  it('KÖK KİLİDİ: source="real" + dataFresh=false + lastSeenMs=0 → CANLI DEĞİL', () => {
    // canSnapshotService'in hydrate ettiği verinin BİREBİR şekli: source damgalı 'real',
    // ama hiç canlı ECU frame'i gelmemiş. Saha hatası tam olarak buydu.
    expect(isObdReadingLive({ source: 'real', dataFresh: false, lastSeenMs: 0 })).toBe(false);
  });

  it('source="real" TEK BAŞINA yetmez — damga kanıt değildir', () => {
    expect(isObdReadingLive({ source: 'real' })).toBe(false);
    expect(isObdReadingLive({ source: 'real', dataFresh: false })).toBe(false);
  });

  it('dataFresh=true ama hiç ölçüm yoksa (lastSeenMs=0) → CANLI DEĞİL', () => {
    expect(isObdReadingLive({ source: 'real', dataFresh: true, lastSeenMs: 0 })).toBe(false);
  });

  it('mock/none kaynak ASLA canlı sayılmaz', () => {
    expect(isObdReadingLive({ source: 'mock', dataFresh: true, lastSeenMs: 1 })).toBe(false);
    expect(isObdReadingLive({ source: 'none', dataFresh: true, lastSeenMs: 1 })).toBe(false);
  });

  it('GERÇEK canlı ölçüm geçer (yanlış-negatif yok — çalışan araçta gösterge körelmez)', () => {
    expect(isObdReadingLive({ source: 'real', dataFresh: true, lastSeenMs: 1_700_000_000 })).toBe(true);
  });

  it('veri bayatlayınca (ECU sustu) canlı olmaktan ÇIKAR', () => {
    // Watchdog dataFresh=false yapar; son değerler korunur ama SAYI olarak gösterilmez.
    expect(isObdReadingLive({ source: 'real', dataFresh: false, lastSeenMs: 1_700_000_000 })).toBe(false);
  });

  it('eksik alanlar fail-closed (undefined → canlı değil)', () => {
    expect(isObdReadingLive({ source: 'real', lastSeenMs: 1_700_000_000 })).toBe(false);
    expect(isObdReadingLive({ source: '' })).toBe(false);
  });
});
