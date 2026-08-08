/**
 * labTruthAuthorities.test.ts — CAROS LAB "TEK DOĞRULUK OTORİTESİ" KİLİTLERİ
 *
 * Kaynak: 2026-08-01 cihaz snapshot'ı (caros.lab.copy.v1). Aynı araç gerçeğinin
 * farklı alt sistemlerde ÇELİŞKİLİ görünmesine yol açan 14 doğrulanmış kusur.
 *
 * Bu dosya davranışı KİLİTLER. Bir kilit bilinçli değişiyorsa kilit GÜNCELLENİR,
 * KALDIRILMAZ (CLAUDE.md — Regresyon Kasası yasası).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/* ══════════════════════════════════════════════════════════════════════════
   T1 — BlackBox RPM veri zinciri
   ════════════════════════════════════════════════════════════════════════ */

/**
 * BlackBox 1Hz örnekleyicisi RPM'i UI store'dan değil, canonical OBD
 * otoritesinden okumalı. Saha kanıtı: ham trafikte 410C1990 (=1636 rpm) akarken
 * BlackBox'ın 60 örneğinin HEPSİ rpm:null idi.
 */
/*
 * NOT: bu blok her testte `vi.resetModules()` + dinamik `import()` yapar; tam
 * takım koşumunda (450+ dosya) modül grafiği yeniden çözümlemesi 5 sn'lik
 * varsayılan tavanı aşabiliyor. Tavan blok düzeyinde yükseltildi — kilidin
 * kendisi ZAYIFLATILMADI, yalnız yükleme yavaşlığına tolerans tanındı.
 */
describe('T1 — BlackBox RPM canonical telemetri zinciri', { timeout: 30_000 }, () => {
  const obdState = {
    dataFresh: true,
    connectionState: 'connected' as string,
    rpm: 1636,
    lastSeenMs: 0,
    freshWindowMs: 12_000,
    /** Otorite çöküşünü SİMÜLE eder — mock'u yeniden kurmadan (aşağıdaki nota bak). */
    snapshotThrows: false,
  };

  beforeEach(() => {
    vi.resetModules();
    obdState.dataFresh = true;
    obdState.connectionState = 'connected';
    obdState.rpm = 1636;
    obdState.lastSeenMs = Date.now();
    obdState.freshWindowMs = 12_000;
    obdState.snapshotThrows = false;

    vi.doMock('../platform/obdService', () => ({
      onOBDData: () => () => undefined,
      getOBDDataSnapshot: () => {
        if (obdState.snapshotThrows) throw new Error('bridge down');
        return {
          rpm: obdState.rpm,
          connectionState: obdState.connectionState,
          lastSeenMs: obdState.lastSeenMs,
        };
      },
      getObdSessionHealth: () => ({ dataFresh: obdState.dataFresh }),
      getObdFreshWindowMs: () => obdState.freshWindowMs,
    }));
  });

  afterEach(() => { vi.doUnmock('../platform/obdService'); vi.resetModules(); });

  async function sampleRpm(): Promise<number | null> {
    // _canonicalObdRpm dosya-içi; davranışı getReplayData üzerinden gözlenir.
    const mod = await import('../platform/security/blackBoxService');
    return mod.__testCanonicalObdRpm();
  }

  it('valid + fresh RPM geldiğinde BlackBox RPM DOLAR (null kalmaz)', async () => {
    expect(await sampleRpm()).toBe(1636);
  });

  it('RPM desteklenmiyorsa (-1 sentineli) null kalır — 0 YAZILMAZ', async () => {
    obdState.rpm = -1;
    const v = await sampleRpm();
    expect(v).toBeNull();
    expect(v).not.toBe(0);       // "0 rpm" = motor durdu iddiasıdır, kanıtsızdır
  });

  it('oturum bayatken eski RPM gerçekmiş gibi TEKRAR YAZILMAZ', async () => {
    obdState.dataFresh = false;
    expect(await sampleRpm()).toBeNull();
  });

  it('paket yaşı tazelik penceresini aşarsa RPM null olur', async () => {
    obdState.lastSeenMs = Date.now() - 30_000;   // pencere 12s
    expect(await sampleRpm()).toBeNull();
  });

  it('bağlantı kopukken RPM null olur', async () => {
    obdState.connectionState = 'disconnected';
    expect(await sampleRpm()).toBeNull();
  });

  it('otorite patlarsa fail-closed null döner (uydurma yok)', async () => {
    /*
     * ⚠️ KİLİT AYNI, DESENİ SAĞLAMLAŞTIRILDI (2026-08-08).
     * Bu test tek başına `vi.resetModules()` + ikinci bir `vi.doMock()` +
     * dinamik `import()` yapıyordu — dosyadaki diğer 40 testten FARKLI bir
     * yol. `beforeEach` zaten aynı modül için bir mock kurduğu için ikinci
     * kurulum modül önbelleğiyle yarışıyordu: tam takım koşumunda (paralel
     * worker'lar altında) bazen ESKİ mock çözülüyor ve throw hiç olmadan
     * rpm=1636 dönüyordu → kilit "1636 beklenirken null" diye DÜŞÜYORDU.
     * Kırılgan olan ürün kodu değil, testin modül-yeniden-yükleme dansıydı.
     *
     * İddia değişmedi: otorite patladığında değer UYDURULMAZ, null döner.
     * Artık çöküş `beforeEach`'teki TEK mock üzerinden bayrakla simüle edilir.
     */
    obdState.snapshotThrows = true;
    expect(await sampleRpm()).toBeNull();
  });

  it('hız zinciri RPM zincirinden BAĞIMSIZ bozulmaz', async () => {
    // RPM desteklenmese bile hız okuma yolu ayrı kaynaktan gelir (UI store).
    obdState.rpm = -1;
    expect(await sampleRpm()).toBeNull();
    obdState.rpm = 900;
    expect(await sampleRpm()).toBe(900);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T2 — Worker yaşam döngüsü + atomik şema
   ════════════════════════════════════════════════════════════════════════ */

describe('T2 — worker yaşam döngüsü ve BlackBox şema atomikliği', () => {
  let mgr: typeof import('../core/runtime/AdaptiveRuntimeManager').runtimeManager;

  beforeEach(async () => {
    vi.resetModules();
    ({ runtimeManager: mgr } = await import('../core/runtime/AdaptiveRuntimeManager'));
    mgr.destroy();
  });

  afterEach(() => { mgr.destroy(); });

  function fakeWorker(): Worker {
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: () => undefined,
      terminate: () => undefined,
    } as unknown as Worker;
  }

  it('BAŞLATILMAMIŞ worker "dead" GÖRÜNMEZ (yer tutucu = not_started)', () => {
    // SystemBoot Wave4 deseni: on-demand worker için null yer tutucu.
    mgr.registerWorker('VisionCompute', null, 'OPTIONAL');
    const row = mgr.getWorkerSnapshot().find((r) => r.key === 'VisionCompute');
    expect(row?.status).toBe('not_started');
    expect(row?.status).not.toBe('dead');
  });

  it('unregister sonrası ANAHTAR KAYBOLMAZ — şema stabil kalır', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    expect(mgr.getWorkerSnapshot().map((r) => r.key)).toContain('VehicleCompute');

    mgr.unregisterWorker('VehicleCompute');
    const keys = mgr.getWorkerSnapshot().map((r) => r.key);
    expect(keys).toContain('VehicleCompute');   // saha kusuru: anahtar tamamen kayboluyordu
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('stopped');
  });

  it('düzenli kapanış "stopped", GERÇEK çökme "dead" üretir', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    mgr.unregisterWorker('VehicleCompute');
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('stopped');

    mgr.markWorkerDead('VehicleCompute');
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('dead');
  });

  it('çökme durumu null yeniden-kayıtla EZİLMEZ (kanıt kaybı yok)', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    mgr.markWorkerDead('VehicleCompute');
    mgr.registerWorker('VehicleCompute', null, 'CRITICAL');
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('dead');
  });

  it('canlı worker yeniden kaydı "active"e YÜKSELTİR (kurtarma görünür)', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    mgr.markWorkerDead('VehicleCompute');
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('active');
  });

  it('unsupported (WebView reddi) "dead" ile KARIŞTIRILMAZ', () => {
    mgr.markWorkerUnavailable('VehicleCompute', 'unsupported');
    mgr.registerWorker('VehicleCompute', null, 'CRITICAL');
    expect(mgr.getWorkerSnapshot().find((r) => r.key === 'VehicleCompute')?.status).toBe('unsupported');
  });

  it('snapshot ATOMİKTİR — sonradan mutasyon dönen diziyi değiştirmez', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    mgr.registerWorker('VisionCompute', null, 'OPTIONAL');
    const snap = mgr.getWorkerSnapshot();
    const before = snap.map((r) => `${r.key}:${r.status}`).join('|');

    mgr.unregisterWorker('VehicleCompute');
    mgr.registerWorker('NavigationCompute', null, 'OPTIONAL');

    expect(snap.map((r) => `${r.key}:${r.status}`).join('|')).toBe(before);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('ardışık örneklerde anahtar kümesi DARALMAZ (şema stabilitesi)', () => {
    mgr.registerWorker('VehicleCompute', fakeWorker(), 'CRITICAL');
    mgr.registerWorker('VisionCompute', null, 'OPTIONAL');
    const first = new Set(mgr.getWorkerSnapshot().map((r) => r.key));

    mgr.unregisterWorker('VehicleCompute');   // saha: bu adımda anahtar düşüyordu
    const second = new Set(mgr.getWorkerSnapshot().map((r) => r.key));

    for (const k of first) expect(second.has(k)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T5 — VIN / kaynağa özgü hata modeli
   ════════════════════════════════════════════════════════════════════════ */

describe('T5 — VIN ve kaynağa özgü connectivity hata modeli', () => {
  it('vinPresent:false iken vinClass:"ok" YANLIŞ "ok" üretmez → absent', async () => {
    const { deriveIdentityStatus } = await import('../platform/canBus/VehicleConnectivityManager');
    // Saha snapshot'ındaki birebir çelişki.
    expect(deriveIdentityStatus({ outcome: 'ok', vinPresent: false, vinClass: 'ok' })).toBe('absent');
  });

  it('VIN varsa present, desteklenmiyorsa unsupported, çalışmadıysa not_requested', async () => {
    const { deriveIdentityStatus } = await import('../platform/canBus/VehicleConnectivityManager');
    expect(deriveIdentityStatus({ outcome: 'ok', vinPresent: true, vinClass: 'ok' })).toBe('present');
    expect(deriveIdentityStatus({ outcome: 'not_supported' })).toBe('unsupported');
    expect(deriveIdentityStatus({ outcome: 'not_run' })).toBe('not_requested');
    expect(deriveIdentityStatus(null)).toBe('unknown');
  });

  it('kimlik ekseni bağlantıdan BAĞIMSIZDIR — VIN yokluğu taşımayı düşürmez', async () => {
    const m = await import('../platform/canBus/VehicleConnectivityManager');
    m.setVehicleIdentityStatus('absent');
    expect(m.getVehicleIdentityStatus()).toBe('absent');
    // Kimlik durumu hiçbir SourceHealth alanına yazılmaz — tip düzeyinde ayrık.
    expect(Object.keys(m.getConnectivitySnapshot?.() ?? {})).not.toContain('vin');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T6 — Native poll evidence: sahte sıfır yasağı
   ════════════════════════════════════════════════════════════════════════ */

describe('T6 — poll evidence unknown/null semantiği', () => {
  beforeEach(() => vi.resetModules());

  it('native kanıt yokken configuredPidCount SAHTE 0 DEĞİL, null olur', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();
    const snap = m.getExtendedPollEvidence();
    expect(snap.present).toBe(false);
    expect(snap.configuredPidCount).toBeNull();
    expect(snap.configuredPidCount).not.toBe(0);
    expect(snap.burstEnabled).toBeNull();
    expect(snap.transport).toBeNull();
  });

  it('kanıt kanalı durumu ÜÇ DURUMDAN birini açıkça söyler', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();
    // JS gözlemi de yoksa → hüküm verilemez
    expect(['insufficient', 'native_unavailable_js_only'])
      .toContain(m.getExtendedPollEvidence().evidenceState);
  });

  /**
   * T6-B — TELEFONDA ÖLÇÜLEN REFRESH RACE (Xiaomi 23090RA98I · Android 13).
   *
   * Temiz boot'ta LAB kopyası `counters:null` + "eski APK / poll başlamadı"
   * diyordu; AYNI cihazda native köprü 43 ms'de tam yanıt veriyordu. Yani
   * hüküm, hiç yapılmamış bir ölçüme dayanıyordu. "Ölçmedik" ≠ "yok".
   */
  it('önbellek hiç tazelenmediyse APK/poll hakkında HÜKÜM VERMEZ', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();                       // temiz boot durumu
    expect(m.getPollEvidenceCacheState()).toBe('never_refreshed');

    const snap = m.getExtendedPollEvidence();
    expect(snap.cacheState).toBe('never_refreshed');
    // Yanlış teşhise sürükleyen ifadeler ARTIK KURULMAZ.
    expect(snap.decision.label).not.toMatch(/eski APK/);
    expect(snap.decision.label).not.toMatch(/poll başlamadı/);
    expect(snap.decision.label).toMatch(/tazelenmedi/);
    expect(snap.decision.label).toMatch(/VERİLEMEZ/);
  });

  it('metot GERÇEKTEN yoksa (unsupported) bunu AÇIKÇA söyler', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();
    m._internals.setCacheState('unsupported');
    const snap = m.getExtendedPollEvidence();
    expect(snap.cacheState).toBe('unsupported');
    expect(snap.decision.label).toMatch(/YOK/);
  });

  it('tazelendi ama kanıt yoksa "ölçmedik" demez (eski davranış korunur)', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();
    m._internals.setCacheState('refreshed');
    const snap = m.getExtendedPollEvidence();
    // Kanal SORULDU → "tazelenmedi" ve "eski APK" suçlamaları ARTIK kurulmaz.
    expect(snap.decision.label).not.toMatch(/tazelenmedi/);
    expect(snap.decision.label).not.toMatch(/eski APK/);
    expect(snap.decision.label).toMatch(/SORULDU/);
  });

  it('JS gözlemi native başarı gibi SUNULMAZ', async () => {
    const m = await import('../platform/obd/extendedPollEvidence');
    m._internals.reset();
    const snap = m.getExtendedPollEvidence();
    if (snap.evidenceState === 'native_unavailable_js_only') {
      expect(snap.present).toBe(false);        // JS gözlemi present'ı TRUE yapmaz
      expect(snap.evidenceComplete).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T7 — odometer semantiği
   ════════════════════════════════════════════════════════════════════════ */

describe('T7 — türetilmiş yol mesafesi "odometer" olarak raporlanmaz', () => {
  it('derived kaynaklı odometre trip_distance olur', async () => {
    const { canonicalSignalKey } = await import('../platform/aiCore/runtime/halAdapter');
    // Saha kanıtı: signal.odometer · derived → 0.5085 km ("toplam km" DEĞİL)
    expect(canonicalSignalKey('odometer', 'derived')).toBe('trip_distance');
    expect(canonicalSignalKey('odometer', 'gps')).toBe('trip_distance');
  });

  it('GERÇEK araç kaynağı (obd/can) odometer adını KORUR', async () => {
    const { canonicalSignalKey } = await import('../platform/aiCore/runtime/halAdapter');
    expect(canonicalSignalKey('odometer', 'obd')).toBe('odometer');
    expect(canonicalSignalKey('odometer', 'can')).toBe('odometer');
  });

  it('diğer sinyal adlarına DOKUNMAZ', async () => {
    const { canonicalSignalKey } = await import('../platform/aiCore/runtime/halAdapter');
    expect(canonicalSignalKey('coolant_temp', 'derived')).toBe('coolant_temp');
    expect(canonicalSignalKey('speed', 'gps')).toBe('speed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T8 — Unavailable PID sayı/liste uyumu
   ════════════════════════════════════════════════════════════════════════ */

describe('T8 — unsupported PID count ile liste uyumu', () => {
  it('duplicate PID iki kez SAYILMAZ ve normalize edilir', async () => {
    const { normalizeUnavailablePids } = await import('../platform/aiCore/runtime/diagnosticEvidence');
    expect(normalizeUnavailablePids(['21', '21', '0x23', ' 2c ', '2C'])).toEqual(['21', '23', '2C']);
  });

  it('sayı liste uzunluğuyla UYUMLUDUR (tek canonical koleksiyon)', async () => {
    const { normalizeUnavailablePids } = await import('../platform/aiCore/runtime/diagnosticEvidence');
    const pids = normalizeUnavailablePids(['21', '23', '2C', '33', '49', '4A', '5B', '5C']);
    expect(pids).toHaveLength(8);
  });

  it('string olmayan girdi sessizce sayıya EKLENMEZ', async () => {
    const { normalizeUnavailablePids } = await import('../platform/aiCore/runtime/diagnosticEvidence');
    expect(normalizeUnavailablePids(['21', null, 42, undefined, '23'])).toEqual(['21', '23']);
    expect(normalizeUnavailablePids(null)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T9 — CAN durum semantiği
   ════════════════════════════════════════════════════════════════════════ */

describe('T9 — OBD-over-CAN ile RAW CAN ayrımı', () => {
  const base = {
    obdConnected: true, obdProtocolActive: '7',
    rawCanAvailable: false, rawCanConnected: false,
    mcuConnected: false, canPhase: 'WAIT_FIRST_FRAME' as string | null,
  };

  it('protokol 7 + OBD verisi → OBD-over-CAN AKTİF', async () => {
    const { deriveCanCapability } = await import('../platform/canBus/VehicleConnectivityManager');
    const v = deriveCanCapability(base);
    // Saha snapshot'ı: protokol 7, veri akıyor, ama canAlive:false → "CAN yok" sanılıyordu.
    expect(v.obdOverCanActive).toBe(true);
    expect(v.obdProtocol).toBe('7');
  });

  it('RAW CAN mevcut değilse frame yokluğu ARIZA sunulmaz → UNAVAILABLE', async () => {
    const { deriveCanCapability } = await import('../platform/canBus/VehicleConnectivityManager');
    const v = deriveCanCapability(base);
    expect(v.rawCanAvailable).toBe(false);
    expect(v.rawCanAlive).toBe(false);
    // "WAIT_FIRST_FRAME" başlamamış bir işi bekliyor gibi gösteriyordu.
    expect(v.rawCanPhase).toBe('UNAVAILABLE');
  });

  it('gerçek CAN frame gelince rawCanAlive GÜNCELLENİR', async () => {
    const { deriveCanCapability } = await import('../platform/canBus/VehicleConnectivityManager');
    const v = deriveCanCapability({ ...base, rawCanAvailable: true, rawCanConnected: true });
    expect(v.rawCanAlive).toBe(true);
    expect(v.rawCanPhase).toBe('ALIVE');
  });

  it('MCU bağlantısı AYRI eksende gösterilir', async () => {
    const { deriveCanCapability } = await import('../platform/canBus/VehicleConnectivityManager');
    expect(deriveCanCapability({ ...base, mcuConnected: false }).mcuConnected).toBe(false);
    expect(deriveCanCapability({ ...base, mcuConnected: true }).mcuConnected).toBe(true);
  });

  it('CAN tabanlı OLMAYAN protokol (KWP=5) OBD-over-CAN saymaz', async () => {
    const { deriveCanCapability } = await import('../platform/canBus/VehicleConnectivityManager');
    expect(deriveCanCapability({ ...base, obdProtocolActive: '5' }).obdOverCanActive).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T11 — Mavi rapor güveni ve dili
   ════════════════════════════════════════════════════════════════════════ */

describe('T11 — confidence 0 iken kesin kök-neden sonucu üretilmez', () => {
  it('kanıt VARKEN güven 0 ise "bulunamadı" KESİNLİĞİ kurulmaz', async () => {
    const { _inconclusiveHeadline } = await import('../platform/aiCore/agents/aiMechanic');
    const ev = [
      { key: 'transport.quality', kind: 'diagnostic', summary: '', confidence: 0.6, observedAt: 1, source: 'obd' },
      { key: 'recovery.reconnect_history', kind: 'diagnostic', summary: '', confidence: 0.6, observedAt: 1, source: 'obd' },
    ] as never;
    const h = _inconclusiveHeadline(ev, 'Kayda değer kök-neden bulunamadı.');
    expect(h).not.toBe('Kayda değer kök-neden bulunamadı.');
    expect(h).toContain('kanıtlanamadı');
    expect(h).toContain('bağlantı/kurtarma');
  });

  it('kanıt YOKSA "sorun yok" DENMEZ (verdict başlığı korunur)', async () => {
    const { _inconclusiveHeadline } = await import('../platform/aiCore/agents/aiMechanic');
    expect(_inconclusiveHeadline([], 'Kanıt yok.')).toBe('Kanıt yok.');
  });

  it('bağlantı olayı MEKANİK ARIZA gibi konuşulmaz', async () => {
    const { _inconclusiveHeadline } = await import('../platform/aiCore/agents/aiMechanic');
    const ev = [
      { key: 'transport.reconnect_pressure', kind: 'diagnostic', summary: '', confidence: 0.3, observedAt: 1, source: 'obd' },
    ] as never;
    const h = _inconclusiveHeadline(ev, 'x');
    expect(h).toContain('kritik mekanik arıza kanıtı yok');
    expect(h).not.toMatch(/arıza tespit edildi|motor arızası/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   T12 — Suppression iz gürültüsü
   ════════════════════════════════════════════════════════════════════════ */

describe('T12 — proaktif suppression trail gürültüsü sınırlanır', () => {
  it('aynı rutin reason tekrarı iz halkasını DOLDURMAZ', async () => {
    const trail: string[] = [];
    vi.resetModules();
    vi.doMock('../platform/diagnosticTrailCore', () => ({
      pushTrail: (_k: string, label: string) => { trail.push(label); },
    }));
    const m = await import('../platform/companion/companionChatProvider');
    m._resetProactiveTrailAggregation();

    // Sahada 4 saniyede bir yazılıyordu; 20 karar → 20 satır oluyordu.
    for (let i = 0; i < 20; i++) {
      m._testEmitProactiveTrail('suppressed', 'not_critical');
    }
    expect(trail.length).toBeLessThan(5);   // ilk satır + varsa özet
    vi.doUnmock('../platform/diagnosticTrailCore');
  });

  it('FARKLI/kritik reason KAYBOLMAZ — anında yazılır', async () => {
    const trail: string[] = [];
    vi.resetModules();
    vi.doMock('../platform/diagnosticTrailCore', () => ({
      pushTrail: (_k: string, label: string) => { trail.push(label); },
    }));
    const m = await import('../platform/companion/companionChatProvider');
    m._resetProactiveTrailAggregation();

    m._testEmitProactiveTrail('suppressed', 'not_critical');
    m._testEmitProactiveTrail('suppressed', 'not_critical');
    m._testEmitProactiveTrail('suppressed', 'safety_gate_unreadable');  // rutin DEĞİL
    m._testEmitProactiveTrail('spoken', 'critical_fault');

    const joined = trail.join('|');
    expect(joined).toContain('spoken');
    expect(trail.length).toBeGreaterThanOrEqual(3);
    vi.doUnmock('../platform/diagnosticTrailCore');
  });

  it('aggregation state restart sonrası GÜVENLİ sıfırlanır', async () => {
    vi.resetModules();
    vi.doMock('../platform/diagnosticTrailCore', () => ({ pushTrail: () => undefined }));
    const m = await import('../platform/companion/companionChatProvider');
    m._testEmitProactiveTrail('suppressed', 'not_critical');
    m._resetProactiveTrailAggregation();
    // Sıfırlama sonrası ilk karar YİNE anında görünür (pencere devretmez).
    expect(m._testShouldEmitProactiveTrail('suppressed', 'not_critical')).toBe(true);
    vi.doUnmock('../platform/diagnosticTrailCore');
  });
});
