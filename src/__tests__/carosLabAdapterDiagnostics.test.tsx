/**
 * carosLabAdapterDiagnostics.test.tsx — CAROS LAB · Adaptör Tanılama (Faz A6) KİLİTLERİ.
 *
 * ANA İLKELER:
 *  (a) SALT-OKUNUR — AT/OBD komutu, reconnect/reset/recovery yok; timer/abonelik yok.
 *  (b) DÜRÜSTLÜK — `-1` sentinel sayı gibi basılmaz, `0` sayaç ile KAYNAK YOK ayrıdır,
 *      damga yoksa "şimdi" yazılmaz.
 *  (c) İKİ MOTOR AYRI — adaptif `dataFresh` ile mutlak `isStale` birleştirilmez.
 *  (d) FAIL-CLOSED — `connected=true` tek başına SAĞLIKLI üretmez.
 *  (e) GİZLİLİK — adaptör adı/adresi/seri numarası sızmaz.
 *
 * Model TAMAMEN SAF (servis importu yok) → mock'suz test edilir.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildAdSections, deriveAdVerdict, countByAdClass,
  AD_SECTION_ORDER, AD_SECTION_TITLE, AD_VERDICT_LABEL,
  MAX_FIELDS_PER_AD_SECTION, MAX_AD_REASONS,
  type AdRawSnapshot, type AdSection,
} from '../platform/devtools/adapterDiagnosticsModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { AdapterDiagnosticsScreen } from '../components/devtools/screens/AdapterDiagnosticsScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;
/** Sızmaması gereken sahte kimlikler. */
const FAKE_MAC  = '00:1D:A5:68:98:8B';
const FAKE_NAME = 'OBDII-CLONE-7788';

/** Her şeyin sağlıklı olduğu tam snapshot. */
function full(over: Partial<AdRawSnapshot> = {}): AdRawSnapshot {
  return {
    readAt: NOW,
    transport: { transport: 'classic', connected: true, reconnectAttempts: 0, lastDisconnectReason: null },
    status:    { connectionState: 'connected', source: 'real', vehicleType: 'ice', lastSeenAt: NOW - 500 },
    data:      { transportConnected: true, dataFresh: true, lastRxAt: NOW - 500, adapterNamePresent: true },
    session:   { transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true },
    freshWindowMs: 12_000,
    lifecycle: {
      resetRequestedCount: 0, resetCompletedCount: 0, disconnectCalledCount: 0,
      reconnectRequestedCount: 0, lastResetReason: null,
      lastResetAt: null, lastDisconnectAt: null, lastReconnectAt: null, lastPacketAgeMs: 500,
    },
    health: {
      connectionQuality: 92, lastPacketAgeMs: 500, isStale: false,
      reconnectPressure: 0, reliabilityFieldCount: 6,
    },
    ...over,
  };
}

/** Hiçbir getter'ın veri veremediği (null/throw) durum. */
function empty(over: Partial<AdRawSnapshot> = {}): AdRawSnapshot {
  return {
    readAt: NOW,
    transport: null, status: null, data: null, session: null,
    freshWindowMs: null, lifecycle: null, health: null,
    ...over,
  };
}

function findField(sections: readonly AdSection[], id: string) {
  for (const s of sections) {
    const f = s.fields.find((x) => x.id === id);
    if (f) return f;
  }
  return undefined;
}

function allText(sections: readonly AdSection[]): string {
  return sections
    .flatMap((s) => s.fields.map((f) => `${f.label}|${f.value}|${f.note}|${f.source}`))
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. KATALOG + SCREEN-MAP
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — katalog AVAILABLE ve screen-map çözümlenir', () => {
  it('adapter-diagnostics AVAILABLE', () => {
    expect(getCarosLabTool('adapter-diagnostics')!.status).toBe('AVAILABLE');
  });

  it('screen-map gerçek bir ekrana çözer', () => {
    expect(renderAvailableTool('adapter-diagnostics')).not.toBeNull();
  });

  it('katalog notu komut göndermeme ve gizlilik güvencesini beyan eder', () => {
    const note = getCarosLabTool('adapter-diagnostics')!.note ?? '';
    expect(note).toMatch(/GÖNDERMEZ/);
    expect(note).toMatch(/RSSI/);
    expect(note).toMatch(/adresi|adres/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. YAPI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — bölüm yapısı deterministik ve bounded', () => {
  it('bölümler SABİT sırada', () => {
    expect(buildAdSections(full()).map((s) => s.id)).toEqual([...AD_SECTION_ORDER]);
  });

  it('başlıklar sözlükten gelir', () => {
    for (const s of buildAdSections(full())) expect(s.title).toBe(AD_SECTION_TITLE[s.id]);
  });

  it('alan tavanı AŞILMAZ (tam ve boş snapshot)', () => {
    for (const snap of [full(), empty()]) {
      for (const s of buildAdSections(snap)) {
        expect(s.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_AD_SECTION);
      }
    }
  });

  it('gerekçe listesi bounded', () => {
    const r = deriveAdVerdict(full({
      transport: { transport: 'ble', connected: true, reconnectAttempts: 9, lastDisconnectReason: 'X' },
      session: { transportReady: true, sessionReady: true, pollingActive: false, dataFresh: true, ready: false },
      lifecycle: { ...full().lifecycle!, resetRequestedCount: 5, resetCompletedCount: 1 },
      health: { connectionQuality: 10, lastPacketAgeMs: 100, isStale: false, reconnectPressure: 3.5, reliabilityFieldCount: 2 },
    }));
    expect(r.reasons.length).toBeLessThanOrEqual(MAX_AD_REASONS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. GİZLİLİK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — MAC / ad / seri numarası SIZMAZ', () => {
  it('model sözleşmesinde adaptör adı/adresi alanı YOKTUR', () => {
    const keys = Object.keys(full().data!);
    expect(keys).toContain('adapterNamePresent');
    for (const banned of ['deviceName', 'address', 'mac', 'serial']) {
      expect(keys, `${banned} taşınıyor`).not.toContain(banned);
    }
  });

  it('çıktıda MAC biçiminde dizi ya da sahte ad geçmez', () => {
    const text = allText(buildAdSections(full()));
    expect(text).not.toContain(FAKE_MAC);
    expect(text).not.toContain(FAKE_NAME);
    expect(text, 'MAC biçimi bulundu').not.toMatch(/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/);
  });

  it('adaptör kimliği yalnız VARLIK olarak gösterilir', () => {
    const f = findField(buildAdSections(full()), 'adAdapterName')!;
    expect(f.value).toBe('kayıtlı (gösterilmez)');
    expect(f.note).toMatch(/EKRANA BASILMAZ/);
    const yok = findField(buildAdSections(full({
      data: { ...full().data!, adapterNamePresent: false },
    })), 'adAdapterName')!;
    expect(yok.value).toBe('kayıt yok');
  });

  it('render çıktısında MAC/ad sızıntısı yok', () => {
    const html = renderToStaticMarkup(<AdapterDiagnosticsScreen />);
    expect(html).not.toContain(FAKE_MAC);
    expect(html).not.toMatch(/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. SENTINEL + 0/KAYNAK YOK AYRIMI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — sentinel ve sıfır dürüstlüğü', () => {
  it('lastPacketAgeMs=-1 → KAYNAK YOK ("0 ms" basılmaz)', () => {
    const sections = buildAdSections(full({
      lifecycle: { ...full().lifecycle!, lastPacketAgeMs: -1 },
      health: { ...full().health!, lastPacketAgeMs: -1 },
    }));
    for (const id of ['adPacketAgeLife', 'adPacketAgeHealth']) {
      const f = findField(sections, id)!;
      expect(f.klass).toBe('UNAVAILABLE');
      expect(f.value).not.toContain('-1');
      expect(f.value).not.toBe('0');
    }
  });

  it('connectionQuality=-1 → "hiç bağlanılmadı" ("0 puan" DEĞİL)', () => {
    const f = findField(buildAdSections(full({
      health: { ...full().health!, connectionQuality: -1 },
    })), 'adQuality')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toMatch(/HİÇ kurulmadı/);
    expect(f.value).not.toBe('0');
  });

  it('lastPacketAgeMs=0 GERÇEK bir ölçümdür → gösterilir', () => {
    const f = findField(buildAdSections(full({
      lifecycle: { ...full().lifecycle!, lastPacketAgeMs: 0 },
    })), 'adPacketAgeLife')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('0');
  });

  it('sayaçlar 0 iken GÖSTERİLİR; kaynak null iken GÖSTERİLMEZ', () => {
    const sifir = findField(buildAdSections(full()), 'adReconnects')!;
    expect(sifir.klass).toBe('OBSERVED');
    expect(sifir.value).toBe('0');

    const sections = buildAdSections(full({ lifecycle: null }));
    expect(findField(sections, 'adReconnects')).toBeUndefined();
    const beyan = findField(sections, 'adLifecycle')!;
    expect(beyan.klass).toBe('UNAVAILABLE');
    expect(beyan.note).toMatch(/0 GÖSTERİLMEZ/);
  });

  it('damga yoksa "şimdi" YAZILMAZ', () => {
    const sections = buildAdSections(full({
      status: { ...full().status!, lastSeenAt: null },
      data:   { ...full().data!, lastRxAt: null },
      lifecycle: { ...full().lifecycle!, lastResetAt: null, lastDisconnectAt: null, lastReconnectAt: null },
    }));
    for (const id of ['adLastSeenAt', 'adLastRxAt', 'adLastResetAt', 'adLastDisconnectAt', 'adLastReconnectAt']) {
      const f = findField(sections, id)!;
      expect(f.klass, `${id} damgasız olmasına rağmen değer basıyor`).toBe('UNAVAILABLE');
      expect(f.updatedAt).toBeNull();
      expect(f.note).toMatch(/şimdi/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. RSSI / BUFFER / KLON / BLE — uydurma yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — kaynağı olmayan metrikler UYDURULMAZ', () => {
  it('sınırlar bölümündeki HER alan UNAVAILABLE', () => {
    const sec = buildAdSections(full()).find((s) => s.id === 'limits')!;
    expect(sec.fields.length).toBeGreaterThanOrEqual(5);
    for (const f of sec.fields) {
      expect(f.klass, `${f.id} bir değer basıyor`).toBe('UNAVAILABLE');
      expect(f.value).toBe('—');
      expect(f.note.length).toBeGreaterThan(0);
    }
  });

  it('RSSI · buffer · klon · BLE · firmware ayrı ayrı beyan edilir', () => {
    const sections = buildAdSections(full());
    for (const id of ['adRssi', 'adBuffer', 'adClone', 'adBleAdvanced', 'adFirmware']) {
      expect(findField(sections, id), `${id} alanı yok`).toBeDefined();
    }
  });

  it('KANIT: her şey sağlıklıyken bile sınırlar UNAVAILABLE kalır', () => {
    const sec = buildAdSections(full()).find((s) => s.id === 'limits')!;
    expect(sec.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. İKİ MOTOR AYRI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — adaptif dataFresh ile mutlak isStale karıştırılmaz', () => {
  it('iki alan AYRI gösterilir', () => {
    const sections = buildAdSections(full());
    expect(findField(sections, 'adDataFresh')!.source).toMatch(/getObdSessionHealth/);
    expect(findField(sections, 'adAbsStale')!.source).toMatch(/ObdHealthMonitor/);
  });

  it('çelişki (fresh=true & stale=true) AÇIKÇA işaretlenir', () => {
    const f = findField(buildAdSections(full({
      health: { ...full().health!, isStale: true },
    })), 'adEngineAgreement')!;
    expect(f.value).toBe('ÇELİŞKİ');
  });

  it('uyumlu durumda "uyumlu" der', () => {
    expect(findField(buildAdSections(full()), 'adEngineAgreement')!.value).toBe('uyumlu');
  });

  it('iki paket yaşı ölçümü AYRI alanlarda kalır', () => {
    const sections = buildAdSections(full({
      lifecycle: { ...full().lifecycle!, lastPacketAgeMs: 500 },
      health: { ...full().health!, lastPacketAgeMs: 4200 },
    }));
    expect(findField(sections, 'adPacketAgeLife')!.value).toBe('500');
    expect(findField(sections, 'adPacketAgeHealth')!.value).toBe('4200');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. SAĞLIK HÜKMÜ — fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — sağlık hükmü kanıta dayanır', () => {
  it('tüm kaynaklar null → BİLİNMİYOR', () => {
    const r = deriveAdVerdict(empty());
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('bağlı değil → BAĞLI DEĞİL + kopma nedeni gerekçede', () => {
    const r = deriveAdVerdict(full({
      transport: { transport: 'ble', connected: false, reconnectAttempts: 2, lastDisconnectReason: 'BT_LINK_LOSS' },
      session: { ...full().session!, transportReady: false, ready: false },
    }));
    expect(r.status).toBe('DISCONNECTED');
    expect(r.reasons.join(' ')).toContain('BT_LINK_LOSS');
  });

  it('connected=true ama session hazır değil → TRANSPORT HAZIR / OTURUM HAZIR DEĞİL', () => {
    const r = deriveAdVerdict(full({
      session: { transportReady: true, sessionReady: false, pollingActive: true, dataFresh: true, ready: false },
    }));
    expect(r.status).toBe('TRANSPORT_ONLY');
    expect(r.status).not.toBe('HEALTHY');
  });

  it('session hazır ama veri bayat (adaptif) → VERİ BAYAT', () => {
    const r = deriveAdVerdict(full({
      session: { ...full().session!, dataFresh: false, ready: false },
    }));
    expect(r.status).toBe('DATA_STALE');
  });

  it('yalnız MUTLAK donma açıkken de VERİ BAYAT + çelişki gerekçesi', () => {
    const r = deriveAdVerdict(full({ health: { ...full().health!, isStale: true } }));
    expect(r.status).toBe('DATA_STALE');
    expect(r.reasons.join(' ')).toMatch(/ÇELİŞİYOR/);
  });

  it('reconnect/reset baskısı → ZAYIF', () => {
    const r = deriveAdVerdict(full({
      transport: { ...full().transport!, reconnectAttempts: 3 },
      lifecycle: { ...full().lifecycle!, resetRequestedCount: 4, resetCompletedCount: 1 },
    }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons.join(' ')).toMatch(/reconnect|Yarım kalan reset/);
  });

  it('düşük kalite → ZAYIF', () => {
    const r = deriveAdVerdict(full({ health: { ...full().health!, connectionQuality: 35 } }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons.join(' ')).toContain('35');
  });

  it('her şey iyi → SAĞLIKLI (tek gerekçeyle)', () => {
    const r = deriveAdVerdict(full());
    expect(r.status).toBe('HEALTHY');
    expect(r.reasons).toHaveLength(1);
  });

  it('connected=true TEK BAŞINA sağlıklı üretmez (oturum kaynağı yokken)', () => {
    const r = deriveAdVerdict(empty({
      transport: { transport: 'classic', connected: true, reconnectAttempts: 0, lastDisconnectReason: null },
    }));
    expect(r.status).not.toBe('HEALTHY');
  });

  it('kısmi kaynak: yalnız oturum var → hüküm yine kurulabilir, uydurma yok', () => {
    const r = deriveAdVerdict(empty({
      session: { transportReady: true, sessionReady: false, pollingActive: false, dataFresh: false, ready: false },
    }));
    expect(r.status).toBe('TRANSPORT_ONLY');
  });

  it('her hüküm için Türkçe etiket EKSİKSİZ', () => {
    for (const k of ['UNKNOWN', 'DISCONNECTED', 'TRANSPORT_ONLY', 'DATA_STALE', 'DEGRADED', 'HEALTHY'] as const) {
      expect(AD_VERDICT_LABEL[k]).toBeTruthy();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — bozuk/eksik girdide patlamaz', () => {
  it('tüm getter null iken model PATLAMAZ', () => {
    expect(() => buildAdSections(empty())).not.toThrow();
    expect(() => deriveAdVerdict(empty())).not.toThrow();
  });

  it('countByAdClass bozuk girdide sıfır döner', () => {
    expect(countByAdClass(undefined as unknown as AdSection[]))
      .toEqual({ OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 });
  });

  it('sayım toplam alan sayısıyla tutarlı', () => {
    const sections = buildAdSections(full());
    const c = countByAdClass(sections);
    expect(c.OBSERVED + c.DERIVED + c.UNAVAILABLE + c.STALE)
      .toBe(sections.reduce((n, s) => n + s.fields.length, 0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. EKRAN + KAYNAK KATMANI — salt-okunurluk (kaynak taraması)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — salt-okunur ve zero-leak', () => {
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const read = async (p: string) => {
    const { readFileSync } = await import('node:fs');
    return stripComments(readFileSync(p, 'utf8'));
  };

  const SCREEN = 'src/components/devtools/screens/AdapterDiagnosticsScreen.tsx';
  const SOURCE = 'src/platform/devtools/adapterDiagnosticsSources.ts';

  it('ekran timer/abonelik/polling kurmaz', async () => {
    const src = await read(SCREEN);
    for (const f of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'subscribe', 'addListener']) {
      expect(src, `${f} bulundu`).not.toContain(f);
    }
  });

  it('ekran reconnect/reset/AT/OBD komut yüzeyi AÇMAZ', async () => {
    const src = await read(SCREEN);
    for (const f of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnectOBD', 'resetObd',
      'requestObdReset', 'CarLauncher', 'ATZ', 'ATI',
    ]) {
      expect(src, `${f} çağrısı var — ekran salt-okunur DEĞİL`).not.toContain(f);
    }
    expect(src, 'native plugin import edilmiş').not.toMatch(/from '.*nativePlugin'/);
  });

  it('UI doğrudan servis çağırmaz — tek kaynak katmanı', async () => {
    const src = await read(SCREEN);
    expect(src, 'ekran doğrudan obdService import ediyor').not.toMatch(/from '.*\/obdService'/);
    expect(src, 'ekran doğrudan ObdHealthMonitor import ediyor').not.toMatch(/from '.*ObdHealthMonitor'/);
    expect(src).toContain('readAdapterDiagnosticsSnapshot');
  });

  it('kaynak katmanı da komut göndermez / yazma yapmaz', async () => {
    const src = await read(SOURCE);
    for (const f of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnectOBD', 'requestObdReset',
      'CarLauncher', 'await ', 'setInterval', 'setTimeout', 'subscribe', 'addListener',
    ]) {
      expect(src, `${f} bulundu — kaynak katmanı yan etkisiz DEĞİL`).not.toContain(f);
    }
  });

  it('ZERO-LEAK: unmount sonrası setState engellenir', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SCREEN, 'utf8');
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('sabit hex renk KULLANMAZ — yalnız --oem-* tokenları', async () => {
    const src = await read(SCREEN);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(
      /\b(?:text|bg|border)-(?:cyan|emerald|amber|rose|sky|slate|zinc|gray|neutral)-\d{2,3}\b/);
    expect(src).toContain('var(--oem-');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10. RENDER
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — ekran render', () => {
  it('hiç bağlantı yokken çökmeden render olur', () => {
    let html = '';
    expect(() => { html = renderToStaticMarkup(<AdapterDiagnosticsScreen />); }).not.toThrow();
    expect(html).toContain('adapter-diagnostics');
    expect(html).toContain('SALT OKUNUR');
  });

  it('ham hüküm enum\'u DOM\'da beyan edilir', () => {
    const html = renderToStaticMarkup(<AdapterDiagnosticsScreen />);
    expect(html).toMatch(/data-verdict="(UNKNOWN|DISCONNECTED|TRANSPORT_ONLY|DATA_STALE|DEGRADED|HEALTHY)"/);
  });

  it('dört bölüm de basılır + sınırlar "GÖZLEM KANALI YOK" ile işaretlenir', () => {
    const html = renderToStaticMarkup(<AdapterDiagnosticsScreen />);
    for (const id of AD_SECTION_ORDER) expect(html).toContain(`ad-section-${id}`);
    expect(html).toContain('GÖZLEM KANALI YOK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11. A4/A5 KİLİTLERİ ZAYIFLAMADI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — önceki fazların kilitleri korunur', () => {
  it('A4 (kwp-monitor) ve A5 (vehicle-fingerprint) hâlâ AVAILABLE ve eşlenmiş', () => {
    for (const id of ['kwp-monitor', 'vehicle-fingerprint'] as const) {
      expect(getCarosLabTool(id)!.status, `${id} durumu bozuldu`).toBe('AVAILABLE');
      expect(renderAvailableTool(id), `${id} ekran eşlemesi kayboldu`).not.toBeNull();
    }
  });

  it('paylaşılan gözlemlenebilirlik modeli hâlâ tek kaynak (paralel sistem yok)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const p of [
      'src/platform/devtools/adapterDiagnosticsModel.ts',
      'src/platform/devtools/kwpMonitorModel.ts',
      'src/platform/devtools/vehicleFingerprintModel.ts',
    ]) {
      expect(readFileSync(p, 'utf8'), `${p} kendi Observability tipini tanımlamış`)
        .toMatch(/from '\.\/sessionInspectorModel'/);
    }
  });
});
