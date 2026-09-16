/**
 * phoneLinkConnectivityIntent.ts — PHONE LINK F6.6/F6.7 · KULLANICI İRADESİ.
 *
 * ── F6'NIN TEMEL YASASI ─────────────────────────────────────────────────────
 *
 *     USER CONNECTIVITY INTENT  >  CarOS AUTOMATION
 *
 * Kullanıcı telefonda veya head unit'te Bluetooth / Wi-Fi / hotspot kapatırsa
 * bu AÇIK BİR KARARDIR. CarOS onu geri açmaz, açmayı denemez, retry ile
 * aşmaz, hidden API / accessibility / root ile aşmaz ve watchdog ile tekrar
 * tekrar denemez.
 *
 * ── GUARD NİYET TESPİTİNE BAĞLI DEĞİLDİR ────────────────────────────────────
 * Bu modülün en önemli tasarım kararı: `mayPhoneLinkEnableConnectivity()`
 * KOŞULSUZ `false` döner. Yani kural "niyeti doğru okursak uygulanır" değil,
 * "Phone Link hiçbir koşulda bağlantı donanımını açmaz"dır. Niyet modeli
 * yalnız GÖZLEMLENEBİLİRLİK ve reconnect kararı içindir; güvenliği taşıyan
 * şey tespitin doğruluğu DEĞİL, yolun yokluğudur.
 *
 * ── İKİNCİ BİR BT/WI-FI OTORİTESİ KURULMADI (F6.6) ──────────────────────────
 * Burada hiçbir yerde `BluetoothAdapter`, `WifiManager` veya native bir durum
 * okuması YOKTUR. Niyet, Phone Link'in ZATEN var olan kanonik gözleminden
 * (`preconditions.blockerCode`, native `RfcommServerTransport.checkPreconditions()`)
 * SAF olarak türetilir. Yeni bir durum deposu, cache veya timer EKLENMEZ.
 *
 * ── "USER_DISABLED" NE DEMEK, NE DEMEK DEĞİL ────────────────────────────────
 * CarOS "kullanıcı az önce kapattı" ile "zaten kapalıydı"yı AYIRT EDEMEZ ve
 * bu ayrımın hiçbir pratik sonucu YOKTUR: her iki durumda da yanıt aynıdır —
 * AÇMA. `USER_DISABLED` bu yüzden bir politika etiketidir, bir tarihçe
 * iddiası değildir.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 * `UNKNOWN` "açma izni" DEĞİLDİR. Bilinmeyen durumda da CarOS açmaz ve
 * reconnect başlatmaz.
 */

/** Phone Link'in ihtiyaç duyabileceği bağlantı taşımaları. */
export type ConnectivityTransport = 'BLUETOOTH' | 'WIFI' | 'HOTSPOT';

export type ConnectivityUserIntent = 'ALLOWED' | 'USER_DISABLED' | 'UNKNOWN';

/**
 * Niyetin hangi kanıttan çıktığı — sessiz düşüş YOK, LAB bunu gösterebilir.
 */
export type ConnectivityIntentReason =
  /** Phone Link önkoşulları hazır — taşıma açık. */
  | 'preconditions_ready'
  /** Native açıkça "Bluetooth kapalı" dedi. */
  | 'bluetooth_disabled'
  /** Native açıkça "Bluetooth izni yok" dedi — bu da kullanıcı kararıdır. */
  | 'bluetooth_permission_withheld'
  /** Donanım yok/desteklenmiyor — açılacak bir şey de yok. */
  | 'transport_unavailable'
  /** Engel var ama bağlantı donanımıyla ilgili değil. */
  | 'blocked_for_other_reason'
  /** Ölçüm yok — fail-closed. */
  | 'not_observed';

export interface ConnectivityIntentEvidence {
  readonly transport: ConnectivityTransport;
  readonly intent: ConnectivityUserIntent;
  readonly reason: ConnectivityIntentReason;
}

/**
 * Phone Link önkoşul gözleminin DAR girdisi.
 *
 * Kasıtlı olarak `PhoneHubLinkSnapshotRaw`ın tamamı DEĞİL: bu modül yalnız
 * blocker koduna bakar, böylece anlık görüntünün geri kalanına bağımlı olmaz.
 */
export interface PhoneLinkPreconditionObservation {
  readonly ready: boolean | null;
  /** `LinkErrorCode` adı; ölçülmediyse `null`. */
  readonly blockerCode: string | null;
}

export const UNOBSERVED_PRECONDITIONS: PhoneLinkPreconditionObservation =
  Object.freeze({ ready: null, blockerCode: null });

/* ══════════════════════════════════════════════════════════════════════════
 * Türetim — SAF
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bluetooth niyeti. Yalnız native'in KENDİ hükmünden türer.
 *
 * `NO_BONDED_DEVICE` / `DEVICE_NOT_SELECTED` kullanıcı kararı DEĞİLDİR
 * (eşleşme eksikliğidir) — bunlar `ALLOWED` bırakılır ki eşleşme akışı
 * engellenmesin. `BLUETOOTH_UNAVAILABLE` ise donanım yokluğudur: açılacak
 * bir şey olmadığı için `USER_DISABLED` demek yanıltıcı olurdu.
 */
export function deriveBluetoothIntent(
  observation: PhoneLinkPreconditionObservation,
): ConnectivityIntentEvidence {
  const base = { transport: 'BLUETOOTH' } as const;

  if (observation.blockerCode === null) {
    return observation.ready === true
      ? Object.freeze({ ...base, intent: 'ALLOWED', reason: 'preconditions_ready' })
      : Object.freeze({ ...base, intent: 'UNKNOWN', reason: 'not_observed' });
  }

  switch (observation.blockerCode) {
    case 'BLUETOOTH_DISABLED':
      return Object.freeze({ ...base, intent: 'USER_DISABLED', reason: 'bluetooth_disabled' });
    case 'BLUETOOTH_PERMISSION_REQUIRED':
    case 'BLUETOOTH_PERMISSION_DENIED':
      /* İzin vermemek de bir kullanıcı kararıdır — CarOS onu aşmaz. */
      return Object.freeze({
        ...base, intent: 'USER_DISABLED', reason: 'bluetooth_permission_withheld',
      });
    case 'BLUETOOTH_UNAVAILABLE':
      return Object.freeze({ ...base, intent: 'UNKNOWN', reason: 'transport_unavailable' });
    default:
      /* Başka bir engel (sunucu dinlemiyor vb.) bağlantı donanımı hakkında
         hüküm VERMEZ — uydurma yapılmaz. */
      return Object.freeze({ ...base, intent: 'UNKNOWN', reason: 'blocked_for_other_reason' });
  }
}

/**
 * Wi-Fi / hotspot niyeti.
 *
 * ⚠️ DÜRÜST SINIR: Phone Link'in Wi-Fi veya hotspot durumunu okuyan kanonik
 * bir gözlemi YOKTUR (F5'in ağ gözlemcisi "bağlı mı"yı söyler, "kullanıcı
 * açtı mı"yı DEĞİL). İkinci bir Wi-Fi otoritesi kurmak F6.6'da yasak olduğu
 * için burada `UNKNOWN` döneriz — ve `UNKNOWN` fail-closed'dur, yani sonuç
 * yine "CarOS açmaz"dır. Tespit edilemeyen şey uydurulmaz.
 */
export function deriveWifiIntent(): ConnectivityIntentEvidence {
  return Object.freeze({
    transport: 'WIFI', intent: 'UNKNOWN', reason: 'not_observed',
  });
}

export function deriveHotspotIntent(): ConnectivityIntentEvidence {
  return Object.freeze({
    transport: 'HOTSPOT', intent: 'UNKNOWN', reason: 'not_observed',
  });
}

export function deriveConnectivityIntent(
  transport: ConnectivityTransport,
  observation: PhoneLinkPreconditionObservation = UNOBSERVED_PRECONDITIONS,
): ConnectivityIntentEvidence {
  switch (transport) {
    case 'BLUETOOTH': return deriveBluetoothIntent(observation);
    case 'WIFI': return deriveWifiIntent();
    case 'HOTSPOT': return deriveHotspotIntent();
    default: return deriveWifiIntent();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * PAZARLIKSIZ KAPI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Phone Link automation'ı bağlantı donanımını AÇABİLİR Mİ?
 *
 * **HER ZAMAN `false`.** Parametre alması bilerek: çağrı yeri okunduğunda
 * "hangi taşıma için sorulduğu" görünür kalsın, ama yanıt asla değişmez.
 *
 * Bu fonksiyonun `true` dönebildiği bir dal EKLENMEMELİDİR. Kullanıcının
 * kapattığı bir radyoyu açmak, CarOS'un yetki alanı DIŞINDADIR — ne ayar
 * ("CarOS Bağlantı Önceliği" dâhil), ne reconnect politikası, ne de bir
 * kolaylık gerekçesi bunu değiştirir (F6 authority hierarchy: USER INTENT
 * her şeyin üstündedir).
 */
export function mayPhoneLinkEnableConnectivity(
  _transport: ConnectivityTransport,
  _intent: ConnectivityUserIntent,
): false {
  return false;
}

/**
 * Normal otomatik yeniden bağlanma YAPILABİLİR Mİ? (F6.8)
 *
 * Kullanıcı Bluetooth'u AÇIK bıraktıysa Phone Link'in normal kolaylığı
 * kaybolmaz: zaten açık olan bir radyoda bilinen/onaylı eşe yeniden bağlanmak
 * kullanıcı kararını aşmaz. Bu "Bluetooth'u otomatik açmak" DEĞİLDİR.
 *
 * FAIL CLOSED: yalnız `ALLOWED` izin verir; `USER_DISABLED` ve `UNKNOWN`
 * reconnect BAŞLATMAZ.
 */
export function isPhoneLinkReconnectPermitted(intent: ConnectivityUserIntent): boolean {
  return intent === 'ALLOWED';
}
