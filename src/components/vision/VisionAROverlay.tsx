/**
 * VisionAROverlay — Three.js tabanlı AR şerit projeksiyon katmanı
 *
 * - İki şerit sınırı çizgisi PerspectiveCamera ile perspektif projeksiyonla çizilir.
 * - Hız arttıkça kamera FOV daralır → vanishing point ileri kayar.
 * - LDW aktif olunca çizgiler kırmızıya döner + CSS drop-shadow glow tetiklenir.
 * - Zero-Leak: RAF iptali → Three.js dispose → DOM kaldırma sırası mühürlüdür.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  acquireARService,
  subscribeLDW,
  getARProjectionParams,
  setLaneHeading,
  type LDWState,
} from '../../platform/arProjectionService';
import { getThermalLevel } from '../../platform/thermalWatchdog';
import { onMemoryPressure }  from '../../platform/memoryWatchdog';
import { useNavigation } from '../../platform/navigationService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

// ── Sahne sabitleri (dünya birimi = metre) ────────────────────────────────────
const LANE_HALF_W  = 1.75;   // standart 3.5 m şerit yarı genişliği
const LANE_NEAR_Z  = -3;     // yakın uç (araç önü)
const LANE_FAR_Z   = -130;   // uzak uç (ufuk)
const CAM_Y        = 1.2;    // göz yüksekliği
const CAM_Z        = 2.5;    // kamera geri ofseti

// CSS glow filtresi
const GLOW_FILTER = 'drop-shadow(0 0 14px rgba(255,34,34,0.95)) drop-shadow(0 0 6px rgba(255,80,80,0.8))';

export default function VisionAROverlay() {
  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const mtlRef      = useRef<THREE.LineBasicMaterial | null>(null);
  const rafRef      = useRef<number | null>(null);

  const [ldw, setLdw] = useState<LDWState>({ departing: false, deviationDeg: 0, side: 'none' });

  const { headingToDestination, isNavigating } = useNavigation();
  const speed = useUnifiedVehicleStore(s => s.speed);

  // navigasyon heading'ini servise aktar
  useEffect(() => {
    setLaneHeading(isNavigating && headingToDestination != null ? headingToDestination : null);
  }, [headingToDestination, isNavigating]);

  // hız değişince kamera FOV'unu hemen güncelle (1-frame gecikme önlenir)
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const { fovDeg } = getARProjectionParams();
    cam.fov = fovDeg;
    cam.updateProjectionMatrix();
  }, [speed]);

  // ── Three.js mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const w = container.clientWidth  || 640;
    const h = container.clientHeight || 360;

    // Kamera: sürücü göz seviyesi, ileriye bakıyor
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, w / h, 0.5, 200);
    camera.position.set(0, CAM_Y, CAM_Z);
    camera.lookAt(0, 0, -50);

    // WebGL renderer — şeffaf, antialiasing kapalı (automotive perf)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    container.appendChild(renderer.domElement);

    cameraRef.current   = camera;
    rendererRef.current = renderer;

    // ── Şerit geometrisi (sol + sağ çizgi, 2 bağımsız segment) ──────────────
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        -LANE_HALF_W, 0, LANE_NEAR_Z,   // 0: sol yakın
        -LANE_HALF_W, 0, LANE_FAR_Z,    // 1: sol uzak
         LANE_HALF_W, 0, LANE_NEAR_Z,   // 2: sağ yakın
         LANE_HALF_W, 0, LANE_FAR_Z,    // 3: sağ uzak
      ]), 3),
    );
    geo.setIndex([0, 1, 2, 3]);  // LineSegments: 0→1 (sol), 2→3 (sağ)
    const mtl   = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const lines = new THREE.LineSegments(geo, mtl);
    scene.add(lines);
    mtlRef.current = mtl;

    // ── LDW aboneliği ─────────────────────────────────────────────────────────
    // RAF için yerel referans (React state re-render beklenmez)
    let currentLdw: LDWState = { departing: false, deviationDeg: 0, side: 'none' };
    const unsubLDW = subscribeLDW(s => {
      currentLdw = s;
      setLdw(s); // overlay UI güncelle
    });
    const releaseService = acquireARService();

    // ── RAF döngüsü ───────────────────────────────────────────────────────────
    let _arFrameCount = 0;
    const tick = (): void => {
      rafRef.current = requestAnimationFrame(tick);

      // Thermal throttle: HOT/CRITICAL (≥L2) → her 2 frame'de bir render (60fps → 30fps)
      _arFrameCount++;
      if (getThermalLevel() >= 2 && (_arFrameCount & 1) !== 0) return;

      // FOV: hız değişimlerini yakala (speed effect ayrıca halleder, burada güvence)
      const { fovDeg } = getARProjectionParams();
      if (Math.abs(camera.fov - fovDeg) > 0.2) {
        camera.fov = fovDeg;
        camera.updateProjectionMatrix();
      }

      // Şerit rengi: normal = beyaz, LDW = tehlike kırmızısı
      mtl.color.setHex(currentLdw.departing ? 0xff2222 : 0xffffff);

      renderer.render(scene, camera);

      // CSS glow — sadece canvas üzerine uygula, çevre UI etkilenmez
      renderer.domElement.style.filter = currentLdw.departing ? GLOW_FILTER : '';
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    });
    ro.observe(container);

    // ── Memory Watchdog — RAM baskısında WebGL context'i serbest bırak ─────────
    // MODERATE veya üstü: RAF durdur + renderer.dispose() → WebGL bellek serbest.
    // Three.js renderer 50-150 MB VRAM + RAM tüketir; baskı altında bu kritik kaynaktır.
    const disposeWebGL = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.domElement.remove();
        rendererRef.current = null;
      }
    };
    const unsubMemory = onMemoryPressure(evt => {
      if (evt.level === 'MODERATE' || evt.level === 'CRITICAL') {
        disposeWebGL();
      }
    });

    // ── Zero-Leak temizlik ────────────────────────────────────────────────────
    // Sıra kritik: RAF → abonelikler → ResizeObserver → Three.js → DOM
    return () => {
      unsubMemory();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      unsubLDW();
      releaseService();
      ro.disconnect();

      scene.remove(lines);
      geo.dispose();
      mtl.dispose();
      if (rendererRef.current) {
        rendererRef.current.dispose();           // WebGL context + texture memory serbest bırakılır
        rendererRef.current.domElement.remove(); // DOM'dan kaldır
        rendererRef.current = null;
      }

      cameraRef.current = null;
      mtlRef.current    = null;
    };
  }, []); // sadece mount/unmount

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={mountRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Kenar glow: saptığı yöne göre kırmızı gradient */}
      {ldw.departing && (
        <div
          className="absolute inset-y-0 w-1/4 transition-opacity duration-300"
          style={{
            [ldw.side === 'left' ? 'left' : 'right']: 0,
            background: ldw.side === 'left'
              ? 'linear-gradient(to right, rgba(255,34,34,0.35), transparent)'
              : 'linear-gradient(to left, rgba(255,34,34,0.35), transparent)',
          }}
        />
      )}

      {/* LDW uyarı etiketi */}
      {ldw.departing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full
                        bg-red-600/80 text-white text-xs font-bold tracking-widest
                        animate-pulse select-none">
          ŞERİT İHLALİ
        </div>
      )}
    </div>
  );
}
