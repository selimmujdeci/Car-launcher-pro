/**
 * driverPresenceDurability.test.ts — DRIVER PRESENCE DURABILITY P2 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Resolver DEĞİŞMEDİ** — dayanıklılık katmanı karar üretmez.
 *  2. Aynı segment İKİ KEZ KAPANMAZ; kapanış DEĞİŞMEZ (idempotent).
 *  3. Presence yalnız DOĞRULANMIŞ araç bağına yazılır; istemcinin taşıdığı
 *     `vehicleId` bir İDDİADIR, kanıt değildir.
 *  4. Yeniden başlatmada açık segment ve `refreshCount` KORUNUR; tekrar
 *     oynatılan gözlem DUPLICATE geçmiş ÜRETMEZ.
 *  5. Bozuk/eski kayıt ONARILMAZ — fail-closed reddedilir ve gerekçesi görünür.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ── safeStorage sahte deposu (gerçek disk/localStorage'a dokunulmaz) ──── */

const _disk = new Map<string, string>();
let _readThrows = false;
let _writeThrows = false;

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => {
    if (_readThrows) throw new Error('read fail');
    return _disk.get(k) ?? null;
  },
  safeSetRaw: (k: string, v: string) => {
    if (_writeThrows) throw new Error('write fail');
    _disk.set(k, v);
  },
  safeRemoveRaw: (k: string) => { _disk.delete(k); },
}));

import {
  driverPresenceStore, bindPresenceVehicle, readDriverPresenceDurability,
  readDriverPresenceHistory, resolveDriverPresence, normalizePresence,
  _resetDriverPresenceStoreForTest,
} from '../platform/fleet/driverPresence';
import {
  encodePresenceSnapshot, decodePresenceSnapshot,
  PRESENCE_SNAPSHOT_KEY, PRESENCE_SNAPSHOT_VERSION, emptyPresenceSnapshot,
} from '../platform/fleet/driverPresencePersistence';
import {
  recordPresenceHistory, closePresenceHistory, settlePresenceHistory,
  summarizePresenceHistory, segmentStatus, isOpenSegment,
  EMPTY_PRESENCE_HISTORY,
} from '../platform/fleet/driverPresenceHistory';

const NOW = Date.UTC(2026, 6, 31, 9, 0, 0);
const H = 3_600_000;
const VEH = 'veh-p2-1';

function obs(over: Record<string, unknown> = {}) {
  return {
    source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-1',
    detectedAt: NOW, expiresAt: NOW + 8 * H, vehicleId: VEH,
    ...over,
  };
}

/** Uygulamanın yeniden başlatılması: bellek sıfırlanır, DİSK kalır. */
function restart(): void {
  _resetDriverPresenceStoreForTest();
}

beforeEach(() => {
  _disk.clear();
  _readThrows = false;
  _writeThrows = false;
  _resetDriverPresenceStoreForTest();
});

/* ═══ A. ARAÇ BAĞI ═════════════════════════════════════════════════════ */

describe('PresenceDurability · A. Araç bağı (istemciye güvenme)', () => {
  it('A1. 🔒 BAĞ YOKKEN gözlem deftere YAZILMAZ (fail-closed)', () => {
    driverPresenceStore.record(obs(), NOW);
    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(0);
    const d = readDriverPresenceDurability(NOW);
    expect(d.vehicleBindingState).toBe('UNBOUND');
    expect(d.bindingRejectedCount).toBe(1);
    expect(d.lastRejectReason).toBe('VEHICLE_NOT_BOUND');
  });

  it('A2. 🔒 BAŞKA aracı iddia eden gözlem REDDEDİLİR', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs({ vehicleId: 'baska-arac' }), NOW);
    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(0);
    expect(readDriverPresenceDurability(NOW).lastRejectReason)
      .toBe('VEHICLE_BINDING_MISMATCH');
  });

  it('A3. 🔒 segmentin aracı BAĞDAN gelir — gözlemin iddiasından DEĞİL', () => {
    bindPresenceVehicle(VEH, NOW);
    /* Gözlem araç kimliği HİÇ taşımıyor: eskiden `null` yazılırdı. */
    driverPresenceStore.record(obs({ vehicleId: undefined }), NOW);
    expect(readDriverPresenceHistory(NOW).current?.vehicleId).toBe(VEH);
  });

  it('A4. 🔒 bağ DEĞİŞİRSE defter devredilmez (başka aracın geçmişi taşınmaz)', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(1);

    bindPresenceVehicle('veh-baska', NOW + H);
    expect(readDriverPresenceHistory(NOW + H).segmentCount).toBe(0);
    expect(readDriverPresenceDurability(NOW + H).boundVehicleId).toBe('veh-baska');
  });

  it('A5. 🔒 AYNI araca yeniden bağlanmak defteri SIFIRLAMAZ', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    bindPresenceVehicle(VEH, NOW + H);
    expect(readDriverPresenceHistory(NOW + H).segmentCount).toBe(1);
  });
});

/* ═══ B. RECONNECT SENARYOLARI ═════════════════════════════════════════ */

describe('PresenceDurability · B. Reconnect senaryoları', () => {
  beforeEach(() => { bindPresenceVehicle(VEH, NOW); });

  it('B1. 🔒 AYNI presence yeniden gelince segment UZAR (yeni satır yok)', () => {
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.record(
      obs({ detectedAt: NOW + H, expiresAt: NOW + 9 * H }), NOW + H);

    const sum = readDriverPresenceHistory(NOW + H);
    expect(sum.segmentCount).toBe(1);
    expect(sum.current?.refreshCount).toBe(1);
    expect(sum.current?.expiresAt).toBe(NOW + 9 * H);
    expect(sum.duplicateCount).toBe(1);
  });

  it('B2. 🔒 YENİ presence gelince önceki segment SUPERSEDED ile kapanır', () => {
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.record(
      obs({ driverId: 'd-2', detectedAt: NOW + 2 * H, expiresAt: NOW + 10 * H }),
      NOW + 2 * H);

    const sum = readDriverPresenceHistory(NOW + 2 * H);
    expect(sum.segmentCount).toBe(2);
    expect(sum.previous?.closeReason).toBe('SUPERSEDED');
    expect(sum.previous?.durationMs).toBe(2 * H);
    expect(sum.current?.driverId).toBe('d-2');
    expect(sum.switchCount).toBe(1);
  });

  it('B3. 🔒 SÜRE DOLUNCA segment TTL_EXPIRED olur (kapanış = TTL, uydurma yok)', () => {
    driverPresenceStore.record(obs(), NOW);
    const later = NOW + 20 * H;                 // TTL 8 saatti
    const sum = readDriverPresenceHistory(later);
    expect(sum.current).toBeNull();
    expect(sum.currentStatus).toBe('TTL_EXPIRED');
    expect(sum.previous?.durationMs ?? segmentDur(sum)).toBe(8 * H);
    expect(sum.expiredSegmentCount).toBe(1);
  });

  it('B4. 🔒 CLEAR açık segmenti CLEARED ile kapatır', () => {
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.clear(NOW + 3 * H);
    const sum = readDriverPresenceHistory(NOW + 3 * H);
    expect(sum.current).toBeNull();
    expect(sum.previous?.closeReason).toBe('CLEARED');
    expect(sum.previous?.durationMs).toBe(3 * H);
  });
});

function segmentDur(sum: { previous: { durationMs: number | null } | null }): number | null {
  return sum.previous?.durationMs ?? null;
}

/* ═══ C. İKİ KEZ KAPANMA YASAK ═════════════════════════════════════════ */

describe('PresenceDurability · C. Kapanış idempotensi', () => {
  it('C1. 🔒 CLEARED bir segment TTL ile YENİDEN kapatılamaz', () => {
    let st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    st = closePresenceHistory(st, NOW + H);
    const closed = st.entries[0]!;
    expect(closed.closeReason).toBe('CLEARED');

    /* TTL çoktan geçti — yine de kapanış DEĞİŞMEMELİ. */
    const settled = settlePresenceHistory(st, NOW + 50 * H);
    expect(settled.entries[0]!.closeReason).toBe('CLEARED');
    expect(settled.entries[0]!.expiredAt).toBe(NOW + H);
    expect(settled.entries[0]!.durationMs).toBe(H);
  });

  it('C2. 🔒 iki kez clear() ikinci kapanışı YAZMAZ', () => {
    let st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    st = closePresenceHistory(st, NOW + H);
    const first = st.entries[0]!;
    st = closePresenceHistory(st, NOW + 5 * H);
    expect(st.entries[0]).toEqual(first);
  });

  it('C3. 🔒 settle() İKİNCİ çağrıda hiçbir şeyi değiştirmez (idempotent)', () => {
    const st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    const once = settlePresenceHistory(st, NOW + 20 * H);
    const twice = settlePresenceHistory(once, NOW + 40 * H);
    expect(twice.entries[0]).toEqual(once.entries[0]);
    expect(once.entries[0]!.closeReason).toBe('TTL_EXPIRED');
    expect(once.entries[0]!.expiredAt).toBe(NOW + 8 * H);
  });

  it('C4. 🔒 kapanmış segment "açık" SAYILMAZ (kapanış anı bilinmese bile)', () => {
    let st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    st = closePresenceHistory(st, null);        // kapanış anı BİLİNMİYOR
    const e = st.entries[0]!;
    expect(e.closeReason).toBe('CLEARED');
    expect(e.expiredAt).toBeNull();
    expect(e.durationMs).toBeNull();            // sahte süre YOK
    expect(isOpenSegment(e)).toBe(false);
    expect(segmentStatus(e, NOW + 99 * H)).toBe('CLEARED');
  });
});

/* ═══ D. KALICILIK ═════════════════════════════════════════════════════ */

describe('PresenceDurability · D. Kalıcılık ve yeniden başlatma', () => {
  it('D1. 🔒 yeniden başlatmada AÇIK segment ve refreshCount KORUNUR', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.record(obs({ detectedAt: NOW + H }), NOW + H);
    driverPresenceStore.record(obs({ detectedAt: NOW + 2 * H }), NOW + 2 * H);

    const before = readDriverPresenceHistory(NOW + 2 * H);
    expect(before.current?.refreshCount).toBe(2);

    restart();
    const after = readDriverPresenceHistory(NOW + 2 * H);
    expect(after.segmentCount).toBe(1);
    expect(after.current?.driverId).toBe('d-1');
    expect(after.current?.refreshCount).toBe(2);     // sayaç KORUNDU
    expect(after.current?.detectedAt).toBe(NOW);     // segment BAŞLANGICI korundu
    expect(readDriverPresenceDurability(NOW + 2 * H).persistenceState).toBe('RESTORED');
  });

  it('D2. 🔒 yeniden başlatma sonrası AYNI gözlem DUPLICATE üretmez', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    restart();

    /* Çevrimdışı kuyruk aynı gözlemi tekrar oynatıyor. */
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.record(obs(), NOW);

    const sum = readDriverPresenceHistory(NOW);
    expect(sum.segmentCount).toBe(1);
    expect(sum.current?.refreshCount).toBe(0);   // tazeleme SAYILMADI
    expect(sum.replayCount).toBe(2);             // ama sessizce yutulmadı
  });

  it('D3. 🔒 kapanmış defter de kalıcıdır (kanıt yeniden başlatmada kaybolmaz)', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    driverPresenceStore.clear(NOW + H);

    restart();
    const sum = readDriverPresenceHistory(NOW + H);
    expect(sum.segmentCount).toBe(1);
    expect(sum.previous?.closeReason).toBe('CLEARED');
    expect(sum.previous?.durationMs).toBe(H);
  });

  it('D4. 🔒 kalıcı kayıt PII TAŞIMAZ (ad/telefon/e-posta/konum yok)', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    const raw = _disk.get(PRESENCE_SNAPSHOT_KEY) ?? '';
    expect(raw.length).toBeGreaterThan(0);
    for (const k of ['name', 'displayName', 'phone', 'email', 'license',
                     'lat', 'lon', 'vin']) {
      expect(raw.toLowerCase()).not.toContain(k.toLowerCase());
    }
  });

  it('D5. 🔒 yazma düşerse gözlem KAYBOLMAZ ama arıza GÖRÜNÜR olur', () => {
    bindPresenceVehicle(VEH, NOW);
    _writeThrows = true;
    driverPresenceStore.record(obs(), NOW);

    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(1);   // bellekte var
    const d = readDriverPresenceDurability(NOW);
    expect(d.persistenceState).toBe('WRITE_FAILED');
    expect(d.lastFailure).toBe('STORAGE_WRITE_FAILED');
  });

  it('D6. 🔒 okuma düşerse defter BOŞ başlar ve sahte "geri yüklendi" DEMEZ', () => {
    _readThrows = true;
    const d = readDriverPresenceDurability(NOW);
    expect(d.persistenceState).toBe('READ_FAILED');
    expect(d.lastFailure).toBe('STORAGE_READ_FAILED');
    expect(d.restoredSegmentCount).toBe(0);
  });

  it('D7. 🔒 hiç kayıt yokken durum EMPTY — bu bir ARIZA değildir', () => {
    const d = readDriverPresenceDurability(NOW);
    expect(d.persistenceState).toBe('EMPTY');
    expect(d.lastFailure).toBeNull();
  });
});

/* ═══ E. ÇÖZÜMLEME FAIL-CLOSED ═════════════════════════════════════════ */

describe('PresenceDurability · E. Bozuk kayıt ONARILMAZ (fail-closed)', () => {
  it('E1. 🔒 roundtrip: kodla → çöz → aynı defter', () => {
    const st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    const snap = { ...emptyPresenceSnapshot(NOW), boundVehicleId: VEH, history: st };
    const res = decodePresenceSnapshot(encodePresenceSnapshot(snap));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.snapshot.history.entries).toEqual(st.entries);
      expect(res.snapshot.boundVehicleId).toBe(VEH);
    }
  });

  it('E2. 🔒 bozuk JSON → PARSE_ERROR (kısmi okuma YOK)', () => {
    expect(decodePresenceSnapshot('{bozuk')).toEqual({ ok: false, reason: 'PARSE_ERROR' });
  });

  it('E3. 🔒 başka şema sürümü OKUNMAZ', () => {
    const raw = JSON.stringify({ version: PRESENCE_SNAPSHOT_VERSION + 1, savedAtMs: NOW });
    expect(decodePresenceSnapshot(raw)).toEqual({ ok: false, reason: 'VERSION_MISMATCH' });
  });

  it('E4. 🔒 YARIM KAPANIŞ reddedilir (kapandı ama süresi yok)', () => {
    const raw = JSON.stringify({
      version: PRESENCE_SNAPSHOT_VERSION, savedAtMs: NOW, boundVehicleId: VEH,
      observationCount: 1, rejectedCount: 0, bindingRejectedCount: 0,
      history: {
        switchCount: 0, duplicateCount: 0, droppedCount: 0, replayCount: 0,
        entries: [{
          vehicleId: VEH, driverId: 'd-1', source: 'NFC', confidence: 'VERY_HIGH',
          detectedAt: NOW, expiresAt: NOW + H, expiredAt: NOW + H,
          durationMs: null, closeReason: null, refreshCount: 0, lastDetectedAt: NOW,
        }],
      },
    });
    expect(decodePresenceSnapshot(raw)).toEqual({ ok: false, reason: 'SCHEMA_INVALID' });
  });

  it('E5. 🔒 İKİ AÇIK SEGMENT reddedilir (iki kişi aynı anda süremez)', () => {
    const open = (d: string, at: number) => ({
      vehicleId: VEH, driverId: d, source: 'NFC', confidence: 'VERY_HIGH',
      detectedAt: at, expiresAt: at + 8 * H, expiredAt: null,
      durationMs: null, closeReason: null, refreshCount: 0, lastDetectedAt: at,
    });
    const raw = JSON.stringify({
      version: PRESENCE_SNAPSHOT_VERSION, savedAtMs: NOW, boundVehicleId: VEH,
      observationCount: 2, rejectedCount: 0, bindingRejectedCount: 0,
      history: {
        switchCount: 1, duplicateCount: 0, droppedCount: 0, replayCount: 0,
        entries: [open('d-1', NOW), open('d-2', NOW + H)],
      },
    });
    expect(decodePresenceSnapshot(raw)).toEqual({ ok: false, reason: 'INVARIANT_VIOLATION' });
  });

  it('E6. 🔒 BAŞKA ARACIN defteri geri yüklenmez', () => {
    const snap = { ...emptyPresenceSnapshot(NOW), boundVehicleId: 'veh-baska' };
    expect(decodePresenceSnapshot(encodePresenceSnapshot(snap), VEH))
      .toEqual({ ok: false, reason: 'VEHICLE_BINDING_CHANGED' });
  });

  it('E7. 🔒 tanınmayan kaynak/güven reddedilir (uydurma enum yok)', () => {
    const raw = JSON.stringify({
      version: PRESENCE_SNAPSHOT_VERSION, savedAtMs: NOW, boundVehicleId: VEH,
      observationCount: 1, rejectedCount: 0, bindingRejectedCount: 0,
      history: {
        switchCount: 0, duplicateCount: 0, droppedCount: 0, replayCount: 0,
        entries: [{
          vehicleId: VEH, driverId: 'd-1', source: 'TELEPATI', confidence: 'COK_YUKSEK',
          detectedAt: NOW, expiresAt: NOW + H, expiredAt: null,
          durationMs: null, closeReason: null, refreshCount: 0, lastDetectedAt: NOW,
        }],
      },
    });
    expect(decodePresenceSnapshot(raw)).toEqual({ ok: false, reason: 'SCHEMA_INVALID' });
  });

  it('E8. 🔒 bozuk kayıt REDDEDİLİNCE defter boş başlar, gerekçe GÖRÜNÜR', () => {
    _disk.set(PRESENCE_SNAPSHOT_KEY, '{bozuk');
    const d = readDriverPresenceDurability(NOW);
    expect(d.persistenceState).toBe('REJECTED');
    expect(d.lastFailure).toBe('PARSE_ERROR');
    expect(readDriverPresenceHistory(NOW).segmentCount).toBe(0);
  });
});

/* ═══ F. RESOLVER REGRESYONU ═══════════════════════════════════════════ */

describe('PresenceDurability · F. Resolver DEĞİŞMEDİ', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverPresence.ts'), 'utf8');

  it('F1. 🔒 resolver gövdesi kalıcılık/bağ/defter BİLMİYOR', () => {
    const start = SRC.indexOf('export function resolveDriverPresence');
    const end = SRC.indexOf('/* ── Kullanıcıya dönük etiketler', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    for (const forbidden of ['safeGetRaw', 'safeSetRaw', 'PRESENCE_SNAPSHOT',
                             '_boundVehicleId', 'history', 'persist', 'snapshot']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('F2. 🔒 dolu defter + kalıcı kayıt resolver çıktısını DEĞİŞTİRMEZ', () => {
    const p = normalizePresence(obs());
    const clean = resolveDriverPresence({
      presence: p, assignmentDriverId: null, driverEligible: true, nowMs: NOW,
    });

    bindPresenceVehicle(VEH, NOW);
    for (let i = 0; i < 12; i++) {
      driverPresenceStore.record(
        obs({ driverId: `d-${i}`, detectedAt: NOW + i * 60_000 }), NOW + i * 60_000);
    }
    restart();   // kalıcı defterden geri yüklenmiş durum

    const afterLedger = resolveDriverPresence({
      presence: p, assignmentDriverId: null, driverEligible: true, nowMs: NOW,
    });
    expect(afterLedger).toEqual(clean);
  });

  it('F3. 🔒 defter DOLUYKEN de fail-closed korunur (geçersiz gözlem kanıt olmaz)', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    const r = resolveDriverPresence({
      presence: normalizePresence(obs({ source: 'HEAD_UNIT' })),
      assignmentDriverId: null, driverEligible: true, nowMs: NOW,
    });
    expect(r.decision).toBe('PRESENCE_UNUSABLE');
    expect(r.driverId).toBeNull();
  });

  it('F4. 🔒 depo timer KURMAZ (zero-leak) — kapanış TEMBELDİR', () => {
    expect(SRC).not.toContain('setInterval');
    expect(SRC).not.toContain('setTimeout');
    expect(readDriverPresenceDurability(NOW).expiryMode).toBe('LAZY_ON_ACCESS');
  });

  it('F5. 🔒 kalıcılık modülü SAF kalır (I/O ve zaman içermez)', () => {
    const PERS = readFileSync(
      join(process.cwd(), 'src/platform/fleet/driverPresencePersistence.ts'), 'utf8');
    const code = PERS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('safeGetRaw');
    expect(code).not.toContain('safeSetRaw');
    expect(code).not.toContain('setTimeout');
  });
});

/* ═══ G. GÖZLEM YÜZEYİ (LAB sözleşmesi) ═══════════════════════════════ */

describe('PresenceDurability · G. LAB gözlem yüzeyi', () => {
  it('G1. 🔒 dayanıklılık okuması ASLA fırlatmaz ve sahte "sağlıklı" üretmez', () => {
    _readThrows = true;
    expect(() => readDriverPresenceDurability(NOW)).not.toThrow();
    const d = readDriverPresenceDurability(NOW);
    expect(d.vehicleBindingState).toBe('UNBOUND');
    expect(d.lastFailure).not.toBeNull();
  });

  it('G2. 🔒 süresi dolan segment sayısı GERÇEK veriden gelir', () => {
    bindPresenceVehicle(VEH, NOW);
    driverPresenceStore.record(obs(), NOW);
    expect(readDriverPresenceDurability(NOW).expiredSegmentCount).toBe(0);
    expect(readDriverPresenceDurability(NOW + 20 * H).expiredSegmentCount).toBe(1);
  });

  it('G3. 🔒 LAB ekranı dayanıklılık alanlarını GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetPresenceHistoryScreen.tsx'), 'utf8');
    for (const field of ['persistenceState', 'lastRestore', 'expiryMode',
                         'expiredSegmentCount', 'vehicleBindingState', 'lastFailure']) {
      expect(SCREEN).toContain(field);
    }
  });

  it('G4. 🔒 LAB ekranı araç/sürücü kimliğini KISALTIR (tam kimlik sızmaz)', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetPresenceHistoryScreen.tsx'), 'utf8');
    expect(SCREEN).toContain('slice(0, 8)');
  });
});

/* ═══ H. ÖZET TUTARLILIĞI ═════════════════════════════════════════════ */

describe('PresenceDurability · H. Özet tutarlılığı', () => {
  it('H1. 🔒 özet defteri DEĞİŞTİRMEZ (salt-okunur)', () => {
    const st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    const before = JSON.stringify(st);
    summarizePresenceHistory(st, NOW + 99 * H);
    expect(JSON.stringify(st)).toBe(before);
  });

  it('H2. 🔒 replayCount ile duplicateCount AYRI şeyleri sayar', () => {
    let st = recordPresenceHistory(EMPTY_PRESENCE_HISTORY, {
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    st = recordPresenceHistory(st, {                       // birebir tekrar
      presence: normalizePresence(obs()), vehicleId: VEH, nowMs: NOW,
    });
    st = recordPresenceHistory(st, {                       // gerçek tazeleme
      presence: normalizePresence(obs({ detectedAt: NOW + H, expiresAt: NOW + 9 * H })),
      vehicleId: VEH, nowMs: NOW + H,
    });
    expect(st.replayCount).toBe(1);
    expect(st.duplicateCount).toBe(1);
    expect(st.entries).toHaveLength(1);
    expect(st.entries[0]!.refreshCount).toBe(1);
  });
});
