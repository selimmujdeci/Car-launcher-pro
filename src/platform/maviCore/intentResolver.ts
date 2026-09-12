/**
 * maviCore/intentResolver.ts — MAVİ 4.0 · DRIVE-3 · DETERMİNİSTİK NİYET ÇÖZÜCÜ (Intent Resolver).
 *
 * AMAÇ (VİZYON — "her sinyal bir kararın parçası" · gate-7 Intent): Kullanıcının DOĞAL DİL
 * cümlesini, MEVCUT Action Registry'nin (DRIVE-1/2) eylem kimliklerine bağlayan İLK niyet katmanı.
 * Bu modül cümleyi → **Intent + Entity + Confidence** üçlüsüne çözer; hiçbir eylemi ÇALIŞTIRMAZ,
 * yalnız çözümü döndürür. Çözümü Execution Engine'e taşımak AYRI PR'dır (DRIVE-4).
 *
 * BU PR'DA YOK (kesin kısıt): LLM/Cloud AI/Gemini/OpenAI çağrısı YOK · voice pipeline değişikliği
 * YOK · Execution Engine / Action Registry değişikliği YOK · yeni AI servisi YOK. Tamamen OFFLINE,
 * DETERMİNİSTİK, saf (import yan etkisiz; timer/abonelik/native çağrı yok).
 *
 * TASARIM İLKELERİ:
 *  - REGEX ÇÖPLÜĞÜ / AD-HOC KEYWORD TABLOSU YOK. Bunun yerine iki katman:
 *      (1) INTENT KATALOĞU (data): her niyet actionId + requiredEntities + optionalEntities +
 *          description + alias listesiyle RESMÎ olarak tanımlanır.
 *      (2) ALIAS SİSTEMİ (logic): Türkçe-normalize + Türkçe eki toleranslı (gövde=önek) token-küme
 *          skorlaması. Alias'lar insan-okur yazılır, kurulumda normalize edilir.
 *  - CONFIDENCE 0..1: alias eşleşme gücü. Deterministik (aynı girdi → aynı çıktı).
 *  - FAIL-CLOSED · ASLA TAHMİN ETME: eşik altı → UNKNOWN_INTENT (no_match); iki niyet yakın
 *    skorda çekişiyorsa → UNKNOWN_INTENT (ambiguous). Yanlış eylemi çalıştırmaktansa "bilmiyorum".
 *  - INTENT ≠ ACTION: niyet kimliği (ör. 'open.vehicle_health') kullanıcı-niyeti kavramıdır; onu
 *    resmî eyleme (ör. 'vehicle.health.read') KATALOG bağlar. Entity eksikse çözüm yine döner ama
 *    `missingRequired` doldurulur (DRIVE-4 takip sorusu sorabilir) — çözücü uydurma değer ÜRETMEZ.
 */

import { PILOT_THEMES } from './actionRegistry';

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

/** Çözülemeyen/belirsiz niyet için kararlı işaret (fail-closed). */
export const UNKNOWN_INTENT = 'unknown' as const;

/** Bir entity değeri — deterministik çıkarım yalnız string/number üretir (serbest LLM yorumu YOK). */
export type EntityValue = string | number;

/**
 * Resmî niyet tanımı (KATALOG kaydı). Niyetin NE olduğunu + hangi eyleme bağlandığını + hangi
 * entity'leri gerektirdiğini tanımlar. Gerçek yürütme BURADA DEĞİL (Execution Engine).
 */
export interface IntentDefinition {
  /** Kararlı niyet kimliği (ör. 'open.home', 'set.theme'). */
  readonly intent: string;
  /** Bağlı Action Registry eylem kimliği (ör. 'open.home', 'vehicle.health.read'). */
  readonly actionId: string;
  /** Eylemin çalışması için ZORUNLU entity'ler (eksikse `missingRequired`'a düşer). */
  readonly requiredEntities: readonly string[];
  /** Verilirse kullanılan, yoksa varsayılana düşülen entity'ler. */
  readonly optionalEntities: readonly string[];
  /** İnsan-okur kısa açıklama (tanı/onay/dokümantasyon). */
  readonly description: string;
  /** Türkçe tetikleyici ifadeler (insan-okur; kurulumda normalize edilir). */
  readonly aliases: readonly string[];
}

/** Bir niyet adayı + skoru (tanı/alternatifler için). */
export interface IntentCandidate {
  readonly intent: string;
  readonly confidence: number;
}

/** Çözüm gerekçesi (olgusal — PASS/FAIL değil). */
export type IntentReason = 'matched' | 'no_match' | 'ambiguous' | 'empty';

/** Niyet çözümü — Intent + Entity + Confidence. */
export interface IntentResolution {
  /** Çözülen niyet kimliği veya UNKNOWN_INTENT. */
  readonly intent: string;
  /** Bağlı eylem kimliği; UNKNOWN_INTENT ise null (fail-closed — çağıran çalıştırmaz). */
  readonly actionId: string | null;
  /** Eşleşme güveni 0..1 (belirsizde de en iyi adayın skoru taşınır — tanı için). */
  readonly confidence: number;
  /** Cümleden deterministik çıkarılan entity'ler (uydurma yok). */
  readonly entities: Readonly<Record<string, EntityValue>>;
  /** Doldurulamayan ZORUNLU entity'ler (varsa DRIVE-4 takip sorusu sorar). */
  readonly missingRequired: readonly string[];
  readonly reason: IntentReason;
  /** En iyi birkaç aday (tanı — özellikle ambiguous durumda ikisi de görünür). */
  readonly alternatives: readonly IntentCandidate[];
}

export interface IntentResolverOptions {
  /** Bu skorun altındaki en iyi aday → no_match (UNKNOWN). Varsayılan 0.5. */
  readonly acceptThreshold?: number;
  /** En iyi ile ikinci aday farkı bu marjın altındaysa → ambiguous (UNKNOWN). Varsayılan 0.12. */
  readonly ambiguityMargin?: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Türkçe normalize + tokenizasyon (SAF · bağımlılıksız)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Türkçe-duyarlı normalize: büyük/küçük harf + aksan sadeleştirme + noktalama→boşluk + tekilleştirme.
 * `İ`/`I` toLowerCase tuzağını (birleşik nokta) atlatmak için önce elle katlanır. Deterministik.
 */
export function normalizeUtterance(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/İ/g, 'i').replace(/I/g, 'i') // Türkçe büyük I/İ → i (toLowerCase öncesi)
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ş/g, 's')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/**
 * İki token eşleşir mi — Türkçe agglütinasyon toleransı:
 *  1. Eşitlik.
 *  2. Gövde ÖNEKtir ("ayarlar"→"ayarlari", "sayfa"→"sayfayi"): kısa taraf (>=3) uzunun başıysa.
 *  3. Ünsüz yumuşaması ("parlaklık"→"parlaklığı" = parlaklik↔parlakligi, k↔ğ): önek-içerme kaçırır
 *     (mutasyon noktasında ayrışır). Ortak önek (LCP) >=4 ve kısa tarafın son ~2 harfi hariç
 *     tamamını kapsıyorsa eşleştir (screenRegistry ile aynı kural).
 * 2-harfli ekler ("ac") gürültü yapmaz (min 3).
 */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 3 && long.startsWith(short)) return true;
  let lcp = 0;
  const m = short.length;
  while (lcp < m && a[lcp] === b[lcp]) lcp++;
  return lcp >= 4 && lcp >= short.length - 2;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Alias skorlaması (ALIAS SİSTEMİ — logic)
 * ════════════════════════════════════════════════════════════════════════ */

/** Precision ağırlığı — alias sorgunun ne kadarını AÇIKLADIĞINI ödüllendirir (gürültü ayrımı). */
const PRECISION_WEIGHT = 0.4;

/**
 * Tek bir (normalize) alias'ın sorgu token'larına karşı skoru 0..1. İki sinyalin çarpımı:
 *  - coverage = eşleşen / alias token sayısı — alias'ın NE KADARI söylendi (zorunlu sinyal).
 *  - precision = eşleşen / sorgu token sayısı — sorgunun NE KADARINI alias açıklıyor (gürültü ayrımı).
 * Tek-token kısa alias'ın (ör. 'çal', 'çalar'ı önekle yakalar) tüm cümleyi kapsayan çok-token
 * eşleşmeyi geçmesini engeller: precision düşükse skor düşer. Tam kapsama + tam açıklama → 1.0.
 */
function scoreAlias(queryTokens: readonly string[], aliasTokens: readonly string[]): number {
  if (aliasTokens.length === 0 || queryTokens.length === 0) return 0;
  const used = new Array<boolean>(queryTokens.length).fill(false);
  let matched = 0;
  for (const at of aliasTokens) {
    for (let i = 0; i < queryTokens.length; i++) {
      if (used[i]) continue;
      if (tokenMatches(queryTokens[i], at)) { used[i] = true; matched++; break; }
    }
  }
  if (matched === 0) return 0;
  const coverage = matched / aliasTokens.length;
  const precision = matched / queryTokens.length;
  if (coverage === 1 && precision === 1) return 1;
  const score = coverage * ((1 - PRECISION_WEIGHT) + PRECISION_WEIGHT * precision);
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

/** Bir niyetin (tüm alias'ları içinden) en iyi skoru. */
function scoreIntent(queryTokens: readonly string[], aliasTokenSets: readonly string[][]): number {
  let best = 0;
  for (const at of aliasTokenSets) {
    const s = scoreAlias(queryTokens, at);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Entity çıkarımı (DETERMİNİSTİK — uydurma YOK; bulunamazsa undefined)
 * ════════════════════════════════════════════════════════════════════════ */

/** Türkçe tema sözcüğü → kanonik tema (actionRegistry.PILOT_THEMES ile hizalı). */
const THEME_LEXICON: ReadonlyMap<string, string> = new Map<string, string>([
  ['gece', 'night'], ['gunduz', 'day'], ['oled', 'oled'],
  ['koyu', 'dark'], ['karanlik', 'dark'], ['aydinlik', 'day'], ['siyah', 'oled'],
]);

/** Navigasyon yapısal sözcükleri (destination çıkarımında AYIKLANIR — hedef değildir). */
const NAV_STRUCTURAL: ReadonlySet<string> = new Set<string>([
  'navigasyon', 'navigasyonu', 'rota', 'rotayi', 'yol', 'tarifi', 'tarif',
  'git', 'gidelim', 'gidecegim', 'baslat', 'ac', 'olustur', 'kur', 'goturme', 'goturur',
]);

/** İlk 0..100 tam sayı token'ını döndürür (parlaklık/ses için). Deterministik, regex yok. */
function extractInteger(tokens: readonly string[]): number | undefined {
  for (const t of tokens) {
    if (t.length === 0 || t.length > 3) continue;
    let allDigit = true;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c < 48 || c > 57) { allDigit = false; break; }
    }
    if (!allDigit) continue;
    const n = Number(t);
    if (Number.isInteger(n) && n >= 0 && n <= 100) return n;
  }
  return undefined;
}

/** İlk tanınan tema sözcüğünü kanonik değere çözer. */
function extractTheme(tokens: readonly string[]): string | undefined {
  for (const t of tokens) {
    const v = THEME_LEXICON.get(t);
    if (v) return v;
  }
  return undefined;
}

/** Navigasyon yapısal sözcükleri ayıklandıktan sonra kalan token'lar hedeftir (varsa). */
function extractDestination(tokens: readonly string[]): string | undefined {
  const rest = tokens.filter((t) => !NAV_STRUCTURAL.has(t));
  const dest = rest.join(' ').trim();
  return dest.length > 0 ? dest : undefined;
}

/** Entity adı → çıkarıcı. Kayıtlı olmayan entity sessizce yok sayılır (fail-closed). */
const ENTITY_EXTRACTORS: ReadonlyMap<string, (tokens: readonly string[]) => EntityValue | undefined> =
  new Map<string, (tokens: readonly string[]) => EntityValue | undefined>([
    ['theme', extractTheme],
    ['value', extractInteger],
    ['destination', extractDestination],
  ]);

/* ══════════════════════════════════════════════════════════════════════════
 * INTENT KATALOĞU (data — niyet → actionId + entity kontratı + alias'lar)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * MAVİ 4.0 DRIVE niyet kataloğu. Her niyet MEVCUT bir Action Registry eylemine bağlıdır
 * (DRIVE-1 nav · DRIVE-2 güvenli uygulama · Faz-1 pilot). `theme` değerleri PILOT_THEMES ile hizalı.
 * Alias'lar insan-okur Türkçe; resolver kurulumda normalize eder. Yeni eylem EKLEMEZ — yalnız
 * doğal dili var olan eylemlere bağlar.
 */
export const DRIVE_INTENT_CATALOG: readonly IntentDefinition[] = Object.freeze([
  {
    intent: 'open.home', actionId: 'open.home',
    requiredEntities: [], optionalEntities: [],
    description: 'Ana ekrana dön / açık çekmeceyi kapat.',
    aliases: ['ana sayfa', 'ana sayfayı aç', 'ana ekran', 'ana ekrana dön', 'anasayfa', 'başlangıç ekranı'],
  },
  {
    intent: 'open.settings', actionId: 'open.settings',
    requiredEntities: [], optionalEntities: [],
    description: 'Ayarlar ekranını aç.',
    aliases: ['ayarlar', 'ayarları aç', 'ayarlar menüsü', 'ayar menüsü'],
  },
  {
    intent: 'open.music', actionId: 'open.music',
    requiredEntities: [], optionalEntities: [],
    description: 'Müzik ekranını aç.',
    aliases: ['müzik', 'müzik aç', 'müzik çalar', 'çalar ekranı'],
  },
  {
    intent: 'open.phone', actionId: 'open.phone',
    requiredEntities: [], optionalEntities: [],
    description: 'Telefon/arama ekranını aç.',
    aliases: ['telefon', 'telefonu aç', 'arama ekranı', 'çevirici'],
  },
  {
    intent: 'go.back', actionId: 'go.back',
    requiredEntities: [], optionalEntities: [],
    description: 'Geri dön (mevcut çekmeceyi kapat).',
    aliases: ['geri', 'geri dön', 'geri git', 'önceki ekran', 'geri gel'],
  },
  {
    intent: 'open.vehicle_health', actionId: 'vehicle.health.read',
    requiredEntities: [], optionalEntities: [],
    description: 'Araç sağlığını oku ve göster (salt okuma).',
    aliases: ['araç sağlığı', 'araç sağlığını göster', 'araç durumu', 'sağlık raporu', 'araç sağlık durumu'],
  },
  {
    intent: 'refresh.device', actionId: 'refresh.device',
    requiredEntities: [], optionalEntities: [],
    description: 'Cihaz durumunu anında yenile.',
    aliases: ['cihazı yenile', 'cihaz yenile', 'cihazı tazele', 'durumu yenile'],
  },
  {
    intent: 'dismiss.toast', actionId: 'dismiss.toast',
    // Registry `dismiss.toast` başlık ZORUNLU tutar; jenerik ifade başlık taşımaz →
    // 'title' opsiyonel çıkarılır, doldurulamayınca `missingRequired`'a girmez (aktif toast
    // başlığını Execution katmanı sağlar). Ayrıntı: bkz. dosya sonu RİSK notu.
    requiredEntities: [], optionalEntities: ['title'],
    description: 'Ekrandaki bildirimi/toast\'ı kapat.',
    aliases: ['bildirimleri kapat', 'bildirimi kapat', 'bildirim kapat', 'uyarıyı kapat', 'bildirimleri gizle'],
  },
  {
    intent: 'media.play', actionId: 'media.play',
    requiredEntities: [], optionalEntities: [],
    description: 'Medyayı çal / devam ettir.',
    aliases: ['çal', 'oynat', 'müziği başlat', 'çalmaya devam et'],
  },
  {
    intent: 'media.pause', actionId: 'media.pause',
    requiredEntities: [], optionalEntities: [],
    description: 'Medyayı duraklat.',
    aliases: ['duraklat', 'müziği duraklat', 'durdur', 'beklet'],
  },
  {
    intent: 'media.next', actionId: 'media.next',
    requiredEntities: [], optionalEntities: [],
    description: 'Sonraki parçaya geç.',
    aliases: ['sonraki parça', 'sonraki şarkı', 'sonraki', 'bir sonraki', 'şarkıyı geç'],
  },
  {
    intent: 'navigation.open', actionId: 'navigation.open',
    requiredEntities: [], optionalEntities: ['destination'],
    description: 'Navigasyonu başlat (hedef verilirse rota kur).',
    aliases: ['navigasyon', 'navigasyonu başlat', 'navigasyonu aç', 'rota oluştur', 'yol tarifi', 'git'],
  },
  {
    intent: 'navigation.cancel', actionId: 'navigation.cancel',
    requiredEntities: [], optionalEntities: [],
    description: 'Navigasyonu/rotayı iptal et.',
    aliases: ['navigasyonu iptal et', 'rotayı iptal et', 'navigasyonu durdur', 'yol tarifini iptal et', 'rotayı kapat'],
  },
  {
    intent: 'set.theme', actionId: 'ui.theme.set',
    requiredEntities: ['theme'], optionalEntities: [],
    description: 'Uygulama temasını değiştir (gece/gündüz/oled/koyu).',
    aliases: ['tema', 'temayı değiştir', 'gece modu', 'gündüz modu', 'oled ekran', 'koyu tema', 'karanlık mod'],
  },
  {
    intent: 'set.brightness', actionId: 'ui.brightness.set',
    requiredEntities: ['value'], optionalEntities: [],
    description: 'Ekran parlaklığını ayarla (0..100).',
    aliases: ['parlaklık', 'parlaklığı ayarla', 'ekran parlaklığı', 'parlaklığı değiştir'],
  },
  {
    intent: 'set.volume', actionId: 'media.volume.set',
    requiredEntities: ['value'], optionalEntities: [],
    description: 'Ses seviyesini ayarla (0..100).',
    aliases: ['ses', 'sesi ayarla', 'ses seviyesi', 'sesi değiştir', 'ses düzeyi'],
  },
  {
    /* "Neredeyim?" — SALT-OKUMA konum sorgusu. Kataloğun SONUNA eklenir: skor eşitliğinde
       sıralama katalog sırasına düştüğü için mevcut niyetlerin önceliği DEĞİŞMEZ.
       Bu bir NAVİGASYON niyeti DEĞİLDİR — rota kurmaz, yalnız mevcut konumu söyler
       ('navigasyon'/'rota'/'git' alias'ları bilinçli olarak YOK, çakışma üretmesin). */
    intent: 'query.current_location', actionId: 'location.current.read',
    requiredEntities: [], optionalEntities: [],
    description: 'Mevcut konumu oku ve söyle (salt okuma).',
    aliases: [
      'neredeyim', 'şu an neredeyim', 'neredeyim şu an', 'neredeyiz', 'şu an neredeyiz',
      'konumumu söyle', 'konumum ne', 'konumum nedir', 'konumumu ver',
      'bulunduğum yer neresi', 'bulunduğumuz yer neresi', 'hangi konumdayım',
      'neresideyiz', 'buranın neresi olduğunu söyle',
    ],
  },
]);

// Kurulum-zamanı hizalama güvencesi: tema leksikonundaki tüm değerler gerçek bir PILOT_THEMES olmalı.
// (Yanlış kanonik tema üretimini erken yakalar — deterministik invaryant.)
{
  const themeSet = new Set<string>(PILOT_THEMES as readonly string[]);
  for (const v of THEME_LEXICON.values()) {
    if (!themeSet.has(v)) throw new Error(`intentResolver: bilinmeyen tema değeri '${v}' (PILOT_THEMES dışı)`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çözücü
 * ════════════════════════════════════════════════════════════════════════ */

interface CompiledIntent {
  readonly def: IntentDefinition;
  readonly aliasTokenSets: readonly string[][];
}

export class MaviIntentResolver {
  private readonly _compiled: readonly CompiledIntent[];
  private readonly _acceptThreshold: number;
  private readonly _ambiguityMargin: number;

  constructor(catalog: readonly IntentDefinition[] = DRIVE_INTENT_CATALOG, opts: IntentResolverOptions = {}) {
    // Alias'ları KURULUMDA normalize et (çözüm sıcak-yolunda yeniden normalize YOK — performans).
    const seen = new Set<string>();
    const compiled: CompiledIntent[] = [];
    for (const def of catalog) {
      if (!def || typeof def.intent !== 'string' || def.intent.length === 0) {
        throw new Error('MaviIntentResolver: geçersiz niyet tanımı (intent yok)');
      }
      if (seen.has(def.intent)) throw new Error(`MaviIntentResolver: çift niyet '${def.intent}'`);
      seen.add(def.intent);
      const aliasTokenSets = def.aliases
        .map((a) => tokenize(normalizeUtterance(a)))
        .filter((t) => t.length > 0);
      compiled.push({ def, aliasTokenSets });
    }
    this._compiled = compiled;
    this._acceptThreshold = clamp01(opts.acceptThreshold, 0.5);
    this._ambiguityMargin = clamp01(opts.ambiguityMargin, 0.12);
  }

  /** Kayıtlı niyet kimlikleri (deterministik — katalog sırası). */
  intents(): readonly string[] {
    return this._compiled.map((c) => c.def.intent);
  }

  /**
   * Doğal dil cümlesini Intent + Entity + Confidence'e çözer. ASLA throw etmez; belirsizde
   * UNKNOWN_INTENT döner (fail-closed). Aynı girdi → aynı çıktı (deterministik).
   */
  resolve(utterance: string): IntentResolution {
    const tokens = tokenize(normalizeUtterance(utterance));
    if (tokens.length === 0) return unknownResolution('empty', 0, []);

    // Tüm niyetleri skorla, azalan sırala (eşitlikte katalog sırası — deterministik).
    const scored: IntentCandidate[] = this._compiled.map((c) => ({
      intent: c.def.intent,
      confidence: scoreIntent(tokens, c.aliasTokenSets),
    }));
    scored.sort((a, b) => (b.confidence - a.confidence) || compareByCatalog(this._compiled, a.intent, b.intent));

    const best = scored[0];
    const second = scored[1];
    const alternatives = scored.slice(0, 3).filter((s) => s.confidence > 0);

    // Eşik altı → hiçbir niyete güvenilmez (no_match).
    if (!best || best.confidence < this._acceptThreshold) {
      return unknownResolution('no_match', best ? best.confidence : 0, alternatives);
    }
    // Yakın çekişme → tahmin etme (ambiguous). İki farklı niyet eşiği geçip marj içinde ise UNKNOWN.
    if (
      second && second.confidence >= this._acceptThreshold &&
      (best.confidence - second.confidence) < this._ambiguityMargin
    ) {
      return unknownResolution('ambiguous', best.confidence, alternatives);
    }

    // Kabul — bağlı eylemi ve entity'leri çöz.
    const compiled = this._compiled.find((c) => c.def.intent === best.intent) as CompiledIntent;
    const def = compiled.def;
    const { entities, missingRequired } = extractEntities(def, tokens);
    return Object.freeze({
      intent: def.intent,
      actionId: def.actionId,
      confidence: best.confidence,
      entities,
      missingRequired,
      reason: 'matched' as const,
      alternatives: Object.freeze(alternatives),
    });
  }

  /** @internal test/tanı — normalize edilmiş katalog (salt okuma). */
  get catalog(): readonly IntentDefinition[] {
    return this._compiled.map((c) => c.def);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function extractEntities(
  def: IntentDefinition,
  tokens: readonly string[],
): { entities: Readonly<Record<string, EntityValue>>; missingRequired: readonly string[] } {
  const entities: Record<string, EntityValue> = {};
  const missing: string[] = [];
  const slots = [...def.requiredEntities, ...def.optionalEntities];
  for (const slot of slots) {
    const extractor = ENTITY_EXTRACTORS.get(slot);
    const v = extractor ? extractor(tokens) : undefined;
    if (v !== undefined) entities[slot] = v;
  }
  for (const req of def.requiredEntities) {
    if (!(req in entities)) missing.push(req);
  }
  return { entities: Object.freeze(entities), missingRequired: Object.freeze(missing) };
}

function unknownResolution(
  reason: IntentReason, confidence: number, alternatives: readonly IntentCandidate[],
): IntentResolution {
  return Object.freeze({
    intent: UNKNOWN_INTENT,
    actionId: null,
    confidence,
    entities: Object.freeze({}),
    missingRequired: Object.freeze([]),
    reason,
    alternatives: Object.freeze(alternatives.slice()),
  });
}

/** Eşit skorda katalog sırasını koru (deterministik sıralama). */
function compareByCatalog(compiled: readonly CompiledIntent[], a: string, b: string): number {
  return compiled.findIndex((c) => c.def.intent === a) - compiled.findIndex((c) => c.def.intent === b);
}

function clamp01(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fabrika — varsayılan katalogla çözücü. Import yan etkisizdir. */
export function createIntentResolver(
  catalog: readonly IntentDefinition[] = DRIVE_INTENT_CATALOG,
  opts: IntentResolverOptions = {},
): MaviIntentResolver {
  return new MaviIntentResolver(catalog, opts);
}

/*
 * ── RİSK / DOWNSTREAM NOTU (DRIVE-4 için) ──────────────────────────────────
 * `dismiss.toast` eyleminin registry doğrulayıcısı `title` ZORUNLU ister; oysa "bildirimleri
 * kapat" jenerik ifadesi başlık taşımaz. Bu, niyet çözümü (bu katman) ile yürütme doğrulaması
 * (registry.validate) arasındaki BİLİNÇLİ ayrımdır: resolver niyeti doğru döndürür, `title`
 * opsiyonel entity olarak boş kalır. DRIVE-4 yürütme köprüsü ya aktif toast başlığını bağlamdan
 * (contextStore) sağlamalı ya da başlıksız kapatma yoluna (ör. dismiss.nav_prompt gibi) yönlendirmeli.
 * Resolver bu PR'da title UYDURMAZ (yanlış toast'ı kapatmamak için) — fail-closed dürüstlük.
 */
