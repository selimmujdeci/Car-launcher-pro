/**
 * nodeTsResolve.mjs — Node'un YERLEŞİK tip-sıyırma özelliğiyle `.ts` koşumu.
 *
 * Neden var: depo kaynağı uzantısız içe aktarım kullanır (`./map/graph/rtg2Reader`);
 * Node ESM ise açık uzantı ister. Bu çözümleyici yalnız o boşluğu kapatır —
 * DERLEME YAPMAZ, tip kontrolü YAPMAZ (o `tsc -b`nin işidir) ve ürün koduna
 * girmez. Yalnız `scripts/` altındaki doğrulama koşumları içindir.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.mjs', '.js'];

export async function resolve(specifier, context, nextResolve) {
  /* `.json` içe aktarımı: Node ESM `with { type: 'json' }` ister, depo kaynağı
     (bundler hedefli) bunu yazmaz. Öznitelik burada eklenir — davranış aynı,
     yalnız koşum ortamının şartı karşılanır. */
  if (/\.json$/.test(specifier)) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, importAttributes: { type: 'json' }, shortCircuit: true };
  }
  if (specifier.startsWith('.') && !/\.(ts|tsx|mjs|cjs|js|json)$/.test(specifier)) {
    const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const suffix of CANDIDATES) {
      const candidate = resolvePath(base, specifier + suffix);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

/**
 * `import.meta.env` — Vite'ın derleme-zamanı sabitidir; Node'da YOKTUR.
 * Doğrulama koşumu ürün modüllerini olduğu gibi içe aktardığı için burada
 * küresel bir shim'e yönlendirilir. Değer üretilmez: `globalThis.__VITE_ENV__`
 * koşum betiği tarafından AÇIKÇA kurulur (kurulmazsa boş nesnedir).
 */
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if ((result.format === 'module' || result.format === 'module-typescript') &&
      typeof result.source === 'string' && result.source.includes('import.meta.env')) {
    return {
      ...result,
      source: result.source.replaceAll(
        'import.meta.env', '(globalThis.__VITE_ENV__ ?? {})'),
    };
  }
  if ((result.format === 'module' || result.format === 'module-typescript') &&
      result.source && typeof result.source !== 'string') {
    const text = Buffer.from(result.source).toString('utf8');
    if (text.includes('import.meta.env')) {
      return {
        ...result,
        source: text.replaceAll('import.meta.env', '(globalThis.__VITE_ENV__ ?? {})'),
      };
    }
  }
  return result;
}
