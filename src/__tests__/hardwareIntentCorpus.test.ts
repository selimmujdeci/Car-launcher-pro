/**
 * hardwareIntentCorpus.test.ts — UNKNOWN-FIRST · AÇIK KOMUT KİLİDİ (P0 güvenlik).
 *
 * ── ONARILAN KUSUR (ölçüldü, uydurulmadı) ───────────────────────────────────
 * Görev öncesi bu corpus'un 75 komut-OLMAYAN cümlesinden **48'i** gerçek donanım
 * intent'i üretiyordu (%64): "korna sesi duyuldu" → korna çal · "kaplumbağa
 * kapıyı izledi" → kapıları kilitle · "camı sildim" → arıza kaydı sil.
 * Üç mekanizma: (1) `reverseHit` prefix kuralı tek kelimeye 1.00 veriyordu
 * ("far" ⊂ "farklı şarkı çal"), (2) donanım kalıplarında tek kelimelik
 * keyword/token, (3) Tier-2 token + Tier-3 fuzzy'nin donanıma da uygulanması.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · Donanım/yıkıcı intent YALNIZ çok kelimeli, TAM İFADE komutla üretilir.
 *  · Tek kelime · prefix · token · fuzzy bu türlerde ASLA intent üretmez.
 *  · Kelime sınırı iki yönlüdür → olumsuz ("kilitleme") ve geçmiş zaman
 *    ("kilitledim") biçimleri eşleşmez.
 *  · Kanıt yoksa sonuç NULL'dur — en yakın tahmine düşülmez.
 *
 * ⚠️ KABUL ÖLÇÜTÜ: `HARDWARE_FALSE_POSITIVE === 0`. Bu sayı asla gevşetilmez.
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, type CommandType } from '../platform/commandParser';

/** Gerçek araca dokunan / yıkıcı türler — yanlış pozitifi SIFIR olmalı. */
const HARDWARE_TYPES: ReadonlySet<string> = new Set<string>([
  'hw_honk_horn', 'hw_lock_doors', 'hw_unlock_doors', 'hw_flash_lights',
  'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
  'vehicle_clear_dtc',
]);

/**
 * Deterministik falsification corpus — LLM YOK, rastgelelik YOK.
 * Kategoriler: A açık donanım komutu · B medya/navigasyon regresyonu ·
 * C donanım kelimeli komut-DEĞİL · D telefon · E medya kelimeli · F navigasyon
 * kelimeli · G çocuk cümlesi · H anlamsız nesne-fiil · I yarım cümle ·
 * J Türkçe karaktersiz · K olumsuz · L geçmiş zaman · M soru · O kapatma.
 */
const CORPUS: ReadonlyArray<readonly [string, CommandType | null, string]> = [
  ['kornaya bas','hw_honk_horn','A'],['kornayı çal','hw_honk_horn','A'],['korna çal','hw_honk_horn','A'],
  ['kapıları kilitle','hw_lock_doors','A'],['arabayı kilitle','hw_lock_doors','A'],['kapıyı kilitle','hw_lock_doors','A'],
  ['kapıların kilidini aç','hw_unlock_doors','A'],['arabayı aç','hw_unlock_doors','A'],['kapıları aç','hw_unlock_doors','A'],
  ['farları yak','hw_flash_lights','A'],['farları aç','hw_flash_lights','A'],['farları yakıp söndür','hw_flash_lights','A'],
  ['ışıkları yak','hw_flash_lights','A'],
  ['alarmı aç','hw_alarm_on','A'],['alarmı devreye al','hw_alarm_on','A'],['alarmı aktif et','hw_alarm_on','A'],
  ['alarmı kapat','hw_alarm_off','A'],['alarmı devreden çıkar','hw_alarm_off','A'],['alarmı durdur','hw_alarm_off','A'],
  ['arıza kodlarını sil','vehicle_clear_dtc','A'],['hata kodlarını temizle','vehicle_clear_dtc','A'],['hataları sil','vehicle_clear_dtc','A'],
  ['telefonu aç','open_phone','A'],['rehberi aç','open_phone','A'],
  ['kamerayı aç','open_camera','A'],
  /* 🔄 KİLİT GÜNCELLENDİ (P0-4B, bilinçli davranış değişikliği — kaldırılmadı):
     "arka kamerayı aç" ifadesi HEM `open_camera` HEM `hw_rear_camera` keyword'ü.
     Eski containment sırası `open_camera`ı (telefon kamerası uygulaması) seçiyordu —
     kullanıcının istediği GERİ GÖRÜŞ kamerasıydı. Korunan eylem kapısı artık genel
     kamera yolundan ÖNCE çalıştığı için doğru intent üretiliyor. */
  ['arka kamerayı aç','hw_rear_camera','A'],
  ['kapilari kilitle','hw_lock_doors','J'],['farlari yak','hw_flash_lights','J'],['alarmi ac','hw_alarm_on','J'],
  ['kapiyi kilitle','hw_lock_doors','J'],
  ['sonraki şarkı','music_next','B'],['önceki şarkı','music_prev','B'],['müziği aç','open_music','B'],
  ['müzik çal','open_music','B'],['işe git','navigate_work','B'],['eve git','navigate_home','B'],['sesi aç','volume_up','B'],
  ['korna',null,'C'],['korna sesi duydum',null,'C'],['korna sesi duyuldu',null,'C'],['çocuk kornadan korktu',null,'C'],
  ['kornanın sesi çok yüksek',null,'C'],['kapı',null,'C'],['kapi',null,'C'],['kapı açık mı bilmiyorum',null,'C'],
  ['kapının rengi güzel',null,'C'],['kaplumbağa kapıyı izledi',null,'C'],['kilit bozuk olabilir',null,'C'],
  ['kapı kolu kırılmış',null,'C'],['far',null,'C'],['farlar çok parlak',null,'C'],['ışık gözümü aldı',null,'C'],
  ['ışık',null,'C'],['farın camı çatlamış',null,'C'],['alarm',null,'C'],['alarm sesi duydum',null,'C'],
  ['alarm kelimesini yaz',null,'C'],['alarm kurdum sabah için',null,'C'],['cam',null,'C'],['camı sildim',null,'C'],
  ['cam çok kirli',null,'C'],['camlar buğulanmış',null,'C'],['sil',null,'C'],['silgi masada',null,'C'],
  ['duvarı sil',null,'C'],['hata kodları ne demek',null,'C'],['kodları anlamıyorum',null,'C'],['kilitle',null,'C'],
  ['telefon',null,'D'],['telefonumun şarjı bitti',null,'D'],['telefon masada',null,'D'],['birini aramak zor',null,'D'],
  ['telefon rehberi kalabalık',null,'D'],
  ['müzik çalıyor',null,'E'],['çal',null,'E'],['çal kelimesinin anlamı nedir',null,'E'],['şarkı sözleri güzel',null,'E'],
  ['iş yerine çalı aldım',null,'F'],['işten geldim',null,'F'],['ofis çok uzak',null,'F'],
  ['anne korna sesi geldi',null,'G'],['araba far yaktı mı',null,'G'],['kaplumbağa camı izledi',null,'G'],
  ['masayı kilitle',null,'H'],['camı kilitle',null,'H'],['kapıyı boyadım',null,'H'],['duvarı yak',null,'H'],
  ['kapıları',null,'I'],['farları',null,'I'],['alarmı',null,'I'],['kornayı',null,'I'],['kilidi',null,'I'],
  ['kapıları kilitleme',null,'K'],['farları yakma',null,'K'],['alarmı açma',null,'K'],['kornaya basma',null,'K'],
  ['kapıları açma',null,'K'],
  ['kapıları kilitledim',null,'L'],['farları yaktım',null,'L'],['kornaya bastım',null,'L'],['alarmı kapattım',null,'L'],
  ['arıza kodlarını sildim',null,'L'],
  ['kapılar kilitli mi',null,'M'],['farlar açık mı',null,'M'],['alarm çalışıyor mu',null,'M'],['korna çalıyor mu',null,'M'],
  ['kamera çalışıyor mu',null,'M'],
  ['iptal',null,'O'],['vazgeç',null,'O'],
  ['kilidi bozuldu',null,'C'],['kornaya bakma',null,'K'],['telefonu düşürdüm',null,'D'],
];

describe('P0-PARSER · unknown-first donanım corpus', () => {
  it('1. AÇIK komutlar doğru intent üretir (false negative = 0)', () => {
    const fails: string[] = [];
    for (const [text, expected] of CORPUS) {
      if (expected === null) continue;
      const got = parseCommand(text)?.type ?? null;
      if (got !== expected) fails.push(`${JSON.stringify(text)}: bekleniyor=${expected} geldi=${got}`);
    }
    expect(fails).toEqual([]);
  });

  it('2. 🔒 komut OLMAYAN cümlelerde DONANIM yanlış pozitifi SIFIR', () => {
    const hwFalsePositives: string[] = [];
    for (const [text, expected] of CORPUS) {
      if (expected !== null) continue;
      const got = parseCommand(text)?.type ?? null;
      if (got !== null && HARDWARE_TYPES.has(got)) hwFalsePositives.push(`${JSON.stringify(text)} -> ${got}`);
    }
    expect(hwFalsePositives).toEqual([]);
  });

  it('3. tek kelimelik riskli token HİÇBİR donanım komutu üretmez', () => {
    for (const w of ['korna', 'kapı', 'kapi', 'far', 'farlar', 'ışık', 'isik',
                     'alarm', 'cam', 'sil', 'çal', 'kilit', 'telefon', 'ara']) {
      const got = parseCommand(w)?.type ?? null;
      expect(HARDWARE_TYPES.has(got ?? '')).toBe(false);
    }
  });

  it('4. çapraz-intent token gaspı kapandı (ölçülen dört vaka)', () => {
    expect(parseCommand('far')?.type ?? null).not.toBe('music_next');
    expect(parseCommand('çal')?.type ?? null).not.toBe('navigate_work');
    expect(parseCommand('cam')?.type ?? null).not.toBe('open_camera');
    expect(parseCommand('camı sildim')?.type ?? null).not.toBe('vehicle_clear_dtc');
  });

  it('5. medya/navigasyon regresyonu YOK', () => {
    expect(parseCommand('sonraki şarkı')?.type).toBe('music_next');
    expect(parseCommand('önceki şarkı')?.type).toBe('music_prev');
    expect(parseCommand('işe git')?.type).toBe('navigate_work');
    expect(parseCommand('eve git')?.type).toBe('navigate_home');
  });

  it('6. olumsuz ve geçmiş zaman biçimleri komut ÜRETMEZ (kelime sınırı)', () => {
    for (const s of ['kapıları kilitleme', 'farları yakma', 'kornaya basma',
                     'kapıları kilitledim', 'farları yaktım', 'kornaya bastım']) {
      const got = parseCommand(s)?.type ?? null;
      expect(HARDWARE_TYPES.has(got ?? '')).toBe(false);
    }
  });

  it('7. YANLIŞLAMA: açık komut kapısı gerçekten etkili', () => {
    /* Kapı kaldırılsaydı bu iki satır AYNI sonucu verirdi — fark, kuralın
       ölü kod olmadığının kanıtıdır. */
    expect(parseCommand('kapıları kilitle')?.type).toBe('hw_lock_doors');   // TAM ifade
    expect(parseCommand('kapı')?.type ?? null).not.toBe('hw_lock_doors');   // tek kelime
    expect(parseCommand('korna çal')?.type).toBe('hw_honk_horn');
    expect(parseCommand('korna sesi duyuldu')?.type ?? null).not.toBe('hw_honk_horn');
  });
});
