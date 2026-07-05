/**
 * companionContext.ts — "Yol Arkadaşım" yolculuk farkındalığı yorumlayıcıları.
 *
 * SAF FONKSİYONLAR: ham araç/yolculuk verisi → insan dili (Türkçe) yorum.
 * Servis import'u YOK — değerleri companionEngine (Commit 4) servislerden
 * (obdService/tripLogService/routingService) toplayıp buraya besler. Bu sayede:
 *  - Cihazsız, mock'suz, deterministik unit test
 *  - Mevcut servislerde sıfır değişiklik riski
 *  - Gemini prompt'una HAM VERİ DEĞİL bu yorumlar girer (mimari §4 —
 *    "ham veri okumama" ilkesi yapısal garanti)
 *
 * Sensor Resiliency (CLAUDE.md §2): imkânsız değerler (NaN, negatif süre,
 * %100 üstü yakıt, 2000 km üstü menzil) yorum üretmez → null döner; çağıran
 * katman fail-soft davranır (cümle kurulamıyorsa susulur).
 *
 * Çıktılar deterministiktir (rastgelelik YOK) — varyant/kişilik katmanı
 * companionPersona'nın işi (Commit 3). Cümleler kısa tutulur (ISO 15008).
 *
 * Bkz: docs/COMPANION_AI_ARCHITECTURE.md §1.7 (veri kaynakları), §6 (modüller).
 */

/* ── Akıl sağlığı sınırları (imkânsız sensör verisi reddi) ──── */

const MAX_PLAUSIBLE_RANGE_KM   = 2000;     // binek araç tek depo üst sınırı
const MAX_PLAUSIBLE_TRIP_MIN   = 48 * 60;  // 48 saat üstü "yolculuk" veri bozulmasıdır
const MAX_PLAUSIBLE_ETA_SEC    = 24 * 3600;
const MAX_PLAUSIBLE_DIST_M     = 5_000_000; // 5000 km

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/* ── Günün dilimi ───────────────────────────────────────────── */

export type TimeOfDay = 'sabah' | 'ogle' | 'aksam' | 'gece';

/**
 * Saat → günün dilimi. Karşılama şablonu seçiminde kullanılır (Commit 3).
 * 05-11 sabah · 11-17 öğle/gündüz · 17-22 akşam · 22-05 gece.
 * Geçersiz saat (NaN, <0, >23) gece sayılır — gece en temkinli dilimdir
 * (proaktif konuşma kısılır), yani hata durumunda fail-safe taraf.
 */
export function interpretTimeOfDay(hour: number): TimeOfDay {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return 'gece';
  const h = Math.floor(hour);
  if (h >= 5 && h < 11)  return 'sabah';
  if (h >= 11 && h < 17) return 'ogle';
  if (h >= 17 && h < 22) return 'aksam';
  return 'gece';
}

/* ── Süre / sayı biçimleme ──────────────────────────────────── */

/**
 * Dakika → doğal Türkçe süre ("2 saat 15 dakika", "45 dakika", "1 saat").
 * TTS dostu: rakam + birim, kısaltma yok. Geçersiz değer → null.
 */
export function formatDurationTr(minutes: number): string | null {
  if (!isFiniteNonNegative(minutes)) return null;
  const total = Math.round(minutes);
  if (total < 1) return 'bir dakikadan az';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} dakika`;
  if (m === 0) return `${h} saat`;
  return `${h} saat ${m} dakika`;
}

/**
 * Süre + "-dır/-tir" eki (ünsüz/ünlü uyumu): "2 saat"→"2 saattir",
 * "45 dakika"→"45 dakikadır", "2 saat 15 dakika"→"2 saat 15 dakikadır".
 */
function withDurSuffix(dur: string): string {
  return dur.endsWith('saat') ? `${dur}tir` : `${dur}dır`;
}

/**
 * Menzil yaklaşıklaması: 100 km altı 10'a, üstü 50'ye yuvarlanır.
 * "143 km" yerine "yaklaşık 140 km" — sahte hassasiyet TTS'te kafa karıştırır.
 */
export function approxRangeKm(km: number): number | null {
  if (!isFiniteNonNegative(km) || km > MAX_PLAUSIBLE_RANGE_KM) return null;
  if (km < 100) return Math.round(km / 10) * 10;
  return Math.round(km / 50) * 50;
}

/* ── Yakıt / menzil ─────────────────────────────────────────── */

/**
 * "Yakıt ne durumda?" yorumu.
 * Eşikler offlineConversationEngine.buildFuel ile hizalı (kritik <10, az <25)
 * ama çıktı yorumludur: ham yüzdeyi MENZİL bağlamıyla birlikte söyler.
 * fuelPercent 0-100 dışında / sayı değilse → null (OBD yok = sus).
 */
export function interpretFuel(fuelPercent: number, rangeKm?: number): string | null {
  if (!isFiniteNonNegative(fuelPercent) || fuelPercent > 100) return null;
  const pct = Math.round(fuelPercent);
  const approx = rangeKm !== undefined ? approxRangeKm(rangeKm) : null;

  // Faz 2 — proaktif rota teklifi: menzil 100 km altına düştüyse yüzdeyi
  // söylemekle yetinme, benzinliği ROTAYA EKLEME teklif et. Hitap/ton yok
  // (persona katmanının işi); teklif cümlesi deterministik kalır.
  if (approx !== null && approx > 0 && approx < 100) {
    if (pct < 10) {
      return `Yakıt kritik seviyede, yüzde ${pct} — yaklaşık ${approx} kilometre menzilin kaldı. Bunu riske atmayalım; istersen rotanın üzerindeki en yakın benzinliğe yönlendireyim.`;
    }
    if (pct < 25) {
      return `Yakıt azalıyor, yüzde ${pct} — bu gidişle yaklaşık ${approx} kilometre yolun var. İstersen yol üstünde uygun bir benzinlik bulup rotana ekleyeyim.`;
    }
    return `Yakıt yüzde ${pct} ama menzil yaklaşık ${approx} kilometreye düştü. İstersen ileride bir benzinliğe uğrayacak şekilde rota önereyim.`;
  }

  const rangePart = approx !== null && approx > 0
    ? ` Mevcut sürüşüne göre yaklaşık ${approx} kilometre yolun var.`
    : '';

  if (pct < 10) return `Yakıt kritik seviyede, yüzde ${pct}.${rangePart} İlk fırsatta benzinliğe uğrayalım.`;
  if (pct < 25) return `Yakıt azalıyor, yüzde ${pct}.${rangePart} Yakında doldurmak iyi olur.`;
  return `Yakıt yüzde ${pct}, durum iyi.${rangePart}`;
}

/**
 * "Ne kadar giderim?" yorumu — menzil odaklı.
 * 50 km altı menzilde aciliyet eklenir. Geçersiz menzil → null.
 */
export function interpretRange(rangeKm: number): string | null {
  const approx = approxRangeKm(rangeKm);
  if (approx === null) return null;
  if (approx <= 0) return 'Menzil neredeyse bitti. Hemen bir benzinlik bulalım.';
  if (approx < 50) return `Kalan yakıtla yaklaşık ${approx} kilometre gidersin. Fazla uzatmadan benzinliğe uğrayalım.`;
  return `Kalan yakıtla yaklaşık ${approx} kilometre gidersin.`;
}

/* ── Menzil vs. aktif rota (yakıt yeterlilik köprüsü) ───────── */

/**
 * "Yakıtım X'e yeter mi?" — aktif rotanın kalan mesafesini araç menziliyle
 * karşılaştırır. İki sinyal birleştirir: OBD menzil + navigasyon kalan mesafe.
 * Yalnız NAVİGASYON AKTİFKEN çağrılır (çağıran getNavigationState ile besler);
 * rota yoksa bağlama hiç girmez.
 *
 * Üç kademe (güvenlik tarafı temkinli — menzil ABARTILMAZ, ham karşılaştırma):
 *  - yetmez  (menzil < yol): yolda yakıt şart + benzinlik teklifi.
 *  - sınırda (menzil < yol×1.15): tampon az, yakıt alması önerilir.
 *  - rahat   (aksi): kısaca "yeter".
 * İmkânsız değer (menzil>2000, yol>5000 km, negatif, NaN) → null.
 */
export function interpretRangeVsRoute(rangeKm: number, routeRemainingKm: number, destName?: string): string | null {
  if (!isFiniteNonNegative(rangeKm) || rangeKm > MAX_PLAUSIBLE_RANGE_KM) return null;
  if (!isFiniteNonNegative(routeRemainingKm) || routeRemainingKm > 5000) return null;
  if (routeRemainingKm < 2) return null; // neredeyse vardık — karşılaştırma anlamsız
  const y = Math.round(routeRemainingKm / 10) * 10 || Math.round(routeRemainingKm);
  const x = Math.round(rangeKm / 10) * 10 || Math.round(rangeKm);
  const dest = destName?.trim();
  const lead = dest
    ? `${dest} rotasında yaklaşık ${y} kilometre yolun var`
    : `Rotanda yaklaşık ${y} kilometre yol var`;
  const rangePart = `menzilin yaklaşık ${x} kilometre`;
  if (rangeKm < routeRemainingKm) {
    return `${lead}; ${rangePart} — bu mesafeye yetmez, yolda en az bir kez yakıt almamız gerekecek. İstersen uygun bir benzinlik planlayayım.`;
  }
  if (rangeKm < routeRemainingKm * 1.15) {
    return `${lead}; ${rangePart} — sınırda kalıyor, yolda bir yerde yakıt alsan içim rahat eder.`;
  }
  return `${lead}; ${rangePart} — rahatça yeter.`;
}

/* ── Batarya / şarj (EV / hibrit) ───────────────────────────── */

/**
 * "Şarjım / menzilim ne durumda?" yorumu — EV/hibrit karşılığı interpretFuel.
 * interpretFuel'in benzin mantığını batarya SoC'ye taşır; iki fark:
 *  - EV'de menzil kaygısı erken başlar → az eşiği %20, kritik %10.
 *  - Şarj OLUYORSA uyarı değil GÜVEN verilir (prizde "az kaldı" demek anlamsız).
 * socPercent 0–100 dışında / sayı değilse → null (ICE'de batteryLevel=-1 = sus).
 * rangeKm EV menzili (obdData.range); charging = chargingState fast/normal.
 */
export function interpretBatteryCharge(socPercent: number, rangeKm?: number, charging?: boolean): string | null {
  if (!isFiniteNonNegative(socPercent) || socPercent > 100) return null;
  const pct = Math.round(socPercent);
  const approx = rangeKm !== undefined ? approxRangeKm(rangeKm) : null;
  const rangePart = approx !== null && approx > 0
    ? ` Kalan şarjla yaklaşık ${approx} kilometre yolun var.`
    : '';

  // Şarjdayken uyarı yerine güven: priz/istasyonda "az kaldı" demek gereksiz.
  if (charging) {
    if (pct >= 95) return `Batarya neredeyse dolu, yüzde ${pct} — az sonra hazırız.`;
    return `Şarj oluyoruz, batarya yüzde ${pct} ve artıyor.${rangePart}`;
  }

  // Menzil 100 km altına düştüyse proaktif şarj teklifi (interpretFuel paraleli).
  if (approx !== null && approx > 0 && approx < 100) {
    if (pct < 10) {
      return `Batarya kritik, yüzde ${pct} — yaklaşık ${approx} kilometre menzilin kaldı. Bunu riske atmayalım; istersen rotanın üstündeki en yakın şarj istasyonuna yönlendireyim.`;
    }
    if (pct < 20) {
      return `Şarj azalıyor, yüzde ${pct} — bu gidişle yaklaşık ${approx} kilometre yolun var. İstersen yol üstünde uygun bir şarj istasyonu bulup rotana ekleyeyim.`;
    }
    return `Batarya yüzde ${pct} ama menzil yaklaşık ${approx} kilometreye düştü. İstersen ileride bir şarj istasyonuna uğrayacak şekilde rota önereyim.`;
  }

  if (pct < 10) return `Batarya kritik seviyede, yüzde ${pct}.${rangePart} İlk fırsatta şarja bağlanalım.`;
  if (pct < 20) return `Şarj azalıyor, yüzde ${pct}.${rangePart} Yakında şarj etmek iyi olur.`;
  return `Batarya yüzde ${pct}, durum iyi.${rangePart}`;
}

/* ── Yolculuk süresi / mola ─────────────────────────────────── */

/**
 * "Ne zamandır yoldayız?" yorumu.
 * tripLogService.TripState.current.liveDurationMin + liveDistanceKm beslenir.
 */
export function interpretTripDuration(durationMin: number, distanceKm?: number): string | null {
  if (!isFiniteNonNegative(durationMin) || durationMin > MAX_PLAUSIBLE_TRIP_MIN) return null;
  const dur = formatDurationTr(durationMin);
  if (dur === null) return null;
  const dist = (distanceKm !== undefined && isFiniteNonNegative(distanceKm) && distanceKm >= 1)
    ? ` Bu sürede ${Math.round(distanceKm)} kilometre yol yaptık.`
    : '';
  if (durationMin < 1) return 'Daha yeni yola çıktık.';
  return `${withDurSuffix(dur)} yoldayız.${dist}`;
}

/**
 * Mola ihtiyacı kararı + cümlesi (PromptScheduler'ın "mola" tetiği — §5).
 * Yalnız eşik AŞILDIYSA cümle döner; aksi hâlde null (= konuşma, sus).
 *
 * @param minutesSinceBreak  Son moladan (veya yolculuk başından) bu yana dakika.
 *                           MONOTONİK kaynaktan gelmeli (CLAUDE.md §4 — clock jump).
 * @param intervalMin        Kullanıcı ayarı (settings.breakReminderIntervalMin).
 *                           30 dk altı geçersiz sayılır (yanlış konfig → sus).
 */
export function interpretBreakNeed(minutesSinceBreak: number, intervalMin: number): string | null {
  if (!isFiniteNonNegative(minutesSinceBreak) || minutesSinceBreak > MAX_PLAUSIBLE_TRIP_MIN) return null;
  if (!isFiniteNonNegative(intervalMin) || intervalMin < 30) return null;
  if (minutesSinceBreak < intervalMin) return null;
  const dur = formatDurationTr(minutesSinceBreak);
  if (dur === null) return null;
  return `${withDurSuffix(dur)} molasız gidiyoruz. Uygun bir yerde kısa bir mola iyi gelir.`;
}

/**
 * "Yorgunum" yanıtı — yolculuk süresi ve gece bilgisiyle yorumlanır.
 * Her zaman cevap üretir (kullanıcı-başlatan soru; null yalnız bozuk veride).
 *
 * Faz 2 — can yoldaşı derinliği: gece + 2 saat üstü sürüşte "mola ver"
 * komutu değil, somut eylem teklifleri (cam, kahve, dinlenme yeri) sunulur.
 * Hitap ("kanka" vb.) BURADA KURULMAZ — kişilik tonu Gemini/persona
 * katmanının işi; profesyonel kişiliğe argo sızmaması böyle garanti edilir.
 */
export function interpretFatigue(tripDurationMin: number, isNight: boolean): string | null {
  if (!isFiniteNonNegative(tripDurationMin) || tripDurationMin > MAX_PLAUSIBLE_TRIP_MIN) return null;
  if (isNight && tripDurationMin >= 120) {
    return 'Gece gece yollar yordu seni, hissediyorum. İstersen camı biraz aralayayım, ya da bir kahve molası verip kendimize gelelim — en yakın dinlenme yerini bulurum.';
  }
  if (isNight) {
    return 'Gece sürüşü insanı sandığından çok yorar. Kendini ağır hissedersen hiç bekletme; söyle, hemen bir mola yeri bulalım.';
  }
  if (tripDurationMin >= 120) {
    return 'Epeydir yoldayız, yorulman çok doğal. İlk uygun yerde mola verip bir kahve içelim derim; istersen camı da biraz aralarım.';
  }
  return 'Daha yolun başındayız ama önemli olan senin nasıl hissettiğin. İstersen kısa bir mola verelim, ya da müziği biraz canlandırayım.';
}

/* ── Rota / varış ───────────────────────────────────────────── */

/**
 * "Ne zaman varırız?" yorumu.
 * routingService.RouteState: kalan mesafe (metre) + kalan süre (saniye).
 * Rota yoksa (0/geçersiz) → null; çağıran "aktif rota yok" durumunu kendisi ele alır.
 */
export function interpretArrival(remainingMeters: number, remainingSeconds: number): string | null {
  if (!isFiniteNonNegative(remainingMeters) || remainingMeters > MAX_PLAUSIBLE_DIST_M) return null;
  if (!isFiniteNonNegative(remainingSeconds) || remainingSeconds > MAX_PLAUSIBLE_ETA_SEC) return null;
  if (remainingMeters < 1 || remainingSeconds < 1) return null;

  const etaMin = Math.max(1, Math.round(remainingSeconds / 60));
  if (remainingMeters < 500) return 'Neredeyse geldik, birkaç yüz metre kaldı.';
  const km = remainingMeters / 1000;
  // Türkçe TTS ondalık ayracı virgül okur ("7,5" → "yedi virgül beş")
  const kmText = km < 10
    ? km.toFixed(1).replace('.0', '').replace('.', ',')
    : String(Math.round(km));
  const dur = formatDurationTr(etaMin);
  if (dur === null) return null;
  if (etaMin <= 10) return `Varışa yaklaşık ${dur} kaldı — ${kmText} kilometre.`;
  return `Varışa yaklaşık ${dur}, ${kmText} kilometre yolumuz var.`;
}

/* ── Motor sıcaklığı (proaktif güvenlik tetiği) ─────────────── */

/**
 * Motor sıcaklığı yorumu — yalnız KONUŞMAYA DEĞER durumlarda cümle döner:
 * soğuk motor (ilk dakikalar) ve aşırı ısınma. Normal aralık → null (sus).
 * Eşikler offlineConversationEngine.buildEngineTemp ile hizalı (70/105).
 *
 * Faz 2 — samimi ton: soğuk motorda "kural" değil dost uyarısı ("biraz
 * ısınsın, öyle basarız"); ısınmada ciddiyet + birliktelik hissi ("ben de
 * göstergeleri izliyorum"). tempC < 50 ilk dakikaların vekil göstergesidir
 * (süre bilgisi bu saf modüle girmez — kaynak: yalnız sensör değeri).
 */
export function interpretEngineTempConcern(tempC: number): string | null {
  if (typeof tempC !== 'number' || !Number.isFinite(tempC) || tempC < -40 || tempC > 200) return null;
  if (tempC > 105) return `Motor sıcaklığı ${Math.round(tempC)} dereceye çıktı — bu şakaya gelmez. Uygun bir yerde durup kontrol edelim, ben de göstergeleri izliyorum.`;
  if (tempC < 50)  return 'Motor daha soğuk — hadi biraz ısınsın, öyle basarız. İlk birkaç dakika yumuşak kullanmak ona iyi gelir.';
  return null;
}

/* ── Gövde güvenliği: kapı / lastik (CAN bus body status) ───── */

/**
 * Türkçe liste birleştirici: ["a","b","c"] → "a, b ve c". Tek eleman → kendisi.
 */
function joinTr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`;
}

/** Cümle başı büyük harf (Türkçe yerel — "ö"→"Ö"). */
function capTr(s: string): string {
  return s.length ? s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) : s;
}

/** Kapı açıklık girdisi — obdData.doors ile yapısal uyumlu (servis bağı YOK). */
export interface DoorAjarInput {
  fl?: boolean; fr?: boolean; rl?: boolean; rr?: boolean; trunk?: boolean;
}

const DOOR_LABEL_TR: Array<[keyof DoorAjarInput, string]> = [
  ['fl', 'sürücü kapısı'],
  ['fr', 'ön yolcu kapısı'],
  ['rl', 'arka sol kapı'],
  ['rr', 'arka sağ kapı'],
  ['trunk', 'bagaj'],
];

/**
 * Kapı/bagaj açık uyarısı — CAN gövde durumundan. Yalnız GERÇEKTEN açık
 * (=== true) olanları sayar; undefined/false = sensör yok ya da kapalı → sus.
 * Hiçbiri açık değilse null. Proaktif motor bunu seyir hâlinde (trip aktif)
 * çağırır — park hâlinde yükleme yaparken "kapı açık" dememek için.
 */
export function interpretDoorAjar(doors?: DoorAjarInput | null): string | null {
  if (!doors || typeof doors !== 'object') return null;
  const open: string[] = [];
  for (const [key, label] of DOOR_LABEL_TR) {
    if (doors[key] === true) open.push(label);
  }
  if (open.length === 0) return null;
  if (open.length === 1) {
    if (open[0] === 'bagaj') return 'Bagaj tam kapanmamış — yolda açılmasın, bir kontrol edelim.';
    return `${capTr(open[0]!)} tam kapanmamış görünüyor — emin olmak için bir bakalım.`;
  }
  return `${capTr(joinTr(open))} açık görünüyor — durup kapatmakta fayda var.`;
}

/** TPMS lastik basıncı girdisi (kPa) — obdData.tpms ile yapısal uyumlu. */
export interface TpmsInput {
  fl?: number; fr?: number; rl?: number; rr?: number;
}

const TIRE_LABEL_TR: Array<[keyof TpmsInput, string]> = [
  ['fl', 'sol ön'],
  ['fr', 'sağ ön'],
  ['rl', 'sol arka'],
  ['rr', 'sağ arka'],
];

// TPMS eşikleri (kPa). Düşük ~1.8 bar: TPMS uyarı lambası eşiği civarı (placard
// ~2.2-2.5 bar'ın %25 altı). Absolüt eşik yanlış-alarmı azaltmak için temkinli;
// placard basıncı OBD'den gelmediğinden adaptif değil. <50 = sensör yok/bozuk.
const TPMS_LOW_KPA          = 180;
const TPMS_MIN_PLAUSIBLE_KPA = 50;
const TPMS_MAX_PLAUSIBLE_KPA = 450;

/**
 * Lastik basıncı düşük uyarısı — TPMS'ten. İmkânsız/eksik değer (undefined,
 * NaN, <50 veya >450 kPa) sensör yok sayılır → o lastik atlanır. Düşük lastik
 * yoksa null. Kalıcı durum → proaktif motor uzun cooldown ile çağırır.
 */
export function interpretTirePressure(tpms?: TpmsInput | null): string | null {
  if (!tpms || typeof tpms !== 'object') return null;
  const low: string[] = [];
  for (const [key, label] of TIRE_LABEL_TR) {
    const v = tpms[key];
    if (typeof v === 'number' && Number.isFinite(v) &&
        v >= TPMS_MIN_PLAUSIBLE_KPA && v <= TPMS_MAX_PLAUSIBLE_KPA && v < TPMS_LOW_KPA) {
      low.push(label);
    }
  }
  if (low.length === 0) return null;
  if (low.length === 1) {
    return `${capTr(low[0]!)} lastiğin basıncı düşük görünüyor — ilk fırsatta kontrol edelim.`;
  }
  return `${capTr(joinTr(low))} lastiklerin basıncı düşük — güvenlik için bir kontrol iyi olur.`;
}

/* ── Arıza kodu (DTC) durumu ─────────────────────────────────── */

/**
 * "Arızam var mı?" yorumu — dtcService.onDTCState senkron son-değer
 * yakalamasından (V2, ASSISTANT_VEHICLE_INTEGRATION_PLAN.md) beslenir.
 * Ham kod listesi (P0300 vb.) BEYNE GİTMEZ, yalnız SAYI yorumlanır —
 * kodun kendisi/nedeni sorulursa dtcService/DTCPanel ekranına yönlendirilir
 * (bu modülün işi değil).
 *
 * 0 aktif + 0 bekleyen → null: SORUN YOKSA bağlama hiç girme (token
 * tasarrufu — plan §"boşta sıfır maliyet" ilkesiyle hizalı).
 * pendingCount imkânsız/eksikse (negatif, NaN, verilmemiş) yok sayılır —
 * yalnız activeCount geçersizse (negatif/NaN) TÜM sonuç null olur.
 */
export function interpretDtcStatus(activeCount: number, pendingCount?: number): string | null {
  if (!isFiniteNonNegative(activeCount)) return null;
  const active  = Math.round(activeCount);
  const pending = isFiniteNonNegative(pendingCount) ? Math.round(pendingCount as number) : 0;
  if (active === 0 && pending === 0) return null;

  if (active > 0 && pending > 0) {
    return `Araçta ${active} aktif arıza kaydı, ${pending} bekleyen kod daha var.`;
  }
  if (active > 0) {
    return active === 1
      ? 'Araçta 1 aktif arıza kaydı var.'
      : `Araçta ${active} aktif arıza kaydı var.`;
  }
  return pending === 1
    ? 'Araçta henüz kesinleşmemiş 1 bekleyen arıza kodu var.'
    : `Araçta henüz kesinleşmemiş ${pending} bekleyen arıza kodu var.`;
}

/* ── Bakım hatırlatması ──────────────────────────────────────── */

/**
 * Bakım kalemi girdisi — vehicleMaintenanceService.MaintenanceAssessment ile
 * yapısal uyumlu (servis import'u YOK, yalnız gerekli ham alanlar taşınır).
 */
export interface MaintenanceItemInput {
  label: string;
  status: 'ok' | 'warning' | 'critical';
  daysLeft?: number;
  kmsLeft?: number;
}

/**
 * "Bakımım ne durumda?" yorumu — status !== 'ok' olan kalemlerden EN ACİL
 * olanı tek cümleyle özetler (çoklu kalem varsa bile tek satır — token
 * bütçesi). Aciliyet sırası: critical > warning; eşitlikte kalan gün/km'si
 * en az olan öne alınır. Süre/km NEGATİF ise (tarihi/kilometresi geçmiş)
 * bu GEÇERLİ bir sinyaldir — calculateDaysLeft zaten negatif döner, red
 * EDİLMEZ (yalnız NaN/Infinity reddedilir).
 * Hepsi 'ok' veya girdi yoksa → null (bağlama girmez).
 */
export function interpretMaintenanceDue(items?: MaintenanceItemInput[] | null): string | null {
  if (!items || !Array.isArray(items) || items.length === 0) return null;
  const due = items.filter((i) =>
    i && (i.status === 'warning' || i.status === 'critical') && typeof i.label === 'string');
  if (due.length === 0) return null;

  const remain = (i: MaintenanceItemInput): number => {
    const d = typeof i.daysLeft === 'number' && Number.isFinite(i.daysLeft) ? i.daysLeft : Infinity;
    const k = typeof i.kmsLeft === 'number' && Number.isFinite(i.kmsLeft) ? i.kmsLeft : Infinity;
    return Math.min(d, k);
  };
  const rank = (i: MaintenanceItemInput): number => (i.status === 'critical' ? 0 : 1);
  const top = [...due].sort((a, b) => rank(a) - rank(b) || remain(a) - remain(b))[0];

  const label = top.label.trim() || 'Bir bakım kalemi';
  const overdue =
    (typeof top.daysLeft === 'number' && Number.isFinite(top.daysLeft) && top.daysLeft < 0) ||
    (typeof top.kmsLeft === 'number' && Number.isFinite(top.kmsLeft) && top.kmsLeft < 0);

  if (overdue) return `${label} süresi geçmiş görünüyor — bir an önce ilgilenelim.`;
  if (top.status === 'critical') return `${label} için süre daralıyor — yakında bir randevu iyi olur.`;
  return `${label} yaklaşıyor, aklında olsun.`;
}

/* ── Bağlam köprüsü: kötü hava + farlar (görünürlük) ────────── */

// Görünürlük düşüren WMO hava kodları: sis (45/48), çiseleme (51-55),
// yağmur (61-65), kar (71-77), sağanak (80-82), karlı sağanak (85/86),
// gök gürültülü fırtına (95-99). Kaynak: weatherService _wmoDesc ile hizalı.
const LOW_VISIBILITY_WMO = new Set([
  45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

/**
 * Bağlam köprüsü — kötü hava + farlar: görünürlük düşüren havada (yağmur/kar/
 * sis) FAR HATIRLATMASI. İki sinyal birleştirir: WMO hava kodu + far durumu.
 *
 * ⚠️ headlightsOn boolean'dır: "kapalı" ile "veri yok"u AYIRT EDEMEYİZ (OBD
 * far durumu bildirmezse false gelir). Bu yüzden:
 *  - headlightsOn === true (BİLİNEN açık) → sustur (null); gereksiz hatırlatma yok.
 *  - aksi (kapalı VEYA bilinmiyor) → İDDİA değil SORU sor ("farların açık mı?").
 *    Bu ifade her iki durumda da dürüst ve güvenli (yanlış "farın kapalı" demez).
 * Hava kodu görünürlük listesinde değilse (açık/bulutlu) → null.
 */
export function interpretVisibilityLights(weatherCode: number, headlightsOn: boolean): string | null {
  if (typeof weatherCode !== 'number' || !Number.isFinite(weatherCode)) return null;
  if (!LOW_VISIBILITY_WMO.has(weatherCode)) return null;
  if (headlightsOn === true) return null; // farlar zaten açık — hatırlatma gereksiz
  const isFog  = weatherCode === 45 || weatherCode === 48;
  const isSnow = (weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86;
  const cause  = isFog ? 'Sis bastırdı' : isSnow ? 'Kar başladı' : 'Yağmur başladı';
  return `${cause}, görünürlük düştü — farların açık mı? Değilse açmakta fayda var.`;
}
