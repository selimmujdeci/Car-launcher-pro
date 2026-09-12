/**
 * toolRouter — tool çağrılarının TEK güvenli giriş noktası.
 *
 * ── GÜVENLİK KAPILARI (sırayla, hepsi fail-closed) ─────────────────────────
 *   1) Özellik şalteri + kullanıcı izni (DI ile gelir)  → `not_permitted`
 *   2) ALLOWLIST: kayıt defterinde olmayan ad          → `unknown_tool`
 *   3) EFFECT kapısı: Faz 1'de yalnız `read`/`navigate` → `not_permitted`
 *   4) Onay gerektiren araç ÇALIŞTIRILMAZ              → `requires_confirmation`
 *   5) ŞEMA doğrulaması (bilinmeyen alan REDDEDİLİR)   → `invalid_arguments`
 *   6) İptal edilmişse çalıştırılmaz                   → `aborted`
 *   7) TIMEOUT + bounded sonuç
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Argümanlar, sonuç verisi ve kullanıcı metni LOGLANMAZ; telemetri yalnız
 * sayaç/kod taşır. Handler throw ederse router throw ETMEZ.
 */

import type {
  ToolArguments,
  ToolDefinition,
  ToolErrorCode,
  ToolExecutionContext,
  ToolParamSchema,
  ToolResult,
  ToolTelemetry,
} from './toolTypes';

/** Faz 1'de yürütülmesine izin verilen yan etkiler. */
const ALLOWED_EFFECTS = new Set(['read', 'navigate']);

/** Varsayılan tool bütçesi — sürücü bekliyor, uzun iş yok. */
export const DEFAULT_TOOL_TIMEOUT_MS = 3_000;
/** Sonuçta taşınacak azami alan sayısı ve metin uzunluğu (bounded). */
export const MAX_RESULT_FIELDS = 12;
export const MAX_SUMMARY_CHARS = 240;
export const MAX_STRING_VALUE_CHARS = 120;

export interface ToolRouterDeps {
  /** Allowlist — yalnız buradaki araçlar çağrılabilir. */
  readonly tools:   readonly ToolDefinition[];
  /** Özellik şalteri (yoksa KAPALI sayılır — fail-closed). */
  readonly enabled?: () => boolean;
  /** Kullanıcı izni (yoksa İZİN YOK sayılır). */
  readonly consent?: () => boolean;
  /** DI saat — süre ölçümü; verilmezse 0 raporlanır (uydurma ölçüm yok). */
  readonly clock?:   { nowMs(): number };
}

export interface ToolCallOutcome {
  readonly result:    ToolResult;
  readonly telemetry: ToolTelemetry;
}

export interface ToolRouter {
  /** Modelin göreceği tool tanımları (izin yoksa BOŞ). */
  listTools(): readonly ToolDefinition[];
  call(name: string, args: unknown, ctx?: ToolExecutionContext): Promise<ToolCallOutcome>;
}

/* ── Şema doğrulama ────────────────────────────────────────────────────────── */

function validateArguments(
  schema: Readonly<Record<string, ToolParamSchema>>,
  raw: unknown,
): { ok: true; args: ToolArguments } | { ok: false } {
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) return { ok: false };
  const input = (raw ?? {}) as Record<string, unknown>;

  // BİLİNMEYEN ALAN REDDEDİLİR (model uydurma parametre gönderemez).
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) return { ok: false };
  }

  const out: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined || value === null) {
      if (spec.required) return { ok: false };
      continue;
    }
    switch (spec.type) {
      case 'string': {
        if (typeof value !== 'string') return { ok: false };
        const trimmed = value.trim();
        if (!trimmed) return { ok: false };
        if (trimmed.length > (spec.maxLength ?? MAX_STRING_VALUE_CHARS)) return { ok: false };
        out[key] = trimmed;
        break;
      }
      case 'enum': {
        if (typeof value !== 'string') return { ok: false };
        if (!spec.values || !spec.values.includes(value)) return { ok: false };   // ALLOWLIST
        out[key] = value;
        break;
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
        if (spec.min !== undefined && value < spec.min) return { ok: false };
        if (spec.max !== undefined && value > spec.max) return { ok: false };
        out[key] = value;
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') return { ok: false };
        out[key] = value;
        break;
      }
      default:
        return { ok: false };
    }
  }
  return { ok: true, args: out };
}

/** Sonucu SINIRLAR: alan sayısı, metin uzunluğu, geçersiz sayı. */
function boundResult(result: ToolResult): ToolResult {
  if (!result.ok) return result;
  const data: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(result.data ?? {})) {
    if (count >= MAX_RESULT_FIELDS) break;
    if (typeof value === 'string') {
      data[key] = value.slice(0, MAX_STRING_VALUE_CHARS);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;                 // NaN/Infinity TAŞINMAZ
      data[key] = value;
    } else if (typeof value === 'boolean') {
      data[key] = value;
    } else {
      continue;                                              // nesne/dizi TAŞINMAZ
    }
    count++;
  }
  const summary = typeof result.summary === 'string' ? result.summary.slice(0, MAX_SUMMARY_CHARS) : '';
  return { ok: true, data, summary };
}

/* ── Router ────────────────────────────────────────────────────────────────── */

export function createToolRouter(deps: ToolRouterDeps): ToolRouter {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of deps.tools ?? []) {
    if (!tool || typeof tool.name !== 'string' || !/^[a-z0-9_]{1,40}$/.test(tool.name)) continue;
    if (typeof tool.handler !== 'function') continue;
    byName.set(tool.name, tool);
  }

  const permitted = (): boolean => {
    try {
      return deps.enabled?.() === true && deps.consent?.() === true;   // İKİSİ de gerekli
    } catch {
      return false;                                                    // okuma hatası → KAPALI
    }
  };

  const now = (): number => {
    try { return deps.clock?.nowMs() ?? 0; } catch { return 0; }
  };

  const fail = (
    code: ToolErrorCode, message: string, name: string,
    effect: ToolDefinition['effect'], durationMs = 0,
  ): ToolCallOutcome => ({
    result:    { ok: false, error: code, message },
    telemetry: { toolName: name, effect, ok: false, errorCode: code, durationMs, resultFields: 0 },
  });

  return {
    listTools(): readonly ToolDefinition[] {
      if (!permitted()) return [];                    // izin yoksa model tool GÖRMEZ
      return [...byName.values()].filter((t) => ALLOWED_EFFECTS.has(t.effect) && !t.requiresConfirmation);
    },

    async call(name: string, args: unknown, ctx: ToolExecutionContext = {}): Promise<ToolCallOutcome> {
      const started = now();

      if (!permitted())            return fail('not_permitted', 'Araç kullanımı için izin verilmemiş.', String(name ?? ''), 'read');
      const tool = byName.get(String(name ?? ''));
      if (!tool)                   return fail('unknown_tool', 'Bilinmeyen araç.', String(name ?? ''), 'read');
      if (!ALLOWED_EFFECTS.has(tool.effect)) {
        return fail('not_permitted', 'Bu araç bu sürümde kullanılamaz.', tool.name, tool.effect);
      }
      if (tool.requiresConfirmation === true) {
        return fail('requires_confirmation', 'Bu işlem için onayın gerekiyor.', tool.name, tool.effect);
      }

      const validated = validateArguments(tool.parameters ?? {}, args);
      if (!validated.ok)           return fail('invalid_arguments', 'Araç parametreleri geçersiz.', tool.name, tool.effect);
      if (ctx.signal?.aborted)     return fail('aborted', 'İstek iptal edildi.', tool.name, tool.effect);

      const timeoutMs = Number.isFinite(ctx.timeoutMs) && (ctx.timeoutMs as number) > 0
        ? (ctx.timeoutMs as number)
        : DEFAULT_TOOL_TIMEOUT_MS;

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<ToolResult>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: 'timeout', message: 'Araç zaman aşımına uğradı.' }), timeoutMs);
        });
        const execution = Promise.resolve(tool.handler(validated.args, { ...ctx, timeoutMs }));
        const raced = await Promise.race([execution, timeout]);

        const result = (raced && typeof raced === 'object' && typeof (raced as ToolResult).ok === 'boolean')
          ? boundResult(raced as ToolResult)
          : ({ ok: false, error: 'failed', message: 'Araç geçersiz sonuç döndürdü.' } as ToolResult);

        const durationMs = Math.max(0, now() - started);
        return {
          result,
          telemetry: {
            toolName: tool.name, effect: tool.effect, ok: result.ok, durationMs,
            ...(result.ok ? {} : { errorCode: result.error }),
            resultFields: result.ok ? Object.keys(result.data).length : 0,
          },
        };
      } catch {
        // Handler throw etse bile router throw ETMEZ.
        return fail('failed', 'Araç çalıştırılamadı.', tool.name, tool.effect, Math.max(0, now() - started));
      } finally {
        if (timer !== undefined) clearTimeout(timer);      // zero-leak
      }
    },
  };
}
