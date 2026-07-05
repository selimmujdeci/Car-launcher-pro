/**
 * vehicleIntentsDomainPatterns.test.ts — V3: araç-alanı ayrıştırması
 * (ASSISTANT_VEHICLE_INTEGRATION_PLAN.md §V3, ROADMAP "asistan alan-modülü
 * ayrıştırma kararı" f87a455)
 *
 * Kapsam:
 *  1) Yapısal kilit — vehicle_status / vehicle_health_check / vehicle_clear_dtc /
 *     vehicle_maintenance kalıpları artık vehicleIntents.ts'te YAŞAR (modülün
 *     export ettiği kalıp sayısı + tipleri üzerinden — ?raw kaynak-metin
 *     kilidi KULLANILMADI, CLAUDE.md görev talimatı).
 *  2) commandParser bu kalıpları vehicleIntents'ten ÇAĞIRDIĞINI kanıtlar:
 *     üretilen komutun feedback/confidence/priority değerleri vehicleIntents
 *     export'larıyla BİREBİR eşleşir (aynı obje referansı kullanıldığının
 *     davranışsal kanıtı).
 *  3) V1 QUERY_SENSOR fallback'i ile V3 taşımasının öncelik ilişkisi bugünkü
 *     fiili davranışla AYNI kalır: kapsanan araç kalıpları (vehicle_status vb.)
 *     EXACT (1.0) eşleşip QUERY_SENSOR denemesine hiç düşmez; kapsanmayan
 *     sensör soruları (yağ sıcaklığı, turbo, akü) hâlâ query_sensor'a düşer.
 *
 * Davranış DEĞİŞİKLİĞİ SIFIR — bu dosya yalnız taşımayı kilitler, mevcut
 * commandParser.test.ts / assistantQuerySensor.test.ts kilitleri AYNEN durur.
 */
import { describe, it, expect } from 'vitest';

describe('vehicleIntents — araç-durumu/sağlık/bakım kalıpları modülde yaşar (yapısal)', () => {
  it('YAPISAL: VEHICLE_DOMAIN_PATTERNS tam 4 kalıp export eder', async () => {
    const mod = await import('../platform/vehicleIntents');
    expect(mod.VEHICLE_DOMAIN_PATTERNS).toBeDefined();
    expect(mod.VEHICLE_DOMAIN_PATTERNS).toHaveLength(4);
  });

  it('YAPISAL: taşınan 4 tip tam olarak vehicle_maintenance/health_check/clear_dtc/status', async () => {
    const { VEHICLE_DOMAIN_PATTERNS } = await import('../platform/vehicleIntents');
    const types = VEHICLE_DOMAIN_PATTERNS.map((p) => p.type).sort();
    expect(types).toEqual(
      ['vehicle_clear_dtc', 'vehicle_health_check', 'vehicle_maintenance', 'vehicle_status'].sort(),
    );
  });

  it('YAPISAL: her export ayrı isimle de erişilebilir (commandParser bunları import edip PATTERNS dizisine yerleştirir)', async () => {
    const mod = await import('../platform/vehicleIntents');
    expect(mod.VEHICLE_MAINTENANCE_PATTERN.type).toBe('vehicle_maintenance');
    expect(mod.VEHICLE_HEALTH_CHECK_PATTERN.type).toBe('vehicle_health_check');
    expect(mod.VEHICLE_CLEAR_DTC_PATTERN.type).toBe('vehicle_clear_dtc');
    expect(mod.VEHICLE_STATUS_PATTERN.type).toBe('vehicle_status');
  });

  it('YAPISAL: vehicle_status kalıbında BİLEREK KALDIRILAN "nasil" tokenı yok (taşımada bozulmadı)', async () => {
    const { VEHICLE_STATUS_PATTERN } = await import('../platform/vehicleIntents');
    expect(VEHICLE_STATUS_PATTERN.tokens).not.toContain('nasil');
  });
});

describe('commandParser — taşınan kalıpları vehicleIntents\'ten ÇAĞIRIR (davranışsal kanıt)', () => {
  it('"bakım ne zaman" → commandParser çıktısı vehicleIntents.VEHICLE_MAINTENANCE_PATTERN ile birebir', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const { VEHICLE_MAINTENANCE_PATTERN } = await import('../platform/vehicleIntents');
    const r = parseCommandFull('bakım ne zaman');
    expect(r.command?.type).toBe(VEHICLE_MAINTENANCE_PATTERN.type);
    expect(r.command?.feedback).toBe(VEHICLE_MAINTENANCE_PATTERN.feedback);
    expect(r.command?.priority).toBe(VEHICLE_MAINTENANCE_PATTERN.priority);
    expect(r.command?.confidence).toBe(1.0);
  });

  it('"arıza var mı" → commandParser çıktısı vehicleIntents.VEHICLE_HEALTH_CHECK_PATTERN ile birebir', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const { VEHICLE_HEALTH_CHECK_PATTERN } = await import('../platform/vehicleIntents');
    const r = parseCommandFull('arıza var mı');
    expect(r.command?.type).toBe(VEHICLE_HEALTH_CHECK_PATTERN.type);
    expect(r.command?.feedback).toBe(VEHICLE_HEALTH_CHECK_PATTERN.feedback);
  });

  it('"hataları sil" → commandParser çıktısı vehicleIntents.VEHICLE_CLEAR_DTC_PATTERN ile birebir', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const { VEHICLE_CLEAR_DTC_PATTERN } = await import('../platform/vehicleIntents');
    const r = parseCommandFull('hataları sil');
    expect(r.command?.type).toBe(VEHICLE_CLEAR_DTC_PATTERN.type);
    expect(r.command?.feedback).toBe(VEHICLE_CLEAR_DTC_PATTERN.feedback);
  });

  it('"araç durumu nasıl" → commandParser çıktısı vehicleIntents.VEHICLE_STATUS_PATTERN ile birebir', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const { VEHICLE_STATUS_PATTERN } = await import('../platform/vehicleIntents');
    const r = parseCommandFull('araç durumu nasıl');
    expect(r.command?.type).toBe(VEHICLE_STATUS_PATTERN.type);
    expect(r.command?.feedback).toBe(VEHICLE_STATUS_PATTERN.feedback);
    expect(r.command?.confidence).toBe(1.0);
  });
});

describe('V1 QUERY_SENSOR fallback ↔ V3 taşınan kalıplar — öncelik ilişkisi bugünkü davranışla aynı', () => {
  it('"araç durumu nasıl" → vehicle_status (EXACT); query_sensor\'a HİÇ düşmez', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('araç durumu nasıl');
    expect(r.command?.type).toBe('vehicle_status');
    expect(r.command?.type).not.toBe('query_sensor');
  });

  it('"yağ sıcaklığı kaç" → commandParser\'da karşılığı olmayan sensör → query_sensor (taşıma sonrası da fallback bozulmadı)', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('yağ sıcaklığı kaç');
    expect(r.command?.type).toBe('query_sensor');
    expect(r.command?.extra?.sensorQuery).toBe('yağ sıcaklığı kaç');
  });

  it('"bakım ne zaman" → vehicle_maintenance (EXACT); query_sensor\'a düşmez', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('bakım ne zaman');
    expect(r.command?.type).toBe('vehicle_maintenance');
  });
});
