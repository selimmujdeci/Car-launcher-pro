/**
 * linkLossLedger.test.ts — #536 · GÖREV A: KOPMA KANIT DEFTERİ.
 *
 * SAHA (2026-08-11, Xiaomi 23090RA98I): 8 timeout · `OBD:LinkLost` 47 s boyunca
 * HİÇBİR paket · `connectionQuality` 100→57 · `reconnectPressure` 0.0019→1.71.
 * Kullanıcının "veri kesiliyor, geri geliyor" beyanı ilk kez sayılarla kayıtlı —
 * ama dört kök neden adayı (adaptör · soket · ELM init · ECU uykusu) AYNI
 * `timeout` sayısını üretiyor. Bu testler defterin o dört imzayı ayırdığını VE
 * ayıramadığı yerde SUSTUĞUNU (UNKNOWN) kilitler.
 *
 * Kör düzeltme yasağının test karşılığı: defter hiçbir eşik/karar üretmez.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyLinkLoss, appendLinkLoss, attachRecovery, noteRecovery,
  summarizeLinkLosses,
  LINK_LOSS_RING, LINK_LOSS_BROWNOUT_V, LINK_LOSS_FAST_RECOVERY_MS,
  LINK_LOSS_VOLTAGE_FRESH_MS, classifyVoltageFreshness,
  type LinkLossSample, type LinkLossTrigger,
} from '../platform/obd/linkLossLedger';

function sample(over: Partial<LinkLossSample> = {}): LinkLossSample {
  return {
    atMs: 1_000,
    trigger: 'LINK_DEAD_WATCHDOG',
    timeoutStage: null,
    linkPacketAgeMs: 47_000,      // saha: 47 s boyunca hiç paket
    ecuDataAgeMs: 47_500,
    adapterVoltageV: 14.1,
    /* C — voltajın OKUNDUĞU an. Damgasız voltaj artık kanıt SAYILMAZ; bu fixture
       "ATRV kopma anında gerçekten okundu" senaryosunu temsil eder. */
    adapterVoltageObservedAt: 1_000,
    everHadEcuData: true,
    transport: 'classic',
    protocolActive: '6',
    ...over,
  };
}

describe('#536 · kopma imzası → aday', () => {
  it('🔒 besleme çöküşü ADAPTER_UNREACHABLE verir', () => {
    const r = classifyLinkLoss(sample({ adapterVoltageV: LINK_LOSS_BROWNOUT_V - 0.5 }));
    expect(r.candidate).toBe('ADAPTER_UNREACHABLE');
    expect(r.note).toContain('besleme');
  });

  it('🔒 ECU link\'ten ÖNCE sustuysa sıra ECU→link okunur', () => {
    /* ECU 90 s, link 5 s → ECU çok önce susmuş: adaptör suçlanamaz. */
    const r = classifyLinkLoss(sample({ ecuDataAgeMs: 90_000, linkPacketAgeMs: 5_000 }));
    expect(r.candidate).toBe('ECU_SILENT');
  });

  it('🔒 tüm paketler AYNI ANDA kesilirse ADAY İDDİA EDİLMEZ', () => {
    /* Fişten çekilme ile soket düşüşü bu anda BİREBİR aynı imzayı üretir —
       "muhtemelen soket" demek tam olarak kaçındığımız hatadır. */
    const r = classifyLinkLoss(sample({ ecuDataAgeMs: 47_500, linkPacketAgeMs: 47_000 }));
    expect(r.candidate).toBe('UNKNOWN');
    expect(r.evidenceGap).toContain('RECOVERY');
  });

  it('🔒 voltaj hiç okunmadıysa EKSİK KANIT olarak sayılır (sahte 0 yok)', () => {
    const r = classifyLinkLoss(sample({ adapterVoltageV: null }));
    expect(r.adapterVoltageV).toBeNull();
    expect(r.evidenceGap).toContain('ADAPTER_VOLTAGE');
  });

  /* ── C · VOLTAJ TAZELİĞİ (saha 2026-08-30 · CAROS LAB TAM KOPYA) ──────────
     Kopma defterinde `"hiç paket yok (ATRV dahil)"` diyen kayıt 12,6 V taşıyordu
     ve `evidenceGap` bunu boşluk SAYMIYORDU — bayat sayı canlı kanıt gibi
     görünüyordu. Aşağıdaki üç kilit o durumu kapatır. */

  it('🔒 C · BAYAT voltaj kanıt sayılmaz; ham değer KAYITTA KALIR', () => {
    const r = classifyLinkLoss(sample({
      atMs: 100_000,
      adapterVoltageV: LINK_LOSS_BROWNOUT_V - 0.5,        // brownout bandı
      adapterVoltageObservedAt: 100_000 - LINK_LOSS_VOLTAGE_FRESH_MS - 1,
    }));
    expect(r.voltageFreshness).toBe('STALE');
    expect(r.adapterVoltageV).toBe(LINK_LOSS_BROWNOUT_V - 0.5);   // kanıt SİLİNMEZ
    expect(r.evidenceGap).toContain('ADAPTER_VOLTAGE');
    /* Bayat brownout okuması ADAPTER_UNREACHABLE hükmü ÜRETEMEZ. */
    expect(r.candidate).not.toBe('ADAPTER_UNREACHABLE');
    expect(r.note).toContain('BAYAT');
  });

  it('🔒 C · ÖLÇÜM ANI BİLİNMEYEN voltaj kanıt sayılmaz (saha imzası)', () => {
    const r = classifyLinkLoss(sample({
      adapterVoltageV: 12.6,
      adapterVoltageObservedAt: null,       // damga yok — sahadaki tam durum
    }));
    expect(r.voltageFreshness).toBe('UNKNOWN');
    expect(r.voltageAgeMs).toBeNull();
    expect(r.evidenceGap).toContain('ADAPTER_VOLTAGE');
    expect(r.note).toContain('ÖLÇÜM ANI BİLİNMİYOR');
  });

  it('🔒 C · TAZE voltaj kanıt sayılır ve boşluk AÇILMAZ', () => {
    const r = classifyLinkLoss(sample({
      atMs: 100_000,
      adapterVoltageV: LINK_LOSS_BROWNOUT_V - 0.5,
      adapterVoltageObservedAt: 100_000 - 1_000,
    }));
    expect(r.voltageFreshness).toBe('FRESH');
    expect(r.voltageAgeMs).toBe(1_000);
    expect(r.evidenceGap).not.toContain('ADAPTER_VOLTAGE');
    expect(r.candidate).toBe('ADAPTER_UNREACHABLE');    // taze brownout → hüküm ÜRETİR
  });

  it('🔒 C · tazelik sınıflandırıcısı SAF (kendi saatini okumaz)', () => {
    expect(classifyVoltageFreshness(1_000, null).freshness).toBe('UNKNOWN');
    expect(classifyVoltageFreshness(1_000, 0).freshness).toBe('UNKNOWN');
    expect(classifyVoltageFreshness(5_000, 4_000)).toEqual({ freshness: 'FRESH', ageMs: 1_000 });
    /* Saat sıçraması: negatif yaş üretilmez. */
    expect(classifyVoltageFreshness(1_000, 9_000).ageMs).toBe(0);
  });

  it('🔒 timeout AŞAMASI adayı ayırır', () => {
    const cases: [LinkLossSample['timeoutStage'], string][] = [
      ['transport', 'ADAPTER_UNREACHABLE'],
      ['connect',   'ELM_INIT_INCOMPLETE'],
      ['pid0100',   'ECU_SILENT'],
      ['mode0902',  'UNKNOWN'],       // VIN timeout'u kopmayı AÇIKLAMAZ
    ];
    for (const [stage, expected] of cases) {
      const r = classifyLinkLoss(sample({ trigger: 'CONNECT_TIMEOUT', timeoutStage: stage }));
      expect(r.candidate, `aşama ${stage}`).toBe(expected);
    }
  });

  it('🔒 aşama bildirilmemiş timeout ADAY ÜRETMEZ, boşluk kaydeder', () => {
    const r = classifyLinkLoss(sample({ trigger: 'CONNECT_TIMEOUT', timeoutStage: null }));
    expect(r.candidate).toBe('UNKNOWN');
    expect(r.evidenceGap).toContain('TIMEOUT_STAGE');
  });

  it('🔒 ELM "UNABLE TO CONNECT" adaptörü SUÇLAMAZ (ECU susuyor)', () => {
    expect(classifyLinkLoss(sample({ trigger: 'CONNECT_UNABLE' })).candidate).toBe('ECU_SILENT');
  });

  it('🔒 ECU susması KOPMA sayılmaz, kullanıcı eylemi ARIZA sayılmaz', () => {
    expect(classifyLinkLoss(sample({ trigger: 'ECU_SILENT_WATCHDOG' })).candidate).toBe('ECU_SILENT');
    expect(classifyLinkLoss(sample({ trigger: 'USER' })).candidate).toBe('USER_ACTION');
  });

  it('🔒 native hata sınıfı yoksa bu AÇIKÇA beyan edilir', () => {
    const r = classifyLinkLoss(sample({ trigger: 'CONNECT_FAIL' }));
    expect(r.candidate).toBe('UNKNOWN');
    expect(r.evidenceGap).toContain('NATIVE_SOCKET_ERROR');
  });
});

describe('#536 · kurtarma imzası ayrımı keskinleştirir', () => {
  const ambiguous = classifyLinkLoss(sample());   // UNKNOWN + RECOVERY boşluğu

  it('🔒 hızlı + denemesiz kurtarma → SOKET düşüşü', () => {
    const r = attachRecovery(ambiguous, {
      recoveredAtMs: ambiguous.atMs + LINK_LOSS_FAST_RECOVERY_MS - 1, failedAttempts: 0,
    });
    expect(r.refinedCandidate).toBe('RFCOMM_SOCKET_DROP');
    expect(r.evidenceGap).not.toContain('RECOVERY');
  });

  it('🔒 düşen denemeli kurtarma → ADAPTÖR erişilemez', () => {
    const r = attachRecovery(ambiguous, { recoveredAtMs: ambiguous.atMs + 40_000, failedAttempts: 3 });
    expect(r.refinedCandidate).toBe('ADAPTER_UNREACHABLE');
  });

  it('🔒 arada kalan imza HÂLÂ UNKNOWN kalır (zorlama yok)', () => {
    const r = attachRecovery(ambiguous, { recoveredAtMs: ambiguous.atMs + 30_000, failedAttempts: 1 });
    expect(r.refinedCandidate).toBe('UNKNOWN');
    expect(r.recoveryMs).toBe(30_000);
  });

  it('🔒 saat GERİ giderse süre UYDURULMAZ', () => {
    const r = attachRecovery(ambiguous, { recoveredAtMs: ambiguous.atMs - 5_000, failedAttempts: 0 });
    expect(r.recoveryMs).toBeNull();
    expect(r.refinedCandidate).toBe('UNKNOWN');
  });

  it('🔒 kanıtı OLAN aday kurtarma yüzünden DEĞİŞMEZ', () => {
    const proven = classifyLinkLoss(sample({ adapterVoltageV: 10.9 }));
    const r = attachRecovery(proven, { recoveredAtMs: proven.atMs + 500, failedAttempts: 0 });
    expect(r.refinedCandidate).toBe('ADAPTER_UNREACHABLE');
  });

  it('🔒 kurtarma EN YENİ bekleyen kayda yazılır; kullanıcı kaydına YAZILMAZ', () => {
    let led = appendLinkLoss([], classifyLinkLoss(sample({ atMs: 1_000 })));
    led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: 2_000, trigger: 'USER' })));
    const out = noteRecovery(led, { recoveredAtMs: 3_000, failedAttempts: 0 });
    expect(out[1].recoveryMs).toBeNull();          // kullanıcı eylemi atlandı
    expect(out[0].recoveryMs).toBe(2_000);
  });

  it('🔒 bekleyen kayıt yoksa defter DEĞİŞMEZ', () => {
    const led = appendLinkLoss([], classifyLinkLoss(sample({ trigger: 'USER' })));
    expect(noteRecovery(led, { recoveredAtMs: 9_999, failedAttempts: 0 })[0].recoveryMs).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * #596 · İLGİSİZ KURTARMA DAMGASI ESKİ KAYDA YAZILAMAZ
 *
 * SAHA (2026-08-16, gerçek araç · CAROS LAB kopyası): kayıt 2 (…767109) ve
 * kayıt 3 (…776146) 9 sn arayla açıldı; kayıt 3 → 27 976 ms, kayıt 2 →
 * 828 625 ms (13,8 dk). Sonraki kopma öncekinden 30× hızlı "kurtardı".
 * `maxRecoveryMs` ölçülmemiş bir sayıya dönüştü; `attachRecovery` bu süreyi
 * kök-neden keskinleştirmede kullandığı için YANLIŞ PARÇA suçlanabilirdi.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('#596 · ölçülemeyen kurtarma uydurulmaz', () => {
  const wd = (atMs: number, trigger: LinkLossTrigger = 'ECU_SILENT_WATCHDOG') =>
    classifyLinkLoss(sample({ atMs, trigger }));

  it('🔒 SAHA: 9 sn arayla iki watchdog kopması → eskisi 828 625 ms YEMEZ', () => {
    let led = appendLinkLoss([], wd(767_109));
    led = appendLinkLoss(led, wd(776_146));

    // Gerçek kurtarma: en yeni (açık olan) kayda yazılır.
    led = noteRecovery(led, { recoveredAtMs: 804_122, failedAttempts: 0 });
    expect(led[1].recoveryMs).toBe(27_976);

    // Çok sonra gelen İLGİSİZ kurtarma eski kayda SIZAMAZ (saha: 828 625).
    led = noteRecovery(led, { recoveredAtMs: 1_595_734, failedAttempts: 0 });
    expect(led[0].recoveryMs).toBeNull();
    expect(led[0].recoverySuperseded).toBe(true);
    expect(led[0].note).toMatch(/KURTARMA ÖLÇÜLEMEDİ/);

    const s = summarizeLinkLosses(led);
    expect(s.maxRecoveryMs).toBe(27_976);        // artefakt özete GİRMEZ
    expect(s.medianRecoveryMs).toBe(27_976);
    expect(s.supersededCount).toBe(1);
    expect(s.pendingRecoveryCount).toBe(0);      // ölçülemez ≠ bekliyor
  });

  it('🔒 ölçülemeyen kayıtta RECOVERY kanıt boşluğu AÇIK kalır', () => {
    let led = appendLinkLoss([], wd(1_000, 'LINK_DEAD_WATCHDOG'));
    led = appendLinkLoss(led, wd(2_000, 'LINK_DEAD_WATCHDOG'));
    expect(led[0].evidenceGap).toContain('RECOVERY');
  });

  it('🔒 şişmiş süre kök-neden adayını ARTIK keskinleştiremez', () => {
    let led = appendLinkLoss([], wd(1_000, 'LINK_DEAD_WATCHDOG'));
    expect(led[0].candidate).toBe('UNKNOWN');        // ön koşul: aday belirsiz
    led = appendLinkLoss(led, wd(2_000, 'LINK_DEAD_WATCHDOG'));
    led = noteRecovery(led, { recoveredAtMs: 900_000, failedAttempts: 0 });
    // Eski kayıt sahte "yavaş kurtarma" ile ADAPTER_UNREACHABLE damgası YEMEZ.
    expect(led[0].refinedCandidate).toBe('UNKNOWN');
  });

  it('🔒 KULLANICI eylemi mühür kanıtı DEĞİLDİR (bekleyen kayıt kapanabilir)', () => {
    let led = appendLinkLoss([], wd(1_000, 'LINK_DEAD_WATCHDOG'));
    led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: 2_000, trigger: 'USER' })));
    led = noteRecovery(led, { recoveredAtMs: 3_000, failedAttempts: 0 });
    expect(led[0].recoveryMs).toBe(2_000);
    expect(led[0].recoverySuperseded).toBe(false);
  });

  it('🔒 başarısız reconnect denemesi mühürLEMEZ — süren kesintinin parçası', () => {
    let led = appendLinkLoss([], wd(1_000, 'LINK_DEAD_WATCHDOG'));
    led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: 2_000, trigger: 'CONNECT_TIMEOUT' })));
    led = noteRecovery(led, { recoveredAtMs: 3_000, failedAttempts: 1 });
    // En yeni bekleyen (CONNECT_TIMEOUT) kapanır; asıl kopma HÂLÂ meşru bekliyor.
    expect(led[0].recoverySuperseded).toBe(false);
    expect(summarizeLinkLosses(led).supersededCount).toBe(0);
    expect(summarizeLinkLosses(led).pendingRecoveryCount).toBe(1);
  });

  it('🔒 tek kopma → mühür YOK, ölçüm normal akar (gerileme koruması)', () => {
    let led = appendLinkLoss([], wd(1_000));
    led = noteRecovery(led, { recoveredAtMs: 5_000, failedAttempts: 0 });
    const s = summarizeLinkLosses(led);
    expect(s.supersededCount).toBe(0);
    expect(s.maxRecoveryMs).toBe(4_000);
  });
});

describe('#536 · defter sınırlı, özet dürüst', () => {
  it('🔒 halka tavanı korunur (en YENİ kayıtlar kalır)', () => {
    let led = [] as ReturnType<typeof appendLinkLoss>;
    for (let i = 0; i < LINK_LOSS_RING + 10; i++) {
      led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: i })));
    }
    expect(led.length).toBe(LINK_LOSS_RING);
    expect(led[led.length - 1].atMs).toBe(LINK_LOSS_RING + 9);
  });

  it('🔒 SAHA senaryosu: 8 timeout, aşama yok → baskın aday YOK, ölçüm istenir', () => {
    let led = [] as ReturnType<typeof appendLinkLoss>;
    for (let i = 0; i < 8; i++) {
      led = appendLinkLoss(led, classifyLinkLoss(
        sample({ atMs: i * 1_000, trigger: 'CONNECT_TIMEOUT', timeoutStage: null })));
    }
    const s = summarizeLinkLosses(led);
    expect(s.total).toBe(8);
    expect(s.byTrigger.CONNECT_TIMEOUT).toBe(8);
    expect(s.unknownCount).toBe(8);
    /* Kanıt yokken baskın aday İLAN EDİLMEZ — sahanın bugünkü durumu tam budur. */
    expect(s.dominant).toBeNull();
    /* Ve defter bir sonraki turun işini söyler: aşamayı ölç. */
    expect(s.nextMeasurement).toBe('TIMEOUT_STAGE');
  });

  it('🔒 UNKNOWN ve USER_ACTION baskın aday YARIŞINA GİRMEZ', () => {
    let led = [] as ReturnType<typeof appendLinkLoss>;
    for (let i = 0; i < 5; i++) {
      led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: i, trigger: 'USER' })));
    }
    expect(summarizeLinkLosses(led).dominant).toBeNull();
  });

  it('🔒 açık farkla öne geçen aday BASKIN ilan edilir', () => {
    let led = [] as ReturnType<typeof appendLinkLoss>;
    for (let i = 0; i < 4; i++) {
      led = appendLinkLoss(led, classifyLinkLoss(
        sample({ atMs: i, trigger: 'CONNECT_TIMEOUT', timeoutStage: 'connect' })));
    }
    led = appendLinkLoss(led, classifyLinkLoss(sample({ atMs: 9, trigger: 'CONNECT_UNABLE' })));
    const s = summarizeLinkLosses(led);
    expect(s.byCandidate.ELM_INIT_INCOMPLETE).toBe(4);
    expect(s.dominant).toBe('ELM_INIT_INCOMPLETE');
  });

  it('🔒 kurtarma ölçülmediyse süre 0 DEĞİL null; bekleyen SAYILIR', () => {
    const led = appendLinkLoss([], classifyLinkLoss(sample()));
    const s = summarizeLinkLosses(led);
    expect(s.medianRecoveryMs).toBeNull();
    expect(s.maxRecoveryMs).toBeNull();
    expect(s.pendingRecoveryCount).toBe(1);
  });

  it('🔒 boş defter hüküm ÜRETMEZ', () => {
    const s = summarizeLinkLosses([]);
    expect(s.total).toBe(0);
    expect(s.dominant).toBeNull();
    expect(s.nextMeasurement).toBeNull();
    expect(s.medianRecoveryMs).toBeNull();
  });

  it('🔒 defter SAF: aynı girdi aynı çıktı, girdi MUTASYONA UĞRAMAZ', () => {
    const s = sample();
    const frozen = JSON.stringify(s);
    const a = classifyLinkLoss(s);
    const b = classifyLinkLoss(s);
    expect(JSON.stringify(s)).toBe(frozen);
    expect(a).toEqual(b);
  });

  it('🔒 her tetikleyici sınıflandırılır (sessiz düşen olay yok)', () => {
    const triggers: LinkLossTrigger[] = [
      'LINK_DEAD_WATCHDOG', 'ECU_SILENT_WATCHDOG', 'DATA_GATE_LOSS',
      'CONNECT_TIMEOUT', 'CONNECT_UNABLE', 'CONNECT_FAIL', 'USER',
    ];
    for (const t of triggers) {
      const r = classifyLinkLoss(sample({ trigger: t }));
      expect(r.trigger, t).toBe(t);
      expect(typeof r.note, t).toBe('string');
      expect(r.note.length, t).toBeGreaterThan(0);
    }
  });
});
