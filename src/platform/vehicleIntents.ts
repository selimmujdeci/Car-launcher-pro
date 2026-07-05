/**
 * vehicleIntents.ts — Araç SENSÖR DEĞERİ sorgusu yerel parser'ı.
 *
 * ASSISTANT_VEHICLE_INTEGRATION_PLAN.md V1'in "alan-modülü ayrıştırması" TOHUMU
 * (ROADMAP kararı — bkz. docs/ASSISTANT_VEHICLE_INTEGRATION_PLAN.md §V3). Bu
 * modül yalnız "X kaç / X ne kadar / X nedir / X söyle" kalıplı SENSÖR sorularını
 * yakalar; adayı `sensorQueryService.resolveSensor` ile DOĞRULAR — gerçek bir
 * sensöre çözülmüyorsa null döner (çağıran beyne düşürür, sahte komut ÜRETMEZ).
 *
 * BİLİNÇLİ KAPSAM: hız/yakıt/motor sıcaklığı/bakım/durum gibi commandParser'da
 * ZATEN kapsanan sorular BURAYA HİÇ GELMEZ — commandParser bu modülü yalnız
 * mevcut kalıplardan HİÇBİRİ eşleşmediğinde (fallback) çağırır. Böylece mevcut
 * vehicle_speed/vehicle_fuel/vehicle_temp/vehicle_maintenance/vehicle_status
 * davranışı BİREBİR korunur (intentEngine'deki mevcut intent'lerin taşınması
 * V3'ün işi — bu patch onlara DOKUNMAZ). Yeni sensörler (yağ sıcaklığı, turbo
 * basıncı, akü voltajı, VIN gibi manufacturer DID'ler…) bu modülden geçer.
 */

import { resolveSensor } from './obd/sensorQueryService';

export interface VehicleSensorMatch {
  /** resolveSensor'a AYNEN geçirilecek soru metni (querySensor de bunu kullanır). */
  sensorQuery: string;
  confidence: number;
}

/** Türkçe aksan sadeleştirme — commandParser/sensorQueryService ile aynı kural
 *  (bağımsız kopya — modüller birbirine implementasyon olarak bağımlı değil). */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soru ipucu: "kaç / ne kadar / nedir / söyle" — plan V1'in birebir kalıp seti. */
const QUERY_CUE_RE = /\bkac\b|\bne kadar\b|\bnedir\b|\bsoyle\b/;

/**
 * Negatif koruma: "aç/kapat" fiili içeren cümleler KOMUTTUR, sensör sorgusu
 * değil ("far ışığını aç" gibi) — bu modül asla tetiklenmemeli. Kelime sınırlı
 * (\b) — "kaç" içindeki "aç" alt-dizisini YAKALAMAZ.
 */
const ACTION_VERB_RE = /\b(ac|acsana|acar misin|kapat|kapatsana)\b/;

/**
 * Metni araç sensör sorgusuna çözmeyi dener. Eşleşme YOKSA (soru ipucu yok,
 * aç/kapat fiili var, ya da resolveSensor bilinen bir sensöre bağlayamadı) null
 * döner — çağıran (commandParser) bunu "eşleşme yok" sayıp beyne/anlaşılamadı
 * zincirine bırakır (SAHTE KOMUT ÜRETİLMEZ).
 */
export function tryParseVehicleQuery(text: string): VehicleSensorMatch | null {
  const normalized = norm(text);
  if (normalized.length < 3) return null;
  if (ACTION_VERB_RE.test(normalized)) return null;
  if (!QUERY_CUE_RE.test(normalized)) return null;

  const target = resolveSensor(text);
  if (!target) return null;

  return { sensorQuery: text.trim(), confidence: 0.82 };
}
