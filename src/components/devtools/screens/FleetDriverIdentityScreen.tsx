/**
 * FleetDriverIdentityScreen — CAROS LAB · Vehicle · FLEET DRIVER IDENTITY.
 *
 * Sürücü kimliği ve atama zincirinin SALT-OKUNUR gözlemi (§18).
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · sürücü oluşturma/düzenleme · atama oluşturma/bitirme
 *   · trip sürücüsü değiştirme · snapshot yakalama (ağ çağrısı)
 *   · timer/abonelik kurma
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK (BAĞLAYICI) ───────────────────────────────────────────────
 * Bu ekran KİŞİSEL VERİ GÖSTERMEZ ve EXPORT ETMEZ:
 *   · sürücü ADI GÖSTERİLMEZ — yalnız bounded teknik referans (`drv:a1b2c3d4`)
 *   · ehliyet / telefon / e-posta / kullanıcı kimliği YOK
 *   · TAM UUID YOK (yalnız ilk 8 karakter)
 * Taşınan: VAR/YOK · ADET · DURUM ADI · YAŞ.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, UserCheck, AlertTriangle, ShieldCheck, Clock } from 'lucide-react';
import {
  readDriverSnapshot, evaluateSnapshotFreshness,
  SNAPSHOT_MAX_AGE_MS,
  type DriverAssignmentSnapshot,
} from '../../../platform/fleet/driverAssignmentSnapshot';
import {
  readDriverPresence, isIdentityVerifying,
} from '../../../platform/fleet/driverPresence';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

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

/**
 * Sürücü referansı — **AD DEĞİL**.
 *
 * LAB bir teşhis yüzeyidir ve ekran görüntüsü paylaşılabilir; sürücü adı
 * kişisel veridir. Teknik takip için kimliğin ilk 8 karakteri yeter.
 */
function driverRef(id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `drv:${id.slice(0, 8)}`;
}

function assignmentRef(id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `asg:${id.slice(0, 8)}`;
}

/** Yaş — mutlak zaman damgası SIZDIRMAZ. */
function ago(atMs: number | null, nowMs: number): string {
  if (atMs === null) return UNAVAILABLE;
  const d = Math.max(0, nowMs - atMs);
  if (d < 1_000) return 'az önce';
  if (d < 60_000) return `${Math.floor(d / 1_000)} sn önce`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} dk önce`;
  return `${Math.floor(d / 3_600_000)} sa önce`;
}

type PresenceRead = ReturnType<typeof readDriverPresence>;

interface Snap {
  readonly snapshot: DriverAssignmentSnapshot;
  readonly freshness: string;
  readonly lastFetchAtMs: number | null;
  readonly lastFailureReason: string | null;
  readonly fetchCount: number;
  /** P1 — fiziksel varlık gözlemi. */
  readonly presence: PresenceRead | null;
  readonly readAtMs: number;
}

/** Okuma fail-soft: zincir düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  /* Presence okuması AYRI fail-soft: düşerse atama gözlemi yine görünür. */
  let presence: PresenceRead | null = null;
  try { presence = readDriverPresence(now); } catch { presence = null; }

  try {
    const r = readDriverSnapshot();
    return {
      snapshot: r.snapshot,
      freshness: evaluateSnapshotFreshness(r.snapshot, now),
      lastFetchAtMs: r.lastFetchAtMs,
      lastFailureReason: r.lastFailureReason,
      fetchCount: r.fetchCount,
      presence,
      readAtMs: now,
    };
  } catch {
    return {
      snapshot: {
        status: 'UNKNOWN', driverId: null, assignmentId: null,
        assignmentRevision: null, displayName: null, source: null,
        confidence: null, validFromMs: null, validUntilMs: null,
        capturedAtMs: null, reason: 'READ_FAILED',
      },
      freshness: 'UNKNOWN', lastFetchAtMs: null,
      lastFailureReason: 'READ_FAILED', fetchCount: 0, presence, readAtMs: now,
    };
  }
}

function FleetDriverIdentityScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const s = snap?.snapshot ?? null;
  const now = snap?.readAtMs ?? 0;
  const fresh = snap?.freshness ?? UNAVAILABLE;
  const pres = snap?.presence ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Fleet Driver Identity
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Sürücü seçmez, atama değiştirmez, ağ çağrısı yapmaz.
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

      {/* 1 · Aktif atama durumu */}
      <Section title="Active Assignment">
        <div className="flex flex-col">
          <Row label="activeAssignmentStatus">
            <Chip tone={
              s?.status === 'ACTIVE' && fresh === 'ACTIVE' ? OK
              : fresh === 'STALE' ? WARN : NONE
            }>
              <UserCheck size={11} className="mr-1" />
              {s?.status ?? UNAVAILABLE}
            </Chip>
          </Row>
          {/* AD DEĞİL — bounded teknik referans. */}
          <Row label="activeDriverRef">{driverRef(s?.driverId ?? null)}</Row>
          <Row label="activeAssignmentRef">{assignmentRef(s?.assignmentId ?? null)}</Row>
          <Row label="assignmentSource">{s?.source ?? UNAVAILABLE}</Row>
          <Row label="assignmentConfidence">
            {s?.confidence === null || s?.confidence === undefined
              ? UNAVAILABLE
              : <Chip tone={
                  s.confidence === 'VERY_HIGH' || s.confidence === 'HIGH' ? OK
                  : s.confidence === 'MEDIUM' ? INFO : NONE
                }>{s.confidence}</Chip>}
          </Row>
          <Row label="assignmentRevision">
            {s?.assignmentRevision === null || s?.assignmentRevision === undefined
              ? UNAVAILABLE : `r${s.assignmentRevision}`}
          </Row>
          <Row label="assignmentAge">{ago(s?.capturedAtMs ?? null, now)}</Row>
          {/* Bayat snapshot sürücü KANITI DEĞİLDİR. */}
          <Row label="snapshotFreshness">
            <Chip tone={fresh === 'ACTIVE' ? OK : fresh === 'STALE' ? WARN : NONE}>
              <Clock size={11} className="mr-1" />{fresh}
            </Chip>
          </Row>
          <Row label="maxSnapshotAge">{Math.round(SNAPSHOT_MAX_AGE_MS / 3_600_000)} sa</Row>
          <Row label="unknownReason">{s?.reason ?? UNAVAILABLE}</Row>
        </div>
      </Section>

      {/* 2 · Yakalama sayaçları */}
      <Section title="Snapshot Capture">
        <div className="flex flex-col">
          <Row label="captureCount">{snap?.fetchCount ?? UNAVAILABLE}</Row>
          <Row label="lastCaptureAge">{ago(snap?.lastFetchAtMs ?? null, now)}</Row>
          <Row label="lastCaptureFailure">
            {snap?.lastFailureReason === null || snap?.lastFailureReason === undefined
              ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />yok</Chip>
              : <Chip tone={BAD}>
                  <AlertTriangle size={11} className="mr-1" />{snap.lastFailureReason}
                </Chip>}
          </Row>
          <Row label="validFromAge">{ago(s?.validFromMs ?? null, now)}</Row>
          <Row label="validUntil">
            {s?.validUntilMs === null || s?.validUntilMs === undefined
              ? 'açık uçlu' : ago(s.validUntilMs, now)}
          </Row>
        </div>
      </Section>

      {/* 2b · P1 — DRIVER PRESENCE (fiziksel varlık gözlemi) */}
      <Section title="Driver Presence (P1)">
        <div className="flex flex-col">
          <Row label="activeSource">
            <Chip tone={
              pres === null ? NONE
              : pres.presence.source === 'NFC' || pres.presence.source === 'BLUETOOTH' ? OK
              : pres.presence.source === 'UNKNOWN' ? NONE : WARN
            }>
              {pres?.presence.source ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="confidence">
            {pres === null || pres.presence.confidence === 'UNKNOWN'
              ? UNAVAILABLE
              : <Chip tone={
                  pres.presence.confidence === 'VERY_HIGH' || pres.presence.confidence === 'HIGH'
                    ? OK : pres.presence.confidence === 'MEDIUM' ? INFO : NONE
                }>{pres.presence.confidence}</Chip>}
          </Row>
          <Row label="age">
            {pres?.ageMs === null || pres?.ageMs === undefined
              ? UNAVAILABLE
              : pres.ageMs < 60_000 ? `${Math.floor(pres.ageMs / 1_000)} sn`
              : pres.ageMs < 3_600_000 ? `${Math.floor(pres.ageMs / 60_000)} dk`
              : `${Math.floor(pres.ageMs / 3_600_000)} sa`}
          </Row>
          <Row label="expired">
            {pres === null ? UNAVAILABLE
              : <Chip tone={pres.expired ? WARN : pres.validity === 'VALID' ? OK : NONE}>
                  {pres.expired ? 'EVET' : pres.validity === 'VALID' ? 'HAYIR' : pres.validity}
                </Chip>}
          </Row>
          <Row label="lastUpdate">{ago(pres?.lastUpdateAtMs ?? null, now)}</Row>
          {/* Sürücü ADI DEĞİL — bounded referans. */}
          <Row label="presenceDriverRef">{driverRef(pres?.presence.driverId ?? null)}</Row>
          <Row label="observationCount">{pres?.observationCount ?? UNAVAILABLE}</Row>
          <Row label="rejectedObservations">
            {pres === null ? UNAVAILABLE
              : pres.rejectedCount === 0
                ? <Chip tone={OK}>0</Chip>
                : <Chip tone={WARN}>{pres.rejectedCount}</Chip>}
          </Row>
          {/* Kaynağın kimlik doğrulayıp doğrulamadığı — kararın çekirdeği. */}
          <Row label="identityVerifyingSource">
            <Chip tone={
              pres !== null && isIdentityVerifying(pres.presence.source) ? OK : NONE
            }>
              {pres !== null && isIdentityVerifying(pres.presence.source) ? 'EVET' : 'HAYIR'}
            </Chip>
          </Row>
        </div>
      </Section>

      {/* 3 · Zincir durumu — bu cihazda ne DOĞRULANDI */}
      <Section title="Chain Status">
        <div className="flex flex-col">
          <Row label="headUnitDriverSelection">
            {/* Güvenli kimlik doğrulama olmadan sürücü seçimi AÇILMADI. */}
            <Chip tone={NONE}>KAPALI (kimlik doğrulama yok)</Chip>
          </Row>
          <Row label="phoneHubDriverSource">
            <Chip tone={NONE}>BAĞLI DEĞİL</Chip>
          </Row>
          <Row label="nfcDriverSource">
            <Chip tone={NONE}>BAĞLI DEĞİL</Chip>
          </Row>
          {/* Presence sözleşmesi HAZIR ama gözlem üreten kaynak YOK. */}
          <Row label="presenceContract">
            <Chip tone={INFO}>HAZIR (üretici yok)</Chip>
          </Row>
          <Row label="realDeviceValidation">
            <Chip tone={WARN}>BLOCKED_REAL_DEVICE</Chip>
          </Row>
        </div>
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Bu ekran hiçbir şey başlatmaz ve sürücü <strong>seçtirmez</strong>:
        head unit&apos;te güvenli kimlik doğrulama olmadığı için serbest
        sürücü seçimi <strong>bilinçli olarak KAPALIDIR</strong> — aksi
        halde &quot;kim olduğunu iddia eden herkes o kişi sayılır&quot; ve
        sürücü ataması kanıt olmaktan çıkardı. <strong>Sürücü adı,
        ehliyet, telefon ve e-posta bu ekrana TAŞINMAZ</strong>; yalnız
        <code> drv:xxxxxxxx</code> biçiminde sınırlı teknik referans
        gösterilir. Bayat anlık görüntü (<em>STALE</em>) sürücü kanıtı
        DEĞİLDİR — sunucu tarafında yolculuk <em>UNKNOWN</em> kalır.
      </p>
    </div>
  );
}

export default memo(FleetDriverIdentityScreenBase);
