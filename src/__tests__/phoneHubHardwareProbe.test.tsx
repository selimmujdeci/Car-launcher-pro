/**
 * phoneHubHardwareProbe.test.tsx — PHONE-HUB P0.5 KİLİTLERİ.
 *
 * ANA İLKELER:
 *  1. Probe SALT-OKUNUR — hiçbir yazma/bağlanma/tarama/komut yüzeyi yok.
 *  2. "Bağlı görünmek" YETENEK KANITI DEĞİLDİR — otorite ayrı, "destekleniyor"
 *     ancak DEVICE_OBSERVED + ANDROID_APP birlikteyken denebilir.
 *  3. Kanıt yoksa UNAVAILABLE/UNKNOWN — sahte 0, sahte tarih, sahte "bağlı değil" YOK.
 *  4. PII (MAC · cihaz adı · kişi · numara) modele ve render'a SIZMAZ.
 *  5. A4–A8, UX-F1 ve erişim kapısı kilitleri bozulmaz.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  buildPhSections, assessPhCollision, deriveProbeStatus, countByPhClass,
  _canClaimSupport, _trust,
  PHONE_HUB_STALE_MS, MAX_FIELDS_PER_PH_SECTION,
  COLLISION_REASON_LABEL,
  type PhoneHubProbeRaw, type PhSection,
} from '../platform/devtools/phoneHubProbeModel';
import { readPhoneHubProbeSnapshot } from '../platform/devtools/phoneHubProbeSources';
import {
  getPhoneHubProbe, refreshPhoneHubProbe, _resetPhoneHubProbeForTest,
} from '../platform/phoneHub/phoneHubHardwareProbe';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { PhoneHubProbeScreen } from '../components/devtools/screens/PhoneHubProbeScreen';
import { CarosLabShell } from '../components/devtools/CarosLabShell';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Bu değerler HİÇBİR yerde görünmemeli (PII sızıntı kanıtı). */
const PII_MAC   = 'AA:BB:CC:DD:EE:FF';
const PII_NAME  = 'Selim iPhone';
const PII_PHONE = '+905551234567';

function snapshot(over: Partial<PhoneHubProbeRaw> = {}): PhoneHubProbeRaw {
  return {
    readAt: NOW,
    present: true,
    schemaVersion: 1,
    capturedAt: NOW - 1_000,
    platformApiLevel: 33,
    bluetooth: {
      adapterAvailable: true, adapterEnabled: true, adapterNamePresent: true,
      permConnect: 'GRANTED', permScan: 'GRANTED', permLegacy: 'NOT_APPLICABLE',
      discoveryActive: 'INACTIVE',
      bondedDeviceCount: 3, phoneLikeCount: 1, audioLikeCount: 1,
      obdLikeCandidateCount: 1, unknownClassCount: 0,
      evidence: 'DEVICE_OBSERVED',
    },
    profiles: {
      a2dpConnectionState: 'CONNECTED', headsetConnectionState: 'CONNECTED',
      gattConnectionState: 'UNAVAILABLE',
      a2dpControlAuthority: 'UNKNOWN', hfpControlAuthority: 'UNKNOWN',
      evidence: 'DEVICE_OBSERVED',
    },
    vendor: {
      knownVendorPackageDetected: true, knownVendorBroadcastObserved: false,
      vendorFamily: 'NWD', lastEvidenceAgeMs: -1, evidence: 'CODE_OBSERVED',
    },
    audio: {
      audioMode: 0, musicActive: false,
      communicationDeviceType: 'NONE', routeAuthority: 'UNKNOWN', evidence: 'DEVICE_OBSERVED',
    },
    obd: {
      transport: 'classic', transportConnected: false, pollingActive: false,
      dataFresh: false, lastPacketAgeMs: -1, resetInProgress: false,
    },
    errors: [],
    ...over,
  };
}

function findField(sections: readonly PhSection[], id: string) {
  for (const s of sections) for (const f of s.fields) if (f.id === id) return f;
  return null;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

afterEach(() => {
  _resetPhoneHubProbeForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — TAM SNAPSHOT → DOĞRU MODEL
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — tam snapshot doğru UI modeline dönüşür', () => {
  it('yedi bölüm üretilir ve alanlar bounded kalır', () => {
    const sections = buildPhSections(snapshot());
    expect(sections.map((s) => s.id)).toEqual([
      'status', 'adapter', 'profiles', 'vendor', 'audio', 'obd', 'restrictions',
    ]);
    for (const s of sections) {
      expect(s.fields.length).toBeGreaterThan(0);
      expect(s.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_PH_SECTION);
      for (const f of s.fields) expect(f.value.length).toBeLessThan(200);
    }
    const counts = countByPhClass(sections);
    expect(counts.OBSERVED).toBeGreaterThan(0);
    expect(counts.DERIVED).toBeGreaterThan(0);
  });

  it('gerçek değerler doğru okunur', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phAdapterAvailable')!.value).toBe('true');
    expect(findField(s, 'phBonded')!.value).toBe('3');
    expect(findField(s, 'phClassCounts')!.value).toBe('1 / 1 / 1 / 0');
    expect(findField(s, 'phApiLevel')!.value).toBe('33');
    expect(findField(s, 'phA2dpState')!.value).toBe('CONNECTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — İZİN YOK / KAYNAK YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — izin yoksa ve kaynak yoksa UNAVAILABLE', () => {
  it('native kanıt yokken tüm bölümler UNAVAILABLE der, sahte değer YOK', () => {
    const empty: PhoneHubProbeRaw = {
      readAt: NOW, present: false, schemaVersion: null, capturedAt: null,
      platformApiLevel: null, bluetooth: null, profiles: null, vendor: null,
      audio: null, obd: null, errors: [],
    };
    const sections = buildPhSections(empty);
    expect(deriveProbeStatus(empty)).toBe('UNAVAILABLE');
    expect(findField(sections, 'phAdapter')!.klass).toBe('UNAVAILABLE');
    expect(findField(sections, 'phProfiles')!.klass).toBe('UNAVAILABLE');
    expect(findField(sections, 'phVendor')!.klass).toBe('UNAVAILABLE');
    expect(findField(sections, 'phAudio')!.klass).toBe('UNAVAILABLE');
    expect(findField(sections, 'phObd')!.klass).toBe('UNAVAILABLE');
    // "adaptör yok" VARSAYILMAZ
    expect(findField(sections, 'phAdapter')!.note).toContain('VARSAYILMAZ');
  });

  it('izin reddedildiyse açıkça gösterilir', () => {
    const s = buildPhSections(snapshot({
      bluetooth: { ...snapshot().bluetooth!, permConnect: 'DENIED', bondedDeviceCount: -1 },
    }));
    expect(findField(s, 'phPermConnect')!.value).toBe('DENIED');
    // izin yokken sayaç 0 GÖSTERİLMEZ
    const bonded = findField(s, 'phBonded')!;
    expect(bonded.klass).toBe('UNAVAILABLE');
    expect(bonded.value).not.toBe('0');
  });

  it('NOT_APPLICABLE ile DENIED karıştırılmaz', () => {
    const s = buildPhSections(snapshot({
      bluetooth: { ...snapshot().bluetooth!, permConnect: 'NOT_APPLICABLE' },
    }));
    expect(findField(s, 'phPermConnect')!.value).toBe('NOT_APPLICABLE');
    expect(findField(s, 'phPermConnect')!.note).toContain('reddedildi DEĞİL');
  });

  it('izin VARLIĞI yetenek kanıtı sayılmaz (not alanında yazılı)', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phPermScan')!.note).toContain('KANITLAMAZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — STALE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — eski gözlem STALE olur', () => {
  it('eşikten eski damga STALE', () => {
    const old = snapshot({ capturedAt: NOW - (PHONE_HUB_STALE_MS + 5_000) });
    expect(deriveProbeStatus(old)).toBe('STALE');
    expect(findField(buildPhSections(old), 'phCapturedAt')!.klass).toBe('STALE');
  });

  it('taze damga AVAILABLE', () => {
    expect(deriveProbeStatus(snapshot())).toBe('AVAILABLE');
  });

  it('damga YOKSA AVAILABLE denmez (yaş doğrulanamaz) ve "şimdi" uydurulmaz', () => {
    const noStamp = snapshot({ capturedAt: null });
    expect(deriveProbeStatus(noStamp)).toBe('STALE');
    const f = findField(buildPhSections(noStamp), 'phCapturedAt')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('UYDURULMAZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — ADAPTER YOK / BT KAPALI FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — adapter yok / BT kapalı fail-soft', () => {
  it('adapter yokken model çökmez ve profil durumu UYDURULMAZ', () => {
    const s = snapshot({
      bluetooth: { ...snapshot().bluetooth!, adapterAvailable: false, adapterEnabled: false },
      profiles: {
        a2dpConnectionState: 'UNAVAILABLE', headsetConnectionState: 'UNAVAILABLE',
        gattConnectionState: 'UNAVAILABLE',
        a2dpControlAuthority: 'UNAVAILABLE', hfpControlAuthority: 'UNAVAILABLE',
        evidence: 'UNKNOWN',
      },
    });
    expect(() => buildPhSections(s)).not.toThrow();
    const sec = buildPhSections(s);
    expect(findField(sec, 'phA2dpState')!.value).toBe('UNAVAILABLE');
    expect(findField(sec, 'phA2dpState')!.value).not.toBe('DISCONNECTED');
  });

  it('BT kapalıyken profil "DISCONNECTED" diye UYDURULMAZ', () => {
    const s = snapshot({
      bluetooth: { ...snapshot().bluetooth!, adapterEnabled: false },
      profiles: { ...snapshot().profiles!, a2dpConnectionState: 'UNAVAILABLE' },
    });
    const f = findField(buildPhSections(s), 'phA2dpState')!;
    expect(f.value).toBe('UNAVAILABLE');
    expect(findField(buildPhSections(s), 'phAdapterEnabled')!.note).toContain('OKUNAMAZ');
  });

  it('bilinmeyen enum değeri fail-soft (çökme yok, UNKNOWN\'a düşer)', () => {
    const s = snapshot({
      profiles: { ...snapshot().profiles!, a2dpControlAuthority: 'QUANTUM_STACK' },
      vendor: { ...snapshot().vendor!, evidence: 'MAGIC' },
    });
    expect(() => buildPhSections(s)).not.toThrow();
    expect(findField(buildPhSections(s), 'phA2dpAuthority')!.value).toBe('BİLİNMİYOR');
    expect(_trust('MAGIC')).toBe('UNKNOWN');
    expect(_trust('DEVICE_OBSERVED')).toBe('DEVICE_OBSERVED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — "DESTEKLENİYOR" İDDİASI KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — cihaz kanıtı olmadan yetenek iddia edilmez', () => {
  it('A2DP CONNECTED ama otorite UNKNOWN → "destekleniyor" DENMEZ', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phA2dpState')!.value).toBe('CONNECTED');
    expect(findField(s, 'phA2dpAuthority')!.value).toBe('BİLİNMİYOR');
    expect(findField(s, 'phA2dpSupportClaim')!.value).toContain('HAYIR');
  });

  it('HFP CONNECTED ama otorite UNKNOWN → çağrı kontrolü iddia EDİLMEZ', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phHfpState')!.value).toBe('CONNECTED');
    expect(findField(s, 'phHfpSupportClaim')!.value).toContain('HAYIR');
  });

  it('iddia kapısı yalnız DEVICE_OBSERVED + ANDROID_APP ile açılır', () => {
    expect(_canClaimSupport('DEVICE_OBSERVED', 'ANDROID_APP')).toBe(true);
    expect(_canClaimSupport('DEVICE_OBSERVED', 'VENDOR_STACK')).toBe(false);
    expect(_canClaimSupport('DEVICE_OBSERVED', 'UNKNOWN')).toBe(false);
    expect(_canClaimSupport('CODE_OBSERVED', 'ANDROID_APP')).toBe(false);
    expect(_canClaimSupport('INFERRED', 'ANDROID_APP')).toBe(false);
  });

  it('ekran metninde kesin yetenek iddiası yok', () => {
    const html = renderToStaticMarkup(<PhoneHubProbeScreen />);
    expect(html).not.toContain('A2DP destekleniyor');
    expect(html).not.toContain('HFP destekleniyor');
    expect(html).toContain('yetenek kanıtı DEĞİLDİR');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — VENDOR KANITI ABARTILMIYOR
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — vendor paketi var ama yayın yok → yalnız CODE_OBSERVED', () => {
  it('paket varlığı ÇIKARIM/KOD gözlemi olarak sınıflanır', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phVendorPkg')!.value).toBe('VAR');
    expect(findField(s, 'phVendorTrust')!.value).toBe('KODDAN GÖZLENDİ');
    expect(findField(s, 'phVendorTrust')!.note).toContain('KANITLAMAZ');
  });

  it('yayın gözlemi yokken "EVET" denmez ve yaş 0 gösterilmez', () => {
    const s = buildPhSections(snapshot());
    expect(findField(s, 'phVendorBroadcast')!.value).toContain('HAYIR');
    const age = findField(s, 'phVendorAge')!;
    expect(age.klass).toBe('UNAVAILABLE');
    expect(age.value).not.toBe('0');
  });

  it('vendor ailesi bilinmiyorsa UNKNOWN kalır', () => {
    const s = buildPhSections(snapshot({
      vendor: { ...snapshot().vendor!, knownVendorPackageDetected: false, vendorFamily: 'UNKNOWN', evidence: 'UNKNOWN' },
    }));
    expect(findField(s, 'phVendorFamily')!.value).toBe('UNKNOWN');
    expect(findField(s, 'phVendorTrust')!.value).toBe('BİLİNMİYOR');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — ÇAKIŞMA DEĞERLENDİRMESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — çakışma riski fail-closed türetilir', () => {
  it('OBD bağlı + keşif aktif → HIGH', () => {
    const r = assessPhCollision(snapshot({
      bluetooth: { ...snapshot().bluetooth!, discoveryActive: 'ACTIVE' },
      obd: { ...snapshot().obd!, transportConnected: true },
    }));
    expect(r.level).toBe('HIGH');
    expect(r.reasons).toContain('OBD_CONNECTED_WITH_DISCOVERY');
  });

  it('adaptör sıfırlama sürüyor → HIGH', () => {
    const r = assessPhCollision(snapshot({
      obd: { ...snapshot().obd!, resetInProgress: true },
    }));
    expect(r.level).toBe('HIGH');
    expect(r.reasons).toContain('ADAPTER_RESET_IN_PROGRESS');
  });

  it('OBD polling + telefon profili bağlı → POSSIBLE', () => {
    const r = assessPhCollision(snapshot({
      obd: { ...snapshot().obd!, transportConnected: true, pollingActive: true },
    }));
    expect(r.level).toBe('POSSIBLE');
    expect(r.reasons).toContain('OBD_POLLING_WITH_PHONE_PROFILE');
  });

  it('BT durumu okunamıyorsa NONE_OBSERVED DEĞİL UNKNOWN', () => {
    const r = assessPhCollision(snapshot({
      profiles: { ...snapshot().profiles!, a2dpConnectionState: 'UNKNOWN', headsetConnectionState: 'UNKNOWN' },
    }));
    expect(r.level).toBe('UNKNOWN');
    expect(r.reasons).toContain('BT_STATE_UNREADABLE');
  });

  it('native kanıt yokken UNKNOWN (fail-closed)', () => {
    const r = assessPhCollision({
      readAt: NOW, present: false, schemaVersion: null, capturedAt: null,
      platformApiLevel: null, bluetooth: null, profiles: null, vendor: null,
      audio: null, obd: null, errors: [],
    });
    expect(r.level).toBe('UNKNOWN');
  });

  it('sessiz sistemde NONE_OBSERVED', () => {
    const r = assessPhCollision(snapshot({
      profiles: { ...snapshot().profiles!, a2dpConnectionState: 'DISCONNECTED', headsetConnectionState: 'DISCONNECTED' },
    }));
    expect(r.level).toBe('NONE_OBSERVED');
    expect(r.reasons).toHaveLength(0);
  });

  it('gerekçeler SABİT ENUM kodudur (serbest metin yok)', () => {
    const r = assessPhCollision(snapshot({
      bluetooth: { ...snapshot().bluetooth!, discoveryActive: 'ACTIVE' },
      obd: { ...snapshot().obd!, transportConnected: true, resetInProgress: true },
    }));
    for (const code of r.reasons) {
      expect(code).not.toContain(' ');
      expect(Object.keys(COLLISION_REASON_LABEL)).toContain(code);
    }
  });

  it('OBD verisi bayatken sentinel korunur (0 ms gösterilmez)', () => {
    const s = buildPhSections(snapshot({
      obd: { ...snapshot().obd!, lastPacketAgeMs: -1, dataFresh: false },
    }));
    const f = findField(s, 'phObdPacketAge')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).not.toBe('0');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — PII SIZINTISI YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — MAC / cihaz adı / kişisel veri SIZMAZ', () => {
  it('ham tip PII alanı İÇERMEZ (yapısal kilit)', () => {
    const s = snapshot();
    const keys = Object.keys(s.bluetooth!);
    for (const banned of ['deviceName', 'address', 'mac', 'name', 'devices']) {
      expect(keys).not.toContain(banned);
    }
    expect(keys).toContain('adapterNamePresent');   // yalnız VARLIK
  });

  it('model çıktısında PII deseni yok', () => {
    const dump = JSON.stringify({
      sections: buildPhSections(snapshot()),
      collision: assessPhCollision(snapshot()),
    });
    expect(dump).not.toContain(PII_MAC);
    expect(dump).not.toContain(PII_NAME);
    expect(dump).not.toContain(PII_PHONE);
    expect(dump).not.toMatch(/\b[0-9A-F]{2}(:[0-9A-F]{2}){5}\b/i);   // MAC deseni
    expect(dump).not.toMatch(/\+\d{10,}/);                            // telefon deseni
  });

  it('render çıktısında MAC/telefon deseni yok', () => {
    const html = renderToStaticMarkup(<PhoneHubProbeScreen />);
    expect(html).not.toMatch(/\b[0-9A-F]{2}(:[0-9A-F]{2}){5}\b/i);
    expect(html).not.toMatch(/\+\d{10,}/);
    // Gizlilik beyanı HER durumda basılır (altbilgi — kaynak yokken de görünür)
    expect(html).toContain('HİÇ GELMEZ');
  });

  it('kaynak katmanı PII getter\'larına DOKUNMAZ', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/phoneHubProbeSources.ts', 'utf8'));
    for (const banned of ['getName', 'getAddress', 'deviceName', 'btDevice', 'contacts']) {
      expect(src).not.toContain(banned);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 9 — SALT-OKUNURLUK (TS tarafı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — TS katmanında yazma/bağlanma/komut yüzeyi YOK', () => {
  it('kaynak katmanı senkron ve müdahalesiz', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/phoneHubProbeSources.ts', 'utf8'));
    for (const f of [
      'await ', 'startDiscovery', 'startScan', 'createBond', 'connectOBD',
      'disconnectOBD', 'reconnect', 'sendCommand', 'setInterval', 'setTimeout',
      'addListener', 'subscribe', 'fetch(',
    ]) expect(src).not.toContain(f);
  });

  it('ekran timer/abonelik/polling kurmaz; tek atış + elle YENİLE', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/PhoneHubProbeScreen.tsx', 'utf8'));
    for (const f of [
      'setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener',
      'addEventListener', 'document.', 'querySelector',
      'startDiscovery', 'createBond', 'sendCommand', 'connectOBD', 'placeCall',
    ]) expect(src).not.toContain(f);
    expect(src).toMatch(/useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\)/);
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
  });

  it('platform köprüsü YALNIZ salt-okunur plugin metodunu çağırır', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/phoneHub/phoneHubHardwareProbe.ts', 'utf8'));
    expect(src).toContain('getPhoneHubHardwareProbe');
    for (const f of [
      'startObdScan', 'connectOBD', 'pairDevice', 'setAudio', 'playPause',
      'setInterval', 'setTimeout',
    ]) expect(src).not.toContain(f);
  });

  it('model saf kalır (I/O · Date.now · React yok)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/phoneHubProbeModel.ts', 'utf8'));
    for (const f of ["from 'react'", 'Date.now', 'setInterval', 'setTimeout', 'fetch(', 'localStorage']) {
      expect(src).not.toContain(f);
    }
  });

  /* NOT: yasaklı kelime listesi DAR tutulur — 'BAĞLAN' gibi bir parça
     "BAĞLANMAZ" beyanıyla da eşleşir ve kilidi anlamsız kılardı (aynı hatayı
     A8'de de yapmıştık). Asıl değişmez: ekranda YENİLE dışında eylem yüzeyi
     olmaması — düğme SAYISI ve form/submit yokluğu ile ölçülür. */
  it('ekranda YENİLE dışında eylem düğmesi yok', () => {
    const html = renderToStaticMarkup(<PhoneHubProbeScreen />);
    expect(html).toContain('ph-refresh');
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect((html.match(/<input/g) ?? []).length).toBe(0);
    expect((html.match(/<select/g) ?? []).length).toBe(0);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toContain('type="submit"');
    // Eylem çağrıştıran KOMUT etiketleri (tam ifade — parça değil)
    for (const banned of ['EŞLEŞTİR', 'TARAMA BAŞLAT', 'BAĞLANTI KUR', 'ÇAĞRI BAŞLAT']) {
      expect(html).not.toContain(banned);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — KÖPRÜ FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — native köprü fail-soft', () => {
  it('başlangıçta kanıt YOK (present:false)', () => {
    expect(getPhoneHubProbe().present).toBe(false);
  });

  it('native metot yoksa (eski APK) çökmez, present:false kalır', async () => {
    const r = await refreshPhoneHubProbe();
    expect(r.present).toBe(false);
    expect(getPhoneHubProbe().present).toBe(false);
  });

  it('üretim yolu gerçek servislerle çalışır ve sözleşmeyi döndürür', () => {
    const s = readPhoneHubProbeSnapshot();
    expect(typeof s.readAt).toBe('number');
    expect(s.readAt).toBeGreaterThan(0);
    expect(typeof s.present).toBe('boolean');
    expect(Array.isArray(s.errors)).toBe(true);
    // Native yokken sahte değer üretilmemeli
    if (!s.present) {
      expect(s.bluetooth).toBeNull();
      expect(s.profiles).toBeNull();
      expect(s.capturedAt).toBeNull();
    }
  });

  it('ekran gerçek servislerle render olur ve çökmez', () => {
    const html = renderToStaticMarkup(<PhoneHubProbeScreen />);
    expect(html).toContain('phone-hub-probe');
    expect(html).toMatch(/data-level="(NONE_OBSERVED|POSSIBLE|HIGH|UNKNOWN)"/);
    expect(html).toMatch(/data-status="(AVAILABLE|UNAVAILABLE|STALE)"/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 11 — KATALOG + SCREENMAP
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — CAROS LAB entegrasyonu eksiksiz', () => {
  it('katalog kaydı AVAILABLE ve iletişim kategorisinde', () => {
    const t = getCarosLabTool('phone-hub-probe')!;
    expect(t.id).toBe('phone-hub-probe');
    expect(t.status).toBe('AVAILABLE');
    expect(t.category).toBe('communication');
    expect(t.note ?? '').toContain('BAŞLATMAZ');
    expect(t.note ?? '').toContain('GÖSTERİLMEZ');
  });

  it('screen map kaydı lazy chunk döndürür', () => {
    const el = renderAvailableTool('phone-hub-probe');
    expect(el).not.toBeNull();
    const type = (el as unknown as { type?: { $$typeof?: symbol } }).type;
    expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('shell katalog görünümünde ekran mount OLMAZ', () => {
    const html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(html).not.toContain('ph-collision');
    expect(html).not.toContain('ÇAKIŞMA RİSKİ');
  });

  it('katalog metni doğrulanmamış iddia içermez', () => {
    const t = getCarosLabTool('phone-hub-probe')!;
    const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
    for (const banned of ['yakında', 'sorunsuz', 'doğrulandı', 'destekleniyor']) {
      expect(text).not.toContain(banned);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 12 — ÖNCEKİ FAZLAR BOZULMADI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 12 — A4/A5/A6/A7/A8 · UX-F1 · erişim kapısı korunur', () => {
  it('önceki AVAILABLE araçlar hâlâ AVAILABLE ve eşlenmiş', () => {
    for (const id of [
      'kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics',
      'mavi-console', 'decoder-registry',
    ] as const) {
      expect(getCarosLabTool(id)!.status).toBe('AVAILABLE');
      expect(renderAvailableTool(id)).not.toBeNull();
    }
  });

  it('UX-F1 giriş odağı korunur', () => {
    const q = renderAvailableTool('queue-monitor') as unknown as { type: unknown; props: { focus?: string } };
    const p = renderAvailableTool('poll-scheduler') as unknown as { type: unknown; props: { focus?: string } };
    expect(q.type).toBe(p.type);
    expect(q.props.focus).toBe('queue-monitor');
    expect(p.props.focus).toBe('poll-scheduler');
  });

  it('Phone Hub ekranı başka hiçbir ekranla karışmaz', () => {
    const ph = renderAvailableTool('phone-hub-probe') as unknown as { type: unknown };
    for (const id of ['adapter-diagnostics', 'mavi-console', 'decoder-registry'] as const) {
      expect((renderAvailableTool(id) as unknown as { type: unknown }).type).not.toBe(ph.type);
    }
  });

  it('geliştirici erişim kapısı tek build otoritesinde kalır', async () => {
    const { isCarosLabAllowed } = await import('../platform/devtools/carosLabGate');
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true })).toBe(true);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
  });

  it('OBD servis dosyalarına yeni davranış eklenmedi (kaynak yalnız getter okur)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/phoneHubProbeSources.ts', 'utf8'));
    expect(src).toContain('getTransportStats');
    expect(src).toContain('getObdSessionHealth');
    expect(src).toContain('getObdHealth');
    for (const f of ['setObd', 'startObd', 'stopObd', 'requestObdReset']) {
      expect(src).not.toContain(f);
    }
  });
});
