/**
 * P0-NAV-15 — MANEVRA / DÖNÜŞ YÖNLENDİRME BÜTÜNLÜĞÜ (KİLİT).
 *
 * ── ÖLÇÜLEN KUSUR (2026-08-24, koddan) ────────────────────────────────────
 * `routingService.toTR()` tek çeviri otoritesiydi ve `depart` · `arrive` ·
 * `roundabout` · `rotary` · `end of road` · `uturn` tiplerini DOĞRU ele
 * alıyordu. Ama tip listesi EKSİKTİ ve eksik tipler sessizce DEĞİŞTİRİCİYE
 * düşüyordu. Ölçüm: **`merge` · `fork` · `on ramp` · `off ramp` ürün kodunun
 * HİÇBİR YERİNDE geçmiyordu** — OSRM bunları ÜRETİR:
 *
 *   · `merge`    + `right` → **"Sağa dönün"**   (oysa şerit birleştirme)
 *   · `fork`     + `left`  → **"Sola dönün"**   (oysa taraf seçme)
 *   · `off ramp` + `right` → **"Sağa dönün"**   (oysa otoyol çıkışı)
 *
 * 120 km/h'te otoyolda sürücüye var olmayan bir kavşak aratmak yalnız yanlış
 * değil TEHLİKELİDİR ve kullanıcının *"dönemeç olmayan yerde sola dönün
 * diyor"* şikâyetiyle AYNI sınıftır.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect } from 'vitest';

import {
  classifyManeuver,
  maneuverInstructionTr,
  maneuverToTr,
} from '../platform/navigation/core/maneuverSemanticsModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) MEVCUT DOĞRU ÇIKTILAR BİREBİR KORUNUYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-15 › mevcut çıktılar korunuyor', () => {
  it('temel dönüşler eskisiyle AYNI cümleyi üretir', () => {
    const cases: ReadonlyArray<readonly [string, string, string, string]> = [
      ['turn', 'right',        'Atatürk Cd', 'Sağa dönün (Atatürk Cd)'],
      ['turn', 'left',         'İnönü Cd',   'Sola dönün (İnönü Cd)'],
      ['turn', 'sharp right',  '',           'Sert sağa dönün'],
      ['turn', 'sharp left',   '',           'Sert sola dönün'],
      ['turn', 'slight right', '',           'Hafif sağa dönün'],
      ['turn', 'slight left',  '',           'Hafif sola dönün'],
      ['turn', 'straight',     '',           'Düz devam edin'],
    ];
    for (const [t, m, n, want] of cases) {
      expect(maneuverToTr(t, m, n), `${t}/${m}`).toBe(want);
    }
  });

  it('kalkış · varış · yol sonu · U dönüşü aynı', () => {
    expect(maneuverToTr('depart', 'straight', 'Bağlar Cd')).toBe('Yola çıkın (Bağlar Cd)');
    expect(maneuverToTr('arrive', 'straight', 'X')).toBe('Hedefinize ulaştınız');
    expect(maneuverToTr('end of road', 'left', '')).toBe('Yol sonunda dönün');
    expect(maneuverToTr('turn', 'uturn', 'X')).toBe('U dönüşü yapın');
  });

  it('dönel kavşak: sayı VARSA söylenir, YOKSA uydurulmaz', () => {
    expect(maneuverToTr('roundabout', 'right', '', 2))
      .toBe('Dönel kavşakta ikinci çıkıştan ayrılın');
    expect(maneuverToTr('roundabout', 'right', '', null))
      .toBe('Dönel kavşakta devam edin');
    expect(maneuverToTr('roundabout', 'right', '', undefined))
      .toBe('Dönel kavşakta devam edin');
    /* Sözlükte olmayan çıkış numarası da UYDURULMAZ. */
    expect(maneuverToTr('rotary', 'right', '', 99))
      .toBe('Dönel kavşakta devam edin');
    expect(maneuverToTr('exit roundabout', 'right', 'D400'))
      .toBe('Dönel kavşaktan çıkın (D400)');
  });

  it('U dönüşü HER tipin üstünde önceliklidir', () => {
    /* Geriye dönmek her bağlamda U dönüşüdür. */
    for (const t of ['turn', 'continue', 'end of road', 'fork']) {
      expect(maneuverToTr(t, 'uturn', ''), t).toBe('U dönüşü yapın');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) DÜZELTİLEN SINIFLAR — BUNLAR DÖNÜŞ DEĞİLDİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-15 › merge · fork · rampa artık DÖNÜŞ DEĞİL', () => {
  it('`merge` bir dönüş cümlesi ÜRETMEZ', () => {
    const out = maneuverToTr('merge', 'right', 'O-51');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Sağdan katılın (O-51)');
    expect(classifyManeuver('merge', 'right').kind).toBe('MERGE');
  });

  it('`fork` bir dönüş cümlesi ÜRETMEZ', () => {
    const out = maneuverToTr('fork', 'left', 'D400');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Soldaki yola devam edin (D400)');
  });

  it('`off ramp` OTOYOL ÇIKIŞIDIR, dönüş değil', () => {
    const out = maneuverToTr('off ramp', 'right', 'Tarsus');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Sağdaki çıkışı kullanın (Tarsus)');
  });

  it('`on ramp` BAĞLANTI YOLUNA GİRİŞTİR', () => {
    const out = maneuverToTr('on ramp', 'right', '');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Sağdaki bağlantı yoluna girin');
  });

  it('taraf bilinmiyorsa taraf UYDURULMAZ', () => {
    expect(maneuverToTr('merge', '', '')).toBe('Yola katılın');
    expect(maneuverToTr('fork', '', '')).toBe('Yol ayrımında devam edin');
    expect(maneuverToTr('off ramp', '', '')).toBe('Çıkışı kullanın');
  });

  it('bu sınıfların HİÇBİRİ "dönün" sözcüğü içermez', () => {
    for (const t of ['merge', 'fork', 'on ramp', 'off ramp', 'ramp']) {
      for (const m of ['left', 'right', 'slight left', 'slight right', '']) {
        expect(maneuverToTr(t, m, 'X'), `${t}/${m}`).not.toContain('dönün');
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) UYDURMA DÖNÜŞ YASAĞI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-15 › uydurma dönüş yasağı', () => {
  it('TANINMAYAN tip bir YÖNE çevrilmez', () => {
    /* Sağlayıcı yarın yeni bir tip eklerse ürün onu "Sağa dönün" diye
       okumamalıdır — söylenmeyen bir şeyi söylemek olurdu. */
    const sem = classifyManeuver('teleport', 'right');
    expect(sem.recognized).toBe(false);
    expect(sem.kind).toBe('UNKNOWN');
    const out = maneuverInstructionTr(sem, 'X');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Devam edin (X)');
  });

  it('tanınmayan tipte TARAF bilgisi yine de TAŞINIR (şerit ipucu değerlidir)', () => {
    expect(classifyManeuver('teleport', 'right').side).toBe('RIGHT');
    expect(classifyManeuver('teleport', 'left').side).toBe('LEFT');
  });

  it('`turn` tipi ama taraf BİLİNMİYORSA dönüş cümlesi kurulmaz', () => {
    const out = maneuverToTr('turn', 'bogus-modifier', 'X');
    expect(out).not.toContain('dönün');
    expect(out).toBe('Devam edin (X)');
  });

  it('`continue` / `new name` bir DÖNÜŞ değildir', () => {
    /* Yolun kıvrılması dönüş değildir; sağlayıcı `new name` + `slight right`
       gönderdiğinde sürücü aynı yolda devam ediyordur. */
    expect(maneuverToTr('new name', 'slight right', 'D400')).toBe('Devam edin (D400)');
    expect(maneuverToTr('continue', 'straight', '')).toBe('Düz devam edin');
  });

  it('boş / sayı olmayan girdi ÇÖKMEZ ve dönüş üretmez', () => {
    for (const t of ['', null, undefined, 42, {}]) {
      const sem = classifyManeuver(t, null);
      expect(sem.recognized, `${String(t)}`).toBe(false);
      expect(maneuverInstructionTr(sem, '')).toBe('Devam edin');
    }
  });

  it('yol adı yoksa parantez EKLENMEZ', () => {
    expect(maneuverToTr('turn', 'right', '')).toBe('Sağa dönün');
    expect(maneuverToTr('turn', 'right', 'X')).toBe('Sağa dönün (X)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) SINIFLANDIRMA SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-15 › sınıflandırma', () => {
  it('sağ/sol/düz aileleri doğru tarafa düşer', () => {
    expect(classifyManeuver('turn', 'sharp right').side).toBe('RIGHT');
    expect(classifyManeuver('turn', 'slight left').side).toBe('LEFT');
    expect(classifyManeuver('turn', 'straight').side).toBe('STRAIGHT');
  });

  it('keskinlik YALNIZ dönüşlerde anlamlıdır', () => {
    expect(classifyManeuver('turn', 'sharp right').sharpness).toBe('SHARP');
    expect(classifyManeuver('merge', 'sharp right').sharpness).toBe('NONE');
    expect(classifyManeuver('fork', 'slight left').sharpness).toBe('NONE');
  });

  it('büyük/küçük harf ve boşluk toleranslıdır', () => {
    expect(classifyManeuver('  MERGE ', ' Right ').kind).toBe('MERGE');
    expect(classifyManeuver('Off Ramp', 'RIGHT').kind).toBe('RAMP_OFF');
  });
});
