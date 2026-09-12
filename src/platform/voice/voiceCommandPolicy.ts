/**
 * voiceCommandPolicy.ts — **MAVI-F13/2 · SES KOMUT POLİTİKASI (SAF).**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `voiceService` bir **bileşim kökü**dür (orchestration root): tur açar, karar
 * sırasını yürütür, yetkiyi kanonik otoritelere teslim eder. Ama içinde yıllar
 * içinde biriken bir yığın **saf sınıflandırma ve sezgi** vardı — komutun ACK
 * sınıfı, sohbet kapatma sözü, n-best seçimi, AI-istek sezgisi. Bunların hiçbiri
 * durum tutmaz, hiçbiri yan etki üretmez ve hiçbiri orkestrasyonun parçası
 * değildir; yalnız kökün karar verirken danıştığı **kurallardır**.
 *
 * Bu dosya o kuralları tek yere toplar.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) ──────────────────────────────────────────────────
 *  · **SAF.** Modül seviyesinde mutable durum YOK · timer YOK · abonelik YOK ·
 *    `Date.now()` YOK · I/O YOK · React YOK. Aynı girdi → aynı çıktı.
 *  · **OTORİTE DEĞİL.** Burada üretilen hiçbir değer bir eylemi yetkilendirmez.
 *    Tur otoritesi `maviTurn`, konuşma otoritesi `maviSpeech`, eylem otoritesi
 *    `maviActionAuthority` → `commandExecutor`. Bu dosya yalnız SINIFLANDIRIR.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** F13/2 taşıma turudur: her sabit, her regex ve her
 *    eşik `voiceService`ten **birebir** taşındı. Tek fark `computeResetDelays`
 *    artık `getConfig()` okumaz, bayrağı PARAMETRE alır (saflık şartı) —
 *    çağıran aynı okumayı yapıp geçirir, üretilen sayılar aynıdır.
 *
 * ── BURADA OLMAYANLAR (bilinçli) ────────────────────────────────────────────
 *  · `CRITICAL_VOICE_TYPES` · `AUTO_DISPATCH_MIN` · `PENDING_TTL_MS` ·
 *    beyin timeout'ları: bunlar **orkestrasyon eşikleridir**, kökte kalır.
 *    (`CRITICAL_VOICE_TYPES` ayrıca Regresyon Kasası'nın kaynak çapasıdır —
 *    taşımak kilidi körleştirirdi.)
 */

import { parseCommandFull, type ParsedCommand } from '../commandParser';
import { repairTranscript } from '../asrRepair';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · ACK SINIFLANDIRMASI (MAVI-M3 / M6)
 * ════════════════════════════════════════════════════════════════════════ */

/* ── MAVI-M3 · SONUÇ-TEMELLİ ACK KOMUTLARI ────────────────────────────────
 * Bu komut tiplerinin parser metni ("Kapılar kilitleniyor", "Arıza kayıtları
 * siliniyor", "Araç sistemleri taranıyor"…) YÜRÜTMEDEN ÖNCE üretilmiş bir
 * İDDİADIR ve M1'de kanıtlandığı gibi çoğu zaman GERÇEK DEĞİLDİR (port yok /
 * routeIntent no-op). Bu tiplerde ses YALNIZ `routeIntent`in döndürdüğü
 * `IntentExecutionResult`ten üretilir (bkz. useVoiceCommandHandler).
 *
 * Liste yalnız DAVRANIŞSAL/YIKICI araç eylemlerini kapsar — salt-okunur ve
 * düşük riskli komutlar (navigasyon · medya · tema · ayar) DOKUNULMADAN
 * bugünkü davranışını sürdürür. */
const RESULT_ACK_COMMAND_TYPES: ReadonlySet<ParsedCommand['type']> = new Set<ParsedCommand['type']>([
  'hw_lock_doors', 'hw_unlock_doors', 'hw_honk_horn', 'hw_flash_lights',
  'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
  'vehicle_clear_dtc', 'vehicle_health_check',
  /* MAVI-M4 EKLENDİ: telefon araması artık AÇIK ONAY ister. Parser'ın
   * "Arama başlatılıyor" metni onay beklenirken söylenirse — ki M4 öncesi
   * TAM OLARAK BU OLUYORDU — kullanıcı arama başladı sanır ama başlamamıştır.
   * Ses yalnız otoritenin sonucundan üretilir. */
  'call_contact',
  /* ── SAHA 2026-08-30 · GERÇEK CİHAZDA ÖLÇÜLEN SAHTE ONAY (kütük #1052) ──────
   * Xiaomi 23090RA98I / Android 13: "Sesi artır" komutu İKİ farklı rotadan
   * gidiyor ve ikisi FARKLI dürüstlük gösteriyordu:
   *   · `companion_action` → `commandExecutor` VOLUME_UP dürüst konuşuyor:
   *     "Ses ayarlama komutunu gönderdim ama sonucu doğrulayamıyorum."  ✅
   *   · `critical_bypass`  → `voiceService`in refleks dalı beyni ve plan/gözlem
   *     yolunu ATLAYIP `dispatch()` çağırıyor; `dispatch()` ayrıştırıcının
   *     İYİMSER metnini ("Ses artırıldı") YÜRÜTMEDEN ÖNCE konuşuyordu.  ❌
   * Cihazda ölçüldü: Mavi "ses artırıldı" dedi, gerçek `dumpsys audio`
   * `streamVolume` 11 → 11 kaldı (53 örnek). Gözlenmemiş sonuç başarı olarak
   * bildirildi — spec F7 `falseConfirmationRate = 0` ihlali.
   *
   * Ses komutları da artık SONUÇ-TEMELLİ ACK'tir: parser metni konuşulmaz, ses
   * yalnız yürütme sonucu zarfından üretilir. Bu M3'ün MEVCUT desenidir; yeni
   * politika KURULMAZ. Refleks bypass'ın HIZI korunur — yalnız kanıtsız İDDİA kalkar. */
  'volume_up', 'volume_down',
  /* Özel Konumlar: parser metni ("X kaydediliyor") NİYETTİR, sonuç DEĞİL —
   * GPS kanıtı yoksa/ambiguous isimse/ID bulunamazsa yürütme başarısız olabilir.
   * Ses yalnız savedLocationsService'in GERÇEK sonucundan üretilir (M3 deseni). */
  'save_location', 'rename_location', 'delete_location', 'share_location',
  /* WhatsApp konum gönderimi: parser metni ("… hazırlanıyor") burada da
   * NİYETTİR — kişi/numara bulunamayabilir, WhatsApp kurulu olmayabilir.
   * "Hazırladım" YALNIZ gerçek `prepareWhatsAppMessage` sonucundan gelir;
   * ASLA "gönderdim" (WhatsApp gerçek gönderimi doğrulanamaz — M3 deseni). */
  'send_location_contact',
]);

/** Sesi YALNIZ yürütme sonucundan gelen komut mu (parser metni konuşulmaz). */
export function isResultAckCommand(type: ParsedCommand['type']): boolean {
  return RESULT_ACK_COMMAND_TYPES.has(type);
}

/* ── MAVI-M6 · GEÇİCİ (PROVISIONAL) PARSER METNİ ──────────────────────────
 * Bu komutlarda parser'ın metni ("X aranıyor") NİHAİ CEVAP DEĞİLDİR: gerçek
 * cevap arama/oynatma bittikten sonra üretilir ("… çalınıyor" / "bulunamadı").
 * Bu yüzden 'progress' katmanına düşer ve tur başına tek olan `answer` slotunu
 * TÜKETMEZ → dürüst sonuç sesi korunur, üst üste konuşma olmaz. */
const PROVISIONAL_FEEDBACK_TYPES: ReadonlySet<ParsedCommand['type']> =
  new Set<ParsedCommand['type']>(['play_music_query', 'play_music_search']);

/** Parser metni NİHAİ cevap DEĞİL, ara bilgi mi ('progress' katmanı). */
export function isProvisionalFeedback(type: ParsedCommand['type']): boolean {
  return PROVISIONAL_FEEDBACK_TYPES.has(type);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · TÜRKÇE SÖYLEM SINIFLANDIRMASI
 * ════════════════════════════════════════════════════════════════════════ */

/** TR aksan sadeleştirme + noktalama temizliği (eşleştirme normalizasyonu). */
function normalizeTr(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── Sohbet kapatma sözleri (sürekli sohbet döngüsünden çıkış) ──
 * Takip dinlemesi penceresinde kullanıcı "tamam / sus / kapat / sonra
 * konuşuruz" derse döngü SESSİZCE kapanır — tekrar tekrar konuşma yok.
 * Yalnız TAM söylem eşleşir ("müziği kapat" gibi nesneli komutlar parser'da
 * kalır; bu regex onları yakalamaz). */
const CONV_END_RE = new RegExp(
  '^(tamam(dir)?|sus|sustur|kapat|kapan|yeter|sonra konusuruz|gorusuruz|hosca kal|gule gule)$',
);

/** Sohbeti kapatma söylemi mi (TAM eşleşme — nesneli komutlar hariç). */
export function isConversationEnd(raw: string): boolean {
  return CONV_END_RE.test(normalizeTr(raw));
}

/** Onay ("evet") söylemi — bekleyen komut/eylem penceresinde okunur. */
export const AFFIRM_RE =
  /^\s*(evet|tabii|tabi|olur|tamam|aynen|onayla|onayliyorum|onaylıyorum|he|hi hi|yap|elbette|kesinlikle|dogru|doğru)\b/i;

/** Ret ("hayır") söylemi — bekleyen komut/eylem penceresinde okunur. */
export const NEGATE_RE =
  /^\s*(hayir|hayır|yok|iptal|vazgec|vazgeç|yapma|gerek yok|istemiyorum|olmaz|dur|bos ver|boş ver)(?:\b|$)/i;

/** Bileşik komut bağlacı — "müziği aç **ve** eve git". */
export const CHAIN_SPLIT = /\s+(?:ve|sonra|ardindan|ardından|bir de|hem de|ayrica|ayrıca)\s+/i;

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · "API ANAHTARI YOK" YÖNLENDİRME SEZGİSİ
 *
 * Anahtar YOKKEN yalnız AI/internet gerektiren bir istek gelirse (haber, döviz,
 * hava, fıkra, bilmece, "X kimdir/nedir"...) kullanıcı sessiz "anlaşılamadı"
 * yerine ayarlardan anahtar eklemesi için yönlendirilir. Yerel komutlar (harita
 * aç, ses kıs...) anahtarsız çalıştığından bu tetiklenmez. ASR çöpünde yanlış
 * pozitif olmasın diye hedefli anahtar-kelime sezgisi kullanılır.
 * ════════════════════════════════════════════════════════════════════════ */

const AI_HINT_TOKENS: readonly string[] = [
  'haber', 'gundem', 'son dakika', 'manset',
  'dolar', 'euro', 'sterlin', 'altin', 'borsa', 'doviz', 'kur', 'bitcoin',
  'kac para', 'kac lira', 'kac tl',
  'mac', 'skor', 'puan durumu', 'fikstur', 'kim kazandi',
  'fikra', 'saka', 'bilmece', 'siir', 'hikaye anlat',
  'kimdir', 'nedir', 'ne demek', 'anlami ne', 'ozetle', 'acikla', 'arastir',
];

/** AI/internet gerektiren bir istek mi? (anahtarsız yönlendirme için sezgi) */
export function looksLikeAiRequest(raw: string): boolean {
  const n = normalizeTr(raw);
  if (n.split(' ').filter((w) => w.length > 1).length < 2) return false; // tek kelime/çöp değil
  return AI_HINT_TOKENS.some((t) => n.includes(t));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · n-best (ÇOK ADAYLI ASR) SEÇİMİ
 *
 * STT tek "en iyi tahmin"de sık yanılıyor (Vosk küçük TR modeli). Alternatifleri
 * (a) yerel parser'da dener, en yüksek güvenli komutu seçer; (b) beyne verir,
 * beyin bağlamla doğru yorumu seçer. Tek alternatif/eski native → eski davranış.
 * ════════════════════════════════════════════════════════════════════════ */

/** Sağlayıcıdan alınacak azami alternatif sayısı. */
export const STT_MAX_ALTERNATIVES = 4;

/** n-best aday tavanı: her alternatif + onarılmış varyantı eklenince sınırsız
 * büyümesin diye (asrRepair.repairTranscript entegrasyonu). */
const MAX_LOCAL_PARSE_CANDIDATES = 8;

/** n-best: alternatif listesini temizler: top ilk, tekrarsız, max N. */
export function dedupeAlts(alternatives: string[] | undefined, top: string): string[] {
  const out: string[] = [];
  const add = (s: string): void => {
    const t = s.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  add(top);
  if (alternatives) for (const a of alternatives) add(a);
  return out.slice(0, STT_MAX_ALTERNATIVES);
}

/**
 * n-best: en yüksek güvenli komutu üreten parse'ı seçer (eşitte top).
 *
 * Offline ASR onarımı (asrRepair.repairTranscript): her alternatifin hemen
 * ardından onarılmış varyantı da aday listesine eklenir. Onarılmış varyant
 * YALNIZ orijinalden DAHA YÜKSEK confidence üretirse kazanır (>, ≥ değil) —
 * eşitlikte orijinal (listede önce gelen) kazanır, fail-soft garantisi budur:
 * onarım asla mevcut davranışı bozamaz, yalnız iyileştirebilir.
 */
export function bestLocalParse(alts: string[]): ReturnType<typeof parseCommandFull> {
  const candidates: string[] = [];
  for (const a of alts) {
    if (candidates.length >= MAX_LOCAL_PARSE_CANDIDATES) break;
    candidates.push(a);
    if (candidates.length >= MAX_LOCAL_PARSE_CANDIDATES) break;
    const repaired = repairTranscript(a);
    if (repaired && repaired !== a) candidates.push(repaired);
  }

  let best = parseCommandFull(candidates[0]);
  let bestConf = best.command?.confidence ?? 0;
  for (let i = 1; i < candidates.length; i++) {
    const r = parseCommandFull(candidates[i]);
    const c = r.command?.confidence ?? 0;
    if (c > bestConf) { best = r; bestConf = c; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · UI DURUM SIFIRLAMA GECİKMELERİ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Komut önceliğine göre "success → idle" gecikmeleri.
 *
 * ⚠️ SAFLIK: `getConfig()` BURADA OKUNMAZ — çağıran (`voiceService`) okur ve
 * bayrağı geçirir. Üretilen sayılar taşımadan önceki değerlerle BİREBİR aynıdır.
 */
export function computeResetDelays(enableRecommendations: boolean): Record<string, number> {
  const baseMultiplier = enableRecommendations ? 1 : 1.5;
  return {
    critical: Math.round(2000 * baseMultiplier),
    high:     Math.round(2500 * baseMultiplier),
    normal:   Math.round(2500 * baseMultiplier),
  };
}
