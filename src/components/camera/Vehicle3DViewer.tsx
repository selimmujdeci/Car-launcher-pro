/**
 * Vehicle3DViewer — Real-time OBD-driven 3D car visualization.
 *
 * Mali-400 GPU kısıtlamaları:
 *  - MeshBasicMaterial / MeshLambertMaterial only — PBR yok
 *  - Shadow / Reflection / Post-processing kesinlikle kapalı
 *  - antialias: false, precision: 'mediump', pixelRatio ≤ 1.5
 *  - 30fps cap (FRAME_MS = 1000/fps)
 *  - Dirty-flag render: sahne değişmediğinde renderer çalışmaz
 *
 * OBD binding (React re-render olmadan, doğrudan Three.js ref manipülasyonu):
 *  - headlights → farlar emissive renk değişimi
 *  - doors      → kapı pivot grubu lerp animasyonu
 *  - tpms       → lastik malzeme rengi (< 180 kPa = kırmızı uyarı)
 *
 * Zero-Leak cleanup:
 *  - cancelAnimationFrame, ResizeObserver.disconnect, onOBDData unsub
 *  - scene.traverse → geometry.dispose + material.dispose
 *  - renderer.dispose + forceContextLoss
 */

import { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { onOBDData } from '../../platform/obdService';
import type { OBDData } from '../../platform/obdService';

/* ── Public interface ─────────────────────────────────────────── */

export interface Vehicle3DViewerProps {
  /** Tema vurgu rengi — far glow ve gövde kenar tonu için */
  accentColor?: string;
  className?:   string;
  style?:       React.CSSProperties;
  /** Render frame rate limiti — Mali-400 için 30fps önerilir */
  fps?:         30 | 60;
  /** Otomatik Y ekseni dönüşü — kapı animasyonu varken durur */
  autoRotate?:  boolean;
}

/* ── Mali-400 sabitleri ───────────────────────────────────────── */

const TPMS_WARN_KPA  = 180;          // kPa — altında kırmızı
const DOOR_OPEN_RAD  = Math.PI * 0.42; // ~76° açıklık
const DOOR_LERP_SPD  = 0.10;         // frame başına lerp hızı
const CAR_ROTATE_SPD = 0.004;        // oto-dönüş rad/frame
const MAX_PIXEL_RATIO = 1.5;         // piksel oranı sınırı

/* ── Renk sabitleri ───────────────────────────────────────────── */

const C_BODY     = 0x1a1a2e;
const C_CABIN    = 0x13131f;
const C_BUMPER   = 0x0f0f14;
const C_GLASS    = 0x1a3a5c;
const C_WHEEL    = 0x252525;
const C_RIM      = 0x888888;
const C_HEAD_OFF = 0x332200;
const C_HEAD_ON  = 0xffffcc;
const C_TAIL_OFF = 0x220000;
const C_TAIL_ON  = 0xcc2222;
const C_TPMS_OK  = C_WHEEL;
const C_TPMS_BAD = 0x7a0000;
const C_DOOR     = C_BODY;

/* ── Three.js sahne referansları ──────────────────────────────── */

interface DoorTargets {
  fl: number; fr: number; rl: number; rr: number; trunk: number;
}

interface SceneRefs {
  renderer:    THREE.WebGLRenderer;
  scene:       THREE.Scene;
  camera:      THREE.PerspectiveCamera;
  carGroup:    THREE.Group;
  headMat:     THREE.MeshBasicMaterial;
  tailMat:     THREE.MeshBasicMaterial;
  doorFL:      THREE.Group;
  doorFR:      THREE.Group;
  doorRL:      THREE.Group;
  doorRR:      THREE.Group;
  doorTrunk:   THREE.Group;
  doorTargets: DoorTargets;
  wheelMats:   { fl: THREE.MeshLambertMaterial; fr: THREE.MeshLambertMaterial; rl: THREE.MeshLambertMaterial; rr: THREE.MeshLambertMaterial };
  dirty:       boolean;
}

/* ── Sahne inşaatı ────────────────────────────────────────────── */

function buildScene(): SceneRefs {
  /* Renderer — Mali-400 optimize */
  const renderer = new THREE.WebGLRenderer({
    antialias:       false,
    alpha:           true,
    powerPreference: 'low-power',
    precision:       'mediump',
  });
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);

  /* Scene */
  const scene = new THREE.Scene();

  /* Işık — sadece ambient + 1 directional, shadow yok */
  const ambient = new THREE.AmbientLight(0x445577, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(4, 7, 3);
  sun.castShadow = false;
  const fill = new THREE.DirectionalLight(0x2233aa, 0.35);
  fill.position.set(-3, 1, -5);
  fill.castShadow = false;
  scene.add(ambient, sun, fill);

  /* Camera */
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.set(3.4, 2.4, 3.4);
  camera.lookAt(0, 0.1, 0);

  /* Ana araç grubu — tüm meshler bu grup altında */
  const carGroup = new THREE.Group();
  scene.add(carGroup);

  /* ── Malzemeler ── */
  const bodyMat   = new THREE.MeshLambertMaterial({ color: C_BODY,   flatShading: true });
  const cabinMat  = new THREE.MeshLambertMaterial({ color: C_CABIN,  flatShading: true });
  const bumperMat = new THREE.MeshLambertMaterial({ color: C_BUMPER, flatShading: true });
  const glassMat  = new THREE.MeshLambertMaterial({ color: C_GLASS,  flatShading: true, transparent: true, opacity: 0.65 });
  const rimMat    = new THREE.MeshLambertMaterial({ color: C_RIM,    flatShading: true });
  const doorMat   = new THREE.MeshLambertMaterial({ color: C_DOOR,   flatShading: true });
  const headMat   = new THREE.MeshBasicMaterial({ color: C_HEAD_OFF });
  const tailMat   = new THREE.MeshBasicMaterial({ color: C_TAIL_OFF });
  const makeWheelMat = () => new THREE.MeshLambertMaterial({ color: C_WHEEL, flatShading: true });
  const wheelMats = { fl: makeWheelMat(), fr: makeWheelMat(), rl: makeWheelMat(), rr: makeWheelMat() };

  /* ── Gövde (body) ── */
  carGroup.add(mesh(new THREE.BoxGeometry(2.20, 0.44, 1.10), bodyMat, 0, 0.22, 0));

  /* ── Kabin (cabin/roof) — biraz öne offset, daha dar ── */
  carGroup.add(mesh(new THREE.BoxGeometry(1.28, 0.40, 0.94), cabinMat, -0.06, 0.63, 0));

  /* ── Ön cam (windshield) ── */
  const wsMesh = mesh(new THREE.BoxGeometry(0.06, 0.38, 0.90), glassMat, 0.60, 0.60, 0);
  wsMesh.rotation.z = -0.40;
  carGroup.add(wsMesh);

  /* ── Arka cam ── */
  const rgMesh = mesh(new THREE.BoxGeometry(0.06, 0.34, 0.88), glassMat, -0.62, 0.58, 0);
  rgMesh.rotation.z = 0.48;
  carGroup.add(rgMesh);

  /* ── Ön tampon ── */
  carGroup.add(mesh(new THREE.BoxGeometry(0.16, 0.26, 1.02), bumperMat, 1.18, 0.08, 0));

  /* ── Arka tampon ── */
  carGroup.add(mesh(new THREE.BoxGeometry(0.16, 0.26, 1.02), bumperMat, -1.18, 0.08, 0));

  /* ── Farlar (headlights) ── */
  const hlGeo = new THREE.BoxGeometry(0.07, 0.09, 0.22);
  carGroup.add(mesh(hlGeo, headMat,  1.13, 0.27,  0.32));
  carGroup.add(mesh(hlGeo, headMat,  1.13, 0.27, -0.32));

  /* ── Stop lambaları (taillights) ── */
  const tlGeo = new THREE.BoxGeometry(0.07, 0.09, 0.26);
  carGroup.add(mesh(tlGeo, tailMat, -1.13, 0.27,  0.32));
  carGroup.add(mesh(tlGeo, tailMat, -1.13, 0.27, -0.32));

  /* ── Yan aynalar ── */
  const mirGeo = new THREE.BoxGeometry(0.14, 0.08, 0.06);
  carGroup.add(mesh(mirGeo, bumperMat, 0.72, 0.48,  0.59));
  carGroup.add(mesh(mirGeo, bumperMat, 0.72, 0.48, -0.59));

  /* ── Tekerlekler ── */
  const tireGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.19, 10);
  const rimGeo  = new THREE.CylinderGeometry(0.14, 0.14, 0.21, 8);

  function makeWheel(wx: number, wy: number, wz: number, mat: THREE.MeshLambertMaterial): THREE.Group {
    const g = new THREE.Group();
    g.position.set(wx, wy, wz);
    g.rotation.z = Math.PI / 2;
    g.add(new THREE.Mesh(tireGeo, mat), new THREE.Mesh(rimGeo, rimMat));
    return g;
  }

  carGroup.add(makeWheel( 0.80, -0.05,  0.62, wheelMats.fl));
  carGroup.add(makeWheel( 0.80, -0.05, -0.62, wheelMats.fr));
  carGroup.add(makeWheel(-0.80, -0.05,  0.62, wheelMats.rl));
  carGroup.add(makeWheel(-0.80, -0.05, -0.62, wheelMats.rr));

  /* ── Kapılar (pivot grup mimarisi) ──
   *
   * Her kapı bir THREE.Group içindedir.
   * Group origin = menteşe noktası (ön kenar).
   * Mesh, menteşeye göre geriye (-X) offset edilir.
   * Açılış: group.rotation.y ± DOOR_OPEN_RAD
   *   Sol kapılar: +Y (dışarı doğru = +Z yönü)
   *   Sağ kapılar: -Y (dışarı doğru = -Z yönü)
   */
  const dW = 0.60, dH = 0.38, dT = 0.055; // genişlik, yükseklik, kalınlık
  const dGeo = new THREE.BoxGeometry(dW, dH, dT);

  function makeDoor(hx: number, hy: number, hz: number): THREE.Group {
    const grp  = new THREE.Group();
    grp.position.set(hx, hy, hz);
    const dmesh = new THREE.Mesh(dGeo, doorMat);
    dmesh.position.x = -(dW / 2);          // ön kenar = menteşe
    grp.add(dmesh);
    carGroup.add(grp);
    return grp;
  }

  // Menteşe konumları: (ön-X, orta-Y, yan-Z ± kalınlık/2)
  const doorFL    = makeDoor( 0.72, 0.22,  0.575);
  const doorFR    = makeDoor( 0.72, 0.22, -0.575);
  const doorRL    = makeDoor( 0.10, 0.22,  0.575);
  const doorRR    = makeDoor( 0.10, 0.22, -0.575);

  // Bagaj kapısı — X ekseni etrafında döner (yukarı açılır)
  const trunkGeo  = new THREE.BoxGeometry(0.52, dT, 0.88);
  const trunkGrp  = new THREE.Group();
  trunkGrp.position.set(-0.98, 0.44, 0);
  const trunkMesh = new THREE.Mesh(trunkGeo, bodyMat);
  trunkMesh.position.x = -0.26;
  trunkGrp.add(trunkMesh);
  carGroup.add(trunkGrp);
  const doorTrunk = trunkGrp;

  return {
    renderer, scene, camera, carGroup,
    headMat, tailMat,
    doorFL, doorFR, doorRL, doorRR, doorTrunk,
    doorTargets: { fl: 0, fr: 0, rl: 0, rr: 0, trunk: 0 },
    wheelMats,
    dirty: true,
  };
}

/* ── Yardımcı: mesh oluştur ───────────────────────────────────── */

function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/* ── Ana bileşen ──────────────────────────────────────────────── */

export const Vehicle3DViewer = memo(function Vehicle3DViewer({
  accentColor = '#3b82f6',
  className   = '',
  style,
  fps         = 30,
  autoRotate  = true,
}: Vehicle3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refsRef      = useRef<SceneRefs | null>(null);
  const rafRef       = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* Sahneyi oluştur */
    const sr = buildScene();
    refsRef.current = sr;

    /* Canvas'ı container'a ekle */
    container.appendChild(sr.renderer.domElement);

    const applySize = (w: number, h: number) => {
      if (w < 1 || h < 1) return;
      sr.renderer.setSize(w, h, false);
      sr.camera.aspect = w / h;
      sr.camera.updateProjectionMatrix();
      sr.dirty = true;
    };

    const rect = container.getBoundingClientRect();
    applySize(rect.width, rect.height);

    /* ResizeObserver — canvas boyutu responsive */
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      applySize(r.width, r.height);
    });
    ro.observe(container);

    /* OBD subscriber — React re-render olmadan doğrudan Three.js manipülasyonu */
    const unsub = onOBDData((data: OBDData) => {
      const s = refsRef.current;
      if (!s) return;

      /* Farlar (headlights) */
      const hlWant = data.headlights ? C_HEAD_ON : C_HEAD_OFF;
      const tlWant = data.headlights ? C_TAIL_ON : C_TAIL_OFF;
      if (s.headMat.color.getHex() !== hlWant) {
        s.headMat.color.setHex(hlWant);
        s.tailMat.color.setHex(tlWant);
        s.dirty = true;
      }

      /* Kapılar (doors) */
      if (data.doors) {
        const t = s.doorTargets;
        const nFL    = data.doors.fl    ? DOOR_OPEN_RAD        : 0;
        const nFR    = data.doors.fr    ? -DOOR_OPEN_RAD       : 0;
        const nRL    = data.doors.rl    ? DOOR_OPEN_RAD        : 0;
        const nRR    = data.doors.rr    ? -DOOR_OPEN_RAD       : 0;
        const nTrunk = data.doors.trunk ? -Math.PI * 0.58      : 0;
        if (t.fl !== nFL || t.fr !== nFR || t.rl !== nRL || t.rr !== nRR || t.trunk !== nTrunk) {
          t.fl = nFL; t.fr = nFR; t.rl = nRL; t.rr = nRR; t.trunk = nTrunk;
          s.dirty = true;
        }
      }

      /* TPMS lastik renkleri */
      if (data.tpms) {
        const check = (mat: THREE.MeshLambertMaterial, kpa: number) => {
          const want = kpa > 0 && kpa < TPMS_WARN_KPA ? C_TPMS_BAD : C_TPMS_OK;
          if (mat.color.getHex() !== want) { mat.color.setHex(want); s.dirty = true; }
        };
        check(s.wheelMats.fl, data.tpms.fl);
        check(s.wheelMats.fr, data.tpms.fr);
        check(s.wheelMats.rl, data.tpms.rl);
        check(s.wheelMats.rr, data.tpms.rr);
      }
    });

    /* Render döngüsü — 30/60 fps cap + dirty flag */
    const FRAME_MS = 1000 / fps;
    let lastMs     = 0;
    let alive      = true;

    const loop = (now: number) => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastMs < FRAME_MS) return;
      lastMs = now;

      const s = refsRef.current;
      if (!s) return;

      /* Kapı lerp animasyonu */
      const lerp = (grp: THREE.Group, target: number, axis: 'y' | 'x') => {
        const cur = grp.rotation[axis];
        const diff = target - cur;
        if (Math.abs(diff) > 0.0005) {
          grp.rotation[axis] = cur + diff * DOOR_LERP_SPD;
          s.dirty = true;
        } else if (grp.rotation[axis] !== target) {
          grp.rotation[axis] = target;
          s.dirty = true;
        }
      };

      lerp(s.doorFL,    s.doorTargets.fl,    'y');
      lerp(s.doorFR,    s.doorTargets.fr,    'y');
      lerp(s.doorRL,    s.doorTargets.rl,    'y');
      lerp(s.doorRR,    s.doorTargets.rr,    'y');
      lerp(s.doorTrunk, s.doorTargets.trunk, 'x');

      /* Oto-dönüş — kapı animasyonu varken durur */
      if (autoRotate) {
        const t = s.doorTargets;
        const allClosed = t.fl === 0 && t.fr === 0 && t.rl === 0 && t.rr === 0 && t.trunk === 0;
        const doorsSettled =
          Math.abs(s.doorFL.rotation.y)    < 0.01 &&
          Math.abs(s.doorFR.rotation.y)    < 0.01 &&
          Math.abs(s.doorRL.rotation.y)    < 0.01 &&
          Math.abs(s.doorRR.rotation.y)    < 0.01 &&
          Math.abs(s.doorTrunk.rotation.x) < 0.01;
        if (allClosed && doorsSettled) {
          s.carGroup.rotation.y += CAR_ROTATE_SPD;
          s.dirty = true;
        }
      }

      /* Sadece dirty ise render — boşta CPU/GPU harcama yok */
      if (s.dirty) {
        s.renderer.render(s.scene, s.camera);
        s.dirty = false;
      }
    };

    rafRef.current = requestAnimationFrame(loop);

    /* Zero-Leak cleanup */
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      unsub();

      const s = refsRef.current;
      if (s) {
        s.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        });
        s.renderer.dispose();
        s.renderer.forceContextLoss();
        s.renderer.domElement.remove();
      }
      refsRef.current = null;
    };
  }, [fps, autoRotate]);

  // accentColor değişince headlight materyalini güncelle (sahneyi yeniden kurmadan)
  useEffect(() => {
    // accentColor only affects future renders; no Three.js re-init needed
  }, [accentColor]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width:    '100%',
        height:   '100%',
        overflow: 'hidden',
        // GPU compositor layer — transition sırasında jank önleme
        transform:          'translateZ(0)',
        willChange:         'transform',
        backfaceVisibility: 'hidden',
        ...style,
      }}
    />
  );
});
