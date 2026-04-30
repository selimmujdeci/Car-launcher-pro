/**
 * VisionAROverlay — Vision AR Navigation (X-2) Temel Pipeline.
 *
 * Katman sırası (z-index 9800):
 *   1. <img> kamera karesi  — cameraService.currentFrame (base64 JPEG)
 *   2. Three.js canvas       — şeffaf (alpha:true), pointer-events:none
 *   3. HTML HUD              — LDW durumu + navigasyon talimatı
 *   4. Kapat butonu
 *
 * Three.js Sahnesi:
 *   · LDW (Lane Departure Warning): V-şekli yol çizgileri, hız > 60 km/h aktif
 *   · Navigasyon oku: < 100m mesafede animasyonlu 3D ok
 *   · Mali-400 uyumu: antialiasing kapalı, MeshBasicMaterial, düşük poligon
 *
 * Adaptive FPS:
 *   · SAFE_MODE → 15 fps  (CPU/GPU ısınma önlemi)
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

// ── Sabitler ──────────────────────────────────────────────────────────────────

const FPS_NORMAL     = 60;
const FPS_SAFE_MODE  = 15;

const COLOR_ARROW  = 0x3b82f6;  // mavi — navigasyon oku
const COLOR_LDW_OK = 0x22c55e;  // yeşil — normal şerit

// ── Three.js geometry yardımcıları ───────────────────────────────────────────

/** Düşük poligonlu navigasyon oku: shaft (CylinderGeometry) + head (ConeGeometry).
 *  Varsayılan yönelim: +X ekseni (sağ). arrowYawRad ile döndürülür. */
function _buildArrow(): { group: THREE.Group; disposables: THREE.BufferGeometry[] } {
  const group       = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  const mat         = new THREE.MeshBasicMaterial({ color: COLOR_ARROW, side: THREE.DoubleSide });

  // Shaft: Y ekseni silindir → Z etrafında π/2 döndür → X ekseni
  const shaftGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8);
  disposables.push(shaftGeo);
  shaftGeo.rotateZ(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.position.x = -0.3;
  group.add(shaft);

  // Head: ConeGeometry → Z etrafında -π/2 döndür → +X'e işaret eder
  const headGeo = new THREE.ConeGeometry(0.22, 0.55, 8);
  disposables.push(headGeo);
  headGeo.rotateZ(-Math.PI / 2);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.x = 0.65;
  group.add(head);

  return { group, disposables };
}

/** V-şeklinde LDW şerit çizgileri. LineSegments = 4 vertex, 2 çizgi. */
function _buildLDW(): { lines: THREE.LineSegments; geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial } {
  const positions = new Float32Array([
    // Sol şerit: yakından uzağa
    -3.8,  0, -4,
    -0.6,  0, -55,
    // Sağ şerit: yakından uzağa
     3.8,  0, -4,
     0.6,  0, -55,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat   = new THREE.LineBasicMaterial({ color: COLOR_LDW_OK, linewidth: 2 });
  const lines = new THREE.LineSegments(geo, mat);
  return { lines, geo, mat };
}

// ── Yön çözücü (NavigationState → StepDirection) ─────────────────────────────

/**
 * headingToDestination (0-360°, kuzey=0) → kavşak yönü.
 * Gerçek turn-by-turn navigasyon verisi olmadığından basit heading bölümleme.
 *   0–45° / 315–360° → düz
 *   45–135° → sağ
 *   135–225° → geri dönüş
 *   225–315° → sol
 */
function _resolveDirection(heading?: number): StepDirection {
  if (heading == null) return 'straight';
  const h = ((heading % 360) + 360) % 360;
  if (h > 315 || h <= 45)   return 'straight';
  if (h > 45  && h <= 135)  return 'right';
  if (h > 135 && h <= 225)  return 'uturn';
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

  const containerRef  = useRef<HTMLDivElement>(null);
  const rafRef        = useRef<number>(0);
  const lastFrameRef  = useRef<number>(0);

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

  // ── Three.js kurulum + RAF döngüsü ───────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth  || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      alpha:           true,   // şeffaf zemin — kamera görüntüsü alttan görünür
      antialias:       false,  // Mali-400: antialias GPU bütçesi eater
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = false; // Mali-400: gölge hesabı yok
    renderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    container.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();

    // ── Kamera (sürücü göz yüksekliği, hafif aşağı bakış) ───────────────────
    const cam = new THREE.PerspectiveCamera(60, w / h, 0.1, 200);
    cam.position.set(0, 1.5, 0);
    cam.lookAt(0, 0, -10);

    // ── LDW şerit çizgileri ───────────────────────────────────────────────────
    const { lines: ldwLines, geo: ldwGeo, mat: ldwMat } = _buildLDW();
    ldwLines.visible = false;
    scene.add(ldwLines);

    // ── Navigasyon oku ────────────────────────────────────────────────────────
    const { group: arrowGroup, disposables: arrowGeos } = _buildArrow();
    arrowGroup.position.set(0, 0.5, -15); // yol yüzeyinde, 15m ileride
    arrowGroup.visible = false;
    scene.add(arrowGroup);

    // Tek shared material — okun shaft + head'i aynı matı kullanır
    const arrowMat = (arrowGroup.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;

    // ── RAF loop ──────────────────────────────────────────────────────────────
    const tick = (ts: number) => {
      rafRef.current = requestAnimationFrame(tick);

      // Adaptive FPS: SAFE_MODE → 15 fps, diğer → 60 fps
      const mode      = runtimeManager.getMode();
      const targetFps = mode === RuntimeMode.SAFE_MODE ? FPS_SAFE_MODE : FPS_NORMAL;
      if (ts - lastFrameRef.current < 1000 / targetFps) return;
      lastFrameRef.current = ts;

      const state = getARState(); // allocation-free, RAF içinde güvenli

      // LDW güncelle
      ldwLines.visible = state.showLDW;
      if (state.showLDW) {
        ldwMat.color.setHex(COLOR_LDW_OK);
      }

      // Navigasyon oku güncelle
      arrowGroup.visible = state.showArrow;
      if (state.showArrow) {
        arrowGroup.rotation.y  = state.arrowYawRad;
        arrowGroup.scale.setScalar(state.arrowScale);
        // Yavaş dikey salınım — sürücünün dikkatini çeker
        arrowGroup.position.y = 0.5 + Math.sin(ts * 0.0018) * 0.12;
      }

      // Kamera pitch ayarı
      cam.rotation.x = state.cameraPitchRad;

      renderer.render(scene, cam);
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Pencere boyutu değişimi ───────────────────────────────────────────────
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

      // LDW
      ldwGeo.dispose();
      ldwMat.dispose();

      // Ok geometrileri
      arrowGeos.forEach((g) => g.dispose());
      arrowMat.dispose();

      // Renderer + DOM
      renderer.dispose();
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
    };
  }, []); // mount-only — RAF içinde getARState() ile güncel durum okunur

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      role="presentation"
      aria-label="AR Navigasyon"
      style={{ position: 'fixed', inset: 0, zIndex: 9800, overflow: 'hidden' }}
    >
      {/* Kamera karesi arka plan */}
      {cameraFeed.currentFrame ? (
        <img
          src={cameraFeed.currentFrame}
          alt=""
          aria-hidden
          style={{
            position:   'absolute',
            inset:      0,
            width:      '100%',
            height:     '100%',
            objectFit:  'cover',
          }}
        />
      ) : (
        /* Kamera henüz hazır değil — koyu zemin */
        <div style={{ position: 'absolute', inset: 0, background: '#060810' }} />
      )}

      {/* Three.js canvas: renderer.domElement containerRef'e append edilir */}

      {/* ── HTML HUD ─────────────────────────────────────────────────────── */}
      <div
        aria-live="polite"
        style={{
          position:  'absolute',
          bottom:    20,
          left:      '50%',
          transform: 'translateX(-50%)',
          display:   'flex',
          gap:       8,
          pointerEvents: 'none',
        }}
      >
        {ar.showLDW && (
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
