/**
 * capabilityFabricModel — CAROS LAB · Capability Fabric SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (`capabilityFabricSources` çıktısının
 * şekli) → servis importu olmadan test edilir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Kaynak okunamadıysa sayı UYDURULMAZ → `UNAVAILABLE`.
 *  · Kapsama oranı GERÇEK trafikten gelir; hiç tur geçmediyse "ölçüm yok"
 *    denir, `%0` diye sunulmaz (0 bir ölçüm gibi görünürdü).
 *  · `UNKNOWN` availability bir KUSUR DEĞİLDİR: registry o yetenek için henüz
 *    kanıt toplamamıştır ve yol kapatılmamıştır — ekran bunu açıkça söyler.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';

const SRC_FABRIC = 'capability/fabric/capabilityFabric.getCapabilityFabricDiagnostics';
const SRC_CATALOG = 'capability/fabric/carosCapabilityCatalog.CAROS_CAPABILITY_CATALOG';
const SRC_REGISTRY = 'capability/capabilityRegistry.getCapability (fabric.readAvailability)';
const SRC_OBSERVATION = 'capability/observation/observationLedger.readObservationDiagnostics';

/* ══════════════════════════════════════════════════════════════════════════
 * Girdi şekli (sources ile birebir — modül İMPORT EDİLMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

export interface FabricDiagnosticsInput {
  readonly enforcing: boolean;
  readonly capabilityRoutes: number;
  readonly legacyRoutes: number;
  readonly allowed: number;
  readonly coveragePercent: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly observations: Readonly<Record<string, number>>;
  readonly plansBuilt: number;
  readonly planItems: number;
  readonly planDependencies: number;
  readonly planResults: Readonly<Record<string, number>>;
}

export interface FabricCatalogRowInput {
  readonly capabilityId: string;
  readonly operation: string;
  readonly domain: string;
  readonly safetyClass: string;
  readonly requiresConfirmation: boolean;
  readonly observationCeiling: string;
  readonly exposedToBrain: boolean;
  readonly legacyIntent: string | null;
  readonly availability: string;
  readonly requiredCapabilities: readonly string[];
}

/** MAVI-F7 · gözlem tanısı girdisi (sources ile birebir — modül İMPORT EDİLMEZ). */
export interface FabricObservationInput {
  readonly pendingCount: number;
  readonly pendingCapacity: number;
  readonly windowMs: number;
  readonly opened: number;
  readonly downgrades: number;
  readonly upgrades: number;
  readonly sources: Readonly<Record<string, number>>;
  readonly settlements: Readonly<Record<string, number>>;
  readonly deferredLevels: Readonly<Record<string, number>>;
  readonly pendingDomains: readonly string[];
}

export interface FabricIntegrityInput {
  readonly ok: boolean;
  readonly duplicateOperations: readonly string[];
  readonly duplicateLegacyIntents: readonly string[];
  readonly emptyEnums: readonly string[];
}

export interface CapabilityFabricInput {
  readonly diagnostics: FabricDiagnosticsInput | null;
  readonly observation: FabricObservationInput | null;
  readonly enforcing: boolean | null;
  readonly rows: readonly FabricCatalogRowInput[] | null;
  readonly integrity: FabricIntegrityInput | null;
  readonly brainIntentCount: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çıktı
 * ════════════════════════════════════════════════════════════════════════ */

export interface CapabilityFabricView {
  readonly fields: readonly InspectorField[];
  readonly rows: readonly FabricCatalogRowInput[];
  /** Alan başına işlem adedi — sıralı, bounded. */
  readonly byDomain: readonly (readonly [string, number])[];
}

function countBy(rows: readonly FabricCatalogRowInput[], key: 'domain'): (readonly [string, number])[] {
  const acc: Record<string, number> = {};
  for (const r of rows) acc[r[key]] = (acc[r[key]] ?? 0) + 1;
  return Object.keys(acc).sort().map((k) => [k, acc[k]] as const);
}

function renderCounts(m: Readonly<Record<string, number>>): string | null {
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return null;
  return keys.map((k) => `${k}: ${m[k]}`).join(' · ');
}

export function buildCapabilityFabricView(input: CapabilityFabricInput): CapabilityFabricView {
  const out: InspectorField[] = [];
  const d = input.diagnostics;
  const rows = input.rows ?? [];

  /* ── 1 · KAPI KİPİ ──────────────────────────────────────────────────── */
  out.push(input.enforcing === null
    ? unavailable({ id: 'mode', label: 'Kapı kipi', source: SRC_FABRIC, note: '' },
        'Kapı durumu okunamadı.')
    : observed({ id: 'mode', label: 'Kapı kipi', source: SRC_FABRIC,
        note: 'GÖLGE (varsayılan) = karar ÜRETİLİR ve ÖLÇÜLÜR ama hiçbir eylem '
            + 'ENGELLENMEZ → cihaz davranışı bugünküyle BİREBİR aynıdır. '
            + 'ZORLAYICI = kapı reddettiğinde beyin önerisi tüketilmez ve akış '
            + 'yerel zincire düşer (tur sessizce ölmez). Şalter: localStorage'
            + '["mavi.capabilityFabric.enforce"]="true".' },
        input.enforcing ? 'ZORLAYICI' : 'GÖLGE (ölçüm)'));

  /* ── 2 · KAPSAMA ────────────────────────────────────────────────────── */
  const totalRoutes = d ? d.capabilityRoutes + d.legacyRoutes : 0;
  out.push(!d
    ? unavailable({ id: 'coverage', label: 'Capability kapsaması', source: SRC_FABRIC, note: '' },
        'Tanı okunamadı.')
    : totalRoutes === 0
      ? unavailable({ id: 'coverage', label: 'Capability kapsaması', source: SRC_FABRIC,
          note: 'Bu oturumda HİÇ eylem turu geçmedi. %0 yazmak bir ÖLÇÜM gibi '
              + 'görünürdü — ölçüm yokluğu ölçüm DEĞİLDİR.' },
          'Ölçüm yok (bu oturumda eylem turu geçmedi).')
      : derived({ id: 'coverage', label: 'Capability kapsaması', source: SRC_FABRIC,
          note: 'Kaç eylem önerisinin katalogdan çözülüp TİPLİ doğrulamadan geçtiği. '
              + 'Kalan yüzde `LEGACY_FALLBACK`tır: katalogda karşılığı YOK ve eski yol '
              + 'AYNEN çalışır (kaybolmaz, yalnız migrasyon borcudur).' },
          `%${d.coveragePercent} (capability ${d.capabilityRoutes} · legacy ${d.legacyRoutes})`));

  /* ── 3 · KATALOG ────────────────────────────────────────────────────── */
  out.push(input.rows === null
    ? unavailable({ id: 'catalog_size', label: 'Katalog işlemi', source: SRC_CATALOG, note: '' },
        'Katalog okunamadı.')
    : observed({ id: 'catalog_size', label: 'Katalog işlemi', source: SRC_CATALOG,
        note: 'Tanımlı capability+operation çifti. Her biri kanonik yürütücüye '
            + '(`dispatchIntent`) köprülenir — YENİ yürütücü kurulmaz.' },
        `${rows.length} işlem · ${new Set(rows.map((r) => r.capabilityId)).size} capability`));

  out.push(input.brainIntentCount === null
    ? unavailable({ id: 'brain_intents', label: 'Beyne açık intent', source: SRC_CATALOG, note: '' },
        'Türetme yapılamadı.')
    : derived({ id: 'brain_intents', label: 'Beyne açık intent', source: SRC_CATALOG,
        note: 'Prompt intent listesi ARTIK ELLE YAZILMAZ, katalogdan TÜRETİLİR. '
            + 'Önceden aynı bilgi ÜÇ ayrı sabit listedeydi ve üçü de FARKLIYDI '
            + '(29 / 29 / 26) — bir intent eklenince biri güncellenmeyince beyin '
            + 'geçerli komut üretiyor, doğrulayıcı onu sessizce DÜŞÜRÜYORDU.' },
        `${input.brainIntentCount} intent (katalogdan türetildi)`));

  /* ── 4 · BÜTÜNLÜK ───────────────────────────────────────────────────── */
  const integ = input.integrity;
  out.push(!integ
    ? unavailable({ id: 'integrity', label: 'Katalog bütünlüğü', source: SRC_CATALOG, note: '' },
        'Denetim çalıştırılamadı.')
    : observed({ id: 'integrity', label: 'Katalog bütünlüğü', source: SRC_CATALOG,
        note: 'Duplicate capability+operation sessizce kabul edilseydi iki farklı '
            + 'işlem AYNI adla çözülür ve hangisinin yürüdüğü TANIM SIRASINA '
            + 'kalırdı — bu sessiz bir yetki kaymasıdır. `values` verilmemiş enum '
            + 'de kusurdur: fail-closed olduğu için HİÇBİR değer geçemez.' },
        integ.ok
          ? 'TEMİZ (duplicate yok · boş enum yok)'
          : `KUSUR — op: ${integ.duplicateOperations.length} · intent: `
            + `${integ.duplicateLegacyIntents.length} · boş enum: ${integ.emptyEnums.length}`));

  /* ── 5 · GÖZLEM SEVİYELERİ ──────────────────────────────────────────── */
  const obsText = d ? renderCounts(d.observations) : null;
  out.push(obsText === null
    ? unavailable({ id: 'observations', label: 'Gözlem seviyesi dağılımı', source: SRC_FABRIC,
        note: 'Bu oturumda hiçbir eylem sonucu sınıflandırılmadı.' },
        'Ölçüm yok.')
    : observed({ id: 'observations', label: 'Gözlem seviyesi dağılımı', source: SRC_FABRIC,
        note: '"YAPTIM" DENEBİLECEK TEK SEVİYE `EXECUTED` ve `OBSERVED`tir. '
            + '`ACCEPTED` = yürütücüye teslim edildi, sonucu DOĞRULANMADI · '
            + '`REQUESTED` = onay bekliyor · `UNKNOWN` = çağrıldı ama kanıt yok · '
            + '`FAILED` = ret/hata. DÜRÜSTLÜK TAVANI UYGULANIR: yürütücü "başarılı" '
            + 'dese bile işlemin tavanı `ACCEPTED` ise sonuç `ACCEPTED` yazılır.' },
        obsText));

  /* ── 6 · REDLER ─────────────────────────────────────────────────────── */
  const failText = d ? renderCounts(d.failures) : null;
  out.push(failText === null
    ? unavailable({ id: 'failures', label: 'Kapı redleri', source: SRC_FABRIC,
        note: 'Bu oturumda hiçbir öneri kapıda düşmedi.' },
        'Ret yok.')
    : observed({ id: 'failures', label: 'Kapı redleri', source: SRC_FABRIC,
        note: 'Bounded hata sınıfları. `INVALID_ARGUMENT` = LLM şemaya uymayan '
            + 'parametre üretti · `PERMISSION_DENIED` = işlem beyne KAPALI '
            + '(cihazda mevcut OLSA BİLE) · `UNAVAILABLE` = registry KANITLA '
            + 'olumsuz. GÖLGE kipte bu redler ölçülür ama UYGULANMAZ.' },
        failText));

  /* ── 7 · BİLEŞİK PLAN (MAVI-F6) ─────────────────────────────────────── */
  out.push(!d || d.plansBuilt === 0
    ? unavailable({ id: 'plans', label: 'Bileşik plan', source: SRC_FABRIC,
        note: 'Bu oturumda tek cümlede birden fazla iş içeren komut gelmedi. '
            + '0 yazmak bir ÖLÇÜM gibi görünürdü.' },
        'Ölçüm yok (bileşik komut geçmedi).')
    : observed({ id: 'plans', label: 'Bileşik plan', source: SRC_FABRIC,
        note: 'Tek cümledeki birden fazla iş TEK tipli plan altında yürütülür. '
            + 'Sonuç sınıfı GÖZLEMLERDEN türetilir: ALL_SUCCEEDED yalnız TÜM '
            + 'adımlar KANITLI başarıya (EXECUTED/OBSERVED) ulaştıysa verilir — '
            + 'bir adım bile doğrulanamadıysa PARTIAL yazılır (sahte toplu başarı '
            + 'YASAK). REFUSED = birden fazla onay gerektiren adım vardı ve plan '
            + 'TÜMÜYLE reddedildi (belirsiz rızada hiçbir şey yapılmaz).' },
        `${d.plansBuilt} plan · ${d.planItems} adım · ${d.planDependencies} bağımlılık`
        + (renderCounts(d.planResults) ? ` — ${renderCounts(d.planResults)}` : '')));

  /* ── 8 · GÖZLEM KAYNAĞI (MAVI-F7) ───────────────────────────────────── */
  const obs = input.observation;
  const srcText = obs ? renderCounts(obs.sources) : null;
  out.push(!obs || srcText === null
    ? unavailable({ id: 'obs_sources', label: 'Gözlem kaynağı', source: SRC_OBSERVATION,
        note: 'Bu oturumda hiçbir eylem uzlaştırılmadı. 0 yazmak bir ÖLÇÜM gibi '
            + 'görünürdü.' },
        'Ölçüm yok.')
    : observed({ id: 'obs_sources', label: 'Gözlem kaynağı', source: SRC_OBSERVATION,
        note: 'Nihai gözlem seviyesini HANGİ gerçeklik belirledi. '
            + '`EXECUTOR_RESULT` BAĞIMSIZ kanıt DEĞİLDİR (yürütücünün kendisi '
            + 'hakkındaki beyanı) · `PLAYBACK_TRUTH` medyanın TEK gerçeği · '
            + '`NAV_DESTINATION` rota hedefinin gerçekten işlendiği · '
            + '`SETTINGS_STORE` ayarın depodan GERİ OKUNDUĞU · `NONE` o alanda '
            + 'bağımsız kaynak YOK. Paralel bir gerçeklik kurulmadı — bu satır '
            + 'yalnız mevcut alan otoritelerini sayar.' },
        srcText));

  out.push(!obs
    ? unavailable({ id: 'obs_honesty', label: 'Dürüstlük düzeltmesi', source: SRC_OBSERVATION, note: '' },
        'Tanı okunamadı.')
    : derived({ id: 'obs_honesty', label: 'Dürüstlük düzeltmesi', source: SRC_OBSERVATION,
        note: 'DÜŞÜRME en değerli ölçüdür: bağımsız kanıt, yürütücünün BAŞARI '
            + 'iddiasını kaç kez geçersiz kıldı — yani F7 olmasaydı kaç kez '
            + '"yaptım" denecekti. YÜKSELTME ise kanıtın bir işlemi ACCEPTED seviyesinden '
            + 'EXECUTED/OBSERVED seviyesine taşıdığı turdur (tavanı AŞAMAZ).' },
        `düşürme ${obs.downgrades} · yükseltme ${obs.upgrades}`));

  /* ── 9 · BEKLEYEN GÖZLEM (MAVI-F7) ──────────────────────────────────── */
  out.push(!obs
    ? unavailable({ id: 'obs_pending', label: 'Bekleyen gözlem', source: SRC_OBSERVATION, note: '' },
        'Tanı okunamadı.')
    : obs.opened === 0
      ? unavailable({ id: 'obs_pending', label: 'Bekleyen gözlem', source: SRC_OBSERVATION,
          note: 'Kanıtı gecikmeli gelen (navigasyon) hiçbir eylem geçmedi.' },
          'Ölçüm yok.')
      : observed({ id: 'obs_pending', label: 'Bekleyen gözlem', source: SRC_OBSERVATION,
          note: 'Rota isteği ASENKRONDUR: yürütücü döndüğünde hedef defterinde '
              + 'henüz kayıt yoktur. Bekleyen gözlem bu gerçeği ölçer ve '
              + 'SÖYLENMİŞ CÜMLEYİ DEĞİŞTİRMEZ (cümle zaten ACCEPTED '
              + 'seviyesindedir). `EXPIRED` = pencere doldu, kanıt YOK → '
              + '**UNKNOWN** yazılır; zaman aşımı ASLA başarıya dönüşmez. '
              + '`EVICTED` = bounded kuyrukta yer açmak için düşürüldü. Kuyruk '
              + 'sınırlıdır ve timer KULLANILMAZ (sıfır sızıntı).' },
          `${obs.opened} açıldı · ${obs.pendingCount}/${obs.pendingCapacity} bekliyor · `
          + `pencere ${Math.round(obs.windowMs / 1000)} sn`
          + (renderCounts(obs.settlements) ? ` — ${renderCounts(obs.settlements)}` : '')
          + (renderCounts(obs.deferredLevels) ? ` → ${renderCounts(obs.deferredLevels)}` : '')));

  /* ── 10 · AVAILABILITY KANITI ───────────────────────────────────────── */
  const withEvidence = rows.filter((r) => r.requiredCapabilities.length > 0);
  const negative = withEvidence.filter((r) => r.availability === 'UNAVAILABLE');
  const positive = withEvidence.filter((r) => r.availability === 'AVAILABLE');
  out.push(input.rows === null
    ? unavailable({ id: 'availability', label: 'Availability kanıtı', source: SRC_REGISTRY, note: '' },
        'Registry okunamadı.')
    : observed({ id: 'availability', label: 'Availability kanıtı', source: SRC_REGISTRY,
        note: 'AVAILABILITY ≠ PERMISSION ≠ AUTHORITY. Yalnız KANITLI OLUMSUZ '
            + '(unavailable/unsupported/restricted) yolu kapatır; `UNKNOWN` '
            + 'KAPATMAZ — registry\'nin henüz kanıt toplamamış olması bir '
            + 'yeteneğin yokluğu DEĞİLDİR ve bugünkü çalışan davranışı kırmak '
            + 'gerçek bir regresyon olurdu. Kanıt İSTEMEYEN işlemler (boş '
            + 'gereksinim) UNKNOWN görünür — sahte kapı KURULMADI, borç yazıldı.' },
        `kanıt isteyen ${withEvidence.length} işlem — AVAILABLE ${positive.length} · `
        + `UNAVAILABLE ${negative.length} · UNKNOWN ${withEvidence.length - positive.length - negative.length}`));

  return Object.freeze({
    fields: Object.freeze(out),
    rows: Object.freeze(rows),
    byDomain: Object.freeze(countBy(rows, 'domain')),
  });
}
