/**
 * destinationHandoff — araç DIŞINDAN gelen hedefin TEK merkezi giriş noktası.
 *
 * ── SAHA KUSURU (2026-08-21, kullanıcı bildirdi) ─────────────────────────
 * İki ayrı yol da kendi navigasyonumuzu ATLIYORDU:
 *
 *   ① "Arabam Cebimde" → *Araca Gönder* → `commandListener` `route_send`
 *      komutu `buildNavIntent()` ile bir `geo:` URI üretip `window.open`
 *      ediyordu → Android seçicisi → **Google Maps**. Aracın kendi rota
 *      motoru (`navigationService.startNavigation`) HİÇ çağrılmıyordu.
 *      Varsayılan sağlayıcı da `'google_maps'` idi; PWA'da "CarOS Pro"
 *      diye bir seçenek zaten YOKTU.
 *   ② WhatsApp'tan gelen konuma basınca Android "hangi uygulamayla açılsın"
 *      diye soruyor ama listede CarOS Pro ÇIKMIYOR — `AndroidManifest`te
 *      `geo:` / `google.navigation:` intent-filter'ı yoktu (bkz. Fix B).
 *
 * Bu modül ikisinin de vardığı TEK kapıdır. `homeWorkNavigation` deseninin
 * aynısı: yeni rota motoru YOK, yeni depolama YOK — mevcut
 * `navigationService.startNavigation()` çağrılır.
 *
 * ── SÖZLEŞME ─────────────────────────────────────────────────────────────
 *  · FAIL-CLOSED koordinat: geçersiz/eksik/0,0 koordinat rotaya GİRMEZ.
 *  · Hedef sahipliği `USER_HANDOFF` olarak bildirilir — kullanıcı iradesidir
 *    (aksi hâlde aktif oturumda sessizce engellenirdi), ama defterde araç
 *    dışından geldiği GÖRÜNÜR kalır.
 *  · Harici uygulamaya YÖNLENDİRME YOK: bu kapıdan geçen hedef her zaman
 *    kendi haritamızda açılır. Harici sağlayıcı isteği ÇAĞIRANIN kararıdır
 *    ve bu kapıya hiç uğramaz.
 *  · Çift-tetik koruması: aynı hedef kısa pencerede iki kez gelirse ikincisi
 *    yutulur (telefon komutu + geo intent aynı anda düşebilir).
 *  · Timer/abonelik KURMAZ; yalnız çağrıldığında çalışır.
 */
import { startNavigation } from '../navigationService';
import { setFullMapView } from '../mapViewBus';
import { speakNavigation } from '../ttsService';
import { logError } from '../crashLogger';
import type { Address } from '../addressBookService';

/** Hedefin araca hangi kanaldan geldiği — gözlem için, karar için DEĞİL. */
export type HandoffChannel =
  /** Telefondaki "Arabam Cebimde" → Araca Gönder (uzak komut). */
  | 'REMOTE_COMMAND'
  /** Başka bir uygulamanın paylaştığı konum (`geo:` / harita bağlantısı). */
  | 'GEO_INTENT';

export interface IncomingDestination {
  readonly lat: number;
  readonly lng: number;
  /** İnsan-okunur ad; boşsa koordinat metni kullanılır (uydurma ad YOK). */
  readonly label?: string | null;
  readonly channel: HandoffChannel;
}

export type HandoffReason =
  | 'invalid_coords'   // NaN / sınır dışı / eksik
  | 'null_island'      // tam 0,0 — "veri yok"un klasik maskesi
  | 'debounced';       // aynı hedef az önce zaten kabul edildi

export type HandoffResult =
  | { readonly ok: true;  readonly destination: Address; readonly channel: HandoffChannel }
  | { readonly ok: false; readonly reason: HandoffReason };

/**
 * 0,0 ("Null Island") REDDEDİLİR.
 *
 * Gerçek bir hedef olma ihtimali yok denecek kadar düşük, ama eksik/bozuk
 * yükte varsayılan değer olarak SIK GÖRÜLÜR. Bu depoda tekrar eden "sahte 0"
 * kusurunun navigasyon karşılığı budur — sürücüyü Atlantik'e sürmemek için
 * ayrı ve açık bir kapı.
 */
function isNullIsland(lat: number, lng: number): boolean {
  return lat === 0 && lng === 0;
}

/** Çift-tetik penceresi: aynı hedefin iki kanaldan gelmesi tek rota olmalıdır. */
export const HANDOFF_DEDUPE_MS = 4_000;
/** Bu yarıçap içindeki hedef "aynı hedef" sayılır (geocoder sapması). */
export const HANDOFF_SAME_TARGET_M = 50;

let _lastAcceptedAt = 0;
let _lastLat = Number.NaN;
let _lastLng = Number.NaN;

/** @internal — testler arası izolasyon. */
export function _resetHandoffGuardForTest(): void {
  _lastAcceptedAt = 0;
  _lastLat = Number.NaN;
  _lastLng = Number.NaN;
}

function _metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Koordinat metni — ad yoksa UYDURULMAZ, koordinatın kendisi yazılır. */
function coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * Gelen hedefi kabul eder ve **kendi navigasyonumuzda** rotayı başlatır.
 *
 * Harici harita uygulaması AÇILMAZ. Başarısızlıkta `startNavigation` HİÇ
 * çağrılmaz (fail-closed) ve sebep çağırana döner — sessiz yutma yok.
 */
export function acceptHandoffDestination(
  incoming: IncomingDestination,
  nowMs: number = Date.now(),
): HandoffResult {
  const lat = Number(incoming?.lat);
  const lng = Number(incoming?.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, reason: 'invalid_coords' };
  }
  if (isNullIsland(lat, lng)) {
    return { ok: false, reason: 'null_island' };
  }

  // Aynı hedef, kısa pencerede ikinci kez → tek rota.
  if (Number.isFinite(_lastLat) && Number.isFinite(_lastLng) &&
      nowMs - _lastAcceptedAt < HANDOFF_DEDUPE_MS &&
      _metersBetween(_lastLat, _lastLng, lat, lng) <= HANDOFF_SAME_TARGET_M) {
    return { ok: false, reason: 'debounced' };
  }

  const name = (incoming.label ?? '').trim() || coordLabel(lat, lng);
  const destination: Address = {
    id:        `handoff-${Math.round(lat * 1e5)}-${Math.round(lng * 1e5)}`,
    name,
    latitude:  lat,
    longitude: lng,
    type:      'history',
  };

  _lastAcceptedAt = nowMs;
  _lastLat = lat;
  _lastLng = lng;

  /* Rota motoru: mevcut TEK yol. Sahiplik `USER_HANDOFF` — aktif oturumda
     sessizce engellenmemesi için (bkz. destinationOwnershipModel). */
  startNavigation(destination, false, 'USER_HANDOFF');

  /* Harita bir çekmece değildir; tam ekran görünümü kendi veri yolundan açılır.
     Kayıt yoksa sessizce düşer — rota yine kurulmuştur (fail-soft). */
  try { setFullMapView(true); } catch (e) { logError('Handoff:mapView', e); }

  /* Kısa sesli onay: sürücü ekrana bakmadan da hedefin değiştiğini bilmeli.
     TTS düşerse rota ETKİLENMEZ. */
  try { speakNavigation(`Rota kuruldu: ${name}`); } catch (e) { logError('Handoff:tts', e); }

  return { ok: true, destination, channel: incoming.channel };
}

/* ── Gözlem yüzeyi (hüküm YOK, ham sayaç) ────────────────────────────────── */

let _accepted = 0;
let _rejected = 0;
let _lastReason: HandoffReason | null = null;
let _lastChannel: HandoffChannel | null = null;

/** Sonucu sayaçlara işler — çağıranlar bunu kullanır, sayaç dışarıdan yazılmaz. */
export function recordHandoffOutcome(r: HandoffResult, channel: HandoffChannel): void {
  _lastChannel = channel;
  if (r.ok) { _accepted++; _lastReason = null; }
  else      { _rejected++; _lastReason = r.reason; }
}

export interface HandoffSnapshot {
  readonly accepted: number;
  readonly rejected: number;
  readonly lastReason: HandoffReason | null;
  readonly lastChannel: HandoffChannel | null;
  readonly lastAcceptedAt: number | null;
}

export function getHandoffSnapshot(): HandoffSnapshot {
  return {
    accepted: _accepted,
    rejected: _rejected,
    lastReason: _lastReason,
    lastChannel: _lastChannel,
    lastAcceptedAt: _lastAcceptedAt > 0 ? _lastAcceptedAt : null,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetHandoffCountersForTest(): void {
  _accepted = 0;
  _rejected = 0;
  _lastReason = null;
  _lastChannel = null;
}
