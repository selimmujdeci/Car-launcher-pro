/**
 * nativeHttp — CORS duvarını aşan POST taşıması (yalnız AI sağlayıcıları için).
 *
 * SAHA (#699, cihazda CDP ile KANITLANDI, 2026-08-22): `api.anthropic.com`
 * WebView'dan `fetch` ile çağrıldığında yanıta CORS başlığı gelmediği için
 * istek **`TypeError: Failed to fetch`** ile ölür — HTTP durumu bile oluşmaz.
 * Kullanıcının anahtarı GEÇERLİYKEN (`sk-ant…`, 108 karakter) Claude Haiku
 * halkası bu yüzden HİÇ çalışmıyordu; zincirin sessizce ölmesine bakıp
 * "anahtarın geçersiz/limitin bitmiş" demek YANLIŞ teşhisti.
 *
 * AYNI istek native katmandan atıldığında gerçek yanıt geldi:
 *   fetch  → THROW "Failed to fetch"
 *   native → 401 {"error":{"message":"x-api-key header is required"}}
 * yani sunucuya ULAŞILIYOR; eksik olan yalnız taşımaydı.
 *
 * Bu modül SAF bir taşıma katmanıdır: prompt/anahtar YORUMLAMAZ, kaydetmez,
 * loglamaz. Native yoksa (tarayıcı/dev) `fetch`e düşer — davranış aynıdır.
 */

/** `Response`un bu kod yolunda kullanılan asgari yüzeyi (fail-soft sözleşme). */
export interface AiHttpResponse {
  readonly ok:     boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

interface CapacitorHttpPlugin {
  request(options: {
    url:             string;
    method:          string;
    headers:         Record<string, string>;
    data:            unknown;
    connectTimeout?: number;
    readTimeout?:    number;
  }): Promise<{ status: number; data: unknown }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { CapacitorHttp?: CapacitorHttpPlugin };
}

/** Native HTTP eklentisi — yoksa `null` (tarayıcı/dev veya eski kabuk). */
function _nativeHttp(): CapacitorHttpPlugin | null {
  try {
    const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.CapacitorHttp ?? null;
  } catch { return null; }
}

/** Native taşıma bu ortamda kullanılabilir mi? (kilit/tanı için) */
export function isNativeHttpAvailable(): boolean {
  return _nativeHttp() !== null;
}

/**
 * JSON POST — native varsa CORS'suz native katmandan, yoksa `fetch` ile.
 *
 * Native yol `AbortSignal` KULLANMAZ (native istek JS sinyalini dinlemez);
 * süre bütçesi `connectTimeout`/`readTimeout` ile aynı anlamda uygulanır.
 * Native çağrı throw ederse `fetch`e DÜŞÜLMEZ: sessiz çift istek (ve çift
 * fatura) üretmemek için hata çağırana aynen bırakılır — çağıranın zaten
 * fail-soft zinciri vardır.
 */
export async function aiPostJson(
  url:       string,
  headers:   Record<string, string>,
  body:      unknown,
  timeoutMs: number,
  signal?:   AbortSignal,
): Promise<AiHttpResponse> {
  const native = _nativeHttp();
  if (native) {
    const res = await native.request({
      url,
      method:         'POST',
      headers,
      data:           body,
      connectTimeout: timeoutMs,
      readTimeout:    timeoutMs,
    });
    /* Native katman gövdeyi ZATEN çözer (string ya da nesne olabilir);
       `json()` her iki hâli de aynı sözleşmeye indirger. */
    const data = res.data;
    return {
      ok:     res.status >= 200 && res.status < 300,
      status: res.status,
      json:   async () => (typeof data === 'string' ? JSON.parse(data) as unknown : data),
    };
  }

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
    signal,
  });
  return {
    ok:     resp.ok,
    status: resp.status,
    json:   () => resp.json() as Promise<unknown>,
  };
}
