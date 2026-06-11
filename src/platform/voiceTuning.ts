/**
 * voiceTuning.ts — araç içi ses algılama hassasiyet ayarları (TEK KAYNAK)
 *
 * K24/head-unit ortamı varsayımı: yol gürültüsü + mikrofon panele gömülü +
 * kullanıcı normal ses tonunda konuşur (bağırmamalı).
 *
 * Zaman hiyerarşisi (İHLAL EDİLEMEZ — voiceTuning.test.ts kilitler):
 *   warmup + maxListenMs  <  listenFailsafeMs  <  uiSafetyCloseMs
 * Aksi halde JS failsafe veya UI penceresi AKTİF dinlemeyi keser
 * ("konuşurken kapandı" sınıfı bug).
 *
 * Native tüketim: startSpeechRecognition({ gain, maxListenMs }) →
 * CarLauncherPlugin.java clamp'ler (gain 1.0–4.0, pencere 5–20s) ve uygular.
 * Native VARSAYILANLARI değişmez (gain 2.0 / 9s) — wake word döngüsü
 * (wakeWordService, opsiyonsuz çağrı) mevcut pil/davranış profilini korur.
 */

export interface VoiceTuning {
  /**
   * Native yazılım kazancı (clipping korumalı çarpan, AGC/NS üstüne).
   * 2.5: alçak sesli konuşma için +%25 (eski 2.0). Tavan 4.0 — üstü yol
   * gürültüsünü "kelime" olarak tanıtmaya başlar (yanlış tetikleme).
   */
  nativeGainX: number;
  /**
   * Native maksimum dinleme penceresi (ms). Vosk endpoint'i konuşma bitince
   * ZATEN erken çözer — bu yalnız üst sınır: geç başlayan/duraksayan
   * konuşmaya alan tanır (eski 9s pencere sonunda kısa komutlar kesilebiliyordu).
   */
  maxListenMs: number;
  /**
   * Takip dinleme penceresi (ms) — sohbet modunda cevap (TTS) bitince açılan
   * otomatik yeniden-dinleme. Normal pencereden KISA tutulur: kullanıcı
   * konuşmazsa sistem hızla idle'a döner (6-10s bandı; sürüş dikkati).
   * Native clamp alt sınırı 5s'in üstünde kalmalı.
   */
  followUpListenMs: number;
  /** Mikrofon donanım ısınması — normal cihaz (ms). */
  warmupMs: number;
  /** Mikrofon donanım ısınması — düşük donanım/T507 (ms). */
  warmupLowEndMs: number;
  /**
   * JS failsafe: 'listening' bu süreyi aşarsa zorla idle.
   * warmupLowEndMs + maxListenMs'ten BÜYÜK olmalı (aktif dinlemeyi kesmesin).
   */
  listenFailsafeMs: number;
  /**
   * UI pencere güvenlik kapanışı (pill/overlay). listenFailsafeMs'ten BÜYÜK
   * olmalı — kullanıcı failsafe'in bastığı terminal durumu görebilsin.
   */
  uiSafetyCloseMs: number;
}

export const VOICE_TUNING: VoiceTuning = {
  nativeGainX:      2.5,
  maxListenMs:      12_000,
  followUpListenMs: 8_000,
  warmupMs:         300,
  warmupLowEndMs:   500,
  listenFailsafeMs: 14_000,
  uiSafetyCloseMs:  16_000,
};
