import {
  authorizePairingContinuation,
} from '@/security/accountCleanup/accountCleanupRuntime';
import { supabaseBrowser } from '@/lib/supabase';

// ── Storage keys ─────────────────────────────────────────────────────────────
const STORAGE = {
  VEHICLE_ID:    'caros_pair_vehicle_id',
  API_KEY:       'caros_pair_api_key',
  VEHICLE_NAME:  'caros_pair_vehicle_name',
  VEHICLE_PLATE: 'caros_pair_vehicle_plate',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PairResult {
  success:    boolean;
  vehicleId?: string;
  message:    string;
  /**
   * Sunucuya ULAŞILAMADI (ağ hatası) — bu bir RED DEĞİLDİR.
   * Çağıran bunu görürse çevrimdışı claim üretir; "başarısız" DEMEZ.
   */
  offline?:   boolean;
  /**
   * #643 — "ULAŞILAMADI"nın SEBEBİ. `offline` yalnız "tekrar denenebilir" der;
   * KULLANICIYA GÖSTERİLEN cümle bu alandan türer.
   *
   * SAHA (2026-08-19): kullanıcı 5G ile tam sinyaldeyken ekranda
   * *"Çevrimdışısınız"* yazıyordu. Sebep: sunucu 5xx/429 dönünce istemci bunu
   * `offline` sayıyor, ekran da CİHAZI suçluyordu. Cihazın çevrimdışı olması
   * ile sunucunun düşmesi AYNI ŞEY DEĞİLDİR ve kullanıcıya farklı şey söyler.
   */
  reason?:    PairFailureReason;
  /** Sunucu yanıt verdiyse HTTP durumu (teşhis için; yanıt yoksa `undefined`). */
  httpStatus?: number;
  /** Sunucunun typed hata kodu (döndürdüyse) — conflict sınıflandırması için. */
  code?:      string;
}

/* #643 — sınıflandırma SAF modelde (`pairing/pairFailureModel`); burada yalnız
   yeniden dışa aktarılır ki çağıranlar tek yerden alsın (ikinci tanım YOK). */
export type { PairFailureReason } from './pairing/pairFailureModel';

export interface LocalVehicle {
  id:     string;
  name:   string;
  plate:  string;
  apiKey: string;
}

// ── Local storage helpers ─────────────────────────────────────────────────────

function storeLocalVehicle(v: LocalVehicle): void {
  try {
    localStorage.setItem(STORAGE.VEHICLE_ID,    v.id);
    localStorage.setItem(STORAGE.API_KEY,       v.apiKey);
    localStorage.setItem(STORAGE.VEHICLE_NAME,  v.name);
    localStorage.setItem(STORAGE.VEHICLE_PLATE, v.plate);
  } catch { /* quota — silently ignore */ }
}

/**
 * Returns the locally paired vehicle, or null if none.
 *
 * ⚠️ `api_key` ARTIK ZORUNLU DEĞİLDİR (#631). Kanonik eşleştirme rotası
 * anahtar döndürmez (eski rota ham anahtar döndürdüğü için kapatılmıştı);
 * oturumlu modda komutlar kullanıcı JWT'siyle gider. Eski kod `!apiKey` ise
 * `null` dönüyordu — bu, yeni akışla eşleştirilen aracın PWA'da HİÇ
 * GÖRÜNMEMESİNE yol açardı. Kimliğin tek şartı `vehicleId`dir.
 */
export function getLocalVehicle(): LocalVehicle | null {
  try {
    const id = localStorage.getItem(STORAGE.VEHICLE_ID);
    if (!id) return null;
    return {
      id,
      apiKey: localStorage.getItem(STORAGE.API_KEY) ?? '',
      name:  localStorage.getItem(STORAGE.VEHICLE_NAME)  ?? 'Araç',
      plate: localStorage.getItem(STORAGE.VEHICLE_PLATE) ?? '—',
    };
  } catch { return null; }
}

/** Removes all local pairing data (unpair). */
export function clearLocalVehicle(): void {
  try {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
  } catch { /* non-critical */ }
}

/**
 * Returns the stored api_key for a given vehicleId.
 * Used by commandService for E2E payload encryption.
 */
export function getStoredApiKey(vehicleId: string): string | null {
  try {
    const storedId = localStorage.getItem(STORAGE.VEHICLE_ID);
    if (storedId !== vehicleId) return null;
    /* Boş dize anahtar DEĞİLDİR: kanonik eşleştirme anahtar döndürmez ve o
       durumda çağıran "anahtar yok" görmeli (oturumsuz mod gerçekten
       çalışamaz), sahte bir anahtarla şifreleme denememeli. */
    const key = localStorage.getItem(STORAGE.API_KEY);
    return key && key.length > 0 ? key : null;
  } catch { return null; }
}

// ── Pairing ───────────────────────────────────────────────────────────────────

/** Kanonik eşleştirme rotası — TEK otorite. */
import {
  classifyHttpFailure, classifyRequestFailure, type PairFailureReason,
} from './pairing/pairFailureModel';

export const PAIRING_ENDPOINT = '/api/vehicle/link';

/**
 * PWA, aracı DOĞRUDAN kendi ekranından eşleştirir (#631).
 *
 * ── NEDEN DEĞİŞTİ (kullanıcı + kaynak ölçümü, 2026-08-18) ───────────────────
 * Kullanıcı: *"pwa sadece araç uygulaması ile işlemeli, filo da araç ile
 * eşleşmesi ikisi ayrı."* Ölçülen durum: bu fonksiyon `/api/pwa/pair`'i
 * çağırıyordu ve o rota **410 ile KALICI KAPALI**. Yani PWA'daki "Eşleştir"
 * düğmesi hiçbir koşulda çalışmıyordu; ekran kullanıcıyı *"Filo panosu → Araç
 * Ekle"*ye yönlendiriyordu. Bireysel kullanıcı için "filo panosu" kavramı
 * anlamsızdır ve eşleştirme oradan geçmek zorunda DEĞİLDİR.
 *
 * ── NEDEN BU ROTA DOĞRU ─────────────────────────────────────────────────────
 * `pair_vehicle_to_user()` RPC'si bireysel eşleştirmeyi ZATEN destekliyor:
 * `company_id` null olabilir, `is_individual` döner ve bireysel hesaba 3 araç
 * limiti uygular. Yani "kullanıcı ↔ araç" ilişkisi altyapıda vardı; eksik olan
 * yalnız PWA'nın bu rotayı çağırmasıydı ("motor var, besleyen yok").
 * Filo ↔ araç eşleşmesi AYRI akış olarak (Filo panosu) yerinde kalır.
 *
 * ── GÜVENLİK: OTURUM ARTIK ŞART ─────────────────────────────────────────────
 * Eski rota oturumsuz çalışıp yanıtta HAM `api_key` döndürüyordu — kapatılma
 * sebeplerinden biri buydu. Kanonik rota kullanıcı JWT'si ister ve anahtar
 * DÖNDÜRMEZ. Komut gönderimi bundan etkilenmez: `sendCommand` oturum varsa
 * zaten Supabase oturumuyla çalışır; `api_key` yalnız oturumsuz (standalone)
 * mod içindir.
 */
export async function pairVehicle(code: string): Promise<PairResult> {
  const access = await authorizePairingContinuation();
  if (!access.allowed) {
    return {
      success: false,
      code: 'ACCOUNT_CLEANUP_IN_PROGRESS',
      message: 'Güvenli oturum temizliği sırasında eşleştirme kullanılamaz.',
    };
  }

  /* Oturum yoksa sunucuya gitmeyiz: rota 401 dönerdi ve kullanıcı sebebini
     anlamazdı. Bu bir AĞ hatası değildir → `offline` İŞARETLENMEZ (yoksa
     çevrimdışı kuyruğa yazılır ve sonsuza dek 401 alırdı). */
  let token: string | null = null;
  try {
    const session = supabaseBrowser
      ? (await supabaseBrowser.auth.getSession()).data.session
      : null;
    token = session?.access_token ?? null;
  } catch { token = null; }

  if (!token) {
    return {
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Aracı hesabına bağlamak için önce giriş yapmalısın.',
    };
  }

  try {
    const res = await fetch(PAIRING_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${token}`,
      },
      body:    JSON.stringify({ code: code.trim() }),
    });

    const data = (await res.json()) as {
      vehicle?: { id?: string; name?: string; plate?: string; company_id?: string | null };
      error?:   string;
      code?:    string;
    };

    if (!res.ok || !data.vehicle?.id) {
      // 5xx/429 sunucu tarafı geçici arıza → RED değil, tekrar denenebilir.
      /* #643: sunucu YANIT VERDİ → cihaz çevrimiçi. "Çevrimdışısınız" DENMEZ. */
      const verdict = classifyHttpFailure(res.status);
      return {
        success: false,
        message: data.error ?? 'Eşleştirme başarısız.',
        offline: verdict.retryable,
        reason:  verdict.reason ?? undefined,
        httpStatus: res.status,
        code:    data.code,
      };
    }

    /* Araç kimliği/adı yerelde tutulur; `api_key` ARTIK SAKLANMAZ — kanonik
       rota anahtar döndürmez ve döndürmemelidir. Oturumlu modda komutlar
       kullanıcı JWT'siyle gider. */
    storeLocalVehicle({
      id:     data.vehicle.id,
      apiKey: '',
      name:   data.vehicle.name  ?? 'Araç',
      plate:  data.vehicle.plate ?? '—',
    });

    return {
      success:   true,
      vehicleId: data.vehicle.id,
      message:   'Araç başarıyla eşleştirildi.',
    };
  } catch {
    /* #643 — İstek hiç tamamlanamadı. Bu, "cihaz çevrimdışı" DEMEK DEĞİLDİR:
       DNS, TLS (ör. sertifikanın alan adını kapsamaması), captive portal veya
       sunucunun erişilemez olması da aynı yola çıkar. Tarayıcı ağı kapalı
       diyorsa öyle deriz; demiyorsa SEBEBİ BİLMİYORUZ ve öyle yazarız. */
    const browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const verdict = classifyRequestFailure(browserOnline);
    return {
      success: false,
      offline: verdict.retryable,
      reason:  verdict.reason ?? undefined,
      message: browserOnline
        ? 'Sunucuya ulaşılamadı (istek tamamlanmadı). Bağlantı gelince otomatik denenecek.'
        : 'Cihaz çevrimdışı. Bağlantı gelince otomatik denenecek.',
    };
  }
}
