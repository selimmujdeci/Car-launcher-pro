/**
 * maviContextGrammar.test.ts — MAVI-STT-CONTEXT-GRAMMAR KİLİTLERİ.
 *
 * ANA İLKELER:
 *  1. **GRAMER KARAR ÜRETMEZ:** yalnız TANIMA adaylarını daraltır. Intent, eylem
 *     ve onay kabul/ret otoritesi DEĞİŞMEZ (M4 + voiceService tek otorite kalır).
 *  2. **ÖNCELİK BAĞLAYICI:** confirmation > navigasyon > medya > araç > general.
 *     Kaynak okunamazsa TAHMİN YOK → general_command.
 *  3. **YALNIZ GERÇEK YÜZEY:** sözcükler `PATTERNS`ten gelir; parser'ın
 *     eşleştiremeyeceği sözcük gramere KONMAZ (yeni komut icat etme yasağı).
 *  4. **FAIL-SOFT:** gramer kurulamazsa genele düşülür; hiçbir yolda mikrofon
 *     veya wake zinciri kapanmaz. Wake grameri AYRI hattadır.
 *  5. **DEDUP:** aynı gramer tekrar uygulanmaz (recognizer boşuna yeniden kurulmaz).
 *  6. **GİZLİLİK:** tanı yüzeyinde SÖZCÜK yoktur — sınıf, adet, bounded kod, sayaç.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  selectGrammar, buildGrammarPlan, generalFallbackPlan, normalizeGrammarWords,
  grammarFingerprint,
  CONFIRMATION_GRAMMAR, NAVIGATION_TYPES, MEDIA_TYPES, VEHICLE_TYPES, ESCAPE_TYPES,
  GRAMMAR_CLASSES, GRAMMAR_REASON_CODES,
  type GrammarContextSnapshot, type GrammarVocabulary,
} from '../platform/voice/contextGrammarModel';
import {
  resolveActiveGrammar, getGrammarDiagnostics,
  _resetGrammarDiagnosticsForTest, _setGrammarCountersForTest,
} from '../platform/voice/contextGrammarApplier';
import {
  registerGrammarContextProviders, grammarProvidersWired,
  _resetGrammarContextProvidersForTest,
} from '../platform/voice/contextGrammarProviders';
import {
  buildCommandGrammar, buildCommandGrammarFor, countGrammarBackedTypes,
  parseCommand, parseCommandFull, type CommandType,
} from '../platform/commandParser';
import {
  setPendingAction, clearPendingAction, peekPendingAction,
  getPendingActionDiagnostics, _resetPendingActionForTest,
} from '../platform/action/pendingActionConfirmation';
import type { AppIntent } from '../platform/intentEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readSrc(...p: string[]): string {
  return readFileSync(join(process.cwd(), ...p), 'utf8');
}

const MODEL_PATH   = ['src', 'platform', 'voice', 'contextGrammarModel.ts'];
const SOURCES_PATH = ['src', 'platform', 'voice', 'contextGrammarSources.ts'];
const APPLIER_PATH = ['src', 'platform', 'voice', 'contextGrammarApplier.ts'];

function ctx(over: Partial<GrammarContextSnapshot> = {}): GrammarContextSnapshot {
  return {
    pendingConfirmation: false,
    navigationActive: false,
    mediaPlaying: false,
    vehicleSessionReady: false,
    online: false,
    ...over,
  };
}

/** GERÇEK sözlük üreticileri — mock YOK (parser'ın kendisi kullanılır). */
const REAL_VOCAB: GrammarVocabulary = {
  buildGeneral: () => buildCommandGrammar(),
  buildFor: (types) => buildCommandGrammarFor(types),
};

function plan(c: GrammarContextSnapshot) {
  return buildGrammarPlan(selectGrammar(c), REAL_VOCAB);
}

/** M4 bekleyen onay slotunu doldurur (gerçek otorite kullanılır). */
function pend(): void {
  setPendingAction({
    actionId: 'phone.call.start',
    intent: { type: 'call_contact', payload: { contactName: 'Ayşe Yıldırım' } } as unknown as AppIntent,
    atMs: NOW,
    turnId: 1,
  } as never);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1-6 — Confirmation bağlamı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · 1-6. confirmation', () => {
  beforeEach(() => { _resetPendingActionForTest(); _resetGrammarDiagnosticsForTest(); });

  it('1. bekleyen onay varken confirmation grameri seçilir (EN YÜKSEK öncelik)', () => {
    const sel = selectGrammar(ctx({ pendingConfirmation: true }));
    expect(sel.grammarClass).toBe('confirmation');
    expect(sel.reasonCode).toBe('PENDING_CONFIRMATION');

    // Navigasyon/medya/araç aynı anda AÇIK olsa bile confirmation kazanır.
    const all = selectGrammar(ctx({
      pendingConfirmation: true, navigationActive: true, mediaPlaying: true, vehicleSessionReady: true,
    }));
    expect(all.grammarClass).toBe('confirmation');
  });

  it('2. confirmation grameri YALNIZ izin verilen yanıtlar + [unk] içerir', () => {
    const p = plan(ctx({ pendingConfirmation: true }))!;
    expect(p.words).toEqual(['evet', 'hayır', 'tamam', 'onayla', 'iptal', 'vazgeç', '[unk]']);
    expect(p.entryCount).toBe(7);
    // `[unk]` TEK ve SONDA.
    expect(p.words!.filter((w) => w === '[unk]')).toHaveLength(1);
    expect(p.words![p.words!.length - 1]).toBe('[unk]');
    // Araç/medya/navigasyon komutu SIZMAMIŞ (kaçış seti confirmation'a UYGULANMAZ).
    for (const banned of ['aracı kilitle', 'müzik', 'eve git', 'korna', 'harita']) {
      expect(p.words!.some((w) => w.includes(banned))).toBe(false);
    }
  });

  it('2b. confirmation sözcükleri gerçek onay ayrıştırıcısına ÖLÇÜLEREK bağlanır', () => {
    /* Gramer, parser'ın göremeyeceği bir sözcük ÖNERMEMELİDİR. AFFIRM_RE/NEGATE_RE
       `voiceService`te özeldir → kaynaktan okunup BİREBİR çalıştırılır (varsayım YOK). */
    const vs = readSrc('src', 'platform', 'voiceService.ts');
    const affirm = /const AFFIRM_RE = (\/.+\/i);/.exec(vs)![1]!;
    const negate = /const NEGATE_RE = (\/.+\/i);/.exec(vs)![1]!;
    const AFFIRM = new RegExp(affirm.slice(1, -2), 'i');
    const NEGATE = new RegExp(negate.slice(1, -2), 'i');

    expect(AFFIRM.test('evet')).toBe(true);
    expect(AFFIRM.test('onayla')).toBe(true);
    expect(AFFIRM.test('tamam')).toBe(true);
    expect(NEGATE.test('hayır')).toBe(true);
    expect(NEGATE.test('iptal')).toBe(true);

    /* ✅ ONARILDI (P0-GÖREV-3): `NEGATE_RE`'nin sonundaki `` ASCII tabanlıydı;
       `ç` sözcük karakteri sayılmadığı için dizgi sonunda sınır oluşmuyor ve tam
       olarak "vazgeç" demek ret hattını TETİKLEMİYORDU. `(?:|$)` alternatifi
       bu tek boşluğu kapattı; diğer davranışlar birebir korundu.
       Önceki tur bu kusuru DÜRÜSTÇE dondurmuştu — kusur giderildiği için kilit
       YENİ DOĞRU DAVRANIŞA güncellendi (kaldırılmadı). */
    expect(NEGATE.test('vazgeç')).toBe(true);
    expect(NEGATE.test('vazgeçtim')).toBe(true);
    expect(NEGATE.test('vazgec')).toBe(true);
    /* Sınır koruması KORUNDU: bu iki sözcük hâlâ ret sayılmaz. */
    expect(NEGATE.test('durum')).toBe(false);
    expect(NEGATE.test('yokuş')).toBe(false);

    /* Sözcük gramerde KALIR: Vosk onu duyamazsa kusur giderildiğinde bile
       kullanıcı "vazgeç" diyemez. Gramer tanımayı açar, kararı vermez. */
    expect(CONFIRMATION_GRAMMAR).toContain('vazgeç');

    /* Artık İSTİSNASIZ: her öneri gerçekten bir onay/ret hattına bağlanır. */
    for (const w of CONFIRMATION_GRAMMAR) {
      if (w === '[unk]') continue;
      expect(AFFIRM.test(w) || NEGATE.test(w)).toBe(true);
    }
  });

  it('3. onay bitince UYGUN önceki/genel gramer geri gelir', () => {
    expect(selectGrammar(ctx({ pendingConfirmation: true, navigationActive: true })).grammarClass)
      .toBe('confirmation');
    // Onay tüketildi/iptal edildi → navigasyon bağlamı geri gelir.
    expect(selectGrammar(ctx({ pendingConfirmation: false, navigationActive: true })).grammarClass)
      .toBe('navigation');
    // Hiçbir bağlam yoksa genele döner.
    expect(selectGrammar(ctx({ pendingConfirmation: false })).grammarClass).toBe('general_command');
  });

  it('4. confirmation gramerinde "aracı kilitle" DOĞRUDAN EYLEM üretmez', () => {
    /* İki katlı kanıt: (a) sözcük gramerde YOK → Vosk onu [unk]'a düşürür;
       (b) gramer katmanı zaten hiçbir intent/eylem ÜRETMEZ (üretim kodu taraması). */
    const p = plan(ctx({ pendingConfirmation: true }))!;
    expect(p.words).not.toContain('aracı kilitle');

    for (const path of [MODEL_PATH, SOURCES_PATH, APPLIER_PATH]) {
      const src = stripComments(readSrc(...path));
      for (const banned of [
        'dispatchIntent', 'executeIntent', 'routeIntent', 'consumePendingAction',
        'setPendingAction', 'clearPendingAction', 'evaluateVehicleAction',
        'commandExecutor', 'speakMaviAnswer', 'parseCommand',
      ]) {
        expect(src).not.toContain(banned);
      }
    }
  });

  it('5-6. onay kabul/ret hattı DEĞİŞMEDİ (tek otorite hâlâ M4 + voiceService)', () => {
    const vs = readSrc('src', 'platform', 'voiceService.ts');
    // "evet" → consumePendingAction · "hayır" → clearPendingAction blokları YERİNDE.
    expect(vs).toMatch(/if \(peekPendingAction\(now\)\) \{[\s\S]{0,600}consumePendingAction\(turn\.id, now\)/);
    expect(vs).toMatch(/if \(NEGATE_RE\.test\(trimmed\)\) \{[\s\S]{0,200}clearPendingAction\(\)/);
    // Gramer katmanı bu bloklara DOKUNMADI: tek değişiklik `grammar:` alanıdır.
    expect(vs).toMatch(/grammar: resolveActiveGrammar\(/);
  });

  it('6b. bağlam okuması onay slotunu TÜKETMEZ (mutasyonsuz kaynak)', () => {
    pend();
    expect(getPendingActionDiagnostics(NOW).pending).toBe(true);
    // Kaynak katmanı `peekPendingAction` KULLANMAZ (o süresi dolmuşu SİLER).
    const src = stripComments(readSrc(...SOURCES_PATH));
    expect(src).toContain('getPendingActionDiagnostics');
    expect(src).not.toContain('peekPendingAction');
    // Slot hâlâ dolu.
    expect(peekPendingAction(NOW)).not.toBeNull();
    clearPendingAction();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7-10 — Diğer bağlamlar ve öncelik
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · 7-10. bağlam seçimi', () => {
  it('7. navigasyon bağlamında navigation grameri seçilir', () => {
    const sel = selectGrammar(ctx({ navigationActive: true, mediaPlaying: true, vehicleSessionReady: true }));
    expect(sel.grammarClass).toBe('navigation');
    expect(sel.reasonCode).toBe('NAVIGATION_ACTIVE');
    const p = plan(ctx({ navigationActive: true }))!;
    expect(p.words).toContain('eve git');
    expect(p.entryCount).toBeLessThan(buildCommandGrammar().length); // GERÇEKTEN daraldı
  });

  it('8. medya bağlamında media grameri seçilir (navigasyon kapalıyken)', () => {
    const sel = selectGrammar(ctx({ mediaPlaying: true, vehicleSessionReady: true }));
    expect(sel.grammarClass).toBe('media');
    expect(sel.reasonCode).toBe('MEDIA_PLAYING');
    const p = plan(ctx({ mediaPlaying: true }))!;
    expect(p.entryCount).toBeLessThan(buildCommandGrammar().length);
  });

  it('9. araç bağlamında vehicle grameri seçilir (nav+medya kapalıyken)', () => {
    const sel = selectGrammar(ctx({ vehicleSessionReady: true }));
    expect(sel.grammarClass).toBe('vehicle');
    expect(sel.reasonCode).toBe('VEHICLE_SESSION_READY');
    const p = plan(ctx({ vehicleSessionReady: true }))!;
    /* GERÇEK yüzey (PATTERNS'ten ÖLÇÜLDÜ): kilit komutunun sözcüğü
       "arabayı kilitle"/"kilitle"dir — "aracı kilitle" bir keyword DEĞİLDİR
       (parser onu token üzerinden yakalar, gramer ise sözcük listesidir). */
    expect(p.words).toContain('arabayı kilitle');
    expect(p.words).toContain('kilitle');
    expect(p.entryCount).toBeLessThan(buildCommandGrammar().length);
  });

  it('9b. araç sınıfı TANI yüzeyini de taşır (dar gramerde desteklenen komut ÖLMEZ)', () => {
    /* `vehicleIntents.ts` yüzeyi aynı `PATTERNS` dizisindedir → dışarıda
       bırakılsaydı araç bağlamında DESTEKLENEN komutlar sessizce kaybolurdu. */
    const p = plan(ctx({ vehicleSessionReady: true }))!;
    for (const w of ['arıza var mı', 'hataları sil', 'araç durumu nasıl', 'bakım durumu']) {
      expect(p.words).toContain(w);
    }
    for (const t of ['vehicle_status', 'vehicle_maintenance', 'vehicle_health_check', 'vehicle_clear_dtc'] as CommandType[]) {
      expect(VEHICLE_TYPES).toContain(t);
    }
  });

  it('10. kaynak BİLİNMİYORSA tahmin yapılmaz → general_command', () => {
    // Hepsi okunamadı → AYRI gerekçe kodu (sessiz "bağlam yok" ile karışmasın).
    const unread = selectGrammar(ctx({
      pendingConfirmation: null, navigationActive: null, mediaPlaying: null, vehicleSessionReady: null,
    }));
    expect(unread.grammarClass).toBe('general_command');
    expect(unread.reasonCode).toBe('CONTEXT_SOURCE_UNREADABLE');

    // Okundu ama kanıt yok → farklı gerekçe.
    expect(selectGrammar(ctx()).reasonCode).toBe('NO_CONTEXT_EVIDENCE');

    // null ASLA false'a indirgenmez: navigasyon okunamadıysa medya sırası gelir.
    expect(selectGrammar(ctx({ navigationActive: null, mediaPlaying: true })).grammarClass).toBe('media');
  });

  it('10b. çevrimiçi yolda gramer HİÇ verilmez (mevcut davranış korunur)', () => {
    const sel = selectGrammar(ctx({ online: true, navigationActive: true, pendingConfirmation: true }));
    expect(sel.grammarClass).toBe('general_command');
    expect(sel.reasonCode).toBe('ONLINE_FULL_DICTATION');
    const p = plan(ctx({ online: true }))!;
    expect(p.words).toBeNull();
    expect(resolveActiveGrammar(true, NOW)).toBeUndefined();
  });

  it('10d. ÇEVRİMDIŞI GENEL yolda gramer YİNE uygulanır (tam sözlük DÜŞMEZ)', () => {
    /* 🔒 REGRESYON KİLİDİ — bir kez DÜŞTÜ: "gramer uygulanmaz" ile "tür süzgeci
       yok" tek bir `null` sentinel'ine bindirilmişti; sonuç, bağlam kanıtı
       olmayan HER offline dinlemenin gramersiz (full-vocab dikte) kalmasıydı —
       yani görev, offline doğruluğu artırmak yerine mevcut Yol A kazancını
       sessizce SİLİYORDU. Sınıf/gerekçe doğru göründüğü için gözden kaçıyordu. */
    const sel = selectGrammar(ctx());
    expect(sel.grammarClass).toBe('general_command');
    expect(sel.applies).toBe(true);            // ← uygulanır
    expect(sel.types).toBeNull();              // ← ama süzgeç yok (tam sözlük)

    const p = plan(ctx())!;
    expect(p.words).not.toBeNull();
    expect(p.entryCount).toBe(buildCommandGrammar().length);   // TAM sözlük, kırpılmadı

    // Kaynaklar okunamadığında da aynı: tahmin yok ama gramer de kaybolmuyor.
    const unread = plan(ctx({
      pendingConfirmation: null, navigationActive: null, mediaPlaying: null, vehicleSessionReady: null,
    }))!;
    expect(unread.entryCount).toBe(buildCommandGrammar().length);

    // Uçtan uca: uygulayıcı GERÇEK bir liste döndürür (undefined = gramersiz).
    const applied = resolveActiveGrammar(false, NOW);
    expect(Array.isArray(applied)).toBe(true);
    expect(applied!.length).toBe(buildCommandGrammar().length);
    // Yalnız ÇEVRİMİÇİ yolda gramer verilmez.
    expect(resolveActiveGrammar(true, NOW)).toBeUndefined();
  });

  it('10c. ÇAPRAZ-BAĞLAM KAÇIŞ SETİ dar gramerde bağlam değiştirmeyi yaşatır', () => {
    /* Vosk gramer kipinde liste dışı söz [unk]'a düşer ve offline'da onu
       kurtaracak beyin YOKTUR → dar gramerde bağlam dışı komut KAYBOLURDU. */
    const nav = plan(ctx({ navigationActive: true }))!;
    expect(nav.words).toContain('müziği aç');       // medyaya geçiş yaşıyor
    expect(nav.words).toContain('arabayı kilitle'); // araca geçiş yaşıyor (GERÇEK sözcük)
    const media = plan(ctx({ mediaPlaying: true }))!;
    expect(media.words).toContain('eve git');     // navigasyona geçiş yaşıyor
    // Kaçış seti BOUNDED ve gerçek türlerden.
    expect(ESCAPE_TYPES.length).toBeLessThanOrEqual(6);
    expect(countGrammarBackedTypes(ESCAPE_TYPES)).toBe(ESCAPE_TYPES.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11-14 — Geçiş, dedup, fallback
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · 11-14. geçiş ve fallback', () => {
  beforeEach(() => { _resetPendingActionForTest(); _resetGrammarDiagnosticsForTest(); });

  it('11. AYNI gramer tekrar tekrar uygulanmaz (dedup — restart sayısı artmaz)', () => {
    resolveActiveGrammar(false, NOW);
    const first = getGrammarDiagnostics().transitionCount;
    expect(first).toBe(1);
    for (let i = 0; i < 10; i++) resolveActiveGrammar(false, NOW);
    expect(getGrammarDiagnostics().transitionCount).toBe(first); // TEK geçiş
  });

  it('12. gramer GERÇEKTEN değiştiğinde TEK geçiş olur', () => {
    resolveActiveGrammar(false, NOW);              // general
    expect(getGrammarDiagnostics().grammarClass).toBe('general_command');
    const before = getGrammarDiagnostics().transitionCount;

    pend();                                        // bekleyen onay doğdu
    resolveActiveGrammar(false, NOW);
    const d = getGrammarDiagnostics();
    expect(d.grammarClass).toBe('confirmation');
    expect(d.grammarEntryCount).toBe(7);
    expect(d.lastReason).toBe('PENDING_CONFIRMATION');
    expect(d.transitionCount).toBe(before + 1);
    expect(d.pendingConfirmation).toBe(true);

    resolveActiveGrammar(false, NOW);              // aynı bağlam → geçiş YOK
    expect(getGrammarDiagnostics().transitionCount).toBe(before + 1);

    clearPendingAction();
    resolveActiveGrammar(false, NOW);              // geri dönüş → tek geçiş daha
    expect(getGrammarDiagnostics().grammarClass).toBe('general_command');
    expect(getGrammarDiagnostics().transitionCount).toBe(before + 2);
  });

  it('13. sözlük kurulamazsa GENEL fallback çalışır', () => {
    const broken: GrammarVocabulary = {
      buildGeneral: () => buildCommandGrammar(),
      buildFor: () => { throw new Error('sözlük patladı'); },
    };
    // Sınıf planı üretilemez…
    expect(buildGrammarPlan(selectGrammar(ctx({ navigationActive: true })), broken)).toBeNull();
    // …ama genel fallback planı üretilir.
    const fb = generalFallbackPlan(broken)!;
    expect(fb).not.toBeNull();
    expect(fb.grammarClass).toBe('general_command');
    expect(fb.reasonCode).toBe('APPLY_FAILED_FALLBACK');
    expect(fb.words).toContain('[unk]');

    // Genel de patlarsa gramer HİÇ verilmez (native full-vocab) — throw YOK.
    const dead: GrammarVocabulary = {
      buildGeneral: () => { throw new Error('yok'); },
      buildFor: () => { throw new Error('yok'); },
    };
    expect(generalFallbackPlan(dead)).toBeNull();
    expect(() => buildGrammarPlan(selectGrammar(ctx()), dead)).not.toThrow();
  });

  it('14. apply hatası wake-word veya mikrofon zincirini ÖLDÜRMEZ', () => {
    // Uygulayıcı hiçbir yolda throw etmez ve mikrofon/wake API'si ÇAĞIRMAZ.
    expect(() => resolveActiveGrammar(false, NOW)).not.toThrow();
    expect(() => resolveActiveGrammar(true, NOW)).not.toThrow();

    const src = stripComments(readSrc(...APPLIER_PATH));
    for (const banned of [
      'startWakeWordListening', 'stopWakeWordListening', 'startSpeechRecognition',
      'startListening', 'stopListening', 'disableWakeWord', 'CarLauncher',
    ]) {
      expect(src).not.toContain(banned);
    }
    // Hata yolunda `undefined` döner — istisna fırlatmaz.
    expect(src).toMatch(/return undefined;/);
  });

  it('15. wake grameri aktif komut greamerinden AYRI hattadır', () => {
    /* Wake grameri native `startWakeWordListening` yolunda kurulur; bu modüller
       o hatta HİÇ dokunmaz. Native tarafta da iki gramer ayrı değişkendir. */
    for (const p of [MODEL_PATH, SOURCES_PATH, APPLIER_PATH]) {
      expect(stripComments(readSrc(...p))).not.toMatch(/wakeGrammar|wakePhrases|startWakeWordListening/);
    }
    const plugin = readSrc('android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'CarLauncherPlugin.java');
    expect(plugin).toMatch(/private volatile String\s+wakeGrammarJson/);
    expect(plugin).toMatch(/private volatile String\s+voskActiveGrammarJson/);
    // Wake sınıfı seçim akışında ASLA üretilmez (ayrı hat).
    for (const c of [ctx(), ctx({ pendingConfirmation: true }), ctx({ navigationActive: true }),
                     ctx({ mediaPlaying: true }), ctx({ vehicleSessionReady: true }), ctx({ online: true })]) {
      expect(selectGrammar(c).grammarClass).not.toBe('wake_word');
    }
    expect(GRAMMAR_CLASSES).toContain('wake_word'); // sözleşmede var, seçimde yok
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16-19 — Gizlilik, sayaçlar, parser değişmezliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · 16-19. gizlilik ve değişmezlik', () => {
  beforeEach(() => { _resetPendingActionForTest(); _resetGrammarDiagnosticsForTest(); });

  it('16. grammar SÖZCÜKLERİ tanı yüzeyine sızmaz (yalnız sınıf + adet + kod)', () => {
    pend();
    resolveActiveGrammar(false, NOW);
    const d = getGrammarDiagnostics();
    const json = JSON.stringify(d);

    for (const w of ['evet', 'hayır', 'onayla', 'eve git', 'müziği aç', 'aracı kilitle']) {
      expect(json).not.toContain(w);
    }
    // Tanı sözleşmesinde string alanlar YALNIZ sabit enumdur.
    expect(GRAMMAR_CLASSES).toContain(d.grammarClass);
    expect(GRAMMAR_REASON_CODES).toContain(d.lastReason);
    expect(Object.keys(d).sort()).toEqual([
      'countersSaturated', 'fallbackGeneralCount', 'grammarApplyFailureCount',
      'grammarClass', 'grammarEntryCount', 'lastReason', 'pendingConfirmation', 'transitionCount',
    ]);
    // Parmak izi geri çevrilemez (sözcük saklamaz).
    expect(grammarFingerprint(['evet', 'hayır'])).toMatch(/^[0-9a-f]{8}$/);
    expect(grammarFingerprint(['evet', 'hayır'])).not.toContain('evet');
    clearPendingAction();
  });

  it('17. transcript ve n-best KAYDEDİLMEZ', () => {
    for (const p of [MODEL_PATH, SOURCES_PATH, APPLIER_PATH]) {
      const src = stripComments(readSrc(...p));
      for (const banned of ['transcript', 'alternatives', 'nBest', 'lastHeard', 'sourceText', 'contactName']) {
        expect(src).not.toMatch(new RegExp(`\\b${banned}\\b`));
      }
    }
  });

  it('18. sayaçlar doğru artar ve SATURATING kalır', () => {
    resolveActiveGrammar(false, NOW);
    expect(getGrammarDiagnostics().transitionCount).toBe(1);
    expect(getGrammarDiagnostics().fallbackGeneralCount).toBe(1); // general'a ilk giriş
    expect(getGrammarDiagnostics().countersSaturated).toBe(false);

    const SAT = Number.MAX_SAFE_INTEGER - 1;
    _setGrammarCountersForTest({ transitionCount: SAT });
    expect(getGrammarDiagnostics().countersSaturated).toBe(true);
    pend();
    resolveActiveGrammar(false, NOW);
    expect(getGrammarDiagnostics().transitionCount).toBe(SAT); // taşmadı
    clearPendingAction();
  });

  it('19. PARSER ÇIKTILARI görev öncesiyle AYNI kalır', () => {
    /* Değişiklik KATKISALDIR: `buildCommandGrammar` ve `parseCommand` davranışı
       birebir korunur (yeni fonksiyon yalnız YENİ bir süzgeç ekler). */
    const g = buildCommandGrammar();
    expect(g[g.length - 1]).toBe('[unk]');
    expect(g.filter((w) => w === '[unk]')).toHaveLength(1);
    expect(buildCommandGrammar()).toBe(g); // önbellek davranışı korunuyor

    /* ⚠️ Beklentiler UYDURULMADI, mevcut parser'dan ÖLÇÜLDÜ. Bu bir DAVRANIŞ
       FOTOĞRAFIDIR: amaç "doğru olanı" dayatmak değil, bu görevin parser'ı
       değiştirmediğini kanıtlamaktır. */
    const corpus: Array<[string, CommandType | null]> = [
      ['eve git', 'navigate_home'],
      ['işe git', 'navigate_work'],
      ['müziği aç', 'open_music'],
      /* ✅ ONARILDI (P0-PARSER, unknown-first turu): "sonraki şarkı" müzik
         ön-kontrolü tarafından yutulup `open_music` veriyordu; artık AÇIK KOMUT
         ön-kapısı doğru şekilde `music_next` üretiyor. Bu satır önceki turda
         kusuru donduran karakterizasyon kilidiydi — kusur giderildiği için
         YENİ DOĞRU DAVRANIŞA güncellendi (kilit kaldırılmadı). */
      ['sonraki şarkı', 'music_next'],
      ['sonraki', 'music_next'],
      ['sesi aç', 'volume_up'],
      ['aracı kilitle', 'hw_lock_doors'],
      /* ✅ ONARILDI: "korna çal" `play_music_query`ye gidiyordu (sondaki "çal"
         fiili müzik araması sanılıyordu) → korna komutu HİÇ çalışmıyordu.
         Açık komut ön-kapısı müzik ön-kontrolünden ÖNCE geldiği için düzeldi. */
      ['korna çal', 'hw_honk_horn'],
      ['kornaya bas', 'hw_honk_horn'],
      ['haritayı aç', 'open_maps'],
      /* ⚠️ HÂLÂ AÇIK KUSUR: anlamsız cümle `null` DEĞİL, `show_weather` veriyor
         (hava kalıbı fazla açgözlü). Bu tur donanım/yıkıcı türleri kapsadı;
         genel fuzzy daralması ayrı bir atomik görevdir. Kilit dürüstçe
         kusurun BUGÜNKÜ hâlini dondurur. */
      ['bu cümlenin hiçbir karşılığı yok', 'show_weather'],
      ['vazgeç', null],
    ];
    for (const [input, expected] of corpus) {
      expect(parseCommand(input)?.type ?? null).toBe(expected);
    }
    // Belirsiz girdi davranışı da korunur.
    expect(parseCommandFull('eve git').command?.type).toBe('navigate_home');
  });

  it('19b. sınıf sözlükleri YALNIZ gerçek PATTERNS türlerinden kurulur', () => {
    for (const types of [NAVIGATION_TYPES, MEDIA_TYPES, VEHICLE_TYPES]) {
      expect(countGrammarBackedTypes(types)).toBe(types.length); // hepsinin karşılığı VAR
    }
    /* ⚠️ ÖLÇÜLEN eksik yüzey: bunların `PATTERNS` girdisi GERÇEKTEN yoktur
       (başka yollardan üretilirler) → gramere KONAMAZLAR, çünkü katkıları sıfır
       sözcüktür. Bu bir icat yasağıdır, tembellik değil. */
    const unbacked: CommandType[] = [
      'find_nearby_gas', 'find_nearby_parking', 'navigate_address', 'navigate_place',
    ];
    expect(countGrammarBackedTypes(unbacked)).toBe(0);
    const all = [...NAVIGATION_TYPES, ...MEDIA_TYPES, ...VEHICLE_TYPES];
    for (const m of unbacked) expect(all).not.toContain(m);

    /* Buna KARŞILIK tanı yüzeyi GERÇEKTEN vardır (ölçüm bunu yanlışladı) →
       sınıfa dahildir. Bu satır, "yok" varsayımının geri gelmesini engeller. */
    for (const t of ['vehicle_status', 'vehicle_maintenance',
                     'vehicle_health_check', 'vehicle_clear_dtc'] as CommandType[]) {
      expect(countGrammarBackedTypes([t])).toBe(1);
      expect(all).toContain(t);
    }
  });

  it('19c. saf model I/O · saat · servis importu içermez; kaynak katmanı senkron', () => {
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/Date\.now|Math\.random|setInterval|setTimeout|from 'react'/);
    expect(model).not.toMatch(/voiceService|navigationService|mediaService|obdService/);
    const src = stripComments(readSrc(...SOURCES_PATH));
    expect(src).not.toMatch(/\bawait\b|setInterval|setTimeout|addListener/);
  });

  it('19d. `[unk]` normalizasyonu: TEK ve SONDA (mükerrer/boş temizlenir)', () => {
    expect(normalizeGrammarWords(['a', '[unk]', 'b', '[unk]', 'a', ' '])).toEqual(['a', 'b', '[unk]']);
    expect(normalizeGrammarWords([])).toEqual(['[unk]']);
    for (const c of [ctx({ pendingConfirmation: true }), ctx({ navigationActive: true }),
                     ctx({ mediaPlaying: true }), ctx({ vehicleSessionReady: true }), ctx()]) {
      const p = plan(c)!;
      expect(p.words![p.words!.length - 1]).toBe('[unk]');
      expect(p.words!.filter((w) => w === '[unk]')).toHaveLength(1);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20-22 — SICAK GRAFİK YALITIMI (bağımlılık yönü)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · 20-22. bağımlılık yalıtımı', () => {
  beforeEach(() => { _resetGrammarContextProvidersForTest(); _resetGrammarDiagnosticsForTest(); });

  it('20. okuma katmanı AĞIR servisleri import ETMEZ (voice grafiği kirlenmez)', () => {
    /* 🔒 REGRESYON KİLİDİ — bir kez DÜŞTÜ: `contextGrammarSources` doğrudan
       `navigationService`/`mediaService`/`obdService` import ediyordu. Bu üçü
       `voiceService` grafiğine obd/store zincirini soktu ve DOKUZ test dosyası
       (`voiceTuning`, `voiceNbest`, `companionConversationLoop`,
       `maviVehicleContextWiring`, `voiceCogPause`, `voiceCommandExecutionPhases`,
       `maviFakeAckVoiceChain`, …) `performanceMode` mock'u eksik kaldığı için
       ARTIK YÜKLENEMEDİ. Aynı kaza `diagnosticTrailCore` başlığında da yazılıdır. */
    const sources = stripComments(readSrc(...SOURCES_PATH));
    for (const heavy of ['navigationService', 'mediaService', 'obdService', 'useStore']) {
      expect(sources).not.toContain(heavy);
    }
    // Ağır importlar YALNIZ boot tarafındaki wiring dosyasında durur.
    const wiring = readSrc('src', 'platform', 'voice', 'contextGrammarWiring.ts');
    for (const heavy of ['navigationService', 'mediaService', 'obdService']) {
      expect(wiring).toContain(heavy);
    }
    // Ve o dosya sıcak taraftan DEĞİL, boot'tan çağrılır.
    expect(stripComments(readSrc('src', 'platform', 'voiceService.ts')))
      .not.toContain('contextGrammarWiring');
    expect(stripComments(readSrc('src', 'platform', 'system', 'SystemBoot.ts')))
      .toContain('wireGrammarContext()');
  });

  it('21. sağlayıcı BAĞLI DEĞİLKEN bağlam "yok" değil BİLİNMİYOR sayılır', () => {
    expect(grammarProvidersWired()).toBe(false);
    /* Tahmin YOK → tam sözlük (bugünkü davranış korunur), sessiz "bağlam yok" DEĞİL. */
    const words = resolveActiveGrammar(false, NOW);
    expect(Array.isArray(words)).toBe(true);
    expect(getGrammarDiagnostics().grammarClass).toBe('general_command');
    expect(words!.length).toBe(buildCommandGrammar().length);
  });

  it('22. sağlayıcı bağlanınca bağlam GERÇEKTEN etkir (kayıt ölü kod değil)', () => {
    registerGrammarContextProviders({
      isNavigating:          () => true,
      isMediaPlaying:        () => false,
      isVehicleSessionReady: () => false,
    });
    expect(grammarProvidersWired()).toBe(true);
    const words = resolveActiveGrammar(false, NOW)!;
    expect(getGrammarDiagnostics().grammarClass).toBe('navigation');
    expect(words.length).toBeLessThan(buildCommandGrammar().length);

    /* Sağlayıcı patlarsa o bağlam BİLİNMİYOR olur — diğerleri okunmaya devam eder
       ve hiçbir yolda istisna dışarı çıkmaz. */
    registerGrammarContextProviders({
      isNavigating: () => { throw new Error('nav öldü'); },
      isMediaPlaying: () => true,
    });
    expect(() => resolveActiveGrammar(false, NOW)).not.toThrow();
    expect(getGrammarDiagnostics().grammarClass).toBe('media');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * YANLIŞLAMA — kapı kaldırılınca bu kilitler DÜŞMELİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-CONTEXT-GRAMMAR · yanlışlama', () => {
  it('Y1. confirmation kapısı kaldırılırsa seçim değişir (kapı GERÇEKTEN etkili)', () => {
    // Kapı VARKEN: confirmation kazanır.
    expect(selectGrammar(ctx({ pendingConfirmation: true, navigationActive: true })).grammarClass)
      .toBe('confirmation');
    // Kapı OLMASAYDI navigasyon kazanırdı — iki sonuç FARKLI olmalı ki kapı ölü kod olmasın.
    expect(selectGrammar(ctx({ pendingConfirmation: false, navigationActive: true })).grammarClass)
      .toBe('navigation');
    // Üretim kodunda kapı gerçekten EN ÜSTTE.
    const model = stripComments(readSrc(...MODEL_PATH));
    const iConf = model.indexOf('pendingConfirmation === true');
    const iNav  = model.indexOf('navigationActive === true');
    const iMedia = model.indexOf('mediaPlaying === true');
    const iVeh  = model.indexOf('vehicleSessionReady === true');
    expect(iConf).toBeGreaterThan(-1);
    expect(iConf).toBeLessThan(iNav);
    expect(iNav).toBeLessThan(iMedia);
    expect(iMedia).toBeLessThan(iVeh);
  });

  it('Y2. dedup kaldırılırsa geçiş sayacı şişer (dedup GERÇEKTEN çalışıyor)', () => {
    _resetPendingActionForTest();
    _resetGrammarDiagnosticsForTest();
    for (let i = 0; i < 8; i++) resolveActiveGrammar(false, NOW);
    // Dedup olmasaydı 8 olurdu.
    expect(getGrammarDiagnostics().transitionCount).toBe(1);
    // Uygulayıcıda anahtar karşılaştırması GERÇEKTEN var.
    expect(stripComments(readSrc(...APPLIER_PATH))).toMatch(/_lastKey !== plan\.key/);
  });

  it('Y3. fallback kaldırılırsa apply-failure yolu çöker (fallback GERÇEKTEN var)', () => {
    const broken: GrammarVocabulary = {
      buildGeneral: () => buildCommandGrammar(),
      buildFor: () => { throw new Error('patladı'); },
    };
    expect(buildGrammarPlan(selectGrammar(ctx({ navigationActive: true })), broken)).toBeNull();
    expect(generalFallbackPlan(broken)).not.toBeNull();
    // Uygulayıcı bu yolda sayacı artırıp genele düşüyor.
    expect(stripComments(readSrc(...APPLIER_PATH)))
      .toMatch(/grammarApplyFailureCount = bump[\s\S]{0,120}generalFallbackPlan\(VOCAB\)/);
  });
});
