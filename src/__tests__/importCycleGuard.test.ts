// @vitest-environment node
/**
 * Statik runtime import döngüsü kilidi.
 *
 * Döngüdeki bir modül üst düzeyde (top-level) başka bir döngü üyesinin
 * binding'ine dokunursa ES modül değerlendirme sırası TDZ hatası üretir —
 * dev sunucusu "Cannot access 'REROUTE_THRESHOLD_M' before initialization"
 * ile tam bu yüzden çöktü (bkz. navImportCycleGuard). Döngü durdukça aynı
 * çökme yeni bir top-level satırla geri gelebilir.
 *
 * Sayılan kenarlar: değerlendirme sırasını belirleyen statik `import` /
 * `export … from`. Sayılmayanlar (değerlendirme sırasına etkisi yok):
 * `import type`, yalnız type specifier'lı import, dinamik `import()`.
 *
 * MAX_CYCLE_FILES yalnız AŞAĞI çekilir; döngü kırıldıkça düşürülür.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MAX_CYCLE_FILES = 16;

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

function runtimeImportGraph(): Map<string, string[]> {
  const cfgPath = join(ROOT, 'tsconfig.app.json');
  const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ROOT);
  const files = cfg.fileNames.filter(
    (f) => f.startsWith(SRC) && !/__tests__|\.test\.|\.spec\./.test(f) && !f.endsWith('.d.ts'),
  );
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
    const deps = new Set<string>();
    const add = (spec: ts.Expression) => {
      if (!ts.isStringLiteral(spec)) return;
      const r = ts.resolveModuleName(spec.text, file, cfg.options, ts.sys).resolvedModule;
      if (r && known.has(r.resolvedFileName)) deps.add(r.resolvedFileName);
    };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const ic = st.importClause;
        if (ic?.isTypeOnly) continue;
        const nb = ic?.namedBindings;
        if (ic && !ic.name && nb && ts.isNamedImports(nb) && nb.elements.length > 0
            && nb.elements.every((e) => e.isTypeOnly)) continue;
        add(st.moduleSpecifier);
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly) {
        const ec = st.exportClause;
        if (ec && ts.isNamedExports(ec) && ec.elements.length > 0 && ec.elements.every((e) => e.isTypeOnly)) continue;
        add(st.moduleSpecifier);
      }
    }
    graph.set(file, [...deps]);
  }
  return graph;
}

/** Tarjan SCC (iteratif); yalnız 1'den büyük (veya kendine import eden) bileşenler. */
function cycles(graph: Map<string, string[]>): string[][] {
  let next = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const start of graph.keys()) {
    if (index.has(start)) continue;
    const work: Array<[string, number]> = [[start, 0]];
    index.set(start, next); low.set(start, next); next++; stack.push(start); onStack.add(start);
    while (work.length > 0) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const deps = graph.get(v)!;
      if (i < deps.length) {
        top[1]++;
        const w = deps[i];
        if (!index.has(w)) {
          index.set(w, next); low.set(w, next); next++; stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) === index.get(v)) {
        const comp: string[] = [];
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1 || deps.includes(v)) out.push(comp.map((f) => relative(SRC, f)).sort());
      }
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

describe('statik runtime import döngüleri', () => {
  it(`döngüdeki dosya sayısı ${MAX_CYCLE_FILES}'i aşmaz`, () => {
    const found = cycles(runtimeImportGraph());
    const total = found.reduce((n, c) => n + c.length, 0);
    const report = found.map((c) => `  [${c.length}] ${c.join(', ')}`).join('\n');
    expect(total, `Statik import döngüsü büyüdü:\n${report}`).toBeLessThanOrEqual(MAX_CYCLE_FILES);
  }, 60_000);
});
