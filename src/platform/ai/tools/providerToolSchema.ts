/**
 * providerToolSchema — ORTAK tool sözleşmesini sağlayıcı şemalarına çeviren
 * SAF dönüştürücüler.
 *
 * Tek bir `ToolDefinition` yazılır; buradan hem OpenAI-uyumlu (OpenRouter)
 * `tools` dizisine hem Gemini `functionDeclarations` dizisine türetilir.
 * Böylece iki sağlayıcı AYNI sözleşmeyi kullanır ve yeni araç eklerken
 * sağlayıcıya özel iş yapılmaz.
 *
 * SAF: IO yok, global yok, girdi mutasyona uğramaz.
 *
 * ⚠️ FAZ 1 SINIRI: bu çeviriciler HAZIRDIR ama gateway/provider istek gövdesine
 * HENÜZ BAĞLANMAMIŞTIR (çok turlu tool-call döngüsü Faz 2). Bu yüzden
 * `capabilityAdapter` her iki sağlayıcı için `supportsTools:false` bildirmeye
 * DEVAM EDER — sahte yetenek ilan edilmez.
 */

import type { ToolDefinition, ToolParamSchema } from './toolTypes';

/** JSON Schema'ya çevrilmiş tek parametre. */
interface JsonSchemaProperty {
  readonly type:         'string' | 'number' | 'boolean';
  readonly description:  string;
  readonly enum?:        readonly string[];
  readonly maxLength?:   number;
  readonly minimum?:     number;
  readonly maximum?:     number;
}

interface JsonSchemaObject {
  readonly type:       'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required:   readonly string[];
  /** Bilinmeyen alan REDDEDİLİR (router da ayrıca zorlar). */
  readonly additionalProperties: false;
}

function toJsonSchemaProperty(spec: ToolParamSchema): JsonSchemaProperty {
  if (spec.type === 'enum') {
    return {
      type: 'string',
      description: spec.description,
      ...(spec.values ? { enum: [...spec.values] } : {}),
    };
  }
  if (spec.type === 'number') {
    return {
      type: 'number',
      description: spec.description,
      ...(spec.min !== undefined ? { minimum: spec.min } : {}),
      ...(spec.max !== undefined ? { maximum: spec.max } : {}),
    };
  }
  if (spec.type === 'boolean') {
    return { type: 'boolean', description: spec.description };
  }
  return {
    type: 'string',
    description: spec.description,
    ...(spec.maxLength !== undefined ? { maxLength: spec.maxLength } : {}),
  };
}

function toJsonSchema(tool: ToolDefinition): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(tool.parameters ?? {})) {
    properties[key] = toJsonSchemaProperty(spec);
    if (spec.required) required.push(key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** OpenAI-uyumlu (OpenRouter) `tools` gösterimi. */
export function toOpenAiTools(tools: readonly ToolDefinition[]): readonly Record<string, unknown>[] {
  return (tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name:        tool.name,
      description: tool.description,
      parameters:  toJsonSchema(tool),
    },
  }));
}

/** Gemini `functionDeclarations` gösterimi. */
export function toGeminiFunctionDeclarations(tools: readonly ToolDefinition[]): readonly Record<string, unknown>[] {
  return (tools ?? []).map((tool) => ({
    name:        tool.name,
    description: tool.description,
    parameters:  toJsonSchema(tool),
  }));
}
