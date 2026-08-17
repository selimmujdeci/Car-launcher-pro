/**
 * mapParkViewZoom.test.ts — #617 KİLİDİ
 *
 * SAHA KUSURU (cihazda ölçüldü 2026-08-17, Xiaomi 23090RA98I):
 * Kullanıcı: *"Büyük haritaya girip çıkınca mini harita düzeliyor, saçma sapan
 * yükleniyor ilk başta."*
 *
 * Park/duruş çerçevesinin zoom'u kodda ÜÇ ayrı yerde ÜÇ ayrı sayıyla yazılıydı:
 * ilk kurulum **16**, "Ortala" düğmesi **16,5**, `exitDrivingView` **15,5**.
 * Açılışta GPS oynaması kısa süre sürüş modunu açıp kapatınca `exitDrivingView`
 * çalışıyor ve `easeTo({zoom: 15.5})` ile doğru çerçeveyi EZİYORDU. Arayüz bu
 * telefonda 0,679 kat ölçeklendiği için (kutu 781 CSS px → ekranda 530 px) bir
 * kademe eksik zoom ekranda ~1,5 kat daha geniş alan demek: yollar saç teli
 * gibi ince ve sık. Ardışık açılışlarda ölçüm 16 / 15,5 / 16 / 15,5 dönüşümlü.
 *
 * BU KİLİTLER ZAYIFLATILMAZ: park zoom'u TEK sabitten gelir; çağrı yerlerine
 * ikinci bir sayı yazılamaz. Değer bilinçli değişirse `PARK_VIEW_ZOOM`
 * güncellenir — kilit kaldırılmaz.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** Yorum satırlarını çıkar — gerekçe metinlerindeki sayılar kilidi yanıltmasın. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const MIM_PATH  = 'src/platform/map/MapInteractionManager.ts';
const MINI_PATH = 'src/components/map/MiniMapWidget.tsx';

describe('#617 — park/duruş çerçevesi TEK otoriteden gelir', () => {
  it('🔒 PARK_VIEW_ZOOM export edilir ve sokak seviyesindedir (≥16)', () => {
    /* Sabit KAYNAKTAN okunur, modül import'uyla DEĞİL: bu depoda test dosyaları
       modül kayıtlarını paylaşabiliyor ve başka bir dosyanın
       `vi.mock('.../MapInteractionManager')` çağrısı bu kilidi sızıntıyla
       düşürüyordu (izole koşumda geçip tam suite'te düşüyordu). Kilit artık
       koşum sırasına bağlı değil. */
    const code = stripComments(read(MIM_PATH));
    const m = code.match(/export const PARK_VIEW_ZOOM\s*=\s*([\d.]+)/);
    expect(m, 'PARK_VIEW_ZOOM export edilmemiş').toBeTruthy();
    const zoom = parseFloat(m![1]);
    // 15,5 sahada ÖLÇÜLEN kusurlu değerdi: bu telefonda ~1,5 kat fazla geniş.
    expect(zoom).toBeGreaterThanOrEqual(16);
    expect(zoom).toBeLessThanOrEqual(17);
  });

  it('🔒 exitDrivingView sabit 15.5 zoom YAZMAZ — sabiti kullanır', () => {
    const code = stripComments(read(MIM_PATH));
    const idx  = code.indexOf('export function exitDrivingView');
    expect(idx).toBeGreaterThan(-1);
    const body = code.slice(idx, idx + 2000);
    expect(body).not.toMatch(/zoom:\s*15\.5/);
    expect(body).toMatch(/zoom:\s*PARK_VIEW_ZOOM/);
  });

  it('🔒 kamera yumuşatma sıfırlaması da aynı sabiti kullanır (ikinci park zoom YOK)', () => {
    const code = stripComments(read(MIM_PATH));
    expect(code).not.toMatch(/resetCameraSmooth\(\{\s*zoom:\s*15\.5/);
  });

  it('🔒 MiniMapWidget park çerçevesine sabit sayı YAZMAZ', () => {
    const code = stripComments(read(MINI_PATH));
    // setMapCenter(...) çağrılarının hiçbiri çıplak park zoom'u taşımamalı
    const calls = code.match(/setMapCenter\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c, `sabit park zoom'u: ${c}`).not.toMatch(/,\s*1[56](\.\d+)?\s*,/);
    }
    expect(code).toMatch(/PARK_VIEW_ZOOM/);
  });

  it('🔒 başlangıç çerçevesi UYGULANDIĞINDA işaretlenir (tek-atımlık şans kaybolmaz)', () => {
    const code = stripComments(read(MINI_PATH));
    // #617: `_initialized = true` koşulsuzdu; çerçeve `_cameraOwned` false iken
    // atlanıp bir daha DENENMİYORDU. Bayrak artık çerçeveyle birlikte konur.
    expect(code).toMatch(/cameraSeededRef\.current\s*=\s*true/);
    // Park dalında telafi yolu bulunmalı (araç dururken de çerçeve kurulur).
    expect(code).toMatch(/!cameraSeededRef\.current\s*&&\s*_cameraOwned/);
  });
});
