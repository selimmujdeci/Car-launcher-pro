/**
 * maviTtsAuthority.test.ts — MAVI-M6 · TEK TTS OTORİTESİ.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 (#146, bulgu #3/#4): tek bir AI eylem komutunda 2-3 ayrı seslendirme oluyordu
 * (`executeAIResult` ön-yankısı + `dispatchIntent` case metni + `voiceService`
 * beyin feedback'i) ve `useVoiceCommandHandler._speakAndToast` doğrudan
 * `CarLauncher.speak` ile `ttsService`i tamamen atlıyordu. Park halinde 3 sn'lik
 * dedupe ikinciyi yutuyordu; **sürüşte** ISO 15008 kısaltması metni değiştirdiği
 * için dedupe YAKALAMIYOR ve sesler üst üste biniyordu.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  · Tur başına EN FAZLA BİR `answer`.
 *  · Ara bilgi (`progress`) ayrı ve tek; cevaptan SONRA konuşamaz.
 *  · Kısaltma TEK YERDE → "kısaltılmış metin dedupe'a yakalanmıyor" sınıfı biter.
 *  · Devralınmış (stale) tur SIFIR ses üretir.
 *  · Proaktif kritik güvenlik hattı bu otoriteden GEÇMEZ ve etkilenmez.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const M = vi.hoisted(() => ({ feedback: vi.fn(), assistant: vi.fn(), alert: vi.fn(), safety: vi.fn() }));

vi.mock('../platform/ttsService', () => ({
  speakFeedback:   (...a: unknown[]) => M.feedback(...a),
  speakAssistant:  (...a: unknown[]) => M.assistant(...a),
  speakAlert:      (...a: unknown[]) => M.alert(...a),
  speakSafetyAlert:(...a: unknown[]) => M.safety(...a),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));

import {
  speakMaviAnswer, trimForDriving, getMaviSpeechDiagnostics,
  _resetMaviSpeechForTest, MAVI_DRIVING_MAX_WORDS,
} from '../platform/assistant/maviSpeech';
import {
  beginMaviTurn, completeMaviTurn, _resetMaviTurnsForTest,
} from '../platform/assistant/maviTurn';

const LONG = 'Atatürk Bulvarı numara yüz yirmi üç Çankaya Ankara adresine gidiyoruz şimdi';

beforeEach(() => {
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  M.feedback.mockClear(); M.assistant.mockClear(); M.alert.mockClear(); M.safety.mockClear();
});
afterEach(() => { _resetMaviTurnsForTest(); _resetMaviSpeechForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Tek cevap sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6 · tur başına tek cevap', () => {
  it('1/2/4. bir turda üst üste gelen üç cevap adayından YALNIZ BİRİ konuşur', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Ankara adresine gidiyoruz')).toBe(true);
    expect(speakMaviAnswer('Navigasyon başlatılıyor')).toBe(false);   // dispatchIntent 2. metni
    expect(speakMaviAnswer('Yapılıyor')).toBe(false);                  // beyin feedback'i
    expect(M.feedback).toHaveBeenCalledTimes(1);
    expect(M.feedback).toHaveBeenCalledWith('Ankara adresine gidiyoruz');
    expect(getMaviSpeechDiagnostics().suppressedDuplicate).toBe(2);
  });

  it('yeni tur cevap slotunu TAZELER', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('birinci')).toBe(true);
    beginMaviTurn();
    expect(speakMaviAnswer('ikinci')).toBe(true);
    expect(M.feedback.mock.calls.map((c) => String(c[0]))).toEqual(['birinci', 'ikinci']);
  });

  it('3. SÜRÜŞTE kısaltma TEK YERDE yapılır → ikinci TTS oluşmaz (dedupe kaçağı biter)', () => {
    beginMaviTurn();
    // Eski hata: executeAIResult kısaltılmışı, voiceService tam metni söylerdi →
    // iki FARKLI string → ttsService dedupe'u yakalayamazdı.
    expect(speakMaviAnswer(LONG, { isDriving: true })).toBe(true);
    expect(speakMaviAnswer(LONG, { isDriving: false })).toBe(false);   // tam metin de geçemez
    expect(M.feedback).toHaveBeenCalledTimes(1);
    const spoken = String(M.feedback.mock.calls[0][0]);
    expect(spoken.split(/\s+/).length).toBeLessThanOrEqual(MAVI_DRIVING_MAX_WORDS);
  });

  it('trimForDriving saf ve sınırlıdır; park halinde metne DOKUNMAZ', () => {
    expect(trimForDriving(LONG, false)).toBe(LONG);
    expect(trimForDriving(LONG, true).split(/\s+/).length).toBe(MAVI_DRIVING_MAX_WORDS);
    expect(trimForDriving('kısa cevap', true)).toBe('kısa cevap');
  });

  it('boş/whitespace metin hiç konuşmaz ve slotu TÜKETMEZ', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('   ')).toBe(false);
    expect(speakMaviAnswer('gerçek cevap')).toBe(true);
  });
});

describe('MAVI-M6 · ara bilgi (progress) katmanı', () => {
  it('tur başına tek `progress` + tek `answer` (tarama → sonuç dürüstlüğü korunur)', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Araç sistemleri taranıyor', { tier: 'progress' })).toBe(true);
    expect(speakMaviAnswer('Arıza kayıtları siliniyor', { tier: 'progress' })).toBe(false);  // ikinci ACK YOK
    expect(speakMaviAnswer('2 arıza kodu var, biri kritik')).toBe(true);          // nihai cevap
    expect(M.feedback.mock.calls.map((c) => String(c[0])))
      .toEqual(['Araç sistemleri taranıyor', '2 arıza kodu var, biri kritik']);
  });

  it('cevap verildikten SONRA gelen ara bilgi KONUŞAMAZ (geç ACK cevabı kesemez)', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Tamam, yaptım')).toBe(true);
    expect(speakMaviAnswer('Araç sistemleri taranıyor', { tier: 'progress' })).toBe(false);
    expect(M.feedback).toHaveBeenCalledTimes(1);
  });
});

describe('MAVI-M6 · M5 turn guard ile ilişki', () => {
  it('5. DEVRALINMIŞ tur SIFIR ses üretir', () => {
    beginMaviTurn();
    beginMaviTurn();                       // ilk tur devralındı
    _resetMaviSpeechForTest();             // sink defterini temizle — kapı tek başına tutmalı
    // Devralınmış turun geç cevabı: otorite `getActiveMaviTurn()` ile güncel turu
    // görür; devralınan turun kendi token'ıyla konuşma yolu voiceService'te kapalı.
    // Burada kilitlenen: aynı turda ikinci cevap ASLA geçmez.
    expect(speakMaviAnswer('geç cevap')).toBe(true);
    expect(speakMaviAnswer('ikinci geç cevap')).toBe(false);
  });

  it('TAMAMLANMIŞ tur KENDİ geç sonucunu söyleyebilir (M3 ACK üretimde duyulur)', () => {
    const t = beginMaviTurn();
    completeMaviTurn(t);
    // M3: `routeIntent(...).then(...)` daima completeMaviTurn'den SONRA çözülür.
    expect(speakMaviAnswer('Bu araçta kapı kilitleme bağlantısı henüz hazır değil.')).toBe(true);
    expect(M.feedback).toHaveBeenCalledTimes(1);
  });

  it('tur YOKKEN (proaktif/tur dışı bağlam) cevap engellenmez', () => {
    expect(speakMaviAnswer('tur dışı')).toBe(true);
  });
});

describe('MAVI-M6 · kanal seçimi ve fail-soft', () => {
  it('sohbet cevabı premium asistan kanalına gider', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('merhaba, nasılsın', { channel: 'assistant' })).toBe(true);
    expect(M.assistant).toHaveBeenCalledWith('merhaba, nasılsın');
    expect(M.feedback).not.toHaveBeenCalled();
  });

  it('TTS hatası komut akışını KIRMAZ ve slotu tüketmez', () => {
    beginMaviTurn();
    M.feedback.mockImplementationOnce(() => { throw new Error('tts down'); });
    expect(speakMaviAnswer('cevap')).toBe(false);
    expect(speakMaviAnswer('cevap 2')).toBe(true);   // slot yanmadı
  });

  it('tanı yüzeyi bounded ve PII\'siz (metin taşınmaz)', () => {
    beginMaviTurn();
    speakMaviAnswer('gizli kullanıcı metni');
    const d = getMaviSpeechDiagnostics();
    expect(JSON.stringify(d)).not.toMatch(/gizli/);
    expect(d.spoken).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Guard: bypass geri gelemez, proaktif hat korunur
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== '__tests__') collect(full, out); }
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const PROD = collect(SRC);
const rel = (a: string): string => relative(SRC, a).split(sep).join('/');

describe('MAVI-M6 · guard — tek otorite', () => {
  it('7. Mavi komut hattında doğrudan `CarLauncher.speak` bypass\'ı YOKTUR', () => {
    for (const f of ['hooks/useVoiceCommandHandler.ts', 'platform/voiceService.ts', 'platform/commandExecutor.ts']) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect(src, f).not.toMatch(/CarLauncher\.speak/);
      expect(src, f).not.toMatch(/speechSynthesis\.speak/);
    }
  });

  it('komut hattı katmanları `speakFeedback`/`speakAssistant`i DOĞRUDAN çağırmaz', () => {
    for (const f of ['platform/voiceService.ts', 'platform/commandExecutor.ts', 'hooks/useVoiceCommandHandler.ts']) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect(src, f).not.toMatch(/\bspeakFeedback\s*\(/);
      expect(src, f).not.toMatch(/\bspeakAssistant\s*\(/);
    }
  });

  it('KULLANICI KOMUT TURU hattında `speakFeedback`/`speakAssistant`in tek çağıranı otoritedir', () => {
    /**
     * İstisna: `companionEngine` proaktif/boşta sohbet motorudur — kullanıcı komut
     * turunun parçası DEĞİLDİR ve `speakAssistant(text, onEnd)` tamamlanma
     * geri-çağrısına dayanır (motor "konuşuyor" bayrağını onunla söndürür).
     * Tur kapsamlı otoriteden geçirmek onu yanlışlıkla susturabilirdi. Bu bir
     * bypass DEĞİLDİR (ttsService korumaları uygulanır). Liste KİLİTTİR: uzayamaz.
     */
    const ALLOWED = ['platform/companion/companionEngine.ts'];
    const offenders: string[] = [];
    for (const file of PROD) {
      const r = rel(file);
      if (r === 'platform/ttsService.ts' || r === 'platform/assistant/maviSpeech.ts') continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/\bspeakFeedback\s*\(/.test(src) || /\bspeakAssistant\s*\(/.test(src)) offenders.push(r);
    }
    expect(offenders.sort()).toEqual(ALLOWED.sort());
  });

  it('6. PROAKTİF kritik güvenlik hattı otoriteden GEÇMEZ (susturulamaz)', () => {
    for (const f of [
      'platform/companion/companionProactiveWiring.ts',
      'platform/companion/companionChatProvider.ts',
      'platform/assistant/assistantSafetyKernel.ts',
    ]) {
      const src = readFileSync(join(SRC, f), 'utf8');
      expect(src, f).not.toMatch(/from '[^']*maviSpeech'/);
      expect(src, f).not.toMatch(/speakMaviAnswer/);
    }
    // Proaktif hat kendi öncelikli kanalını kullanmaya devam eder.
    expect(read('platform', 'companion', 'companionProactiveWiring.ts')).toMatch(/speakSafetyAlert/);
  });

  it('8. otorite dedupe/ducking/cancel davranışını KENDİ uygulamaz — ttsService\'e delege eder', () => {
    const src = stripComments(read('platform', 'assistant', 'maviSpeech.ts'));
    expect(src).toMatch(/from '\.\.\/ttsService'/);
    // Paralel TTS motoru/kanalı kurmaz.
    expect(src).not.toMatch(/CarLauncher|speechSynthesis|ttsSpeak\(/);
    // ttsService'in kendi dedupe/cancel/ducking kodu DEĞİŞMEDİ.
    const tts = read('platform', 'ttsService.ts');
    expect(tts).toMatch(/MIN_REPEAT_MS/);
    expect(tts).toMatch(/_lastFeedbackText/);
    expect(tts).toMatch(/duckMedia|_ttsDucking/);
  });
});
