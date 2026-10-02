/**
 * voiceClips.ts — Premium önceden-kaydedilmiş Türkçe ses bankası (hibrit TTS Phase 1).
 *
 * NEDEN: K24 head unit ROM'unda çalışan bir TTS motoru YOK ve cihaz 32-bit Android
 * olduğu için neural TTS (sherpa-onnx/Piper, onnxruntime) `SIGBUS` ile çöküyor —
 * yani cihazda kaliteli dinamik TTS imkânsız. Çözüm hibrit:
 *   1) Kritik + sabit ifadeler önceden üretilmiş kliplerden çalınır (public/voice/*.wav).
 *      TEK SES (2026-10-02, ürün kararı): klipler Mavi'nin tek sesi **Emel**
 *      (tr-TR-EmelNeural, `carospro.com/api/tts`) ile üretildi; eski Piper dfki (ERKEK)
 *      klipleri kaldırıldı. Yalnız ses ÇIKTISI gömülür (motor/GPL espeak-ng YOK).
 *      ⚠️ SATIŞ KAPISI: Edge okuma servisi resmi ticari API değil → satıştan önce
 *      aynı ses lisanslı kaynaktan (Azure Speech, tr-TR-EmelNeural) yeniden üretilmeli
 *      (bkz. website/src/app/api/tts/route.ts "TİCARİ NOT").
 *   2) Eşleşmeyen serbest metin `ttsService` zincirine düşer: Edge Emel → cihaz motoru (son çare).
 *
 * Klipler basit `HTMLAudioElement` ile çalınır (Chrome 64-78 uyumlu, decodeAudioData
 * gerekmez). MUSIC F6.1: klip çalarken müzik KANONİK yoldan kısılır
 * (`duckRequest` → `duckPolicy` → native authority); klip kendi WebView ses
 * elemanından tam sesle duyulur — güvenlik uyarısı için istenen davranış.
 */

import { requestDuck, type DuckHandle } from './media/authority/duckRequest';
import type { DuckReason } from './media/authority/duckPolicy';
/* MAVI-F0: ilk duyulabilir ses ölçümü. `maviLatencyTrace` HİÇBİR modülü import
   etmez → bu yaprağın bağımlılık grafiği büyümez. YALNIZ ÖLÇÜM. */
import { markMaviLatency } from './assistant/maviLatencyTrace';

/**
 * Konuşulan TAM metin → klip id (public/voice/<id>.wav).
 * Anahtarlar app'in `ttsSpeak`/`speakSafetyAlert`/`speakHazardAlert`'a geçirdiği
 * stringlerle BİREBİR aynıdır (SafetyRuleEngine mesajları + ttsService şablonları).
 */
const CLIP_MANIFEST: Readonly<Record<string, string>> = {
  // ── Güvenlik uyarıları (SafetyRuleEngine sabit mesajları) ──
  'Kapı açık, lütfen kapıyı hemen kapatın.':                  'safety-door-moving',
  'El freni çekili, lütfen el frenini indirin.':              'safety-parking-brake',
  'Motor sıcaklığı yüksek, lütfen güvenli yerde durun.':      'safety-overheat',
  'Emniyet kemeri takılı değil.':                             'safety-seatbelt',
  'Kaput veya bagaj açık, lütfen durup kontrol edin.':        'safety-hood-trunk',
  'Farlar kapalı görünüyor.':                                 'safety-headlights',
  'Yakıt seviyesi düşük.':                                    'safety-low-fuel',
  'Araçta bir arıza göstergesi var, kontrol önerilir.':       'safety-battery-oil',
  'Kapı açık.':                                               'safety-door-park',
  // ── Tehlike uyarıları (mesafesiz varyant; mesafeli varyant yedeğe düşer) ──
  'Dikkat! yol çalışması.':                                   'hazard-construction',
  'Dikkat! kaza.':                                            'hazard-accident',
  'Dikkat! zor hava koşulları.':                              'hazard-weather',
  'Dikkat! hız kamerası.':                                    'hazard-speedcam',
  'Dikkat! yol hasarı.':                                      'hazard-road-damage',
  'Dikkat! tünel.':                                           'hazard-tunnel',
  // ── Donanım / OBD geri bildirimleri ──
  'Bağlantı kurulamadı. Tekrar deneyin.':                     'hw-error',
  'Araç verisi alınamıyor. OBD bağlantısını kontrol edin.':   'obd-nodata',
};

/** Eşleştirme normalizasyonu: yalnız boşluk daraltma + trim (büyük/küçük harf korunur). */
function _norm(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

const _idByText = new Map<string, string>();
for (const [text, id] of Object.entries(CLIP_MANIFEST)) _idByText.set(_norm(text), id);

const _clipBase = `${import.meta.env.BASE_URL}voice/`;
const _cache = new Map<string, HTMLAudioElement>();
let _active: HTMLAudioElement | null = null;

function _audioFor(id: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let a = _cache.get(id);
  if (!a) {
    a = new Audio(`${_clipBase}${id}.wav`);
    a.preload = 'auto';
    _cache.set(id, a);
  }
  return a;
}

/** Metne karşılık premium klip id'si (yoksa null). */
export function clipIdFor(text: string): string | null {
  return _idByText.get(_norm(text)) ?? null;
}

/** Metne karşılık premium klip var mı. */
export function hasClip(text: string): boolean {
  return _idByText.has(_norm(text));
}

/**
 * Eşleşen premium klibi çalar ve `true` döner; klip yoksa/çalınamazsa `false`
 * (çağıran native/web TTS yedeğine düşmeli).
 *
 * `onEnd` yalnız klip GERÇEKTEN başladıysa, bitiş/hata anında bir kez çağrılır
 * (TTS bitiş semantiği: ducking geri açma + takip dinlemesi korunur).
 */
export function tryPlayClip(
  text: string,
  onEnd?: () => void,
  duckReason: DuckReason = 'MAVI',
): boolean {
  const id = clipIdFor(text);
  if (!id) return false;
  const audio = _audioFor(id);
  if (!audio) return false;

  // Önceki klibi durdur (QUEUE_FLUSH semantiği — yeni uyarı eskiyi keser)
  if (_active && _active !== audio) { try { _active.pause(); } catch { /* zaten durmuş */ } }

  let settled = false;
  let duck: DuckHandle | null = null;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (duck !== null) { duck.release(); duck = null; }
    if (_active === audio) _active = null;
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;              // MAVI-F0: zero-leak (ölçüm kancası bırakılmaz)
    onEnd?.();
  };

  try {
    audio.currentTime = 0;
    /* MAVI-F0: klip ÖNCEDEN sentezlenmiştir → sentez süresi ~0; `playing` olayı
     * platformun GERÇEK başlangıç bildirimidir (proxy değil, kanıt). */
    markMaviLatency('tts_audio_ready');
    audio.onplaying = () => { markMaviLatency('first_audio_confirmed'); };
    markMaviLatency('first_audio_requested');
    const p = audio.play();
    // play() başlatıldı → klibi sahiplen, ducking + bitiş kancalarını bağla.
    _active = audio;
    duck = requestDuck(duckReason);
    audio.onended = settle;
    audio.onerror = settle;
    if (p && typeof p.catch === 'function') p.catch(() => settle());
    return true;
  } catch {
    // Senkron hata → hiçbir yan etki bırakma; çağıran TTS yedeğine düşsün.
    if (_active === audio) _active = null;
    return false;
  }
}

/** Çalan klibi anında durdur (ttsCancel ile birlikte). */
export function cancelClip(): void {
  if (_active) {
    try { _active.pause(); } catch { /* zaten durmuş */ }
    _active = null;
  }
}

/* ── "ŞİMDİ KONUŞ" TONU (earcon) ─────────────────────────────────────────────
 * Ürün kararı (2026-10-02, Apple/Siri modeli): Mavi uyanınca KONUŞMAZ, kısa bir
 * ton çalar; kullanıcı tondan SONRA konuşur. Mavi dinlemeye her geçtiğinde
 * (uyanma · mikrofon düğmesi · takip dinlemesi) AYNI ton çalar. Ton TTS
 * motoruna, internete ve dile bağlı değildir — motorsuz head unit'te de duyulur.
 *
 * Ses: iki notadan yükselen çan (G5 → D6), 170 ms, tamamen SENTETİK (kayıt yok,
 * lisans temiz). Mikrofonu açan sahip `voiceService.startListening`dir; bu
 * modül yalnız sesi çalar ve nominal süresini bildirir. Klip kanalından
 * (`_active`) BAĞIMSIZDIR: `cancelClip`/`ttsCancel` tonu kesmez. */
export const LISTEN_EARCON_MS = 170;

let _earcon: HTMLAudioElement | null = null;

/**
 * Dinleme tonunu çalar. Çalma başlatıldıysa tonun nominal süresini (ms), platform
 * WAV çalamıyorsa ya da hata olursa `0` döner — çağıran `0`da BEKLEMEDEN dinlemeye
 * geçer (ton dinlemeyi asla engellemez).
 */
export function playListenEarcon(): number {
  if (typeof Audio === 'undefined') return 0;
  try {
    if (!_earcon) {
      _earcon = new Audio(`${_clipBase}earcon-listen.wav`);
      _earcon.preload = 'auto';
    }
    // Platform yeteneği: WAV çalamayan ortam ('' = hayır) → ton yok, bekleme yok.
    if (typeof _earcon.canPlayType === 'function' && _earcon.canPlayType('audio/wav') === '') return 0;
    _earcon.currentTime = 0;
    const p = _earcon.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* ton çalmazsa dinleme yine açılır */ });
    return LISTEN_EARCON_MS;
  } catch {
    return 0;
  }
}
