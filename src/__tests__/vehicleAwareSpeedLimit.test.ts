/**
 * vehicleAwareSpeedLimit.test.ts — VEHICLE_AWARE_SPEED_LIMIT_P0 kilitleri.
 *
 * Kapsam (görev §13):
 *   A. Araç sınıfı çözümleme (VIN, kullanıcı, çelişki, belirsizlik, bayatlık)
 *   B. Türkiye politika tablosu (yol sınıfları, sürüm, kaynak)
 *   C. Uygulanabilir sınır otoritesi (min kuralı, fail-closed durumlar)
 *   D. UI bağlantısı (tek motor, iki ekran aynı kart)
 *   E. Gizlilik + saflık
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

import classSrc     from '../platform/vehicle/legalVehicleClass.ts?raw';
import policySrc    from '../platform/navigation/policy/turkeySpeedPolicy.ts?raw';
import authoritySrc from '../platform/navigation/core/vehicleAwareSpeedLimitAuthority.ts?raw';
import roadClassSrc from '../platform/navigation/policy/roadClassResolver.ts?raw';
import hudSrc       from '../components/map/NavigationHUD.tsx?raw';
import miniSrc      from '../components/map/MiniMapWidget.tsx?raw';
import cardSrc      from '../components/map/SpeedLimitCard.tsx?raw';
import promptSrc    from '../components/map/VehicleClassPrompt.tsx?raw';
import researchSrc  from '../platform/vehicle/vehicleClassResearch.ts?raw';

import {
  resolveVehicleClass, claimFromUserChoice, maskVin, vinResearchPrefix,
  isValidVin, isVehicleClassApplicable, EMPTY_VEHICLE_CLASS_PROFILE,
  type VehicleClassClaim, type VehicleClassProfile,
} from '../platform/vehicle/legalVehicleClass';
import {
  vehicleClassCap, TURKEY_SPEED_POLICY, POLICY_VERSION, POLICY_TABLE_ROAD_CLASSES,
} from '../platform/navigation/policy/turkeySpeedPolicy';
import { resolveRoadClass } from '../platform/navigation/policy/roadClassResolver';
import {
  computeEffectiveSpeedLimit, isEffectiveLimitDisplayable, isEffectiveLimitDefinitive,
} from '../platform/navigation/core/vehicleAwareSpeedLimitAuthority';
import {
  parseResearchResponse, confidenceFromAgreement,
} from '../platform/vehicle/vehicleClassResearch';
import {
  shouldPromptVehicleClass, vehicleClassKey, maskVehicleClassKey,
} from '../platform/vehicle/vehicleClassRuntime';
import type { SpeedLimitVerdict } from '../platform/navigation/core/speedLimitTruthModel';

/** Yorumları soyar — yapısal kilitler AÇIKLAMA metnini değil KODU denetler. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

const NOW = 1_700_000_000_000;

const ref = (title: string) => ({
  url: 'https://example.org/kaynak', title, retrievedAt: NOW,
});

function claim(over: Partial<VehicleClassClaim> = {}): VehicleClassClaim {
  return {
    legalVehicleCategory: 'N1',
    registrationBodyType: 'PICKUP',
    source: 'TRUSTED_DATABASE',
    confidence: 0.7,
    verifiedAt: NOW,
    expiresAt: null,
    sourceRefs: [ref('Kaynak A')],
    ...over,
  };
}

/** Yol hükmü üretici — `speedLimitTruthModel` çıktısını taklit eder. */
function road(kmh: number | null, over: Partial<SpeedLimitVerdict> = {}): SpeedLimitVerdict {
  return {
    state: kmh === null ? 'UNKNOWN' : 'AVAILABLE',
    kmh,
    source: kmh === null ? null : 'osm',
    ageMs: 5_000,
    distanceFromFixM: 20,
    confidence: 0.9,
    reason: 'test',
    ...over,
  };
}

function profile(over: Partial<VehicleClassProfile> = {}): VehicleClassProfile {
  return { ...EMPTY_VEHICLE_CLASS_PROFILE, ...over };
}

const MOTORWAY = resolveRoadClass({ highway: 'motorway', postedKmh: 130, postedSource: 'osm' });

/* ══════════════════════════════════════════════════════════════════════════
   A. ARAÇ SINIFI ÇÖZÜMLEME
   ══════════════════════════════════════════════════════════════════════════ */
describe('A. Araç sınıfı çözümleme', () => {
  it('kanıt yoksa UNAVAILABLE — otomobil VARSAYILMAZ', () => {
    const p = resolveVehicleClass({ claims: [], nowMs: NOW });
    expect(p.resolutionState).toBe('UNAVAILABLE');
    expect(p.legalVehicleCategory).toBe('UNKNOWN');
    expect(isVehicleClassApplicable(p)).toBe(false);
  });

  it('tek otoriter kanıt + yüksek güven → VERIFIED', () => {
    const p = resolveVehicleClass({
      claims: [claim({ source: 'OFFICIAL_VIN_LOOKUP', confidence: 0.9 })], nowMs: NOW,
    });
    expect(p.resolutionState).toBe('VERIFIED');
    expect(p.legalVehicleCategory).toBe('N1');
  });

  it('otoriter olmayan tek kanıt → PROBABLE (VERIFIED DEĞİL)', () => {
    const p = resolveVehicleClass({ claims: [claim()], nowMs: NOW });
    expect(p.resolutionState).toBe('PROBABLE');
  });

  it('iki kaynak UYUMLU → tek aday, en yüksek güven temsil eder', () => {
    const p = resolveVehicleClass({
      claims: [claim({ confidence: 0.6 }), claim({ confidence: 0.75, source: 'MANUFACTURER_DATA' })],
      nowMs: NOW,
    });
    expect(p.resolutionState).toBe('PROBABLE');
    expect(p.confidence).toBeCloseTo(0.75);
    expect(p.candidates).toHaveLength(2);
  });

  it('iki kaynak ÇELİŞKİLİ → AMBIGUOUS, hiçbiri seçilmez', () => {
    const p = resolveVehicleClass({
      claims: [claim(), claim({ registrationBodyType: 'PANELVAN' })], nowMs: NOW,
    });
    expect(p.resolutionState).toBe('AMBIGUOUS');
    expect(p.legalVehicleCategory).toBe('UNKNOWN');
    expect(p.candidates).toHaveLength(2);
  });

  it('süresi dolmuş tüm kanıtlar → STALE, sınıf UYGULANMAZ', () => {
    const p = resolveVehicleClass({
      claims: [claim({ expiresAt: NOW - 1 })], nowMs: NOW,
    });
    expect(p.resolutionState).toBe('STALE');
    expect(isVehicleClassApplicable(p)).toBe(false);
  });

  it('kullanıcı beyanı internete ÜSTÜN gelir — ama sessizce DEĞİL (CONFLICTED)', () => {
    const user = claimFromUserChoice('PANELVAN_N1', NOW)!;
    const p = resolveVehicleClass({ claims: [claim(), user], nowMs: NOW });
    expect(p.registrationBodyType).toBe('PANELVAN');       // kullanıcı uygulandı
    expect(p.source).toBe('USER_CONFIRMED');
    expect(p.resolutionState).toBe('CONFLICTED');           // çelişki İLAN EDİLDİ
    expect(isVehicleClassApplicable(p)).toBe(true);
  });

  it('kullanıcı beyanı dış kaynakla UYUMLUYSA → VERIFIED', () => {
    const user = claimFromUserChoice('PICKUP_N1', NOW)!;
    const p = resolveVehicleClass({ claims: [claim(), user], nowMs: NOW });
    expect(p.resolutionState).toBe('VERIFIED');
  });

  it('"Bilmiyorum" bir SINIF BEYANI değildir → kanıt üretmez', () => {
    expect(claimFromUserChoice('DONT_KNOW', NOW)).toBeNull();
  });

  it('VIN doğrulama ve maskeleme — tam VIN sızmaz', () => {
    const vin = 'ZFA26300006123456';
    expect(isValidVin(vin)).toBe(true);
    expect(isValidVin('ZFA2630000612345')).toBe(false);     // 16 hane
    expect(isValidVin('ZFA26300006I2345')).toBe(false);     // yasak harf I
    const masked = maskVin(vin)!;
    expect(masked).toBe('ZFA…56');
    expect(masked).not.toContain(vin);
    expect(masked.length).toBeLessThan(vin.length);
  });

  it('araştırma öneki 9 HANEDİR — seri numarası taşımaz', () => {
    const vin = 'ZFA26300006123456';
    const prefix = vinResearchPrefix(vin)!;
    expect(prefix).toHaveLength(9);
    expect(vin.endsWith(prefix)).toBe(false);
    expect(vin.slice(9)).not.toContain(prefix);
  });

  it('VIN yoksa araştırma öneki üretilmez', () => {
    expect(vinResearchPrefix(null)).toBeNull();
    expect(vinResearchPrefix('YOK')).toBeNull();
  });

  it('araç anahtarı araç DEĞİŞİNCE değişir — kanıt taşınmaz', () => {
    const a = vehicleClassKey({ vin: 'ZFA26300006123456', make: null, model: null, modelYear: null });
    const b = vehicleClassKey({ vin: 'VF1BM0A0H12345678', make: null, model: null, modelYear: null });
    expect(a).not.toBe(b);
    // VIN yoksa marka|model|yıl
    expect(vehicleClassKey({ vin: null, make: 'Fiat', model: 'Doblo', modelYear: 2016 }))
      .toBe('mmy:FIAT|DOBLO|2016');
    // Kimlik hiç yoksa anahtar YOK → kanıt saklanmaz
    expect(vehicleClassKey({ vin: null, make: null, model: null, modelYear: null })).toBeNull();
  });

  it('LAB anahtarı maskelidir', () => {
    expect(maskVehicleClassKey('vin9:ZFA263000')).toBe('vin9:ZFA…00');
    expect(maskVehicleClassKey(null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. TÜRKİYE POLİTİKA TABLOSU
   ══════════════════════════════════════════════════════════════════════════ */
describe('B. Türkiye hız politikası', () => {
  it('tablo VERSİYONLU ve KAYNAKLIDIR — her satır künyeli', () => {
    expect(POLICY_VERSION).toMatch(/^TR-\d{4}\.\d{2}\.\d{2}$/);
    for (const r of TURKEY_SPEED_POLICY) {
      expect(r.countryCode).toBe('TR');
      expect(r.policyVersion).toBe(POLICY_VERSION);
      expect(r.sourceRef).toMatch(/^https:\/\//);
      expect(r.sourceAuthority.length).toBeGreaterThan(10);
      expect(r.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('tablo tüm politika yol sınıflarını kapsar', () => {
    const cats = new Set(TURKEY_SPEED_POLICY.map((r) => `${r.legalVehicleCategory}/${r.registrationBodyType}`));
    for (const key of cats) {
      const rows = TURKEY_SPEED_POLICY.filter(
        (r) => `${r.legalVehicleCategory}/${r.registrationBodyType}` === key);
      expect(rows).toHaveLength(POLICY_TABLE_ROAD_CLASSES.length);
    }
  });

  it('otomobil M1 — şehir içi 50, şehirlerarası 90, bölünmüş 110', () => {
    const q = (roadClass: Parameters<typeof vehicleClassCap>[0]['roadClass']) =>
      vehicleClassCap({ legalVehicleCategory: 'M1', registrationBodyType: 'AUTOMOBILE', roadClass }).capKmh;
    expect(q('URBAN')).toBe(50);
    expect(q('INTERURBAN_TWO_WAY')).toBe(90);
    expect(q('DIVIDED_HIGHWAY')).toBe(110);
  });

  it('kamyonet N1 — otoyol 95, bölünmüş 85, şehirlerarası 80', () => {
    const q = (roadClass: Parameters<typeof vehicleClassCap>[0]['roadClass']) =>
      vehicleClassCap({ legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP', roadClass }).capKmh;
    expect(q('MOTORWAY_KGM')).toBe(95);
    expect(q('MOTORWAY_YID')).toBe(95);
    expect(q('DIVIDED_HIGHWAY')).toBe(85);
    expect(q('INTERURBAN_TWO_WAY')).toBe(80);
  });

  it('panelvan N1 — kamyonetten AYRI ve DAHA YÜKSEK (RG 21/3/2012)', () => {
    const q = (roadClass: Parameters<typeof vehicleClassCap>[0]['roadClass']) =>
      vehicleClassCap({ legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN', roadClass }).capKmh;
    expect(q('MOTORWAY_KGM')).toBe(110);
    expect(q('DIVIDED_HIGHWAY')).toBe(100);
    expect(q('INTERURBAN_TWO_WAY')).toBe(85);
  });

  it('KGM/YİD otoyol ayrımı M1 için tabloda VARDIR', () => {
    const kgm = TURKEY_SPEED_POLICY.find((r) => r.legalVehicleCategory === 'M1' && r.roadClass === 'MOTORWAY_KGM');
    const yid = TURKEY_SPEED_POLICY.find((r) => r.legalVehicleCategory === 'M1' && r.roadClass === 'MOTORWAY_YID');
    expect(kgm?.statutoryLimitKmh).toBe(130);
    expect(yid?.statutoryLimitKmh).toBe(140);
  });

  it('gövde cinsi BİLİNMEZKEN N1 → en DÜŞÜK aday (muhafazakâr) + ambiguous', () => {
    const r = vehicleClassCap({
      legalVehicleCategory: 'N1', registrationBodyType: 'UNKNOWN', roadClass: 'MOTORWAY_KGM',
    });
    expect(r.ambiguous).toBe(true);
    expect(r.capKmh).toBe(95);                     // panelvan 110 DEĞİL
    expect(r.candidateCapsKmh).toEqual([95, 110]);
  });

  it('sınıf UNKNOWN → tavan YOK (otomobil varsayılmaz)', () => {
    const r = vehicleClassCap({
      legalVehicleCategory: 'UNKNOWN', registrationBodyType: 'UNKNOWN', roadClass: 'MOTORWAY_KGM',
    });
    expect(r.capKmh).toBeNull();
    expect(r.reason).toContain('VARSAYILMAZ');
  });

  it('traktör otoyola GİREMEZ → tavan null', () => {
    const r = vehicleClassCap({
      legalVehicleCategory: 'UNKNOWN', registrationBodyType: 'TRACTOR', roadClass: 'MOTORWAY_KGM',
    });
    expect(r.capKmh).toBeNull();
  });

  it('levha sınıfları politika tablosunda YOKTUR (levha yoldan gelir)', () => {
    for (const rc of ['LOCAL_SIGN_OVERRIDE', 'TEMPORARY_SIGN', 'UNKNOWN'] as const) {
      expect(vehicleClassCap({
        legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP', roadClass: rc,
      }).capKmh).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B2. YOL SINIFI ÇÖZÜMLEYİCİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('B2. Yol sınıfı çözümleyici', () => {
  it('motorway etiketi → otoyol, işletmeci BİLİNMEZ', () => {
    const v = resolveRoadClass({ highway: 'motorway', postedKmh: null, postedSource: null });
    expect(v.roadClass).toBe('MOTORWAY_KGM');
    expect(v.motorwayOperatorKnown).toBe(false);
  });

  it('okunan levha yol sınıfını ayırt eder', () => {
    expect(resolveRoadClass({ highway: 'primary', postedKmh: 50, postedSource: 'osm' }).roadClass)
      .toBe('URBAN');
    expect(resolveRoadClass({ highway: 'primary', postedKmh: 90, postedSource: 'osm' }).roadClass)
      .toBe('INTERURBAN_TWO_WAY');
    expect(resolveRoadClass({ highway: 'primary', postedKmh: 110, postedSource: 'osm' }).roadClass)
      .toBe('DIVIDED_HIGHWAY');
  });

  it('ÇIKARIM levhası sınıf belirlemede KULLANILMAZ (döngüsel olurdu)', () => {
    const v = resolveRoadClass({ highway: 'primary', postedKmh: 90, postedSource: 'inferred' });
    expect(v.roadClass).toBe('UNKNOWN');
  });

  it('levhasız primary/secondary → UNKNOWN (şehir içi mi dışı mı bilinmez)', () => {
    expect(resolveRoadClass({ highway: 'secondary', postedKmh: null, postedSource: null }).roadClass)
      .toBe('UNKNOWN');
  });

  it('residential → yerleşim içi (levhasız bile)', () => {
    expect(resolveRoadClass({ highway: 'residential', postedKmh: null, postedSource: null }).roadClass)
      .toBe('URBAN');
  });

  it('hiç sinyal yoksa UNKNOWN, güven 0', () => {
    const v = resolveRoadClass({ highway: null, postedKmh: null, postedSource: null });
    expect(v.roadClass).toBe('UNKNOWN');
    expect(v.confidence).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C. UYGULANABİLİR SINIR OTORİTESİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('C. Uygulanabilir sınır otoritesi', () => {
  const N1_PICKUP = profile({
    legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP',
    source: 'USER_CONFIRMED', confidence: 0.95, resolutionState: 'VERIFIED',
  });
  const M1 = profile({
    legalVehicleCategory: 'M1', registrationBodyType: 'AUTOMOBILE',
    source: 'USER_CONFIRMED', confidence: 0.95, resolutionState: 'VERIFIED',
  });

  it('yol 130 + N1 kamyonet tavan 95 → 95 (ARAÇ SINIRI)', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(130), roadClass: MOTORWAY, vehicleClass: N1_PICKUP,
    });
    expect(v.effectiveLimitKmh).toBe(95);
    expect(v.state).toBe('AVAILABLE');
    expect(v.effectiveLimitReason).toBe('VEHICLE_CLASS_CAP');
    expect(v.sourceLabel).toBe('ARAÇ SINIRI');
  });

  it('yol 110 + N1 kamyonet (bölünmüş yol tavanı 85) → 85', () => {
    const rc = resolveRoadClass({ highway: 'trunk', postedKmh: 110, postedSource: 'osm' });
    const v = computeEffectiveSpeedLimit({ road: road(110), roadClass: rc, vehicleClass: N1_PICKUP });
    expect(v.effectiveLimitKmh).toBe(85);
    expect(v.effectiveLimitReason).toBe('VEHICLE_CLASS_CAP');
  });

  it('yol 70 + N1 tavan 85 → 70 (levha daha düşük, tablo YÜKSELTMEZ)', () => {
    const rc = resolveRoadClass({ highway: 'trunk', postedKmh: 70, postedSource: 'osm' });
    const v = computeEffectiveSpeedLimit({ road: road(70), roadClass: rc, vehicleClass: N1_PICKUP });
    expect(v.effectiveLimitKmh).toBe(70);
    expect(v.effectiveLimitReason).toBe('ROAD_POSTED');
    expect(v.sourceLabel).toBe('YOL SINIRI');
  });

  it('yerel DÜŞÜK levha araç tablosuyla YÜKSELTİLMEZ', () => {
    // Otoyolda şantiye levhası 50: M1 tavanı 140 olsa da sonuç 50 kalır.
    const v = computeEffectiveSpeedLimit({
      road: road(50), roadClass: MOTORWAY, vehicleClass: M1,
    });
    expect(v.effectiveLimitKmh).toBe(50);
    expect(v.effectiveLimitKmh).toBeLessThan(v.vehicleClassCapKmh as number);
  });

  it('yol 130 + M1 otomobil → 130 (tavan bağlamaz)', () => {
    const v = computeEffectiveSpeedLimit({ road: road(130), roadClass: MOTORWAY, vehicleClass: M1 });
    expect(v.effectiveLimitKmh).toBe(130);
    expect(v.effectiveLimitReason).toBe('ROAD_POSTED');
  });

  it('araç sınıfı UNKNOWN → ROAD_ONLY, "YOL SINIRI" etiketi, otomobil VARSAYILMAZ', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(130), roadClass: MOTORWAY, vehicleClass: EMPTY_VEHICLE_CLASS_PROFILE,
    });
    expect(v.state).toBe('ROAD_ONLY');
    expect(v.effectiveLimitKmh).toBe(130);
    expect(v.vehicleClassCapKmh).toBeNull();
    expect(v.sourceLabel).toBe('YOL SINIRI');
    expect(isEffectiveLimitDefinitive(v)).toBe(false);
  });

  it('yol sınıfı UNKNOWN → araç tavanı UYGULANMAZ (kesin sınır üretilmez)', () => {
    const rc = resolveRoadClass({ highway: 'secondary', postedKmh: null, postedSource: null });
    const v = computeEffectiveSpeedLimit({ road: road(90), roadClass: rc, vehicleClass: N1_PICKUP });
    expect(v.state).toBe('ROAD_ONLY');
    expect(v.vehicleClassCapKmh).toBeNull();
  });

  it('yol sınırı YOK + araç tavanı VAR → VEHICLE_ONLY, sayı ÜRETİLMEZ', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(null), roadClass: MOTORWAY, vehicleClass: N1_PICKUP,
    });
    expect(v.state).toBe('VEHICLE_ONLY');
    expect(v.effectiveLimitKmh).toBeNull();
    expect(v.vehicleClassCapKmh).toBe(95);
    expect(isEffectiveLimitDisplayable(v)).toBe(false);
  });

  it('yol BAYAT → STALE, sayı YOK (eski yolun limiti taşınmaz)', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(null, { state: 'STALE', reason: 'araç uzaklaştı' }),
      roadClass: MOTORWAY, vehicleClass: N1_PICKUP,
    });
    expect(v.state).toBe('STALE');
    expect(v.effectiveLimitKmh).toBeNull();
    expect(isEffectiveLimitDisplayable(v)).toBe(false);
  });

  it('yol ÇELİŞKİLİ → CONFLICTED, sayı YOK', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(null, { state: 'CONFLICTED', reason: 'çelişen limitler' }),
      roadClass: MOTORWAY, vehicleClass: N1_PICKUP,
    });
    expect(v.state).toBe('CONFLICTED');
    expect(v.effectiveLimitKmh).toBeNull();
  });

  it('araç sınıfı BELİRSİZ → AMBIGUOUS + en düşük tavan uygulanır', () => {
    const n1Unknown = profile({
      legalVehicleCategory: 'N1', registrationBodyType: 'UNKNOWN',
      source: 'TRUSTED_DATABASE', confidence: 0.6, resolutionState: 'PROBABLE',
    });
    const v = computeEffectiveSpeedLimit({
      road: road(130), roadClass: MOTORWAY, vehicleClass: n1Unknown,
    });
    expect(v.state).toBe('AMBIGUOUS');
    expect(v.effectiveLimitKmh).toBe(95);
    expect(v.effectiveLimitReason).toBe('AMBIGUOUS_CLASS_CONSERVATIVE');
    expect(isEffectiveLimitDefinitive(v)).toBe(false);
  });

  it('kullanıcı↔internet çelişkisi → CONFLICTED ama muhafazakâr sayı üretilir', () => {
    const conflicted = profile({
      legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP',
      source: 'USER_CONFIRMED', confidence: 0.95, resolutionState: 'CONFLICTED',
    });
    const v = computeEffectiveSpeedLimit({
      road: road(130), roadClass: MOTORWAY, vehicleClass: conflicted,
    });
    expect(v.state).toBe('CONFLICTED');
    expect(v.effectiveLimitKmh).toBe(95);
    expect(v.effectiveLimitReason).toBe('VEHICLE_CLASS_CONFLICT');
  });

  it('sınır ASLA yol sınırının ÜSTÜNE çıkmaz — kaba kuvvet taraması', () => {
    const bodies = ['AUTOMOBILE', 'PICKUP', 'PANELVAN', 'MINIBUS', 'UNKNOWN'] as const;
    const cats = ['M1', 'M2', 'N1', 'N2', 'UNKNOWN'] as const;
    for (const kmh of [30, 50, 70, 82, 90, 110, 120, 130, 140]) {
      for (const cat of cats) {
        for (const body of bodies) {
          const v = computeEffectiveSpeedLimit({
            road: road(kmh),
            roadClass: MOTORWAY,
            vehicleClass: profile({
              legalVehicleCategory: cat, registrationBodyType: body,
              source: 'USER_CONFIRMED', confidence: 0.9,
              resolutionState: cat === 'UNKNOWN' && body === 'UNKNOWN' ? 'UNAVAILABLE' : 'VERIFIED',
            }),
          });
          if (v.effectiveLimitKmh !== null) {
            expect(v.effectiveLimitKmh).toBeLessThanOrEqual(kmh);
          }
        }
      }
    }
  });

  it('AVAILABLE dışında hiçbir durum "kesin" sayılmaz', () => {
    const states = ['ROAD_ONLY', 'AMBIGUOUS', 'CONFLICTED'] as const;
    for (const s of states) {
      expect(isEffectiveLimitDefinitive({
        ...computeEffectiveSpeedLimit({
          road: road(130), roadClass: MOTORWAY, vehicleClass: EMPTY_VEHICLE_CLASS_PROFILE,
        }),
        state: s,
      })).toBe(false);
    }
  });

  it('bilinmeyen değer ASLA 0 gösterilmez', () => {
    const v = computeEffectiveSpeedLimit({
      road: road(null), roadClass: MOTORWAY, vehicleClass: EMPTY_VEHICLE_CLASS_PROFILE,
    });
    expect(v.effectiveLimitKmh).toBeNull();
    expect(v.effectiveLimitKmh).not.toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C2. DOBLO ÖZEL DOĞRULAMA (görev §8)
   ══════════════════════════════════════════════════════════════════════════ */
describe('C2. Fiat Doblo varyantları — AYNI YOL, FARKLI SINIR', () => {
  const dobloIdentity = { make: 'Fiat', model: 'Doblo', modelYear: 2016, vin: 'ZFA26300006123456' };
  const onMotorway130 = (vc: VehicleClassProfile) =>
    computeEffectiveSpeedLimit({ road: road(130), roadClass: MOTORWAY, vehicleClass: vc });

  const resolveWith = (claims: VehicleClassClaim[]) =>
    resolveVehicleClass({ claims, nowMs: NOW, ...dobloIdentity });

  it('Doblo M1 otomobil → 130', () => {
    const p = resolveWith([claimFromUserChoice('AUTOMOBILE_M1', NOW)!]);
    expect(onMotorway130(p).effectiveLimitKmh).toBe(130);
  });

  it('Doblo N1 kamyonet → 95', () => {
    const p = resolveWith([claimFromUserChoice('PICKUP_N1', NOW)!]);
    expect(onMotorway130(p).effectiveLimitKmh).toBe(95);
  });

  it('Doblo N1 panelvan → 110', () => {
    const p = resolveWith([claimFromUserChoice('PANELVAN_N1', NOW)!]);
    expect(onMotorway130(p).effectiveLimitKmh).toBe(110);
  });

  it('üç varyant AYNI yolda ÜÇ FARKLI sınır üretir', () => {
    const vals = (['AUTOMOBILE_M1', 'PICKUP_N1', 'PANELVAN_N1'] as const)
      .map((c) => onMotorway130(resolveWith([claimFromUserChoice(c, NOW)!])).effectiveLimitKmh);
    expect(new Set(vals).size).toBe(3);
    expect(vals).toEqual([130, 95, 110]);
  });

  it('model/yıl belirsiz + kaynak yok → sınıf UNKNOWN, kart YOL SINIRI', () => {
    const p = resolveVehicleClass({ claims: [], nowMs: NOW, make: 'Fiat', model: 'Doblo' });
    const v = onMotorway130(p);
    expect(v.state).toBe('ROAD_ONLY');
    expect(v.sourceLabel).toBe('YOL SINIRI');
  });

  it('internet kaynakları ÇELİŞKİLİ (M1 vs N1) → AMBIGUOUS, tavan uygulanmaz', () => {
    const p = resolveWith([
      claim({ legalVehicleCategory: 'M1', registrationBodyType: 'AUTOMOBILE' }),
      claim({ legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN' }),
    ]);
    expect(p.resolutionState).toBe('AMBIGUOUS');
    const v = onMotorway130(p);
    expect(v.state).toBe('ROAD_ONLY');
    expect(v.vehicleClassCapKmh).toBeNull();
  });

  it('VIN bulunamadı → marka/model anahtarı kullanılır, sınıf uydurulmaz', () => {
    const p = resolveVehicleClass({ claims: [], nowMs: NOW, make: 'Fiat', model: 'Doblo', vin: null });
    expect(p.vinMasked).toBeNull();
    expect(p.legalVehicleCategory).toBe('UNKNOWN');
  });

  it('kullanıcı "bilmiyorum" dedi → sınıf UNKNOWN kalır', () => {
    const p = resolveWith([]);
    expect(p.legalVehicleCategory).toBe('UNKNOWN');
    expect(isVehicleClassApplicable(p)).toBe(false);
  });

  it('N1 biliniyor ama gövde bilinmiyor → 95 (panelvan varsayılmaz)', () => {
    const p = resolveWith([claim({ legalVehicleCategory: 'N1', registrationBodyType: 'UNKNOWN' })]);
    expect(onMotorway130(p).effectiveLimitKmh).toBe(95);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C3. ARAŞTIRMA YANITI DOĞRULAMA
   ══════════════════════════════════════════════════════════════════════════ */
describe('C3. Araştırma yanıtı — dış veri ASLA güvenilmez', () => {
  it('künyesiz kanıt REDDEDİLİR', () => {
    const claims = parseResearchResponse({
      results: [{ legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN', source: 'TRUSTED_DATABASE' }],
    }, NOW);
    expect(claims).toHaveLength(0);
  });

  it('geçersiz kategori/kaynak REDDEDİLİR', () => {
    const claims = parseResearchResponse({
      results: [
        { legalVehicleCategory: 'X9', source: 'TRUSTED_DATABASE', sourceRefs: [ref('a')] },
        { legalVehicleCategory: 'N1', source: 'RASTGELE_BLOG', sourceRefs: [ref('b')] },
      ],
    }, NOW);
    expect(claims).toHaveLength(0);
  });

  it('https OLMAYAN künye REDDEDİLİR (javascript:/data: dahil)', () => {
    const claims = parseResearchResponse({
      results: [{
        legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN', source: 'TRUSTED_DATABASE',
        sourceRefs: [{ url: 'javascript:alert(1)', title: 'kötü' }, { url: 'http://x.tr', title: 'düz' }],
      }],
    }, NOW);
    expect(claims).toHaveLength(0);
  });

  it('geçerli kanıt kabul edilir ve TTL taşır', () => {
    const claims = parseResearchResponse({
      results: [{
        legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN',
        source: 'OFFICIAL_VIN_LOOKUP', agreementCount: 2, sourceRefs: [ref('Tip onayı')],
      }],
    }, NOW);
    expect(claims).toHaveLength(1);
    expect(claims[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(claims[0].expiresAt).toBeGreaterThan(NOW);
  });

  it('TEK kaynak VERIFIED üretecek güveni alamaz (veri tabanı)', () => {
    expect(confidenceFromAgreement('TRUSTED_DATABASE', 1)).toBeLessThan(0.8);
    const p = resolveVehicleClass({
      claims: [claim({ source: 'TRUSTED_DATABASE', confidence: confidenceFromAgreement('TRUSTED_DATABASE', 1) })],
      nowMs: NOW,
    });
    expect(p.resolutionState).toBe('PROBABLE');
  });

  it('yanıt en fazla 4 kanıtla sınırlıdır (şişkin yanıt budanır)', () => {
    const one = {
      legalVehicleCategory: 'N1', registrationBodyType: 'PANELVAN',
      source: 'TRUSTED_DATABASE', sourceRefs: [ref('x')],
    };
    expect(parseResearchResponse({ results: Array(20).fill(one) }, NOW).length).toBeLessThanOrEqual(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. SORU KAPISI + UI BAĞLANTISI
   ══════════════════════════════════════════════════════════════════════════ */
describe('D. Soru kapısı — sürüşte ASLA', () => {
  const snap = (over: Record<string, unknown> = {}) => ({
    key: 'mmy:FIAT|DOBLO|2016',
    profile: EMPTY_VEHICLE_CLASS_PROFILE,
    researchOutcome: 'UNAVAILABLE' as const,
    researchAttemptedAt: NOW, researchFailureReason: null,
    promptDismissedAt: null, vinMasked: null, hasVin: false,
    ...over,
  });

  it('araç DURURKEN ve sınıf bilinmezken sorulur', () => {
    expect(shouldPromptVehicleClass({ snapshot: snap(), speedKmh: 0 })).toBe(true);
  });

  it('araç HAREKET HÂLİNDEYSE sorulmaz', () => {
    expect(shouldPromptVehicleClass({ snapshot: snap(), speedKmh: 40 })).toBe(false);
  });

  it('hız BİLİNMİYORSA sorulmaz (fail-closed)', () => {
    expect(shouldPromptVehicleClass({ snapshot: snap(), speedKmh: null })).toBe(false);
  });

  it('araç kimliği yoksa sorulmaz', () => {
    expect(shouldPromptVehicleClass({ snapshot: snap({ key: null }), speedKmh: 0 })).toBe(false);
  });

  it('kullanıcı daha önce kapattıysa bir daha sorulmaz', () => {
    expect(shouldPromptVehicleClass({
      snapshot: snap({ promptDismissedAt: NOW }), speedKmh: 0,
    })).toBe(false);
  });

  it('kullanıcı zaten beyan ettiyse sorulmaz', () => {
    expect(shouldPromptVehicleClass({
      snapshot: snap({
        profile: profile({
          legalVehicleCategory: 'N1', registrationBodyType: 'PICKUP',
          source: 'USER_CONFIRMED', resolutionState: 'VERIFIED',
        }),
      }),
      speedKmh: 0,
    })).toBe(false);
  });

  it('sınıf BELİRSİZSE (Doblo) durunca yine sorulur', () => {
    expect(shouldPromptVehicleClass({
      snapshot: snap({ profile: profile({ resolutionState: 'AMBIGUOUS' }) }), speedKmh: 0,
    })).toBe(true);
  });
});

describe('D2. 🔒 UI — tek motor, iki ekran aynı kart', () => {
  it('🔒 mini harita ve tam ekran AYNI hook\'u kullanır', () => {
    expect(code(miniSrc)).toContain('useEffectiveSpeedLimit()');
    expect(code(hudSrc)).toContain('useEffectiveSpeedLimit()');
  });

  it('🔒 iki ekran AYNI kart bileşenini render eder', () => {
    expect(code(miniSrc)).toContain('<SpeedLimitCard');
    expect(code(hudSrc)).toContain('<SpeedLimitCard');
  });

  it('🔒 tam ekran KENDİ sorgu döngüsünü açmaz', () => {
    expect(code(hudSrc)).not.toContain('useSpeedLimitByLocation');
  });

  it('🔒 kart, kaynak etiketini GÖSTERİR (sayı tek başına yeterli değil)', () => {
    expect(code(cardSrc)).toContain('limit.sourceLabel');
  });

  it('🔒 kesin OLMAYAN sayı kesikli çerçeveyle ayrılır', () => {
    expect(code(cardSrc)).toContain("definitive ? 'solid' : 'dashed'");
  });

  it('🔒 soru MODAL DEĞİLDİR (overlay/backdrop yok)', () => {
    const src = code(promptSrc);
    expect(src).not.toContain('fixed inset-0');
    expect(src).not.toContain('backdrop');
    expect(src).toContain('shouldPromptVehicleClass');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E. SAFLIK + GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */
describe('E. 🔒 Saflık ve gizlilik', () => {
  it('🔒 saf katmanlar I/O · saat · React KULLANMAZ', () => {
    for (const [name, src] of [
      ['legalVehicleClass', classSrc],
      ['turkeySpeedPolicy', policySrc],
      ['vehicleAwareSpeedLimitAuthority', authoritySrc],
      ['roadClassResolver', roadClassSrc],
    ] as const) {
      const s = code(src);
      for (const forbidden of ['fetch(', 'Date.now', 'performance.now', 'useState', 'setTimeout', 'localStorage']) {
        expect(s, `${name} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('🔒 politika sayıları UI dosyalarına GÖMÜLMEZ', () => {
    // Kart yalnız hükümden gelen sayıyı basar; kendi tablosu YOKTUR.
    const s = code(cardSrc);
    expect(s).not.toMatch(/\b(95|110|130|140)\b/);
  });

  it('🔒 araştırma isteği TAM VIN göndermez', () => {
    const s = code(researchSrc);
    expect(s).toContain('vinPrefix');
    expect(s).not.toMatch(/body:\s*JSON\.stringify\(\{[\s\S]{0,200}\bvin\b\s*:/);
  });

  it('🔒 sınıf katmanı console.* KULLANMAZ (VIN loglanamaz)', () => {
    for (const src of [classSrc, researchSrc]) {
      expect(code(src)).not.toContain('console.');
    }
  });

  it('🔒 dış metin yalnız VERİ olarak işlenir — HTML çalıştırılmaz', () => {
    for (const src of [researchSrc, cardSrc, promptSrc]) {
      const s = code(src);
      expect(s).not.toContain('dangerouslySetInnerHTML');
      expect(s).not.toContain('innerHTML');
      expect(s).not.toContain('eval(');
    }
  });
});
