/**
 * toolTypes — Mavi Tool Router sözleşmeleri (SAĞLAYICI-BAĞIMSIZ).
 *
 * Tek bir tool tanımı YAZILIR; OpenRouter (OpenAI `tools`) ve Gemini
 * (`functionDeclarations`) şemalarına SAF ÇEVİRİCİLERLE dönüştürülür
 * (`providerToolSchema.ts`). Sağlayıcıya özel alan bu dosyada YOKTUR.
 *
 * ── FAZ 1 KAPSAMI: YALNIZ SALT-OKUNUR + GÜVENLİ ────────────────────────────
 * Yazma, silme, AKTİF OBD/ECU komutu, DTC temizleme, ayar değiştirme YOKTUR.
 * `effect` alanı bunu TİP DÜZEYİNDE zorlar: Faz 1 kaydı yalnız `read` veya
 * `navigate` olabilir (registry testi bunu kilitler).
 */

/** Aracın yan etkisi. Faz 1'de yalnız ilk ikisi kayıt defterine girebilir. */
export type ToolEffect = 'read' | 'navigate' | 'write' | 'vehicle_command';

/** Desteklenen parametre tipleri — sınırlı ve doğrulanabilir küme. */
export type ToolParamType = 'string' | 'number' | 'boolean' | 'enum';

export interface ToolParamSchema {
  readonly type:        ToolParamType;
  readonly description: string;
  readonly required?:   boolean;
  /** `enum` için izinli değerler (ALLOWLIST). */
  readonly values?:     readonly string[];
  /** `string` için azami uzunluk (bounded girdi). */
  readonly maxLength?:  number;
  /** `number` için fiziksel/mantıksal sınırlar. */
  readonly min?:        number;
  readonly max?:        number;
}

export type ToolArguments = Readonly<Record<string, string | number | boolean>>;

/** Tool sonucu — BOUNDED ve tipli. Ham nesne/dump TAŞIMAZ. */
export type ToolResult =
  | { readonly ok: true;  readonly data: Readonly<Record<string, string | number | boolean>>; readonly summary: string }
  | { readonly ok: false; readonly error: ToolErrorCode; readonly message: string };

export type ToolErrorCode =
  | 'unknown_tool'          // allowlist'te yok
  | 'invalid_arguments'     // şema doğrulaması düştü
  | 'not_permitted'         // izin/şalter kapalı ya da onay gerekiyor
  | 'requires_confirmation' // kullanıcı onayı gerekir → ÇALIŞTIRILMAZ
  | 'unavailable'           // kaynak yok (araç bağlı değil vb.)
  | 'timeout'
  | 'aborted'
  | 'failed';

export interface ToolExecutionContext {
  readonly signal?:    AbortSignal;
  readonly timeoutMs?: number;
  /** DI saat — `Date.now` gömülü DEĞİL. */
  readonly nowMs?:     number;
}

/**
 * Bir aracın TANIMI. `handler` SALT-OKUNUR olmalı ve ASLA throw etmemelidir
 * (router yine de savunmacı sarar).
 */
export interface ToolDefinition {
  /** Kararlı kimlik — model bu adı çağırır. `[a-z0-9_]{1,40}` */
  readonly name:        string;
  readonly description: string;
  readonly effect:      ToolEffect;
  /**
   * `true` → çalıştırmadan ÖNCE kullanıcı onayı gerekir. Faz 1'de router bu
   * araçları ÇALIŞTIRMAZ (`requires_confirmation` döner) — onay akışı yok.
   */
  readonly requiresConfirmation?: boolean;
  readonly parameters:  Readonly<Record<string, ToolParamSchema>>;
  handler(args: ToolArguments, ctx: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}

/** YALNIZ güvenli metadata — argüman/sonuç/kullanıcı verisi TAŞIMAZ. */
export interface ToolTelemetry {
  readonly toolName:     string;
  readonly effect:       ToolEffect;
  readonly ok:           boolean;
  readonly errorCode?:   ToolErrorCode;
  readonly durationMs:   number;
  readonly resultFields: number;
}
