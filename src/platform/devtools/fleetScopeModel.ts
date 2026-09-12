/**
 * fleetScopeModel — filo yüzeylerinin YETKİ KAPSAMI (saf · tek kaynak).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Yalnız ÖLÇÜLMÜŞ olgular ve etiketler.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * 2026-08-21 CAROS LAB denetiminde altı filo ekranının cihazda DAİMA BOŞ olduğu
 * ölçüldü. İlk bakışta bu "bozuk ekran" gibi görünüyordu; kök neden ölçülünce
 * başka çıktı: head unit'in kullanıcı OTURUMU yoktur, yalnız cihaz API anahtarı
 * vardır. Sunucu tarafındaki yetkiler (migration dosyalarından SAYILDI):
 *
 *   `get_active_driver_assignment(p_api_key)`  → GRANT **anon**          ✅
 *   `get_driver_dna(uuid)`                     → GRANT **authenticated** ❌
 *   `get_fleet_intelligence()`                 → GRANT **authenticated** ❌
 *   `get_evidence_coverage()`                  → GRANT **authenticated** ❌
 *   `list_vehicle_presence_history(uuid,int)`  → `REVOKE ALL … FROM anon` ❌
 *   sürücü doğrulama                           → public okuma RPC'si YOK  ❌
 *
 * Yani beş yüzey **bozuk değil, bu cihazın yetkisinde değil**: şirket kapsamlı
 * yönetici verisidir ve otoritesi sunucudadır. `anon` GRANT açmak filo geneli
 * veriyi head unit'e sızdırırdı — bilinçli olarak YAPILMADI.
 *
 * ── BU MODÜLÜN İŞİ ──────────────────────────────────────────────────────────
 * "Boş ekran" ile "yetki dışı ekran"ı AYIRMAK. Boş bir ekran kusur gibi okunur
 * ve her turda yeniden araştırılır; kapsamını söyleyen bir ekran ise DOĞRU
 * çalışan bir gözlem yüzeyidir. Burada veri ÜRETİLMEZ, yalnız sınır beyan edilir.
 */

/** Kapsamı beyan edilen filo yüzeyleri (CAROS LAB araç kimlikleriyle birebir). */
export type FleetScopeSurface =
  | 'fleet-driver-identity'
  | 'fleet-presence-history'
  | 'fleet-driver-authentication'
  | 'fleet-driver-dna'
  | 'fleet-intelligence'
  | 'ai-evidence-engine';

/** Bu yüzey BU CİHAZDA veri gösterebilir mi? */
export type FleetScopeVerdict =
  /** Cihaz yetkisi VAR ve kablo kurulu — gerçek veri beklenir. */
  | 'DEVICE_READABLE'
  /**
   * Sunucu yetkisi `authenticated` (kullanıcı oturumu) gerektiriyor; head unit'in
   * oturumu YOK. Ekran boş kalır ve bu DOĞRU davranıştır.
   */
  | 'REQUIRES_USER_SESSION'
  /** Sunucu tarafında `anon` AÇIKÇA reddedilmiş (`REVOKE ALL … FROM anon`). */
  | 'ANON_REVOKED'
  /** Okuma ucu (public RPC) hiç yok. */
  | 'NO_READ_ENDPOINT'
  /** Veriyi ÜRETEN donanım/üretici bu cihazda yok (NFC · PIN · Bluetooth). */
  | 'NO_PRODUCER';

export const FLEET_SCOPE_VERDICT_LABEL: Readonly<Record<FleetScopeVerdict, string>> = {
  DEVICE_READABLE:       'BU CİHAZDA OKUNABİLİR',
  REQUIRES_USER_SESSION: 'KULLANICI OTURUMU GEREKİR — head unit yetkisi YOK',
  ANON_REVOKED:          'CİHAZ ERİŞİMİ SUNUCUDA REDDEDİLMİŞ (bilinçli)',
  NO_READ_ENDPOINT:      'OKUMA UCU YOK',
  NO_PRODUCER:           'ÜRETİCİ YOK (donanım bağlı değil)',
} as const;

/** Rozet tonu — model renk BİLMEZ, ekran OEM token'ına çevirir. */
export type FleetScopeTone = 'ok' | 'muted' | 'warn';

export function fleetScopeTone(v: FleetScopeVerdict): FleetScopeTone {
  return v === 'DEVICE_READABLE' ? 'ok'
    : v === 'NO_READ_ENDPOINT' ? 'warn'
      : 'muted';
}

export interface FleetScopeFact {
  readonly surface: FleetScopeSurface;
  readonly verdict: FleetScopeVerdict;
  /** İlgili sunucu ucu — yoksa `null`. PII taşımaz, yalnız fonksiyon adı. */
  readonly endpoint: string | null;
  /** Ölçülen yetki (migration'dan SAYILDI) — yoksa `null`. */
  readonly grant: string | null;
  /** Bu veriyi kim görür — otoritenin gerçek yeri. */
  readonly audience: string;
  /** Neden böyle; tek cümle, gerekçeli. */
  readonly note: string;
}

/**
 * ÖLÇÜLMÜŞ olgular. Bu tablo bir TASARIM BEYANI değil, migration dosyalarından
 * sayılmış GRANT gerçeğidir; sunucu tarafı değişirse BURASI da değişmelidir
 * (kilit testi `carosLabFleetScope.test.ts` tabloyu sözleşmeye bağlar).
 */
export const FLEET_SCOPE_FACTS: readonly FleetScopeFact[] = Object.freeze([
  {
    surface: 'fleet-driver-identity',
    verdict: 'DEVICE_READABLE',
    endpoint: 'get_active_driver_assignment(p_api_key)',
    grant: 'anon, authenticated, service_role',
    audience: 'Head unit + yönetici',
    note: 'Cihaz API anahtarıyla çağrılabilir. Kablo trip başlangıcına bağlandı (fleetReadbackService) — trip başına TEK çağrı, timer YOK.',
  },
  {
    surface: 'fleet-presence-history',
    verdict: 'ANON_REVOKED',
    endpoint: 'list_vehicle_presence_history(uuid, integer)',
    grant: 'authenticated, service_role (anon AÇIKÇA REVOKE)',
    audience: 'Yönetici paneli',
    note: 'Sunucu `REVOKE ALL … FROM PUBLIC, anon` diyor: sürücü varlık geçmişi cihaz anahtarıyla okunamaz. Bu bir kusur değil, veri koruma kararıdır. Ayrıca varlık ÜRETİCİSİ (NFC/Bluetooth) de bu cihazda yok.',
  },
  {
    surface: 'fleet-driver-authentication',
    verdict: 'NO_PRODUCER',
    endpoint: null,
    grant: 'tablo SELECT → authenticated',
    audience: 'Yönetici paneli',
    note: 'Public okuma RPC\'si YOK ve doğrulama ÜRETİCİSİ (NFC · PIN · Bluetooth · telefon) bu cihazda bağlı değil. Araç bağı köprü tarafından kurulur; doğrulama üretilmediği için otorite durumu UNBOUND/IDLE kalır — bu DOĞRU cevaptır.',
  },
  {
    surface: 'fleet-driver-dna',
    verdict: 'REQUIRES_USER_SESSION',
    endpoint: 'get_driver_dna(uuid)',
    grant: 'authenticated, service_role',
    audience: 'Yönetici paneli / sürücünün kendisi',
    note: 'DNA sunucuda birikir (`_dna_apply_trip` tetikleyicisi) ve kullanıcı oturumuyla okunur. Head unit\'in oturumu yoktur; okumak için `anon` GRANT açmak bir sürücünün sürüş karakterini araçtaki herkese verirdi.',
  },
  {
    surface: 'fleet-intelligence',
    verdict: 'REQUIRES_USER_SESSION',
    endpoint: 'get_fleet_intelligence()',
    grant: 'authenticated, service_role',
    audience: 'Yönetici paneli',
    note: 'İçgörüler ŞİRKET kapsamlıdır (`auth_company_id()` ile daraltılır). Tek bir aracın head unit\'ine tüm filonun içgörüsünü açmak kapsam ihlalidir.',
  },
  {
    surface: 'ai-evidence-engine',
    verdict: 'REQUIRES_USER_SESSION',
    endpoint: 'get_evidence_coverage()',
    grant: 'authenticated, service_role',
    audience: 'Yönetici paneli',
    note: 'Kanıt omurgası şirket kapsamlıdır ve üretimi SUNUCUDADIR (`_evidence_*` tetikleyicileri). Head unit kanıt üretmez, üretilmiş kanıtı da şirket yetkisi olmadan okuyamaz.',
  },
] as const);

/** Yüzeyin kapsam olgusu; bilinmeyen yüzey için `null` (fail-soft, throw YOK). */
export function getFleetScope(surface: string): FleetScopeFact | null {
  for (const f of FLEET_SCOPE_FACTS) if (f.surface === surface) return f;
  return null;
}

/**
 * Ekranın BOŞ olması beklenen bir sonuç mu?
 *
 * `true` ise ekran "veri yok" demeyi bir KUSUR gibi sunmamalıdır — kapsamı
 * söylemelidir. `false` ise (cihazda okunabilir) boşluk GERÇEKTEN incelenmelidir.
 */
export function isEmptinessExpected(fact: FleetScopeFact | null): boolean {
  return fact !== null && fact.verdict !== 'DEVICE_READABLE';
}
