/**
 * thermalRasterLatch.test.ts — #640 KİLİDİ
 * "FPS düşüşü haritayı KALICI raster'a kilitleyemez" sözleşmesi.
 *
 * ── NEDEN VAR (CİHAZDA ÖLÇÜLDÜ, 2026-08-19, Xiaomi 23090RA98I) ──────────────
 * Kullanıcı bildirimi: *"aynı harita, yollar gri gerisi gri."* Ekran
 * görüntüsünden piksel ölçüldü: zemin **RGB(71,71,71)**, yol **RGB(83,83,83)**
 * → yol↔zemin kontrastı **1,21:1**. Projenin kendi vektör gece merdiveni
 * 3,04–8,00; yani ekrandaki harita kendi standardımızın 2,5–6,6 katı kötüydü.
 *
 * Ölçüm MapLibre raster boya zinciriyle (saturation → contrast → brightness)
 * modellendi ve BİREBİR tuttu: `RASTER_PAINT_NIGHT` (`brightness 0.02–0.25`,
 * `saturation −0.58`) tüm görüntüyü ekranın %23'lük bandına sıkıştırıyor ve
 * OSM'in yol hiyerarşisini taşıyan RENGİ siliyor. Yani harita raster'a
 * düştüğü anda okunamaz hâle geliyor.
 *
 * KÖK: `notifyLowFPS(true)` raster'a kilitliyor, ama `notifyLowFPS(false)`
 * YALNIZ bayrağı temizliyordu — vektöre dönüşü hiçbir yerden kurmuyordu.
 * Dönüş tek bir başka çağrıya (`notifyNavigationRender`) bağlıydı ve o da
 * yalnız navigasyon durumu DEĞİŞİNCE çalışır. Sürücü navigasyona girmezse
 * harita, tek bir anlık FPS düşüşünden sonra OTURUM BOYUNCA raster kalıyordu.
 * (#634 · #604 · #606 ile aynı "tek yönlü mandal" sınıfı.)
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. FPS düşünce raster ANINDA gelir (mevcut davranış korunur).
 *   2. FPS toparlayınca vektör KENDİLİĞİNDEN geri gelir — başka bir çağrıyı
 *      beklemez.
 *   3. Kurtarma debounce'ludur ve tetikte durum YENİDEN okunur: bu arada FPS
 *      tekrar düşmüşse geçiş YAPILMAZ (salınım koruması).
 *   4. AR açıkken kurtarma vektöre dönmez (AR'da raster kasıtlıdır).
 *   5. mapMode 'road' değilse (uydu/hibrit) hiçbir şey yapılmaz.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  notifyLowFPS, notifyNavigationRender, useMapSourceStore, getTileModeVerdict,
} from '../platform/mapSourceManager';

const RECOVERY_MS = 2500;

function setMode(mapMode: 'road' | 'satellite', tileRender: 'raster' | 'vector') {
  useMapSourceStore.setState({ mapMode, tileRender } as never);
}

describe('#640 — FPS düşüşü kalıcı raster mandalı üretemez', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMode('road', 'vector');
    notifyNavigationRender(false, false); // AR kapalı olarak modüle yazılır
    vi.runOnlyPendingTimers();
    setMode('road', 'vector');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('🔒 FPS düşünce raster ANINDA gelir (mevcut davranış korunur)', () => {
    notifyLowFPS(true);
    expect(useMapSourceStore.getState().tileRender).toBe('raster');
  });

  it('🔒 CİHAZDA ÖLÇÜLEN KUSUR: FPS toparlayınca vektör KENDİLİĞİNDEN geri gelir', () => {
    notifyLowFPS(true);
    expect(useMapSourceStore.getState().tileRender).toBe('raster');

    notifyLowFPS(false);            // FPS toparladı — başka HİÇBİR çağrı yok
    expect(
      useMapSourceStore.getState().tileRender,
      'kurtarma debounce beklemeden geçmemeli',
    ).toBe('raster');

    vi.advanceTimersByTime(RECOVERY_MS + 10);
    expect(
      useMapSourceStore.getState().tileRender,
      'FPS toparladığı hâlde harita raster\'da kaldı — tek yönlü mandal geri geldi',
    ).toBe('vector');
  });

  it('🔒 SALINIM KORUMASI: kurtarma penceresinde FPS tekrar düşerse geçiş YAPILMAZ', () => {
    notifyLowFPS(true);
    notifyLowFPS(false);
    vi.advanceTimersByTime(1000);
    notifyLowFPS(true);             // pencere dolmadan tekrar düştü
    vi.advanceTimersByTime(RECOVERY_MS + 10);
    expect(useMapSourceStore.getState().tileRender).toBe('raster');
  });

  it('🔒 AR açıkken kurtarma vektöre DÖNMEZ (AR\'da raster kasıtlıdır)', () => {
    notifyNavigationRender(false, true);   // AR açık
    notifyLowFPS(true);
    notifyLowFPS(false);
    vi.advanceTimersByTime(RECOVERY_MS + 10);
    expect(useMapSourceStore.getState().tileRender).toBe('raster');
  });

  it('🔒 uydu/hibrit modda kurtarma hiçbir şey yapmaz', () => {
    setMode('satellite', 'raster');
    notifyLowFPS(false);
    vi.advanceTimersByTime(RECOVERY_MS + 10);
    expect(useMapSourceStore.getState().mapMode).toBe('satellite');
    expect(useMapSourceStore.getState().tileRender).toBe('raster');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * #640-B — "HARİTA NEDEN GRİ?" TEK YAPIŞTIRMAYLA CEVAPLANABİLMELİ
 *
 * SAHA (2026-08-19): kullanıcı LAB'ın TAM KOPYASINI gönderdi ve teşhis yine
 * ÇIKARILAMADI — kopyada ne çözülen karo modu ne de sebebi vardı. Ekranda
 * görünen bir alanın kopyaya girmemesi, gözlemlenebilirliğin yarısının ölü
 * olması demektir (aynı kusur #523/#535'te de yaşandı: "ölçüm yazıldı, dışarı
 * çıkarılmadı").
 * ════════════════════════════════════════════════════════════════════════ */
describe('#640-B — karo modu hükmü: mod + SEBEP hem ekranda hem kopyada', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMode('road', 'vector');
    notifyNavigationRender(false, false);
    vi.runOnlyPendingTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('🔒 raster ise SEBEP üretilir; vektörse sebep NULL (kanıtsız sebep yok)', () => {
    notifyLowFPS(true);
    const v = getTileModeVerdict();
    expect(v.intent).toBe('raster');
    expect(v.thermalLock).toBe(true);
    /* `resolved` yalnız `getMapStyle()` çağrıldığında tazelenir; bu testte stil
       çözülmediği için hükmün İDDİA ETTİĞİ tek şey niyet ve kilit durumudur.
       Sebep alanı ancak çözülen mod raster ise dolar — uydurma YOK. */
    if (v.resolved === 'raster') {
      expect(v.reason, 'raster çözüldü ama sebep üretilmedi').not.toBeNull();
    } else {
      expect(v.reason, 'vektörde sebep üretilmemeli').toBeNull();
    }
  });

  it('🔒 KAYNAK: sebep sıralaması AR → termal → niyet → kapı → kaynak', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/mapSourceManager.ts'), 'utf8');
    const fn = src.match(/export function getTileModeVerdict[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn, 'getTileModeVerdict bulunamadı').not.toBe('');
    const order = ['MAP_MODE_RASTER', 'AR_ACTIVE', 'THERMAL_LOCK_FPS', 'INTENT_RASTER',
                   'VECTOR_GATE_BLOCKED', 'NO_VECTOR_SOURCE'];
    const positions = order.map((k) => fn.indexOf(`'${k}'`));
    positions.forEach((pos, i) => {
      expect(pos, `${order[i]} sebebi kaldırılmış`).toBeGreaterThan(-1);
      if (i > 0) {
        expect(pos, `sebep sıralaması bozuldu: ${order[i - 1]} → ${order[i]}`)
          .toBeGreaterThan(positions[i - 1]);
      }
    });
  });

  it('🔒 KAYNAK: hüküm LAB TAM KOPYASINA giriyor (ekranda görünüp kopyada olmayan alan YASAK)', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/devtools/carosLabCopySources.ts'), 'utf8');
    expect(src, 'kopya karo hükmünü hiç okumuyor').toMatch(/getTileModeVerdict\(\)/);
    for (const field of ['haritaKaroModu', 'haritaRasterSebebi', 'haritaKaroNiyeti', 'cihazSinifi']) {
      expect(src, `${field} kopyaya yazılmıyor`).toContain(field);
    }
  });

  it('🔒 KAYNAK: LAB ekranı da NİYETİ değil ÇÖZÜLEN modu + sebebi gösteriyor', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/devtools/navigationCoreSources.ts'), 'utf8');
    expect(src, 'ekran hükmü okumuyor').toMatch(/getTileModeVerdict\(\)/);
    expect(src, 'sebep ekrana yazılmıyor').toMatch(/sebep:/);
    expect(src, 'store niyeti (tileRender) yeniden ekrana sızmış')
      .not.toMatch(/miniMapStyle:[\s\S]{0,200}st\.tileRender/);
  });
});
