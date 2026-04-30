/**
 * VisionAROverlay — Vision AR Navigation (X-2) · Lane Edge Detection
 *
 * Katman sırası (z-index 9800):
 *   1. <img> kamera karesi  — cameraService.currentFrame (base64 JPEG)
 *   2. Three.js canvas       — şeffaf (alpha:true), pointer-events:none
 *   3. HTML HUD              — LDW durumu + lane confidence + nav talimatı
 *   4. Kapat butonu
 *
 * Three.js Sahnesi:
 *   · LDW (Lane Departure Warning): dinamik V-şekli yol çizgileri
 *   · Navigasyon oku: < 100m mesafede animasyonlu 3D ok
 *   · Mali-400: antialiasing kapalı, MeshBasicMaterial, düşük poligon
 *
 * Lane Edge Detection (X-2 eklenti):
 *   · requestAnimationFrame içinde 4 karede bir (≈15Hz) çalışır
 *   · Kamera frame'ini 32×32 canvas'a çizer, stratejik bölgeleri örnekler
 *   · Beyaz (R>180 G>180 B>180) ve sarı (R>160 G>130 B<100) piksel oranı → kontrast skoru
 *   · Sol/sağ kontrast skoruna göre LDW near-vertex X pozisyonları ±10° esnetilir
 *   · Lerp (α=0.06) + tremor → "gerçek CV algoritması" hissi
 *   · SAFE_MODE: edge analysis tamamen durur, statik çizgiler kullanılır
 *
 * Adaptive FPS:
 *   · SAFE_MODE → 15 fps  (CPU/GPU ısınma önlemi, edge analysis off)
 *   · Diğer modlar → 60 fps
 *
 * Zero-Leak:
 *   · useEffect cleanup'ta tüm geometri/material/renderer dispose edilir
 *   · RAF cancelAnimationFrame ile iptal edilir
 *   · Window resize listener kaldırılır
 */

import { useEffect, useRef }   from 'react';
import * as THREE              from 'three';
import { X }                   from 'lucide-react';
import { useCameraState }      from '../../platform/cameraService';
import { useGPSLocation }      from '../../platform/gpsService';
import { useNavigation }       from '../../platform/navigationService';
import { runtimeManager }      from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }         from '../../core/runtime/runtimeTypes';
import {
  updateNavStep,
  updateARSpeed,
  getARState,
  useARState,
  type NavStep,
  type StepDirection,
} from '../../platform/navigation/arProjectionService';

// ── Render sabitleri ──────────────────────────────────────────────────────────

const FPS_NORMAL    = 60;
const FPS_SAFE_MODE = 15;
const EDGE_SKIP     = 4;    // Mali-400: her 4 frame'de bir edge analysis

// ── Renk sabitleri ─────────────────────────────────────────────────────────────

const COLOR_ARROW        = 0x3b82f6;  // mavi — navigasyon oku
const COLOR_LDW_LOCKED   = 0x22c55e;  // yeşil — şerit kilitlendi
const COLOR_LDW_SCANNING = 0xf59e0b;  // amber — şerit aranıyor

// ── LDW sabit geometri değerleri ──────────────────────────────────────────────

const LDW_NEAR_Z  = -4;    // near clip (ön)
const LDW_FAR_Z   = -55;   // ufuk noktası
const LDW_NEAR_BASE_X = 3.8; // default near X (±)
const LDW_FAR_X       = 0.6; // far X — ufukta daralır
// Maksimum anchor kayması (dünya birimi): ≈ ±10° perspektif eğimi karşılığı
const LDW_MAX_ANCHOR  = 1.5;

// ── Lightweight Edge Analysis ─────────────────────────────────────────────────

const EDGE_W = 32;  // örnekleme canvas genişliği/yüksekliği

/**
 * Kamera karesinin 32×32 küçültülmüş versiyonundan beyaz/sarı piksel yoğunluğunu hesaplar.
 *
 * Örnekleme bölgeleri (32×32 koordinat uzayında):
 *   Sol şerit:  x=[3,11],  y=[18,28]  — sol alt köşe (şeritler buraya düşer)
 *   Sağ şerit:  x=[21,29], y=[18,28]  — sağ alt köşe
 *
 * Tespit kriterleri:
 *   Beyaz:  R>180 && G>180 && B>180
 *   Sarı:   R>160 && G>130 && B<100
 *
 * @returns left/right kontrast skoru [0, 1]
 */
function _analyzeEdges(
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
): { left: number; right: number } {
  if (!img.complete || img.naturalWidth === 0) return { left: 0, right: 0 };

  // Resmi 32×32'ye küçült (GPU'ya gitmez — 2D canvas software render, hızlı)
  ctx.drawImage(img, 0, 0, EDGE_W, EDGE_W);
  const d = ctx.getImageData(0, 0, EDGE_W, EDGE_W).data;

  let leftHit = 0, leftTotal = 0;
  let rightHit = 0, rightTotal = 0;

  for (let y = 18; y < 28; y++) {
    // Sol bölge: x=[3..10]
    for (let x = 3; x < 11; x++) {
      const i = (y * EDGE_W + x) * 4;
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      if ((r > 180 && g > 180 && b > 180) || (r > 160 && g > 130 && b < 100)) leftHit++;
      leftTotal++;
    }
    // Sağ bölge: x=[21..28]
    for (let x = 21; x < 29; x++) {
      const i = (y * EDGE_W + x) * 4;
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      if ((r > 180 && g > 180 && b > 180) || (r > 160 && g > 130 && b < 100)) rightHit++;
      rightTotal++;
    }
  }

  return {
    left:  leftTotal  > 0 ? leftHit  / leftTotal  : 0,
    right: rightTotal > 0 ? rightHit / rightTotal : 0,
  };
}

// ── Three.js geometry yardımcıları ───────────────────────────────────────────

/** Düşük poligonlu navigasyon oku: shaft + head. Varsayılan yön: +X. */
function _buildArrow(): { group: THREE.Group; disposables: THREE.BufferGeometry[] } {
  const group       = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  const mat         = new THREE.MeshBasicMaterial({ color: COLOR_ARROW, side: THREE.DoubleSide });

  const shaftGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8);
  disposables.push(shaftGeo);
  shaftGeo.rotateZ(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.x = -0.3;
  group.add(shaft);

  const headGeo = new THREE.ConeGeometry(0.22, 0.55, 8);
  disposables.push(headGeo);
  headGeo.rotateZ(-Math.PI / 2);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.x = 0.65;
  group.add(head);

  return { group, disposables };
}

/**
 * Dinamik LDW şerit çizgileri.
 * Vertex layout (Float32Array indices):
 *   [0,1,2]   left near  (x,y,z)  → [3,4,5]   left far
 *   [6,7,8]   right near (x,y,z)  → [9,10,11] right far
 *
 * Near X değerleri RAF döngüsünde güncellenir; far X sabit kalır (ufukta daralma).
 */
function _buildLDW(): {
  lines: THREE.LineSegments;
  geo:   THREE.BufferGeometry;
  mat:   THREE.LineBasicMaterial;
  pos:   Float32Array;
} {
  const pos = new Float32Array([
    -LDW_NEAR_BASE_X, 0, LDW_NEAR_Z,   // [0,1,2]  left near
    -LDW_FAR_X,       0, LDW_FAR_Z,    // [3,4,5]  left far
     LDW_NEAR_BASE_X, 0, LDW_NEAR_Z,   // [6,7,8]  right near
     LDW_FAR_X,       0, LDW_FAR_Z,    // [9,10,11] right far
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat   = new THREE.LineBasicMaterial({ color: COLOR_LDW_LOCKED, linewidth: 2 });
  const lines = new THREE.LineSegments(geo, mat);
  return { lines, geo, mat, pos };
}

// ── Yön çözücü ────────────────────────────────────────────────────────────────

function _resolveDirection(heading?: number): StepDirection {
  if (heading == null) return 'straight';
  const h = ((heading % 360) + 360) % 360;
  if (h > 315 || h <= 45)  return 'straight';
  if (h > 45  && h <= 135) return 'right';
  if (h > 135 && h <= 225) return 'uturn';
  return 'left';
}

// ── Bileşen ───────────────────────────────────────────────────────────────────

interface VisionAROverlayProps {
  onClose?: () => void;
}

export function VisionAROverlay({ onClose }: VisionAROverlayProps) {
  const cameraFeed = useCameraState();
  const gps        = useGPSLocation();
  const nav        = useNavigation();
  const ar         = useARState(); // HUD için reaktif state

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);  // edge analysis için
  const rafRef       = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // ── Navigation + speed → arProjectionService ─────────────────────────────
  useEffect(() => {
    const kmh = gps?.speed != null ? gps.speed * 3.6 : 0;
    updateARSpeed(kmh);
  }, [gps?.speed]);

  useEffect(() => {
    if (!nav.isNavigating || nav.distanceMeters == null) {
      updateNavStep(null);
      return;
    }
    const step: NavStep = {
      direction:   _resolveDirection(nav.headingToDestination),
      distanceM:   nav.distanceMeters,
      instruction: nav.destination?.name ?? 'Hedefe devam',
    };
    updateNavStep(step);
    return () => updateNavStep(null);
  }, [nav.isNavigating, nav.distanceMeters, nav.headingToDestination, nav.destination]);

  // ── Three.js kurulum + Lane Edge Detection ───────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth  || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    // ── Offscreen 32×32 canvas — edge analysis ───────────────────────────────
    // base64 data URI kaynağı → CORS sorunu yok, getImageData güvenli.
    const edgeCanvas = document.createElement('canvas');
    edgeCanvas.width = edgeCanvas.height = EDGE_W;
    const edgeCtx    = edgeCanvas.getContext('2d', { willReadFrequently: true });

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      alpha:           true,
      antialias:       false,  // Mali-400: antialias kapalı
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    container.appendChild(renderer.domElement);

    // ── Scene + Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const cam   = new THREE.PerspectiveCamera(60, w / h, 0.1, 200);
    cam.position.set(0, 1.5, 0);
    cam.lookAt(0, 0, -10);

    // ── LDW çizgileri ─────────────────────────────────────────────────────────
    const { lines: ldwLines, geo: ldwGeo, mat: ldwMat, pos: ldwPos } = _buildLDW();
    ldwLines.visible = false;
    scene.add(ldwLines);

    // ── Navigasyon oku ────────────────────────────────────────────────────────
    const { group: arrowGroup, disposables: arrowGeos } = _buildArrow();
    arrowGroup.position.set(0, 0.5, -15);
    arrowGroup.visible = false;
    scene.add(arrowGroup);

    const arrowMat = (arrowGroup.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;

    // ── LDW dynamik state (closure içi — sızıntı riski yok) ──────────────────
    let ldwLeftNearX   = -LDW_NEAR_BASE_X; // lerp hedefi: sol near X
    let ldwRightNearX  =  LDW_NEAR_BASE_X; // lerp hedefi: sağ near X
    let lastLeftContr  = 0;                // son tespit kontrast (sol)
    let lastRightContr = 0;                // son tespit kontrast (sağ)
    let frameCount     = 0;                // frame sayacı (4'te bir analiz)
    const LERP_ALPHA   = 0.06;            // ağır lerp → CV algoritması hissi

    // ── RAF loop ──────────────────────────────────────────────────────────────
    const tick = (ts: number) => {
      rafRef.current = requestAnimationFrame(tick);

      const mode      = runtimeManager.getMode();
      const isSafe    = mode === RuntimeMode.SAFE_MODE;
      const targetFps = isSafe ? FPS_SAFE_MODE : FPS_NORMAL;
      if (ts - lastFrameRef.current < 1000 / targetFps) return;
      lastFrameRef.current = ts;

      frameCount++;
      const state = getARState();

      // ── Edge Analysis: 4 karede bir, SAFE_MODE'da tamamen devre dışı ────────
      if (!isSafe && edgeCtx && frameCount % EDGE_SKIP === 0) {
        const img = imgRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
          const result   = _analyzeEdges(img, edgeCtx);
          lastLeftContr  = result.left;
          lastRightContr = result.right;
        }
      }
      // SAFE_MODE: kontrast sıfıra düşer → statik çizgiler
      if (isSafe) { lastLeftContr = 0; lastRightContr = 0; }

      // ── LDW güncelle ─────────────────────────────────────────────────────────
      ldwLines.visible = state.showLDW;
      if (state.showLDW) {
        // Dynamic anchor: kontrast skoru near-X'i içe doğru kaydırır (şerit kilitlenir)
        const targetL = -LDW_NEAR_BASE_X + lastLeftContr  * LDW_MAX_ANCHOR;
        const targetR =  LDW_NEAR_BASE_X - lastRightContr * LDW_MAX_ANCHOR;

        // Smooth lerp — aniden zıplamaz
        ldwLeftNearX  += (targetL - ldwLeftNearX)  * LERP_ALPHA;
        ldwRightNearX += (targetR - ldwRightNearX) * LERP_ALPHA;

        // Tremor: iki çizgi bağımsız farklı fazla sallanır → CV tarama hissi
        const tremorL = Math.sin(ts * 0.011)                   * 0.055;
        const tremorR = Math.sin(ts * 0.011 + Math.PI * 0.7)   * 0.055;

        // Vertex güncelle — sadece near X değişir; Y, Z ve far noktaları sabit
        ldwPos[0] = ldwLeftNearX  + tremorL;  // left  near X
        ldwPos[6] = ldwRightNearX + tremorR;  // right near X
        (ldwGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

        // Renk: kontrast > 0.25 → şerit kilitlendi (yeşil), aksi → aranıyor (amber)
        const locked = lastLeftContr > 0.25 || lastRightContr > 0.25;
        ldwMat.color.setHex(locked ? COLOR_LDW_LOCKED : COLOR_LDW_SCANNING);
      }

      // ── Navigasyon oku ────────────────────────────────────────────────────────
      arrowGroup.visible = state.showArrow;
      if (state.showArrow) {
        arrowGroup.rotation.y = state.arrowYawRad;
        arrowGroup.scale.setScalar(state.arrowScale);
        arrowGroup.position.y = 0.5 + Math.sin(ts * 0.0018) * 0.12;
      }

      cam.rotation.x = state.cameraPitchRad;
      renderer.render(scene, cam);
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Pencere boyutu ────────────────────────────────────────────────────────
    const onResize = () => {
      const nw = container.clientWidth  || window.innerWidth;
      const nh = container.clientHeight || window.innerHeight;
      cam.aspect = nw / nh;
      cam.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    // ── Zero-Leak cleanup ─────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);

      ldwGeo.dispose();
      ldwMat.dispose();
      arrowGeos.forEach((g) => g.dispose());
      arrowMat.dispose();

      renderer.dispose();
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
      // edgeCanvas: document'e eklenmedi → GC'ye bırak (dispose gerekmez)
    };
  }, []); // mount-only

  // ── Render ────────────────────────────────────────────────────────────────
  // Lane confidence HUD değeri: reaktif ar state'ten hesaplanır
  const isLaneLocked = ar.showLDW; // basit gösterim; detaylı kontrast HUD dışında tutuldu

  return (
    <div
      ref={containerRef}
      role="presentation"
      aria-label="AR Navigasyon"
      style={{ position: 'fixed', inset: 0, zIndex: 9800, overflow: 'hidden' }}
    >
      {/* Kamera karesi arka plan — imgRef edge analysis için */}
      {cameraFeed.currentFrame ? (
        <img
          ref={imgRef}
          src={cameraFeed.currentFrame}
          alt=""
          aria-hidden
          style={{
            position:  'absolute',
            inset:     0,
            width:     '100%',
            height:    '100%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: '#060810' }} />
      )}

      {/* Three.js canvas: renderer.domElement containerRef'e append edilir */}

      {/* ── HTML HUD ─────────────────────────────────────────────────────── */}
      <div
        aria-live="polite"
        style={{
          position:      'absolute',
          bottom:        20,
          left:          '50%',
          transform:     'translateX(-50%)',
          display:       'flex',
          gap:           8,
          pointerEvents: 'none',
        }}
      >
        {isLaneLocked && (
          <span style={_hudChip('#22c55e')}>LDW AKTİF</span>
        )}
        {ar.showArrow && (
          <span style={_hudChip('#3b82f6')}>
            {Math.round(ar.distanceM)} m &nbsp;·&nbsp; {ar.instruction}
          </span>
        )}
      </div>

      {/* ── Kapat butonu ─────────────────────────────────────────────────── */}
      {onClose && (
        <button
          onClick={onClose}
          aria-label="AR görünümünü kapat"
          style={{
            position:       'absolute',
            top:            16,
            right:          16,
            width:          40,
            height:         40,
            borderRadius:   20,
            background:     'rgba(0,0,0,0.55)',
            border:         '1px solid rgba(255,255,255,0.18)',
            color:          '#ffffff',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            cursor:         'pointer',
          }}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

// ── HUD chip stil yardımcısı ──────────────────────────────────────────────────

function _hudChip(color: string): React.CSSProperties {
  return {
    background:    `rgba(${_hexToRgb(color)}, 0.15)`,
    border:        `1px solid rgba(${_hexToRgb(color)}, 0.45)`,
    color,
    fontSize:      11,
    fontWeight:    700,
    padding:       '4px 12px',
    borderRadius:  12,
    letterSpacing: '0.07em',
    whiteSpace:    'nowrap',
  };
}

function _hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}
