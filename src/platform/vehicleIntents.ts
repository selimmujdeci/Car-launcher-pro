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
import type { CommandPattern } from './commandParser';

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

/* ──────────────────────────────────────────────────────────────────────
 * V3 — Araç DURUMU / SAĞLIĞI-ARIZA KODU / BAKIM yerel parser kalıpları.
 *
 * ASSISTANT_VEHICLE_INTEGRATION_PLAN.md §V3 (ROADMAP alan-modülü ayrıştırma
 * kararı, f87a455): commandParser.ts'in PATTERNS dizisinde yaşayan
 * vehicle_status / vehicle_health_check / vehicle_clear_dtc /
 * vehicle_maintenance kalıpları BİREBİR (keywords/tokens/feedback/priority
 * aynı) buraya taşındı. commandParser bu sabitleri PATTERNS dizisinde AYNI
 * SIRA POZİSYONUNDA import edip kullanır — Array.prototype.sort() kararlı
 * (stable) olduğundan puan eşitliklerinde dizi SIRASI belirleyicidir; kalıp
 * içeriği değişmeden yalnız TANIM YERİ değişti, davranış birebir korunur.
 *
 * BİLİNÇLİ KAPSAM DIŞI: vehicle_speed/vehicle_fuel/vehicle_temp bu taşımaya
 * DAHİL DEĞİL (plan V3 kapsamı yalnız durum/sağlık-arıza/bakım) — onlar
 * commandParser.ts'te kalır.
 * ──────────────────────────────────────────────────────────────────── */

export const VEHICLE_MAINTENANCE_PATTERN: CommandPattern = {
  type: 'vehicle_maintenance', priority: 'normal',
  feedback: 'Bakım bilgileri gösteriliyor',
  label: 'Bakım Durumunu Göster', example: 'bakım ne zaman',
  keywords: [
    'bakım ne zaman', 'bakım durumu', 'araç bakımı', 'bakım zamanı',
    'muayene ne zaman', 'sigorta ne zaman', 'kasko ne zaman',
    'yağ değişimi ne zaman', 'yağ ne zaman', 'servis ne zaman',
    'filtre değişimi', 'last servis ne zamandı', 'bakım yapılması lazım',
  ],
  tokens: ['bakim', 'muayene', 'sigorta', 'kasko', 'servis', 'yag'],
};

export const VEHICLE_HEALTH_CHECK_PATTERN: CommandPattern = {
  type: 'vehicle_health_check', priority: 'normal',
  feedback: 'Araç sistemleri taranıyor',
  label: 'Araç Sağlık Kontrolü', example: 'arıza var mı',
  keywords: [
    'nesi var', 'arıza var mı', 'check engine', 'sorun var mı', 'sağlık durumu',
    'motor ışığı yandı', 'uyarı lambası', 'hata kodu nedir', 'araç sağlıklı mı',
    'diagnostic çalıştır', 'tarama başlat', 'obd oku',
  ],
  tokens: ['ariza', 'sorun', 'check', 'saglik', 'tarama', 'obd', 'diagnostic'],
};

export const VEHICLE_CLEAR_DTC_PATTERN: CommandPattern = {
  type: 'vehicle_clear_dtc', priority: 'normal',
  feedback: 'Arıza kayıtları siliniyor',
  label: 'Arıza Kodlarını Sil', example: 'hataları sil',
  keywords: [
    'hataları sil', 'arıza ışığını söndür', 'kodları temizle',
    'motor ışığını söndür', 'arıza kayıtlarını sil', 'hataları temizle',
  ],
  tokens: ['hata', 'sil', 'ariza', 'kod', 'temizle', 'sondur'],
};

export const VEHICLE_STATUS_PATTERN: CommandPattern = {
  type: 'vehicle_status', priority: 'normal',
  feedback: 'Araç durumu okunuyor',
  label: 'Araç Durumu', example: 'arabanın durumu nasıl',
  keywords: [
    // Temel
    // NOT: 'nasılsın' BİLEREK YOK — sosyal hal-hatır sorusudur, araç raporu
    // değil. Parser yutarsa offlineConversationEngine'in HOW_ARE_YOU niyeti
    // hiç çalışamıyor ve OBD bağlı değilken "Araç verisi alınamıyor" deniyordu.
    'arabanın durumu', 'araç durumu nasıl', 'hız kaç', 'yakıt ne kadar', 'durum nasıl',
    'durumumuz ne', 'her şey yolunda mı', 'araç özeti', 'rapor ver',
    'obd durumu', 'obd durumu nasıl',
    // Argo / günlük
    // NOT: 'ne var ne yok' BİLEREK YOK — sosyal hal-hatır deyimidir
    // ('nasılsın' ile aynı P0 saha hatası); companion/sohbet hattının işi.
    'brifing ver', 'genel durum ne', 'sistemi oku',
    'araç nasıl gidiyor', 'her şey normale mi', 'kontrol listesi',
    // Sistem fiilleri
    'raporla', 'durum raporu', 'sistem raporu', 'araç raporu',
    'araç bilgisi', 'mevcut durum', 'hepsi tamam mı', 'nasıl gidiyor',
  ],
  // NOT: 'nasil' token'ı BİLEREK YOK — "nasılsın"/"hava nasıl" gibi her
  // "nasıl"lı cümleyi Tier-2'de araç durumuna çekiyordu. Araçlı kalıplar
  // ('araç durumu nasıl', 'durum nasıl') Tier-1 exact eşleşmeyle zaten yakalanır.
  tokens: ['durum', 'hiz', 'yakit', 'sicaklik', 'status', 'ozet', 'rapor', 'brifing'],
};

/** Yapısal kilit yardımcısı — bu 4 kalıbın tümü bu modülde yaşar. */
export const VEHICLE_DOMAIN_PATTERNS: readonly CommandPattern[] = [
  VEHICLE_MAINTENANCE_PATTERN,
  VEHICLE_HEALTH_CHECK_PATTERN,
  VEHICLE_CLEAR_DTC_PATTERN,
  VEHICLE_STATUS_PATTERN,
];
