/**
 * phoneValidationScenarios.ts — TELEFON DOĞRULAMA SÖZLEŞMESİ (saf, makine-okur).
 *
 * ── NE DEĞİLDİR ───────────────────────────────────────────────────────
 * Bu dosya **head-unit doğrulaması DEĞİLDİR**. Gerçek araç ünitesi olmadan
 * doğrulanamayacak her şey burada `BLOCKED_HEAD_UNIT` olarak işaretlidir ve
 * telefonda koşulsa bile PASS ÜRETEMEZ. `PHONE_VALIDATED` etiketi yalnız
 * gerçekten telefonda koşulup kanıt toplanan senaryolar için kullanılabilir.
 *
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────
 * Senaryolar metin olarak bir belgede dururken ölçüm sonucu uygulamanın
 * kendi gözlemiyle İLİŞKİLENDİRİLEMEZ. Bu sözleşme senaryoları makine-okur
 * hâle getirir: her senaryonun ön koşulu, adımları, beklenen olayları ve
 * **YASAKLI olayları** vardır; kanıt olmadan PASS yazılamaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

/* ── Sonuç ─────────────────────────────────────────────────────────────── */

export const SCENARIO_RESULTS = [
  'NOT_RUN',
  'PASS',
  'FAIL',
  'BLOCKED_HEAD_UNIT',   // gerçek araç ünitesi gerekir — telefonda PASS OLAMAZ
  'BLOCKED_ENVIRONMENT', // ortam elverişsiz (ör. ikinci hesap yok)
] as const;
export type ScenarioResult = (typeof SCENARIO_RESULTS)[number];

export const EVIDENCE_KINDS = [
  'LAB_SNAPSHOT',   // CAROS LAB panelinden okunan sayaç/durum
  'UI_TEXT',        // kullanıcıya gösterilen metin
  'SCREENSHOT',
  'SERVER_STATE',   // sunucudaki gerçek satır/durum
  'MANUAL_NOTE',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface PhoneScenario {
  scenarioId:      string;
  title:           string;
  /** Gerçek head-unit gerektiriyor mu — true ise telefonda PASS ÜRETİLEMEZ. */
  requiresHeadUnit: boolean;
  preconditions:   readonly string[];
  steps:           readonly string[];
  expectedEvents:  readonly string[];
  expectedUiState: readonly string[];
  expectedServerState: readonly string[];
  /** Bunlardan biri gözlenirse senaryo DÜŞER (sessiz geçiş yok). */
  prohibitedEvents: readonly string[];
  evidenceRequired: readonly EvidenceKind[];
}

/* ── Telefonda doğrulanabilir senaryolar (P1–P15) ──────────────────────── */

export const PHONE_SCENARIOS: readonly PhoneScenario[] = [
  {
    scenarioId: 'P1',
    title: 'Çevrimdışı düşük riskli araç metadata güncellemesi kuyruğa alınır',
    requiresHeadUnit: false,
    preconditions: ['Oturum açık', 'En az bir araç erişilebilir', 'Bekleyen kuyruk boş'],
    steps: ['Uçak modunu aç', 'Filo adını değiştir', '/dashboard/fleet/pending ekranını aç'],
    expectedEvents: ['kuyruğa COMPANY_UPDATE eklendi'],
    expectedUiState: [
      'Bildirim "Sunucu onaylayana kadar tamamlanmış sayılmaz" ibaresini taşır',
      'Bekleyen işlem sayısı 1 artar',
    ],
    expectedServerState: ['Sunucuda DEĞİŞİKLİK YOK (henüz gönderilmedi)'],
    prohibitedEvents: ['UI "Kaydedildi" veya "Tamamlandı" der'],
    evidenceRequired: ['UI_TEXT', 'LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P2',
    title: 'Çevrimdışıyken online-required işlem REDDEDİLİR',
    requiresHeadUnit: false,
    preconditions: ['Oturum açık', 'Şirkette admin rolü', 'En az iki üye'],
    steps: ['Uçak modunu aç', 'Bir üyenin rolünü değiştirmeyi dene', 'Sahiplik devri başlatmayı dene'],
    expectedEvents: ['requires_online reddi'],
    expectedUiState: ['"Bu işlem için internet bağlantısı gerekli" gösterilir'],
    expectedServerState: ['Sunucuda DEĞİŞİKLİK YOK'],
    prohibitedEvents: [
      'Bekleyen işlem sayısı artar',
      'UI işlemi kaydedilmiş gösterir',
    ],
    evidenceRequired: ['UI_TEXT', 'LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P3',
    title: 'Yeniden bağlanınca senkron TEK KEZ çalışır',
    requiresHeadUnit: false,
    preconditions: ['Kuyrukta en az 1 bekleyen işlem'],
    steps: ['Uçak modunu kapat', 'Uygulamayı öne al', 'LAB panelini yenile'],
    expectedEvents: ['tek senkron turu'],
    expectedUiState: ['Bekleyen işlem sayısı sıfırlanır'],
    expectedServerState: ['İşlem sunucuda BİR KEZ uygulanmış'],
    prohibitedEvents: ['Aynı işlem sunucuda iki kez görünür', 'Senkron turu çalışıyor kalır'],
    evidenceRequired: ['LAB_SNAPSHOT', 'SERVER_STATE'],
  },
  {
    scenarioId: 'P4',
    title: 'Yeniden bağlanmada revizyon boşluğu TESPİT EDİLİR',
    requiresHeadUnit: false,
    preconditions: ['Realtime bağlı', 'İkinci bir cihaz/sekme sunucuda değişiklik yapabiliyor'],
    steps: [
      'Uçak modunu aç',
      'Başka bir cihazdan filoda 2–3 değişiklik yap',
      'Uçak modunu kapat',
      'LAB · Realtime bölümünü oku',
    ],
    expectedEvents: ['suspectedGapCount artar', 'confirmedGapCount artar'],
    expectedUiState: ['Bağlantı kesintisi sonrası "veriler doğrulanıyor" gösterilir'],
    expectedServerState: ['Snapshot revizyonu yerelden ileri'],
    prohibitedEvents: ['Durum snapshot alınmadan LIVE olur', 'lastGapReason boş kalır'],
    evidenceRequired: ['LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P5',
    title: 'Snapshot uzlaştırması bitmeden UI "güncel" DEMEZ',
    requiresHeadUnit: false,
    preconditions: ['Ağ yavaş/kesintili taklit edilebiliyor'],
    steps: ['Ağı kes', 'Geri aç', 'Snapshot gelene kadar ekranı gözle'],
    expectedEvents: ['realtimeState: SUSPECTED_GAP → RESYNCING → RECONCILING → LIVE'],
    expectedUiState: ['Ara durumlarda "güncel" ibaresi YOK'],
    expectedServerState: [],
    prohibitedEvents: ['RESYNCING sırasında "Canlı — veriler güncel" gösterilir'],
    evidenceRequired: ['LAB_SNAPSHOT', 'SCREENSHOT'],
  },
  {
    scenarioId: 'P6',
    title: 'A hesabının bekleyen kuyruğu B hesabına GÖRÜNMEZ',
    requiresHeadUnit: false,
    preconditions: ['İki farklı test hesabı'],
    steps: [
      'A ile giriş yap, çevrimdışı bir işlem sırala',
      'Çıkış yap',
      'B ile giriş yap',
      'LAB ve bekleyen işlemler ekranını oku',
    ],
    expectedEvents: ['kuyruk hesap kapsamına bağlı'],
    expectedUiState: ['B için bekleyen işlem sayısı 0'],
    expectedServerState: [],
    prohibitedEvents: [
      'B hesabında A hesabının işlemi görünür',
      'LAB "Kuyruk hesap kapsamına bağlı = HAYIR" gösterir',
    ],
    evidenceRequired: ['LAB_SNAPSHOT', 'SCREENSHOT'],
  },
  {
    scenarioId: 'P7',
    title: 'Çıkış sırasında aktif senkron İPTAL EDİLİR',
    requiresHeadUnit: false,
    preconditions: ['Kuyrukta bekleyen işlem var', 'Ağ yavaş'],
    steps: ['Senkron başlarken hemen çıkış yap', 'Yeniden giriş yap', 'LAB oku'],
    expectedEvents: ['staleCallbackRejectCount veya bayat sonuç reddi artar'],
    expectedUiState: ['Yeni oturum temiz başlar'],
    expectedServerState: ['Yarım uygulanmış işlem YOK'],
    prohibitedEvents: ['Çıkıştan sonra kuyruk durumu değişir'],
    evidenceRequired: ['LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P8',
    title: 'Süreç öldürüldükten sonra kuyruk GÜVENLİ yüklenir',
    requiresHeadUnit: false,
    preconditions: ['Kuyrukta bekleyen işlem var'],
    steps: ['Uygulamayı zorla kapat', 'Yeniden aç', 'Bekleyen işlemleri oku'],
    expectedEvents: ['SYNCING kalan işlem RETRYABLE_FAILED yapılır'],
    expectedUiState: ['Bekleyen işlem korunur, "gönderildi" DENMEZ'],
    expectedServerState: [],
    prohibitedEvents: ['Kesintiye uğrayan işlem "başarılı" sayılır', 'Kuyruk sessizce boşalır'],
    evidenceRequired: ['LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P9',
    title: 'Bozuk kuyruk kaydı KARANTİNAYA alınır',
    requiresHeadUnit: false,
    preconditions: ['Geliştirici araçlarıyla localStorage bozulabiliyor'],
    steps: ['caros.fleet.queue.* değerini boz', 'Uygulamayı yeniden aç', 'LAB oku'],
    expectedEvents: ['Bozuk kayıt sayacı artar'],
    expectedUiState: ['Uygulama ÇÖKMEZ'],
    expectedServerState: [],
    prohibitedEvents: ['Uygulama açılışta çöker', 'Bozuk kayıt sessizce yok sayılır'],
    evidenceRequired: ['LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P10',
    title: 'Üyelik kaldırılınca eski filo verisi TEMİZLENİR',
    requiresHeadUnit: false,
    preconditions: ['İki hesap: biri admin, biri member'],
    steps: [
      'Member telefonda filoyu görüntülerken admin onu filodan çıkarsın',
      'Member tarafında yenile',
    ],
    expectedEvents: ['MEMBERSHIP_REVOKED uzlaştırması'],
    expectedUiState: ['Filo araçları listelenmez', 'Dürüst bilgilendirme gösterilir'],
    expectedServerState: ['Member profilinde company_id NULL'],
    prohibitedEvents: ['Eski filo araçları görünmeye devam eder', 'Komut butonları aktif kalır'],
    evidenceRequired: ['SCREENSHOT', 'SERVER_STATE'],
  },
  {
    scenarioId: 'P11',
    title: 'Sahiplik devrinden sonra ESKİ sahibin önbelleği temizlenir',
    requiresHeadUnit: false,
    preconditions: ['İki hesap', 'Devredilebilir bir araç'],
    steps: [
      'A hesabından devri başlat',
      'B hesabından kabul et',
      'A hesabında yenile',
    ],
    expectedEvents: ['OWNERSHIP_CHANGED uzlaştırması'],
    expectedUiState: [
      'A hesabında araç listede YOK veya düzenlenemez',
      'B hesabında araç görünür',
    ],
    expectedServerState: [
      'vehicles.owner_id yeni sahibe eşit',
      'Eski sahibin vehicle_pairings kaydı YOK',
    ],
    prohibitedEvents: [
      'A hesabı aracı hâlâ düzenleyebiliyor',
      'A hesabı aracın konumunu görebiliyor',
    ],
    evidenceRequired: ['SCREENSHOT', 'SERVER_STATE', 'LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P12',
    title: 'Bayat realtime bildirimi YENİ kapsama uygulanmaz',
    requiresHeadUnit: false,
    preconditions: ['İki hesap', 'Realtime aktif'],
    steps: ['A ile bağlan', 'Hızlıca B hesabına geç', 'LAB · Realtime oku'],
    expectedEvents: ['staleEventRejectCount artar'],
    expectedUiState: ['B hesabında A verisi bir an bile görünmez'],
    expectedServerState: [],
    prohibitedEvents: ['B ekranında A hesabının aracı belirir'],
    evidenceRequired: ['LAB_SNAPSHOT', 'SCREENSHOT'],
  },
  {
    scenarioId: 'P13',
    title: 'Yeniden bağlanma fırtınası SINIRLI kalır',
    requiresHeadUnit: false,
    preconditions: ['Ağ hızlı açılıp kapanabiliyor'],
    steps: ['Uçak modunu 10 kez hızlıca aç/kapat', 'LAB · Realtime sayaçlarını oku'],
    expectedEvents: ['resyncAttemptCount artar ama sınırlı', 'backoff devreye girer'],
    expectedUiState: ['Arayüz donmaz'],
    expectedServerState: ['Sunucuya snapshot isteği seli GİTMEZ'],
    prohibitedEvents: ['resyncAttemptCount sınırsız artar', 'Uygulama yanıt vermez hâle gelir'],
    evidenceRequired: ['LAB_SNAPSHOT'],
  },
  {
    scenarioId: 'P14',
    title: 'CAROS LAB ham veri / PII GÖSTERMEZ',
    requiresHeadUnit: false,
    preconditions: ['LAB erişimi açık'],
    steps: ['LAB · Filo & Çevrimdışı ekranındaki tüm panelleri oku'],
    expectedEvents: [],
    expectedUiState: ['Yalnız VAR/YOK, ADET ve durum kodları görünür'],
    expectedServerState: [],
    prohibitedEvents: [
      'E-posta görünür', 'Eşleştirme kodu görünür', 'Transfer anahtarı görünür',
      'Araç konumu görünür', 'Ham payload görünür', 'Tam kullanıcı kimliği görünür',
    ],
    evidenceRequired: ['SCREENSHOT'],
  },
  {
    scenarioId: 'P15',
    title: 'Çakışma kullanıcıya DÜRÜST gösterilir',
    requiresHeadUnit: false,
    preconditions: ['Çakışma üretilebiliyor (ör. çevrimdışıyken sunucuda değişiklik)'],
    steps: ['Çakışma üret', '/dashboard/fleet/conflicts ekranını aç'],
    expectedEvents: ['conflict kaydı oluşur'],
    expectedUiState: [
      'Ne olduğu düz Türkçe anlatılır',
      'Seçenekler arasında "zorla devral" YOKTUR',
    ],
    expectedServerState: ['Sunucu durumu DEĞİŞMEMİŞ'],
    prohibitedEvents: ['Ham SQL/teknik hata metni gösterilir', 'Çakışma sessizce yok sayılır'],
    evidenceRequired: ['SCREENSHOT', 'UI_TEXT'],
  },
];

/* ── Head-unit gerektiren, telefonda PASS ÜRETİLEMEYECEK alanlar ───────── */

export const HEAD_UNIT_BLOCKED_AREAS: readonly PhoneScenario[] = [
  'Kontak (ignition) yaşam döngüsü',
  'Head-unit süreç yönetimi ve önbellek davranışı',
  'Üretici WebView / Android sürüm farklılıkları',
  'Araç içi ağ değişimleri (OEM modem/hotspot)',
  'Fiziksel cihaz eşleştirme (araçta kod üretimi)',
  'Düşük donanım (Mali-400) altında filo ekranı performansı',
  'Direksiyon tuşları / araç komut entegrasyonu',
  'Gerçek sürüş sırasında çevrimdışı→çevrimiçi geçişi',
].map((title, index) => ({
  scenarioId: `H${index + 1}`,
  title,
  requiresHeadUnit: true,
  preconditions: ['GERÇEK head unit gerekir'],
  steps: [],
  expectedEvents: [],
  expectedUiState: [],
  expectedServerState: [],
  prohibitedEvents: ['Telefon testinde PASS işaretlenmesi'],
  evidenceRequired: ['MANUAL_NOTE'],
}));

/* ── Sonuç kaydı ───────────────────────────────────────────────────────── */

/**
 * Koşumun yapıldığı cihaz bağlamı.
 *
 * Kanıtın hangi cihazda/hangi derlemede toplandığı YAZILMAZSA sonuç
 * tekrar üretilemez — "telefonda çalıştı" iddiası doğrulanamaz olur.
 */
export interface DeviceContext {
  model:          string;   // ör. "Xiaomi 22101316G"
  androidVersion: string;   // ör. "13"
  /** Yerel derleme kimliği (commit/hash/etiket). Yayın YAPILMAZ. */
  appBuild:       string;
}

export interface ScenarioRun {
  scenarioId: string;
  result:     ScenarioResult;
  evidence:   readonly EvidenceKind[];
  note:       string;
  /** PASS için ZORUNLU — hangi cihazda ölçüldüğü bilinmeden geçerli sayılmaz. */
  device?:    DeviceContext;
  startedAt?:   number;
  completedAt?: number;
  /** Gerçekten gözlenenler (beklenenle karşılaştırma için). */
  observedEvents?: readonly string[];
  observedUi?:     readonly string[];
  /** Kanıt dosyası/ekran görüntüsü referansı (yol veya kimlik). */
  evidenceRef?:    string;
  failureCode?:    string;
}

/** Cihaz bağlamı eksiksiz mi (boş string kabul edilmez). */
export function isDeviceContextComplete(device: DeviceContext | undefined): boolean {
  if (!device) return false;
  return (
    device.model.trim().length > 0 &&
    device.androidVersion.trim().length > 0 &&
    device.appBuild.trim().length > 0
  );
}

/** Kayıt sınırı — bounded (sınırsız büyüme yok). */
export const MAX_SCENARIO_RUNS = 200;

export function findScenario(scenarioId: string): PhoneScenario | null {
  return (
    PHONE_SCENARIOS.find((s) => s.scenarioId === scenarioId) ??
    HEAD_UNIT_BLOCKED_AREAS.find((s) => s.scenarioId === scenarioId) ??
    null
  );
}

export type RunRejection =
  | 'UNKNOWN_SCENARIO'
  | 'HEAD_UNIT_REQUIRED'   // telefonda PASS üretilemez
  | 'EVIDENCE_MISSING'     // kanıtsız PASS yasak
  | 'DEVICE_CONTEXT_MISSING'; // hangi cihazda ölçüldüğü bilinmeden PASS yasak

/**
 * Bir senaryo sonucunu kaydetmeden ÖNCE doğrular.
 *
 * FAIL-CLOSED üç kural:
 *   1. Bilinmeyen senaryo kaydedilmez.
 *   2. Head-unit gerektiren senaryo telefonda **PASS OLAMAZ** — en fazla
 *      `BLOCKED_HEAD_UNIT` yazılabilir. ("Gerçek head unit olmadan
 *      head-unit doğrulandı demek YASAK" kuralının makine karşılığı.)
 *   3. PASS yazmak için senaryonun istediği TÜM kanıt türleri toplanmış olmalı.
 */
export function validateRun(run: ScenarioRun): { ok: boolean; reason: RunRejection | null } {
  const scenario = findScenario(run.scenarioId);
  if (!scenario) return { ok: false, reason: 'UNKNOWN_SCENARIO' };

  if (scenario.requiresHeadUnit && run.result === 'PASS') {
    return { ok: false, reason: 'HEAD_UNIT_REQUIRED' };
  }

  if (run.result === 'PASS') {
    const missing = scenario.evidenceRequired.filter((kind) => !run.evidence.includes(kind));
    if (missing.length > 0) return { ok: false, reason: 'EVIDENCE_MISSING' };

    // Cihaz bağlamı olmadan "telefonda geçti" iddiası doğrulanamaz.
    if (!isDeviceContextComplete(run.device)) {
      return { ok: false, reason: 'DEVICE_CONTEXT_MISSING' };
    }
  }

  return { ok: true, reason: null };
}

/* ── Kanıt toplayıcı (bounded) ─────────────────────────────────────────── */

/**
 * Koşum kayıtlarını toplar.
 *
 * · Yalnız GEÇERLİ kayıtlar eklenir (`validateRun`) — geçersiz PASS sessizce
 *   girmez, reddedilir ve sebebi döner.
 * · BOUNDED — `MAX_SCENARIO_RUNS` aşılırsa en eski kayıt düşer.
 * · Aynı senaryonun yeni koşumu eskisini DEĞİŞTİRİR (son ölçüm geçerlidir).
 */
export class ValidationEvidenceCollector {
  private readonly runs: ScenarioRun[] = [];

  record(run: ScenarioRun): { ok: boolean; reason: RunRejection | null } {
    const check = validateRun(run);
    if (!check.ok) return check;

    const existing = this.runs.findIndex((r) => r.scenarioId === run.scenarioId);
    if (existing >= 0) this.runs[existing] = run;
    else {
      if (this.runs.length >= MAX_SCENARIO_RUNS) this.runs.shift();
      this.runs.push(run);
    }
    return { ok: true, reason: null };
  }

  all(): readonly ScenarioRun[] {
    return this.runs;
  }

  summary(): ValidationSummary {
    return summarize(this.runs);
  }

  clear(): void {
    this.runs.length = 0;
  }
}

/* ── Tekil toplayıcı (LAB gözlemi için) ────────────────────────────────── */

let _collector: ValidationEvidenceCollector | null = null;

/**
 * Koşum toplayıcısı — telefon testini yürüten araç bunu kullanır.
 * LAB YALNIZ okur; koşum BAŞLATMAZ.
 */
export function getValidationCollector(): ValidationEvidenceCollector {
  if (!_collector) _collector = new ValidationEvidenceCollector();
  return _collector;
}

/** SALT-OKUMA: toplayıcı varsa döner, YOKSA null (yeni örnek KURMAZ). */
export function peekValidationCollector(): ValidationEvidenceCollector | null {
  return _collector;
}

export function resetValidationCollector(): void {
  _collector = null;
}

/* ── LAB export (redacted) ─────────────────────────────────────────────── */

/** LAB'a taşınan özet — not, kanıt yolu ve cihaz kimliği TAŞINMAZ. */
export interface ValidationLabExport {
  total:      number;
  passed:     number;
  failed:     number;
  notRun:     number;
  blocked:    number;
  phoneValidated: boolean;
  /** Son koşumun derleme kimliği (cihaz modeli/PII değil). */
  lastBuild:  string | null;
  /** Kanıt eksiksizliği: PASS'lerin kaçı tam kanıtlı. */
  evidenceComplete: number;
}

/**
 * LAB için özet üretir.
 *
 * REDAKSİYON: serbest metin `note`, `evidenceRef` (dosya yolu olabilir),
 * cihaz modeli ve Android sürümü **taşınmaz** — bunlar kullanıcı/cihaz
 * ayırt edici bilgilerdir. Yalnız derleme kimliği ve sayımlar geçer.
 */
export function toLabExport(runs: readonly ScenarioRun[]): ValidationLabExport {
  const summary = summarize(runs);
  let lastBuild: string | null = null;
  let latest = -1;
  let evidenceComplete = 0;

  for (const run of runs) {
    const stamp = run.completedAt ?? run.startedAt ?? 0;
    if (run.device?.appBuild && stamp >= latest) {
      latest = stamp;
      lastBuild = run.device.appBuild;
    }
    if (run.result === 'PASS' && validateRun(run).ok) evidenceComplete += 1;
  }

  return {
    total:   summary.total,
    passed:  summary.passed,
    failed:  summary.failed,
    notRun:  summary.notRun,
    blocked: summary.blocked,
    phoneValidated: summary.phoneValidated,
    lastBuild,
    evidenceComplete,
  };
}

/* ── Toplu özet ────────────────────────────────────────────────────────── */

export interface ValidationSummary {
  total:       number;
  passed:      number;
  failed:      number;
  notRun:      number;
  blocked:     number;
  /** Telefon doğrulaması "tamamlandı" sayılabilir mi. */
  phoneValidated: boolean;
}

/**
 * Telefon doğrulama özeti.
 *
 * `phoneValidated` YALNIZ telefonda koşulabilir senaryoların TAMAMI kanıtlı
 * PASS ise true olur. Tek bir NOT_RUN bile varsa **false** — "çoğu geçti"
 * doğrulama sayılmaz.
 */
export function summarize(runs: readonly ScenarioRun[]): ValidationSummary {
  const byId = new Map(runs.map((r) => [r.scenarioId, r]));
  let passed = 0, failed = 0, notRun = 0, blocked = 0;

  for (const scenario of PHONE_SCENARIOS) {
    const run = byId.get(scenario.scenarioId);
    if (!run || run.result === 'NOT_RUN') { notRun += 1; continue; }
    if (run.result === 'FAIL')            { failed += 1; continue; }
    if (run.result === 'PASS' && validateRun(run).ok) { passed += 1; continue; }
    blocked += 1;   // kanıtsız PASS veya BLOCKED_* → geçmiş SAYILMAZ
  }

  return {
    total:  PHONE_SCENARIOS.length,
    passed, failed, notRun, blocked,
    phoneValidated: passed === PHONE_SCENARIOS.length,
  };
}

export function scenarioResultLabel(result: ScenarioResult): string {
  switch (result) {
    case 'NOT_RUN':             return 'Koşulmadı';
    case 'PASS':                return 'Geçti';
    case 'FAIL':                return 'Düştü';
    case 'BLOCKED_HEAD_UNIT':   return 'Gerçek araç ünitesi gerekiyor';
    case 'BLOCKED_ENVIRONMENT': return 'Ortam elverişsiz';
  }
}
