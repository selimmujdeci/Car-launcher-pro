/**
 * AdasSettingsPanel — Sürüş Destek (ADAS) ayarları + canlı durum.
 *
 * Varsayılan KAPALI. Sürücüye söylenen her şey kanıta dayanır: çalışmıyorsa NEDENİ,
 * kalibre olmadıysa İLERLEMESİ, mesafe güvenilir değilse "—" yazılır (sahte metre yok).
 * USB kamera takılı ama sistem açamıyorsa bu da açıkça söylenir.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  useAdasStore, setAdasSettings, getAdasCalibration, saveAdasCalibration, resetAdasCalibration, cameraKeyFor,
} from '../../platform/adas/adasStore';
import { DEFAULT_ADAS_CALIBRATION } from '../../platform/adas/adasCalibration';
import type { AdasSettings } from '../../platform/adas/adasStore';
import { discoverRoadCameras, subscribeCameraChanges } from '../../platform/adas/adasCameraDiscovery';
import type { CameraDiscoveryReport } from '../../platform/adas/adasCameraDiscovery';
import { describeAdasStatus, describeUsbVerdict } from '../../platform/adas/adasStatusText';
import type { AdasTone } from '../../platform/adas/adasStatusText';
import type { AdasSensitivity } from '../../platform/adas/adasTypes';

const ink2 = 'var(--oem-ink-3, rgba(255,255,255,0.45))';
const ink1 = 'var(--oem-ink-2, rgba(255,255,255,0.75))';
const ACCENT = '#34d399';

const TONE_COLOR: Record<AdasTone, string> = {
  ok: '#34d399',
  info: '#60a5fa',
  warn: '#fbbf24',
  off: 'var(--oem-ink-3, rgba(255,255,255,0.45))',
};

const FEATURES: ReadonlyArray<{ key: keyof Pick<AdasSettings, 'forwardCollision' | 'headway' | 'laneDeparture' | 'leadDeparture'>; label: string; sub: string }> = [
  { key: 'forwardCollision', label: 'Ön çarpışma uyarısı', sub: 'Öndeki araca hızla yaklaşırken sesli + kırmızı uyarı' },
  { key: 'laneDeparture', label: 'Şeritten ayrılma', sub: '55–65 km/sa üstünde, sinyalsiz şerit kayması' },
  { key: 'headway', label: 'Takip mesafesi', sub: 'Öndeki araçla aradaki süre sürekli kısaysa' },
  { key: 'leadDeparture', label: 'Öndeki araç kalktı', sub: 'Dururken öndeki araç hareket edince hafif uyarı' },
];

const SENS: ReadonlyArray<{ id: AdasSensitivity; label: string }> = [
  { id: 'early', label: 'Erken' },
  { id: 'normal', label: 'Normal' },
  { id: 'late', label: 'Geç' },
];

function Chip({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }): ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
      style={{
        background: on ? 'rgba(52,211,153,0.16)' : 'var(--oem-surface-3, rgba(255,255,255,0.05))',
        border: `1px solid ${on ? 'rgba(52,211,153,0.5)' : 'var(--oem-line, rgba(255,255,255,0.1))'}`,
        color: on ? ACCENT : ink1,
      }}
    >
      {children}
    </button>
  );
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }): ReactElement {
  const btn = 'w-9 h-9 rounded-xl text-[16px] font-black active:scale-95';
  const st = { background: 'var(--oem-surface-3, rgba(255,255,255,0.05))', border: '1px solid var(--oem-line, rgba(255,255,255,0.1))', color: ink1 };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px]" style={{ color: ink2 }}>{label}</span>
      <div className="flex items-center gap-2">
        <button className={btn} style={st} onClick={onDec} aria-label={`${label} azalt`}>−</button>
        <b className="min-w-[4.5rem] text-center text-[12px]" style={{ color: ink1 }}>{value}</b>
        <button className={btn} style={st} onClick={onInc} aria-label={`${label} artır`}>+</button>
      </div>
    </div>
  );
}

export const AdasSettingsPanel = memo(function AdasSettingsPanel() {
  const settings = useAdasStore((s) => s.settings);
  const status = useAdasStore((s) => s.status);
  const reason = useAdasStore((s) => s.reason);
  const progress = useAdasStore((s) => Math.round(s.calibrationProgress * 20) / 20);
  const storedCal = useAdasStore((s) => s.calibrations[cameraKeyFor(s.settings.cameraDeviceId)]);
  // Canlı değerler yuvarlanarak seçilir → 10 Hz akış paneli 10 Hz yeniden çizdirmez.
  const leadM = useAdasStore((s) => (s.lead?.distanceM != null ? Math.round(s.lead.distanceM) : null));
  const leadGap = useAdasStore((s) => (s.lead?.timeGapS != null ? Math.round(s.lead.timeGapS * 10) / 10 : null));
  const leadSeen = useAdasStore((s) => s.lead !== null);
  const laneL = useAdasStore((s) => s.lane?.leftTracked === true);
  const laneR = useAdasStore((s) => s.lane?.rightTracked === true);

  const [report, setReport] = useState<CameraDiscoveryReport | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = (): void => { void discoverRoadCameras().then((r) => { if (alive) setReport(r); }); };
    refresh();
    const unsub = subscribeCameraChanges(refresh);
    return () => { alive = false; unsub(); };
  }, []);

  const cal = storedCal ?? DEFAULT_ADAS_CALIBRATION;
  const patchCal = useCallback((p: Partial<typeof cal>) => {
    saveAdasCalibration(settings.cameraDeviceId, { ...getAdasCalibration(settings.cameraDeviceId), ...p });
  }, [settings.cameraDeviceId]);

  const st = describeAdasStatus(status, reason, progress);
  const usbNote = report ? describeUsbVerdict(report.verdict) : null;
  const running = status === 'active' || status === 'calibrating' || status === 'degraded';

  return (
    <div className="flex flex-col gap-3" data-testid="adas-settings">
      <div className="text-[11px] leading-snug" style={{ color: ink2 }}>
        Kamera ile öndeki aracı ve şerit çizgilerini izler; tehlikede sesli ve görsel uyarı verir.
        <b> Sürücü desteğidir — dikkatli sürüşün yerine geçmez, frenlemez.</b> Kamera yalnız
        sürüş sırasında çalışır; park ve geri viteste kapanır.
      </div>

      {/* ── Ana anahtar + durum ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--oem-ink)' }}>Sürüş Destek</span>
          <span className="text-[11px] font-bold" style={{ color: TONE_COLOR[st.tone] }} data-testid="adas-status">{st.title}</span>
        </div>
        <Chip on={settings.enabled} onClick={() => setAdasSettings({ enabled: !settings.enabled })}>
          {settings.enabled ? 'Açık' : 'Kapalı'}
        </Chip>
      </div>
      {st.detail && (
        <div className="text-[11px] leading-snug" style={{ color: TONE_COLOR[st.tone] }}>{st.detail}</div>
      )}

      {running && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]" style={{ color: ink2 }} data-testid="adas-live">
          <span>Öndeki araç</span>
          <b style={{ color: ink1 }}>
            {!leadSeen ? 'yok' : leadM === null ? 'izleniyor (mesafe kalibrasyon bekliyor)' : `${leadM} m${leadGap !== null ? ` · ${leadGap.toFixed(1)} sn` : ''}`}
          </b>
          <span>Şerit çizgileri</span>
          <b style={{ color: ink1 }}>{laneL && laneR ? 'iki taraf izleniyor' : laneL ? 'yalnız sol' : laneR ? 'yalnız sağ' : 'görülmüyor'}</b>
        </div>
      )}

      {/* ── Özellikler ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        {FEATURES.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold" style={{ color: ink1 }}>{f.label}</span>
              <span className="text-[10px]" style={{ color: ink2 }}>{f.sub}</span>
            </div>
            <Chip on={settings[f.key]} onClick={() => setAdasSettings({ [f.key]: !settings[f.key] })}>
              {settings[f.key] ? 'Açık' : 'Kapalı'}
            </Chip>
          </div>
        ))}
      </div>

      {/* ── Hassasiyet ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold" style={{ color: ink1 }}>Uyarı zamanlaması</span>
        <div className="flex gap-1.5">
          {SENS.map((s) => (
            <Chip key={s.id} on={settings.sensitivity === s.id} onClick={() => setAdasSettings({ sensitivity: s.id })}>{s.label}</Chip>
          ))}
        </div>
      </div>

      {/* ── Yol kamerası (dahili / USB) ─────────────────────────────────── */}
      <div className="flex flex-col gap-1.5" data-testid="adas-camera">
        <span className="text-[11px] font-bold" style={{ color: ink1 }}>Yol kamerası</span>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={settings.cameraDeviceId === null} onClick={() => setAdasSettings({ cameraDeviceId: null })}>Otomatik (arka)</Chip>
          {(report?.cameras ?? []).map((c) => (
            <Chip key={c.deviceId} on={settings.cameraDeviceId === c.deviceId} onClick={() => setAdasSettings({ cameraDeviceId: c.deviceId })}>
              {c.kind === 'usb' || c.kind === 'external' ? `USB · ${c.label}` : c.label}
            </Chip>
          ))}
        </div>
        {report && report.usbDevices.length > 0 && (
          <div className="text-[10px]" style={{ color: ink2 }}>
            USB'de görülen: {report.usbDevices.map((d) => d.name || `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`).join(', ')}
          </div>
        )}
        {usbNote && <div className="text-[11px] leading-snug" style={{ color: report?.verdict === 'usb_ready' ? ACCENT : '#fbbf24' }}>{usbNote}</div>}
      </div>

      {/* ── Kalibrasyon (seçili kameraya özgü) ──────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold" style={{ color: ink1 }}>
          Kalibrasyon · {cal.source === 'default' ? 'yapılmadı (otomatik öğrenir)' : cal.source === 'auto' ? 'otomatik tamamlandı' : 'elle'}
        </span>
        <Stepper
          label="Kamera yüksekliği (yoldan)"
          value={`${cal.cameraHeightM.toFixed(2)} m`}
          onDec={() => patchCal({ cameraHeightM: Math.max(0.5, Math.round((cal.cameraHeightM - 0.05) * 100) / 100) })}
          onInc={() => patchCal({ cameraHeightM: Math.min(3.0, Math.round((cal.cameraHeightM + 0.05) * 100) / 100) })}
        />
        <Stepper
          label="Kaput payı (görüntü altı)"
          value={`%${Math.round((1 - cal.hoodV) * 100)}`}
          onDec={() => patchCal({ hoodV: Math.min(1.0, Math.round((cal.hoodV + 0.02) * 100) / 100) })}
          onInc={() => patchCal({ hoodV: Math.max(0.6, Math.round((cal.hoodV - 0.02) * 100) / 100) })}
        />
        <button
          onClick={() => resetAdasCalibration(settings.cameraDeviceId)}
          disabled={cal.source === 'default'}
          className="self-start px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-30"
          style={{ background: 'var(--oem-surface-3, rgba(255,255,255,0.05))', border: '1px solid var(--oem-line, rgba(255,255,255,0.1))', color: ink1 }}
        >
          Kalibrasyonu sıfırla (kamera yeri değiştiyse)
        </button>
      </div>
    </div>
  );
});
