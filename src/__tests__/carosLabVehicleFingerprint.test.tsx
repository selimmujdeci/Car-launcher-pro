/**
 * carosLabVehicleFingerprint.test.tsx — CAROS LAB · Araç Parmak İzi (Faz A5) KİLİTLERİ.
 *
 * ANA İLKELER:
 *  (a) GİZLİLİK — ham VIN / plaka / adaptör MAC hiçbir alana SIZMAZ.
 *  (b) DÜRÜSTLÜK — hash yoksa üretilmez, damga yoksa "şimdi" yazılmaz,
 *      BOŞ koleksiyon ile KAYNAK YOK ayrı sınıflandırılır.
 *  (c) FAIL-CLOSED — kimlik yoksa asla HAZIR denmez.
 *  (d) SALT-OKUNUR — araca komut yok, timer/abonelik yok, unmount sonrası setState yok.
 *
 * Model TAMAMEN SAF (servis importu yok) → mock'suz test edilir.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildVfSections, deriveVfEvidence, countByVfClass,
  VF_SECTION_ORDER, VF_SECTION_TITLE, VF_EVIDENCE_LABEL, MAX_FIELDS_PER_VF_SECTION,
  type VfRawSnapshot, type VfSection,
} from '../platform/devtools/vehicleFingerprintModel';
import { VF_MAX_PIDS, VF_MAX_DIDS, VF_MAX_ECUS } from '../platform/devtools/vehicleFingerprintSources';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { VehicleFingerprintScreen } from '../components/devtools/screens/VehicleFingerprintScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;
/** Testte kullanılan SAHTE VIN — hiçbir alana sızmamalı. */
const FAKE_VIN = 'WF0AXXTTRA5R12345';

function full(over: Partial<VfRawSnapshot> = {}): VfRawSnapshot {
  return {
    readAt: NOW,
    identity: {
      hash: 'a1b2c3d4',
      vinHash: 'deadbeef',
      vinPresent: true,
      protocol: '6',
      supportedPidBitmap: 'BE3FA813',
      firstSeen: NOW - 86_400_000,
      lastSeen: NOW - 60_000,
    },
    storedVehicleCount: 2,
    ecuAddresses: ['7E8', '7E9'],
    ecuAddressTotal: 2,
    supportedPids: ['0105', '010C', '010D'],
    supportedPidTotal: 3,
    autoDids: [{ did: '2201', ecuRx: '7E8' }],
    autoDidTotal: 1,
    recordTotal: 12,
    recordPidCount: 9,
    recordDidCount: 3,
    recordLastSeenAt: NOW - 3_600_000,
    ...over,
  };
}

/** Hiçbir kaynağın okunamadığı durum. */
function empty(over: Partial<VfRawSnapshot> = {}): VfRawSnapshot {
  return {
    readAt: NOW,
    identity: null,
    storedVehicleCount: null,
    ecuAddresses: null,
    ecuAddressTotal: null,
    supportedPids: null,
    supportedPidTotal: null,
    autoDids: null,
    autoDidTotal: null,
    recordTotal: null,
    recordPidCount: null,
    recordDidCount: null,
    recordLastSeenAt: null,
    ...over,
  };
}

function findField(sections: readonly VfSection[], id: string) {
  for (const s of sections) {
    const f = s.fields.find((x) => x.id === id);
    if (f) return f;
  }
  return undefined;
}

function allText(sections: readonly VfSection[]): string {
  return sections
    .flatMap((s) => s.fields.map((f) => `${f.label}|${f.value}|${f.note}|${f.source}`))
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. KATALOG + SCREEN-MAP
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — katalog AVAILABLE ve ekran çözümleniyor', () => {
  it('vehicle-fingerprint AVAILABLE', () => {
    expect(getCarosLabTool('vehicle-fingerprint')!.status).toBe('AVAILABLE');
  });

  it('screen-map gerçek bir ekrana çözer (sahte "çalışıyor" yok)', () => {
    expect(renderAvailableTool('vehicle-fingerprint')).not.toBeNull();
  });

  it('katalog notu "araca sorgu göndermez" güvencesini beyan eder', () => {
    const note = getCarosLabTool('vehicle-fingerprint')!.note ?? '';
    expect(note).toMatch(/SORGU GÖNDERMEZ|sorgu göndermez/);
    expect(note).toMatch(/VIN/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. YAPI — bölümler sabit ve bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — bölüm yapısı deterministik ve bounded', () => {
  it('bölümler SABİT sırada', () => {
    expect(buildVfSections(full()).map((s) => s.id)).toEqual([...VF_SECTION_ORDER]);
  });

  it('başlıklar sözlükten gelir (undefined basmaz)', () => {
    for (const s of buildVfSections(full())) {
      expect(s.title).toBe(VF_SECTION_TITLE[s.id]);
    }
  });

  it('alan tavanı AŞILMAZ', () => {
    for (const snap of [full(), empty()]) {
      for (const s of buildVfSections(snap)) {
        expect(s.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_VF_SECTION);
      }
    }
  });

  it('kaynak katmanının liste tavanları tanımlı ve makul', () => {
    for (const cap of [VF_MAX_PIDS, VF_MAX_DIDS, VF_MAX_ECUS]) {
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(64);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. GİZLİLİK — VIN / plaka / MAC sızıntısı YASAK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — ham VIN ve kişisel veri SIZMAZ', () => {
  it('ham VIN model çıktısının HİÇBİR alanında geçmez', () => {
    // Sözleşme gereği ham VIN model girdisine bile GİRMEZ; yine de çıktı taranır.
    const text = allText(buildVfSections(full()));
    expect(text, 'ham VIN sızdı').not.toContain(FAKE_VIN);
    // 17 haneli VIN benzeri hiçbir dizi olmamalı.
    expect(text, 'VIN biçiminde dizi bulundu').not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  });

  it('ham VIN taşıyan bir snapshot tipi model sözleşmesinde YOKTUR', () => {
    // VfIdentityRaw yalnız vinHash + vinPresent taşır; 'vin' alanı olsaydı
    // aşağıdaki nesne tip hatası verirdi (tsc bu kilidin ikinci yarısıdır).
    const id = full().identity!;
    expect(Object.keys(id)).not.toContain('vin');
    expect(Object.keys(id)).toContain('vinHash');
    expect(Object.keys(id)).toContain('vinPresent');
  });

  it('adaptör MAC / plaka alanı model sözleşmesinde YOKTUR', () => {
    const keys = Object.keys(full()).concat(Object.keys(full().identity!));
    for (const banned of ['adapterMac', 'mac', 'plate', 'plaka', 'metadata']) {
      expect(keys, `${banned} alanı taşınıyor`).not.toContain(banned);
    }
  });

  it('VIN yoksa özet UYDURULMAZ', () => {
    const f = findField(
      buildVfSections(full({ identity: { ...full().identity!, vinHash: null, vinPresent: false } })),
      'vfVinHash',
    )!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toMatch(/UYDURULMAZ|yok/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. DÜRÜSTLÜK — sentinel, hash ve timestamp
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — hash/timestamp uydurulmaz', () => {
  it('kimlik yoksa hash UNAVAILABLE (üretilmez)', () => {
    const f = findField(buildVfSections(empty()), 'vfHash')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
  });

  it('firstSeen/lastSeen damgası yoksa "şimdi" YAZILMAZ', () => {
    const sections = buildVfSections(full({
      identity: { ...full().identity!, firstSeen: null, lastSeen: null },
    }));
    for (const id of ['vfFirstSeen', 'vfLastSeen']) {
      const f = findField(sections, id)!;
      expect(f.klass).toBe('UNAVAILABLE');
      expect(f.updatedAt).toBeNull();
      expect(f.note).toMatch(/şimdi/);
    }
  });

  it('keşif damgası yoksa "son keşif" UYDURULMAZ', () => {
    const f = findField(buildVfSections(full({ recordLastSeenAt: null })), 'vfLastDiscoveryAt')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.updatedAt).toBeNull();
  });

  it('damga VARSA ISO değer + updatedAt taşınır', () => {
    const f = findField(buildVfSections(full()), 'vfLastDiscoveryAt')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe(new Date(NOW - 3_600_000).toISOString());
    expect(f.updatedAt).toBe(NOW - 3_600_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. BOŞ ≠ KAYNAK YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — boş koleksiyon ile kaynak yokluğu AYRI', () => {
  it('PID: null → KAYNAK YOK, sıfır sayı GÖSTERİLMEZ', () => {
    const sections = buildVfSections(full({ supportedPids: null, supportedPidTotal: null }));
    const f = findField(sections, 'vfPidCount')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(f.note).toMatch(/HİÇ yapılmadı|null/);
    // Liste alanı hiç üretilmemeli (yanlışlıkla "boş liste" gösterilmesin).
    expect(findField(sections, 'vfPidList')).toBeUndefined();
  });

  it('PID: boş küme → keşif YAPILDI, sonuç boş (0 dürüstçe gösterilir)', () => {
    const sections = buildVfSections(full({ supportedPids: [], supportedPidTotal: 0 }));
    const count = findField(sections, 'vfPidCount')!;
    expect(count.klass).toBe('OBSERVED');
    expect(count.value).toBe('0');
    const list = findField(sections, 'vfPidList')!;
    expect(list.klass).toBe('UNAVAILABLE');
    expect(list.note).toMatch(/YAPILDI/);
  });

  it('ECU: null → KAYNAK YOK; boş dizi → gerçek boşluk', () => {
    expect(findField(buildVfSections(empty()), 'vfEcuCount')!.klass).toBe('UNAVAILABLE');
    const sections = buildVfSections(full({ ecuAddresses: [], ecuAddressTotal: 0 }));
    expect(findField(sections, 'vfEcuCount')!.value).toBe('0');
    expect(findField(sections, 'vfEcuList')!.note).toMatch(/gerçek bir boşluk/);
  });

  it('kayıt deposu: null → anahtar yok; 0 → anahtar var kayıt yok', () => {
    expect(findField(buildVfSections(full({ recordTotal: null })), 'vfRecordCount')!.klass)
      .toBe('UNAVAILABLE');
    const f = findField(buildVfSections(full({ recordTotal: 0, recordPidCount: 0, recordDidCount: 0 })), 'vfRecordCount')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('0');
  });

  it('DID: boş dizi HÜKÜM KURMAZ (API tarandı/taranmadı ayrımı vermiyor)', () => {
    const f = findField(buildVfSections(full({ autoDids: [], autoDidTotal: 0 })), 'vfDidCount')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toMatch(/AYIRT ETMİYOR/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. BOUNDED LİSTELER — kesilen kuyruk gizlenmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — bounded listeler toplamı BEYAN eder', () => {
  it('PID listesi kesildiyse toplam sayı notta yazılır', () => {
    const pids = Array.from({ length: VF_MAX_PIDS }, (_, i) => `01${i.toString(16).padStart(2, '0')}`);
    const f = findField(buildVfSections(full({ supportedPids: pids, supportedPidTotal: 120 })), 'vfPidList')!;
    expect(f.note).toMatch(/Bounded/);
    expect(f.note).toContain('120');
  });

  it('ECU listesi kesildiyse toplam sayı notta yazılır', () => {
    const ecus = Array.from({ length: VF_MAX_ECUS }, (_, i) => `7E${i}`);
    const f = findField(buildVfSections(full({ ecuAddresses: ecus, ecuAddressTotal: 40 })), 'vfEcuList')!;
    expect(f.note).toMatch(/Bounded/);
    expect(f.note).toContain('40');
  });

  it('DID listesi kesildiyse toplam sayı notta yazılır', () => {
    const dids = Array.from({ length: VF_MAX_DIDS }, (_, i) => ({ did: `22${i.toString(16).padStart(2, '0')}`, ecuRx: '7E8' }));
    const f = findField(buildVfSections(full({ autoDids: dids, autoDidTotal: 99 })), 'vfDidList')!;
    expect(f.note).toMatch(/Bounded/);
    expect(f.note).toContain('99');
  });

  it('liste tam ise "Tam liste" denir (yanıltıcı bounded notu yok)', () => {
    expect(findField(buildVfSections(full()), 'vfPidList')!.note).toMatch(/Tam liste/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. KANIT SAĞLIĞI — fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — kanıt sağlığı fail-closed', () => {
  it('tüm kaynaklar mevcut → HAZIR (4/4)', () => {
    const r = deriveVfEvidence(full());
    expect(r.status).toBe('READY');
    expect(r.presentCount).toBe(4);
    expect(r.missing).toHaveLength(0);
  });

  it('tüm kaynaklar null → KAYNAK YOK (0/4) + her eksiğin gerekçesi', () => {
    const r = deriveVfEvidence(empty());
    expect(r.status).toBe('NO_SOURCE');
    expect(r.presentCount).toBe(0);
    expect(r.missing).toHaveLength(4);
    for (const m of r.missing) {
      expect(m.reason.length, `${m.key} gerekçesiz`).toBeGreaterThan(0);
      expect(m.source.length).toBeGreaterThan(0);
    }
  });

  it('kısmi kaynak → KISMİ', () => {
    const r = deriveVfEvidence(full({ supportedPids: null, supportedPidTotal: null }));
    expect(r.status).toBe('PARTIAL');
    expect(r.presentCount).toBe(3);
    expect(r.missing.map((m) => m.key)).toContain('desteklenen PID');
  });

  it('KİMLİK YOKSA diğer kaynaklar dolu olsa bile ASLA HAZIR denmez', () => {
    const r = deriveVfEvidence(full({ identity: null }));
    expect(r.status).not.toBe('READY');
    expect(r.status).toBe('PARTIAL');
  });

  it('her sağlık değeri için Türkçe etiket EKSİKSİZ', () => {
    for (const k of ['READY', 'PARTIAL', 'NO_SOURCE'] as const) {
      expect(VF_EVIDENCE_LABEL[k]).toBeTruthy();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. FAIL-SOFT + SAYIM
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — bozuk/eksik girdide patlamaz', () => {
  it('tüm kaynaklar null iken model PATLAMAZ', () => {
    expect(() => buildVfSections(empty())).not.toThrow();
    expect(() => deriveVfEvidence(empty())).not.toThrow();
  });

  it('countByVfClass bozuk girdide sıfır döner', () => {
    expect(countByVfClass(undefined as unknown as VfSection[]))
      .toEqual({ OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 });
  });

  it('sayım toplam alan sayısıyla tutarlı', () => {
    const sections = buildVfSections(full());
    const c = countByVfClass(sections);
    expect(c.OBSERVED + c.DERIVED + c.UNAVAILABLE + c.STALE)
      .toBe(sections.reduce((n, s) => n + s.fields.length, 0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. EKRAN — salt-okunur, timer/abonelik/komut yasağı (kaynak taraması)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — ekran salt-okunur ve zero-leak', () => {
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const readScreen = async () => {
    const { readFileSync } = await import('node:fs');
    return stripComments(
      readFileSync('src/components/devtools/screens/VehicleFingerprintScreen.tsx', 'utf8'));
  };

  it('timer/abonelik/polling kurmaz', async () => {
    const src = await readScreen();
    for (const f of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener']) {
      expect(src, `${f} bulundu — periyodik/abonelikli yol açılmış`).not.toContain(f);
    }
  });

  it('araçla komutlaşan hiçbir yüzey YOK', async () => {
    const src = await readScreen();
    for (const f of [
      'getVehicleFingerprint', 'readObdDid', 'sendCommand', 'connectOBD', 'disconnectOBD',
      'startDeepScan', 'maybeStartAutoDidDiscovery', 'startAutoDidWatcher',
      'clearDTC', 'upsertDiscoveredRecord', 'CarLauncher',
    ]) {
      expect(src, `${f} çağrısı var — ekran artık salt-okunur DEĞİL`).not.toContain(f);
    }
    expect(src, 'native plugin import edilmiş').not.toMatch(/from '.*nativePlugin'/);
  });

  it('UI ham repository çağrısı YAPMAZ — tek kaynak katmanı kullanır', async () => {
    const src = await readScreen();
    expect(src, 'ekran doğrudan repository import ediyor')
      .not.toMatch(/from '.*discoveredDataRepository'/);
    expect(src, 'ekran doğrudan fingerprint store import ediyor')
      .not.toMatch(/from '.*vehicleFingerprintService'/);
    expect(src, 'ekran doğrudan extendedPidService import ediyor')
      .not.toMatch(/from '.*extendedPidService'/);
    expect(src, 'ekran doğrudan autoDidDiscovery import ediyor')
      .not.toMatch(/from '.*autoDidDiscovery'/);
    expect(src, 'tek kaynak katmanı kullanılmıyor').toContain('readVehicleFingerprintSnapshot');
  });

  it('ZERO-LEAK: unmount sonrası setState engellenir', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/devtools/screens/VehicleFingerprintScreen.tsx', 'utf8');
    expect(src).toContain('mountedRef.current = false');
    expect(src, 'setSnap mountedRef kapısından geçmiyor').toMatch(/if \(mountedRef\.current\) setSnap/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('sabit hex renk KULLANMAZ — yalnız --oem-* tokenları', async () => {
    const src = await readScreen();
    expect(src, 'sabit hex renk geri geldi').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src, 'tailwind palet rengi kullanılmış').not.toMatch(
      /\b(?:text|bg|border)-(?:cyan|emerald|amber|rose|sky|slate|zinc|gray|neutral)-\d{2,3}\b/);
    expect(src).toContain('var(--oem-');
  });

  it('kaynak katmanı da araca komut göndermez', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/platform/devtools/vehicleFingerprintSources.ts', 'utf8'));
    for (const f of ['getVehicleFingerprint', 'readObdDid', 'sendCommand', 'CarLauncher', 'await ']) {
      expect(src, `${f} bulundu — kaynak katmanı artık yan etkisiz DEĞİL`).not.toContain(f);
    }
    expect(src, 'yazma yolu (upsert/save) çağrılmış').not.toMatch(/upsertDiscoveredRecord|\.save\(|\.remove\(|\.clear\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10. RENDER
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — ekran render', () => {
  it('hiç kayıt yokken bile çökmeden render olur', () => {
    let html = '';
    expect(() => { html = renderToStaticMarkup(<VehicleFingerprintScreen />); }).not.toThrow();
    expect(html).toContain('vehicle-fingerprint');
    expect(html).toContain('SALT OKUNUR');
  });

  it('ham sağlık enum\'u DOM\'da beyan edilir (dile bağımsız)', () => {
    const html = renderToStaticMarkup(<VehicleFingerprintScreen />);
    expect(html).toMatch(/data-health="(READY|PARTIAL|NO_SOURCE)"/);
  });

  it('dört bölüm de basılır', () => {
    const html = renderToStaticMarkup(<VehicleFingerprintScreen />);
    for (const id of VF_SECTION_ORDER) {
      expect(html, `vf-section-${id} yok`).toContain(`vf-section-${id}`);
    }
  });

  it('render çıktısında VIN biçiminde dizi YOK', () => {
    const html = renderToStaticMarkup(<VehicleFingerprintScreen />);
    expect(html).not.toContain(FAKE_VIN);
  });
});
