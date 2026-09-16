/**
 * phoneIntegrationArbiter.ts — PHONE LINK F6.2/F6.3/F6.5 · sahiplik politikası.
 *
 * ── BU BİR PROCESS KILLER DEĞİLDİR ──────────────────────────────────────────
 * Burada hiçbir paket durdurulmaz, hiçbir servis öldürülmez, hiçbir process
 * taranmaz. `kill`, shell, root, hidden API, accessibility ve force-stop
 * döngüsü YOKTUR. Modül yalnız ŞU SORUYU yanıtlar:
 *
 *   "Şu an CarOS'un GERÇEKTEN kontrol edebildiği telefon-entegrasyon
 *    kaynaklarında sahiplik kimde olmalı?"
 *
 * ── ÖLÇÜLEN PLATFORM GERÇEĞİ (uydurma değil) ────────────────────────────────
 * F6.0 denetimi şunları buldu:
 *  · CarOS bir SİSTEM/PRIVILEGED uygulama DEĞİLDİR — manifest'te `sharedUserId`,
 *    `android:persistent`, `FORCE_STOP_PACKAGES`, `KILL_BACKGROUND_PROCESSES`,
 *    `PACKAGE_USAGE_STATS` ve `QUERY_ALL_PACKAGES` YOKTUR.
 *  · Depoda ZLink/AutoKit/CarbitLink/EasyConnection/TLink/Android Auto/CarPlay
 *    için KANITLANMIŞ HİÇBİR paket/servis kimliği YOKTUR (tek bir referans
 *    bile yok). Paket adı EZBERDEN UYDURULMAZ.
 *  · CarOS'un gerçekten sahip olabildiği tek alan kendi ses/medya yüzeyidir
 *    (`CarosAudioFocusManager` → `AudioManager` audio focus, ve kendi
 *    `MediaSession`'ı). Bunlar Android'in BELGELİ arbitrasyon yollarıdır.
 *
 * Sonuç: `AUDIO` ve `MEDIA_CONTROL` YÖNETİLEBİLİR; `MICROPHONE`, `PROJECTION`
 * ve `USB_PHONE_INTEGRATION` **UNMANAGED**'dır. "ZLink tamamen kapalı" gibi
 * bir iddia ÜRETİLMEZ (F6.4/F6.20).
 *
 * ── İSİM ÇAKIŞMASI YOK ──────────────────────────────────────────────────────
 * Buradaki `ACTIVE_OWNER` bir KAYNAK sahipliğidir. F3'ün `PhoneLinkRole`
 * `PRIMARY`si bir KİŞİ rolüdür ve bu modülle hiçbir ilgisi yoktur; bu dosya
 * `PRIMARY` kelimesini hiç kullanmaz.
 *
 * ── SAF ─────────────────────────────────────────────────────────────────────
 * Yan etki, IO, timer, native çağrısı YOKTUR. Girdi → politika. Bu yüzden
 * "Phone Link yokken arbiter idle" iddiası yapısal olarak doğrudur: çağrılmaz,
 * hiçbir şey çalışmaz.
 */

/** CarOS kaynaklarının ownership alanları (F6.5). */
export type PhoneIntegrationResourceDomain =
  | 'AUDIO'
  | 'MEDIA_CONTROL'
  | 'MICROPHONE'
  | 'PROJECTION'
  | 'USB_PHONE_INTEGRATION';

export const PHONE_INTEGRATION_DOMAINS: readonly PhoneIntegrationResourceDomain[] =
  Object.freeze(['AUDIO', 'MEDIA_CONTROL', 'MICROPHONE', 'PROJECTION', 'USB_PHONE_INTEGRATION']);

/**
 * Sahiplik durumu.
 *
 *  · `ACTIVE_OWNER` — CarOS bu alanda sahiptir.
 *  · `SUSPENDED`    — bilinen ve KONTROL EDİLEBİLİR bir rakip bu alanda
 *                     geri çekilmiştir. Sahte üretilmez.
 *  · `AVAILABLE`    — alan serbest; CarOS sahiplik İDDİA ETMİYOR.
 *  · `UNMANAGED`    — CarOS bu alanı kontrol EDEMEZ; hiçbir iddia YOK.
 */
export type ResourceOwnership = 'ACTIVE_OWNER' | 'SUSPENDED' | 'AVAILABLE' | 'UNMANAGED';

/**
 * Bilinen rakip telefon entegrasyonları.
 *
 * ⚠️ Depoda KANITLANMIŞ bir paket/servis kimliği bulunmadığı için bu birleşimde
 * bugün YALNIZ `UNKNOWN` vardır. İsimler ezberden eklenmez; gerçek bir cihaz
 * config'i/kanıtı geldiğinde buraya YENİ ÜYE eklenir ve o üye için
 * kontrol edilebilirlik AYRICA kanıtlanır.
 */
export type CompetingPhoneIntegration = 'UNKNOWN';

/** `UNKNOWN` bir rakip ASLA zorla susturulmaz (F6.1). */
export function isIntegrationControllable(integration: CompetingPhoneIntegration): boolean {
  return integration !== 'UNKNOWN';
}

/**
 * Bir alanın CarOS tarafından kontrol edilebilir olup olmadığı — ÖLÇÜLMÜŞ
 * gerçek, tercih değil.
 */
export function isDomainControllable(domain: PhoneIntegrationResourceDomain): boolean {
  switch (domain) {
    /* Android'in BELGELİ audio focus sözleşmesi; CarOS zaten uyguluyor. */
    case 'AUDIO': return true;
    /* CarOS kendi MediaSession'ının sahibidir. */
    case 'MEDIA_CONTROL': return true;
    /* Mikrofon arbitrasyonunu Android yapar; başka bir uygulamanın kaydını
       askıya alacak BELGELİ bir yol YOKTUR. */
    case 'MICROPHONE': return false;
    /* Projeksiyon/USB entegrasyonu için ne OEM API'si ne de sistem-app
       ayrıcalığı VAR — sahte SUSPENDED üretmemek için UNMANAGED. */
    case 'PROJECTION': return false;
    case 'USB_PHONE_INTEGRATION': return false;
    default: return false;
  }
}

export type ArbitrationReason =
  /** Ayar kapalı — CarOS hiçbir şeyi susturmaya çalışmaz. */
  | 'priority_disabled'
  /** Ayar açık ama Phone Link ACTIVE değil — gereksiz suppression YOK. */
  | 'phone_link_inactive'
  /** Ayar açık + Phone Link ACTIVE — kontrol edilebilir alanlarda sahiplik. */
  | 'exclusive_ownership'
  /** Alan CarOS tarafından kontrol edilemiyor. */
  | 'domain_not_controllable';

export interface PhoneIntegrationPolicy {
  readonly ownership: Readonly<Record<PhoneIntegrationResourceDomain, ResourceOwnership>>;
  /** CarOS bu an sahiplik iddia ediyor mu (en az bir alanda). */
  readonly exclusiveOwnershipHeld: boolean;
  readonly reason: ArbitrationReason;
  /**
   * GERÇEKTEN askıya alınmış rakipler. Kontrol edilebilir bir rakip
   * kanıtlanmadığı sürece BOŞ kalır — dolu gösterilmesi sahte iddia olurdu.
   */
  readonly suspendedIntegrations: readonly CompetingPhoneIntegration[];
}

const EMPTY_SUSPENDED: readonly CompetingPhoneIntegration[] = Object.freeze([]);

function buildOwnership(
  held: boolean,
): Readonly<Record<PhoneIntegrationResourceDomain, ResourceOwnership>> {
  const map = {} as Record<PhoneIntegrationResourceDomain, ResourceOwnership>;
  for (const domain of PHONE_INTEGRATION_DOMAINS) {
    if (!isDomainControllable(domain)) {
      /* Ayar ne olursa olsun UNMANAGED — dürüstlük ayara bağlı değildir. */
      map[domain] = 'UNMANAGED';
      continue;
    }
    map[domain] = held ? 'ACTIVE_OWNER' : 'AVAILABLE';
  }
  return Object.freeze(map);
}

/**
 * TEK karar noktası (F6.2/F6.11).
 *
 * Etkinleşme koşulu bilinçli olarak DAR: uygulamanın açık olması ya da
 * launcher'ın ön planda olması YETMEZ. Yalnız
 *
 *   ayar AÇIK  +  Phone Link oturumu ACTIVE
 *
 * ise CarOS sahiplik iddia eder. Telefon bağlı değilken suppression YOK —
 * bu hem kaynak tüketimini hem kullanıcı sürprizini engeller.
 */
export function derivePhoneIntegrationPolicy(input: {
  readonly priorityEnabled: boolean;
  readonly phoneLinkActive: boolean;
}): PhoneIntegrationPolicy {
  if (!input.priorityEnabled) {
    return Object.freeze({
      ownership: buildOwnership(false),
      exclusiveOwnershipHeld: false,
      reason: 'priority_disabled',
      suspendedIntegrations: EMPTY_SUSPENDED,
    });
  }
  if (!input.phoneLinkActive) {
    return Object.freeze({
      ownership: buildOwnership(false),
      exclusiveOwnershipHeld: false,
      reason: 'phone_link_inactive',
      suspendedIntegrations: EMPTY_SUSPENDED,
    });
  }
  return Object.freeze({
    ownership: buildOwnership(true),
    exclusiveOwnershipHeld: true,
    reason: 'exclusive_ownership',
    /* Kontrol edilebilir bir rakip KANITLANMADIĞI için boş — bkz. dosya
       üstündeki ölçüm notu. */
    suspendedIntegrations: EMPTY_SUSPENDED,
  });
}

/**
 * İki politikanın GERÇEK bir geçiş olup olmadığı — gereksiz release/acquire
 * tetiklenmesin (idempotent uygulama, F4'ün `isPortalTransition` deseniyle
 * aynı amaç).
 */
export function isOwnershipTransition(
  previous: PhoneIntegrationPolicy, next: PhoneIntegrationPolicy,
): boolean {
  return previous.exclusiveOwnershipHeld !== next.exclusiveOwnershipHeld;
}

/**
 * Serbest bırakma politikası — "bırakmak ≠ zorla başlatmak" (F6.3).
 *
 * CarOS sahipliği bıraktığında rakip entegrasyonu BAŞLATMAZ; yalnız alanı
 * `AVAILABLE` yapar. Kullanıcı isterse onu kendisi açar.
 */
export function releasedPolicy(): PhoneIntegrationPolicy {
  return derivePhoneIntegrationPolicy({ priorityEnabled: false, phoneLinkActive: false });
}
