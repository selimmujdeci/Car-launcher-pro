/**
 * geoUriParser — paylaşılan konum URI'sini koordinata/aramaya çeviren SAF ayrıştırıcı.
 *
 * SÖZLEŞME: I/O YOK · ağ YOK · timer YOK · global durum YOK. Girdi bir string,
 * çıktı ya koordinat ya arama metni ya da "çözülemedi" — ÜÇÜ AYRI.
 *
 * NEDEN JS'TE: biçimler çok çeşitli ve uygulamadan uygulamaya değişiyor
 * (WhatsApp `geo:`, Telegram `geo:`, Google "yol tarifi" `google.navigation:`,
 * paylaşılan `https://maps.google.com/...`, kısaltılmış `maps.app.goo.gl/...`).
 * Java'da ayrıştırmak birim testsiz kalırdı; native yalnız ham URI'yi taşır.
 *
 * ⚠️ KISA BAĞLANTI ÇÖZÜLMEZ: `maps.app.goo.gl/xyz` içinde koordinat YOKTUR;
 * çözmek ağ ister. Bu durumda dürüstçe `unresolved` denir — sahte koordinat
 * ÜRETİLMEZ, sessizce de yutulmaz (çağıran kullanıcıya söyler).
 */

export type GeoParseResult =
  /** Koordinat çıkarıldı — doğrudan rota kurulabilir. */
  | { readonly kind: 'coords'; readonly lat: number; readonly lng: number; readonly label: string | null }
  /** Koordinat yok ama aranabilir bir metin var (adres/yer adı). */
  | { readonly kind: 'query'; readonly query: string }
  /** Ne koordinat ne metin — ağ gerektiren kısa bağlantı veya tanınmayan biçim. */
  | { readonly kind: 'unresolved'; readonly reason: 'short_link' | 'no_coords' | 'empty' };

function validLat(v: number): boolean { return Number.isFinite(v) && v >= -90 && v <= 90; }
function validLng(v: number): boolean { return Number.isFinite(v) && v >= -180 && v <= 180; }

/** "41.0082,28.9784" → koordinat çifti. Geçersizse null. */
function parsePair(text: string): { lat: number; lng: number } | null {
  const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text ?? '');
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!validLat(lat) || !validLng(lng)) return null;
  /* 0,0 BURADA elenmez: "koordinat çıkarıldı" doğrudur. 0,0'ı reddetmek
     hedef kapısının işidir (destinationHandoff) — iki yerde ayrı kural olmaz. */
  return { lat, lng };
}

/** `q=41.0,28.9(Ev)` → etiket "Ev". Parantez yoksa null. */
function parseLabel(text: string): string | null {
  const m = /\(([^)]{1,120})\)/.exec(text ?? '');
  const raw = m?.[1]?.trim();
  return raw ? raw : null;
}

function decode(v: string | null | undefined): string {
  if (!v) return '';
  try { return decodeURIComponent(v.replace(/\+/g, ' ')).trim(); }
  catch { return v.trim(); }
}

/**
 * Konum URI'sini ayrıştırır.
 *
 * Öncelik sırası (ilk çözülen kazanır):
 *   1. `q=` parametresindeki koordinat — WhatsApp `geo:0,0?q=41.0,28.9(Ad)`
 *      bu yüzden ÖNCE bakılır: şema gövdesi 0,0 dolgudur, gerçek hedef q'dadır.
 *   2. `google.navigation:` / `?destination=` / `?daddr=` parametreleri.
 *   3. Google Maps URL'indeki `@lat,lng,zoom` parçası.
 *   4. Şema gövdesi (`geo:41.0,28.9`).
 *   5. Koordinat yoksa aranabilir metin.
 */
export function parseGeoUri(raw: string | null | undefined): GeoParseResult {
  const uri = (raw ?? '').trim();
  if (!uri) return { kind: 'unresolved', reason: 'empty' };

  const qIdx = uri.indexOf('?');
  const head = qIdx >= 0 ? uri.slice(0, qIdx) : uri;
  const tail = qIdx >= 0 ? uri.slice(qIdx + 1) : '';

  const params = new Map<string, string>();
  for (const part of tail.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    params.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1));
  }

  const label = parseLabel(decode(params.get('q'))) ?? parseLabel(uri);

  // 1-2) Parametrelerdeki koordinat.
  for (const key of ['q', 'destination', 'daddr', 'll', 'query', 'point', 'pt']) {
    const val = decode(params.get(key));
    if (!val) continue;
    const pair = parsePair(val);
    if (pair) return { kind: 'coords', lat: pair.lat, lng: pair.lng, label };
  }

  // 3) Google Maps `/@41.0,28.9,15z`
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(uri);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (validLat(lat) && validLng(lng)) return { kind: 'coords', lat, lng, label };
  }

  // 4) Şema gövdesi: `geo:41.0,28.9` / `google.navigation:41.0,28.9`
  const colon = head.indexOf(':');
  const scheme = colon >= 0 ? head.slice(0, colon).toLowerCase() : '';
  const isWeb  = scheme === 'http' || scheme === 'https';
  /* Web adresinde "gövde" tüm URL'dir; onu adres metni saymak
     `//maps.app.goo.gl/aBcD1234` gibi bir şeyi geocoder'a sormak olurdu. */
  const body = (!isWeb && colon >= 0) ? decode(head.slice(colon + 1)) : '';
  const bodyPair = parsePair(body);
  /* `geo:0,0` DOLGUDUR (WhatsApp bunu q= ile birlikte gönderir). q'da koordinat
     bulunamadıysa 0,0'ı hedef saymak sürücüyü Atlantik'e sürerdi. */
  if (bodyPair && !(bodyPair.lat === 0 && bodyPair.lng === 0)) {
    return { kind: 'coords', lat: bodyPair.lat, lng: bodyPair.lng, label };
  }

  // 5) Koordinat yok — aranabilir metin var mı?
  const textCandidates = [decode(params.get('q')), decode(params.get('destination')),
                          decode(params.get('daddr')), decode(params.get('query')), body];
  for (const t of textCandidates) {
    const clean = t.replace(/\([^)]*\)/g, '').trim();
    /* Salt sayı/virgül kalıntısı arama metni DEĞİLDİR. */
    if (clean.length >= 3 && /[^\d\s,.\-+]/.test(clean)) {
      return { kind: 'query', query: clean };
    }
  }

  /* Kısa bağlantı: içinde hedef YOK, çözmek ağ ister — uydurma yapılmaz. */
  if (/goo\.gl|app\.goo\.gl|bit\.ly|maps\.apple/i.test(uri)) {
    return { kind: 'unresolved', reason: 'short_link' };
  }
  return { kind: 'unresolved', reason: 'no_coords' };
}
