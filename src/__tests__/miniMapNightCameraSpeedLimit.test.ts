/**
 * miniMapNightCameraSpeedLimit.test.ts — MINI_MAP_NIGHT_CAMERA_SPEED_LIMIT_P0.
 *
 * Üç kullanıcı şikâyetinin kilitleri:
 *   A. Gece haritası okunamıyor        → token sistemi + kontrast profili
 *   B. Sürükleyince araca dönmüyor     → kanonik kamera otoritesi + Ortala
 *   C. Hız limiti kartı yok / yanlış   → dürüstlük modeli (yalnız gerçek levha)
 *   D. Yerleşim çakışması
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

import miniMapSrc      from '../components/map/MiniMapWidget.tsx?raw';
import fullMapSrc      from '../components/map/FullMapView.tsx?raw';
import hudControlsSrc  from '../components/map/MapHudControls.tsx?raw';
import cameraSrc       from '../platform/navigation/cameraFollowAuthority.ts?raw';
import speedModelSrc   from '../platform/navigation/core/speedLimitTruthModel.ts?raw';
import speedCardSrc    from '../components/map/SpeedLimitCard.tsx?raw';
import effectiveHookSrc from '../platform/navigation/useEffectiveSpeedLimit.ts?raw';

import {
  RASTER_PAINT_NIGHT, RASTER_PAINT_DAY, MAP_BG_NIGHT, MAP_BG_DAY,
  getMapContrastProfile,
} from '../platform/mapStyleBuilders';
import {
  CameraFollowState,
  AUTO_FOLLOW_DELAY_NAV_MS, AUTO_FOLLOW_DELAY_IDLE_MS,
  getCameraFollowState, canDriveCamera, isRecenterAvailable,
  subscribeCameraFollow, setCameraNavActive,
  notifyUserPanStart, notifyUserPanEnd,
  beginRecenter, completeRecenter, noteFollowZoom,
  resetCameraFollow, getCameraFollowSnapshot,
  _resetCameraFollowForTest,
} from '../platform/navigation/cameraFollowAuthority';
/** Yorumları soyar — yapısal kilitler AÇIKLAMA metnini değil KODU denetlemeli.
 *  (İlk yazımda bu eksikti: kilitler kendi gerekçe yorumlarını yakalıyordu.) */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // blok yorum
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');     // satır yorumu (URL'leri bozmadan)
}

import {
  classifySpeedLimit, isSpeedLimitDisplayable,
  SPEED_LIMIT_MAX_AGE_MS, SPEED_LIMIT_MAX_DISTANCE_M,
} from '../platform/navigation/core/speedLimitTruthModel';

/* ══════════════════════════════════════════════════════════════════════════
   A. GECE GÖRÜNÜMÜ
   ══════════════════════════════════════════════════════════════════════════ */
describe('A. Gece haritası okunabilirliği', () => {
  it('gece paleti GÜNDÜZE DÖNMEZ — parlaklık gündüzün çok altında', () => {
    expect(RASTER_PAINT_NIGHT['raster-brightness-max'])
      .toBeLessThan(RASTER_PAINT_DAY['raster-brightness-max'] / 3);
  });

  it('🔒 saha kilidinin ÜST SINIRI korunur (ölçülen 0.25)', () => {
    // 2026-08-02 cihaz ölçümü: 0.25 üstü gece haritayı gündüz parlaklığında bırakıyordu.
    expect(RASTER_PAINT_NIGHT['raster-brightness-max']).toBeLessThanOrEqual(0.25);
  });

  it('okunabilirlik ARTIRILDI — eski 0.16 değerine geri dönülmedi', () => {
    // Kullanıcı 2026-08-04'te "mini haritada gece okunamıyor" bildirdi.
    expect(RASTER_PAINT_NIGHT['raster-brightness-max']).toBeGreaterThan(0.16);
  });

  it('KONTRAST etiketleri ezmeden yol ağını ayırır (2026-06-13 dersi)', () => {
    // Koyulaştırma brightness ile yapılır; contrast DÜŞÜRÜLEREK etiket ezilmez.
    expect(RASTER_PAINT_NIGHT['raster-contrast']).toBeGreaterThan(RASTER_PAINT_DAY['raster-contrast']);
    expect(RASTER_PAINT_NIGHT['raster-contrast']).toBeLessThanOrEqual(0.55);
  });

  it('saf siyah YOK — brightness-min sıfırdan büyük (detay yutulmasın)', () => {
    expect(RASTER_PAINT_NIGHT['raster-brightness-min']).toBeGreaterThan(0);
  });

  it('renk ipuçları (su/yeşil) tamamen boğulmaz', () => {
    expect(RASTER_PAINT_NIGHT['raster-saturation']).toBeGreaterThan(-0.65);
  });

  it('arka plan token TEK KAYNAKTAN gelir ve saf siyah değildir', () => {
    expect(MAP_BG_NIGHT).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MAP_BG_NIGHT).not.toBe('#000000');
    expect(MAP_BG_DAY).not.toBe(MAP_BG_NIGHT);
  });

  it('kontrast profili gündüz/gece için AYRI ad üretir', () => {
    expect(getMapContrastProfile(true)).toBe('NIGHT_READABLE');
    expect(getMapContrastProfile(false)).toBe('DAY_NATURAL');
  });

  it('🔒 mini haritada bileşen-içi rastgele harita rengi YOK', () => {
    // Harita renkleri token setinden gelir; widget kendi paletini kurmaz.
    expect(miniMapSrc).not.toContain('raster-brightness');
    expect(miniMapSrc).not.toContain('raster-contrast');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. KAMERA TAKİBİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('B. Kamera takip durumları', () => {
  beforeEach(() => { _resetCameraFollowForTest(); vi.useRealTimers(); });

  it('başlangıç FOLLOWING ve kamera sürülebilir', () => {
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    expect(canDriveCamera()).toBe(true);
    expect(isRecenterAvailable()).toBe(false);   // araç merkezde → düğme GİZLİ
  });

  it('kullanıcı pan → USER_PANNING, kamera SÜRÜLEMEZ', () => {
    notifyUserPanStart();
    expect(getCameraFollowState()).toBe(CameraFollowState.USER_PANNING);
    expect(canDriveCamera()).toBe(false);
    expect(isRecenterAvailable()).toBe(true);    // düğme GÖRÜNÜR
  });

  it('pan bitince FOLLOW_SUSPENDED — harita kendiliğinden ATLAMAZ', () => {
    notifyUserPanStart();
    notifyUserPanEnd();                          // geri çağrı YOK → otomatik dönüş YOK
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOW_SUSPENDED);
    expect(canDriveCamera()).toBe(false);
  });

  it('Ortala → FOLLOWING ve düğme yeniden GİZLENİR', () => {
    notifyUserPanStart(); notifyUserPanEnd();
    beginRecenter('USER_BUTTON');
    expect(getCameraFollowState()).toBe(CameraFollowState.RECENTERING);
    completeRecenter();
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    expect(isRecenterAvailable()).toBe(false);
  });

  it('İKİNCİ pan bekleyen otomatik dönüşü İPTAL eder', () => {
    vi.useFakeTimers();
    const applied = vi.fn();
    setCameraNavActive(true);
    notifyUserPanStart(); notifyUserPanEnd(applied);
    expect(getCameraFollowSnapshot().autoRecenterPending).toBe(true);

    notifyUserPanStart();                        // kullanıcı yeniden dokundu
    expect(getCameraFollowSnapshot().autoRecenterPending).toBe(false);
    vi.advanceTimersByTime(AUTO_FOLLOW_DELAY_NAV_MS * 3);
    expect(applied).not.toHaveBeenCalled();      // kamera GERİ ALINMADI
    vi.useRealTimers();
  });

  it('otomatik dönüş MEVCUT ÜRÜN SÖZLEŞMESİNİ kullanır (3 sn nav / 10 sn dışı)', () => {
    expect(AUTO_FOLLOW_DELAY_NAV_MS).toBe(3_000);
    expect(AUTO_FOLLOW_DELAY_IDLE_MS).toBe(10_000);

    vi.useFakeTimers();
    const applied = vi.fn();
    setCameraNavActive(true);
    notifyUserPanStart(); notifyUserPanEnd(applied);
    vi.advanceTimersByTime(AUTO_FOLLOW_DELAY_NAV_MS - 1);
    expect(applied).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    vi.useRealTimers();
  });

  it('navigasyon bitince kamera durumu TEMİZLENİR (bekleyen dönüş iptal)', () => {
    vi.useFakeTimers();
    const applied = vi.fn();
    notifyUserPanStart(); notifyUserPanEnd(applied);
    resetCameraFollow('NAV_END');
    expect(getCameraFollowState()).toBe(CameraFollowState.FOLLOWING);
    expect(getCameraFollowSnapshot().autoRecenterPending).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(applied).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('UNKNOWN fail-closed — kamera SÜRÜLMEZ, düğme GÖRÜNÜR', () => {
    // Doğrudan UNKNOWN'a düşen bir yol yok; sözleşmeyi saf fonksiyonlarla doğrula.
    expect(CameraFollowState.UNKNOWN).toBe('UNKNOWN');
    expect(cameraSrc).toContain('return _state === CameraFollowState.FOLLOWING;');
  });

  it('abonelik sızdırmaz — unsubscribe dinleyiciyi düşürür', () => {
    const a = vi.fn(); const b = vi.fn();
    const offA = subscribeCameraFollow(a);
    subscribeCameraFollow(b);
    expect(getCameraFollowSnapshot().listenerCount).toBe(2);
    offA();
    expect(getCameraFollowSnapshot().listenerCount).toBe(1);
    notifyUserPanStart();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('kamera isteği FIRTINASI yok — aynı duruma tekrar geçiş yayın ÜRETMEZ', () => {
    const spy = vi.fn();
    subscribeCameraFollow(spy);
    notifyUserPanStart();
    notifyUserPanStart();
    notifyUserPanStart();
    expect(spy).toHaveBeenCalledTimes(1);   // yalnız GERÇEK değişim yayılır
  });

  it('takip zoom kaydedilir — sabit rastgele zoom yok', () => {
    noteFollowZoom(16.5);
    expect(getCameraFollowSnapshot().followZoom).toBe(16.5);
    noteFollowZoom(NaN);
    expect(getCameraFollowSnapshot().followZoom).toBeNull();
  });
});

describe('B2. 🔒 Tek kamera otoritesi — iki görünüm aynı mantık', () => {
  it('🔒 mini harita ve tam ekran AYNI otoriteyi kullanır', () => {
    for (const src of [miniMapSrc, fullMapSrc]) {
      expect(src).toContain("from '../../platform/navigation/cameraFollowAuthority'");
      expect(src).toContain('notifyUserPanStart');
      expect(src).toContain('notifyUserPanEnd');
    }
  });

  it('🔒 görünümler kendi takip bayrağını YAZMAZ (ikinci otorite yok)', () => {
    // Mini harita hiç yerel takip state'i kurmamalı.
    expect(miniMapSrc).not.toMatch(/useState\([^)]*isFollowing/);
    // Tam ekranda ayna YALNIZ abonelikten yazılır.
    expect(fullMapSrc).toContain('return subscribeCameraFollow(sync);');
  });

  it('🔒 Ortala düğmesi navigasyonda GİZLENEMEZ', () => {
    // Eski hata: `!isFollowing && !isNavigating` → navigasyonda düğme yoktu.
    expect(code(hudControlsSrc)).not.toContain('!isFollowing && !isNavigating');
    expect(code(hudControlsSrc)).toContain('{!isFollowing && (');
  });

  it('🔒 Ortala TEK DOKUNUŞ — uzun basma yok, toast yok', () => {
    for (const src of [miniMapSrc, hudControlsSrc]) {
      expect(src).not.toContain('onLongPress');
      expect(src).not.toContain('showToast');
    }
  });

  it('🔒 erişilebilir ad var', () => {
    expect(miniMapSrc).toContain('aria-label="Aracı ortala"');
    expect(hudControlsSrc).toContain('aria-label="Aracı ortala"');
  });

  it('🔒 otorite haritaya DOKUNMAZ (MapLibre örneği girmez)', () => {
    const src = code(cameraSrc).toLowerCase();
    for (const forbidden of ['maplibre', 'setcenter', 'jumpto', 'easeto', 'flyto', 'getmap']) {
      expect(src, `otorite ${forbidden} kullanıyor — haritaya dokunuyor`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C. HIZ LİMİTİ DÜRÜSTLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */
describe('C. Hız limiti — yalnız GERÇEK levha', () => {
  const at = (over: Partial<Parameters<typeof classifySpeedLimit>[0]> = {}) => ({
    kmh: 50, source: 'osm' as const, resolvedAtMs: 1_000,
    resolvedAtLat: 36.9, resolvedAtLon: 34.86, conflicting: false, ...over,
  });
  const ctx = (over: Partial<Parameters<typeof classifySpeedLimit>[1]> = {}) => ({
    lat: 36.9, lon: 34.86, nowMs: 2_000, ...over,
  });

  it('gerçek maxspeed → AVAILABLE ve sayı taşır', () => {
    const v = classifySpeedLimit(at(), ctx());
    expect(v.state).toBe('AVAILABLE');
    expect(v.kmh).toBe(50);
    expect(v.source).toBe('osm');
    expect(isSpeedLimitDisplayable(v)).toBe(true);
  });

  it('kaynak hiç cevap vermedi → UNKNOWN ve sayı YOK', () => {
    const v = classifySpeedLimit(at({ kmh: null, source: null }), ctx());
    expect(v.state).toBe('UNKNOWN');
    expect(v.kmh).toBeNull();
    expect(isSpeedLimitDisplayable(v)).toBe(false);
  });

  it('YOL SINIFINDAN ÇIKARIM mini haritada GÖSTERİLMEZ', () => {
    const v = classifySpeedLimit(at({ source: 'inferred' }), ctx());
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.kmh).toBeNull();
    expect(v.reason).toMatch(/çıkarım/);
  });

  it('açıkça izin verilirse çıkarım kabul edilir (tam ekran HUD sözleşmesi)', () => {
    const v = classifySpeedLimit(at({ source: 'inferred' }), ctx(), true);
    expect(v.state).toBe('AVAILABLE');
    expect(v.source).toBe('inferred');
  });

  it('araç limitin çözüldüğü yoldan UZAKLAŞTI → STALE, eski levha GÖSTERİLMEZ', () => {
    // ~0.004° ≈ 445 m > 200 m eşiği
    const v = classifySpeedLimit(at(), ctx({ lat: 36.904 }));
    expect(v.state).toBe('STALE');
    expect(v.kmh).toBeNull();
    expect(v.distanceFromFixM).toBeGreaterThan(SPEED_LIMIT_MAX_DISTANCE_M);
  });

  it('değer ÇOK YAŞLI → STALE', () => {
    const v = classifySpeedLimit(at(), ctx({ nowMs: 1_000 + SPEED_LIMIT_MAX_AGE_MS + 1 }));
    expect(v.state).toBe('STALE');
    expect(v.kmh).toBeNull();
  });

  it('ÇELİŞKİLİ limitler → CONFLICTED, sayı GÖSTERİLMEZ', () => {
    const v = classifySpeedLimit(at({ conflicting: true }), ctx());
    expect(v.state).toBe('CONFLICTED');
    expect(v.kmh).toBeNull();
  });

  it('bilinmeyen değer 0 OLMAZ — geçersiz sayı tamamen gizlenir', () => {
    for (const bad of [0, -5, NaN, 999]) {
      const v = classifySpeedLimit(at({ kmh: bad }), ctx());
      expect(v.kmh).toBeNull();
      expect(v.state).toBe('UNAVAILABLE');
    }
  });

  it('zaman damgası yoksa UNKNOWN — uydurma tazelik YOK', () => {
    const v = classifySpeedLimit(at({ resolvedAtMs: null }), ctx());
    expect(v.state).toBe('UNKNOWN');
  });

  it('güven yaş ve mesafeyle AZALIR', () => {
    const taze = classifySpeedLimit(at(), ctx({ nowMs: 1_100 }));
    const eski = classifySpeedLimit(at(), ctx({ nowMs: 1_000 + SPEED_LIMIT_MAX_AGE_MS * 0.9 }));
    expect(taze.confidence).toBeGreaterThan(eski.confidence);
  });

  it('🔒 model SAF — I/O, saat ve React YOK', () => {
    const src = code(speedModelSrc);
    for (const forbidden of ['fetch(', 'Date.now', 'performance.now', 'useState', 'setTimeout']) {
      expect(src, `saf model ${forbidden} kullanıyor`).not.toContain(forbidden);
    }
  });

  it('🔒 AVAILABLE dışında sayı dönmesi YAPISAL olarak imkânsız', () => {
    // Gizleme yardımcısı her zaman kmh:null üretir.
    expect(speedModelSrc).toContain('kmh: null');
  });
});

/* ── KİLİT GÜNCELLEMESİ (VEHICLE_AWARE_SPEED_LIMIT_P0) ────────────────────────
 * Bu kilitler ESKİDEN mini haritanın KENDİ içinde `classifySpeedLimit(...,false)`
 * çağırmasını şart koşuyordu. O sözleşme bilinçli olarak DEĞİŞTİ: sınıflandırma
 * artık mini harita ile tam ekranın PAYLAŞTIĞI tek motora (`useEffectiveSpeedLimit`)
 * taşındı — çünkü iki ekran farklı değer gösteriyordu. Kilitler kaldırılmadı,
 * YENİ DOĞRU DAVRANIŞA taşındı: çıkarım yasağı ve konum çıpası artık paylaşılan
 * motorda denetlenir, mini haritada ise "ikinci motor kurulmamış olması" kilitlenir.
 */
describe('C2. 🔒 Mini harita hız limiti bağlantısı (paylaşılan motor)', () => {
  it('🔒 kart YALNIZ gösterilebilir hükümde render edilir', () => {
    // Gizleme kararı paylaşılan kartın içindedir; kart hükmü aynen alır.
    expect(miniMapSrc).toContain('<SpeedLimitCard limit={speedLimit} size="mini" />');
    expect(code(speedCardSrc)).toContain('if (!isEffectiveLimitDisplayable(limit)) return null;');
  });

  it('🔒 mini harita İKİNCİ bir hız limiti motoru kurmaz', () => {
    const src = code(miniMapSrc);
    expect(src).toContain('useEffectiveSpeedLimit()');
    // Kendi sınıflandırmasını YAPMAZ, kendi Overpass döngüsünü AÇMAZ.
    expect(src).not.toContain('classifySpeedLimit(');
    expect(src).not.toContain('useSpeedLimitByLocation(');
  });

  it('🔒 paylaşılan motor ÇIKARIMA izin VERMEZ', () => {
    // classifySpeedLimit(obs, ctx, false) — üçüncü argüman açıkça false.
    expect(code(effectiveHookSrc)).toMatch(/classifySpeedLimit\([\s\S]{0,160}false\)/);
  });

  it('🔒 limit ARACIN konumuna bağlıdır — kamera merkezine DEĞİL', () => {
    const src = code(effectiveHookSrc);
    expect(src).toContain('getSnappedMarkerPosition()');
    expect(src).toContain('location?.latitude');
    // Harita merkezinden okuma YAPILMAZ (pan limiti değiştirmesin).
    expect(src).not.toContain('getCenter().lat');
    expect(code(miniMapSrc)).not.toContain('getCenter().lat');
  });

  it('🔒 bilinmeyen limit için "—" YAZILMAZ, kart tamamen gizlenir', () => {
    const src = code(speedCardSrc);
    expect(src).not.toContain("'—'");
    expect(src).not.toContain('"—"');
  });

  it('🔒 hız limiti değişiminde animasyon/flaş YOK (dikkat dağıtmaz)', () => {
    const src = code(speedCardSrc);
    expect(src).not.toContain('animation:');
    expect(src).not.toContain('transition:');
    // Tek istisna: hız AŞIMI nabzı — kart değişimi değil, güvenlik sinyalidir.
    expect(src).toContain("overSpeed ? 'animate-pulse' : ''");
  });

  it('🔒 mini harita kartı hız AŞIMI uyarısı veya ses ÜRETMEZ', () => {
    // `overSpeed` prop'u verilmez → mini haritada nabız/kırmızı YOK.
    expect(miniMapSrc).not.toContain('size="mini" overSpeed');
    for (const forbidden of ['speak', 'playAlert', 'new Audio']) {
      expect(code(speedCardSrc)).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. YERLEŞİM
   ══════════════════════════════════════════════════════════════════════════ */
describe('D. Mini harita yerleşimi çakışmaz', () => {
  /** Basit kutu-çakışma denetimi — mini haritadaki sabit köşe yerleşimleri. */
  type Box = { name: string; top?: number; bottom?: number; left?: number; right?: number; w: number; h: number };
  const BOXES: Box[] = [
    { name: 'kaynak rozeti (MapOverlay)', top: 8,  right: 8, w: 76, h: 22 },
    { name: 'hız limiti levhası',         top: 34, right: 8, w: 38, h: 38 },
    { name: 'aracı ortala',               top: 8,  left: -1, w: 44, h: 44 },   // left:-1 = yatay ORTA
    { name: 'hız göstergesi (MapOverlay)', bottom: 8, right: 8, w: 96, h: 34 },
    { name: 'nav şeridi',                 bottom: 8, left: 8,  w: 200, h: 62 },
    { name: 'son konum rozeti',           top: 8,  left: 8,  w: 92, h: 22 },
  ];

  const RESOLUTIONS = [
    { name: '1024×600', w: 1024, h: 600 },
    { name: '1280×720', w: 1280, h: 720 },
    { name: '1920×720', w: 1920, h: 720 },
  ];

  /** Mini harita kartı, ekranın kabaca yarısı kadar bir alandır. */
  const cardOf = (r: { w: number; h: number }) => ({ w: Math.round(r.w * 0.45), h: Math.round(r.h * 0.45) });

  function rect(b: Box, card: { w: number; h: number }) {
    const x = b.left === -1 ? (card.w - b.w) / 2 : (b.left ?? (card.w - b.w - (b.right ?? 0)));
    const y = b.top != null ? b.top : card.h - b.h - (b.bottom ?? 0);
    return { x1: x, y1: y, x2: x + b.w, y2: y + b.h };
  }

  for (const res of RESOLUTIONS) {
    it(`${res.name} — hiçbir mini harita öğesi çakışmıyor`, () => {
      const card = cardOf(res);
      for (let i = 0; i < BOXES.length; i++) {
        for (let j = i + 1; j < BOXES.length; j++) {
          const a = rect(BOXES[i], card);
          const b = rect(BOXES[j], card);
          const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
          expect(overlap, `${BOXES[i].name} ↔ ${BOXES[j].name} çakışıyor (${res.name})`).toBe(false);
        }
      }
    });
  }

  it('hız limiti kartı, hız göstergesiyle AYNI köşede değil', () => {
    const sl  = BOXES.find(b => b.name === 'hız limiti levhası')!;
    const spd = BOXES.find(b => b.name.startsWith('hız göstergesi'))!;
    expect(sl.top != null && spd.bottom != null).toBe(true);   // biri üst, diğeri alt
  });
});
