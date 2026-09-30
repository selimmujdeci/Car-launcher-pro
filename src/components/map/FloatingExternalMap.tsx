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
import { ExternalLink, GripHorizontal, X } from 'lucide-react';
import { clearExternalRoute, useExternalRoute } from '../../platform/navigation/externalRouteState';
import { buildExternalMapEmbedUrl } from '../../platform/navigation/externalMapEmbed';
import { EXTERNAL_NAV_LABEL, bringExternalAppToFront } from '../../platform/navigation/externalNavHandoff';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { allowsConnectivity } from '../../platform/connectivity/connectivityGate';
import { subscribeConnectivity } from '../../platform/connectivity/connectivityAuthority';

const POS_KEY = 'caros-external-map-pos';
const W = 'min(360px, 46vw)';
const H = 'min(250px, 42vh)';

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

export const FloatingExternalMap = memo(function FloatingExternalMap() {
  const route = useExternalRoute();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => _loadPos());
  const [loading, setLoading] = useState(true);
  /* İnternet hükmü TEK otoriteden (connectivityAuthority); navigator.onLine okunmaz. */
  const [online, setOnline] = useState(() => allowsConnectivity('CLOUD_INTERACTIVE'));

  /* Başlangıç noktası pencere AÇILDIĞI andaki konumdur — her GPS güncellemesinde
     iframe yeniden yüklenmesin diye rota kimliğine (startedAtMs) bağlanır. */
  const src = useMemo(() => {
    if (!route) return null;
    const loc = useUnifiedVehicleStore.getState().location;
    const origin = loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
      ? { lat: loc.latitude, lng: loc.longitude } : null;
    return buildExternalMapEmbedUrl(route.provider, { lat: route.lat, lng: route.lng }, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız yeni rotada yeniden kur
  }, [route?.startedAtMs]);

  useEffect(() => { setLoading(true); }, [src]);

  useEffect(() => subscribeConnectivity(() => setOnline(allowsConnectivity('CLOUD_INTERACTIVE'))), []);

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
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: W, height: H }
    : { right: 16, bottom: 96, width: W, height: H };

  return (
    <div
      ref={boxRef}
      data-testid="floating-external-map"
      data-no-page-swipe
      className="fixed z-[var(--z-floating)] flex flex-col overflow-hidden rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-0)] shadow-2xl"
      style={style}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 bg-[var(--oem-surface-2)] border-b border-[var(--oem-line)] select-none"
        style={{ touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GripHorizontal className="w-4 h-4 flex-shrink-0 text-[color:var(--oem-ink-3)]" />
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[color:var(--oem-ink-3)]">{label} rotası</div>
          <div className="text-[13px] font-bold truncate text-[color:var(--oem-ink)]">{route.destName}</div>
        </div>
        {route.packageName && (
          <button
            type="button"
            aria-label={`${label} uygulamasına dön`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { void bringExternalAppToFront(route.packageName); }}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--oem-surface-3)] text-[color:var(--oem-ink)] active:scale-90"
          >
            <ExternalLink className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Kapat"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={clearExternalRoute}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--oem-surface-3)] text-[color:var(--oem-ink)] active:scale-90"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 relative">
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
      </div>
    </div>
  );
});
