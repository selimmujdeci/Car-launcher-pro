/**
 * RadarAlertHUD.tsx — Eagle Eye floating alert panel.
 *
 * Slides in from the top when a radar enters the front cone.
 * Shows nearest front-cone threat: type, distance, speed limit.
 * When a live radar is within 50 m a verification prompt appears.
 *
 * Uses useRadarStore directly (not useRadarSystem) so it never starts
 * a second GPS subscription.
 */

import { useMemo }                            from 'react';
import { Camera, Radio, Gauge, Activity }     from 'lucide-react';
import { useRadarStore }                      from '../../platform/radar/radarStore';
import type { ThreatEntry }                   from '../../platform/radar/radarStore';
import { voteThreat }                         from '../../platform/radar/radarCommunityService';

// ── Label / style maps ────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  speed:    'Hız Kamerası',
  redlight: 'Kırmızı Işık',
  mobile:   'Mobil Radar',
  average:  'Ortalama Hız',
};

const TYPE_BG: Record<string, string> = {
  speed:    'rgba(249,115,22,0.18)',
  redlight: 'rgba(239,68,68,0.18)',
  mobile:   'rgba(234,179,8,0.18)',
  average:  'rgba(59,130,246,0.18)',
};

const TYPE_BORDER: Record<string, string> = {
  speed:    'rgba(249,115,22,0.55)',
  redlight: 'rgba(239,68,68,0.55)',
  mobile:   'rgba(234,179,8,0.55)',
  average:  'rgba(59,130,246,0.55)',
};

const TYPE_TEXT: Record<string, string> = {
  speed:    '#fb923c',
  redlight: '#f87171',
  mobile:   '#facc15',
  average:  '#60a5fa',
};

function TypeIcon({ type, size = 20 }: { type: string; size?: number }) {
  const cls = `shrink-0`;
  const style = { color: TYPE_TEXT[type] ?? '#a3a3a3', width: size, height: size };
  if (type === 'mobile')   return <Radio    className={cls} style={style} />;
  if (type === 'average')  return <Activity className={cls} style={style} />;
  if (type === 'speed')    return <Gauge    className={cls} style={style} />;
  return <Camera className={cls} style={style} />;  // redlight default
}

// ── Handlers (no hook — called directly on store) ────────────────────────────

async function confirmRadar(radarId: string): Promise<void> {
  useRadarStore.getState().patchThreat(radarId, { needsVerification: false });
  await voteThreat(radarId, 'confirm').catch(() => undefined);
}

async function denyRadar(radarId: string): Promise<void> {
  useRadarStore.getState().patchThreat(radarId, { needsVerification: false });
  await voteThreat(radarId, 'deny').catch(() => undefined);
}

// ── Sub-component: verification prompt ───────────────────────────────────────

function VerifyPrompt({ threat }: { threat: ThreatEntry }) {
  const id = threat.radar.id;
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 rounded-xl mt-2"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      <span className="text-xs font-semibold tracking-wide" style={{ color: 'rgba(255,255,255,0.70)' }}>
        Radar hâlâ burada mı?
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => confirmRadar(id)}
          className="px-3 py-1 rounded-lg text-xs font-bold active:scale-90 transition-transform"
          style={{ background: 'rgba(34,197,94,0.25)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.40)' }}
        >
          Evet
        </button>
        <button
          onClick={() => denyRadar(id)}
          className="px-3 py-1 rounded-lg text-xs font-bold active:scale-90 transition-transform"
          style={{ background: 'rgba(239,68,68,0.20)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}
        >
          Hayır
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RadarAlertHUD() {
  const threats = useRadarStore((s) => s.threats);

  const nearestFront = useMemo((): ThreatEntry | null => {
    let best: ThreatEntry | null = null;
    for (const t of threats.values()) {
      if (!t.inFrontCone) continue;
      if (!best || t.distanceM < best.distanceM) best = t;
    }
    return best;
  }, [threats]);

  const verifyPending = useMemo(
    () => Array.from(threats.values()).filter((t) => t.needsVerification),
    [threats],
  );

  const visible = nearestFront !== null;

  if (!visible && verifyPending.length === 0) {
    return (
      <div
        aria-hidden="true"
        style={{ transform: 'translateY(-110%)', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9900 }}
      />
    );
  }

  const t    = nearestFront;
  const type = t?.radar.type ?? 'speed';
  const dist = t ? Math.max(0, Math.round(t.distanceM / 10) * 10) : 0;
  const bg   = TYPE_BG[type]     ?? 'rgba(100,100,100,0.18)';
  const brd  = TYPE_BORDER[type] ?? 'rgba(100,100,100,0.40)';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position:   'fixed',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     9900,
        transform:  visible ? 'translateY(0)' : 'translateY(-110%)',
        transition: 'transform 0.36s cubic-bezier(0.34,1.56,0.64,1)',
        pointerEvents: 'none',
      }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth:        480,
          margin:          '10px 12px 0',
          padding:         '12px 16px',
          borderRadius:    '1.25rem',
          background:      `${bg}`,
          backdropFilter:  'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          border:          `1.5px solid ${brd}`,
          boxShadow:       '0 8px 32px rgba(0,0,0,0.45)',
          pointerEvents:   verifyPending.length > 0 ? 'auto' : 'none',
        }}
      >
        {t && (
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: TYPE_BG[type], border: `1px solid ${brd}` }}
            >
              <TypeIcon type={type} size={22} />
            </div>

            {/* Label + live badge */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-sm font-extrabold tracking-wide uppercase truncate"
                  style={{ color: TYPE_TEXT[type] ?? '#fff' }}
                >
                  {TYPE_LABEL[type] ?? 'Radar'}
                </span>
                {t.radar.isLive && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}
                  >
                    İHBAR
                  </span>
                )}
              </div>
              <div className="text-xs font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.50)' }}>
                {t.phase === 'AT_POINT' ? 'Radar noktasında' : 'İleride radar'}
              </div>
            </div>

            {/* Distance + speed limit */}
            <div className="flex flex-col items-end shrink-0">
              <span className="text-xl font-black tabular-nums" style={{ color: '#fff' }}>
                {dist < 1000 ? `${dist} m` : `${(dist / 1000).toFixed(1)} km`}
              </span>
              {t.radar.speedLimit != null && (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-lg mt-0.5"
                  style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}
                >
                  {t.radar.speedLimit} km/h
                </span>
              )}
            </div>
          </div>
        )}

        {/* Verification prompts */}
        {verifyPending.map((vt) => (
          <VerifyPrompt key={vt.radar.id} threat={vt} />
        ))}
      </div>
    </div>
  );
}
