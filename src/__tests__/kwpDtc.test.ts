/**
 * OBD-OS-F3-3 — KWP2000 ReadDTCByStatus (0x18) ayrıştırması.
 *
 * KRİTİK FARK: KWP DTC'si 2 BAYTTIR (UDS 0x19'da 3). UDS çözücüsünü KWP gövdesine
 * uygulamak tüm listeyi kaydırır → sessiz veri bozulması. Bu testler o sınırı kilitler.
 *
 * KWP araçlar (Trafic, eski Doblo, çoğu 2000-2008 Avrupa aracı) UDS 0x19'u TANIMAZ;
 * üretici kodları 0x18'de yaşar.
 */
import { describe, it, expect } from 'vitest';
import { parseKwpDtcResponse } from '../platform/obd/kwpDtc';
import { parseUdsDtcResponse } from '../platform/obd/udsDtc';

describe('OBD-OS-F3-3 — parseKwpDtcResponse', () => {
  it('🔒 KİLİT: 3 baytlık kayıtlar (DTC 2 bayt + status) doğru çözülür', () => {
    // count(02) + P0301(0301,status 09) + C1234(5234, status 04)
    const raw = '02' + '0301' + '09' + '5234' + '04';
    const dtcs = parseKwpDtcResponse(raw);

    expect(dtcs).toHaveLength(2);
    expect(dtcs[0]!.code).toBe('P0301');
    expect(dtcs[0]!.status.confirmed).toBe(true);
    expect(dtcs[0]!.status.testFailed).toBe(true);
    expect(dtcs[1]!.code).toBe('C1234');
    expect(dtcs[1]!.status.pending).toBe(true);
  });

  it('🔒 KİLİT: KWP gövdesi UDS çözücüsüyle ÇÖZÜLMEZ (kayıt boyu farkı — sessiz bozulma tuzağı)', () => {
    const raw = '02' + '0301' + '09' + '5234' + '04';
    const kwp = parseKwpDtcResponse(raw);
    const asUds = parseUdsDtcResponse(raw);   // yanlış çözücü → yanlış/kaymış sonuç

    expect(kwp.map((d) => d.code)).toEqual(['P0301', 'C1234']);
    // UDS çözücüsü aynı gövdeden AYNI kodları ÜRETEMEZ (kayıt boyu 4 bayt sanıyor).
    expect(asUds.map((d) => d.code)).not.toEqual(['P0301', 'C1234']);
  });

  it('ham DTC baytları KORUNUR (üretici DF tablosu eşlemesi için)', () => {
    const dtcs = parseKwpDtcResponse('01' + '0301' + '09');
    expect(dtcs[0]!.rawDtc).toBe('0301');
    expect(dtcs[0]!.rawStatus).toBe('09');
  });

  it('ZERO-TRUST: count alanına körü körüne güvenilmez — gerçek kayıtlar sayılır', () => {
    // ECU "5 kod var" diyor ama gövdede 1 kayıt var → 1 döner (uydurma YOK).
    const dtcs = parseKwpDtcResponse('05' + '0301' + '09');
    expect(dtcs).toHaveLength(1);
  });

  it('kırık son kayıt sessizce atlanır; dolgu (0000) kod sayılmaz', () => {
    expect(parseKwpDtcResponse('02' + '0301' + '09' + '52')).toHaveLength(1);
    expect(parseKwpDtcResponse('02' + '0000' + '00' + '0301' + '09')).toHaveLength(1);
  });

  it('boş / çok kısa gövde → boş liste', () => {
    expect(parseKwpDtcResponse('')).toEqual([]);
    expect(parseKwpDtcResponse('02')).toEqual([]);
  });

  it('boşluklu hex de çözülür', () => {
    const dtcs = parseKwpDtcResponse('01 03 01 09');
    expect(dtcs).toHaveLength(1);
    expect(dtcs[0]!.code).toBe('P0301');
  });
});
