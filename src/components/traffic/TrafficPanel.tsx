/**
 * TrafficPanel — trafik çekmecesi (Google Maps tarzı), YALNIZ gerçek veriyle.
 *
 * Kaynak TomTom (akış katmanı + bulunulan yol + olaylar) ya da HERE. Anahtar/konum/
 * servis yoksa NEDEN'i yazan durum kartı gösterilir — uydurma yol/yoğunluk YOK.
 * TomTom verisi gösterildiğinde "© TomTom" atfı zorunludur (lisans).
 */
import { useEffect, useState } from 'react';
import {
  Ban, CarFront, CloudRain, Construction, OctagonAlert, Radio, TrafficCone, TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTrafficState, TRAFFIC_COLORS, type TrafficIncident } from '../../platform/trafficService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { TrafficMapMini } from './TrafficMapMini';
import {
  INCIDENT_COLORS, INCIDENT_TITLE, LEVEL_LABEL, UNAVAILABLE_TEXT, fmtAge, fmtDelay, fmtDistance, incidentRoute,
  lowConfidence, roadSpeedLine,
} from './trafficPanelModel';

const INCIDENT_ICON: Record<TrafficIncident['kind'], LucideIcon> = {
  accident: TriangleAlert, jam: CarFront, roadworks: Construction, road_closed: Ban,
  lane_closed: TrafficCone, broken_vehicle: CarFront, weather: CloudRain, danger: OctagonAlert, other: OctagonAlert,
};

const SOURCE_LABEL = { tomtom: 'TomTom', here: 'HERE' } as const;

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold"
      style={{ background: 'rgba(11,18,32,0.82)', color: '#E8EAED' }}>
      <span>Hızlı</span>
      <span className="flex h-2 w-24 overflow-hidden rounded-full">
        {(['free', 'moderate', 'heavy', 'standstill'] as const).map((l) => (
          <span key={l} className="flex-1" style={{ background: TRAFFIC_COLORS[l] }} />
        ))}
      </span>
      <span>Yavaş</span>
    </div>
  );
}

function IncidentRow({ i }: { i: TrafficIncident }) {
  const Icon = INCIDENT_ICON[i.kind];
  const color = INCIDENT_COLORS[i.kind];
  const delay = fmtDelay(i.delaySec);
  const dist = fmtDistance(i.distanceM);
  const route = incidentRoute(i);
  return (
    <div data-traffic-incident={i.kind} className="flex items-center gap-3 rounded-2xl px-3 py-3"
      style={{ background: 'var(--oem-surface-2)' }}>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: `${color}22`, color }}>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[color:var(--oem-ink)]">
          {INCIDENT_TITLE[i.kind]}{i.description ? <span className="font-normal text-[color:var(--oem-ink-2)]"> · {i.description}</span> : null}
        </p>
        {route && <p className="truncate text-[13px] text-[color:var(--oem-ink-2)]">{route}</p>}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end">
        {delay && <span className="text-[15px] font-bold" style={{ color: i.magnitude >= 3 ? '#E53935' : '#F9A825' }}>{delay}</span>}
        {dist && <span className="text-[12px] text-[color:var(--oem-ink-3)]">{dist}</span>}
      </div>
    </div>
  );
}

export function TrafficPanel() {
  const traffic = useTrafficState();
  const s = traffic.summary;
  const location = useUnifiedVehicleStore((st) => st.location);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const lat = location?.latitude;
  const lng = location?.longitude;
  const hasPos = typeof lat === 'number' && typeof lng === 'number';
  const unavailable = !s && !traffic.loading ? (traffic.unavailable ?? (hasPos ? null : 'no_location')) : null;
  const road = s?.road ?? null;
  const incidents = s?.incidents ?? [];

  return (
    <div data-theme-surface="traffic" data-editable="traffic.screen" data-editable-type="panel" className="space-y-3 p-4">
      <div data-editable="traffic.header" data-editable-type="header" className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[color:var(--oem-ink)]">Trafik</h2>
        {s ? (
          <span data-traffic-source={s.source} data-editable="traffic.badge" data-editable-type="card" className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{ background: 'rgba(52,168,83,0.14)', color: '#34A853' }}>
            <Radio size={13} /> {SOURCE_LABEL[s.source]} · canlı · {fmtAge(s.updatedAt, now)}
          </span>
        ) : (
          <span data-editable="traffic.badge" data-editable-type="card" className="rounded-full px-3 py-1 text-[12px] font-semibold text-[color:var(--oem-ink-3)]"
            style={{ background: 'var(--oem-surface-2)' }}>
            {traffic.loading ? 'yükleniyor…' : 'canlı veri yok'}
          </span>
        )}
      </div>

      {hasPos && (
        <div className="relative">
          <TrafficMapMini lat={lat} lng={lng} tileUrl={s ? traffic.tileLayerUrl || undefined : undefined}
            road={road} incidents={incidents} />
          {s && traffic.tileLayerUrl && <Legend />}
        </div>
      )}

      {unavailable && (
        <div data-traffic-unavailable={unavailable} className="rounded-2xl px-4 py-3" style={{ background: 'var(--oem-surface-2)' }}>
          <p className="text-[15px] font-semibold text-[color:var(--oem-ink)]">{UNAVAILABLE_TEXT[unavailable].title}</p>
          <p className="mt-0.5 text-[13px] text-[color:var(--oem-ink-2)]">{UNAVAILABLE_TEXT[unavailable].body}</p>
        </div>
      )}

      {road && (
        <div data-traffic-road="" className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--oem-surface-2)' }}>
          <span className="h-10 w-1.5 flex-shrink-0 rounded-full" style={{ background: TRAFFIC_COLORS[road.level] }} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--oem-ink-3)]">Bulunduğun yol</p>
            <p className="text-[17px] font-bold" style={{ color: TRAFFIC_COLORS[road.level] }}>{LEVEL_LABEL[road.level]}</p>
            <p className="text-[13px] text-[color:var(--oem-ink-2)]">
              {roadSpeedLine(road)}{lowConfidence(road) ? ' · az veri' : ''}
            </p>
          </div>
          {fmtDelay(road.delaySec) && (
            <span className="flex-shrink-0 text-[17px] font-bold" style={{ color: TRAFFIC_COLORS[road.level] }}>{fmtDelay(road.delaySec)}</span>
          )}
        </div>
      )}

      {s && s.source === 'tomtom' && (
        <div className="space-y-2">
          <p className="px-1 text-[13px] font-semibold text-[color:var(--oem-ink-2)]">
            {incidents.length > 0 ? `Çevrede ${incidents.length} olay` : 'Çevrede bildirilmiş olay yok'}
          </p>
          {incidents.map((i) => <IncidentRow key={i.id} i={i} />)}
        </div>
      )}

      {s && s.source === 'here' && s.segments.length > 0 && (
        <div className="space-y-2">
          {s.segments.map((seg, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--oem-surface-2)' }}>
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: TRAFFIC_COLORS[seg.level] }} />
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[color:var(--oem-ink)]">{seg.label}</p>
            </div>
          ))}
        </div>
      )}

      {s && (
        <p className="pt-1 text-center text-[11px] text-[color:var(--oem-ink-3)]">
          © {SOURCE_LABEL[s.source]} · {new Date(s.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} güncellendi
        </p>
      )}
    </div>
  );
}
