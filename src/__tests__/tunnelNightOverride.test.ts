/**
 * tunnelNightOverride.test.ts — TÜNEL GECE ÖRTÜSÜ kilitleri.
 *
 * KİLİTLENEN KUSUR: `autoBrightnessService` tünel girişini/çıkışını ZATEN doğru
 * algılıyordu (gündüz + far açık → giriş, far kapalı → çıkış) ama `_tunnelMode`
 * modül içinde kalıyor, harita tarafından OKUNAMIYORDU → tünelde gündüz
 * haritası kalıyordu.
 *
 * DÖNGÜ TUZAĞI (bu PR'ın asıl riski): `settings.dayNightMode`e yazmak
 * `useDayNightManager.checkTime()` tarafından 60 sn'de geri alınır →
 * night → day → night → **flicker**. Bu yüzden örtü, ayarın ÜSTÜNDE ve
 * `setMapNight` hunisinin İÇİNDEDİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMapNight, getMapNight, getRequestedMapNight,
  setTunnelNightOverride, isTunnelNightOverrideActive,
  useMapSourceStore,
} from '../platform/mapSourceManager';
import { resolveLightBasemap } from '../platform/map/MapLayerManager';
import {
  resolveRouteColor, ROUTE_CASING_NORMAL, ROUTE_CASING_LIGHT_BASEMAP,
} from '../platform/map/core/routeColorModel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
/**
 * Yorumları söker.
 *
 * Kilitler YORUMA DEĞİL KODA bakmalıdır: gerekçe metinlerinde `dayNightMode`,
 * `#f7fabf` (PR-3b'nin ölçtüğü OSM zemini) gibi adların geçmesi NORMALDİR.
 * Metin araması bu turda üç kez yanlış alarm verdi.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const bridgeSrc  = read('src/platform/map/tunnelNightRuntime.ts');
const sourceSrc  = read('src/platform/mapSourceManager.ts');
const brightSrc  = read('src/platform/autoBrightnessService.ts');
const dayMgrSrc  = read('src/hooks/useDayNightManager.ts');
const colorSrc   = read('src/platform/map/core/routeColorModel.ts');

type Mode = 'road' | 'hybrid' | 'satellite';

/** Zemin kutbunu ürünün KENDİ durumundan sürer (ikinci sahte otorite YOK). */
function withMap<T>(night: boolean, mode: Mode, tunnel: boolean, fn: () => T): T {
  const prevMode = useMapSourceStore.getState().mapMode;
  try {
    setTunnelNightOverride(false);      // temiz başlangıç
    setMapNight(night);
    useMapSourceStore.setState({ mapMode: mode });
    setTunnelNightOverride(tunnel);
    return fn();
  } finally {
    setTunnelNightOverride(false);
    useMapSourceStore.setState({ mapMode: prevMode });
  }
}

beforeEach(() => {
  setTunnelNightOverride(false);
  setMapNight(false);
});

/* ══════════════ 1) ETKİN GÜN/GECE ══════════════ */

describe('Tünel örtüsü — etkin gün/gece', () => {
  it('gündüz + road + tünel YOK → GÜNDÜZ', () => {
    withMap(false, 'road', false, () => {
      expect(getMapNight()).toBe(false);
      expect(resolveLightBasemap()).toBe(true);
    });
  });

  it('gündüz + road + TÜNEL → GECE', () => {
    withMap(false, 'road', true, () => {
      expect(getMapNight(), 'tünelde harita gündüz kalmış').toBe(true);
      expect(resolveLightBasemap(), 'tünelde açık zemin sayılmış').toBe(false);
    });
  });

  it('gece + road + TÜNEL → GECE (değişiklik yok)', () => {
    withMap(true, 'road', true, () => {
      expect(getMapNight()).toBe(true);
      expect(resolveLightBasemap()).toBe(false);
    });
  });

  it('gece + road + tünel YOK → GECE', () => {
    withMap(true, 'road', false, () => {
      expect(getMapNight()).toBe(true);
    });
  });

  it('TÜNEL ÇIKIŞI istenen duruma DÖNER (gündüz geri gelir)', () => {
    setMapNight(false);
    setTunnelNightOverride(true);
    expect(getMapNight()).toBe(true);
    setTunnelNightOverride(false);
    expect(getMapNight(), 'tünelden çıkınca gündüze dönmedi').toBe(false);
    expect(getRequestedMapNight()).toBe(false);
  });

  it('Örtü altında saat GÜNDÜZ yazsa bile ETKİN gece KALIR (checkTime döngüsü kırık)', () => {
    setMapNight(false);
    setTunnelNightOverride(true);
    // `useDayNightManager.checkTime()` 60 sn'de bunu yapar:
    setMapNight(false);
    setMapNight(false);
    expect(getMapNight(), 'checkTime örtüyü sildi — FLICKER').toBe(true);
    // Tünelden çıkınca saatin istediği duruma dönülür.
    setTunnelNightOverride(false);
    expect(getMapNight()).toBe(false);
  });

  it('İstek örtü altında GÜNCELLENİR — çıkışta yeni isteğe dönülür', () => {
    setMapNight(false);
    setTunnelNightOverride(true);
    setMapNight(true);                    // tünel içindeyken akşam oldu
    expect(getMapNight()).toBe(true);
    setTunnelNightOverride(false);
    expect(getMapNight(), 'çıkışta akşam isteği kaybolmuş').toBe(true);
  });
});

/* ══════════════ 2) İDEMPOTENS ══════════════ */

describe('Tünel örtüsü — idempotent (gereksiz boyama yok)', () => {
  it('false → true TEK kez uygulanır', () => {
    setMapNight(false);
    expect(setTunnelNightOverride(true), 'ilk geçiş bildirilmedi').toBe(true);
    expect(setTunnelNightOverride(true), 'tekrar bildirim iş üretti').toBe(false);
    expect(setTunnelNightOverride(true)).toBe(false);
    expect(isTunnelNightOverrideActive()).toBe(true);
  });

  it('true → false TEK kez uygulanır', () => {
    setMapNight(false);
    setTunnelNightOverride(true);
    expect(setTunnelNightOverride(false)).toBe(true);
    expect(setTunnelNightOverride(false)).toBe(false);
  });

  it('GERÇEK GECEDE tünele girmek boyama GEREKTİRMEZ', () => {
    // Etkin değer zaten `true` → görsel değişim yok, boşuna repaint olmamalı.
    setMapNight(true);
    expect(setTunnelNightOverride(true), 'gecede gereksiz boyama tetiklendi').toBe(false);
    expect(getMapNight()).toBe(true);
    expect(isTunnelNightOverrideActive(), 'örtü durumu yine de kaydedilmeli').toBe(true);
  });

  it('Bozuk girdi örtüyü açmaz', () => {
    setMapNight(false);
    setTunnelNightOverride(undefined as unknown as boolean);
    expect(isTunnelNightOverrideActive()).toBe(false);
    expect(getMapNight()).toBe(false);
  });
});

/* ══════════════ 3) PR-3b SÖZLEŞMESİ ══════════════ */

describe('PR-3b uyumu — zemin kutbu ve rota rengi', () => {
  it('gündüz + satellite + tünel YOK → lightBasemap=false, BEYAZ casing', () => {
    withMap(false, 'satellite', false, () => {
      const light = resolveLightBasemap();
      expect(light).toBe(false);
      expect(resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: light }).casing)
        .toBe(ROUTE_CASING_NORMAL);
    });
  });

  it('gündüz + hybrid + tünel YOK → mevcut sözleşme KORUNUR', () => {
    withMap(false, 'hybrid', false, () => {
      const light = resolveLightBasemap();
      expect(light).toBe(false);
      expect(resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: light }).casing)
        .toBe(ROUTE_CASING_NORMAL);
    });
  });

  it('gündüz + satellite + TÜNEL → yine koyu zemin (beyaz casing korunur)', () => {
    withMap(false, 'satellite', true, () => {
      expect(getMapNight()).toBe(true);
      const light = resolveLightBasemap();
      expect(light, 'uyduda açık zemin sayılmış').toBe(false);
      expect(resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: light }).casing)
        .toBe(ROUTE_CASING_NORMAL);
    });
  });

  it('TÜNEL ÇIKIŞINDA gündüz+road koyu mürekkep casing GERİ GELİR', () => {
    withMap(false, 'road', true, () => {
      expect(resolveLightBasemap()).toBe(false);       // tünelde gece
    });
    // withMap finally örtüyü kaldırdı; mod road, istek gündüz.
    useMapSourceStore.setState({ mapMode: 'road' });
    setMapNight(false);
    expect(resolveLightBasemap()).toBe(true);
    expect(resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: true }).casing)
      .toBe(ROUTE_CASING_LIGHT_BASEMAP);
  });

  it('🔒 routeColorModel\'e YENİ RENK eklenmedi', () => {
    /* KODA bakılır: PR-3b'nin ölçüm gerekçeleri (OSM zemin renkleri `#f7fabf`,
       `#e892a2` …) YORUMLARDA geçer ve palet değildir. */
    const hexes = new Set(codeOf(colorSrc).match(/#[0-9a-fA-F]{6}/g) ?? []);
    // PR-3a/3b paleti: beyaz · koyu mürekkep · halo mavisi · amber + gradient üç durak.
    //
    // #619 — KİLİT BİLİNÇLİ GÜNCELLENDİ (KALDIRILMADI): gece çekirdeği için üç
    // durak eklendi. Gerekçe ÖLÇÜMDÜR — tema-bağımsız gradient gece yolundan
    // yalnız 1,18 kontrastla ayrışıyordu (kullanıcı: *"gece rota böyle karanlık
    // oluyor"*). Yeni duraklar `routeNightContrast.test.ts` içinde zemin/yol/
    // kılıf eşiklerine bağlandı; palet SERBEST BÜYÜMEZ, bu liste hâlâ kapıdır.
    const allowed = new Set([
      '#ffffff', '#0A0C10', '#4285f4', '#f59e0b',
      // RC-2026.08.24-OEM — GÜNDÜZ çekirdeği: doygun OEM mavi → derin mavi →
      // camgöbeği. Eski `#1A73E8`/`#4F46E5`/`#10b981` KODDAN ÇIKTI (yalnız
      // gerekçe yorumlarında kaldı) ve bu liste bilinçli olarak yalnız KODDAKİ
      // renkleri taşır — kapı dar kalsın.
      '#006CFF', '#0057D9', '#00A6FF',
      // #619 → #622 → RC-2026.08.24-OEM gece çekirdeği — renk kimliği korunur
      // (mavi → indigo → camgöbeği). Orta durak `#969CFF` ile geldi ama #619'un
      // gece-yolu eşiğini (≥1,9) 1,872 ile kaçırıyordu; ÖLÇÜLEREK `#9CA2FF`ye
      // açıldı (yol 1,989) — palet geri alınmadı, yalnız eşiğe getirildi.
      '#52A0F0', '#8E8CF2', '#25BFAE',
    ]);
    for (const h of hexes) {
      expect(allowed.has(h), `rota paletine yeni renk girmiş: ${h}`).toBe(true);
    }
  });
});

/* ══════════════ 4) YAPISAL KİLİTLER ══════════════ */

describe('🔒 YAPISAL — tek otorite, yeni dedektör yok, ayar yazılmıyor', () => {
  it('🔒 `settings.dayNightMode` TÜNEL tarafından YAZILMAZ', () => {
    for (const [src, name] of [[bridgeSrc, 'köprü'], [sourceSrc, 'mapSourceManager']] as const) {
      const code = codeOf(src);
      expect(code, `${name} ayara yazıyor`).not.toMatch(/dayNightMode/);
      expect(code, `${name} store'a yazıyor`).not.toMatch(/updateSettings/);
    }
  });

  it('🔒 `useDayNightManager` DEĞİŞTİRİLMEDİ (60 sn checkTime aynen)', () => {
    expect(dayMgrSrc).toContain('const interval = setInterval(checkTime, 60_000);');
    expect(dayMgrSrc, 'gün/gece yöneticisine tünel bilgisi sızmış').not.toMatch(/tunnelNight|TunnelOverride/);
  });

  it('🔒 YENİ TÜNEL DEDEKTÖRÜ yok — karar autoBrightnessService\'in', () => {
    expect(bridgeSrc).toContain('onTunnelModeChange');
    expect(bridgeSrc, 'köprüye kendi tespit mantığı girmiş')
      .not.toMatch(/headlight|lux|sunTimes|calcPhase|isDaytime/i);
  });

  it('🔒 GPS kaybı TÜNEL KANITI değildir', () => {
    for (const [src, name] of [[bridgeSrc, 'köprü'], [sourceSrc, 'mapSourceManager']] as const) {
      expect(src, `${name} GPS'e bağlanmış`)
        .not.toMatch(/gpsService|onGPSLocation|isDeadReckoningActive|drState|GPS_STALE/);
    }
  });

  it('🔒 YENİ TIMER / POLLING yok', () => {
    expect(bridgeSrc).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
    // Yayın mevcut OBD far callback'inde olur; autoBrightness'a yeni timer eklenmemeli.
    const intervals = brightSrc.match(/setInterval\(/g) ?? [];
    expect(intervals.length, 'autoBrightnessService\'e yeni interval eklenmiş').toBe(0);
  });

  it('🔒 İKİNCİ gün/gece otoritesi doğmadı — örtü TEK huninin içinde', () => {
    expect(sourceSrc).toContain('function _recomputeMapNight()');
    expect(sourceSrc).toMatch(/export function setMapNight\(night: boolean\): void \{\s*_mapNightRequested = night;/);
    // Köprü doğrudan `_mapNight` yazamaz; yalnız örtü setter'ını kullanır.
    expect(bridgeSrc).toContain('setTunnelNightOverride(');
    expect(bridgeSrc, 'köprü etkin değeri doğrudan yazıyor').not.toMatch(/setMapNight\(/);
  });

  it('🔒 Tünel durumu TEK yazma noktasından yayınlanır', () => {
    /* Bildirim (`let _tunnelMode = false;`) yazma noktası SAYILMAZ; sayılan
       şey durumu DEĞİŞTİREN atamalardır ve o tek yer `_setTunnelMode`tir.
       İkinci bir atama eklenirse yayın atlanır ve harita örtüde ASILI kalır. */
    const code = codeOf(brightSrc).replace(/let\s+_tunnelMode\s*=\s*false;/, '');
    const writes = code.match(/_tunnelMode\s*=\s*(?!=)/g) ?? [];
    expect(writes.length, 'tünel durumu birden fazla yerden yazılıyor').toBe(1);
    expect(code).toContain('function _setTunnelMode(');
    // Ve o tek atama gerçekten yayın yapan fonksiyonun içinde olmalı.
    const setter = code.slice(code.indexOf('function _setTunnelMode('));
    expect(setter.slice(0, 300)).toMatch(/_tunnelMode\s*=\s*active/);
  });

  it('🔒 Köprü tek dinleyici kurar ve söker (zero-leak)', () => {
    const subs = bridgeSrc.match(/onTunnelModeChange\(/g) ?? [];
    expect(subs.length).toBe(1);
    expect(bridgeSrc).toContain('_unsub()');
    // Sökülürken örtü de kalkmalı — asılı gece haritası bırakmaz.
    expect(bridgeSrc).toMatch(/stopTunnelNightRuntime[\s\S]*setTunnelNightOverride\(false\)/);
  });

  it('🔒 Kamera · DR · Trip · Mavi yollarına DOKUNULMADI', () => {
    expect(bridgeSrc).not.toMatch(/cameraEngine|navigationSessionRuntime|tripSession|companion|locationContext/i);
  });

  it('🔒 FullMapView / MiniMapWidget değiştirilmedi', () => {
    for (const p of ['src/components/map/FullMapView.tsx', 'src/components/map/MiniMapWidget.tsx']) {
      expect(read(p), `${p} tünel bilgisine bağlanmış`).not.toMatch(/tunnel/i);
    }
  });
});
