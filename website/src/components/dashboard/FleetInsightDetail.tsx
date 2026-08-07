'use client';

/**
 * FleetInsightDetail — Fleet Intelligence içgörü detayı + KANIT ZİNCİRİ.
 *
 * ── NE YAPMAZ ──────────────────────────────────────────────────────────
 * İçgörü HESAPLAMAZ · güven ÜRETMEZ · kanıt YAZMAZ. Yalnız migration 054'ün
 * ürettiği kayıtları ve `ai_evidence_chain` üzerinden GERÇEK bağları okur.
 * Kanıtı olmayan içgörü için **sahte zincir üretilmez**.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Ham UUID / VIN / konum EKRANA BASILMAZ — yalnız kısaltılmış referans.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readFleetInsights, readFleetInsightChain,
  type FleetInsightRow, type FleetInsightChainRow,
} from '@/lib/lab/intelligenceLabSource';

export interface FleetInsightDetailProps {
  readonly userId: string | null;
}

/** Kısaltılmış referans — TAM kimlik ASLA gösterilmez. */
function shortRef(prefix: string, id: string | null | undefined): string {
  if (typeof id !== 'string' || id === '') return '—';
  return `${prefix}:${id.slice(0, 8)}`;
}

function stateTone(s: string | null | undefined): string {
  if (s === 'ACTIVE')   return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (s === 'EXPIRED' || s === 'SUPERSEDED' || s === 'RETRACTED')
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-white/10 bg-white/5 text-white/60';
}

export function FleetInsightDetail({ userId }: FleetInsightDetailProps) {
  const [rows, setRows] = useState<readonly FleetInsightRow[] | null>(null);
  const [readable, setReadable] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chain, setChain] = useState<readonly FleetInsightChainRow[] | null>(null);
  const [chainReadable, setChainReadable] = useState<boolean | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const r = await readFleetInsights(userId);
      if (!alive.current) return;
      setRows(r.rows);
      setReadable(r.readable);
    })();
    return () => { alive.current = false; };
  }, [userId]);

  const toggle = useCallback(async (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    setChain(null);
    setChainReadable(null);
    if (next === null) return;
    const c = await readFleetInsightChain(userId, next);
    if (!alive.current) return;
    setChain(c.rows);
    setChainReadable(c.readable);
  }, [openId, userId]);

  if (readable === null) return <p className="text-sm text-white/40">Okunuyor…</p>;
  if (!readable) {
    return (
      <p className="text-sm text-amber-300/80">
        İçgörüler OKUNAMADI — bu &quot;içgörü yok&quot; demek değildir.
        Oturum veya yetki eksik olabilir.
      </p>
    );
  }
  if (rows === null || rows.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-white/40">
        Henüz içgörü üretilmedi. Bu <b>&quot;filo sağlıklı&quot; demek değildir</b> —
        içgörü yalnız yeterli kanıt biriktiğinde oluşur.
      </p>
    );
  }

  const source   = (chain ?? []).filter((c) => c.direction === 'SOURCE');
  const consumer = (chain ?? []).filter((c) => c.direction === 'CONSUMER');

  return (
    <div className="flex flex-col gap-2" data-testid="fleet-insight-detail">
      {rows.map((i) => {
        const id = typeof i.insight_id === 'string' ? i.insight_id : '';
        const open = openId === id && id !== '';
        return (
          <div key={id || Math.random()} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
                {i.type ?? 'UNKNOWN'}
              </span>
              <span className={`rounded border px-2 py-0.5 text-[11px] ${stateTone(i.state)}`}>
                {i.state ?? 'UNKNOWN'}
              </span>
              <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                güven {i.confidence ?? 'UNKNOWN'}
              </span>
              {/* SINIRI GİZLEME: tek araçtan çıkan gözlem "filo içgörüsü" sanılmasın. */}
              {i.unknown_reason === 'SINGLE_VEHICLE_ONLY' && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                  YALNIZ TEK ARAÇ
                </span>
              )}
              {i.unknown_reason && i.unknown_reason !== 'SINGLE_VEHICLE_ONLY' && (
                <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/50">
                  {i.unknown_reason}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-white/40">
              <span>kanıt {i.evidence_count ?? 0}</span>
              <span>araç {i.vehicle_count ?? 0}</span>
              <span>sürücü {i.driver_count ?? 0}</span>
              <span>yolculuk {i.trip_count ?? 0}</span>
              <span>ölçülen {i.measured_count ?? 0}</span>
              <span>{shortRef(String(i.subject_kind ?? 'sub').toLowerCase(), i.subject_id)}</span>
              <span>r{i.revision ?? 0}</span>
            </div>

            <button
              type="button"
              data-testid={`insight-chain-toggle-${id}`}
              aria-expanded={open}
              disabled={id === ''}
              onClick={() => void toggle(id)}
              className="mt-2 rounded border border-sky-400/25 px-2 py-0.5 text-[11px] text-sky-300/80 disabled:opacity-40"
            >
              {open ? 'Kanıt zincirini gizle' : 'Kanıt zinciri'}
            </button>

            {open && (
              <div className="mt-2 flex flex-col gap-2" data-testid="insight-chain-panel">
                {chainReadable === null ? (
                  <p className="text-[11px] text-white/40">Zincir okunuyor…</p>
                ) : !chainReadable ? (
                  <p className="text-[11px] text-amber-300/80">
                    Zincir OKUNAMADI — bu &quot;kanıt yok&quot; demek değildir.
                  </p>
                ) : (chain ?? []).length === 0 ? (
                  <p className="text-[11px] text-white/40">
                    Bu içgörüye bağlı kanıt kaydı yok — zincir <b>uydurulmaz</b>.
                  </p>
                ) : (
                  <>
                    <ChainBlock title="Bu içgörüyü besleyen kanıtlar" rows={source} />
                    <ChainBlock title="Bu içgörünün beslediği çıktılar" rows={consumer} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChainBlock({ title, rows }: { title: string; rows: readonly FleetInsightChainRow[] }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-white/30">Kayıt yok.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((c, idx) => (
            <div key={`${c.evidence_id ?? idx}-${c.consumer_id ?? idx}`} className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                {shortRef('ev', c.evidence_id)}
              </span>
              <span className="text-[10px] text-white/45">{c.source ?? '—'}</span>
              <span className="text-[10px] text-white/45">{c.category ?? '—'}</span>
              <span className="font-mono text-[10px] text-white/60">{c.metric ?? '—'}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${stateTone(c.state)}`}>
                {c.state ?? 'UNKNOWN'}
              </span>
              <span className="text-[10px] text-white/35">{c.provenance ?? '—'}</span>
              <span className="text-[10px] text-white/35">güven {c.confidence ?? 'UNKNOWN'}</span>
              {c.consumer && (
                <span className="rounded border border-sky-500/20 bg-sky-500/5 px-1.5 py-0.5 text-[10px] text-sky-300/70">
                  → {c.consumer}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
