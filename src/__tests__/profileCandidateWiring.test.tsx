/**
 * profileCandidateWiring.test.tsx — V-04/6: `manufacturerProfileBuilder` bağlandı.
 *
 * NEDEN: builder "MANUEL ONAYA hazır adaylar üretir" diye yazılmıştı ama onaya
 * bakacak kimse yoktu — üretilen aday hiçbir yerde görünmüyordu. Var oluş sebebi
 * bir inceleme yüzeyi olan bir modül, o yüzey olmadan ölüdür.
 *
 * ANA İLKELER:
 *  (a) YAZMA YOK — profil/registry/VKB/bulut hiçbiri değişmez.
 *  (b) ÇAKIŞMA OTOMATİK ÇÖZÜLMEZ — "hazır" hükmü çakışmayı EZEMEZ.
 *  (c) TÜRETİLDİ olarak işaretlenir — adaylar ölçüm değil, türetimdir.
 *  (d) SESSİZ KIRPMA YOK — ekrana sığmayan aday sayısı görünür.
 *  (e) FAIL-SOFT — üretim patlarsa ekran boş liste değil AÇIK hata gösterir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import pcModelSrc from '../platform/devtools/profileCandidateModel.ts?raw';
import pcSourcesSrc from '../platform/devtools/profileCandidateSources.ts?raw';
import pcScreenSrc from '../components/devtools/screens/ProfileCandidateScreen.tsx?raw';

const rig = vi.hoisted(() => ({
  knowledge: [] as unknown[],
  candidates: [] as unknown[],
  knowledgeThrows: false,
}));

vi.mock('../platform/manufacturerIntelligenceEngine', () => ({
  getManufacturerIntelligence: () => {
    if (rig.knowledgeThrows) throw new Error('VKB okunamadı');
    return rig.knowledge;
  },
}));
vi.mock('../platform/manufacturerProfileBuilder', () => ({
  buildProfileCandidates: () => rig.candidates,
}));

import {
  readProfileCandidateSnapshot, CANDIDATE_ROW_CAP,
} from '../platform/devtools/profileCandidateSources';
import {
  buildCandidateGroups, countCandidates, deriveCandidateVerdict,
  CANDIDATE_VERDICT_LABEL,
} from '../platform/devtools/profileCandidateModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { ProfileCandidateScreen } from '../components/devtools/screens/ProfileCandidateScreen';
import type { ProfileCandidate } from '../platform/manufacturerProfileBuilder';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function cand(over: Partial<ProfileCandidate> = {}): ProfileCandidate {
  return {
    manufacturer: 'renault',
    profileHint: 'renault-generic',
    protocol: '',
    ecuAddress: '7E0',
    pidOrDid: '22F190',
    mode: '22',
    confidence: 0.8,
    vehicleCount: 3,
    seenCount: 12,
    firstSeen: NOW - 100_000,
    lastSeen: NOW - 1_000,
    candidateStatus: 'strong',
    mergeGroup: 'renault|DID|22F190',
    requiresManualReview: false,
    conflictReasons: [],
    ...over,
  } as ProfileCandidate;
}

function codeOnly(src: string): string {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

beforeEach(() => {
  rig.knowledge = [{ manufacturer: 'renault' }];
  rig.candidates = [cand()];
  rig.knowledgeThrows = false;
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. BAĞLANTI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — builder artık gerçek bir tüketiciye bağlı', () => {
  it('katalog AVAILABLE ve ekran çözülüyor', () => {
    expect(getCarosLabTool('profile-candidates')!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('profile-candidates')).not.toBeNull();
  });

  it('kaynak katmanı builder ve marka zekâsını GERÇEKTEN çağırır', () => {
    const code = codeOnly(pcSourcesSrc);
    expect(code).toMatch(/buildProfileCandidates\(/);
    expect(code).toMatch(/getManufacturerIntelligence\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. YAZMA YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — hiçbir katman profil/registry YAZMAZ', () => {
  it('yazma/onay çağrısı hiçbir katmanda yok', () => {
    for (const [name, src] of [
      ['kaynak', pcSourcesSrc], ['model', pcModelSrc], ['ekran', pcScreenSrc],
    ] as const) {
      const code = codeOnly(src);
      for (const forbidden of ['registerProfile', 'saveProfile', 'approve', 'upsert',
        'supabase', 'safeSetRaw', 'writeProfile']) {
        expect(code.includes(forbidden),
          `${name} katmanı ${forbidden} kullanıyor — yazma yolu açılmış`).toBe(false);
      }
    }
  });

  it('ekranda YENİLE dışında düğme YOKTUR (onayla düğmesi eklenmemiş)', () => {
    const html = renderToStaticMarkup(<ProfileCandidateScreen />);
    expect((html.match(/<button/g) ?? []).length).toBe(1);
  });

  it('model saf: I/O ve modül durumu YOK', () => {
    const code = codeOnly(pcModelSrc);
    expect(code.includes('Date.now'), 'model Date.now kullanıyor').toBe(false);
    expect(/^(let|var) /m.test(code), 'model modül durumu tutuyor').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. GRUPLAMA — varyantlar GİZLENMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — aynı sinyalin ECU varyantları tek grupta ama görünür', () => {
  it('aynı mergeGroup tek grup olur, varyantlar korunur', () => {
    rig.candidates = [
      cand({ ecuAddress: '7E0' }),
      cand({ ecuAddress: '7E1' }),
    ];
    const groups = buildCandidateGroups(readProfileCandidateSnapshot());
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
    expect(groups[0].variants.map((v) => v.ecuAddress)).toEqual(['7E0', '7E1']);
  });

  it('farklı sinyal ayrı grup olur', () => {
    rig.candidates = [
      cand({ pidOrDid: '22F190', mergeGroup: 'renault|DID|22F190' }),
      cand({ pidOrDid: '2280', mergeGroup: 'renault|DID|2280' }),
    ];
    expect(buildCandidateGroups(readProfileCandidateSnapshot())).toHaveLength(2);
  });

  it('adaylar TÜRETİLDİ olarak işaretlenir (ölçüm değil)', () => {
    const groups = buildCandidateGroups(readProfileCandidateSnapshot());
    expect(groups[0].klass).toBe('DERIVED');
  });

  it('sayaçlar grup ve varyantı AYRI sayar', () => {
    rig.candidates = [cand({ ecuAddress: '7E0' }), cand({ ecuAddress: '7E1' })];
    const counts = countCandidates(buildCandidateGroups(readProfileCandidateSnapshot()));
    expect(counts.groups).toBe(1);
    expect(counts.variants).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. ÇAKIŞMA OTOMATİK ÇÖZÜLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — çakışma "hazır"ı EZER', () => {
  it('tek varyant bile inceleme isterse grup inceleme ister', () => {
    rig.candidates = [
      cand({ ecuAddress: '7E0' }),
      cand({ ecuAddress: '7E1', requiresManualReview: true, conflictReasons: ['confidence çelişkisi'] }),
    ];
    const groups = buildCandidateGroups(readProfileCandidateSnapshot());
    expect(groups[0].needsReview).toBe(true);
    expect(groups[0].conflicts).toContain('confidence çelişkisi');
  });

  it('çakışmalı aday varken hüküm HAZIR olamaz', () => {
    rig.candidates = [cand({ requiresManualReview: true, conflictReasons: ['çakışma'] })];
    const snap = readProfileCandidateSnapshot();
    const v = deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap)));
    expect(v.status).toBe('REVIEW_REQUIRED');
    expect(v.status).not.toBe('READY_FOR_REVIEW');
  });

  it('çakışma yoksa İNCELEMEYE HAZIR', () => {
    const snap = readProfileCandidateSnapshot();
    expect(deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap))).status)
      .toBe('READY_FOR_REVIEW');
  });

  it('çakışma nedenleri model içinde ÇÖZÜLMEZ, yalnız toplanır', () => {
    expect(codeOnly(pcModelSrc).includes('conflictReasons = []'),
      'model çakışmayı siliyor — insan kararı yok sayılır').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. BOŞ/HATA DURUMLARI DÜRÜST
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — boş ile bilinmeyen ayrı', () => {
  it('marka kaydı yoksa BİLGİ TABANI BOŞ', () => {
    rig.knowledge = [];
    rig.candidates = [];
    const snap = readProfileCandidateSnapshot();
    expect(deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap))).status)
      .toBe('NO_KNOWLEDGE');
  });

  it('kayıt var ama aday yoksa GÜÇLÜ ADAY YOK (kayıt yok DEĞİL)', () => {
    rig.candidates = [];
    const snap = readProfileCandidateSnapshot();
    expect(deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap))).status)
      .toBe('NO_CANDIDATES');
  });

  it('üretim patlarsa ÜRETİM DÜŞTÜ — sessiz boş liste yok', () => {
    rig.knowledgeThrows = true;
    const snap = readProfileCandidateSnapshot();
    expect(snap.error).not.toBeNull();
    expect(deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap))).status)
      .toBe('READ_FAILED');
  });

  it('tavanı aşan aday sayısı GÖRÜNÜR taşınır', () => {
    rig.candidates = Array.from({ length: CANDIDATE_ROW_CAP + 5 }, (_, i) =>
      cand({ pidOrDid: `22F1${i}`, mergeGroup: `renault|DID|22F1${i}` }));
    const snap = readProfileCandidateSnapshot();
    expect(snap.totalCandidates).toBe(CANDIDATE_ROW_CAP + 5);
    expect(snap.trimmed).toBe(5);
    expect(snap.rows).toHaveLength(CANDIDATE_ROW_CAP);
    const v = deriveCandidateVerdict(snap, countCandidates(buildCandidateGroups(snap)));
    expect(v.reasons.join(' ')).toMatch(/kırpıldı/);
  });

  it('her hükmün Türkçe etiketi vardır', () => {
    Object.values(CANDIDATE_VERDICT_LABEL).forEach((l) => expect(l.length).toBeGreaterThan(0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. EKRAN
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — ekran çizimi', () => {
  it('ekran çizilir ve salt-okunur beyanını taşır', () => {
    const html = renderToStaticMarkup(<ProfileCandidateScreen />);
    expect(html).toContain('ÜRETİCİ PROFİL ADAYLARI');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="pc-groups"');
  });

  it('çakışmalı grup ekranda İNSAN KARARI GEREKLİ olarak işaretlenir', () => {
    rig.candidates = [cand({ requiresManualReview: true, conflictReasons: ['ECU çelişkisi'] })];
    const html = renderToStaticMarkup(<ProfileCandidateScreen />);
    expect(html).toContain('data-review="required"');
    expect(html).toContain('ECU çelişkisi');
  });

  it('kırpma ekranda rozetle görünür', () => {
    rig.candidates = Array.from({ length: CANDIDATE_ROW_CAP + 2 }, (_, i) =>
      cand({ pidOrDid: `22F2${i}`, mergeGroup: `renault|DID|22F2${i}` }));
    const html = renderToStaticMarkup(<ProfileCandidateScreen />);
    expect(html).toContain('data-testid="pc-trim"');
  });
});
