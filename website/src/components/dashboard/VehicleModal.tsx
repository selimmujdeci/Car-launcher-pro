'use client';

import FuelCostPanel from '@/components/console/FuelCostPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { supabaseBrowser } from '@/lib/supabase';
import VehicleIdentityEditor from '@/components/dashboard/VehicleIdentityEditor';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import {
  measurementLabel,
  locationLabel,
  freshnessLabel,
  dataSourceLabel,
  ageLabel,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  buildVehicleIdentityView,
  identityStatusLabel,
  identityFieldLabel,
  identityConfidenceLabel,
  identityConflictLabel,
  type VehicleIdentityRow,
} from '@/lib/fleet/vehicleIdentityView';
import {
  buildTripsView,
  tripValueLabel,
  tripTimeLabel,
  tripScoreLabel,
  tripConfidenceLabel,
  tripUploadStateLabel,
  tripDurationLabel,
  tripCountLabel,
  tripCostLabel,
  fuelRejectReasonLabel,
} from '@/lib/fleet/vehicleTripsView';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import { readSubjectEvidence, type SubjectEvidenceReading } from '@/lib/lab/intelligenceLabSource';
import { SubjectEvidenceList } from '@/components/dashboard/SubjectEvidenceList';
import {
  tripDriverLabel,
  attributionSourceLabel,
  attributionConfidenceLabel,
} from '@/lib/fleet/driverIdentity';
import {
  buildLastSeenDriverView,
  lastSeenDriverLabel,
  lastSeenDetailLabel,
  type PresenceHistoryRow,
} from '@/lib/fleet/driverPresenceHistoryView';
import {
  fetchVehicleIdentities, fetchVehicleTrips, fetchVehiclePresenceHistory,
} from '@/lib/vehicles.service';

interface VehicleModalProps {
  vehicle: LiveVehicle;
  onClose: () => void;
  onRemove?: (id: string) => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-verified', text: 'text-verified' },
  offline: { label: 'Offline', dot: 'bg-white/30', text: 'text-t2' },
  alarm: { label: 'Alarm', dot: 'bg-critical animate-pulse', text: 'text-critical' },
};

export default function VehicleModal({ vehicle: v, onClose, onRemove }: VehicleModalProps) {
  const s = statusConfig[v.status];
  /* Gerçek katmanı — bilinmeyen `null`, tazelik/kaynak ayrı. */
  const t = v.telemetry;
  const fuel = t?.fuelPercent;
  const fuelKnown = fuel != null && fuel.value !== null;
  const fuelPct = fuelKnown ? Math.max(0, Math.min(100, fuel.value as number)) : 0;

  /* ── Araç kimliği (P1) ─────────────────────────────────────────────────
     `null` = OKUNAMADI (RPC yok/yetki yok/ağ hatası) — "kayıt yok" ile
     KARIŞTIRILMAZ. Okuma başarısız olursa UI "Okunamadı" der, sahte
     "Kimlik bilinmiyor" DEMEZ. */
  const [identityRow, setIdentityRow] = useState<VehicleIdentityRow | null>(null);
  const [identityReadable, setIdentityReadable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const map = await fetchVehicleIdentities();
      if (!alive) return;                       // unmount sonrası setState YOK
      if (map === null) { setIdentityReadable(false); return; }
      setIdentityReadable(true);
      setIdentityRow(map.get(v.id) ?? null);
    })();
    return () => { alive = false; };
  }, [v.id]);

  /* ── ARAC KANITI (DORMANT ACTIVATION P0) ────────────────────────────
     `get_subject_evidence` SQL 056'dan beri VARDI ama hicbir yer cagirmiyordu.
     Burada okuma ucu tamamlanir. `null` = OKUNAMADI, bos dizi = kanit yok —
     ikisi AYRI gosterilir. Oturum kimligi RPC'nin kendi `auth.uid()`
     kapisindan gelir; bu bilesen ikinci bir yetki kapisi KURMAZ. */
  const [evidence, setEvidence] = useState<SubjectEvidenceReading | null>(null);

  /* ── TRIP DETAY + KANIT ─────────────────────────────────────────────
     Yolculuk satirina tiklaninca acilir. Kanit YALNIZ secilen yolculuk icin
     okunur (acilista toplu okuma YOK). `tripId` sunucu kimligidir ve ekrana
     BASILMAZ — yalniz RPC parametresi. */
  const [openTripKey, setOpenTripKey] = useState<string | null>(null);
  const [tripEvidence, setTripEvidence] = useState<SubjectEvidenceReading | null>(null);
  const tripAlive = useRef(true);

  useEffect(() => {
    tripAlive.current = true;
    return () => { tripAlive.current = false; };
  }, []);

  const toggleTrip = useCallback(async (tripKey: string, tripId: string | null) => {
    const next = openTripKey === tripKey ? null : tripKey;
    setOpenTripKey(next);
    setTripEvidence(null);
    if (next === null || tripId === null) return;
    const r = await readSubjectEvidence('session', 'TRIP', tripId);
    if (!tripAlive.current) return;
    setTripEvidence(r);
  }, [openTripKey]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      /* userId parametresi yalnizca "oturum var mi" on kapisidir; gercek
         yetki sunucuda. Modal zaten oturumlu dashboard icinde acilir. */
      const r = await readSubjectEvidence('session', 'VEHICLE', v.id);
      if (!alive) return;
      setEvidence(r);
    })();
    return () => { alive = false; };
  }, [v.id]);

  const identity = buildVehicleIdentityView({
    now: Date.now(),
    row: identityRow,
    readable: identityReadable === true,
  });
  const identityConflictText = identity.conflictCount > 0
    ? identityConflictLabel(identity.conflictReason)
    : null;

  /* ── Yolculuklar (P1) ──────────────────────────────────────────────────
     `null` = OKUNAMADI — "yolculuk yok" ile KARIŞTIRILMAZ. */
  const [tripRows, setTripRows] = useState<TripRow[] | null>(null);
  const [tripsReadable, setTripsReadable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await fetchVehicleTrips(v.id, 20);
      if (!alive) return;                       // unmount sonrası setState YOK
      if (rows === null) { setTripsReadable(false); return; }
      setTripsReadable(true);
      setTripRows(rows);
    })();
    return () => { alive = false; };
  }, [v.id]);

  const tripsView = buildTripsView({
    rows: tripRows,
    readable: tripsReadable === true,
  });

  /* ── Son görülen sürücü (P1 · varlık geçmişi) ──────────────────────────
     Bu bir GÖZLEMDİR, trip attribution KARARI DEĞİLDİR: araçta fiziksel
     bir varlık işareti okundu demektir. `null` = OKUNAMADI — "gözlem yok"
     ile KARIŞTIRILMAZ. */
  const [presenceRows, setPresenceRows] = useState<PresenceHistoryRow[] | null>(null);
  const [presenceReadable, setPresenceReadable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await fetchVehiclePresenceHistory(v.id, 20);
      if (!alive) return;                       // unmount sonrası setState YOK
      if (rows === null) { setPresenceReadable(false); return; }
      setPresenceReadable(true);
      setPresenceRows(rows);
    })();
    return () => { alive = false; };
  }, [v.id]);

  const lastSeen = buildLastSeenDriverView({
    rows: presenceRows,
    readable: presenceReadable === true,
  });
  const lastSeenDetail = lastSeenDetailLabel(lastSeen);

  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleRemove() {
    if (!confirmRemove) { setConfirmRemove(true); setRemoveError(null); return; }
    setRemoving(true);
    setRemoveError(null);
    try {
      const session = (await supabaseBrowser?.auth.getSession())?.data.session;
      const token   = session?.access_token;

      const res = await fetch(`/api/vehicles/${v.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.ok) {
        onRemove?.(v.id);
        onClose();
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setRemoveError(body.error ?? `Hata ${res.status}: Araç kaldırılamadı.`);
        setConfirmRemove(false);
      }
    } catch {
      setRemoveError('Bağlantı hatası. İnternet bağlantınızı kontrol edin.');
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 " onClick={onClose} />

      <div className="relative w-full sm:max-w-lg bg-panel border border-hair rounded-t-sm sm:rounded-sm shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col">

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-hair flex-shrink-0">
          <div>
            <div className="flex items-center gap-3">
              {/* Kimlik TEK otoriteden (#661) — plaka boşsa UUID GÖSTERİLMEZ. */}
              <p className={`text-base font-semibold text-t1 ${isFallbackTitle(v) ? '' : 'font-mono'}`}>
                {vehicleTitle(v)}
              </p>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-t3">{vehicleSubtitle(v) ?? 'İsim verilmedi'}</p>
              <button
                onClick={() => setEditingIdentity(true)}
                className="text-[11px] font-bold text-copper-ink hover:underline"
              >
                {isFallbackTitle(v) ? 'İsim ver' : 'Düzenle'}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-sm bg-bezel border border-hair flex items-center justify-center text-t2 hover:text-t1 hover:bg-bezel transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-5 sm:px-6 flex flex-col gap-4">
          {/* Metrics */}
          {/* Ölçümler — bilinmeyen değer `0` GÖSTERİLMEZ, uyarı rengi ALMAZ. */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Hız',     m: t?.speedKmh,    unit: 'km/h', warnAbove: undefined as number | undefined },
              { label: 'RPM',     m: t?.rpm,         unit: 'rpm',  warnAbove: 3000 },
              { label: 'Motor °C', m: t?.engineTempC, unit: '°C',   warnAbove: 100 },
            ].map(({ label, m, unit, warnAbove }) => {
              const known = m != null && m.value !== null;
              // Uyarı YALNIZ ölçülmüş + CANLI veriye verilir.
              const warn = known && m!.state === 'LIVE' && warnAbove !== undefined && (m!.value as number) > warnAbove;
              return (
                <div key={label} className="p-4 rounded-sm bg-bezel border border-hair text-center">
                  <p className={`text-base font-bold font-mono ${
                    !known ? 'text-t3' : warn ? 'text-critical'
                    : m!.state !== 'LIVE' ? 'text-t2' : 'text-t1'
                  }`}>
                    {m ? measurementLabel(m, unit) : 'Veri yok'}
                  </p>
                  <p className="text-[10px] text-t3 mt-0.5">{label}</p>
                </div>
              );
            })}
          </div>

          {/* Bağlantı ve tazelik — kaynak ve yaş açıkça yazılır. */}
          {t && (
            <div className="p-4 rounded-sm bg-bezel border border-hair flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-t3">Araç ünitesi</span>
                <span className="text-xs text-t1">
                  {freshnessLabel(t.device)} · {ageLabel(t.deviceAgeMs)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-t3">Konum</span>
                <span className="text-xs text-t1 text-right">
                  {locationLabel(t)}
                  <span className="text-t3"> · {dataSourceLabel(t.locationSource)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-t3">Motor verisi (OBD)</span>
                <span className="text-xs text-t1">{freshnessLabel(t.engine)}</span>
              </div>
              {t.accuracyM !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-t3">Konum doğruluğu</span>
                  <span className="text-xs text-t1">±{Math.round(t.accuracyM)} m</span>
                </div>
              )}
            </div>
          )}

          {/* Details */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Sürücü', value: v.driver },
              { label: 'Konum', value: t ? locationLabel(t) : v.location },
              { label: 'Son Görülme', value: t ? ageLabel(t.deviceAgeMs) : v.lastSeen },
              { label: 'Kilometre', value: v.odometer > 0 ? `${v.odometer.toLocaleString()} km` : 'Veri yok' },
            ].map(({ label, value }) => (
              <div key={label} className="p-4 rounded-sm bg-bezel border border-hair">
                <p className="text-[10px] text-t3 mb-1">{label}</p>
                <p className="text-sm text-t1 font-medium truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Son görülen sürücü (P1 · varlık geçmişi)
              GÖZLEM ≠ KARAR: "araçta görüldü" demek, yolculuğun ona ait
              olduğu demek DEĞİLDİR. Doğrulanmamış kaynak (araç ekranı
              beyanı) burada İSİM olarak GÖSTERİLMEZ. */}
          <div className="p-4 rounded-sm bg-bezel border border-hair flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-t3">Son görülen sürücü</span>
              {!lastSeen.readable ? (
                /* OKUNAMADI ≠ GÖZLEM YOK — dürüstçe ayrı söylenir. */
                <span className="text-[11px] text-t2">Okunamadı</span>
              ) : lastSeen.isCurrent ? (
                <span className="text-[11px] font-medium text-verified">Şu an araçta</span>
              ) : null}
            </div>

            <p className={`text-sm font-medium ${
              lastSeen.entry?.driverName != null ? 'text-t1'
              : lastSeen.unverifiedOnly ? 'text-warning/70'
              : 'text-t3'
            }`}>
              {lastSeenDriverLabel(lastSeen)}
            </p>

            {lastSeenDetail !== null && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-t3">Gözlem</span>
                <span className="text-[10px] font-mono text-t2">{lastSeenDetail}</span>
              </div>
            )}

            {/* Doğrulanmamış kaynak SESSİZCE GİZLENMEZ: kayıt olduğu ama
                kimlik kanıtı olmadığı açıkça yazılır. */}
            {lastSeen.readable && lastSeen.unverifiedOnly && (
              <p className="text-[10px] text-warning/40">
                Araçta bir gözlem kaydı var, ancak kaynağı kimlik doğrulamıyor
                (araç ekranı beyanı kanıt sayılmaz) — sürücü adı gösterilmez.
              </p>
            )}

            <p className="text-[10px] text-t3">
              Bu bir <strong>gözlemdir</strong>, yolculuk sürücüsü kararı
              değildir. Yolculuğun sürücüsü aşağıda ayrıca gösterilir.
            </p>
          </div>

          {/* Yakıt maliyeti (V-16/5) — AYNI yolculuk satırlarından türetilir;
              ikinci bir çekim YAPILMAZ (tek otorite). `tripsReadable === false`
              ise `null` geçilir: "okunamadı" ile "yolculuk yok" AYRI kalsın. */}
          <FuelCostPanel rows={tripsReadable === false ? null : tripRows} />

          {/* Trips (P1) — tahmin "(tahmini)" etiketli, okunamadı ≠ trip yok */}
          <div className="p-4 rounded-sm bg-bezel border border-hair flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-t3">Yolculuklar</span>
              {!tripsView.readable ? (
                <span className="text-[11px] text-t2">Okunamadı</span>
              ) : (
                <span className="text-[11px] text-t2">
                  {tripsView.isEmpty ? 'Kayıt yok' : `${tripsView.trips.length} yolculuk`}
                </span>
              )}
            </div>

            {tripsView.readable && !tripsView.isEmpty && (
              <div className="flex flex-col gap-2">
                {tripsView.trips.slice(0, 5).map((t) => (
                  <div key={t.tripKey} className="rounded-sm bg-bezel border border-hair p-3 flex flex-col gap-1">
                    {/* Detay acma — gercek kullanici yolu (mount degil, TIKLAMA). */}
                    <button
                      type="button"
                      data-testid={`trip-detail-toggle-${t.tripKey}`}
                      aria-expanded={openTripKey === t.tripKey}
                      onClick={() => void toggleTrip(t.tripKey, t.tripId)}
                      className="self-start text-[10px] rounded border border-sky-400/25 px-2 py-0.5 text-sky-300/80"
                    >
                      {openTripKey === t.tripKey ? 'Kaniti gizle' : 'Yolculuk kaniti'}
                    </button>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-t2 font-mono">
                        {tripTimeLabel(t.startedAtMs)}
                      </span>
                      <span className="text-[10px] text-verified/70">
                        {tripUploadStateLabel(t.uploadState)}
                      </span>
                    </div>
                    {/* ── SÜRÜCÜ ─────────────────────────────────────────
                        Kanıt yoksa "Sürücü bilinmiyor" — araç sahibine,
                        son giriş yapana veya yöneticiye DÜŞMEZ. */}
                    <div className="flex items-center justify-between gap-2 border-b border-hair pb-1 mb-0.5">
                      <span className="text-[10px] text-t3">Sürücü</span>
                      <span className="flex items-center gap-1.5">
                        <span className={`text-[11px] ${
                          t.driver.status === 'ATTRIBUTED' || t.driver.status === 'LOCKED'
                            ? 'text-t1'
                            : t.driver.status === 'CONFLICTED'
                              ? 'text-warning/70'
                              : 'text-t3'
                        }`}>
                          {tripDriverLabel(t.driver)}
                        </span>
                        {/* Elle düzeltme GİZLENMEZ. */}
                        {t.driver.isManual && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded border border-hair text-t3">
                            elle
                          </span>
                        )}
                      </span>
                    </div>
                    {t.driver.status !== 'UNKNOWN' && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-t3">Sürücü kaynağı</span>
                        <span className="text-[10px] font-mono text-t2">
                          {attributionSourceLabel(t.driver.source)}
                          {' · '}
                          {attributionConfidenceLabel(t.driver.confidence)}
                          {t.driver.revision !== null ? ` · r${t.driver.revision}` : ''}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {[
                        { label: 'Bitiş',      text: tripTimeLabel(t.endedAtMs) },
                        { label: 'Mesafe',     text: tripValueLabel(t.distanceKm, 'km') },
                        { label: 'Süre',       text: tripValueLabel(t.durationMin, 'dk', 0) },
                        /* P2 — süre ayrışması. "Bilinmeyen" AYRI gösterilir:
                           rölantiye katılırsa "duruyordu" TAHMİNİ üretilir. */
                        { label: 'Hareket',    text: tripDurationLabel(t.movingTimeMin) },
                        { label: 'Rölanti',    text: tripDurationLabel(t.idleTimeMin) },
                        { label: 'Bilinmeyen', text: tripDurationLabel(t.unknownTimeMin) },
                        { label: 'Duruş',      text: tripCountLabel(t.stopCount) },
                        { label: 'Yakıt',      text: tripValueLabel(t.fuelUsedL, 'L') },
                        /* Maliyet para birimi SNAPSHOT'tan — uydurulmaz. */
                        { label: 'Maliyet',    text: tripCostLabel(t.estimatedCost, t.currency) },
                        { label: 'Ort. hız',   text: tripValueLabel(t.avgSpeedKmh, 'km/h', 0) },
                        { label: 'Maks. hız',  text: tripValueLabel(t.maxSpeedKmh, 'km/h', 0) },
                        /* P2 — motor tepe değerleri: yalnız taze OBD'den. */
                        { label: 'Maks. RPM',  text: tripCountLabel(t.maxRpm) },
                        { label: 'Maks. sıc.', text: tripValueLabel(t.maxEngineTempC, '°C', 0) },
                        { label: 'Sert fren',  text: tripCountLabel(t.harshBrakeCount) },
                        { label: 'Sert hız.',  text: tripCountLabel(t.harshAccelCount) },
                        /* Hız limiti kaynağı yoksa "Veri yok" — 0 DEĞİL. */
                        { label: 'Hız ihlali', text: tripCountLabel(t.speedViolations) },
                        { label: 'Skor',       text: tripScoreLabel(t.score) },
                        { label: 'Güvenilirlik', text: tripConfidenceLabel(t.confidence) },
                      ].map(({ label, text }) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-[10px] text-t3">{label}</span>
                          <span className={`text-[10px] font-mono ${
                            text === 'Veri yok' ? 'text-t3'
                            : text.includes('(tahmini)') ? 'text-t2'
                            : 'text-t1'
                          }`}>
                            {text}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* P2 — yakıt ÖLÇÜLEMEDİYSE gerekçesi yazılır. Sessizce
                        tahmine düşmek, kullanıcının varsayımı ölçüm sanmasına
                        yol açar. */}
                    {fuelRejectReasonLabel(t.fuelRejectReason) !== null && (
                      <p className="text-[10px] text-warning/40 mt-0.5">
                        Yakıt ölçülemedi: {fuelRejectReasonLabel(t.fuelRejectReason)}
                      </p>
                    )}

                    {openTripKey === t.tripKey && (
                      <div className="mt-1" data-testid="trip-evidence-panel">
                        {t.tripId === null ? (
                          <p className="text-[10px] text-t3">
                            Bu yolculuk sunucuda kimliklenmemis — kanit SORULAMAZ.
                          </p>
                        ) : tripEvidence === null ? (
                          <p className="text-[10px] text-t3">Kanit okunuyor…</p>
                        ) : !tripEvidence.readable ? (
                          <p className="text-[10px] text-warning/70">
                            Kanit OKUNAMADI — bu &quot;kanit yok&quot; demek degildir.
                          </p>
                        ) : (
                          <SubjectEvidenceList rows={tripEvidence.rows} title="Yolculuk kaniti" />
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-t3">
                  &quot;(tahmini)&quot; işaretli değerler araçtan ölçülmedi; ortalama
                  tüketim ve birim fiyat varsayımıyla hesaplandı.
                  <br />
                  &quot;Veri yok&quot; o metriğin ÖLÇÜLMEDİĞİ anlamına gelir —
                  sıfır olduğu anlamına DEĞİL.
                </p>
              </div>
            )}
          </div>

          {/* Vehicle Identity (P1) — kanıt yoksa "Veri yok", onay yoksa "Doğrulanıyor" */}
          <div className="p-4 rounded-sm bg-bezel border border-hair flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-t3">Araç Kimliği</span>
              {identityReadable === false ? (
                /* OKUNAMADI ≠ KAYIT YOK — kullanıcıya dürüstçe ayrı söylenir. */
                <span className="text-[11px] text-t2">Okunamadı</span>
              ) : (
                <span className={`text-[11px] font-medium ${
                  identity.status === 'VERIFIED' ? 'text-verified'
                  : identity.status === 'CONFLICT' ? 'text-critical'
                  : identity.status === 'STALE' ? 'text-warning'
                  : 'text-t2'
                }`}>
                  {identityStatusLabel(identity.status)}
                </span>
              )}
            </div>

            {identityReadable !== false && (
              <>
                {[
                  { label: 'Şasi No (VIN)', value: identity.vinMasked },
                  { label: 'Marka',         value: identity.make },
                  { label: 'Model',         value: identity.model },
                  { label: 'Yıl',           value: identity.modelYear },
                  { label: 'OBD Protokolü', value: identity.obdProtocol },
                  { label: 'İmza Sürümü',   value: identity.fingerprintVersion },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-t3">{label}</span>
                    <span className={`text-[11px] font-mono ${value === null ? 'text-t3' : 'text-t1'}`}>
                      {identityFieldLabel(value)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-t3">Kimlik Güveni</span>
                  <span className={`text-[11px] font-mono ${
                    identity.confidence === null ? 'text-t3' : 'text-t1'
                  }`}>
                    {identityConfidenceLabel(identity.confidence)}
                  </span>
                </div>

                {/* Çakışma GİZLENMEZ. */}
                {identityConflictText !== null && (
                  <p className="text-[11px] text-critical/80 mt-1">⚠ {identityConflictText}</p>
                )}
              </>
            )}
          </div>

          {/* Fuel bar */}
          <div className="p-4 rounded-sm bg-bezel border border-hair">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs text-t3">Yakıt Seviyesi</span>
              <span className={`text-sm font-mono font-semibold ${
                !fuelKnown ? 'text-t3'
                : fuel!.state !== 'LIVE' ? 'text-t2'
                : fuelPct < 20 ? 'text-critical'
                : fuelPct < 35 ? 'text-warning' : 'text-verified'
              }`}>
                {t ? measurementLabel(t.fuelPercent, '%').replace(' %', '%') : 'Veri yok'}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-bezel overflow-hidden">
              {/* Yakıt bilinmiyorsa dolgu ÇİZİLMEZ — boş kırmızı çubuk
                  "yakıt bitti" sahte alarmı üretiyordu. */}
              {fuelKnown && (
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    fuel!.state !== 'LIVE' ? 'bg-white/25'
                    : fuelPct < 20 ? 'bg-critical'
                    : fuelPct < 35 ? 'bg-warning' : 'bg-verified'
                  }`}
                  style={{ width: `${fuelPct}%` }}
                />
              )}
            </div>
            {/* İkmal uyarısı YALNIZ ölçülmüş + CANLI düşük yakıtta verilir. */}
            {fuelKnown && fuel!.state === 'LIVE' && fuelPct < 20 && (
              <p className="text-[11px] text-critical/80 mt-2">⚠ Yakıt ikmali gerekiyor</p>
            )}
            {!fuelKnown && (
              <p className="text-[11px] text-t3 mt-2">Yakıt verisi araçtan okunamadı</p>
            )}
          </div>

          {/* Safe bottom padding for mobile */}
          <div className="sm:hidden h-2" />
        </div>

        {/* ARAC KANITI — kanit zincirinin okunabilir ucu. */}
        <div className="flex-shrink-0 px-5 sm:px-6 pb-3">
          {evidence === null ? (
            <p className="text-xs text-t3">Kanit okunuyor…</p>
          ) : !evidence.readable ? (
            <p className="text-xs text-warning/70">
              Kanit OKUNAMADI — bu &quot;kanit yok&quot; demek degildir.
            </p>
          ) : (
            <SubjectEvidenceList rows={evidence.rows} title="Arac kaniti" />
          )}
        </div>

        {/* Footer — remove button */}
        {onRemove && (
          <div className="flex-shrink-0 px-5 pb-5 sm:px-6 sm:pb-6 pt-3 border-t border-hair flex flex-col gap-2">
            {removeError && (
              <p className="text-xs text-critical bg-[var(--cn-critical-bg)] border border-critical rounded-sm px-3 py-2">
                ⚠ {removeError}
              </p>
            )}
            <button
              onClick={handleRemove}
              disabled={removing}
              className={`w-full py-2.5 rounded-sm text-sm font-medium transition-all border ${
                confirmRemove
                  ? 'bg-[var(--cn-critical-bg)] border-critical text-critical hover:bg-[var(--cn-critical-bg)]'
                  : 'bg-bezel border-hair text-t2 hover:text-critical hover:border-critical hover:bg-[var(--cn-critical-bg)]'
              }`}
            >
              {removing ? 'Kaldırılıyor…' : confirmRemove ? 'Emin misin? Tekrar tıkla' : 'Aracı Listeden Kaldır'}
            </button>
          </div>
        )}
      </div>

      {editingIdentity && (
        <VehicleIdentityEditor
          vehicle={v}
          onClose={() => setEditingIdentity(false)}
        />
      )}
    </div>
  );
}
