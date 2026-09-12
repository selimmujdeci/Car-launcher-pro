/**
 * LongRoadFieldValidationScreen — CAROS LAB · Developer · UZUN YOL SAHA DOĞRULAMA.
 *
 * Otomatik saha doğrulama oturumunun SALT-OKUNUR gözlemi (görev §19).
 *
 * ── BU EKRANIN YETKİSİ ─────────────────────────────────────────────────
 * Üç düğme YALNIZ GÖZLEMCİYİ yönetir: BAŞLAT · DURDUR · RAPOR OLUŞTUR.
 * Araca, OBD'ye, GPS'e, Bluetooth'a, ağa veya herhangi bir ürün servisine
 * KOMUT GÖNDERMEZ. Polling sırasını/süresini DEĞİŞTİRMEZ. Bağlantı
 * KURMAZ/KESMEZ. Müzik/navigasyon BAŞLATMAZ. Yapay arıza ÜRETMEZ.
 *
 * ── OKUMA DİSİPLİNİ ────────────────────────────────────────────────────
 * Açılışta TEK okuma + elle YENİLE. Bu ekran timer KURMAZ ve 1 Hz'lik
 * gözlemci döngüsüne ABONE OLMAZ — aksi hâlde LAB açıkken saniyede bir
 * tüm ağaç render olurdu (2026-07-27 ısınma bulgusunun kökü buydu).
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Koordinat · TAM VIN · API anahtarı · JWT · e-posta · ham komut YOK.
 * Yalnız VAR/YOK · ADET · DURUM ADI · SÜRE gösterilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Play, Square, FileText, Trash2, AlertTriangle, ShieldCheck, Route,
} from 'lucide-react';
import {
  IDENTITY_VERDICT_LABEL, LR_SNAPSHOT_CRITICAL_QUOTA, LR_SNAPSHOT_PERIODIC_QUOTA,
  SESSION_STATE_LABEL, VERDICT_LABEL, counterDelta, elapsedMs, odometerDistanceKm,
  type LongRoadSession, type Verdict,
} from '../../../platform/fieldValidation/longRoadModel';
import {
  checkpointLongRoad, clearLongRoadSession, getLongRoadBlackBox, getLongRoadBlackBoxLoad,
  getLongRoadBodies, getLongRoadCriticalCount, getLongRoadSession, initLongRoadRecorder,
  isLongRoadActive, startLongRoadSession, stopLongRoadSession,
} from '../../../platform/fieldValidation/longRoadRecorder';
import { readStoreWriteStats } from '../../../platform/fieldValidation/longRoadStore';
import { allWindows, blackBoxMetas } from '../../../platform/fieldValidation/longRoadBlackBox';
import {
  SELF_CHECK_LABEL, validateSelf,
  type SelfCheckResult,
} from '../../../platform/fieldValidation/longRoadSelfValidator';
import { buildLongRoadReport } from '../../../platform/fieldValidation/longRoadReport';
import { copyTextFailSoft, describeClipboardRoute } from '../../../platform/devtools/carosLabClipboard';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';

const NA = 'UNAVAILABLE';

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
      <span className="text-right font-mono text-[12px] text-[var(--oem-ink-1)]">{children}</span>
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

function Btn({
  onClick, disabled, tone, children,
}: {
  onClick: () => void; disabled?: boolean; tone: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  );
}

/* ── biçimleyiciler ────────────────────────────────────────────────────── */

function dur(ms: number | null): string {
  if (ms === null) return NA;
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} sa ${min % 60} dk` : `${min} dk`;
}

function num(v: number | null, digits = 0): string {
  return v === null ? NA : v.toFixed(digits);
}

function selfTone(v: SelfCheckResult): string {
  if (v === 'VERIFIED') return OK;
  if (v === 'MISMATCH' || v === 'CORRUPT') return BAD;
  if (v === 'INSUFFICIENT_RAW_EVIDENCE') return WARN;
  return NONE;
}

function verdictTone(v: Verdict): string {
  if (v === 'PASS') return OK;
  if (v === 'FAIL') return BAD;
  if (v === 'DEGRADED') return WARN;
  if (v === 'BLOCKED_BACKEND' || v === 'BLOCKED_HARDWARE' || v === 'BLOCKED_POLICY') return INFO;
  return NONE;
}

/* ── Ekran durumu ──────────────────────────────────────────────────────── */

interface Snap {
  readonly session: LongRoadSession | null;
  readonly blackBoxCount: number;
  /** D2 kanıtı: gözlemcinin KENDİ yazım defteri (ürün metriği değil). */
  readonly writeStats: ReturnType<typeof readStoreWriteStats> | null;
  readonly blackBoxLoad: ReturnType<typeof getLongRoadBlackBoxLoad>;
  readonly bodyIds: readonly string[];
  readonly readAtMs: number;
}

/** Her getter AYRI try/catch — tek bir okuma patlarsa ekran KÖR KALMAZ. */
function readSnap(): Snap {
  const now = Date.now();
  const session = (() => { try { return getLongRoadSession(); } catch { return null; } })();
  const blackBoxCount = (() => {
    try { return blackBoxMetas(getLongRoadBlackBox()).length; } catch { return 0; }
  })();
  const writeStats = (() => { try { return readStoreWriteStats(); } catch { return null; } })();
  const blackBoxLoad = (() => { try { return getLongRoadBlackBoxLoad(); } catch { return null; } })();
  const bodyIds = (() => {
    try { return getLongRoadBodies().map((b) => b.id); } catch { return []; }
  })();
  return { session, blackBoxCount, writeStats, blackBoxLoad, bodyIds, readAtMs: now };
}

function LongRoadFieldValidationScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;      // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    /* Diskte devam eden oturum varsa SÜRDÜRÜLÜR; yoksa hiçbir şey başlamaz. */
    try { initLongRoadRecorder('APP_RESTART'); } catch { /* fail-soft */ }
    refresh();                            // açılışta TEK okuma; timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const onStart = useCallback(() => {
    try { startLongRoadSession(); setNotice('Oturum başlatıldı.'); }
    catch { setNotice('Oturum başlatılamadı.'); }
    refresh();
  }, [refresh]);

  const onStop = useCallback(() => {
    try { stopLongRoadSession(); setNotice('Oturum durduruldu.'); }
    catch { setNotice('Oturum durdurulamadı.'); }
    refresh();
  }, [refresh]);

  const onReport = useCallback(() => {
    const s = getLongRoadSession();
    if (!s) { setNotice('Oturum yok — rapor üretilemez.'); return; }
    try {
      checkpointLongRoad();
      const bb = getLongRoadBlackBox();
      const bodies = getLongRoadBodies();
      const report = buildLongRoadReport({
        session: s,
        blackBox: blackBoxMetas(bb),
        snapshotBodies: bodies as unknown[],
        blackBoxWindows: allWindows(bb),
        selfEvidence: {
          blackBoxLoad: getLongRoadBlackBoxLoad(),
          snapshotBodyIds: bodies.map((b) => b.id),
        },
        writeStats: readStoreWriteStats(),
        nowMs: Date.now(),
      });
      const text = `${report.markdown}\n\n<!-- MAKİNE OKUNUR -->\n\`\`\`json\n${report.json}\n\`\`\`\n`;
      void copyTextFailSoft(text).then((route) => {
        if (!mountedRef.current) return;
        setNotice(
          `Rapor: ${describeClipboardRoute(route, text.length)} · ` +
          `karar=${report.finalVerdict} · öz-denetim=${report.selfValidation.verdict}`,
        );
      });
    } catch {
      setNotice('Rapor üretilemedi.');
    }
    refresh();
  }, [refresh]);

  const onClear = useCallback(() => {
    try { clearLongRoadSession(); setNotice('Oturum ve kanıt silindi.'); }
    catch { setNotice('Silinemedi.'); }
    refresh();
  }, [refresh]);

  const s = snap?.session ?? null;
  const now = snap?.readAtMs ?? Date.now();
  const running = s !== null && (s.state === 'ACTIVE' || s.state === 'RECOVERING');

  const matrixSummary = s
    ? (() => {
        try {
          const report = buildLongRoadReport({
            session: s, blackBox: [], snapshotBodies: [], nowMs: now,
          });
          return { summary: report.summary, verdict: report.finalVerdict, privacy: report.privacy.verdict };
        } catch { return null; }
      })()
    : null;

  /* Öz-denetim AYRI otoritedir — kabul matrisi özetiyle KARIŞTIRILMAZ. */
  const selfValidation = s
    ? (() => {
        try {
          return validateSelf(s, allWindows(getLongRoadBlackBox()), now, {
            blackBoxLoad: snap?.blackBoxLoad ?? null,
            snapshotBodyIds: snap?.bodyIds ?? [],
          });
        } catch { return null; }
      })()
    : null;

  const observedScenarios = s ? s.scenarios.filter((x) => x.hits > 0).length : 0;
  const lastCritical = s
    ? [...s.events].reverse().find((e) => e.severity === 'CRITICAL') ?? null
    : null;
  /* Kayıt gerçekten sürüyor mu ve kaç kritik sorun birikti — defterin kendi
     otoritesinden okunur (ekran kendi sayımını YAPMAZ; envanter denetimi E-32:
     bu iki uç yazılmış ama hiçbir yüzeye bağlanmamıştı). */
  const recording = (() => { try { return isLongRoadActive(); } catch { return false; } })();
  const criticalCount = (() => { try { return getLongRoadCriticalCount(); } catch { return 0; } })();

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Uzun Yol Saha Doğrulama
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur gözlemci. Araca komut göndermez, polling'e dokunmaz,
            bağlantı kurmaz/kesmez, popup açmaz.
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

      {/* ── Kontroller: YALNIZ gözlemci ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={onStart} disabled={running} tone={OK}>
          <Play size={12} /> BAŞLAT
        </Btn>
        <Btn onClick={onStop} disabled={!running} tone={WARN}>
          <Square size={12} /> DURDUR
        </Btn>
        <Btn onClick={onReport} disabled={s === null} tone={INFO}>
          <FileText size={12} /> SAHA RAPORUNU OLUŞTUR
        </Btn>
        <Btn onClick={onClear} disabled={s === null || running} tone={NONE}>
          <Trash2 size={12} /> SİL
        </Btn>
      </div>

      {notice !== null && (
        <p className="text-[11px] text-[var(--oem-ink-2)]">{notice}</p>
      )}

      {s === null ? (
        <Section title="Oturum">
          <p className="text-[12px] text-[var(--oem-ink-3)]">
            Aktif veya kayıtlı saha oturumu yok. <strong>BAŞLAT</strong>'a
            basıldığında gözlemci kurulur; sonrasında sürüş boyunca hiçbir
            işlem yapmanız gerekmez.
          </p>
        </Section>
      ) : (
        <>
          <Section title="Oturum">
            <Row label="Durum">
              <Chip tone={running ? OK : s.state === 'CORRUPT' || s.state === 'FAILED' ? BAD : NONE}>
                {SESSION_STATE_LABEL[s.state]}
              </Chip>
            </Row>
            <Row label="Oturum kimliği">{s.sessionId}</Row>
            <Row label="Oturum sürümü / restore">{s.sessionVersion} / {s.restoreCount}</Row>
            <Row label="Restore nedeni">{s.lastRestoreReason ?? NA}</Row>
            <Row label="Geçen süre">{dur(elapsedMs(s, now))}</Row>
            <Row label="Ölçüm süresi">{dur(s.odometry.recordedMs)}</Row>
            <Row label="Mesafe">{num(odometerDistanceKm(s.odometry), 1)} km</Row>
            <Row label="Hareket / duruş / bilinmeyen">
              {dur(s.odometry.movingMs)} / {dur(s.odometry.stoppedMs)} / {dur(s.odometry.unknownMs)}
            </Row>
            <Row label="Son checkpoint">
              {s.lastCheckpointAt === null ? NA : `${Math.round((now - s.lastCheckpointAt) / 1000)} sn önce`}
            </Row>
          </Section>

          <Section title="Kapsama ve karar">
            <Row label="Senaryo kapsaması">{observedScenarios} / {s.scenarios.length}</Row>
            {matrixSummary !== null && (
              <>
                <Row label="Kabul matrisi">
                  <span className="flex flex-wrap justify-end gap-1">
                    <Chip tone={OK}>GEÇTİ {matrixSummary.summary.pass}</Chip>
                    <Chip tone={matrixSummary.summary.fail > 0 ? BAD : NONE}>
                      DÜŞTÜ {matrixSummary.summary.fail}
                    </Chip>
                    <Chip tone={matrixSummary.summary.degraded > 0 ? WARN : NONE}>
                      ZAYIF {matrixSummary.summary.degraded}
                    </Chip>
                    <Chip tone={INFO}>ENGELLİ {matrixSummary.summary.blocked}</Chip>
                    <Chip tone={NONE}>GÖZLENMEDİ {matrixSummary.summary.notObserved}</Chip>
                  </span>
                </Row>
                <Row label="Nihai karar">
                  <Chip tone={matrixSummary.verdict === 'FIELD_VALIDATION_PASS' ? OK
                    : matrixSummary.verdict === 'FIELD_VALIDATION_FAILED' ? BAD : WARN}>
                    {matrixSummary.verdict}
                  </Chip>
                </Row>
                <Row label="Gizlilik taraması">
                  <Chip tone={matrixSummary.privacy === 'PASS' ? OK : BAD}>{matrixSummary.privacy}</Chip>
                </Row>
              </>
            )}
            <Row label="Rapor hazır mı">
              {s.odometry.recordedMs > 0 ? 'EVET (kanıt kadar)' : 'HAYIR — ölçüm yok'}
            </Row>
          </Section>

          <Section title="Kayıt öz-denetimi (AYRI otorite — PASS/FAIL'i değiştirmez)">
            {selfValidation === null ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">Öz-denetim çalıştırılamadı.</p>
            ) : (
              <>
                <Row label="Doğrulayıcı hükmü">
                  <Chip tone={selfTone(selfValidation.verdict)}>
                    {SELF_CHECK_LABEL[selfValidation.verdict]}
                  </Chip>
                  {' '}{selfValidation.verifiedCount}/{selfValidation.rows.length}
                </Row>
                {selfValidation.rows.map((row) => (
                  <Row key={row.id} label={row.title}>
                    <Chip tone={selfTone(row.result)}>{SELF_CHECK_LABEL[row.result]}</Chip>
                  </Row>
                ))}
              </>
            )}
          </Section>

          <Section title="Süreklilik">
            <Row label="OBD veri kaybı olayı">{s.counters.obdDataGapCount}</Row>
            <Row label="En uzun OBD kesintisi">{num(s.counters.longestObdGapMs / 1000, 1)} sn</Row>
            <Row label="Reconnect isteği">{num(counterDelta(s.counters.obdReconnectRequested))}</Row>
            <Row label="Başarısız reconnect">
              <Chip tone={s.counters.failedReconnectCount > 0 ? BAD : NONE}>
                {s.counters.failedReconnectCount}
              </Chip>
            </Row>
            <Row label="KWP recovery">{num(counterDelta(s.counters.kwpRecoveryCount))}</Row>
            <Row label="GPS kaybı olayı">{s.counters.gpsLossCount}</Row>
            <Row label="En uzun GPS kaybı">{num(s.counters.longestGpsLossMs / 1000, 1)} sn</Row>
            <Row label="Konum kaynak değişimi">{num(counterDelta(s.counters.gpsSwitchCount))}</Row>
            <Row label="İnternet kaybı olayı">{s.counters.internetLossCount}</Row>
          </Section>

          {/* ── D1 · Kayıt kimliği bütünlüğü ────────────────────────────── */}
          <Section title="Kayıt kimliği bütünlüğü (restore)">
            <Row label="Kimlik hükmü">
              <Chip tone={s.identity.lastScanVerdict === 'OK' ? OK
                : s.identity.lastScanVerdict === 'NOT_SCANNED' ? NONE
                  : s.identity.lastScanVerdict === 'DEGRADED_UNPARSABLE' ? WARN : BAD}>
                {IDENTITY_VERDICT_LABEL[s.identity.lastScanVerdict]}
              </Chip>
            </Row>
            <Row label="Dağıtılmış en büyük sekans">{s.identity.idHighWater}</Row>
            <Row label="Restore tohumlaması">
              {s.identity.seedCount} kez · son tohum={s.identity.lastSeededFrom}
            </Row>
            <Row label="Kopya kimlik / kopya sekans">
              <Chip tone={s.identity.duplicateIds > 0 || s.identity.duplicateSequences > 0 ? BAD : OK}>
                {s.identity.duplicateIds} / {s.identity.duplicateSequences}
              </Chip>
            </Row>
            <Row label="Çözülemeyen kimlik">{s.identity.unparsableIds}</Row>
            <Row label="Sekans boşluğu (hata değil)">{s.identity.sequenceGaps}</Row>
          </Section>

          {/* ── D2 · eMMC yazma defteri ─────────────────────────────────── */}
          <Section title="eMMC yazma defteri (gözlemcinin KENDİ ölçümü)">
            {snap?.writeStats == null ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">{NA} — yazım ölçümü okunamadı.</p>
            ) : (
              <>
                <Row label="Oturum yazımı">
                  {snap.writeStats.sessionWrites} kez · {snap.writeStats.sessionBytes} bayt
                </Row>
                <Row label="BlackBox yazımı">
                  {snap.writeStats.blackBoxWrites} kez · {snap.writeStats.blackBoxBytes} bayt
                </Row>
                <Row label="Toplam bayt">
                  {snap.writeStats.sessionBytes + snap.writeStats.blackBoxBytes}
                </Row>
                {/* #507 devamı — eski VIN maskesi artığı temizliği. Sessiz
                    olmamalı: temizlik yapıldıysa KAÇ kayıt/alan olduğu sayılır.
                    Hiç temizlik gerekmediyse bu da bir bulgudur ("0 · gerek
                    yok") — satırın kendisi gizlenmez. */}
                <Row label="Eski VIN maskesi temizliği (#507)">
                  {snap.writeStats.legacyMaskRecords === 0
                    ? '0 kayıt · gerek olmadı'
                    : `${snap.writeStats.legacyMaskRecords} kayıt · ${snap.writeStats.legacyMaskFields} alan temizlendi`}
                </Row>
              </>
            )}
            <Row label="BlackBox okuma hükmü">
              <Chip tone={snap?.blackBoxLoad == null ? NONE
                : snap.blackBoxLoad.kind === 'OK' ? OK
                  : snap.blackBoxLoad.kind === 'CORRUPT' ? BAD
                    : snap.blackBoxLoad.kind === 'NONE' ? NONE : WARN}>
                {snap?.blackBoxLoad?.kind ?? NA}
              </Chip>
            </Row>
            <Row label="Format / checksum">
              {snap?.blackBoxLoad?.formatVersion ?? NA}
              {' / '}
              {snap?.blackBoxLoad == null || snap.blackBoxLoad.checksumOk === null
                ? 'DENETLENMEDİ'
                : snap.blackBoxLoad.checksumOk ? 'TUTUYOR' : 'TUTMUYOR'}
            </Row>
          </Section>

          {/* ── D3 · Snapshot kotası ────────────────────────────────────── */}
          <Section title="Snapshot kota defteri">
            <Row label="PERIODIC (saklanan / kota)">
              {s.snapshotPolicy.periodicCount} / {LR_SNAPSHOT_PERIODIC_QUOTA}
            </Row>
            <Row label="CRITICAL (saklanan / kota)">
              {s.snapshotPolicy.criticalCount} / {LR_SNAPSHOT_CRITICAL_QUOTA}
            </Row>
            <Row label="Düşen periyodik snapshot">{s.dropped.droppedPeriodicSnapshots}</Row>
            <Row label="Düşen KRİTİK snapshot">
              <Chip tone={s.dropped.droppedCriticalSnapshots > 0 ? BAD : OK}>
                {s.dropped.droppedCriticalSnapshots}
              </Chip>
            </Row>
            <Row label="Kontrollü tahliye">{s.snapshotPolicy.evictedCriticalCount}</Row>
            <Row label="Bellekteki gövde / indeks">
              {snap?.bodyIds.length ?? 0} / {s.snapshots.length}
            </Row>
          </Section>

          <Section title="Kayıt bütçesi">
            <Row label="Snapshot (üretilen / bastırılan)">
              {s.snapshots.length} / {s.snapshotPolicy.suppressedCount}
            </Row>
            <Row label="BlackBox penceresi">{snap?.blackBoxCount ?? 0}</Row>
            <Row label="Düşen kayıt (örnek / olay / BB)">
              {s.dropped.droppedSamples} / {s.dropped.droppedEvents} / {s.dropped.droppedBlackBoxRecords}
            </Row>
            <Row label="Depolama">
              <Chip tone={s.storage.pressure === 'CRITICAL' ? BAD
                : s.storage.pressure === 'WARN' ? WARN : OK}>
                {s.storage.pressure}
              </Chip>
              {' '}{s.storage.usedBytes === null ? NA : `${s.storage.usedBytes} bayt`}
            </Row>
            <Row label="Budanan (snapshot / olay)">
              {s.storage.prunedSnapshots} / {s.storage.prunedEvents}
            </Row>
          </Section>

          <Section title="Son kritik olay">
            <div
              data-testid="lr-critical-summary"
              className="mb-2 font-mono text-[11px] text-[var(--oem-ink-2)]"
            >
              kayıt {recording ? 'SÜRÜYOR' : 'DURDU'} · kritik olay {criticalCount}
            </div>
            {lastCritical === null ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">Kritik olay kaydedilmedi.</p>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 text-[var(--oem-danger)]" />
                <div>
                  <div className="font-mono text-[11px] text-[var(--oem-ink-1)]">{lastCritical.type}</div>
                  <div className="text-[11px] text-[var(--oem-ink-2)]">{lastCritical.detail}</div>
                </div>
              </div>
            )}
          </Section>

          <Section title="Preflight">
            {s.preflight.length === 0 ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">Preflight kaydı yok.</p>
            ) : (
              s.preflight.map((row) => (
                <Row key={row.id} label={row.id}>
                  <Chip tone={verdictTone(row.verdict)}>{VERDICT_LABEL[row.verdict]}</Chip>
                </Row>
              ))
            )}
          </Section>
        </>
      )}

      <p className="flex items-start gap-1.5 text-[10px] text-[var(--oem-ink-3)]">
        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
        <span>
          <strong>Bu sistem ürün davranışını DEĞİŞTİRMEZ.</strong> Yalnız mevcut
          senkron getter'ları okur; hiçbir servis başlatmaz/durdurmaz, komut
          göndermez, bağlantıya dokunmaz. Sürüş sırasında popup açılmaz,
          ses çalınmaz, işlem istenmez. Gözlenmeyen senaryo <code>NOT_OBSERVED</code>'dır,
          başarısızlık DEĞİL; backend yoksa <code>BLOCKED_BACKEND</code>, FAIL değil.
          <strong> Kanıtsız PASS üretilmez.</strong> Gerçek araç kanıtı olmadan
          hiçbir madde &quot;sahada doğrulandı&quot; sayılmaz.
        </span>
      </p>
      <p className="flex items-start gap-1.5 text-[10px] text-[var(--oem-ink-3)]">
        <Route size={12} className="mt-0.5 shrink-0" />
        <span>
          Ekran <strong>açılışta tek kez</strong> okur; 1 Hz'lik gözlemci
          döngüsüne abone olmaz (LAB açıkken render baskısı üretmemek için).
          Güncel değer için YENİLE'ye basın.
          {matrixSummary === null && s !== null && ' Matris hesaplanamadı.'}
        </span>
      </p>
    </div>
  );
}

export default memo(LongRoadFieldValidationScreenBase);
