/**
 * maviFillerAbolition.test.ts — **MAVI-F2 · YAPAY ARA SÖZ İMHASI (I11) KİLİDİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Mavi gecikmeyi *"Bakıyorum… / Düşünüyorum… / Bir saniye… / Kontrol ediyorum…"*
 * diyerek örtüyordu. Bu bir UX tercihi değil ölçülmüş bir kusurdu: cümle hiçbir
 * bilgi taşımıyordu, tipik tur eşiği (1500 ms) aştığı için neredeyse HER TURDA
 * çalışıyordu ve geç ateşlediğinde BAŞLAMIŞ cevabı KESİYORDU.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  1. Normal sohbette (companion AÇIK ve KAPALI) yapay ara söz = **0**.
 *  2. Yavaş beyinde de = **0** (timer yok; gecikme örtülmez, ÖLÇÜLÜR).
 *  3. Prompt modele filler ÖĞRETMEZ; model yine de üretirse PARSE SINIRINDA süzülür.
 *  4. Semantik ACK ("Araç sistemleri taranıyor") **serbesttir** ve filler SAYILMAZ.
 *  5. ACK ≠ BAŞARI: ACK bir işin BAŞLADIĞINI söyler, bittiğini İDDİA ETMEZ.
 *  6. Gerçek hata mesajı ve belirsizlik sorusu (`answer`) bu kapıdan ETKİLENMEZ.
 *  7. Tek-cevap otoritesi ve tur guard'ı korunur — ACK + cevap DUPLICATE üretmez.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası). Bir davranış
 * bilinçli değişiyorsa kilit YENİ DOĞRUYA güncellenir — kaldırılmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({ feedback: vi.fn(), assistant: vi.fn(), alert: vi.fn(), safety: vi.fn() }));

vi.mock('../platform/ttsService', () => ({
  speakFeedback:    (...a: unknown[]) => M.feedback(...a),
  speakAssistant:   (...a: unknown[]) => M.assistant(...a),
  speakAlert:       (...a: unknown[]) => M.alert(...a),
  speakSafetyAlert: (...a: unknown[]) => M.safety(...a),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));

import { isGenericFiller } from '../platform/assistant/maviAckPolicy';
import {
  speakMaviAnswer, getMaviSpeechDiagnostics, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import { beginMaviTurn, _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
import { buildStageFeedback } from '../platform/maviCore/wiring/maviFeedback';

const read = (...p: string[]): string => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
/** Yorumlar hariç GERÇEK kod — F2 açıklama notları eski adları anlatım için içerir. */
const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

beforeEach(() => {
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  M.feedback.mockClear(); M.assistant.mockClear(); M.alert.mockClear(); M.safety.mockClear();
});
afterEach(() => { _resetMaviTurnsForTest(); _resetMaviSpeechForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Sınıflandırma: filler ↔ semantik ACK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F2 · A · maviAckPolicy sınıflandırması', () => {
  it('1. tarihsel filler metinlerinin HEPSİ yakalanır (TR + EN)', () => {
    const FILLERS = [
      // voiceService THINKING_PHRASES (silindi)
      'Bakıyorum hemen...', 'Bir saniye...', 'Kontrol ediyorum...',
      // voiceService / commandExecutor / maviFeedback (değiştirildi)
      'Bakıyorum...', 'Bakıyorum', 'Bir saniye',
      // eşdeğerleri
      'bakayım', 'Bir bakalım', 'Düşünüyorum', 'Bir düşüneyim', 'Kontrol edeyim',
      'Anlıyorum', 'Bekle', 'Birazdan', 'İki saniye', 'Bir dakika', 'Bir saniye bekle',
      'Arıyorum', 'Araştırıyorum',
      // İngilizce (model karışık dil üretebilir)
      'thinking', 'One moment', 'let me check', 'just a second', 'Hold on',
    ];
    for (const f of FILLERS) expect(isGenericFiller(f), f).toBe(true);
  });

  it('2. SEMANTİK ACK yakalanMAZ — bilgi taşıyan cümle filler değildir', () => {
    const ACKS = [
      'Araç sistemleri taranıyor', 'Arıza kayıtları siliniyor',
      'Araç bakım durumu kontrol ediliyor', 'yağ sıcaklığı okunuyor',
      'Hava durumunu alıyorum.', 'Araçtan okuyorum.',
      'Ev adresini arıyorum.', 'Kadıköy rotası açılıyor', 'Sezen Aksu aranıyor',
    ];
    for (const a of ACKS) expect(isGenericFiller(a), a).toBe(false);
  });

  it('3. GERÇEK HATA ve BELİRSİZLİK cümleleri filler DEĞİLDİR (yanlışlıkla silinmesin)', () => {
    const KEEP = [
      'Şu an buna ulaşamadım.', 'Zaman aşımı oldu, yapamadım',
      'Hangi Kadıköy?', 'Annen mi, kayınvaliden mi?',
      'Bu sensörü tanımıyorum.', 'Klima kontrolü bu araçta yok.',
      'Bunu şu an yapamıyorum', 'İnternete ulaşamıyorum. Bağlantı gelince tekrar dene.',
      'Tam anlayamadım, bir daha söyler misin?',
    ];
    for (const k of KEEP) expect(isGenericFiller(k), k).toBe(false);
  });

  it('4. saf modül: import · I/O · timer · Date.now · global durum YOK', () => {
    const src = read('platform', 'assistant', 'maviAckPolicy.ts');
    expect(codeOf(src)).not.toMatch(/\bimport\b/);   // yaprak modül — hiçbir şey import etmez
    expect(codeOf(src)).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
    expect(codeOf(src)).not.toMatch(/^\s*let\s/m);   // modül düzeyinde mutable durum yok
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Konuşma otoritesi: kapı YALNIZ `progress` katmanındadır
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F2 · B · maviSpeech I11 kapısı', () => {
  it('5. `progress` katmanında filler KONUŞULMAZ ve sayılır', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Bakıyorum', { tier: 'progress' })).toBe(false);
    expect(speakMaviAnswer('Bir saniye...', { tier: 'progress' })).toBe(false);
    expect(M.feedback).not.toHaveBeenCalled();
    expect(getMaviSpeechDiagnostics().rejectedFiller).toBe(2);
  });

  it('6. düşen filler `progress` SLOTUNU TÜKETMEZ — gerçek ACK hâlâ konuşur', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Düşünüyorum', { tier: 'progress' })).toBe(false);
    expect(speakMaviAnswer('Araç sistemleri taranıyor', { tier: 'progress' })).toBe(true);
    expect(M.feedback.mock.calls.map((c) => String(c[0]))).toEqual(['Araç sistemleri taranıyor']);
  });

  it('7. kapı `answer` katmanına UYGULANMAZ (F2 bir susturma mekanizması değildir)', () => {
    beginMaviTurn();
    // Nihai cevap katmanı metin filtresine GİRMEZ — hata/soru/cevap korunur.
    expect(speakMaviAnswer('Anlıyorum')).toBe(true);
    expect(getMaviSpeechDiagnostics().rejectedFiller).toBe(0);
    expect(M.feedback).toHaveBeenCalledWith('Anlıyorum');
  });

  it('8. ACK + nihai cevap DUPLICATE konuşma üretmez (tek-cevap sözleşmesi korunur)', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Müzik aranıyor', { tier: 'progress' })).toBe(true);
    expect(speakMaviAnswer('Sezen Aksu çalıyor')).toBe(true);
    expect(speakMaviAnswer('Sezen Aksu çalıyor')).toBe(false);                   // ikinci cevap DÜŞER
    expect(speakMaviAnswer('Müzik aranıyor', { tier: 'progress' })).toBe(false); // geç ACK DÜŞER
    expect(M.feedback.mock.calls.map((c) => String(c[0])))
      .toEqual(['Müzik aranıyor', 'Sezen Aksu çalıyor']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Kaynak kilitleri: filler üretim yollarında YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F2 · C · üretim kaynağında filler yok', () => {
  it('9. voiceService: düşünme timer\'ı ve ifade listesi SİLİNMİŞ', () => {
    const code = codeOf(read('platform', 'voiceService.ts'));
    expect(code).not.toContain('THINKING_PHRASES');
    expect(code).not.toContain('_speakThinking');
    expect(code).not.toContain('THINKING_FEEDBACK_DELAY_MS');
    expect(code).not.toContain('_thinkingTimer');
  });

  it('10. konuşan katmanlarda içeriksiz bekletme cümlesi kalmadı', () => {
    const FILES: readonly string[][] = [
      ['platform', 'voiceService.ts'],
      ['platform', 'commandExecutor.ts'],
      ['platform', 'voiceInfoService.ts'],
      ['platform', 'maviCore', 'wiring', 'maviFeedback.ts'],
    ];
    for (const f of FILES) {
      const code = codeOf(read(...f));
      // Konuşulan string literal'leri toplanır; her biri politikadan geçirilir.
      const literals = code.match(/'[^'\n]{2,60}'/g) ?? [];
      for (const lit of literals) {
        expect(isGenericFiller(lit.slice(1, -1)), `${f.join('/')} → ${lit}`).toBe(false);
      }
    }
  });

  it('11. maviFeedback: "Bir saniye"/"Bakıyorum" aşama satırları KALDIRILDI', () => {
    expect(buildStageFeedback('understanding')).toBeNull();
    expect(buildStageFeedback('planning')).toBeNull();
    // Bilgi TAŞIYAN aşamalar korunur (mikrofon açık · gerçek eylem başladı).
    expect(buildStageFeedback('listening')?.message).toBe('Dinliyorum');
    expect(buildStageFeedback('executing')?.message).toBe('Yapıyorum');
  });

  it('12. maviCore köprüsü planlama aşamasında ara söz YAYINLAMAZ', () => {
    const code = codeOf(read('platform', 'maviCore', 'wiring', 'maviVoiceBridge.ts'));
    expect(code).not.toContain("buildStageFeedback('planning')");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Prompt: LLM'e filler ÖĞRETİLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F2 · D · prompt temizliği', () => {
  const PROVIDER = read('platform', 'companion', 'companionChatProvider.ts');

  it('13. prompt ÖRNEKLERİNDE hiçbir `feedback` alanı filler DEĞİLDİR', () => {
    const fbs = [...PROVIDER.matchAll(/"feedback":"([^"]+)"/g)].map((m) => m[1]);
    expect(fbs.length, 'prompt örneği bulunamadı — kilit körleşti').toBeGreaterThan(5);
    for (const fb of fbs) expect(isGenericFiller(fb), `prompt örneği: ${fb}`).toBe(false);
  });

  it('14. prompt gecikme örtmeyi AÇIKÇA yasaklar ve sahte onay yasağını EZMEZ', () => {
    expect(PROVIDER).toContain('GECİKME ÖRTME YASAK');
    expect(PROVIDER).toContain('SAHTE ONAY YASAK');   // ACK ≠ BAŞARI — ikisi birlikte durur
  });

  it('15. semantik AI prompt\'unun örnekleri de filler taşımaz', () => {
    const fbs = [...read('platform', 'ai', 'semanticAiService.ts')
      .matchAll(/"feedback":"([^"]+)"/g)].map((m) => m[1]);
    for (const fb of fbs) expect(isGenericFiller(fb), `semantic örneği: ${fb}`).toBe(false);
  });
});
