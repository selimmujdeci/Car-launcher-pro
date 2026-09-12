/**
 * SttConditionSummary — CAROS LAB · Ölçüm Defteri · KOŞUL ÖZETLERİ (MAVI-STT-LAB-3).
 *
 * TAMAMEN SALT-OKUNUR. Bu bileşen **yalnız hesaplanmış özetleri** alır
 * (`summaries` prop'u) — ham ölçüm kayıtlarını GÖRMEZ, hiçbir mutasyon geri
 * çağrısı ALMAZ. Dolayısıyla ölçüm başlatma, kayıt silme, defter temizleme veya
 * ayar değiştirme bu katmanda YAPISAL OLARAK imkânsızdır.
 *
 * KARAR ÜRETMEZ: iki koşul karşılaştırması yalnız A · B · (B−A)'dır. "İyi/kötü",
 * "uygun eşik", "hızdan kaynaklandı" gibi hüküm, öneri ve nedensellik YOKTUR.
 *
 * GİZLİLİK: özet sözleşmesinde `measurementId` dahil hiçbir kayıt kimliği yoktur;
 * transcript · n-best · wake sözcüğü · grammar kelimeleri · ham ses bu katmana
 * tip olarak ulaşamaz.
 *
 * BOUNDED: koşul sayısı enum ile 8; dağılım listeleri model tarafında sınırlıdır;
 * bu bileşen modül seviyesi cache TUTMAZ (yalnız kendi ömrü boyunca `useMemo`).
 */

import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import {
  compareConditionSummaries,
  STT_AGG_METRIC_IDS, STT_AGG_METRIC_LABEL, STT_AGG_METRIC_IS_RATIO,
  STT_SUMMARY_STATUS_LABEL, STT_MIN_REPEATS,
  type SttConditionSummary as Summary, type SttSummaryStatus, type AggregateStats,
} from '../../../platform/devtools/sttConditionSummaryModel';
import type { SttConditionId } from '../../../platform/devtools/sttMeasurementModel';

const STATUS_STYLE: Record<SttSummaryStatus, string> = {
  READY:                'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  INSUFFICIENT_REPEATS: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NO_DATA:              'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function fmtStat(st: AggregateStats | null, isRatio: boolean): string {
  if (!st) return '—';
  const f = (v: number): string => (isRatio ? `${(v * 100).toFixed(1)}%` : v.toFixed(4));
  return `medyan ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)} · genişlik ${f(st.spread)} · ${st.validRecords} kayıt`;
}

function fmtRatio(v: number | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
}

function fmtDate(ts: number | null): string {
  return ts === null ? '—' : new Date(ts).toISOString();
}

/* ── Tek koşul kartı ─────────────────────────────────────────────────────── */

const ConditionCard = memo(function ConditionCard({
  s, open, onToggle,
}: { s: Summary; open: boolean; onToggle: (id: SttConditionId) => void }) {
  return (
    <div
      data-testid={`stt-cs-card-${s.conditionId}`}
      data-status={s.status}
      className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <button
        type="button"
        data-testid={`stt-cs-toggle-${s.conditionId}`}
        onClick={() => onToggle(s.conditionId)}
        className="flex w-full flex-wrap items-center gap-2 text-left font-mono text-[10px]"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="text-[var(--oem-ink)]">{s.label}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] ${STATUS_STYLE[s.status]}`}>
          {STT_SUMMARY_STATUS_LABEL[s.status]}
        </span>
        <span className="text-[var(--oem-ink-2)]">
          tamamlanan <b>{s.completeCount}</b> · kaynak kayıp <b>{s.sourceLostCount}</b> ·
          toplam <b>{s.totalCount}</b>
        </span>
        {s.status === 'READY' && (
          <span className="text-[var(--oem-ink-2)]">
            · taban p50 medyanı <b>{s.metrics.floorP50 ? s.metrics.floorP50.median.toFixed(4) : '—'}</b>
            {' '}· eşik p50 medyanı <b>{s.metrics.thrP50 ? s.metrics.thrP50.median.toFixed(4) : '—'}</b>
          </span>
        )}
      </button>

      {s.status === 'INSUFFICIENT_REPEATS' && (
        <p className="mt-0.5 pl-4 font-mono text-[9px] text-[var(--oem-warn)]">
          Toplu istatistik için en az {STT_MIN_REPEATS} tamamlanmış kayıt gerekir
          ({s.completeCount} var). Değerler aşağıda görünür ama TEKRAR YETERSİZDİR —
          tek ölçüm koşulu temsil etmez.
        </p>
      )}

      {open && (
        <div data-testid={`stt-cs-detail-${s.conditionId}`} className="mt-1 pl-4 font-mono text-[9px]">
          {s.totalCount === 0 ? (
            <p className="text-[var(--oem-ink-3)]">
              Bu koşulda hiç kayıt yok — sahte özet ÜRETİLMEZ.
            </p>
          ) : (
            <>
              <div className="text-[var(--oem-ink-3)]">
                ilk ölçüm {fmtDate(s.firstAt)} · son ölçüm {fmtDate(s.lastAt)} ·
                hız kanıtı olmayan kayıt oranı {fmtRatio(s.speedUnknownRecordRatio)}
              </div>

              {([
                ['AudioSource', s.sourceDistribution],
                ['örnekleme hızı', s.sampleRateDistribution],
                ['AEC/NS/AGC (M=mevcut · O=oluştu · E=etkin)', s.effectDistribution],
                ['grammar sınıfı', s.grammarDistribution],
              ] as const).map(([title, dist]) => (
                <div key={title} className="mt-0.5 text-[var(--oem-ink-2)]">
                  <span className="text-[var(--oem-ink-3)]">{title}: </span>
                  {dist.length === 0
                    ? '—'
                    : dist.map((d) => `${d.key} ×${d.count}`).join('  ·  ')}
                </div>
              ))}

              <div className="mt-1">
                {STT_AGG_METRIC_IDS.map((id) => (
                  <div
                    key={id}
                    data-testid={`stt-cs-metric-${s.conditionId}-${id}`}
                    className="grid grid-cols-[10rem_1fr] gap-x-2 border-b border-[var(--oem-line)] py-0.5 last:border-b-0"
                  >
                    <span className="text-[var(--oem-ink-3)]">{STT_AGG_METRIC_LABEL[id]}</span>
                    <span className="text-[var(--oem-ink)]">
                      {fmtStat(s.metrics[id], STT_AGG_METRIC_IS_RATIO[id])}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

/* ── Bölüm ───────────────────────────────────────────────────────────────── */

export const SttConditionSummarySection = memo(function SttConditionSummarySection({
  summaries,
}: { summaries: readonly Summary[] }) {
  const [openId, setOpenId] = useState<SttConditionId | null>(null);
  const [cmpA, setCmpA] = useState<string>('');
  const [cmpB, setCmpB] = useState<string>('');

  const byId = useMemo(() => {
    const m = new Map<string, Summary>();
    for (const s of summaries) m.set(s.conditionId, s);
    return m;
  }, [summaries]);

  const comparison = useMemo(() => {
    const a = byId.get(cmpA);
    const b = byId.get(cmpB);
    return a && b && a.conditionId !== b.conditionId ? compareConditionSummaries(a, b) : null;
  }, [byId, cmpA, cmpB]);

  const readyCount = summaries.filter((s) => s.status === 'READY').length;

  return (
    <div
      data-testid="stt-condition-summary"
      className="border-t border-[var(--oem-line-strong)]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
        <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          <Layers size={12} /> KOŞUL ÖZETLERİ
        </span>
        <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          SALT OKUNUR · yeterli tekrar: {readyCount}/{summaries.length}
        </span>
        <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
          merkez değer MEDYAN · yalnız tamamlanmış kayıtlar
        </span>
      </div>

      {/* Koşullar — SABİT enum sırası */}
      <div data-testid="stt-cs-list">
        {summaries.map((s) => (
          <ConditionCard
            key={s.conditionId}
            s={s}
            open={openId === s.conditionId}
            onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
          />
        ))}
      </div>

      {/* İki koşul karşılaştırması */}
      <div className="border-t border-[var(--oem-line)] px-3 py-2 font-mono text-[10px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--oem-ink-3)]">KOŞUL FARKI</span>
          <select
            data-testid="stt-cs-cmp-a"
            value={cmpA}
            onChange={(e) => setCmpA(e.target.value)}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            <option value="">A koşulu…</option>
            {summaries.map((s) => (
              <option key={s.conditionId} value={s.conditionId}>{s.label}</option>
            ))}
          </select>
          <select
            data-testid="stt-cs-cmp-b"
            value={cmpB}
            onChange={(e) => setCmpB(e.target.value)}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            <option value="">B koşulu…</option>
            {summaries.map((s) => (
              <option key={s.conditionId} value={s.conditionId}>{s.label}</option>
            ))}
          </select>
        </div>

        {comparison ? (
          <div data-testid="stt-cs-comparison" className="mt-1.5">
            {comparison.rows.map((row) => (
              <div
                key={row.id}
                data-testid={`stt-cs-diff-${row.id}`}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-b border-[var(--oem-line)] py-0.5 last:border-b-0"
              >
                <span className="text-[var(--oem-ink-2)]">{row.label}</span>
                <span className="text-right text-[var(--oem-ink)]">{row.a}</span>
                <span className="text-right text-[var(--oem-ink)]">{row.b}</span>
                <span className="w-24 text-right text-[var(--oem-info)]">{row.diff}</span>
              </div>
            ))}
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
              Yalnız matematiksel fark (B − A). Bu tablo hangi koşulun veya eşiğin
              «uygun» olduğunu SÖYLEMEZ ve iki koşul arasında neden-sonuç KURMAZ.
              Koşul etiketi kullanıcı beyanıdır; gerçek hız ayrı satırda durur.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[9px] text-[var(--oem-ink-3)]">
            İki FARKLI koşul seçilince matematiksel fark tablosu görünür.
          </p>
        )}
      </div>

      <p className="px-3 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        İKİ SEVİYE KARIŞTIRILMAZ: bir kaydın p50'si o ölçümün kendi örneklerinden,
        buradaki medyan ise KAYITLAR ARASI hesaplanır. «Kaynak kayıp» kayıtları ayrı
        sayılır ve hiçbir merkez değeri, dağılımı veya zaman damgasını etkilemez.
        Hız kanıtı olmayan kayıt 0 km/s SAYILMAZ. Bir metrik için geçerli kayıt yoksa
        KAYNAK YOK gösterilir — sahte istatistik üretilmez.
      </p>
    </div>
  );
});
