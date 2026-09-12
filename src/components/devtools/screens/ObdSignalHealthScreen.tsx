/**
 * ObdSignalHealthScreen — CAROS LAB · İletişim · OBD SİNYAL SAĞLIĞI.
 *
 * Kritik PID'lerin yaşı, gözlenen aralığı, hata nedeni ve genel hat hükmü.
 *
 * NEDEN AYRI EKRAN (Adaptör Tanılama VARKEN): o ekran TAŞIMA sorusuna bakar
 * (RFCOMM/BLE canlı mı, oturum bayrakları, yaşam döngüsü). Bu ekran VERİ
 * sorusuna bakar: taşıma açıkken bile TEK BİR PID donmuş olabilir ve o durumda
 * "Bluetooth bağlı" cevabı yanıltıcıdır. İki soru birleştirilmez.
 *
 * SALT-OKUNUR: sorgu göndermez, poll yapılandırmasını değiştirmez, reconnect
 * tetiklemez, timer kurmaz. Açılışta tek okuma + elle YENİLE.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Activity, ShieldCheck } from 'lucide-react';
import { getObdSignalHealth, getLinkLossLedger } from '../../../platform/obdService';
import { LINK_LOSS_CANDIDATE_LABEL } from '../../../platform/obd/linkLossLedger';
import {
  HEALTH_CAUSE_LABEL, FIELD_CLASS,
  type ObdHealthState, type FieldHealth,
} from '../../../platform/obd/obdHealthModel';

const TONE: Readonly<Record<ObdHealthState, string>> = {
  HEALTHY:      'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DEGRADED:     'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  STALLED:      'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  DISCONNECTED: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  speed: 'Hız', rpm: 'Motor devri', engineTemp: 'Soğutma sıvısı',
  fuelLevel: 'Yakıt seviyesi', throttle: 'Gaz kelebeği', intakeTemp: 'Emme havası',
  boostPressure: 'Manifold basıncı', voltage: 'Adaptör voltajı',
};

/** `null` → `—`. SAHTE 0 YOK: "0 ms" ile "hiç ölçülmedi" farklı gerçeklerdir. */
function dur(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const s = ms / 1_000;
  return s < 60 ? `${s.toFixed(1)} sn` : `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn`;
}

function Chip({ state, children }: { state: ObdHealthState; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[state]}`}>
      {children}
    </span>
  );
}

const FieldRow = memo(function FieldRow({ f }: { f: FieldHealth }) {
  return (
    <tr className="border-t border-[var(--oem-line)] align-top"
      data-testid={`oh-field-${f.field}`} data-state={f.state} data-cause={f.cause}>
      <td className="py-1 pr-2 text-[var(--oem-ink-2)]">
        {FIELD_LABEL[f.field] ?? f.field}
        <span className="ml-1 text-[9px] text-[var(--oem-ink-3)]">{FIELD_CLASS[f.field]}</span>
      </td>
      <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-1)]">{dur(f.ageMs)}</td>
      <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-3)]">{dur(f.observedIntervalMs)}</td>
      <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-3)]">{dur(f.stallMs)}</td>
      <td className="py-1 pr-2 text-[var(--oem-ink-3)]">
        {HEALTH_CAUSE_LABEL[f.cause]}
        {f.frozen && (
          <span className="ml-1 text-[9px] text-[var(--oem-warn)]">
            · değer {dur(f.unchangedMs)} değişmedi (gözlem — arıza DEĞİL)
          </span>
        )}
      </td>
      <td className="py-1 text-right"><Chip state={f.state}>{f.state}</Chip></td>
    </tr>
  );
});

export default function ObdSignalHealthScreen() {
  const mountedRef = useRef(true);
  const [snap, setSnap] = useState(() => {
    try { return getObdSignalHealth(); } catch { return null; }
  });
  const [readAt, setReadAt] = useState(() => Date.now());

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    try { setSnap(getObdSignalHealth()); } catch { setSnap(null); }
    setReadAt(Date.now());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const link = snap?.link;

  /* ── P0-OBD-07 · KOPMA DEFTERİYLE GÖZLEMSEL İLİŞKİ ──────────────────────
   * Defter AYRI BİR OTORİTEDİR ve öyle kalır: sağlık hükmünü DEĞİŞTİRMEZ,
   * hüküm de deftere yazmaz. Burada yalnız YAN YANA gösterilirler — "hat
   * neden durdu" sorusunun cevabı çoğu zaman son kopmanın imzasındadır ve
   * iki ekran arasında gidip gelmek o bağı gizliyordu. */
  const ledger = (() => {
    try { return getLinkLossLedger(); } catch { return null; }
  })();
  const lastLoss = ledger?.records.length ? ledger.records[ledger.records.length - 1] : null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="obd-signal-health">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Activity size={12} /> OBD SİNYAL SAĞLIĞI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT-OKUNUR — sorgu göndermez
          </span>
          <button type="button" data-testid="oh-refresh" onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)]">
            <RefreshCw size={11} /> YENİLE
          </button>
          <Chip state={link?.state ?? 'DISCONNECTED'} data-testid="oh-link">
            {link?.state ?? 'OKUNAMADI'}
          </Chip>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          <b>Bluetooth bağlı = sağlıklı DEĞİLDİR</b> ve <b>ELM cevap veriyor = veri
          sağlıklı DEĞİLDİR.</b> Hüküm veri AKIŞINDAN türer. <b>STALL</b> (yenileme
          gelmiyor) bir arızadır; <b>FREEZE</b> (ölçüm geliyor ama değer sabit) tek
          başına arıza DEĞİLDİR — park hâlinde hız ve devir sabittir. Sıcak sinyaller
          (hız/devir sınıfı) saniyeler içinde, yavaş sinyaller kendi kadanslarına göre
          değerlendirilir. Tüm ölçümler MEVCUT poll akışından türetilir; bu ekran
          ELM327'ye tek bir ek sorgu göndermez.
        </p>
        {link && (
          <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-2)]">{link.reason}</p>
        )}
        {link && (
          <p className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
            {link.healthy} sağlıklı · {link.degraded} zayıf · {link.stalled} durdu
            {link.hotStalled > 0 && <> ({link.hotStalled} sıcak)</>} ·
            {' '}beklenen periyot {dur(snap?.expectedIntervalMs ?? null)} ·
            {' '}oturum #{snap?.epoch ?? '—'} · okuma {new Date(readAt).toLocaleTimeString('tr-TR')}
          </p>
        )}
      </div>

      <div className="shrink-0 overflow-x-auto rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <table className="w-full min-w-[520px] border-collapse text-[10px]">
          <thead>
            <tr className="text-left text-[var(--oem-ink-3)]">
              <th className="px-2 py-1 font-medium">Sinyal</th>
              <th className="px-2 py-1 font-medium text-right">Yaş</th>
              <th className="px-2 py-1 font-medium text-right">Gözlenen aralık</th>
              <th className="px-2 py-1 font-medium text-right">Stall eşiği</th>
              <th className="px-2 py-1 font-medium">Neden</th>
              <th className="px-2 py-1 font-medium text-right">Durum</th>
            </tr>
          </thead>
          <tbody>
            {(snap?.fields ?? []).map((f) => <FieldRow key={f.field} f={f} />)}
          </tbody>
        </table>
      </div>

      {ledger !== null && (
        <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2"
          data-testid="oh-linkloss">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--oem-ink-2)]">
            SON KOPMA İMZASI (ayrı defter — hüküm ÜRETMEZ)
          </div>
          <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
            Bu bölüm <b>gözlemseldir</b>: kopma defteri sağlık hükmünü DEĞİŞTİRMEZ,
            sağlık hükmü de deftere YAZMAZ. Yan yana durmalarının tek sebebi,
            “hat neden durdu” sorusunun cevabının çoğu zaman son kopmanın
            imzasında olmasıdır.
          </p>
          <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-2)]">
            {lastLoss === null
              ? 'Bu oturumda kayıtlı kopma YOK.'
              : `Aday: ${LINK_LOSS_CANDIDATE_LABEL[lastLoss.refinedCandidate] ?? lastLoss.refinedCandidate}`
                + ` · tetik: ${lastLoss.trigger}`
                + ` · kurtarma: ${lastLoss.recoveryMs === null ? 'ÖLÇÜLEMEDİ' : `${Math.round(lastLoss.recoveryMs / 1000)} sn`}`}
          </p>
          <p className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
            Toplam kayıt: {ledger.records.length}
          </p>
        </div>
      )}

      <p className="px-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        “Gözlenen aralık” komutun gidiş-dönüş süresi DEĞİLDİR: verinin bize hangi
        sıklıkla ULAŞTIĞINI ölçer. Çekirdek poll döngüsünde round-trip ölçülmez —
        ölçmek sıcak yola dokunmak olurdu. Genişletilmiş PID'lerin gerçek gidiş-dönüş
        süresi ayrı bir kanıt defterindedir (Kanıt Görüntüleyici → ExtendedPollEvidence).
      </p>
    </div>
  );
}
