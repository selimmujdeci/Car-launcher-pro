import { memo, useState, useEffect } from 'react';
import { Gauge, Satellite, Sparkles } from 'lucide-react';
import { isNative } from '../../platform/bridge';
import { useOBDState, getObdFreshWindowMs } from '../../platform/obdService';
import { useGPSState } from '../../platform/gpsService';
import { getAiHealthSnapshot } from '../../platform/aiHealth';
import { sensitiveKeyStore } from '../../platform/sensitiveKeyStore';
import type { StatusPalette } from './StatusControls';
import { StatusItem, type StatusItemState } from './StatusItem';
import {
  deriveObdStatus, deriveGpsStatus, deriveAiStatus, statusTone, statusAnimates,
  type ObdStatus, type GpsStatus, type AiStatus, type StatusTone,
} from '../../platform/vehicleStatusModel';

/**
 * VehicleStatusIndicators — OEM durum çubuğuna OBD / GPS / AI göstergeleri ekler.
 *
 * StatusControls (Wi-Fi/BT/ses) ile AYNI öğe (`StatusItem`: ikon + kısa etiket +
 * anlamsal nokta); MEVCUT kaynaklardan beslenir (yeni state/polling/health-ping
 * YOK). Büyük renkli rozet yok. Nabız YALNIZ connecting/checking durumunda ve CSS
 * `motion-safe:` ile (prefers-reduced-motion / low-tier'da kapanır) — JS timer/rAF yok.
 *
 * AI ikonu SIKI kurala tabi: yapılandırılmış sağlayıcı yoksa / kapalıysa HİÇ render
 * edilmez. Anahtar DEĞERİ hiçbir zaman state'e/DOM'a/log'a taşınmaz — yalnız `has()`
 * boolean'ı okunur.
 */

const AI_PROVIDER_KEYS = ['geminiApiKey', 'claudeHaikuApiKey', 'groqApiKey'] as const;

/** Model tonu → durum öğesi durumu (renk/anlam StatusItem'ındır). */
const TONE_STATE: Record<StatusTone, StatusItemState> = {
  ok: 'ok', active: 'active', warn: 'warn', error: 'error', muted: 'off',
};

const OBD_LABEL: Record<ObdStatus, string> = {
  connected: 'OBD: Bağlı', stale: 'OBD: Veri bayat', connecting: 'OBD: Bağlanıyor',
  disconnected: 'OBD: Bağlı değil', error: 'OBD: Hata', unavailable: 'OBD: Yok',
};
const GPS_LABEL: Record<GpsStatus, string> = {
  fixed: 'GPS: Fix var', weak: 'GPS: Zayıf sinyal', searching: 'GPS: Aranıyor',
  stale: 'GPS: Konum bayat', disabled: 'GPS: Kapalı', error: 'GPS: Hata',
};
const AI_LABEL: Record<AiStatus, string> = {
  healthy: 'AI: Hazır', fallback: 'AI: Yedek sağlayıcı', error: 'AI: Kullanılamıyor',
  checking: 'AI: Kontrol ediliyor', hidden: '',
};

type IndicatorId = 'obd' | 'gps' | 'ai';

function VehicleStatusIndicatorsInner({ palette, size = 15 }: { palette: StatusPalette; size?: number }) {
  const obd = useOBDState();
  const gps = useGPSState();
  const [open, setOpen] = useState<IndicatorId | null>(null);

  // AI yapılandırma kontrolü — TEK SEFERLİK (polling değil). Yalnız boolean/sayı tutulur,
  // anahtar DEĞERİ asla state'e girmez.
  const [ai, setAi] = useState({ configured: false, checked: false, providerCount: 0 });
  useEffect(() => {
    let alive = true;
    Promise.all(AI_PROVIDER_KEYS.map((k) => sensitiveKeyStore.has(k).catch(() => false)))
      .then((flags) => {
        if (!alive) return;
        const count = flags.filter(Boolean).length;
        setAi({ configured: count > 0, checked: true, providerCount: count });
      })
      .catch(() => { if (alive) setAi((a) => ({ ...a, checked: true })); });
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const obdStatus = deriveObdStatus({
    connectionState: obd.connectionState, source: obd.source,
    lastSeenMs: obd.lastSeenMs, now, available: isNative,
    // "OBD bağlı değil" YALNIZ doğrulanmış transport kopmasında. ECU'nun susması
    // (dataFresh=false) 'stale' üretir → son değerler korunur, sahte kopma yok.
    transportConnected: obd.transportConnected,
    freshMs: getObdFreshWindowMs(),   // aktif poll kadansından türer
  });
  const gpsStatus = deriveGpsStatus({
    unavailable: gps.unavailable, isTracking: gps.isTracking, hasLocation: gps.location != null,
    accuracy: gps.location?.accuracy ?? Infinity, error: gps.error != null,
    fixTimestamp: gps.location?.timestamp ?? 0, now,
  });
  // AI health: mevcut circuit breaker (yeni ping YOK). Global circuit → readyCount coarse.
  const aiHealthy = getAiHealthSnapshot().healthy;
  const aiStatus = deriveAiStatus({
    configured: ai.configured, enabled: true, checked: ai.checked,
    providerCount: ai.providerCount,
    readyProviderCount: aiHealthy ? ai.providerCount : 0,
    primaryReady: aiHealthy,
  });

  const renderIcon = (
    id: IndicatorId, Icon: typeof Gauge, caption: string,
    status: ObdStatus | GpsStatus | AiStatus, label: string,
  ) => (
    <StatusItem
      key={id}
      Icon={Icon}
      state={TONE_STATE[statusTone(status)]}
      caption={caption}
      label={label}
      onClick={() => setOpen((o) => (o === id ? null : id))}
      palette={palette}
      size={size}
      /* Yalnız bağlanıyor/kontrol durumunda hafif nabız (CSS, reduced-motion korumalı). */
      pulseClassName={statusAnimates(status) ? 'motion-safe:animate-pulse' : undefined}
    />
  );

  const labelFor = (id: IndicatorId): string =>
    id === 'obd' ? OBD_LABEL[obdStatus] : id === 'gps' ? GPS_LABEL[gpsStatus] : AI_LABEL[aiStatus];

  return (
    <div className="flex items-center" style={{ gap: 4, position: 'relative' }}>
      {renderIcon('obd', Gauge, 'OBD', obdStatus, OBD_LABEL[obdStatus])}
      {renderIcon('gps', Satellite, 'GPS', gpsStatus, GPS_LABEL[gpsStatus])}
      {/* AI: yapılandırılmış sağlayıcı yoksa / kapalıysa HİÇ render edilmez */}
      {aiStatus !== 'hidden' && renderIcon('ai', Sparkles, 'AI', aiStatus, AI_LABEL[aiStatus])}

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 120 }} onClick={() => setOpen(null)} />
          <div
            role="status"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 121,
              background: palette.surface ?? 'rgba(22,22,27,0.97)',
              border: `1px solid ${palette.line ?? 'rgba(255,255,255,0.14)'}`, borderRadius: 12,
              padding: '8px 12px', boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
              fontSize: 12, fontWeight: 700, color: palette.ink, whiteSpace: 'nowrap',
            }}
          >
            {labelFor(open)}
          </div>
        </>
      )}
    </div>
  );
}

export const VehicleStatusIndicators = memo(VehicleStatusIndicatorsInner);
