/**
 * TripCostScreen — CAROS LAB · Vehicle · TRIP COST (TRIP-COST-B3).
 *
 * Rota → plan → maliyet raporu zincirinin SALT-OKUNUR gözlemi: plan üretildi mi,
 * üretilmediyse hangi beyan eksik, hangi kalemler doğdu, hangileri "bilinmiyor"
 * ve NEDEN.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · rota isteme · hedef seçme/değiştirme · plan kaydetme · fiyat sorgulama
 *   · ağ çağrısı · kullanıcı beyanı yazma
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * HAM VERİ GÖSTERİLMEZ: hedef ADI, başlangıç ADI, adres ve rota GEOMETRİSİ
 * taşınmaz (Navigation Core / Location Engine ile aynı karar) — hedef yalnız
 * VAR/YOK olarak görünür. Gözlemcinin sorusu "hedef beyan edildi mi", "hedef
 * neresi" değildir.
 *
 * İKİ FARKLI "YOK" AYRI GÖSTERİLİR (birleştirilmesi yasak):
 *   · kategori HİÇ AÇILMADI  → plan girdisi beyan edilmedi, kalem YOKTUR
 *   · kategori AÇIK ama değer BİLİNMİYOR → kalem var, tutar null, toplama girmez
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Route, AlertTriangle } from 'lucide-react';
import {
  readTripCostObservation, type TripCostObservationRow,
} from '../../../platform/devtools/tripCostSources';
import {
  TRIP_COST_GAP_LABEL, TRIP_COST_CATEGORY_REASON_LABEL,
} from '../../../platform/trip/cost/tripCostComposition';

/* ── OEM tokenlar (tek katman) ─────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';

/** Bilinmeyen değer için TEK gösterim — sahte 0 / sahte tutar YOK. */
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

/** Süre — mutlak zaman damgası DEĞİL, yolculuk süresi. */
function durationText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return UNAVAILABLE;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

function kmText(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return UNAVAILABLE;
  return `${km.toFixed(1)} km`;
}

/** Tutar — kaynağı yoksa 0 DEĞİL, "bilinmiyor". */
function amountText(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return 'BİLİNMİYOR';
  return `${value.toFixed(2)} ${currency}`;
}

function readSnap(): { row: TripCostObservationRow | null } {
  try { return { row: readTripCostObservation() }; } catch { return { row: null }; }
}

function TripCostScreenBase() {
  const [snap, setSnap] = useState<{ row: TripCostObservationRow | null } | null>(null);
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

  const row = snap?.row ?? null;
  const outcome = row?.outcome ?? null;
  const report = outcome?.report ?? null;
  const currency = outcome?.plan?.currency ?? '';

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">Trip Cost</h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Rota → plan → maliyet raporu. Salt-okunur; hedef/başlangıç ADI taşınmaz.
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

      {row === null ? (
        <Section title="Durum">
          <p className="text-[12px] text-[var(--oem-ink-3)]">
            {UNAVAILABLE} — gözlem okunamadı.
          </p>
        </Section>
      ) : (
        <>
          {/* ── Rota ölçüsü — fiyattan BAĞIMSIZ, fiyat kaynağı olmasa da okunur ── */}
          <Section title="Rota ölçüsü (fiyattan bağımsız)">
            <Row label="Aktif rota">
              <Chip tone={row.routePresent ? OK : NONE}>
                {row.routePresent ? 'VAR' : 'YOK'}
              </Chip>
            </Row>
            <Row label="Toplam mesafe">{kmText(row.totalDistanceKm)}</Row>
            <Row label="Toplam süre">{durationText(row.totalDurationSeconds)}</Row>
            <Row label="Rota ücretli geçiş içeriyor">
              {row.routeHasToll === null ? UNAVAILABLE : (row.routeHasToll ? 'EVET' : 'HAYIR')}
            </Row>
          </Section>

          {/* ── Beyan — rotada OLMAYAN alanlar ── */}
          <Section title="Beyan (rota modelinde olmayan alanlar)">
            {/* Başlangıç/hedef ADI ölçüldü: maliyet hesabına HİÇ girmiyor
                (yalnız gösterim). Bu yüzden eksikliği planı ENGELLEMEZ —
                yalnız işaretlenir. Gece/yolcu ise kategori kapısını belirler. */}
            <Row label="Hedef beyan edildi (yalnız gösterim)">
              <Chip tone={row.destinationDeclared ? OK : WARN}>
                {row.destinationDeclared ? 'EVET' : 'HAYIR'}
              </Chip>
            </Row>
            <Row label="Başlangıç beyan edildi (yalnız gösterim)">
              <Chip tone={row.originDeclared ? OK : WARN}>
                {row.originDeclared ? 'EVET' : 'HAYIR'}
              </Chip>
            </Row>
            <Row label="Eksik beyanlar">
              {outcome && outcome.gaps.length > 0
                ? outcome.gaps.map((g) => TRIP_COST_GAP_LABEL[g]).join(' · ')
                : 'yok'}
            </Row>
          </Section>

          {/* ── Plan ── */}
          <Section title="Plan">
            <Row label="Plan üretildi">
              <Chip tone={outcome?.planBuilt ? OK : WARN}>
                {outcome?.planBuilt ? 'EVET' : 'HAYIR'}
              </Chip>
            </Row>
            {!outcome?.planBuilt && (
              <Row label="Planı engelleyen">
                {outcome && outcome.blockedBy.length > 0
                  ? outcome.blockedBy.map((g) => TRIP_COST_GAP_LABEL[g]).join(' · ')
                  : UNAVAILABLE}
              </Row>
            )}
            <Row label="Bacak sayısı">{outcome?.plan ? outcome.plan.legs.length : UNAVAILABLE}</Row>
          </Section>

          {/* ── Kategori kapıları — İKİ FARKLI "YOK" ayrı ── */}
          <Section title="Kategori kapıları">
            {outcome && outcome.categories.length > 0 ? (
              outcome.categories.map((c) => (
                <Row key={c.category} label={c.category}>
                  <Chip tone={c.opened ? OK : NONE}>
                    {TRIP_COST_CATEGORY_REASON_LABEL[c.reason]}
                  </Chip>
                </Row>
              ))
            ) : (
              <p className="text-[12px] text-[var(--oem-ink-3)]">{UNAVAILABLE}</p>
            )}
          </Section>

          {/* ── Rapor — tutarsız kalem sıfır YAZILMAZ ── */}
          <Section title="Maliyet raporu">
            {report === null ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">
                {UNAVAILABLE} — plan üretilmediği için rapor yok.
              </p>
            ) : (
              <>
                <Row label="Dürüst alt sınır">{amountText(report.lowerBound, currency)}</Row>
                <Row label="Üst sınır">
                  {report.upperBound === null ? 'UYDURULMAZ' : amountText(report.upperBound, currency)}
                </Row>
                <Row label="Rapor tam mı">
                  <Chip tone={report.isComplete ? OK : WARN}>
                    {report.isComplete ? 'TAM' : 'EKSİK'}
                  </Chip>
                </Row>
                <Row label="Toplama giren kalem">{report.knownItems.length}</Row>
                <Row label="Bilinmeyen kalem">{report.missingItems.length}</Row>
                {report.missingItems.length > 0 && (
                  <Row label="Bilinmeyen kalemler">
                    {report.missingItems.map((i) => `${i.category}${i.noteKey ? ` (${i.noteKey})` : ''}`).join(' · ')}
                  </Row>
                )}
                <Row label="Para birimi uyuşmayan">{report.mismatchedItems.length}</Row>
                <Row label="Bayat kalem">{report.staleItems.length}</Row>
              </>
            )}
          </Section>

          <p className="flex items-start gap-1.5 text-[11px] text-[var(--oem-ink-3)]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Fiyat kaynakları HENÜZ BAĞLI DEĞİL (TRIP-COST P2–P5). Kaynağı olmayan
              kalem <b>0 yazmaz</b>, &quot;BİLİNMİYOR&quot; der ve toplama girmez.
              Beyan edilmeyen alanın kategorisi ise hiç açılmaz — varsayılan
              değerle doldurulmaz.
            </span>
          </p>
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--oem-ink-3)]">
            <Route size={12} className="mt-0.5 shrink-0" />
            <span>Bu ekran rota istemez, hedef değiştirmez, plan kaydetmez.</span>
          </p>
        </>
      )}
    </div>
  );
}

export const TripCostScreen = memo(TripCostScreenBase);
