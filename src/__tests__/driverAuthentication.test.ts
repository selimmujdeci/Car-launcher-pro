/**
 * driverAuthentication.test.ts — DRIVER AUTHENTICATION P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Presence resolver'ı DEĞİŞMEDİ** — doğrulama ayrı bir otoritedir.
 *  2. **Presence TEK BAŞINA `VERY_HIGH` ÜRETEMEZ** (kart ≠ kişi).
 *  3. Doğrulama + varlık BİRLİKTE `VERY_HIGH` üretebilir.
 *  4. İki katman farklı kişiyi gösterirse sonuç **fail-closed**.
 *  5. İstemci kendi seviyesini YÜKSELTEMEZ; oturumsuz/tekrar kayıt REDDEDİLİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AUTHENTICATION_SOURCES, AUTHENTICATION_LEVELS, AUTHENTICATION_DECISIONS,
  TRUST_DECISIONS, AUTHORITY_STATES,
  UNKNOWN_AUTHENTICATION, NO_AUTHENTICATION_RESOLUTION,
  AUTHENTICATION_DEFAULT_TTL_MS, AUTHENTICATION_MAX_TTL_MS,
  normalizeDriverAuthentication, authenticationValidity, authenticationAgeMs,
  sourceAuthenticationCeiling, weakestAuthenticationLevel,
  resolveDriverAuthentication, resolveDriverTrust,
  authenticationSourceLabel, authenticationLevelLabel,
  authenticationDecisionLabel, trustDecisionLabel,
  driverAuthenticationStore, readDriverAuthentication, bindAuthenticationVehicle,
  _resetDriverAuthenticationStoreForTest,
  type DriverAuthentication, type AuthenticationResolution,
} from '../platform/fleet/driverAuthentication';
import {
  resolveDriverPresence, normalizePresence,
  type PresenceResolution,
} from '../platform/fleet/driverPresence';

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const H = 3_600_000;
const VEH = 'veh-auth-1';

function auth(over: Record<string, unknown> = {}): DriverAuthentication {
  return normalizeDriverAuthentication({
    driverId: 'd-1', vehicleId: VEH,
    authenticationSource: 'NFC', authenticationLevel: 'VERIFIED',
    verifiedAt: NOW, expiresAt: NOW + 4 * H, sessionId: 'ses-1',
    ...over,
  });
}

function resolveAuth(a: DriverAuthentication, over: {
  boundVehicleId?: string | null; driverEligible?: boolean; nowMs?: number;
} = {}): AuthenticationResolution {
  return resolveDriverAuthentication({
    authentication: a,
    boundVehicleId: over.boundVehicleId === undefined ? VEH : over.boundVehicleId,
    driverEligible: over.driverEligible ?? true,
    nowMs: over.nowMs ?? NOW + H,
  });
}

/** Presence otoritesinin GERÇEK çıktısı — mock DEĞİL. */
function presenceOf(over: Record<string, unknown> = {},
                    assignmentDriverId: string | null = 'd-1'): PresenceResolution {
  return resolveDriverPresence({
    presence: normalizePresence({
      source: 'NFC', confidence: 'VERY_HIGH', driverId: 'd-1',
      detectedAt: NOW, expiresAt: NOW + 8 * H, ...over,
    }),
    assignmentDriverId, driverEligible: true, nowMs: NOW + H,
  });
}

beforeEach(() => { _resetDriverAuthenticationStoreForTest(); });

/* ═══ A. SÖZLEŞME ══════════════════════════════════════════════════════ */

describe('DriverAuthentication · A. Kanonik model', () => {
  it('A1. 🔒 kaynak listesi SÖZLEŞMEDİR (head unit beyanı YOK)', () => {
    expect([...AUTHENTICATION_SOURCES]).toEqual(
      ['UNKNOWN', 'PIN', 'PHONE', 'BLUETOOTH', 'NFC']);
    /* `HEAD_UNIT` bilinçli olarak YOKTUR: anon rolde kimlik iddiası kanıt olamaz. */
    expect(AUTHENTICATION_SOURCES).not.toContain('HEAD_UNIT');
  });

  it('A2. 🔒 seviye listesi SÖZLEŞMEDİR', () => {
    expect([...AUTHENTICATION_LEVELS]).toEqual(['VERIFIED', 'PARTIAL', 'UNKNOWN']);
  });

  it('A3. 🔒 model ALANLARI eksiksiz ve UNKNOWN varsayılanı güvenli', () => {
    expect(Object.keys(UNKNOWN_AUTHENTICATION).sort()).toEqual([
      'authenticationLevel', 'authenticationSource', 'driverId',
      'expiresAt', 'sessionId', 'vehicleId', 'verifiedAt',
    ]);
    expect(UNKNOWN_AUTHENTICATION.driverId).toBeNull();
    expect(UNKNOWN_AUTHENTICATION.authenticationLevel).toBe('UNKNOWN');
  });

  it('A4. 🔒 OTURUMSUZ kayıt doğrulama SAYILMAZ (replay kilidi zorunlu)', () => {
    expect(normalizeDriverAuthentication({
      driverId: 'd-1', authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
    })).toEqual(UNKNOWN_AUTHENTICATION);
  });

  it('A5. 🔒 sürücüsüz / kaynaksız kayıt REDDEDİLİR', () => {
    expect(normalizeDriverAuthentication({ sessionId: 's', authenticationSource: 'NFC' }))
      .toEqual(UNKNOWN_AUTHENTICATION);
    expect(normalizeDriverAuthentication({ sessionId: 's', driverId: 'd-1' }))
      .toEqual(UNKNOWN_AUTHENTICATION);
    expect(normalizeDriverAuthentication(null)).toEqual(UNKNOWN_AUTHENTICATION);
    expect(normalizeDriverAuthentication('uydurma')).toEqual(UNKNOWN_AUTHENTICATION);
  });

  it('A6. 🔒 İSTEMCİ kendi seviyesini YÜKSELTEMEZ (kaynak tavanı)', () => {
    expect(sourceAuthenticationCeiling('NFC')).toBe('VERIFIED');
    expect(sourceAuthenticationCeiling('PIN')).toBe('VERIFIED');
    expect(sourceAuthenticationCeiling('BLUETOOTH')).toBe('PARTIAL');
    expect(sourceAuthenticationCeiling('PHONE')).toBe('PARTIAL');
    expect(sourceAuthenticationCeiling('UNKNOWN')).toBe('UNKNOWN');

    const bt = auth({ authenticationSource: 'BLUETOOTH', authenticationLevel: 'VERIFIED' });
    expect(bt.authenticationLevel).toBe('PARTIAL');
  });

  it('A7. 🔒 en zayıf halka kuralı', () => {
    expect(weakestAuthenticationLevel('VERIFIED', 'PARTIAL')).toBe('PARTIAL');
    expect(weakestAuthenticationLevel('PARTIAL', 'UNKNOWN')).toBe('UNKNOWN');
    expect(weakestAuthenticationLevel('VERIFIED', 'VERIFIED')).toBe('VERIFIED');
  });

  it('A8. 🔒 TTL verilmezse varsayılan uygulanır; ömür SINIRLIDIR', () => {
    const a = auth({ expiresAt: undefined });
    expect(a.expiresAt).toBe(NOW + AUTHENTICATION_DEFAULT_TTL_MS);
    /* Doğrulama presence'tan KISA yaşar (daha güçlü sonuç doğurur). */
    expect(AUTHENTICATION_DEFAULT_TTL_MS).toBeLessThan(8 * H);
    expect(AUTHENTICATION_MAX_TTL_MS).toBe(12 * H);
  });

  it('A9. 🔒 geçerlilik: VALID · EXPIRED · FUTURE · UNKNOWN', () => {
    expect(authenticationValidity(auth(), NOW + H)).toBe('VALID');
    expect(authenticationValidity(auth(), NOW + 5 * H)).toBe('EXPIRED');
    expect(authenticationValidity(auth(), NOW - H)).toBe('FUTURE');
    expect(authenticationValidity(UNKNOWN_AUTHENTICATION, NOW)).toBe('UNKNOWN');
    expect(authenticationAgeMs(auth(), NOW + H)).toBe(H);
    expect(authenticationAgeMs(UNKNOWN_AUTHENTICATION, NOW)).toBeNull();
  });
});

/* ═══ B. OTORİTE ═══════════════════════════════════════════════════════ */

describe('DriverAuthentication · B. Tek otorite', () => {
  it('B1. 🔒 kayıt yoksa NO_AUTHENTICATION (fail-closed)', () => {
    const r = resolveAuth(UNKNOWN_AUTHENTICATION);
    expect(r).toEqual(NO_AUTHENTICATION_RESOLUTION);
    expect(r.usable).toBe(false);
  });

  it('B2. 🔒 geçerli NFC → AUTHENTICATED', () => {
    const r = resolveAuth(auth());
    expect(r.decision).toBe('AUTHENTICATED');
    expect(r.driverId).toBe('d-1');
    expect(r.level).toBe('VERIFIED');
    expect(r.usable).toBe(true);
  });

  it('B3. 🔒 ARAÇ BAĞI yoksa kullanılamaz ("herhalde bu araçtır" YOK)', () => {
    const r = resolveAuth(auth(), { boundVehicleId: null });
    expect(r.decision).toBe('AUTHENTICATION_UNUSABLE');
    expect(r.reason).toBe('VEHICLE_NOT_BOUND');
    expect(r.driverId).toBeNull();
  });

  it('B4. 🔒 BAŞKA aracın doğrulaması kullanılamaz', () => {
    const r = resolveAuth(auth({ vehicleId: 'baska' }));
    expect(r.decision).toBe('AUTHENTICATION_UNUSABLE');
    expect(r.reason).toBe('VEHICLE_BINDING_MISMATCH');
  });

  it('B5. 🔒 SÜRESİ GEÇMİŞ doğrulama kanıt DEĞİLDİR', () => {
    const r = resolveAuth(auth(), { nowMs: NOW + 5 * H });
    expect(r.decision).toBe('AUTHENTICATION_EXPIRED');
    expect(r.driverId).toBeNull();
    expect(r.usable).toBe(false);
  });

  it('B6. 🔒 GELECEK tarihli doğrulama kullanılamaz (saat oynatma)', () => {
    const r = resolveAuth(auth(), { nowMs: NOW - H });
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('AUTHENTICATION_IN_FUTURE');
  });

  it('B7. 🔒 UYGUN OLMAYAN sürücü (tenant/pasif) kanıt üretmez', () => {
    const r = resolveAuth(auth(), { driverEligible: false });
    expect(r.decision).toBe('AUTHENTICATION_UNUSABLE');
    expect(r.reason).toBe('DRIVER_NOT_ELIGIBLE');
  });

  it('B8. 🔒 PARTIAL kimlik KANITI SAYILMAZ (yakınlık ≠ kişi)', () => {
    const r = resolveAuth(auth({ authenticationSource: 'BLUETOOTH' }));
    expect(r.decision).toBe('PARTIALLY_AUTHENTICATED');
    expect(r.driverId).toBeNull();
    expect(r.usable).toBe(false);
  });

  it('B9. 🔒 karar listesi SÖZLEŞMEDİR', () => {
    expect([...AUTHENTICATION_DECISIONS]).toEqual([
      'AUTHENTICATED', 'PARTIALLY_AUTHENTICATED', 'AUTHENTICATION_EXPIRED',
      'AUTHENTICATION_UNUSABLE', 'NO_AUTHENTICATION',
    ]);
  });
});

/* ═══ C. PRESENCE × AUTHENTICATION (asıl politika) ═════════════════════ */

describe('DriverAuthentication · C. Nihai güven', () => {
  it('C1. 🔒 PRESENCE TEK BAŞINA VERY_HIGH ÜRETEMEZ (tavan HIGH)', () => {
    const p = presenceOf();
    /* Presence otoritesi kendi kararında hâlâ VERY_HIGH diyor — DEĞİŞMEDİ. */
    expect(p.decision).toBe('PRESENCE_CONFIRMED');
    expect(p.confidence).toBe('VERY_HIGH');

    const t = resolveDriverTrust({ presence: p, authentication: NO_AUTHENTICATION_RESOLUTION });
    expect(t.decision).toBe('PRESENCE_ONLY');
    expect(t.driverId).toBe('d-1');
    expect(t.confidence).toBe('HIGH');          // ← TAVAN UYGULANDI
    expect(t.veryHighEligible).toBe(false);
  });

  it('C2. 🔒 KİMLİK + VARLIK birlikte VERY_HIGH üretir', () => {
    const t = resolveDriverTrust({
      presence: presenceOf(), authentication: resolveAuth(auth()),
    });
    expect(t.decision).toBe('VERIFIED_PRESENCE');
    expect(t.driverId).toBe('d-1');
    expect(t.confidence).toBe('VERY_HIGH');
    expect(t.veryHighEligible).toBe(true);
  });

  it('C3. 🔒 ÇELİŞKİ → fail-closed (sürücü YAZILMAZ)', () => {
    const t = resolveDriverTrust({
      presence: presenceOf(),
      authentication: resolveAuth(auth({ driverId: 'd-2', sessionId: 'ses-2' })),
    });
    expect(t.decision).toBe('TRUST_CONFLICT');
    expect(t.driverId).toBeNull();
    expect(t.confidence).toBe('UNKNOWN');
    expect(t.usable).toBe(false);
  });

  it('C4. 🔒 YALNIZ KİMLİK → sürücü var ama tavan HIGH', () => {
    const noPresence = resolveDriverPresence({
      presence: normalizePresence({}), assignmentDriverId: null,
      driverEligible: true, nowMs: NOW,
    });
    const t = resolveDriverTrust({
      presence: noPresence, authentication: resolveAuth(auth()),
    });
    expect(t.decision).toBe('AUTHENTICATION_ONLY');
    expect(t.driverId).toBe('d-1');
    expect(t.confidence).toBe('HIGH');
    expect(t.veryHighEligible).toBe(false);
  });

  it('C5. 🔒 hiçbir kanıt yoksa NO_TRUST → atama modeli çalışır', () => {
    const noPresence = resolveDriverPresence({
      presence: normalizePresence({}), assignmentDriverId: null,
      driverEligible: true, nowMs: NOW,
    });
    const t = resolveDriverTrust({
      presence: noPresence, authentication: NO_AUTHENTICATION_RESOLUTION,
    });
    expect(t.decision).toBe('NO_TRUST');
    expect(t.driverId).toBeNull();
    expect(t.usable).toBe(false);
  });

  it('C6. 🔒 KULLANILAMAZ doğrulama VERY_HIGH kapısını AÇMAZ', () => {
    for (const bad of [
      resolveAuth(auth(), { nowMs: NOW + 9 * H }),        // süresi geçmiş
      resolveAuth(auth({ authenticationSource: 'PHONE' })), // PARTIAL
      resolveAuth(auth(), { boundVehicleId: null }),        // bağsız
    ]) {
      const t = resolveDriverTrust({ presence: presenceOf(), authentication: bad });
      expect(t.confidence).toBe('HIGH');
      expect(t.veryHighEligible).toBe(false);
    }
  });

  it('C7. 🔒 ZAYIF presence doğrulamayla GÜÇLENMEZ (tavan yükselmez)', () => {
    /* Presence `PRESENCE_ONLY` (atama yok) → kendi güveni HIGH. Doğrulama
       VERY_HIGH kapısını açar ama zayıf gözlemi YÜKSELTMEZ. */
    const p = presenceOf({}, null);
    expect(p.decision).toBe('PRESENCE_ONLY');
    expect(p.confidence).toBe('HIGH');
    const t = resolveDriverTrust({ presence: p, authentication: resolveAuth(auth()) });
    expect(t.confidence).toBe('HIGH');
  });

  it('C8. 🔒 karar listeleri SÖZLEŞMEDİR', () => {
    expect([...TRUST_DECISIONS]).toEqual([
      'VERIFIED_PRESENCE', 'PRESENCE_ONLY', 'AUTHENTICATION_ONLY',
      'TRUST_CONFLICT', 'NO_TRUST',
    ]);
    expect([...AUTHORITY_STATES]).toEqual(
      ['UNBOUND', 'IDLE', 'ACTIVE', 'EXPIRED', 'DEGRADED']);
  });
});

/* ═══ D. DEPO: bağ · duplicate · replay ════════════════════════════════ */

describe('DriverAuthentication · D. Depo kapıları', () => {
  it('D1. 🔒 BAĞ YOKKEN doğrulama kabul EDİLMEZ', () => {
    driverAuthenticationStore.record({
      driverId: 'd-1', authenticationSource: 'NFC', authenticationLevel: 'VERIFIED',
      verifiedAt: NOW, expiresAt: NOW + 4 * H, sessionId: 'ses-x',
    }, NOW);
    const r = readDriverAuthentication(NOW);
    expect(r.acceptedCount).toBe(0);
    expect(r.lastRejectReason).toBe('VEHICLE_NOT_BOUND');
    expect(r.authorityState).toBe('UNBOUND');
  });

  it('D2. 🔒 BAŞKA aracı iddia eden doğrulama REDDEDİLİR', () => {
    bindAuthenticationVehicle(VEH);
    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: 'baska-arac', authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 4 * H, sessionId: 'ses-y',
    }, NOW);
    expect(readDriverAuthentication(NOW).lastRejectReason)
      .toBe('VEHICLE_BINDING_MISMATCH');
  });

  it('D3. 🔒 AYNI oturum İKİ KEZ kabul edilmez (duplicate)', () => {
    bindAuthenticationVehicle(VEH);
    const rec = {
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 4 * H, sessionId: 'ses-1',
    };
    driverAuthenticationStore.record(rec, NOW);
    driverAuthenticationStore.record(rec, NOW + 60_000);
    const r = readDriverAuthentication(NOW + 60_000);
    expect(r.acceptedCount).toBe(1);
    expect(r.lastRejectReason).toBe('DUPLICATE_SESSION');
  });

  it('D4. 🔒 ESKİ mesajın yeniden oynatılması REDDEDİLİR (replay)', () => {
    bindAuthenticationVehicle(VEH);
    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW + H,
      expiresAt: NOW + 5 * H, sessionId: 'ses-new',
    }, NOW + H);
    /* Daha ESKİ bir doğrulama, farklı oturumla bile olsa yeni kanıt olamaz. */
    driverAuthenticationStore.record({
      driverId: 'd-2', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW - 2 * H,
      expiresAt: NOW + 2 * H, sessionId: 'ses-old',
    }, NOW + H);
    const r = readDriverAuthentication(NOW + H);
    expect(r.acceptedCount).toBe(1);
    expect(r.lastRejectReason).toBe('REPLAY_REJECTED');
    expect(r.authentication.driverId).toBe('d-1');   // eski mesaj EZMEDİ
  });

  it('D5. 🔒 SINIRSIZ oturum ve GELİR GELMEZ süresi geçmiş kayıt reddedilir', () => {
    bindAuthenticationVehicle(VEH);
    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 20 * H, sessionId: 'ses-ttl',
    }, NOW);
    expect(readDriverAuthentication(NOW).lastRejectReason).toBe('TTL_TOO_LONG');

    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW - 5 * H,
      expiresAt: NOW - H, sessionId: 'ses-dead',
    }, NOW);
    expect(readDriverAuthentication(NOW).lastRejectReason).toBe('ALREADY_EXPIRED');
  });

  it('D6. 🔒 BAĞ DEĞİŞİRSE aktif doğrulama DÜŞER', () => {
    bindAuthenticationVehicle(VEH);
    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 4 * H, sessionId: 'ses-1',
    }, NOW);
    expect(readDriverAuthentication(NOW).authorityState).toBe('ACTIVE');

    bindAuthenticationVehicle('veh-baska');
    const r = readDriverAuthentication(NOW);
    expect(r.authentication).toEqual(UNKNOWN_AUTHENTICATION);
    expect(r.authorityState).toBe('IDLE');
  });

  it('D7. 🔒 otorite durumu GERÇEK veriden gelir (sahte "sağlıklı" yok)', () => {
    expect(readDriverAuthentication(NOW).authorityState).toBe('UNBOUND');
    bindAuthenticationVehicle(VEH);
    expect(readDriverAuthentication(NOW).authorityState).toBe('IDLE');

    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 4 * H, sessionId: 'ses-1',
    }, NOW);
    expect(readDriverAuthentication(NOW).authorityState).toBe('ACTIVE');
    expect(readDriverAuthentication(NOW + 9 * H).authorityState).toBe('EXPIRED');
  });

  it('D8. 🔒 oturum hafızası SINIRLI (bellek sızıntısı yok)', () => {
    bindAuthenticationVehicle(VEH);
    for (let i = 0; i < 260; i++) {
      driverAuthenticationStore.record({
        driverId: 'd-1', vehicleId: VEH, authenticationSource: 'NFC',
        authenticationLevel: 'VERIFIED', verifiedAt: NOW + i * 1000,
        expiresAt: NOW + i * 1000 + 4 * H, sessionId: `ses-${i}`,
      }, NOW + i * 1000);
    }
    expect(readDriverAuthentication(NOW).knownSessionCount).toBeLessThanOrEqual(200);
  });
});

/* ═══ E. REGRESYON VE SAFLIK ═══════════════════════════════════════════ */

describe('DriverAuthentication · E. Regresyon ve saflık', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverAuthentication.ts'), 'utf8');
  const PRESENCE_SRC = readFileSync(
    join(process.cwd(), 'src/platform/fleet/driverPresence.ts'), 'utf8');

  it('E1. 🔒 doğrulama modülü presence RESOLVER\'INI ÇAĞIRMAZ', () => {
    expect(SRC).not.toMatch(/^import \{[^}]*resolveDriverPresence/m);
    expect(SRC).toContain('import type {');
  });

  it('E2. 🔒 presence modülü doğrulamayı BİLMEZ (tek yönlü bağımlılık)', () => {
    expect(PRESENCE_SRC).not.toContain('driverAuthentication');
    expect(PRESENCE_SRC).not.toContain('resolveDriverTrust');
  });

  it('E3. 🔒 otorite ve sözleşme SAF (I/O · zaman · timer YOK)', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('performance.now()');
    expect(code).not.toContain('setInterval');
    expect(code).not.toContain('setTimeout');
    expect(code).not.toContain('safeGetRaw');
    expect(code).not.toContain('fetch(');
  });

  it('E4. 🔒 ÜRETİMDE doğrulama ÜRETEN yol YOK (NFC/PIN/BT/telefon yazılmadı)', () => {
    /* Bu, katmanın güvenlik tasarımının parçasıdır: kaynak bağlanana kadar
       hiçbir doğrulama üretilmez → VERY_HIGH kapısı KAPALI kalır. */
    const wiring = readFileSync(
      join(process.cwd(), 'src/platform/fleet/presenceVehicleBinding.ts'), 'utf8');
    expect(wiring).toContain('bindAuthenticationVehicle');
    expect(wiring).not.toContain('driverAuthenticationStore.record');
  });

  it('E5. 🔒 etiketler tüm enum değerlerini KAPSAR (sessiz boşluk yok)', () => {
    for (const s of AUTHENTICATION_SOURCES) {
      expect(authenticationSourceLabel(s).length).toBeGreaterThan(0);
    }
    for (const l of AUTHENTICATION_LEVELS) {
      expect(authenticationLevelLabel(l).length).toBeGreaterThan(0);
    }
    for (const d of AUTHENTICATION_DECISIONS) {
      expect(authenticationDecisionLabel(d).length).toBeGreaterThan(0);
    }
    for (const d of TRUST_DECISIONS) {
      expect(trustDecisionLabel(d).length).toBeGreaterThan(0);
    }
  });

  it('E6. 🔒 LAB ekranı istenen alanları GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetDriverAuthenticationScreen.tsx'), 'utf8');
    for (const field of ['authorityState', 'source', 'level',
                         'expiresIn', 'sessionAge', 'driverRef']) {
      expect(SCREEN).toContain(field);
    }
    /* Aktif komut ve timer YOK. */
    expect(SCREEN).not.toContain('setInterval');
    expect(SCREEN).not.toContain('.record(');
  });

  it('E7. 🔒 LAB ekranı OTURUM KİMLİĞİNİ tam göstermez (token sızıntısı yok)', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/FleetDriverAuthenticationScreen.tsx'), 'utf8');
    expect(SCREEN).toContain('slice(0, 8)');
    expect(SCREEN).toContain("shortRef('ses'");
  });

  it('E8. 🔒 depo PII TAŞIMAZ (ad/telefon/e-posta/PIN alanı yok)', () => {
    bindAuthenticationVehicle(VEH);
    driverAuthenticationStore.record({
      driverId: 'd-1', vehicleId: VEH, authenticationSource: 'PIN',
      authenticationLevel: 'VERIFIED', verifiedAt: NOW,
      expiresAt: NOW + 4 * H, sessionId: 'ses-1',
      /* Sızmaya çalışan alanlar — daraltma bunları ATMALI. */
      displayName: 'Ahmet Yilmaz', phone: '+90...', pin: '1234',
    }, NOW);
    const serialized = JSON.stringify(readDriverAuthentication(NOW).authentication);
    expect(serialized).not.toContain('Ahmet');
    expect(serialized).not.toContain('1234');
    expect(serialized.toLowerCase()).not.toContain('phone');
  });
});
