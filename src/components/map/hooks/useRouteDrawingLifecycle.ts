/**
 * useRouteDrawingLifecycle — P0-NAV-02 · rota ÇİZİM yaşam döngüsü.
 *
 * ── NE TAŞINDI ────────────────────────────────────────────────────────────
 * `FullMapView` içindeki **bitişik beş efekt**, olduğu gibi:
 *   1. `routeReady` bayrağı (rota geometrisi geldi mi)
 *   2. rota çizgisini çiz/güncelle (stil yeniden yükleniyorsa BEKLE)
 *   3. failsafe deadlock kurtarma (SEL_LAYER 1,2 sn kayıpsa yeniden inşa)
 *   4. dönüş odağı (yaklaşırken vurgula, adım ilerleyince temizle)
 *   5. rota başlangıcı parlaması
 *
 * ── DAVRANIŞ DEĞİŞMEDİ (pazarlıksız) ──────────────────────────────────────
 * Beş efekt de kaynakta ARDIŞIKTI ve bu hook `FullMapView` içinde tam olarak
 * o konumda çağrılır → efekt BİLDİRİM SIRASI birebir korunur. Gövdeler,
 * eşikler (200 m odak · 1200 ms deadlock · 400 ms tarama · 700 ms parlama) ve
 * bağımlılık dizileri harfi harfine aynıdır. Tek fark: bağımlılık dizilerine
 * KARARLI ref nesneleri eklendi (`mapRef` vb.) — kimlikleri hiç değişmediği
 * için efektlerin yeniden koşma anları DEĞİŞMEZ, yalnız lint sözleşmesi tamamlanır.
 *
 * ── ROTA MOTORUNA DOKUNULMADI ─────────────────────────────────────────────
 * `routingService` · `navigationSessionRuntime` · `navigation/core/*` bu turda
 * ELLENMEDİ. Burada yalnız ÇİZİM yaşar; rota kararı değil.
 */

import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import {
  setRouteGeometry, setTurnFocus, clearTurnFocus,
} from '../../../platform/mapService';
import { getRouteState, notifyStyleChange, type RouteStep } from '../../../platform/routingService';
import {
  applyRouteEmphasis, invalidateRouteEmphasis, routeConfidenceFrom,
} from '../../../platform/map/MapLayerManager';
import { mapMutexWindow, routeHash, type MapRef } from './_mapSurfaceInternals';
/* ARCH-06/F3 — YALNIZ SAYAÇ. Rota kimliği/dedup mantığı DEĞİŞMEDİ. */
import { bumpPerf } from '../../../platform/perf/perfCounters';

/** Çizim için gereken rota alanları — `RouteState`in okunan alt kümesi. */
export interface RouteDrawingSlice {
  readonly geometry: [number, number][] | null;
  readonly alternatives: [number, number][][];
  readonly altRealIndices: number[];
  readonly altDurations: number[];
  readonly totalDurationSeconds: number;
  readonly steps: RouteStep[];
  readonly currentStepIndex: number;
  readonly distanceToNextTurnMeters: number;
  /** Rotayı hangi katman üretti — `'straight-line'` ise GERÇEK ROTA DEĞİLDİR. */
  readonly serverUsed: string | null;
  /** Doğrulama hükmü; yoksa `null` → fail-closed `DEGRADED` sayılır. */
  readonly validationVerdict: 'VALID' | 'DEGRADED' | 'REJECTED' | 'UNKNOWN' | null;
}

export interface RouteDrawingLifecycleOptions {
  readonly mapRef: RefObject<MapRef | null>;
  readonly mountedRef: RefObject<boolean>;
  readonly route: RouteDrawingSlice;
  readonly mapStatus: string;
  readonly styleKey: number;
  readonly navStatus: string;
  readonly isNavigating: boolean;
  readonly isPreview: boolean;
  /* Stil/çizim arasında paylaşılan durum — sahipleri `FullMapView`de kalır. */
  readonly styleChangingRef: RefObject<boolean>;
  readonly lastAppliedRef: RefObject<{ hash: string; styleKey: number; navStatus: string } | null>;
  readonly routeGeometryRef: RefObject<[number, number][] | null>;
  readonly routeAltRef: RefObject<[number, number][][]>;
  readonly routeAltIdxRef: RefObject<number[]>;
  readonly routeAltDursRef: RefObject<number[]>;
  readonly routeMainDurRef: RefObject<number>;
  readonly routeStepsRef: RefObject<RouteStep[]>;
  readonly prevStepIndexRef: RefObject<number>;
  readonly setRouteReady: Dispatch<SetStateAction<boolean>>;
  readonly setRouteStartFlash: Dispatch<SetStateAction<boolean>>;
  readonly pushDebug: (label: string, data: unknown) => void;
}

export function useRouteDrawingLifecycle(o: RouteDrawingLifecycleOptions): void {
  const {
    mapRef, mountedRef, route, mapStatus, styleKey, navStatus, isNavigating, isPreview,
    styleChangingRef, lastAppliedRef, routeGeometryRef, routeAltRef, routeAltIdxRef,
    routeAltDursRef, routeMainDurRef, routeStepsRef, prevStepIndexRef,
    setRouteReady, setRouteStartFlash, pushDebug,
  } = o;

  // routeReady: rota geometrisi hesaplandı mı? → buton hemen açılır (harita render beklenmez)
  useEffect(() => {
    if (route.geometry && route.geometry.length >= 2) {
      setRouteReady(true);
    }
  }, [route.geometry, setRouteReady]);

  // Draw / update route line — only when READY and style is not reloading.
  // styleChangingRef guard: MapLibre wipes all sources/layers on setStyle(); applying
  // route geometry before style.load completes throws "source does not exist" errors.
  // notifyStyleChange(false) → styleKey increments → this effect re-runs automatically.
  useEffect(() => {
    if (!route.geometry) return;
    // Ref'leri mapStatus'ten bağımsız her zaman güncelle.
    // _onStyleReady ve webglcontextrestored callback'leri bu ref'lerden okur;
    // harita LOADING iken gelen yeni geometri kaybolmamalı.
    routeGeometryRef.current = route.geometry;
    routeAltRef.current      = route.alternatives;
    routeAltIdxRef.current   = route.altRealIndices;
    routeAltDursRef.current  = route.altDurations;
    routeMainDurRef.current  = route.totalDurationSeconds;
    routeStepsRef.current    = route.steps;

    // Ground-truth READY: mapStatus bayrağı bir style-switch'te false'ta TAKILABİLİR
    // (style.load kaçırılırsa). O durumda harita render olur (tile/marker/ETA çalışır) ama
    // rota çizimi hiç tetiklenmezdi → "çizgi hiçbir yerde yok". Bayrak takılıysa bile stil
    // gerçekten yüklüyse (isStyleLoaded) çizime devam et.
    if (!mapRef.current || (mapStatus !== 'READY' && !mapRef.current.isStyleLoaded())) return;
    if (styleChangingRef.current) return; // style reload in-flight — wait for notifyStyleChange(false)
    const hash = routeHash(route.geometry);
    const last = lastAppliedRef.current;
    const styleKeyChanged = !last || last.styleKey !== styleKey;
    if (!styleKeyChanged && last && last.hash === hash && last.navStatus === navStatus) {
      /* ARCH-06/F3: aynı rota kimliği → TAM geometri yeniden kurulumu ATLANDI.
         F3'ün kabul ölçütü tam olarak budur: ilerleme güncellemesi geometri
         yeniden kurmaz. Sayaç bunun ÖLÇÜLEBİLİR kanıtıdır. */
      bumpPerf('map.routeGeometryDedupSkip');
      return;
    }
    lastAppliedRef.current = { hash, styleKey, navStatus };
    setRouteGeometry(mapRef.current, route.geometry, route.alternatives, route.altRealIndices, route.altDurations, route.totalDurationSeconds, route.steps);
    pushDebug('ROUTE_GEOMETRY_SET', { pts: route.geometry?.length, first: route.geometry?.[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [route.geometry, route.alternatives, route.altRealIndices, mapStatus, styleKey, navStatus]);

  // Failsafe Deadlock Recovery — SEL_LAYER 3 saniye boyunca kayıpsa rota yeniden inşa edilir.
  // Senaryo: Android low-memory → layer silindi ama style READY → setRouteGeometry hiç tetiklenmedi.
  useEffect(() => {
    // mapStatus gate'i KASTEN kaldırıldı: takılı bayrak failsafe'i de devre dışı bırakıyordu.
    // İçerideki map.isStyleLoaded() ground-truth kontrolü hazır olup olmadığını zaten yönetir.
    if (!isNavigating) return;
    let missingStart: number | null = null;
    const t = setInterval(() => {
      const map = mapRef.current;
      // Bekleme koşulu artık BAYRAĞA değil, ground-truth'a (isStyleLoaded) bakar.
      // styleChangingRef burada KASTEN yok sayılır: takılı bir bayrak rota çizimini
      // kalıcı bloke ediyorsa ("hiç çizilmiyor, beklesen de gelmiyor") deadlock'u burada kırarız.
      if (!map || !mountedRef.current || !map.isStyleLoaded()) {
        missingStart = null;
        return;
      }
      if (map.getLayer('selected-route-layer')) {
        missingStart = null;
        return;
      }
      if (missingStart === null) {
        missingStart = performance.now();
        return;
      }
      if (performance.now() - missingStart >= 1200) {
        missingStart = null;
        // Stil yüklü ama rota katmanı 1.2sn+ yok → çizimi bloke eden takılı/bayat
        // style-changing guard'larını (component ref + module _isStyleChanging) zorla temizle.
        // Stil zaten yüklü olduğundan setRouteGeometry güvenli — "source does not exist" riski yok.
        if (styleChangingRef.current) {
          styleChangingRef.current = false;
          mapMutexWindow().__MAP_MUTEX__ = false;
        }
        notifyStyleChange(false); // module _isStyleChanging=false → setRouteGeometry erken-return etmez
        const geom = routeGeometryRef.current ?? getRouteState().geometry;
        if (geom) {
          setRouteGeometry(map, geom, routeAltRef.current, routeAltIdxRef.current, routeAltDursRef.current, routeMainDurRef.current, routeStepsRef.current);
          lastAppliedRef.current = null;
        }
      }
    }, 400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [isNavigating]);

  // Turn focus: highlight next turn when approaching, clear on step advance
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route.steps.length) return;

    // Step just advanced → turn completed, clear focus
    if (route.currentStepIndex !== prevStepIndexRef.current) {
      prevStepIndexRef.current = route.currentStepIndex;
      clearTurnFocus();
      return;
    }

    const nextIdx  = Math.min(route.currentStepIndex + 1, route.steps.length - 1);
    const nextStep = route.steps[nextIdx];
    const dist     = route.distanceToNextTurnMeters;

    if (dist > 0 && dist < 200 && nextStep && nextIdx > route.currentStepIndex) {
      const [nLon, nLat] = nextStep.coordinate;
      setTurnFocus(map, nLon, nLat);
    } else {
      clearTurnFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bağımlılık dizisi TAŞIMADAN ÖNCEKİYLE birebir aynı (davranış kilidi)
  }, [route.currentStepIndex, route.distanceToNextTurnMeters, route.steps.length]);

  // Route start micro-interaction flash
  useEffect(() => {
    if (!isPreview) return;
    setRouteStartFlash(true);
    const t = setTimeout(() => setRouteStartFlash(false), 700);
    return () => clearTimeout(t);
  }, [isPreview, setRouteStartFlash]);

  /* ── ROTA VURGU SÖZLEŞMESİ (P0-NAV-03) ───────────────────────────────────
   * Ana rota / alternatif baskınlığı ve KESİNLİK İDDİASI. Güven sınıfı yeni
   * bir hüküm DEĞİLDİR: `serverUsed` (routingService) ile doğrulama hükmü
   * (`routeValidationModel`) mevcut kararlarından TÜRETİLİR.
   *
   * Düz-hat yedeğinde rota KESİK çizilir ve akış animasyonu KAPANIR — olmayan
   * bir yolda ilerleme animasyonu göstermek görsel bir yalandır. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route.geometry) return;
    invalidateRouteEmphasis();          // stil/rota değişti → yeniden yaz
    try {
      applyRouteEmphasis(
        map,
        routeConfidenceFrom(route.serverUsed, route.validationVerdict),
        isNavigating,
        route.alternatives.length,
      );
    } catch { /* fail-soft — vurgu rota ÇİZİMİNİ asla düşürmez */ }
  }, [
    mapRef, route.geometry, route.serverUsed, route.validationVerdict,
    route.alternatives.length, isNavigating, styleKey, mapStatus,
  ]);
}
