/**
 * adapterIdentityService — `adapterCapability` saf sınıflandırıcısının ÜRÜN KÖPRÜSÜ.
 *
 * NEDEN AYRI DOSYA: `adapterCapability.ts` bilinçli olarak SAFtır (modül durumu yok, I/O
 * yok, tam test edilebilir). Ona durum/I/O eklemek o sözleşmeyi bozardı. Bu dosya köprüyü
 * kurar: native'den ham kimliği ALIR → saf sınıflandırıcıya VERİR → sonucu SAKLAR.
 *
 * ── ZERO-TRUST (modülün kendi kuralının devamı) ─────────────────────────────
 * Sonuç bir ÖLÇÜMDÜR, varsayım değil. Prob hiç koşmadıysa `null` döner — "unknown"
 * DÖNMEZ, çünkü "sorduk ve bilemedik" ile "hiç sormadık" AYRI şeylerdir. Bu ayrım
 * kaybolursa gözlem ekranı "adaptör kimliği okunamadı" der ve okuyan, probun hiç
 * çalışmadığını anlayamaz (#675/#679 sınıfı: kapı var ama hüküm okunmuyor).
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Prob patlarsa/plugin metodu yoksa oturum ETKİLENMEZ: OBD akışı aynen sürer, yalnız
 * sınıflandırma yapılmamış olur. Adaptör kimliği bir KONFOR bilgisidir; onun yokluğu
 * veri akışını durdurmaz.
 *
 * ── TEK SEFER ───────────────────────────────────────────────────────────────
 * Kimlik oturum boyunca DEĞİŞMEZ (aynı fiziksel donanım). Bu yüzden bağlantı başına
 * TEK prob çalışır — ELM kuyruğuna tekrar tekrar yük binmez (Mali-400 kuralı).
 * Bağlantı koptuğunda `resetAdapterIdentity()` ile temizlenir: yeni bağlantı BAŞKA bir
 * adaptör olabilir (sahada yaşandı: aynı dongle başka araca, başka dongle aynı araca).
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { classifyAdapter, type AdapterCapabilities } from './adapterCapability';

/** Prob sonucu — `null` = prob HİÇ koşmadı (bkz. zero-trust notu). */
let _caps: AdapterCapabilities | null = null;
/** Ham yanıt (teşhis için saklanır; sınıflandırma değil KANIT). */
let _raw: string | null = null;
/** Prob denendi mi — `_caps === null` iken "denenmedi" ile "başarısız"ı ayırır. */
let _attempted = false;
/** Aynı bağlantıda ikinci probu engeller (tek sefer kuralı). */
let _inFlight: Promise<AdapterCapabilities | null> | null = null;

/** Sınıflandırılmış yetenekler; prob koşmadıysa/başarısızsa `null`. */
export function getAdapterCapabilities(): AdapterCapabilities | null {
  return _caps;
}

/** Ham `"ATI|AT@1|STDI"` yanıtı — hüküm değil kanıt. Prob koşmadıysa `null`. */
export function getAdapterIdentityRaw(): string | null {
  return _raw;
}

/**
 * Prob denendi mi? Gözlem ekranı bunu AYRI göstermelidir:
 *  · `false` → henüz sorulmadı (bağlantı yok / plugin metodu yok)
 *  · `true` + `getAdapterCapabilities() === null` → soruldu, yanıt alınamadı
 */
export function wasAdapterProbeAttempted(): boolean {
  return _attempted;
}

/**
 * Adaptör kimliğini bir kez sorar ve sınıflandırır.
 *
 * @returns sınıflandırma; prob yapılamadıysa `null` (çağıran akışı DURDURMAZ).
 */
export function probeAdapterIdentity(): Promise<AdapterCapabilities | null> {
  if (_caps) return Promise.resolve(_caps);
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      /* Web/demo modunda native yok — prob DENENMEDİ sayılır (yanlış "unknown" üretme). */
      if (!Capacitor.isNativePlatform()) return null;
      const fn = CarLauncher.probeAdapterIdentity;
      /* Eski plugin sürümünde metot yok → graceful degrade (nativePlugin'deki `?` sözleşmesi). */
      if (typeof fn !== 'function') return null;

      _attempted = true;
      const res = await fn.call(CarLauncher);
      const raw = typeof res?.raw === 'string' ? res.raw : '';
      /* Tamamen boş yanıt sınıflandırılmaz: `classifyAdapter('')` 'unknown' üretirdi ve bu,
         "sorduk, cihaz sustu" ile "hiç yanıt gelmedi"yi aynı kovaya atardı. */
      if (raw.trim().length === 0) return null;

      _raw = raw;
      _caps = classifyAdapter(raw);
      return _caps;
    } catch {
      /* FAIL-SOFT: prob patlasa da OBD akışı sürer. `_attempted` true kalır —
         "denendi ama olmadı" bilgisi gözlem için DEĞERLİDİR. */
      return null;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/**
 * Bağlantı koptuğunda çağrılır — kimlik bir SONRAKİ bağlantıya taşınmaz.
 * Aynı dongle başka araca ya da başka dongle aynı araca takılabilir; eski kimliği
 * yeni bağlantıya devretmek, ölçümü varsayıma çevirir.
 */
export function resetAdapterIdentity(): void {
  _caps = null;
  _raw = null;
  _attempted = false;
  _inFlight = null;
}
