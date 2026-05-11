/**
 * Offline Conversation Engine — internet gerekmeden doğal dil yanıtları.
 *
 * Tamamen kural tabanlı: regex pattern tablosu + araç bağlamı enjeksiyonu.
 *   - ML model yok, ağ çağrısı yok, 0 ek bağımlılık.
 *   - Senkron — ana thread'i bloklama yok.
 *   - Sürüş modu: isDriving=true → ≤ 8 kelime (ISO 15008).
 *   - Araç verisi: hız (GPS), yakıt/sıcaklık (OBD snapshot), müzik (MediaSession).
 */

import { getMediaState } from './mediaService';
import { getGPSState }   from './gpsService';
import { onOBDData }     from './obdService';

/* ── Types ───────────────────────────────────────────────────── */

export interface ConvResult {
  response: string;
  handled:  boolean;
}

interface OBDSnapshot {
  fuelLevel?:  number;
  engineTemp?: number;
  speedKmh?:   number;
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
function obdSnapshot(): OBDSnapshot {
  let snap: OBDSnapshot = {};
  try {
    const unsub = onOBDData((d) => {
      snap = { fuelLevel: d.fuelLevel, engineTemp: d.engineTemp, speedKmh: d.speed };
    });
    unsub();
  } catch { /* OBD bağlı değil — zarifçe devam */ }
  return snap;
}

/** Sürüş sırasında uzun yanıtı kısalt (≤ 8 kelime). */
function drive(full: string, short: string, isDriving?: boolean): string {
  return isDriving ? short : full;
}

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
  const obd = obdSnapshot();
  const spd = ctxSpeed ?? obd.speedKmh ?? getGPSState().location?.speed ?? 0;
  if (spd < 2)  return pick(['Şu an duruyoruz.', 'Araç durmuş durumda.']);
  return `Saatte ${Math.round(spd)} km hızla gidiyoruz.`;
}

function buildFuel(): string {
  const { fuelLevel } = obdSnapshot();
  if (fuelLevel === undefined) return 'OBD bağlı değil, yakıt bilgisi alınamıyor.';
  if (fuelLevel < 10) return `Yakıt kritik: yüzde ${Math.round(fuelLevel)}. Benzinliğe uğrayalım.`;
  if (fuelLevel < 25) return `Yakıt az: yüzde ${Math.round(fuelLevel)}. Yakında doldurmalısın.`;
  return `Yakıt seviyesi yüzde ${Math.round(fuelLevel)}.`;
}

function buildEngineTemp(): string {
  const { engineTemp } = obdSnapshot();
  if (engineTemp === undefined) return 'OBD bağlı değil, sıcaklık bilgisi yok.';
  if (engineTemp < 70)  return `Motor henüz ısınıyor, ${Math.round(engineTemp)} derece.`;
  if (engineTemp > 105) return `Motor aşırı ısınıyor! ${Math.round(engineTemp)} derece — dur ve kontrol et!`;
  return `Motor sıcaklığı normal: ${Math.round(engineTemp)} derece.`;
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
  'Rica ederim!',
  'Ne demek, her zaman!',
  'Yardımcı olabildiğime memnunum.',
  'Buyur, başka bir şey?',
];

const GOODBYE = [
  'Güle güle! İyi yolculuklar.',
  'Hoşça kal! Dikkatli git.',
  'Görüşmek üzere!',
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
  'Şunları yapabilirim: navigasyon başlat, müzik çal veya değiştir, ' +
  'ses ayarla, Bluetooth yönet, saat ve tarih söyle, ' +
  'hız, yakıt ve motor sıcaklığı bildir, ' +
  'uygulama aç, şaka anlat. ' +
  'İnternet varsa çok daha fazlasını anlayabilirim.';

const WEATHER_OFFLINE =
  'Hava durumu için internet gerekiyor. Şu an çevrimdışısın.';

const TRAFFIC_OFFLINE =
  'Trafik bilgisi için internet bağlantısı gerekli.';

/* ── Pattern tablosu ─────────────────────────────────────────── */

type Handler = (n: string, isDriving?: boolean, speedKmh?: number) => string;

const PATTERNS: [RegExp, Handler][] = [

  /* Selamlama */
  [/\b(merhaba|selam|hey|gunaydin|iyi gunler|iyi aksamlar|iyi sabahlar)\b/,
    () => pick(GREETINGS)],

  /* Nasılsın / Ne haber */
  [/\b(nasilsin|nasil misin|ne haber|naber|iyi misin|nasılsın)\b/,
    (_, drv) => drive(pick(HOW_ARE_YOU), 'İyiyim, teşekkürler!', drv)],

  /* Teşekkür / Onay */
  [/\b(tesekk|sagol|eyvallah|cok guzel|harika|mukemmel|super|bravo)\b/,
    () => pick(THANKS)],

  /* Güle güle / Veda */
  [/\b(gule gule|hosca kal|gorusurum|gorururuz|gorusuruz|bay bay|bye)\b/,
    () => pick(GOODBYE)],

  /* Saat */
  [/\b(saat kac|saat ne|saat nedir|kac saat oldu|saat kaci)\b/,
    () => buildTime()],

  /* Tarih / Gün */
  [/\b(bugun ne gunu|tarih ne|hangi gun|gunlerden ne|kacincisi|bugunun tarihi|bugun kac)\b/,
    () => buildDate()],

  /* Saat VE Tarih birlikte */
  [/\b(saat ve tarih|tarih ve saat)\b/,
    () => `${buildTime()} ${buildDate()}`],

  /* Ne çalıyor / Müzik adı */
  [/\b(ne caliyor|sarki adi|ne muzik|sarki ne|kim soyluyor|muzik ne|hangi sarki)\b/,
    (_, drv) => drive(buildMusic(), buildMusic(), drv)],

  /* Hız */
  [/\b(hiz kac|kac km|kac hizla|hizimiz|ne kadar hiz|kac kmh|hiz nedir)\b/,
    (_, drv, spd) => drive(buildSpeed(spd), buildSpeed(spd), drv)],

  /* Yakıt */
  [/\b(yakit kac|yakit ne kadar|ne kadar yakit|yakit seviyesi|benzin kaldi|mazot kaldi|yakit durum)\b/,
    (_, drv) => drive(buildFuel(), buildFuel(), drv)],

  /* Motor sıcaklığı */
  [/\b(motor sicakligi|motor kac derece|kac derece motor|engine temp|motor isiyor|motor sicak)\b/,
    (_, drv) => drive(buildEngineTemp(), buildEngineTemp(), drv)],

  /* Hava durumu */
  [/\b(hava durumu|hava nasil|dis sicaklik|dis hava|hava kac derece)\b/,
    (_, drv) => drive(WEATHER_OFFLINE, 'İnternet yok, hava bilinmiyor.', drv)],

  /* Trafik */
  [/\b(trafik nasil|trafik var mi|trafik durumu|yol acik mi)\b/,
    (_, drv) => drive(TRAFFIC_OFFLINE, 'İnternet yok, trafik bilinmiyor.', drv)],

  /* Şaka / Fıkra */
  [/\b(saka anlat|fikra anlat|guldurucu bir sey|beni guldururunsun|saka yap|beni guldurum|eglenceli)\b/,
    () => pick(JOKES)],

  /* Kim sin / ne sin */
  [/\b(kim sin|sen kimsin|adin ne|ismin ne|ne sin|hangi asistan)\b/,
    () => pick(WHO_AM_I)],

  /* Ne yapabilirsin / Yardım */
  [/\b(ne yapabilirsin|yardim|komutlar|ne biliyorsun|ne yaparsın|ne ogrettin|nasil kullanilir)\b/,
    (_, drv) => drive(HELP_TEXT, 'Komut veya müzik, navigasyon, araç bilgisi.', drv)],

  /* İyi yolculuk / dilekler */
  [/\b(iyi yolculuklar|guvenli surusler|iyi surucler|kolay gelsin)\b/,
    () => pick(['İyi yolculuklar!', 'Güvenli sürüşler, dikkatli ol.', 'Teşekkürler, güvenli git!'])],

  /* Dur / bekle — sohbet kalıbı */
  [/^\b(dur|tamam|anladim|peki|oldu|haklisın|dogru)\b$/,
    () => pick(['Tamam!', 'Anlaşıldı.', 'Peki.'])],

  /* Evet / Hayır kısa yanıt */
  [/^(evet|tabii|kesinlikle|tabi ki|olur)$/,
    () => pick(['Harika!', 'Anlaşıldı.', 'Tamam, devam ediyorum.'])],

  [/^(hayir|yok|istemiyorum|gerek yok)$/,
    () => pick(['Tamam, bir şey yapmıyorum.', 'Peki, beklerim.'])],
];

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Ham metin girişini konuşma motoruyla değerlendirir.
 * Eşleşme bulursa { handled: true, response: "..." } döner.
 * Eşleşme yoksa { handled: false, response: '' } döner — caller başka yola yönlenir.
 */
export function tryOfflineConversation(
  raw:        string,
  isDriving?: boolean,
  speedKmh?:  number,
): ConvResult {
  if (!raw.trim()) return { handled: false, response: '' };

  const n = norm(raw);

  for (const [pattern, handler] of PATTERNS) {
    if (pattern.test(n)) {
      const response = handler(n, isDriving, speedKmh);
      return { handled: true, response };
    }
  }

  return { handled: false, response: '' };
}
