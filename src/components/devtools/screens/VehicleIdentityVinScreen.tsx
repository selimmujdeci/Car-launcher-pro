/**
 * VehicleIdentityVinScreen — CAROS LAB · Araç · ARAÇ KİMLİĞİ (VIN).
 *
 * VIN · kaynak(lar) · doğrulama durumu · VIN'den çıkarılabilenler · araç sınıfı
 * ve sınıfın KANITI. Salt-okunur.
 *
 * ── GİZLİLİK (pazarlıksız) ────────────────────────────────────────────────
 * Ham VIN EKRANA ÇIKMAZ. VIN bir aracı TEKİL olarak tanımlar; LAB ekranı
 * kopyalanabilir ve paylaşılabilir. Yalnız MASKELİ biçim (`VF1**************`)
 * gösterilir — mevcut `maskVin` otoritesi kullanılır, yeni maske yazılmaz.
 *
 * ── EKRANIN İDDİASI ───────────────────────────────────────────────────────
 * VIN'den "ne çıkar" kadar **"ne ÇIKMAZ"** da gösterilir. Marka/model/gövde ve
 * ticari-binek sınıfı VIN'den türetilemez; bunu yazmamak, kullanıcıya sistemin
 * beceremediği izlenimi verirdi — oysa standart o bilgiyi vermiyor.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Fingerprint, ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  getVehicleIdentity, VIN_STATE_LABEL, VIN_SOURCE_LABEL,
  type VinIdentityState, type VehicleIdentitySnapshot,
} from '../../../platform/vehicle/vehicleIdentity';
import { VIN_REGION_LABEL } from '../../../platform/vehicle/vinDecode';
import { getObdSessionEpoch } from '../../../platform/obdService';
import { getVehicleClassSnapshot } from '../../../platform/vehicle/vehicleClassRuntime';
import {
  VEHICLE_CLASS_STATE_LABEL, LEGAL_CATEGORY_LABEL,
} from '../../../platform/vehicle/legalVehicleClass';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const TONE: Readonly<Record<Tone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function stateTone(s: VinIdentityState): Tone {
  return s === 'VERIFIED' ? 'ok'
    : s === 'SINGLE' ? 'warn'
    : s === 'CONFLICT' ? 'bad'
    : 'muted';
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
      <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
        {title}
      </div>
      <div className="px-2 py-1.5">{children}</div>
    </div>
  );
}

const IdentityBlock = memo(function IdentityBlock({ id }: { id: VehicleIdentitySnapshot }) {
  const f = id.facts;
  return (
    <>
      <Section title="VIN">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <Chip tone={stateTone(id.state)}>{VIN_STATE_LABEL[id.state]}</Chip>
          <span className="text-[var(--oem-ink-1)]">{id.maskedVin ?? '—'}</span>
          <span className="text-[var(--oem-ink-3)]">oturum #{id.epoch}</span>
        </div>

        {id.state === 'CONFLICT' && (
          <p className="mt-1 flex items-start gap-1.5 text-[9px] leading-relaxed text-[var(--oem-danger)]">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            Kaynaklar FARKLI VIN bildirdi ({id.conflicting.join(' / ')}). Hiçbiri kanonik
            SAYILMAZ — “ilk gelen kazanır” bir çakışmayı sessizce çözer ve yanlış araca
            yazardık. Header sızıntısı ya da yanlış ECU'ya sorulmuş olabilir.
          </p>
        )}
        {id.state === 'STALE' && (
          <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-warn)]">
            Bu VIN ÖNCEKİ OBD oturumuna ait. Adaptör başka bir araca takılmış olabilir;
            yeni bir okuma gelmeden kanonik kabul EDİLMEZ.
          </p>
        )}

        <div className="mt-1 space-y-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {id.observations.length === 0 && <div>Hiç VIN gözlemi yok.</div>}
          {id.observations.map((o) => (
            <div key={o.source} data-testid={`vin-src-${o.source}`}>
              · {VIN_SOURCE_LABEL[o.source]}
              {o.ecuRx !== null && <> · ECU {o.ecuRx}</>}
              {' '}· oturum #{o.epoch}
            </div>
          ))}
        </div>

        {id.rejections.length > 0 && (
          <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
            Reddedilen okuma: {id.rejections.length} ({id.rejections
              .map((r) => `${VIN_SOURCE_LABEL[r.source]}: ${r.reason === 'empty' ? 'boş' : `bozuk/${r.length} hane`}`)
              .join(' · ')}). Biçimi tutmayan VIN kimlik SAYILMAZ — bu bir ARIZA
            DEĞİL, fail-closed kapısının çalıştığının kanıtıdır.
          </p>
        )}
      </Section>

      <Section title="VIN'den çıkarılabilenler (yalnız standart)">
        <div className="grid grid-cols-1 gap-0.5 font-mono text-[9px] text-[var(--oem-ink-2)] sm:grid-cols-2">
          <span>Üretici kodu (WMI): {f.wmi ?? '—'}</span>
          <span>Bölge (ISO 3780): {VIN_REGION_LABEL[f.region]}</span>
          <span>
            Model yılı: {f.modelYear !== null
              ? f.modelYear
              : f.modelYearCandidates.length > 1
                ? `BELİRSİZ (${f.modelYearCandidates.join(' / ')})`
                : '—'}
          </span>
          <span>
            Kontrol hanesi: {f.checkDigit === 'not_applicable'
              ? 'uygulanmaz (Kuzey Amerika dışı)'
              : f.checkDigit === 'valid' ? 'geçerli' : 'GEÇERSİZ'}
          </span>
        </div>
        <p className="mt-1 text-[9px] font-semibold text-[var(--oem-ink-2)]">VIN'den ÇIKMAZ:</p>
        <ul className="text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          {f.notDerivable.map((n) => <li key={n}>· {n}</li>)}
        </ul>
      </Section>
    </>
  );
});

export default function VehicleIdentityVinScreen() {
  const mountedRef = useRef(true);
  const read = useCallback(() => {
    let epoch = -1;
    try { epoch = getObdSessionEpoch(); } catch { /* fail-soft */ }
    let cls = null;
    try { cls = getVehicleClassSnapshot(); } catch { /* fail-soft */ }
    return {
      id: getVehicleIdentity(epoch, new Date().getFullYear()),
      cls,
      readAtMs: Date.now(),
    };
  }, []);

  const [snap, setSnap] = useState(read);
  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(read());
  }, [read]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const cls = snap.cls;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="vehicle-identity-vin">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Fingerprint size={12} /> ARAÇ KİMLİĞİ (VIN)
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT-OKUNUR · ham VIN GÖSTERİLMEZ
          </span>
          <button type="button" data-testid="vin-refresh" onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)]">
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          VIN <b>17 haneli ISO 3779</b> biçimini tutmuyorsa kimlik SAYILMAZ (fail-closed).
          İki bağımsız kaynak (Mode 09 · UDS F190) aynı VIN'i verirse durum
          <b> DOĞRULANDI</b>; farklı verirse <b>ÇELİŞKİ</b> olur ve hiçbiri kanonik
          kabul edilmez. Yeni OBD oturumunda kimlik <b>bayat</b> sayılır — adaptör
          başka araca takılmış olabilir.
        </p>
      </div>

      <IdentityBlock id={snap.id} />

      <Section title="Araç sınıfı (ayrı otorite)">
        {cls === null ? (
          <p className="text-[9px] text-[var(--oem-ink-3)]">Sınıf katmanı okunamadı.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <Chip tone={cls.profile.legalVehicleCategory === 'UNKNOWN' ? 'muted' : 'ok'}>
                {LEGAL_CATEGORY_LABEL[cls.profile.legalVehicleCategory]}
              </Chip>
              <span className="text-[var(--oem-ink-3)]">
                {VEHICLE_CLASS_STATE_LABEL[cls.profile.resolutionState]}
              </span>
              <span className="text-[var(--oem-ink-3)]">
                güven %{Math.round(cls.profile.confidence * 100)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
              Gerekçe: {cls.profile.reason}
            </p>
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
              Sınıf <b>VIN'den ÇIKARILMAZ</b>: aynı şasi hem M1 (binek) hem N1 (ticari)
              tescillenebilir. Bu yüzden sınıf ayrı bir otoritededir (kullanıcı beyanı /
              doğrulanmış araştırma) ve emin olunmadıkça <b>BİLİNMİYOR</b> kalır.
              Belirsiz sınıfta ticari hız limiti UYDURULMAZ — navigasyon o durumda
              genel limite düşer.
            </p>
          </>
        )}
      </Section>

      <p className="px-1 text-[9px] text-[var(--oem-ink-3)]">
        Son okuma: {new Date(snap.readAtMs).toLocaleTimeString('tr-TR')}
      </p>
    </div>
  );
}
