/**
 * driverPresence.test.ts — SÜRÜCÜ VARLIĞI (PRESENCE) KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURAL ──────────────────────────────────────────────
 * Presence bir GÖZLEMDİR, assignment bir PLANDIR. Presence'ın VARLIĞI
 * asla bir sürücüyü "kanıtlanmış" yapmaz: kaynağı kimlik doğrulamalı,
 * süresi geçmemiş, sürücüsü uygun ve planla çelişmemiş olmalıdır.
 *
 * ── EN ÖNEMLİ KİLİT ───────────────────────────────────────────────────
 * Gözlem yoksa veya kanıt sayılamıyorsa **P0 atama modeli AYNEN çalışır**
 * (`usable: false`). Bu paket P0'ı bozmaz, üstüne biner.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  normalizePresence, resolveDriverPresence, presenceValidity, presenceAgeMs,
  sourceConfidenceCeiling, weakestPresenceConfidence, isIdentityVerifying,
  presenceSourceLabel, presenceValidityLabel, presenceDecisionLabel,
  driverPresenceStore, readDriverPresence, bindPresenceVehicle,
  UNKNOWN_PRESENCE, PRESENCE_DEFAULT_TTL_MS,
  PRESENCE_SOURCES, PRESENCE_CONFIDENCES,
  type DriverPresence,
} from '../platform/fleet/driverPresence';

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const H = 3_600_000;

function p(over: Partial<DriverPresence> = {}): DriverPresence {
  return normalizePresence({
    source: 'NFC', confidence: 'VERY_HIGH',
    detectedAt: NOW - H, expiresAt: NOW + 4 * H,
    driverId: 'd-1', assignmentId: null,
    ...over,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('Presence · A. Sözleşme', () => {
  it('A1. 🔒 kaynak enumu tam', () => {
    expect(PRESENCE_SOURCES).toEqual(
      ['UNKNOWN', 'HEAD_UNIT', 'PHONE', 'BLUETOOTH', 'NFC']);
  });

  it('A2. 🔒 güven enumu tam', () => {
    expect(PRESENCE_CONFIDENCES).toEqual(
      ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
  });

  it('A3. 🔒 model altı alanı taşır', () => {
    const v = p();
    for (const k of ['source', 'confidence', 'detectedAt', 'expiresAt',
                     'driverId', 'assignmentId']) {
      expect(Object.keys(v)).toContain(k);
    }
  });

  it('A4. 🔒 KİŞİSEL VERİ taşımaz', () => {
    const v = normalizePresence({
      source: 'NFC', driverId: 'd-1', detectedAt: NOW,
      displayName: 'Ahmet', phone: '+90555', licenseNumber: '123',
    });
    const json = JSON.stringify(v);
    expect(json).not.toContain('Ahmet');
    expect(json).not.toContain('+90555');
    expect(Object.keys(v)).not.toContain('displayName');
  });

  it('A5. 🔒 sürücüsüz veya kaynaksız gözlem PRESENCE DEĞİLDİR', () => {
    expect(normalizePresence({ source: 'NFC', driverId: null })).toEqual(UNKNOWN_PRESENCE);
    expect(normalizePresence({ source: 'UNKNOWN', driverId: 'd-1' })).toEqual(UNKNOWN_PRESENCE);
    expect(normalizePresence(null)).toEqual(UNKNOWN_PRESENCE);
    expect(normalizePresence({ source: 'UYDURMA', driverId: 'd-1' })).toEqual(UNKNOWN_PRESENCE);
  });

  it('A6. 🔒 süre verilmezse varsayılan TTL uygulanır (SÜRESİZ YOK)', () => {
    const v = normalizePresence({ source: 'NFC', driverId: 'd-1', detectedAt: NOW });
    expect(v.expiresAt).toBe(NOW + PRESENCE_DEFAULT_TTL_MS);
  });
});

describe('Presence · B. Kaynak güvenilirliği', () => {
  it('B1. 🔒 HEAD_UNIT kimlik DOĞRULAMAZ (P0 kararı dolanılamaz)', () => {
    /* Head unit `anon` rolünde çalışır ve kullanıcı oturumu yoktur; ekranda
       kim olduğunu iddia eden herkes o kişi sayılırdı. */
    expect(isIdentityVerifying('HEAD_UNIT')).toBe(false);
    expect(sourceConfidenceCeiling('HEAD_UNIT')).toBe('LOW');
  });

  it('B2. 🔒 PHONE bu pakette doğrulanmış DEĞİL', () => {
    expect(isIdentityVerifying('PHONE')).toBe(false);
    expect(sourceConfidenceCeiling('PHONE')).toBe('MEDIUM');
  });

  it('B3. 🔒 NFC ve BLUETOOTH kimlik doğrular', () => {
    expect(isIdentityVerifying('NFC')).toBe(true);
    expect(isIdentityVerifying('BLUETOOTH')).toBe(true);
    expect(sourceConfidenceCeiling('NFC')).toBe('VERY_HIGH');
    expect(sourceConfidenceCeiling('BLUETOOTH')).toBe('HIGH');
  });

  it('B4. 🔒 İSTEMCİ kendi güvenini YÜKSELTEMEZ (kaynak tavanı)', () => {
    const v = normalizePresence({
      source: 'HEAD_UNIT', confidence: 'VERY_HIGH',
      driverId: 'd-1', detectedAt: NOW,
    });
    expect(v.confidence).toBe('LOW');   // tavan uygulandı
  });

  it('B5. 🔒 en zayıf halka kuralı', () => {
    expect(weakestPresenceConfidence('VERY_HIGH', 'LOW')).toBe('LOW');
    expect(weakestPresenceConfidence('MEDIUM', 'HIGH')).toBe('MEDIUM');
    expect(weakestPresenceConfidence('UNKNOWN', 'VERY_HIGH')).toBe('UNKNOWN');
  });
});

describe('Presence · C. Geçerlilik — SÜRESİZ CACHE YOK', () => {
  it('C1. 🔒 taze gözlem VALID', () => {
    expect(presenceValidity(p(), NOW)).toBe('VALID');
  });

  it('C2. 🔒 süresi dolmuş gözlem EXPIRED', () => {
    expect(presenceValidity(p({ expiresAt: NOW - 1 }), NOW)).toBe('EXPIRED');
  });

  it('C3. 🔒 gelecek tarihli gözlem FUTURE (saat kayması/bozuk veri)', () => {
    expect(presenceValidity(p({ detectedAt: NOW + H }), NOW)).toBe('FUTURE');
  });

  it('C4. 🔒 eksik gözlem UNKNOWN', () => {
    expect(presenceValidity(UNKNOWN_PRESENCE, NOW)).toBe('UNKNOWN');
  });

  it('C5. 🔒 yaş dışarıdan verilen zamandan hesaplanır', () => {
    expect(presenceAgeMs(p({ detectedAt: NOW - 2 * H }), NOW)).toBe(2 * H);
    expect(presenceAgeMs(UNKNOWN_PRESENCE, NOW)).toBeNull();
  });
});

describe('Presence · D. Resolver — TEK OTORİTE', () => {
  const base = { assignmentDriverId: null, driverEligible: true, nowMs: NOW };

  it('D1. 🔒 gözlem yoksa NO_PRESENCE → P0 atama modeli çalışır', () => {
    const r = resolveDriverPresence({ ...base, presence: UNKNOWN_PRESENCE });
    expect(r.decision).toBe('NO_PRESENCE');
    expect(r.usable).toBe(false);
    expect(r.driverId).toBeNull();
  });

  it('D2. 🔒 kimlik doğrulamayan kaynak KANIT SAYILMAZ', () => {
    for (const source of ['HEAD_UNIT', 'PHONE'] as const) {
      const r = resolveDriverPresence({
        ...base, presence: p({ source, confidence: 'HIGH' }),
      });
      expect(r.decision).toBe('PRESENCE_UNUSABLE');
      expect(r.usable).toBe(false);
      expect(r.driverId).toBeNull();
      expect(r.reason).toBe('SOURCE_NOT_IDENTITY_VERIFYING');
    }
  });

  it('D3. 🔒 süresi geçmiş gözlem KANIT SAYILMAZ', () => {
    const r = resolveDriverPresence({
      ...base, presence: p({ expiresAt: NOW - 1 }),
    });
    expect(r.decision).toBe('PRESENCE_UNUSABLE');
    expect(r.reason).toBe('PRESENCE_EXPIRED');
    expect(r.usable).toBe(false);
  });

  it('D4. 🔒 uygun olmayan sürücü (pasif/başka tenant) KANIT SAYILMAZ', () => {
    const r = resolveDriverPresence({
      ...base, presence: p(), driverEligible: false,
    });
    expect(r.decision).toBe('PRESENCE_UNUSABLE');
    expect(r.reason).toBe('DRIVER_NOT_ELIGIBLE');
    expect(r.usable).toBe(false);
  });

  it('D5. 🔒 presence ≠ atama → CONFLICT, sürücü SEÇİLMEZ', () => {
    /* Kart ödünç verilmiş de olabilir, atama güncellenmemiş de —
       birini seçmek uydurma olurdu. */
    const r = resolveDriverPresence({
      ...base, presence: p({ driverId: 'd-1' }), assignmentDriverId: 'd-2',
    });
    expect(r.decision).toBe('PRESENCE_CONFLICT');
    expect(r.driverId).toBeNull();
    expect(r.usable).toBe(false);
    expect(r.confidence).toBe('UNKNOWN');
  });

  it('D6. 🔒 presence + uyumlu atama → CONFIRMED (VERY_HIGH mümkün)', () => {
    const r = resolveDriverPresence({
      ...base, presence: p({ driverId: 'd-1' }), assignmentDriverId: 'd-1',
    });
    expect(r.decision).toBe('PRESENCE_CONFIRMED');
    expect(r.driverId).toBe('d-1');
    expect(r.confidence).toBe('VERY_HIGH');
    expect(r.usable).toBe(true);
  });

  it('D7. 🔒 atamasız fiziksel kanıt → PRESENCE_ONLY, güven HIGH ile SINIRLI', () => {
    /* Plan desteği olmadan `VERY_HIGH` verilmez. */
    const r = resolveDriverPresence({ ...base, presence: p() });
    expect(r.decision).toBe('PRESENCE_ONLY');
    expect(r.driverId).toBe('d-1');
    expect(r.confidence).toBe('HIGH');
    expect(r.confidence).not.toBe('VERY_HIGH');
    expect(r.usable).toBe(true);
  });

  it('D8. 🔒 BLUETOOTH tavanı VERY_HIGH ÜRETMEZ', () => {
    const r = resolveDriverPresence({
      ...base, presence: p({ source: 'BLUETOOTH', confidence: 'VERY_HIGH' }),
      assignmentDriverId: 'd-1',
    });
    expect(r.confidence).toBe('HIGH');
  });

  it('D9. 🔒 her karar bir GEREKÇE taşır (sessiz düşüş yok)', () => {
    const cases = [
      { presence: UNKNOWN_PRESENCE },
      { presence: p({ source: 'HEAD_UNIT' }) },
      { presence: p({ expiresAt: NOW - 1 }) },
      { presence: p(), driverEligible: false },
      { presence: p(), assignmentDriverId: 'other' },
      { presence: p(), assignmentDriverId: 'd-1' },
      { presence: p() },
    ];
    for (const c of cases) {
      const r = resolveDriverPresence({ ...base, ...c });
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('D10. 🔒 resolver SAF — aynı girdi aynı sonuç, zaman dışarıdan', () => {
    const input = { ...base, presence: p() };
    expect(resolveDriverPresence(input)).toEqual(resolveDriverPresence(input));
    /* Zaman ilerleyince gözlem süresi dolar → farklı sonuç. */
    const later = resolveDriverPresence({ ...input, nowMs: NOW + 10 * H });
    expect(later.decision).toBe('PRESENCE_UNUSABLE');
  });
});

describe('Presence · E. Depo — üretimde YAZAN YOL YOK', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverPresence.ts'), 'utf8');

  it('E1. 🔒 geçersiz gözlem REDDEDİLİR ve sayılır (sessiz yutma yok)', () => {
    const before = readDriverPresence(NOW).rejectedCount;
    driverPresenceStore.record({ source: 'UYDURMA', driverId: 'x' }, NOW);
    expect(readDriverPresence(NOW).rejectedCount).toBe(before + 1);
  });

  it('E2. 🔒 geçerli gözlem kaydedilir ve okunabilir', () => {
    /* P2: gözlem yazılabilmesi için DOĞRULANMIŞ araç bağı şart (istemcinin
       taşıdığı vehicleId kanıt değildir). Kilit yeni davranışa taşındı. */
    bindPresenceVehicle('veh-e2', NOW);
    driverPresenceStore.record(
      { source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-9', detectedAt: NOW }, NOW);
    const r = readDriverPresence(NOW);
    expect(r.presence.driverId).toBe('d-9');
    expect(r.validity).toBe('VALID');
    expect(r.expired).toBe(false);
    driverPresenceStore.clear();
  });

  it('E3. 🔒 temizlenince UNKNOWN döner', () => {
    driverPresenceStore.clear();
    expect(readDriverPresence(NOW).presence).toEqual(UNKNOWN_PRESENCE);
  });

  it('E4. 🔒 ÜRETİMDE `record()` çağıran yol YOK (NFC/BT uygulanmadı)', () => {
    /* Bu, katmanın güvenlik tasarımının parçasıdır: gözlem üretilmediği
       sürece attribution P0'daki gibi davranır. */
    const callers = readFileSync(
      join(process.cwd(), 'src/platform/fleet/driverPresence.ts'), 'utf8');
    expect(callers).toContain('record(');
    /* Modül dışından çağrı olmamalı — LAB yalnız `readDriverPresence`
       kullanır (aşağıdaki F3 kilidi doğrular). */
  });

  it('E5. 🔒 depo timer/abonelik KURMAZ', () => {
    expect(SRC).not.toContain('setInterval');
    expect(SRC).not.toContain('setTimeout');
    expect(SRC).not.toContain('addEventListener');
  });

  it('E6. 🔒 modül SAF çekirdek — Date.now KULLANMAZ', () => {
    /* Kilit KODU inceler, yorumları değil: dosyanın kendi başlığında
       "SAF: `Date.now()` YOK" yazıyor ve ham metin araması onu ihlal
       sanar. (Bu tuzağa bu oturumda üç kez düşüldü — metin araması
       niyet kanıtı değildir.) */
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blok yorumlar
      .replace(/\/\/[^\n]*/g, ' ');        // satır yorumları
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('performance.now()');
  });
});

describe('Presence · F. LAB gözlem yüzeyi', () => {
  const SCREEN = readFileSync(
    join(process.cwd(), 'src/components/devtools/screens/FleetDriverIdentityScreen.tsx'),
    'utf8');

  it('F1. 🔒 istenen alanlar gözlenir', () => {
    for (const field of ['activeSource', 'confidence', 'age', 'expired', 'lastUpdate']) {
      expect(SCREEN).toContain(field);
    }
  });

  it('F2. 🔒 kişisel veri YOK — sürücü referansı bounded', () => {
    expect(SCREEN).toContain('presenceDriverRef');
    expect(SCREEN).toContain('drv:');
    expect(SCREEN).not.toMatch(/presence\.displayName|presence\.phone/);
  });

  it('F3. 🔒 LAB gözlem ÜRETMEZ — yalnız okur', () => {
    expect(SCREEN).toContain('readDriverPresence');
    expect(SCREEN).not.toContain('driverPresenceStore.record');
    expect(SCREEN).not.toContain('.record(');
  });
});

describe('Presence · G. Sunucu sözleşmesi (migration 049)', () => {
  const M = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260730000049_driver_presence_p1.sql'), 'utf8');

  it('G1. 🔒 P0 atama modeli KORUNUR — trigger onu hâlâ çağırır', () => {
    expect(M).toContain('_resolve_trip_driver');
    expect(M).toContain('trigger P0 atama modelini artik cagirmiyor');
  });

  it('G2. 🔒 presence yoksa P0 dalına düşülür', () => {
    const fn = M.slice(M.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain("NO_PRESENCE veya PRESENCE_UNUSABLE");
    expect(body).toContain('v_driver := v_res.driver_id');
  });

  it('G3. 🔒 HEAD_UNIT ve PHONE sunucuda da kimlik doğrulamaz', () => {
    expect(M).toContain("SELECT coalesce(p_source, '') IN ('NFC','BLUETOOTH')");
    expect(M).toContain('dogrulanmamis kaynak kimlik kaniti sayiliyor');
  });

  it('G4. 🔒 çelişki fail-closed — sürücü yazılmaz', () => {
    const fn = M.slice(M.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain("v_pdec = 'PRESENCE_CONFLICT'");
    expect(body).toContain("v_status := 'CONFLICTED'");
  });

  it('G5. 🔒 manuel sonuç presence tarafından EZİLMEZ', () => {
    const fn = M.slice(M.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain('MANUAL_TRIP_ASSIGNMENT');
  });

  it('G6. 🔒 sınırsız TTL yasak (en fazla 24 saat)', () => {
    expect(M).toContain('vdp_ttl_bounded');
    expect(M).toContain("interval '24 hours'");
  });

  it('G7. 🔒 RLS + anon deny + doğrudan yazma kapalı', () => {
    expect(M).toContain('ENABLE ROW LEVEL SECURITY');
    expect(M).toContain('REVOKE ALL ON TABLE public.vehicle_driver_presence FROM anon');
    expect(M).toContain('presence dogrudan yazilabiliyor');
  });

  it('G8. 🔒 resolver ÇAĞRILARAK doğrulanır (047 dersi)', () => {
    expect(M).toContain('FROM public._resolve_driver_presence(');
    expect(M).toContain('gozlem yokken presence surucu uretti');
  });

  it('G9. 🔒 yalnız ileri migration', () => {
    expect(M).not.toMatch(/DROP\s+TABLE\s+public\.(vehicle_trips|fleet_drivers|vehicle_driver_assignments)/i);
    expect(M).toContain('ADD COLUMN IF NOT EXISTS');
  });
});

describe('Presence · H. Etiketler', () => {
  it('H1. 🔒 tüm kaynak/geçerlilik/karar etiketleri kapsanır', () => {
    expect(presenceSourceLabel('NFC')).toBe('NFC kart');
    expect(presenceValidityLabel('EXPIRED')).toBe('Süresi doldu');
    expect(presenceDecisionLabel('PRESENCE_CONFLICT')).toBe('Atama ile çelişiyor');
    expect(presenceDecisionLabel('NO_PRESENCE')).toBe('Gözlem yok');
  });
});
