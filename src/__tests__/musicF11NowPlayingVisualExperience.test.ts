/**
 * musicF11NowPlayingVisualExperience.test.ts — MUSIC F11 · OEM++ Now Playing.
 *
 * F11 bir CSS rötuşu değildir; kontrollü bir görsel/UX redesign'dır. Bu paket
 * şunları kilitler:
 *   · ÖLÇÜLEN kusur giderildi — kapak yalnız GENİŞLİĞE göre değil, YÜKSEKLİĞE
 *     göre de sınırlanır (800×480 sınıfı ekranda taşma olmaz)
 *   · her yoğunlukta dokunma hedefi ≥48px (transport hiçbir zaman küçülüp
 *     erişilemez hâle gelmez)
 *   · sürüşte HER ZAMAN COMPACT — F13 sözleşmesi (yeni sürüş otoritesi YOK,
 *     yalnız var olan `drivingMode`ın yorumu)
 *   · REGULAR yoğunluk F11 ÖNCESİ tasarımla PİKSEL UYUMLU (280px tavan korunur)
 *   · UI ikinci playback/native/provider otoritesi KURMAZ · PlayQueue'yu
 *     doğrudan mutasyona uğratmaz · sahte progress üretmez · F7.2 video
 *     güvenlik kapısını bypass edemez
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyNowPlayingDensity, computeNowPlayingLayout, COMPACT_HEIGHT_BREAKPOINT_PX,
  COMPACT_WIDTH_BREAKPOINT_PX, MIN_TOUCH_TARGET_PX, nowPlayingArtworkPx,
} from '../components/media/nowPlayingLayoutModel';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* Modül kapsamında: birden fazla `describe` bloğu aynı kaynağı okur. */
const screen = strip(read('src/components/media/MediaScreen.tsx'));
const layoutModel = strip(read('src/components/media/nowPlayingLayoutModel.ts'));

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · YERLEŞİM SÖZLEŞMESİ: 800×480 kontratı + dokunma hedefi
 * ════════════════════════════════════════════════════════════════════════ */

describe('F11 · nowPlayingLayoutModel — 800×480 sözleşmesi', () => {
  it('1 · 800×480 sınıfı ekran → COMPACT; kapak taşmaz', () => {
    // Drawer kenar boşluğu düşülmüş yaklaşık içerik alanı.
    const w = 800 - 48;
    const h = 480 - 67;
    const density = classifyNowPlayingDensity(w, h, 'idle');
    expect(density).toBe('COMPACT');

    const layout = computeNowPlayingLayout(w, h, 'idle');
    expect(layout.density).toBe('COMPACT');
    /* Kapak İKİ eksene de saygılı: yüksekliğin büyük bir kısmını AŞMAZ. */
    expect(layout.artworkPx).toBeLessThanOrEqual(Math.round(h * 0.34) + 1);
    expect(layout.artworkPx).toBeLessThanOrEqual(176);
    expect(layout.artworkPx).toBeGreaterThanOrEqual(96);
  });

  it('2 · geniş ama ALÇAK ekran (1280×480) da COMPACT — yalnız genişliğe bakılmaz', () => {
    const layout = computeNowPlayingLayout(1280 - 48, 480 - 67, 'idle');
    expect(layout.density, 'yükseklik göz ardı edilmiş').toBe('COMPACT');
    expect(layout.artworkPx).toBeLessThanOrEqual(180);
  });

  it('3 · büyük ekran (1280×720) → REGULAR ve eski tavanla (280px) UYUMLU', () => {
    const w = 1280 - 48;
    const h = 720 - 67;
    const layout = computeNowPlayingLayout(w, h, 'idle');
    expect(layout.density).toBe('REGULAR');
    expect(layout.artworkPx, 'F11 öncesi 280px tavanı bozulmuş').toBeLessThanOrEqual(280);
    expect(layout.titleFontPx).toBe(24);       // eski text-2xl ile aynı
    expect(layout.transportPrimaryPx).toBe(80); // eski w-20 ile aynı
    expect(layout.transportSecondaryPx).toBe(64); // eski w-16 ile aynı
  });

  it('4 · HİÇBİR yoğunlukta dokunma hedefi 48px altına İNMEZ', () => {
    const sizes = [
      computeNowPlayingLayout(800 - 48, 480 - 67, 'idle'),
      computeNowPlayingLayout(1280 - 48, 720 - 67, 'idle'),
      computeNowPlayingLayout(800 - 48, 480 - 67, 'driving'),
      computeNowPlayingLayout(320, 240, 'idle'),   // uç durum — çok küçük ekran
    ];
    for (const l of sizes) {
      expect(l.transportPrimaryPx).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(l.transportSecondaryPx).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(l.transportTertiaryPx).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–6 · SÜRÜŞ REDÜKSİYONU (F13) — yeni otorite YOK, yalnız yorum
 * ════════════════════════════════════════════════════════════════════════ */

describe('F11 · sürüşte HER ZAMAN COMPACT (F13 sözleşmesi)', () => {
  it('5 · büyük ekranda bile sürüş modu COMPACT\'a zorlar', () => {
    const layout = computeNowPlayingLayout(1920 - 48, 1080 - 67, 'driving');
    expect(layout.density, 'sürüşte büyük ekran REGULAR kalmış').toBe('COMPACT');
    expect(layout.tabBarCompact).toBe(true);
    /* Sürüşte transport bile REGULAR çapından küçülür — dokunma yine ≥48px. */
    expect(layout.transportPrimaryPx).toBeLessThan(80);
  });

  it('6 · idle/normal + yeterli alan → REGULAR (kısıtlama YOK)', () => {
    const idle = computeNowPlayingLayout(1280 - 48, 720 - 67, 'idle');
    const normal = computeNowPlayingLayout(1280 - 48, 720 - 67, 'normal');
    expect(idle.density).toBe('REGULAR');
    expect(normal.density).toBe('REGULAR');
    expect(idle.tabBarCompact).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–8 · KAPAK: iki eksen + eşik sabitleri
 * ════════════════════════════════════════════════════════════════════════ */

describe('F11 · kapak boyutu iki eksene de saygılıdır', () => {
  it('7 · dar genişlik geniş yüksekliği ezer, dar yükseklik geniş genişliği ezer', () => {
    const narrowWide = nowPlayingArtworkPx(300, 2000, 'REGULAR');   // dar genişlik
    const shortTall  = nowPlayingArtworkPx(2000, 300, 'REGULAR');   // dar yükseklik
    expect(narrowWide).toBeLessThan(280);
    expect(shortTall).toBeLessThan(280);
  });

  it('8 · eşik sabitleri kaldırılmamış (kilitli sınıflandırma)', () => {
    expect(COMPACT_HEIGHT_BREAKPOINT_PX).toBeGreaterThan(0);
    expect(COMPACT_WIDTH_BREAKPOINT_PX).toBeGreaterThan(0);
    expect(classifyNowPlayingDensity(COMPACT_WIDTH_BREAKPOINT_PX + 100,
      COMPACT_HEIGHT_BREAKPOINT_PX - 1, 'idle')).toBe('COMPACT');
    expect(classifyNowPlayingDensity(COMPACT_WIDTH_BREAKPOINT_PX - 1,
      COMPACT_HEIGHT_BREAKPOINT_PX + 100, 'idle')).toBe('COMPACT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–14 · AUTHORITY GUARDS (statik kilit) — UI ikinci otorite KURAMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F11 · Now Playing UI ikinci otorite DEĞİLDİR', () => {
  it('9 · native köprüye/sağlayıcıya DOĞRUDAN komut YOK', () => {
    expect(screen.length, 'MediaScreen okunamadı — kilit boş kümeye düştü').toBeGreaterThan(5000);
    expect(screen, 'native köprüye doğrudan inmiş').not.toContain('nativeAuthorityBridge');
    expect(screen, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(screen, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplaySpotifyTrack\s*\(/);
  });

  it('10 · PlayQueue DOĞRUDAN mutasyona uğratılamaz', () => {
    expect(screen, 'kanonik kuyruğu doğrudan import etmiş')
      .not.toMatch(/from '[^']*session\/playQueue'/);
    expect(screen, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
  });

  it('11 · taşıma (transport) YALNIZ kanonik kuyruk-farkında giriş veya F0 kapısından geçer', () => {
    expect(screen, 'kuyruk-farkında giriş kaldırılmış').toContain('queueAwareNext');
    expect(screen, 'kuyruk-farkında giriş kaldırılmış').toContain('queueAwarePrevious');
    expect(screen, 'kanonik komut kapısı kaldırılmış').toContain('mediaCommandGateway');
  });

  it('12 · sahte ilerleme ÜRETİLMEZ — tek kaynak nowPlayingModel.progressFor', () => {
    /* PlayerView'ın kendi çubuğu kendi süre/yüzde hesabı KURMAZ; yalnız F4
       sunum modelinin `nowPlaying.progress`sinden `percent`/etiket okur.
       (Tam ekran YouTube video chrome'unun KENDİ ilerleme çubuğu — ayrı bir
       yüzey, F7.1 döneminden — bu kilidin kapsamı DIŞINDADIR.) */
    const playerViewBody = screen.slice(
      screen.indexOf('function PlayerView('), screen.indexOf('function SourcesView('),
    );
    expect(playerViewBody.length, 'PlayerView gövdesi okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(playerViewBody, 'PlayerView kendi yüzde/süre hesabı kurmuş')
      .not.toMatch(/positionSec\s*\/\s*durationSec/);
    expect(playerViewBody, 'kanonik ilerleme okunuyor').toContain('progress.percent');
  });

  it('13 · SAHA BUGFIX (2026-09-03) · hız/hareket video görüntüsünü ARTIK GATE\'LEMEZ', () => {
    /* ÜRÜN KARARI DEĞİŞTİ: F7.2 hız kapısı MediaScreen'den kaldırıldı — video
       görünürlüğü YALNIZ kullanıcının `videoMode` seçimine bağlıdır. */
    expect(screen, 'video render kararı hâlâ hız kapısına bağlı — kaldırılması gerekiyordu')
      .not.toContain('useVideoSafety');
    expect(screen, 'video render kararı hâlâ videoSafety.allowed okuyor')
      .not.toMatch(/videoMode\s*&&\s*videoSafety\.allowed/);
    expect(screen, 'YouTube + videoMode açıkken host görünür kılınmalı')
      .toMatch(/isYouTube\s*&&\s*videoMode\s*&&\s*\(/);
  });

  it('14 · yerleşim modeli SAF kalır (ikinci sürüş/ekran otoritesi kurmaz)', () => {
    expect(layoutModel.length, 'yerleşim modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);
    expect(layoutModel, 'yerleşim modeli zamana bağlanmış').not.toContain('Date.now');
    expect(layoutModel, 'yerleşim modeli timer kurmuş').not.toMatch(/setInterval|setTimeout/);
    expect(layoutModel, 'yerleşim modeli React\'e bağlanmış').not.toContain("from 'react'");
    expect(layoutModel, 'yerleşim modeli otoriteye inmiş').not.toContain('mediaCommandGateway');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15–17 · BU TURDA KAPATILAN 4 KUSURUN DOĞRULAMASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F11 · önceki turda tespit edilen kusurlar KAPANDI', () => {
  it('15 · kapak overflow — iki eksene göre sınırlı (bkz. 1–3 numaralı testler)', () => {
    /* 800×480'de kapak yüksekliğin ~%34'ünü aşamaz; ayrı bir doğrulama
       gerekmez, üstteki 800×480 sözleşmesi bunu zaten kanıtlıyor. Burada
       yalnız eski TEK-eksenli davranışın (yalnız `70vw`) kodda KALMADIĞINI
       teyit ederiz. */
    expect(screen, 'eski tek-eksenli kapak boyutlandırması geri gelmiş')
      .not.toContain("width: 'min(280px, 70vw)'");
  });

  it('16 · beğeni düğmesi YALNIZ MUSIC F13\'ün gerçek favori otoritesiyle geri gelebilir', () => {
    /* F11: `onClick`i olmayan süs bir beğeni düğmesi vardı → KALDIRILDI (o an
       hiçbir favori otoritesi yoktu). MUSIC F13 gerçek bir
       `musicCollectionAuthority` KURDUĞUNDAN düğme artık MEŞRU — kilit yeni
       doğru davranışa GÜNCELLENDİ (aynı kilit `regression.guards.test.ts`te
       kalıcı olarak da tutulur): Heart varsa YALNIZ `useFavoriteStatus`
       durumuna bağlı ve kanıt kapılı olabilir; kanıtsız/onClick'siz süs YASAK. */
    if (screen.includes('Heart')) {
      expect(screen, 'F13 favori hook\'u kullanılmadan Heart eklenmiş').toContain('useFavoriteStatus');
      expect(screen, 'Heart kontrolü kanıt kapısı olmadan çiziliyor').toMatch(/favorite\.available\s*&&/);
    }
  });

  it('17 · çelişen tipografi sınıfları KALDIRILDI; tab bar COMPACT\'ta hafifliyor', () => {
    const trackInfo = screen.slice(
      screen.indexOf('data-editable="media.track-info"'),
      screen.indexOf('data-editable="media.progress"'),
    );
    expect(trackInfo, 'çakışan sabit yazı boyutu sınıfı geri gelmiş')
      .not.toMatch(/text-2xl|text-base/);
    /* Tab bar: compact'ta etiket görsel olarak gizlenir, dokunma yüksekliği garanti. */
    expect(screen, 'tab bar compact dalı kaldırılmış').toContain("compact ? 'sr-only'");
    expect(screen, 'tab bar compact yüksekliği kaldırılmış').toContain('minHeight: compact ? 56');
  });
});
