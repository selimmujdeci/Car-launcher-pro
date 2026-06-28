/**
 * voiceClips.ts — Premium önceden-kaydedilmiş Türkçe ses bankası (hibrit TTS Phase 1).
 *
 * NEDEN: K24 head unit ROM'unda çalışan bir TTS motoru YOK ve cihaz 32-bit Android
 * olduğu için neural TTS (sherpa-onnx/Piper, onnxruntime) `SIGBUS` ile çöküyor —
 * yani cihazda kaliteli dinamik TTS imkânsız. Çözüm hibrit:
 *   1) Kritik + sabit ifadeler PC'de Piper ile üretilmiş **stüdyo kalite** kliplerden
 *      çalınır (public/voice/*.wav). Lisans temiz: yalnız ses ÇIKTISI gömülür
 *      (espeak/program çıktıyı kapsamaz; dfki modeli MIT).
 *   2) Eşleşmeyen serbest metin native TTS yedeğine (eSpeak) düşer.
 *
 * Klipler basit `HTMLAudioElement` ile çalınır (Chrome 64-78 uyumlu, decodeAudioData
 * gerekmez). `duckMedia` yalnız uygulama-içi Web Audio kaynaklarını kısar; klip ayrı
 * eleman olduğu için tam sesle duyulur — güvenlik uyarısı için istenen davranış.
 */

import { duckMedia, unduckMedia } from './audioService';

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
export function tryPlayClip(text: string, onEnd?: () => void): boolean {
  const id = clipIdFor(text);
  if (!id) return false;
  const audio = _audioFor(id);
  if (!audio) return false;

  // Önceki klibi durdur (QUEUE_FLUSH semantiği — yeni uyarı eskiyi keser)
  if (_active && _active !== audio) { try { _active.pause(); } catch { /* zaten durmuş */ } }

  let settled = false;
  let ducked  = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (ducked) { unduckMedia(); ducked = false; }
    if (_active === audio) _active = null;
    audio.onended = null;
    audio.onerror = null;
    onEnd?.();
  };

  try {
    audio.currentTime = 0;
    const p = audio.play();
    // play() başlatıldı → klibi sahiplen, ducking + bitiş kancalarını bağla.
    _active = audio;
    ducked = true;
    duckMedia();
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
