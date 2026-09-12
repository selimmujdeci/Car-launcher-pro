/**
 * P0-NAV-16 — SESLİ YÖNLENDİRME PLANLAYICISI (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * Zincir NAV-16'nın istediklerinin ÇOĞUNA zaten sahipti ve **bu tur onu
 * YENİDEN KURMADI**:
 *   · deterministik kimlik `oturum:rotaRevizyonu:adım` (yalnız adım indeksi
 *     kullanmak reroute sonrası "zaten söylendi" yanlışını üretiyordu — ZATEN
 *     düzeltilmiş)
 *   · üç kademe · **hıza uyarlanabilir** son kademe (~4 sn önce)
 *   · rota kimliği değişince kuyruk TEMİZLENİR
 *   · reroute sırasında manevra anonsu BASTIRILIR
 *   · mesafe kaynağı `UNKNOWN` iken KONUŞULMAZ (uydurma yasağı)
 *
 * Ölçülen boşluk: **runtime yalnız SÖYLENENİ sayıyordu.** NAV-16'nın dört
 * sorusundan (çok erken · çok geç · iki kez · HİÇ) yalnız "iki kez"
 * ölçülebiliyordu. Sürücünün gerçekten yaşadığı kusur ötekiler.
 *
 * SAF: ağ YOK · timer YOK · TTS YOK.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  LATE_RATIO, VERY_LATE_RATIO, GUIDANCE_AUDIT_RING,
  getGuidanceAudit, judgeAnnouncementTiming, judgeMissedGuidance,
  recordAnnouncementTiming, recordMissedGuidance, resetGuidanceAudit,
} from '../platform/navigation/core/voiceGuidanceAudit';
import {
  STAGE_BIT, FAR_TIER_M, NEAR_TIER_M, finalTierMetres,
} from '../platform/navigation/core/voiceGuidanceModel';

beforeEach(() => { resetGuidanceAudit(); });

/* ══════════════════════════════════════════════════════════════════════════
   1) "ÇOK GEÇ" ÖLÇÜLEBİLİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-16 › anons zamanlaması', () => {
  it('pencerenin başında söylenen anons ZAMANINDA', () => {
    expect(judgeAnnouncementTiming(580, FAR_TIER_M)).toBe('ON_TIME');
    expect(judgeAnnouncementTiming(240, NEAR_TIER_M)).toBe('ON_TIME');
  });

  it('pencerenin yarısından sonrası GEÇ', () => {
    expect(judgeAnnouncementTiming(NEAR_TIER_M * LATE_RATIO, NEAR_TIER_M)).toBe('LATE');
    expect(judgeAnnouncementTiming(100, NEAR_TIER_M)).toBe('LATE');
  });

  it('manevranın üstünde söylenen anons ÇOK GEÇ', () => {
    expect(judgeAnnouncementTiming(NEAR_TIER_M * VERY_LATE_RATIO, NEAR_TIER_M)).toBe('VERY_LATE');
    expect(judgeAnnouncementTiming(10, NEAR_TIER_M)).toBe('VERY_LATE');
  });

  it('son kademe HIZA bağlı eşikle yargılanır (sabit metre DEĞİL)', () => {
    /* 100 km/h'te son uyarı ~111 m'de olmalı; 55 m'de söylenmesi GEÇTİR.
       Aynı 55 m şehir içinde (30 km/h → eşik 35 m) ZAMANINDADIR. */
    const fastThreshold = finalTierMetres(100);
    const slowThreshold = finalTierMetres(30);
    expect(judgeAnnouncementTiming(55, fastThreshold)).toBe('LATE');
    expect(judgeAnnouncementTiming(55, slowThreshold)).toBe('ON_TIME');
  });

  it('ölçülemeyen girdi UNKNOWN üretir — sahte hüküm YOK', () => {
    expect(judgeAnnouncementTiming(null, 250)).toBe('UNKNOWN');
    expect(judgeAnnouncementTiming(100, null)).toBe('UNKNOWN');
    expect(judgeAnnouncementTiming(NaN, 250)).toBe('UNKNOWN');
    expect(judgeAnnouncementTiming(100, 0)).toBe('UNKNOWN');
    expect(judgeAnnouncementTiming(-5, 250)).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) "HİÇ SÖYLENMEDİ" ÖLÇÜLEBİLİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-16 › kaçırılan anons', () => {
  const ok = { hadUsableDistance: true, wasRerouting: false };

  it('tüm kademeler söylendiyse kusur YOK', () => {
    expect(judgeMissedGuidance({
      ...ok, spokenBits: STAGE_BIT.FAR | STAGE_BIT.NEAR | STAGE_BIT.IMMINENT,
    })).toBe('NONE');
  });

  it('SON uyarı söylenmediyse yakalanır', () => {
    expect(judgeMissedGuidance({
      ...ok, spokenBits: STAGE_BIT.FAR | STAGE_BIT.NEAR,
    })).toBe('MISSED_IMMINENT');
  });

  it('hiçbir kademe söylenmediyse yakalanır', () => {
    expect(judgeMissedGuidance({ ...ok, spokenBits: 0 })).toBe('MISSED_ALL');
  });

  it('⚠️ SESSİZLİK HER ZAMAN KUSUR DEĞİLDİR — mesafe kanıtı yoksa susmak DOĞRU', () => {
    /* `distanceSource === 'UNKNOWN'` iken konuşmamak ürünün fail-closed
       tasarımıdır; bunu kusur saymak doğru davranışı arıza gibi göstermek
       olurdu. */
    expect(judgeMissedGuidance({
      spokenBits: 0, hadUsableDistance: false, wasRerouting: false,
    })).toBe('SILENCE_JUSTIFIED');
  });

  it('reroute sırasındaki sessizlik de MEŞRUDUR', () => {
    expect(judgeMissedGuidance({
      spokenBits: 0, hadUsableDistance: true, wasRerouting: true,
    })).toBe('SILENCE_JUSTIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-16 › denetim defteri', () => {
  it('ZAMANINDA anonslar sayılır ama halkayı DOLDURMAZ', () => {
    for (let i = 0; i < 5; i++) {
      recordAnnouncementTiming(`m${i}`, 'NEAR', 240, NEAR_TIER_M, 1000 + i);
    }
    recordAnnouncementTiming('late', 'NEAR', 20, NEAR_TIER_M, 2000);

    const a = getGuidanceAudit();
    expect(a.timing.ON_TIME).toBe(5);
    expect(a.timing.VERY_LATE).toBe(1);
    expect(a.recent.length).toBe(1);            // yalnız geç olan saklandı
    expect(a.announcementCount).toBe(6);
  });

  it('MEŞRU sessizlik halkaya girmez ama sayılır', () => {
    recordMissedGuidance('m1', {
      spokenBits: 0, hadUsableDistance: false, wasRerouting: false,
    }, 1000);
    const a = getGuidanceAudit();
    expect(a.missed.SILENCE_JUSTIFIED).toBe(1);
    expect(a.recent.length).toBe(0);
    expect(a.maneuverCount).toBe(1);
  });

  it('GERÇEK kaçırma halkaya girer', () => {
    recordMissedGuidance('m1', {
      spokenBits: 0, hadUsableDistance: true, wasRerouting: false,
    }, 1000);
    const a = getGuidanceAudit();
    expect(a.missed.MISSED_ALL).toBe(1);
    expect(a.recent.length).toBe(1);
    expect(a.recent[0].missed).toBe('MISSED_ALL');
  });

  it('halka sınırlıdır ama sayaç kaybolmaz', () => {
    for (let i = 0; i < GUIDANCE_AUDIT_RING + 6; i++) {
      recordMissedGuidance(`m${i}`, {
        spokenBits: 0, hadUsableDistance: true, wasRerouting: false,
      }, 1000 + i);
    }
    const a = getGuidanceAudit();
    expect(a.recent.length).toBe(GUIDANCE_AUDIT_RING);
    expect(a.missed.MISSED_ALL).toBe(GUIDANCE_AUDIT_RING + 6);
  });

  it('boş defterde sahte sayı YOK', () => {
    const a = getGuidanceAudit();
    expect(a.announcementCount).toBe(0);
    expect(a.maneuverCount).toBe(0);
    expect(a.recent).toEqual([]);
  });

  it('kayıt yolu THROW ETMEZ (teşhis anonsu bozamaz)', () => {
    expect(() => recordAnnouncementTiming(
      'x', 'NEAR', null, null, 1,
    )).not.toThrow();
    expect(() => recordMissedGuidance(
      'x', undefined as unknown as { spokenBits: number; hadUsableDistance: boolean; wasRerouting: boolean }, 1,
    )).not.toThrow();
  });

  it('yeni oturum eski kusurları TAŞIMAZ', () => {
    recordMissedGuidance('m1', {
      spokenBits: 0, hadUsableDistance: true, wasRerouting: false,
    }, 1000);
    expect(getGuidanceAudit().missed.MISSED_ALL).toBe(1);
    resetGuidanceAudit();
    expect(getGuidanceAudit().missed.MISSED_ALL).toBe(0);
    expect(getGuidanceAudit().recent).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) MEVCUT PLANLAYICI KİLİTLERİ KORUNUYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-16 › mevcut kilitler korunuyor', () => {
  it('son kademe HIZA uyarlanır (sabit metre DEĞİL)', () => {
    /* Sabit 80 m şehir içinde erken, otoyolda geç kalıyordu — ölçülmüş kusur. */
    expect(finalTierMetres(30)).toBeLessThan(finalTierMetres(100));
    expect(finalTierMetres(0)).toBeGreaterThan(0);      // taban korunur
    expect(finalTierMetres(300)).toBeLessThanOrEqual(150); // tavan korunur
  });

  it('kademe eşikleri sıralı (uzaktan yakına)', () => {
    expect(FAR_TIER_M).toBeGreaterThan(NEAR_TIER_M);
    expect(NEAR_TIER_M).toBeGreaterThan(finalTierMetres(100));
  });

  it('kademe bitleri ayrık (maske çakışmaz)', () => {
    expect(STAGE_BIT.FAR & STAGE_BIT.NEAR).toBe(0);
    expect(STAGE_BIT.NEAR & STAGE_BIT.IMMINENT).toBe(0);
    expect(STAGE_BIT.FAR & STAGE_BIT.IMMINENT).toBe(0);
  });
});
