'use client';

/**
 * KANIT KONSOLU — temel yüzeyler (#662).
 *
 * Enstrüman paneli dili: keskin köşe (2 px), kıl payı çizgi (1 px), gölge
 * yerine iç ışık. Gradient / glassmorphism / yuvarlak "SaaS kartı" YOK.
 *
 * Saf gösterim: veri çekmez, timer kurmaz.
 */

import type { ReactNode } from 'react';
import {
  agoLabel,
  evidenceLine,
  verdictLabel,
  verdictToken,
  type EvidenceReading,
  type Verdict,
} from '@/lib/console/evidenceModel';

const TOKEN_COLOR: Record<string, string> = {
  verified: 'var(--cn-verified)',
  warning:  'var(--cn-warning)',
  critical: 'var(--cn-critical)',
  unknown:  'var(--cn-unknown)',
  copper:   'var(--cn-copper)',
};

const TOKEN_BG: Record<string, string> = {
  verified: 'var(--cn-verified-bg)',
  warning:  'var(--cn-warning-bg)',
  critical: 'var(--cn-critical-bg)',
  unknown:  'var(--cn-unknown-bg)',
  copper:   'var(--cn-copper-bg)',
};

/* ── Panel ─────────────────────────────────────────────────────────────── */

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return <Tag className={`cn-panel ${className}`}>{children}</Tag>;
}

export function PanelHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hair">
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="cn-eyebrow whitespace-nowrap">{title}</h2>
        {meta && <span className="cn-num text-[10px] text-t3 truncate">{meta}</span>}
      </div>
      {action}
    </header>
  );
}

/* ── Kanıt rozeti ──────────────────────────────────────────────────────── */

export function EvidenceBadge({
  verdict,
  compact = false,
}: {
  verdict: Verdict;
  compact?: boolean;
}) {
  const token = verdictToken(verdict);
  return (
    <span
      className={`inline-flex items-center gap-1.5 cn-num uppercase whitespace-nowrap ${
        compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'
      }`}
      style={{
        color: TOKEN_COLOR[token],
        background: TOKEN_BG[token],
        border: `1px solid ${TOKEN_COLOR[token]}`,
        borderRadius: 2,
        letterSpacing: '0.16em',
      }}
    >
      <span
        aria-hidden
        style={{ width: 5, height: 5, background: TOKEN_COLOR[token], display: 'inline-block' }}
      />
      {verdictLabel(verdict)}
    </span>
  );
}

/** Durum noktası — listelerde renk kodu. Kanıt yoksa içi boş halka. */
export function StatusDot({ verdict, offline = false }: { verdict: Verdict; offline?: boolean }) {
  const token = offline ? 'unknown' : verdictToken(verdict);
  const hollow = verdict === 'NO_EVIDENCE' || offline;
  return (
    <span
      aria-hidden
      style={{
        width: 9,
        height: 9,
        flexShrink: 0,
        borderRadius: '50%',
        background: hollow ? 'transparent' : TOKEN_COLOR[token],
        border: `1.5px solid ${TOKEN_COLOR[token]}`,
        boxShadow: hollow ? 'none' : `0 0 8px ${TOKEN_COLOR[token]}55`,
      }}
    />
  );
}

/* ── Metrik kartı (gösterge kullanılamayan kategorik veri) ─────────────── */

export function MetricCard({
  label,
  value,
  reading,
  footnote,
  children,
}: {
  label: string;
  /** Gösterilecek okuma; `null` iken "KANIT YOK" basılır (sahte 0 YOK). */
  value?: ReactNode;
  reading: EvidenceReading;
  footnote?: string;
  children?: ReactNode;
}) {
  const token = verdictToken(reading.verdict);
  return (
    <article
      className="cn-panel p-4 flex flex-col gap-3"
      style={{ borderColor: TOKEN_COLOR[token] }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="cn-eyebrow">{label}</span>
        <EvidenceBadge verdict={reading.verdict} compact />
      </div>

      <div className="cn-num text-2xl leading-none" style={{ color: TOKEN_COLOR[token] }}>
        {reading.verdict === 'NO_EVIDENCE' ? (
          <span className="text-sm tracking-[0.18em] text-unknown">KANIT YOK</span>
        ) : (
          value
        )}
      </div>

      {children}

      <div className="cn-num text-[10px] text-t3 leading-relaxed">
        {evidenceLine(reading)}
        {footnote && <span className="block text-t3">{footnote}</span>}
      </div>
    </article>
  );
}

/* ── Sayaç kutucuğu (üst şerit) ────────────────────────────────────────── */

export function StatTile({
  label,
  count,
  token = 'unknown',
  active = false,
  onClick,
}: {
  label: string;
  count: number;
  token?: 'verified' | 'warning' | 'critical' | 'unknown' | 'copper';
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={`cn-panel px-4 py-3 text-left w-full transition-colors ${
        onClick ? 'hover:bg-bezel cursor-pointer' : ''
      }`}
      style={{
        borderColor: active ? TOKEN_COLOR[token] : 'var(--cn-line)',
        background: active ? TOKEN_BG[token] : 'var(--cn-bg-panel)',
      }}
    >
      <div className="cn-num text-3xl leading-none" style={{ color: TOKEN_COLOR[token] }}>
        {count}
      </div>
      <div className="cn-eyebrow mt-2">{label}</div>
    </Tag>
  );
}

/* ── Kanıt defteri satırı ──────────────────────────────────────────────── */

export function LedgerRow({
  metric,
  reading,
  unit = '',
  precision = 1,
}: {
  metric: string;
  reading: EvidenceReading;
  unit?: string;
  precision?: number;
}) {
  const token = verdictToken(reading.verdict);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 border-b border-hair-soft last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] text-t1">{metric}</div>
        <div className="cn-num text-[10px] text-t3 mt-0.5">{evidenceLine(reading)}</div>
      </div>
      <div className="text-right">
        <div className="cn-num text-[15px]" style={{ color: TOKEN_COLOR[token] }}>
          {reading.value === null
            ? '—'
            : `${reading.value.toFixed(precision)}${unit ? ` ${unit}` : ''}`}
        </div>
        <div className="mt-1">
          <EvidenceBadge verdict={reading.verdict} compact />
        </div>
      </div>
    </div>
  );
}

/* ── Boş/yükleniyor/hata durumları — hepsi GEREKÇE söyler ──────────────── */

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="cn-num text-[11px] tracking-[0.2em] text-unknown uppercase">{title}</p>
      {detail && <p className="text-[12px] text-t3 mt-2 max-w-sm mx-auto leading-relaxed">{detail}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="px-4 py-4 cn-num text-[11px]"
      style={{ color: 'var(--cn-critical)', background: 'var(--cn-critical-bg)', border: '1px solid var(--cn-critical)' }}
    >
      {message}
    </div>
  );
}

/** Zaman damgası — mono, "X önce" biçiminde. Bilinmiyorsa uydurma YOK. */
export function Ago({ ageMs }: { ageMs: number | null }) {
  return <span className="cn-num text-[10px] text-t3">{agoLabel(ageMs)}</span>;
}

export { TOKEN_COLOR, TOKEN_BG };
