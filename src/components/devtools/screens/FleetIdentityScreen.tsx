/**
 * FleetIdentityScreen — CAROS LAB · Vehicle · FLEET IDENTITY (P1).
 *
 * Araç kimlik boru hattının SALT-OKUNUR gözlemi: kimlik kaynakları,
 * koordinatör durumu, yayıncı durumu, retry/çakışma sayaçları ve son
 * başarı/başarısızlık anları.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · kimlik yayını tetikleme · VIN sorgusu (Mode 09) · handshake başlatma
 *   · parmak izi yeniden hesaplama · protokol değiştirme · ağ çağrısı
 *   · retry zorlama · çakışma çözme ("zorla devral" YOK)
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * HAM VERİ GÖSTERİLMEZ (§5): TAM VIN yok (yalnız maskeli son 6),
 * ham parmak izi yok (yalnız ilk 12), `api_key` yok, ham Mode 09 yanıtı yok,
 * ECU adresi / PID bitmap / adaptör MAC yok, GPS/konum yok.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Fingerprint } from 'lucide-react';
import {
  readIdentityCoordinatorSnapshot,
} from '../../../platform/telemetry/vehicleIdentityRuntime';
import type { IdentityCoordinatorSnapshot } from '../../../platform/telemetry/vehicleIdentityCoordinator';
import { maskVin } from '../../../platform/telemetry/vehicleIdentityReport';
import type { IdentityStatus } from '../../../platform/telemetry/vehicleIdentityObservation';

/* ── OEM tokenlar (tek katman) ─────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

/** Bilinmeyen değer için TEK gösterim — sahte 0 / sahte tarih YOK. */
const UNAVAILABLE = 'UNAVAILABLE';

const STATUS_TONE: Record<IdentityStatus, string> = {
  UNKNOWN:  NONE,
  PENDING:  INFO,
  VERIFIED: OK,
  CONFLICT: BAD,
  STALE:    WARN,
};

const STATUS_LABEL: Record<IdentityStatus, string> = {
  UNKNOWN:  'UNKNOWN — kimlik kanıtı yok',
  PENDING:  'PENDING — sunucu onayı yok',
  VERIFIED: 'VERIFIED — sunucu kabul etti',
  CONFLICT: 'CONFLICT — sunucu çakışma bildirdi',
  STALE:    'STALE — gözlem bayat',
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--oem-line)] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[var(--oem-ink-3)]">{label}</span>
      <span className="text-[12px] font-mono text-[var(--oem-ink-1)] text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Zaman FARKI gösterir — mutlak zaman damgası SIZDIRMAZ. */
function ago(atMs: number | null, nowMs: number): string {
  if (atMs === null) return UNAVAILABLE;
  const d = Math.max(0, nowMs - atMs);
  if (d < 1_000) return 'az önce';
  if (d < 60_000) return `${Math.floor(d / 1_000)} sn önce`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} dk önce`;
  return `${Math.floor(d / 3_600_000)} sa önce`;
}

interface Snap {
  readonly co: IdentityCoordinatorSnapshot | null;
  readonly readAtMs: number;
}

/** Okuma fail-soft: koordinatör düşse bile ekran çökmez. */
function readSnap(): Snap {
  let co: IdentityCoordinatorSnapshot | null = null;
  try { co = readIdentityCoordinatorSnapshot(); } catch { co = null; }
  return { co, readAtMs: Date.now() };
}

function FleetIdentityScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer/abonelik YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const co = snap?.co ?? null;
  const obs = co?.observation ?? null;
  const now = snap?.readAtMs ?? 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">Fleet Identity</h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Kimlik yayını tetiklemez, VIN sorgulamaz.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={12} /> YENİLE
        </button>
      </div>

      {/* 1 · Kimlik durumu */}
      <Section title="Kimlik Durumu">
        {co === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — koordinatör okunamadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Durum">
              <Chip tone={STATUS_TONE[co.status]}>{STATUS_LABEL[co.status]}</Chip>
            </Row>
            <Row label="Kimlik kaynağı">{obs?.source ?? UNAVAILABLE}</Row>
            <Row label="Revizyon">
              {co.identityRevision === null ? UNAVAILABLE : `#${co.identityRevision}`}
            </Row>
            <Row label="Son değişim sınıfı">{co.lastChange ?? UNAVAILABLE}</Row>
          </div>
        )}
      </Section>

      {/* 2 · Kimlik alanları (MASKELİ) */}
      <Section title="Kimlik Alanları (maskeli)">
        {obs === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — henüz gözlem yok</Chip>
        ) : (
          <div className="flex flex-col">
            {/* TAM VIN ASLA gösterilmez. */}
            <Row label="VIN">
              {obs.vin === null
                ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                : maskVin(obs.vin)}
            </Row>
            <Row label="VIN kaynağı">{obs.vinSource ?? UNAVAILABLE}</Row>
            <Row label="Marka">{obs.make ?? UNAVAILABLE}</Row>
            <Row label="Model">{obs.model ?? UNAVAILABLE}</Row>
            <Row label="Model yılı">
              {obs.modelYear === null ? UNAVAILABLE : String(obs.modelYear)}
            </Row>
            <Row label="Araç nesli">{obs.vehicleGeneration ?? UNAVAILABLE}</Row>
            <Row label="Aktif protokol">{obs.activeProtocol ?? UNAVAILABLE}</Row>
            {/* Ham parmak izi DEĞİL — yalnız ön ek. */}
            <Row label="Parmak izi (ön ek)">
              {obs.fingerprintHash === null
                ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                : (
                  <span className="inline-flex items-center gap-1">
                    <Fingerprint size={11} className="text-[var(--oem-ink-3)]" />
                    {obs.fingerprintHash.slice(0, 12)}…
                  </span>
                )}
            </Row>
            <Row label="Parmak izi şema sürümü">{obs.fingerprintVersion ?? UNAVAILABLE}</Row>
            <Row label="Yerel güven">
              {obs.confidence === null ? UNAVAILABLE : obs.confidence.toFixed(2)}
            </Row>
            <Row label="Gözlem yaşı">{ago(obs.observedAt, now)}</Row>
          </div>
        )}
      </Section>

      {/* 3 · Yayıncı */}
      <Section title="Yayıncı (tek otorite)">
        {co === null ? (
          <Chip tone={NONE}>{UNAVAILABLE}</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Yayıncı durumu">
              <Chip tone={
                co.publisherState === 'PUBLISHED' ? OK
                : co.publisherState === 'CONFLICT' || co.publisherState === 'FAILED' ? BAD
                : co.publisherState === 'RETRY_WAIT' ? WARN
                : NONE
              }>
                {co.publisherState}
              </Chip>
            </Row>
            <Row label="Yayın reddi">
              {co.lastRejection === null
                ? <Chip tone={OK}>YOK</Chip>
                : <Chip tone={WARN}>{co.lastRejection}</Chip>}
            </Row>
            <Row label="Deneme sayısı">{co.attemptCount}</Row>
            <Row label="Retry sayısı">{co.retryCount}</Row>
            <Row label="Yayınlanan">{co.publishedCount}</Row>
            <Row label="Dedupe ile atlanan">{co.dedupeSkipCount}</Row>
            <Row label="Son başarı">{ago(co.lastSuccessAtMs, now)}</Row>
            <Row label="Son başarısızlık">{ago(co.lastFailureAtMs, now)}</Row>
          </div>
        )}
      </Section>

      {/* 4 · Sunucu hükmü ve çakışma */}
      <Section title="Sunucu Hükmü">
        {co === null ? (
          <Chip tone={NONE}>{UNAVAILABLE}</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Son hüküm">{co.lastAckState ?? UNAVAILABLE}</Row>
            <Row label="Sunucu güveni">
              {co.lastAckConfidence === null ? UNAVAILABLE : co.lastAckConfidence.toFixed(2)}
            </Row>
            <Row label="Çakışma sayısı">
              {co.conflictCount === 0
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />0</Chip>
                : <Chip tone={BAD}><AlertTriangle size={11} className="mr-1" />{co.conflictCount}</Chip>}
            </Row>
            <Row label="Çakışma gerekçesi">
              {co.lastConflictReason ?? <Chip tone={NONE}>{UNAVAILABLE}</Chip>}
            </Row>
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Ham veri gösterilmez: TAM VIN, ham parmak izi girdileri (ECU adresi ·
        PID bitmap · adaptör MAC adresi), ham Mode 09 yanıtı ve cihaz API
        anahtarı bu ekrana TAŞINMAZ. Bilinmeyen alanlar UNAVAILABLE
        gösterilir — sahte 0, sahte
        tarih veya sahte &quot;doğrulandı&quot; üretilmez. Güven puanı ve
        revizyon SUNUCUDA üretilir; bu ekran onları yalnız OKUR.
      </p>
    </div>
  );
}

export default memo(FleetIdentityScreenBase);
