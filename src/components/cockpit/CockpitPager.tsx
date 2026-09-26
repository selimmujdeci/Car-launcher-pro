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
 *
 * ── JEST: NE KENAR KISITI NE YÖN KISITI (saha düzeltmesi) ─────────────────
 * Jest EKRANIN HER YERİNDEN ve HER İKİ YATAY YÖNDEN başlar. İkisi de saha
 * dersidir: önce "yalnız sağ kenar bandı" kısıtı kondu (kullanıcı açamadı),
 * sonra "yalnız SOLA" ve ardından "yalnız SAĞA" yön dayatıldı (yine açamadı).
 * Tek komşu sayfası olan bir kabukta "yanlış yön" YOKTUR: kullanıcı yatay
 * kaydırdıysa niyeti bellidir. Sayfanın hangi kenardan geleceği jestin
 * yönünden TÜRETİLİR (`entrySideForDrag`) — parmak sola giderse sayfa sağdan,
 * sağa giderse soldan gelir; ters/"lastik" his oluşmaz.
 *
 * Dikey baskın hareket hâlâ REDDEDİLİR (ses jesti/scroll dokunulmaz) ve
 * gerçekten yatay kaydırılabilen HOME kartları (dock/carousel) ile düşük
 * z-index'li tam ekran yüzeyler `data-no-page-swipe` ile korunur
 * (`isBlockedByDom`) — kenar kısıtı olmadığı için bu tek koruma kaldı.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useSystemStore } from '../../store/useSystemStore';
import { DigitalCockpitPage } from './DigitalCockpitPage';
import {
  canBeginPageSwipe, classifyPageDrag, resolvePageSwipe, entrySideForDrag, neighborFor,
  type CockpitPage, type CockpitEntrySide,
} from './cockpitSwipeModel';
import { ObdLivePage } from './ObdLivePage';
import { TripComputerPage } from './TripComputerPage';
import { registerCockpitPageHandler, unregisterCockpitPageHandler } from '../../platform/cockpitPageBus';

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
 * bir yüzeyde mi? Jest artık EKRANIN HER YERİNDEN başlayabildiği için (kenar
 * bandı kısıtı kaldırıldı — saha talebi) bu fonksiyon TEK savunma hattıdır ve
 * İKİ mekanizma kullanır (blanket `canvas` kuralı KALDIRILDI — bkz. gövdedeki
 * not: mini harita tuvali HOME'un merkezini kapladığı için o kural jestin
 * gerçek parmakla hiç çalışmamasının kök nedeniydi):
 *   1. `data-no-page-swipe` — GERÇEKTEN yatay kaydırılabilen dock/carousel'ler
 *      VE kendi z-index'i düşük tam-ekran yüzeyler (FullMapView z=50,
 *      SplitScreen z=60, RearViewCamera z=90 — bunlar `DrawerShell` ARACILIĞIYLA
 *      açılmaz, kendi z-index'lerini yönetirler, bu yüzden aşağıdaki z≥900
 *      taraması onları YAKALAMAZ; ÖLÇÜLDÜ saha bulgusu: tam ekran navigasyonun
 *      "Yol sonunda dönün" kartı üzerinden başlayan bir kaydırma, dışlama
 *      olmadan sayfa jestine kurban gidiyordu).
 *   2. z≥900 sabit ata taraması (aşağıda) — `DrawerShell` tabanlı ÇEKMECELER
 *      (apps/music/phone/settings/climate/… — hepsi z-1000/z-9999) ve
 *      `AddressNavCard` (z-9500) bununla yakalanır.
 */
function isBlockedByDom(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  /* ── TEK KAPI: `data-no-page-swipe` (saha kararı) ────────────────────────
   * Blanket `canvas` kuralı KALDIRILDI: jestin gerçek parmakla hiç
   * çalışmamasının kök nedeni oydu (sentetik testler `window`a olay
   * gönderdiği için bu kapıyı hiç görmüyordu).
   *
   * Yerine AÇIK işaretleme kullanılır. Sayfa jestinden muaf yüzeyler:
   *   · mini harita (`MiniMapWidget` kökü) — kullanıcı haritayı sağa/sola pan
   *     edebilmeli; sayfa jesti haritayı çalmaz,
   *   · alt dock kökü (`DockBar` + 4 tema dock'u) — yatay dock kaydırması,
   *   · tam ekran harita / split / kamera kökleri,
   *   · metin girişi ve slider'lar.
   * Bunların DIŞINDA kalan her yerden yatay kaydırma sayfayı değiştirir. */
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
  /**
   * Kokpitin ekrana HANGİ KENARDAN gireceği — jestin yönünden TÜRETİLİR.
   * Kullanıcıya yön DAYATILMAZ (iki tur yanlış tahminin dersi): parmak sola
   * giderse sayfa sağdan, sağa giderse soldan gelir; içerik her zaman parmağın
   * gittiği yöne akar.
   */
  const [entrySide, setEntrySide] = useState<CockpitEntrySide>('right');

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

  /* ── Sesli sayfa isteği ("yolculuk bilgisayarını aç") — cockpitPageBus ───
     Sayfa durumunun sahibi BURASI. Güvenlik kapısı jestle AYNIDIR: geri vites /
     tiyatro / uyku açıkken kokpit sesle de AÇILMAZ ve `false` döner. */
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => {
    registerCockpitPageHandler((p) => {
      if (p !== 'home' && blockedRef.current) return false;
      if (p !== 'home') setMounted(true);
      setDragDx(null);
      setPage(p);
      return true;
    });
    return () => { unregisterCockpitPageHandler(); };
  }, []);

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
      if (!canBeginPageSwipe({ blocked })) return;
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
        /* Giriş kenarı YALNIZ jest devreye girerken, HOME'dayken belirlenir;
           tur ortasında değişmez (sayfa zıplamaz). */
        if (page === 'home') setEntrySide(entrySideForDrag(dx));
        if (!mounted) setMounted(true);
      }
      st.dx = dx;
      setDragDx(dx);
      /* ── JEST DOĞRULANDIKTAN SONRA OLAYI SAHİPLEN ────────────────────────
       * `stopPropagation` ŞART: dinleyiciler CAPTURE fazındadır, yani olay
       * hedefe (ör. MapLibre tuvali) İNMEDEN önce buradan geçer. Yalnız
       * yatay baskınlık KANITLANDIKTAN sonra durdururuz — o ana kadar tüm
       * dokunuşlar (harita pan/zoom, dikey kaydırma, butonlar) normal
       * çalışır. Bu, `VolumeGestureLayer`ın kullandığı desenin AYNISIDIR. */
      e.preventDefault();
      e.stopPropagation();
    };

    const onUp = (e: PointerEvent) => {
      const st = g.current;
      if (!st.active || e.pointerId !== st.pointerId) return;
      endDrag(true);
    };
    /* ── POINTERCANCEL: NİYETİ ATMA (saha bulgusu) ──────────────────────
     * Harita gibi kendi dokunma akışını süren bileşenler devreye girince
     * tarayıcı bize `pointercancel` gönderip pointer akışını KESER. Eskiden
     * bunu `endDrag(false)` ile çöpe atıyorduk — yani harita üzerinden
     * başlayan kaydırma, mesafe yeterli olsa bile sessizce DÜŞÜYORDU.
     * Jest zaten DEVREYE GİRDİYSE karar normal bırakma gibi verilir
     * (eşik/hız kapısı `resolvePageSwipe`te AYNEN uygulanır). */
    const onCancel = () => {
      const st = g.current;
      if (!st.active) return;
      endDrag(st.engaged);
    };

    /* ── DOKUNMA AKIŞINI DA SAHİPLEN ────────────────────────────────────
     * MapLibre pointer DEĞİL **touch** olaylarını dinler; pointer akışını
     * durdurmak onu durdurmaz. Jest doğrulandıktan SONRA touch akışını da
     * capture fazında keseriz: hem native kaydırma (ve onun tetiklediği
     * `pointercancel`) engellenir, hem harita altta kaymaz. Jest devreye
     * girmeden HİÇBİR touch olayına dokunulmaz — harita pan/zoom ve
     * dikey kaydırma aynen çalışır. */
    const onTouchMove = (e: TouchEvent) => {
      if (!g.current.engaged) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };

    /* CAPTURE fazı: olay hedefe (MapLibre tuvali vb.) inmeden BURADAN geçer;
       jest doğrulanınca `stopPropagation` ile sahiplenebilelim diye şart. */
    const capPassive: AddEventListenerOptions = { capture: true, passive: true };
    const capActive: AddEventListenerOptions = { capture: true, passive: false };
    window.addEventListener('pointerdown', onDown, capPassive);
    window.addEventListener('pointermove', onMove, capActive);
    window.addEventListener('pointerup', onUp, capPassive);
    window.addEventListener('pointercancel', onCancel, capPassive);
    window.addEventListener('touchmove', onTouchMove, capActive);
    return () => {
      window.removeEventListener('pointerdown', onDown, capPassive);
      window.removeEventListener('pointermove', onMove, capActive);
      window.removeEventListener('pointerup', onUp, capPassive);
      window.removeEventListener('pointercancel', onCancel, capPassive);
      window.removeEventListener('touchmove', onTouchMove, capActive);
    };
  }, [page, blocked, mounted, endDrag]);

  /* ── Donanım geri tuşu: kokpit/OBD açıkken önce HOME'a dön ──────────── */
  useEffect(() => {
    if (page === 'home') return;
    const handler = (e: Event) => {
      e.stopImmediatePropagation();  // MainLayout'un "çıkmak için tekrar bas"ına gitmesin
      setPage('home');
    };
    window.addEventListener('carlauncherBackButton', handler, { capture: true });
    return () => window.removeEventListener('carlauncherBackButton', handler, { capture: true });
  }, [page]);

  if (!mounted) return null;

  /* Kapalıyken jestin geldiği KENARDA bekler (sağ: +100% · sol: -100%);
     açıkken 0. Sürükleme anlık kaymayı ekler ve kırpma o kenara göre yapılır —
     böylece parmak hangi yöne giderse sayfa o yönde akar. */
  const open = page !== 'home';
  const closedPct = entrySide === 'right' ? 100 : -100;
  const restPct = open ? 0 : closedPct;
  const dragging = dragDx !== null;
  const vw = typeof window !== 'undefined' ? (window.innerWidth || 1) : 1;
  /* İki AÇIK sayfa arasında (kokpit ⇄ OBD) katman YERİNDE kalır: o jest
     içeriği değiştirir, katmanı ekrandan çıkarmaz. Katman yalnız HOME'a
     giderken ya da HOME'dan gelirken kayar — açılma/kapanma hissi aynen korunur. */
  const dragTarget = dragging ? neighborFor(page, dragDx) : null;
  const layerMoves = !open || dragTarget === 'home';
  const dragPct = dragging && layerMoves ? (dragDx / vw) * 100 : 0;
  const raw = restPct + dragPct;
  const translatePct = entrySide === 'right'
    ? Math.max(0, Math.min(100, raw))
    : Math.max(-100, Math.min(0, raw));
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
      {page === 'obd'  ? <ObdLivePage onHome={() => setPage('home')} />
        : page === 'trip' ? <TripComputerPage onHome={() => setPage('home')} />
          : <DigitalCockpitPage />}
    </div>
  );
}

export default CockpitPager;
