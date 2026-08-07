/**
 * DecoderRegistryScreen — CAROS LAB · Geliştirici · Çözücü Kayıtları (Faz A8).
 *
 * SALT-OKUNUR STATİK KATALOG. Repoda KAYITLI olan standart PID ve üretici DID
 * çözücü tanımlarını listeler.
 *
 * BU EKRAN ARAÇ TARAMA EKRANI DEĞİLDİR: OBD/AT komutu göndermez, ECU sorgulamaz,
 * PID/DID keşfi başlatmaz, bağlantı/polling/reconnect tetiklemez, native köprü
 * çağırmaz, ağ isteği yapmaz. Araçta neyin DESTEKLENDİĞİNİ bilmez ve iddia etmez.
 *
 * ZAMANLAYICI YOK: açılışta tek okuma + elle YENİLE (CAROS LAB deseni).
 * Arama tamamen client-side ve saftır — debounce/timer gerekmez.
 *
 * GİZLİLİK: VIN, araç parmak izi, kullanıcı aracı, anahtar/token, dosya yolu,
 * çalışma-zamanı ECU cevabı ve ÇÖZÜCÜ FONKSİYON GÖVDESİ bu ekrana HİÇ GELMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Binary, Search } from 'lucide-react';
import { readDecoderRegistrySnapshot } from '../../../platform/devtools/decoderRegistrySources';
import {
  buildDecoderRecords, buildDecoderSummary, filterDecoderRecords, collectDecoderFacets,
  DECODER_TYPE_LABEL, DECODER_SUPPORT_LABEL, DECODER_COLLISION_LABEL,
  MAX_DECODER_ROWS_RENDERED,
  type DecoderRegistryRaw, type DecoderRecord, type DecoderKind,
  type DecoderType, type DecoderSupport,
} from '../../../platform/devtools/decoderRegistryModel';

const KIND_STYLE: Record<DecoderKind, string> = {
  PID: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DID: 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
};

const SELECT_CLASS =
  'rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1.5 py-1 ' +
  'font-mono text-[10px] text-[var(--oem-ink-2)]';

/** Sayı ya da "KAYNAK YOK" — `null` asla 0 gibi basılmaz. */
const Count = memo(function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">
      {label}{' '}
      <span className={value === null ? 'text-[var(--oem-warn)]' : 'text-[var(--oem-ink)]'}>
        {value === null ? 'KAYNAK YOK' : value}
      </span>
    </span>
  );
});

const RecordRow = memo(function RecordRow({ rec }: { rec: DecoderRecord }) {
  return (
    <div
      data-testid={`decoder-row-${rec.kind}-${rec.profile ?? 'std'}-${rec.normalizedId}`}
      data-kind={rec.kind}
      data-type={rec.decoderType}
      data-support={rec.supportStatus}
      data-collision={rec.collision}
      className="grid grid-cols-[auto_1fr] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${KIND_STYLE[rec.kind]}`}>
        {rec.kind} {rec.normalizedId}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink)]">{rec.displayName}</span>
          {rec.unit && (
            <span className="font-mono text-[10px] text-[var(--oem-ink-2)]">[{rec.unit}]</span>
          )}
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            servis {rec.service}
          </span>
          {rec.collision !== 'UNIQUE' && (
            <span className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
              {DECODER_COLLISION_LABEL[rec.collision]}
            </span>
          )}
          {rec.supportStatus === 'DROPPED_UNKNOWN_ECU' && (
            <span className="rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
              {DECODER_SUPPORT_LABEL[rec.supportStatus]}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[9px] text-[var(--oem-ink-2)]">
          <span>çözücü: {DECODER_TYPE_LABEL[rec.decoderType]}</span>
          <span>formül: {rec.formulaSummary ?? '—'}</span>
          <span>aralık: {rec.min === null ? '—' : rec.min} … {rec.max === null ? '—' : rec.max}</span>
          <span>bayt: {rec.bytes === null ? '—' : rec.bytes}</span>
          {rec.manufacturer && <span>marka: {rec.manufacturer}</span>}
          {rec.category && <span>kategori: {rec.category}</span>}
          <span>rol: {DECODER_SUPPORT_LABEL[rec.supportStatus]}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{rec.sourceRegistry}</div>
        {rec.notes && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{rec.notes}</div>
        )}
      </div>
    </div>
  );
});

export const DecoderRegistryScreen = memo(function DecoderRegistryScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<DecoderRegistryRaw>(() => readDecoderRegistrySnapshot());

  const [query, setQuery]     = useState('');
  const [kind, setKind]       = useState<DecoderKind | 'ALL'>('ALL');
  const [man, setMan]         = useState<string>('ALL');
  const [unit, setUnit]       = useState<string>('ALL');
  const [dType, setDType]     = useState<DecoderType | 'ALL'>('ALL');
  const [support, setSupport] = useState<DecoderSupport | 'ALL'>('ALL');

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readDecoderRegistrySnapshot());
  }, []);

  const records  = useMemo(() => buildDecoderRecords(snap), [snap]);
  const summary  = useMemo(() => buildDecoderSummary(snap, records), [snap, records]);
  const facets   = useMemo(() => collectDecoderFacets(records), [records]);
  const filtered = useMemo(
    () => filterDecoderRecords(records, {
      query, kind, manufacturer: man, unit, decoderType: dType, supportStatus: support,
    }),
    [records, query, kind, man, unit, dType, support],
  );
  const shown = filtered.length <= MAX_DECODER_ROWS_RENDERED
    ? filtered
    : filtered.slice(0, MAX_DECODER_ROWS_RENDERED);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="decoder-registry">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Binary size={12} /> ÇÖZÜCÜ KAYITLARI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> STATİK KATALOG — araca komut göndermez
          </span>
          <button
            type="button"
            data-testid="decoder-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran repoda KAYITLI çözücü tanımlarının envanteridir. ECU sorgusu, PID/DID
          keşfi, bağlantı, polling veya native çağrı YAPMAZ. Araçta hangi kimliğin
          DESTEKLENDİĞİNİ BİLMEZ — aşağıdaki "rol" alanı yalnız kayıt defterindeki yeri
          anlatır. Çözücü fonksiyon gövdeleri GÖSTERİLMEZ.
        </p>
      </div>

      {/* 1 · Registry özeti */}
      <div
        data-testid="decoder-summary"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Count label="Standart PID" value={summary.pidCount} />
          <Count label="Üretici DID" value={summary.didCount} />
          <Count label="Profil" value={summary.profileCount} />
          <Count label="Marka" value={summary.manufacturerCount} />
          <Count label="Üzerine yazılan" value={summary.overriddenCount} />
          <Count label="Derlemede düşen" value={summary.droppedCount} />
          <Count label="Profiller arası aynı kimlik" value={summary.crossProfileDuplicates} />
          <Count label="Bozuk/atlanan kayıt" value={summary.invalidCount} />
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Her sayının hangi kayıt defterinden geldiği, aşağıdaki satırların "kaynak"
          alanında tam modül yoluyla yazılıdır. Profil DID sayıları saf derleyiciden
          alınır (tanımlı → derlendi). "Profiller arası aynı kimlik" bir ÇAKIŞMA
          DEĞİLDİR: repo aynı anda TEK profil yükler, profiller BİRLEŞTİRİLMEZ.
        </p>
      </div>

      {/* 5 · Arama ve filtre */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--oem-ink-3)]">
            <Search size={11} /> ARA
          </span>
          <input
            data-testid="decoder-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="kimlik · ad · marka · profil · birim"
            className="min-w-[180px] flex-1 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--oem-ink)] placeholder:text-[var(--oem-ink-3)]"
          />
          <select
            data-testid="decoder-filter-kind" value={kind} className={SELECT_CLASS}
            onChange={(e) => setKind(e.target.value as DecoderKind | 'ALL')}
          >
            <option value="ALL">tür: hepsi</option>
            <option value="PID">PID</option>
            <option value="DID">DID</option>
          </select>
          <select
            data-testid="decoder-filter-manufacturer" value={man} className={SELECT_CLASS}
            onChange={(e) => setMan(e.target.value)}
          >
            <option value="ALL">marka: hepsi</option>
            {facets.manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            data-testid="decoder-filter-unit" value={unit} className={SELECT_CLASS}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="ALL">birim: hepsi</option>
            {facets.units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select
            data-testid="decoder-filter-type" value={dType} className={SELECT_CLASS}
            onChange={(e) => setDType(e.target.value as DecoderType | 'ALL')}
          >
            <option value="ALL">çözücü: hepsi</option>
            {facets.types.map((t) => <option key={t} value={t}>{DECODER_TYPE_LABEL[t]}</option>)}
          </select>
          <select
            data-testid="decoder-filter-support" value={support} className={SELECT_CLASS}
            onChange={(e) => setSupport(e.target.value as DecoderSupport | 'ALL')}
          >
            <option value="ALL">rol: hepsi</option>
            {facets.supports.map((s) => <option key={s} value={s}>{DECODER_SUPPORT_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]" data-testid="decoder-result-count">
          {filtered.length} kayıt eşleşti ({records.length} kayıt içinde)
          {filtered.length > shown.length && ` · ilk ${shown.length} satır gösteriliyor`}
        </div>
      </div>

      {/* 3 · Üretici DID profilleri */}
      <div
        data-testid="decoder-profiles"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            Üretici DID Profilleri
          </span>
          {snap.profiles === null && (
            <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
              <AlertTriangle size={10} /> KAYNAK OKUNAMADI
            </span>
          )}
        </div>
        {snap.profiles === null && (
          <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Profil kayıt defteri okunamadı. Boş defter ile OKUNAMADI ayrı şeydir — 0 gösterilmez.
          </div>
        )}
        {snap.profiles !== null && snap.profiles.length === 0 && (
          <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Kayıtlı üretici profili YOK (okuma başarılı).
          </div>
        )}
        {(snap.profiles ?? []).map((p) => (
          <div
            key={p.profileId}
            data-testid={`decoder-profile-${p.profileId}`}
            className="border-b border-[var(--oem-line)] px-3 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-[var(--oem-ink)]">{p.brand || p.profileId}</span>
              <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">({p.profileId})</span>
              <span className="font-mono text-[10px] text-[var(--oem-ink-2)]">
                DID: {p.declaredDids} tanımlı → {p.compiledDids === null ? 'derleme okunamadı' : `${p.compiledDids} derlendi`}
              </span>
              <span className="font-mono text-[10px] text-[var(--oem-ink-2)]">ECU: {p.ecuCount}</span>
              {p.protocols && (
                <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                  protokol: {p.protocols.join(' · ')}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">kaynak: {p.source || '—'}</div>
            {p.note && <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{p.note}</div>}
          </div>
        ))}
      </div>

      {/* 2 + 6 · Kayıt listesi (detay satır içinde, salt-okunur) */}
      <div
        data-testid="decoder-records"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            Çözücü Kayıtları
          </span>
          {snap.pids === null && (
            <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
              <AlertTriangle size={10} /> PID KAYNAĞI OKUNAMADI
            </span>
          )}
          {snap.dids === null && (
            <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
              <AlertTriangle size={10} /> DID KAYNAĞI OKUNAMADI
            </span>
          )}
        </div>
        {shown.length === 0 && (
          <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Eşleşen kayıt yok.
          </div>
        )}
        {shown.map((r) => (
          <RecordRow key={`${r.kind}-${r.profile ?? 'std'}-${r.normalizedId}-${r.displayName}`} rec={r} />
        ))}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        ÇÖZÜCÜ SINIFI DÜRÜSTLÜĞÜ: üretici DID'lerinde çözücü repoda SABİT bir küme olarak
        veriyle tanımlıdır (A · AB · temp40 · pct · linear · div · ascii) → sınıf ve formül
        özeti KESİNDİR. Standart PID'lerde çözücü bir JS kapanışıdır; makine-okunur spec
        YOKTUR ve gövdesi hiçbir yöntemle OKUNMAZ → sınıf ÖZEL, formül özeti "—".
        DERLEME GERÇEĞİ: profil derleyicisi haritayı YALNIZ kimlikle anahtarlar —
        aynı kimlik iki kez tanımlanırsa SON yazan kazanır, ECU referansı çözülemeyen DID
        ise SESSİZCE atlanır. Bu ekran ikisini de gizlemez.
      </p>
    </div>
  );
});
