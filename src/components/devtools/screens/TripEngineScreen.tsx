/**
 * TripEngineScreen — CAROS LAB · Vehicle · TRIP ENGINE (P1).
 *
 * Trip motorunun SALT-OKUNUR gözlemi (§7).
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · trip başlatma/durdurma · trip silme · yükleme tetikleme/zorlama
 *   · kuyruk boşaltma · retry zorlama · ağ çağrısı · `tripLogService`
 *     konfigürasyonuna dokunma
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * HAM VERİ GÖSTERİLMEZ: **koordinat/rota GÖSTERİLMEZ** (trip modeli
 * zaten taşımaz), mutlak zaman damgası yerine YAŞ gösterilir.
 *
 * DÜRÜSTLÜK: tahmin edilmiş metrik **"(tahmini)" etiketiyle** gösterilir;
 * bilinmeyen metrik `Veri yok` — sahte `0` YOK.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Route, AlertTriangle, ShieldCheck, CloudUpload } from 'lucide-react';
import { readTripUploadSnapshot } from '../../../platform/trip/tripUploadRuntime';
import { getTripSnapshot } from '../../../platform/tripLogService';
import { getTripMeterSnapshot, type TripMeterSnapshot } from '../../../platform/trip/tripMeterService';
import { formatTripMeterKm } from '../../../platform/trip/tripMeterModel';
import { getLongRoadGlance } from '../../../platform/fieldValidation/longRoadRecorder';
import type { TripUploadSnapshot, UploadState } from '../../../platform/trip/tripUploadCoordinator';
import { toCanonicalTripSummary, buildTripStatistics } from '../../../platform/trip/tripLifecycle';
import {
  metricLabel, metricSourceLabel, tripConfidenceLabel,
  type TripStatistics, type TripSummary, type Metric,
} from '../../../platform/trip/tripCanonicalModel';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

const UNAVAILABLE = 'UNAVAILABLE';

const UPLOAD_TONE: Record<UploadState, string> = {
  IDLE: NONE, QUEUED: INFO, UPLOADED: OK,
  DUPLICATE: OK, RETRY_WAIT: WARN, FAILED: BAD,
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

/** Yaş — mutlak zaman damgası SIZDIRMAZ. */
function ago(atMs: number | null, nowMs: number): string {
  if (atMs === null) return UNAVAILABLE;
  const d = Math.max(0, nowMs - atMs);
  if (d < 1_000) return 'az önce';
  if (d < 60_000) return `${Math.floor(d / 1_000)} sn önce`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} dk önce`;
  return `${Math.floor(d / 3_600_000)} sa önce`;
}

interface Snap {
  readonly upload: TripUploadSnapshot | null;
  readonly stats: TripStatistics | null;
  readonly activeState: string;
  readonly liveDistanceKm: number | null;
  readonly liveDurationMin: number | null;
  /** Son KAPANMIŞ trip'in kanonik özeti — P2 metrik gözlemi buradan gelir. */
  readonly lastTrip: TripSummary | null;
  /** Kullanıcının RESETLENEBİLİR yol sayacı — salt gözlem. */
  readonly meter: TripMeterSnapshot | null;
  /** Saha testi oturumunun KENDİ mesafesi — ayrı otorite, karşılaştırma için. */
  readonly fieldSessionDistanceKm: number | null;
  readonly fieldSessionActive: boolean;
  readonly readAtMs: number;
}

/**
 * Metrik + kaynak etiketi.
 *
 * Değer ile güvenilirliği AYRI göstermek P2'nin ana kuralıdır: `2,4 L`
 * tek başına ölçüm mü tahmin mi belli değildir.
 */
function MetricRow(
  { label, m, unit }: { label: string; m: Metric; unit: string },
) {
  return (
    <Row label={label}>
      {metricLabel(m, unit)}
      <span className="ml-1 text-[var(--oem-ink-3)]">[{metricSourceLabel(m.source)}]</span>
    </Row>
  );
}

/** Oran (0–1) → yüzde metni; bilinmiyorsa `UNAVAILABLE` (sahte %0 YOK). */
function pct(v: number | null): string {
  return v === null ? UNAVAILABLE : `%${Math.round(v * 100)}`;
}

function num(v: number | null): string {
  return v === null ? UNAVAILABLE : String(v);
}

/** Okuma fail-soft: motor düşse bile ekran çökmez. */
function readSnap(): Snap {
  let upload: TripUploadSnapshot | null = null;
  let stats: TripStatistics | null = null;
  let activeState = UNAVAILABLE;
  let liveDistanceKm: number | null = null;
  let liveDurationMin: number | null = null;
  let lastTrip: TripSummary | null = null;
  let meter: TripMeterSnapshot | null = null;
  let fieldSessionDistanceKm: number | null = null;
  let fieldSessionActive = false;

  try { upload = readTripUploadSnapshot(); } catch { upload = null; }
  try { meter = getTripMeterSnapshot(); } catch { meter = null; }
  try {
    /* Saha testi AYRI bir mesafe otoritesidir; buradan yalnız OKUNUR —
       yol sayacına yazmaz, yol sayacı da ona yazmaz. */
    const g = getLongRoadGlance();
    fieldSessionDistanceKm = g.distanceKm;
    fieldSessionActive = g.active;
  } catch { fieldSessionDistanceKm = null; fieldSessionActive = false; }
  try {
    const t = getTripSnapshot();
    activeState = t.active ? 'RUNNING' : 'IDLE';
    liveDistanceKm = t.current?.liveDistanceKm ?? null;
    liveDurationMin = t.current?.liveDurationMin ?? null;
    /* Geçmiş kayıtları kanonik özete çevirip istatistik türet.
       Buradaki bağlam YALNIZ eski (P1) kayıtlar için tabandır: P2 kayıtları
       kendi kaynak etiketlerini TAŞIR ve dönüşüm onları tercih eder. */
    const summaries = t.history.slice(0, 50).map((r) =>
      toCanonicalTripSummary(r, 'COMPLETED', {
        distanceSource: 'DERIVED', fuelMeasured: false, fuelPriceKnown: false,
      }));
    stats = buildTripStatistics(summaries);
    /* `tripLogService` yeni kaydı BAŞA ekler → [0] en son kapanan trip. */
    lastTrip = summaries[0] ?? null;
  } catch { stats = null; }

  return {
    upload, stats, activeState, liveDistanceKm, liveDurationMin, lastTrip,
    meter, fieldSessionDistanceKm, fieldSessionActive,
    readAtMs: Date.now(),
  };
}

function TripEngineScreenBase() {
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

  const u = snap?.upload ?? null;
  const st = snap?.stats ?? null;
  const lt = snap?.lastTrip ?? null;
  const now = snap?.readAtMs ?? 0;
  const mr = snap?.meter?.record ?? null;

  /* Fark ancak İKİ taraf da okunabiliyorsa üretilir — bilinmeyenden sahte 0
     TÜRETİLMEZ. Hangisinin doğru olduğu BURADA HÜKME BAĞLANMAZ (§8): iki ayrı
     otorite, iki ayrı başlangıç anı; fark tek başına hata anlamına GELMEZ. */
  const meterKm = mr !== null && mr.state === 'READY' ? mr.distanceKm : null;
  const fieldKm = snap?.fieldSessionDistanceKm ?? null;
  const diffKm = meterKm !== null && fieldKm !== null ? meterKm - fieldKm : null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">Trip Engine</h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Trip başlatmaz, yükleme tetiklemez.
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

      {/* 1 · Aktif trip durumu */}
      <Section title="Trip State">
        <div className="flex flex-col">
          <Row label="Durum">
            <Chip tone={snap?.activeState === 'RUNNING' ? OK : NONE}>
              <Route size={11} className="mr-1" />
              {snap?.activeState ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="Distance (canlı)">
            {snap?.liveDistanceKm === null || snap?.liveDistanceKm === undefined
              ? UNAVAILABLE
              : `${snap.liveDistanceKm} km`}
          </Row>
          <Row label="Duration (canlı)">
            {snap?.liveDurationMin === null || snap?.liveDurationMin === undefined
              ? UNAVAILABLE
              : `${snap.liveDurationMin} dk`}
          </Row>
        </div>
      </Section>

      {/* 1b · P2 — son kapanan trip'in metrikleri, METRİK BAŞINA kaynak */}
      <Section title="Last Completed Trip · Metric Provenance (P2)">
        {lt === null ? (
          <Chip tone={NONE}>Kapanmış trip YOK</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="lastCompletedTripKey">{lt.tripKey}</Row>
            <MetricRow label="Mesafe"          m={lt.metrics.distanceKm}      unit="km" />
            <MetricRow label="Süre"            m={lt.metrics.durationMin}     unit="dk" />
            <MetricRow label="Hareket süresi"  m={lt.metrics.movingTimeMin}   unit="dk" />
            <MetricRow label="Rölanti süresi"  m={lt.metrics.idleTimeMin}     unit="dk" />
            {/* BİLİNMEYEN süre AYRI kova — rölantiye katılmaz. */}
            <MetricRow label="Bilinmeyen süre" m={lt.metrics.unknownTimeMin}  unit="dk" />
            <MetricRow label="Duruş sayısı"    m={lt.metrics.stopCount}       unit="" />
            <MetricRow label="Ortalama hız"    m={lt.metrics.averageSpeedKmh} unit="km/h" />
            <MetricRow label="Maksimum hız"    m={lt.metrics.maximumSpeedKmh} unit="km/h" />
            <MetricRow label="Maksimum RPM"    m={lt.metrics.maxRpm}          unit="" />
            <MetricRow label="Maks. motor sıc." m={lt.metrics.maxEngineTempC} unit="°C" />
            <MetricRow label="Sert fren"       m={lt.metrics.harshBrakeCount} unit="" />
            <MetricRow label="Sert hızlanma"   m={lt.metrics.harshAccelCount} unit="" />
            {/* Gerçek hız limiti kaynağı YOK → ihlal ÜRETİLMEZ (§8). */}
            <Row label="speedViolationSource">
              <Chip tone={NONE}>{lt.metrics.speedViolations.source}</Chip>
            </Row>
          </div>
        )}
      </Section>

      {/* 1c · P2 — yakıt ve maliyet: ölçüm mü, tahmin mi */}
      <Section title="Fuel & Cost (P2)">
        {lt === null ? (
          <Chip tone={NONE}>Kapanmış trip YOK</Chip>
        ) : (
          <div className="flex flex-col">
            {/* ÖLÇÜLEN yakıt YÜZDE puandır; litre bir DÖNÜŞÜMDÜR. */}
            <MetricRow label="Yakıt (ölçülen %)" m={lt.fuelUsedPercent} unit="puan" />
            <MetricRow label="Yakıt (litre)"     m={lt.metrics.fuelUsedL} unit="L" />
            <Row label="fuelSource">
              <Chip tone={lt.metrics.fuelUsedL.source === 'MEASURED' ? OK
                        : lt.metrics.fuelUsedL.source === 'DERIVED' ? INFO
                        : lt.metrics.fuelUsedL.source === 'ESTIMATED' ? WARN : NONE}>
                {lt.metrics.fuelUsedL.source}
              </Chip>
            </Row>
            <Row label="fuelUnit">{lt.fuelUnit ?? UNAVAILABLE}</Row>
            {/* Ölçüm reddedildiyse GEREKÇE — sessiz "tahmin" YOK. */}
            <Row label="fuelRejectReason">{lt.fuelRejectReason ?? UNAVAILABLE}</Row>
            <MetricRow label="Maliyet" m={lt.metrics.estimatedCost} unit={lt.price.currency ?? ''} />
            <Row label="costSource">
              <Chip tone={lt.metrics.estimatedCost.source === 'DERIVED' ? INFO
                        : lt.metrics.estimatedCost.source === 'ESTIMATED' ? WARN : NONE}>
                {lt.metrics.estimatedCost.source}
              </Chip>
            </Row>
            {/* Fiyat SNAPSHOT'ı — sonradan fiyat değişse maliyet DEĞİŞMEZ. */}
            <Row label="Birim fiyat (snapshot)">
              {lt.price.unitPrice === null
                ? UNAVAILABLE
                : `${lt.price.unitPrice} ${lt.price.currency ?? ''}`.trim()}
            </Row>
            <Row label="priceSource">{lt.price.source ?? UNAVAILABLE}</Row>
            <Row label="Fiyat alındı">{ago(lt.price.capturedAtMs, now)}</Row>
          </div>
        )}
      </Section>

      {/* 1d · P2 — confidence ve DAYANDIĞI kanıt */}
      <Section title="Confidence Evidence (P2)">
        {lt === null ? (
          <Chip tone={NONE}>Kapanmış trip YOK</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="tripConfidence">
              <Chip tone={lt.confidence === 'VERY_HIGH' || lt.confidence === 'HIGH' ? OK
                        : lt.confidence === 'MEDIUM' ? INFO
                        : lt.confidence === 'LOW' ? WARN : NONE}>
                {lt.confidence} · {tripConfidenceLabel(lt.confidence)}
              </Chip>
            </Row>
            {/* Güveni HANGİ kanıt sınırladı — denetlenebilirlik. */}
            <Row label="confidenceLimitedBy">{lt.coverage.limitedBy ?? UNAVAILABLE}</Row>
            <Row label="distanceSource">
              <Chip tone={lt.metrics.distanceKm.source === 'MEASURED' ? OK : INFO}>
                {lt.metrics.distanceKm.source}
              </Chip>
            </Row>
            <Row label="sampleCoverage (hız örneği)">{num(lt.coverage.speedSampleCount)}</Row>
            <Row label="obdCoverage">{pct(lt.coverage.obdCoverage)}</Row>
            <Row label="timeCoverage">{pct(lt.coverage.timeCoverage)}</Row>
            <Row label="dataGapCount">
              {lt.coverage.dataGapCount === null ? UNAVAILABLE
                : <Chip tone={lt.coverage.dataGapCount === 0 ? OK : WARN}>
                    {lt.coverage.dataGapCount}
                  </Chip>}
            </Row>
            <Row label="sourceSwitchCount">{num(lt.coverage.sourceSwitchCount)}</Row>
            <Row label="metricsVersion">{num(lt.metricsVersion)}</Row>
          </div>
        )}
      </Section>

      {/* 1e · Kullanıcının RESETLENEBİLİR yol sayacı — SALT GÖZLEM */}
      <Section title="User Trip Meter (resettable) · read-only">
        {mr === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — yol sayacı okunamadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="userTripMeterKm">
              {/* state READY değilse mesafe GÖSTERİLMEZ — sahte 0 YOK. */}
              {meterKm === null ? UNAVAILABLE : `${formatTripMeterKm(meterKm)} km`}
            </Row>
            <Row label="meterState">
              <Chip tone={mr.state === 'READY' ? OK : mr.state === 'CORRUPT' ? BAD : NONE}>
                {mr.state}
              </Chip>
            </Row>
            <Row label="distanceSource">
              <Chip tone={mr.distanceSource === 'UNIFIED_ODOMETER' ? OK : NONE}>
                {mr.distanceSource}
              </Chip>
            </Row>
            <Row label="confidence">
              <Chip tone={mr.confidence === 'HIGH' ? OK : mr.confidence === 'MEDIUM' ? WARN : NONE}>
                {mr.confidence}
              </Chip>
            </Row>
            <Row label="startedAt (son sıfırlama)">{ago(mr.startedAtMs, now)}</Row>
            <Row label="lastUpdatedAt">{ago(mr.lastUpdatedAtMs, now)}</Row>
            <Row label="resetCount">{mr.resetCount}</Row>
            <Row label="lastPersistedAt">{ago(snap?.meter?.lastPersistedAtMs ?? null, now)}</Row>
            <Row label="restoreState">
              <Chip tone={snap?.meter?.restoreState === 'CORRUPT' ? BAD
                        : snap?.meter?.restoreState === 'RESTORED' ? OK : NONE}>
                {snap?.meter?.restoreState ?? UNAVAILABLE}
              </Chip>
            </Row>
            <Row label="persistenceVersion">{mr.persistenceVersion}</Row>
            {/* Saha testi AYRI otorite — yol sayacını SAHİPLENMEZ, sıfırlamaz. */}
            <Row label="fieldSessionDistanceKm">
              {fieldKm === null
                ? UNAVAILABLE
                : `${formatTripMeterKm(fieldKm)} km${snap?.fieldSessionActive ? ' · AKTİF' : ''}`}
            </Row>
            <Row label="differenceKm">
              {diffKm === null ? UNAVAILABLE : `${formatTripMeterKm(diffKm)} km`}
            </Row>
          </div>
        )}
        <p className="mt-2 text-[10px] text-[var(--oem-ink-3)]">
          Bu bölüm SALT-OKUNURDUR: LAB&apos;dan sıfırlama YOKTUR (sıfırlama yalnız
          ana ekranda, araç dururken). <strong>Fark bir hata hükmü DEĞİLDİR</strong> —
          yol sayacı ile saha testi oturumu iki AYRI otoritedir ve farklı anlarda
          başlar; hangisinin doğru olduğu otomatik ilan EDİLMEZ.
        </p>
      </Section>

      {/* 2 · Yükleme kuyruğu */}
      <Section title="Upload Queue">
        {u === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — yükleme defteri okunamadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Kuyrukta">
              {u.queuedCount === 0 ? <Chip tone={NONE}>0</Chip> : <Chip tone={INFO}>{u.queuedCount}</Chip>}
            </Row>
            <Row label="Yüklendi">
              <Chip tone={u.uploadedCount > 0 ? OK : NONE}>
                <CloudUpload size={11} className="mr-1" />{u.uploadedCount}
              </Chip>
            </Row>
            <Row label="Tekrar (dedupe)">
              {/* DUPLICATE bir HATA DEĞİL — sunucuda veri zaten var. */}
              <Chip tone={u.duplicateCount > 0 ? OK : NONE}>{u.duplicateCount}</Chip>
            </Row>
            <Row label="Retry">
              {u.retryCount === 0
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />0</Chip>
                : <Chip tone={WARN}>{u.retryCount}</Chip>}
            </Row>
            <Row label="Başarısız">
              {u.failedCount === 0
                ? <Chip tone={OK}>0</Chip>
                : <Chip tone={BAD}><AlertTriangle size={11} className="mr-1" />{u.failedCount}</Chip>}
            </Row>
            <Row label="Last Upload">{ago(u.lastSuccessAtMs, now)}</Row>
            <Row label="Last Failure">{ago(u.lastFailureAtMs, now)}</Row>
            {/* lastUploadResult: sunucunun SON hükmü — uydurulmaz. */}
            <Row label="lastUploadResult">
              {u.entries.length === 0 || u.entries[0]?.lastAckState == null
                ? UNAVAILABLE
                : <Chip tone={UPLOAD_TONE[u.entries[0].state]}>
                    {u.entries[0].lastAckState}
                  </Chip>}
            </Row>
          </div>
        )}
      </Section>

      {/* 3 · Revizyon defteri */}
      <Section title="Revision Ledger">
        {u === null || u.entries.length === 0 ? (
          <Chip tone={NONE}>Kayıt YOK</Chip>
        ) : (
          <div className="flex flex-col">
            {u.entries.slice(0, 10).map((e) => (
              <Row key={e.tripKey} label={e.tripKey}>
                <span className="inline-flex items-center gap-1.5">
                  <Chip tone={UPLOAD_TONE[e.state]}>{e.state}</Chip>
                  <span className="text-[var(--oem-ink-3)]">
                    r{e.revision}
                    {e.serverRevision !== null && e.serverRevision !== e.revision
                      ? ` → s${e.serverRevision}` : ''}
                    {' · '}{e.attempts} deneme
                  </span>
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {/* 4 · İstatistik — tahmin/ölçüm ayrımı GÖRÜNÜR */}
      <Section title="Trip Statistics (yerel geçmiş)">
        {st === null ? (
          <Chip tone={NONE}>{UNAVAILABLE}</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Trip sayısı">{st.tripCount}</Row>
            <Row label="Toplam mesafe">{metricLabel(st.totalDistanceKm, 'km')}</Row>
            <Row label="Toplam süre">{metricLabel(st.totalDurationMin, 'dk')}</Row>
            <Row label="Toplam yakıt">
              {metricLabel(st.totalFuelL, 'L')}
              <span className="ml-1 text-[var(--oem-ink-3)]">
                [{metricSourceLabel(st.totalFuelL.source)}]
              </span>
            </Row>
            <Row label="Toplam maliyet">
              {metricLabel(st.totalCost, '')}
              <span className="ml-1 text-[var(--oem-ink-3)]">
                [{metricSourceLabel(st.totalCost.source)}]
              </span>
            </Row>
            <Row label="Ortalama skor">
              {st.averageScore === null ? UNAVAILABLE : String(st.averageScore)}
            </Row>
            <Row label="Yükleme bekleyen">{st.pendingUploadCount}</Row>
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Bu ekran hiçbir şey başlatmaz ve mevcut trip akışına DOKUNMAZ —
        <code> tripLogService</code> yalnız GÖZLENİR. Rota/koordinat
        gösterilmez (trip modeli zaten taşımaz). <strong>Tahmin edilmiş
        metrikler &quot;(tahmini)&quot; etiketiyle</strong> gösterilir: head
        unit yakıtı 8,5 L/100km ve maliyeti sabit birim fiyatla hesaplar —
        bunlar ölçüm DEĞİLDİR. Bilinmeyen metrik <em>Veri yok</em> gösterilir,
        sahte 0 üretilmez. Tekrar (dedupe) bir HATA değildir: aynı yolculuk
        iki kez sayılmasın diye sunucu ikinci gönderimi reddeder.
      </p>
    </div>
  );
}

export default memo(TripEngineScreenBase);
