/**
 * Offline Conversation Engine — internet gerekmeden doğal dil yanıtları.
 *
 * Tamamen kural tabanlı: SKORLU anahtar-kelime eşleştirme + araç bağlamı enjeksiyonu.
 *   - ML model yok, ağ çağrısı yok, 0 ek bağımlılık.
 *   - Senkron — ana thread'i bloklama yok.
 *   - Sürüş modu: isDriving=true → kısa yanıt (ISO 15008).
 *   - Veri: hız (GPS/OBD), yakıt/menzil/sıcaklık/RPM/akü/lastik/kapı/far (OBD),
 *           ETA/mesafe (rota), müzik (MediaSession), saat/tarih.
 *
 * ESKİDEN: ilk-eşleşen-regex kazanırdı → Vosk'un kelime varyasyonları (sıra/ek farkı)
 * kaçıyordu. ARTIK: her niyetin anahtar kelimeleri girişte aranır, EN ÇOK eşleşen
 * niyet kazanır (kelime sırasından bağımsız, eş anlamlılara dayanıklı).
 */

import { getMediaState }  from './mediaService';
import { getGPSState }    from './gpsService';
import { onOBDData }      from './obdService';
import { getRouteState }  from './routingService';

/* ── Types ───────────────────────────────────────────────────── */

export interface ConvResult {
  response: string;
  handled:  boolean;
}

interface CarSnapshot {
  speedKmh?:        number;
  rpm?:             number;
  engineTemp?:      number;
  fuelLevel?:       number;       // %
  fuelRemainingL?:  number;       // litre
  rangeKm?:         number;       // tahmini menzil
  batteryVoltage?:  number;       // 12V sistem
  batteryLevel?:    number;       // EV %
  chargingState?:   string;
  throttle?:        number;
  headlights?:      boolean;
  doors?:           { fl: boolean; fr: boolean; rl: boolean; rr: boolean; trunk: boolean };
  tpms?:            { fl: number; fr: number; rl: number; rr: number };
}

/* ── Helpers ─────────────────────────────────────────────────── */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Türkçe karakterleri ASCII'ye indir — commandParser ile aynı mantık. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** OBD anlık snapshot — onOBDData abone/ayrıl döngüsüyle tek ölçüm alır. */
function carSnapshot(): CarSnapshot {
  let snap: CarSnapshot = {};
  try {
    const unsub = onOBDData((d) => {
      snap = {
        speedKmh:       d.speed,
        rpm:            d.rpm,
        engineTemp:     d.engineTemp,
        fuelLevel:      d.fuelLevel,
        fuelRemainingL: d.fuelRemainingL,
        rangeKm:        d.estimatedRangeKm >= 0 ? d.estimatedRangeKm : (d.range >= 0 ? d.range : undefined),
        batteryVoltage: d.batteryVoltage,
        batteryLevel:   d.batteryLevel >= 0 ? d.batteryLevel : undefined,
        chargingState:  d.chargingState,
        throttle:       d.throttle,
        headlights:     d.headlights,
        doors:          d.doors,
        tpms:           d.tpms,
      };
    });
    unsub();
  } catch { /* OBD bağlı değil — zarifçe devam */ }
  return snap;
}

/** Sürüş sırasında uzun yanıtı kısalt. */
function drive(full: string, short: string, isDriving?: boolean): string {
  return isDriving ? short : full;
}

const NO_OBD = 'OBD bağlı değil, bu bilgiyi alamıyorum.';

/* ── Saat / Tarih ────────────────────────────────────────────── */

function buildTime(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes().toString().padStart(2, '0');
  return `Saat ${h}:${m}.`;
}

function buildDate(): string {
  const DAYS   = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const now = new Date();
  return `Bugün ${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`;
}

/* ── Araç verisi ─────────────────────────────────────────────── */

function buildSpeed(ctxSpeed?: number): string {
  const c = carSnapshot();
  const spd = ctxSpeed ?? c.speedKmh ?? getGPSState().location?.speed ?? 0;
  if (spd < 2)  return pick(['Şu an duruyoruz.', 'Araç durmuş durumda.']);
  return `Saatte ${Math.round(spd)} kilometre hızla gidiyoruz.`;
}

function buildRpm(): string {
  const { rpm } = carSnapshot();
  if (rpm === undefined || rpm < 0) return 'Motor devri bilgisi yok (OBD desteklemiyor olabilir).';
  if (rpm < 100) return 'Motor şu an çalışmıyor gibi görünüyor.';
  return `Motor devri ${Math.round(rpm)} RPM.`;
}

function buildFuel(): string {
  const { fuelLevel, fuelRemainingL } = carSnapshot();
  if (fuelLevel === undefined || fuelLevel < 0) return NO_OBD;
  const litres = (fuelRemainingL !== undefined && fuelRemainingL > 0)
    ? ` (yaklaşık ${fuelRemainingL} litre)` : '';
  if (fuelLevel < 10) return `Yakıt kritik: yüzde ${Math.round(fuelLevel)}${litres}. Benzinliğe uğrayalım.`;
  if (fuelLevel < 25) return `Yakıt az: yüzde ${Math.round(fuelLevel)}${litres}. Yakında doldurmalısın.`;
  return `Yakıt seviyesi yüzde ${Math.round(fuelLevel)}${litres}.`;
}

function buildRange(): string {
  const { rangeKm, batteryLevel } = carSnapshot();
  if (batteryLevel !== undefined) {
    const r = rangeKm !== undefined ? ` Tahmini menzil ${rangeKm} kilometre.` : '';
    return `Batarya yüzde ${Math.round(batteryLevel)}.${r}`;
  }
  if (rangeKm === undefined) {
    return 'Menzil için ortalama tüketim ayarı gerekli. Ayarlardan depo ve tüketim değerini girersen hesaplarım.';
  }
  return `Kalan yakıtla tahmini menzilin yaklaşık ${rangeKm} kilometre.`;
}

function buildEngineTemp(): string {
  const { engineTemp } = carSnapshot();
  if (engineTemp === undefined || engineTemp < -40) return NO_OBD;
  if (engineTemp < 70)  return `Motor henüz ısınıyor, ${Math.round(engineTemp)} derece.`;
  if (engineTemp > 105) return `Motor aşırı ısınıyor! ${Math.round(engineTemp)} derece — dur ve kontrol et!`;
  return `Motor sıcaklığı normal: ${Math.round(engineTemp)} derece.`;
}

function buildBattery(): string {
  const { batteryVoltage, batteryLevel } = carSnapshot();
  if (batteryLevel !== undefined) return `Batarya seviyesi yüzde ${Math.round(batteryLevel)}.`;
  if (batteryVoltage === undefined || batteryVoltage <= 0) return NO_OBD;
  const v = batteryVoltage.toFixed(1);
  if (batteryVoltage < 12.2) return `Akü voltajı düşük: ${v} volt. Akü zayıflıyor olabilir.`;
  if (batteryVoltage > 14.8) return `Akü voltajı yüksek: ${v} volt. Şarj sistemini kontrol ettir.`;
  return `Akü voltajı ${v} volt, normal.`;
}

function buildTires(): string {
  const { tpms } = carSnapshot();
  if (!tpms) return 'Lastik basıncı bilgisi yok (araç TPMS sağlamıyor olabilir).';
  const vals = [tpms.fl, tpms.fr, tpms.rl, tpms.rr];
  if (vals.some((v) => v == null || v <= 0)) return 'Lastik basıncı okunamıyor.';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  // Normal bant ≈ 210–260 (kPa). Dışına çıkan varsa uyar.
  if (lo < 200) return `Bir lastiğin basıncı düşük (en düşük ${lo}). Lastikleri kontrol et: ön sol ${tpms.fl}, ön sağ ${tpms.fr}, arka sol ${tpms.rl}, arka sağ ${tpms.rr}.`;
  if (hi > 280) return `Bir lastiğin basıncı yüksek (en yüksek ${hi}). Kontrol etmekte fayda var.`;
  return 'Lastik basınçların normal görünüyor.';
}

function buildDoors(): string {
  const { doors } = carSnapshot();
  if (!doors) return 'Kapı durumu bilgisi yok.';
  const open: string[] = [];
  if (doors.fl) open.push('ön sol');
  if (doors.fr) open.push('ön sağ');
  if (doors.rl) open.push('arka sol');
  if (doors.rr) open.push('arka sağ');
  if (doors.trunk) open.push('bagaj');
  if (open.length === 0) return 'Tüm kapılar kapalı.';
  return `Açık: ${open.join(', ')}.`;
}

function buildHeadlights(): string {
  const { headlights } = carSnapshot();
  if (headlights === undefined) return 'Far durumu bilgisi yok.';
  return headlights ? 'Farlar açık.' : 'Farlar kapalı.';
}

/* ── Rota / Navigasyon ───────────────────────────────────────── */

function buildEta(): string {
  const r = getRouteState();
  if (!r.geometry || r.totalDurationSeconds <= 0) {
    return 'Şu an aktif bir rota yok. Önce hedef söyle.';
  }
  const mins = Math.round(r.totalDurationSeconds / 60);
  const arrival = new Date(Date.now() + r.totalDurationSeconds * 1000);
  const ah = arrival.getHours();
  const am = arrival.getMinutes().toString().padStart(2, '0');
  if (mins < 1) return 'Neredeyse vardık.';
  if (mins < 60) return `Varışa yaklaşık ${mins} dakika. Tahmini varış ${ah}:${am}.`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Varışa yaklaşık ${h} saat ${m} dakika. Tahmini varış ${ah}:${am}.`;
}

function buildDistance(): string {
  const r = getRouteState();
  if (!r.geometry || r.totalDistanceMeters <= 0) {
    return 'Şu an aktif bir rota yok.';
  }
  const km = r.totalDistanceMeters / 1000;
  if (km < 1) return `${Math.round(r.totalDistanceMeters)} metre kaldı.`;
  return `Hedefe yaklaşık ${km.toFixed(1)} kilometre yol var.`;
}

/* ── Müzik ───────────────────────────────────────────────────── */

function buildMusic(): string {
  const ms = getMediaState();
  if (!ms.hasSession || !ms.track.title) {
    return pick(['Şu an müzik çalmıyor.', 'Aktif müzik kaynağı yok.']);
  }
  const artist = ms.track.artist ? ` — ${ms.track.artist}` : '';
  return `"${ms.track.title}"${artist} çalıyor.`;
}

/* ── Statik yanıt setleri ────────────────────────────────────── */

const GREETINGS = [
  'Merhaba! Nasıl yardımcı olabilirim?',
  'Selam! Buyur, dinliyorum.',
  'Hey! Emirleriniz?',
  'Merhaba, CockpitOS hazır!',
];
const HOW_ARE_YOU = [
  'İyiyim, teşekkürler! Yolculuk nasıl gidiyor?',
  'Gayet iyi! Bir şeye ihtiyacın var mı?',
  'Çalışır durumdayım, endişelenme!',
  'Hem iyi hem hızlıyım — sen nasılsın?',
];
const THANKS = [
  'Rica ederim!', 'Ne demek, her zaman!',
  'Yardımcı olabildiğime memnunum.', 'Buyur, başka bir şey?',
];
const GOODBYE = [
  'Güle güle! İyi yolculuklar.', 'Hoşça kal! Dikkatli git.', 'Görüşmek üzere!',
];
const JOKES = [
  "GPS'e sordular: Neden dur diyorsun? Çünkü sen kırmızı ışıkta bile dinlemiyorsun.",
  'Bir araba ne zaman akıllıdır? İçinde sen olmadığında!',
  'Dedim asistan ne zaman hata yapar, dediler navigasyonda sola dönmeyi söyleyince.',
  'Ben araç içi asistanım. Şaka bilgim harita verisi kadar güncel!',
];
const WHO_AM_I = [
  'Ben CockpitOS asistanıyım — internetsiz de çalışırım!',
  'CockpitOS, senin araç asistanın. Müzik, navigasyon, araç bilgisi — hepsi burada.',
  'Adım CockpitOS. Komut beklemiyorum, muhabbet de ederim!',
];
const HELP_TEXT =
  'Şunları sorabilirsin: hız, yakıt, menzil, motor sıcaklığı, devir, akü voltajı, ' +
  'lastik ve kapı durumu, varışa ne kadar kaldı, ne çalıyor, saat ve tarih. ' +
  'Ayrıca navigasyon başlat, müzik çal, ses ayarla, uygulama aç diyebilirsin.';
const WEATHER_OFFLINE = 'Hava durumu için internet gerekiyor. Şu an çevrimdışısın.';
const TRAFFIC_OFFLINE = 'Trafik bilgisi için internet bağlantısı gerekli.';

/* ── Niyet tablosu (skorlu eşleştirme) ───────────────────────────
 * Her niyet: anahtar kelimeler (normalize, çok-kelimeli = daha spesifik = yüksek puan)
 * + yanıt üreticisi. Girişte en çok eşleşen niyet kazanır. */

interface Intent {
  kw:    string[];
  build: (isDriving?: boolean, speedKmh?: number) => string;
}

const INTENTS: Intent[] = [
  // ── Araç verisi (yüksek değer) ──
  { kw: ['hiz kac', 'kac km', 'kac hizla', 'hizimiz', 'ne kadar hiz', 'kac kmh', 'hiz nedir', 'ne hizla'],
    build: (drv, spd) => drive(buildSpeed(spd), buildSpeed(spd), drv) },
  { kw: ['motor devri', 'devir kac', 'kac devir', 'rpm kac', 'kac rpm', 'devir nedir'],
    build: (drv) => drive(buildRpm(), buildRpm(), drv) },
  { kw: ['yakit kac', 'yakit ne kadar', 'ne kadar yakit', 'yakit seviyesi', 'benzin kaldi', 'mazot kaldi',
    'yakit durum', 'depoda ne', 'benzin ne kadar', 'kac yakit', 'yakit var mi', 'benzin var mi'],
    build: (drv) => drive(buildFuel(), buildFuel(), drv) },
  { kw: ['menzil', 'kac km gider', 'ne kadar gider', 'daha ne kadar gider', 'kac kilometre gider', 'kalan menzil'],
    build: (drv) => drive(buildRange(), buildRange(), drv) },
  { kw: ['motor sicakligi', 'motor kac derece', 'kac derece motor', 'motor isiyor', 'motor sicak',
    'motor isindi', 'hararet', 'sicaklik kac'],
    build: (drv) => drive(buildEngineTemp(), buildEngineTemp(), drv) },
  { kw: ['aku voltaj', 'aku kac volt', 'kac volt', 'aku durumu', 'aku seviyesi', 'voltaj kac', 'aku nasil', 'batarya'],
    build: (drv) => drive(buildBattery(), buildBattery(), drv) },
  { kw: ['lastik basinc', 'lastik kac', 'lastik durum', 'lastikler nasil', 'tekerlek basinc', 'lastik hava'],
    build: (drv) => drive(buildTires(), buildTires(), drv) },
  { kw: ['kapi acik', 'kapilar acik', 'kapi durumu', 'kapi kapali mi', 'bagaj acik', 'kapilar kapali mi'],
    build: (drv) => drive(buildDoors(), buildDoors(), drv) },
  { kw: ['far acik', 'farlar acik', 'far durumu', 'farlar yaniyor', 'far yaniyor mu', 'farlar kapali mi'],
    build: (drv) => drive(buildHeadlights(), buildHeadlights(), drv) },

  // ── Rota / Navigasyon ──
  { kw: ['varisa ne kadar', 'ne zaman varir', 'ne zaman variriz', 'kac dakika kaldi', 'varis ne zaman',
    'eta', 'ne zaman ulasir', 'daha ne kadar var', 'kac dakika var'],
    build: (drv) => drive(buildEta(), buildEta(), drv) },
  { kw: ['ne kadar yol', 'kac km kaldi', 'kac kilometre kaldi', 'mesafe ne kadar', 'kac km var', 'kalan mesafe',
    'hedefe ne kadar'],
    build: (drv) => drive(buildDistance(), buildDistance(), drv) },

  // ── Saat / Tarih ──
  { kw: ['saat ve tarih', 'tarih ve saat'],
    build: () => `${buildTime()} ${buildDate()}` },
  { kw: ['saat kac', 'saat ne', 'saat nedir', 'kac saat oldu', 'saat kaci'],
    build: () => buildTime() },
  { kw: ['bugun ne gunu', 'tarih ne', 'hangi gun', 'gunlerden ne', 'kacincisi', 'bugunun tarihi', 'bugun kac',
    'ayin kaci', 'hangi tarih'],
    build: () => buildDate() },

  // ── Müzik ──
  { kw: ['ne caliyor', 'sarki adi', 'ne muzik', 'sarki ne', 'kim soyluyor', 'muzik ne', 'hangi sarki',
    'sarkinin adi', 'bu sarki ne'],
    build: (drv) => drive(buildMusic(), buildMusic(), drv) },

  // ── Hava / Trafik (offline stub) ──
  { kw: ['hava durumu', 'hava nasil', 'dis sicaklik', 'dis hava', 'hava kac derece', 'yagmur var mi'],
    build: (drv) => drive(WEATHER_OFFLINE, 'İnternet yok, hava bilinmiyor.', drv) },
  { kw: ['trafik nasil', 'trafik var mi', 'trafik durumu', 'yol acik mi', 'yogunluk var mi'],
    build: (drv) => drive(TRAFFIC_OFFLINE, 'İnternet yok, trafik bilinmiyor.', drv) },

  // ── Sohbet ──
  { kw: ['merhaba', 'selam', 'gunaydin', 'iyi gunler', 'iyi aksamlar', 'iyi sabahlar', 'alo', 'hey'],
    build: () => pick(GREETINGS) },
  { kw: ['nasilsin', 'nasil misin', 'ne haber', 'naber', 'iyi misin', 'keyifler nasil', 'ne var ne yok'],
    build: (drv) => drive(pick(HOW_ARE_YOU), 'İyiyim, teşekkürler!', drv) },
  { kw: ['tesekkur', 'sagol', 'eyvallah', 'cok guzel', 'harika', 'mukemmel', 'super', 'bravo', 'tesekkurler'],
    build: () => pick(THANKS) },
  { kw: ['gule gule', 'hosca kal', 'gorusuruz', 'gorusurum', 'bay bay', 'bye', 'kendine iyi bak'],
    build: () => pick(GOODBYE) },
  { kw: ['saka anlat', 'fikra anlat', 'guldur', 'saka yap', 'eglenceli bir sey', 'komik bir sey'],
    build: () => pick(JOKES) },
  { kw: ['kimsin', 'sen kimsin', 'adin ne', 'ismin ne', 'nesin', 'hangi asistan', 'kim sin'],
    build: () => pick(WHO_AM_I) },
  { kw: ['ne yapabilirsin', 'yardim', 'komutlar', 'ne biliyorsun', 'ne yaparsin', 'neler yapabilirsin',
    'nasil kullanilir', 'ne sorabilirim'],
    build: (drv) => drive(HELP_TEXT, 'Hız, yakıt, menzil, varış, müzik sorabilirsin.', drv) },
  { kw: ['iyi yolculuklar', 'guvenli surus', 'iyi suruc', 'kolay gelsin'],
    build: () => pick(['İyi yolculuklar!', 'Güvenli sürüşler, dikkatli ol.', 'Teşekkürler, güvenli git!']) },
];

/* ── Skorlama ─────────────────────────────────────────────────── */

// Eşleşme eşiği: en az bir anahtar kelime tam (substring) bulunmalı.
// Çok-kelimeli anahtarlar 2 puan (spesifik), tek-kelimeli 1 puan.
function scoreIntent(n: string, kw: string[]): number {
  let s = 0;
  for (const k of kw) {
    if (n.includes(k)) s += k.includes(' ') ? 2 : 1;
  }
  return s;
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Ham metin girişini konuşma motoruyla değerlendirir (skorlu).
 * En yüksek puanlı niyet (≥1) yanıtı döner; eşleşme yoksa handled:false.
 */
export function tryOfflineConversation(
  raw:        string,
  isDriving?: boolean,
  speedKmh?:  number,
): ConvResult {
  if (!raw.trim()) return { handled: false, response: '' };

  const n = norm(raw);

  let bestScore = 0;
  let best: Intent | null = null;
  for (const intent of INTENTS) {
    const s = scoreIntent(n, intent.kw);
    if (s > bestScore) { bestScore = s; best = intent; }
  }

  if (best && bestScore >= 1) {
    return { handled: true, response: best.build(isDriving, speedKmh) };
  }

  return { handled: false, response: '' };
}
