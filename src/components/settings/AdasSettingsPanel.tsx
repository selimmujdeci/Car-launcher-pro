/**
 * AdasSettingsPanel — Sürüş Asistanı ayarları (Ayarlar › Sürüş Asistanı).
 *
 * Bu panel bir PROJEKSİYONDUR: durum `useAdasStore`'dan (tek yazar adasRuntime)
 * okunur, kullanıcı niyeti `settings.adas`'a yazılır. Hiçbir uyarı/karar
 * burada üretilmez.
 *
 * İlk açılışta sınırlamalar onaylatılır. Canlı görüntü (kameranın yolu doğru
 * gördüğünü doğrulamak ve elle hizalamak için) YALNIZ araç dururken gösterilir;
 * hız bilinmiyorsa durmuyor sayılır.
 */
import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ArrowLeftRight, ArrowUpToLine, Camera, CarFront, Crosshair, Info, MoveUp, RefreshCw,
  RotateCcw, Ruler, ShieldCheck, TriangleAlert, Usb, type LucideIcon,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAdasStore, type AdasOverall } from '../../platform/adas/adasStore';
import {
  DEFAULT_ADAS_SETTINGS, type AdasFeature, type AdasFeatureStatus, type AdasReason,
  type AdasSensitivity, type AdasSettings,
} from '../../platform/adas/adasTypes';
import { manualCalibration } from '../../platform/adas/adasCalibration';
import { LANE_REF_Y } from '../../platform/adas/adasGeometry';
import {
  diagnoseUsb, listAdasCameras, readCameraHardware, type AdasCameraOption, type UsbDiagnosis,
} from '../../platform/adas/adasCamera';
import { cameraKeyOf } from '../../platform/adas/adasSupervisor';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { attachVisionPreview, getVisionTrackInfo, useVisionStore } from '../../platform/vision';

type ToggleProps = {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void; icon?: LucideIcon;
};

const ACCENT = '#38bdf8';

const OVERALL_TEXT: Readonly<Record<AdasOverall, string>> = {
  OFF: 'Kapalı', STARTING: 'Başlıyor…', ACTIVE: 'Etkin', CALIBRATING: 'Kamerayı öğreniyor',
  DEGRADED: 'Kısmen etkin', UNAVAILABLE: 'Kullanılamıyor',
};

const ADAS_REASON_TEXT: Readonly<Record<AdasReason, string>> = {
  DISABLED: 'Kapalı',
  NO_CONSENT: 'Açmak için sınırlamaları onaylayın',
  NO_CAMERA: 'Yola bakan kamera bulunamadı',
  CAMERA_DENIED: 'Kamera izni verilmedi',
  CAMERA_ERROR: 'Kamera bağlantısı kesildi',
  CAMERA_STALLED: 'Kamera görüntüsü dondu',
  CALIBRATING: 'Kamera öğreniliyor',
  VERIFYING_CAMERA: 'Kameranın yola baktığı doğrulanıyor',
  CAMERA_FACES_BACKWARD: 'Bu kamera arkaya bakıyor (geri görüş) — önü gören bir kamera gerekli',
  LOW_VISIBILITY: 'Şerit çizgileri görünmüyor',
  SPEED_UNKNOWN: 'Hız bilgisi yok',
  BELOW_SPEED: 'Hız eşiğinin altında — beklemede',
  SYSTEM_PROTECTION: 'Sistem koruması (ısı / kaynak)',
  DETECTOR_LOADING: 'Araç tanıma hazırlanıyor',
  DETECTOR_UNAVAILABLE: 'Bu cihazda araç tanıma çalışmıyor',
  DETECTOR_TOO_SLOW: 'İşlemci araç tanımaya yetişmiyor',
  REVERSE: 'Geri viteste beklemede',
};

const FEATURES: ReadonlyArray<{ id: AdasFeature; label: string; desc: string; Icon: LucideIcon }> = [
  { id: 'ldw', label: 'Şerit Uyarısı', desc: '60 km/h üstünde, sinyal vermeden şeritten çıkarken uyarır', Icon: ArrowLeftRight },
  { id: 'fcw', label: 'Çarpışma Uyarısı', desc: 'Öndeki araca çarpmaya ~2 saniye kala uyarır (15 km/h üstü)', Icon: CarFront },
  { id: 'headway', label: 'Takip Mesafesi', desc: 'Öndeki araca 1 saniyeden yakın takipte uyarır (50 km/h üstü)', Icon: ArrowUpToLine },
  { id: 'leadDeparture', label: 'Öndeki Araç Kalktı', desc: 'Dururken öndeki araç ilerleyince hatırlatır', Icon: MoveUp },
];

const SENSITIVITY: ReadonlyArray<{ id: AdasSensitivity; label: string }> = [
  { id: 'early', label: 'Erken' }, { id: 'normal', label: 'Normal' }, { id: 'late', label: 'Geç' },
];

const USB_TEXT: Readonly<Record<UsbDiagnosis, string>> = {
  USB_READY: 'USB kamera bulundu ve kullanılabilir.',
  USB_NOT_EXPOSED: 'USB kamera takılı ama bu cihaz onu kamera olarak sunmuyor (sistemde UVC desteği yok).',
  NO_USB: 'Yola bakan her kamera kullanılabilir: head unit ön kamera girişi, telefon/tablet arka kamerası ya da USB kamera. Kameranın öne baktığı ilk sürüşte otomatik doğrulanır.',
};

function directionTag(f: 'forward' | 'backward' | undefined): string {
  return f === 'forward' ? ' · ✓ yola bakıyor' : f === 'backward' ? ' · arkaya bakıyor' : '';
}

function LearnStep({ label, value, hint }: { label: string; value: number; hint: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between text-xs font-semibold" style={{ color: 'var(--oem-ink-2)' }}>
        <span>{label}</span><span className="tabular-nums">{pct >= 100 ? '✓' : `%${pct}`}</span>
      </span>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.2)' }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: pct >= 100 ? '#34d399' : ACCENT }} />
      </div>
      <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>{hint}</span>
    </div>
  );
}

function featureLine(st: AdasFeatureStatus | undefined): { text: string; tone: 'ok' | 'idle' | 'warn' } {
  if (!st || st.state === 'OFF') return { text: 'Kapalı', tone: 'idle' };
  if (st.state === 'READY') return { text: 'Hazır', tone: 'ok' };
  return {
    text: st.reason ? ADAS_REASON_TEXT[st.reason] : 'Beklemede',
    tone: st.state === 'UNAVAILABLE' ? 'warn' : 'idle',
  };
}

const TONE_COLOR = { ok: '#34d399', idle: 'var(--oem-ink-3)', warn: '#f59e0b' } as const;

// ── Canlı önizleme ───────────────────────────────────────────────────────────

const AdasLivePreview = memo(function AdasLivePreview(
  { align }: { align: { horizonY: number; centerX: number } | null },
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visionState = useVisionStore((s) => s.state);
  const cameraLabel = useAdasStore((s) => s.debug.cameraLabel);
  const alignRef = useRef(align);
  alignRef.current = align;
  const track = getVisionTrackInfo();
  const aspect = track && track.width > 0 && track.height > 0 ? track.width / track.height : 16 / 9;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || (visionState !== 'active' && visionState !== 'degraded')) return;
    return attachVisionPreview(v);
  }, [visionState, cameraLabel]);

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      const { debug } = useAdasStore.getState();
      const a = alignRef.current;

      const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash: number[] = []) => {
        g.save();
        g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
        g.beginPath(); g.moveTo(x1 * w, y1 * h); g.lineTo(x2 * w, y2 * h); g.stroke();
        g.restore();
      };
      for (const l of [debug.lanes?.left, debug.lanes?.right]) {
        if (l) line(l.x1, l.y1, l.x2, l.y2, 'rgba(52,211,153,0.95)', 3);
      }
      if (a) {
        line(0, a.horizonY, 1, a.horizonY, 'rgba(56,189,248,0.95)', 2, [8, 6]);
        line(a.centerX, a.horizonY, a.centerX, LANE_REF_Y, 'rgba(56,189,248,0.95)', 2, [8, 6]);
      } else if (debug.referenceLine) {
        const r = debug.referenceLine;
        line(0, r.y1, 1, r.y1, 'rgba(255,255,255,0.35)', 1, [4, 6]);
        line(r.x1, r.y1, r.x2, r.y2, 'rgba(255,255,255,0.55)', 1.5, [4, 6]);
      }
      if (debug.lead) {
        const b = debug.lead.box;
        g.strokeStyle = 'rgba(251,191,36,0.95)'; g.lineWidth = 2.5;
        g.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
        if (debug.lead.distanceM !== null) {
          g.fillStyle = 'rgba(251,191,36,0.95)'; g.font = '600 13px system-ui, sans-serif';
          g.fillText(`${Math.round(debug.lead.distanceM)} m`, b.x * w, Math.max(14, b.y * h - 6));
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const live = visionState === 'active' || visionState === 'degraded';
  return (
    <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: String(aspect), background: '#05070a' }}>
      <video ref={videoRef} muted playsInline autoPlay
        className="absolute inset-0 w-full h-full" style={{ objectFit: 'fill' }} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {!live && (
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold" style={{ color: '#cbd5e1' }}>
          Kamera açılıyor…
        </div>
      )}
    </div>
  );
});

// ── Küçük yapı taşları ───────────────────────────────────────────────────────

function Row({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--oem-surface-2, rgba(255,255,255,0.03))', border: '1px solid rgba(148,163,184,0.18)' }}>
      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>
        <Icon className="w-4 h-4" style={{ color: ACCENT }} /> {title}
      </div>
      {children}
    </div>
  );
}

function Btn({ onClick, children, primary, disabled }: {
  onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-40 active:scale-[0.98]"
      style={primary
        ? { background: ACCENT, color: '#04131c' }
        : { background: 'rgba(148,163,184,0.14)', color: 'var(--oem-ink)', border: '1px solid rgba(148,163,184,0.25)' }}>
      {children}
    </button>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-semibold" style={{ color: 'var(--oem-ink-2)' }}>
        <span>{label}</span><span className="tabular-nums" style={{ color: 'var(--oem-ink)' }}>{value.toFixed(step < 1 ? 2 : 0)} {unit}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: ACCENT }} />
    </label>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function AdasSettingsPanel({ Toggle }: { Toggle: ComponentType<ToggleProps> }) {
  const adas = useStore((s) => s.settings.adas ?? DEFAULT_ADAS_SETTINGS);
  const updateSettings = useStore((s) => s.updateSettings);
  const overall = useAdasStore((s) => s.overall);
  const overallReason = useAdasStore((s) => s.overallReason);
  const features = useAdasStore((s) => s.features);
  const progress = useAdasStore((s) => s.debug.calibrationProgress);
  const facing = useAdasStore((s) => s.debug.cameraFacing);
  const dirProgress = useAdasStore((s) => s.debug.directionProgress);
  const turnKnown = useAdasStore((s) => s.debug.turnSignalKnown);
  const cameraLabel = useAdasStore((s) => s.debug.cameraLabel);
  const cameraIsUsb = useAdasStore((s) => s.debug.cameraIsUsb);
  const backend = useAdasStore((s) => s.debug.detectorBackend);
  const speed = useUnifiedVehicleStore((s) => s.speed);
  const parked = typeof speed === 'number' && speed < 3;

  const [askConsent, setAskConsent] = useState(false);
  const [cameras, setCameras] = useState<AdasCameraOption[]>([]);
  const [usb, setUsb] = useState<UsbDiagnosis>('NO_USB');
  const [align, setAlign] = useState<{ horizonY: number; centerX: number } | null>(null);
  const [alignError, setAlignError] = useState<string | null>(null);

  const set = useCallback((patch: Partial<AdasSettings>) => {
    const cur = useStore.getState().settings.adas ?? DEFAULT_ADAS_SETTINGS;
    updateSettings({ adas: { ...cur, ...patch } });
  }, [updateSettings]);

  /* Kamera listesi — etiketler izinden sonra dolar; tak-çıkarda yenilenir. */
  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      const hw = await readCameraHardware();
      const list = await listAdasCameras(hw);
      if (!alive) return;
      setCameras(list);
      setUsb(diagnoseUsb(hw, list));
    };
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => { alive = false; md?.removeEventListener?.('devicechange', refresh); };
  }, [overall]);

  const onMainToggle = (v: boolean): void => {
    if (v && adas.consentAtMs === null) { setAskConsent(true); return; }
    set({ enabled: v });
  };

  const retry = (): void => {
    void import('../../platform/adas/adasRuntime').then((m) => m.retryAdasCamera());
  };

  const saveAlign = async (): Promise<void> => {
    if (!align) return;
    const m = await import('../../platform/adas/adasRuntime');
    const id = m.getAdasCameraIdentity();
    if (!id) { setAlignError('Kamera açık değil.'); return; }
    const cal = manualCalibration({
      horizonY: align.horizonY, centerX: align.centerX, cameraHeightM: adas.cameraHeightM,
      aspect: id.aspect, laneWidthM: 3.5, cameraKey: id.key, wallMs: Date.now(),
    });
    if (!cal) { setAlignError('Bu hizalama geçersiz: ufuk çizgisi görüntünün üst yarısında, merkez ortaya yakın olmalı.'); return; }
    set({ calibration: cal });
    setAlign(null);
    setAlignError(null);
  };

  const byId = (f: AdasFeature) => features.find((x) => x.feature === f);
  const running = adas.enabled && adas.consentAtMs !== null;
  /* Genel kart zaten "öğreniyor / başlıyor" diyorsa her özellikte tekrarlanmaz. */
  const showFeatureLines = overall === 'ACTIVE' || overall === 'DEGRADED' || overall === 'UNAVAILABLE';
  const blockedCamera = overallReason === 'CAMERA_DENIED' || overallReason === 'NO_CAMERA' || overallReason === 'CAMERA_ERROR';

  return (
    <div className="flex flex-col gap-4">
      <Toggle icon={ShieldCheck} label="Sürüş Asistanı"
        desc="Yol kamerasıyla şerit ve öndeki araç uyarıları — yalnız uyarır, aracı kontrol etmez"
        value={running} onChange={onMainToggle} />

      {askConsent && (
        <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--oem-ink)' }}>
            <TriangleAlert className="w-5 h-5" style={{ color: '#f59e0b' }} /> Açmadan önce
          </div>
          <ul className="text-sm leading-relaxed flex flex-col gap-1.5 list-disc pl-5" style={{ color: 'var(--oem-ink-2)' }}>
            <li>Sürüş Asistanı yalnız <b>uyarır</b>; direksiyon, fren veya gaza müdahale etmez.</li>
            <li>Kötü hava, gece, güneş parlaması, silik şerit çizgisi, kirli cam ya da kamera açısı tespiti engelleyebilir.</li>
            <li><b>Uyarı gelmemesi yolun güvenli olduğu anlamına gelmez.</b> Dikkat ve sorumluluk her zaman sürücüdedir.</li>
            <li>Görüntü cihazda işlenir; kaydedilmez ve hiçbir yere gönderilmez.</li>
            <li>İlk sürüşte kamera birkaç dakika boyunca yolu öğrenir; bu sürede uyarı verilmez.</li>
          </ul>
          <div className="flex gap-2 flex-wrap">
            <Btn primary onClick={() => { set({ enabled: true, consentAtMs: Date.now() }); setAskConsent(false); }}>
              Anladım, aç
            </Btn>
            <Btn onClick={() => setAskConsent(false)}>Vazgeç</Btn>
          </div>
        </div>
      )}

      {running && (
        <>
          {/* Durum */}
          <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.28)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold" style={{ color: 'var(--oem-ink)' }}>{OVERALL_TEXT[overall]}</span>
              {cameraLabel && (
                <span className="text-xs font-semibold flex items-center gap-1.5 truncate" style={{ color: 'var(--oem-ink-2)' }}>
                  {cameraIsUsb ? <Usb className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                  <span className="truncate">{cameraLabel}</span>
                </span>
              )}
            </div>
            {overallReason && overall !== 'ACTIVE' && overall !== 'CALIBRATING' && (
              <span className="text-sm" style={{ color: 'var(--oem-ink-2)' }}>{ADAS_REASON_TEXT[overallReason]}</span>
            )}
            {overall === 'CALIBRATING' && (
              <>
                <LearnStep label="Kamera yönü" value={facing === 'forward' ? 1 : dirProgress}
                  hint={facing === 'forward' ? 'Kamera yola bakıyor' : '20 km/h üstünde birkaç saniye sürün — yol akışından ölçülür'} />
                <LearnStep label="Kalibrasyon" value={progress}
                  hint={progress >= 1 ? 'Tamam' : 'Şerit çizgileri belirgin bir yolda 50 km/h üstünde birkaç dakika sürün'} />
              </>
            )}
            {overallReason === 'CAMERA_FACES_BACKWARD' && (
              <div className="flex flex-col gap-2">
                <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>
                  Sürüşte yol görüntüsü ufka doğru aktı: bu kamera aracın arkasını görüyor. Ön cama bir USB kamera takın
                  ya da listeden öne bakan kamerayı seçin. Kamerayı çevirdiyseniz yön kaydını sıfırlayın.
                </span>
                <div><Btn onClick={() => { set({ cameraDirections: {} }); retry(); }}>
                  <span className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Yön kaydını sıfırla</span>
                </Btn></div>
              </div>
            )}
            {blockedCamera && (
              <div><Btn onClick={retry}><span className="flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Kamerayı yeniden dene</span></Btn></div>
            )}
          </div>

          {/* Özellikler */}
          <div className="flex flex-col gap-2">
            {FEATURES.map(({ id, label, desc, Icon }) => {
              const line = featureLine(byId(id));
              return (
                <div key={id} className="flex flex-col gap-1">
                  <Toggle icon={Icon} label={label} desc={desc} value={adas[id]} onChange={(v) => set({ [id]: v } as Partial<AdasSettings>)} />
                  {adas[id] && showFeatureLines && !(byId(id)?.reason && byId(id)?.reason === overallReason) && (
                    <span className="text-xs font-semibold pl-2" style={{ color: TONE_COLOR[line.tone] }}>● {line.text}</span>
                  )}
                  {id === 'ldw' && adas.ldw && !turnKnown && (
                    <span className="text-xs pl-2 flex items-center gap-1.5" style={{ color: 'var(--oem-ink-3)' }}>
                      <Info className="w-3.5 h-3.5" /> Araçtan sinyal bilgisi alınamıyor — şerit değiştirirken de uyarı alabilirsiniz.
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hassasiyet */}
          <Row icon={Crosshair} title="Uyarı zamanlaması">
            <div className="grid grid-cols-3 gap-2">
              {SENSITIVITY.map((o) => (
                <button key={o.id} type="button" onClick={() => set({ sensitivity: o.id })}
                  className="py-2.5 rounded-xl text-sm font-bold"
                  style={adas.sensitivity === o.id
                    ? { background: ACCENT, color: '#04131c' }
                    : { background: 'rgba(148,163,184,0.12)', color: 'var(--oem-ink-2)' }}>
                  {o.label}
                </button>
              ))}
            </div>
          </Row>

          {/* Kamera */}
          <Row icon={Camera} title="Yol kamerası">
            <select value={adas.cameraDeviceId ?? ''} onChange={(e) => set({ cameraDeviceId: e.target.value || null })}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold"
              style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--oem-ink)', border: '1px solid rgba(148,163,184,0.25)' }}>
              <option value="">Otomatik (USB kamera öncelikli)</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>
                  {(c.label || `Kamera ${i + 1}`)
                    + (c.kind === 'usb' ? ' · USB' : c.kind === 'front' ? ' · ön/iç' : '')
                    + directionTag(adas.cameraDirections?.[cameraKeyOf({ deviceId: c.deviceId, label: c.label })]?.facing)}
                </option>
              ))}
            </select>
            <span className="text-xs flex items-start gap-1.5" style={{ color: 'var(--oem-ink-3)' }}>
              <Usb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {USB_TEXT[usb]}
            </span>
            {backend && <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>Araç tanıma: {backend === 'webgl' ? 'GPU' : 'İşlemci'}</span>}
          </Row>

          {/* Kurulum + kalibrasyon */}
          <Row icon={Ruler} title="Kamera kurulumu">
            <Slider label="Kameranın yerden yüksekliği" value={adas.cameraHeightM} min={0.8} max={2.2} step={0.05} unit="m"
              onChange={(v) => set({ cameraHeightM: v })} />
            <Slider label="Yatay görüş açısı" value={adas.hfovDeg} min={45} max={130} step={1} unit="°"
              onChange={(v) => set({ hfovDeg: v })} />
            <span className="text-sm" style={{ color: 'var(--oem-ink-2)' }}>
              {adas.calibration
                ? `Kalibrasyon: ${adas.calibration.source === 'auto' ? 'sürüşte otomatik öğrenildi' : 'elle hizalandı'} · ${new Date(adas.calibration.learnedAtMs).toLocaleDateString('tr-TR')}`
                : 'Kalibrasyon: henüz yok — ilk sürüşte otomatik öğrenilir.'}
            </span>
            <div className="flex gap-2 flex-wrap">
              <Btn disabled={!parked || overall === 'OFF' || overall === 'UNAVAILABLE'}
                onClick={() => setAlign({ horizonY: adas.calibration?.horizonY ?? 0.45, centerX: adas.calibration?.centerX ?? 0.5 })}>
                <span className="flex items-center gap-2"><Crosshair className="w-4 h-4" /> Elle hizala</span>
              </Btn>
              <Btn disabled={!adas.calibration} onClick={() => set({ calibration: null })}>
                <span className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Kalibrasyonu sıfırla</span>
              </Btn>
            </div>
          </Row>

          {/* Canlı görüntü — yalnız dururken */}
          {parked ? (
            <Row icon={Camera} title={align ? 'Elle hizalama' : 'Canlı görüntü'}>
              <AdasLivePreview align={align} />
              {align ? (
                <>
                  <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>
                    Mavi yatay çizgiyi yolun ufukta birleştiği yüksekliğe, dikey çizgiyi aracınızın ortasına getirin.
                  </span>
                  <Slider label="Ufuk çizgisi" value={align.horizonY} min={0.15} max={0.75} step={0.005} unit=""
                    onChange={(v) => setAlign({ ...align, horizonY: v })} />
                  <Slider label="Araç merkezi" value={align.centerX} min={0.2} max={0.8} step={0.005} unit=""
                    onChange={(v) => setAlign({ ...align, centerX: v })} />
                  {alignError && <span className="text-xs font-semibold" style={{ color: '#f87171' }}>{alignError}</span>}
                  <div className="flex gap-2">
                    <Btn primary onClick={() => void saveAlign()}>Kaydet</Btn>
                    <Btn onClick={() => { setAlign(null); setAlignError(null); }}>Vazgeç</Btn>
                  </div>
                </>
              ) : (
                <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>
                  Yeşil: algılanan şerit çizgileri · Sarı: öndeki araç. Kamera yolu ortadan ve düz görmeli.
                </span>
              )}
            </Row>
          ) : (
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--oem-ink-3)' }}>
              <Info className="w-3.5 h-3.5" /> Canlı görüntü ve elle hizalama yalnız araç dururken kullanılabilir.
            </span>
          )}
        </>
      )}
    </div>
  );
}
