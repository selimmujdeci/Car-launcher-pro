/**
 * assistantQuerySensor.test.ts — V1: QUERY_SENSOR uçtan uca (parser katmanı)
 * (ASSISTANT_VEHICLE_INTEGRATION_PLAN.md, dal feat/obd-core-v2)
 *
 * Kapsam:
 *  1) vehicleIntents.tryParseVehicleQuery — pozitif/negatif kalıplar (aç/kapat
 *     fiilleriyle YANLIŞ tetiklenmeme, resolveSensor doğrulaması).
 *  2) commandParser — query_sensor FALLBACK olarak eklenir; mevcut
 *     vehicle_speed/vehicle_fuel/vehicle_temp/vehicle_maintenance/vehicle_status
 *     kalıpları BİREBİR korunur (bu patch onlara dokunmaz — V3'ün işi).
 *  3) Yapısal kilit — beyin şemasında (companionChatProvider) QUERY_SENSOR var
 *     ama DEĞER alanı YOK (beyin sahte değer üretemez); commandExecutor'da
 *     QUERY_SENSOR case'i querySensor'u çağırır + uzun-metin dalını yönetir.
 *
 * voiceService yerel bypass testleri (querySensor MOCK'lanmalı) AYRI dosyada:
 * assistantQuerySensorBypass.test.ts — vi.mock modül-kapsamlı hoisting yaptığı
 * için resolveSensor'un GERÇEK implementasyonunu kullanan bu dosyayla çakışır.
 *
 * NOT: regression.guards.test.ts'e KENDİ kilidini eklemek yerine bu dosyaya
 * konuldu — o dosya bu oturumda paralel bir WIP'in (Freeze/worker) parçası
 * olarak zaten değişik durumda; commit çakışması riskini önlemek için
 * yapısal kilitler burada tutulur (CLAUDE.md görev talimatı).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/* ────────────────────────────────────────────────────────────────
   1) vehicleIntents.tryParseVehicleQuery — pür fonksiyon testleri
   ──────────────────────────────────────────────────────────────── */
describe('vehicleIntents.tryParseVehicleQuery', () => {
  it('pozitif: "yağ sıcaklığı kaç" → sensör sorgusuna çözülür', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    const m = tryParseVehicleQuery('yağ sıcaklığı kaç');
    expect(m).not.toBeNull();
    expect(m!.sensorQuery).toBe('yağ sıcaklığı kaç');
    expect(m!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('pozitif: "turbo basıncı ne kadar" → çözülür', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    expect(tryParseVehicleQuery('turbo basıncı ne kadar')).not.toBeNull();
  });

  it('pozitif: "akü voltajı nedir" → çözülür', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    expect(tryParseVehicleQuery('akü voltajı nedir')).not.toBeNull();
  });

  it('negatif: soru ipucu (kaç/ne kadar/nedir/söyle) yoksa null', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    expect(tryParseVehicleQuery('yağ sıcaklığı')).toBeNull();
  });

  it('negatif: "aç/kapat" fiili içeren cümlede TETİKLENMEZ (komut, sorgu değil)', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    // cue ("kaç") VE aksiyon fiili ("kapat") BİRLİKTE — guard'ın gerçekten
    // fiile baktığını (yalnız cue eksikliğine değil) doğrular.
    expect(tryParseVehicleQuery('yağ sıcaklığı kaç, şunu kapat')).toBeNull();
  });

  it('negatif: resolveSensor bilinen bir sensöre bağlayamazsa null (beyne düşer)', async () => {
    const { tryParseVehicleQuery } = await import('../platform/vehicleIntents');
    expect(tryParseVehicleQuery('uzaylı gemisi nedir')).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────
   2) commandParser entegrasyonu — fallback + mevcut davranış korunur
   ──────────────────────────────────────────────────────────────── */
describe('commandParser — query_sensor fallback', () => {
  it('YENİ: "yağ sıcaklığı kaç" → query_sensor (commandParser\'da karşılığı yoktu)', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('yağ sıcaklığı kaç');
    expect(r.command?.type).toBe('query_sensor');
    expect(r.command?.extra?.sensorQuery).toBe('yağ sıcaklığı kaç');
    expect(r.needsSemantic).toBe(false);
  });

  it('YENİ: "turbo basıncı ne kadar" → query_sensor', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('turbo basıncı ne kadar');
    expect(r.command?.type).toBe('query_sensor');
  });

  it('KORUNUR: "hızım kaç" HÂLÂ vehicle_speed (query_sensor DEĞİL — mevcut davranış)', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('hızım kaç');
    expect(r.command?.type).toBe('vehicle_speed');
    expect(r.command?.confidence).toBe(1.0);
  });

  it('KORUNUR: "motor sıcaklığı kaç" HÂLÂ vehicle_temp (query_sensor DEĞİL)', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('motor sıcaklığı kaç');
    expect(r.command?.type).toBe('vehicle_temp');
  });

  it('KORUNUR: "yakıt durumum ne" HÂLÂ vehicle_fuel', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('yakıt durumum ne');
    expect(r.command?.type).toBe('vehicle_fuel');
  });

  it('KORUNUR: "bakım ne zaman" HÂLÂ vehicle_maintenance', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('bakım ne zaman');
    expect(r.command?.type).toBe('vehicle_maintenance');
  });

  it('NEGATİF: "farları aç" query_sensor ÜRETMEZ', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    const r = parseCommandFull('farları aç');
    expect(r.command?.type).not.toBe('query_sensor');
  });
});

/* ────────────────────────────────────────────────────────────────
   3) Yapısal kilitler — beyin şeması + executor case
   ──────────────────────────────────────────────────────────────── */
describe('Beyin şeması (companionChatProvider) — QUERY_SENSOR', () => {
  const src = read('src/platform/companion/companionChatProvider.ts');

  it('YAPISAL: BRAIN_INTENTS içinde QUERY_SENSOR var', () => {
    const block = src.match(/const BRAIN_INTENTS\s*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/);
    expect(block, 'BRAIN_INTENTS bloğu bulunamadı').toBeTruthy();
    expect(block![1]).toMatch(/'QUERY_SENSOR'/);
  });

  it('YAPISAL: BrainJson şemasında sensorQuery VAR ama DEĞER alanı YOK (sahte değer üretilemez)', () => {
    const block = src.match(/interface BrainJson \{[\s\S]*?\n\}/);
    expect(block, 'BrainJson arayüzü bulunamadı').toBeTruthy();
    expect(block![0]).toMatch(/sensorQuery\??:\s*string/);
    // Değer taşıyan bir alan (sensorValue / value) BİLİNÇLİ OLARAK yok —
    // beyin şemadan bir sayı/değer alanı bulup uyduramaz (plan §1).
    expect(block![0]).not.toMatch(/sensorValue/);
  });

  it('YAPISAL: system prompt "sensör değeri uydurma" kuralını içerir', () => {
    expect(src).toMatch(/SENSÖR DEĞERİ UYDURMA/);
    expect(src).toMatch(/QUERY_SENSOR/);
  });
});

describe('commandExecutor — QUERY_SENSOR case (yapısal)', () => {
  const src = read('src/platform/commandExecutor.ts');

  it('YAPISAL: case \'QUERY_SENSOR\' querySensor\'u çağırır', () => {
    const block = src.match(/case 'QUERY_SENSOR':[\s\S]*?\n {6}\}/);
    expect(block, 'QUERY_SENSOR case bloğu bulunamadı').toBeTruthy();
    expect(block![0]).toMatch(/await querySensor\(/);
  });

  it('YAPISAL: uzun metin (>20 karakter) dalı showToast ile ekrana yönlendirir', () => {
    const block = src.match(/case 'QUERY_SENSOR':[\s\S]*?\n {6}\}/);
    expect(block![0]).toMatch(/value\.length > 20/);
    expect(block![0]).toMatch(/showToast\(/);
  });

  it('YAPISAL: null cevap dalı dürüst mesaj verir (sahte değer YOK)', () => {
    const block = src.match(/case 'QUERY_SENSOR':[\s\S]*?\n {6}\}/);
    expect(block![0]).toMatch(/if \(!answer\)/);
  });
});

describe('intentEngine — QUERY_SENSOR köprüsü (yapısal)', () => {
  const src = read('src/platform/intentEngine.ts');

  it('YAPISAL: IntentType, VALID_INTENTS, fromSemanticResult QUERY_SENSOR\'u tanır', () => {
    expect(src).toMatch(/'QUERY_SENSOR'/);
    expect(src).toMatch(/sensorQuery\?:\s*string/);
  });
});
