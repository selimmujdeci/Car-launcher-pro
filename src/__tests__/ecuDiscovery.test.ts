/**
 * OBD-OS-F2-1 — Çoklu-ECU keşfi (fonksiyonel prob ayrıştırması).
 *
 * Car Scanner farkının temeli: bugüne kadar tüm teşhis TEK ECU'ya (motor) yapılıyordu.
 * Bu ayrıştırıcı araçta gerçekten YAŞAYAN ECU'ları çıkarır.
 *
 * SÖZLEŞME:
 *  - Yalnız GERÇEKTEN yanıt veren adres envantere girer (zero-trust — uydurma topoloji yok).
 *  - Rol tahmini yalnız STANDARTLA garanti olanda ('7E8' = motor); gerisi 'unknown'.
 *  - Boşluklu (ATS1) VE boşluksuz (ATS0) yanıt biçimlerinin İKİSİ de çözülür.
 */
import { describe, it, expect } from 'vitest';
import { parseEcuProbe, buildTopology, emptyTopology } from '../platform/obd/ecuDiscovery';

describe('OBD-OS-F2-1 — parseEcuProbe', () => {
  it('tek ECU (yalnız motor) → 7E8 motor olarak tanınır', () => {
    const ecus = parseEcuProbe('7E8 06 41 00 BE 3F A8 13');
    expect(ecus).toHaveLength(1);
    expect(ecus[0]!.rxHeader).toBe('7E8');
    expect(ecus[0]!.txHeader).toBe('7E0');     // istek adresi = yanıt − 8
    expect(ecus[0]!.role).toBe('engine');
    expect(ecus[0]!.addressBits).toBe(11);
  });

  it('🔒 KİLİT: ÇOK ECU’lu araç → hepsi envantere girer (Car Scanner farkı)', () => {
    const raw = [
      '7E8 06 41 00 BE 3F A8 13',   // motor
      '7E9 06 41 00 80 00 00 00',   // ikinci ECU (çoğu araçta şanzıman)
      '7EA 06 41 00 80 00 00 00',   // üçüncü ECU
    ].join('\r\n');
    const ecus = parseEcuProbe(raw);
    expect(ecus).toHaveLength(3);
    expect(ecus.map((e) => e.txHeader)).toEqual(['7E0', '7E1', '7E2']);
  });

  it('🔒 KİLİT: BOŞLUKSUZ yanıt (ATS0) da çözülür — sahada bir kez ısırdı', () => {
    // Kök: `_hexTokens` boşlukla bölüyordu → ATS0 açıkken 0 token → supportedPids BOŞ →
    // veri akmıyordu. Aynı hata burada tekrarlanmasın.
    const ecus = parseEcuProbe('7E8064100BE3FA813\r7E9064100800000 00');
    expect(ecus.map((e) => e.rxHeader)).toEqual(['7E8', '7E9']);
  });

  it('ZERO-TRUST: rol yalnız standartla garanti olanda; 7E9+ "unknown" kalır', () => {
    const ecus = parseEcuProbe('7E8 06 41 00 BE\r\n7E9 06 41 00 80');
    expect(ecus[0]!.role).toBe('engine');
    expect(ecus[1]!.role).toBe('unknown');     // "şanzıman" DİYE UYDURMA (araç-özel)
  });

  it('29-bit genişletilmiş adresleme (18DAF1xx) çözülür ve tx tersine çevrilir', () => {
    const ecus = parseEcuProbe('18DAF110 06 41 00 BE 3F A8 13');
    expect(ecus).toHaveLength(1);
    expect(ecus[0]!.addressBits).toBe(29);
    expect(ecus[0]!.rxHeader).toBe('18DAF110');
    expect(ecus[0]!.txHeader).toBe('18DA10F1');  // tester(F1) → ECU(10)
    expect(ecus[0]!.role).toBe('unknown');       // 29-bit'te standart rol garantisi yok
  });

  it('çok-frame yanıtta aynı ECU TEKRAR sayılmaz', () => {
    const raw = ['7E8 10 14 49 02 01', '7E8 21 31 32 33 34', '7E8 22 35 36 37 38'].join('\n');
    expect(parseEcuProbe(raw)).toHaveLength(1);
  });

  it('ELM gürültüsü (SEARCHING/NO DATA/OK/prompt) ECU sanılmaz', () => {
    const raw = ['SEARCHING...', 'NO DATA', 'OK', '>', '7E8 06 41 00 BE'].join('\r\n');
    const ecus = parseEcuProbe(raw);
    expect(ecus).toHaveLength(1);
    expect(ecus[0]!.rxHeader).toBe('7E8');
  });

  it('boş/çöp yanıt → boş envanter (uydurma ECU YOK)', () => {
    expect(parseEcuProbe('')).toEqual([]);
    expect(parseEcuProbe('UNABLE TO CONNECT')).toEqual([]);
    expect(parseEcuProbe('ZZZZ')).toEqual([]);
  });
});

describe('OBD-OS-F2-1 — buildTopology (fail-closed)', () => {
  it('🔒 KİLİT: keşif HİÇ çalışmadıysa probedAt null — "ECU yok" ile "bakılmadı" karışmaz', () => {
    const t = emptyTopology();
    expect(t.probedAt).toBeNull();
    expect(t.probeEmpty).toBe(false);   // "boş prob" DEĞİL — hiç prob YOK
    expect(t.ecus).toEqual([]);
  });

  it('prob çalıştı ama hiç ECU yanıtlamadı → probeEmpty=true (adaptör/araç sinyali)', () => {
    const t = buildTopology('NO DATA', 1_700_000_000_000);
    expect(t.probedAt).toBe(1_700_000_000_000);
    expect(t.probeEmpty).toBe(true);
    expect(t.ecus).toEqual([]);
  });

  it('prob başarılı → ECU listesi + zaman damgası', () => {
    const t = buildTopology('7E8 06 41 00 BE\r\n7E9 06 41 00 80', 1_700_000_000_000);
    expect(t.ecus).toHaveLength(2);
    expect(t.probeEmpty).toBe(false);
    expect(t.probedAt).toBe(1_700_000_000_000);
  });
});
