/**
 * docsReferenceIntegrity.test.ts — V-18 belge ↔ kod bütünlüğü KAPISI.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * `src/platform/OFFLINE_MAP_GUIDE.md` mimari çekirdek olarak `offlineMapService.ts`
 * ve `tileLoader.ts` adlı iki dosyayı anlatıyordu — **ikisi de repoda hiç yoktu**;
 * içindeki her `import` örneği derlenmeyecek koddu. Bu, `DOCUMENTATION ≠
 * IMPLEMENTATION` sınıfının en saf hâlidir ve hiçbir test onu yakalamıyordu.
 *
 * ── KAPSAM BİLİNÇLİ OLARAK DAR ─────────────────────────────────────────────
 * Kapı yalnız **REHBER/MİMARİ** belgeleri denetler. Tarihsel kayıtlar (kütük ·
 * devir · ADR · rapor · denetim · plan) silinmiş dosyaları anmakta HAKLIDIR —
 * onları "düzeltmek" tarihi yeniden yazmak olurdu. Kapı bu yüzden bir DIŞLAMA
 * deseni değil, açık bir İZLENEN LİSTE kullanır: yeni bir rehber yazan kişi onu
 * bilinçli olarak listeye ekler.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Denetlenen belgeler: "bu sistem BÖYLE çalışıyor" diyen, yani okuyanın
 * bugünün mimarisi sanacağı belgeler.
 */
const GUIDES: ReadonlyArray<{
  readonly path: string;
  /**
   * Rehberin BİLEREK "bu dosya YOKTU" diye andığı adlar.
   *
   * Bunlar kusur DEĞİL, kusurun KAYDIDIR: rehberin başındaki düzeltme notu eski
   * sürümün hangi hayalî dosyaları anlattığını söyler. Muafiyet dar tutulur —
   * listeye ad eklemek, o adın gerçekten "yok" diye anıldığını iddia etmektir.
   */
  readonly knownAbsent: readonly string[];
}> = [
  {
    path: 'src/platform/OFFLINE_MAP_GUIDE.md',
    knownAbsent: ['offlineMapService.ts', 'tileLoader.ts'],
  },
];

/** Markdown içindeki `backtick` ve **kalın** biçimli .ts/.tsx referansları. */
const REF_RE = /(?:`|\*\*)([A-Za-z0-9_./-]+\.(?:ts|tsx))(?:`|\*\*)/g;

function referencedFiles(md: string): readonly string[] {
  return [...new Set([...md.matchAll(REF_RE)].map((m) => m[1]))];
}

/**
 * Repo genelinde dosya ADI indeksi.
 *
 * Neden çıplak ada bakılıyor: rehberler modülü çoğu zaman `mapSourceManager.ts`
 * diye anar, tam yoluyla değil. Yalnız `src/<ad>` denemek, gerçekte
 * `src/platform/` altında duran her modülü "YOK" diye raporlardı — kapının
 * kendisi yalancı olurdu.
 */
const PRUNE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.worktrees', 'android']);

function indexFilenames(dir: string, out: Set<string>): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (PRUNE.has(e)) continue;
    const full = join(dir, e);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) indexFilenames(full, out);
    else out.add(e);
  }
}

const FILE_NAMES = new Set<string>();
indexFilenames(resolve(process.cwd(), 'src'), FILE_NAMES);
indexFilenames(resolve(process.cwd(), 'public'), FILE_NAMES);

/** Repoda böyle bir dosya var mı — tam yol VEYA çıplak ad. */
function existsInRepo(ref: string): boolean {
  const clean = ref.replace(/^@\//, '').replace(/^\.\//, '');
  const candidates = [clean, `src/${clean}`, `public/${clean}`];
  if (candidates.some((c) => existsSync(resolve(process.cwd(), c)))) return true;
  return FILE_NAMES.has(clean.split('/').pop() ?? clean);
}

describe('belge ↔ kod bütünlüğü', () => {
  for (const guide of GUIDES) {
    describe(guide.path, () => {
      const md = readFileSync(resolve(process.cwd(), guide.path), 'utf8');

      it('anlattığı HER dosya repoda GERÇEKTEN var', () => {
        const missing = referencedFiles(md)
          .filter((r) => !guide.knownAbsent.includes(r))
          .filter((r) => !existsInRepo(r));
        /* Düşerse: ya dosya yeniden adlandırıldı (rehberi güncelle) ya da
           silindi (iddiayı kaldır). Rehber, olmayan bir şeyi "çekirdek
           bileşen" diye anlatamaz. */
        expect(missing).toEqual([]);
      });

      it('en az bir gerçek modül anlatıyor — boş rehber kapıyı kandıramaz', () => {
        const real = referencedFiles(md).filter((r) => !guide.knownAbsent.includes(r));
        expect(real.length).toBeGreaterThan(3);
      });

      it('muafiyet listesindeki adlar GERÇEKTEN yok — muafiyet kalkan olamaz', () => {
        /* Biri var olan bir dosyayı listeye ekleyip kapıyı susturamasın. */
        for (const a of guide.knownAbsent) expect(existsInRepo(a)).toBe(false);
      });
    });
  }
});

/**
 * Eskimiş tasarım belgeleri SİLİNMEZ (tasarım gerekçesi değerlidir) ama
 * "bugünün mimarisi" sanılmamaları için durum bandı TAŞIMALIDIR.
 */
const STALE_SPECS = [
  'docs/archive/TECHNICAL_SPEC_STYLE_ENGINE.md',
  'docs/archive/TECHNICAL_SPEC_REMOTE_COMMAND.md',
  'docs/COMPANION_AI_ARCHITECTURE.md',
] as const;

describe('eskimiş tasarım belgeleri › durum bandı', () => {
  for (const spec of STALE_SPECS) {
    it(`${spec} — okuyucuyu UYARIYOR`, () => {
      const md = readFileSync(resolve(process.cwd(), spec), 'utf8');
      const head = md.slice(0, 2000);
      /* Bant BAŞTA olmalı: 40. satırda saklı bir uyarı, uyarı değildir. */
      expect(head).toMatch(/DURUM (DÜZELTMESİ|NOTU)/);
      expect(head).toMatch(/V-18/);
      /* Hangi dosyanın artık olmadığı AÇIKÇA yazmalı. */
      expect(head).toMatch(/YOKTUR/);
    });
  }
});
