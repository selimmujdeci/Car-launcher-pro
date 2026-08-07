/**
 * FleetConnectivityScreen — CAROS LAB · Vehicle · FLEET CONNECTIVITY (P0).
 *
 * Head unit → Fleet backend bağlantı ve telemetri zincirinin SALT-OKUNUR
 * gözlemi. Zorunlu Gözlemlenebilirlik Kuralı'nın 7 şartını karşılar.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · eşleştirme başlatma / kod üretme / kod yenileme
 *   · telemetri push tetikleme · kimlik bildirimi gönderme
 *   · OBD sorgusu · GPS düzeltmesi isteme · ağ çağrısı
 *   · kuyruk temizleme · yeniden bağlanma · araç komutu
 * Yalnız mevcut anlık görüntüleri OKUR; açılışta TEK okuma + elle YENİLE.
 *
 * GİZLİLİK: `api_key`, ham 6 haneli kod, JWT, TAM VIN, TAM UUID, GPS
 * koordinatı ve kullanıcı verisi GÖSTERİLMEZ — yalnız VAR/YOK · ADET ·
 * DURUM · ZAMAN FARKI. Bilinmeyen alan `UNAVAILABLE` gösterilir; sahte 0,
 * sahte tarih, sahte "sağlıklı" YASAK.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Link2Off } from 'lucide-react';
import {
  readTelemetryPushObservation,
  readPairingAuthority,
  readIdentityObservation,
  readContractGate,
  readDeprecatedPairingPaths,
  type TelemetryPushObservation,
  type PairingAuthorityObservation,
  type IdentityObservationRow,
  type ContractGateObservation,
} from '../../../platform/devtools/fleetConnectivitySources';

/* ── Görsel tokenlar (OEM tek katman) ─────────────────────────────────── */

const OK    = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN  = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD   = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE  = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO  = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

/** Bilinmeyen değer için TEK gösterim — sahte 0 YOK. */
const UNAVAILABLE = 'UNAVAILABLE';

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

/** Yaş gösterimi — bilinmiyorsa UNAVAILABLE (uydurma "0 ms" YOK). */
function age(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} dk`;
}

/* ── Anlık görüntü ────────────────────────────────────────────────────── */

interface Snapshot {
  readonly push: TelemetryPushObservation | null;
  readonly pairing: PairingAuthorityObservation | null;
  readonly identity: IdentityObservationRow | null;
  readonly gate: ContractGateObservation | null;
  readonly readAtMs: number;
}

function readSnapshot(): Snapshot {
  const now = Date.now();
  const push = readTelemetryPushObservation(now);
  return {
    push,
    pairing: readPairingAuthority(),
    identity: readIdentityObservation(),
    gate: readContractGate(push),
    readAtMs: now,
  };
}

/* ── Ekran ────────────────────────────────────────────────────────────── */

function FleetConnectivityScreenBase() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnapshot();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer/abonelik YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const push     = snap?.push ?? null;
  const pairing  = snap?.pairing ?? null;
  const identity = snap?.identity ?? null;
  const gate     = snap?.gate ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Başlık + elle yenile */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">Fleet Connectivity</h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Komut göndermez, push tetiklemez.
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

      {/* 1 · Eşleştirme otoritesi */}
      <Section title="Eşleştirme Otoritesi">
        {pairing === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — okunamadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Kanonik akış">
              <span className="text-[11px]">{pairing.canonicalFlow}</span>
            </Row>
            <Row label="Araç kaydı">
              {pairing.vehicleRegistered
                ? <Chip tone={OK}>VAR</Chip>
                : <Chip tone={NONE}>YOK</Chip>}
            </Row>
            <Row label="Araç kimliği (kısaltılmış)">
              {pairing.vehicleIdShort ?? UNAVAILABLE}
            </Row>
            <Row label="API anahtarı">
              {/* DEĞER GÖSTERİLMEZ — yalnız varlık. */}
              {pairing.apiKeyPresent
                ? <Chip tone={OK}>VAR (değer gizli)</Chip>
                : <Chip tone={NONE}>YOK</Chip>}
            </Row>
            <Row label="Kapatılan ölü yol">
              <Chip tone={INFO}>{pairing.deprecatedRouteCount} adet</Chip>
            </Row>
          </div>
        )}
      </Section>

      {/* 2 · Kapatılan yollar */}
      <Section title="Kapatılan Eşleştirme Yolları (410)">
        <div className="flex flex-col gap-1">
          {readDeprecatedPairingPaths().map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Link2Off size={12} className="text-[var(--oem-ink-3)]" />
              <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{p}</span>
              <Chip tone={NONE}>410 GONE</Chip>
            </div>
          ))}
        </div>
      </Section>

      {/* 3 · Telemetri sözleşmesi */}
      <Section title="Telemetri Sözleşmesi (son payload)">
        {push === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — henüz payload kurulmadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Kaynak">{push.source}</Row>
            <Row label="Konum kaynağı">{push.locationSource ?? UNAVAILABLE}</Row>
            <Row label="Gözlem yaşı">{age(push.observedAgeMs)}</Row>
            <Row label="OBD gözlem yaşı">{age(push.obdObservedAgeMs)}</Row>
            <Row label="GPS gözlem yaşı">{age(push.gpsObservedAgeMs)}</Row>
            <Row label="OBD alanları">
              {push.obdSkipped
                ? <Chip tone={WARN}>ATLANDI — {push.obdSkipReason ?? UNAVAILABLE}</Chip>
                : <Chip tone={OK}>GÖNDERİLDİ</Chip>}
            </Row>
            <Row label="Konum alanları">
              {push.gpsSkipped
                ? <Chip tone={WARN}>ATLANDI — {push.gpsSkipReason ?? UNAVAILABLE}</Chip>
                : <Chip tone={OK}>GÖNDERİLDİ</Chip>}
            </Row>
            <Row label="Bulunan alanlar">
              <span className="text-[11px]">
                {push.presentFields.length > 0 ? push.presentFields.join(' · ') : 'YOK'}
              </span>
            </Row>
            <Row label="Reddedilen alanlar">
              {push.rejectedFields.length > 0
                ? <Chip tone={WARN}>{push.rejectedFields.join(' · ')}</Chip>
                : <Chip tone={OK}>YOK</Chip>}
            </Row>
          </div>
        )}
      </Section>

      {/* 4 · Sözleşme kapısı */}
      <Section title="Sözleşme Kapısı">
        {gate === null ? (
          <Chip tone={NONE}>{UNAVAILABLE}</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Bilinmeyen ASLA 0 değil">
              {gate.unknownNeverZero
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />GEÇTİ</Chip>
                : <Chip tone={BAD}><AlertTriangle size={11} className="mr-1" />İHLAL</Chip>}
            </Row>
            <Row label="RPC anahtarları (bu payload)">
              <span className="text-[11px]">
                {gate.rpcKeysPresent.length > 0 ? gate.rpcKeysPresent.join(' · ') : 'YOK'}
              </span>
            </Row>
            <Row label="RPC'nin okuduğu anahtarlar">
              <span className="text-[11px] text-[var(--oem-ink-3)]">
                {gate.rpcCompatibleKeys.join(' · ')}
              </span>
            </Row>
          </div>
        )}
      </Section>

      {/* 5 · Araç kimliği */}
      <Section title="Araç Kimliği (maskeli)">
        {identity === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — kimlik bildirilmedi</Chip>
        ) : (
          <div className="flex flex-col">
            {/* TAM VIN ASLA gösterilmez. */}
            <Row label="VIN (maskeli)">{identity.maskedVin}</Row>
            <Row label="VIN kaynağı">{identity.vinSource ?? UNAVAILABLE}</Row>
            <Row label="Parmak izi (ön ek)">{identity.fingerprintPrefix ?? UNAVAILABLE}</Row>
            <Row label="Parmak izi sürümü">{identity.fingerprintVersion ?? UNAVAILABLE}</Row>
            <Row label="Aktif OBD protokolü">{identity.activeObdProtocol ?? UNAVAILABLE}</Row>
            <Row label="Sunucu güveni">
              {identity.identityConfidence === null
                ? UNAVAILABLE
                : identity.identityConfidence.toFixed(2)}
            </Row>
            <Row label="Sunucu hükmü">{identity.lastAckState ?? UNAVAILABLE}</Row>
            <Row label="Kimlik çakışması">
              {identity.conflict === null
                ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                : identity.conflict
                  ? <Chip tone={BAD}>ÇAKIŞMA — {identity.conflictReason ?? UNAVAILABLE}</Chip>
                  : <Chip tone={OK}>YOK</Chip>}
            </Row>
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Bu ekran hiçbir şey başlatmaz. Değerler açılışta ve YENİLE ile okunur;
        bilinmeyen alanlar UNAVAILABLE gösterilir — sahte 0 veya sahte
        &quot;sağlıklı&quot; üretilmez.
      </p>
    </div>
  );
}

export default memo(FleetConnectivityScreenBase);
