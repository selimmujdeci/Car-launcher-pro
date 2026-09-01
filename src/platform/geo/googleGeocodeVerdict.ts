/**
 * googleGeocodeVerdict — Google Geocoding yanıtının TEK yorumlayıcısı (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Girdi bir yanıtın HTTP durumu + gövdesidir; çıktı tipli bir hükümdür.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (teşhis · 2026-08-28) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı "Google kırmızı / hata veriyor" dedi. İki katman ölçüldü:
 *
 *   1) `credentialVerifiers.verifyGeocodeGoogleKey` — Google'ın döndürdüğü
 *      `REQUEST_DENIED` ve `INVALID_REQUEST` TEK BİR `invalid_key` hükmüne
 *      katlanıyordu. Kullanıcıya gösterilen cümle: *"Anahtar geçersiz
 *      görünüyor. Kopyaladığınız anahtarı kontrol edin."*
 *   2) `geocodingProviders._google` — `status !== 'OK'` olan HER yanıtı sessiz
 *      boş diziye çeviriyordu; ret ile "sonuç yok" ayırt edilemiyordu.
 *
 * OYSA GOOGLE SEBEBİ GÖVDEDE SÖYLÜYOR (`error_message`) ve sebepler farklı
 * EYLEM ister. `REQUEST_DENIED`in en az dört ayrı sebebi vardır:
 *   • anahtar gerçekten geçersiz          → anahtarı düzelt
 *   • Geocoding API projede AÇIK DEĞİL    → API'yi etkinleştir (anahtar SAĞLAM)
 *   • faturalandırma açık değil           → billing aç       (anahtar SAĞLAM)
 *   • anahtarda referrer/IP kısıtı var    → kısıtı gevşet    (anahtar SAĞLAM)
 *
 * Son üçünde kullanıcının anahtarı DOĞRUDUR; "anahtarınızı kontrol edin" demek
 * onu saatlerce yanlış yere bakmaya iter. Bu, #699'da yaşanan hatanın aynısıdır
 * ("anahtar geçersiz" dedik, sorun taşımaydı) — bu sefer kanıt gövdede HAZIR
 * duruyordu ve okunmuyordu.
 *
 * ── ÖLÇÜLDÜ (2026-08-28, anahtar KULLANILMADAN) ───────────────────────────
 * `GET maps.googleapis.com/maps/api/geocode/json?address=Ankara&key=TESTKEY`
 *   → HTTP 200 · `Access-Control-Allow-Origin: *`
 *   → gövde: `{"status":"REQUEST_DENIED","error_message":"The provided API key
 *      is invalid. "}`
 * İKİ SONUÇ:
 *   • CORS duvarı YOK → #699'un native taşıma çözümü buraya GEREKMEZ.
 *   • Hata HTTP 200 ile gelir → durum koduna bakmak YETMEZ, gövde OKUNMALIDIR.
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ──────────────────────────────────────────────────
 *  · Tanınmayan sebep `UNKNOWN`tır — uydurulmaz (CLAUDE.md kanıt kuralı).
 *  · `hint` metinleri BU DOSYADA SABİTTİR; Google'ın `error_message` metni
 *    kullanıcıya AYNEN geçirilmez. Sızıntı bu yüzden yapısal olarak imkânsız:
 *    hükümden dışarı yalnız bizim yazdığımız sabit cümle çıkar.
 *  · Anahtar materyali bu modüle GİRMEZ (imzada `apiKey` parametresi YOKTUR).
 */

/**
 * Google Geocoding'in ürün açısından ANLAMLI sebep sınıfları.
 * "Ne oldu" değil "kim ne yapmalı" ekseninde ayrılmıştır.
 */
export type GoogleGeocodeReason =
  /** Sonuç geldi. */
  | 'OK'
  /** Sorgu çalıştı ama adres bulunamadı — sağlayıcı SAĞLAM. */
  | 'ZERO_RESULTS'
  /** Anahtarın kendisi geçersiz — kullanıcı anahtarı düzeltmeli. */
  | 'KEY_INVALID'
  /** Anahtar sağlam ama referrer/IP kısıtı bu API'yi engelliyor. */
  | 'KEY_RESTRICTED'
  /** Anahtar sağlam ama Geocoding API projede etkin değil. */
  | 'API_NOT_ENABLED'
  /** Anahtar sağlam ama projede faturalandırma açık değil. */
  | 'BILLING_DISABLED'
  /** Günlük/anlık kota aşıldı — anahtar SAĞLAM. */
  | 'QUOTA_EXCEEDED'
  /** İstek biçimi hatalı — ÜRÜN kusuru, kullanıcı kusuru DEĞİL. */
  | 'BAD_REQUEST'
  /** Google tarafında geçici arıza. */
  | 'SERVER_ERROR'
  /** Yanıt hiç alınamadı (ağ/timeout/abort). */
  | 'TRANSPORT'
  /** Tanınmayan sebep — SINIFLANDIRILMADI, uydurulmadı. */
  | 'UNKNOWN';

export interface GoogleGeocodeVerdict {
  readonly reason: GoogleGeocodeReason;
  /** Yanıttaki sonuçlar kullanılabilir mi (yalnız `OK`). */
  readonly usable: boolean;
  /**
   * Anahtarın kendisi bu ret için SUÇLU mu? `false` → kullanıcıya "anahtarını
   * kontrol et" DENMEZ (yanlış yönlendirme). Yalnız `KEY_INVALID` için `true`.
   */
  readonly keyAtFault: boolean;
  /** Kullanıcıya gösterilecek TEK cümlelik EYLEM. Sabit metin — sızıntı yok. */
  readonly hint: string;
}

/** Google'ın yorumlanan gövde alanları (fazlası OKUNMAZ). */
export interface GoogleGeocodeBody {
  readonly status?: unknown;
  readonly error_message?: unknown;
}

function _verdict(
  reason: GoogleGeocodeReason,
  usable: boolean,
  keyAtFault: boolean,
  hint: string,
): GoogleGeocodeVerdict {
  return { reason, usable, keyAtFault, hint };
}

/** Tüm hükümlerin sabit metinleri — tek yerde, çeviri/denetim kolay. */
const HINT: Readonly<Record<GoogleGeocodeReason, string>> = {
  OK:               'Bağlantı başarılı — Google adres çözümlemesi çalışıyor.',
  ZERO_RESULTS:     'Bağlantı başarılı — anahtar çalışıyor (deneme adresi sonuç döndürmedi).',
  KEY_INVALID:      'Google anahtarı reddetti: anahtar geçersiz. Anahtarı Cloud Console\'dan yeniden kopyalayın.',
  KEY_RESTRICTED:   'Anahtar GEÇERLİ ama üzerinde site/IP kısıtı var; Geocoding web servisi kısıtlı anahtar kabul etmez. Cloud Console → anahtar → "Uygulama kısıtlamaları" → Yok.',
  API_NOT_ENABLED:  'Anahtar GEÇERLİ ama bu projede "Geocoding API" etkin değil. Cloud Console → API\'ler ve Servisler → Geocoding API → Etkinleştir.',
  BILLING_DISABLED: 'Anahtar GEÇERLİ ama projede faturalandırma açık değil. Google Geocoding faturalandırma olmadan çalışmaz.',
  QUOTA_EXCEEDED:   'Anahtar GEÇERLİ ama kota/günlük sınır aşılmış. Cloud Console\'dan kotayı veya faturalandırma sınırını kontrol edin.',
  BAD_REQUEST:      'İstek biçimi Google tarafından reddedildi — bu bir ÜRÜN kusurudur, anahtarınızda sorun yok.',
  SERVER_ERROR:     'Google tarafında geçici bir arıza var. Bir süre sonra tekrar deneyin.',
  TRANSPORT:        'Google\'a ulaşılamadı — internet bağlantısını kontrol edin.',
  UNKNOWN:          'Google isteği reddetti ama sebebi sınıflandırılamadı. Sebep uydurulmuyor; Cloud Console\'daki anahtar sayfasını kontrol edin.',
};

/**
 * Google'ın `error_message` metnini sebebe çevirir.
 * Sıra ÖNEMLİDİR: daha ÖZEL kalıp önce denenir ("api project is not
 * authorized" → API kapalı, "not authorized to use this api key" → kısıt).
 * Hiçbiri tutmazsa `null` — çağıran `status` alanına düşer.
 */
function _reasonFromMessage(msg: string): GoogleGeocodeReason | null {
  const m = msg.toLowerCase();
  if (!m) return null;

  /* Faturalandırma — Google bunu hem REQUEST_DENIED hem OVER_DAILY_LIMIT ile
     gönderebilir; mesaj `status`tan DAHA KESKİN kanıttır, bu yüzden önce. */
  if (m.includes('enable billing') || m.includes('billing account')) return 'BILLING_DISABLED';

  /* API projede etkin değil. */
  if (m.includes('api project is not authorized')) return 'API_NOT_ENABLED';
  if (m.includes('has not been used in project') || m.includes('is disabled')) return 'API_NOT_ENABLED';

  /* Anahtar kısıtları (referrer / IP / paket adı). */
  if (m.includes('referer restrictions') || m.includes('referrer restrictions')) return 'KEY_RESTRICTED';
  if (m.includes('api keys with') && m.includes('restrictions')) return 'KEY_RESTRICTED';
  if (m.includes('not authorized to use this api key')) return 'KEY_RESTRICTED';
  if (m.includes('ip, site or mobile application')) return 'KEY_RESTRICTED';

  /* Anahtarın kendisi bozuk. */
  if (m.includes('api key is invalid') || m.includes('invalid api key')) return 'KEY_INVALID';
  if (m.includes('api key not valid')) return 'KEY_INVALID';
  if (m.includes('keyinvalid')) return 'KEY_INVALID';

  return null;
}

/** `status` alanı → sebep (mesaj sınıflandırılamadığında kullanılır). */
function _reasonFromStatus(status: string): GoogleGeocodeReason {
  switch (status) {
    case 'OK':                return 'OK';
    case 'ZERO_RESULTS':      return 'ZERO_RESULTS';
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':  return 'QUOTA_EXCEEDED';
    case 'INVALID_REQUEST':   return 'BAD_REQUEST';
    case 'UNKNOWN_ERROR':     return 'SERVER_ERROR';
    /* REQUEST_DENIED gövde mesajı olmadan AYIRT EDİLEMEZ. "Geçersiz anahtar"
       demek burada UYDURMA olurdu — bilinmiyor denir. */
    case 'REQUEST_DENIED':    return 'UNKNOWN';
    default:                  return 'UNKNOWN';
  }
}

/**
 * TEK yorumlayıcı. Hem bağlantı testi hem gerçek arama yolu bunu kullanır —
 * iki katmanın FARKLI hüküm vermesi yapısal olarak imkânsızdır.
 *
 * @param httpStatus Yanıtın HTTP durumu; yanıt hiç alınamadıysa `null`.
 * @param body       Çözümlenmiş JSON gövde; okunamadıysa `null`.
 */
export function classifyGoogleGeocodeResponse(
  httpStatus: number | null,
  body: GoogleGeocodeBody | null,
): GoogleGeocodeVerdict {
  /* Yanıt hiç yok → taşıma. */
  if (httpStatus === null) return _verdict('TRANSPORT', false, false, HINT.TRANSPORT);

  /* Google hataları HTTP 200 ile de gelir; bu yüzden gövde ÖNCE okunur.
     Gövde yoksa yalnız durum kodu kalır. */
  const rawMsg    = typeof body?.error_message === 'string' ? body.error_message : '';
  const rawStatus = typeof body?.status        === 'string' ? body.status        : '';

  const fromMsg = _reasonFromMessage(rawMsg);
  if (fromMsg !== null) {
    return _verdict(fromMsg, false, fromMsg === 'KEY_INVALID', HINT[fromMsg]);
  }

  if (rawStatus) {
    const r = _reasonFromStatus(rawStatus);
    return _verdict(r, r === 'OK', r === 'KEY_INVALID', HINT[r]);
  }

  /* Gövde yorumlanamadı → yalnız HTTP durumu. */
  if (httpStatus >= 500) return _verdict('SERVER_ERROR', false, false, HINT.SERVER_ERROR);
  if (httpStatus === 429) return _verdict('QUOTA_EXCEEDED', false, false, HINT.QUOTA_EXCEEDED);
  if (httpStatus === 401 || httpStatus === 403) return _verdict('KEY_INVALID', false, true, HINT.KEY_INVALID);
  if (httpStatus === 400) return _verdict('BAD_REQUEST', false, false, HINT.BAD_REQUEST);
  if (httpStatus >= 200 && httpStatus < 300) return _verdict('UNKNOWN', false, false, HINT.UNKNOWN);
  return _verdict('UNKNOWN', false, false, HINT.UNKNOWN);
}

/** LAB/kütük için kısa Türkçe sebep etiketi (PII YOK, anahtar YOK). */
export const GOOGLE_GEOCODE_REASON_LABEL: Readonly<Record<GoogleGeocodeReason, string>> = {
  OK:               'çalışıyor',
  ZERO_RESULTS:     'sonuç yok (sağlayıcı sağlam)',
  KEY_INVALID:      'anahtar geçersiz',
  KEY_RESTRICTED:   'anahtar kısıtlı (site/IP)',
  API_NOT_ENABLED:  'Geocoding API etkin değil',
  BILLING_DISABLED: 'faturalandırma kapalı',
  QUOTA_EXCEEDED:   'kota aşıldı',
  BAD_REQUEST:      'istek biçimi hatalı (ürün kusuru)',
  SERVER_ERROR:     'Google arızası',
  TRANSPORT:        'ulaşılamadı',
  UNKNOWN:          'sınıflandırılamadı',
};
