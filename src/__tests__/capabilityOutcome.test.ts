/**
 * capabilityOutcome.test.ts — PR-CAP-1: araç yetenek sonucu sözlüğü + saf sınıflandırıcı.
 *
 * Bu testler, bugünkü `supported: boolean` daraltmasının KAYBETTİĞİ ayrımları kilitler:
 * 7F-31 (araç tanımıyor) ≠ 7F-33 (güvenlik) ≠ 7F-22 (koşul) ≠ NO DATA ≠ hat hatası.
 */
import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_OUTCOMES,
  isCapabilityOutcome,
  isCapabilityEvidence,
  isPermanentOutcome,
  shouldRetryOutcome,
  classifyNrc,
  classifyElmResponse,
  mergeOutcome,
  describeOutcome,
  NRC_RESPONSE_PENDING,
  type CapabilityOutcome,
} from '../platform/obd/capabilityOutcome';

describe('sözlük bütünlüğü', () => {
  it('tam olarak 7 sonuç vardır (şartname sözleşmesi)', () => {
    expect(CAPABILITY_OUTCOMES).toHaveLength(7);
    expect([...CAPABILITY_OUTCOMES].sort()).toEqual([
      'condition_required', 'no_data', 'parse_error', 'security_required',
      'timeout', 'unsupported', 'working',
    ]);
  });

  it('isCapabilityOutcome bozuk disk kaydını reddeder', () => {
    expect(isCapabilityOutcome('working')).toBe(true);
    expect(isCapabilityOutcome('supported')).toBe(false);   // eski boolean dünyası
    expect(isCapabilityOutcome(null)).toBe(false);
    expect(isCapabilityOutcome(1)).toBe(false);
    expect(isCapabilityOutcome({})).toBe(false);
  });

  it('her sonucun insan-okur açıklaması vardır (boş değil)', () => {
    for (const o of CAPABILITY_OUTCOMES) {
      expect(describeOutcome(o).length).toBeGreaterThan(0);
    }
  });
});

describe('zero-trust: timeout KANIT DEĞİLDİR', () => {
  it('timeout dışındaki her sonuç araç hakkında kanıttır', () => {
    for (const o of CAPABILITY_OUTCOMES) {
      expect(isCapabilityEvidence(o)).toBe(o !== 'timeout');
    }
  });

  it('KRİTİK: hat hatası öğrenilmiş yeteneği SİLMEZ (kopan kablo aracı unutturmaz)', () => {
    expect(mergeOutcome('working', 'timeout')).toBe('working');
    expect(mergeOutcome('unsupported', 'timeout')).toBe('unsupported');
    expect(mergeOutcome('condition_required', 'timeout')).toBe('condition_required');
  });

  it('hiç kanıt yokken timeout hiçbir şey öğretmez (null kalır)', () => {
    expect(mergeOutcome(null, 'timeout')).toBeNull();
  });
});

describe('kalıcılık ve tekrar-deneme kararları', () => {
  it('YALNIZ unsupported ve security_required kalıcıdır', () => {
    const permanent = CAPABILITY_OUTCOMES.filter(isPermanentOutcome);
    expect([...permanent].sort()).toEqual(['security_required', 'unsupported']);
  });

  it('REGRESYON: condition_required KALICI DEĞİLDİR — bugünkü kodun kök hatası', () => {
    // manufacturerPidService `!supported` gelen HER DID'i kalıcı kara listeye alıyordu →
    // "motor çalışınca okunur" (7F-22) bir DID sonsuza dek yasaklanıyordu.
    expect(isPermanentOutcome('condition_required')).toBe(false);
    expect(shouldRetryOutcome('condition_required')).toBe(true);
  });

  it('kalıcı sonuçlar tekrar sorulmaz', () => {
    expect(shouldRetryOutcome('unsupported')).toBe(false);
    expect(shouldRetryOutcome('security_required')).toBe(false);
  });

  it('parse_error tekrar sorulmaz — ECU sağlam, çözücümüz bozuk', () => {
    expect(shouldRetryOutcome('parse_error')).toBe(false);
    // ...ama kalıcı bir ARAÇ sınırı değildir (profil düzeltilince okunur).
    expect(isPermanentOutcome('parse_error')).toBe(false);
  });

  it('working / no_data / timeout tekrar sorulur', () => {
    expect(shouldRetryOutcome('working')).toBe(true);
    expect(shouldRetryOutcome('no_data')).toBe(true);
    expect(shouldRetryOutcome('timeout')).toBe(true);
  });
});

describe('NRC → sonuç (ISO 14229-1 Tablo A.1)', () => {
  it('0x78 responsePending NİHAİ sonuç değildir → null', () => {
    expect(classifyNrc(NRC_RESPONSE_PENDING)).toBeNull();
    expect(NRC_RESPONSE_PENDING).toBe(0x78);
  });

  it('araç kimliği tanımıyor → unsupported', () => {
    expect(classifyNrc(0x11)).toBe('unsupported'); // serviceNotSupported
    expect(classifyNrc(0x12)).toBe('unsupported'); // subFunctionNotSupported
    expect(classifyNrc(0x31)).toBe('unsupported'); // requestOutOfRange (en yaygın)
    expect(classifyNrc(0x7F)).toBe('unsupported'); // serviceNotSupportedInActiveSession
  });

  it('güvenlik ailesi → security_required (bypass KAPSAM DIŞI)', () => {
    expect(classifyNrc(0x33)).toBe('security_required'); // securityAccessDenied
    expect(classifyNrc(0x34)).toBe('security_required'); // authenticationRequired
    expect(classifyNrc(0x35)).toBe('security_required'); // invalidKey
    expect(classifyNrc(0x36)).toBe('security_required'); // exceedNumberOfAttempts
  });

  it('koşul ailesi → condition_required', () => {
    expect(classifyNrc(0x22)).toBe('condition_required'); // conditionsNotCorrect
    expect(classifyNrc(0x24)).toBe('condition_required'); // requestSequenceError
    expect(classifyNrc(0x37)).toBe('condition_required'); // requiredTimeDelayNotExpired
    expect(classifyNrc(0x7E)).toBe('condition_required');
  });

  it('0x81-0x8F fiziksel koşul ailesi tümüyle condition_required', () => {
    // rpmTooHigh(81) rpmTooLow(82) engineIsRunning(83) engineIsNotRunning(84)
    // engineRunTimeTooLow(85) temperatureTooHigh(86) … vehicleSpeedTooHigh(88) …
    for (let nrc = 0x81; nrc <= 0x8F; nrc++) {
      expect(classifyNrc(nrc)).toBe('condition_required');
    }
  });

  it('bozuk isteğimiz → parse_error (profil/decode hatamız)', () => {
    expect(classifyNrc(0x13)).toBe('parse_error'); // incorrectMessageLength
    expect(classifyNrc(0x14)).toBe('parse_error'); // responseTooLong
  });

  it('ECU meşgul → timeout (araç hakkında kanıt değil)', () => {
    expect(classifyNrc(0x21)).toBe('timeout');           // busyRepeatRequest
    expect(isCapabilityEvidence(classifyNrc(0x21)!)).toBe(false);
  });

  it('alt ECU sessiz → no_data', () => {
    expect(classifyNrc(0x25)).toBe('no_data'); // noResponseFromSubnetComponent
  });

  it('ZERO-TRUST: bilinmeyen NRC kalıcı ELEMEZ (kanıt aşımı yok)', () => {
    // ECU aktif olarak yanıt verdi → kimlik muhtemelen VAR; sebebi bilmiyoruz.
    // Kalıcı "unsupported" demek, kanıtın söylemediğini iddia etmek olurdu.
    for (const nrc of [0x01, 0x40, 0x55, 0x99, 0xF0, 0xFF]) {
      const out = classifyNrc(nrc)!;
      expect(out).toBe('condition_required');
      expect(isPermanentOutcome(out)).toBe(false);
    }
  });

  it('geçersiz NRC girdisi muhafazakâr davranır (fail-soft, throw YOK)', () => {
    expect(classifyNrc(-1)).toBe('condition_required');
    expect(classifyNrc(256)).toBe('condition_required');
    expect(classifyNrc(1.5)).toBe('condition_required');
    expect(classifyNrc(NaN)).toBe('condition_required');
  });
});

describe('ham ELM327 yanıtı → sonuç', () => {
  it('pozitif yanıt + çözüldü → working', () => {
    expect(classifyElmResponse({ kind: 'OK', nrc: null, decoded: true })).toBe('working');
  });

  it('KRİTİK: pozitif yanıt + çözülemedi → parse_error (no_data DEĞİL)', () => {
    // ECU veriyi VERDİ; kaybeden bizim decode'umuz. Bunu 'no_data' saymak, sağlam bir
    // DID'i "araç vermiyor" diye suçlamak olurdu.
    expect(classifyElmResponse({ kind: 'OK', nrc: null, decoded: false })).toBe('parse_error');
  });

  it('NO DATA → no_data', () => {
    expect(classifyElmResponse({ kind: 'NO_DATA', nrc: null, decoded: false })).toBe('no_data');
  });

  it('NEG_7F NRC ile → NRC kararı uygulanır', () => {
    expect(classifyElmResponse({ kind: 'NEG_7F', nrc: 0x31, decoded: false })).toBe('unsupported');
    expect(classifyElmResponse({ kind: 'NEG_7F', nrc: 0x33, decoded: false })).toBe('security_required');
    expect(classifyElmResponse({ kind: 'NEG_7F', nrc: 0x22, decoded: false })).toBe('condition_required');
  });

  it('NEG_7F NRC=0x78 → nihai değil (null) — çalışan DID yanlışlıkla elenmez', () => {
    expect(classifyElmResponse({ kind: 'NEG_7F', nrc: 0x78, decoded: false })).toBeNull();
  });

  it('NEG_7F ama NRC yok (eski köprü) → muhafazakâr condition_required, kalıcı eleme YOK', () => {
    const out = classifyElmResponse({ kind: 'NEG_7F', nrc: null, decoded: false })!;
    expect(out).toBe('condition_required');
    expect(isPermanentOutcome(out)).toBe(false);
  });

  it('hat/protokol hatası → timeout (kanıt değil)', () => {
    for (const kind of ['ERROR', 'TIMEOUT_PARTIAL'] as const) {
      const out = classifyElmResponse({ kind, nrc: null, decoded: false })!;
      expect(out).toBe('timeout');
      expect(isCapabilityEvidence(out)).toBe(false);
    }
  });

  it('BUSY (SEARCHING/BUS INIT) nihai değildir → null, öğrenme YOK', () => {
    expect(classifyElmResponse({ kind: 'BUSY', nrc: null, decoded: false })).toBeNull();
  });

  it('bilinmeyen kind (ileri köprü sürümü) → timeout, kanıt sayılmaz (fail-soft)', () => {
    const out = classifyElmResponse({
      kind: 'FUTURE_KIND' as never, nrc: null, decoded: false,
    })!;
    expect(out).toBe('timeout');
    expect(isCapabilityEvidence(out)).toBe(false);
  });
});

describe('mergeOutcome — araca inan, hafızaya değil', () => {
  it('canlı kanıt hafızayı ezer (dongle Doblo→Trafic senaryosu)', () => {
    // Hafıza "bu DID çalışıyor" diyor; yeni araç "böyle bir DID yok" diyor → araca inan.
    expect(mergeOutcome('working', 'unsupported')).toBe('unsupported');
    expect(mergeOutcome('working', 'no_data')).toBe('no_data');
    expect(mergeOutcome('unsupported', 'working')).toBe('working');
  });

  it('ilk kanıt doğrudan yazılır', () => {
    expect(mergeOutcome(null, 'working')).toBe('working');
    expect(mergeOutcome(null, 'unsupported')).toBe('unsupported');
  });

  it('kanıt-olmayan (timeout) hiçbir geçişi tetiklemez', () => {
    for (const prev of CAPABILITY_OUTCOMES) {
      expect(mergeOutcome(prev, 'timeout')).toBe(prev);
    }
  });

  it('idempotent: aynı kanıt tekrar gelince sonuç değişmez', () => {
    for (const o of CAPABILITY_OUTCOMES) {
      const first = mergeOutcome(null, o);
      expect(mergeOutcome(first, o)).toBe(first);
    }
  });

  it('SAF: girdi mutasyona uğramaz, throw yok (fail-soft sözleşmesi)', () => {
    const outcomes: CapabilityOutcome[] = [...CAPABILITY_OUTCOMES];
    for (const prev of outcomes) {
      for (const next of outcomes) {
        expect(() => mergeOutcome(prev, next)).not.toThrow();
      }
    }
    expect(CAPABILITY_OUTCOMES).toHaveLength(7); // dondurulmuş sözlük bozulmadı
  });
});
