/**
 * extendedPollEvidence — PR-OBD-DIAG-3: native EXTENDED PID poll kanıtı + JS akış
 * sayaçlarını birleştirip H1/H2/H3/H4 KESİN HÜKMÜNÜ üretir (saf, test edilebilir).
 *
 * KÖK PROBLEM: {@code obdDeep.extended.samples: []} üç farklı arızayı ayıramıyordu.
 * Bu modül native sayaçları (attempted/success/callbackEmitted…) ile JS sayaçlarını
 * (eventsReceived/valuesStored) yan yana koyar → tek raporla neyin nerede koptuğu belli.
 *
 *   H1  configured>0 & attempted=0            → POLL ÇALIŞMADI (burst/poll wiring)
 *   H2  attempted>0 & success=0 & callback=0  → POLL ÇALIŞTI, ECU DEĞER ÜRETMEDİ
 *   H3  success>0 & callback>0 & stored=0     → NATIVE→JS/STORE HATTI (köprü ya da decode)
 *   H4  success>0 & callback>0 & stored>0     → HAT SAĞLIKLI
 *
 * Native çağrı ASYNC (plugin) → {@link refreshExtendedPollEvidence} önce await edilir,
 * sonra {@link getExtendedPollEvidence} senkron okunur (buildObdDeepSnapshot senkron).
 * Fail-soft: eski APK / hata → kanıt yok (NO_NATIVE_EVIDENCE), rapor yine döner.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher, type NativeExtendedPollEvidence } from '../nativePlugin';
import { getExtendedJsCounters } from './extendedPidService';

export type ExtendedPollDecisionCode =
  | 'NO_NATIVE_EVIDENCE'  // eski APK / plugin metodu yok / kanıt hiç tazelenmedi
  | 'NO_NATIVE_EVIDENCE_JS_ALIVE' // native kanıt yok AMA JS akışı poll'un çalıştığını kanıtlıyor
  | 'NO_PIDS'             // hiç extended PID yapılandırılmadı (panel kapalı / keşif boş)
  | 'H1_POLL_DEAD'        // liste var, hiç denenmedi
  | 'H2_ECU_SILENT'       // denendi, değer yok
  | 'H3_BRIDGE_GAP'       // native başarılı+callback ama JS olayı gelmedi (köprü)
  | 'H3_DECODE_GAP'       // JS olayı geldi ama değer saklanmadı (decode)
  | 'H4_HEALTHY'          // uçtan uca akıyor
  | 'UNKNOWN';            // sayaçlar tutarsız

export interface ExtendedPollDecision {
  code: ExtendedPollDecisionCode;
  label: string;
}

export interface ExtendedJsCounters {
  eventsReceived: number; decodeFailures: number; valuesStored: number; valuesCached: number;
}

/**
 * T6: kanıt kanalının üç açık durumu — "sahte başarı" ile "sahte arıza" arasındaki
 * boşluğu kapatır. JS gözlemleri native kanıt YERİNE GEÇMEZ.
 */
export type ExtendedPollEvidenceState =
  /** Native kanıt kanalı yayın yapıyor — sayaçlar gerçek. */
  | 'native_available'
  /** Native kanıt YOK ama JS tarafında gözlem var — poll çalışıyor olabilir, KANIT eksik. */
  | 'native_unavailable_js_only'
  /** Ne native kanıt ne JS gözlemi — hüküm verilemez. */
  | 'insufficient';

export interface ExtendedPollEvidenceSnapshot {
  present: boolean;
  /** T6-B: kanıt önbelleği bu oturumda tazelendi mi — "ölçmedik" ≠ "yok". */
  cacheState: PollEvidenceCacheState;
  /** T6: kanıt kanalının durumu — karar etiketiyle birlikte okunur. */
  evidenceState: ExtendedPollEvidenceState;
  /** Native kanıt yoksa `null` — 'unknown' string'i sahte bilgi üretiyordu. */
  transport: string | null;
  /** Native kanıt yoksa `null` (false DEĞİL — "burst kapalı" iddiası kanıtsızdı). */
  burstEnabled: boolean | null;
  /**
   * Native kanıt yoksa `null`.
   *
   * ESKİ KUSUR (saha snapshot 2026-08-01): `native?.configuredPidCount ?? 0`
   * yazıyordu → kanıt kanalı sussa bile LAB "0 PID yapılandırıldı" diyordu.
   * Bu SAHTE SIFIR: gerçekte kaç PID izlendiği BİLİNMİYORDU. 0 ile bilinmiyor
   * arasındaki fark teşhiste kritiktir (`NO_PIDS` hükmü buna dayanıyor).
   */
  configuredPidCount: number | null;
  configuredPidPreview: string[];
  counters: NativeExtendedPollEvidence['counters'] | null;
  /** Native son BAŞARILI PID — kanıt yoksa null (uydurulmaz). */
  lastSuccessfulPid: string | null;
  /** Native son poll duvar-saati damgası — kanıt yoksa/0 ise null (uydurulmaz). */
  lastPollAt: number | null;
  lastAttempts: NativeExtendedPollEvidence['lastAttempts'];
  js: ExtendedJsCounters;
  decision: ExtendedPollDecision;
  /** Kanıt eksiksiz mi — hüküm çıkarmak için native sayaçlar mevcut ve tutarlı. */
  evidenceComplete: boolean;
}

let _cached: NativeExtendedPollEvidence | null = null;

/**
 * T6-B — ÖNBELLEK TAZELEME DURUMU (telefonda kanıtlandı 2026-08-01).
 *
 * `getExtendedPollEvidence()` SENKRONDUR ve yalnız `_cached`i okur; önbelleği
 * dolduran tek şey ASYNC `refreshExtendedPollEvidence()`tir. CAROS LAB "TÜMÜNÜ
 * KOPYALA" yolu (`carosLabCopySources`) sözleşmesi gereği senkrondur ve bu
 * tazelemeyi ÇAĞIRMAZ.
 *
 * ÖLÇÜLEN SONUÇ (Xiaomi 23090RA98I · Android 13 · debug build):
 *   · Temiz boot → LAB kopyası: `counters:null`, etiket "Kanıt mevcut değil
 *     (eski APK / kanıt tazelenmedi / poll başlamadı)".
 *   · AMA aynı cihazda `CarLauncher.getObdExtendedPollEvidence()` doğrudan
 *     çağrıldığında 43 ms'de TAM yapılandırılmış yanıt döndü — yani native
 *     kanal SAĞLAM, metot MEVCUT. "Eski APK" teşhisi YANLIŞ yönlendiriyordu.
 *   · Önbellek yalnız başka bir yüzey (Runtime Scheduling · KWP Monitor ·
 *     Tanı Gönder) önce açıldığında doluyordu → gözlem sırası bağımlılığı.
 *
 * Bu bayrak "hiç tazelenmedi"yi "kanal yok"tan AYIRIR. Tazeleme davranışı
 * DEĞİŞMEDİ (senkron sözleşme korunur); yalnız hüküm dürüstleşir.
 */
export type PollEvidenceCacheState = 'never_refreshed' | 'refreshed' | 'unsupported' | 'error';

let _refreshState: PollEvidenceCacheState = 'never_refreshed';

/**
 * #526 — ÖNBELLEĞİN TAZELENDİĞİ AN (duvar saati ms). `0` = hiç tazelenmedi.
 *
 * SAHA (2026-08-10): kopyada `lastPollAt` **5 dk 17 sn** bayat görünüyordu ve
 * "extended poll durdu" sanıldı. Poll DURMAMIŞTI — bu blok native önbellekten
 * okunur ve önbelleği yalnız `refreshExtendedPollEvidence()` doldurur; o da
 * yalnız Runtime Scheduling ekranı açıldığında çağrılır. Kopya alınırken açık
 * ekran başkasıydı, yani snapshot son ziyaretten kalmaydı.
 *
 * `cacheState: 'refreshed'` bu tuzağı GİZLİYORDU: yalnız "bir kez tazelendi"
 * demek, "ŞU AN taze" demek DEĞİLDİR. Yaş damgası olmadan okuyucu 5 dakikalık
 * bir snapshot'ı canlı sanıyor. Bundan sonra yaş RAPORLANIR.
 */
let _refreshedAtMs = 0;

/** @internal testler için — tazeleme durumu. */
export function getPollEvidenceCacheState(): PollEvidenceCacheState {
  return _refreshState;
}

/**
 * #526 — önbelleğin tazelendiği an (ms). `null` = hiç tazelenmedi.
 * Çağıran bunu okuma anıyla karşılaştırıp snapshot YAŞINI yazmalıdır.
 */
export function getPollEvidenceRefreshedAt(): number | null {
  return _refreshedAtMs > 0 ? _refreshedAtMs : null;
}

/** Native kanıtı tazele (async plugin çağrısı) — rapor derlemeden önce await edilir. */
export async function refreshExtendedPollEvidence(): Promise<void> {
  // Web/test veya eski APK: metot yok → kanıt yok (fail-soft).
  if (!Capacitor.isNativePlatform() || !CarLauncher.getObdExtendedPollEvidence) {
    _cached = null;
    _refreshState = 'unsupported';   // web/test veya metotsuz APK — GERÇEKTEN yok
    return;
  }
  try {
    const ev = await CarLauncher.getObdExtendedPollEvidence();
    _cached = ev && typeof ev === 'object' ? ev : null;
    _refreshState = 'refreshed';     // kanal cevap verdi (present false olsa bile)
    _refreshedAtMs = Date.now();     // #526: yaş raporlanabilsin
  } catch {
    _cached = null; // köprü hatası → kanıt yok
    _refreshState = 'error';
  }
}

/**
 * Saf karar fonksiyonu — native + JS sayaçlardan H1/H2/H3/H4 hükmü. Test edilebilir
 * (acceptance §11 birebir). Kanıt yoksa NO_NATIVE_EVIDENCE; yapılandırma yoksa NO_PIDS.
 */
export function classifyExtendedPoll(
  native: NativeExtendedPollEvidence | null,
  js: ExtendedJsCounters,
  cacheState: PollEvidenceCacheState = 'refreshed',
): ExtendedPollDecision {
  if (!native || !native.present) {
    /* T6-B (TELEFONDA ÖLÇÜLDÜ 2026-08-01): önbellek bu oturumda HİÇ tazelenmediyse
       elimizde native kanal hakkında HİÇBİR gözlem yoktur. Eski etiket bu durumda
       da "eski APK / poll başlamadı" diyordu — oysa aynı cihazda köprü 43 ms'de
       yanıt veriyordu. Kanıtsız suçlama YASAK: "ölçmedik" ile "yok" ayrılır. */
    if (cacheState === 'never_refreshed') {
      return {
        code: 'NO_NATIVE_EVIDENCE',
        label: 'Kanıt ÖNBELLEĞİ bu oturumda hiç tazelenmedi (LAB kopyası senkrondur) — '
             + 'APK sürümü veya poll durumu hakkında hüküm VERİLEMEZ. '
             + 'Ölçmek için Runtime Scheduling ekranını açıp YENİLE yapın.',
      };
    }
    if (cacheState === 'unsupported') {
      return {
        code: 'NO_NATIVE_EVIDENCE',
        label: 'Native kanıt metodu bu platformda/APK\'da YOK (web/test veya eski APK) — JS akışı: '
             + `${js.eventsReceived} olay / ${js.valuesStored} değer`,
      };
    }
    if (cacheState === 'error') {
      return {
        code: 'NO_NATIVE_EVIDENCE',
        label: 'Native kanıt çağrısı HATA verdi (köprü) — kanal durumu bilinmiyor',
      };
    }
    /* SAHA (snapshot 2026-07-25): native kanıt yokken etiket "eski APK / poll başlamadı"
       diyordu — AMA aynı nesnede `js.eventsReceived=102`, `js.valuesStored=102` vardı.
       Yani poll çalışıyordu; eksik olan POLL DEĞİL, KANIT KANALIYDI. Yanlış etiket
       geliştiriciyi "APK eski" teşhisine sürüklüyordu. Elimizdeki veriyle çelişen
       hüküm kurulmaz (8 Kapı §1 doğruluk). */
    if (js.eventsReceived > 0 || js.valuesStored > 0) {
      return {
        code: 'NO_NATIVE_EVIDENCE_JS_ALIVE',
        label: `Native kanıt kanalı yayın yapmıyor — POLL ÇALIŞIYOR (JS ${js.eventsReceived} olay / ${js.valuesStored} değer)`,
      };
    }
    /* T6-B: buraya YALNIZ cacheState==='refreshed' iken düşülür — yani kanal
       SORULDU ve "kanıt yok" dedi. Eski metin hâlâ "eski APK / kanıt tazelenmedi"
       diyordu; ikisi de bu dalda ARTIK YANLIŞ (tazeledik, metot da vardı).
       Geriye kalan tek dürüst açıklama: poll oturumu hiç başlamadı. */
    return {
      code: 'NO_NATIVE_EVIDENCE',
      label: 'Native kanal SORULDU, kanıt YOK — extended poll oturumu bu bağlantıda hiç başlamadı '
           + '(araç/OBD oturumu yok ya da izlenen PID listesi boş). JS akışı da BOŞ.',
    };
  }
  const c = native.counters;
  if (native.configuredPidCount === 0 && c.attempted === 0) {
    return { code: 'NO_PIDS', label: 'Yapılandırılan extended PID yok — panel açılmadı / keşif boş' };
  }
  if (c.attempted === 0) {
    return { code: 'H1_POLL_DEAD', label: 'POLL ÇALIŞMADI — burst/poll wiring tetiklenmedi' };
  }
  if (c.success === 0 && c.callbackEmitted === 0) {
    return { code: 'H2_ECU_SILENT', label: 'POLL ÇALIŞTI, ECU DEĞER ÜRETMEDİ (NO_DATA/timeout/negatif)' };
  }
  if (c.callbackEmitted > 0 && js.valuesStored === 0) {
    if (js.eventsReceived === 0) {
      return { code: 'H3_BRIDGE_GAP', label: 'NATIVE BAŞARILI ama JS OLAY GELMEDİ — native→JS köprü hattı' };
    }
    return { code: 'H3_DECODE_GAP', label: 'JS OLAY GELDİ ama DEĞER SAKLANMADI — decode/registry hattı' };
  }
  if (c.success > 0 && c.callbackEmitted > 0 && js.valuesStored > 0) {
    return { code: 'H4_HEALTHY', label: 'HAT SAĞLIKLI — native→JS→store uçtan uca akıyor' };
  }
  return { code: 'UNKNOWN', label: 'Belirsiz — sayaçlar tutarsız (kanıt eksik)' };
}

/** Senkron birleşik kanıt — buildObdDeepSnapshot bunu gömer. */
export function getExtendedPollEvidence(): ExtendedPollEvidenceSnapshot {
  const js = getExtendedJsCounters();
  const native = _cached;
  const decision = classifyExtendedPoll(native, js, _refreshState);
  const present = !!(native && native.present);
  // T6: kanıt YOKKEN JS gözlemi native başarı gibi SUNULMAZ — ayrı durum taşır.
  const hasJsObservation = js.eventsReceived > 0 || js.valuesStored > 0;
  const evidenceState: ExtendedPollEvidenceState = present
    ? 'native_available'
    : hasJsObservation ? 'native_unavailable_js_only' : 'insufficient';
  return {
    present,
    cacheState: _refreshState,
    evidenceState,
    // Kanıt yoksa alanlar NULL — uydurma varsayılan ('unknown'/false/0) YOK.
    transport: present ? (native?.transport ?? null) : null,
    burstEnabled: present ? (native?.burstEnabled ?? null) : null,
    configuredPidCount: present ? (native?.configuredPidCount ?? null) : null,
    configuredPidPreview: present ? (native?.configuredPidPreview ?? []) : [],
    counters: native?.counters ?? null,
    /* SAHA (2026-07-25): bu iki alan native yanıtta VARDI ama anlık görüntüye taşınmıyordu →
       Poll Scheduler ekranında "son poll zamanı" ve "son başarılı PID" HER ZAMAN "KAYNAK YOK"
       görünüyordu. 0 damgası "bilinmiyor" demektir, ISO tarihine çevrilmez. */
    lastSuccessfulPid: native?.lastSuccessfulPid ?? null,
    lastPollAt: native && native.lastPollAt > 0 ? native.lastPollAt : null,
    lastAttempts: native?.lastAttempts ?? [],
    js,
    decision,
    // Hüküm ancak native sayaçlar mevcut + tutarlı ise "tam"dır.
    evidenceComplete: present && (native?.coherent ?? false),
  };
}

/** Test yardımcıları — üretim kodu çağırmaz. */
export const _internals = {
  reset(): void { _cached = null; _refreshState = 'never_refreshed'; },
  setCached(ev: NativeExtendedPollEvidence | null): void { _cached = ev; _refreshState = 'refreshed'; },
  setCacheState(st: PollEvidenceCacheState): void { _refreshState = st; },
};
