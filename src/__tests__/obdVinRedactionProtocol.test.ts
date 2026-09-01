/**
 * P0-VDK-FIELD-FIX-A · VIN REDAKSİYONU PROTOKOL-FARKINDA (B1 kilidi).
 *
 * SAHA (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA): `{"cmd":"0100",
 * "resp":"[VIN redacted]"}` — desteklenen PID bitmap'i (ECU keşfinin TEK kanıtı)
 * VIN sanılıp silindi. Kök neden: `_compact(resp).includes('4902')` — bayt hizası
 * ve servis bağlamı olmadan alt-dizi araması (#533 ile AYNI hata sınıfı).
 *
 * Bu dosya iki yönü BİRLİKTE kilitler:
 *   · YANLIŞ POZİTİF YOK → kanıt kaybolmaz (0100 · nibble kayması · durum sözcüğü)
 *   · YANLIŞ NEGATİF YOK → gerçek VIN her biçimde gizlenir (SF · ISO-TP · headers ON)
 * Biri için diğeri feda EDİLEMEZ.
 */
import { describe, it, expect } from 'vitest';
import {
  maskObdTrafficEntry,
  maskVinPayload,
  isVinResponse,
  isVinRequest,
  REDACTED_VIN,
} from '../platform/devtools/obdTrafficMask';

/* ── Gerçek araç ham'ı (kopya 1788096650111 · protokol 6 · ATS0 bitişik hex) ──── */
/** VIN DID yanıtı — `22F190`, ISO-TP çok frame. VIN DEĞİL (UDS DID), maskelenmez. */
const REAL_DID_F190 = '0160:62F190582B381:323933313034342:363042415A42313:4656AAAAAAAAAA';
/** Mode 03 DTC yanıtı — çok frame. */
const REAL_MODE03   = '00C0:4305018300891:108900890642AA';

describe('B1 · YANLIŞ POZİTİF YOK — kanıt kaybolmaz', () => {
  it('🔒 header\'lı çok-ECU 0100 bitmap yanıtı VIN diye MASKELENMEZ (saha arızası)', () => {
    /* `41 00` + bitmap; bitmap baytları `A4 90 2B` nibble kaymasıyla "4902" üretir.
       Eski kapı bu kaydı TAMAMEN siliyordu → ECU keşif kanıtı yok oluyordu. */
    const bitmap = '7E8064100A4902B13';
    expect(bitmap.includes('4902')).toBe(true);          // hizasız dizi GERÇEKTEN var
    const masked = maskObdTrafficEntry('0100', bitmap);
    expect(masked.masked).toBe(false);
    expect(masked.resp).toBe(bitmap);
    expect(masked.resp).not.toContain(REDACTED_VIN);
  });

  it('🔒 çok-ECU bitmap yanıtının HİÇBİR ECU satırı kaybolmaz', () => {
    const multi = '7E8064100BE3FA813\r7EA064100A4902B13\r7EB06410088180011';
    const masked = maskObdTrafficEntry('0100', multi);
    expect(masked.masked).toBe(false);
    expect(masked.resp).toContain('7E8064100BE3FA813');
    expect(masked.resp).toContain('7EA064100A4902B13');
    expect(masked.resp).toContain('7EB06410088180011');
  });

  it('🔒 hizasız "4902" içeren rastgele hex korunur (nibble kayması eşleşme DEĞİL)', () => {
    for (const raw of ['410CA4902B', '4100983B490211', 'BB4902AA', '412308A24902']) {
      const r = maskVinPayload(raw);
      expect(r.masked, `hizasız eşleşme maskelendi: ${raw}`).toBe(false);
      expect(r.text).toBe(raw);
    }
  });

  it('🔒 gerçek araç ham kayıtları (22F190 · Mode 03) DOKUNULMADAN kalır', () => {
    expect(maskObdTrafficEntry('22F190', REAL_DID_F190).resp).toBe(REAL_DID_F190);
    expect(maskObdTrafficEntry('03', REAL_MODE03).resp).toBe(REAL_MODE03);
    expect(maskObdTrafficEntry('22F190', REAL_DID_F190).masked).toBe(false);
  });

  it('🔒 0902 → "NO DATA" artık kanıt olarak KORUNUR (gizlenecek kimlik yok)', () => {
    const masked = maskObdTrafficEntry('0902', 'NO DATA');
    expect(masked.masked).toBe(false);
    expect(masked.resp).toBe('NO DATA');
  });

  it('🔒 normal PID trafiği dokunulmadan kalır (mevcut sözleşme)', () => {
    const normal = maskObdTrafficEntry('010C', '41 0C 1A F8');
    expect(normal.masked).toBe(false);
    expect(normal.resp).toBe('41 0C 1A F8');
  });
});

describe('B1 · YANLIŞ NEGATİF YOK — gerçek VIN her biçimde gizlenir', () => {
  /** Gerçek VIN'in hex karşılığı: "WF0AXXTTRA5R12345" ASCII. */
  const VIN_HEX = '5746304158585454524135523132333435';

  it('🔒 headers OFF · tek frame gerçek VIN maskelenir; servis baytı KALIR', () => {
    const raw = `4902 01 ${VIN_HEX}`;
    const r = maskVinPayload(raw);
    expect(r.masked).toBe(true);
    expect(r.text).toContain('4902');                     // akış izlenebilir kalır
    expect(r.text).toContain(REDACTED_VIN);
    expect(r.text).not.toContain(VIN_HEX);
  });

  it('🔒 headers OFF · ISO-TP segmented gerçek VIN maskelenir (devam frame\'leri dahil)', () => {
    /* Gerçek adaptör ham'ı (RAW_HANDSHAKE.json biçimi). */
    const raw = '0140:4902012020201:202020202020202:20202020202020';
    const r = maskVinPayload(raw);
    expect(r.masked).toBe(true);
    expect(r.text).toContain('4902');
    expect(r.text).toContain(REDACTED_VIN);
    /* Devam frame'leri (`1:` `2:`) VIN yükünün parçasıdır — sızmamalı. */
    expect(r.text).not.toContain('202020202020202');
  });

  it('🔒 headers ON · 11-bit FF gerçek VIN maskelenir', () => {
    const raw = `7E810144902 01 ${VIN_HEX}`;
    const r = maskVinPayload(raw);
    expect(r.masked).toBe(true);
    expect(r.text).not.toContain(VIN_HEX);
    expect(r.text).toContain('7E81014');                  // header + PCI korunur
  });

  it('🔒 headers ON · 29-bit FF gerçek VIN maskelenir', () => {
    const raw = `18DAF11010144902${VIN_HEX}`;
    const r = maskVinPayload(raw);
    expect(r.masked).toBe(true);
    expect(r.text).not.toContain(VIN_HEX);
  });

  it('🔒 aynı kayıtta VIN satırı gizlenir, DİĞER ECU satırı korunur', () => {
    const raw = `7E8064100BE3FA813\n7E910144902${VIN_HEX}\n7EB06410088180011`;
    const r = maskVinPayload(raw);
    expect(r.masked).toBe(true);
    expect(r.text).not.toContain(VIN_HEX);
    expect(r.text).toContain('7E8064100BE3FA813');        // VIN taşımayan satırlar
    expect(r.text).toContain('7EB06410088180011');
    expect(r.text.split('\n')).toHaveLength(3);           // satır yapısı bozulmaz
  });

  it('🔒 FAIL-CLOSED: 0902 isteği + çözülemeyen hex → yanıtın TAMAMI gizlenir', () => {
    /* Desenkronizasyonda başka bir yanıt bu satıra kayabilir (send() prompt-timeout).
       Yapı çözülemiyorsa gizlilik kanıttan ÖNCE gelir. */
    const masked = maskObdTrafficEntry('0902', '7E8064100BE3FA813');
    expect(masked.masked).toBe(true);
    expect(masked.resp).toBe(REDACTED_VIN);
  });

  it('🔒 ASCII VIN ikinci kapıdan (RE_VIN) yine geçemez', () => {
    const masked = maskObdTrafficEntry('ATI', 'ELM327 v1.5 WF0AXXTTRA5R12345');
    expect(masked.resp).not.toContain('WF0AXXTTRA5R12345');
    expect(masked.resp).toContain(REDACTED_VIN);
  });
});

describe('B1 · sözleşme yüzeyi', () => {
  it('isVinRequest davranışı DEĞİŞMEDİ', () => {
    expect(isVinRequest('0902')).toBe(true);
    expect(isVinRequest('09 02')).toBe(true);
    expect(isVinRequest('0100')).toBe(false);
  });

  it('isVinResponse artık protokol-farkında', () => {
    expect(isVinResponse('7E8064100A4902B13')).toBe(false);   // bitmap → VIN DEĞİL
    expect(isVinResponse('49020157463058')).toBe(true);       // gerçek VIN
    expect(isVinResponse(null)).toBe(false);
  });

  it('boş / hex olmayan girdi güvenle geçer', () => {
    expect(maskVinPayload('').masked).toBe(false);
    expect(maskVinPayload('OK').masked).toBe(false);
    expect(maskVinPayload('SEARCHING...').masked).toBe(false);
    expect(maskVinPayload('⚠ Stream kapandı').masked).toBe(false);
  });
});
