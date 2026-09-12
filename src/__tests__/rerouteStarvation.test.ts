/**
 * P0-NAV-13 — OFF-ROUTE / REROUTE DURUM MAKİNESİ (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * Sapma durum makinesi (`offRouteModel`) NAV-13'ün istediği HER ŞEYE sahipti:
 * `ON_ROUTE → SUSPECTED_OFF_ROUTE → CONFIRMED_OFF_ROUTE → REROUTING → REJOINED`
 * artı çoklu kanıt (ardışık örnek SAYISI **ve** SÜRE **ve** hız **ve**
 * doğruluk **ve** yön). Tek GPS gürültüsü reroute başlatamaz. **Bu tur o
 * makineyi YENİDEN KURMADI.**
 *
 * Ölçülen İKİ boşluk:
 *   1. `getRerouteBlockStats()` ÜRÜNDE HİÇBİR YERDEN OKUNMUYORDU — tek çağıranı
 *      bir testti. `routingService` yorumu "LAB'da görünür" diyordu; ölçüm bunu
 *      ÇÜRÜTTÜ.
 *   2. Kalıcı engelde (doğruluk sürekli eşik üstü) sürücü rota dışındayken
 *      SONSUZA KADAR yeni rota alamıyordu ve bu SESSİZDİ.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect } from 'vitest';

import {
  REROUTE_STARVED_MS,
  REROUTE_TRANSIENT_MS,
  judgeRerouteHealth,
  type RerouteHealthInput,
} from '../platform/navigation/core/rerouteStarvationModel';
import {
  MIN_EVIDENCE, requiredEvidenceFor, requiredEvidenceMsFor,
  ACTIONABLE_ACCURACY_M,
} from '../platform/navigation/core/offRouteModel';

const T0 = 1_000_000;

const base: RerouteHealthInput = {
  confirmedAtMs: T0,
  lastCommitAtMs: null,
  offRouteState: 'CONFIRMED_OFF_ROUTE',
  lastBlock: null,
  nowMs: T0 + 1_000,
};

const i = (over: Partial<RerouteHealthInput> = {}): RerouteHealthInput => ({ ...base, ...over });

/* ══════════════════════════════════════════════════════════════════════════
   1) MEVCUT MAKİNE — TEK GÜRÜLTÜ REROUTE BAŞLATAMAZ (kilit korunuyor)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-13 › çoklu kanıt kilidi korunuyor', () => {
  it('tek örnek ASLA yeterli değildir', () => {
    expect(MIN_EVIDENCE).toBeGreaterThanOrEqual(2);
    /* Her hız/doğruluk bileşiminde gereken örnek sayısı ≥ MIN_EVIDENCE. */
    for (const kmh of [null, 0, 10, 50, 120]) {
      for (const acc of [null, 5, 20, 60]) {
        expect(requiredEvidenceFor(kmh, acc, false),
          `kmh=${kmh} acc=${acc}`).toBeGreaterThanOrEqual(MIN_EVIDENCE);
      }
    }
  });

  it('SAYI kanıtının yanında SÜRE kanıtı da vardır', () => {
    for (const kmh of [null, 0, 30, 90]) {
      expect(requiredEvidenceMsFor(kmh, false), `kmh=${kmh}`).toBeGreaterThan(0);
    }
  });

  it('aksiyon eşiği ile karar eşiği AYNI sayıdır (iki katman ayrışmaz)', () => {
    /* Kütük #402: makine kötü doğruluklu fix'i kanıt sayıyor, routingService
       aynı fix'le rota kurmayı reddediyordu → sistem üzerine hareket
       EDEMEYECEĞİ bir karar üretiyordu. */
    expect(ACTIONABLE_ACCURACY_M).toBe(50);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) AÇLIK HÜKMÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-13 › reroute sağlığı', () => {
  it('doğrulanmış sapma YOKSA sağlık HEALTHY', () => {
    const v = judgeRerouteHealth(i({ confirmedAtMs: null }));
    expect(v.health).toBe('HEALTHY');
    /* Sapma yokken "0 sn'dir sapmış" DEMEZ — sahte 0 YASAK. */
    expect(v.offRouteForMs).toBeNull();
  });

  it('sapmadan SONRA rota uygulandıysa açlık BİTMİŞTİR', () => {
    const v = judgeRerouteHealth(i({
      lastCommitAtMs: T0 + 500, nowMs: T0 + 60_000,
    }));
    expect(v.health).toBe('HEALTHY');
  });

  it('sapmadan ÖNCEKİ commit açlığı bitirmez', () => {
    /* Eski rotanın commit'i yeni sapmayı iyileştirmiş SAYILMAZ. */
    const v = judgeRerouteHealth(i({
      lastCommitAtMs: T0 - 5_000, nowMs: T0 + REROUTE_STARVED_MS + 1,
    }));
    expect(v.health).toBe('STARVED');
  });

  it('istek YOLDAYSA açlık İDDİA EDİLMEZ', () => {
    const v = judgeRerouteHealth(i({
      offRouteState: 'REROUTING', nowMs: T0 + REROUTE_STARVED_MS + 10_000,
    }));
    expect(v.health).toBe('REROUTING');
  });

  it('kısa engel GEÇİCİ sayılır', () => {
    const v = judgeRerouteHealth(i({
      nowMs: T0 + REROUTE_TRANSIENT_MS - 1,
      lastBlock: { reason: 'THROTTLED', tsMs: T0 + 100 },
    }));
    expect(v.health).toBe('BLOCKED_TRANSIENT');
    expect(v.blockedBy).toBe('THROTTLED');
  });

  it('UZUN engel AÇLIKTIR ve sebebi taşınır', () => {
    const v = judgeRerouteHealth(i({
      nowMs: T0 + REROUTE_STARVED_MS + 1,
      lastBlock: { reason: 'WEAK_ACCURACY', tsMs: T0 + 100 },
    }));
    expect(v.health).toBe('STARVED');
    expect(v.blockedBy).toBe('WEAK_ACCURACY');
    expect(v.why).toContain('WEAK_ACCURACY');
    expect(v.offRouteForMs ?? 0).toBeGreaterThanOrEqual(REROUTE_STARVED_MS);
  });

  it('engel sebebi bildirilmese bile açlık ÖLÇÜLÜR', () => {
    const v = judgeRerouteHealth(i({
      nowMs: T0 + REROUTE_STARVED_MS + 1, lastBlock: null,
    }));
    expect(v.health).toBe('STARVED');
    expect(v.blockedBy).toBeNull();
    expect(v.why).toContain('bildirilmedi');
  });

  it('şimdiki zaman ölçülemezse hüküm UNKNOWN', () => {
    expect(judgeRerouteHealth(i({ nowMs: null })).health).toBe('UNKNOWN');
    expect(judgeRerouteHealth(i({ nowMs: NaN })).health).toBe('UNKNOWN');
  });

  it('eşikler mantıklı sırada (geçici < açlık)', () => {
    expect(REROUTE_TRANSIENT_MS).toBeLessThan(REROUTE_STARVED_MS);
  });

  it('geçmişe dönük saat sıçraması NEGATİF süre üretmez', () => {
    const v = judgeRerouteHealth(i({ nowMs: T0 - 10_000 }));
    expect(v.offRouteForMs ?? -1).toBeGreaterThanOrEqual(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) MODEL AKSİYON ALMAZ — DOĞRULUK KAPISI EZİLMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-13 › model karar üretmez', () => {
  it('açlık hükmü bir ALARMDIR, reroute TETİKLEMEZ', () => {
    /* Zayıf sinyalde rota kurmak yanlış yere rota kurmaktır (fail-closed) ve
       bu kural pazarlıksızdır. Model yalnız açlığı GÖRÜNÜR kılar. */
    const v = judgeRerouteHealth(i({
      nowMs: T0 + REROUTE_STARVED_MS * 10,
      lastBlock: { reason: 'WEAK_ACCURACY', tsMs: T0 },
    }));
    expect(v.health).toBe('STARVED');
    /* Hükmün içinde hiçbir "yap" alanı YOKTUR — yalnız ölçüm ve gerekçe. */
    expect(Object.keys(v).sort()).toEqual(
      ['blockedBy', 'health', 'offRouteForMs', 'why'],
    );
  });
});
