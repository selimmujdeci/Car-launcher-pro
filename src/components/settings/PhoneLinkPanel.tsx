/**
 * PhoneLinkPanel — Ayarlar › Bağlantı › Telefon Bağlantısı (CarOS Pro ↔ CarOS Pro).
 *
 * Aynı CarOS Pro iki rolde çalışır: ARAÇTA hibrit sunucu (Bluetooth + yerel
 * Wi-Fi), TELEFONDA istemci ("Araca bağlan"). Bu panel bir PROJEKSİYONDUR:
 * durumu native anlık görüntüden okur, kullanıcı eylemini iletir; karar ve
 * güven native oturumdadır (iki ekranda aynı 6 haneli kod onayı).
 *
 * Tazeleme yalnız panel AÇIKKEN yapılır (1,5 sn) — panel kapanınca durur.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { CarFront, Link2, Link2Off, RefreshCw, RotateCcw, ShieldCheck, Smartphone, Wifi, Bluetooth } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { isNative } from '../../platform/bridge';
import {
  confirmPhoneHubPairing, forgetTrustedPhone, getPhoneHubLink, getPhoneHubPairingCode, refreshPhoneHubLink,
  startPhoneHubServer, stopPhoneHubServer, type PhoneHubLinkSnapshotRaw,
} from '../../platform/phoneHub/phoneHubLink';
import {
  CLIENT_ABSENT, confirmCarPairing, connectToCar, disconnectFromCar, forgetTrustedCar, getCarPairingCode,
  refreshPhoneHubClient, subscribeClientPhase, type PhoneHubClientSnapshot,
} from '../../platform/phoneHub/phoneHubClient';
import {
  currentShortSideDp, isVendorHeadUnit, resolvePhoneLinkRole, type PhoneLinkDeviceRole,
} from '../../platform/phoneLink/phoneLinkDeviceRole';
import {
  describeCarView, describePhoneView, type StatusLine, type Tone,
} from '../../platform/phoneLink/phoneLinkPanelModel';

const ACCENT = '#34d399';
const REFRESH_MS = 1_500;
const TONE: Readonly<Record<Tone, string>> = { ok: '#34d399', idle: 'var(--oem-ink-3)', warn: '#f59e0b' };

function Line({ line, icon: Icon }: { line: StatusLine; icon: typeof Wifi }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: TONE[line.tone] }} />
      <span className="text-sm font-semibold w-24 flex-shrink-0" style={{ color: 'var(--oem-ink-2)' }}>{line.label}</span>
      <span className="text-sm" style={{ color: line.tone === 'idle' ? 'var(--oem-ink-2)' : TONE[line.tone] }}>{line.text}</span>
    </div>
  );
}

function Btn({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className="px-4 py-2.5 rounded-xl text-sm font-bold active:scale-[0.98] flex items-center gap-2"
      style={primary
        ? { background: ACCENT, color: '#03140d' }
        : { background: 'rgba(148,163,184,0.14)', color: 'var(--oem-ink)', border: '1px solid rgba(148,163,184,0.25)' }}>
      {children}
    </button>
  );
}

/** İki ekranda gösterilen doğrulama kodu + onay. */
function PairingConfirm({ code, onAnswer }: { code: string | null; onAnswer: (ok: boolean) => void }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)' }}>
      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>
        <ShieldCheck className="w-4 h-4" style={{ color: '#f59e0b' }} /> Eşleştirme kodu
      </div>
      <div className="text-4xl font-black tracking-[0.3em] tabular-nums text-center py-1" style={{ color: 'var(--oem-ink)' }}>
        {code ?? '······'}
      </div>
      <span className="text-xs text-center" style={{ color: 'var(--oem-ink-3)' }}>
        Diğer ekrandaki kodla AYNIYSA onaylayın. Farklıysa reddedin — biri araya girmeye çalışıyor olabilir.
      </span>
      <div className="flex gap-2 justify-center">
        <Btn primary onClick={() => onAnswer(true)}>Kodlar aynı, onayla</Btn>
        <Btn onClick={() => onAnswer(false)}>Reddet</Btn>
      </div>
    </div>
  );
}

/* ── Araç rolü ───────────────────────────────────────────────────────────── */

const CarRole = memo(function CarRole() {
  const [raw, setRaw] = useState<PhoneHubLinkSnapshotRaw>(() => getPhoneHubLink());
  const [code, setCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await refreshPhoneHubLink().catch(() => getPhoneHubLink());
    setRaw(r);
    setCode(r.pairing?.awaitingConfirmation === true ? await getPhoneHubPairingCode() : null);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const view = describeCarView(raw);
  if (!view) {
    return <span className="text-sm" style={{ color: 'var(--oem-ink-3)' }}>Telefon bağlantısı bu sürümde/cihazda okunamıyor.</span>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Line line={view.wifi} icon={Wifi} />
        <Line line={view.bluetooth} icon={Bluetooth} />
        <Line line={view.connection} icon={Smartphone} />
      </div>
      {view.awaitingConfirmation && (
        <PairingConfirm code={code} onAnswer={(ok) => { void confirmPhoneHubPairing(ok).then(refresh); }} />
      )}
      <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>
        Telefona CarOS Pro'yu kurun, orada Ayarlar › Bağlantı › "Telefon" rolünde "Araca bağlan"a dokunun.
        Wi-Fi için araç ile telefon aynı ağda olmalı (en kolayı: telefonun hotspot'u).
      </span>
      <div className="flex gap-2 flex-wrap">
        {!view.listening && (
          <Btn primary onClick={() => { void startPhoneHubServer({ askPermission: true }).then(refresh); }}>
            <Link2 className="w-4 h-4" /> Telefonu bekle
          </Btn>
        )}
        {view.hasTrustedPhone && (
          <Btn onClick={() => { void forgetTrustedPhone().then(refresh); }}>
            <RotateCcw className="w-4 h-4" /> Güvenilen telefonu unut
          </Btn>
        )}
      </div>
    </div>
  );
});

/* ── Telefon rolü ────────────────────────────────────────────────────────── */

const PhoneRole = memo(function PhoneRole() {
  const [snap, setSnap] = useState<PhoneHubClientSnapshot>(CLIENT_ABSENT);
  const [code, setCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await refreshPhoneHubClient();
    setSnap(s);
    setCode(s.awaitingConfirmation ? await getCarPairingCode() : null);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, REFRESH_MS);
    const unsub = subscribeClientPhase(() => { void refresh(); });
    return () => { clearInterval(t); unsub(); };
  }, [refresh]);

  const view = describePhoneView(snap);
  if (!view) {
    return <span className="text-sm" style={{ color: 'var(--oem-ink-3)' }}>Bu sürümde telefon rolü yok — CarOS Pro'yu güncelleyin.</span>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="text-base font-bold" style={{ color: TONE[view.tone] === 'var(--oem-ink-3)' ? 'var(--oem-ink)' : TONE[view.tone] }}>
        {view.headline}
      </div>
      <div>
        <Line line={view.wifi} icon={Wifi} />
        <Line line={view.bluetooth} icon={Bluetooth} />
      </div>
      {view.awaitingConfirmation && (
        <PairingConfirm code={code} onAnswer={(ok) => { void confirmCarPairing(ok).then(refresh); }} />
      )}
      {view.hint && <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>{view.hint}</span>}
      <div className="flex gap-2 flex-wrap">
        {view.action === 'connect' ? (
          <Btn primary onClick={() => { void connectToCar().then(refresh); }}>
            <Link2 className="w-4 h-4" /> Araca bağlan
          </Btn>
        ) : (
          <Btn onClick={() => { void disconnectFromCar().then(refresh); }}>
            <Link2Off className="w-4 h-4" /> Bağlantıyı kes
          </Btn>
        )}
        {snap.hasTrustedCar && (
          <Btn onClick={() => { void forgetTrustedCar().then(refresh); }}>
            <RotateCcw className="w-4 h-4" /> Aracı unut
          </Btn>
        )}
      </div>
    </div>
  );
});

/* ── Panel ───────────────────────────────────────────────────────────────── */

export const PhoneLinkPanel = memo(function PhoneLinkPanel() {
  const setting = useStore((s) => s.settings.phoneLinkRole ?? 'auto');
  const updateSettings = useStore((s) => s.updateSettings);
  const role: PhoneLinkDeviceRole = resolvePhoneLinkRole(setting, currentShortSideDp(), isVendorHeadUnit());
  /* Açılışta hangi rolle başladığımız — rol değişince tam etki için yeniden başlatma gerekir. */
  const [bootRole] = useState<PhoneLinkDeviceRole>(role);

  const choose = (next: PhoneLinkDeviceRole) => {
    if (next === role && setting !== 'auto') return;
    updateSettings({ phoneLinkRole: next });
    if (next === 'phone') void stopPhoneHubServer();
    else void disconnectFromCar();
  };

  if (!isNative) {
    return (
      <span className="text-sm" style={{ color: 'var(--oem-ink-3)' }}>
        Telefon bağlantısı yalnız Android uygulamasında çalışır.
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--oem-ink-2)' }}>Bu cihaz</span>
        <div className="grid grid-cols-2 gap-2">
          {([['car', 'Araç ekranı', CarFront], ['phone', 'Telefon', Smartphone]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => choose(id)}
              className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
              style={role === id
                ? { background: ACCENT, color: '#03140d' }
                : { background: 'rgba(148,163,184,0.12)', color: 'var(--oem-ink-2)' }}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
        {setting === 'auto' && (
          <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>Otomatik seçildi — yanlışsa değiştirin.</span>
        )}
        {role !== bootRole && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs" style={{ color: '#f59e0b' }}>Rol değişikliği için CarOS'u yeniden başlatın.</span>
            <Btn onClick={() => window.location.reload()}><RefreshCw className="w-4 h-4" /> Yeniden başlat</Btn>
          </div>
        )}
      </div>
      {role === 'car' ? <CarRole /> : <PhoneRole />}
    </div>
  );
});
