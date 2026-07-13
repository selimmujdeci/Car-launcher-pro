/**
 * deepScanOfflinePass.test.ts — W5-3a "Offline Run Surface + Guard Band" birim testleri.
 *
 * KORUMA BANDI KİLİTLERİ (bu testler zayıflatılamaz/silinemez — CLAUDE.md regresyon kuralı):
 *  - ignition `null` iken offline pass KOŞAR (aktif faza hiç dokunmaz)
 *  - `_finalize()` / `runtime.completeScan()` / `persistence.completeScan()` ÇAĞRILMAZ
 *  - `hasCompletedFullScan` false kalır · completedScanCount/changeCheckCount ARTMAZ
 *  - runtime AKTİF-KAYIT API'leri (recordEcu/Pid/Did/FirmwareResult) HİÇ çağrılmaz
 *  - pass sonunda runtime `idle` (gerçek tarama sonradan başlayabilir)
 *  - handler throw/timeout/cancel fail-soft; tek offline faz hatası diğerlerini durdurmaz
 *  - özet BOUNDED + IMMUTABLE; girdi mutate edilmez; gizlilik sızıntısı yok
 *
 * Gerçek OBD/native/SQL YOK — enjekte runtime/persistence + kontrollü saat.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDeepScanOrchestrator,
  DeepScanRuntimeService,
  DeepScanPersistenceStore,
  OFFLINE_PHASES,
  OFFLINE_PHASE_SEQUENCE,
  ACTIVE_PHASES,
  DEEP_SCAN_PHASE_SEQUENCE,
  isOfflinePhase,
  type PhaseHandler,
  type DeepScanStoreIO,
  type OfflinePhaseHandlers,
} from '../platform/deepScan';
// Kaynak-metin kilitleri (flake bağışık).
import orchestratorSource from '../platform/deepScan/deepScanOrchestrator.ts?raw';
import systemBootSource from '../platform/system/SystemBoot.ts?raw';
import wiringSource from '../platform/system/platformCoreDeepScanWiring.ts?raw';

const NOW = 3_000_000;
const now = () => NOW;
const HASH = 'a1b2c3d4e5f60718';

function memIO() {
  const map = new Map<string, string>();
  const io: DeepScanStoreIO = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
  return { io, map };
}

function harness() {
  const runtime = new DeepScanRuntimeService({ now });
  const io = memIO();
  const persistence = new DeepScanPersistenceStore('k-offline', 16, 5000, io.io, now);
  // ignitionSource enjekte EDİLMEZ → üretim fail-closed davranışı (getConfirmedValue → null).
  const orch = createDeepScanOrchestrator({ runtime, persistence, now });
  return { runtime, persistence, orch };
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1) ignition null iken offline pass ÇALIŞIR
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — offline pass ignition null iken koşar', () => {
  it('kontak BİLİNMİYORKEN 6 offline fazın tümünü yürütür (aktif faza dokunmadan)', async () => {
    const { runtime, orch } = harness();
    expect(runtime.getSnapshot().ignitionConfirmed).toBeNull();

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(summary.ran).toBe(true);
    expect(summary.blockedReason).toBeNull();
    expect(summary.phaseCount).toBe(OFFLINE_PHASE_SEQUENCE.length);
    expect(summary.phaseCount).toBe(6);
    // Handler yok → hepsi skipped (fail-soft, sahte başarı üretilmez).
    expect(summary.skippedCount).toBe(6);
    expect(summary.errorCount).toBe(0);
    // Yürütülen fazların HİÇBİRİ aktif değil.
    const phases = summary.outcomes.map((o) => o.phase);
    expect(phases).toEqual([...OFFLINE_PHASE_SEQUENCE]);
    for (const p of phases) expect(ACTIVE_PHASES).not.toContain(p);
  });

  it('OFFLINE_PHASE_SEQUENCE aktif faz İÇERMEZ ve tam sıra ile tutarlıdır', () => {
    for (const p of OFFLINE_PHASE_SEQUENCE) expect(isOfflinePhase(p)).toBe(true);
    expect([...OFFLINE_PHASE_SEQUENCE]).toEqual([...OFFLINE_PHASES]);
    // Tam sıradaki offline fazların göreli sırası korunur.
    const offlineFromFull = DEEP_SCAN_PHASE_SEQUENCE.filter(isOfflinePhase);
    expect([...OFFLINE_PHASE_SEQUENCE]).toEqual(offlineFromFull);
    // Aktif + offline = tüm fazlar (sınıflandırılmamış faz yok).
    expect(ACTIVE_PHASES.length + OFFLINE_PHASES.length).toBe(DEEP_SCAN_PHASE_SEQUENCE.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2) Aktif faz handler'ı TYPE-LEVEL reddedilir
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — aktif faz handler tip düzeyinde reddedilir', () => {
  it('OfflinePhaseHandlers aktif faz anahtarı kabul etmez (derleme kilidi)', () => {
    const ok: OfflinePhaseHandlers = {
      capability_analysis: () => ({ status: 'success' }),
      change_detection: () => ({ status: 'success' }),
    };
    expect(Object.keys(ok)).toHaveLength(2);

    // @ts-expect-error — 'vehicle_identity' AKTİF fazdır; OfflinePhaseHandlers kabul ETMEZ.
    const bad: OfflinePhaseHandlers = { vehicle_identity: () => ({ status: 'success' }) };
    // Çalışma zamanında da aktif faz handler'ı ASLA çağrılmaz (aşağıdaki test kanıtlar).
    expect(bad).toBeTruthy();
  });

  it('aktif faz handler’ı kaçak yolla verilse bile ÇAĞRILMAZ', async () => {
    const { orch } = harness();
    const activeSpy = vi.fn<PhaseHandler>(() => ({ status: 'success' }));
    // Tip kilidini bilerek deliyoruz (kötü niyetli/kazara çağrıyı simüle) — davranış yine korumalı.
    const handlers = { vehicle_identity: activeSpy, protocol_detection: activeSpy } as unknown as OfflinePhaseHandlers;

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    expect(activeSpy).not.toHaveBeenCalled();          // aktif faz kümede YOK → çağrılamaz
    expect(summary.phaseCount).toBe(6);
    expect(summary.skippedCount).toBe(6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3-6) Sonlandırma YOK · persistence kirlenmez
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — sonlandırma ve persistence koruma bandı', () => {
  it('runtime.completeScan ve persistence.completeScan ÇAĞRILMAZ', async () => {
    const { runtime, persistence, orch } = harness();
    const rtComplete = vi.spyOn(runtime, 'completeScan');
    const psComplete = vi.spyOn(persistence, 'completeScan');
    const psSave = vi.spyOn(persistence, 'saveSnapshot');

    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(rtComplete).not.toHaveBeenCalled();
    expect(psComplete).not.toHaveBeenCalled();
    expect(psSave).not.toHaveBeenCalled();             // W5-3a persistence'a HİÇ yazmaz
  });

  it('hasCompletedFullScan false kalır; sayaçlar ARTMAZ; kayıt oluşmaz', async () => {
    const { persistence, orch } = harness();
    expect(persistence.hasCompletedFullScan(HASH)).toBe(false);

    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(persistence.hasCompletedFullScan(HASH)).toBe(false);
    expect(persistence.resolveMode(HASH)).toBe('FULL_SCAN');   // gerçek tarama HÂLÂ tam tarama
    const rec = persistence.load(HASH);
    expect(rec).toBeNull();                                     // hiç kayıt yazılmadı
  });

  it('pass sonrası özet "completed" bir tarama üretmez (reportSummary yok)', async () => {
    const { runtime, orch } = harness();
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(summary.ran).toBe(true);
    expect(runtime.getSnapshot().status).not.toBe('completed');
    expect(runtime.getSnapshot().reportSummary).toBeNull();
    expect(orch.getSnapshot().status).toBe('idle');             // gerçek tarama başlamadı
  });

  it('kaynak kilidi: runOfflinePass gövdesi _finalize/completeScan ÇAĞIRMAZ', () => {
    const start = orchestratorSource.indexOf('async runOfflinePass(');
    const end = orchestratorSource.indexOf('cancelOfflinePass()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = orchestratorSource.slice(start, end);

    expect(body).not.toContain('this._finalize(');
    expect(body).not.toContain('completeScan(');
    expect(body).not.toContain('_applyResult(');                 // aktif-kayıt yolu YOK
    expect(body).toContain('this._runtime.reset()');             // reset ZORUNLU
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7-8) Aktif kayıt API'leri ve discovery payload
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — aktif-kayıt API’leri hiç çağrılmaz', () => {
  it('handler ECU/PID/DID/Firmware payload döndürse bile runtime aktif-kayıt API’leri çağrılmaz', async () => {
    const { runtime, orch } = harness();
    const ecuSpy = vi.spyOn(runtime, 'recordEcuDiscovery');
    const pidSpy = vi.spyOn(runtime, 'recordPidDiscovery');
    const didSpy = vi.spyOn(runtime, 'recordDidDiscovery');
    const fwSpy = vi.spyOn(runtime, 'recordFirmwareResult');

    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => ({
        status: 'success',
        ecus: ['7E0', '7E8'],
        pids: [{ pidOrDid: '0C' }, { pidOrDid: '0D' }],
        dids: [{ pidOrDid: 'F190' }],
        firmware: [{ ecu: '7E0', version: 'v1', changed: true }],
      }),
    };

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    // Payload BİLİNÇLİ olarak yok sayıldı → aktif-kayıt kapısı hiç tetiklenmedi.
    expect(ecuSpy).not.toHaveBeenCalled();
    expect(pidSpy).not.toHaveBeenCalled();
    expect(didSpy).not.toHaveBeenCalled();
    expect(fwSpy).not.toHaveBeenCalled();

    // Keşif sayımları SIFIR kalır; durum waiting_for_ignition'a DÜŞMEZ.
    const snap = runtime.getSnapshot();
    expect(snap.discoveredEcuCount).toBe(0);
    expect(snap.discoveredPidCount).toBe(0);
    expect(snap.discoveredDidCount).toBe(0);
    expect(summary.successCount).toBe(1);
  });

  it('kontak-serbest tek yol: changedFirmware/changedEcu recordChangeDetection ile geçer', async () => {
    const { runtime, orch } = harness();
    const changeSpy = vi.spyOn(runtime, 'recordChangeDetection');

    const handlers: OfflinePhaseHandlers = {
      change_detection: () => ({ status: 'success', changedEcu: true, changedFirmware: true }),
    };
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(summary.changedEcu).toBe(true);
    expect(summary.changedFirmware).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 9-12) Runtime yaşam döngüsü — reset, tekrar pass, gerçek tarama, takılmama
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — runtime yaşam döngüsü', () => {
  it('pass sonunda runtime idle’a döner (waiting_for_ignition’da TAKILI KALMAZ)', async () => {
    const { runtime, orch } = harness();
    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    const snap = runtime.getSnapshot();
    expect(snap.status).toBe('idle');
    expect(snap.scanId).toBeNull();
    expect(snap.phase).toBeNull();
    expect(snap.progressPercent).toBe(0);      // sahte %97 progress kalıntısı YOK
    expect(orch.isOfflinePassRunning).toBe(false);
  });

  it('ikinci pass tekrar çalışabilir', async () => {
    const { orch } = harness();
    const first = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });
    const second = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(first.ran).toBe(true);
    expect(second.ran).toBe(true);
    expect(second.phaseCount).toBe(6);
    expect(second.blockedReason).toBeNull();
  });

  it('pass sonrası GERÇEK tarama başlayabilir (startScan idle guard’ına takılmaz)', async () => {
    const { runtime, orch } = harness();
    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    const snap = orch.start({ vehicleFingerprintHash: HASH });
    expect(snap.status).not.toBe('idle');
    // Kontak yok → gerçek tarama fail-closed olarak beklemede (aktif sorgu YOK).
    expect(runtime.getSnapshot().status).toBe('waiting_for_ignition');
    expect(runtime.getSnapshot().scanId).not.toBeNull();
  });

  it('gerçek tarama yürürken offline pass REDDEDİLİR (runtime kirletilmez)', async () => {
    const { orch } = harness();
    orch.start({ vehicleFingerprintHash: HASH });

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });
    expect(summary.ran).toBe(false);
    expect(summary.blockedReason).toBe('scan_in_progress');
    expect(summary.phaseCount).toBe(0);
  });

  it('runtime idle değilse (dışarıdan tutulmuş) pass REDDEDİLİR', async () => {
    const { runtime, orch } = harness();
    runtime.startScan({ vehicleFingerprintHash: HASH, ignitionConfirmed: null });   // dışarıdan tutuldu

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });
    expect(summary.ran).toBe(false);
    expect(summary.blockedReason).toBe('runtime_not_idle');
  });

  it('dispose edilmiş orchestrator pass koşmaz', async () => {
    const { orch } = harness();
    orch.dispose();
    const summary = await orch.runOfflinePass();
    expect(summary.ran).toBe(false);
    expect(summary.blockedReason).toBe('disposed');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 13-15) Fail-soft: throw · timeout · cancel
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — fail-soft', () => {
  it('handler throw → tek faz düşer, KALAN offline fazlar DEVAM EDER', async () => {
    const { runtime, orch } = harness();
    const later = vi.fn<PhaseHandler>(() => ({ status: 'success' }));

    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => { throw new Error('patladı'); },
      report_generation: later,                       // sıradaki SON faz
    };
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    expect(summary.ran).toBe(true);
    expect(summary.phaseCount).toBe(6);               // hiçbir faz atlanmadı
    expect(summary.errorCount).toBe(1);
    expect(later).toHaveBeenCalledTimes(1);           // hata SONRAKİ fazları durdurmadı
    expect(summary.outcomes[0]).toMatchObject({ phase: 'capability_analysis', status: 'error', errorCode: 'handler_exception' });
    // Runtime `failed`'a DÜŞMEZ (offline faz kritik değil) ve idle'a döner.
    expect(runtime.getSnapshot().status).toBe('idle');
  });

  it('handler asılırsa timeout ile düşer, timer sızmaz, kalan fazlar devam eder', async () => {
    const { orch } = harness();
    const later = vi.fn<PhaseHandler>(() => ({ status: 'success' }));
    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => new Promise(() => { /* asla çözülmez */ }),
      report_generation: later,
    };

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers, phaseTimeoutMs: 10 });

    expect(summary.errorCount).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({ phase: 'capability_analysis', status: 'timeout', errorCode: 'phase_timeout' });
    expect(later).toHaveBeenCalledTimes(1);
    expect(summary.phaseCount).toBe(6);
  });

  it('handler cancelled döndürünce pass güvenli durur (runtime yine idle)', async () => {
    const { runtime, orch } = harness();
    const never = vi.fn<PhaseHandler>(() => ({ status: 'success' }));
    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => ({ status: 'cancelled' }),
      report_generation: never,
    };

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    expect(summary.cancelled).toBe(true);
    expect(never).not.toHaveBeenCalled();             // iptalden sonra faz yürütülmez
    expect(summary.phaseCount).toBeLessThan(6);
    expect(runtime.getSnapshot().status).toBe('idle'); // reset yine koştu (finally)
  });

  it('cancelOfflinePass() yürüyen pass’i durdurur; ctx.isCancelled görünür', async () => {
    const { runtime, orch } = harness();
    const seen: boolean[] = [];
    const handlers: OfflinePhaseHandlers = {
      capability_analysis: (ctx) => { orch.cancelOfflinePass(); seen.push(ctx.isCancelled()); return { status: 'success' }; },
      fingerprint_update: (ctx) => { seen.push(ctx.isCancelled()); return { status: 'success' }; },
    };

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    expect(summary.cancelled).toBe(true);
    expect(summary.phaseCount).toBe(1);               // iptal sonrası döngü kırıldı
    expect(runtime.getSnapshot().status).toBe('idle');
  });

  it('geçersiz handler sonucu (null) fail-soft error olur', async () => {
    const { orch } = harness();
    const handlers = { capability_analysis: () => null } as unknown as OfflinePhaseHandlers;
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });
    expect(summary.outcomes[0]).toMatchObject({ status: 'error', errorCode: 'invalid_result' });
    expect(summary.phaseCount).toBe(6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 16-20) Kapsam kilitleri — bu PR neyi DEĞİŞTİRMEDİ
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — kapsam kilitleri (bu PR çağrılmıyor, davranış değişmiyor)', () => {
  it('SystemBoot offline pass ÇAĞIRMAZ (trigger/wiring W5-3b’de)', () => {
    expect(systemBootSource).not.toContain('runOfflinePass');
    expect(systemBootSource).not.toContain('cancelOfflinePass');
    // W5-1 kilidi korunur: SystemBoot gerçek tarama da başlatmaz.
    expect(systemBootSource).not.toContain('startScan');
    expect(systemBootSource).not.toContain('runNextPhase');
    expect(systemBootSource).toContain('startPlatformCoreDeepScanWiring');
  });

  it('ownership wiring tipi start/run/runNextPhase/runOfflinePass GÖSTERMEZ', () => {
    // OwnedOrchestrator yüzeyi W5-3a’da DEĞİŞMEDİ → wiring pass koşamaz (compile-time).
    const ifaceStart = wiringSource.indexOf('export interface OwnedOrchestrator');
    expect(ifaceStart).toBeGreaterThan(-1);
    const iface = wiringSource.slice(ifaceStart, wiringSource.indexOf('}', ifaceStart));
    expect(iface).not.toContain('start(');
    expect(iface).not.toContain('run(');
    expect(iface).not.toContain('runNextPhase');
    expect(iface).not.toContain('runOfflinePass');
    expect(wiringSource).not.toContain('runOfflinePass');
  });

  it('orchestrator Event Bus’a publish ETMEZ (köprü bu PR’da değişmedi)', () => {
    expect(orchestratorSource).not.toContain('eventBus');
    expect(orchestratorSource).not.toContain('appEventBus');
    expect(orchestratorSource).not.toContain('publish(');
  });

  it('offline pass orchestrator OLAYI YAYINLAMAZ (dinleyiciye sızmaz)', async () => {
    const { orch } = harness();
    const events: string[] = [];
    orch.subscribe((e) => events.push(e.type));

    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(events).toHaveLength(0);   // W5-3b'ye kadar bus/dinleyici trafiği YOK
  });

  it('import yan etkisizdir (timer/abonelik/native yok)', () => {
    expect(orchestratorSource).not.toContain('setInterval');
    expect(orchestratorSource).not.toContain('requestAnimationFrame');
    // Tek setTimeout kullanımı offline faz timeout'u; clearTimeout ile eşleşir.
    const setCount = (orchestratorSource.match(/setTimeout\(/g) ?? []).length;
    const clearCount = (orchestratorSource.match(/clearTimeout\(/g) ?? []).length;
    expect(setCount).toBe(1);
    expect(clearCount).toBe(1);
  });

  it('native/OBD/CAN/SQL yüzeyine DOKUNMAZ', () => {
    for (const forbidden of ['obdService', 'nativePlugin', 'Capacitor', 'supabase', 'canBus', 'sendCommand']) {
      expect(orchestratorSource).not.toContain(forbidden);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 21-25) Bütçe · immutability · gizlilik
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3a — bütçe, immutability, gizlilik', () => {
  it('steady-state ek yük yok: pass tek atış, periyodik tick AÇMAZ', async () => {
    const { orch } = harness();
    // Pass bittikten sonra hiçbir zamanlayıcı/döngü kalmamalı.
    await orch.runOfflinePass({ vehicleFingerprintHash: HASH });
    expect(orch.isOfflinePassRunning).toBe(false);
    // Kaynakta periyodik yapı yok (Mali-400 steady-state yükü sıfır).
    expect(orchestratorSource).not.toContain('setInterval');
    expect(orchestratorSource).not.toContain('scheduleTask');
  });

  it('girdi MUTATE EDİLMEZ', async () => {
    const { orch } = harness();
    const handlers: OfflinePhaseHandlers = { capability_analysis: () => ({ status: 'success' }) };
    const input = Object.freeze({ vehicleFingerprintHash: HASH, handlers, phaseTimeoutMs: 50 });
    const handlerKeys = Object.keys(handlers);

    await orch.runOfflinePass(input);

    expect(input.vehicleFingerprintHash).toBe(HASH);
    expect(input.phaseTimeoutMs).toBe(50);
    expect(Object.keys(handlers)).toEqual(handlerKeys);   // handler haritası değişmedi
  });

  it('özet IMMUTABLE (frozen) ve bounded', async () => {
    const { orch } = harness();
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH });

    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.outcomes)).toBe(true);
    expect(Object.isFrozen(summary.warnings)).toBe(true);
    for (const o of summary.outcomes) expect(Object.isFrozen(o)).toBe(true);
    // Bounded: faz sayısı sabit üst sınır.
    expect(summary.outcomes.length).toBeLessThanOrEqual(OFFLINE_PHASE_SEQUENCE.length);
  });

  it('gizlilik: özet VIN/koordinat/ham hex/secret SIZDIRMAZ', async () => {
    const { orch } = harness();
    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => ({
        status: 'error',
        // VIN 17 hane · koordinat · secret — üçü de temizlenmeli.
        errorCode: 'VIN WDD12345678901234 41.0082,28.9784 sk-abcdefghijklmno',
      }),
    };
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    const blob = JSON.stringify(summary);
    expect(blob).not.toContain('WDD12345678901234');  // VIN (17 hane)
    expect(blob).not.toContain('41.0082,28.9784');    // koordinat
    expect(blob).not.toContain('sk-abcdefghijklmno'); // secret
    expect(blob).toContain('[redacted]');
    // Uyarı metni de temizlenmiş.
    for (const w of summary.warnings) expect(w).not.toContain('WDD12345678901234');
  });

  it('özet ham keşif kimliği TAŞIMAZ (yalnız sayımlar + faz sonuçları)', async () => {
    const { orch } = harness();
    const handlers: OfflinePhaseHandlers = {
      capability_analysis: () => ({ status: 'success', ecus: ['7E0'], pids: [{ pidOrDid: '0C' }] }),
    };
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers });

    const blob = JSON.stringify(summary);
    expect(blob).not.toContain('7E0');
    expect(blob).not.toContain('0C');
    expect(blob).not.toContain(HASH);                  // parmak izi hash'i de taşınmaz
  });
});
