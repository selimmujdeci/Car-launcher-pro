/**
 * CockpitPager — HOME ↔ Digital Cockpit sayfa geçişi (kabuk seviyesinde).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── HOME'A DOKUNULMADI ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu bileşen `MainLayout`/`NewHomeLayout`/tema layout'larını DEĞİŞTİRMEZ,
 * SARMAZ ve TRANSFORM ETMEZ. Kokpit HOME'un ÜSTÜNE kayan kardeş bir katmandır.
 *
 * NEDEN HOME KAYDIRILMIYOR (bilinçli mimari karar): HOME ağacı onlarca
 * `position: fixed` öğe barındırır (AddressNavCard z-9500 · çekmeceler ·
 * toast'lar · tam ekran harita). Bir ataya CSS `transform` uygulamak, o
 * ağaçtaki TÜM `fixed` öğelerin konum referansını viewport'tan o ataya
 * çevirir — yani HOME'u kaydırmaya çalışmak, HOME'un yerleşimini sessizce
 * bozardı. "Ana ekranın mevcut layout'unu bozma" kuralı bu yüzden kaydırmayı
 * TEK katmana (kokpit) sınırlar. Kullanıcı için sonuç aynıdır: yatay kaydırma
 * ile gelen/giden bir komşu sayfa.
 *
 * ── SERVİS YENİDEN BAŞLATMA YOK ───────────────────────────────────────────
 * HOME hiç unmount edilmez → Navigation/Music/Mavi/Vehicle abonelikleri
 * dokunulmadan sürer. Kokpit katmanı İLK açılışta mount olur ve sonra
 * MOUNT KALIR (kapanınca ekran dışına kayar); böylece her geçişte yeniden
 * mount/effect çalışması olmaz. Kokpit zaten kendi aboneliğini açmaz —
 * yalnız mevcut store'ları okur (`useCockpitData`).
 *
 * ── GÜVENLİK ──────────────────────────────────────────────────────────────
 * Geri vites · tiyatro · uyku · tam ekran harita/çekmece açıkken jest HİÇ
 * başlamaz. Geri vites devreye girerse kokpit ANINDA HOME'a döner (kamera
 * önceliği mutlaktır).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useSystemStore } from '../../store/useSystemStore';
import { DigitalCockpitPage } from './DigitalCockpitPage';
import {
  canBeginPageSwipe, classifyPageDrag, resolvePageSwipe,
  type CockpitPage,
} from './cockpitSwipeModel';

/** Sayfa oturma animasyonu — akıcı ama ağır değil (OEM hissi). */
const SETTLE_MS = 260;
const SETTLE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/**
 * Bu z-index'in ÜSTÜNDE kalan sabit bir ata varsa jest başlamaz.
 * Ölçü: HOME çekmeceleri z-1000, AddressNavCard z-9500, tiyatro z-9990.
 * 900 tabanı, HOME'un normal içeriğini (z≤100) serbest bırakır.
 */
const OVERLAY_Z_FLOOR = 900;

/** Kokpit katmanının z-index'i — AddressNavCard'ın üstünde, tiyatro/geri vitesin ALTINDA. */
const COCKPIT_Z = 9600;

/**
 * Dokunuşun başladığı nokta HOME'un normal içeriğinde mi, yoksa üstte duran
 * bir yüzeyde mi? Harita tuvali ve kaydırılabilir/etkileşimli öğeler de burada
 * elenir — böylece mevcut hiçbir jest bozulmaz.
 */
function isBlockedByDom(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Harita etkileşimini ASLA bozma.
  if (target.closest('.maplibregl-canvas, .maplibregl-map, canvas')) return true;
  // Açıkça dışlanmak isteyen öğeler (ileride bir bileşen kendini korumak isterse).
  if (target.closest('[data-no-page-swipe]')) return true;
  // Metin girişi / kaydırıcı üzerinde sayfa jesti olmaz.
  if (target.closest('input, textarea, select, [role="slider"], [contenteditable="true"]')) return true;

  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      // Kokpitin kendi katmanı engel değildir.
      if (el instanceof HTMLElement && el.dataset.carosCockpit === 'layer') return false;
      const cs = window.getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'absolute') {
        const z = Number.parseInt(cs.zIndex, 10);
        if (Number.isFinite(z) && z >= OVERLAY_Z_FLOOR) return true;
      }
    }
  }
  return false;
}

export function CockpitPager() {
  const [page, setPage] = useState<CockpitPage>('home');
  /** Kokpit ilk kez açılana kadar DOM'a hiç girmez (boot maliyeti sıfır). */
  const [mounted, setMounted] = useState(false);
  /** Sürükleme sırasındaki anlık kayma (px). `null` = sürükleme yok. */
  const [dragDx, setDragDx] = useState<number | null>(null);

  const isReverse = useSystemStore((s) => s.isReverseActive);
  const isTheater = useSystemStore((s) => s.isTheaterModeActive);
  /* Sürüş bilgisi YOKSA "duruyor" VARSAYILMAZ: eşik sürüş varsayımıyla
     (yüksek) hesaplanır — fail-closed. */
  const isDriving = useSystemStore((s) => s.isDriving);
  const sleepMode = useStore((s) => s.settings.sleepMode);

  const blocked = isReverse || isTheater || sleepMode;

  const g = useRef({
    active: false, engaged: false, pointerId: -1,
    startX: 0, startY: 0, startT: 0, dx: 0,
  });

  /* ── Güvenlik: geri vites / tiyatro / uyku → kokpit anında kapanır ───── */
  useEffect(() => {
    if (blocked && page !== 'home') {
      setPage('home');
      setDragDx(null);
    }
  }, [blocked, page]);

  const endDrag = useCallback((commit: boolean) => {
    const st = g.current;
    if (commit && st.engaged) {
      const vw = window.innerWidth || 1;
      const dt = Math.max(1, performance.now() - st.startT);
      const r = resolvePageSwipe({
        page, dx: st.dx, viewportWidth: vw,
        isDriving: isDriving !== false, // bilinmiyorsa sürüş VARSAY (yüksek eşik)
        velocityPxPerMs: Math.abs(st.dx) / dt,
      });
      if (r.committed) setPage(r.target);
    }
    st.active = false; st.engaged = false; st.pointerId = -1; st.dx = 0;
    setDragDx(null);
  }, [page, isDriving]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (g.current.active) return;
      if (blocked) return;
      const vw = window.innerWidth || 1;
      if (!canBeginPageSwipe({ page, startX: e.clientX, viewportWidth: vw, blocked: false })) return;
      if (isBlockedByDom(e.target)) return;
      g.current = {
        active: true, engaged: false, pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY, startT: performance.now(), dx: 0,
      };
    };

    const onMove = (e: PointerEvent) => {
      const st = g.current;
      if (!st.active || e.pointerId !== st.pointerId) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      const verdict = classifyPageDrag({ page, dx, dy });
      if (verdict === 'rejected') { st.active = false; st.engaged = false; setDragDx(null); return; }
      if (verdict === 'pending') return;

      if (!st.engaged) {
        st.engaged = true;
        if (!mounted) setMounted(true);
      }
      st.dx = dx;
      setDragDx(dx);
      /* Jest DOĞRULANDIKTAN sonra altdaki UI'ya sızmasın (yanlış tıklama yok). */
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      const st = g.current;
      if (!st.active || e.pointerId !== st.pointerId) return;
      endDrag(true);
    };
    const onCancel = () => { if (g.current.active) endDrag(false); };

    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [page, blocked, mounted, endDrag]);

  /* ── Donanım geri tuşu: kokpit açıkken önce HOME'a dön ───────────────── */
  useEffect(() => {
    if (page !== 'cockpit') return;
    const handler = (e: Event) => {
      e.stopImmediatePropagation();  // MainLayout'un "çıkmak için tekrar bas"ına gitmesin
      setPage('home');
    };
    window.addEventListener('carlauncherBackButton', handler, { capture: true });
    return () => window.removeEventListener('carlauncherBackButton', handler, { capture: true });
  }, [page]);

  if (!mounted) return null;

  /* Kapalıyken ekranın SAĞINDA bekler; açıkken 0. Sürükleme anlık kaymayı ekler. */
  const restPct = page === 'cockpit' ? 0 : 100;
  const dragging = dragDx !== null;
  const vw = typeof window !== 'undefined' ? (window.innerWidth || 1) : 1;
  const dragPct = dragging ? (dragDx / vw) * 100 : 0;
  const translatePct = Math.max(0, Math.min(100, restPct + dragPct));
  const open = page === 'cockpit';

  return (
    <div
      data-caros-cockpit="layer"
      data-cockpit-page={page}
      aria-hidden={!open}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: COCKPIT_Z,
        transform: `translate3d(${translatePct}%, 0, 0)`,
        transition: dragging ? 'none' : `transform ${SETTLE_MS}ms ${SETTLE_EASE}`,
        willChange: 'transform',
        pointerEvents: open || dragging ? 'auto' : 'none',
        overscrollBehavior: 'contain',
      }}
    >
      <DigitalCockpitPage />
    </div>
  );
}

export default CockpitPager;
