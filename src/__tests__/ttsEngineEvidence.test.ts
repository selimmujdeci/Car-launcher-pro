/**
 * ttsEngineEvidence.test.ts — **SAHA #1256-a · "ÇAĞRI YAPILDI" ≠ "SES DUYULDU".**
 *
 * ── ÖLÇÜLEN ARIZA (2026-09-04, Xiaomi 23090RA98I) ───────────────────────────
 * Kullanıcı "Hey Mavi" sonrası HİÇBİR ŞEY duymuyordu ve bunu "Mavi uyanmıyor"
 * diye bildirdi. LAB `maviSpeech` defteri ise `toplam seslendirme: 2` diyordu —
 * TTS'e GERÇEKTEN iki çağrı gitmişti. Kök neden ürünün DIŞINDAYDI:
 * `settings get secure tts_default_synth` = **null** (Google TTS kuruluydu ama
 * varsayılan motor HİÇ SEÇİLMEMİŞTİ; motor seçili değilken `TextToSpeech`
 * çağrıları sessizce hiçbir ses üretmez).
 *
 * O gün kaybedilen şey bir düzeltme değil, bir AYRIMDI: ürün "çağrı yaptım"
 * diyebiliyordu ama "motor cevap verdi mi" sorusuna cevabı YOKTU.
 *
 * ── BU KİLİDİN SINIRI (dürüstlük — pazarlıksız) ─────────────────────────────
 * JS'ten sesin duyulduğu KANITLANAMAZ. Bu dosya "ses çıktı" iddiasını DEĞİL,
 * yalnız şunları kilitler: (a) seslendirmenin nasıl sonlandığı ölçülür,
 * (b) motor cevap vermediğinde bu AYRI bir sınıf olarak görünür, (c) hiçbir
 * yerde "duyuldu" iddiası ÜRETİLMEZ, (d) metin LAB'a TAŞINMAZ.
 *
 * ZAYIFLATMA/SİLME YASAK (CLAUDE.md §Regresyon Kasası).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ══════════════════════════════════════════════════════════════════════════
 * A · DAVRANIŞ — defter gerçek yolları ayırt eder
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1256-a/A — TTS motor sonuç defteri', () => {
  let tts: typeof import('../platform/ttsService');

  beforeEach(async () => {
    vi.resetModules();
    tts = await import('../platform/ttsService');
    tts._resetTtsEngineDiagnosticsForTest();
  });

  afterEach(() => {
    tts._resetTtsEngineDiagnosticsForTest();
  });

  it('çapa: tanı yüzeyi gerçekten var ve boş başlar', () => {
    const d = tts.getTtsEngineDiagnostics();
    expect(d.requested).toBe(0);
    expect(d.engineDone).toBe(0);
    expect(d.noEngineReport).toBe(0);
    expect(d.last, 'hiç seslendirme yokken sahte kayıt üretilmiş').toBeNull();
  });

  it('web motoru YOKSA sessizce yutulmaz — ENGINE_SILENT olarak kaydedilir', () => {
    /* `isTTSAvailable()` false yolu: platformda hiç TTS yok. Eskiden bu durum
       defterde HİÇBİR iz bırakmıyordu — "çağrı yaptım" bile denmiyordu. */
    tts.ttsSpeak('Merhaba, ben Mavi. Seni dinliyorum.');
    const d = tts.getTtsEngineDiagnostics();
    expect(d.requested, 'deneme hiç kaydedilmedi').toBe(1);
    expect(d.engineError).toBe(1);
    expect(d.last?.evidence).toBe('ENGINE_SILENT');
    expect(d.last?.cause).toBe('ENGINE_UNAVAILABLE');
  });

  it('GİZLİLİK: defter METİN taşımaz — yalnız karakter SAYISI', () => {
    tts.ttsSpeak('gizli kullanıcı cümlesi');
    const d = tts.getTtsEngineDiagnostics();
    const blob = JSON.stringify(d);
    expect(blob, 'seslendirilen metin tanı yüzeyine sızdı').not.toContain('gizli');
    expect(blob).not.toContain('cümlesi');
    expect(d.last?.charCount).toBeGreaterThan(0);
  });

  it('sayaç tavanı vardır — defter sınırsız büyümez', () => {
    const cap = Number(
      /TTS_LEDGER_CAP\s*=\s*([\d_]+)/.exec(read('platform', 'ttsService.ts'))?.[1]
        .replace(/_/g, ''),
    );
    expect(cap, 'tavan sabiti bulunamadı — kilit körleşti').toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(100_000);
  });

  it('fiziksel alt sınır cömerttir (yanlış-pozitif yerine kaçırmayı seçer)', () => {
    const src = read('platform', 'ttsService.ts');
    const perChar = Number(/return 250 \+ charCount \* (\d+);/.exec(src)?.[1]);
    expect(perChar, 'alt sınır formülü bulunamadı — kilit körleşti').toBeGreaterThan(0);
    /* Türkçe TTS pratikte ~12-15 karakter/sn (≈70-83 ms/karakter). Sınır bunun
       ÇOK altında olmalı ki gerçek ama hızlı bir motor "şüpheli" sayılmasın. */
    expect(perChar, 'alt sınır gerçek konuşma hızına yaklaştı — yanlış-pozitif riski')
      .toBeLessThan(50);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · YAPISAL — üç settle yolu da etiketli, iddia üretilmiyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1256-a/B — yapısal kilitler', () => {
  const TTS  = stripComments(read('platform', 'ttsService.ts'));
  const SRCS = stripComments(read('platform', 'devtools', 'maviConsoleSources.ts'));
  const MODEL = read('platform', 'devtools', 'maviConsoleModel.ts');

  it('native yolun ÜÇ çıkışı da AYRI nedenle etiketlenir', () => {
    expect(TTS, 'emniyet süresi dolması motor bitişinden ayrılmıyor')
      .toContain("settle('NO_ENGINE_REPORT')");
    expect(TTS).toContain("settle('ENGINE_DONE')");
    expect(TTS).toContain("settle('ENGINE_ERROR')");
  });

  it('etiketsiz `settle()` çağrısı KALMADI (sessiz yol yok)', () => {
    const bare = TTS.match(/[^_a-zA-Z]settle\(\)/g) ?? [];
    expect(bare, `${bare.length} adet etiketsiz settle — sessiz yol geri geldi`)
      .toHaveLength(0);
  });

  it('YENİ TIMER eklenmedi — defter mevcut yolları etiketler', () => {
    /* Native seslendirme yolunda tek bir emniyet zamanlayıcısı vardır ve
       defter ona BİNMEZ; kendi zamanlayıcısını kurmaz. */
    expect(TTS).toContain('const safety = setTimeout(');
    expect(TTS, 'defter kendi zamanlayıcısını kurdu').not.toMatch(
      /_noteTtsAttempt[\s\S]{0,200}setTimeout\(/,
    );
  });

  it('defter hiçbir TTS KARARINI etkilemez (ikinci otorite yok)', () => {
    /* YAPISAL İDDİA: sayaçlar YALNIZ defter bloğunun içinde geçer. Konuşma
       yollarından biri bir sayacı okusaydı gözlem, karara dönüşmüş olurdu —
       defter sessizce ikinci otorite hâline gelirdi. */
    const a = TTS.indexOf('export type TtsSettleCause');
    const b = TTS.indexOf('export function _resetTtsEngineDiagnosticsForTest');
    expect(a, 'defter bloğu bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(b, 'sıfırlayıcı bulunamadı — kilit körleşti').toBeGreaterThan(a);
    const bEnd = TTS.indexOf(String.fromCharCode(10) + '}', b);
    const outside = TTS.slice(0, a) + TTS.slice(bEnd);

    for (const counter of [
      '_ttsRequested', '_ttsEngineDone', '_ttsEngineError',
      '_ttsNoEngineReport', '_ttsSuspectInstant', '_ttsLastSettle',
      '_ttsLedgerSaturated',
    ]) {
      expect(outside, `sayaç defter bloğunun DIŞINDA kullanılmış: ${counter}`)
        .not.toContain(counter);
    }
    /* Konuşma yolları defteri OKUMAZ — yalnız `_noteTts*` ile YAZAR. */
    expect(outside, 'konuşma yolu defteri okuyor').not.toContain('getTtsEngineDiagnostics()');
    expect(outside).toContain('_noteTtsAttempt(');
    expect(outside).toContain('_noteTtsSettled(');
  });

  it('LAB kaynağı kendi try/catch içinde okur (bölüm körelmez)', () => {
    expect(SRCS).toContain('_safe(() => getTtsEngineDiagnostics())');
  });

  it('LAB "ses duyuldu" İDDİA ETMEZ — kanıt sınıfı taşınır', () => {
    expect(MODEL, 'motor bitişi ses kanıtı gibi sunuluyor')
      .toContain('sesin DUYULDUĞUNUN kanıtı');
    expect(MODEL).toContain("id: 'msTtsSilent'");
    /* Hüküm türetimi DERIVED olarak sınıflanmalı — OBSERVED olarak sunmak
       LAB'ı ikinci otorite yapardı. */
    /* İki `msTtsLast` alanı vardır: kayıt YOKKEN `unavailable`, VARKEN
       `derived`. Kilit ikincisini arar — hüküm OBSERVED sunulursa LAB kendi
       gerçeğini üretmiş olurdu. */
    const first = MODEL.indexOf("id: 'msTtsLast'");
    expect(first, 'son kanıt alanı yok — kilit körleşti').toBeGreaterThan(-1);
    const second = MODEL.indexOf("id: 'msTtsLast'", first + 1);
    expect(second, 'kanıt VARKEN gösterilen alan yok — kilit körleşti').toBeGreaterThan(-1);
    expect(MODEL.slice(Math.max(0, second - 120), second)).toContain('derived(');
    expect(MODEL.slice(Math.max(0, first - 120), first)).toContain('unavailable(');
  });

  it('YENİ LAB EKRANI AÇILMADI — mevcut konsol genişletildi', () => {
    const catalog = read('platform', 'devtools', 'carosLabCatalog.ts');
    expect(catalog, 'TTS motoru için ayrı ekran açılmış (ekran enflasyonu yasağı)')
      .not.toMatch(/tts-engine|ttsEngine/);
  });
});
