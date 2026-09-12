/**
 * connectAuthority — P0-OBD-CORE-06 · ELM327 HATTININ SAHİBİ KİM? (saf model)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * ELM327 hattı TEK KULLANICILIDIR: aynı anda iki motor komut gönderemez, iki
 * soket açılamaz. Ama `obdService` içinde hattı ele geçirebilen DÖRT yol vardı
 * ve her biri KENDİ bayrağına bakıyordu:
 *
 *   1. `_startNative()`          — connect denemesi (15–40 sn sürebilir)
 *   2. `_scheduleReconnect()`    — üstel merdiven (+ derin döngü)
 *   3. `_resumeFromForeground()` — uygulama öne gelince
 *   4. `_maybeRunEcuRecovery()`  — ECU susunca ATPC/ATWS merdiveni
 *
 * Kapılar dağınık olduğu için sahada şu ölçüldü: merdiven timer'ı ateşler
 * (`_reconnectTimer = null` olur) → connect 40 sn uçuşta kalır → o pencerede
 * foreground-resume "reconnect_pending değil, poll da durmuş" deyip İKİNCİ bir
 * `connectOBD()` başlatır → native `connect()` ilk iş olarak `disconnect()`
 * çağırdığı için BİRİNCİNİN soketini kapatır → birinci `CONNECT_FAILED` ile
 * düşer → onun catch'i merdiveni yeniden kurar → fırtına. 17 başarısız
 * denemenin bir kısmı **araçtan değil, bizden** geliyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * Bu modül KARAR VERİR, İŞ YAPMAZ: timer kurmaz, komut göndermez, `Date.now()`
 * okumaz, global durum tutmaz. `obdService` her kapıda buraya sorar; böylece
 * "aynı anda tek sahip" kuralı TEK YERDE yaşar ve unit test edilebilir.
 *
 * ÖNCELİK (yukarıdan aşağı — üstteki alttakini bekletir):
 *   connect  >  native_reconnect  >  recovery  >  reconnect_pending  >  idle
 *
 * `connect` en üsttedir çünkü fiziksel soketi O açar; `recovery` transport'a
 * dokunmaz ama ELM oturumunu sıfırlar → kurulmakta olan bir oturumu bozabilir.
 */

/** Hattı şu an kimin tuttuğu — ham durum bayraklarından türetilir. */
export type ObdLineOwner =
  | 'connect'            // uçuşta bir connect denemesi var (soket açılıyor)
  | 'native_reconnect'   // otorite native tarafta (F0-5 devri)
  | 'recovery'           // ECU oturum kurtarması (ATPC/ATWS) sürüyor
  | 'reconnect_pending'  // merdiven timer'ı kurulu, henüz ateşlemedi
  | 'idle';              // sahipsiz

/** Kararların TEK girdisi. Hepsi boolean — zaman/eşik BURADA yok. */
export interface ObdLineState {
  /** `_connectAttempt !== null` — uçuşta connect denemesi. */
  readonly connectInFlight: boolean;
  /** `_reconnectTimer !== null` — merdiven tetiği beklemede. */
  readonly reconnectPending: boolean;
  /** `_nativeReconnectInFlight` — otorite native'de. */
  readonly nativeReconnectInFlight: boolean;
  /** `_recoveryInFlight` — ECU oturum kurtarması uçuşta. */
  readonly recoveryInFlight: boolean;
}

/** Hattın sahibi (öncelik sırasıyla ilk eşleşen). */
export function lineOwner(s: ObdLineState): ObdLineOwner {
  if (s.connectInFlight)         return 'connect';
  if (s.nativeReconnectInFlight) return 'native_reconnect';
  if (s.recoveryInFlight)        return 'recovery';
  if (s.reconnectPending)        return 'reconnect_pending';
  return 'idle';
}

/**
 * Yeni bir transport reconnect TURU açılabilir mi?
 *
 * Uçuşta bir deneme varken YENİ TUR AÇILMAZ: o denemenin kendi sonucu zaten
 * (başarı → sıfırlama, hata → merdiven) doğru yolu seçecektir. Kopma bilgisi
 * KAYBOLMAZ, yalnız ikinci bir otorite doğmaz.
 *
 * `nativeReconnectInFlight` burada BLOKLAMAZ — o kapı çağıran tarafta ayrıca
 * uygulanır (mevcut F0-5 sözleşmesi birebir korunur).
 */
export function canScheduleTransportReconnect(s: ObdLineState): boolean {
  return !s.connectInFlight;
}

/**
 * Merdiven tetiği ateşlendi: şimdi mi bağlanılsın, yoksa kurtarmaya mı yol verilsin?
 *
 * Kurtarma sürerken bağlanmak, kurtarmanın altındaki oturumu kapatır (iki motor).
 * Tetik İPTAL EDİLMEZ — gerçek bir kopma kaybolurdu; yalnız kısa süre geri
 * çekilir. Geri çekilme SONSUZ DEĞİLDİR: kurtarma takılırsa reconnect aç kalmaz.
 *
 * @param yieldsUsed Bu tetiğin şimdiye dek kaç kez geri çekildiği.
 * @param maxYields  Geri çekilme tavanı.
 */
export function reconnectFireDecision(
  s: ObdLineState,
  yieldsUsed: number,
  maxYields: number,
): 'start' | 'yield_to_recovery' {
  if (s.recoveryInFlight && yieldsUsed < maxYields) return 'yield_to_recovery';
  return 'start';
}

/**
 * ECU oturum kurtarması (ATPC/ATWS) başlatılabilir mi?
 *
 * Transport tarafı çalışıyorsa (uçuşta deneme ya da beklemede tetik) sıra
 * ONUNDUR: kurulmakta olan bir oturumu ELM seviyesinde sıfırlamak, kurtarmayı
 * da bağlantıyı da düşürür. Kapı KAPANMAZ — kurtarma bir sonraki gözcü turunda
 * yeniden bakar.
 */
export function canStartEcuRecovery(s: ObdLineState): boolean {
  return !s.connectInFlight && !s.reconnectPending && !s.nativeReconnectInFlight;
}

/**
 * Foreground'da müdahale (yeni connect denemesi) YAPILABİLİR Mİ?
 *
 * Hat sahipsiz DEĞİLSE hayır. Bu, sahadaki fırtınanın tetikleyicisini kapatan
 * kuraldır: eski kod yalnız `reconnectPending` ve `recoveryInFlight` bakıyordu;
 * `connectInFlight` penceresi (denemenin TAM ORTASI) açıkta kalıyordu.
 */
export function canResumeFromForeground(s: ObdLineState): boolean {
  return lineOwner(s) === 'idle';
}
