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
