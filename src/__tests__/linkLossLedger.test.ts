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
