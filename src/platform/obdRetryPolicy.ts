/** Maksimum yeniden bağlanma denemesi (sonrası mock'a düşer) */
export const MAX_RECONNECT_ATTEMPTS = 5;
/** BT cihazı bu süre içinde yanıt vermezse bağlantı iptal edilir.
 *  15 s: ELM327 normalde <5 s'de bağlanır. Düşük tutmanın amacı, classic↔BLE
 *  otomatik fallback'inin HIZLI devreye girmesi — yanlış transport'ta 30 s
 *  beklenmez (2×15=30 s toplam, modal 75 s penceresine rahat sığar). */
export const CONNECT_TIMEOUT_MS     = 15_000; // 15 s
/**
 * ISO 15031-5 §6.3.3 TABANI — protokol sınıfının EN DÜŞÜK bayatlık eşiği.
 *
 * ⚠️ Bu bir TABANDIR, tek başına eşik DEĞİLDİR: gerçek eşik aktif poll kadansından
 * türetilir (bkz. {@link computeStaleThresholdMs}). Doğrudan kullanmak, poll periyodu
 * bu değerden büyük olan modlarda (POWER_SAVE 15s / SAFE_MODE 10s) SAHTE bayatlık
 * üretir — sahada "1-2 sn'lik bağlı/kopuk dalgalanması" kök nedeni buydu.
 */
export const STALE_THRESHOLD_MS     = 12_000; // 12 s
/** Stale watchdog kontrol aralığı */
export const WATCHDOG_INTERVAL_MS   = 5_000;  // 5 s

/* ── Kadans-türevli bayatlık eşiği (dalgalanma kök düzeltmesi) ──────────────── */

/**
 * Bayat saymadan ÖNCE kaçırılmasına izin verilen ardışık poll turu.
 * 3: tek bir kayıp frame (BT paket düşmesi / ELM327 tur atlaması) bayatlık İLAN ETMEZ;
 * üç ardışık tur sessizse gerçekten bir sorun vardır.
 */
export const STALE_MISSED_POLLS = 3;

/**
 * Kadans üstüne eklenen jitter payı (ms). ELM327 + Bluetooth gecikmesi, komut kuyruğu
 * sırası ve extended PID rotasyonunun turdan çaldığı süre için tampon.
 */
export const STALE_JITTER_MARGIN_MS = 2_000;

/**
 * Bayatlık eşiği — AKTİF poll kadansına bağlı.
 *
 * KÖK NEDEN (bu fonksiyonun varlık sebebi): `STALE_THRESHOLD_MS` (12s) sabit bir
 * protokol sabitiydi; oysa native FAST poll periyodu RuntimeMode'a göre 15s'ye kadar
 * çıkar (`computeObdPollProfile` zayıf modda `fastMs = modePollingMs` yapar —
 * POWER_SAVE 15_000 · SAFE_MODE 10_000). İki sabit birbirini HİÇ görmüyordu →
 * çekirdek PID 15s'de bir gelirken watchdog 12s'de "veri kesildi" deyip SAHTE
 * reconnect başlatıyordu → ~1-2 sn süren reconnect turu = UI dalgalanması.
 * (ATRV her ~5s'de geldiği için `_lastRealDataMs`'i koşulsuz tazeliyor ve bu çelişkiyi
 * KAZARA maskeliyordu; ECU-donma düzeltmesi maskeyi kaldırınca çelişki açığa çıktı.)
 *
 * Formül: `max(protocolFloorMs, fastMs × STALE_MISSED_POLLS + STALE_JITTER_MARGIN_MS)`
 * — eşik HER ZAMAN gerçek kadansın üstünde kalır; protokol tabanı da asla altına inilmez
 * (hızlı poll'da 12s/18s/20s taban korunur → mevcut CAN davranışı BİREBİR aynı).
 *
 * @param protocolFloorMs protokol sınıfı tabanı (CAN 12s · KWP 18s · ISO9141 20s)
 * @param fastMs          aktif native FAST poll periyodu (computeObdPollProfile.fastMs)
 */
export function computeStaleThresholdMs(protocolFloorMs: number, fastMs: number): number {
  // Fail-soft: geçersiz kadans (0/NaN/negatif) → yalnız protokol tabanına güven.
  const floor = Number.isFinite(protocolFloorMs) && protocolFloorMs > 0
    ? protocolFloorMs
    : STALE_THRESHOLD_MS;
  if (!Number.isFinite(fastMs) || fastMs <= 0) return floor;
  return Math.max(floor, fastMs * STALE_MISSED_POLLS + STALE_JITTER_MARGIN_MS);
}

/* ── CAN ECU-silent kurtarma politikası ────────────────────────────────────────
 *
 * NEDEN: KWP/ISO9141'de ölü oturum kurtarması NATIVE'dedir (ElmProtocol.noteKwpSessionHealth
 * → ardışık çekirdek NO_DATA → ATPC), ama `isSlowSerialActive()` kapısı CAN'i (proto 6/7)
 * BİLİNÇLİ olarak dışarıda bırakır. Sonuç: CAN'de ECU susunca kurtarma YOK → manuel
 * reset'e dek donuk (saha 2026-07-16 Doblo). Bu politika o boşluğu TS tarafında,
 * BOUNDED biçimde doldurur.
 *
 * DALGALANMA KORUMASI (bu politikanın en önemli kısmı): kurtarma, dalgalanmayı yeniden
 * icat ETMEMELİDİR. Bu yüzden:
 *   - TEK stale olayı kurtarma tetiklemez (ardışık ECU_SILENT_STREAK_TO_RECOVER şart),
 *   - denemeler arası cooldown ÜSTEL büyür,
 *   - toplam deneme SINIRLI (MAX_RECOVERY_ATTEMPTS) → sonsuz döngü YOK,
 *   - ilk iki basamak transport'a DOKUNMAZ → connectionState değişmez → UI dalgalanmaz.
 */

/**
 * Kurtarma basamağı — en hafiften en ağıra. Her basamak bir öncekinin başarısızlığında
 * denenir; hiçbiri ECU'ya YAZMAZ (salt okuma/oturum komutları — write/coding/security YOK).
 */
export type ObdRecoveryLevel =
  /** ATPC (Protocol Close) — ELM327 bir SONRAKİ istekte protokolü taze kurar. Transport'a
   *  DOKUNMAZ, poll döngüsü sürer, ~1-2s. KWP'nin native kurtarmasının CAN karşılığı. */
  | 'protocol_close'
  /** Kontrollü ELM yeniden init (ATWS + init dizisi + ATSP<n>). Transport'a DOKUNMAZ ama
   *  ELM327'yi sıfırlar (~2-4s). ATPC yetmediyse adaptör durum makinesi karışmış demektir. */
  | 'elm_reinit'
  /** SON ÇARE: transport reconnect (BT/GATT koparıp yeniden bağlan). connectionState
   *  değişir → UI 'connecting' görür. Yalnız ilk iki basamak başarısızsa. */
  | 'transport_reconnect';

/**
 * Kurtarma tetiklenmeden ÖNCE gereken ARDIŞIK "ECU sessiz" doğrulaması (watchdog turu).
 * 2: tek bir stale olayı ASLA kurtarma başlatmaz (kullanıcı şartı) — iki ardışık tur
 * (≥2×WATCHDOG_INTERVAL_MS) sessizlik gerçek bir ECU susmasıdır.
 */
export const ECU_SILENT_STREAK_TO_RECOVER = 2;

/** Toplam kurtarma denemesi tavanı — aşılınca kurtarma DURUR (sonsuz döngü yasak). */
export const MAX_RECOVERY_ATTEMPTS = 3;

/** İlk cooldown (ms). Her denemede üstel büyür: 10s → 20s → 40s. */
export const RECOVERY_BASE_COOLDOWN_MS = 10_000;

/**
 * Deneme numarasına (0 tabanlı) göre kurtarma basamağı. Merdiven en hafiften en ağıra:
 * 0 → protocol_close · 1 → elm_reinit · 2 → transport_reconnect.
 * Tavan aşılırsa null (kurtarma durur — çağıran ısrar ETMEZ).
 */
export function getRecoveryLevel(attempt: number): ObdRecoveryLevel | null {
  switch (attempt) {
    case 0:  return 'protocol_close';
    case 1:  return 'elm_reinit';
    case 2:  return 'transport_reconnect';
    default: return null; // MAX_RECOVERY_ATTEMPTS aşıldı → dur
  }
}

/**
 * Bir denemeden sonra beklenecek cooldown (ms) — üstel: 10s · 20s · 40s.
 * Kurtarma turlarının birbirini kovalayıp dalgalanma üretmesini engeller.
 */
export function getRecoveryCooldownMs(attempt: number): number {
  const a = Math.max(0, Math.min(attempt, MAX_RECOVERY_ATTEMPTS));
  return RECOVERY_BASE_COOLDOWN_MS * Math.pow(2, a);
}

/**
 * CAN kurtarması bu protokolde uygulanabilir mi?
 *
 * YALNIZ CAN (ISO 15765-4: ATSP 6/7/8/9 + A/B/C kullanıcı CAN). Yavaş seri protokoller
 * (3 ISO9141 · 4/5 KWP) HARİÇ: onlarda native ATPC kurtarması ZATEN çalışıyor
 * (ElmProtocol.noteKwpSessionHealth) — ikinci bir motor eklemek ÇİFT KURTARMA olur
 * (aynı anda iki taraf ATPC gönderir → oturum sürekli kapanır → yeni bir dalgalanma).
 */
export function isCanRecoveryApplicable(activeProtocol: string | null | undefined): boolean {
  if (!activeProtocol) return false; // protokol bilinmiyor → fail-closed, kurtarma YOK
  const c = activeProtocol.trim().toUpperCase().charAt(0);
  return c === '6' || c === '7' || c === '8' || c === '9'
      || c === 'A' || c === 'B' || c === 'C';
}
/** connectOBD + ısınma sonrası ilk PID için bekleme süresi */
export const DATA_GATE_TIMEOUT_MS   = 10_000; // 10 s
/**
 * Derin yeniden bağlanma aralığı (Automotive "Always-On").
 * Üstel backoff turu (5 deneme) tükenince DOĞRULANMIŞ bir adaptör için sistem
 * pes ETMEZ; bu aralıkta bir yeni tur başlatır. Otomotiv standardı: kontak/araç
 * tekrar açıldığında (saatler sonra bile) bağlantı kendiliğinden geri gelir.
 */
export const DEEP_RECONNECT_INTERVAL_MS = 300_000; // 5 dk

/**
 * Deneme numarasına göre üstel geri-çekilme gecikmesi hesaplar.
 * Formül: 2^attempt × 2000 ms → 2 s, 4 s, 8 s, 16 s, 32 s
 */
export function getReconnectDelay(attempt: number): number {
  return Math.pow(2, attempt) * 2_000;
}

/**
 * Daha fazla yeniden bağlanma denemesi yapılıp yapılmayacağını döner.
 * MAX_RECONNECT_ATTEMPTS aşıldığında false → mock'a düş veya hata göster.
 */
export function shouldAttemptReconnect(attempt: number): boolean {
  return attempt < MAX_RECONNECT_ATTEMPTS;
}

/**
 * Son başarılı veri alımından bu yana geçen sürenin stale eşiğini aşıp
 * aşmadığını döner. RFCOMM socket sessiz drop tespiti için kullanılır.
 */
export function isDataStale(lastSeenMs: number): boolean {
  return Date.now() - lastSeenMs > STALE_THRESHOLD_MS;
}
