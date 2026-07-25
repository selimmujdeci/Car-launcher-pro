/**
 * maviCore/actionRegistry.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Typed AppAction KAYIT DEFTERİ.
 *
 * AMAÇ (VİZYON — "her sinyal bir kararın parçası"): Mavi'nin çalıştırabileceği HER uygulama
 * eylemi burada RESMİ, tiplenmiş bir kontratla tanımlanır. Kayıtlı olmayan hiçbir eylem
 * yürütülemez (fail-closed). Bu, "sabit komut parser'ı" DEĞİLDİR — dilden bağımsız, tek
 * yetkili eylem sözlüğüdür; niyet çözümü (LLM/parser) bu deftere BAĞLANIR, deftere gömülmez.
 *
 * TASARIM İLKELERİ (CLAUDE.md · aiCore deseniyle bire-bir):
 *  - SAF METADATA: bu modül eylemin NE olduğunu tanımlar (schema/risk/reversible/timeout/
 *    result kontratı/araç kapsamı) — eylemin NASIL yapılacağını (gerçek servis çağrısı) DEĞİL.
 *    Yürütme (portlar + perform) executionEngine'de (sonraki PR). Böylece defter yan etkisiz,
 *    servis bağımlılığı YOK, tam test edilebilir.
 *  - FAIL-CLOSED: bilinmeyen id → undefined (çağıran reddeder). Bozuk payload → validate() hata.
 *    Çift kayıt → kurulum-zamanı Error (programlama hatası sessizce yutulmaz).
 *  - İKİNCİ OTORİTE YOK: `vehicleScope` yalnız METADATA'dır; asıl araç güvenlik kararı
 *    AiSafetyGate'e delege edilir (actionSafety — sonraki PR). Defter karar VERMEZ.
 *  - risk/reversible: yürütme motorunun onay (medium→confirmation) ve rollback kararlarının girdisi.
 */

import type { AiCapabilityScope } from '../aiCore/safetyGate';

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

/** Eylemin risk seviyesi — yürütme onay/rollback politikasının girdisi. */
export type ActionRiskLevel = 'low' | 'medium' | 'high';

/**
 * Eylemin sonuç kontratı:
 *  - 'ack'   : yalnız başarı/başarısızlık döner (UI/media/nav eylemleri).
 *  - 'value' : bir veri taşır (ör. vehicle.health.read → sağlık özeti).
 */
export type ActionResultContract = 'ack' | 'value';

/** Payload doğrulama sonucu (SAF — girdi mutate edilmez). */
export interface ActionValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Doğrulanmış + normalize edilmiş payload (ok=false ise undefined). */
  readonly value?: Readonly<Record<string, unknown>>;
}

/** Bir eylemin payload doğrulayıcısı — SAF, throw ETMEZ (fail-closed sonuç döner). */
export type ActionValidator = (payload: unknown) => ActionValidationResult;

/**
 * Resmi eylem tanımı. Yürütmenin ihtiyaç duyduğu tüm metadata + payload sözleşmesi. Gerçek
 * servis çağrısı (perform) burada DEĞİL — executionEngine handler map'inde bağlanır.
 */
export interface ActionDefinition {
  /** Kararlı, nokta-ayrık kimlik (ör. 'ui.theme.set', 'media.play'). */
  readonly id: string;
  /** İnsan-okur kısa başlık (log/onay diyaloğu). */
  readonly title: string;
  readonly risk: ActionRiskLevel;
  /**
   * Geri alınabilir mi — rollback yalnız reversible=true eylemlerde denenir (executionEngine).
   * "Geri alınabilir" = etkisini tersine çeviren bir eylem VARDIR (tema eskiye döner, medya
   * duraklatılır). media.next gibi tek-yön eylemler false'tur.
   */
  readonly reversible: boolean;
  /** Bounded yürütme tavanı (ms). Aşılırsa executionEngine adımı timeout ile keser. */
  readonly timeoutMs: number;
  readonly resultContract: ActionResultContract;
  /**
   * Araç-ETKİLİ eylemler için AiSafetyGate kapsamı (ör. vehicle.health.read → 'read'). UI/
   * media/navigation eylemleri araç ECU'suna dokunmaz → tanımsız (araç güvenlik kararı
   * gerektirmez; yalnız UX risk sınıfı geçerli). ecu_write/coding/actuator ASLA verilmez
   * (verilseydi bile AiSafetyGate hard-forbidden reddederdi).
   */
  readonly vehicleScope?: AiCapabilityScope;
  readonly validate: ActionValidator;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hafif payload doğrulayıcı yardımcıları (SAF · bağımlılıksız)
 * ════════════════════════════════════════════════════════════════════════ */

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** Boş/parametresiz payload bekleyen eylemler (media.play, media.pause…) — daima ok. */
export function validateEmpty(_payload: unknown): ActionValidationResult {
  return { ok: true, errors: [], value: Object.freeze({}) };
}

/** Belirli bir alanı enum kümesinden bekler. */
export function makeEnumValidator(field: string, allowed: readonly string[]): ActionValidator {
  const set = new Set(allowed);
  return (payload: unknown): ActionValidationResult => {
    const rec = asRecord(payload);
    if (!rec) return { ok: false, errors: [`payload nesne değil`] };
    const v = rec[field];
    if (typeof v !== 'string' || !set.has(v)) {
      return { ok: false, errors: [`${field} geçersiz (beklenen: ${allowed.join('|')})`] };
    }
    return { ok: true, errors: [], value: Object.freeze({ [field]: v }) };
  };
}

/** Belirli bir alanı [min,max] aralığında sayı bekler (sonlu). */
export function makeNumberRangeValidator(field: string, min: number, max: number): ActionValidator {
  return (payload: unknown): ActionValidationResult => {
    const rec = asRecord(payload);
    if (!rec) return { ok: false, errors: [`payload nesne değil`] };
    const v = rec[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      return { ok: false, errors: [`${field} ${min}..${max} aralığında sayı olmalı`] };
    }
    return { ok: true, errors: [], value: Object.freeze({ [field]: v }) };
  };
}

/** Opsiyonel string alan (verilirse boş-olmayan string). Boş payload da geçerli. */
export function makeOptionalStringValidator(field: string): ActionValidator {
  return (payload: unknown): ActionValidationResult => {
    const rec = asRecord(payload);
    if (!rec) return { ok: true, errors: [], value: Object.freeze({}) };
    const v = rec[field];
    if (v === undefined || v === null) return { ok: true, errors: [], value: Object.freeze({}) };
    if (typeof v !== 'string' || v.trim().length === 0) {
      return { ok: false, errors: [`${field} boş-olmayan string olmalı`] };
    }
    return { ok: true, errors: [], value: Object.freeze({ [field]: v.trim() }) };
  };
}

/** Zorunlu boş-olmayan string alan. */
export function makeRequiredStringValidator(field: string): ActionValidator {
  return (payload: unknown): ActionValidationResult => {
    const rec = asRecord(payload);
    const v = rec?.[field];
    if (typeof v !== 'string' || v.trim().length === 0) {
      return { ok: false, errors: [`${field} zorunlu (boş-olmayan string)`] };
    }
    return { ok: true, errors: [], value: Object.freeze({ [field]: v.trim() }) };
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıt defteri
 * ════════════════════════════════════════════════════════════════════════ */

export class MaviActionRegistry {
  private readonly _defs = new Map<string, ActionDefinition>();

  /** Bir eylem tanımı kaydet. Çift id → Error (kurulum-zamanı programlama hatası). */
  register(def: ActionDefinition): void {
    if (!def || typeof def.id !== 'string' || def.id.length === 0) {
      throw new Error('MaviActionRegistry.register: geçersiz tanım (id yok)');
    }
    if (this._defs.has(def.id)) {
      throw new Error(`MaviActionRegistry.register: çift kayıt '${def.id}'`);
    }
    // Savunma derinliği: yazma kapsamları (hard-forbidden) bir eyleme metadata olarak bile
    // eklenemez — Faz-1 read-only invaryantı defter seviyesinde de zorlanır.
    if (def.vehicleScope && HARD_FORBIDDEN_METADATA.has(def.vehicleScope)) {
      throw new Error(`MaviActionRegistry.register: yasak kapsam '${def.vehicleScope}' ('${def.id}')`);
    }
    this._defs.set(def.id, Object.freeze({ ...def }));
  }

  /** Kayıtlı tanımı getir; bilinmeyen id → undefined (fail-closed). */
  get(id: string): ActionDefinition | undefined {
    return typeof id === 'string' ? this._defs.get(id) : undefined;
  }

  has(id: string): boolean {
    return typeof id === 'string' && this._defs.has(id);
  }

  /** Kayıtlı tüm eylem id'leri (sıralı — deterministik). */
  ids(): readonly string[] {
    return [...this._defs.keys()].sort();
  }

  get size(): number { return this._defs.size; }
}

/** Metadata seviyesinde bile yasak kapsamlar (AiSafetyGate HARD_FORBIDDEN ile hizalı). */
const HARD_FORBIDDEN_METADATA: ReadonlySet<AiCapabilityScope> = new Set<AiCapabilityScope>([
  'ecu_write', 'coding', 'adaptation', 'actuator',
]);

/** Fabrika — boş defter. Import yan etkisizdir. */
export function createActionRegistry(): MaviActionRegistry {
  return new MaviActionRegistry();
}

/* ══════════════════════════════════════════════════════════════════════════
 * PİLOT EYLEM SETİ (Faz-1 — 10 eylem). Yalnız VERİ tanımı (yan etkisiz).
 * ════════════════════════════════════════════════════════════════════════ */

/** Pilot UI tema seçenekleri (mevcut tema motoruyla hizalı). */
export const PILOT_THEMES = Object.freeze(['night', 'day', 'oled', 'dark'] as const);

/**
 * Faz-1 pilot eylemleri. Hepsi düşük-risk UI/media/navigation + salt-okuma araç sağlığı;
 * hiçbiri ECU'ya yazmaz. vehicle.health.read araç-ETKİLİ olduğundan `vehicleScope:'read'`
 * taşır (AiSafetyGate'ten geçer); gerisi araç kapsamsızdır.
 */
export const PILOT_ACTIONS: readonly ActionDefinition[] = Object.freeze([
  {
    id: 'ui.theme.set', title: 'Tema değiştir', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack',
    validate: makeEnumValidator('theme', PILOT_THEMES),
  },
  {
    id: 'ui.page.open', title: 'Ekran aç', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack',
    validate: makeRequiredStringValidator('page'),
  },
  {
    id: 'ui.brightness.set', title: 'Parlaklık ayarla', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack',
    validate: makeNumberRangeValidator('value', 0, 100),
  },
  {
    id: 'media.play', title: 'Medya çal', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
  },
  {
    id: 'media.pause', title: 'Medya duraklat', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
  },
  {
    // Tek-yön: sonraki parça geri alınamaz (reversible=false → rollback denenmez).
    id: 'media.next', title: 'Sonraki parça', risk: 'low', reversible: false,
    timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
  },
  {
    id: 'media.volume.set', title: 'Ses seviyesi ayarla', risk: 'low', reversible: true,
    timeoutMs: 2_000, resultContract: 'ack',
    validate: makeNumberRangeValidator('value', 0, 100),
  },
  {
    // Hedef opsiyonel (boş → navigasyon ekranını aç). Rota başlatma cancel ile geri alınır.
    id: 'navigation.open', title: 'Navigasyon başlat', risk: 'low', reversible: true,
    timeoutMs: 5_000, resultContract: 'ack',
    validate: makeOptionalStringValidator('destination'),
  },
  {
    id: 'navigation.cancel', title: 'Navigasyonu iptal et', risk: 'low', reversible: false,
    timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
  },
  {
    /* "Neredeyim?" — SALT-OKUMA konum sorgusu. Araç ECU'suna DOKUNMAZ (GPS cihaz sensörüdür)
       → `vehicleScope` YOK, AiSafetyGate araç kapsamı gerektirmez. Yan etkisiz: navigasyon
       başlatmaz, rota kurmaz, hiçbir şey yazmaz → reversible (geri alınacak etki yok).
       timeout: GPS snapshot senkron + reverse geocoding bütçesi 3s → 5s güvenli tavan. */
    id: 'location.current.read', title: 'Mevcut konumu oku', risk: 'low', reversible: true,
    timeoutMs: 5_000, resultContract: 'value', validate: validateEmpty,
  },
  {
    // Araç-ETKİLİ (salt okuma) → AiSafetyGate 'read' kapsamından geçer. EXTENDED DID okuması
    // 12s'e kadar sürebilir (sensorQueryService deseni) → timeout geniş. Yan etkisiz → reversible.
    id: 'vehicle.health.read', title: 'Araç sağlığı oku', risk: 'low', reversible: true,
    timeoutMs: 12_000, resultContract: 'value', vehicleScope: 'read', validate: validateEmpty,
  },
]);

/** Pilot eylemleri verilen deftere kaydet (yan etki tek çağrıda; idempotent değil — çift çağrı Error). */
export function registerPilotActions(registry: MaviActionRegistry): void {
  for (const def of PILOT_ACTIONS) registry.register(def);
}

/** Kısa yol: pilot eylemlerle dolu yeni defter. */
export function createPilotActionRegistry(): MaviActionRegistry {
  const reg = createActionRegistry();
  registerPilotActions(reg);
  return reg;
}
