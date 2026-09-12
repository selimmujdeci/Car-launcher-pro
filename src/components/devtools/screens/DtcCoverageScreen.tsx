/**
 * DtcCoverageScreen — CAROS LAB · Vehicle · DTC SINIF KAPSAMI (P0-OBD-09).
 *
 * SALT-OKUNUR. Hiçbir OBD komutu GÖNDERMEZ, tarama BAŞLATMAZ, timer KURMAZ.
 * Yalnız `dtcScanEvidence` defterini okur (açılışta bir kez + elle YENİLE).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Sahada başka bir uygulama `P0089` BEKLEYEN kodunu gösterirken CarOS
 * göstermiyordu. Kök neden native DTC çözümleyicisindeydi ve **hiçbir ekranda
 * görünmüyordu**: ürün "Mode 07'ye ne cevap geldi, ondan ne çözümlendi"
 * sorusunu cevaplayamıyordu. Bu ekran o cevabı verir — ham yanıt ile
 * çözümlenmiş kod YAN YANA durur.
 *
 * DÜRÜSTLÜK: "0 kod" ile "okunmadı" AYRI gösterilir; düşen okuma ASLA yeşil
 * gösterilmez; ham yanıt yoksa `UNAVAILABLE` yazılır (boş string YASAK).
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert, Cpu } from 'lucide-react';
import {
  readDtcCoverageSnapshot, type DtcCoverageSnapshot,
} from '../../../platform/devtools/dtcCoverageSources';
import {
  describeDtcPipelineLoss, formatDtcPipelineLine, DTC_PIPELINE_LOSS_LABEL,
} from '../../../platform/obd/dtcPipelineAccounting';
import {
  buildDtcCoverageView, NA,
  type DtcCoverageView, type DtcTone, type EcuDiscoveryRow,
} from '../../../platform/devtools/dtcCoverageModel';

const TONE: Readonly<Record<DtcTone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function Chip({ tone, children }: { tone: DtcTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const Row = memo(function Row({ row }: { row: DtcCoverageView['rows'][number] }) {
  return (
    <div
      className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`dtc-ev-${row.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">{row.title}</span>
        <Chip tone={row.tone}>{row.outcome}</Chip>
        <span className="flex items-center gap-1 text-[var(--oem-ink-3)]">
          <Cpu size={11} />{row.target}
        </span>
        <span className="text-[var(--oem-ink-3)]">oturum {row.epoch}</span>
      </div>
      <div className="mt-1 grid gap-0.5 font-mono text-[10px]">
        {/* P0-OBD-11: TX/RX yan yana — "komut gitti mi, ne döndü" tek bakışta. */}
        <div>
          <span className="text-[var(--oem-ink-3)]">TX: </span>
          <span className="text-[var(--oem-ink-1)]">{row.tx}</span>
          <span className="text-[var(--oem-ink-3)]"> · süre: </span>
          <span className={row.elapsed === NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.elapsed}
          </span>
          <span className="text-[var(--oem-ink-3)]"> · </span>
          <span className={row.protocol === NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.protocol}
          </span>
        </div>
        <div className="break-all">
          <span className="text-[var(--oem-ink-3)]">RX (ham): </span>
          <span className={row.raw === NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.raw}
          </span>
        </div>
        <div>
          <span className="text-[var(--oem-ink-3)]">çözümlenen: </span>
          <span className={row.codes === NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.codes}
          </span>
        </div>
        {row.recoveredBefore === true && (
          <div className="text-[var(--oem-warn)]">
            ⚠ Bu okumadan ÖNCE hat kurtarması (ATPC/reinit) oldu — tarama tek parça DEĞİL.
          </div>
        )}
        {row.error !== null && (
          <div className="text-[var(--oem-danger)]">hata: {row.error}</div>
        )}
      </div>
    </div>
  );
});

/** Bir ECU adayının keşif/adreslenebilirlik künyesi — SALT-OKUNUR. */
const EcuRow = memo(function EcuRow({ row }: { row: EcuDiscoveryRow }) {
  return (
    <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`ecu-obs-${row.id}`} data-addressability={row.addressability}>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <Cpu size={11} className="text-[var(--oem-ink-3)]" />
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">{row.title}</span>
        <Chip tone={row.tone}>{row.addressability}</Chip>
        <span className="text-[var(--oem-ink-3)]">oturum {row.epoch}</span>
      </div>
      <div className="mt-1 grid gap-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
        <div>keşif: {row.source} · prob: {row.probeOutcome} · admisyon: {row.admission}</div>
        <div className="break-all">{row.route} · {row.protocol}</div>
        <div>tx kuralı: {row.txRule}</div>
        <div>KWP hedefi: {row.kwpTarget}</div>
        <div>gerekçe: {row.addressabilityReason}</div>
        <div>servis: {row.services.join(' · ') || NA}</div>
        {row.raws.map((x) => (
          <div key={x} className="break-all text-[var(--oem-ink-2)]">ham {x}</div>
        ))}
        <div>otorite yayını: {row.published}</div>
      </div>
    </div>
  );
});

export default function DtcCoverageScreen() {
  const [snap, setSnap] = useState<DtcCoverageSnapshot | null>(null);
  /** Zero-leak: sökülmüş bileşene setState YAPILMAZ. */
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readDtcCoverageSnapshot();
    if (mountedRef.current) setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — abonelik/timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const view: DtcCoverageView | null = snap === null
    ? null
    : buildDtcCoverageView(snap.entries, snap.summary, snap.sessionEpoch, snap.ecuObservations);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="dtc-coverage-screen">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-[var(--oem-ink-3)]" />
          <span className="text-[12px] font-semibold text-[var(--oem-ink-1)]">
            DTC Sınıf Kapsamı
          </span>
          <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            oturum {view?.epochLabel ?? NA}
          </span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* Üç servis karosu — servis hiç sorulmadıysa da GÖRÜNÜR. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(view?.tiles ?? []).map((t) => (
          <div
            key={t.service}
            className={`rounded border px-2 py-1.5 ${TONE[t.tone]}`}
            data-testid={`dtc-tile-${t.service}`}
          >
            <div className="text-[11px] font-semibold">{t.title}</div>
            <div className="font-mono text-[10px] opacity-90">{t.detail}</div>
            <div className="font-mono text-[10px] opacity-90">{t.codes}</div>
          </div>
        ))}
      </div>

      {view?.mixedEpochs === true && (
        <div className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1.5 text-[10px] text-[var(--oem-warn)]">
          Defter BİRDEN FAZLA oturum taşıyor — oturum sıfırlaması kaçırılmış olabilir.
        </div>
      )}

      {/* P0-OBD-FINAL-01 — ECU KEŞİF & ADRESLENEBİLİRLİK.
          Sahada bu bölüm BOŞTU ve boşluk iki ayrı şeyi (ECU yok / keşif hiç
          koşmadı) aynı gösteriyordu. Artık her aday için keşif kaynağı, rota,
          tx kuralı, protokol, oturum, prob sonucu, adreslenebilirlik, servis
          denemeleri, ham yanıt ve otorite yayını YAN YANA durur. */}
      <div className="flex flex-col gap-1.5" data-testid="ecu-discovery-evidence">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          ECU KEŞİF & ADRESLENEBİLİRLİK
        </div>
        {view === null ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
        ) : view.ecuEmpty ? (
          <div className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-warn)]"
            data-testid="ecu-discovery-empty">
            Bu oturumda ECU keşif GÖZLEMİ YOK. Bu &quot;araçta tek ECU var&quot; ya da
            &quot;araç temiz&quot; DEMEK DEĞİLDİR — tam araç taraması bu oturumda hiç
            koşmamış olabilir. Tarama koştuysa ve burası hâlâ boşsa, fonksiyonel
            prob yanıtı çözümlenememiş demektir (protokol/adres kalıbı).
          </div>
        ) : (
          view.ecuRows.map((r) => <EcuRow key={r.id} row={r} />)
        )}
      </div>

      {/* ── P0-VDK-F2A · KANONİK TANI İZİ ───────────────────────────────────
          KRİTİK OKUMA: `sıra boşluğu` ya da `tekrar` 0 DIŞINDA ise kanıt
          güvenilmezdir. `export HAZIR DEĞİL` satırında NEDEN yazılıdır. */}
      <div className="flex flex-col gap-1.5" data-testid="canonical-trace">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          Kanonik tanı izi (append-only)
        </div>
        {snap === null ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
        ) : snap.traceSummary.integrity.eventCount === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu süreçte iz olayı KAYDEDİLMEDİ — bu &quot;tarama yapıldı ve temiz&quot; DEMEK DEĞİLDİR.
          </div>
        ) : (
          <div
            data-testid="trace-summary"
            className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px]"
          >
            <div className="text-[var(--oem-ink-1)]">
              iz {snap.traceSummary.traceId}
              {' · '}olay {snap.traceSummary.integrity.eventCount}
              {' · '}işlem {snap.traceSummary.transactionCount}
            </div>
            <div className="text-[var(--oem-ink-3)]">
              ham kapsam: {snap.traceSummary.rawCoverage === null
                ? NA : `%${Math.round(snap.traceSummary.rawCoverage * 100)}`}
              {' · '}maskeli {snap.traceSummary.redactedCount}
              {' · '}ham ölçümsüz {snap.traceSummary.integrity.missingRawCount}
            </div>
            <div className={snap.traceSummary.integrity.gaps.length === 0
              && snap.traceSummary.integrity.duplicates.length === 0
              ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-danger)]'}>
              sıra boşluğu {snap.traceSummary.integrity.gaps.length}
              {' · '}tekrar {snap.traceSummary.integrity.duplicates.length}
              {' · '}düşen {snap.traceSummary.integrity.droppedCount}
              {snap.traceSummary.integrity.truncated ? ' (KIRPILDI)' : ''}
            </div>
            <div className={snap.traceSummary.exportReady
              ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-warn)]'}>
              {snap.traceSummary.exportReady
                ? 'EXPORT HAZIR'
                : `EXPORT HAZIR DEĞİL — ${snap.traceSummary.exportBlockReason ?? NA}`}
            </div>
          </div>
        )}
      </div>

      {/* ── P0-VDK-F1C · ISO-TP TRANSPORT TUNING ────────────────────────────
          KRİTİK OKUMA: `restore düşen > 0` bir KUSURDUR — adaptör kirli
          kalmış olabilir. `uygulanmadı` satırında NEDEN mutlaka yazılıdır. */}
      <div className="flex flex-col gap-1.5" data-testid="isotp-tuning">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          ISO-TP transport tuning (flow control)
        </div>
        <div className="font-mono text-[9px] text-[var(--oem-ink-3)]">
          adaptör: {snap?.adapter === null || snap?.adapter === undefined
            ? `${NA} — yetenek VARSAYILMAZ (fail-closed)`
            : `${snap.adapter.kind} · flow-control ${snap.adapter.flowControl ? 'GÜVENİLİR' : 'GÜVENİLMEZ'}`}
        </div>
        {(snap?.tuning ?? []).length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu oturumda çok-frame UDS okuması YAPILMADI — tuning kararı üretilmedi.
          </div>
        ) : (
          <>
            {(snap?.tuning ?? []).slice().reverse().map((t, i) => (
              <div
                key={`${t.atMs}-${t.txHeader}-${t.subFunction}-${i}`}
                data-testid={`tuning-${t.service}-${t.subFunction}`}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5 font-mono text-[9px]"
              >
                <div className="flex flex-wrap gap-2 text-[var(--oem-ink-1)]">
                  <span>servis {t.service}-{t.subFunction}</span>
                  <span>{t.txHeader ?? NA} → {t.rxHeader ?? NA}</span>
                  <span>{t.protocol !== null ? `ATDPN ${t.protocol}` : NA}</span>
                  <span>adaptör {t.adapterKind}</span>
                  <span className={t.applied ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-ink-3)]'}>
                    {t.applied ? 'TUNING UYGULANDI' : 'uygulanmadı'}
                  </span>
                </div>
                <div className="text-[var(--oem-ink-3)]">karar: {t.decision}</div>
                {t.commands !== null && (
                  <div className="break-all text-[var(--oem-ink-3)]">komutlar: {t.commands}</div>
                )}
                {t.applied && (
                  <div className={t.restored === false
                    ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-ink-3)]'}>
                    restore: {t.restored === null ? NA : t.restored ? 'OK' : 'DÜŞTÜ'}
                    {t.restoreDetail === null ? '' : ` · ${t.restoreDetail}`}
                    {' · '}{t.previousMode ?? NA} → {t.newMode ?? NA}
                  </div>
                )}
                <div className={t.transportOutcome === 'COMPLETE'
                  ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-danger)]'}>
                  transport: {t.transportOutcome}
                  {' · '}bayt {t.byteCount ?? NA}
                  {' · '}çerçeve {t.frameCount ?? NA}
                </div>
              </div>
            ))}
            {snap !== null && (
              <div
                data-testid="tuning-summary"
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px]"
              >
                toplam {snap.tuningSummary.total}
                {' · '}uygulandı {snap.tuningSummary.applied}
                {' · '}atlandı {snap.tuningSummary.skipped}
                {' · '}BUFFER FULL {snap.tuningSummary.bufferFull}
                {' · '}kesik {snap.tuningSummary.truncated}
                <div className={snap.tuningSummary.restoreFailures === 0
                  ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-danger)]'}>
                  RESTORE DÜŞEN: {snap.tuningSummary.restoreFailures}
                  {snap.tuningSummary.restoreFailures === 0 ? ' (beklenen)' : ' ← KUSUR'}
                </div>
                {snap.tuningSummary.topSkipReason !== null && (
                  <div className="text-[var(--oem-ink-3)]">
                    en sık atlama: {snap.tuningSummary.topSkipReason}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── P0-VDK-F1B · TANI OTURUMU KİRALARI (keepalive) ──────────────────
          KRİTİK OKUMA: `keepalive GEREKMEZ` yazan bir satırda `deneme > 0`
          görülüyorsa bu bir KUSURDUR — kör TesterPresent gönderilmiş demektir. */}
      <div className="flex flex-col gap-1.5" data-testid="session-leases">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          Tanı oturumu kiraları (TesterPresent)
        </div>
        {(snap?.sessionLeases ?? []).length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu süreçte oturum kirası AÇILMADI — bu &quot;oturum gerekmiyor&quot; DEMEK DEĞİLDİR.
          </div>
        ) : (
          <>
            {(snap?.sessionLeases ?? []).slice().reverse().map((l) => (
              <div
                key={l.leaseId}
                data-testid={`lease-${l.ecuEndpoint.rxHeader ?? 'FUNC'}`}
                className="flex flex-wrap gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1 font-mono text-[9px]"
              >
                <span className="text-[var(--oem-ink-1)]">{l.ecuEndpoint.label}</span>
                <span className="text-[var(--oem-ink-3)]">
                  {l.ecuEndpoint.txHeader ?? NA} → {l.ecuEndpoint.rxHeader ?? NA}
                </span>
                <span className="text-[var(--oem-ink-3)]">
                  {l.protocol !== null ? `ATDPN ${l.protocol}` : NA}
                </span>
                <span className={l.state === 'DEGRADED' || l.state === 'FAILED' || l.state === 'UNKNOWN'
                  ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-ink-1)]'}>{l.state}</span>
                <span className="text-[var(--oem-ink-3)]">{l.sessionKind}</span>
                <span className={l.keepAliveRequired
                  ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-ink-3)]'}>
                  {l.keepAliveRequired ? 'keepalive GEREKLİ' : 'keepalive GEREKMEZ'}
                </span>
                <span className="text-[var(--oem-ink-3)]">
                  deneme {l.keepAliveAttempts}/başarı {l.keepAliveSuccesses}
                </span>
                <span className="text-[var(--oem-ink-3)]">
                  son keepalive: {l.lastKeepAliveAt === null ? NA
                    : `${Math.max(0, Math.round((Date.now() - l.lastKeepAliveAt) / 1000))} sn önce`}
                </span>
                <span className="text-[var(--oem-ink-3)]">oturum #{l.sessionEpoch}</span>
                {l.failureReason !== null && (
                  <span className="text-[var(--oem-warn)]">neden: {l.failureReason}</span>
                )}
                {l.invalidTransitionFrom !== null && (
                  <span className="text-[var(--oem-danger)]">
                    GEÇİŞ İHLALİ: {l.invalidTransitionFrom}
                  </span>
                )}
              </div>
            ))}
            {snap !== null && (
              <div
                data-testid="session-summary"
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px]"
              >
                oturum açıldı {snap.sessionSummary.sessionsOpened}
                {' · '}keepalive {snap.sessionSummary.keepAliveSent}
                {' · '}başarılı {snap.sessionSummary.keepAlivePositive}
                {' · '}düşen {snap.sessionSummary.keepAliveFailed}
                {' · '}oturum düştü {snap.sessionSummary.expired}
                <div className="text-[var(--oem-ink-3)]">
                  başarı oranı: {snap.sessionSummary.successRate === null
                    ? NA
                    : `%${Math.round(snap.sessionSummary.successRate * 100)}`}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── P0-VDK-F1A · KANONİK TANI İŞLEMLERİ ─────────────────────────────
          Bütçe · iptal · bayat oturum · geç yanıt kararlarının tamamı buradan
          okunur. `UNKNOWN > 0` bir durum geçişi İHLALİDİR ve her zaman kusurdur. */}
      <div className="flex flex-col gap-1.5" data-testid="diagnostic-transactions">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          Tanı işlemleri (bütçe · iptal · oturum mührü)
        </div>
        {(snap?.transactions ?? []).length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu süreçte tanı işlemi AÇILMADI — bu &quot;tarama başarılı&quot; DEMEK DEĞİLDİR.
          </div>
        ) : (
          <>
            {(snap?.transactions ?? []).slice().reverse().map((t) => (
              <div
                key={t.transactionId}
                data-testid={`txn-${t.purpose}`}
                className="flex flex-wrap gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1 font-mono text-[9px]"
              >
                <span className="text-[var(--oem-ink-1)]">{t.purpose}</span>
                <span className={t.state === 'UNKNOWN' || t.state === 'FAILED'
                  ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-ink-1)]'}>{t.state}</span>
                <span className="text-[var(--oem-ink-3)]">
                  istek {t.requestsUsed}/{t.requestBudget}
                </span>
                <span className="text-[var(--oem-ink-3)]">
                  {t.protocol !== null ? `ATDPN ${t.protocol}` : NA}
                </span>
                <span className="text-[var(--oem-ink-3)]">oturum #{t.sessionEpoch}</span>
                <span className="text-[var(--oem-ink-3)]">{t.ecuEndpoint.label}</span>
                {t.lastDenial !== null && (
                  <span className="text-[var(--oem-warn)]">red: {t.lastDenial}</span>
                )}
                {t.cancelReason !== null && (
                  <span className="text-[var(--oem-warn)]">neden: {t.cancelReason}</span>
                )}
                {t.invalidTransitionFrom !== null && (
                  <span className="text-[var(--oem-danger)]">
                    GEÇİŞ İHLALİ: {t.invalidTransitionFrom}
                  </span>
                )}
              </div>
            ))}
            {snap !== null && (
              <div
                data-testid="txn-summary"
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px]"
              >
                TOPLAM {snap.transactionSummary.total}
                {' · '}tamam {snap.transactionSummary.completed}
                {' · '}iptal {snap.transactionSummary.cancelled}
                {' · '}düştü {snap.transactionSummary.failed}
                {' · '}bütçe reddi {snap.transactionSummary.budgetExhausted}
                {' · '}bayat oturum reddi {snap.transactionSummary.staleEpochRejections}
                <div className={snap.transactionSummary.unknown === 0
                  ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-danger)]'}>
                  DURUM GEÇİŞİ İHLALİ: {snap.transactionSummary.unknown}
                  {snap.transactionSummary.unknown === 0 ? ' (beklenen)' : ' ← KUSUR'}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── P0-OBD-PARITY · STANDART FİZİKSEL ADRES PROBLARI ────────────────
          ISO 15765-4 7E1..7E7. Boş liste "başka ECU yok" DEĞİL: prob yalnız
          CAN'de koşar, K-line'da HİÇ gönderilmez (kör adres taraması orada
          başka modülü uyandırabilir). */}
      <div className="flex flex-col gap-1.5" data-testid="physical-ecu-probes">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          Standart fiziksel adres probları (ISO 15765-4 · yalnız CAN)
        </div>
        {(snap?.physicalProbes ?? []).length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu oturumda fiziksel adres probu KOŞMADI (CAN değil · köprü yok · tarama yapılmadı).
            Bu &quot;başka ECU yok&quot; DEMEK DEĞİLDİR.
          </div>
        ) : (
          <>
            {(snap?.physicalProbes ?? []).slice().reverse().map((p, i) => (
              <div
                key={`${p.atMs}-${p.txHeader}-${i}`}
                data-testid={`physical-probe-${p.txHeader}`}
                className="flex flex-wrap gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1 font-mono text-[9px]"
              >
                <span className="text-[var(--oem-ink-1)]">{p.txHeader} → {p.rxHeader}</span>
                <span className="text-[var(--oem-ink-3)]">{p.outcome}</span>
                <span className="text-[var(--oem-ink-3)]">
                  NRC {p.nrc === null ? NA : `0x${p.nrc.toString(16).toUpperCase().padStart(2, '0')}`}
                </span>
                <span className={p.present ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-ink-3)]'}>
                  {p.present ? 'ECU VAR (cevapladı)' : 'ECU SAYILMADI (sessiz)'}
                </span>
                <span className="break-all text-[var(--oem-ink-3)]">raw: {p.raw ?? NA}</span>
              </div>
            ))}
            {(snap?.physicalProbeSkipped ?? 0) > 0 && (
              <div className="font-mono text-[9px] text-[var(--oem-warn)]">
                {snap?.physicalProbeSkipped} adres bütçe tavanı nedeniyle SORULMADI.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── P0-OBD-PARITY · RAW → PARSER → AUTHORITY → UI SAYIM ZİNCİRİ ─────
          Saha teşhisinin TEK seferde çözülmesi için kritik blok: ekranda kod
          yokken "hangi katman düşürdü" sorusunun cevabı buradadır. Sayı
          ölçülemediyse `?` basılır — sahte 0 YASAK. */}
      <div className="flex flex-col gap-1.5" data-testid="dtc-pipeline-accounting">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          RAW → PARSER → AUTHORITY → UI sayım zinciri
        </div>
        {(snap?.pipeline ?? []).length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Bu oturumda üretici DTC okuması YAPILMADI — bu &quot;kayıp yok&quot; DEMEK DEĞİLDİR.
          </div>
        ) : (
          <>
            {(snap?.pipeline ?? [])
              .filter((e) => snap?.sessionEpoch === null || e.sessionEpoch === snap?.sessionEpoch)
              .slice().reverse().map((e, i) => {
                const loss = describeDtcPipelineLoss(e);
                return (
                  <div
                    key={`${e.atMs}-${e.txHeader}-${e.service}-${e.subFunction}-${i}`}
                    data-testid={`pipeline-row-${e.service}-${e.subFunction}`}
                    className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5 font-mono text-[9px]"
                  >
                    <div className="flex flex-wrap gap-2 text-[var(--oem-ink-1)]">
                      <span>servis {e.service}</span><span>alt {e.subFunction}</span>
                      <span>{e.txHeader} → {e.rxHeader}</span>
                      <span>{e.ecuLabel}</span>
                      <span>{e.outcome}</span>
                    </div>
                    <div className={loss === 'NONE'
                      ? 'text-[var(--oem-ink-1)]'
                      : loss === 'UNKNOWN' ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-danger)]'}>
                      {formatDtcPipelineLine(e)}
                    </div>
                  </div>
                );
              })}
            {/* TUR TOPLAMI — tek bakışta "tuttu mu?" */}
            {snap !== null && (
              <div
                data-testid="pipeline-summary"
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px]"
              >
                TOPLAM · RAW {snap.pipelineSummary.raw ?? NA}
                {' · '}PARSED {snap.pipelineSummary.parsed ?? NA}
                {' · '}AUTHORITY {snap.pipelineSummary.authority ?? NA}
                {' · '}UI {snap.pipelineSummary.ui ?? NA}
                <div className={snap.pipelineSummary.lossStages.length === 0 && !snap.pipelineSummary.hasUnknown
                  ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-danger)]'}>
                  KAYIP: {snap.pipelineSummary.lossStages.length === 0
                    ? (snap.pipelineSummary.hasUnknown ? 'BİLİNMİYOR (ölçülemeyen sayı var)' : 'YOK')
                    : snap.pipelineSummary.lossStages
                        .map((st) => DTC_PIPELINE_LOSS_LABEL[st]).join(' · ')}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5" data-testid="advanced-dtc-evidence">
        <div className="font-mono text-[10px] font-semibold text-[var(--oem-ink-2)]">
          UDS 0x19 / KWP 0x18 gelişmiş kanıt
        </div>
        {(snap?.advanced ?? []).filter((e) => snap?.sessionEpoch === null || e.sessionEpoch === snap?.sessionEpoch)
          .slice().reverse().map((e, i) => (
          <div key={`${e.atMs}-${e.service}-${e.subFunction}-${i}`}
            className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5 font-mono text-[9px]">
            <div className="flex flex-wrap gap-2 text-[var(--oem-ink-1)]">
              <span>servis {e.service}</span><span>alt {e.subFunction}</span>
              <span>{e.tx} → {e.rx}</span><span>{e.outcome}</span>
              <span>NRC {e.nrc === null ? NA : `0x${e.nrc.toString(16).toUpperCase().padStart(2, '0')}`}</span>
              <span>epoch {e.sessionEpoch}</span>
            </div>
            <div className="break-all text-[var(--oem-ink-3)]">raw: {e.raw ?? NA}</div>
            <div className="text-[var(--oem-ink-3)]">
              DTC: {e.dtcs.join(' · ') || NA} · status: {e.statusBytes.join(' · ') || NA} ·
              {' '}availability: {e.statusAvailabilityMask ?? NA}
            </div>
            <div className="break-all text-[var(--oem-ink-3)]">
              snapshot: {e.snapshotReferences.join(' · ') || NA} · extended-data: {e.extendedDataReferences.join(' · ') || NA}
            </div>
            {e.error !== null && <div className="text-[var(--oem-danger)]">hata: {e.error}</div>}
          </div>
        ))}
      </div>

      {view === null ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
      ) : view.empty ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
          Bu oturumda DTC taraması YAPILMADI — bu &quot;arıza yok&quot; DEMEK DEĞİLDİR.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {view.rows.map((r) => <Row key={r.id} row={r} />)}
        </div>
      )}
    </div>
  );
}
