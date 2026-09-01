/**
 * DeviceIdentityScreen — CAROS LAB · Vehicle · CİHAZ KİMLİĞİ & E2E ANAHTAR.
 *
 * İki sessiz zincirin SALT-OKUNUR gözlemi:
 *   · cihaz kimliğinin reinstall dayanıklılığı  (P0-001C)
 *   · E2E açık anahtar yayını                    (P0-001B)
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · anahtar yayını TETİKLEMEZ · kimlik ÜRETMEZ/SIFIRLAMAZ · eşleştirme YAPMAZ
 *   · ağ çağrısı YAPMAZ · komut GÖNDERMEZ · anahtar ROTASYONU başlatmaz
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * HAM VERİ GÖSTERİLMEZ: `veh_api_key` yok · cihaz kimliğinin kendisi yok ·
 * E2E açık anahtarın içeriği yok · ham SSAID yok. Yalnız VAR/YOK · ADET ·
 * DURUM ADI · ZAMAN FARKI.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Fingerprint, KeyRound, Radio } from 'lucide-react';
import {
  readDeviceIdentity, readDevicePairing, readE2eKeyPublish,
} from '../../../platform/devtools/deviceIdentityLabSources';
import {
  buildIdentityLines, buildPairingLines, buildE2eLines, overallVerdict,
  type LabLine, type LabVerdict,
} from '../../../platform/devtools/deviceIdentityLabModel';

/* ── OEM tokenlar (tek katman) ─────────────────────────────────────────── */

const TONE: Readonly<Record<LabVerdict, string>> = {
  OK:          'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  WARN:        'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  BAD:         'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const OVERALL_LABEL: Readonly<Record<LabVerdict, string>> = {
  OK:          'ZİNCİR SAĞLAM',
  WARN:        'DİKKAT — bir dal zayıf',
  BAD:         'KIRIK — fiziksel komutlar etkilenir',
  UNAVAILABLE: 'KANIT YOK',
};

function Chip({ tone, children }: { tone: LabVerdict; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function LineRow({ line }: { line: LabLine }) {
  return (
    <div className="border-b border-[var(--oem-line)] py-1.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] text-[var(--oem-ink-3)]">{line.label}</span>
        <Chip tone={line.verdict}>{line.value}</Chip>
      </div>
      {line.note !== null && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--oem-ink-3)]">{line.note}</p>
      )}
    </div>
  );
}

function Section({
  title, icon, lines,
}: { title: string; icon: React.ReactNode; lines: readonly LabLine[] }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {icon}{title}
      </h3>
      {lines.map((l) => <LineRow key={l.label} line={l} />)}
    </section>
  );
}

/* ── Ekran ─────────────────────────────────────────────────────────────── */

interface Snapshot {
  identity: readonly LabLine[];
  pairing:  readonly LabLine[];
  e2e:      readonly LabLine[];
  overall:  LabVerdict;
  readAtMs: number;
}

function readSnapshot(): Snapshot {
  const identity = buildIdentityLines(readDeviceIdentity());
  const pairing  = buildPairingLines(readDevicePairing());
  const e2e      = buildE2eLines(readE2eKeyPublish());
  return {
    identity, pairing, e2e,
    overall:  overallVerdict([identity, pairing, e2e]),
    readAtMs: Date.now(),
  };
}

export function DeviceIdentityScreen() {
  const mountedRef = useRef(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(readSnapshot());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="device-identity-screen">
      <div className="flex items-center justify-between gap-2">
        <Chip tone={snap?.overall ?? 'UNAVAILABLE'}>
          {OVERALL_LABEL[snap?.overall ?? 'UNAVAILABLE']}
        </Chip>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={12} />YENİLE
        </button>
      </div>

      {snap === null ? (
        <p className="text-[12px] text-[var(--oem-ink-3)]">UNAVAILABLE — okuma yapılmadı.</p>
      ) : (
        <>
          <Section title="Cihaz Kimliği" icon={<Fingerprint size={12} />} lines={snap.identity} />
          <Section title="E2E Açık Anahtar Yayını" icon={<KeyRound size={12} />} lines={snap.e2e} />
          <Section title="Bulut Hattı" icon={<Radio size={12} />} lines={snap.pairing} />
        </>
      )}

      <p className="text-[11px] leading-snug text-[var(--oem-ink-3)]">
        Bu ekran YALNIZ OKUR: anahtar yayını tetiklemez, kimlik üretmez/sıfırlamaz,
        komut göndermez. Ham anahtar, cihaz kimliği ve SSAID bu ekrana hiç gelmez.
      </p>
    </div>
  );
}

export default memo(DeviceIdentityScreen);
