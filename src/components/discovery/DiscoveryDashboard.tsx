/**
 * DiscoveryDashboard — araçtan keşfedilen katalog-dışı PID/DID'lerin CANLI görünümü (PR-DISC-3).
 *
 * YALNIZ UI + OKUMA: DiscoveryCaptureService.getObservations() (canlı), exportJson()
 * (mevcut discoveryExport → DiscoveryQueue). Discovery/capture/queue/registry/native
 * mantığına DOKUNMAZ. Liste sanallaştırılmış (1000+ kayıt performanslı). Yeni keşifte
 * ekran otomatik güncellenir (servis aboneliği).
 *
 * Amaç: saha testlerinde toplanan gerçek OBD sinyalleri, kataloga eklenmeden önce
 * güvenle incelensin (filtrele / ara / dışa aktar).
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Radar, Search, Copy, Check, Cpu, Fingerprint } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import { discoveryCaptureService } from '../../platform/obd/discovery';
import { useDiscoveryObservations } from './useDiscoveryObservations';
import {
  vehicleLearningIntegrationService,
  learningBadgesFor,
  type LearningBadge,
  type LearningDiscoveryAnnotation,
} from '../../platform/vehicleLearningIntegrationService';
import {
  computeSummary,
  selectVisible,
  computeVirtualWindow,
  observationBadges,
  type DiscoveryFilter,
  type DiscoveryBadge,
} from './discoveryDashboardModel';

/** Sabit satır yüksekliği (px) — virtualization hesabı için deterministik. */
const ROW_HEIGHT = 104;
/** Liste görünüm penceresi yüksekliği (px). */
const LIST_VIEWPORT = 520;

const FILTERS: readonly { id: DiscoveryFilter; label: string }[] = [
  { id: 'all',       label: 'Tümü' },
  { id: 'pid',       label: 'PID' },
  { id: 'did',       label: 'DID' },
  { id: 'new',       label: 'Yeni' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'known',     label: 'Bilinen' },
  // P2-5 öğrenme filtreleri (salt-okunur)
  { id: 'strong',    label: 'Strong' },
  { id: 'candidate', label: 'Candidate' },
  { id: 'manual',    label: 'Manuel İnceleme' },
  { id: 'conflict',  label: 'Conflict' },
];

const BADGE_CLASS: Record<DiscoveryBadge, string> = {
  NEW:         'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  KNOWN:       'bg-sky-500/15 text-sky-300 border-sky-500/30',
  DUPLICATE:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  UNSUPPORTED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

/** P2-5 öğrenme rozetleri renkleri (salt-okunur görünürlük). */
const LEARNING_BADGE_CLASS: Record<LearningBadge, string> = {
  WEAK:          'bg-white/10 text-white/60 border-white/20',
  CANDIDATE:     'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  STRONG:        'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  MANUAL_REVIEW: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  STALE:         'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  CONFLICT:      'bg-rose-500/20 text-rose-200 border-rose-500/40',
};

/** Discovery record'un öğrenme anahtarı (integration service ile aynı normalizasyon). */
function learningKey(source: string, pidOrDid: string): string {
  const id = (pidOrDid ?? '').toString().trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
  return `${source === 'DID' ? 'DID' : 'PID'}:${id}`;
}

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleTimeString('tr-TR'); } catch { return '—'; }
}

/* ── Özet kartı ───────────────────────────────────────────────────────────── */
const SummaryCard = memo(function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
});

/* ── Ana ekran ────────────────────────────────────────────────────────────── */
export const DiscoveryDashboard = memo(function DiscoveryDashboard() {
  const observations = useDiscoveryObservations();
  const [filter, setFilter] = useState<DiscoveryFilter>('all');
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // P2-5: öğrenme anotasyon haritası (salt-okunur; service içi memoize). Evidence deposu bu
  // katmanda yazılmadığından oturum içinde sabittir → mount'ta bir kez hesaplanır (zero-leak).
  const annotationMap = useMemo<Map<string, LearningDiscoveryAnnotation>>(
    () => vehicleLearningIntegrationService.getAnnotationMap(),
    [],
  );
  const annotationOf = useCallback(
    (o: { record: { discoverySource: string; pidOrDid: string } }): LearningDiscoveryAnnotation | null =>
      annotationMap.get(learningKey(o.record.discoverySource, o.record.pidOrDid)) ?? null,
    [annotationMap],
  );

  const summary = useMemo(() => computeSummary(observations), [observations]);
  const visible = useMemo(() => selectVisible(observations, filter, query, annotationOf), [observations, filter, query, annotationOf]);
  const win = useMemo(
    () => computeVirtualWindow({ scrollTop, rowHeight: ROW_HEIGHT, viewportHeight: LIST_VIEWPORT, itemCount: visible.length }),
    [scrollTop, visible.length],
  );
  const rows = visible.slice(win.startIndex, win.endIndex);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const onExport = useCallback(async () => {
    // Mevcut discoveryExport → DiscoveryQueue içeriği (yeni export sistemi YOK).
    const json = discoveryCaptureService.exportJson();
    try {
      await Clipboard.write({ string: json });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* pano yoksa (web/eski) — fail-soft, sessiz */ }
  }, []);

  const hasAny = observations.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-white">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-emerald-400" />
          <h2 className="text-base font-semibold">Keşif (Discovery)</h2>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={summary.newPid + summary.newDid === 0}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Kopyalandı' : 'Dışa Aktar (JSON)'}
        </button>
      </div>

      {/* Özet kartları */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <SummaryCard label="Yeni PID" value={summary.newPid} />
        <SummaryCard label="Yeni DID" value={summary.newDid} />
        <SummaryCard label="Toplam" value={summary.total} />
        <SummaryCard label="Duplicate" value={summary.duplicate} />
        <SummaryCard label="Registry'de mevcut" value={summary.known} />
        <SummaryCard label="Son keşif" value={formatTime(summary.lastAt)} />
      </div>

      {/* Arama */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ara: 7E0, 242E, 8B, VIN, DPF, Renault, Trafic…"
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/35 focus:border-emerald-500/40 focus:outline-none"
        />
      </div>

      {/* Filtre sekmeleri */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.id
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-white/10 bg-white/5 text-white/60 hover:text-white/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste / Empty state */}
      {!hasAny ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 p-8 text-center">
          <Radar className="h-8 w-8 text-white/25" />
          <p className="text-sm font-medium text-white/70">Henüz yeni PID veya DID keşfedilmedi.</p>
          <p className="text-xs text-white/45">OBD cihazını bağlayın ve Discovery modunu başlatın.</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative overflow-y-auto rounded-xl border border-white/10 bg-black/20"
          style={{ height: LIST_VIEWPORT }}
          data-testid="discovery-list"
        >
          {/* Sanal yükseklik (kaydırma çubuğu doğru olsun) */}
          <div style={{ height: win.totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: win.offsetY, left: 0, right: 0 }}>
              {rows.map((o) => {
                const r = o.record;
                const badges = observationBadges(o);
                const ann = annotationOf(o);
                const learningBadges = learningBadgesFor(ann);
                return (
                  <div
                    key={`${r.discoverySource}-${r.mode}-${r.ecuAddress}-${r.pidOrDid}`}
                    className="border-b border-white/5 px-3 py-2"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {r.discoverySource === 'PID'
                          ? <Cpu className="h-4 w-4 text-sky-300" />
                          : <Fingerprint className="h-4 w-4 text-violet-300" />}
                        <span className="font-mono text-sm font-semibold text-white">{r.pidOrDid}</span>
                        <span className="text-[11px] text-white/40">Mode {r.mode || '—'}</span>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {badges.map((b) => (
                          <span key={b} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${BADGE_CLASS[b]}`}>{b}</span>
                        ))}
                        {learningBadges.map((b) => (
                          <span key={`L-${b}`} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${LEARNING_BADGE_CLASS[b]}`}>{b.replace('_', ' ')}</span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white/55 sm:grid-cols-3">
                      <span>ECU: {r.ecuAddress || '—'}</span>
                      <span>Kaynak: {r.discoverySource}</span>
                      <span>Proto: {r.protocol || '—'}</span>
                      <span className="truncate">İstek: {r.request || '—'}</span>
                      <span className="truncate">Yanıt: {r.rawResponse || '—'}</span>
                      <span className="truncate">Değer: {r.decodedValue !== undefined ? String(r.decodedValue) : '—'}</span>
                      <span>Destek: {r.supported ? 'evet' : 'hayır'}</span>
                      <span className="truncate">Profil: {r.vehicleProfile || '—'}</span>
                      <span className="truncate">FW: {r.firmwareVersion || '—'}</span>
                    </div>
                    {ann && (
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-white/5 pt-1 font-mono text-[10px] text-emerald-200/60 sm:grid-cols-3">
                        <span>Güven: {ann.confidence.toFixed(2)}</span>
                        <span>Decay: {ann.decayedConfidence.toFixed(2)}</span>
                        <span>Araç: {ann.vehicleCount}</span>
                        <span>Gözlem: {ann.observationCount}</span>
                        <span>ECU#: {ann.ecuCount}</span>
                        <span>Statü: {(ann.patternStatus ?? ann.evidenceStatus).toUpperCase()}</span>
                        {ann.conflictReasons.length > 0 && (
                          <span className="col-span-2 truncate text-rose-300/70 sm:col-span-3">Çelişki: {ann.conflictReasons.join(', ')}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hasAny && (
        <div className="text-right text-[11px] text-white/40">
          {visible.length} / {observations.length} kayıt gösteriliyor
        </div>
      )}
    </div>
  );
});
