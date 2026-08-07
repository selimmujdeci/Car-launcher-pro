/**
 * maviVehicleContext.test.ts — MAVI-M2 · GERÇEK ARAÇ BAĞLAMI + FAIL-CLOSED SÜRÜŞ GÜVENLİĞİ.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 denetimi (kütük #146, bulgu #1) kanıtladı: `processTextCommand` üretimde HİÇ
 * `VehicleContext` almıyordu ve `useVoiceCommandHandler` sabit
 * `{ speedKmh: 0, isDriving: false }` yazıyordu → "veri yok" sessizce "araç park
 * halinde" sayılıyordu (fail-OPEN). Bu dosya o davranışın geri gelmesini KİLİTLER.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. `unknown` asla `false`a indirgenmez (hareket · geri vites · kontak).
 *  2. Hız bilinmiyorsa `speedKmh === null` — SIFIR YAZILMAZ.
 *  3. GPS "duruyor" KANITI ÜRETEMEZ (yalnız hareket kanıtı).
 *  4. Bayat telemetri hareket/durma kanıtı sayılmaz.
 *  5. Riskli araç eylemi (kapı açma) yalnız DOĞRULANMIŞ `stopped` ile geçer;
 *     `unknown` fail-closed'dur — ama `motionState` taşımayan ESKİ çağıranlar
 *     (uzak komut yolu) için sözleşme BİREBİR korunur.
 *  6. Üretim kaynaklarında "parked" güvenlik varsayımı yeniden eklenemez.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

vi.mock('../platform/navigationService', () => ({ startNavigation: vi.fn() }));
vi.mock('../platform/ttsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/ttsService')>();
  return { ...actual, speakFeedback: vi.fn(), speakAlert: vi.fn(), speakNavigation: vi.fn() };
});

import { speakFeedback } from '../platform/ttsService';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import {
  resolveMaviVehicleContext,
  unknownMaviVehicleContext,
  currentMaviVehicleContext,
  setMaviVehicleSnapshotSource,
  hasMaviVehicleSnapshotSource,
  _resetMaviVehicleContextForTest,
  MAVI_ACTIVE_DRIVING_KMH,
  type MaviVehicleSnapshot,
} from '../platform/assistant/maviVehicleContext';
import { WRITE_GATE_STOPPED_SPEED_KMH } from '../platform/obd/writeGate';
import { GPS_STALE_MS, GPS_WEAK_ACCURACY_M } from '../platform/vehicleStatusModel';

const speakFeedbackMock = vi.mocked(speakFeedback);

const NOW = 1_700_000_000_000;

/** Nötr snapshot — hiçbir kaynak kanıt vermiyor (gerçek "boş araç" hâli). */
function snap(over: Partial<MaviVehicleSnapshot> = {}): MaviVehicleSnapshot {
  return {
    obdSpeedFreshKmh: null,
    obdConnected:     false,
    obdLastSeenMs:    0,
    obdFreshWindowMs: 3_000,
    gpsSpeedMps:      null,
    gpsAccuracyM:     null,
    gpsFixAtMs:       null,
    reverseSignal:    false,
    ignition:         'unknown',
    ...over,
  };
}

/** CANLI + TAZE OBD oturumu (dataFresh=true üretir). */
function liveSnap(over: Partial<MaviVehicleSnapshot> = {}): MaviVehicleSnapshot {
  return snap({ obdConnected: true, obdLastSeenMs: NOW - 500, obdFreshWindowMs: 3_000, ...over });
}

/* ══════════════════════════════════════════════════════════════════════════
 * A — SAF RESOLVER
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M2 · resolveMaviVehicleContext — hareket hükmü', () => {
  it('1. taze OBD hızı > 0 → moving + isDriving=true', () => {
    const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 42 }), NOW);
    expect(c.motionState).toBe('moving');
    expect(c.isDriving).toBe(true);
    expect(c.speedKmh).toBe(42);
    expect(c.motionSource).toBe('obd_speed');
    expect(c.drivingMode).toBe('driving');   // 42 >= MAVI_ACTIVE_DRIVING_KMH
  });

  it('1b. taze OBD hızı düşük ama > eşik → moving, etiket "normal"', () => {
    const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: MAVI_ACTIVE_DRIVING_KMH - 1 }), NOW);
    expect(c.motionState).toBe('moving');
    expect(c.drivingMode).toBe('normal');
  });

  it('2. taze OBD hızı 0 → GÜVENİLİR park kanıtı: stopped + isDriving=false', () => {
    const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 0 }), NOW);
    expect(c.motionState).toBe('stopped');
    expect(c.isDriving).toBe(false);
    expect(c.speedKmh).toBe(0);
    expect(c.drivingMode).toBe('idle');
  });

  it('3. hız kaynağı yok → unknown; isDriving false\'a "park" anlamı YÜKLENMEZ', () => {
    const c = resolveMaviVehicleContext(snap(), NOW);
    expect(c.motionState).toBe('unknown');
    expect(c.speedKmh).toBeNull();            // SIFIR YAZILMAZ
    expect(c.motionSource).toBe('none');
    expect(c.isDriving).toBe(false);          // eski boolean sözleşme (yalnız doğrulanmış hareket true)
    expect(c.motionState).not.toBe('stopped');// "veri yok" ≠ "araç duruyor"
  });

  it('4. bayat telemetri → dataFresh=false; hız kaynağı yoksa unknown kalır', () => {
    const c = resolveMaviVehicleContext(
      snap({ obdConnected: true, obdLastSeenMs: NOW - 60_000, obdFreshWindowMs: 3_000 }),
      NOW,
    );
    expect(c.dataFresh).toBe(false);
    expect(c.motionState).toBe('unknown');
    expect(c.lastPacketAgeMs).toBe(60_000);
  });

  it('4b. saat geriye gittiyse (negatif yaş) veri TAZE SAYILMAZ', () => {
    const c = resolveMaviVehicleContext(
      snap({ obdConnected: true, obdLastSeenMs: NOW + 10_000, obdFreshWindowMs: 3_000 }),
      NOW,
    );
    expect(c.dataFresh).toBe(false);
    expect(c.lastPacketAgeMs).toBeNull();
  });

  it('5. NaN / Infinity / negatif / imkânsız hız → kanıt sayılmaz (unknown)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 5_000]) {
      const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: bad }), NOW);
      expect(c.motionState, `hız=${bad}`).toBe('unknown');
      expect(c.speedKmh, `hız=${bad}`).toBeNull();
      expect(c.isDriving, `hız=${bad}`).toBe(false);
    }
  });

  it('6. reverseSignal=true KORUNUR (kanıt taşınır)', () => {
    const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 0, reverseSignal: true }), NOW);
    expect(c.reverseActive).toBe(true);
  });

  it('7. geri vites bilgisi YOK → undefined (false\'a çevrilmez)', () => {
    const c = resolveMaviVehicleContext(snap(), NOW);
    expect(c.reverseActive).toBeUndefined();
  });

  it('7b. CANLI + TAZE kaynak varken reverse sinyali yoksa → false (gerçek kanıt)', () => {
    const c = resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 0 }), NOW);
    expect(c.reverseActive).toBe(false);
  });

  it('8. OBD bağlı ama veri bayat → hareket kanıtı SAYILMAZ', () => {
    const c = resolveMaviVehicleContext(
      snap({ obdConnected: true, obdLastSeenMs: NOW - 30_000, obdSpeedFreshKmh: null }),
      NOW,
    );
    expect(c.motionState).toBe('unknown');
    expect(c.dataFresh).toBe(false);
  });

  it('9. snapshot sonradan değişse bile çözülmüş bağlam DEĞİŞMEZ (immutable)', () => {
    const mutable = { ...snap({ obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: NOW - 100 }) };
    const c = resolveMaviVehicleContext(mutable, NOW);
    expect(c.motionState).toBe('stopped');
    (mutable as { obdSpeedFreshKmh: number | null }).obdSpeedFreshKmh = 120;   // sonradan mutasyon
    expect(c.motionState).toBe('stopped');       // karar kaymaz
    expect(Object.isFrozen(c)).toBe(true);       // tüketici de değiştiremez
  });
});

describe('MAVI-M2 · GPS Doppler — YALNIZ hareket kanıtı', () => {
  it('taze + doğru GPS fix, hız > eşik → moving (OBD yokken)', () => {
    const c = resolveMaviVehicleContext(
      snap({ gpsSpeedMps: 20, gpsAccuracyM: 8, gpsFixAtMs: NOW - 1_000 }),
      NOW,
    );
    expect(c.motionState).toBe('moving');
    expect(c.motionSource).toBe('gps_doppler');
    expect(c.speedKmh).toBeCloseTo(72, 5);
  });

  it('GPS hızı 0 → "duruyor" DEMEZ, unknown kalır (hayalet/drift koruması)', () => {
    const c = resolveMaviVehicleContext(
      snap({ gpsSpeedMps: 0, gpsAccuracyM: 5, gpsFixAtMs: NOW - 1_000 }),
      NOW,
    );
    expect(c.motionState).toBe('unknown');
    expect(c.motionState).not.toBe('stopped');
    expect(c.speedKmh).toBeNull();
  });

  it('bayat GPS fix (> GPS_STALE_MS) → kanıt sayılmaz', () => {
    const c = resolveMaviVehicleContext(
      snap({ gpsSpeedMps: 30, gpsAccuracyM: 5, gpsFixAtMs: NOW - (GPS_STALE_MS + 1) }),
      NOW,
    );
    expect(c.motionState).toBe('unknown');
  });

  it('zayıf doğruluk (> GPS_WEAK_ACCURACY_M) → kanıt sayılmaz', () => {
    const c = resolveMaviVehicleContext(
      snap({ gpsSpeedMps: 30, gpsAccuracyM: GPS_WEAK_ACCURACY_M + 1, gpsFixAtMs: NOW - 500 }),
      NOW,
    );
    expect(c.motionState).toBe('unknown');
  });

  it('OBD hızı VARSA GPS kullanılmaz (kaynak önceliği)', () => {
    const c = resolveMaviVehicleContext(
      liveSnap({ obdSpeedFreshKmh: 0, gpsSpeedMps: 30, gpsAccuracyM: 5, gpsFixAtMs: NOW - 500 }),
      NOW,
    );
    expect(c.motionSource).toBe('obd_speed');
    expect(c.motionState).toBe('stopped');
  });
});

describe('MAVI-M2 · kontak (üç durumlu)', () => {
  it("ignition 'on' → true · 'off' → false · 'unknown' → undefined", () => {
    expect(resolveMaviVehicleContext(snap({ ignition: 'on' }), NOW).ignitionOn).toBe(true);
    expect(resolveMaviVehicleContext(snap({ ignition: 'off' }), NOW).ignitionOn).toBe(false);
    expect(resolveMaviVehicleContext(snap({ ignition: 'unknown' }), NOW).ignitionOn).toBeUndefined();
  });
});

describe('MAVI-M2 · kaynak kaydı (DI)', () => {
  it('kaynak KAYITLI DEĞİLKEN currentMaviVehicleContext → unknown (parked DEĞİL)', () => {
    _resetMaviVehicleContextForTest();
    expect(hasMaviVehicleSnapshotSource()).toBe(false);
    const c = currentMaviVehicleContext(NOW);
    expect(c.motionState).toBe('unknown');
    expect(c.speedKmh).toBeNull();
  });

  it('kaynak THROW ederse → unknown (fail-closed, akış kırılmaz)', () => {
    setMaviVehicleSnapshotSource(() => { throw new Error('kaynak düştü'); });
    const c = currentMaviVehicleContext(NOW);
    expect(c.motionState).toBe('unknown');
    _resetMaviVehicleContextForTest();
  });

  it('kayıtlı kaynak resolver\'a taşınır', () => {
    setMaviVehicleSnapshotSource(() => liveSnap({ obdSpeedFreshKmh: 80 }));
    const c = currentMaviVehicleContext(NOW);
    expect(c.motionState).toBe('moving');
    expect(c.speedKmh).toBe(80);
    _resetMaviVehicleContextForTest();
  });

  it('unknownMaviVehicleContext() bir "park" bağlamı DEĞİLDİR', () => {
    const c = unknownMaviVehicleContext(NOW);
    expect(c.motionState).toBe('unknown');
    expect(c.drivingMode).not.toBe('idle');
    expect(c.speedKmh).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — FAIL-CLOSED DAVRANIŞ (commandExecutor)
 * ════════════════════════════════════════════════════════════════════════ */

function cmdCtx(vehicleCtx: CommandContext['vehicleCtx'], over: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx,
    defaultNav: 'maps',
    defaultMusic: 'spotify',
    launch: vi.fn(),
    /* P0-GÖREV-3: donanım eylemleri açık onay ister. Bu dosya ONAY kapısını değil
       HAREKET matrisini ölçer → onay verilmiş kabul edilir (onay kilitleri
       `hardwareConfirmationGate.test.ts` içindedir). */
    actionConfirmed: true,
    hwUnlockDoors: vi.fn(async () => ({ status: 'completed' as const })),
    ...over,
  } as CommandContext;
}

describe('MAVI-M2 · HARDWARE_UNLOCK fail-closed matrisi', () => {
  it('14. sürüşte uzun cevap ISO 15008 ile ≤8 kelimeye KISALIR (isDriving artık gerçek)', async () => {
    speakFeedbackMock.mockClear();
    const ctx = cmdCtx(resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 90 }), NOW));
    await executeIntent(
      { type: 'NAVIGATE_ADDRESS', payload: { destination: 'Atatürk Bulvarı numara yüz yirmi üç Çankaya Ankara' }, priority: 'normal' },
      ctx,
    );
    const spoken = speakFeedbackMock.mock.calls.map((c) => String(c[0]));
    expect(spoken.length).toBeGreaterThan(0);
    for (const s of spoken) expect(s.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('15. HAREKET doğrulandı → kapı açma ENGELLENİR', async () => {
    const unlock = vi.fn(async () => ({ status: 'completed' as const }));
    const ctx = cmdCtx(resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 50 }), NOW), { hwUnlockDoors: unlock });
    await executeIntent({ type: 'HARDWARE_UNLOCK', payload: {}, priority: 'high' }, ctx);
    expect(unlock).not.toHaveBeenCalled();
  });

  it('16. UNKNOWN → kapı açma FAIL-CLOSED (eski davranışta AÇILIYORDU)', async () => {
    const unlock = vi.fn(async () => ({ status: 'completed' as const }));
    const ctx = cmdCtx(unknownMaviVehicleContext(NOW), { hwUnlockDoors: unlock });
    await executeIntent({ type: 'HARDWARE_UNLOCK', payload: {}, priority: 'high' }, ctx);
    expect(unlock).not.toHaveBeenCalled();
  });

  it('17. DOĞRULANMIŞ park → kapı açma İZİNLİ (meşru davranış korunur)', async () => {
    const unlock = vi.fn(async () => ({ status: 'completed' as const }));
    const ctx = cmdCtx(resolveMaviVehicleContext(liveSnap({ obdSpeedFreshKmh: 0 }), NOW), { hwUnlockDoors: unlock });
    await executeIntent({ type: 'HARDWARE_UNLOCK', payload: {}, priority: 'high' }, ctx);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('🔒 motionState TAŞIMAYAN eski bağlam artık FAIL-CLOSED (kilit güncellendi)', async () => {
    /* ⚠️ BİLİNÇLİ DAVRANIŞ DEĞİŞİKLİĞİ (P0-GÖREV-3). Bu kilit eskiden ters yönü
       koruyordu: `motionState` üretmeyen ESKİ çağıran (uzak komut yolu) için
       `isDriving:false` "duruyor" sayılıyor ve kapı açma İZİN ALIYORDU. Yani
       hiç telemetri olmayan bir araçta uzaktan kapı açılabiliyordu.
       Yeni sözleşme: YALNIZ doğrulanmış `stopped` geçer — "bilinmiyorsa duruyor
       varsayma". Kilit kaldırılmadı, YENİ DOĞRU DAVRANIŞA güncellendi. */
    const unlock = vi.fn(async () => ({ status: 'completed' as const }));
    const legacyParked = { speedKmh: 0, drivingMode: 'idle' as const, isDriving: false };
    const r = await executeIntent(
      { type: 'HARDWARE_UNLOCK', payload: {}, priority: 'high' },
      cmdCtx(legacyParked, { hwUnlockDoors: unlock }),
    );
    expect(unlock).not.toHaveBeenCalled();
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('motion_unverified');

    const unlock2 = vi.fn(async () => ({ status: 'completed' as const }));
    const legacyDriving = { speedKmh: 60, drivingMode: 'driving' as const, isDriving: true };
    await executeIntent(
      { type: 'HARDWARE_UNLOCK', payload: {}, priority: 'high' },
      cmdCtx(legacyDriving, { hwUnlockDoors: unlock2 }),
    );
    expect(unlock2).not.toHaveBeenCalled();
  });

  it('durma eşiği MEVCUT WriteGate sabitiyle AYNI (paralel eşik üretilmedi)', () => {
    const justBelow = resolveMaviVehicleContext(
      liveSnap({ obdSpeedFreshKmh: WRITE_GATE_STOPPED_SPEED_KMH - 0.5 }), NOW,
    );
    const atThreshold = resolveMaviVehicleContext(
      liveSnap({ obdSpeedFreshKmh: WRITE_GATE_STOPPED_SPEED_KMH }), NOW,
    );
    expect(justBelow.motionState).toBe('stopped');
    expect(atThreshold.motionState).toBe('moving');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — GUARD: "parked varsayımı" geri gelemez
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = join(process.cwd(), 'src');

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;   // test fixture'ları serbest
      collectSources(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const PROD_SOURCES = collectSources(SRC);
const rel = (abs: string): string => relative(SRC, abs).split(sep).join('/');

/** Yorumları çıkarır — kilit YALNIZ gerçek koda bakar (belge metni suç değildir). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('MAVI-M2 · guard — üretimde "parked" güvenlik varsayımı yasak', () => {
  it('18. hiçbir üretim dosyası `speedKmh: 0` + `isDriving: false` sabit varsayımı ÜRETMEZ', () => {
    const offenders: string[] = [];
    for (const file of PROD_SOURCES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      // Aynı dosyada hem sıfır hız hem "sürüşte değil" iddiası = parked varsayımı.
      if (/speedKmh:\s*0\b/.test(src) && /isDriving:\s*false/.test(src)) offenders.push(rel(file));
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('18b. `useVoiceCommandHandler` artık kendi bağlam varsayımını üretmez', () => {
    const src = stripComments(readFileSync(join(SRC, 'hooks', 'useVoiceCommandHandler.ts'), 'utf8'));
    expect(src).not.toMatch(/drivingMode:\s*'idle'/);
    expect(src).toMatch(/unknownMaviVehicleContext\(\)/);
  });

  it('19. `processTextCommand` bağlamı KENDİ İÇİNDE çözer (çağıranlar parked default üretemez)', () => {
    const src = readFileSync(join(SRC, 'platform', 'voiceService.ts'), 'utf8');
    expect(src).toMatch(/currentMaviVehicleContext\(\)/);
    expect(src).toMatch(/unknownMaviVehicleContext\(\)/);
    // Bağlam bir kez çözülür; modülde mutable "son bağlam" alanı TUTULMAZ.
    expect(src).not.toMatch(/let\s+_lastVehicleContext/);
    expect(src).not.toMatch(/_currentVehicleContext\s*=/);
  });

  it('20. saf resolver katmanı global mutable bağlam TUTMAZ', () => {
    const src = readFileSync(join(SRC, 'platform', 'assistant', 'maviVehicleContext.ts'), 'utf8');
    expect(src).not.toMatch(/let\s+_context/);
    expect(src).not.toMatch(/let\s+_lastContext/);
    // Yalnız DI kaynağı tutulur (fonksiyon referansı — bağlam değeri DEĞİL).
    expect(src).toMatch(/let _source: MaviVehicleSnapshotSource \| null = null;/);
  });

  it('21. composition root canlı kaynağı kaydeder ve dispose\'da söker', () => {
    const src = readFileSync(join(SRC, 'platform', 'system', 'platformCoreMaviVoiceWiring.ts'), 'utf8');
    expect(src).toMatch(/setMaviVehicleSnapshotSource\(captureMaviVehicleSnapshot\)/);
    expect(src).toMatch(/setMaviVehicleSnapshotSource\(null\)/);
  });

  it('22. saf resolver modülü AĞIR servis import ETMEZ (voiceService grafiği kirlenmesin)', () => {
    const src = readFileSync(join(SRC, 'platform', 'assistant', 'maviVehicleContext.ts'), 'utf8');
    for (const heavy of ['obdService', 'UnifiedVehicleStore', 'deepScanIgnitionSource', 'useSystemStore']) {
      const re = new RegExp(`(?<!import type .*)from '[^']*${heavy}'`);
      expect(re.test(src), `${heavy} saf katmana statik import EDİLEMEZ`).toBe(false);
    }
  });
});
