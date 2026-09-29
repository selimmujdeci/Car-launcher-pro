/**
 * liveFuelPrice — carospro.com/api/fuel-prices'tan CANLI il fiyatı (EPDK).
 *
 * ÖNCELİK: canlı fiyat (tarihli, aracın İLİ) > APK'daki tablo (`BUNDLED_FUEL_PRICE_PACK`).
 * Canlı fiyat bayat değilse (≤ `FUEL_PRICE_STALE_AFTER_DAYS`) HER ZAMAN kazanır:
 * EPDK `observedOn`'u kullanılan satırların en eski günüdür (temkinli) ve APK
 * tablosu başka bir ilin fiyatıdır — yalnız tarihe bakmak, birkaç gün "yeni"
 * diye başka ilin fiyatını öne geçirirdi. Canlı kayıt da bayatsa daha yeni günlü
 * olan kullanılır (eski bir canlı kayıt, daha yeni beyanlı tabloyu ezmesin).
 *
 * AĞ YOKSA: son geçerli canlı cevap yerel depoda saklanır ve kullanılır. Bayatlık
 * AYRI hesaplanmaz — `resolveFuelCategory` gözlem gününe bakıp 14 günü geçeni
 * `STALE` işaretler (tek bayatlık otoritesi orasıdır).
 *
 * Cevap `parseFuelPricePack` ile doğrulanır; fiyatı `null` olan ya da bozuk cevap
 * kaydedilmez ve önceki iyi kaydı SİLMEZ. Hata sessizdir (fail-soft): yakıt kalemi
 * tabloya ya da "bilinmiyor"a düşer, hiçbir şey 0 yazmaz.
 */
import { signalWithTimeout } from '../../../utils/abortCompat';
import { safeGetRaw, safeSetRaw } from '../../../utils/safeStorage';
import { getGPSState } from '../../gpsService';
import { nearestProvince } from './data/trProvinceCenters';
import {
  BUNDLED_FUEL_PRICE_PACK,
  FUEL_PRICE_STALE_AFTER_DAYS,
  parseFuelPricePack,
  type FuelPricePack,
} from './fuelPricePack';

const FUEL_PRICE_URL =
  (import.meta.env.VITE_FUEL_PRICE_URL as string | undefined) || 'https://carospro.com/api/fuel-prices';

export const LIVE_FUEL_STORAGE_KEY = 'caros.tripCost.liveFuelPrice.v1';
/** Sunucu EPDK'ya 6 saatte bir gider; araç daha sık sormaz. */
export const LIVE_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;
/** Başarısız denemeden sonra en erken yeniden deneme. */
export const LIVE_RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const WATCH_TICK_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

interface StoredLive {
  /** Sunucunun ham cevabı — okurken yeniden doğrulanır. */
  raw: unknown;
  province: string;
  fetchedAtMs: number;
}

export interface LiveFuelDeps {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  now: () => number;
  url?: string;
}

export function createLiveFuelPriceClient(deps: LiveFuelDeps) {
  const url = deps.url ?? FUEL_PRICE_URL;
  let stored: StoredLive | null | undefined; // undefined = depodan henüz okunmadı
  let pack: FuelPricePack | null = null;
  let lastAttemptMs = -Infinity;
  let lastAttemptOk = false;
  let inflight: Promise<boolean> | null = null;

  function load(): void {
    if (stored !== undefined) return;
    stored = null;
    try {
      const txt = deps.storage.get(LIVE_FUEL_STORAGE_KEY);
      if (!txt) return;
      const s = JSON.parse(txt) as StoredLive;
      const p = parseFuelPricePack(s?.raw);
      if (p && typeof s.province === 'string' && Number.isFinite(s.fetchedAtMs)) {
        stored = s;
        pack = p;
      }
    } catch { /* bozuk kayıt → yok say */ }
  }

  /** Son geçerli canlı fiyat (ağ yoksa depodan). */
  function getLivePack(): FuelPricePack | null {
    load();
    return pack;
  }

  /** Taze canlı fiyat > APK tablosu; canlı da bayatsa daha yeni günlü olan. */
  function getEffectivePack(bundled: FuelPricePack | null = BUNDLED_FUEL_PRICE_PACK): FuelPricePack | null {
    const live = getLivePack();
    if (!live) return bundled;
    const liveFresh = deps.now() - live.observedAtMs <= FUEL_PRICE_STALE_AFTER_DAYS * 86_400_000;
    if (liveFresh) return live;
    if (bundled && bundled.observedAtMs > live.observedAtMs) return bundled;
    return live;
  }

  /** İl için canlı fiyat ister. true → yeni geçerli fiyat kaydedildi. */
  async function refresh(province: string): Promise<boolean> {
    if (inflight) return inflight;
    lastAttemptMs = deps.now();
    inflight = (async () => {
      try {
        const res = await deps.fetchFn(`${url}?il=${encodeURIComponent(province)}`, {
          method: 'GET',
          signal: signalWithTimeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return false;
        const raw: unknown = await res.json();
        const p = parseFuelPricePack(raw);
        if (!p) return false; // fiyatsız/bozuk cevap önceki iyi kaydı silmez
        load();
        stored = { raw, province, fetchedAtMs: deps.now() };
        pack = p;
        try { deps.storage.set(LIVE_FUEL_STORAGE_KEY, JSON.stringify(stored)); } catch { /* depo dolu */ }
        return true;
      } catch {
        return false;
      }
    })();
    try {
      lastAttemptOk = await inflight;
      return lastAttemptOk;
    } finally {
      inflight = null;
    }
  }

  /** İzleyicinin şimdi sorması gerekiyor mu (il değişti / süre doldu). */
  function shouldRefresh(province: string): boolean {
    load();
    const now = deps.now();
    if (!lastAttemptOk && now - lastAttemptMs < LIVE_RETRY_AFTER_FAILURE_MS) return false;
    if (!stored || stored.province !== province) return true;
    return now - stored.fetchedAtMs >= LIVE_REFRESH_INTERVAL_MS;
  }

  return { getLivePack, getEffectivePack, refresh, shouldRefresh };
}

/* ── Uygulama örneği ─────────────────────────────────────────────────────── */

const client = createLiveFuelPriceClient({
  fetchFn: (u, i) => fetch(u, i),
  storage: { get: safeGetRaw, set: (k, v) => safeSetRaw(k, v) },
  now: () => Date.now(),
});

/** Yakıt kalemine verilecek fiyat tablosu: canlı (EPDK) > APK tablosu. */
export function getEffectiveFuelPricePack(): FuelPricePack | null {
  try { return client.getEffectivePack(); } catch { return BUNDLED_FUEL_PRICE_PACK; }
}

/** GPS'ten il: yalnız gerçek konum ('default' sahte konumdur → il seçilmez). */
function currentProvince(): string | null {
  const gps = getGPSState();
  const loc = gps.location;
  if (!loc || gps.source === 'default' || gps.source === null) return null;
  return nearestProvince(loc.latitude, loc.longitude);
}

/**
 * Konum biliniyorsa ilin canlı fiyatını periyodik ister. Başlatılır, durdurucu döner.
 * Ağ/konum yoksa hiçbir şey yapmaz; hata yutulur (fail-soft).
 */
export function startLiveFuelPriceWatcher(): () => void {
  const tick = () => {
    try {
      const province = currentProvince();
      if (province && client.shouldRefresh(province)) void client.refresh(province);
    } catch { /* fail-soft */ }
  };
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, WATCH_TICK_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
}
