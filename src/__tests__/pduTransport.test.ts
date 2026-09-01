/**
 * pduTransport.test.ts — P0-VDK-F3A · PDU SINIRI KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ
 * ══════════════════════════════════════════════════════════════════════════
 * "Bir tanı isteği taşımadan bağımsız ifade edilebiliyor; aynı PDU hem gerçek
 *  ELM327 köprüsüne hem doğrulanmış ize gönderilebiliyor; taşımanın
 *  TAŞIYAMADIĞI bir PDU **araç hakkında bir iddiaya dönüşmüyor**."
 *
 * En kritik ayrım bu sonuncusudur:
 *   `NOT_SUPPORTED_BY_TRANSPORT` = "biz soramadık"
 *   `NEGATIVE`                   = "araç desteklemiyor dedi"
 * İkisini karıştırmak, ürünün defalarca ödediği kusur sınıfıdır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
    probeEcus: vi.fn(), readUdsDtcs: vi.fn(), readDTC: vi.fn(),
  },
}));

import { CarLauncher } from '../platform/nativePlugin';
import {
  makePdu, pduTarget, encodePduRequest, pduIdentity, addressingFromHeader,
  isAddressable, isPduCoverageLoss, pduOutcomeFromAdvanced, pduOutcomeFromDtcClass,
  advancedOutcomeFromPdu, FUNCTIONAL_TARGET,
} from '../platform/obd/pdu';
import {
  ElmPduTransport, VirtualPduTransport, canCarry,
} from '../platform/obd/pduTransport';
import { GENERIC_READ_ONLY_SERVICES } from '../platform/obd/genericPduTransport';

beforeEach(() => {
  for (const m of ['readDtcClass', 'readDtcFromEcu', 'readAdvancedDtcs',
    'sendTesterPresent'] as const) {
    vi.mocked(CarLauncher[m]!).mockReset();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) SÖZLEŞME — adresleme ve künye
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · A) PDU sözleşmesi', () => {
  it('🔒 adresleme başlık UZUNLUĞUNDAN ÖLÇÜLÜR — tahmin edilmez', () => {
    expect(addressingFromHeader(null)).toBe('functional');
    expect(addressingFromHeader('7E0')).toBe('physical_can11');
    expect(addressingFromHeader('817AF1')).toBe('physical_kwp');
    expect(addressingFromHeader('18DA10F1')).toBe('physical_can29');
  });

  it('🔒 TANINMAYAN adres `unknown` — "muhtemelen CAN" YOK', () => {
    expect(addressingFromHeader('7E')).toBe('unknown');
    expect(addressingFromHeader('ZZZZ')).toBe('unknown');
    expect(addressingFromHeader('7E0F')).toBe('unknown');
  });

  it('🔒 `unknown` adres ADRESLENEMEZ (fail-closed)', () => {
    expect(isAddressable(pduTarget('7E0', '7E8'))).toBe(true);
    expect(isAddressable(pduTarget('ZZ', null))).toBe(false);
    expect(isAddressable(FUNCTIONAL_TARGET)).toBe(true);
  });

  it('🔒 KÜNYE: servis + alt fonksiyon + gövde', () => {
    expect(encodePduRequest(makePdu({ service: '19', subFunction: '02', payload: 'FF' })))
      .toBe('1902FF');
    expect(encodePduRequest(makePdu({ service: '03' }))).toBe('03');
    expect(encodePduRequest(makePdu({ service: '3E', subFunction: '00' }))).toBe('3E00');
  });

  it('🔒 alt fonksiyon servisin KENDİSİYSE tekrar YAZILMAZ (18-18 · 13-13)', () => {
    expect(encodePduRequest(makePdu({ service: '18', subFunction: '18', payload: '00FF00' })))
      .toBe('1800FF00');
    expect(encodePduRequest(makePdu({ service: '13', subFunction: '13', payload: '' })))
      .toBe('13');
  });

  it('🔒 künye ECU hedefini de taşır — iki ECU aynı isteği AYRI sorar', () => {
    const a = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') });
    const b = makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E1', '7E9') });
    expect(pduIdentity(a)).not.toBe(pduIdentity(b));
  });

  it('🔒 KAPSAM KAYBI sınıfları: NEGATIVE kapsam kaybı DEĞİLDİR', () => {
    expect(isPduCoverageLoss('NEGATIVE'), 'ECU cevap verdi — kapsam kaybı değil').toBe(false);
    expect(isPduCoverageLoss('POSITIVE')).toBe(false);
    for (const o of ['NO_RESPONSE', 'TIMEOUT', 'MALFORMED', 'TRANSPORT_ERROR',
      'NOT_ADDRESSABLE', 'NOT_SUPPORTED_BY_TRANSPORT', 'UNKNOWN'] as const) {
      expect(isPduCoverageLoss(o), o).toBe(true);
    }
  });

  it('🔒 sözlük çevirisi TEK YER ve gidiş-dönüş tutarlı', () => {
    for (const n of ['ok', 'negative_nrc', 'no_response', 'timeout',
      'malformed', 'not_addressable'] as const) {
      expect(advancedOutcomeFromPdu(pduOutcomeFromAdvanced(n)), n).toBe(n);
    }
    /* TANINMAYAN değer fail-closed UNKNOWN'a düşer, "ok" DEĞİL. */
    expect(pduOutcomeFromAdvanced('bilinmeyen')).toBe('UNKNOWN');
    expect(pduOutcomeFromAdvanced(undefined)).toBe('UNKNOWN');
  });

  it('🔒 `readDtcClass` sözlüğü: UNSUPPORTED = açık negatif yanıt', () => {
    expect(pduOutcomeFromDtcClass('OK')).toBe('POSITIVE');
    expect(pduOutcomeFromDtcClass('UNSUPPORTED')).toBe('NEGATIVE');
    expect(pduOutcomeFromDtcClass('NO_RESPONSE')).toBe('NO_RESPONSE');
    expect(pduOutcomeFromDtcClass('BUS_ERROR')).toBe('TRANSPORT_ERROR');
    expect(pduOutcomeFromDtcClass('NO_SID')).toBe('MALFORMED');
    expect(pduOutcomeFromDtcClass('bilinmeyen')).toBe('UNKNOWN');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) ELM TAŞIMASI — mevcut köprüye eşleme
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · B) ELM327 taşıması', () => {
  const t = new ElmPduTransport();

  it('🔒 Mode 03 FONKSİYONEL → readDtcClass', async () => {
    vi.mocked(CarLauncher.readDtcClass!).mockResolvedValue({
      codes: [], raw: '43 00', supported: true, outcome: 'OK', elapsedMs: 42, protocol: '6',
    });
    const r = await t.send(makePdu({ service: '03' }));
    expect(CarLauncher.readDtcClass).toHaveBeenCalledWith({ mode: '03' });
    expect(r.outcome).toBe('POSITIVE');
    expect(r.raw).toBe('43 00');
    expect(r.latencyMs).toBe(42);
  });

  it('🔒 Mode 03 FİZİKSEL → readDtcFromEcu (farklı metot, aynı PDU)', async () => {
    vi.mocked(CarLauncher.readDtcFromEcu!).mockResolvedValue({
      codes: [], raw: '43 00', supported: true, outcome: 'OK', elapsedMs: 30,
    });
    const r = await t.send(makePdu({ service: '03', target: pduTarget('7E0', '7E8') }));
    expect(CarLauncher.readDtcFromEcu).toHaveBeenCalledWith({ tx: '7E0', rx: '7E8', mode: '03' });
    expect(r.outcome).toBe('POSITIVE');
  });

  it('🔒 UDS 0x19 → readAdvancedDtcs, gövde ve tuning bayrağı taşınır', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockResolvedValue({
      raw: 'FF0380110', kind: 'OK', outcome: 'ok', byteCount: 9, frameCount: 2,
      sessionOpened: true, sessionCommand: '1003',
      tuningApplied: true, tuningCommands: 'ATFCSH7E0=OK', tuningRestored: true,
    });
    const r = await t.send(
      makePdu({ service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8') }),
      { isoTpTuning: true },
    );
    expect(vi.mocked(CarLauncher.readAdvancedDtcs!).mock.calls[0]![0]).toMatchObject({
      service: '19', subFunction: '02', payload: 'FF', tx: '7E0', rx: '7E8', isoTpTuning: true,
    });
    expect(r.outcome).toBe('POSITIVE');
    expect(r.byteCount).toBe(9);
    expect(r.frameCount).toBe(2);
    expect(r.session).toEqual({ opened: true, command: '1003' });
    expect(r.tuning?.applied).toBe(true);
    expect(r.tuning?.restored).toBe(true);
  });

  it('🔒 TesterPresent → sendTesterPresent', async () => {
    vi.mocked(CarLauncher.sendTesterPresent!).mockResolvedValue({
      raw: '7E00', kind: 'OK', outcome: 'ok',
    });
    const r = await t.send(makePdu({
      service: '3E', subFunction: '00', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('POSITIVE');
    expect(r.raw).toBe('7E00');
  });

  it('🔒 ANA KİLİT: taşınamayan PDU "araç desteklemiyor" DEMEZ', async () => {
    /* Servis 0x22 (ReadDataByIdentifier) köprüde bu yoldan taşınmıyor. */
    const r = await t.send(makePdu({
      service: '22', payload: 'F190', target: pduTarget('7E0', '7E8'),
    }));
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    expect(r.outcome).not.toBe('NEGATIVE');
    expect(r.raw, 'gönderilmemiş istek için ham yanıt UYDURULDU').toBeNull();
    expect(r.detail).toMatch(/servis 22/);
    /* Bu bir KAPSAM KAYBIdır — "temiz" sayılamaz. */
    expect(isPduCoverageLoss(r.outcome)).toBe(true);
  });

  it('🔒 ADRESLENEMEZ hedefe istek GÖNDERİLMEZ', async () => {
    const r = await t.send(makePdu({ service: '19', subFunction: '02', target: pduTarget('ZZ', null) }));
    expect(r.outcome).toBe('NOT_ADDRESSABLE');
    expect(CarLauncher.readAdvancedDtcs).not.toHaveBeenCalled();
  });

  it('🔒 ESKİ APK (metot yok) → NOT_SUPPORTED_BY_TRANSPORT, ürün çökmez', async () => {
    const saved = CarLauncher.readAdvancedDtcs;
    // @ts-expect-error — eski APK simülasyonu
    CarLauncher.readAdvancedDtcs = undefined;
    const r = await t.send(makePdu({ service: '19', subFunction: '02', target: pduTarget('7E0', '7E8') }));
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    expect(r.detail).toMatch(/eski APK/);
    CarLauncher.readAdvancedDtcs = saved;
  });

  it('🔒 native İSTİSNA fırlatırsa taşıma hatası SONUÇ olur (throw etmez)', async () => {
    vi.mocked(CarLauncher.readAdvancedDtcs!).mockRejectedValue(new Error('bağlantı koptu'));
    const r = await t.send(makePdu({ service: '19', subFunction: '02', target: pduTarget('7E0', '7E8') }));
    expect(r.outcome).toBe('TRANSPORT_ERROR');
    expect(r.detail).toBe('bağlantı koptu');
  });

  it('🔒 yetenek beyanı DÜRÜST: genel PDU yolu YOK', () => {
    expect(t.capabilities.supportsArbitraryPdu,
      'köprüde genel PDU metodu olmadığı hâlde VAR denildi').toBe(false);
    expect(canCarry(t, makePdu({ service: '19', target: pduTarget('7E0', '7E8') }))).toBe(true);
    expect(canCarry(t, makePdu({ service: '22', target: pduTarget('7E0', '7E8') }))).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) SANAL TAŞIMA — yanıt UYDURMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · C) sanal taşıma', () => {
  it('🔒 teslim ENJEKTE edilir — sanal taşıma ize DOĞRUDAN bağlanmaz', async () => {
    const seen: string[] = [];
    const v = new VirtualPduTransport(async (pdu) => {
      seen.push(encodePduRequest(pdu));
      return {
        outcome: 'POSITIVE', raw: 'FF08332909', nrc: null, latencyMs: 5,
        byteCount: 5, frameCount: 1, protocol: '6', transportKind: 'ok',
        session: null, tuning: null, detail: null,
      };
    });
    const r = await v.send(makePdu({
      service: '19', subFunction: '02', payload: 'FF', target: pduTarget('7E0', '7E8'),
    }));
    expect(seen).toEqual(['1902FF']);
    expect(r.outcome).toBe('POSITIVE');
  });

  /* ══════════════════════════════════════════════════════════════════════
     KİLİT GÜNCELLENDİ — P0-VDK-F6A (kaldırılmadı, DOĞRU REFERANSA taşındı)
     ══════════════════════════════════════════════════════════════════════
     Kilidin AMACI: sanal taşıma, GERÇEK ürün yolunun taşıyabildiğinden FAZLA
     servis taşıyormuş gibi görünmemeli — aksi hâlde replay, sahada asla
     gönderilemeyecek bir isteği "başarılı" gösterirdi.

     F4-A'dan beri gerçek ürün yolu ARTIK LEGACY DEĞİL, HİBRİTTİR: legacy'nin
     taşıyamadığı salt-okunur servisler (`21` · `22` · `1A` …) GENEL köprüden
     gider. F6-A'da DID okuması (`22`/`21`) kanonik ize girdiği için sanal
     taşıma da onu taşımak ZORUNDADIR; referansı legacy'de bırakmak, kilidi
     ölçtüğü şeyden koparırdı.

     Yeni referans: sanal küme ⊆ (legacy ∪ genel köprünün İZİN VERDİĞİ küme). */
  it('🔒 sanal taşıma GERÇEK taşımadan FAZLA servis taşıyormuş gibi görünmez', () => {
    const v = new VirtualPduTransport(async () => {
      throw new Error('çağrılmamalı');
    });
    const real = new Set<string>([
      ...new ElmPduTransport().capabilities.supportedServices,
      ...GENERIC_READ_ONLY_SERVICES,
    ]);
    for (const svc of v.capabilities.supportedServices) {
      expect(real.has(svc), `sanal taşıma ${svc} taşıyor ama gerçek yol taşımıyor`)
        .toBe(true);
    }
    /* Sanal taşıma HÂLÂ keyfi PDU taşıdığını İDDİA ETMEZ. */
    expect(v.capabilities.supportsArbitraryPdu).toBe(false);
  });

  it('🔒 desteklenmeyen servis TESLİME HİÇ ULAŞMAZ', async () => {
    let called = false;
    const v = new VirtualPduTransport(async () => {
      called = true;
      throw new Error('ulaşmamalıydı');
    });
    /* `09` (araç bilgisi) izde operasyon karşılığı OLMAYAN bir servistir;
       F6-A'da `22` taşınabilir hâle geldiği için örnek GÜNCELLENDİ — kilidin
       ölçtüğü şey değişmedi: taşınamayan bir PDU teslime HİÇ ulaşmaz. */
    const r = await v.send(makePdu({ service: '09', target: pduTarget('7E0', '7E8') }));
    expect(called).toBe(false);
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
  });

  it('🔒 teslim İSTİSNA fırlatırsa taşıma hatası SONUÇ olur', async () => {
    const v = new VirtualPduTransport(async () => { throw new Error('iz bozuk'); });
    const r = await v.send(makePdu({ service: '03' }));
    expect(r.outcome).toBe('TRANSPORT_ERROR');
    expect(r.detail).toBe('iz bozuk');
  });

  it('🔒 adreslenemez hedef teslime ULAŞMAZ', async () => {
    let called = false;
    const v = new VirtualPduTransport(async () => {
      called = true;
      throw new Error('ulaşmamalıydı');
    });
    const r = await v.send(makePdu({ service: '19', target: pduTarget('ZZ', null) }));
    expect(called).toBe(false);
    expect(r.outcome).toBe('NOT_ADDRESSABLE');
  });
});
