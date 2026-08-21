/**
 * fleetKbWiring.test.tsx — V-04/4: `fleetKb` ürün yoluna bağlandı KİLİTLERİ.
 *
 * NEDEN: modül "araçtan öğren, sonraki sefere hazır gel" mantığını taşıyordu ama
 * hiçbir yerden çağrılmıyordu — iddia kodda, üründe yoktu.
 *
 * ANA İLKELER:
 *  (a) KİMLİKSİZ ÖĞRENME YOK — kanıt yoksa profil yazılmaz.
 *  (b) HAM VIN DİSKE YAZILMAZ — kimlik hash'lenir, ekrana ham VIN gelmez.
 *  (c) HAFIZA KANIT DEĞİL — ipucu yalnız SIRA belirler, hiçbir ECU atlanmaz.
 *  (d) ARACA İNAN — canlı keşif hafızayı EZER (ECU kaybı/araç değişimi).
 *  (e) FAIL-SOFT — depolama patlarsa tarama ETKİLENMEZ.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import multiEcuScanSrc from '../platform/obd/multiEcuScan.ts?raw';
import fleetKbServiceSrc from '../platform/obd/fleetKbService.ts?raw';
import fleetKbLabModelSrc from '../platform/devtools/fleetKbLabModel.ts?raw';

/* ── Depolama ve VIN uçları mock ─────────────────────────────────────────── */
const store = vi.hoisted(() => ({
  data: new Map<string, string>(),
  readThrows: false,
  writeThrows: false,
}));
const ctx = vi.hoisted(() => ({ vin: null as string | null, pids: new Set<string>() }));

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => {
    if (store.readThrows) throw new Error('depo okunamadı');
    return store.data.get(k) ?? null;
  },
  safeSetRaw: (k: string, v: string) => {
    if (store.writeThrows) throw new Error('depo yazılamadı');
    store.data.set(k, v);
  },
}));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: () => ctx.vin }));
vi.mock('../platform/obd/extendedPidService', () => ({ getSupportedPids: () => ctx.pids }));
vi.mock('../platform/crashLogger', () => ({ logError: () => { /* sessiz */ } }));

import {
  currentFingerprint, recordVehicleObservation, scanHintsFor,
  getFleetKbSnapshot, loadProfile, MAX_FLEET_PROFILES, _resetFleetKbForTest,
} from '../platform/obd/fleetKbService';
import {
  buildFleetKbFields, buildFleetKbProfiles, deriveFleetKbVerdict,
  FLEET_KB_VERDICT_LABEL, ESTABLISHED_OBSERVATIONS,
} from '../platform/devtools/fleetKbLabModel';
import { readFleetKbLabSnapshot } from '../platform/devtools/fleetKbLabSources';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { FleetKbScreen } from '../components/devtools/screens/FleetKbScreen';
import type { DiscoveredEcu, VehicleTopology } from '../platform/obd/ecuDiscovery';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;
const VIN = 'VF1RFA00123456789';

function ecu(tx: string, rx: string, label = 'ECU'): DiscoveredEcu {
  return { txHeader: tx, rxHeader: rx, label } as DiscoveredEcu;
}

function topo(ecus: DiscoveredEcu[]): VehicleTopology {
  return { ecus, probedAt: NOW, raw: '' } as unknown as VehicleTopology;
}

beforeEach(() => {
  store.data.clear();
  store.readThrows = false;
  store.writeThrows = false;
  ctx.vin = VIN;
  ctx.pids = new Set(['0C', '0D', '05']);
  _resetFleetKbForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. ÜRÜN YOLUNA BAĞLI MI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — fleetKb artık ÜRÜN yolundan çağrılıyor', () => {
  it('tam araç taraması hem ipucunu okur hem gözlemi öğrenir', () => {
    expect(multiEcuScanSrc, 'tarama ipucu okuması kaldırılmış — öğrenilen hiç kullanılmaz')
      .toMatch(/scanHintsFor\(/);
    expect(multiEcuScanSrc, 'öğrenme çağrısı kaldırılmış — hafıza hiç dolmaz')
      .toMatch(/recordVehicleObservation\(/);
  });

  it('LAB kataloğunda AVAILABLE ve gerçek ekrana çözülüyor', () => {
    expect(getCarosLabTool('fleet-kb')!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('fleet-kb')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. KİMLİKSİZ ÖĞRENME YOK · HAM VIN SAKLANMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — kimlik ve gizlilik', () => {
  it('kanıt yoksa (ECU yok, PID yok, VIN yok) kimlik ÜRETİLMEZ', () => {
    ctx.vin = null;
    ctx.pids = new Set();
    expect(currentFingerprint(topo([]))).toBeNull();
    expect(recordVehicleObservation(topo([]), [], NOW)).toBeNull();
  });

  it('kimliksiz gözlemde diske HİÇBİR ŞEY yazılmaz', () => {
    ctx.vin = null;
    ctx.pids = new Set();
    recordVehicleObservation(topo([]), [], NOW);
    expect(store.data.size).toBe(0);
  });

  it('VIN varsa kimlik HASH\'tir — ham VIN kimliğe girmez', () => {
    const fp = currentFingerprint(topo([ecu('7E0', '7E8')]))!;
    expect(fp.source).toBe('vin');
    expect(fp.fingerprint.includes(VIN), 'ham VIN kimliğe sızdı').toBe(false);
    expect(fp.fingerprint.startsWith('vin:')).toBe(true);
  });

  it('diske yazılan içerikte ham VIN GEÇMEZ', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW);
    const written = [...store.data.values()].join('|');
    expect(written.includes(VIN), 'ham VIN diske yazıldı — gizlilik ihlali').toBe(false);
  });

  it('VIN yoksa ECU+PID imzası kullanılır (öğrenme durmaz)', () => {
    ctx.vin = null;
    const fp = currentFingerprint(topo([ecu('7E0', '7E8')]))!;
    expect(fp.source).toBe('signature');
    expect(fp.fingerprint).toMatch(/^sig:/);
  });

  it('servis ham VIN\'i log/ekran yoluna TAŞIMAZ (yalnız hash üretir)', () => {
    expect(fleetKbServiceSrc, 'hash fonksiyonu kaldırılmış').toMatch(/function fnv1a/);
    expect(fleetKbServiceSrc.includes('fingerprint: fp.fingerprint'),
      'ham fingerprint doğrudan kullanılıyor — VIN sızma riski').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. ÖĞRENME VE ARACA İNANMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — öğrenme, gözlem sayısı, araç değişimi', () => {
  it('ilk gözlem profil yazar ve firstSeen bildirir', () => {
    const obs = recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW)!;
    expect(obs.firstSeen).toBe(true);
    expect(obs.profile.observationCount).toBe(1);
    expect(loadProfile(obs.profile.fingerprint)).not.toBeNull();
  });

  it('aynı araç ikinci kez görülünce gözlem sayısı ve güven ARTAR', () => {
    const a = recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW)!;
    const b = recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW + 1000)!;
    expect(b.profile.observationCount).toBe(2);
    expect(b.confidence).toBeGreaterThan(a.confidence);
    expect(b.firstSeen).toBe(false);
  });

  it('güven 1\'e ULAŞMAZ (araç her an değişebilir)', () => {
    let obs = recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW)!;
    for (let i = 1; i < 12; i++) {
      obs = recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW + i * 1000)!;
    }
    expect(obs.confidence).toBeLessThan(1);
  });

  it('ECU kaybı hafızada TUTULMAZ — canlı kanıt kazanır', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8'), ecu('7E1', '7E9')]), [], NOW)!;
    const after = recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW + 1000)!;
    expect(after.missing).toContain('7E1');
    expect(after.profile.ecus.map((e) => e.txHeader)).toEqual(['7E0']);
  });

  it('hiç ortak ECU kalmadıysa ARAÇ DEĞİŞİMİ bildirilir (dongle taşındı)', () => {
    ctx.vin = null;                       // imza yolunda kimlik ECU'lardan gelir
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW);
    /* Aynı kimlikte kalması için imzayı sabitlemek yerine profili elle okuruz:
       farklı ECU seti FARKLI imza üretir → yeni profil. Araç değişimi sinyali
       VIN yolunda anlamlıdır; orada kimlik sabit kalır. */
    ctx.vin = VIN;
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW + 1000);
    const changed = recordVehicleObservation(topo([ecu('18DAF110', '18DA10F1')]), [], NOW + 2000)!;
    expect(changed.vehicleChanged).toBe(true);
  });

  it('profil sayısı tavanı aşmaz — en eski GÖRÜLEN düşer', () => {
    ctx.vin = null;
    for (let i = 0; i < MAX_FLEET_PROFILES + 3; i++) {
      recordVehicleObservation(topo([ecu(`7E${i}`, `7F${i}`)]), [], NOW + i * 1000);
    }
    expect(getFleetKbSnapshot().profileCount).toBe(MAX_FLEET_PROFILES);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. HAFIZA KANIT DEĞİL — yalnız SIRA
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — ipucu tarama kapsamını DARALTMAZ', () => {
  it('öğrenilen UDS ECU\'ları ipucu olarak döner', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8'), ecu('7E1', '7E9')]), ['7E1'], NOW);
    expect(scanHintsFor(topo([ecu('7E0', '7E8'), ecu('7E1', '7E9')])).udsFirst).toEqual(['7E1']);
  });

  it('sıralama yardımcı fonksiyonu FİLTRELEMEZ (küme aynı kalır)', () => {
    /* Kilit metni: `orderByUdsHint` yalnız iki kovaya ayırıp birleştirir. */
    expect(multiEcuScanSrc, 'sıralama yardımcı fonksiyonu kaldırılmış')
      .toMatch(/function orderByUdsHint/);
    expect(multiEcuScanSrc, 'ipucu FİLTRE olarak kullanılıyor — ECU atlanır!')
      .not.toMatch(/ecus\.filter\(\(e\) => hinted\.has/);
    expect(multiEcuScanSrc).toMatch(/return \[\.\.\.first, \.\.\.rest\]/);
  });

  it('bilinmeyen araçta ipucu BOŞ döner (uydurma sıra yok)', () => {
    expect(scanHintsFor(topo([ecu('7E0', '7E8')])).udsFirst).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. FAIL-SOFT
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — depolama patlarsa teşhis ETKİLENMEZ', () => {
  it('okuma patlarsa fırlatmaz, boş sonuç ve HATA döner', () => {
    store.readThrows = true;
    expect(() => getFleetKbSnapshot()).not.toThrow();
    expect(getFleetKbSnapshot().profileCount).toBe(0);
    expect(getFleetKbSnapshot().error).not.toBeNull();
  });

  it('yazma patlarsa gözlem fırlatmaz', () => {
    store.writeThrows = true;
    expect(() => recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW)).not.toThrow();
  });

  it('bozuk JSON tüm dosyayı çöpe atmaz, sessizce boş döner', () => {
    store.data.set('caros.fleetkb.v1', '{bozuk');
    expect(getFleetKbSnapshot().profileCount).toBe(0);
  });

  it('ipucu okuması patlarsa boş ipucu döner (tarama durmaz)', () => {
    store.readThrows = true;
    expect(scanHintsFor(topo([ecu('7E0', '7E8')])).udsFirst).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. LAB MODELİ + EKRAN
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — gözlem yüzeyi', () => {
  it('model saf: I/O ve modül durumu YOK', () => {
    const code = fleetKbLabModelSrc
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code.includes('Date.now'), 'model Date.now kullanıyor').toBe(false);
    expect(code.includes('safeGetRaw'), 'model doğrudan depoya erişiyor').toBe(false);
    expect(/^(let|var) /m.test(code), 'model modül durumu tutuyor').toBe(false);
  });

  it('hiç kayıt yokken HİÇ ÖĞRENİLMEDİ der (sahte "hazır" yok)', () => {
    const snap = readFleetKbLabSnapshot();
    const v = deriveFleetKbVerdict(snap, buildFleetKbProfiles(snap));
    expect(v.status).toBe('EMPTY');
  });

  it('tek gözlemli profil KANIT sayılmaz (ÖĞRENİYOR)', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW);
    const snap = readFleetKbLabSnapshot();
    const profiles = buildFleetKbProfiles(snap);
    expect(profiles[0].observationCount).toBeLessThan(ESTABLISHED_OBSERVATIONS);
    expect(deriveFleetKbVerdict(snap, profiles).status).toBe('LEARNING');
    expect(profiles[0].note).toMatch(/KANIT DEĞİL/);
  });

  it('iki gözlemden sonra DOĞRULANMIŞ PROFİL VAR', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW);
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), [], NOW + 1000);
    const snap = readFleetKbLabSnapshot();
    expect(deriveFleetKbVerdict(snap, buildFleetKbProfiles(snap)).status).toBe('ESTABLISHED');
  });

  it('depo okunamazsa "profil yok" DEMEZ — HAFIZA OKUNAMADI der', () => {
    store.readThrows = true;
    const snap = readFleetKbLabSnapshot();
    /* Servis fail-soft olduğu için snapshot gelir ama hata alanı DOLU olmalı. */
    expect(snap.error).not.toBeNull();
    const fields = buildFleetKbFields(snap);
    expect(fields.find((f) => f.id === 'error')!.klass).toBe('STALE');
  });

  it('kayıt yoksa son öğrenme damgası null kalır — yaş HESAPLANMAZ', () => {
    const fields = buildFleetKbFields(readFleetKbLabSnapshot());
    expect(fields.find((f) => f.id === 'last-seen')!.updatedAt).toBeNull();
  });

  it('ekran çizilir ve ham VIN İÇERMEZ', () => {
    recordVehicleObservation(topo([ecu('7E0', '7E8')]), ['7E0'], NOW);
    const html = renderToStaticMarkup(<FleetKbScreen />);
    expect(html).toContain('FİLO HAFIZASI');
    expect(html).toContain('data-testid="fkb-profiles"');
    expect(html.includes(VIN), 'ham VIN ekrana sızdı').toBe(false);
  });

  it('her hükmün Türkçe etiketi vardır', () => {
    Object.values(FLEET_KB_VERDICT_LABEL).forEach((l) => expect(l.length).toBeGreaterThan(0));
  });
});
