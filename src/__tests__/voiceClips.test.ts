import { describe, it, expect } from 'vitest';
import { clipIdFor, hasClip } from '../platform/voiceClips';

/**
 * REGRESYON KİLİDİ — premium ses bankası ↔ konuşulan sabit ifade kontratı.
 *
 * K24 gibi TTS-motorsuz ünitelerde bu ifadeler ANCAK bundle'lı klipten sesli
 * çıkar. Bir SafetyRuleEngine mesajı / ttsService sabiti değişir de karşılık
 * gelen klip güncellenmezse → motorsuz ünitede O uyarı SESSİZ kalır (saha riski).
 * Bu test o sessiz kopmayı yakalar: her ifade ↔ klip id birebir kilitli.
 */
const REQUIRED: Record<string, string> = {
  // Güvenlik (SafetyRuleEngine mesajları — birebir)
  'Kapı açık, lütfen kapıyı hemen kapatın.':                'safety-door-moving',
  'El freni çekili, lütfen el frenini indirin.':            'safety-parking-brake',
  'Motor sıcaklığı yüksek, lütfen güvenli yerde durun.':    'safety-overheat',
  'Emniyet kemeri takılı değil.':                           'safety-seatbelt',
  'Kaput veya bagaj açık, lütfen durup kontrol edin.':      'safety-hood-trunk',
  'Farlar kapalı görünüyor.':                               'safety-headlights',
  'Yakıt seviyesi düşük.':                                  'safety-low-fuel',
  'Araçta bir arıza göstergesi var, kontrol önerilir.':     'safety-battery-oil',
  'Kapı açık.':                                             'safety-door-park',
  // Tehlike (mesafesiz varyant — ttsService.speakHazardAlert)
  'Dikkat! yol çalışması.':                                 'hazard-construction',
  'Dikkat! kaza.':                                          'hazard-accident',
  'Dikkat! zor hava koşulları.':                            'hazard-weather',
  'Dikkat! hız kamerası.':                                  'hazard-speedcam',
  'Dikkat! yol hasarı.':                                    'hazard-road-damage',
  'Dikkat! tünel.':                                         'hazard-tunnel',
  // Donanım / OBD (ttsService + commandExecutor canonical string)
  'Bağlantı kurulamadı. Tekrar deneyin.':                   'hw-error',
  'Araç verisi alınamıyor. OBD bağlantısını kontrol edin.': 'obd-nodata',
};

describe('voiceClips — premium ses bankası eşleştirme kilidi', () => {
  it('her sabit/kritik ifadenin klibi VAR ve id birebir doğru', () => {
    for (const [text, id] of Object.entries(REQUIRED)) {
      expect(hasClip(text), `klip eksik: "${text}"`).toBe(true);
      expect(clipIdFor(text), `yanlış klip id: "${text}"`).toBe(id);
    }
  });

  it('boşluk normalizasyonu eşleşmeyi BOZMAZ (fazla boşluk/trim)', () => {
    expect(clipIdFor('  El freni çekili,   lütfen el frenini indirin.  '))
      .toBe('safety-parking-brake');
  });

  it('bilinmeyen/serbest metin eşleşmez → null/false (TTS yedeğine düşer)', () => {
    expect(hasClip('bugün hava nasıl olacak')).toBe(false);
    expect(clipIdFor('bugün hava nasıl olacak')).toBeNull();
    // Mesafeli tehlike varyantı sabit klip DEĞİL (dinamik mesafe) → yedeğe düşmeli
    expect(hasClip('Dikkat! kaza, 300 metre ileride.')).toBe(false);
  });
});
