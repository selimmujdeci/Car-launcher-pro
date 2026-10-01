/**
 * VisionOverlay — AR navigasyon katmanı: kamera + yola oturan rota + ADAS işaretleri.
 *
 * Katmanlar (z-index sırası, kapsayıcı `--z-map-vision` içinde):
 *   <video>   — kamera; yalnız HYBRID modunda görünür (görüntüleme öğesi; işleme
 *               visionCore'un kendi gizli öğesindedir — ADAS ile paylaşılır)
 *   kenar karartması — üst/alt HUD'ın kamera üstünde okunması için
 *   <canvas>  — rota halısı + chevron'lar + ADAS mekânsal işaretleri
 *   manevra işareti (DOM) — dönüş noktasında havada duran ok + mesafe
 *   AR düğmesi · bildirim — her zaman en üstte
 *
 * ── KAMERA NE ZAMAN AÇILIR (kök neden 2026-10-01) ───────────────────────────
 * Kamera kullanıcının NİYETİNE bağlıdır (`userPreference === 'hybrid'`), modun
 * kendisine DEĞİL. Eski hâl kilitleniyordu: mod "kamera aktifse HYBRID" diyor,
 * kamera "mod HYBRID ise aç" diyordu → AR düğmesine basınca HİÇBİR ŞEY olmuyordu
 * (ADAS kamerayı zaten açmış değilse). Şimdi: niyet → kamera açılır → vision
 * `active` olur → modeController HYBRID'e geçer → görüntü belirir.
 *
 * ── ADAS UYUMU ──────────────────────────────────────────────────────────────
 *   - Tek kamera, kiralama ile paylaşılır (`startVision(video)` = sahip 'ar').
 *     AR'ı kapatmak ADAS'ın kamerasını KESMEZ; tersi de.
 *   - Kamera pozu ADAS'ın ÖLÇTÜĞÜ ufuktan alınır (varsa) — iki katman aynı yolu
 *     aynı geometriyle görür.
 *   - Öndeki araç / şerit ayrılma YALNIZ ADAS hükmüyle ve tazelik kapısıyla
 *     çizilir; AR kendi şerit uyarısını ÜRETMEZ. Uyarı metni/sesi SafetyOverlay'de.
 *
 * ── PERFORMANS ──────────────────────────────────────────────────────────────
 *   Çizim döngüsü yalnız AR GÖRÜNÜRKEN yaşar (görünmezken rAF YOK — idle harita
 *   saha ölçümü 2026-07-12). Kare bütçesi AdaptiveRuntime moduna göre 30/20/10 fps.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';

/** HYBRID'den çıkınca kameranın açık tutulacağı pay (ms). Mod geçişleri
 *  arasında donanımı yeniden açmanın gecikmesini gizler; süre dolunca
 *  kamera BIRAKILIR (bkz. ısınma ölçümü 2026-08-03). */
const CAMERA_RELEASE_GRACE_MS = 15_000;

import {
  startVision,
  stopVision,
  useVisionStore,
  getVisionTrackInfo,
} from '../../platform/vision';
import {
  useNavMode,
  useTransitioning,
  useUserVisionPref,
  setUserVisionPreference,
  useModeSync,
} from '../../platform/modeController';
import {
  startARAlignment,
  stopARAlignment,
  updateCompassHeading,
  updateRouteBearing,
  getARAlignment,
} from '../../platform/arAlignmentService';
import { useRouteState } from '../../platform/routingService';
import { useAdasStore, type AdasOverall } from '../../platform/adas/adasStore';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { ManeuverArrow } from './hud/ManeuverArrow';
import { splitManeuverDistance } from './hud/formatManeuverDistance';
import {
  AR_MANEUVER_MAX_FWD_M,
  AR_MANEUVER_MIN_FWD_M,
  AR_ORIGIN_RESET_M,
  billboardScale,
  buildArcLengths,
  chevronAnchors,
  chevronPolygon,
  classifyCameraError,
  clipPathForward,
  coverFit,
  extractPathAhead,
  extrapolateFix,
  isDeviceBackCamera,
  makeGroundProjector,
  normToScreen,
  resolveArPose,
  ribbonEdges,
  routeEvidence,
  smoothPose,
  toEnu,
  toVehicleFrame,
  type ArCameraNotice,
  type ArEvidenceReason,
  type DisplayPose,
  type GroundProjector,
  type LocalPt,
  type PathAhead,
  type SceneOrigin,
  type ScreenPt,
} from './ar/arScene';
import { paintChevrons, paintLaneEdge, paintLeadBracket, paintRibbon } from './ar/arPainter';

/* ─────────────────────────────────────────────────────────────── */
/* PROPS                                                           */
/* ─────────────────────────────────────────────────────────────── */

interface VisionOverlayProps {
  /** AR katmanı etkin: navigasyon sürüyor YA DA kullanıcı kamerayı açtı. */
  isNavigating: boolean;
  currentLat: number | null;
  currentLon: number | null;
  /** GPS rotası (°, kuzeyden saat yönü). `null` = bilinmiyor (sahte 0 VERİLMEZ). */
  headingDeg: number | null;
  /** GPS hızı (m/s) — yalnız çizim pozunu ileri kestirmek için. */
  speedMps: number | null;
  /** Konum doğruluğu (m) — AR rotasının kanıt kapısı. */
  accuracyM: number | null;
  /** Aktif rota [lon, lat][] */
  routeGeometry: [number, number][] | null;
}

/* ─────────────────────────────────────────────────────────────── */
/* SAHNE SABİTLERİ                                                 */
/* ─────────────────────────────────────────────────────────────── */

/** Halı genişliği (yarım) — şeritten dar: yolu boyamaz, yolu GÖSTERİR. */
const RIBBON_HALF_WIDTH_M = 1.1;
const CHEVRON_SPACING_M = 8;
/** Kaputun hemen önü ve ufuk tarafı kırpma bandı. */
const PATH_NEAR_M = 3.5;
const PATH_FAR_M = 140;
/** ADAS kalp atışı bundan eskiyse işaretler ÇİZİLMEZ (donmuş kare ≠ canlı hüküm). */
const ADAS_FRESH_MS = 1_000;
const ADAS_RUNNING: ReadonlySet<AdasOverall> = new Set(['ACTIVE', 'DEGRADED', 'CALIBRATING']);
/** Kanıt nedeni bu kadar sürerse sürücüye söylenir (anlık titreşim gösterilmez). */
const REASON_SHOW_AFTER_MS = 1_200;

function frameIntervalMs(): number {
  const m = runtimeManager.getMode();
  if (m === RuntimeMode.SAFE_MODE) return 100;
  if (m === RuntimeMode.POWER_SAVE || m === RuntimeMode.BASIC_JS) return 50;
  return 33;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Derinlik solması: kaput önünde belirir, ufka doğru kaybolur. */
function depthFade(fwd: number): number {
  return clamp01((fwd - PATH_NEAR_M) / 3.5) * clamp01((130 - fwd) / 60);
}

/** Çokgenin tüm köşeleri projekte olursa ekran noktaları, yoksa null. */
function projectAll(project: GroundProjector, pts: readonly LocalPt[]): ScreenPt[] {
  const out: ScreenPt[] = [];
  for (const p of pts) {
    const s = project(p.right, p.fwd);
    if (!s) break;
    out.push(s);
  }
  return out;
}

const NOTICE_TEXT: Readonly<Record<ArCameraNotice, { title: string; detail: string }>> = {
  DENIED:    { title: 'Kamera izni gerekli', detail: 'Sistem ayarlarından bu uygulamaya kamera izni verin.' },
  NOT_FOUND: { title: 'Kamera bulunamadı', detail: 'Cihaza bağlı bir kamera algılanmadı.' },
  BUSY:      { title: 'Kamera kullanımda', detail: 'Başka bir uygulama kamerayı kullanıyor olabilir.' },
  LOST:      { title: 'Kamera bağlantısı kesildi', detail: 'Harita görünümüne dönüldü.' },
  FAILED:    { title: 'Kamera açılamadı', detail: 'Tekrar denemek için AR’a dokunun.' },
};

const REASON_TEXT: Readonly<Record<Exclude<ArEvidenceReason, null>, string>> = {
  NO_FIX:       'Konum bekleniyor',
  STALE_FIX:    'Konum güncellenmiyor',
  LOW_ACCURACY: 'Konum doğruluğu düşük — AR rotası gizlendi',
  OFF_ROUTE:    'Rota dışındasınız',
  NO_HEADING:   'Yön belirleniyor',
  CAMERA_TILT:  'Kamerayı yola doğrultun',
};

/** Apple malzemesi: koyu cam, ince saç teli kenar. Harita ve kamera üstünde okunur. */
const GLASS: CSSProperties = {
  background: 'rgba(28,28,30,0.66)',
  border: '0.5px solid rgba(255,255,255,0.16)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  boxShadow: '0 8px 28px rgba(0,0,0,0.24)',
};

/* ─────────────────────────────────────────────────────────────── */
/* AR DÜĞMESİ                                                      */
/* ─────────────────────────────────────────────────────────────── */

type PillState = 'off' | 'starting' | 'on';

const ArPill = memo(function ArPill({ state, onToggle }: { state: PillState; onToggle: () => void }) {
  const on = state === 'on';
  const starting = state === 'starting';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={state !== 'off'}
      aria-label={on ? 'AR görünümünü kapat' : starting ? 'Kamera açılıyor — iptal' : 'AR görünümünü aç'}
      className="flex items-center gap-2 h-11 pl-3.5 pr-4 rounded-full select-none active:scale-[0.96]"
      style={{
        ...GLASS,
        background: on ? 'rgba(10,132,255,0.94)' : GLASS.background,
        border: on ? '0.5px solid rgba(255,255,255,0.30)' : GLASS.border,
        color: '#ffffff',
        transition: 'background-color 240ms ease, transform 120ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {starting
        ? <Loader2 className="w-[18px] h-[18px] animate-spin" strokeWidth={2.4} />
        : <Camera className="w-[18px] h-[18px]" strokeWidth={2.2} />}
      <span className="text-[15px] font-semibold tracking-tight leading-none">
        {starting ? 'Açılıyor' : 'AR'}
      </span>
      {on && <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ boxShadow: '0 0 6px rgba(255,255,255,0.9)' }} />}
    </button>
  );
});

/* ─────────────────────────────────────────────────────────────── */
/* ANA BİLEŞEN                                                     */
/* ─────────────────────────────────────────────────────────────── */

interface LiveFix {
  lat: number; lon: number;
  courseDeg: number | null; speedMps: number | null; accuracyM: number | null;
  atMs: number;
}

export const VisionOverlay = memo(function VisionOverlay({
  isNavigating,
  currentLat,
  currentLon,
  headingDeg,
  speedMps,
  accuracyM,
  routeGeometry,
}: VisionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const billboardRef = useRef<HTMLDivElement>(null);

  const mode          = useNavMode();
  const transitioning = useTransitioning();
  const userPref      = useUserVisionPref();
  const route         = useRouteState();

  // VisionState + güven → ModeController
  useModeSync();

  const isHybrid   = mode === 'HYBRID_AR_NAVIGATION';
  /** Kullanıcının NİYETİ — kamerayı bu açar (mod değil). */
  const wantCamera = isNavigating && userPref === 'hybrid';
  /** AR gerçekten ekranda — çizim döngüsü yalnız bu durumda yaşar. */
  const arVisible  = isNavigating && isHybrid;
  const pillState: PillState = !wantCamera ? 'off' : isHybrid ? 'on' : 'starting';

  const [notice, setNotice] = useState<ArCameraNotice | null>(null);
  const [reason, setReason] = useState<ArEvidenceReason>(null);

  /* ── Hizalama sensörleri: navigasyon boyunca açık (ucuz, izinsiz; AR'a
        geçildiğinde hazır olmalı). ── */
  useEffect(() => {
    if (!isNavigating) {
      stopARAlignment();
      return;
    }
    startARAlignment();
    return () => { stopARAlignment(); };
  }, [isNavigating]);

  /* ── Kamera kirası: NİYETE bağlı ──────────────────────────────────────
   * Niyet yokken kamera kısa bir paydan sonra BIRAKILIR (görünmeyen kamera
   * için donanım çalıştırılmaz — ısınma ölçümü 2026-08-03). Niyet varken
   * kira alınır; ADAS kamerayı zaten açtıysa yalnız görüntü bağlanır. */
  useEffect(() => {
    if (!isNavigating) { stopVision(); return; }

    if (!wantCamera) {
      const t = setTimeout(() => { stopVision(); }, CAMERA_RELEASE_GRACE_MS);
      return () => clearTimeout(t);
    }

    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    // Kamera hatası navigasyonu ASLA etkilemez — yalnız neden söylenir, AR kapanır.
    startVision(video).catch((err: unknown) => {
      if (cancelled) return;
      setNotice(classifyCameraError(err));
      setUserVisionPreference('standard');
    });
    return () => { cancelled = true; };
  }, [isNavigating, wantCamera]);

  /* Unmount: pay zamanlayıcısı temizlenince kamera açık kalmasın. */
  useEffect(() => () => { stopVision(); }, []);

  /* Akış sürüş sırasında koparsa (USB çekildi, sistem kesti): dürüstçe söyle. */
  useEffect(() => {
    if (!wantCamera) return;
    return useVisionStore.subscribe((s, p) => {
      if (s.state === 'error' && (p.state === 'active' || p.state === 'degraded')) {
        setNotice('LOST');
        setUserVisionPreference('standard');
      }
    });
  }, [wantCamera]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6_000);
    return () => clearTimeout(t);
  }, [notice]);

  /* ── Düğme: İKİ durumlu (KAPALI ↔ AÇIK). 'auto' yalnız sistemin kendi
        kararıdır, kullanıcı tıklamasıyla ARAYA GİRMEZ (saha 2026-08-03). ── */
  const handleToggle = useCallback(() => {
    setNotice(null);
    if (wantCamera) setUserVisionPreference('standard');
    else setUserVisionPreference('hybrid');
  }, [wantCamera]);

  /* ── Canlı veri → çizim döngüsünün ref'leri (React yeniden çizimi YOK) ── */
  const fixRef = useRef<LiveFix | null>(null);
  useEffect(() => {
    if (currentLat === null || currentLon === null) { fixRef.current = null; return; }
    const prev = fixRef.current;
    const moved = !prev || prev.lat !== currentLat || prev.lon !== currentLon;
    fixRef.current = {
      lat: currentLat, lon: currentLon,
      courseDeg: headingDeg, speedMps, accuracyM,
      atMs: moved ? performance.now() : prev.atMs,
    };
  }, [currentLat, currentLon, headingDeg, speedMps, accuracyM]);

  useEffect(() => { updateCompassHeading(headingDeg); }, [headingDeg]);

  /* ── İleri rota yolu: her GPS düzeltmesinde bir kez (O(N), ~1 Hz) ── */
  const arc = useMemo(
    () => (routeGeometry && routeGeometry.length >= 2 ? buildArcLengths(routeGeometry) : null),
    [routeGeometry],
  );
  const originRef  = useRef<SceneOrigin | null>(null);
  const pathRef    = useRef<PathAhead | null>(null);
  const segHintRef = useRef<{ geom: unknown; idx: number }>({ geom: null, idx: -1 });

  useEffect(() => {
    if (!wantCamera || currentLat === null || currentLon === null) return;
    let origin = originRef.current;
    const rel = origin ? toEnu(origin, currentLat, currentLon) : null;
    if (!origin || !rel || Math.hypot(rel.e, rel.n) > AR_ORIGIN_RESET_M) {
      origin = { lat: currentLat, lon: currentLon };
      originRef.current = origin;
    }
    if (!routeGeometry || !arc) {
      pathRef.current = null;
      updateRouteBearing(null);
      return;
    }
    if (segHintRef.current.geom !== routeGeometry) segHintRef.current = { geom: routeGeometry, idx: -1 };
    const path = extractPathAhead(routeGeometry, arc, origin, currentLat, currentLon, segHintRef.current.idx);
    pathRef.current = path;
    segHintRef.current.idx = path?.segIdx ?? -1;
    // Rota yönü — durakta (GPS rotası yok) hizalama servisinin yön yedeği
    updateRouteBearing(path?.bearingDeg ?? null);
  }, [wantCamera, currentLat, currentLon, routeGeometry, arc]);

  /* ── Yaklaşan manevra (NavigationHUD ile AYNI adım semantiği: steps[i+1]) ── */
  const upcoming = route.steps[route.currentStepIndex + 1]
    ?? (route.steps[route.currentStepIndex]?.maneuverType === 'arrive' ? route.steps[route.currentStepIndex] : undefined);
  const maneuver = useMemo(() => (upcoming && routeGeometry
    ? { lon: upcoming.coordinate[0], lat: upcoming.coordinate[1], mod: upcoming.maneuverModifier, type: upcoming.maneuverType }
    : null), [upcoming, routeGeometry]);
  const maneuverRef = useRef(maneuver);
  useEffect(() => { maneuverRef.current = maneuver; }, [maneuver]);
  const hasRouteRef = useRef(false);
  useEffect(() => { hasRouteRef.current = !!routeGeometry && routeGeometry.length >= 2; }, [routeGeometry]);
  /* Mesafe navigasyon otoritesinden; kaynağı bilinmiyorsa sayı BASILMAZ. */
  const distParts = route.distanceToNextTurnSource !== 'UNKNOWN' && Number.isFinite(route.distanceToNextTurnMeters)
    ? splitManeuverDistance(route.distanceToNextTurnMeters)
    : null;

  /* ── Çizim döngüsü — yalnız AR görünürken ─────────────────────────── */
  useEffect(() => {
    if (!arVisible) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const bb = billboardRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !container || !ctx) return;

    let w = 0, h = 0, dpr = 1;
    const measure = (): void => {
      const r = container.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(container); else window.addEventListener('resize', measure);

    let raf = 0;
    let lastDraw = 0;
    let pose: DisplayPose | null = null;
    let trackLabel = '';
    let trackCheckedAt = -Infinity;
    let shownReason: ArEvidenceReason = null;
    let pendingReason: ArEvidenceReason = null;
    let pendingSince = 0;

    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - lastDraw < frameIntervalMs()) return;
      const dtS = lastDraw ? (now - lastDraw) / 1000 : 0;
      lastDraw = now;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const video = videoRef.current;
      const fit = coverFit(video?.videoWidth ?? 0, video?.videoHeight ?? 0, w, h);
      if (now - trackCheckedAt > 1_000) { trackLabel = getVisionTrackInfo()?.label ?? ''; trackCheckedAt = now; }

      /* ADAS — salt okuma projeksiyon, tazelik kapılı. */
      const adas = useAdasStore.getState();
      const adasLive = ADAS_RUNNING.has(adas.overall) && now - adas.warning.atPerfMs < ADAS_FRESH_MS;

      const align = getARAlignment();
      const camPose = resolveArPose({
        adas: adasLive && adas.camera
          ? { hfovDeg: adas.camera.hfovDeg, cameraHeightM: adas.camera.cameraHeightM, horizonY: adas.camera.calibration?.horizonY ?? null }
          : null,
        sensor: { pitchDeg: align.pitchDeg, measured: align.poseMeasured },
        deviceBackCamera: isDeviceBackCamera(trackLabel),
        srcW: fit.srcW, srcH: fit.srcH,
      });
      const project = makeGroundProjector(camPose, fit);

      /* Çizim pozu: son düzeltme → kısa ileri kestirim → yumuşatma (yalnız SUNUM). */
      const fix = fixRef.current;
      const origin = originRef.current;
      const path = pathRef.current;
      let headingKnown = false;
      if (fix && origin) {
        const p0 = toEnu(origin, fix.lat, fix.lon);
        const ext = extrapolateFix({ ...p0, courseDeg: fix.courseDeg, speedMps: fix.speedMps }, (now - fix.atMs) / 1000);
        /* Yön: hizalama füzyonu (jiroskop + pusula/GPS) bir kaynağa oturduysa o;
           değilse rotanın yerel yönü (araç rotada, durakta). Hiçbiri → çizilmez. */
        const hd = align.sensorActive ? align.fusedHeadingDeg : (path?.bearingDeg ?? null);
        if (hd !== null) {
          headingKnown = true;
          pose = smoothPose(pose, { e: ext.e, n: ext.n, headingDeg: hd }, dtS);
        }
      }

      const ev = routeEvidence({
        accuracyM: fix?.accuracyM ?? null,
        fixAgeMs: fix ? now - fix.atMs : null,
        offRouteM: path?.offRouteM ?? null,
        headingKnown,
        pose: camPose,
      });
      const fwdWarn = adasLive ? adas.warning.forward : null;
      /* Çarpışma uyarısında rota ve manevra işareti geri çekilir — tehlike öne çıksın. */
      const routeAlpha = ev.alpha * (fwdWarn === 'collision' ? 0.35 : 1);

      /* ADAS'ın izlediği öndeki araç (ekran kutusu) — rota onun ALTINDAN geçer. */
      const lead = adasLive ? adas.debug.lead : null;
      let leadBox: { x: number; y: number; w: number; h: number } | null = null;
      if (lead) {
        const tl = normToScreen(fit, lead.box.x, lead.box.y);
        const br = normToScreen(fit, lead.box.x + lead.box.w, lead.box.y + lead.box.h);
        if (br.x > tl.x && br.y > tl.y) leadBox = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
      }

      /* ── Rota halısı + chevron'lar ── */
      if (pose && path && ev.level !== 'NONE') {
        const local = clipPathForward(toVehicleFrame(path.points, pose.e, pose.n, pose.headingDeg), PATH_NEAR_M, PATH_FAR_M);
        if (local.length >= 2) {
          ctx.save();
          if (leadBox) {
            /* Örtme: halı öndeki aracın üstüne BOYANMAZ (yol boyası araç altında kalır). */
            ctx.beginPath();
            ctx.rect(0, 0, w, h);
            ctx.rect(leadBox.x, leadBox.y, leadBox.w, leadBox.h);
            ctx.clip('evenodd');
          }
          const edges = ribbonEdges(local, RIBBON_HALF_WIDTH_M);
          paintRibbon(ctx, projectAll(project, edges.left), projectAll(project, edges.right), routeAlpha);

          const polys: ScreenPt[][] = [];
          const alphas: number[] = [];
          for (const a of chevronAnchors(local, CHEVRON_SPACING_M)) {
            const poly: ScreenPt[] = [];
            for (const [r, f] of chevronPolygon(a)) {
              const s = project(r, f);
              if (!s) break;
              poly.push(s);
            }
            if (poly.length !== 6) continue;
            /* İleri akan yumuşak ışıltı dalgası — hareket yönünü sezdirir. */
            const wave = 0.72 + 0.28 * Math.max(0, Math.cos(2 * Math.PI * (a.s / 42 - now / 1_500)));
            polys.push(poly);
            alphas.push(0.92 * routeAlpha * depthFade(a.fwd) * wave);
          }
          paintChevrons(ctx, polys, alphas);
          ctx.restore();
        }
      }

      /* ── Manevra işareti (DOM; konum burada, içerik React'te) ── */
      const m = maneuverRef.current;
      let bbShown = false;
      if (bb && m && pose && origin && ev.level !== 'NONE') {
        const me = toEnu(origin, m.lat, m.lon);
        const [loc] = toVehicleFrame([{ e: me.e, n: me.n, s: 0 }], pose.e, pose.n, pose.headingDeg);
        if (loc.fwd >= AR_MANEUVER_MIN_FWD_M && loc.fwd <= AR_MANEUVER_MAX_FWD_M) {
          const g = project(loc.right, loc.fwd, 0);
          if (g && g.x > -60 && g.x < w + 60 && g.y > 0 && g.y < h + 60) {
            const s = billboardScale(loc.fwd);
            bb.style.transform = `translate3d(${g.x.toFixed(1)}px,${g.y.toFixed(1)}px,0) translate(-50%,-100%) scale(${s.toFixed(3)})`;
            bbShown = true;
          }
        }
      }
      if (bb) {
        const o = bbShown ? routeAlpha.toFixed(2) : '0';
        if (bb.style.opacity !== o) bb.style.opacity = o;
      }

      /* ── ADAS mekânsal işaretleri (hüküm ADAS'ın; burada yalnız NEREDE) ── */
      if (adasLive) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 150);
        const lane = adas.warning.lane;
        if (lane) {
          const ln = lane === 'left' ? adas.debug.lanes?.left : adas.debug.lanes?.right;
          const seg = ln ? [normToScreen(fit, ln.x1, ln.y1), normToScreen(fit, ln.x2, ln.y2)] as const : null;
          paintLaneEdge(ctx, lane, seg, w, h, pulse);
        }
        if (lead && leadBox) {
          const tone = fwdWarn === 'collision' ? 'collision' : fwdWarn === 'headway' ? 'headway' : 'tracked';
          const label = lead.distanceM !== null && Number.isFinite(lead.distanceM) ? `${Math.round(lead.distanceM)} m` : null;
          paintLeadBracket(ctx, leadBox, tone, label, pulse);
        }
      }

      /* ── Kanıt nedeni: yalnız rota varken, kalıcıysa söylenir ── */
      const want: ArEvidenceReason = hasRouteRef.current ? ev.reason : null;
      if (want !== pendingReason) { pendingReason = want; pendingSince = now; }
      const next = want === null ? null : now - pendingSince >= REASON_SHOW_AFTER_MS ? want : shownReason;
      if (next !== shownReason) { shownReason = next; setReason(next); }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', measure);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bb) bb.style.opacity = '0';
      setReason(null);
    };
  }, [arVisible]);

  /* ─────────────────────────────────────────────────────────── */
  /* RENDER                                                       */
  /* ─────────────────────────────────────────────────────────── */

  const fade = `opacity ${transitioning ? 500 : 400}ms ease`;
  const isArrive = maneuver?.type === 'arrive';

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 'var(--z-map-vision)' }}
    >
      {/* ── Kamera ── */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        style={{ opacity: isHybrid ? 1 : 0, transition: fade, background: isHybrid ? '#000' : 'transparent' }}
      />

      {/* ── Kenar karartması: üst/alt HUD kamera üstünde okunur kalsın ── */}
      <div
        className="absolute inset-x-0 top-0 h-40 pointer-events-none"
        style={{ opacity: isHybrid ? 1 : 0, transition: fade, background: 'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 100%)' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-56 pointer-events-none"
        style={{ opacity: isHybrid ? 1 : 0, transition: fade, background: 'linear-gradient(0deg, rgba(0,0,0,0.46) 0%, rgba(0,0,0,0) 100%)' }}
      />

      {/* ── AR tuvali — konumsal kanıt kapısı çizimin İÇİNDE (routeEvidence) ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: arVisible ? 1 : 0, transition: fade }}
      />

      {/* ── Manevra işareti: dönüş noktasında havada duran ok + mesafe ── */}
      <div
        ref={billboardRef}
        aria-hidden="true"
        className="absolute left-0 top-0 pointer-events-none"
        style={{ opacity: 0, transformOrigin: '50% 100%', willChange: 'transform, opacity', transition: 'opacity 220ms ease' }}
      >
        {maneuver && (
          <div className="flex flex-col items-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 76, height: 76,
                background: 'rgba(255,255,255,0.95)',
                color: isArrive ? '#FF3B30' : '#0A84FF',
                boxShadow: '0 12px 32px rgba(0,0,0,0.38), 0 0 0 0.5px rgba(0,0,0,0.06)',
              }}
            >
              <ManeuverArrow mod={maneuver.mod} type={maneuver.type} size="lg" />
            </div>
            {distParts && (
              <div
                className="mt-2 px-3 h-8 rounded-full flex items-baseline gap-1 tabular-nums"
                style={{ ...GLASS, color: '#fff', alignItems: 'center' }}
              >
                <span className="text-[17px] font-semibold leading-none">{distParts.value}</span>
                {distParts.unit && <span className="text-[13px] font-medium leading-none opacity-75">{distParts.unit}</span>}
              </div>
            )}
            <div
              className="mt-1.5 rounded-full"
              style={{
                width: 3, height: 40,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35))',
                /* Açık gökyüzünde kaybolmasın: ince koyu kontur. */
                boxShadow: '0 0 0 0.5px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.25)',
              }}
            />
            <div
              className="rounded-[50%]"
              style={{ width: 26, height: 9, marginTop: -4, background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%)' }}
            />
          </div>
        )}
      </div>

      {/* ── Kanıt yetersiz: rota GİZLİ, nedeni söylenir ── */}
      {arVisible && reason && (
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ bottom: 'calc(var(--nav-bar-h, 72px) + 64px)' }}
          role="status"
        >
          <div className="px-4 h-9 rounded-full flex items-center text-[14px] font-medium text-white whitespace-nowrap" style={GLASS}>
            {REASON_TEXT[reason]}
          </div>
        </div>
      )}

      {/* ── AR düğmesi + bildirim ── */}
      {isNavigating && (
        /* right-[7rem] idi → ANA EKRAN düğmesine ~30 px biniyordu (telefon,
           2026-09-24). Sıra sağdan: ANA EKRAN · harita kaynak rozeti · AR. */
        <div className="absolute top-5 right-[14.5rem] pointer-events-auto z-[var(--z-map-effect)] flex flex-col items-end gap-2">
          <ArPill state={pillState} onToggle={handleToggle} />
          {notice && (
            <div role="alert" className="flex items-start gap-3 px-4 py-3 rounded-2xl max-w-[300px]" style={GLASS}>
              <CameraOff className="w-5 h-5 mt-0.5 shrink-0" style={{ color: '#FF9F0A' }} />
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold leading-tight text-white">{NOTICE_TEXT[notice].title}</span>
                <span className="text-[13px] leading-snug" style={{ color: 'rgba(235,235,245,0.7)' }}>{NOTICE_TEXT[notice].detail}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
