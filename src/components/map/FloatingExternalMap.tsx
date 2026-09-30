/**
 * FloatingExternalMap — rota Yandex/Google/Waze'deyken uygulamamızın ÜSTÜNDE
 * sürüklenebilir küçük pencere; içinde O SAĞLAYICININ web haritası.
 *
 * Sahibin kararı (2026-09-30): "uygulamanın üzerine mini harita çıksın, rota
 * bitince veya iptal edince kapansın, istediğimiz yere çekebilelim; içinde
 * Yandex'in / Google'ın haritası olsun". Kapanış: varış (bizim GPS, bkz.
 * externalRouteWatcher) · × · bizde yeni navigasyon · azami ömür.
 *
 * Bizim harita/rota ÇİZİLMEZ (iki farklı rota gösterilmez). İnternet yoksa
 * boş kutu yerine durum dürüstçe yazılır. Konum kaydı yalnız kolaylıktır
 * (localStorage, try/catch).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, GripHorizontal, Maximize2, Minimize2, Minus, PanelTopOpen, X } from 'lucide-react';
import { clearExternalRoute, useExternalRoute } from '../../platform/navigation/externalRouteState';
import { buildExternalMapEmbedUrl } from '../../platform/navigation/externalMapEmbed';
import { EXTERNAL_NAV_LABEL, bringExternalAppToFront } from '../../platform/navigation/externalNavHandoff';
import { startExternalRouteWatch } from '../../platform/navigation/externalRouteWatcher';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { allowsConnectivity } from '../../platform/connectivity/connectivityGate';
import { subscribeConnectivity } from '../../platform/connectivity/connectivityAuthority';

const POS_KEY = 'caros-external-map-pos';
const SIZE_KEY = 'caros-external-map-size';
const COLLAPSED_KEY = 'caros-external-map-collapsed';
/* Telefonda ölçüldü (2026-09-30): eski 360×250 kutuda harita alanı 358×150 px
   kalıyordu; Yandex'in rota kartı çizgiyi, Waze'in arayüzü haritayı örtüyordu.
   Varsayılan büyütüldü, başlık tek satıra indi; ayrıca büyüt/küçült ve
   simge durumu (yalnız başlık çubuğu) var. */
const SIZES = {
  normal: { w: 'min(560px, 60vw)', h: 'min(380px, 70vh)' },
  large:  { w: 'min(760px, 86vw)', h: 'min(500px, 86vh)' },
} as const;
type SizeMode = keyof typeof SIZES;

interface Pos { x: number; y: number }

function _loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x as number, y: p.y as number } : null;
  } catch { return null; }
}

function _savePos(p: Pos): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* kolaylık — kaybolabilir */ }
}

function _loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function _loadSize(): SizeMode {
  try { return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'normal'; } catch { return 'normal'; }
}

export const FloatingExternalMap = memo(function FloatingExternalMap() {
  const route = useExternalRoute();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => _loadPos());
  const [size, setSize] = useState<SizeMode>(() => _loadSize());
  const [collapsed, setCollapsed] = useState<boolean>(() => _loadCollapsed());
  const [loading, setLoading] = useState(true);
  /* İnternet hükmü TEK otoriteden (connectivityAuthority); navigator.onLine okunmaz. */
  const [online, setOnline] = useState(() => allowsConnectivity('CLOUD_INTERACTIVE'));

  /* Başlangıç noktası: yalnız CANLI GPS (native/web). Son bilinen / varsayılan
     konum başlangıç SAYILMAZ (sahte rota çizilmez). Telefonda ölçüldü
     (2026-09-30): uygulama yeniden açılınca konum henüz yoktu → pencere yalnız
     hedefi gösteriyordu. Artık canlı konum ilk geldiğinde adres BİR KEZ rota
     olarak yeniden kurulur; sonra her GPS güncellemesinde yeniden yüklenmez. */
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    setOrigin(null);
    if (!route) return;
    const pick = (st: ReturnType<typeof useUnifiedVehicleStore.getState>) => {
      const loc = st.location;
      if (st.gpsSource !== 'native' && st.gpsSource !== 'web') return null;
      return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
        ? { lat: loc.latitude, lng: loc.longitude } : null;
    };
    const now = pick(useUnifiedVehicleStore.getState());
    if (now) { setOrigin(now); return; }
    let unsub: (() => void) | null = null;
    unsub = useUnifiedVehicleStore.subscribe((st) => {
      const o = pick(st);
      if (o) { setOrigin(o); unsub?.(); unsub = null; }
    });
    return () => { unsub?.(); };
  }, [route?.startedAtMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const src = useMemo(() => {
    if (!route) return null;
    return buildExternalMapEmbedUrl(route.provider, { lat: route.lat, lng: route.lng }, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız yeni rotada / ilk canlı konumda kur
  }, [route?.startedAtMs, origin]);

  useEffect(() => { setLoading(true); }, [src]);

  useEffect(() => subscribeConnectivity(() => setOnline(allowsConnectivity('CLOUD_INTERACTIVE'))), []);

  /* Bitiş izleyicisi TEK yerden: yeni rota kurulunca ve uygulama yeniden
     açılıp kayıtlı rota geri yüklenince (varış/azami ömür yine kapatır). */
  useEffect(() => { if (route) startExternalRouteWatch(); }, [route?.startedAtMs]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sürükleme: başlık tutamacından, Pointer Events (dokunmatik + fare) ── */
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const clamp = useCallback((x: number, y: number): Pos => {
    const el = boxRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)),
    };
  }, []);

  /* Boyut değişince pencere ekran dışına taşmasın (konum kaydı güncellenir). */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setPos((p) => {
        if (!p) return p;
        const c = clamp(p.x, p.y);
        if (c.x === p.x && c.y === p.y) return p;
        _savePos(c);
        return c;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [size, collapsed, clamp]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1'); } catch { /* kolaylık */ }
      return !c;
    });
  };

  const toggleSize = () => {
    setSize((m) => {
      const next: SizeMode = m === 'large' ? 'normal' : 'large';
      try { localStorage.setItem(SIZE_KEY, next); } catch { /* kolaylık */ }
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setPos((p) => { if (p) _savePos(p); return p; });
  };

  if (!route) return null;
  const label = EXTERNAL_NAV_LABEL[route.provider];
  const { w: W, h: H0 } = SIZES[size];
  /* Simge durumu: yalnız başlık çubuğu kalır (sürüklenebilir), harita kaldırılır. */
  const H = collapsed ? 'auto' : H0;
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: collapsed ? 'min(340px, 80vw)' : W, height: H }
    : { right: 16, bottom: 96, width: collapsed ? 'min(340px, 80vw)' : W, height: H };
  const btn = 'w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-[var(--oem-surface-3)] text-[color:var(--oem-ink)] active:scale-90';

  return (
    <div
      ref={boxRef}
      data-testid="floating-external-map"
      data-size={collapsed ? 'collapsed' : size}
      data-no-page-swipe
      className="fixed z-[var(--z-floating)] flex flex-col overflow-hidden rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-0)] shadow-2xl"
      style={style}
    >
      <div
        className="flex items-center gap-1.5 px-1.5 py-1 bg-[var(--oem-surface-2)] border-b border-[var(--oem-line)] select-none"
        style={{ touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GripHorizontal className="w-4 h-4 flex-shrink-0 text-[color:var(--oem-ink-3)]" />
        <div className="flex-1 min-w-0 truncate text-[13px] leading-tight">
          <span className="font-black uppercase tracking-[0.08em] text-[color:var(--oem-ink-3)]">{collapsed ? label : `${label} rotası`}</span>
          <span className="text-[color:var(--oem-ink-3)]"> · </span>
          <span className="font-bold text-[color:var(--oem-ink)]">{route.destName}</span>
        </div>
        <button
          type="button"
          aria-label={collapsed ? 'Haritayı aç' : 'Simge durumuna küçült'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleCollapsed}
          className={btn}
        >
          {collapsed ? <PanelTopOpen className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
        </button>
        {!collapsed && <button
          type="button"
          aria-label={size === 'large' ? 'Küçült' : 'Büyüt'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSize}
          className={btn}
        >
          {size === 'large' ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>}
        {route.packageName && (
          <button
            type="button"
            aria-label={`${label} uygulamasına dön`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { void bringExternalAppToFront(route.packageName); }}
            className={btn}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="Kapat"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={clearExternalRoute}
          className={btn}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed && <div className="flex-1 relative">
        {!online || !src ? (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-[13px] font-bold text-[color:var(--oem-ink-2)]">
            {!src ? 'Hedef koordinatı geçersiz' : `İnternet yok — ${label} haritası yüklenemiyor`}
          </div>
        ) : (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-[color:var(--oem-ink-3)]">
                {label} haritası yükleniyor…
              </div>
            )}
            <iframe
              title={`${label} haritası`}
              src={src}
              className="w-full h-full border-none"
              onLoad={() => setLoading(false)}
              sandbox="allow-scripts allow-same-origin"
            />
          </>
        )}
      </div>}
    </div>
  );
});
