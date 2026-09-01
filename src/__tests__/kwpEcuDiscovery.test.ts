/**
 * P0-OBD-FINAL-01 — KWP/ISO ECU KEŞFİ VE ADRESLENEBİLİRLİK KİLİTLERİ.
 *
 * ── ÖLÇÜLEN SAHA KUSURU (2026-08-25, Protocol 5 / classic BT) ─────────────
 * Fonksiyonel prob (ATH1 + 0100) ÇALIŞIYORDU ve ECU'lar cevap veriyordu; ama
 * `parseEcuProbe` YALNIZ CAN header'ı tanıyordu (7E8..7EF · 18DAF1xx). Yavaş
 * seri hatta yanıt "48 6B 10 41 00 …" biçimindedir → hiçbir satır eşleşmiyor →
 * topoloji BOŞ → motor ECU'su dışında hiçbir birim SORULMUYOR → araçtaki bilinen
 * arıza görünmüyor ve LAB'da "keşif gözlemleri" boş kalıyordu.
 *
 * İKİNCİ KUSUR: `kwpTargetVerified` bayrağı kodun HİÇBİR YERİNDE `true`
 * olmuyordu → `isKwpDtcAddressable` her zaman `false` → KWP 0x18 (üretici DTC)
 * HİÇ GÖNDERİLMEDİ. KWP araçta üretici kodları yalnız orada yaşar.
 *
 * Bu dosya iki şeyi birden kilitler: keşif ARTIK çalışır ve adres UYDURULMAZ.
 */
import { describe, it, expect } from 'vitest';
import { parseEcuProbe, buildTopology } from '../platform/obd/ecuDiscovery';
import {
  addressabilityFromOutcome, mergeAddressability,
} from '../platform/obd/ecuAddressability';
import { isKwpDtcAddressable } from '../platform/obd/multiEcuScan';

/** Gerçek bir KWP2000 (ATSP5) fonksiyonel 0100 yanıtı — iki ECU cevap veriyor. */
const KWP_RAW = [
  '48 6B 10 41 00 BE 3E B8 11 A3',
  '48 6B 18 41 00 80 00 00 00 5C',
  '>',
].join('\r');

/** Mevcut CAN yanıtı — bu turun CAN yolunu DEĞİŞTİRMEDİĞİNİ kanıtlar. */
const CAN_RAW = [
  '7E8 06 41 00 BE 3F A8 13',
  '7E9 06 41 00 80 00 00 00',
].join('\r');

describe('P0-OBD-FINAL-01 · KWP/ISO ECU keşfi', () => {
  it('🔒 KİLİT: KWP yanıt header\'ı ARTIK tanınır — topoloji boş KALMAZ', () => {
    const ecus = parseEcuProbe(KWP_RAW, '5');
    expect(ecus).toHaveLength(2);
    expect(ecus.map((e) => e.rxHeader)).toEqual(['486B10', '486B18']);
    expect(ecus.every((e) => e.addressBits === 8)).toBe(true);
  });

  it('tx ISO 14230-4 kuralıyla türetilir ve KURALIN ADI taşınır', () => {
    const [ecm, other] = parseEcuProbe(KWP_RAW, '5');
    expect(ecm.txHeader).toBe('8110F1');
    expect(ecm.txProvenance).toBe('kwp_iso14230');
    expect(other.txHeader).toBe('8118F1');
  });

  it('ISO 9141-2 (protokol 3) FARKLI format baytı kullanır — kural karıştırılmaz', () => {
    const [ecm] = parseEcuProbe(KWP_RAW, '3');
    expect(ecm.txHeader).toBe('6810F1');
    expect(ecm.txProvenance).toBe('kwp_iso9141');
  });

  it('🔒 KİLİT: protokol BİLİNMİYORSA tx UYDURULMAZ — istek gönderilemez', () => {
    const [ecm] = parseEcuProbe(KWP_RAW, null);
    expect(ecm.txHeader).toBe('');                 // boş = fiziksel hedef YOK
    expect(ecm.txProvenance).toBe('unknown');
    /* ECU yine de KEŞFEDİLİR: "bu birim cevap verdi" gözlemi KAYBOLMAZ. */
    expect(ecm.rxHeader).toBe('486B10');
    expect(ecm.probeOutcome).toBe('responded');
  });

  it('rol yalnız STANDART garantiyle atanır (0x10 = ECU #1), gerisi unknown', () => {
    const [ecm, other] = parseEcuProbe(KWP_RAW, '5');
    expect(ecm.role).toBe('engine');
    expect(ecm.roleEvidence).toBe('standard');
    expect(other.role).toBe('unknown');
    expect(other.roleEvidence).toBe('none');
  });

  it('🔒 KİLİT: CAN yolu BİREBİR korunur (regresyon yok)', () => {
    const ecus = parseEcuProbe(CAN_RAW, '6');
    expect(ecus.map((e) => e.rxHeader)).toEqual(['7E8', '7E9']);
    expect(ecus.every((e) => e.addressBits === 11)).toBe(true);
    expect(ecus[0].txHeader).toBe('7E0');
    expect(ecus[0].txProvenance).toBe('can_11bit_standard');
    /* CAN satırları KWP eşleştiricisine DÜŞMEZ (tester baytı çakışmaz). */
    expect(ecus.every((e) => e.txProvenance !== 'kwp_iso14230')).toBe(true);
  });

  it('gürültü satırları (echo/prompt/tester adresi) ECU sayılmaz', () => {
    const noisy = ['SEARCHING...', '48 6B F1 41 00', 'NO DATA', '>'].join('\r');
    expect(parseEcuProbe(noisy, '5')).toHaveLength(0);
  });

  it('buildTopology protokolü keşfe taşır — probeEmpty artık yalan söylemez', () => {
    const t = buildTopology(KWP_RAW, 1_000, '5');
    expect(t.probeEmpty).toBe(false);
    expect(t.ecus).toHaveLength(2);
    expect(t.probedAt).toBe(1_000);
  });
});

describe('P0-OBD-FINAL-01 · adreslenebilirlik ölçümü', () => {
  it('cevap gelmesi YETER: pozitif de NRC de hedefi KANITLAR', () => {
    expect(addressabilityFromOutcome('OK')).toBe('PROVEN');
    expect(addressabilityFromOutcome('UNSUPPORTED')).toBe('PROVEN');
  });

  it('SESSİZLİK hedefi ÇÜRÜTÜR — "0 kod" ile karıştırılmaz', () => {
    expect(addressabilityFromOutcome('NO_RESPONSE')).toBe('NOT_ADDRESSABLE');
    expect(addressabilityFromOutcome('TIMEOUT')).toBe('NOT_ADDRESSABLE');
  });

  it('ölçülemeyen sonuç UNKNOWN kalır (fail-closed) — sahte kanıt YOK', () => {
    expect(addressabilityFromOutcome(null)).toBe('UNKNOWN');
    expect(addressabilityFromOutcome('')).toBe('UNKNOWN');
    expect(addressabilityFromOutcome('BUS_ERROR')).toBe('UNKNOWN');
    expect(addressabilityFromOutcome('saçma')).toBe('UNKNOWN');
  });

  it('kanıt BİRİKİR: bir kez kanıtlanan hedef sonraki sessizlikle düşmez', () => {
    expect(mergeAddressability('PROVEN', 'NOT_ADDRESSABLE')).toBe('PROVEN');
    expect(mergeAddressability('NOT_ATTEMPTED', 'NOT_ADDRESSABLE')).toBe('NOT_ADDRESSABLE');
    expect(mergeAddressability('NOT_ATTEMPTED', 'UNKNOWN')).toBe('UNKNOWN');
    expect(mergeAddressability('NOT_ATTEMPTED', 'NOT_ATTEMPTED')).toBe('NOT_ATTEMPTED');
  });

  it('🔒 KİLİT: KWP 0x18 kapısı KANITSIZ AÇILMAZ', () => {
    const [ecm] = parseEcuProbe(KWP_RAW, '5');
    /* Fonksiyonel keşif hedefi kanıtlamaz → kapı KAPALI. */
    expect(ecm.kwpTargetVerified).toBe(false);
    expect(isKwpDtcAddressable(ecm, '5')).toBe(false);
    /* Fiziksel cevap kanıtlar → kapı AÇILIR. */
    expect(isKwpDtcAddressable({ ...ecm, kwpTargetVerified: true }, '5')).toBe(true);
    /* CAN protokolünde 0x18 hiç denenmez (kanıt olsa bile). */
    expect(isKwpDtcAddressable({ ...ecm, kwpTargetVerified: true }, '6')).toBe(false);
  });
});
