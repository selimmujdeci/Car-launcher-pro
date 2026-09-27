'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  freshnessLabel,
  type Measurement, type FreshnessState,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import { useCommandTracker } from '@/hooks/useCommandTracker';
import type { CmdPhase, CommandResult } from '@/hooks/useCommandTracker';
import type { CommandType, RoutePayload } from '@/lib/commandService';
import { BODY_CONTROL_VERIFIED, COMMAND_TTL_MINUTES } from '@/lib/commandService';
/* F0.3 · Komut sonucunun kanıt seviyesi — tek eşleme, ikinci otorite değil. */
import { EVIDENCE_TITLE, EVIDENCE_DETAIL } from '@/lib/commandEvidence';
import { Icon } from '@/components/pwa/ui/Icon';
import { IconBadge, StatusPill as MdStatusPill } from '@/components/pwa/ui/primitives';

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

interface Props {
  vehicle:          LiveVehicle | null;
  /** Kullanıcının TÜM eşleştirilmiş araçları — selector listesi için. */
  vehicles:         LiveVehicle[];
  onSelectVehicle:  (id: string) => void;
  onAddVehicle:     () => void;
  /**
   * F3 · GÖMÜLÜ KULLANIM.
   *
   * `embedded` iken kimlik satırı ve telemetri şeridi BASILMAZ: ana ekranda
   * bunların karşılığı zaten var (başlık · sağlık kartı · yakıt kartı) ve
   * ikisini birden göstermek aynı gerçeği iki kez, iki farklı dille anlatırdı.
   * Araç SEÇİCİ kaybolmaz — birden fazla araç varken kimlik satırı seçici
   * olarak çalıştığı için o durumda korunur.
   */
  variant?:         'standalone' | 'embedded';
}

type NavProvider = RoutePayload['provider_intent'];

interface GeoResult {
  lat:          number;
  lng:          number;
  display_name: string;
  short_name:   string;
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */

const SpinIcon = () => (
  <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"
      strokeDasharray="42" strokeDashoffset="14" opacity="0.35"/>
    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const QueueIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 2"/>
    <path d="M11 7v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

/* ── Phase label helper ─────────────────────────────────────────────────────── */

/**
 * F0.3 · Düğme alt metni KANIT SEVİYESİNİ söyler.
 *
 * `'ok'` fazı DB `completed`tir ve "araç komutu yürüttü + taşıma kabul etti"
 * demektir. Eskiden burada **"Onaylandı ✓"** yazıyordu; bu, araçta karşılığı
 * OLMAYAN bir fiziksel doğrulama iddiasıydı (donanım ACK'i yok —
 * bkz. `lib/commandEvidence.ts`). Artık `DELIVERED` seviyesinin dürüst
 * metni kullanılır.
 */
function phaseLabel(phase: CmdPhase, defaultLabel: string, defaultSub: string) {
  if (phase === 'pending')   return { label: 'Gönderiliyor',   sub: 'Bekle...' };
  if (phase === 'queued')    return { label: defaultLabel,      sub: EVIDENCE_TITLE.QUEUED };
  if (phase === 'accepted')  return { label: defaultLabel,      sub: EVIDENCE_TITLE.RECEIVED };
  if (phase === 'executing') return { label: 'Yürütülüyor',    sub: 'Lütfen bekle' };
  if (phase === 'ok')        return { label: defaultLabel,      sub: EVIDENCE_TITLE.DELIVERED };
  if (phase === 'err')       return { label: 'Hata',           sub: 'Tekrar dene' };
  return { label: defaultLabel, sub: defaultSub };
}

/* ── Offline banner ─────────────────────────────────────────────────────────── */

function OfflineBanner({ plate }: { plate: string }) {
  /* Çevrimdışı olmak bir ARIZA değildir (park etmiş araç çoğu zaman
     çevrimdışıdır) → alarm kırmızısı yerine sakin tonal kart; ne olacağı
     tek cümleyle söylenir. Süre kanonik `COMMAND_TTL_MINUTES`ten (N-7). */
  return (
    <div className="md-card-filled flex items-center gap-4 px-4 py-3" role="status">
      <IconBadge name="cloud_off" />
      <div className="flex-1 min-w-0">
        <p className="md-title-s md-on-surface">Araç bağlantısı kesildi</p>
        <p className="md-body-s md-on-surface-variant mt-0.5">
          {plate} · Gönderdiğiniz komutlar {COMMAND_TTL_MINUTES} dakika sırada bekler
        </p>
      </div>
    </div>
  );
}

/* ── Large round button ─────────────────────────────────────────────────────── */

const BigBtn = memo(function BigBtn({
  label, sublabel, color, bgColor, borderColor,
  phase, onClick, onRetry, children,
}: {
  label: string; sublabel: string; color: string;
  bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy   = ['pending', 'accepted', 'executing'].includes(phase);
  const queued = phase === 'queued';
  const isErr  = phase === 'err';
  const { label: l, sub } = phaseLabel(phase, label, sublabel);

  const glow =
    phase === 'ok'  ? `0 0 32px ${mix(color, 33)}, 0 0 12px ${mix(color, 19)} inset` :
    isErr           ? `0 0 20px color-mix(in srgb, var(--md-error) 30%, transparent)` :
                      `0 0 16px ${mix(color, 9)}`;

  return (
    <div className="relative flex flex-col gap-1 w-full">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full aspect-square rounded-3xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70"
        style={{
          background:  isErr ? 'color-mix(in srgb, var(--md-error) 8%, transparent)' : queued ? 'color-mix(in srgb, var(--md-warning) 8%, transparent)' : bgColor,
          border:      `2px solid ${isErr ? 'color-mix(in srgb, var(--md-error) 35%, transparent)' : queued ? 'color-mix(in srgb, var(--md-warning) 30%, transparent)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   glow,
        }}
      >
        <span style={{ color: isErr ? 'var(--md-error)' : queued ? 'var(--md-warning)' : color }}
          className="transition-transform duration-150">
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[11px] font-semibold"
          style={{ color: isErr ? 'var(--md-error)' : queued ? 'var(--md-warning)' : color }}>{l}</span>
        <span className="text-[11px] font-medium"
          style={{ color: `${isErr ? 'var(--md-error)' : queued ? 'var(--md-warning)' : color}70` }}>{sub}</span>
      </button>

      {isErr && onRetry && (
        <button onClick={onRetry}
          className="w-full py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{ background: 'color-mix(in srgb, var(--md-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 25%, transparent)', color: 'var(--md-error)' }}>
          ↺ Tekrar Dene
        </button>
      )}
    </div>
  );
});

/* ── Small button ───────────────────────────────────────────────────────────── */

const SmallBtn = memo(function SmallBtn({
  label, color, bgColor, borderColor, phase, onClick, onRetry, children,
}: {
  label: string; color: string; bgColor: string; borderColor: string;
  phase: CmdPhase; onClick: () => void; onRetry?: () => void;
  children: React.ReactNode;
}) {
  const busy   = ['pending', 'accepted', 'executing'].includes(phase);
  const queued = phase === 'queued';
  const isErr  = phase === 'err';
  const { label: l } = phaseLabel(phase, label, '');

  return (
    <div className="flex-1 flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={busy || queued}
        className="flex flex-col items-center justify-center gap-2 w-full py-4 rounded-2xl transition-all duration-200 select-none active:scale-90 disabled:opacity-70 min-h-[72px]"
        style={{
          background:  isErr ? 'color-mix(in srgb, var(--md-error) 8%, transparent)' : queued ? 'color-mix(in srgb, var(--md-warning) 8%, transparent)' : bgColor,
          border:      `1.5px solid ${isErr ? 'color-mix(in srgb, var(--md-error) 30%, transparent)' : queued ? 'color-mix(in srgb, var(--md-warning) 30%, transparent)' : phase === 'ok' ? color : borderColor}`,
          boxShadow:   phase === 'ok' ? `0 0 18px ${mix(color, 25)}` : 'none',
        }}
      >
        <span style={{ color: isErr ? 'var(--md-error)' : queued ? 'var(--md-warning)' : color }}
          className={busy ? 'animate-pulse' : ''}>
          {busy ? <SpinIcon /> : queued ? <QueueIcon /> : children}
        </span>
        <span className="text-[11px] font-semibold"
          style={{ color: isErr ? 'var(--md-error)' : queued ? 'var(--md-warning)' : color }}>{l}</span>
      </button>

      {isErr && onRetry && (
        <button onClick={onRetry}
          className="w-full py-1 rounded-lg text-[11px] font-semibold transition-all active:scale-95"
          style={{ background: 'color-mix(in srgb, var(--md-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 20%, transparent)', color: 'var(--md-error)' }}>
          ↺ Tekrar
        </button>
      )}
    </div>
  );
});

/* ── Command Toast ──────────────────────────────────────────────────────────── */

/**
 * M3 SNACKBAR — komut sonucu ekranın altında, gezinme çubuğunun üstünde
 * görünür (içerik akışını itmez). Ters yüzey rengi her temada öne çıkar;
 * sonuç türü ikon + metinle söylenir (renk tek başına anlam taşımaz).
 * Metin kanıt dilinden gelir: `DELIVERED` üstünde bir iddia YOK (F0.3).
 */
function CommandToast({ result }: { result: CommandResult }) {
  const kind: 'queued' | 'ok' | 'err' = result.queued ? 'queued' : result.ok ? 'ok' : 'err';
  const title = kind === 'queued' ? 'Sıraya Alındı' : result.label;
  const detail = kind === 'queued' ? EVIDENCE_DETAIL.QUEUED
    : kind === 'ok' ? EVIDENCE_DETAIL.DELIVERED : EVIDENCE_DETAIL.FAILED;
  const icon = kind === 'queued' ? 'schedule' : kind === 'ok' ? 'check_circle' : 'error';
  return (
    <div role="status" aria-live="polite"
      className="md-enter fixed left-4 right-4 z-40 mx-auto max-w-lg flex items-center gap-3 px-4 py-3"
      style={{
        bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--md-inverse-surface)', color: 'var(--md-inverse-on-surface)',
        borderRadius: 'var(--md-shape-xs)', minHeight: 48,
        boxShadow: '0 3px 6px color-mix(in srgb, var(--md-scrim) 20%, transparent)',
      }}>
      <span className="flex-shrink-0" style={{ color: kind === 'err' ? 'var(--md-error-container)' : 'var(--md-inverse-primary)' }}>
        <Icon name={icon} size={20} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="md-body-m font-medium truncate">{title}</p>
        <p className="md-body-s" style={{ opacity: 0.85 }}>{detail}</p>
      </div>
      {kind === 'ok' && result.durationMs > 0 && (
        <span className="md-label-m flex-shrink-0" style={{ opacity: 0.85 }}>
          {result.durationMs < 1000 ? `${result.durationMs} ms` : `${(result.durationMs / 1000).toFixed(1)} sn`}
        </span>
      )}
    </div>
  );
}

/* ── Provider pill ──────────────────────────────────────────────────────────── */

/**
 * Rota nerede açılsın.
 *
 * `caros` İLK ve VARSAYILANDIR: kullanıcı "Araca Gönder" derken aracın kendi
 * navigasyonunu kastediyor. Eskiden bu bir seçenek DEĞİLDİ ve varsayılan
 * `google_maps` olduğu için rota her zaman harici uygulamada açılıyordu.
 */
const PROVIDERS: { id: NavProvider; label: string; color: string }[] = [
  { id: 'caros',       label: 'CarOS Pro',   color: '#22d3ee' },
  { id: 'google_maps', label: 'Google Maps', color: '#4285F4' },
  { id: 'waze',        label: 'Waze',        color: '#33CCFF' },
  { id: 'yandex',      label: 'Yandex',      color: '#FC3F1D' },
];

function ProviderRow({
  selected, onSelect,
}: {
  selected: NavProvider;
  onSelect: (p: NavProvider) => void;
}) {
  /* M3 filtre çipleri; marka rengi yalnız küçük bir nokta olarak kalır
     (marka renkleri beyaz/koyu zeminde metin olarak AA sağlamıyordu). */
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Navigasyon uygulaması">
      {PROVIDERS.map(({ id, label, color }) => {
        const on = selected === id;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(id)}
            className="md-state md-label-l inline-flex items-center gap-2 px-3"
            style={{
              minHeight: 32, borderRadius: 'var(--md-shape-sm)',
              background: on ? 'var(--md-secondary-container)' : 'transparent',
              color: on ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface-variant)',
              border: on ? '1px solid transparent' : '1px solid var(--md-outline)',
            }}
          >
            {on ? <Icon name="check_circle" size={18} />
              : <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Nominatim geocoding ────────────────────────────────────────────────────── */

async function searchNominatim(query: string): Promise<GeoResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'tr,en' } });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    lat: string; lon: string; display_name: string;
  }>;
  return data.map((r) => ({
    lat:          parseFloat(r.lat),
    lng:          parseFloat(r.lon),
    display_name: r.display_name,
    short_name:   r.display_name.split(',').slice(0, 2).join(',').trim(),
  }));
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr,en' } });
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name?.split(',').slice(0, 3).join(',').trim()
      ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/* ── Navigation Panel ───────────────────────────────────────────────────────── */

type NavStep = 'closed' | 'menu' | 'locating' | 'address' | 'confirm';

function NavPanel({
  onSendRoute,
  busy,
}: {
  onSendRoute: (loc: GeoResult, provider: NavProvider) => void;
  busy: boolean;
}) {
  const [step,     setStep]     = useState<NavStep>('closed');
  const [provider, setProvider] = useState<NavProvider>('caros');
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<GeoResult[]>([]);
  const [selected, setSelected] = useState<GeoResult | null>(null);
  const [locErr,   setLocErr]   = useState('');
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef    = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (step !== 'address' || query.trim().length < 3) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchNominatim(query);
      setResults(found);
      setSearching(false);
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [query, step]);

  useEffect(() => {
    if (step === 'address') setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const handleLocate = useCallback(async () => {
    setStep('locating');
    setLocErr('');
    if (!navigator.geolocation) {
      setLocErr('Tarayıcınız konum özelliğini desteklemiyor.');
      setStep('menu');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat  = pos.coords.latitude;
        const lng  = pos.coords.longitude;
        const name = await reverseGeocode(lat, lng);
        setSelected({ lat, lng, display_name: name, short_name: name.split(',').slice(0, 2).join(',').trim() });
        setStep('confirm');
      },
      (err) => {
        setLocErr(err.code === 1 ? 'Konum izni reddedildi.' : 'Konum alınamadı.');
        setStep('menu');
      },
      { timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  const handleSelectResult = useCallback((r: GeoResult) => {
    setSelected(r);
    setQuery('');
    setResults([]);
    setStep('confirm');
  }, []);

  const handleSend = useCallback(() => {
    if (!selected) return;
    onSendRoute(selected, provider);
    setStep('closed');
    setSelected(null);
  }, [selected, provider, onSendRoute]);

  // ── Closed state — nav trigger button ──────────────────────────────────────
  if (step === 'closed') {
    return (
      <button
        onClick={() => setStep('menu')}
        className="md-state md-card-elevated w-full flex items-center justify-between gap-4 px-4 py-4 text-left md-on-surface"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{ borderRadius: 'var(--md-shape-full)', background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z"
                stroke="currentColor" strokeWidth="1.4"/>
              <circle cx="8" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="md-title-m md-on-surface">Navigasyon Gönder</p>
            <p className="md-body-s md-on-surface-variant">Konum veya adres araca ilet</p>
          </div>
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="md-on-surface-variant flex-shrink-0">
          <path d="M9.5 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    );
  }

  // ── Locating ────────────────────────────────────────────────────────────────
  if (step === 'locating') {
    return (
      <div className="md-card-elevated flex items-center justify-center gap-3 py-6" role="status">
        <svg className="animate-spin w-5 h-5" style={{ color: 'var(--md-primary)' }} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" opacity="0.3"/>
          <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <span className="md-body-m md-on-surface">GPS konumu alınıyor…</span>
      </div>
    );
  }

  // ── Menu — choose mode ──────────────────────────────────────────────────────
  if (step === 'menu') {
    return (
      <section className="md-card-elevated overflow-hidden" aria-label="Navigasyon gönder">
        <div className="flex items-center justify-between pl-4 pr-1 pt-2">
          <p className="md-title-m md-on-surface">Navigasyon gönder</p>
          <button onClick={() => setStep('closed')} aria-label="Kapat" className="md-icon-btn md-state">
            <Icon name="close" />
          </button>
        </div>

        {locErr && (
          <p className="mx-4 mb-2 md-body-s px-3 py-2"
            style={{ background: 'var(--md-error-container)', color: 'var(--md-on-error-container)', borderRadius: 'var(--md-shape-sm)' }}>
            {locErr}
          </p>
        )}

        <button onClick={() => void handleLocate()} className="md-list-item md-state md-on-surface pb-3">
          <IconBadge name="my_location" tone="primary" />
          <span className="flex-1 min-w-0">
            <span className="block md-body-l md-on-surface">Konumumu Gönder</span>
            <span className="block md-body-m md-on-surface-variant">Telefon GPS konumunu araca ilet</span>
          </span>
          <Icon name="chevron_right" className="md-on-surface-variant flex-shrink-0" />
        </button>
        <button onClick={() => setStep('address')} className="md-list-item md-state md-on-surface pb-3">
          <IconBadge name="search" />
          <span className="flex-1 min-w-0">
            <span className="block md-body-l md-on-surface">Adres Ara</span>
            <span className="block md-body-m md-on-surface-variant">İsim veya adres yazarak seç</span>
          </span>
          <Icon name="chevron_right" className="md-on-surface-variant flex-shrink-0" />
        </button>
      </section>
    );
  }

  // ── Address search ──────────────────────────────────────────────────────────
  if (step === 'address') {
    return (
      <section className="md-card-elevated overflow-hidden" aria-label="Adres ara">
        {/* M3 arama çubuğu: geri + alan + ilerleme */}
        <div className="flex items-center gap-1 m-3 pr-3"
          style={{ background: 'var(--md-surface-container-highest)', borderRadius: 'var(--md-shape-full)', minHeight: 56 }}>
          <button onClick={() => setStep('menu')} aria-label="Geri" className="md-icon-btn md-state flex-shrink-0">
            <Icon name="arrow_back" />
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder="Adres, şehir veya yer adı"
            aria-label="Adres ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent outline-none md-body-l md-on-surface"
          />
          {searching && (
            <svg className="animate-spin w-5 h-5 flex-shrink-0" style={{ color: 'var(--md-primary)' }} viewBox="0 0 20 20" fill="none" aria-label="Aranıyor">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" opacity="0.3"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
        </div>

        {results.length > 0 && (
          <div className="flex flex-col max-h-72 overflow-y-auto pb-2">
            {results.map((r, i) => (
              <button key={i} onClick={() => handleSelectResult(r)} className="md-list-item md-state md-on-surface">
                <span className="md-on-surface-variant flex-shrink-0"><Icon name="location_on" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block md-body-l md-on-surface truncate">{r.short_name}</span>
                  <span className="block md-body-s md-on-surface-variant truncate">{r.display_name}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 3 && !searching && results.length === 0 && (
          <p className="text-center md-body-m md-on-surface-variant pb-5">Sonuç bulunamadı</p>
        )}
      </section>
    );
  }

  // ── Confirm & send ──────────────────────────────────────────────────────────
  if (step === 'confirm' && selected) {
    return (
      <section className="md-card-elevated overflow-hidden p-4 flex flex-col gap-4" aria-label="Rotayı onayla">
        <div className="flex items-start gap-3">
          <button onClick={() => setStep('menu')} aria-label="Geri" className="md-icon-btn md-state flex-shrink-0 -ml-3 -mt-2">
            <Icon name="arrow_back" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="md-label-m md-on-surface-variant">Hedef</p>
            <p className="md-title-m md-on-surface line-clamp-2">{selected.short_name}</p>
            <p className="md-body-s md-on-surface-variant tabular-nums mt-0.5">
              {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
            </p>
          </div>
        </div>

        <div>
          <p className="md-label-m md-on-surface-variant mb-2">Hangi uygulamada açılsın</p>
          <ProviderRow selected={provider} onSelect={setProvider} />
        </div>

        <button onClick={handleSend} disabled={busy} className="md-btn-filled md-state w-full disabled:opacity-50" style={{ minHeight: 48 }}>
          <Icon name="near_me" size={20} />
          {busy ? 'Gönderiliyor…' : 'Araca Gönder'}
        </button>
      </section>
    );
  }

  return null;
}

/* ── Speed Alert Panel ──────────────────────────────────────────────────────── */

const SPEED_PRESETS = [80, 100, 120, 140] as const;
type SpeedPreset = typeof SPEED_PRESETS[number];

const ALERT_KEY = 'caros_speed_alert';

interface SpeedAlertConfig { enabled: boolean; threshold: SpeedPreset }

function loadAlert(): SpeedAlertConfig {
  try {
    const raw = localStorage.getItem(ALERT_KEY);
    return raw ? (JSON.parse(raw) as SpeedAlertConfig) : { enabled: false, threshold: 120 };
  } catch { return { enabled: false, threshold: 120 }; }
}

function SpeedAlertPanel({ vehicleId }: { vehicleId: string | null }) {
  const [cfg,      setCfg]      = useState<SpeedAlertConfig>(loadAlert);
  const [open,     setOpen]     = useState(false);
  const [saving,   setSaving]   = useState(false);
  /** Araç komutu gerçekten UYGULADI (`completed`) — gönderim onayı DEĞİL. */
  const [saved,    setSaved]    = useState(false);
  /** Araca ulaştı ama henüz uygulamadı ya da çevrimdışı → ayar YÜRÜRLÜKTE DEĞİL. */
  const [queued,   setQueued]   = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const unsubRef                = useRef<(() => void) | null>(null);

  useEffect(() => () => { unsubRef.current?.(); }, []);

  /* ÖNCEDEN: `sendCommand`in sonucu HİÇ okunmuyordu (`catch {}` + koşulsuz
     "Kaydedildi ✓"). Ayar araca ulaşmasa bile — ki `set_speed_alert` DB
     CHECK'inde olmadığı için hiç ulaşmıyordu — kullanıcı uyarının açık
     olduğunu sanıyordu. Artık telefonun yerel kopyası ile ARACIN durumu
     ayrı ayrı raporlanır. */
  const handleSave = useCallback(async (next: SpeedAlertConfig) => {
    if (!vehicleId) return;
    setSaving(true);
    setSaved(false);
    setQueued(false);
    setSaveErr('');

    // Yerel kopya: ekranın kendi durumu (aracın durumu DEĞİL).
    try { localStorage.setItem(ALERT_KEY, JSON.stringify(next)); } catch { /* kota */ }

    try {
      const { sendCommand, subscribeCommandStatus } = await import('@/lib/commandService');
      const res = await sendCommand(vehicleId, 'set_speed_alert', {
        speed_alert: { enabled: next.enabled, threshold_kmh: next.threshold },
      });
      setSaving(false);

      if (!res.ok) { setSaveErr(res.error ?? 'Ayar araca gönderilemedi.'); return; }

      /* `ok` YALNIZCA "komut kaydedildi" demektir — araç henüz uygulamadı.
         "Araçta ✓" ancak aracın `completed` yazmasıyla söylenebilir; aksi
         halde çevrimdışı bir araçta uyarı açık sanılır. */
      setQueued(true);
      if (!res.commandId) return;

      unsubRef.current?.();
      unsubRef.current = subscribeCommandStatus(res.commandId, (ev) => {
        if (ev.status === 'completed') {
          setQueued(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 3_000);
        } else if (['failed', 'rejected'].includes(ev.status)) {
          setQueued(false);
          setSaveErr('Araç ayarı kabul etmedi.');
        } else if (ev.status === 'expired') {
          setQueued(false);
          setSaveErr('Araç yanıt vermedi — ayar uygulanmadı.');
        }
      });
    } catch {
      setSaving(false);
      setSaveErr('Ayar araca gönderilemedi.');
    }
  }, [vehicleId]);

  const update = useCallback((patch: Partial<SpeedAlertConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    void handleSave(next);
  }, [cfg, handleSave]);

  return (
    <section className="md-card-elevated overflow-hidden" aria-label="Hız uyarısı">
      {/* Başlık satırı: genişletme alanı ve anahtar AYRI denetimlerdir
          (iç içe etkileşimli öğe yok → klavye/ekran okuyucu erişilebilir). */}
      <div className="flex items-center gap-2 pr-3">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="md-state flex-1 min-w-0 flex items-center gap-4 pl-4 pr-2 py-4 text-left md-on-surface"
        >
          <IconBadge name="speed" tone={cfg.enabled ? 'primary' : 'neutral'} />
          <span className="flex-1 min-w-0">
            <span className="block md-title-m md-on-surface">Hız uyarısı</span>
            <span className="block md-body-s md-on-surface-variant">
              {cfg.enabled ? `${cfg.threshold} km/sa üzerinde uyarır` : 'Kapalı'}
            </span>
          </span>
          <Icon name="expand_more" className="md-on-surface-variant flex-shrink-0"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--md-dur-short) var(--md-ease-standard)' }} />
        </button>
        <button
          role="switch"
          aria-checked={cfg.enabled}
          aria-label="Hız uyarısı"
          onClick={() => update({ enabled: !cfg.enabled })}
          className="relative flex-shrink-0"
          style={{ width: 52, height: 32, borderRadius: 16,
            background: cfg.enabled ? 'var(--md-primary)' : 'var(--md-surface-container-highest)',
            border: cfg.enabled ? 'none' : '2px solid var(--md-outline)' }}
        >
          <span className="absolute top-1/2 -translate-y-1/2" style={{
            left: cfg.enabled ? 24 : 6, width: cfg.enabled ? 24 : 16, height: cfg.enabled ? 24 : 16,
            borderRadius: '50%', transition: 'all var(--md-dur-short) var(--md-ease-standard)',
            background: cfg.enabled ? 'var(--md-on-primary)' : 'var(--md-outline)' }} />
        </button>
      </div>

      {/* Üç ayrı gerçek: araçta UYGULANDI · sıraya alındı · gönderilemedi. */}
      {(saved || queued || saveErr || saving) && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 -mt-1">
          {saving && <MdStatusPill icon="sync">Gönderiliyor</MdStatusPill>}
          {saved && <MdStatusPill tone="success" icon="check_circle">Araçta uygulandı</MdStatusPill>}
          {queued && <MdStatusPill tone="warning" icon="schedule">Sırada — araç henüz uygulamadı</MdStatusPill>}
          {saveErr && <MdStatusPill tone="error" icon="error">Gönderilemedi</MdStatusPill>}
        </div>
      )}

      {/* Eşik seçimi — M3 filtre çipleri */}
      {open && (
        <div className="px-4 pb-4">
          <p className="md-label-m md-on-surface-variant mb-2">Uyarı eşiği</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Uyarı eşiği">
            {SPEED_PRESETS.map((spd) => {
              const on = cfg.enabled && cfg.threshold === spd;
              return (
                <button
                  key={spd}
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ threshold: spd, enabled: true })}
                  className="md-state md-label-l inline-flex items-center gap-1.5 px-3"
                  style={{
                    minHeight: 32, borderRadius: 'var(--md-shape-sm)',
                    background: on ? 'var(--md-secondary-container)' : 'transparent',
                    color: on ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface-variant)',
                    border: on ? '1px solid transparent' : '1px solid var(--md-outline)',
                  }}
                >
                  {on && <Icon name="check_circle" size={18} />}
                  {spd} km/sa
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Telemetri kutusu ───────────────────────────────────────────────────────
 *
 * ÖLÇÜLEN KUSUR (2026-08-14): bu şerit ham `vehicle.speed/fuel/engineTemp`
 * sayılarını basıyordu. Sonuç sahada görüldü: araç OFFLINE, kartta "Araç
 * bağlantısı kesildi" yazıyor ve HEMEN ALTINDA **HIZ 22 km/h yeşil · YAKIT 0 ·
 * MOTOR 0** görünüyordu. İkisi de yalandı — 22 bayat bir ölçüm, iki sıfır ise
 * hiç ölçülmemiş alanların varsayılanıydı (**sahte 0**).
 *
 * `vehicleStore` bunu zaten biliyordu: her sinyal `telemetry` katmanında
 * `Measurement` (değer + hüküm + yaş + kaynak) taşır ve store'un kendi yorumu
 * "gerçek katmanı bunu ETİKETLER" der — tüketici o etiketi hiç okumuyordu.
 * Artık okunur; katman yoksa (eski kayıt) ham sayıya düşülür ama **hükümsüz**
 * gösterilir, canlı iddia edilmez.
 */

type Tint = (v: number) => string;

const speedTint: Tint = (v) => (v > 90 ? 'var(--md-error)' : v > 60 ? 'var(--md-warning)' : 'var(--md-success)');
const fuelTint:  Tint = (v) => (v < 15 ? 'var(--md-error)' : v < 30 ? 'var(--md-warning)' : 'var(--md-primary)');
const tempTint:  Tint = (v) => (v > 100 ? 'var(--md-error)' : v > 85 ? 'var(--md-warning)' : 'var(--md-success)');

/** Bilinmeyen/bayat veri için nötr renk — yeşil "iyi" anlamına gelir, hak edilmeden verilmez. */
const UNKNOWN_TINT = 'var(--pwa-text-3)';

const TelemetryTile = memo(function TelemetryTile({
  label, unit, m, fallback, tint,
}: {
  label: string;
  unit: string;
  m: Measurement | undefined;
  /** Tazelik katmanı yokken (eski kayıt) ham sayı — HÜKÜMSÜZ gösterilir. */
  fallback: number;
  tint: Tint;
}) {
  // Katman varsa TEK otorite odur; yoksa ham sayı "durumu bilinmeyen" sayılır.
  const value: number | null = m ? m.value : (Number.isFinite(fallback) ? fallback : null);
  const state: FreshnessState | null = m ? m.state : null;

  const isLive  = state === 'LIVE';
  const known   = value !== null;
  const color   = known && isLive ? tint(value) : UNKNOWN_TINT;

  // Durum notu: canlı veride yer kaplamaz, canlı OLMAYANDA zorunludur.
  const note =
    !known                    ? (state ? freshnessLabel(state) : 'Veri yok')
    : isLive                  ? unit
    : state === 'STALE'       ? 'eski veri'
    : state === 'OFFLINE'     ? 'çevrimdışı'
    : state === 'NEVER_SEEN'  ? 'veri yok'
    : state === 'UNKNOWN'     ? 'okunamadı'
    :                           'doğrulanmadı';   // katman yok → hüküm verilemez

  return (
    <div className="flex flex-col items-center py-3 rounded-xl"
      style={{
        background: known && isLive ? `${mix(color, 4)}` : 'var(--pwa-surface-3)',
        border:     `1px solid ${known && isLive ? `${mix(color, 13)}` : 'var(--pwa-border-soft)'}`,
      }}>
      <span className="text-[11px] font-semibold pwa-text-3 mb-1">{label}</span>
      {/* Bilinmeyen değer 0 diye BASILMAZ — em-dash bir sayı iddiası değildir. */}
      <span className="text-lg font-semibold tabular-nums leading-none" style={{ color }}>
        {known ? Math.round(value) : '—'}
      </span>
      <span className="text-[11px] mt-0.5 text-center leading-tight"
        style={{ color: known && isLive ? color : 'var(--pwa-text-3)' }}>
        {known && !isLive ? `${unit} · ${note}` : note}
      </span>
    </div>
  );
});

/* ── Vehicle selector (bottom sheet) ────────────────────────────────────────── */

function StatusPill({ status }: { status: LiveVehicle['status'] }) {
  const online = status !== 'offline';
  const color  = status === 'alarm' ? 'var(--md-error)' : online ? 'var(--md-success)' : 'var(--pwa-text-3)';
  const bg     = status === 'alarm' ? 'color-mix(in srgb, var(--md-error) 10%, transparent)' : online ? 'color-mix(in srgb, var(--md-success) 10%, transparent)' : 'var(--pwa-surface)';
  const border = status === 'alarm' ? 'color-mix(in srgb, var(--md-error) 25%, transparent)' : online ? 'color-mix(in srgb, var(--md-success) 25%, transparent)' : 'var(--pwa-border)';
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
      style={{ color, background: bg, border: `1px solid ${border}` }}>
      {status === 'online' ? 'Online' : status === 'alarm' ? 'Alarm' : 'Offline'}
    </span>
  );
}

function VehicleSelectorSheet({
  vehicles, activeId, onSelect, onAdd, onClose,
}: {
  vehicles: LiveVehicle[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd:    () => void;
  onClose:  () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0"
        style={{ background: 'var(--md-surface-container-high)' }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md rounded-t-3xl p-4 pb-safe"
        style={{
          background: 'linear-gradient(180deg, var(--pwa-card-a) 0%, var(--pwa-card-b) 100%)',
          border: '1px solid var(--pwa-border)',
          boxShadow: '0 -20px 60px var(--md-surface-container-high)',
          animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--pwa-border)' }} />

        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-[11px] font-semibold pwa-text-3">Araçlarım</p>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg"
            style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="var(--pwa-text-3)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
          {vehicles.map((v) => {
            const active = v.id === activeId;
            return (
              <button
                key={v.id}
                onClick={() => onSelect(v.id)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                style={{
                  background: active ? 'color-mix(in srgb, var(--md-primary) 10%, transparent)' : 'var(--pwa-surface-3)',
                  border: `1.5px solid ${active ? 'color-mix(in srgb, var(--md-primary) 40%, transparent)' : 'var(--pwa-border-soft)'}`,
                }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: active ? 'var(--md-primary)' : 'transparent',
                    border: active ? 'none' : '1.5px solid var(--pwa-border)',
                  }}
                >
                  {active && (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M2 5.5l2.2 2.2L9 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold pwa-text text-sm">{v.plate}</p>
                  <p className="text-xs pwa-text-3 truncate">
                    {v.name}{v.driver && v.driver !== '—' ? ` · ${v.driver}` : ''}
                  </p>
                </div>
                <StatusPill status={v.status} />
              </button>
            );
          })}
        </div>

        <button
          onClick={onAdd}
          className="w-full mt-3 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{ background: 'color-mix(in srgb, var(--md-primary) 8%, transparent)', border: '1.5px dashed color-mix(in srgb, var(--md-primary) 30%, transparent)', color: 'var(--md-primary)' }}
        >
          + Araç Ekle
        </button>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */

export default function MobileCarControl({
  vehicle, vehicles, onSelectVehicle, onAddVehicle, variant = 'standalone',
}: Props) {
  const { phases, result, dispatch, retry } = useCommandTracker(vehicle?.id ?? null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    onSelectVehicle(id);
    setSelectorOpen(false);
  }, [onSelectVehicle]);

  const handleAdd = useCallback(() => {
    setSelectorOpen(false);
    onAddVehicle();
  }, [onAddVehicle]);

  const handleSendRoute = useCallback(
    (loc: GeoResult, provider: NavProvider) => {
      void dispatch('route_send', {
        route: {
          lat:             loc.lat,
          lng:             loc.lng,
          address_name:    loc.short_name,
          provider_intent: provider,
        },
      });
    },
    [dispatch],
  );

  const navBusy = ['pending', 'accepted', 'executing'].includes(phases.route_send ?? 'idle');

  if (!vehicle) {
    // Birden fazla eşleştirilmiş araç var ama hiçbiri aktif değil (belirsiz) —
    // veya hiç araç yok. Komut FAIL CLOSED kalır; kullanıcı açıkça seçmeli.
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-16 h-16 rounded-3xl pwa-surface border border-white/[0.07] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M4 18L8 10Q9.5 7 12 7H16Q18.5 7 20 10L24 18V22Q24 24 22 24H6Q4 24 4 22Z"
              stroke="var(--pwa-text-3)" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-sm pwa-text-3">Araç seçilmedi</p>
        {vehicles.length > 1 && (
          <button
            onClick={() => setSelectorOpen(true)}
            className="mt-1 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
            style={{ background: 'color-mix(in srgb, var(--md-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-primary) 30%, transparent)', color: 'var(--md-primary)' }}
          >
            {vehicles.length} araçtan birini seç →
          </button>
        )}
        {selectorOpen && (
          <VehicleSelectorSheet
            vehicles={vehicles}
            activeId={null}
            onSelect={handleSelect}
            onAdd={handleAdd}
            onClose={() => setSelectorOpen(false)}
          />
        )}
      </div>
    );
  }

  const isOnline = vehicle.status !== 'offline';

  return (
    <div className={`flex flex-col ${variant === 'embedded' ? 'gap-3' : 'gap-4 px-1'}`}>

      {/* Vehicle identity — birden fazla araç varsa dokunulabilir selector.
          Gömülü kullanımda TEK araç varken bu satır yalnız bir TEKRAR olurdu
          (düğme zaten devre dışı ve plakayı ana başlık söylüyor). */}
      <button
        onClick={() => vehicles.length > 1 && setSelectorOpen(true)}
        disabled={vehicles.length <= 1}
        className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.99] disabled:active:scale-100"
        style={{
          background: 'var(--pwa-surface-3)',
          border: '1px solid var(--pwa-border-soft)',
          /* Satır içi `display` sınıfı EZER — `hidden` özniteliği Tailwind'in
             `.flex` kuralına yenik düşerdi. */
          ...(variant === 'embedded' && vehicles.length <= 1 ? { display: 'none' } : {}),
        }}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          vehicle.status === 'online' ? 'bg-emerald-400 neon-online' :
          vehicle.status === 'alarm'  ? 'bg-red-400 neon-alarm animate-pulse' : 'bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold pwa-text text-sm">{vehicle.plate}</p>
          <p className="text-xs pwa-text-3 truncate">{vehicle.name} · {vehicle.driver}</p>
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
          style={{
            color:      isOnline ? 'var(--md-success)' : 'var(--pwa-text-3)',
            background: isOnline ? 'color-mix(in srgb, var(--md-success) 10%, transparent)' : 'var(--pwa-surface)',
            border:     `1px solid ${isOnline ? 'color-mix(in srgb, var(--md-success) 25%, transparent)' : 'var(--pwa-border)'}`,
          }}>
          {vehicle.status === 'online' ? 'Online' : vehicle.status === 'alarm' ? 'Alarm' : 'Offline'}
        </span>
        {vehicles.length > 1 && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
            <path d="M3 4.5l3 3 3-3" stroke="var(--pwa-text-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {selectorOpen && (
        <VehicleSelectorSheet
          vehicles={vehicles}
          activeId={vehicle.id}
          onSelect={handleSelect}
          onAdd={handleAdd}
          onClose={() => setSelectorOpen(false)}
        />
      )}

      {/* Offline banner */}
      {!isOnline && <OfflineBanner plate={vehicle.plate} />}

      {/* Lock / Unlock + Horn / Alarm / Lights — gerçek araçta kanıtlanana kadar gizli */}
      {BODY_CONTROL_VERIFIED && (<>
      <div className="grid grid-cols-2 gap-4">
        <BigBtn
          label="Kilitle" sublabel="Kapat"
          color="var(--md-error)" bgColor="color-mix(in srgb, var(--md-error) 8%, transparent)" borderColor="color-mix(in srgb, var(--md-error) 25%, transparent)"
          phase={phases.lock ?? 'idle'}
          onClick={() => void dispatch('lock')}
          onRetry={() => void retry('lock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="25" r="2.5" fill="currentColor"/>
          </svg>
        </BigBtn>

        <BigBtn
          label="Aç" sublabel="Kilidi Kaldır"
          color="var(--md-success)" bgColor="color-mix(in srgb, var(--md-success) 8%, transparent)" borderColor="color-mix(in srgb, var(--md-success) 25%, transparent)"
          phase={phases.unlock ?? 'idle'}
          onClick={() => void dispatch('unlock')}
          onRetry={() => void retry('unlock')}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="7" y="17" width="22" height="16" rx="4" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M12 17V13a6 6 0 0112 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2"/>
          </svg>
        </BigBtn>
      </div>

      {/* Horn + Alarm + Lights */}
      <div className="flex gap-3">
        <SmallBtn
          label="Korna" color="var(--md-warning)"
          bgColor="color-mix(in srgb, var(--md-warning) 8%, transparent)" borderColor="color-mix(in srgb, var(--md-warning) 22%, transparent)"
          phase={phases.horn ?? 'idle'}
          onClick={() => void dispatch('horn')}
          onRetry={() => void retry('horn')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 9H4a1 1 0 000 2h2m0-2v2m0-2l6-4.5v12L6 13"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 7.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M17.5 5a9.5 9.5 0 010 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Alarm" color="var(--md-tertiary)"
          bgColor="color-mix(in srgb, var(--md-tertiary) 8%, transparent)" borderColor="color-mix(in srgb, var(--md-tertiary) 22%, transparent)"
          phase={phases.alarm_on ?? 'idle'}
          onClick={() => void dispatch('alarm_on')}
          onRetry={() => void retry('alarm_on')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M12 10v4M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </SmallBtn>

        <SmallBtn
          label="Farlar" color="#fde68a"
          bgColor="rgba(253,230,138,0.07)" borderColor="rgba(253,230,138,0.22)"
          phase={phases.lights_on ?? 'idle'}
          onClick={() => void dispatch('lights_on')}
          onRetry={() => void retry('lights_on')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="12" rx="4" ry="4" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
          </svg>
        </SmallBtn>
      </div>
      </>)}

      {/* Navigation panel */}
      <NavPanel onSendRoute={handleSendRoute} busy={navBusy} />

      {/* Speed alert panel */}
      <SpeedAlertPanel vehicleId={vehicle.id} />

      {/* Command toast */}
      {result && <CommandToast result={result} />}

      {/* Telemetry strip — tazelik katmanına bağlı (bkz. TelemetryTile).
          Gömülü kullanımda basılmaz: yakıt ana ekranın kendi kartında, motor
          sıcaklığı sağlık kanıtlarında ZATEN gösteriliyor. */}
      <div
        className="grid grid-cols-3 gap-2"
        style={variant === 'embedded' ? { display: 'none' } : undefined}
      >
        <TelemetryTile label="Hız"   unit="km/h" m={vehicle.telemetry?.speedKmh}    fallback={vehicle.speed}      tint={speedTint} />
        <TelemetryTile label="Yakıt" unit="%"    m={vehicle.telemetry?.fuelPercent} fallback={vehicle.fuel}       tint={fuelTint} />
        <TelemetryTile label="Motor" unit="°C"   m={vehicle.telemetry?.engineTempC} fallback={vehicle.engineTemp} tint={tempTint} />
      </div>
    </div>
  );
}
