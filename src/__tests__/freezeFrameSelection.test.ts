/**
 * OBD-OS-F1-3 — Freeze frame PID seçimi (kanıt-güdümlü genişleme).
 * OBD-OS-F1-5 — J1850 protokol döngüsü.
 *
 * F1-3 SÖZLEŞMESİ:
 *  - Kanıt (desteklenen-PID keşfi) YOKSA → mevcut statik 7'li taban AYNEN (regresyon yok,
 *    kör genişleme yasak: desteklenmeyen her PID ~200 ms NO-DATA bekletir).
 *  - Kanıt VARSA → öncelik listesinden yalnız DESTEKLENENLER, tarama bütçesi tavanıyla kesik.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectFreezeFramePids } from '../platform/dtcService';

const BASE_7 = ['0C', '0D', '05', '04', '0B', '0F', '11'];

describe('OBD-OS-F1-3 — selectFreezeFramePids', () => {
  it('🔒 KİLİT: kanıt YOK (null) → statik 7’li taban AYNEN (fail-soft, regresyonsuz)', () => {
    expect(selectFreezeFramePids(null)).toEqual(BASE_7);
  });

  it('kanıt boş küme → yine taban (kör genişleme yok)', () => {
    expect(selectFreezeFramePids(new Set())).toEqual(BASE_7);
  });

  it('kanıt VAR → desteklenmeyen PID sorulmaz (NO-DATA israfı yok)', () => {
    const supported = new Set(['0C', '0D', '05']);
    const picked = selectFreezeFramePids(supported);
    expect(picked).toEqual(['0C', '0D', '05']);
    expect(picked).not.toContain('04');   // desteklenmiyor → listede YOK
  });

  it('kanıt VAR → taban 7’nin ÖTESİNE genişler (F1-3’ün asıl kazancı)', () => {
    // Zengin araç: taban + trim + MAF + voltaj destekli.
    const supported = new Set([...BASE_7, '06', '07', '10', '42', '2F']);
    const picked = selectFreezeFramePids(supported);
    expect(picked.length).toBeGreaterThan(BASE_7.length);
    expect(picked).toContain('06');   // kısa dönem trim → karışım kanıtı
    expect(picked).toContain('10');   // MAF → hava yolu
    expect(picked).toContain('42');   // ECU voltajı → besleme
  });

  it('BÜTÇE: her şeyi destekleyen araçta bile tavan aşılmaz (tarama süresi patlamasın)', () => {
    const all = new Set(['0C','0D','05','04','0B','0F','11','06','07','08','09','0E','44','10','33','42','2F','43','1F','46','5C','5E']);
    const picked = selectFreezeFramePids(all);
    expect(picked.length).toBeLessThanOrEqual(16);
    // Tavan kesse bile ÇEKİRDEK bağlam (arıza anının devri/hızı) korunmalı — sıra teşhis değeri.
    expect(picked.slice(0, 4)).toEqual(['0C', '0D', '05', '04']);
  });

  it('seçim girdiyi MUTASYONA UĞRATMAZ (saf fonksiyon)', () => {
    const supported = new Set(['0C', '0D']);
    selectFreezeFramePids(supported);
    expect([...supported]).toEqual(['0C', '0D']);
  });
});

describe('OBD-OS-F1-5 — J1850 protokol döngüsü', () => {
  it('🔒 KİLİT: PROTOCOL_CYCLE J1850’yi (ATSP1 PWM / ATSP2 VPW) içerir', () => {
    // 1996-2004 Amerikan araçları (Ford PWM · GM VPW) bu hatları kullanır; döngüde
    // yokken ATSP0 dışında hiçbir aday denenmiyordu → o araçlarda bağlanma şansı yok.
    const src = readFileSync(resolve(process.cwd(), 'src/platform/obdService.ts'), 'utf8');
    const m = src.match(/PROTOCOL_CYCLE:\s*\(string \| undefined\)\[\]\s*=\s*\[([^\]]+)\]/);
    expect(m, 'PROTOCOL_CYCLE tanımı bulunamadı').not.toBeNull();
    const cycle = m![1]!;
    expect(cycle, "J1850 PWM ('1') döngüde yok").toMatch(/'1'/);
    expect(cycle, "J1850 VPW ('2') döngüde yok").toMatch(/'2'/);
    // Mevcut adaylar korunmalı (CAN/KWP/ISO9141 regresyonu yasak).
    for (const p of ['6', '5', '4', '3', '7']) {
      expect(cycle, `mevcut aday '${p}' döngüden düşmüş`).toMatch(new RegExp(`'${p}'`));
    }
    // J1850 en NADİR → sonda olmalı (yaygın aracı geciktirmesin).
    expect(cycle.indexOf("'1'"), "J1850 CAN'den ÖNCE deneniyor — yaygın araç gecikir")
      .toBeGreaterThan(cycle.indexOf("'6'"));
  });
});
