/**
 * aiCore/safetyGate.ts — AI Core GÜVENLİK KAPISI (Faz-1 read-only invaryantının bekçisi).
 *
 * AMAÇ: AI Core ajanlarının araç üzerinde YAPABİLECEĞİ her eylemi tek bir kapıdan geçirir.
 * Faz-1 SÖZLEŞMESİ (VİZYON ANAYASASI): "ECU write, coding ve actuator kapsam dışı." Bu
 * kapı o sözleşmeyi KOD SEVİYESİNDE zorlar — bir ajan (bugün AI Mechanic, yarın başkası)
 * yanlışlıkla veya kötü niyetle yazma isteği üretse bile kapı fail-closed reddeder.
 *
 * NEDEN AYRI MODÜL (savunma derinliği): "sadece read-only kod yazdık" yeterli değildir —
 * niyetin RUNTIME kanıtı gerekir. Her ajan eylemi bu kapıya sorar; kapı kararı + gerekçe
 * döner. Böylece Faz-2'de yazma açılırken kapı TEK değişim noktasıdır (ajanlar değişmez).
 *
 * ZERO-TRUST / FAIL-CLOSED: bilinmeyen/bozuk istek → DENY. HARD_FORBIDDEN kapsamları
 * (ecu_write · coding · actuator · adaptation) yapılandırma ne derse desin ASLA açılamaz
 * (savunma derinliği — allowedScopes'a eklense bile reddedilir). SAF: I/O yok, yan etki yok.
 */

/**
 * Bir ajanın araçtan talep edebileceği erişim kapsamı. Faz-1'de yalnız `read` meşrudur;
 * gerisi yazma/etki içerir ve KAPSAM DIŞIDIR.
 */
export type AiCapabilityScope =
  | 'read'         // salt okuma (PID/DTC/VIN okuma, canlı telemetri) — Faz-1 tek meşru kapsam
  | 'clear_dtc'    // arıza kodu silme (yazma) — Faz-1 kapsam dışı
  | 'ecu_write'    // ECU belleğine yazma — DAİMA yasak (HARD_FORBIDDEN)
  | 'coding'       // kodlama/konfigürasyon — DAİMA yasak
  | 'adaptation'   // adaptasyon/öğretme — DAİMA yasak
  | 'actuator';    // aktüatör tetikleme (bidirectional) — DAİMA yasak

export interface AiActionRequest {
  /** İsteği yapan ajan kimliği (log/gerekçe için). */
  readonly agentId: string;
  readonly scope: AiCapabilityScope;
  /** Opsiyonel insan-okur açıklama (log). */
  readonly description?: string;
}

export interface SafetyGateDecision {
  readonly allowed: boolean;
  readonly scope: AiCapabilityScope;
  /** Makine-okur gerekçe kodu (ör. 'ok', 'not_in_allowed_scopes', 'hard_forbidden'). */
  readonly reason: string;
}

/**
 * HİÇBİR yapılandırmayla açılamayan kapsamlar (Faz-1 anayasal invaryant). Bir gate örneği
 * allowedScopes'ta bunlardan birini alsa bile kapı reddeder → savunma derinliği.
 */
export const HARD_FORBIDDEN_SCOPES: ReadonlySet<AiCapabilityScope> = new Set<AiCapabilityScope>([
  'ecu_write', 'coding', 'adaptation', 'actuator',
]);

/** Faz-1 varsayılan izinli kapsam: yalnız okuma. */
export const DEFAULT_ALLOWED_SCOPES: readonly AiCapabilityScope[] = Object.freeze(['read'] as const);

const VALID_SCOPES: ReadonlySet<string> = new Set<AiCapabilityScope>([
  'read', 'clear_dtc', 'ecu_write', 'coding', 'adaptation', 'actuator',
]);

export interface SafetyGateDeps {
  /**
   * Bu gate örneğinin izin verdiği kapsamlar (varsayılan: yalnız 'read'). HARD_FORBIDDEN
   * kapsamları burada verilse bile ETKİSİZDİR (kapı yine reddeder). Faz-2 yazma yolu
   * açılırken izin bu listeye + capability/authoritative kanıt kapısına bağlanacak.
   */
  readonly allowedScopes?: readonly AiCapabilityScope[];
}

/**
 * AI Core güvenlik kapısı. Tek görev: bir ajan eyleminin Faz-1 kapsamında olup olmadığına
 * fail-closed karar vermek. Karar SAFTIR (aynı girdi → aynı çıktı), gözlemlenebilirlik için
 * sayaç tutar.
 */
export class AiSafetyGate {
  private readonly _allowed: ReadonlySet<AiCapabilityScope>;
  private _allowedCount = 0;
  private _deniedCount = 0;

  constructor(deps: SafetyGateDeps = {}) {
    const requested = Array.isArray(deps.allowedScopes) ? deps.allowedScopes : DEFAULT_ALLOWED_SCOPES;
    const set = new Set<AiCapabilityScope>();
    for (const s of requested) {
      // HARD_FORBIDDEN asla eklenmez — yapılandırma bunu ezemez (savunma derinliği).
      if (VALID_SCOPES.has(s) && !HARD_FORBIDDEN_SCOPES.has(s)) set.add(s);
    }
    // 'read' her zaman meşrudur (AI Core'un varlık nedeni okumaktır).
    set.add('read');
    this._allowed = set;
  }

  /** Bir eylem isteğini değerlendirir (fail-closed). Yan etki YOK — yalnız karar + sayaç. */
  evaluate(request: AiActionRequest): SafetyGateDecision {
    // Bozuk/eksik istek → DENY (zero-trust).
    if (!request || typeof request !== 'object' || typeof request.scope !== 'string' || !VALID_SCOPES.has(request.scope)) {
      this._deniedCount++;
      return Object.freeze({ allowed: false, scope: 'read', reason: 'invalid_request' });
    }
    const scope = request.scope;
    // Anayasal olarak yasak → DENY (allowedScopes ne olursa olsun).
    if (HARD_FORBIDDEN_SCOPES.has(scope)) {
      this._deniedCount++;
      return Object.freeze({ allowed: false, scope, reason: 'hard_forbidden' });
    }
    // İzinli kümede mi?
    if (!this._allowed.has(scope)) {
      this._deniedCount++;
      return Object.freeze({ allowed: false, scope, reason: 'not_in_allowed_scopes' });
    }
    this._allowedCount++;
    return Object.freeze({ allowed: true, scope, reason: 'ok' });
  }

  /** Kısa yol: bu kapsam şu an açık mı (yan etkisiz — sayaç artırmaz). */
  isScopeAllowed(scope: AiCapabilityScope): boolean {
    return typeof scope === 'string' && !HARD_FORBIDDEN_SCOPES.has(scope) && this._allowed.has(scope);
  }

  /** Faz-1 invaryantı: kapı yalnız okuma izin veriyor mu (yazma kapsamı hiç açık değil mi). */
  get isReadOnly(): boolean {
    for (const s of this._allowed) if (s !== 'read') return false;
    return true;
  }

  get allowedScopes(): readonly AiCapabilityScope[] {
    return [...this._allowed];
  }

  get stats(): { allowedCount: number; deniedCount: number } {
    return { allowedCount: this._allowedCount, deniedCount: this._deniedCount };
  }
}

/** Fabrika — DI ile örnek üretir. Import yan etkisizdir (yalnız açıkça oluşturulunca çalışır). */
export function createAiSafetyGate(deps: SafetyGateDeps = {}): AiSafetyGate {
  return new AiSafetyGate(deps);
}
