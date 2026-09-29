/**
 * epdkFuelPrice — EPDK il bazlı akaryakıt fiyatı: istek, ayrıştırma, özet, önbellek.
 *
 * KAYNAK (2026-09-29 canlı doğrulandı): EPDK "İllere Göre Akaryakıt Bayi
 * Fiyatlarına İlişkin XML Web Servisi" — SOAP `genelSorgu`, `sorguNo=72`,
 * parametre = il plaka kodu (İstanbul Anadolu 341, Avrupa 342). Anahtar yok.
 *
 * VERİNİN ANLAMI: servis günlük kesit DEĞİL, her markanın o ildeki SON fiyat
 * bildirimini döner (tarihli). 2016'dan kalma pasif markalar da gelir; tek tük
 * hatalı değer de görüldü (ör. benzin 39,23 ₺). Bu yüzden:
 *   · yalnız en yeni bildirim gününden geriye PENCERE_GÜN içindeki satırlar,
 *   · marka medyanı, medyandan %20'den fazla sapan satır atılıp yeniden medyan,
 *   · `observedOn` = kullanılan satırların EN ESKİ günü (tazeliği abartmaz).
 * Veri yoksa fiyat `null` — sahte sayı / 0 YAZILMAZ.
 *
 * ÖNBELLEK: il başına 6 saat. EPDK hata/429 verirse son İYİ veri döner ve
 * bekleme süresi dolana kadar EPDK'ya HİÇ gidilmez (tekrar deneme fırtınası yok).
 */

export const EPDK_ENDPOINT =
  'https://lisansws.epdk.gov.tr/services/bildirimPetrolAkaryakitFiyatlari';
export const EPDK_SORGU_NO_IL = 72;

export const CACHE_TTL_MS      = 6 * 60 * 60_000;
export const COOLDOWN_429_MS   = 30 * 60_000;
export const COOLDOWN_ERROR_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const WINDOW_DAYS = 7;
const OUTLIER_RATIO = 0.2;
const PRICE_RANGE = { min: 1, max: 1_000 } as const;
const DAY_MS = 86_400_000;

const FUEL_PETROL = 'Kurşunsuz Benzin 95 Oktan';
const FUEL_DIESEL = 'Motorin';

export interface FuelPriceResponse {
  schema: 1;
  currency: 'TRY';
  source: string;
  observedOn: string | null;
  province: string | null;
  pricePerLiter: { petrol: number | null; diesel: number | null };
}

export interface EpdkRow {
  day: string;        // YYYY-MM-DD
  fuel: string;
  province: string;
  brand: string;
  price: number;
}

/* ── İller ─────────────────────────────────────────────────────────────── */

const PROVINCES: ReadonlyArray<readonly [number, string]> = [
  [1, 'Adana'], [2, 'Adıyaman'], [3, 'Afyonkarahisar'], [4, 'Ağrı'], [5, 'Amasya'],
  [6, 'Ankara'], [7, 'Antalya'], [8, 'Artvin'], [9, 'Aydın'], [10, 'Balıkesir'],
  [11, 'Bilecik'], [12, 'Bingöl'], [13, 'Bitlis'], [14, 'Bolu'], [15, 'Burdur'],
  [16, 'Bursa'], [17, 'Çanakkale'], [18, 'Çankırı'], [19, 'Çorum'], [20, 'Denizli'],
  [21, 'Diyarbakır'], [22, 'Edirne'], [23, 'Elazığ'], [24, 'Erzincan'], [25, 'Erzurum'],
  [26, 'Eskişehir'], [27, 'Gaziantep'], [28, 'Giresun'], [29, 'Gümüşhane'], [30, 'Hakkari'],
  [31, 'Hatay'], [32, 'Isparta'], [33, 'Mersin'], [35, 'İzmir'], [36, 'Kars'],
  [37, 'Kastamonu'], [38, 'Kayseri'], [39, 'Kırklareli'], [40, 'Kırşehir'], [41, 'Kocaeli'],
  [42, 'Konya'], [43, 'Kütahya'], [44, 'Malatya'], [45, 'Manisa'], [46, 'Kahramanmaraş'],
  [47, 'Mardin'], [48, 'Muğla'], [49, 'Muş'], [50, 'Nevşehir'], [51, 'Niğde'],
  [52, 'Ordu'], [53, 'Rize'], [54, 'Sakarya'], [55, 'Samsun'], [56, 'Siirt'],
  [57, 'Sinop'], [58, 'Sivas'], [59, 'Tekirdağ'], [60, 'Tokat'], [61, 'Trabzon'],
  [62, 'Tunceli'], [63, 'Şanlıurfa'], [64, 'Uşak'], [65, 'Van'], [66, 'Yozgat'],
  [67, 'Zonguldak'], [68, 'Aksaray'], [69, 'Bayburt'], [70, 'Karaman'], [71, 'Kırıkkale'],
  [72, 'Batman'], [73, 'Şırnak'], [74, 'Bartın'], [75, 'Ardahan'], [76, 'Iğdır'],
  [77, 'Yalova'], [78, 'Karabük'], [79, 'Kilis'], [80, 'Osmaniye'], [81, 'Düzce'],
  // İstanbul EPDK'da iki yakadır; yalnız "İstanbul" Avrupa Yakası sayılır.
  [342, 'İstanbul (Avrupa Yakası)'], [341, 'İstanbul (Anadolu Yakası)'],
];

/** Türkçe harfleri sadeleştirip küçük harfe indirir ("İzmir" → "izmir"). */
export function normalizeProvinceKey(s: string): string {
  return s.trim()
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const BY_KEY = new Map<string, { code: number; name: string }>();
for (const [code, name] of PROVINCES) {
  BY_KEY.set(normalizeProvinceKey(name), { code, name });
  BY_KEY.set(String(code), { code, name });
}
BY_KEY.set('istanbul', { code: 342, name: 'İstanbul (Avrupa Yakası)' });
BY_KEY.set('istanbul avrupa', { code: 342, name: 'İstanbul (Avrupa Yakası)' });
BY_KEY.set('istanbul anadolu', { code: 341, name: 'İstanbul (Anadolu Yakası)' });
BY_KEY.set('afyon', { code: 3, name: 'Afyonkarahisar' });
BY_KEY.set('icel', { code: 33, name: 'Mersin' });
BY_KEY.set('maras', { code: 46, name: 'Kahramanmaraş' });
BY_KEY.set('urfa', { code: 63, name: 'Şanlıurfa' });
BY_KEY.set('izmit', { code: 41, name: 'Kocaeli' });
BY_KEY.set('antakya', { code: 31, name: 'Hatay' });
BY_KEY.set('adapazari', { code: 54, name: 'Sakarya' });

/** İl adı ya da plaka kodu → EPDK parametresi. Bilinmiyorsa `null`. */
export function resolveProvince(input: string | null | undefined): { code: number; name: string } | null {
  if (typeof input !== 'string') return null;
  const key = normalizeProvinceKey(input);
  if (!key) return null;
  const numeric = /^\d+$/.test(key) ? String(Number(key)) : key;
  return BY_KEY.get(numeric) ?? null;
}

/* ── SOAP ──────────────────────────────────────────────────────────────── */

export function buildSoapRequest(provinceCode: number): string {
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
    + 'xmlns:gen="http://genel.service.ws.epvys.g222.tubitak.gov.tr/"><soapenv:Header/>'
    + `<soapenv:Body><gen:genelSorgu><sorguNo>${EPDK_SORGU_NO_IL}</sorguNo>`
    + `<parametreler>${Math.trunc(provinceCode)}</parametreler></gen:genelSorgu>`
    + '</soapenv:Body></soapenv:Envelope>';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? m[1].trim() : null;
}

/**
 * SOAP cevabını satırlara çevirir. SOAP Fault ya da `<return>` yoksa HATA fırlatır
 * (çağıran "veri yok" ile "servis hatası"nı ayırabilsin). Bozuk satır atlanır.
 */
export function parseEpdkResponse(xml: string): EpdkRow[] {
  if (/<(?:\w+:)?Fault>/.test(xml)) {
    const fs = /<faultstring>([^<]*)<\/faultstring>/.exec(xml)?.[1] ?? 'SOAP Fault';
    throw new Error(`EPDK fault: ${fs}`);
  }
  const ret = /<return>([\s\S]*)<\/return>/.exec(xml);
  if (!ret) throw new Error('EPDK cevabında <return> yok');
  let inner = decodeEntities(ret[1]);
  inner = inner.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');

  const rows: EpdkRow[] = [];
  const blockRe = /<PetrolPiyasasiIllereGoreAkaryakitFiyatlari>([\s\S]*?)<\/PetrolPiyasasiIllereGoreAkaryakitFiyatlari>/g;
  for (let m = blockRe.exec(inner); m; m = blockRe.exec(inner)) {
    const b = m[1];
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(tag(b, 'Tarih') ?? '')?.[1];
    const fuel = tag(b, 'YakitTipi');
    const province = tag(b, 'Il');
    const brand = tag(b, 'FirmaMarkasi');
    const priceText = tag(b, 'Fiyat');
    const price = priceText !== null && priceText !== '' ? Number(priceText) : NaN;
    if (!day || !fuel || !province || !brand || !Number.isFinite(price)) continue;
    rows.push({ day, fuel, province, brand, price });
  }
  return rows;
}

/* ── Özet ──────────────────────────────────────────────────────────────── */

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

interface FuelSummary { price: number; oldestDay: string }

function summarizeFuel(rows: EpdkRow[], fuel: string): FuelSummary | null {
  const valid = rows.filter((r) => r.fuel === fuel
    && r.price >= PRICE_RANGE.min && r.price <= PRICE_RANGE.max
    && Number.isFinite(dayMs(r.day)));
  if (valid.length === 0) return null;
  const newest = Math.max(...valid.map((r) => dayMs(r.day)));
  const recent = valid.filter((r) => newest - dayMs(r.day) <= WINDOW_DAYS * DAY_MS);
  const m0 = median(recent.map((r) => r.price));
  const kept = recent.filter((r) => Math.abs(r.price - m0) <= m0 * OUTLIER_RATIO);
  if (kept.length === 0) return null;
  const oldestDay = kept.reduce((a, r) => (r.day < a ? r.day : a), kept[0].day);
  return { price: Math.round(median(kept.map((r) => r.price)) * 100) / 100, oldestDay };
}

export function emptyResponse(province: string | null, source = 'EPDK — veri yok'): FuelPriceResponse {
  return {
    schema: 1, currency: 'TRY', source, observedOn: null, province,
    pricePerLiter: { petrol: null, diesel: null },
  };
}

/** EPDK satırları → yanıt. Veri yoksa fiyatlar `null`. */
export function summarizeRows(rows: EpdkRow[], provinceName: string): FuelPriceResponse {
  const petrol = summarizeFuel(rows, FUEL_PETROL);
  const diesel = summarizeFuel(rows, FUEL_DIESEL);
  if (!petrol && !diesel) return emptyResponse(provinceName);
  const days = [petrol?.oldestDay, diesel?.oldestDay].filter((d): d is string => !!d);
  const observedOn = days.reduce((a, d) => (d < a ? d : a));
  return {
    schema: 1,
    currency: 'TRY',
    source: `EPDK İllere Göre Akaryakıt Bayi Fiyatları (sorguNo 72) — ${provinceName}, marka medyanı`,
    observedOn,
    province: provinceName,
    pricePerLiter: { petrol: petrol?.price ?? null, diesel: diesel?.price ?? null },
  };
}

/* ── Önbellek ──────────────────────────────────────────────────────────── */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CacheResult {
  body: FuelPriceResponse;
  /** fresh: EPDK'dan/6 saatlik önbellekten · fallback: hata sonrası son iyi veri · none: veri yok */
  state: 'fresh' | 'fallback' | 'none';
}

export class EpdkRateLimitError extends Error {}

export function createEpdkFuelCache(opts: { fetchFn: FetchLike; now: () => number }) {
  const good = new Map<number, { body: FuelPriceResponse; at: number }>();
  const inflight = new Map<number, Promise<CacheResult>>();
  let blockedUntil = 0;

  async function fetchFromEpdk(code: number, name: string): Promise<FuelPriceResponse> {
    const res = await opts.fetchFn(EPDK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'genelSorgu' },
      body: buildSoapRequest(code),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.status === 429 || /throttl/i.test(text)) throw new EpdkRateLimitError('EPDK 429');
    if (!res.ok && !/<return>/.test(text)) throw new Error(`EPDK HTTP ${res.status}`);
    return summarizeRows(parseEpdkResponse(text), name);
  }

  async function get(province: { code: number; name: string }): Promise<CacheResult> {
    const now = opts.now();
    const cached = good.get(province.code);
    if (cached && now - cached.at < CACHE_TTL_MS) return { body: cached.body, state: 'fresh' };
    const fallback = (): CacheResult => cached
      ? { body: cached.body, state: 'fallback' }
      : { body: emptyResponse(province.name), state: 'none' };
    if (now < blockedUntil) return fallback();

    const running = inflight.get(province.code);
    if (running) return running;
    const p = (async (): Promise<CacheResult> => {
      try {
        const body = await fetchFromEpdk(province.code, province.name);
        if (body.observedOn === null) {
          // EPDK cevap verdi ama bu il için kullanılabilir fiyat yok: son iyiyi koru.
          return cached ? { body: cached.body, state: 'fallback' } : { body, state: 'none' };
        }
        good.set(province.code, { body, at: opts.now() });
        return { body, state: 'fresh' };
      } catch (e) {
        blockedUntil = opts.now()
          + (e instanceof EpdkRateLimitError ? COOLDOWN_429_MS : COOLDOWN_ERROR_MS);
        console.error('fuel-prices:', e instanceof Error ? e.message : e);
        return fallback();
      } finally {
        inflight.delete(province.code);
      }
    })();
    inflight.set(province.code, p);
    return p;
  }

  return { get };
}
