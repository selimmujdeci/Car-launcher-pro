/**
 * protectedWholeInputGate.test.ts — WHOLE-INPUT ALLOWLIST KİLİDİ (P0-4B).
 *
 * ── ÖNCEKİ ÇÖZÜM NEDEN REDDEDİLDİ ───────────────────────────────────────────
 * `hardwareSpeechActGuard` bir KARA LİSTEYDİ; güvenlik regex listesinin
 * eksiksizliğine bağlıydı. Bağımsız denetimde 160 örnekte **36 donanım yanlış
 * pozitifi** üretti: `'aracı kilitle'` (tek tırnak) · `... demiştim` ·
 * `... yazısını göster` · `araç durduğunda ...` · `... iptal` · `... vazgeç`.
 *
 * ── KİLİTLENEN YENİ SÖZLEŞME ────────────────────────────────────────────────
 *  · Korunan intent YALNIZ normalize edilmiş girdinin TAMAMI canonical komutsa
 *    üretilir (+ AÇIK allowlist nezaket ekleri: lütfen · mavi · şimdi).
 *  · Containment (explicit VE scored yol) korunan intent ÜRETEMEZ.
 *  · Kanıt yoksa sonuç NULL'dur; ayrıca `safetyDecision.blocked` ile semantic
 *    yol da kapanır (uçtan uca kilit: hardwareSemanticResurrection.test.ts).
 *  · İfade listesi TEK KAYNAKTAN (`getProtectedCommandCatalog`) gelir —
 *    bu dosya kendi kopyasını TUTMAZ.
 *
 * ⚠️ KABUL ÖLÇÜTÜ: adversarial corpus'ta korunan eylem üretimi = 0 ·
 * production ifade corpus'unda false-negative = 0. Bu sayılar gevşetilmez.
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  parseCommandFull,
  matchProtectedWholeInputCommand,
  getProtectedCommandCatalog,
} from '../platform/commandParser';
import {
  PROTECTED_ACTION_TYPES,
  PROTECTED_VEHICLE_ACTIONS,
  PROTECTED_VIEW_ACTIONS,
  protectedActionClass,
} from '../platform/protectedCommandGate';

const typeOf = (s: string): string | null => parseCommand(s)?.type ?? null;
const isProtected = (s: string): boolean => PROTECTED_ACTION_TYPES.has(typeOf(s) ?? '');

/** Her korunan eylem için TEK temsilci komut (adversarial aileler bunlara uygulanır). */
const REPRESENTATIVES: ReadonlyArray<readonly [string, string]> = [
  ['aracı kilitle',          'hw_lock_doors'],
  ['kapıların kilidini aç',  'hw_unlock_doors'],
  ['kornaya bas',            'hw_honk_horn'],
  ['farları yak',            'hw_flash_lights'],
  ['alarmı devreye al',      'hw_alarm_on'],
  ['alarmı devreden çıkar',  'hw_alarm_off'],
  ['arıza kodlarını sil',    'vehicle_clear_dtc'],
  ['ışıkları kapat',         'hw_lights_off'],
  ['arka kamerayı aç',       'hw_rear_camera'],
  ['ekranı kapat',           'hw_screen_off'],
];

/** Bağımsız denetimden gelen sistematik bypass aileleri (12 kalıp). */
const ADVERSARIAL_FAMILIES: ReadonlyArray<(c: string) => string> = [
  (c) => `'${c}'`,
  (c) => `${c} demiştim`,
  (c) => `${c} yazısını göster`,
  (c) => `araç durduğunda ${c}`,
  (c) => `${c} iptal`,
  (c) => `${c} vazgeç`,
  (c) => `${c} diye yaz`,
  (c) => `${c} sözünü sil`,
  (c) => `${c} olduğunu söyle`,
  (c) => `${c} komutunu göster`,
  (c) => `${c} desem ne olur`,
  (c) => `${c} dersen ne olur`,
];

/** 12 aile × 10 temsilci = 120 + aşağıdaki 44 elle yazılmış = 164 örnek. */
const EXTRA_ADVERSARIAL: readonly string[] = [
  '“aracı kilitle”', '«kornaya bas»', '‘farları yak’',
  'eve varınca aracı kilitle', 'şu an değil sonra kornaya bas',
  'kapıları kilitle demedim', 'kullanıcı aracı kilitle dedi',
  'eşim kapıları kilitlememi söyledi', 'az önce kornaya bas dedim',
  'örnek komut: farları aç', 'aracı kilitle ne demek',
  'bana kornaya bas de', 'kornaya bas diye bir komut var',
  'yarın arıza kodlarını sil', 'birazdan alarmı aç',
  'eğer yağmur yağarsa farları aç', 'ben inmeden aracı kilitle',
  'kapıları kilitleyebilir misin', 'farları açabilir misin',
  'alarmı açmak güvenli mi', 'arıza kodlarını silebilir misin',
  'aracı kilitle ne yapar', 'kapıları kilitle demedim ama farları aç',
  'örnek olarak aracı kilitle, sonra devam et',
  'kullanıcı “alarmı aç” dedi ama yapma',
  'aracı kilitle dedim ama vazgeçtim', 'aracı kilitle komutu nedir',
  'servisçi arıza kodlarını sil demiş', 'aracı kilitle tuşuna bastım',
  'aracı kilitle sonra müziği aç', 'önce farları yak sonra dur',
  'aracı kilitle mi demek istedin', 'aracı kilitle demek istemedim',
  'aracı kilitle yazdım', 'aracı kilitle diye duydum',
  'aracı kilitle cümlesini çevir', 'aracı kilitle örneğini ver',
  'aracı kilitle ifadesini tekrarla', 'aracı kilitle şakaydı',
  'aracı kilitle demeyi unutma', 'aracı kilitle desem kilitlenir mi',
  'arka kamerayı aç demiştim', 'ekranı kapat diye yazdım',
  'ışıkları kapat sözünü geri alıyorum',
];

const ADVERSARIAL_CORPUS: readonly string[] = [
  ...REPRESENTATIVES.flatMap(([cmd]) => ADVERSARIAL_FAMILIES.map((f) => f(cmd))),
  ...EXTRA_ADVERSARIAL,
];

describe('P0-4B · korunan eylem WHOLE-INPUT kapısı', () => {
  it('0. corpus gerçekten 160+ örnek içeriyor (kabul ölçütü ölçeği)', () => {
    expect(ADVERSARIAL_CORPUS.length).toBeGreaterThanOrEqual(160);
  });

  it('1. 🔒 adversarial corpus\'ta KORUNAN eylem üretimi SIFIR', () => {
    const falsePositives: string[] = [];
    for (const text of ADVERSARIAL_CORPUS) {
      const got = typeOf(text);
      if (got !== null && PROTECTED_ACTION_TYPES.has(got)) falsePositives.push(`${JSON.stringify(text)} -> ${got}`);
    }
    expect(falsePositives).toEqual([]);
  });

  it('2. 🔒 gömülü bağlamda parser AÇIKÇA blocked kararı taşır', () => {
    const missing: string[] = [];
    for (const text of ADVERSARIAL_CORPUS) {
      const d = parseCommandFull(text).safetyDecision;
      if (!d?.blocked) missing.push(text);
    }
    expect(missing).toEqual([]);
  });

  it('3. tırnak içindeki komut ZİKİRDİR — kullanım değil', () => {
    for (const q of ["'aracı kilitle'", '"aracı kilitle"', '“aracı kilitle”', '‘kornaya bas’']) {
      const r = parseCommandFull(q);
      expect(r.command).toBeNull();
      expect(r.safetyDecision?.reason).toBe('quoted');
    }
    // Tek kesme işareti Türkçe ek ayracıdır; korunan eylem değil → etkilenmez.
    expect(parseCommandFull("Ahmet'i ara").safetyDecision).toBeUndefined();
  });

  it('4. POZİTİF: temsilci komutlar doğrudan çalışır (false-negative 0)', () => {
    for (const [text, expected] of REPRESENTATIVES) {
      expect(`${text}->${typeOf(text)}`).toBe(`${text}->${expected}`);
    }
  });

  it('5. POZİTİF: yalnız AÇIK allowlist nezaket ekleri kabul edilir', () => {
    for (const [text, expected] of REPRESENTATIVES) {
      expect(typeOf(`lütfen ${text}`)).toBe(expected);
      expect(typeOf(`mavi ${text}`)).toBe(expected);
      expect(typeOf(`mavi lütfen ${text}`)).toBe(expected);
      expect(typeOf(`şimdi ${text}`)).toBe(expected);
      expect(typeOf(`${text} lütfen`)).toBe(expected);
    }
  });

  it('6. allowlist DIŞI önekler korunan eylem üretmez (genel tolerans yok)', () => {
    for (const s of ['hadi aracı kilitle', 'acil aracı kilitle', 'çabuk kornaya bas',
                     'bence aracı kilitle', 'sanırım farları yak']) {
      expect(isProtected(s)).toBe(false);
    }
  });

  it('7. matchKind ve canonical ifade dürüst raporlanır', () => {
    const exact = matchProtectedWholeInputCommand('aracı kilitle');
    expect(exact.matched).toBe(true);
    expect(exact.matchKind).toBe('exact');
    expect(exact.canonicalPhrase).toBe('araci kilitle');
    expect(exact.actionClass).toBe('vehicle');

    const pre = matchProtectedWholeInputCommand('lütfen aracı kilitle');
    expect(pre.matchKind).toBe('safe_prefix');

    const suf = matchProtectedWholeInputCommand('aracı kilitle lütfen');
    expect(suf.matchKind).toBe('safe_suffix');

    const blk = matchProtectedWholeInputCommand('eve varınca aracı kilitle');
    expect(blk.matched).toBe(false);
    expect(blk.blockedReason).toBe('not_whole_input');
    expect(blk.mentionedActionType).toBe('hw_lock_doors');

    // Korunan eylemle ilgisi olmayan girdi: karar YOK (genel parser bozulmaz).
    expect(matchProtectedWholeInputCommand('müziği aç').blockedReason).toBeUndefined();
  });

  it('8. UI eylemleri AYRI sınıfta ama containment\'a karşı aynı korumada', () => {
    expect(protectedActionClass('hw_rear_camera')).toBe('view');
    expect(protectedActionClass('hw_screen_off')).toBe('view');
    expect(protectedActionClass('hw_lock_doors')).toBe('vehicle');
    expect(PROTECTED_VEHICLE_ACTIONS.size).toBe(8);
    expect(PROTECTED_VIEW_ACTIONS.size).toBe(2);
    expect(typeOf('arka kamerayı aç demiştim')).toBeNull();
    expect(typeOf('arka kamerayı aç')).toBe('hw_rear_camera');
  });

  it('9. tek kelimelik korunan kalıp ASLA komut değildir', () => {
    for (const w of ['kilitle', 'korna', 'far', 'alarm', 'unlock', 'lock', 'flash', 'bip']) {
      expect(isProtected(w)).toBe(false);
    }
  });
});

/* ── GÖREV 5 · PRODUCTION PHRASE REGRESYONU ───────────────────────────────── */

describe('P0-4B · production korunan ifade corpus (tek kaynak)', () => {
  const catalog = getProtectedCommandCatalog();

  it('10. katalog üretim kalıplarından türetilmiş ve boş değil', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(60);
    for (const e of catalog) {
      expect(e.phrase.includes(' ')).toBe(true);            // yalnız çok kelimeli
      expect(PROTECTED_ACTION_TYPES.has(e.actionType)).toBe(true);
      expect(e.phrase).toBe(e.phrase.toLowerCase().trim());  // normalize edilmiş
    }
  });

  it('11. hiçbir canonical ifade kesme/tırnak işareti taşımaz (quoted kuralı güvenli)', () => {
    const withQuote = catalog.filter((e) => /["'«»“”‘’`´]/.test(e.phrase));
    expect(withQuote).toEqual([]);
  });

  it('12. 🔒 TÜM production korunan ifadeleri doğru intent üretir (FN = 0)', () => {
    const fails: string[] = [];
    for (const e of catalog) {
      const got = typeOf(e.phrase);
      if (got !== e.actionType) fails.push(`${JSON.stringify(e.phrase)}: bekleniyor=${e.actionType} geldi=${got}`);
    }
    expect(fails).toEqual([]);
  });

  it('13. ifade çakışmaları deterministik ve BELGELİ', () => {
    /* Aynı ifade iki korunan türde varsa katalog sırası (PATTERNS sırası) karar
       verir. Bugün çakışma YOKTUR; çıkarsa bu kilit onu görünür kılar. */
    const byPhrase = new Map<string, string[]>();
    for (const e of catalog) {
      const list = byPhrase.get(e.phrase) ?? [];
      if (!list.includes(e.actionType)) list.push(e.actionType);
      byPhrase.set(e.phrase, list);
    }
    const conflicts = [...byPhrase.entries()]
      .filter(([, types]) => types.length > 1)
      .map(([phrase, types]) => `${phrase} → ${types.join(' | ')}`);
    expect(conflicts).toEqual([]);
  });

  it('14. denetimde bildirilen DÖRT bozuk ifade onarıldı', () => {
    /* 1-2: "selam ver" / "kornasız selam" GERÇEK ürün komutudur (far ile selam
       verme deyimi, hw_flash_lights kalıp listesinde). Eskiden `stripFiller`
       'selam'ı dolgu sayıp siliyor ve ifade tek kelimeye düşüp NULL oluyordu;
       whole-input eşitliği dolgu filtresine bağlı DEĞİLDİR → artık çalışır. */
    expect(typeOf('selam ver')).toBe('hw_flash_lights');
    expect(typeOf('kornasız selam')).toBe('hw_flash_lights');
    /* 3: geri görüş kamerası artık genel kamera yolundan ÖNCE karar verir. */
    expect(typeOf('arka kamerayı aç')).toBe('hw_rear_camera');
    /* 4: "reverse kamera" NULL dönüyordu — söz edimi kara listesindeki
       `-se/-sa` koşul kuralı "reverse"ü yakalıyordu. Kara liste artık kabul
       otoritesi DEĞİL (allowlist-first) → ifade geri kazanıldı. */
    expect(typeOf('reverse kamera')).toBe('hw_rear_camera');
  });
});

/* ── GÖREV 3 · CONTAINMENT YOLLARI KAPALI ─────────────────────────────────── */

describe('P0-4B · containment yolları korunan intent üretemez', () => {
  it('15. YANLIŞLAMA: kapı kaldırılsa AYNI olurdu — tek fark whole-input', () => {
    expect(typeOf('aracı kilitle')).toBe('hw_lock_doors');       // TAM girdi
    expect(typeOf('aracı kilitle demiştim')).toBeNull();          // gömülü
    expect(typeOf('kornaya bas')).toBe('hw_honk_horn');
    expect(typeOf('araç durduğunda kornaya bas')).toBeNull();
  });

  it('16. scored yol (token/fuzzy/containment) korunan intent üretmez', () => {
    /* Bu girdiler korunan ifadeyi ZİKRETMEZ → kapı devreye girmez; skorlayıcı
       tek başına kalır. Yine de korunan tür ÜRETEMEZ (scorePattern erken 0). */
    for (const s of ['kapı kolu kırılmış', 'korna sesi duyuldu', 'farlar çok parlak',
                     'alarm kurdum sabah için', 'camı sildim', 'ekran çok parlak',
                     'kilit bozuk olabilir', 'ışık gözümü aldı']) {
      expect(isProtected(s)).toBe(false);
    }
  });

  it('17. korunan olmayan intent davranışı DEĞİŞMEDİ', () => {
    expect(typeOf('müziği aç')).toBe('open_music');
    expect(typeOf('sonraki şarkı')).toBe('music_next');
    expect(typeOf('önceki şarkı')).toBe('music_prev');
    expect(typeOf('eve git')).toBe('navigate_home');
    expect(typeOf('işe git')).toBe('navigate_work');
    expect(typeOf('haritayı aç')).toBe('open_maps');
    expect(typeOf('sesi aç')).toBe('volume_up');
    expect(typeOf('telefonu aç')).toBe('open_phone');
    expect(typeOf('kamerayı aç')).toBe('open_camera');
    // Korunan eylemle ilgisi olmayan girdilerde güvenlik alanı hiç üretilmez.
    expect(parseCommandFull('müziği aç').safetyDecision).toBeUndefined();
    expect(parseCommandFull('bana motor sıcaklığını açıkla').safetyDecision).toBeUndefined();
  });
});
