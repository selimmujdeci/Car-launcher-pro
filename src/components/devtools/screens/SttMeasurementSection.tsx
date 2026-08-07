/**
 * SttMeasurementSection — CAROS LAB · Mavi STT / Mikrofon · ÖLÇÜM DEFTERİ (MAVI-STT-LAB-2).
 *
 * Bu bölüm STT-LAB-1'in ürettiği gözlemi, kullanıcının ELLE başlattığı sabit süreli
 * ölçümlerde toplayıp KARŞILAŞTIRILABİLİR özet kayıtlara çevirir.
 *
 * SALT-OKUNUR (ölçüm dışında): mikrofon BAŞLATMAZ/DURDURMAZ · STT veya wake motoruna
 * DOKUNMAZ · VAD eşiği DEĞİŞTİRMEZ · AudioSource seçimine DOKUNMAZ · AEC/NS/AGC
 * aç-kapa YAPMAZ · araç sistemine komut GÖNDERMEZ. Yaptığı tek şey, var olan
 * salt-okunur gözlemi periyodik OKUMAKTIR.
 *
 * OTOMATİK KAYIT YOK: ölçüm YALNIZ "ÖLÇÜMÜ BAŞLAT" ile başlar. Ekran kapanırsa
 * koşucu `dispose()` ile ölür → arka planda ölçüm DEVAM ETMEZ (koşucunun sahibi
 * bu bileşendir; modül seviyesi durum yoktur).
 *
 * GİZLİLİK: transcript · n-best · wake sözcüğü · grammar kelimeleri · ham ses
 * hiçbir kayda, snapshot'a veya markup'a GİRMEZ. Kayıtlar ham örnek SAKLAMAZ.
 *
 * KARAR ÜRETMEZ: karşılaştırma YALNIZ sayısal farktır. "Bu eşik daha iyi",
 * "gürültü hızdan arttı", "şunu kullan" gibi hüküm/öneri/nedensellik YOKTUR.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, AlertTriangle, ClipboardList } from 'lucide-react';
import { readSttMicSnapshot } from '../../../platform/devtools/sttMicSources';
import { refreshVoiceMicDiagnostics } from '../../../platform/voice/voiceMicDiagnosticsProbe';
import {
  appendMeasurement, removeMeasurement, compareMeasurements,
  STT_CONDITION_IDS, STT_CONDITION_LABEL, STT_DURATION_OPTIONS_S, STT_LEDGER_MAX,
  STT_OUTCOME_LABEL, STT_REASON_LABEL, STT_SAMPLE_INTERVAL_MS,
  type SttConditionId, type SttMeasurementRecord,
} from '../../../platform/devtools/sttMeasurementModel';
import {
  createSttMeasurementRunner, STT_DEFAULT_DURATION_MS,
  type SttRunnerState,
} from '../../../platform/devtools/sttMeasurementRunner';
import {
  loadMeasurementLedger, saveMeasurementLedger, clearMeasurementLedgerStorage,
} from '../../../platform/devtools/sttMeasurementStore';
/* MAVI-STT-LAB-3: koşul bazlı toplu özet. Özet bileşenine YALNIZ hesaplanmış
   özetler geçilir — ham kayıtları GÖRMEZ ve mutasyon geri çağrısı ALMAZ, bu
   yüzden o katmanda silme/başlatma/ayar değiştirme yapısal olarak imkânsızdır. */
import { buildConditionSummaries } from '../../../platform/devtools/sttConditionSummaryModel';
import { SttConditionSummarySection } from './SttConditionSummary';

/* ── Gösterim yardımcıları (saf) ─────────────────────────────────────────── */

function f4(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '—';
}
function f1(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
}
function pct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
}
function clock(ms: number): string {
  return `${(ms / 1000).toFixed(1)}sn`;
}

const BTN = 'rounded border px-2 py-1 font-mono text-[10px]';
const BTN_IDLE = `${BTN} border-[var(--oem-line-strong)] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]`;
const BTN_DANGER = `${BTN} border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]`;

/* ── Kayıt satırı ────────────────────────────────────────────────────────── */

const RecordRow = memo(function RecordRow({
  rec, armed, onArm, onDelete, onDisarm,
}: {
  rec: SttMeasurementRecord;
  armed: boolean;
  onArm: (id: string) => void;
  onDelete: (id: string) => void;
  onDisarm: () => void;
}) {
  return (
    <div
      data-testid={`stt-m-row-${rec.measurementId}`}
      data-outcome={rec.outcome}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0 font-mono text-[10px] text-[var(--oem-ink-2)]">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[var(--oem-ink)]">{STT_CONDITION_LABEL[rec.conditionId]}</span>
          <span className="text-[9px] text-[var(--oem-ink-3)]">
            {new Date(rec.startedAt).toISOString()} · {clock(rec.elapsedMs)}/{clock(rec.targetMs)}
          </span>
          <span className="rounded border border-[var(--oem-line-strong)] px-1 text-[9px]">
            {STT_OUTCOME_LABEL[rec.outcome]}
          </span>
        </div>
        <div className="mt-0.5 break-all text-[9px]">
          taban p50 <b>{f4(rec.noiseFloor?.p50)}</b> · eşik p50 <b>{f4(rec.threshold?.p50)}</b> ·
          RMS p50 <b>{f4(rec.rms?.p50)}</b> · konuşma <b>{pct(rec.speechDetectedRatio)}</b> ·
          hız p50 <b>{f1(rec.speed?.p50)}</b> · örnek <b>{rec.samplesValid}/{rec.samplesTaken}</b> ·
          kaynak <b>{rec.selectedSourceName}</b>
        </div>
        <div className="mt-0.5 text-[9px] text-[var(--oem-ink-3)]">
          {STT_REASON_LABEL[rec.reasonCode]}
          {rec.sourceChanged && ' · ⚠ AudioSource DEĞİŞTİ'}
          {rec.effectsChanged && ' · ⚠ efekt durumu DEĞİŞTİ'}
          {rec.grammarChanged && ' · ⚠ grammar DEĞİŞTİ'}
        </div>
      </div>
      {armed ? (
        <div className="flex h-fit shrink-0 gap-1">
          <button
            type="button"
            data-testid={`stt-m-del-confirm-${rec.measurementId}`}
            onClick={() => onDelete(rec.measurementId)}
            className={BTN_DANGER}
          >
            ONAYLA
          </button>
          <button type="button" onClick={onDisarm} className={BTN_IDLE}>VAZGEÇ</button>
        </div>
      ) : (
        <button
          type="button"
          data-testid={`stt-m-del-${rec.measurementId}`}
          onClick={() => onArm(rec.measurementId)}
          className={`${BTN_IDLE} h-fit shrink-0`}
        >
          <Trash2 size={10} className="inline" /> KAYDI SİL
        </button>
      )}
    </div>
  );
});

/* ── Bölüm ───────────────────────────────────────────────────────────────── */

export const SttMeasurementSection = memo(function SttMeasurementSection() {
  const [ledger, setLedger] = useState<SttMeasurementRecord[]>(() => loadMeasurementLedger());
  const [condition, setCondition] = useState<SttConditionId>('park_motor_kapali');
  const [durationMs, setDurationMs] = useState<number>(STT_DEFAULT_DURATION_MS);
  const [runner, setRunner] = useState<SttRunnerState | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [armedClearAll, setArmedClearAll] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [cmpA, setCmpA] = useState<string>('');
  const [cmpB, setCmpB] = useState<string>('');

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);

  /* Yeni kayıt: deftere ekle + diske yaz. İptal edilen kayıt deftere GİRMEZ
     (appendMeasurement sözleşmesi) ama "son ölçüm" olarak GÖRÜNÜR. */
  const handleFinalized = useCallback((rec: SttMeasurementRecord) => {
    if (!mountedRef.current) return;
    setLedger((prev) => {
      const next = appendMeasurement(prev, rec);
      if (next !== prev) setStorageWarning(!saveMeasurementLedger(next));
      return next;
    });
  }, []);

  /* Koşucunun SAHİBİ bu bileşendir → unmount'ta dispose (arka planda ölçüm YOK). */
  const runnerRef = useRef<ReturnType<typeof createSttMeasurementRunner> | null>(null);
  if (runnerRef.current === null) {
    runnerRef.current = createSttMeasurementRunner({
      sampleOnce: async () => {
        // Salt-okunur native pull + senkron okuma (STT-LAB-1 hattı — ikinci üretici YOK).
        await refreshVoiceMicDiagnostics().catch(() => { /* fail-soft */ });
        return readSttMicSnapshot();
      },
      nowWall: () => Date.now(),
      nowMono: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      setTimer: (fn, ms) => setInterval(fn, ms),
      clearTimer: (id) => clearInterval(id as ReturnType<typeof setInterval>),
      onFinalized: handleFinalized,
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    const r = runnerRef.current!;
    const off = r.subscribe((s) => { if (mountedRef.current) setRunner(s); });
    setRunner(r.getState());
    return () => {
      mountedRef.current = false;
      off();
      r.dispose();            // aktif ölçüm GÜVENLİ iptal + timer temizliği
      runnerRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    runnerRef.current?.start(condition, durationMs);
  }, [condition, durationMs]);

  const cancel = useCallback(() => { runnerRef.current?.cancel(); }, []);

  const deleteOne = useCallback((id: string) => {
    setArmedDeleteId(null);
    setLedger((prev) => {
      const next = removeMeasurement(prev, id);
      setStorageWarning(!saveMeasurementLedger(next));
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setArmedClearAll(false);
    setLedger([]);
    setStorageWarning(!clearMeasurementLedgerStorage());
  }, []);

  const running = runner?.running === true;
  const last = runner?.lastRecord ?? null;

  const recA = useMemo(() => ledger.find((r) => r.measurementId === cmpA) ?? null, [ledger, cmpA]);
  const recB = useMemo(() => ledger.find((r) => r.measurementId === cmpB) ?? null, [ledger, cmpB]);
  const comparison = useMemo(
    () => (recA && recB && recA.measurementId !== recB.measurementId ? compareMeasurements(recA, recB) : null),
    [recA, recB],
  );

  /* MAVI-STT-LAB-3: toplu özet İHTİYAÇ ANINDA hesaplanır ve yalnız bu ekranın
     ömrü boyunca memoize edilir — modül seviyesi mutable cache YOKTUR. */
  const conditionSummaries = useMemo(() => buildConditionSummaries(ledger), [ledger]);

  return (
    <div
      data-testid="stt-measurement"
      className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
        <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          <ClipboardList size={12} /> 7 · ÖLÇÜM DEFTERİ (kabin gürültüsü)
        </span>
        <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          YEREL · en fazla {STT_LEDGER_MAX} kayıt · örnekleme ≥{STT_SAMPLE_INTERVAL_MS}ms
        </span>
      </div>

      {/* Kontroller */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-2 font-mono text-[10px]">
        <label className="flex items-center gap-1 text-[var(--oem-ink-2)]">
          KOŞUL
          <select
            data-testid="stt-m-condition"
            value={condition}
            disabled={running}
            onChange={(e) => setCondition(e.target.value as SttConditionId)}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            {STT_CONDITION_IDS.map((c) => (
              <option key={c} value={c}>{STT_CONDITION_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[var(--oem-ink-2)]">
          SÜRE
          <select
            data-testid="stt-m-duration"
            value={durationMs}
            disabled={running}
            onChange={(e) => setDurationMs(Number(e.target.value))}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            {STT_DURATION_OPTIONS_S.map((s) => (
              <option key={s} value={s * 1000}>{s} sn</option>
            ))}
          </select>
        </label>

        {running ? (
          <button type="button" data-testid="stt-m-cancel" onClick={cancel} className={BTN_DANGER}>
            <Square size={10} className="inline" /> ÖLÇÜMÜ İPTAL ET
          </button>
        ) : (
          <button type="button" data-testid="stt-m-start" onClick={start} className={BTN_IDLE}>
            <Play size={10} className="inline" /> ÖLÇÜMÜ BAŞLAT
          </button>
        )}

        {armedClearAll ? (
          <span className="flex items-center gap-1">
            <button type="button" data-testid="stt-m-clear-confirm" onClick={clearAll} className={BTN_DANGER}>
              ONAYLA — GERİ ALINAMAZ
            </button>
            <button type="button" onClick={() => setArmedClearAll(false)} className={BTN_IDLE}>VAZGEÇ</button>
          </span>
        ) : (
          <button
            type="button"
            data-testid="stt-m-clear"
            onClick={() => setArmedClearAll(true)}
            disabled={ledger.length === 0}
            className={BTN_IDLE}
          >
            <Trash2 size={10} className="inline" /> TÜM KAYITLARI TEMİZLE
          </button>
        )}
      </div>

      {/* Aktif ölçüm durumu */}
      <div
        data-testid="stt-m-status"
        data-running={running ? 'yes' : 'no'}
        className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[10px] text-[var(--oem-ink-2)]"
      >
        {running ? (
          <>
            ÖLÇÜM SÜRÜYOR · koşul <b>{STT_CONDITION_LABEL[runner!.conditionId!]}</b> ·
            kalan <b>{clock(runner!.remainingMs)}</b> ·
            örnek <b>{runner!.samplesValid}/{runner!.samplesTaken}</b>
            {runner!.skippedTicks > 0 && <> · atlanan tik <b>{runner!.skippedTicks}</b></>}
          </>
        ) : (
          <>ÖLÇÜM YOK — kayıt yalnız «ÖLÇÜMÜ BAŞLAT» ile alınır (otomatik kayıt YOK).</>
        )}
      </div>

      {/* Son ölçüm */}
      <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[10px]">
        <span className="text-[var(--oem-ink-3)]">SON ÖLÇÜM: </span>
        {last ? (
          <span data-testid="stt-m-last" data-outcome={last.outcome} className="text-[var(--oem-ink)]">
            {STT_CONDITION_LABEL[last.conditionId]} · {STT_OUTCOME_LABEL[last.outcome]} ·
            {' '}taban p50 {f4(last.noiseFloor?.p50)} · eşik p50 {f4(last.threshold?.p50)} ·
            {' '}RMS p50 {f4(last.rms?.p50)} · konuşma {pct(last.speechDetectedRatio)} ·
            {' '}örnek {last.samplesValid}/{last.samplesTaken}
            {last.outcome === 'cancelled' && (
              <span className="text-[var(--oem-warn)]"> — İPTAL EDİLDİ, DEFTERE YAZILMADI</span>
            )}
          </span>
        ) : (
          <span className="text-[var(--oem-ink-3)]">—</span>
        )}
      </div>

      {storageWarning && (
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[10px] text-[var(--oem-warn)]">
          <AlertTriangle size={10} className="inline" /> Defter diske YAZILAMADI — kayıtlar
          yalnız bu oturumda geçerli (sessiz başarı iddiası yok).
        </div>
      )}

      {/* Karşılaştırma */}
      <div className="border-b border-[var(--oem-line)] px-3 py-2 font-mono text-[10px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--oem-ink-3)]">KARŞILAŞTIR</span>
          <select
            data-testid="stt-m-cmp-a"
            value={cmpA}
            onChange={(e) => setCmpA(e.target.value)}
            className="max-w-[45%] rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            <option value="">A seç…</option>
            {ledger.map((r) => (
              <option key={r.measurementId} value={r.measurementId}>
                {STT_CONDITION_LABEL[r.conditionId]} · {new Date(r.startedAt).toISOString().slice(11, 19)}
              </option>
            ))}
          </select>
          <select
            data-testid="stt-m-cmp-b"
            value={cmpB}
            onChange={(e) => setCmpB(e.target.value)}
            className="max-w-[45%] rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 text-[var(--oem-ink)]"
          >
            <option value="">B seç…</option>
            {ledger.map((r) => (
              <option key={r.measurementId} value={r.measurementId}>
                {STT_CONDITION_LABEL[r.conditionId]} · {new Date(r.startedAt).toISOString().slice(11, 19)}
              </option>
            ))}
          </select>
        </div>

        {comparison ? (
          <div data-testid="stt-m-comparison" className="mt-1.5">
            {comparison.rows.map((row) => (
              <div
                key={row.id}
                data-testid={`stt-m-cmp-${row.id}`}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-b border-[var(--oem-line)] py-0.5 last:border-b-0"
              >
                <span className="text-[var(--oem-ink-2)]">{row.label}</span>
                <span className="text-right text-[var(--oem-ink)]">{row.a}</span>
                <span className="text-right text-[var(--oem-ink)]">{row.b}</span>
                <span className="w-24 text-right text-[var(--oem-info)]">{row.diff}</span>
              </div>
            ))}
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
              Yalnız sayısal fark (B − A) gösterilir. Bu tablo hangi ayarın «daha iyi»
              olduğunu SÖYLEMEZ ve iki ölçüm arasında neden-sonuç KURMAZ; yorum
              tamamen okuyucuya aittir.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[9px] text-[var(--oem-ink-3)]">
            İki FARKLI kayıt seçilince sayısal fark tablosu görünür.
          </p>
        )}
      </div>

      {/* Defter */}
      <div data-testid="stt-m-ledger" data-count={ledger.length}>
        {ledger.length === 0 ? (
          <p className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Defter boş — hiç ölçüm alınmadı. Sahte/örnek kayıt ÜRETİLMEZ.
          </p>
        ) : (
          ledger.map((r) => (
            <RecordRow
              key={r.measurementId}
              rec={r}
              armed={armedDeleteId === r.measurementId}
              onArm={setArmedDeleteId}
              onDisarm={() => setArmedDeleteId(null)}
              onDelete={deleteOne}
            />
          ))
        )}
      </div>

      {/* Koşul bazlı toplu özet — MAVI-STT-LAB-3 (salt-okunur, mutasyon yetkisi YOK) */}
      <SttConditionSummarySection summaries={conditionSummaries} />

      <p className="px-3 py-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KOŞUL ETİKETİ yalnız KULLANICI BEYANIDIR — etiketten hız, fan veya motor durumu
        ÇIKARILMAZ; gerçek hız aynı kayıtta AYRICA gösterilir ve ikisi çelişebilir.
        Kayıtlar ham örnek SAKLAMAZ (yalnız özet istatistik) ve yalnız bu cihazda
        yereldir — hiçbir sunucuya gönderilmez. Konuşma metni, wake sözcüğü ve ham ses
        hiçbir kayda girmez.
      </p>
    </div>
  );
});
