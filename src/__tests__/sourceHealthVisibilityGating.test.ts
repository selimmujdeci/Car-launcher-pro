/**
 * sourceHealthVisibilityGating.test.ts — PR-2 düzeltmesi: BACKGROUND SAHTE "ÖLÜ" KAPISI.
 *
 * PROBLEM (cihazda gözlendi): uygulama arka plandayken WebView timer'ları kısılır ve
 * CAN/OBD/GPS frame'leri durur; ama worker'ın `_alive()` ölçümü `performance.now()`
 * kullanır ve bu saat arka planda İLERLEMEYE DEVAM EDER. Dönüşteki ilk 1 Hz watchdog
 * tikinde `now - lastSeen` timeout'u kat kat aşar → kaynak SAĞLAMKEN "ölü" kararı.
 * PR #72 ile bu karar HAL'e işlenir → sahte `supported=false` + sahte
 * `connection.changed=false` + dönüşte true/false fırtınası.
 *
 * ÇÖZÜM: `sourceHealthGate` — hidden iken sağlık GEÇİŞİ üretilmez; foreground dönüşünde
 * timeout SAATİ yeniden tabanlanır (arka planda geçen süre timeout'a YAZILMAZ).
 * Gerçek foreground kaybı MASKELENMEZ: görünür zamanda timeout dolarsa `false` üretilir.
 *
 * Kapı SAF (timer/DOM/store yok, zaman enjekte edilir) → invaryantlar DAVRANIŞSAL
 * doğrulanır. Worker/resolver Web Worker/DOM bağımlı olduğu için YAPISAL kilitlenir.
 */

import { describe, it, expect } from 'vitest';
import { createSourceHealthGate } from '../platform/vehicleDataLayer/sourceHealthGate';
import gateSrc     from '../platform/vehicleDataLayer/sourceHealthGate.ts?raw';
import workerSrc   from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';
import resolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';

/* ── Worker watchdog + sağlık postu simülasyonu (gerçek koda birebir uyar) ──────
 * `_alive()` (worker:409) ve `_postSourceHealthIfChanged()` mantığı; tek fark: zaman
 * ve frame'ler testten sürülür → arka plan/foreground senaryosu deterministik kurulur. */

const T_CAN = 3_000;   // SRC_TIMEOUT_CAN_MS
const T_OBD = 5_000;   // SRC_TIMEOUT_OBD_MS
const T_GPS = 5_000;   // SRC_TIMEOUT_GPS_MS

type Src = 'can' | 'obd' | 'gps';
interface Post { can: boolean; obd: boolean; gps: boolean; ts: number }

function makeWatchdog() {
  const gate = createSourceHealthGate();
  const posts: Post[] = [];
  const lastSeen: Record<Src, number> = { can: 0, obd: 0, gps: 0 };
  let prevCan: boolean | null = null;
  let prevObd: boolean | null = null;
  let prevGps: boolean | null = null;

  const alive = (ls: number, timeout: number, now: number) => ls > 0 && (now - ls) < timeout;

  return {
    gate,
    posts,
    /** Adaptörden frame geldi (worker `_handleVehicleData` → `_xLastSeen = performance.now()`). */
    frame(src: Src, now: number) { lastSeen[src] = now; },
    setVisible(visible: boolean, now: number) { gate.setVisible(visible, now); },
    /** 1 Hz watchdog tiki (yeni timer YOK — mevcut tik). */
    tick(now: number) {
      if (!gate.isVisible()) return;                       // hidden → geçiş DONDURULUR
      const can = gate.decide(now, lastSeen.can, T_CAN, alive(lastSeen.can, T_CAN, now), prevCan);
      const obd = gate.decide(now, lastSeen.obd, T_OBD, alive(lastSeen.obd, T_OBD, now), prevObd);
      const gps = gate.decide(now, lastSeen.gps, T_GPS, alive(lastSeen.gps, T_GPS, now), prevGps);
      if (can === null || obd === null || gps === null) return;   // karar yok → unknown korunur
      if (can === prevCan && obd === prevObd && gps === prevGps) return;
      prevCan = can; prevObd = obd; prevGps = gps;
      posts.push({ can, obd, gps, ts: now });
    },
    /** 1 Hz tik dizisi (from, to] — arka planda tikler KISILDIĞI için ayrıca kullanılır. */
    ticks(from: number, to: number, stepMs = 1_000) {
      for (let t = from; t <= to; t += stepMs) this.tick(t);
    },
    last(): Post | undefined { return posts[posts.length - 1]; },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) GÖRÜNÜRKEN davranış DEĞİŞMEDİ (gerçek kayıp hâlâ yakalanır)
 * ════════════════════════════════════════════════════════════════════════ */

describe('görünür (foreground) — mevcut davranış korunur', () => {
  it('CAN alive → dead normal çalışır (gerçek kayıp MASKELENMEZ)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_500);
    expect(w.last()).toMatchObject({ can: true, obd: false, gps: false });

    w.ticks(2_500, 6_000);                        // CAN frame yok → 3s sonra ölü
    expect(w.last()!.can).toBe(false);
    expect(w.last()!.ts).toBeLessThanOrEqual(4_500);   // ~timeout içinde karar
  });

  it('dead → alive (yeni frame) geçişi çalışır', () => {
    const w = makeWatchdog();
    w.tick(1_000);                                // hepsi ölü
    expect(w.last()).toMatchObject({ can: false });
    w.frame('can', 2_000);
    w.tick(2_100);
    expect(w.last()!.can).toBe(true);
  });

  it('CAN / OBD / GPS BAĞIMSIZ (CAN düşer, GPS canlı kalır)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000); w.frame('gps', 1_000);
    w.tick(1_100);
    expect(w.last()).toMatchObject({ can: true, gps: true });

    for (let t = 2_000; t <= 6_000; t += 1_000) { w.frame('gps', t); w.tick(t); }  // yalnız GPS besleniyor
    expect(w.last()).toMatchObject({ can: false, gps: true });                     // CAN düştü, GPS AYAKTA
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) HIDDEN — sahte "ölü" ÜRETİLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('arka plan (hidden) — sağlık geçişi dondurulur', () => {
  it('hidden iken YENİ false ÜRETİLMEZ (timer kısılsa bile)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000); w.frame('gps', 1_000);
    w.tick(1_100);
    const n = w.posts.length;

    w.setVisible(false, 2_000);
    w.ticks(3_000, 60_000);                       // arka planda tikler gelse bile
    expect(w.posts.length).toBe(n);               // HİÇ yeni mesaj yok
    expect(w.last()).toMatchObject({ can: true, gps: true });
  });

  it('hidden iken lastSeen BOZULMAZ — dönüşte taze frame anında "alive" der', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 50_000);                   // 48 sn arka plan
    w.frame('can', 50_100);                       // adaptör frame'i döndü
    w.tick(50_200);
    expect(w.last()).toMatchObject({ can: true });
    expect(w.posts.length).toBe(1);               // arada SAHTE false/true çifti YOK
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) FOREGROUND dönüşü — yeniden tabanlama
 * ════════════════════════════════════════════════════════════════════════ */

describe('foreground dönüşü — timeout saati yeniden tabanlanır', () => {
  it('ARKA PLAN SÜRESİ timeout hesabına YAZILMAZ (dönüşte anında false YOK)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000); w.frame('obd', 1_000); w.frame('gps', 1_000);
    w.tick(1_100);
    expect(w.last()).toMatchObject({ can: true, obd: true, gps: true });

    w.setVisible(false, 2_000);
    w.setVisible(true, 47_000);                   // 45 sn arka plan (cihaz senaryosu)
    w.tick(47_001);                               // dönüşteki İLK tik — eski lastSeen=1000
    expect(w.posts.length).toBe(1);               // 46 sn "sessizlik" ölü SAYILMAZ
    expect(w.last()).toMatchObject({ can: true });
  });

  it('dönüşten sonra YENİ FRAME gelirse → true KALIR (kayıp uydurulmaz)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 47_000);
    // Adaptör akışı döndü (gerçek araç sürekli frame yayar)
    for (let t = 47_500; t <= 55_000; t += 1_000) { w.frame('can', t); w.tick(t); }
    expect(w.last()).toMatchObject({ can: true });
    expect(w.posts.length).toBe(1);               // dönüşte SAHTE false/true çifti YOK
  });

  it('dönüşten sonra FRAME GELMEZSE → GÖRÜNÜR zamanda gerçek timeout dolunca false', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 47_000);                   // baseline = 47_000

    w.tick(48_000);                               // görünür süre 1s < 3s → KARAR YOK
    expect(w.posts.length).toBe(1);
    w.tick(49_500);                               // 2.5s < 3s → hâlâ karar yok
    expect(w.posts.length).toBe(1);

    w.tick(50_100);                               // 3.1s ≥ 3s → GERÇEK timeout doldu
    expect(w.posts.length).toBe(2);
    expect(w.last()).toMatchObject({ can: false });
  });

  it('gerçek foreground CAN kaybı SONSUZA KADAR maskelenmez (dead nihayetinde gelir)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 100_000);
    w.ticks(101_000, 130_000);
    expect(w.last()).toMatchObject({ can: false });
  });

  it('dönüşte CAN ölü + GPS canlı → BAĞIMSIZ (yalnız CAN düşer)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000); w.frame('gps', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 47_000);
    for (let t = 47_500; t <= 56_000; t += 1_000) { w.frame('gps', t); w.tick(t); }  // yalnız GPS döndü
    expect(w.last()).toMatchObject({ can: false, gps: true });
  });

  it('DUPLICATE visibility mesajı pencereyi YENİDEN BAŞLATMAZ (spam/uzatma yok)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000);
    w.tick(1_100);
    w.setVisible(false, 2_000);
    w.setVisible(true, 47_000);
    w.setVisible(true, 49_000);                   // DUPLICATE — baseline 47_000 kalmalı
    w.setVisible(true, 49_900);                   // DUPLICATE
    w.tick(50_100);                               // 47_000 + 3s < 50_100 → false gelmeli
    expect(w.last()).toMatchObject({ can: false });
  });

  it('BACKGROUND → FOREGROUND: her şey sağlıklıyken EVENT FIRTINASI YOK (0 yeni mesaj)', () => {
    const w = makeWatchdog();
    w.frame('can', 1_000); w.frame('obd', 1_000); w.frame('gps', 1_000);
    w.tick(1_100);
    const n = w.posts.length;

    w.setVisible(false, 2_000);
    w.ticks(3_000, 47_000);                       // 45 sn arka plan
    w.setVisible(true, 48_000);
    for (let t = 48_500; t <= 56_000; t += 500) { w.frame('can', t); w.frame('obd', t); w.frame('gps', t); w.tick(t); }

    expect(w.posts.length).toBe(n);               // false/true ÇİFTİ YOK → bridge sahte
                                                  // connection.changed üretmez
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) Kapı sözleşmesi + saflık
 * ════════════════════════════════════════════════════════════════════════ */

describe('sourceHealthGate — sözleşme', () => {
  it('ana thread bildirene kadar GÖRÜNÜR varsayılır (boot davranışı değişmez)', () => {
    const g = createSourceHealthGate();
    expect(g.isVisible()).toBe(true);
    // baseline yok → ham karar aynen döner
    expect(g.decide(5_000, 1_000, 3_000, false, true)).toBe(false);
  });

  it('duplicate setVisible NO-OP döner (false), gerçek değişim true döner', () => {
    const g = createSourceHealthGate();
    expect(g.setVisible(true, 10)).toBe(false);   // zaten görünür
    expect(g.setVisible(false, 20)).toBe(true);
    expect(g.setVisible(false, 30)).toBe(false);  // duplicate
    expect(g.setVisible(true, 40)).toBe(true);
  });

  it('rebaseline penceresinde karar YOK → son BİLİNEN değer korunur (prev)', () => {
    const g = createSourceHealthGate();
    g.setVisible(false, 1_000);
    g.setVisible(true, 10_000);                   // baseline = 10_000
    expect(g.decide(10_500, 500, 3_000, false, true)).toBe(true);   // prev=true korunur
    expect(g.decide(10_500, 500, 3_000, false, null)).toBeNull();   // prev yok → UNKNOWN
  });

  it('SAF: timer/DOM/store/IO YOK — zaman dışarıdan enjekte edilir', () => {
    expect(gateSrc).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|performance\.now/);
    expect(gateSrc).not.toMatch(/document|window|self\.|localStorage|fetch\(/);
    expect(gateSrc).not.toMatch(/from\s+['"]/);   // hiçbir import yok → yan etkisiz
  });

  it('kapı HAL/Event Bus/bridge/store KAVRAMI TAŞIMAZ (yalnız sağlık kararı)', () => {
    expect(gateSrc).not.toMatch(/vehicleHal|eventBus|halStatusStore|supported|'none'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) Worker + resolver kilitleri (yapısal — Worker/DOM jsdom'da koşturulamaz)
 * ════════════════════════════════════════════════════════════════════════ */

describe('worker — görünürlük kapısı bağlandı', () => {
  it('VISIBILITY mesajı bounded: yalnız boolean (araç verisi/PII YOK)', () => {
    expect(workerSrc).toMatch(/\|\s*\{\s*type:\s*'VISIBILITY';\s*visible:\s*boolean\s*\}/);
  });

  it('hidden iken sağlık postu ERKEN ÇIKAR (geçiş üretilmez)', () => {
    expect(workerSrc).toMatch(/function _postSourceHealthIfChanged[\s\S]{0,200}if \(!_healthGate\.isVisible\(\)\) return;/);
  });

  it('karar verilemezse POSTLANMAZ (unknown korunur — sahte false yok)', () => {
    expect(workerSrc).toMatch(/if \(can === null \|\| obd === null \|\| gps === null\) return;/);
  });

  it('VISIBILITY dispatcher\'a bağlandı ve YALNIZ kapıyı besler', () => {
    expect(workerSrc).toMatch(/case 'VISIBILITY':\s*_handleVisibility\(msg\);/);
    expect(workerSrc).toMatch(/function _handleVisibility[\s\S]{0,200}_healthGate\.setVisible\(msg\.visible === true, performance\.now\(\)\)/);
  });

  it('YENİ TIMER YOK — worker setInterval sayısı DEĞİŞMEDİ (4)', () => {
    expect((workerSrc.match(/setInterval\(/g) ?? []).length).toBe(4);
  });

  it('kapı YALNIZ sağlık kararını etkiler — fusion/reverse/SAB HAM `_alive()` kullanır', () => {
    // `_watchdog` ham değerleri hesaplar ve reverse/SAB kararlarını onlarla verir.
    expect(workerSrc).toMatch(/const canAlive = _alive\(_canLastSeen, SRC_TIMEOUT_CAN_MS\);/);
    expect(workerSrc).toMatch(/if \(!canAlive && !obdAlive\)/);   // reverse reset — DEĞİŞMEDİ
  });
});

describe('resolver — görünürlük kanalı (zero-leak)', () => {
  it('TEK visibilitychange dinleyicisi kurar', () => {
    expect((resolverSrc.match(/addEventListener\('visibilitychange'/g) ?? []).length).toBe(1);
  });

  it('stop() dinleyiciyi SÖKER → dispose sonrası worker\'a VISIBILITY gitmez', () => {
    const stopBlock = resolverSrc.slice(resolverSrc.indexOf('stop(): void {'));
    expect(stopBlock).toMatch(/removeEventListener\('visibilitychange', this\._onVisibilityBound\)/);
    expect(stopBlock).toMatch(/this\._onVisibilityBound = null;/);
    // Sökme, worker terminate'ten ÖNCE olmalı
    expect(stopBlock.indexOf('removeEventListener(\'visibilitychange\''))
      .toBeLessThan(stopBlock.indexOf('terminate()'));
  });

  it('DUPLICATE durum POSTLANMAZ (aynı görünürlük tekrar gönderilmez)', () => {
    expect(resolverSrc).toMatch(/if \(visible === this\._lastVisibleSent\) return;/);
  });

  it('yeni timer/polling AÇMAZ (yalnız event listener)', () => {
    const visBlock = resolverSrc.slice(
      resolverSrc.indexOf('private _sendVisibility'),
      resolverSrc.indexOf('stop(): void {'),
    );
    expect(visBlock.length).toBeGreaterThan(0);
    expect(visBlock).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
