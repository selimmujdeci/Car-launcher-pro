/**
 * movingSpeedGate.test.ts — UZAKTAN KOMUTUN SÜRÜŞ GÜVENLİĞİ KAPISI kilitleri.
 *
 * ── KİLİTLENEN ÖLÇÜLEN KUSURLAR ────────────────────────────────────────────
 *  1. (#574, ilk tur) `updateCurrentSpeed` ürün yolunda HİÇ çağrılmıyordu →
 *     kapı kördü. Kapatıldı, ama ikinci bir kusur ortaya çıktı:
 *  2. (bu tur) Kapının hız değişkeni **0 ile başlıyordu** ve **yaşı yoktu**.
 *     Sonuç: (a) ölçüm hiç gelmese bile kapı kendini "araç duruyor" sanıyordu;
 *     (b) OBD koptuktan sonra donmuş son değer sonsuza dek geçerli sayılıyordu —
 *     araç 100 km/h giderken uzaktan "Aç" komutu geçerdi.
 *
 * Bu dosya kapının SAF hüküm fonksiyonunu kilitler: `Date.now` · global durum ·
 * I/O yok, girdiler dışarıdan verilir.
 */

import { describe, it, expect } from 'vitest';
import { judgeMovingGate, type MovingGateVerdict } from '../platform/commandListener';

/** Üründeki değerlerle aynı politika — testin kendi sabitleri YOK. */
const MAX_AGE_MS = 10_000;
const THRESHOLD  = 5;

function judge(speed: number | null, ageMs: number | null, dangerous = true): MovingGateVerdict {
  return judgeMovingGate(dangerous, speed, ageMs, MAX_AGE_MS, THRESHOLD);
}

describe('judgeMovingGate — tehlikeli komut hız kapısı', () => {
  it('tehlikeli OLMAYAN komut kapıya hiç girmez (korna/far hızdan bağımsızdır)', () => {
    expect(judge(200, 0, false)).toBe('ALLOW');
    expect(judge(null, null, false)).toBe('ALLOW');
  });

  it('KİLİT: araç hareket halindeyken tehlikeli komut REDDEDİLİR', () => {
    expect(judge(90, 500)).toBe('BLOCK');
    expect(judge(THRESHOLD + 0.1, 0)).toBe('BLOCK');
  });

  it('ölçülmüş DURUŞ komutu geçirir (0 geçerli bir ölçümdür)', () => {
    expect(judge(0, 0)).toBe('ALLOW');
    expect(judge(THRESHOLD, 1_000)).toBe('ALLOW');
  });

  it('KİLİT: HİÇ ölçüm yoksa "araç duruyor" DENMEZ — hüküm SPEED_UNKNOWN', () => {
    // Eski kusur: değişken 0 ile başlıyordu ve bu sessizce ALLOW üretiyordu.
    expect(judge(null, null)).toBe('SPEED_UNKNOWN');
  });

  it('KİLİT: BAYAT ölçüm hüküm kuramaz (OBD koptu, son değer dondu)', () => {
    // Tam sınırda hâlâ geçerli…
    expect(judge(0, MAX_AGE_MS)).toBe('ALLOW');
    // …bir ms sonrası ölçüm değil, hatıradır.
    expect(judge(0, MAX_AGE_MS + 1)).toBe('SPEED_UNKNOWN');
    // Bayat YÜKSEK hız da hüküm kurmaz — kapı "hâlâ gidiyor" da diyemez.
    expect(judge(120, MAX_AGE_MS + 1)).toBe('SPEED_UNKNOWN');
  });

  it('KİLİT: bozuk sayı ölçüm SAYILMAZ', () => {
    expect(judge(Number.NaN, 0)).toBe('SPEED_UNKNOWN');
    expect(judge(Number.POSITIVE_INFINITY, 0)).toBe('SPEED_UNKNOWN');
  });

  it('BEYAN EDİLEN ÖDÜNÇ: SPEED_UNKNOWN reddetmez — ama ALLOW ile AYNI da değildir', () => {
    /* Kapalı otoparkta (GPS yok · kontak kapalı → OBD yok) aracını uzaktan
       açamamak ürünü kırardı; bu yüzden bilinmeyen hız BLOCK değildir.
       Ama bu kabul KANITSIZDIR ve ayrı bir hüküm olarak döner — çağıran onu
       ayrı sayaçta defterler ve CAROS LAB'da gösterir. İkisi tek değere
       indirgenirse "güvenlik kapısı korudu" yalanı YAPISAL olarak mümkün olur. */
    const unknown = judge(null, null);
    expect(unknown).not.toBe('BLOCK');
    expect(unknown).not.toBe('ALLOW');
    expect(unknown).toBe('SPEED_UNKNOWN');
  });

  it('kapı SAFTIR — aynı girdi her zaman aynı hükmü verir', () => {
    const a = judge(42, 3_000);
    const b = judge(42, 3_000);
    expect(a).toBe(b);
  });
});
