/**
 * aiGatewayAccess.ts — AI GATEWAY KAPSAMLI ERİŞİM + HAZIRLIK (SAF ÇEKİRDEK).
 *
 * ── ÇÖZÜLEN SORUN ──────────────────────────────────────────────────────
 * `isAiGatewayEnabled()` bugün TEK bir global bayrağa bakar
 * (`feature_flags.mavi_ai_gateway`). O tablonun ŞİRKET KAPSAMI YOKTUR ve
 * `anon` için `USING(true)` okunur → oradan açmak AI zincirini **dünyadaki
 * her cihazda** aynı anda açardı. Bu modül global bayrağı bir **ANA ŞALTER**
 * olarak bırakır ve üstüne KAPSAM koyar:
 *
 *     ETKİN = ana şalter AND (şirket izni VEYA araç izni)
 *
 * ── "AÇIK" ≠ "HAZIR" (bağlayıcı ayrım) ─────────────────────────────────
 * İzin verilmiş olması sistemin ÇALIŞABİLECEĞİ anlamına gelmez. Sağlayıcı
 * anahtarı (LLM key) yoksa zincir ilk çağrıda düşer. Bu yüzden iki durum
 * AYRI tutulur ve LAB'da AYRI gösterilir:
 *   · `access`   — izin var mı (sunucu kararı)
 *   · `provider` — sağlayıcı anahtarı var mı (cihaz kararı)
 *   · `ready`    — ikisi birden
 * Anahtar yokken sistem "aktif" GÖSTERİLMEZ (görev şartı).
 *
 * ── FAIL-CLOSED ────────────────────────────────────────────────────────
 * Okunamayan her şey KAPALI sayılır. Bilinmeyen bir durum "aç" demek değildir.
 *
 * SAF: I/O YOK · timer YOK · React YOK · `Date.now()` YOK. Ağ okuması
 * `aiGatewayAccessRuntime` tarafından yapılır ve buraya BESLENİR.
 */

/* ── Kapsamlı erişim anlık görüntüsü (sunucudan) ───────────────────────── */

export interface AiGatewayAccessSnapshot {
  /** Global ana şalter (`feature_flags.mavi_ai_gateway`). */
  readonly killSwitchOn: boolean;
  /** Bu şirket için genel izin. */
  readonly companyGranted: boolean;
  /** Araç-özel izin sayısı (kademeli açılış). */
  readonly vehicleGrantCount: number;
  /** Sunucunun hesapladığı etkin izin. */
  readonly effective: boolean;
}

/** Hiç okunmamış / okunamamış durum — her alan KAPALI (fail-closed). */
export const UNREAD_ACCESS: AiGatewayAccessSnapshot = Object.freeze({
  killSwitchOn: false,
  companyGranted: false,
  vehicleGrantCount: 0,
  effective: false,
});

/**
 * Erişim kaynağı — LAB "neden açık/kapalı" sorusunu yanıtlar.
 * `LOCAL_OVERRIDE` yalnız geliştirici kaldıracıdır ve satış yolunda YOKTUR.
 */
export type AiGatewaySource =
  | 'NOT_READ'          // sunucu hiç okunmadı
  | 'KILL_SWITCH_OFF'   // ana şalter kapalı → kapsam sorulmaz bile
  | 'NO_GRANT'          // ana şalter açık ama bu şirkete izin yok
  | 'COMPANY_GRANT'
  | 'VEHICLE_GRANT'
  | 'LOCAL_OVERRIDE';

/**
 * Sağlayıcı (LLM) hazırlığı — ALTI AYRI DURUM.
 *
 * ⚠️ "Anahtar var" ≠ "hazır". Bir anahtarın varlığı sağlayıcının erişilebilir
 * olduğunu KANITLAMAZ. Bu yüzden yapılandırma ile erişilebilirlik ayrı ayrı
 * adlandırılır; yalnız `READY` gerçekten kullanılabilir demektir.
 *
 *   UNKNOWN        — hiç ölçülmedi (kaçış değil, CEVAP)
 *   NOT_CONFIGURED — hiçbir yapılandırma yok (anahtar girilmemiş)
 *   CONFIGURED     — anahtar VAR ama erişilebilirlik DOĞRULANMADI
 *   READY          — anahtar var VE sağlayıcıya erişildi
 *   DEGRADED       — erişildi ama sınırlı/hatalı (kota, yavaş, kısmi)
 *   FAILED         — yapılandırılmış ama erişilemiyor
 */
export type AiProviderReadiness =
  | 'UNKNOWN' | 'NOT_CONFIGURED' | 'CONFIGURED' | 'READY' | 'DEGRADED' | 'FAILED';

/** Hazırlık ölçümünün künyesi — LAB "kaynak · yaş · son hata" gösterir. */
export interface AiProviderReadinessInfo {
  readonly state: AiProviderReadiness;
  /** Ölçümün nereden geldiği (bounded — serbest metin yok). */
  readonly source: 'NOT_MEASURED' | 'CONFIG_ONLY' | 'PROBE';
  /** Ölçüm anı (epoch ms); `null` = hiç ölçülmedi. */
  readonly measuredAt: number | null;
  /**
   * Son başarısızlığın bounded SINIFI — ham hata metni, endpoint, token veya
   * secret ASLA taşınmaz.
   */
  readonly lastFailure: 'NONE' | 'NO_KEY' | 'UNREACHABLE' | 'TIMEOUT' | 'REJECTED' | 'UNKNOWN_ERROR';
}

export const UNMEASURED_PROVIDER: AiProviderReadinessInfo = Object.freeze({
  state: 'UNKNOWN' as const,
  source: 'NOT_MEASURED' as const,
  measuredAt: null,
  lastFailure: 'NONE' as const,
});

/**
 * Sağlayıcı GERÇEKTEN kullanılabilir mi.
 *
 * YALNIZ `READY` yeterlidir. `CONFIGURED` bilinçle YETMEZ: anahtarın varlığı
 * erişilebilirlik kanıtı değildir ve "AI açık" demek zincirin ilk çağrıda
 * düşeceğini gizlerdi.
 */
export function isProviderUsable(p: AiProviderReadiness): boolean {
  return p === 'READY';
}

/** LAB ve ürün kodunun okuduğu birleşik durum. */
export interface AiGatewayStatus {
  /** İzin verilmiş mi (sunucu kararı). */
  readonly accessGranted: boolean;
  readonly source: AiGatewaySource;
  readonly provider: AiProviderReadiness;
  /**
   * GERÇEKTEN kullanılabilir mi. `accessGranted && provider==='CONFIGURED'`.
   * Ürün kodu YALNIZ bunu okur — "izin var ama anahtar yok" durumu
   * kullanıcıya "AI açık" diye gösterilemez.
   */
  readonly ready: boolean;
  readonly snapshot: AiGatewayAccessSnapshot;
}

/**
 * SAF durum türetimi — tüm kapılar burada, tek yerde.
 *
 * `localOverride` yalnız geliştirici kaldıracıdır; ana şalteri EZMEZ mi?
 * EZER — ama bilinçli olarak: geliştirici cihazında sunucuya bağlanmadan
 * zincir denenebilmelidir. Satış build'inde bu kaldıraç için UI yoktur ve
 * `LOCAL_OVERRIDE` kaynağı LAB'da AÇIKÇA görünür (gizli açılış YOK).
 */
export function deriveGatewayStatus(input: {
  readonly snapshot: AiGatewayAccessSnapshot | null;
  readonly localOverride: boolean;
  readonly provider: AiProviderReadiness;
}): AiGatewayStatus {
  const snap = input.snapshot ?? UNREAD_ACCESS;

  let accessGranted = false;
  let source: AiGatewaySource = 'NOT_READ';

  if (input.localOverride) {
    accessGranted = true;
    source = 'LOCAL_OVERRIDE';
  } else if (input.snapshot === null) {
    accessGranted = false;
    source = 'NOT_READ';                       // okunmadı ≠ kapalı; ama fail-closed
  } else if (!snap.killSwitchOn) {
    accessGranted = false;
    source = 'KILL_SWITCH_OFF';
  } else if (snap.companyGranted) {
    accessGranted = true;
    source = 'COMPANY_GRANT';
  } else if (snap.vehicleGrantCount > 0) {
    accessGranted = true;
    source = 'VEHICLE_GRANT';
  } else {
    accessGranted = false;
    source = 'NO_GRANT';
  }

  return Object.freeze({
    accessGranted,
    source,
    provider: input.provider,
    /* "Açık" tek başına yetmez ve "anahtar var" da yetmez: sağlayıcı
       GERÇEKTEN erişilebilir (READY) olmadıkça sistem HAZIR sayılmaz.
       Yerel geliştirici kaldıracı bu kapıyı EZEMEZ — izin verebilir ama
       sağlayıcıyı hazır YAPAMAZ. */
    ready: accessGranted && isProviderUsable(input.provider),
    snapshot: snap,
  });
}

/** LAB için insan-okur kaynak etiketi (bounded — serbest metin yok). */
export function gatewaySourceLabel(s: AiGatewaySource): string {
  switch (s) {
    case 'NOT_READ':        return 'SUNUCU OKUNMADI';
    case 'KILL_SWITCH_OFF': return 'ANA ŞALTER KAPALI';
    case 'NO_GRANT':        return 'BU ŞİRKETE İZİN YOK';
    case 'COMPANY_GRANT':   return 'ŞİRKET İZNİ';
    case 'VEHICLE_GRANT':   return 'ARAÇ İZNİ (kademeli)';
    case 'LOCAL_OVERRIDE':  return 'YEREL GELİŞTİRİCİ KALDIRACI';
  }
}

/** LAB için sağlayıcı hazırlık etiketi. */
export function providerReadinessLabel(p: AiProviderReadiness): string {
  switch (p) {
    case 'UNKNOWN':        return 'ÖLÇÜLMEDİ';
    case 'NOT_CONFIGURED': return 'YAPILANDIRILMAMIŞ';
    case 'CONFIGURED':     return 'ANAHTAR VAR (erişim doğrulanmadı)';
    case 'READY':          return 'HAZIR';
    case 'DEGRADED':       return 'KISITLI';
    case 'FAILED':         return 'ERİŞİLEMİYOR';
  }
}

/** LAB için bounded hata sınıfı etiketi. */
export function providerFailureLabel(f: AiProviderReadinessInfo['lastFailure']): string {
  switch (f) {
    case 'NONE':          return 'YOK';
    case 'NO_KEY':        return 'ANAHTAR YOK';
    case 'UNREACHABLE':   return 'SAĞLAYICIYA ULAŞILAMADI';
    case 'TIMEOUT':       return 'ZAMAN AŞIMI';
    case 'REJECTED':      return 'SAĞLAYICI REDDETTİ';
    case 'UNKNOWN_ERROR': return 'SINIFLANDIRILAMAYAN HATA';
  }
}
