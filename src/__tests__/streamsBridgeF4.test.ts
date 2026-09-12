/**
 * streamsBridgeF4.test.ts — ARCH-06/F4 · AKIŞ VE KÖPRÜ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BU FAZIN AMACI akış hızlarını KÖRCE DÜŞÜRMEK DEĞİLDİR: aynı truth ve aynı
 * alan kadansıyla daha az gereksiz köprü/JS/VDL işi yapmaktır.
 *
 * Bu yüzden buradaki kilitlerin ÇOĞU "değişmedi" der: kadans, nesil kapıları,
 * poll otoritesi ve native coalescing sabitleri. Bir performans turunun en
 * tehlikeli yan etkisi, hız kazanırken TRUTH'u bozmaktır — özellikle:
 *   · eksik sinyali 0 sanmak
 *   · değişmeyen alanı yanlışlıkla SİLMEK
 *   · bayat veriyi güncel göstermek
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  getPerfCounters, _resetPerfCountersForTest,
} from '../platform/perf/perfCounters';
import { getBridgePolicy, bridgeSurfaces } from '../platform/perf/bridgePolicyContract';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';

const JAVA = readFileSync('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java', 'utf8');
const VDL_INDEX = readFileSync('src/platform/vehicleDataLayer/index.ts', 'utf8');
const STORE = readFileSync('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts', 'utf8');
const CAN_ADAPTER = readFileSync('src/platform/vehicleDataLayer/CanAdapter.ts', 'utf8');
const GPS = readFileSync('src/platform/gpsService.ts', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const store = () => useUnifiedVehicleStore.getState();

beforeEach(() => {
  _resetPerfCountersForTest();
  store().resetCanData();
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) CAN → VDL · DEĞİŞEN ALAN YAMASI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/A · CAN değişen-alan yaması', () => {
  it('A1 — yalnız DEĞİŞEN alan yazılır, yama boyutu ölçülür', () => {
    store().updateCanExtras({ rpm: 1000, coolantTemp: 80 });
    const first = getPerfCounters();
    expect(first['can.vdlPatchWritten']).toBe(1);
    /* İki alan değişti → yama boyutu 2. */
    expect(first['can.vdlPatchFields']).toBe(2);

    /* Aynı değerler tekrar: TEK alan değişiyor. */
    store().updateCanExtras({ rpm: 1200, coolantTemp: 80 });
    const second = getPerfCounters();
    expect(second['can.vdlPatchWritten']).toBe(2);
    expect(second['can.vdlPatchFields']).toBe(3);   // 2 + 1
  });

  it('A2 — 🔒 hiçbir alan değişmediyse set() ÇAĞRILMAZ (abone uyanmaz)', () => {
    store().updateCanExtras({ rpm: 2000 });
    const before = useUnifiedVehicleStore.getState();
    store().updateCanExtras({ rpm: 2000 });
    const after = useUnifiedVehicleStore.getState();
    /* Zustand `set` çağrılmadıysa durum nesnesi AYNI referanstır. */
    expect(after).toBe(before);
    expect(getPerfCounters()['can.vdlPatchSkipped']).toBe(1);
  });

  it('A3 — 🔒 DEĞİŞMEYEN alanlar KORUNUR (yama eski alanı silmez)', () => {
    store().updateCanExtras({ rpm: 3000, coolantTemp: 90, gearPos: 4 });
    /* Sonraki yamada yalnız rpm gelsin — diğerleri `undefined`. */
    store().updateCanExtras({
      rpm: 3500, coolantTemp: undefined, gearPos: undefined,
    });
    const s = useUnifiedVehicleStore.getState();
    expect(s.canRpm).toBe(3500);
    expect(s.canCoolantTemp).toBe(90);   // KORUNDU
    expect(s.canGearPos).toBe(4);        // KORUNDU
  });

  it('A4 — 🔒 UNKNOWN (undefined/null) SIFIRA ÇEVRİLMEZ', () => {
    store().updateCanExtras({ rpm: 4000 });
    store().updateCanExtras({ rpm: null });
    expect(useUnifiedVehicleStore.getState().canRpm).toBe(4000);
    store().updateCanExtras({ rpm: undefined });
    expect(useUnifiedVehicleStore.getState().canRpm).toBe(4000);
  });

  it('A5 — 🔒 ÖLÇÜLMÜŞ 0 geçerli bir değerdir ve YAZILIR', () => {
    store().updateCanExtras({ rpm: 5000 });
    store().updateCanExtras({ rpm: 0 });
    /* Motor durdu: 0 gerçek bir ölçümdür, `null` ile karıştırılamaz. */
    expect(useUnifiedVehicleStore.getState().canRpm).toBe(0);
  });

  it('A6 — TPMS eleman-eleman kıyaslanır (yeni referans dirty ÜRETMEZ)', () => {
    store().updateCanExtras({ tpms: [220, 220, 210, 210] });
    const before = useUnifiedVehicleStore.getState();
    store().updateCanExtras({ tpms: [220, 220, 210, 210] });   // YENİ dizi, AYNI değerler
    expect(useUnifiedVehicleStore.getState()).toBe(before);
  });

  it('A7 — 🔒 ÖN-TAHSİSLİ zarf: hot-path’te nesne literali YOK', () => {
    /* Her emit’te 22 alanlı yeni nesne tahsis etmek, Mali-400 sınıfı bir
       cihazda saniyede ~12 kısa ömürlü nesne demekti. Zarf yeniden kullanılır
       (CanAdapter’ın `_data`/`_tpmsBuffer` deseniyle aynı). */
    expect(VDL_INDEX).toContain('const _canPatch: CanExtrasPatch = {');
    expect(VDL_INDEX).toContain('updateCanExtras(_canPatch)');
    /* Eski desen geri gelmemeli: çağrının içinde nesne literali AÇILMAMALI. */
    expect(codeOnly(VDL_INDEX)).not.toMatch(/updateCanExtras\(\{/);
  });

  it('A8 — 🔒 zarf HER alanı yeniden yazar (kısmi güncelleme YOK)', () => {
    /* Bir alan yazılmadan bırakılsaydı önceki emit’in değeri "hâlâ geldi"
       sanılırdı — sessiz bir bayatlık kaynağı. */
    for (const f of ['doorOpen', 'headlightsOn', 'highBeam', 'turnLeft', 'turnRight',
      'hazard', 'tpms', 'rpm', 'coolantTemp', 'oilTemp', 'throttle', 'batteryVolt',
      'gearPos', 'ambientTemp', 'abs', 'tractionControl', 'stabilityControl',
      'parkingBrake', 'seatbelt', 'wipers', 'airCondition', 'cruiseControl']) {
      expect(VDL_INDEX, f).toContain(`_canPatch.${f}`);
    }
  });

  it('A9 — provenance yalnız DEĞİŞEN alanlara damgalanır', () => {
    expect(STORE).toMatch(/if \(k in u\) stampProvenance\(k, 'can', _pAt\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) NATIVE CAN COALESCING — DEĞİŞMEDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/B · native CAN coalescing korunuyor', () => {
  it('B1 — 🔒 80 ms penceresi ve dedup AYNEN duruyor', () => {
    expect(JAVA).toContain('CAN_EMIT_MIN_INTERVAL_MS = 80L');
    expect(JAVA).toContain('sameEmittedData');
    expect(JAVA).toContain('_pendingEmitData');
  });

  it('B2 — 🔒 güvenlik bypass’ı (reverse · parkingBrake) DEĞİŞMEDİ', () => {
    expect(JAVA).toContain('isSafetyCriticalChange');
    expect(JAVA).toMatch(/Objects\.equals\(incoming\.reverse, lastEmitted\.reverse\)/);
    expect(JAVA).toMatch(/Objects\.equals\(incoming\.parkingBrake, lastEmitted\.parkingBrake\)/);
  });

  it('B3 — 🔒 ham sniffer HÂLÂ ON_DEMAND', () => {
    expect(JAVA).toContain('_canSnifferActive');
    expect(JAVA).toMatch(/if \(_canSnifferActive && !signals\.isEmpty\(\)\)/);
  });

  it('B4 — 🔒 EMIT YOLUNDA ikinci throttle KURULMADI', () => {
    /* DOSYA DEĞİL BÖLGE taranır: `CanAdapter` içindeki `setTimeout`'lar
       ilk-frame gözcüsü ve geç-kurtarma yollarıdır (emit throttle DEĞİL).
       Dosyanın tamamını taramak yanlış alarm üretip GERÇEK riski gizlerdi. */
    const raw = CAN_ADAPTER;
    const start = raw.indexOf("CarLauncher.addListener('canData'");
    expect(start, 'canData dinleyicisi bulunamadı').toBeGreaterThan(-1);
    const NL = String.fromCharCode(10);
    const region = codeOnly(raw.slice(start).split(NL).slice(0, 140).join(NL));
    expect(region).not.toMatch(/setTimeout\(|setInterval\(/);
    expect(region).not.toMatch(/debounce|COALESCE_MS|_lastEmitAt|_pendingEmit/i);
  });

  it('B5 — 🔒 CanAdapter ön-tahsisli nesneyi KORUYOR', () => {
    expect(CAN_ADAPTER).toContain('this._tpmsBuffer');
    expect(CAN_ADAPTER).toContain('this._data');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) GPS — OTORİTE VE GUARD'LAR DEĞİŞMEDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/C · GPS otoritesi korunuyor', () => {
  it('C1 — 🔒 kadans sabitleri DEĞİŞMEDİ', () => {
    expect(GPS).toContain('POSITION_THROTTLE_BASE_MS = 200');
    expect(GPS).toContain('GPS_NAV_MAX_INTERVAL_MS = 500');
  });

  it('C2 — 🔒 nesil ve sıra guard’ları AYNEN duruyor', () => {
    expect(GPS).toContain('_staleGenerationRejectCount++');
    expect(GPS).toContain('_outOfOrderRejectCount++');
    expect(GPS).toContain('isCurrentGPSObservation(');
  });

  it('C3 — 🔒 GPS hızı DOĞRULANMIŞ araç hızına YAZILMAZ', () => {
    /* GPS hızı yalnız `updateGpsSpeedForValidation` ucuna gider; kanonik
       araç hızı otoritesi HAL>CAN>OBD sırasındadır. */
    expect(VDL_INDEX).toContain('updateGpsSpeedForValidation');
    const code = codeOnly(VDL_INDEX);
    expect(code).not.toMatch(/updateCanExtras\([^)]*gpsSpeed/);
  });

  it('C4 — VDL yayın sayacı GERÇEK yola takılı', () => {
    expect(readFileSync('src/platform/vehicleDataLayer/GpsAdapter.ts', 'utf8'))
      .toContain("bumpPerf('gps.publishedToStore')");
  });

  it('C5 — GPS sayaç zinciri tam: callback → accepted → published', () => {
    const ids = Object.keys(getPerfCounters());
    for (const id of ['gps.providerCallback', 'gps.fixAccepted',
      'gps.fixThrottled', 'gps.publishedToStore']) {
      expect(ids, id).toContain(id);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) OBD — POLL OTORİTESİ DEĞİŞMEDİ, KANIT BAĞLANDI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/D · OBD otoritesi ve kanıtı', () => {
  it('D1 — 🔒 native poll planlayıcısı DEĞİŞMEDİ', () => {
    const sched = readFileSync(
      'android/app/src/main/java/com/cockpitos/pro/obd/AdaptivePidScheduler.java', 'utf8');
    expect(sched).toContain('public synchronized List<String> plan(');
    expect(sched).toContain('budgetMs');
  });

  it('D2 — 🔒 İKİNCİ OBD performans gerçeği KURULMADI', () => {
    /* Toplayıcı native `PollCostLedger`ı OKUR; kendi sayacını TUTMAZ. */
    const agg = codeOnly(readFileSync('src/platform/perf/performanceAggregator.ts', 'utf8'));
    expect(agg).toContain('getPollCostSnapshot');
    expect(agg).not.toMatch(/_pollCycles|_obdBudget\s*=|recordPollCost/);
  });

  it('D3 — kanıt yoksa OBD bölümü UNMEASURED (0 GÖSTERMEZ)', () => {
    const obd = getPerformanceDiagnosticsSnapshot().sections.find((s) => s.sectionId === 'obd');
    expect(obd).toBeDefined();
    /* Test ortamında native ledger yok → dürüst boşluk. */
    for (const m of obd!.metrics) {
      if (m.kind === 'UNMEASURED') expect(m.value).toBeNull();
    }
  });

  it('D4 — canlı telemetri ile burst/derin teşhis AYRI raporlanır', () => {
    const agg = readFileSync('src/platform/perf/performanceAggregator.ts', 'utf8');
    expect(agg).toContain('obd.burstCycles');
    expect(agg).toMatch(/CANLI TELEMETRİ ile BURST/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) KÖPRÜ POLİTİKASI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/E · köprü trafik sınıfları', () => {
  it('E1 — 🔒 GÜVENLİK-KRİTİK yüzey ASLA batch/coalesce edilemez', () => {
    for (const s of bridgeSurfaces()) {
      if (s.safetyCritical) {
        expect(s.trafficClass, s.surfaceId).not.toBe('BATCHED');
        expect(s.trafficClass, s.surfaceId).not.toBe('COALESCED');
      }
    }
  });

  it('E2 — donanım/MCU komutları DIRECT', () => {
    const byId = new Map(bridgeSurfaces().map((s) => [s.surfaceId, s]));
    expect(byId.get('mcuCommand')?.trafficClass).toBe('DIRECT');
    expect(byId.get('hardwareMediaKey')?.trafficClass).toBe('DIRECT');
    expect(byId.get('sendDiagnosticPdu')?.trafficClass).toBe('DIRECT');
    expect(byId.get('memoryPressure')?.trafficClass).toBe('DIRECT');
    expect(byId.get('thermalStatus')?.trafficClass).toBe('DIRECT');
  });

  it('E3 — akış yüzeyleri doğru sınıfta', () => {
    const byId = new Map(bridgeSurfaces().map((s) => [s.surfaceId, s]));
    expect(byId.get('canData')?.trafficClass).toBe('COALESCED');
    expect(byId.get('canData.safetyBypass')?.trafficClass).toBe('DIRECT');
    expect(byId.get('canRawFrame')?.trafficClass).toBe('ON_DEMAND');
    expect(byId.get('obdData')?.trafficClass).toBe('SAMPLED');
    expect(byId.get('gps.watchPosition')?.trafficClass).toBe('SAMPLED');
    expect(byId.get('storage.filesystem')?.trafficClass).toBe('BATCHED');
  });

  it('E4 — her yüzey UYGULAYICISINI gösterir (sözleşme uygulamaz)', () => {
    for (const s of bridgeSurfaces()) {
      expect(s.enforcedBy.length, s.surfaceId).toBeGreaterThan(0);
      expect(s.rationale.length, s.surfaceId).toBeGreaterThan(0);
    }
    const code = codeOnly(readFileSync('src/platform/perf/bridgePolicyContract.ts', 'utf8'));
    /* Sözleşme hiçbir olayı yakalamaz/geciktirmez. */
    expect(code).not.toMatch(/addListener|setTimeout\(|setInterval\(|CarLauncher/);
  });

  it('E5 — COALESCED ile BATCHED ayrımı yazılı', () => {
    expect(getBridgePolicy().notes.join(' ')).toMatch(/KASTEN düşürür.*hiçbirini düşürmez/s);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) TRUTH / PERFORMANS AYRIMI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F4/F · truth korunuyor', () => {
  it('F1 — ölçüm katmanı sinyal DEĞERİ taşımaz', () => {
    for (const f of ['src/platform/perf/bridgePolicyContract.ts',
      'src/platform/perf/perfCounters.ts']) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/latitude|longitude|\bvin\b|rpm\s*=|speed\s*=/i);
    }
  });

  it('F2 — profiler SALT-OKUNUR (sayaç sıfırlamaz, store yazmaz)', () => {
    const agg = codeOnly(readFileSync('src/platform/perf/performanceAggregator.ts', 'utf8'));
    expect(agg).not.toMatch(/setState|updateCanExtras|_reset[A-Za-z]*ForTest/);
  });

  it('F3 — CAN sayaçları store DAVRANIŞINI değiştirmedi', () => {
    /* Sayaç eklemek dedup kararını etkilememeli: aynı değer → yine skip. */
    store().updateCanExtras({ coolantTemp: 77 });
    const ref = useUnifiedVehicleStore.getState();
    store().updateCanExtras({ coolantTemp: 77 });
    expect(useUnifiedVehicleStore.getState()).toBe(ref);
  });

  it('F4 — F1/F2/F3 sözleşmeleri bozulmadı', () => {
    const ids = Object.keys(getPerfCounters());
    /* Sayaç kabı SABİT şekilli kaldı ve eski id’ler duruyor. */
    for (const id of ['bridge.canData.received', 'map.cameraDedupSkipped',
      'storage.setRequest', 'artwork.accentDecode']) {
      expect(ids, id).toContain(id);
    }
  });

  it('F5 — yeni bölümler toplayıcıda mevcut', () => {
    const ids = getPerformanceDiagnosticsSnapshot().sections.map((s) => s.sectionId);
    for (const need of ['can_vdl', 'obd', 'bridge_policy']) {
      expect(ids, need).toContain(need);
    }
  });

  it('F6 — 0/0 durumunda oran UYDURULMAZ', () => {
    const canVdl = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'can_vdl');
    const ratio = canVdl?.metrics.find((m) => m.name === 'can.vdlWriteRatio');
    expect(ratio?.value).toBeNull();
  });
});
