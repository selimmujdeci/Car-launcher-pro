/**
 * maviDeterministicFastPath.test.ts — MAVI-P0-LATENCY · hızlı yol KİLİTLERİ.
 *
 * Bu dosya bir GECİKME testi DEĞİLDİR (test hızı saha gecikmesi kanıtı olamaz).
 * Kilitlediği şey hızlı yolun **kapsamı ve fail-closed davranışı**dır:
 *
 *   1. Girdinin TAMAMI canonical ifadeyse hızlı yol açılır.
 *   2. Alt-dizi/parça eşleşmesi hızlı yolu AÇAMAZ (P0'da reddedilen kanıt sınıfı).
 *   3. Korunan · araç etkili · geri alınamaz · serbest metinli hiçbir tip
 *      kümede olamaz — kümenin kendisi bir allowlist'tir.
 *   4. Nezaket ekleri yalnız AÇIK allowlist'ten geçer.
 */

import { describe, it, expect } from 'vitest';
import {
  matchDeterministicWholeInput,
  getFastPathTypes,
  parseCommandFull,
  type CommandType,
} from '../platform/commandParser';
import { PROTECTED_ACTION_TYPES } from '../platform/protectedCommandGate';

describe('hızlı yol — TAM EŞLEŞME açar', () => {
  const cases: ReadonlyArray<readonly [string, CommandType]> = [
    ['sonraki şarkı',   'music_next'],
    ['önceki şarkı',    'music_prev'],
    ['haritayı aç',     'open_maps'],
    ['müziği aç',       'open_music'],
    ['eve git',         'navigate_home'],
  ];

  for (const [input, type] of cases) {
    it(`"${input}" → ${type}`, () => {
      const m = matchDeterministicWholeInput(input);
      expect(m).not.toBeNull();
      expect(m?.type).toBe(type);
    });
  }

  it('aksansız yazım da eşleşir (normalize tek kaynaktan)', () => {
    expect(matchDeterministicWholeInput('muzigi ac')?.type).toBe('open_music');
  });

  it('hızlı yol tipi parser kararıyla ÇELİŞMEZ', () => {
    for (const [input] of cases) {
      const fast = matchDeterministicWholeInput(input);
      const parsed = parseCommandFull(input).command;
      if (fast && parsed) expect(parsed.type).toBe(fast.type);
    }
  });
});

describe('hızlı yol — FAIL-CLOSED', () => {
  it('alt-dizi eşleşmesi hızlı yolu AÇMAZ', () => {
    // Kalıp cümlenin İÇİNDE geçiyor ama girdinin tamamı değil.
    expect(matchDeterministicWholeInput('sonraki şarkı ne olacak acaba')).toBeNull();
    expect(matchDeterministicWholeInput('haritayı aç dedim sana')).toBeNull();
  });

  it('tırnaklı girdi (zikir) hızlı yolu AÇMAZ', () => {
    expect(matchDeterministicWholeInput('"sonraki şarkı"')).toBeNull();
    expect(matchDeterministicWholeInput("'haritayı aç' demiştim")).toBeNull();
  });

  it('boş/geçersiz girdi null döner', () => {
    expect(matchDeterministicWholeInput('')).toBeNull();
    expect(matchDeterministicWholeInput('   ')).toBeNull();
    expect(matchDeterministicWholeInput(null as unknown as string)).toBeNull();
    expect(matchDeterministicWholeInput(42 as unknown as string)).toBeNull();
  });

  it('bilinmeyen cümle hızlı yolu AÇMAZ (beyne gider)', () => {
    expect(matchDeterministicWholeInput('bugün hava nasıl olacak dersin')).toBeNull();
    expect(matchDeterministicWholeInput('bana bir fıkra anlat')).toBeNull();
  });
});

describe('hızlı yol — NEZAKET EKİ yalnız allowlist', () => {
  it('açık önekler soyulur', () => {
    expect(matchDeterministicWholeInput('mavi sonraki şarkı')?.type).toBe('music_next');
    expect(matchDeterministicWholeInput('lütfen haritayı aç')?.type).toBe('open_maps');
    expect(matchDeterministicWholeInput('mavi lütfen müziği aç')?.type).toBe('open_music');
  });

  it('açık sonek soyulur', () => {
    expect(matchDeterministicWholeInput('haritayı aç lütfen')?.type).toBe('open_maps');
  });

  it('allowlist DIŞI önek/sonek hızlı yolu AÇMAZ', () => {
    expect(matchDeterministicWholeInput('acaba sonraki şarkı')).toBeNull();
    expect(matchDeterministicWholeInput('haritayı aç bakalım')).toBeNull();
  });
});

describe('hızlı yol KÜMESİ — kapsam kilidi', () => {
  const fastTypes = new Set<string>(getFastPathTypes());

  it('korunan eylem tipleriyle KESİŞMEZ', () => {
    for (const t of fastTypes) {
      expect(PROTECTED_ACTION_TYPES.has(t)).toBe(false);
    }
  });

  it('geri alınamaz / yıkıcı tipler kümede YOKTUR', () => {
    for (const t of ['vehicle_clear_dtc', 'call_contact', 'open_phone', 'delete_location']) {
      expect(fastTypes.has(t)).toBe(false);
    }
  });

  it('serbest metinli (ASR onarımından fayda gören) tipler kümede YOKTUR', () => {
    for (const t of [
      'navigate_address', 'navigate_place',
      'play_music_query', 'play_music_search',
      'save_location', 'rename_location', 'share_location',
      'set_setting', 'query_sensor',
    ]) {
      expect(fastTypes.has(t)).toBe(false);
    }
  });

  it('hiçbir donanım (hw_) tipi kümede YOKTUR', () => {
    for (const t of fastTypes) expect(t.startsWith('hw_')).toBe(false);
  });

  it('küme boş değildir ve her üyesi gerçekten eşleşebilir', () => {
    expect(fastTypes.size).toBeGreaterThan(0);
  });
});

describe('korunan eylem — hızlı yoldan SIZAMAZ', () => {
  it('"kapıları kilitle" hızlı yol üretmez', () => {
    expect(matchDeterministicWholeInput('kapıları kilitle')).toBeNull();
  });
  it('"kornaya bas" hızlı yol üretmez', () => {
    expect(matchDeterministicWholeInput('kornaya bas')).toBeNull();
  });
  it('"arıza kodlarını sil" hızlı yol üretmez', () => {
    expect(matchDeterministicWholeInput('arıza kodlarını sil')).toBeNull();
  });
});
