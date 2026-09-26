/**
 * appStateContext — Mavi'nin beynine UYGULAMANIN o anki durumu (salt okuma).
 *
 * SAHA 2026-09-26: "bu hangi şarkı" diye sorulduğunda parça çalarken bile
 * Gemini "çalan parça algılayamadım" diyordu; rota, varış süresi, sürücü,
 * ses/parlaklık hiç bağlamda yoktu → model uygulamayı "göremiyordu".
 *
 * SINIRLAR:
 *  · Yalnız mevcut sahiplerin snapshot getter'ları okunur; yazma/abonelik YOK.
 *  · Bilinmeyen alan UYDURULMAZ (satır hiç yazılmaz); "0 km" gibi sahte değer yok.
 *  · Ham koordinat, telefon numarası, mesaj içeriği GİRMEZ.
 */
import { getNavigationState, NavStatus } from '../navigationService';
import { getMediaState } from '../mediaService';
import { useStore } from '../../store/useStore';
import { useCarTheme } from '../../store/useCarTheme';

export interface AppStateInput {
  readonly media: { playing: boolean; title: string | null; artist: string | null; source: string | null } | null;
  readonly nav: { status: string; destination: string | null; remainingKm: number | null; etaMin: number | null } | null;
  readonly driverName: string | null;
  readonly volume: number | null;
  readonly brightness: number | null;
  readonly theme: string | null;
}

const SOURCE_TR: Record<string, string> = {
  youtube: 'YouTube', spotify: 'Spotify', radio: 'radyo', local: 'cihaz müziği', stream: 'internet',
};

/** SAF — test edilir. Boş parça listesi → boş metin. */
export function formatAppStateLine(i: AppStateInput): string {
  const parts: string[] = [];
  if (i.media && i.media.title) {
    const who = i.media.artist ? ` — ${i.media.artist}` : '';
    const src = i.media.source && SOURCE_TR[i.media.source] ? ` (${SOURCE_TR[i.media.source]})` : '';
    parts.push(i.media.playing
      ? `Şu an çalan: "${i.media.title}"${who}${src}.`
      : `Müzik duraklatılmış; son parça: "${i.media.title}"${who}${src}.`);
  } else if (i.media && !i.media.playing) {
    parts.push('Şu an müzik çalmıyor.');
  }
  if (i.nav) {
    if (i.nav.status === NavStatus.IDLE || i.nav.status === NavStatus.ERROR) {
      parts.push('Aktif rota yok.');
    } else if (i.nav.destination) {
      const km = i.nav.remainingKm !== null ? `, kalan ${i.nav.remainingKm.toFixed(i.nav.remainingKm < 10 ? 1 : 0)} km` : '';
      const eta = i.nav.etaMin !== null ? `, tahmini varış ${Math.max(1, Math.round(i.nav.etaMin))} dk` : '';
      parts.push(`Aktif rota: ${i.nav.destination}${km}${eta}.`);
    }
  }
  if (i.driverName) parts.push(`Sürücü: ${i.driverName}.`);
  const set: string[] = [];
  if (i.volume !== null) set.push(`ses %${i.volume}`);
  if (i.brightness !== null) set.push(`parlaklık %${i.brightness}`);
  if (i.theme) set.push(`tema ${i.theme.endsWith('-day') ? 'gündüz' : 'gece'}`);
  if (set.length) parts.push(`Uygulama: ${set.join(', ')}.`);
  return parts.join(' ');
}

/** Canlı okuma — her parça ayrı fail-soft (biri düşerse diğerleri yazılır). */
export function readAppStateContextLine(): string {
  let media: AppStateInput['media'] = null;
  try {
    const m = getMediaState();
    // Kaynağı bilinmeyen varsayılan parça (açılış yer tutucusu) GERÇEK parça değildir.
    const real = m.source && m.source !== 'unknown';
    media = {
      playing: m.playing === true,
      title: real ? (m.track?.title?.trim() || null) : null,
      artist: real ? (m.track?.artist?.trim() || null) : null,
      source: real ? String(m.source) : null,
    };
  } catch { media = null; }

  let nav: AppStateInput['nav'] = null;
  try {
    const n = getNavigationState();
    nav = {
      status: n.status,
      destination: n.destination?.name ?? null,
      remainingKm: typeof n.distanceMeters === 'number' && n.distanceMeters > 0 ? n.distanceMeters / 1000 : null,
      etaMin: typeof n.etaSeconds === 'number' && n.etaSeconds > 0 ? n.etaSeconds / 60 : null,
    };
  } catch { nav = null; }

  let driverName: string | null = null;
  let volume: number | null = null;
  let brightness: number | null = null;
  try {
    const s = useStore.getState().settings;
    driverName = s.driverProfiles?.find((d) => d.id === s.activeDriverProfileId)?.name?.trim() || null;
    volume = Number.isFinite(s.volume) ? s.volume : null;
    brightness = Number.isFinite(s.brightness) ? s.brightness : null;
  } catch { /* depo okunamadı — ayar satırı atlanır */ }

  let theme: string | null = null;
  try { theme = useCarTheme.getState().theme ?? null; } catch { theme = null; }

  return formatAppStateLine({ media, nav, driverName, volume, brightness, theme });
}
