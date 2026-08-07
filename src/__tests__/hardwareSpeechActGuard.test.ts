/**
 * hardwareSpeechActGuard.test.ts — GÖMÜLÜ BAĞLAM KİLİDİ (P0 güvenlik).
 *
 * ── ONARILAN KUSUR (ölçüldü, uydurulmadı) ───────────────────────────────────
 * `matchExplicitCommand` girdinin komuta EŞİT olmasını değil, çok kelimeli komut
 * kalıbının cümle İÇİNDE geçmesini kabul ediyordu. Görev öncesi ölçüm: aşağıdaki
 * gömülü-bağlam corpus'unda **17 cümle** gerçek donanım intent'i üretiyordu —
 * "eve varınca aracı kilitle" → hw_lock_doors · "şu an değil sonra kornaya bas"
 * → hw_honk_horn · "örnek komut: farları aç" → hw_flash_lights.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · Donanım/yıkıcı intent YALNIZ açık · doğrudan · ŞİMDİ istenen emirle üretilir.
 *  · Olumsuzlama · alıntı · aktarma · erteleme · soru → FAİL-CLOSED (NULL).
 *  · Bloklanan cümle bulut semantiğine de gitmez (`needsSemantic === false`) —
 *    aksi hâlde komut ikinci yoldan geri dirilirdi.
 *  · Doğrudan pozitif komutlarda false-negative SIFIRDIR.
 *
 * ⚠️ KABUL ÖLÇÜTÜ: `HARDWARE_FALSE_POSITIVE === 0`. Bu sayı asla gevşetilmez.
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, parseCommandFull, type CommandType } from '../platform/commandParser';
import {
  classifyHardwareSpeechAct,
  isHardwareSpeechActBlocked,
  HARDWARE_SPEECH_ACT_TYPES,
} from '../platform/hardwareSpeechActGuard';

/** Gerçek araca dokunan / geri alınamayan türler — yanlış pozitifi SIFIR olmalı. */
const HARDWARE_TYPES: ReadonlySet<string> = HARDWARE_SPEECH_ACT_TYPES;

const typeOf = (s: string): string | null => parseCommand(s)?.type ?? null;
const isHardware = (s: string): boolean => HARDWARE_TYPES.has(typeOf(s) ?? '');

/* ── A · Doğrudan emirler (false-negative = 0) ─────────────────────────────── */

const POSITIVE_COMMANDS: ReadonlyArray<readonly [string, CommandType]> = [
  ['aracı kilitle',           'hw_lock_doors'],
  ['kapıları kilitle',        'hw_lock_doors'],
  ['kapıların kilidini aç',   'hw_unlock_doors'],
  ['kornaya bas',             'hw_honk_horn'],
  ['kornayı çal',             'hw_honk_horn'],
  ['farları aç',              'hw_flash_lights'],
  ['alarmı devreye al',       'hw_alarm_on'],
  ['alarmı devreden çıkar',   'hw_alarm_off'],
  ['arıza kodlarını sil',     'vehicle_clear_dtc'],
  ['hata kodlarını temizle',  'vehicle_clear_dtc'],
  ['dtc sil',                 'vehicle_clear_dtc'],
];

/* ── B–G · Gömülü bağlam adversarial corpus ───────────────────────────────── */

const NEGATION: readonly string[] = [
  'kapıları kilitle demedim',
  'kapıları kilitleme',
  'kornaya basma',
  'alarmı açma',
  'farları açma',
  'arıza kodlarını silme',
  'kornaya bas demiyorum',
  'farları aç istemiyorum',
  'aracı kilitle ama şimdi yapma',
];

const QUOTATION: readonly string[] = [
  '“aracı kilitle” cümlesini tekrar et',
  'örnek komut: farları aç',
  'aracı kilitle ne demek',
  'bana kornaya bas de',
  '"kapıları kilitle" ifadesini yaz',
  'kornaya bas diye bir komut var',
];

const REPORTED: readonly string[] = [
  'kullanıcı aracı kilitle dedi',
  'eşim kapıları kilitlememi söyledi',
  'az önce kornaya bas dedim',
  'servisçi arıza kodlarını sil demiş',
];

const DEFERRED: readonly string[] = [
  'eve varınca aracı kilitle',
  'sonra kornaya bas',
  'birazdan alarmı aç',
  'yarın arıza kodlarını sil',
  'şu an değil sonra farları aç',
  'eğer yağmur yağarsa farları aç',
  'ben inmeden aracı kilitle',
];

const QUESTIONS: readonly string[] = [
  'kapıları kilitleyebilir misin',
  'farları açabilir misin',
  'alarmı açmak güvenli mi',
  'arıza kodlarını silebilir misin',
  'aracı kilitle ne yapar',
];

const ADVERSARIAL: readonly string[] = [
  'kapıları kilitle demedim ama farları aç',
  'örnek olarak aracı kilitle, sonra devam et',
  'kullanıcı “alarmı aç” dedi ama yapma',
];

const EMBEDDED_CORPUS: readonly string[] = [
  ...NEGATION, ...QUOTATION, ...REPORTED, ...DEFERRED, ...QUESTIONS, ...ADVERSARIAL,
];

describe('P0-PARSER · donanım söz edimi (speech-act) kapısı', () => {
  it('A. doğrudan emirler doğru intent üretir (false negative = 0)', () => {
    const fails: string[] = [];
    for (const [text, expected] of POSITIVE_COMMANDS) {
      const got = typeOf(text);
      if (got !== expected) fails.push(`${JSON.stringify(text)}: bekleniyor=${expected} geldi=${got}`);
    }
    expect(fails).toEqual([]);
  });

  it('B. 🔒 gömülü bağlam corpus\'unda DONANIM yanlış pozitifi SIFIR', () => {
    const falsePositives: string[] = [];
    for (const text of EMBEDDED_CORPUS) {
      const got = typeOf(text);
      if (got !== null && HARDWARE_TYPES.has(got)) falsePositives.push(`${JSON.stringify(text)} -> ${got}`);
    }
    expect(falsePositives).toEqual([]);
  });

  it('C. görev şartnamesindeki beş referans cümle NULL döner (fail-closed)', () => {
    for (const s of [
      'Aracı kilitle demedim.',
      '“Aracı kilitle” cümlesini tekrar et.',
      'Eve varınca aracı kilitle.',
      'Kullanıcı aracı kilitle dedi.',
      'Örnek komut: farları aç.',
    ]) {
      expect(typeOf(s)).toBeNull();
    }
    // Ve pozitif referans bozulmadı
    expect(typeOf('Aracı kilitle.')).toBe('hw_lock_doors');
  });

  it('D. bloklanan cümle bulut semantiğine DEVREDİLMEZ (ikinci yoldan diriliş yok)', () => {
    for (const s of ['eve varınca aracı kilitle', 'kullanıcı aracı kilitle dedi',
                     'kapıları kilitle demedim']) {
      const r = parseCommandFull(s);
      expect(r.command).toBeNull();
      expect(r.needsSemantic).toBe(false);
    }
  });

  it('E. olumsuzlama sınıfı donanım üretmez', () => {
    for (const s of NEGATION) expect(isHardware(s)).toBe(false);
  });

  it('F. alıntı / metalinguistik sınıf donanım üretmez', () => {
    for (const s of QUOTATION) expect(isHardware(s)).toBe(false);
  });

  it('G. aktarılmış konuşma sınıfı donanım üretmez', () => {
    for (const s of REPORTED) expect(isHardware(s)).toBe(false);
  });

  it('H. ertelenmiş / koşullu sınıf donanım üretmez', () => {
    for (const s of DEFERRED) expect(isHardware(s)).toBe(false);
  });

  it('I. soru / yetenek sorgusu sınıfı donanım üretmez', () => {
    for (const s of QUESTIONS) expect(isHardware(s)).toBe(false);
  });

  it('J. karışık / adversarial cümleler donanım üretmez', () => {
    for (const s of ADVERSARIAL) expect(isHardware(s)).toBe(false);
  });
});

describe('P0-PARSER · guard modülü sözleşmesi', () => {
  it('K. sınıflandırma doğru etiketi verir (gözlemlenebilirlik)', () => {
    expect(classifyHardwareSpeechAct('kapıları kilitle demedim').speechClass).toBe('negation');
    expect(classifyHardwareSpeechAct('aracı kilitle cümlesini tekrar et').speechClass).toBe('quotation');
    expect(classifyHardwareSpeechAct('kullanıcı aracı kilitle dedi').speechClass).toBe('reported');
    expect(classifyHardwareSpeechAct('eve varınca aracı kilitle').speechClass).toBe('deferred');
    expect(classifyHardwareSpeechAct('kapıları kilitleyebilir misin').speechClass).toBe('question');
  });

  it('L. doğrudan emirlerde kapı AÇIK (guard tek başına da yanlış kapatmaz)', () => {
    for (const [text] of POSITIVE_COMMANDS) {
      const v = classifyHardwareSpeechAct(text);
      expect(`${text}:${v.blocked}:${v.cue}`).toBe(`${text}:false:`);
    }
  });

  it('M. TEK kesme işareti alıntı SAYILMAZ (Türkçe ek ayracı)', () => {
    expect(isHardwareSpeechActBlocked("Ahmet'i ara")).toBe(false);
    expect(isHardwareSpeechActBlocked('“aracı kilitle”')).toBe(true);
  });

  it('N. fail-soft: boş / geçersiz girdi kapıyı kapatmaz', () => {
    expect(isHardwareSpeechActBlocked('')).toBe(false);
    expect(isHardwareSpeechActBlocked('   ')).toBe(false);
    expect(isHardwareSpeechActBlocked(undefined as unknown as string)).toBe(false);
  });

  it('O. YANLIŞLAMA: kapı gerçekten etkili — tek fark gömülü bağlamdır', () => {
    /* Kapı ölü kod olsaydı bu iki satır AYNI sonucu verirdi. */
    expect(typeOf('aracı kilitle')).toBe('hw_lock_doors');
    expect(typeOf('eve varınca aracı kilitle')).toBeNull();
    expect(typeOf('kornaya bas')).toBe('hw_honk_horn');
    expect(typeOf('şu an değil sonra kornaya bas')).toBeNull();
  });

  it('P. donanım DIŞI intent davranışı değişmedi (kapı kapsamı dar)', () => {
    /* Söz edimi BLOKLU olsa bile donanım dışı tür etkilenmez — kapı yalnız
       `HARDWARE_SPEECH_ACT_TYPES` üzerinde çalışır. */
    expect(isHardwareSpeechActBlocked('eve varınca müziği aç')).toBe(true);
    expect(typeOf('eve varınca müziği aç')).not.toBeNull();
    expect(isHardware('eve varınca müziği aç')).toBe(false);

    expect(typeOf('sonraki şarkı')).toBe('music_next');
    expect(typeOf('önceki şarkı')).toBe('music_prev');
    expect(typeOf('eve git')).toBe('navigate_home');
    expect(typeOf('işe git')).toBe('navigate_work');
    expect(typeOf('müziği aç')).toBe('open_music');
    expect(typeOf('sesi aç')).toBe('volume_up');
    expect(typeOf('haritayı aç')).toBe('open_maps');
  });
});
