/**
 * phoneHubFieldValidation.test.tsx — PHONE-HUB P0.8 KİLİTLERİ.
 *
 * ANA İLKELER (bozulursa kilit düşer):
 *  1. UNKNOWN VARSAYILANDIR — araç yokken hiçbir alan "başarılı" görünmez.
 *  2. TELEFONDA ALINAN ÖLÇÜM head unit otoritesi/sonucu ÜRETMEZ.
 *  3. Kullanıcı onayı TEKNİK KANITIN YERİNE GEÇMEZ.
 *  4. automotive özelliğinin YOKLUĞU head unit olmadığını KANITLAMAZ.
 *  5. Tek zayıf paket eşleşmesi / yalnız servis varlığı authority kanıtı DEĞİLDİR.
 *  6. P1-A yedi koşulun TAMAMI olmadan ASLA açılmaz.
 *  7. Senaryo sıfırlama İZOLEDİR ve sistem durumuna dokunmaz.
 *  8. PII (MAC · numara · kişi · parça adı · paket adı) modele, diske ve dışa
 *     aktarıma SIZMAZ.
 *  9. Ekran hiçbir yasak yüzeye (eşleştirme/tarama/komut/izin) dokunmaz.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  createSession, withIdentity, withUserAffirmation, withScenarioCapture,
  withScenarioReset, withStaleness, buildFieldSummary, buildFieldExport,
  classifyDeviceRole, deviceRoleConfidence, countHeadUnitSignals, areScenariosLocked,
  nextScenarioStatus, applyScenarioStaleness, emptyScenario,
  decideAuthorities, controlPlaneConfidence, assessCoexistence, assessReadiness,
  mediaResultOf, callResultOf, migrateSession, sanitizeForExport, maskPii, isDeniedKey,
  buildScenarioObservations, detectScenarioBlockers, isSessionStale, isCriticalBlocker,
  confidenceAtLeast, weakestAuthorityConfidence,
  SCENARIO_ORDER, SCENARIO_INSTRUCTION, SCENARIO_STALE_MS, SESSION_STALE_MS,
  PH_FIELD_SCHEMA_VERSION, PH_FIELD_STORAGE_KEY, PHONE_LOCK_MESSAGE,
  MAX_OBSERVATIONS_PER_SCENARIO,
  type PhoneHubFieldRaw, type PhFieldIdentity, type PhoneHubFieldValidationSession,
  type ScenarioId, type Confidence,
} from '../platform/devtools/phoneHubFieldModel';
import {
  saveFieldSession, loadFieldSession, deleteFieldSession, loadOrCreateFieldSession,
} from '../platform/devtools/phoneHubFieldStore';
import { readPhoneHubFieldSnapshot } from '../platform/devtools/phoneHubFieldSources';
import {
  getPhoneHubFieldProbe, refreshPhoneHubFieldProbe, _resetPhoneHubFieldProbeForTest,
} from '../platform/phoneHub/phoneHubFieldProbe';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { PhoneHubFieldValidationScreen } from '../components/devtools/screens/PhoneHubFieldValidationScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_800_000_000_000;

/** Bu değerler HİÇBİR yerde görünmemeli (PII sızıntı kanıtı). */
const PII_MAC   = 'AA:BB:CC:DD:EE:FF';
const PII_PHONE = '+905551234567';
const PII_MAIL  = 'selim@example.com';
const PII_VIN   = 'VF1RFB00565123456';

/** Gerçek head unit kimliği: automotive özelliği YOK ama CarService + vendor VAR. */
function headUnitIdentity(over: Partial<PhFieldIdentity> = {}): PhFieldIdentity {
  return {
    manufacturer: 'NWD', model: 'K24-HU', device: 'k24', product: 'k24_car',
    androidRelease: '10', sdkInt: 29,
    fingerprintSummary: 'NWD/k24_car/…', fingerprintHash: 'deadbeef',
    automotiveFeature: 'NO',        // aftermarket ünite → özellik YOK
    carServicePresent: 'YES',
    telephonyFeature: 'NO',
    headUnitMarkerCount: 4,
    phoneOemMarkerCount: 0,
    vendorFamily: 'NWD',
    deviceRoleTechnical: 'HEAD_UNIT_CONFIRMED', deviceRoleConfidence: 'HIGH',
    ...over,
  };
}

/** P0.7'de gerçekten ölçülmüş telefon profili. */
function phoneIdentity(over: Partial<PhFieldIdentity> = {}): PhFieldIdentity {
  return {
    manufacturer: 'Xiaomi', model: '23090RA98I', device: 'zircon', product: 'zircon_in',
    androidRelease: '13', sdkInt: 33,
    fingerprintSummary: 'Redmi/zircon_in/…', fingerprintHash: 'cafebabe',
    automotiveFeature: 'NO', carServicePresent: 'NO', telephonyFeature: 'YES',
    headUnitMarkerCount: 0, phoneOemMarkerCount: 2,
    vendorFamily: 'UNKNOWN',
    deviceRoleTechnical: 'PHONE_CONFIRMED', deviceRoleConfidence: 'HIGH',
    ...over,
  };
}

interface RawOpts {
  readonly identity?: PhFieldIdentity | null;
  readonly a2dp?: string;
  readonly hfp?: string;
  readonly discovery?: string;
  readonly musicActive?: boolean;
  readonly obdConnected?: boolean;
  readonly obdFresh?: boolean;
  readonly obdPolling?: boolean;
  readonly obdReset?: boolean;
  readonly vendorPkg?: boolean;
  readonly dialerClass?: string;
  readonly callVendorMarkers?: number;
  readonly mediaAccess?: string;
  readonly sessions?: number;
  readonly ownerLocal?: number;
  readonly ownerVendor?: number;
  readonly fieldPresent?: boolean;
  readonly errors?: readonly string[];
  readonly readAt?: number;
}

function raw(o: RawOpts = {}): PhoneHubFieldRaw {
  const readAt = o.readAt ?? NOW;
  return {
    readAt,
    fieldPresent: o.fieldPresent ?? true,
    hw: {
      readAt, present: true, schemaVersion: 1, capturedAt: readAt - 500,
      platformApiLevel: 29,
      bluetooth: {
        adapterAvailable: true, adapterEnabled: true, adapterNamePresent: true,
        permConnect: 'GRANTED', permScan: 'GRANTED', permLegacy: 'NOT_APPLICABLE',
        discoveryActive: o.discovery ?? 'INACTIVE',
        bondedDeviceCount: 2, phoneLikeCount: 1, audioLikeCount: 0,
        obdLikeCandidateCount: 1, unknownClassCount: 0,
        evidence: 'DEVICE_OBSERVED',
      },
      profiles: {
        a2dpConnectionState: o.a2dp ?? 'DISCONNECTED',
        headsetConnectionState: o.hfp ?? 'DISCONNECTED',
        gattConnectionState: 'UNAVAILABLE',
        a2dpControlAuthority: 'UNKNOWN', hfpControlAuthority: 'UNKNOWN',
        evidence: 'DEVICE_OBSERVED',
      },
      vendor: {
        knownVendorPackageDetected: o.vendorPkg ?? true,
        knownVendorBroadcastObserved: false,
        vendorFamily: 'NWD', lastEvidenceAgeMs: -1, evidence: 'CODE_OBSERVED',
      },
      audio: {
        audioMode: 0, musicActive: o.musicActive ?? false,
        communicationDeviceType: 'NONE', routeAuthority: 'UNKNOWN',
        evidence: 'DEVICE_OBSERVED',
      },
      obd: {
        transport: 'classic',
        transportConnected: o.obdConnected ?? false,
        pollingActive: o.obdPolling ?? false,
        dataFresh: o.obdFresh ?? false,
        lastPacketAgeMs: o.obdConnected ? 800 : -1,
        resetInProgress: o.obdReset ?? false,
      },
      errors: ['VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE'],
    },
    identity: o.identity === undefined ? headUnitIdentity() : o.identity,
    call: {
      dialerClass: o.dialerClass ?? 'VENDOR_OR_OEM',
      telecomManagerAvailable: 'YES',
      callVendorMarkerCount: o.callVendorMarkers ?? 1,
    },
    media: {
      mediaSessionAccess: o.mediaAccess ?? 'DENIED',
      activeSessionCount: o.sessions ?? -1,
      ownerLocalCount: o.ownerLocal ?? -1,
      ownerSystemCount: -1,
      ownerVendorCount: o.ownerVendor ?? -1,
      ownerOtherCount: -1,
      playbackStatePresent: 'UNKNOWN', metadataPresent: 'UNKNOWN',
      artworkPresent: 'UNKNOWN', transportControlsPresent: 'UNKNOWN',
    },
    errors: o.errors
      ? [...o.errors]
      : ['MEDIA_SESSION_ACCESS_DENIED', 'PROFILE_PROXY_NOT_USED'],
  };
}

/** Head unit'te tüm senaryoları başarıyla yakalayan tam bir oturum kurar. */
function fullyCapturedSession(): PhoneHubFieldValidationSession {
  let s = createSession('sid-full', NOW);
  s = withIdentity(s, raw(), NOW);
  const per: Record<ScenarioId, PhoneHubFieldRaw> = {
    BASELINE_HEAD_UNIT: raw(),
    PHONE_CONNECTED: raw({ a2dp: 'CONNECTED', hfp: 'CONNECTED' }),
    PHONE_MEDIA_ACTIVE: raw({ a2dp: 'CONNECTED', hfp: 'CONNECTED', musicActive: true }),
    OBD_CONNECTED: raw({ obdConnected: true, obdFresh: true, obdPolling: true }),
    PHONE_AND_OBD_CONNECTED: raw({
      a2dp: 'CONNECTED', hfp: 'CONNECTED',
      obdConnected: true, obdFresh: true, obdPolling: true,
    }),
  };
  for (const id of SCENARIO_ORDER) s = withScenarioCapture(s, id, per[id], NOW);
  return s;
}

beforeEach(() => {
  localStorage.clear();
  _resetPhoneHubFieldProbeForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — CİHAZ ROLÜ KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — cihaz rolü birleşik kanıtla belirlenir', () => {
  it('automotive özelliğinin YOKLUĞU head unit olmadığını KANITLAMAZ', () => {
    const id = headUnitIdentity();          // automotive: NO
    expect(id.automotiveFeature).toBe('NO');
    expect(countHeadUnitSignals(id)).toBe(2);  // CarService + vendor paketi
    expect(classifyDeviceRole(id, false)).toBe('HEAD_UNIT_CONFIRMED');
    expect(deviceRoleConfidence('HEAD_UNIT_CONFIRMED', id, false)).toBe('HIGH');
  });

  it('kimlik okunamazsa rol UNAVAILABLE — "telefon değil" VARSAYILMAZ', () => {
    expect(classifyDeviceRole(null, true)).toBe('UNAVAILABLE');
    expect(classifyDeviceRole(headUnitIdentity({ manufacturer: 'UNKNOWN' }), true))
      .toBe('UNAVAILABLE');
    expect(classifyDeviceRole(headUnitIdentity({ sdkInt: -1 }), true)).toBe('UNAVAILABLE');
    expect(deviceRoleConfidence('UNAVAILABLE', null, true)).toBe('NONE');
  });

  it('tek teknik sinyal ONAYSIZ head unit sayılmaz', () => {
    const id = headUnitIdentity({ carServicePresent: 'NO', headUnitMarkerCount: 2 });
    expect(countHeadUnitSignals(id)).toBe(1);
    expect(classifyDeviceRole(id, false)).toBe('ANDROID_DEVICE_UNKNOWN');
  });

  it('tek teknik sinyal + onay → doğrulanır ama güven yalnız ORTA', () => {
    const id = headUnitIdentity({ carServicePresent: 'NO', headUnitMarkerCount: 2 });
    expect(classifyDeviceRole(id, true)).toBe('HEAD_UNIT_CONFIRMED');
    expect(deviceRoleConfidence('HEAD_UNIT_CONFIRMED', id, true)).toBe('MEDIUM');
  });

  it('KULLANICI ONAYI TEKNİK KANITIN YERİNE GEÇMEZ (sıfır sinyal → yükseltme YOK)', () => {
    const bare = headUnitIdentity({
      carServicePresent: 'NO', headUnitMarkerCount: 0, automotiveFeature: 'NO',
    });
    expect(countHeadUnitSignals(bare)).toBe(0);
    expect(classifyDeviceRole(bare, true)).toBe('ANDROID_DEVICE_UNKNOWN');

    let s = createSession('sid', NOW);
    s = withIdentity(s, raw({ identity: bare }), NOW);
    s = withUserAffirmation(s, true, raw({ identity: bare }), NOW);
    expect(s.deviceRole).toBe('ANDROID_DEVICE_UNKNOWN');
    expect(s.blockers).toContain('USER_AFFIRMATION_WITHOUT_TECHNICAL_EVIDENCE');
  });

  it('telefon teşhis edilir ve ONAY bunu EZMEZ', () => {
    const id = phoneIdentity();
    expect(classifyDeviceRole(id, false)).toBe('PHONE_CONFIRMED');
    expect(classifyDeviceRole(id, true)).toBe('PHONE_CONFIRMED');
    expect(areScenariosLocked('PHONE_CONFIRMED')).toBe(true);
    expect(areScenariosLocked('HEAD_UNIT_CONFIRMED')).toBe(false);
  });

  it('paket listesi okunamazsa (-1) görünürlük blocker\'ı düşer, 0 VARSAYILMAZ', () => {
    const id = headUnitIdentity({ headUnitMarkerCount: -1, carServicePresent: 'UNKNOWN' });
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw({ identity: id }), NOW);
    expect(s.blockers).toContain('PACKAGE_VISIBILITY_LIMITED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — TELEFONDA SAHA AŞAMALARI KİLİTLİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — telefon cihazında head unit sonucu ÜRETİLMEZ', () => {
  it('ölçüm denenirse BLOCKED yazılır, CAPTURED olmaz', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw({ identity: phoneIdentity() }), NOW);
    expect(s.deviceRole).toBe('PHONE_CONFIRMED');

    s = withScenarioCapture(s, 'BASELINE_HEAD_UNIT', raw({ identity: phoneIdentity() }), NOW);
    const rec = s.scenarios.find((x) => x.id === 'BASELINE_HEAD_UNIT')!;
    expect(rec.status).toBe('BLOCKED');
    expect(rec.status).not.toBe('CAPTURED');
    expect(rec.blockers).toContain('DEVICE_IS_PHONE');
    expect(rec.observations).toHaveLength(0);
  });

  it('tüm otorite kararları rol kapısında UNKNOWN/NONE kalır', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw({ identity: phoneIdentity() }), NOW);
    const decisions = decideAuthorities(s);
    expect(decisions).toHaveLength(4);
    for (const d of decisions) {
      expect(d.value).toBe('UNKNOWN');
      expect(d.confidence).toBe('NONE');
      expect(d.architecturalConsequence).toMatch(/TELEFON/i);
    }
    expect(mediaResultOf(decisions)).toBe('UNKNOWN');
    expect(callResultOf(decisions)).toBe('UNKNOWN');
  });

  it('coexistence telefonda UNKNOWN ve kritik blocker düşer', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw({ identity: phoneIdentity() }), NOW);
    expect(assessCoexistence(s).result).toBe('UNKNOWN');
    expect(s.blockers).toContain('DEVICE_IS_PHONE');
    expect(isCriticalBlocker('DEVICE_IS_PHONE')).toBe(true);
    expect(assessReadiness(s).readiness).toBe('NOT_READY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — SENARYO DURUM MAKİNESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — senaryo durum makinesi', () => {
  it('geçerli geçişler', () => {
    expect(nextScenarioStatus('NOT_STARTED', 'ARM')).toBe('READY');
    expect(nextScenarioStatus('READY', 'START')).toBe('CAPTURING');
    expect(nextScenarioStatus('CAPTURING', 'CAPTURE')).toBe('CAPTURED');
    expect(nextScenarioStatus('CAPTURED', 'START')).toBe('CAPTURING');
    expect(nextScenarioStatus('STALE', 'START')).toBe('CAPTURING');
  });

  it('GEÇERSİZ geçiş mevcut durumu KORUR (sessiz sıçrama yok)', () => {
    expect(nextScenarioStatus('NOT_STARTED', 'CAPTURE')).toBe('NOT_STARTED');
    expect(nextScenarioStatus('READY', 'CAPTURE')).toBe('READY');
  });

  it('BLOCKED durumdan ölçüme geçilemez', () => {
    expect(nextScenarioStatus('BLOCKED', 'START')).toBe('BLOCKED');
    expect(nextScenarioStatus('BLOCKED', 'CAPTURE')).toBe('BLOCKED');
    expect(nextScenarioStatus('BLOCKED', 'RESET')).toBe('NOT_STARTED');
    expect(nextScenarioStatus('BLOCKED', 'ARM')).toBe('READY');
  });

  it('yeni senaryo kaydı sahte değer taşımaz', () => {
    const rec = emptyScenario('PHONE_CONNECTED');
    expect(rec.status).toBe('NOT_STARTED');
    expect(rec.capturedAt).toBeNull();
    expect(rec.completedAt).toBeNull();
    expect(rec.deviceRole).toBe('UNAVAILABLE');
    expect(rec.evidence).toHaveLength(0);
  });

  it('damgası olmayan kayıt BAYATLAMAZ (sahte bayatlık yasak)', () => {
    const rec = { ...emptyScenario('OBD_CONNECTED'), status: 'CAPTURED' as const };
    expect(applyScenarioStaleness(rec, NOW + SCENARIO_STALE_MS * 5).status).toBe('CAPTURED');
  });

  it('eşiği geçen CAPTURED kayıt STALE olur', () => {
    let s = fullyCapturedSession();
    s = withStaleness(s, NOW + SCENARIO_STALE_MS + 1);
    for (const rec of s.scenarios) expect(rec.status).toBe('STALE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — AUTHORITY KURALLARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — authority yalnız kanıtla açılır', () => {
  it('ölçüm yokken dört otorite UNKNOWN/NONE (fail-closed)', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    const d = decideAuthorities(s);
    for (const x of d) {
      expect(x.value).toBe('UNKNOWN');
      expect(x.confidence).toBe('NONE');
    }
    expect(controlPlaneConfidence(d)).toBe('NONE');
    expect(weakestAuthorityConfidence(d)).toBe('NONE');
  });

  it('TEK zayıf paket eşleşmesi authority kanıtı SAYILMAZ', () => {
    let s = createSession('sid', NOW);
    const weak = headUnitIdentity({ headUnitMarkerCount: 1, carServicePresent: 'YES' });
    s = withIdentity(s, raw({ identity: weak }), NOW);
    // Telefon bağlı ölçümü var ama framework profili bağlı GÖRMÜYOR
    s = withScenarioCapture(s, 'PHONE_CONNECTED',
      raw({ identity: weak, a2dp: 'DISCONNECTED', hfp: 'DISCONNECTED' }), NOW);
    const bt = decideAuthorities(s).find((x) => x.key === 'bluetooth')!;
    expect(bt.value).toBe('UNKNOWN');
    expect(bt.confidence).toBe('NONE');
    expect(bt.architecturalConsequence).toMatch(/TEK zayıf/);
  });

  it('yalnız framework profili bağlı görüyorsa ANDROID_FRAMEWORK (orta güven)', () => {
    let s = createSession('sid', NOW);
    const noVendor = headUnitIdentity({ headUnitMarkerCount: 0, carServicePresent: 'YES',
      automotiveFeature: 'YES' });
    s = withIdentity(s, raw({ identity: noVendor }), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED',
      raw({ identity: noVendor, a2dp: 'CONNECTED' }), NOW);
    const bt = decideAuthorities(s).find((x) => x.key === 'bluetooth')!;
    expect(bt.value).toBe('ANDROID_FRAMEWORK');
    expect(bt.confidence).toBe('MEDIUM');
    expect(bt.classification).toBe('DERIVED');
  });

  it('ÇELİŞKİLİ kanıt (framework + güçlü vendor) → HYBRID ve çelişki listelenir', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'BASELINE_HEAD_UNIT', raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED', raw({ a2dp: 'CONNECTED' }), NOW);
    const bt = decideAuthorities(s).find((x) => x.key === 'bluetooth')!;
    expect(bt.value).toBe('HYBRID');
    expect(bt.conflictingEvidenceIds.length).toBeGreaterThan(0);
    expect(bt.architecturalConsequence).toMatch(/tek sahip VARSAYMAMALI/i);
  });

  it('vendor dialer + vendor çağrı paketi → VENDOR_SERVICE / VENDOR_CALL_AUTHORITY', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED',
      raw({ a2dp: 'CONNECTED', dialerClass: 'VENDOR_OR_OEM', callVendorMarkers: 2 }), NOW);
    const d = decideAuthorities(s);
    const call = d.find((x) => x.key === 'call')!;
    expect(call.value).toBe('VENDOR_SERVICE');
    expect(call.confidence).toBe('MEDIUM');
    expect(callResultOf(d)).toBe('VENDOR_CALL_AUTHORITY');
  });

  it('AOSP dialer + vendor çağrı paketi ÇELİŞKİSİ → HYBRID', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED',
      raw({ a2dp: 'CONNECTED', dialerClass: 'AOSP_TELECOM', callVendorMarkers: 1 }), NOW);
    const d = decideAuthorities(s);
    expect(d.find((x) => x.key === 'call')!.value).toBe('HYBRID');
    expect(callResultOf(d)).toBe('HYBRID');
  });

  it('dialer okunamazsa çağrı otoritesi UNKNOWN (varsayım YOK)', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED',
      raw({ a2dp: 'CONNECTED', dialerClass: 'UNAVAILABLE' }), NOW);
    const call = decideAuthorities(s).find((x) => x.key === 'call')!;
    expect(call.value).toBe('UNKNOWN');
    expect(call.classification).toBe('UNAVAILABLE');
  });

  it('MediaSession erişimi yoksa en fazla AVRCP_METADATA_ONLY türetilir', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_MEDIA_ACTIVE',
      raw({ a2dp: 'CONNECTED', musicActive: true, mediaAccess: 'DENIED' }), NOW);
    const d = decideAuthorities(s);
    expect(d.find((x) => x.key === 'media')!.value).toBe('AVRCP_METADATA_ONLY');
    expect(d.find((x) => x.key === 'media')!.confidence).toBe('LOW');
    expect(mediaResultOf(d)).toBe('AVRCP_METADATA_ONLY');
  });

  it('vendor MediaSession gözlenirse VENDOR_MEDIASESSION_USABLE', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_MEDIA_ACTIVE', raw({
      a2dp: 'CONNECTED', musicActive: true,
      mediaAccess: 'GRANTED', sessions: 2, ownerVendor: 1, ownerLocal: 0,
    }), NOW);
    const d = decideAuthorities(s);
    expect(d.find((x) => x.key === 'media')!.value).toBe('VENDOR_MEDIASESSION');
    expect(mediaResultOf(d)).toBe('VENDOR_MEDIASESSION_USABLE');
  });

  it('erişim VAR ama oturum YOK → NO_MEDIASESSION (dürüst negatif)', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_MEDIA_ACTIVE', raw({
      a2dp: 'CONNECTED', musicActive: true,
      mediaAccess: 'GRANTED', sessions: 0, ownerLocal: 0, ownerVendor: 0,
    }), NOW);
    expect(mediaResultOf(decideAuthorities(s))).toBe('NO_MEDIASESSION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — COEXISTENCE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — coexistence yalnız gerçek eşzamanlı ölçümle açılır', () => {
  it('birleşik ölçüm yoksa UNKNOWN', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_CONNECTED', raw({ a2dp: 'CONNECTED' }), NOW);
    expect(assessCoexistence(s).result).toBe('UNKNOWN');
  });

  it('üç senaryo tam + veri taze → COEXISTENCE_OBSERVED', () => {
    const v = assessCoexistence(fullyCapturedSession());
    expect(v.result).toBe('COEXISTENCE_OBSERVED');
    expect(v.classification).toBe('OBSERVED');
    expect(v.confidence).toBe('HIGH');
  });

  it('yalnız birleşik ölçüm varsa hüküm TÜRETİLDİ (gözlendi DEĞİL)', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_AND_OBD_CONNECTED', raw({
      a2dp: 'CONNECTED', obdConnected: true, obdFresh: true,
    }), NOW);
    const v = assessCoexistence(s);
    expect(v.result).toBe('COEXISTENCE_DERIVED');
    expect(v.reasons).toContain('SINGLE_SCENARIO_ONLY');
  });

  it('OBD verisi taze değilse CONFLICT_RISK', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_AND_OBD_CONNECTED', raw({
      a2dp: 'CONNECTED', obdConnected: true, obdFresh: false,
    }), NOW);
    const v = assessCoexistence(s);
    expect(v.result).toBe('CONFLICT_RISK');
    expect(v.reasons).toContain('OBD_DATA_NOT_FRESH_WITH_PHONE');
  });

  it('ölçüm sırasında keşif aktifse CONFLICT_RISK', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'PHONE_AND_OBD_CONNECTED', raw({
      a2dp: 'CONNECTED', obdConnected: true, obdFresh: true, discovery: 'ACTIVE',
    }), NOW);
    expect(assessCoexistence(s).result).toBe('CONFLICT_RISK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — READINESS (P1-A KAPISI)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — P1-A yedi koşulun TAMAMI olmadan açılmaz', () => {
  it('boş oturum (araç yok) → NOT_READY, bu doğal sonuçtur', () => {
    const v = assessReadiness(createSession('sid', NOW));
    expect(v.readiness).toBe('NOT_READY');
    expect(v.unmet).toContain('ROLE_NOT_HEAD_UNIT');
    expect(v.unmet).toContain('BASELINE_NOT_CAPTURED');
    expect(v.unmet).toContain('COEXISTENCE_UNKNOWN');
  });

  it('tam yakalanmış head unit oturumu → READY_FOR_P1_A', () => {
    const v = assessReadiness(fullyCapturedSession());
    expect(v.unmet).toEqual([]);
    expect(v.readiness).toBe('READY_FOR_P1_A');
  });

  it('BAYAT yakalama CAPTURED sayılmaz → P1-A KAPANIR', () => {
    const stale = withStaleness(fullyCapturedSession(), NOW + SCENARIO_STALE_MS + 1);
    const v = assessReadiness(stale);
    expect(v.readiness).not.toBe('READY_FOR_P1_A');
    expect(v.unmet).toContain('BASELINE_NOT_CAPTURED');
  });

  it('kritik blocker varsa P1-A açılmaz', () => {
    const s = fullyCapturedSession();
    const withBlocker = { ...s, blockers: [...s.blockers, 'NATIVE_FIELD_PROBE_ABSENT'] };
    const v = assessReadiness(withBlocker);
    expect(v.readiness).not.toBe('READY_FOR_P1_A');
    expect(v.unmet.some((u) => u.startsWith('CRITICAL_BLOCKER:'))).toBe(true);
  });

  it('kontrol düzlemi güveni ORTA altındaysa P1-A açılmaz', () => {
    let s = createSession('sid', NOW);
    const weak = headUnitIdentity({ headUnitMarkerCount: 3, carServicePresent: 'YES' });
    s = withIdentity(s, raw({ identity: weak }), NOW);
    // Framework profili bağlı GÖRMÜYOR → bluetooth otoritesi LOW
    for (const id of SCENARIO_ORDER) {
      s = withScenarioCapture(s, id, raw({
        identity: weak, a2dp: 'DISCONNECTED', hfp: 'DISCONNECTED',
        obdConnected: true, obdFresh: true,
      }), NOW);
    }
    const d = decideAuthorities(s);
    expect(confidenceAtLeast(controlPlaneConfidence(d), 'MEDIUM')).toBe(false);
    expect(assessReadiness(s).unmet).toContain('CONTROL_PLANE_CONFIDENCE_BELOW_MEDIUM');
  });

  it('kısmen ölçülmüş oturum READY_FOR_MORE_EVIDENCE olur (NOT_READY değil)', () => {
    let s = createSession('sid', NOW);
    s = withIdentity(s, raw(), NOW);
    s = withScenarioCapture(s, 'BASELINE_HEAD_UNIT', raw(), NOW);
    expect(assessReadiness(s).readiness).toBe('READY_FOR_MORE_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — SENARYO SIFIRLAMA İZOLASYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — sıfırlama izole ve yan etkisiz', () => {
  it('yalnız hedef senaryo sıfırlanır, diğerleri AYNEN kalır', () => {
    const before = fullyCapturedSession();
    const after = withScenarioReset(before, 'PHONE_CONNECTED', NOW + 1);

    const target = after.scenarios.find((x) => x.id === 'PHONE_CONNECTED')!;
    expect(target.status).toBe('NOT_STARTED');
    expect(target.observations).toHaveLength(0);
    expect(target.capturedAt).toBeNull();

    for (const id of SCENARIO_ORDER) {
      if (id === 'PHONE_CONNECTED') continue;
      const a = after.scenarios.find((x) => x.id === id)!;
      const b = before.scenarios.find((x) => x.id === id)!;
      expect(a).toEqual(b);
    }
    // Kimlik ve rol DOKUNULMAZ
    expect(after.deviceRole).toBe(before.deviceRole);
    expect(after.deviceIdentity).toEqual(before.deviceIdentity);
  });

  it('sıfırlanan senaryonun kanıtı oturum kanıt listesinden de düşer', () => {
    const before = fullyCapturedSession();
    expect(before.evidence.some((e) => e.scenario === 'OBD_CONNECTED')).toBe(true);
    const after = withScenarioReset(before, 'OBD_CONNECTED', NOW + 1);
    expect(after.evidence.some((e) => e.scenario === 'OBD_CONNECTED')).toBe(false);
    expect(after.evidence.some((e) => e.scenario === 'BASELINE_HEAD_UNIT')).toBe(true);
  });

  it('girdi nesnesi MUTASYONA UĞRAMAZ (saf fonksiyon)', () => {
    const before = fullyCapturedSession();
    const snapshot = JSON.stringify(before);
    withScenarioReset(before, 'PHONE_CONNECTED', NOW + 1);
    withScenarioCapture(before, 'PHONE_CONNECTED', raw(), NOW + 2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — YEREL KAYIT + ŞEMA GÖÇÜ + BAYAT OTURUM
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — yerel kayıt, göç ve bayatlık', () => {
  it('yazılan oturum aynen geri okunur', () => {
    const s = fullyCapturedSession();
    expect(saveFieldSession(s)).toBe(true);
    const back = loadFieldSession();
    expect(back).not.toBeNull();
    expect(back!.sessionId).toBe(s.sessionId);
    expect(back!.deviceRole).toBe('HEAD_UNIT_CONFIRMED');
    expect(back!.scenarios).toHaveLength(SCENARIO_ORDER.length);
    expect(back!.scenarios.find((x) => x.id === 'PHONE_CONNECTED')!.status).toBe('CAPTURED');
  });

  it('bozuk JSON ÇÖKERTMEZ, null döner', () => {
    localStorage.setItem(PH_FIELD_STORAGE_KEY, '{bozuk json');
    expect(loadFieldSession()).toBeNull();
    const fresh = loadOrCreateFieldSession('new-sid', NOW);
    expect(fresh.sessionId).toBe('new-sid');
  });

  it('eski/eksik şema güvenli varsayılanlara göç eder (throw YOK)', () => {
    const legacy = {
      schemaVersion: 0,
      sessionId: 'legacy-1',
      createdAt: NOW - 1000,
      updatedAt: NOW - 500,
      deviceRole: 'BOGUS_ROLE',
      deviceRoleConfidence: 'SUPER',
      scenarios: [
        { id: 'PHONE_CONNECTED', status: 'WAT', capturedAt: 0, observations: 'nope' },
        { id: 'UNKNOWN_SCENARIO', status: 'CAPTURED' },
      ],
      blockers: ['DEVICE_IS_PHONE', 42],
    };
    const m = migrateSession(legacy)!;
    expect(m).not.toBeNull();
    expect(m.schemaVersion).toBe(PH_FIELD_SCHEMA_VERSION);
    expect(m.deviceRole).toBe('UNAVAILABLE');          // tanınmayan rol → güvenli
    expect(m.deviceRoleConfidence).toBe('NONE');
    expect(m.scenarios).toHaveLength(SCENARIO_ORDER.length);
    expect(m.scenarios.find((x) => x.id === 'PHONE_CONNECTED')!.status).toBe('NOT_STARTED');
    expect(m.scenarios.map((x) => x.id)).toEqual([...SCENARIO_ORDER]);
    expect(m.blockers).toEqual(['DEVICE_IS_PHONE']);   // sayı düşürüldü
  });

  it('tanınamayan gövde null döner (yeni oturum açılır)', () => {
    expect(migrateSession(null)).toBeNull();
    expect(migrateSession(42)).toBeNull();
    expect(migrateSession({ noSessionId: true })).toBeNull();
  });

  it('bayat oturum tespit edilir; damga yoksa da bayat sayılır', () => {
    const s = createSession('sid', NOW);
    expect(isSessionStale(s, NOW + 1000)).toBe(false);
    expect(isSessionStale(s, NOW + SESSION_STALE_MS + 1)).toBe(true);
    expect(isSessionStale({ ...s, updatedAt: 0 }, NOW)).toBe(true);
  });

  it('silme sonrası kayıt kalmaz', () => {
    saveFieldSession(fullyCapturedSession());
    expect(deleteFieldSession()).toBe(true);
    expect(loadFieldSession()).toBeNull();
  });

  it('kalıcı kayıt UZAK sunucuya gitmez (store\'da ağ çağrısı YOK)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/devtools/phoneHubFieldStore.ts'), 'utf8');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'supabase', 'firebase', 'axios', 'WebSocket']) {
      expect(src).not.toContain(bad);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 9 — PII SÜZGECİ + DIŞA AKTARMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — PII ne modele ne diske ne dışa aktarıma sızar', () => {
  it('maskPii MAC/numara/e-posta/VIN/IP desenlerini siler', () => {
    expect(maskPii(PII_MAC)).not.toContain('AA:BB');
    expect(maskPii(PII_PHONE)).not.toContain('905551234567');
    expect(maskPii(PII_MAIL)).not.toContain('@example.com');
    expect(maskPii(PII_VIN)).not.toContain(PII_VIN);
    expect(maskPii('192.168.1.42')).not.toContain('192.168');
  });

  it('yasaklı anahtarlar düşer, DONANIM kimliği anahtarları KORUNUR', () => {
    expect(isDeniedKey('macAddress')).toBe(true);
    expect(isDeniedKey('phoneNumber')).toBe(true);
    expect(isDeniedKey('contactName')).toBe(true);
    expect(isDeniedKey('trackTitle')).toBe(true);
    expect(isDeniedKey('packageName')).toBe(true);
    expect(isDeniedKey('vin')).toBe(true);
    // Donanım kimliği bu fazın ASIL sorusudur → düşmemeli
    expect(isDeniedKey('manufacturer')).toBe(false);
    expect(isDeniedKey('model')).toBe(false);
    expect(isDeniedKey('device')).toBe(false);
    expect(isDeniedKey('product')).toBe(false);
    expect(isDeniedKey('vendorFamily')).toBe(false);
    expect(isDeniedKey('fingerprintSummary')).toBe(false);
  });

  it('sanitizeForExport derinlik/uzunluk tavanı uygular ve throw ETMEZ', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i++) deep = { nest: deep };
    expect(() => sanitizeForExport(deep)).not.toThrow();
    expect(JSON.stringify(sanitizeForExport(deep))).toContain('DEPTH_LIMIT');
    expect(sanitizeForExport(Number.NaN)).toBeNull();
  });

  it('dışa aktarma gövdesinde PII deseni YOK ve dosya adı kimlik taşımaz', () => {
    /* Kirli veriyi ZORLA modele sokmayı dene — süzgeç yakalasın. */
    const dirty = {
      ...fullyCapturedSession(),
      blockers: [`MAC=${PII_MAC}`, `tel ${PII_PHONE}`, PII_MAIL],
    } as PhoneHubFieldValidationSession;

    const res = buildFieldExport(dirty, NOW);
    expect(res.body).not.toContain(PII_MAC);
    expect(res.body).not.toContain('905551234567');
    expect(res.body).not.toContain(PII_MAIL);
    expect(res.body).toContain('REDACTED');
    expect(res.fileName).toMatch(/^phone-hub-field-validation-.*\.json$/);
    expect(res.fileName).not.toContain('NWD');
    expect(res.fileName).not.toContain('K24');
  });

  it('dışa aktarma dürüstlük beyanı ve karşılanmayan koşulları içerir', () => {
    const res = buildFieldExport(createSession('sid', NOW), NOW);
    const parsed = JSON.parse(res.body);
    expect(parsed.schema).toBe('caros.phonehub.fieldvalidation.v1');
    expect(parsed.readiness).toBe('NOT_READY');
    expect(parsed.piiFree).toBe(true);
    expect(Array.isArray(parsed.unmetReadinessConditions)).toBe(true);
    expect(parsed.unmetReadinessConditions.length).toBeGreaterThan(0);
    expect(JSON.stringify(parsed.honesty)).toMatch(/UNKNOWN varsayılandır/);
  });

  it('dışa aktarma ASLA throw etmez (döngüsel/kirli girdi)', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const bad = { ...createSession('sid', NOW), blockers: cyc as unknown as string[] };
    expect(() => buildFieldExport(bad as PhoneHubFieldValidationSession, NOW)).not.toThrow();
  });

  it('diske yazılan gövdede de PII deseni YOK', () => {
    const dirty = {
      ...createSession('sid', NOW),
      blockers: [`MAC=${PII_MAC}`],
    } as PhoneHubFieldValidationSession;
    saveFieldSession(dirty);
    const stored = localStorage.getItem(PH_FIELD_STORAGE_KEY) ?? '';
    expect(stored).not.toContain(PII_MAC);
  });

  it('ham gözlem tipinde PII alanı YOKTUR (yapısal kilit)', () => {
    const keys = new Set<string>();
    const walk = (v: unknown, d = 0): void => {
      if (d > 6 || !v || typeof v !== 'object') return;
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        keys.add(k.toLowerCase());
        walk(val, d + 1);
      }
    };
    walk(raw());
    for (const forbidden of ['mac', 'address', 'phonenumber', 'contact',
      'title', 'artist', 'album', 'packagename', 'ssid', 'imei', 'androidid']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — GÖZLEM ÜRETİMİ (sentinel dürüstlüğü)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — gözlemler sahte 0 / sahte "bağlı değil" üretmez', () => {
  it('-1 sentinel UNAVAILABLE olarak görünür, 0 GÖSTERİLMEZ', () => {
    const obs = buildScenarioObservations(raw({ sessions: -1, ownerLocal: -1 }));
    const sess = obs.find((o) => o.key === 'activeSessionCount')!;
    expect(sess.klass).toBe('UNAVAILABLE');
    expect(sess.value).toBe('—');
    expect(sess.value).not.toBe('0');
  });

  it('profil durumu UNAVAILABLE ise UNAVAILABLE kalır (DISCONNECTED uydurulmaz)', () => {
    const obs = buildScenarioObservations(raw({ a2dp: 'UNAVAILABLE', hfp: 'UNKNOWN' }));
    expect(obs.find((o) => o.key === 'a2dpState')!.klass).toBe('UNAVAILABLE');
    expect(obs.find((o) => o.key === 'hfpState')!.klass).toBe('UNAVAILABLE');
  });

  it('gözlem listesi bounded', () => {
    expect(buildScenarioObservations(raw()).length)
      .toBeLessThanOrEqual(MAX_OBSERVATIONS_PER_SCENARIO);
  });

  it('baseline kirliyse blocker düşer', () => {
    const b = detectScenarioBlockers('BASELINE_HEAD_UNIT',
      raw({ a2dp: 'CONNECTED', obdConnected: true }));
    expect(b).toContain('BASELINE_NOT_CLEAN');
  });

  it('native sonda yoksa kritik blocker ve kanıt yokluğu bildirilir', () => {
    const r = raw({ fieldPresent: false, identity: null });
    expect(detectScenarioBlockers('BASELINE_HEAD_UNIT', r))
      .toContain('NATIVE_FIELD_PROBE_ABSENT');
    let s = createSession('sid', NOW);
    s = withIdentity(s, r, NOW);
    expect(s.blockers).toContain('NATIVE_FIELD_PROBE_ABSENT');
    expect(s.deviceRole).toBe('UNAVAILABLE');
  });

  it('MediaSession reddi ve profil-proxy atlanması SESSİZ geçilmez', () => {
    const b = detectScenarioBlockers('PHONE_CONNECTED', raw());
    expect(b).toContain('MEDIA_SESSION_ACCESS_DENIED');
    expect(b).toContain('PROFILE_PROXY_NOT_USED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 11 — NATIVE KÖPRÜ FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — native köprü fail-soft', () => {
  it('native metot yokken present:false kalır ve kaynak katmanı çökmez', async () => {
    expect(getPhoneHubFieldProbe().present).toBe(false);
    const r = await refreshPhoneHubFieldProbe();
    expect(r.present).toBe(false);

    const snap = readPhoneHubFieldSnapshot();
    expect(snap.fieldPresent).toBe(false);
    expect(snap.identity).toBeNull();
    expect(snap.call).toBeNull();
    expect(snap.media).toBeNull();
    expect(snap.hw).toBeTruthy();
  });

  it('senkron getter yan etkisizdir (native\'e gitmez)', () => {
    const a = getPhoneHubFieldProbe();
    const b = getPhoneHubFieldProbe();
    expect(a).toBe(b);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 12 — CAROS LAB ENTEGRASYONU + EKRAN
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 12 — LAB entegrasyonu ve ekran', () => {
  it('iki AYRI araç kayıtlı: P0.5 probe SİLİNMEDİ', () => {
    const probe = getCarosLabTool('phone-hub-probe');
    const field = getCarosLabTool('phone-hub-field-validation');
    expect(probe).toBeTruthy();
    expect(probe!.status).toBe('AVAILABLE');
    expect(field).toBeTruthy();
    expect(field!.status).toBe('AVAILABLE');
    expect(field!.name).toBe('Phone Hub Saha Doğrulama');
  });

  it('ekran eşlemesi her ikisini de çözer', () => {
    expect(renderAvailableTool('phone-hub-probe')).not.toBeNull();
    expect(renderAvailableTool('phone-hub-field-validation')).not.toBeNull();
  });

  it('ekran render olur ve talimatları gösterir', () => {
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).toContain('phone-hub-field-validation');
    for (const id of SCENARIO_ORDER) {
      expect(html).toContain(SCENARIO_INSTRUCTION[id]);
    }
    expect(html).toContain('SALT OKUNUR');
  });

  it('araç yokken ekran P1-A HAZIR göstermez ve UNKNOWN görünür', () => {
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).not.toContain('P1-A İÇİN HAZIR');
    expect(html).toContain('HAZIR DEĞİL');
    expect(html).toContain('BİLİNMİYOR');
  });

  it('telefonda kilit mesajı ekranda gösterilir', () => {
    /* Kalıcı kayda TELEFON rolü koyup ekranı açıyoruz (ekran açılışta yükler). */
    saveFieldSession({
      ...withIdentity(createSession('phone-sid', NOW), raw({ identity: phoneIdentity() }), NOW),
    });
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).toContain(PHONE_LOCK_MESSAGE);
    expect(html).toContain('phf-phone-lock');
  });

  it('render çıktısında PII deseni yok', () => {
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).not.toMatch(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/);
    expect(html).not.toMatch(/\+\d{10,}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 13 — STATİK GÜVENLİK (TS tarafı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 13 — yasaklı yüzeylere hiç dokunulmaz (statik tarama)', () => {
  const FILES = [
    'src/platform/devtools/phoneHubFieldModel.ts',
    'src/platform/devtools/phoneHubFieldSources.ts',
    'src/platform/devtools/phoneHubFieldStore.ts',
    'src/platform/phoneHub/phoneHubFieldProbe.ts',
    'src/components/devtools/screens/PhoneHubFieldValidationScreen.tsx',
  ];

  /** Yorumlar çıkarılır → yalnız YÜRÜTÜLEN kod taranır (yanlış-pozitif yok). */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  const FORBIDDEN = [
    'createBond', 'startDiscovery', 'cancelDiscovery', 'startScan', 'stopScan',
    'connectObd', 'disconnectObd', 'startBluetoothSco', 'requestPermissions',
    'dispatchMediaKeyEvent', 'placeCall', 'ACTION_CALL', 'sendSms',
    'setCommunicationDevice', 'bindService',
    // OBD davranışını değiştirebilecek çağrılar
    'setPollingActive', 'resetObd', 'forceReconnect', 'startPolling', 'stopPolling',
  ];

  for (const file of FILES) {
    it(`${file} — yasaklı çağrı YOK`, () => {
      const code = stripComments(
        readFileSync(resolve(process.cwd(), file), 'utf8'));
      for (const bad of FORBIDDEN) {
        expect(code, `${file} içinde YASAK çağrı: ${bad}`).not.toContain(bad);
      }
    });
  }

  it('saf model dosyası I/O, timer, Date.now ve React İÇERMEZ', () => {
    const code = stripComments(readFileSync(
      resolve(process.cwd(), 'src/platform/devtools/phoneHubFieldModel.ts'), 'utf8'));
    expect(code).not.toContain('Date.now(');
    expect(code).not.toContain('setInterval(');
    expect(code).not.toContain('setTimeout(');
    expect(code).not.toContain('localStorage');
    expect(code).not.toContain('from \'react\'');
    expect(code).not.toContain('fetch(');
  });

  it('OBD kaynak kodu bu turda DEĞİŞTİRİLMEDİ (yalnız getter okunur)', () => {
    const sources = stripComments(readFileSync(
      resolve(process.cwd(), 'src/platform/devtools/phoneHubFieldSources.ts'), 'utf8'));
    /* OBD verisi P0.5 kaynak katmanı üzerinden gelir; bu dosya obdService'i
       DOĞRUDAN import etmez ve hiçbir OBD yazma yüzeyine dokunmaz. */
    expect(sources).not.toContain('obdService');
    expect(sources).toContain('readPhoneHubProbeSnapshot');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 14 — ÜST ÖZET TUTARLILIĞI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 14 — üst özet', () => {
  it('boş oturumda her şey en güvenli değerde', () => {
    const sum = buildFieldSummary(createSession('sid', NOW));
    expect(sum.deviceRole).toBe('UNAVAILABLE');
    expect(sum.readiness).toBe('NOT_READY');
    expect(sum.controlPlaneConfidence).toBe('NONE');
    expect(sum.coexistence.result).toBe('UNKNOWN');
    expect(sum.mediaResult).toBe('UNKNOWN');
    expect(sum.callResult).toBe('UNKNOWN');
    expect(sum.capturedCount).toBe(0);
    expect(sum.scenariosLocked).toBe(false);
  });

  it('tam oturumda özet P1-A hazır ve eşzamanlılık gözlenmiş der', () => {
    const sum = buildFieldSummary(fullyCapturedSession());
    expect(sum.deviceRole).toBe('HEAD_UNIT_CONFIRMED');
    expect(sum.readiness).toBe('READY_FOR_P1_A');
    expect(sum.coexistence.result).toBe('COEXISTENCE_OBSERVED');
    expect(sum.capturedCount).toBe(SCENARIO_ORDER.length);
    expect(confidenceAtLeast(sum.controlPlaneConfidence, 'MEDIUM')).toBe(true);
  });

  it('güven karşılaştırması doğru sıralanır', () => {
    const order: Confidence[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
    expect(confidenceAtLeast('HIGH', 'MEDIUM')).toBe(true);
    expect(confidenceAtLeast('LOW', 'MEDIUM')).toBe(false);
    expect(confidenceAtLeast('MEDIUM', 'MEDIUM')).toBe(true);
    expect(order).toHaveLength(4);
  });
});
