/**
 * arch05ProductionEnforcement.test.ts — ARCH-05 ÜRETİM YAPTIRIMI KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR: `arch05SecurityAuthorization.test.ts` SÖZLEŞMEYİ kilitler
 * (kural doğru mu). Bu dosya ÜRETİM YOLUNU kilitler: gerçek gateway'ler
 * çağrılır ve "DENY ⇒ SIFIR YAN ETKİ" iddiası ÖLÇÜLÜR. Güçlü bir sözleşme
 * bağlanmamışsa güvenlik DEĞİLDİR — bu ayrım bu dosyanın varlık sebebidir.
 *
 * Kilitler ZAYIFLATILAMAZ. Bir kilit bilinçli değişiyorsa YENİ doğru
 * davranışa GÜNCELLENİR, kaldırılmaz.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

import {
  authorizeOperation, revalidateAuthorization, decisionMatchesOperation,
  classifyDiagnosticOperation, diagnosticCapabilityFor, judgeDiagnosticOperation,
  classifySetting, settingCapabilityFor, authorizeSettingApply, authorizeStorageAdmin,
  principalGrantMatrix, CAPABILITY_STATUS, UNMODELLED_CAPABILITIES,
  _setSecurityContextForTest, _resetSecurityContextReadersForTest,
  type SecurityPrincipalClass,
} from '../platform/security/enforcement';
import {
  CAPABILITIES, getRecentSecurityDecisions, _resetSecurityDecisionsForTest,
} from '../platform/security/authorization';
import { controlCapabilityOf } from '../platform/companion/companionSessionManager';
import { getSecurityTrustCapabilityLabModel } from '../platform/devtools/securityTrustCapabilityModel';

/** Karar için "en iyi hâl": araç kimlikli, doğrulanmış PARK EDİLMİŞ. */
const PARKED = { vehicleRef: 'a1b2c3d4e5f60718', motion: 'PARKED' as const };
const MOVING = { vehicleRef: 'a1b2c3d4e5f60718', motion: 'MOVING' as const };
const UNKNOWN_MOTION = { vehicleRef: 'a1b2c3d4e5f60718', motion: 'UNKNOWN' as const };
const OTHER_VEHICLE = { vehicleRef: '99998888777766ff', motion: 'PARKED' as const };

let opCounter = 0;
const opId = (): string => `op-${++opCounter}`;

/**
 * Alan sahibinin native yüzey ölçümünü SİMÜLE eder: "köprü GERÇEKTEN var".
 * Bu bir yetki DEĞİLDİR — yetenek kapısı ondan bağımsız işler ve K1 kilidi
 * tam olarak bunu kanıtlar (izin `true` iken bile Mavi silemez).
 */
const ask = (
  principalClass: SecurityPrincipalClass,
  capability: Parameters<typeof authorizeOperation>[0]['capability'],
  channel?: Parameters<typeof authorizeOperation>[0]['channel'],
) => authorizeOperation({
  principalClass, capability, operationId: opId(), targetRef: 'test:target', channel,
  nativePermission: true,
});

beforeEach(() => {
  _resetSecurityDecisionsForTest();
  _setSecurityContextForTest(PARKED);
});
afterEach(() => {
  _setSecurityContextForTest(null);
  _resetSecurityContextReadersForTest();
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) PRINCIPAL / ROL / KİMLİK AYRIMI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/A · principal ve rol ayrımı', () => {
  it('A1 — bilinmeyen principal her yetkide reddedilir', () => {
    for (const cap of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
      expect(ask('UNKNOWN', cap).allowed).toBe(false);
    }
  });

  it('A2 — bilinmeyen yetenek hiçbir principal için verilmez', () => {
    for (const p of ['LOCAL_UI', 'MAVI', 'PHONE_LINK', 'PHONE_REMOTE', 'SYSTEM_INTERNAL'] as const) {
      expect(ask(p, 'UNKNOWN').allowed).toBe(false);
    }
  });

  it('A3 — hiçbir rol/sınıf TÜM yetkileri almaz (owner ⇒ hepsi YASAK)', () => {
    const all = Object.keys(CAPABILITIES).length;
    for (const [principal, caps] of Object.entries(principalGrantMatrix())) {
      expect(caps.length, `${principal} tüm yetkileri alamaz`).toBeLessThan(all);
    }
  });

  it('A4 — cihaz ≠ kişi ≠ sürücü: kanıt satırında ham kimlik alanı YOK', () => {
    const e = ask('LOCAL_UI', 'DIAGNOSTIC_READ').evidence;
    const keys = Object.keys(e);
    for (const forbidden of ['deviceIdentityRef', 'personIdentityRef', 'sessionRef', 'role']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(e)).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/); // ham VIN deseni
  });

  it('A5 — SYSTEM_INTERNAL yalnız RUNTIME_ADMIN alır; teşhis/silme ALAMAZ', () => {
    expect(ask('SYSTEM_INTERNAL', 'RUNTIME_ADMIN').allowed).toBe(true);
    expect(ask('SYSTEM_INTERNAL', 'CLEAR_DTC').allowed).toBe(false);
    expect(ask('SYSTEM_INTERNAL', 'DIAGNOSTIC_READ').allowed).toBe(false);
    expect(ask('SYSTEM_INTERNAL', 'STORAGE_ADMIN').allowed).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) LOCAL UI · MAVI İZOLASYONU
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/B · UI ve Mavi izolasyonu', () => {
  it('B1 — LOCAL_UI düşük riskli kontrolü yapabilir', () => {
    expect(ask('LOCAL_UI', 'MEDIA_CONTROL').allowed).toBe(true);
    expect(ask('LOCAL_UI', 'NAVIGATION_CONTROL').allowed).toBe(true);
  });

  it('B2 — LOCAL_UI yönetimsel/ayrıcalıklı yetki ALAMAZ', () => {
    expect(ask('LOCAL_UI', 'RUNTIME_ADMIN').allowed).toBe(false);
    expect(ask('LOCAL_UI', 'DIAGNOSTIC_PRIVILEGED').allowed).toBe(false);
    expect(ask('LOCAL_UI', 'REMOTE_INPUT').allowed).toBe(false);
  });

  it('B3 — Mavi düşük riskli kontrolü yapabilir', () => {
    expect(ask('MAVI', 'MEDIA_CONTROL').allowed).toBe(true);
    expect(ask('MAVI', 'NAVIGATION_CONTROL').allowed).toBe(true);
  });

  it('B4 — Mavi KENDİNE yetki VEREMEZ: silme/runtime/depolama reddedilir', () => {
    expect(ask('MAVI', 'CLEAR_DTC').allowed).toBe(false);
    expect(ask('MAVI', 'RUNTIME_ADMIN').allowed).toBe(false);
    expect(ask('MAVI', 'STORAGE_ADMIN').allowed).toBe(false);
    expect(ask('MAVI', 'DIAGNOSTIC_PRIVILEGED').allowed).toBe(false);
  });

  it('B5 — Mavi genel teşhis izniyle SİLME yapamaz (CLEAR_DTC ayrıdır)', () => {
    expect(ask('MAVI', 'DIAGNOSTIC_READ').allowed).toBe(true);
    expect(ask('MAVI', 'CLEAR_DTC').allowed).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) PHONE TRUST ZİNCİRİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/C · telefon güven zinciri', () => {
  const linked = (over: Record<string, unknown> = {}) => ({
    attached: true, authenticated: true, generation: 3, currentGeneration: 3,
    negotiatedCapabilities: ['MEDIA'], available: true, ...over,
  });

  it('C1 — doğrulanmamış telefon reddedilir', () => {
    expect(ask('PHONE_LINK', 'MEDIA_CONTROL', linked({ authenticated: false })).allowed).toBe(false);
  });

  it('C2 — doğrulanmış ama BAĞLI OLMAYAN telefon reddedilir', () => {
    expect(ask('PHONE_LINK', 'PHONE_CONTROL', linked({ attached: false, negotiatedCapabilities: ['CALLS'] })).allowed).toBe(false);
  });

  it('C3 — bağlı ama yeteneği ANLAŞILMAMIŞ telefon reddedilir', () => {
    expect(ask('PHONE_LINK', 'PHONE_CONTROL', linked({ negotiatedCapabilities: [] })).allowed).toBe(false);
  });

  it('C4 — doğru anlaşılmış yetenekle çalışır', () => {
    expect(ask('PHONE_LINK', 'MEDIA_CONTROL', linked()).allowed).toBe(true);
  });

  it('C4b — CONNECTED taşıma yetki DEĞİLDİR: doğrulanmamış oturumda yetenek listesi BOŞ sayılır', () => {
    /* Telefon MEDIA anlaşmış görünse bile kimlik doğrulanmamışsa yetki YOKTUR —
       "önbellekte yeteneği vardı" bir izin kaynağı değildir. */
    expect(ask('PHONE_LINK', 'MEDIA_CONTROL', linked({ authenticated: false })).allowed).toBe(false);
    expect(ask('PHONE_LINK', 'MEDIA_CONTROL', linked({ attached: false })).allowed).toBe(false);
  });

  it('C5 — MEDIA izni teşhis/silme YAPAMAZ (yanlış yetenek reddedilir)', () => {
    expect(ask('PHONE_LINK', 'DIAGNOSTIC_READ', linked()).allowed).toBe(false);
    expect(ask('PHONE_LINK', 'CLEAR_DTC', linked()).allowed).toBe(false);
    expect(ask('PHONE_LINK', 'RUNTIME_ADMIN', linked()).allowed).toBe(false);
  });

  it('C6 — BAYAT nesil reddedilir', () => {
    expect(ask('PHONE_LINK', 'MEDIA_CONTROL', linked({ generation: 2, currentGeneration: 3 })).allowed).toBe(false);
  });

  it('C7 — companion yetenek haritası teşhis/runtime/depolama ÜRETEMEZ', () => {
    const tokens = ['MEDIA', 'CALLS', 'CONTACTS', 'SMS', 'FILES', 'PHOTOS', 'VIDEO',
      'NOTIFICATIONS', 'VOICE', 'AUDIO_STREAM', 'TEXT_REPLY', 'BACKGROUND_SYNC', 'HEALTH'];
    for (const cap of ['DIAGNOSTIC_READ', 'CLEAR_DTC', 'DIAGNOSTIC_PRIVILEGED', 'RUNTIME_ADMIN', 'STORAGE_ADMIN', 'SETTINGS_WRITE'] as const) {
      expect(ask('PHONE_LINK', cap, linked({ negotiatedCapabilities: tokens })).allowed).toBe(false);
    }
  });

  it('C8 — kontrol komutu sınıflandırması: bilinmeyen alt alan UNKNOWN ⇒ DENY', () => {
    expect(controlCapabilityOf('companion.control.media')).toBe('MEDIA_CONTROL');
    expect(controlCapabilityOf('companion.control.call')).toBe('PHONE_CONTROL');
    expect(controlCapabilityOf('companion.control.diagnostic')).toBe('UNKNOWN');
    expect(controlCapabilityOf('companion.control.runtime')).toBe('UNKNOWN');
    /* Kontrol OLMAYAN mesaj kapıya hiç girmez (el sıkışma/telemetri bozulmaz). */
    expect(controlCapabilityOf('companion.hello')).toBeNull();
    expect(controlCapabilityOf('companion.ack')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) ARAÇ KAPSAMI · İPTAL · TOCTOU
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/D · araç kapsamı, iptal ve TOCTOU', () => {
  it('D1 — A aracında verilen izin B aracında GEÇERSİZDİR', () => {
    const op = ask('LOCAL_UI', 'CLEAR_DTC');
    expect(op.allowed).toBe(true);
    _setSecurityContextForTest(OTHER_VEHICLE);
    expect(revalidateAuthorization(op)).toBe(false);
  });

  it('D2 — araç kimliği YOKKEN araç kapsamlı yetki reddedilir', () => {
    _setSecurityContextForTest({ vehicleRef: null, motion: 'PARKED' });
    expect(ask('LOCAL_UI', 'CLEAR_DTC').allowed).toBe(false);
  });

  it('D3 — TOCTOU: yürütmeden önce hareket bozulursa yetki DÜŞER', () => {
    const op = ask('LOCAL_UI', 'CLEAR_DTC');
    expect(op.allowed).toBe(true);
    _setSecurityContextForTest(MOVING);
    expect(revalidateAuthorization(op)).toBe(false);
  });

  it('D4 — TOCTOU: telefon nesli ilerlerse yetki DÜŞER', () => {
    const ch = { attached: true, authenticated: true, generation: 4, currentGeneration: 4, negotiatedCapabilities: ['MEDIA'] };
    const op = ask('PHONE_LINK', 'MEDIA_CONTROL', ch);
    expect(op.allowed).toBe(true);
    expect(revalidateAuthorization(op, { ...ch, currentGeneration: 5 })).toBe(false);
  });

  it('D5 — İPTAL: oturum ayrılırsa aynı karar artık yürütülemez', () => {
    const ch = { attached: true, authenticated: true, generation: 1, currentGeneration: 1, negotiatedCapabilities: ['CALLS'] };
    const op = ask('PHONE_LINK', 'PHONE_CONTROL', ch);
    expect(op.allowed).toBe(true);
    expect(revalidateAuthorization(op, { ...ch, attached: false })).toBe(false);
  });

  it('D6 — İPTAL: yetenek geri alınırsa aynı karar yürütülemez', () => {
    const ch = { attached: true, authenticated: true, generation: 1, currentGeneration: 1, negotiatedCapabilities: ['MEDIA'] };
    const op = ask('PHONE_LINK', 'MEDIA_CONTROL', ch);
    expect(op.allowed).toBe(true);
    expect(revalidateAuthorization(op, { ...ch, negotiatedCapabilities: [] })).toBe(false);
  });

  it('D7 — reddedilmiş bir karar ASLA yeniden doğrulanamaz', () => {
    const op = ask('MAVI', 'CLEAR_DTC');
    expect(op.allowed).toBe(false);
    expect(revalidateAuthorization(op)).toBe(false);
  });

  it('D8 — karar BAŞKA operasyon veya BAŞKA yetenek için kullanılamaz', () => {
    const op = authorizeOperation({
      principalClass: 'LOCAL_UI', capability: 'MEDIA_CONTROL',
      operationId: 'op-A', targetRef: null,
    });
    expect(decisionMatchesOperation(op.evidence, 'op-A', 'MEDIA_CONTROL')).toBe(true);
    expect(decisionMatchesOperation(op.evidence, 'op-B', 'MEDIA_CONTROL')).toBe(false);
    expect(decisionMatchesOperation(op.evidence, 'op-A', 'CLEAR_DTC')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) HAREKET / BAĞLAM POLİTİKASI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/E · hareket ve bağlam politikası', () => {
  it('E1 — BİLİNMEYEN hareket yüksek riskli işlemi BLOKLAR (unknown ≠ parked)', () => {
    _setSecurityContextForTest(UNKNOWN_MOTION);
    const op = ask('LOCAL_UI', 'CLEAR_DTC');
    expect(op.allowed).toBe(false);
    expect(op.evidence.decision).toBe('MOTION_RESTRICTED');
  });

  it('E2 — hareket hâlinde yüksek riskli işlem BLOKLANIR', () => {
    _setSecurityContextForTest(MOVING);
    expect(ask('LOCAL_UI', 'CLEAR_DTC').allowed).toBe(false);
  });

  it('E3 — düşük riskli medya/navigasyon hareket yüzünden BLOKLANMAZ', () => {
    _setSecurityContextForTest(MOVING);
    expect(ask('LOCAL_UI', 'MEDIA_CONTROL').allowed).toBe(true);
    expect(ask('LOCAL_UI', 'NAVIGATION_CONTROL').allowed).toBe(true);
  });

  it('E4 — hareket kaynağı GPS DEĞİLDİR (wiring yalnız OBD ölçümünü okur)', () => {
    const src = readFileSync('src/platform/security/securityWiring.ts', 'utf8');
    expect(src).toContain('getObdSpeedFresh');
    expect(src).not.toMatch(/gpsService|getGPSState|onGPSLocation/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) OBD — SINIFLANDIRMA VE ÇİFT KAPI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/F · OBD sınıflandırma ve çift kapı', () => {
  it('F1 — salt-okunur servisler DIAGNOSTIC_READ sınıfındadır', () => {
    for (const sid of ['01', '03', '06', '07', '09', '0A', '10', '13', '17', '18', '19', '1A', '21', '22', '3E']) {
      expect(classifyDiagnosticOperation(sid), sid).toBe('DIAGNOSTIC_READ');
    }
  });

  it('F2 — yıkıcı servisler privileged/CLEAR sınıfına düşer ve yetki bulunmaz', () => {
    const expected: Record<string, string> = {
      '04': 'CLEAR_DTC', '14': 'CLEAR_DTC', '11': 'ACTIVE_TEST', '2F': 'ACTIVE_TEST',
      '85': 'ACTIVE_TEST', '28': 'ACTIVE_TEST', '31': 'ROUTINE_CONTROL', '27': 'SECURITY_ACCESS',
      '2E': 'WRITE_DATA', '3B': 'WRITE_DATA', '34': 'FLASHING', '35': 'FLASHING',
      '36': 'FLASHING', '37': 'FLASHING',
    };
    for (const [sid, cls] of Object.entries(expected)) {
      expect(classifyDiagnosticOperation(sid), sid).toBe(cls);
    }
  });

  it('F3 — BİLİNMEYEN/bozuk servis bayti UNKNOWN ⇒ DENY', () => {
    for (const bad of ['', 'ZZ', '1', '123', null, undefined, '99', '7F']) {
      expect(classifyDiagnosticOperation(bad as string)).toBe('UNKNOWN');
    }
    expect(diagnosticCapabilityFor('UNKNOWN')).toBe('UNKNOWN');
  });

  it('F4 — SecurityAccess (0x27) hiçbir principal için ÜRETİLEMEZ', () => {
    for (const p of ['LOCAL_UI', 'MAVI', 'PHONE_LINK', 'PHONE_REMOTE', 'SYSTEM_INTERNAL'] as const) {
      const r = judgeDiagnosticOperation({ principalClass: p, service: '27', operationId: opId(), targetRef: '7E0' });
      expect(r.operationClass).toBe('SECURITY_ACCESS');
      expect(r.allowed).toBe(false);
    }
  });

  it('F5 — privileged sınıflar DIAGNOSTIC_PRIVILEGED yetkisine düşer ve kimse alamaz', () => {
    for (const cls of ['ACTIVE_TEST', 'ROUTINE_CONTROL', 'SECURITY_ACCESS', 'WRITE_DATA', 'CODING', 'ADAPTATION', 'FLASHING'] as const) {
      expect(diagnosticCapabilityFor(cls)).toBe('DIAGNOSTIC_PRIVILEGED');
    }
    for (const p of ['LOCAL_UI', 'MAVI', 'PHONE_REMOTE'] as const) {
      expect(ask(p, 'DIAGNOSTIC_PRIVILEGED').allowed).toBe(false);
    }
  });

  it('F6 — güvenli okuma ürün yolunda ÇALIŞIR (kapı okumayı öldürmez)', () => {
    const r = judgeDiagnosticOperation({ principalClass: 'LOCAL_UI', service: '03', operationId: opId(), targetRef: '7DF' });
    expect(r.operationClass).toBe('DIAGNOSTIC_READ');
    expect(r.allowed).toBe(true);
  });

  it('F7 — ÇİFT KAPI: TS kapısı native beyaz listeyi GENİŞLETEMEZ', () => {
    const nativeGate = readFileSync('android/app/src/main/java/com/cockpitos/pro/obd/DiagnosticServiceGate.java', 'utf8');
    /* Native beyaz listedeki her servis TS'te de salt-okunur sınıfta olmalı;
       TS'te salt-okunur sayılan hiçbir servis native destructive kümesinde
       OLMAMALIDIR — iki kapı ayrışırsa biri sessizce gevşemiş demektir. */
    const readOnly = (nativeGate.match(/"([0-9A-F]{2})"/g) ?? []).map((x) => x.replace(/"/g, ''));
    const destructive = ['04', '11', '14', '27', '28', '2E', '2F', '31', '34', '35', '36', '37', '3B', '85'];
    for (const sid of destructive) {
      expect(classifyDiagnosticOperation(sid), `native destructive ${sid} TS'te READ olamaz`).not.toBe('DIAGNOSTIC_READ');
    }
    expect(readOnly.length).toBeGreaterThan(0);
  });

  it('F8 — TS kapısı reddedince native köprü HİÇ çağrılmaz (ürün kodu kanıtı)', () => {
    const src = readFileSync('src/platform/obd/genericPduTransport.ts', 'utf8');
    const authzIdx = src.indexOf('judgeDiagnosticOperation({');
    const sendIdx = src.indexOf('const r = await fn({');
    expect(authzIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(authzIdx); // yetki kapısı gönderimden ÖNCE
    expect(src).toContain("pduUnmeasured('DENIED_BY_SAFETY_GATE'");
  });

  it('F9 — native kapı GEVŞETİLMEDİ: destructive küme aynen duruyor', () => {
    const nativeGate = readFileSync('android/app/src/main/java/com/cockpitos/pro/obd/DiagnosticServiceGate.java', 'utf8');
    for (const sid of ['04', '11', '14', '27', '28', '2E', '2F', '31', '34', '35', '36', '37', '3B', '85']) {
      expect(nativeGate).toContain(`"${sid}"`);
    }
    expect(nativeGate).toContain('DENY_SERVICE_NOT_READ_ONLY');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) CLEAR DTC AYRIMI VE ÜRÜN YOLU
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/G · CLEAR_DTC ürün yolu', () => {
  it('G1 — CLEAR_DTC ile DIAGNOSTIC_READ AYRI yetkilerdir', () => {
    expect(CAPABILITIES.CLEAR_DTC.riskClass).toBe('DESTRUCTIVE');
    expect(CAPABILITIES.DIAGNOSTIC_READ.riskClass).toBe('READ_ONLY');
    expect(CAPABILITIES.CLEAR_DTC.parkedOnly).toBe(true);
    expect(CAPABILITIES.CLEAR_DTC.requiresVehicleScope).toBe(true);
  });

  it('G2 — okuma yetkisi silme yetkisi DEĞİLDİR (uzak kanal)', () => {
    expect(ask('PHONE_REMOTE', 'DIAGNOSTIC_READ').allowed).toBe(true);
    expect(ask('PHONE_REMOTE', 'CLEAR_DTC').allowed).toBe(false);
  });

  it('G3 — uzak kanal silmeyi YALNIZ E2E kanıtıyla kazanır', () => {
    expect(ask('PHONE_REMOTE', 'CLEAR_DTC', { e2eVerified: false, authenticated: true }).allowed).toBe(false);
    expect(ask('PHONE_REMOTE', 'CLEAR_DTC', { e2eVerified: true, authenticated: true }).allowed).toBe(true);
  });

  it('G4 — ürün yolu: `clearDTCCodes` yetki kapısı native çağrıdan ÖNCE', () => {
    const src = readFileSync('src/platform/dtcService.ts', 'utf8');
    const authz = src.indexOf('authorizeOperation({');
    const deny = src.indexOf("reason: 'not_authorized'");
    /* GERÇEK yan etki satırı: köprünün ÇAĞRILDIĞI yer (varlık ölçümü değil). */
    const native = src.indexOf('await CarLauncher.clearDtcCodes()');
    expect(authz).toBeGreaterThan(0);
    expect(deny).toBeGreaterThan(authz);
    expect(native).toBeGreaterThan(deny);
    /* Yan etkiden HEMEN ÖNCE yeniden doğrulama ZORUNLU. */
    expect(src).toContain('revalidateAuthorization(authorization');
  });

  it('G5 — çağıranlar KENDİ sınıflarını taşır (varsayılana yaslanma YOK)', () => {
    expect(readFileSync('src/platform/commandExecutor.ts', 'utf8')).toContain("principal: 'MAVI'");
    expect(readFileSync('src/components/obd/DTCPanel.tsx', 'utf8')).toContain("principal: 'LOCAL_UI'");
    expect(readFileSync('src/platform/remoteDiagnosticCommands.ts', 'utf8')).toContain("principal: 'PHONE_REMOTE'");
  });

  it('G6 — E2E kanıtını YALNIZ kanal sahibi üretir', () => {
    const listener = readFileSync('src/platform/commandListener.ts', 'utf8');
    const remote = readFileSync('src/platform/remoteDiagnosticCommands.ts', 'utf8');
    expect(listener).toContain('e2eVerified = true');
    expect(listener).toContain('executeClearDtc({ e2eVerified })');
    /* Yürütücü kanıtı UYDURAMAZ: PARAMETRE olarak alır ve yalnız onu okur. */
    expect(remote).toContain('channel: RemoteChannelEvidence = {}');
    expect(remote).toContain('channel.e2eVerified === true');
    /* Kanıt PARAMETREDEN gelir: yürütücüde `e2eVerified` üreten bir atama YOK. */
    expect(remote).not.toContain('e2eVerified = true');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H) RUNTIME ADMIN
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/H · runtime admin', () => {
  it('H1 — normal UI / Mavi / telefon elle runtime yönetimi YAPAMAZ', () => {
    for (const p of ['LOCAL_UI', 'MAVI', 'PHONE_LINK', 'PHONE_REMOTE'] as const) {
      expect(ask(p, 'RUNTIME_ADMIN').allowed).toBe(false);
    }
  });

  it('H2 — iç kurtarma yolu bozulmadı: kapı YALNIZ MANUAL_INTERNAL için işler', () => {
    const src = readFileSync('src/platform/runtime/runtimeRecoverySupervisor.ts', 'utf8');
    expect(src).toContain("if (request.source === 'MANUAL_INTERNAL')");
    /* Otomatik kaynaklar kapıya HİÇ girmez → mevcut mekanizma aynen çalışır. */
    expect(src).not.toMatch(/source === 'HEALTH_MONITOR'\s*\)\s*\{[^}]*authorizeOperation/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I) AYAR VE DEPOLAMA
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/I · ayar ve depolama', () => {
  it('I1 — hassas ayar anahtarları doğru sınıflanır', () => {
    expect(classifySetting('developerMode')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('expertWriteUnlock')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('debugOverlay')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('trustedDevice')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('nativeOverride')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('unsafeBypass')).toBe('SECURITY_SENSITIVE');
    expect(classifySetting('runtimeForceRestart')).toBe('RUNTIME_ADMIN');
    expect(classifySetting('theme')).toBe('NORMAL_USER');
    /* Boş/bozuk anahtar en GENİŞ sınıfa DÜŞMEZ (fail-closed). */
    expect(classifySetting('')).toBe('SECURITY_SENSITIVE');
  });

  it('I2 — normal ayar yetki istemez; hassas ayar SETTINGS_WRITE ister', () => {
    expect(settingCapabilityFor('NORMAL_USER')).toBeNull();
    expect(settingCapabilityFor('SECURITY_SENSITIVE')).toBe('SETTINGS_WRITE');
    expect(settingCapabilityFor('RUNTIME_ADMIN')).toBe('RUNTIME_ADMIN');
  });

  it('I3 — Mavi hassas ayarı uygulayamaz; runtime ayarını KİMSE uygulayamaz', () => {
    expect(authorizeSettingApply({ principalClass: 'MAVI', key: 'developerMode', operationId: opId() }).allowed).toBe(false);
    for (const p of ['LOCAL_UI', 'MAVI', 'PHONE_REMOTE'] as const) {
      expect(authorizeSettingApply({ principalClass: p, key: 'runtimeForceRestart', operationId: opId() }).allowed).toBe(false);
    }
  });

  it('I4 — KALICI AYAR DEĞERİ yetki ÜRETMEZ (hidrasyon kapı açamaz)', () => {
    /* Yetki yalnız principal sınıfından ve kanal kanıtından doğar; hiçbir
       yerde depodan okunan bir değer `grantedCapabilities`e eklenmez. */
    const src = readFileSync('src/platform/security/enforcement.ts', 'utf8');
    expect(src).not.toMatch(/safeGetRaw|localStorage|useStore|getState\(\)/);
    /* Aynı anahtar, farklı principal → farklı sonuç: karar principal'a bağlı. */
    expect(authorizeSettingApply({ principalClass: 'LOCAL_UI', key: 'developerMode', operationId: opId() }).allowed).toBe(true);
    expect(authorizeSettingApply({ principalClass: 'UNKNOWN', key: 'developerMode', operationId: opId() }).allowed).toBe(false);
  });

  it('I5 — STORAGE_ADMIN yalnız LOCAL_UI; SETTINGS_WRITE onu ÜRETMEZ', () => {
    expect(authorizeStorageAdmin({ principalClass: 'LOCAL_UI', operation: 'FULL_RESET', operationId: opId() }).allowed).toBe(true);
    for (const p of ['MAVI', 'PHONE_LINK', 'PHONE_REMOTE', 'SYSTEM_INTERNAL', 'LAB'] as const) {
      expect(authorizeStorageAdmin({ principalClass: p, operation: 'FULL_RESET', operationId: opId() }).allowed).toBe(false);
    }
    /* PHONE_REMOTE'un SETTINGS_WRITE yetkisi var ama STORAGE_ADMIN'i YOK.
       Kimlik kanıtı ZORUNLUDUR: kanıtsız çağrı `NOT_AUTHENTICATED` düşer. */
    expect(ask('PHONE_REMOTE', 'SETTINGS_WRITE').evidence.decision).toBe('NOT_AUTHENTICATED');
    expect(ask('PHONE_REMOTE', 'SETTINGS_WRITE', { authenticated: true }).allowed).toBe(true);
    expect(ask('PHONE_REMOTE', 'STORAGE_ADMIN', { authenticated: true }).allowed).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   J) REPLAY / IMPORT / LAB İZOLASYONU
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/J · replay, import ve LAB izolasyonu', () => {
  it('J1 — REPLAY / IMPORTED / LAB canlı yetki ÜRETEMEZ', () => {
    for (const p of ['REPLAY', 'IMPORTED', 'LAB'] as const) {
      for (const cap of ['MEDIA_CONTROL', 'DIAGNOSTIC_READ', 'CLEAR_DTC', 'RUNTIME_ADMIN', 'STORAGE_ADMIN'] as const) {
        expect(ask(p, cap).allowed, `${p}/${cap}`).toBe(false);
      }
    }
  });

  it('J2 — geçmişte ALLOW olmuş olmak ŞİMDİ allow DEĞİLDİR', () => {
    const live = ask('LOCAL_UI', 'CLEAR_DTC');
    expect(live.allowed).toBe(true);
    const replayed = ask('REPLAY', 'CLEAR_DTC');
    expect(replayed.allowed).toBe(false);
    expect(replayed.evidence.reason).toBe('non_live_provenance_cannot_authorize');
  });

  it('J3 — LAB modeli SALT-OKUNUR ve yetki üretmez', () => {
    const model = getSecurityTrustCapabilityLabModel();
    expect(model.readOnly).toBe(true);
    const src = readFileSync('src/platform/devtools/securityTrustCapabilityModel.ts', 'utf8');
    expect(src).not.toMatch(/authorizeOperation|authorizeSettingApply|authorizeStorageAdmin|revalidateAuthorization/);
    const screen = readFileSync('src/components/devtools/screens/SecurityTrustCapabilityScreen.tsx', 'utf8');
    expect(screen).not.toMatch(/CarLauncher|clearDTC|grant\(|setInterval|fetch\(/);
  });

  it('J4 — DENETİM DEFTERİ yetki ÜRETEMEZ (karar defteri okumaz)', () => {
    const src = readFileSync('src/platform/security/authorization.ts', 'utf8');
    const authorizeBody = src.slice(src.indexOf('export function authorize('));
    const body = authorizeBody.slice(0, authorizeBody.indexOf('\n}'));
    expect(body).not.toContain('recentDecisions.some');
    expect(body).not.toContain('recentDecisions.find');
    expect(body).not.toContain('getRecentSecurityDecisions');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   K) NATIVE İZİN AYRIMI VE CONFUSED DEPUTY
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/K · native izin ayrımı ve confused deputy', () => {
  it('K1 — native izin TEK BAŞINA yetki DEĞİLDİR', () => {
    /* Native izin AÇIKÇA verilmiş sayılsa bile yetenek kapısı ayrı işler. */
    const op = authorizeOperation({
      principalClass: 'MAVI', capability: 'CLEAR_DTC',
      operationId: opId(), targetRef: null, nativePermission: true,
    });
    expect(op.allowed).toBe(false);
    expect(op.evidence.decision).toBe('CAPABILITY_NOT_GRANTED');
  });

  it('K2 — alan-arası yetki devri YOK', () => {
    /* MEDIA → OBD yok; MEDIA → RUNTIME yok; SETTINGS → DIAGNOSTIC yok. */
    const media = { attached: true, authenticated: true, negotiatedCapabilities: ['MEDIA'] };
    expect(ask('PHONE_LINK', 'DIAGNOSTIC_READ', media).allowed).toBe(false);
    expect(ask('PHONE_LINK', 'RUNTIME_ADMIN', media).allowed).toBe(false);
    expect(ask('PHONE_REMOTE', 'DIAGNOSTIC_PRIVILEGED', { e2eVerified: true, authenticated: true }).allowed).toBe(false);
  });

  it('K3 — yetenek HEDEF ALANA bağlıdır: karar hedefi kanıtta taşınır', () => {
    const op = authorizeOperation({
      principalClass: 'LOCAL_UI', capability: 'MEDIA_CONTROL',
      operationId: 'op-target', targetRef: 'media:play',
    });
    expect(op.evidence.targetRef).toBe('media:play');
    expect(op.evidence.capability).toBe('MEDIA_CONTROL');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L) FAIL-OPEN / BYPASS TARAMASI
   ═══════════════════════════════════════════════════════════════════════════ */

const SECURITY_SOURCES = [
  'src/platform/security/authorization.ts',
  'src/platform/security/enforcement.ts',
  'src/platform/security/securityWiring.ts',
];

describe('ARCH-05/L · fail-open ve bypass taraması', () => {
  it('L1 — güvenlik kaynaklarında varsayılan-izin deseni YOK', () => {
    for (const file of SECURITY_SOURCES) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/\?\?\s*true\b/);
      expect(src, file).not.toMatch(/\|\|\s*true\b/);
      expect(src, file).not.toMatch(/defaultAllow|skipAuth|forceAllow|allowAll/i);
      expect(src, file).not.toMatch(/catch\s*\{\s*return true/);
      expect(src, file).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*return true/);
    }
  });

  it('L2 — istisna hâlinde ALLOW imkânsız: bağlam düşerse UNKNOWN döner', () => {
    _setSecurityContextForTest(null);
    _resetSecurityContextReadersForTest();
    /* Okuyucular bağlı değil → araç yok + hareket bilinmiyor → yıkıcı DENY. */
    expect(ask('LOCAL_UI', 'CLEAR_DTC').allowed).toBe(false);
  });

  it('L3 — test-only kancalar ÜRETİM kodundan çağrılmaz', () => {
    const forbidden = ['_setSecurityContextForTest', '_resetSecurityContextReadersForTest', '_resetSecurityDecisionsForTest'];
    const productionFiles = [
      'src/platform/dtcService.ts', 'src/platform/commandListener.ts',
      'src/platform/remoteDiagnosticCommands.ts', 'src/platform/commandExecutor.ts',
      'src/platform/obd/genericPduTransport.ts', 'src/platform/tripLogService.ts',
      'src/platform/companion/companionSessionManager.ts',
      'src/platform/runtime/runtimeRecoverySupervisor.ts',
      'src/platform/devtools/securityTrustCapabilityModel.ts',
      'src/components/devtools/screens/SecurityTrustCapabilityScreen.tsx',
    ];
    for (const file of productionFiles) {
      const src = readFileSync(file, 'utf8');
      for (const hook of forbidden) expect(src, `${file} → ${hook}`).not.toContain(hook);
    }
  });

  it('L4 — güvenlik katmanı hiçbir şey YÜRÜTMEZ (yönlendirme/komut yok)', () => {
    const src = readFileSync('src/platform/security/enforcement.ts', 'utf8');
    expect(src).not.toMatch(/CarLauncher|setTimeout|setInterval|fetch\(|await /);
  });

  it('L5 — ÜRETİM ADOPSİYON ENVANTERİ: yaptırım noktaları SABİTTİR', () => {
    /* Yeni bir yaptırım noktası eklemek serbesttir; SESSİZCE KAYBOLMASI
       değildir. Bu kilit, bir alan kapısının fark edilmeden sökülmesini
       imkânsız kılar. */
    const points: readonly [string, string][] = [
      ['src/platform/dtcService.ts', 'authorizeOperation({'],
      ['src/platform/obd/genericPduTransport.ts', 'judgeDiagnosticOperation({'],
      ['src/platform/companion/companionSessionManager.ts', 'authorizeOperation({'],
      ['src/platform/runtime/runtimeRecoverySupervisor.ts', 'authorizeOperation({'],
      ['src/platform/commandListener.ts', 'authorizeSettingApply({'],
      ['src/platform/tripLogService.ts', 'authorizeStorageAdmin({'],
    ];
    for (const [file, call] of points) {
      expect(readFileSync(file, 'utf8'), file).toContain(call);
    }
  });

  it('L6 — hiçbir çağıran KENDİNİ SYSTEM_INTERNAL ilan edemez', () => {
    /* `SYSTEM_INTERNAL` tek ayrıcalıklı sınıftır (RUNTIME_ADMIN). Bir alan
       kapısının onu sabit olarak yazması, kendine yetki vermesi demektir.
       Runtime yolu bile sınıfı VERİ olarak (`request.principal`) alır. */
    const productionFiles = [
      'src/platform/dtcService.ts', 'src/platform/commandListener.ts',
      'src/platform/remoteDiagnosticCommands.ts', 'src/platform/commandExecutor.ts',
      'src/platform/obd/genericPduTransport.ts', 'src/platform/tripLogService.ts',
      'src/platform/companion/companionSessionManager.ts',
      'src/platform/runtime/runtimeRecoverySupervisor.ts',
      'src/components/obd/DTCPanel.tsx',
    ];
    for (const file of productionFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/principalClass:\s*'SYSTEM_INTERNAL'/);
    }
    expect(readFileSync('src/platform/runtime/runtimeRecoverySupervisor.ts', 'utf8'))
      .toContain("request.principal ?? 'UNKNOWN'");
  });

  it('L7 — dev/debug yüzeyi yetki ÜRETEMEZ', () => {
    /* Bir ekranın gizli olması güvenlik DEĞİLDİR; asıl güvence, dev yollarının
       principal sınıfına dokunamamasıdır. Güvenlik katmanında DEV dalı YOKTUR. */
    for (const file of SECURITY_SOURCES) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/import\.meta\.env|__DEV__|isDev|developerMode/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   M) KANIT · GİZLİLİK · MATRİS DÜRÜSTLÜĞÜ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-05/M · kanıt, gizlilik ve matris dürüstlüğü', () => {
  it('M1 — her karar ARCH-03 operasyonuna BAĞLANIR', () => {
    _resetSecurityDecisionsForTest();
    authorizeOperation({ principalClass: 'LOCAL_UI', capability: 'MEDIA_CONTROL', operationId: 'corr-1', targetRef: 'media' });
    const [latest] = getRecentSecurityDecisions();
    expect(latest?.correlationId).toBe('corr-1');
    expect(latest?.capability).toBe('MEDIA_CONTROL');
  });

  it('M2 — kanıt defteri SINIRLIDIR ve ham veri taşımaz', () => {
    _resetSecurityDecisionsForTest();
    for (let i = 0; i < 60; i += 1) ask('LOCAL_UI', 'MEDIA_CONTROL');
    const decisions = getRecentSecurityDecisions();
    expect(decisions.length).toBeLessThanOrEqual(40);
    const dump = JSON.stringify(decisions);
    expect(dump).not.toMatch(/token|password|secret|payload/i);
    for (const d of decisions) expect(d.principalRef).toMatch(/^principal:/);
  });

  it('M3 — LAB gerçek üretim kararlarını gösterir (sentetik demo YOK)', () => {
    _resetSecurityDecisionsForTest();
    ask('MAVI', 'CLEAR_DTC');
    const model = getSecurityTrustCapabilityLabModel();
    expect(model.decisions.length).toBeGreaterThan(0);
    expect(model.decisions[0]?.capability).toBe('CLEAR_DTC');
    expect(model.decisions[0]?.decision).not.toBe('ALLOW');
    expect(model.grants.length).toBeGreaterThan(0);
    expect(model.context.motion).toBe('PARKED');
  });

  it('M4 — yetenek durum matrisi DÜRÜSTTÜR: bilinmeyen ⇒ ALLOW yok', () => {
    for (const cap of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
      expect(CAPABILITY_STATUS[cap], cap).toBeDefined();
    }
    expect(CAPABILITY_STATUS.DIAGNOSTIC_PRIVILEGED).toBe('DENY_DEFAULT');
    expect(CAPABILITY_STATUS.REMOTE_INPUT).toBe('DENY_DEFAULT');
    expect(CAPABILITY_STATUS.UNKNOWN).toBe('NOT_SUPPORTED');
    /* Sözleşmede karşılığı olmayanlar GİZLENMEZ. */
    expect(UNMODELLED_CAPABILITIES.MAVI_ACTION).toBe('NOT_SUPPORTED');
    expect(UNMODELLED_CAPABILITIES.MEDIA_CAST).toBe('NOT_SUPPORTED');
  });

  it('M5 — DENY_DEFAULT yetenekler hiçbir yetki tablosunda YOK', () => {
    for (const [principal, caps] of Object.entries(principalGrantMatrix())) {
      expect(caps, principal).not.toContain('DIAGNOSTIC_PRIVILEGED');
      expect(caps, principal).not.toContain('REMOTE_INPUT');
      expect(caps, principal).not.toContain('UNKNOWN');
    }
  });
});
