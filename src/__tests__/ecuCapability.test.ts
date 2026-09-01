/**
 * ecuCapability.test.ts — P0-OBD-PARITY · ECU YETENEK KÜNYESİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KUSUR: "bu ECU'ya ne sorabildik ve ne cevap verdi" sorusunun cevabı
 * BEŞ ayrı deftere dağılmıştı. Daha kötüsü, o defterlerin çoğu sonucu İKİYE
 * indiriyordu ("çalıştı / çalışmadı") — o an **"soruldu ve servis yok"** ile
 * **"hiç sorulmadı"** ile **"ECU sustu"** aynı kutuya düşüyor ve ürün
 * kapsam yalanı üretiyordu.
 *
 * Bu dosya DOKUZ durumun ayrı kalmasını ve "tam kapsam" iddiasının kanıta
 * bağlı olmasını kilitler.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEcuCapability, deriveServiceCapability, evaluateEcuClearReadiness,
  isCapabilityCoverageLoss, isCapabilityMeasured, summarizeEcuCapabilities,
  type EcuCapabilityInput, type EcuServiceCapability,
} from '../platform/obd/ecuCapabilityModel';
import { isEcuReadable } from '../platform/obd/multiEcuScan';

type Measured = EcuCapabilityInput['measured'];

function input(over: Partial<EcuCapabilityInput> = {}): EcuCapabilityInput {
  return {
    rxHeader: '7E8', txHeader: '7E0', label: 'Motor (ECM)', role: 'engine',
    addressBits: 11, protocol: '6', addressing: 'PROVEN',
    addressingReason: 'fiziksel Mode 03 cevapladı', session: 'NOT_REQUIRED',
    sessionEpoch: 3, lastValidatedAtMs: 1_700_000_000_000,
    measured: new Map() as Measured,
    ...over,
  };
}

function measured(
  rows: ReadonlyArray<[string, Parameters<typeof deriveServiceCapability>[0], number | null, string?]>,
): Measured {
  const m = new Map();
  for (const [key, outcome, codeCount, diag] of rows) {
    m.set(key, { outcome, codeCount, diagnosticOutcome: diag ?? null });
  }
  return m as Measured;
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) DOKUZ DURUM AYRI KALIR
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · A) servis yeteneği sınıflaması', () => {
  it('🔒 ANA KİLİT: "kayıt yok" ile "servis yok" ile "sorulmadı" ile "ECU sustu" AYRI', () => {
    expect(deriveServiceCapability('ok', 0)).toBe('SUPPORTED_EMPTY');
    expect(deriveServiceCapability('unsupported', null)).toBe('UNSUPPORTED');
    expect(deriveServiceCapability('not_scanned', null)).toBe('NOT_QUERIED');
    expect(deriveServiceCapability('no_data', null)).toBe('NO_RESPONSE');
    expect(deriveServiceCapability('timeout', null)).toBe('NO_RESPONSE');
    expect(deriveServiceCapability('deferred', null)).toBe('NOT_QUERIED');
  });

  it('pozitif yanıt + kayıt → DESTEKLİ-kayıt var', () => {
    expect(deriveServiceCapability('ok', 20)).toBe('SUPPORTED_WITH_DATA');
  });

  it('🔒 KİLİT: bozuk gövde PARSE_FAILED — "kod yok" SAYILMAZ', () => {
    expect(deriveServiceCapability('failed', null, 'malformed')).toBe('PARSE_FAILED');
  });

  it('🔒 KİLİT: oturum/koşul reddi AYRI — servis VAR ama bu oturumda kapalı', () => {
    expect(deriveServiceCapability('failed', null, 'security_required')).toBe('SESSION_FAILED');
    expect(deriveServiceCapability('failed', null, 'condition_required')).toBe('SESSION_FAILED');
  });

  it('🔒 KİLİT: adreslenemeyen istek "sorulmadı" DEĞİL — ayrı kök neden', () => {
    expect(deriveServiceCapability(null, null, 'not_addressable')).toBe('NOT_ADDRESSABLE');
  });

  it('🔒 KAPSAM KURALI: yalnız ÜÇ durum kayıp DEĞİLDİR (ölçülmüş gerçekler)', () => {
    const notLoss: EcuServiceCapability[] = ['SUPPORTED_WITH_DATA', 'SUPPORTED_EMPTY', 'UNSUPPORTED'];
    for (const c of notLoss) {
      expect(isCapabilityCoverageLoss(c), c).toBe(false);
      expect(isCapabilityMeasured(c), c).toBe(true);
    }
    const loss: EcuServiceCapability[] = [
      'NO_RESPONSE', 'NEGATIVE_RESPONSE', 'SESSION_FAILED',
      'PARSE_FAILED', 'NOT_ADDRESSABLE', 'NOT_QUERIED',
    ];
    for (const c of loss) {
      expect(isCapabilityCoverageLoss(c), c).toBe(true);
      expect(isCapabilityMeasured(c), c).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) KÜNYE — sorulmayan servis GİZLENMEZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · B) ECU künyesi', () => {
  it('🔒 ANA KİLİT: YEDİ kanonik servis satırı HER ZAMAN basılır (eksik = SORULMADI)', () => {
    const cap = buildEcuCapability(input({ measured: measured([['03|03', 'ok', 1]]) }));
    expect(cap.services.map((s) => `${s.service}-${s.subFunction}`))
      .toEqual(['03-03', '07-07', '0A-0A', '19-02', '19-0A', '18-18', '13-13']);
    expect(cap.services.filter((s) => s.capability === 'NOT_QUERIED')).toHaveLength(6);
  });

  it('🔒 KİLİT: 19-02 ve 19-0A AYRI satırdır (alt fonksiyon ayrımı kaybolamaz)', () => {
    const cap = buildEcuCapability(input({
      measured: measured([['19|02', 'unsupported', null], ['19|0A', 'ok', 4]]),
    }));
    const s02 = cap.services.find((s) => s.subFunction === '02')!;
    const s0A = cap.services.find((s) => s.subFunction === '0A' && s.service === '19')!;
    expect(s02.capability).toBe('UNSUPPORTED');
    expect(s0A.capability).toBe('SUPPORTED_WITH_DATA');
    expect(s0A.codeCount).toBe(4);
  });

  it('🔒 KİLİT: adres kanıtlanmadıysa servisler "SORULMADI" değil "ADRESLENEMEDİ"', () => {
    const cap = buildEcuCapability(input({ addressing: 'NOT_ADDRESSABLE', measured: new Map() as Measured }));
    expect(cap.services.every((s) => s.capability === 'NOT_ADDRESSABLE')).toBe(true);
    expect(cap.coverageGaps).toHaveLength(7);
  });

  it('🔒 KİLİT: hiç ölçüm yoksa toplam kod `null` — 0 yazmak "kod yok" YALANI olurdu', () => {
    const cap = buildEcuCapability(input({ measured: new Map() as Measured }));
    expect(cap.totalCodes).toBeNull();
  });

  it('🔒 KİLİT: hiç servis sorulmadıysa güven `null` — "%0 güven" ile AYNI DEĞİL', () => {
    expect(buildEcuCapability(input({ measured: new Map() as Measured })).confidence).toBeNull();
  });

  it('güven = ölçülen / sorulan oranıdır', () => {
    const cap = buildEcuCapability(input({
      measured: measured([
        ['03|03', 'ok', 0], ['07|07', 'ok', 0],
        ['19|02', 'no_data', null], ['19|0A', 'timeout', null],
      ]),
    }));
    expect(cap.confidence).toBe(0.5);          // 2 ölçüldü / 4 soruldu
    /* Boşluk = ölçülmemiş HER satır: iki sessizlik (19-02 · 19-0A) + hiç
       sorulmayan üç servis (0A · 18 · 13). "Sorulmadı" da bir kapsam
       kaybıdır — sorulmamış bir servisi boşluk saymamak, tam olarak bu
       modelin engellediği sessiz kapsam yalanı olurdu. */
    expect(cap.coverageGaps).toHaveLength(5);
    expect(cap.coverageGaps.filter((g) => g.includes('ECU SUSTU'))).toHaveLength(2);
    expect(cap.coverageGaps.filter((g) => g.includes('SORULMADI'))).toHaveLength(3);
  });

  it('ölçülen satırlardan toplam kod hesaplanır', () => {
    const cap = buildEcuCapability(input({
      measured: measured([['19|02', 'ok', 14], ['19|0A', 'ok', 6], ['03|03', 'ok', 0]]),
    }));
    expect(cap.totalCodes).toBe(20);
  });

  it('rol KANIT yoksa null KALIR (adresten rol uydurulmaz)', () => {
    expect(buildEcuCapability(input({ role: null })).role).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) SİLME KANIT ZİNCİRİ — İZİN DEĞİL, KANIT ÖZETİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · C) silme kanıt zinciri', () => {
  it('🔒 ANA KİLİT: adres kanıtlanmadıysa BLOCKED (destructive komut YASAK)', () => {
    const cap = buildEcuCapability(input({
      addressing: 'UNKNOWN', measured: measured([['19|02', 'ok', 5]]),
    }));
    expect(evaluateEcuClearReadiness(cap)).toBe('BLOCKED');
  });

  it('🔒 KİLİT: oturum REDDEDİLDİYSE BLOCKED', () => {
    const cap = buildEcuCapability(input({
      session: 'REFUSED', measured: measured([['19|02', 'ok', 5]]),
    }));
    expect(evaluateEcuClearReadiness(cap)).toBe('BLOCKED');
  });

  it('🔒 KİLİT: hiçbir servis ÖLÇÜLMEDİYSE BLOCKED — "kayıt yok" DENMEZ', () => {
    const cap = buildEcuCapability(input({
      measured: measured([['19|02', 'no_data', null]]),
    }));
    expect(evaluateEcuClearReadiness(cap)).toBe('BLOCKED');
  });

  it('zincir tam + kayıt var → READY (yine de bir İZİN DEĞİL)', () => {
    const cap = buildEcuCapability(input({ measured: measured([['19|02', 'ok', 3]]) }));
    expect(evaluateEcuClearReadiness(cap)).toBe('READY');
  });

  it('zincir tam + kayıt yok → NOTHING_TO_CLEAR', () => {
    const cap = buildEcuCapability(input({ measured: measured([['19|02', 'ok', 0]]) }));
    expect(evaluateEcuClearReadiness(cap)).toBe('NOTHING_TO_CLEAR');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) ARAÇ ÖZETİ — "tam kapsam" iddiası kanıta bağlı
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · D) araç özeti', () => {
  const full = () => buildEcuCapability(input({
    measured: measured([
      ['03|03', 'ok', 0], ['07|07', 'ok', 0], ['0A|0A', 'unsupported', null],
      ['19|02', 'ok', 2], ['19|0A', 'unsupported', null],
      ['18|18', 'unsupported', null], ['13|13', 'unsupported', null],
    ]),
  }));

  it('🔒 ANA KİLİT: tek boşluk bile varsa TAM KAPSAM İDDİA EDİLEMEZ', () => {
    const gappy = buildEcuCapability(input({
      rxHeader: '7E9', measured: measured([['03|03', 'ok', 0], ['19|02', 'no_data', null]]),
    }));
    expect(summarizeEcuCapabilities([full(), gappy]).fullCoverageProven).toBe(false);
  });

  it('🔒 KİLİT: hiç ECU künyesi yoksa TAM KAPSAM iddia EDİLEMEZ (boş ≠ temiz)', () => {
    expect(summarizeEcuCapabilities([]).fullCoverageProven).toBe(false);
  });

  it('yedi servisin hepsi ölçüldüyse tam kapsam KANITLANIR', () => {
    const sum = summarizeEcuCapabilities([full()]);
    expect(sum.fullCoverageProven).toBe(true);
    expect(sum.gapCount).toBe(0);
    expect(sum.totalCodes).toBe(2);
  });

  it('🔒 KİLİT: bir ECU’nun toplamı ölçülemediyse ARAÇ toplamı da BİLİNMEZ', () => {
    const unknown = buildEcuCapability(input({ rxHeader: '7EA', measured: new Map() as Measured }));
    expect(summarizeEcuCapabilities([full(), unknown]).totalCodes).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) OKUNABİLİRLİK KURALI — "yalnız UDS konuşan ECU" düşmüş SAYILMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-PARITY · E) ECU okunabilirlik kuralı', () => {
  type Scan = Parameters<typeof isEcuReadable>[0];
  const base = {
    ecu: {} as never, stored: 'failed', pending: 'failed', permanent: 'failed',
    uds: null, udsSupported: null, kwp: null, kwp13: null,
    codes: [], authorityCodes: [],
  } as unknown as Scan;

  it('🔒 ANA KİLİT: Mode 03/07/0A düşse de UDS 0x19-02 cevapladıysa ECU OKUNDU', () => {
    expect(isEcuReadable({ ...base, uds: 'ok' } as Scan)).toBe(true);
  });

  it('🔒 KİLİT: yalnız 0x19-0A cevapladıysa da ECU OKUNDU', () => {
    expect(isEcuReadable({ ...base, udsSupported: 'ok' } as Scan)).toBe(true);
  });

  it('🔒 ANA KİLİT: `unsupported` OKUNDU SAYILMAZ — ulaşılabilirlik ≠ arıza bilgisi', () => {
    /* "ECU bu servisi bilmiyor" ULAŞILDIĞININ kanıtıdır ama ARIZA BİLGİSİ
       DEĞİLDİR. Tüm servisleri düşmüş, yalnız birinde "bilmiyorum" demiş bir
       ECU'yu okundu saymak güveni olduğundan yüksek gösterirdi. */
    expect(isEcuReadable({ ...base, kwp13: 'unsupported' } as Scan)).toBe(false);
    expect(isEcuReadable({ ...base, uds: 'unsupported' } as Scan)).toBe(false);
  });

  it('🔒 FAIL-CLOSED: hepsi düştüyse okunamadı', () => {
    expect(isEcuReadable(base)).toBe(false);
  });

  it('🔒 FAIL-CLOSED: `deferred` ve `null` ULAŞILDI SAYILMAZ (ölçüm yok)', () => {
    expect(isEcuReadable({ ...base, uds: 'deferred' } as Scan)).toBe(false);
    expect(isEcuReadable({ ...base, udsSupported: null } as Scan)).toBe(false);
  });
});
