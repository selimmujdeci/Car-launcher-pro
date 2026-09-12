/**
 * serviceRoutineWiring.test.tsx — V-04/5: `serviceFunctions` kapısı gözleme bağlandı.
 *
 * NEDEN: modül "araca yazan tek profesyonel yol"un KAPISI olarak yazılmıştı ama
 * üründe hiç çağrılmıyordu — kapının gerçek araç verisiyle nasıl karar verdiği
 * cihazda hiç görülemiyordu.
 *
 * ANA İLKELER (bu ekran araca yazan yola bakıyor — kilitler SERT):
 *  (a) YAZMA YOK — ekran/kaynak/model hiçbir rutini çalıştırmaz, komut göndermez.
 *  (b) İKİNCİ İZİN MOTORU YOK — karar yalnız `evaluateServiceRoutine`'den gelir.
 *  (c) "ARAÇ UYGUN" ≠ "ÇALIŞTIRILABİLİR" — insan/kanıt kapıları DAİMA kapalı.
 *  (d) KANIT YOKSA SÖYLE — rutin destek kanalı yok, uydurulmaz.
 *  (e) RİSK METNİ KISALTILMAZ — bilgilendirilmiş rıza metni ham gösterilir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import svcModelSrc from '../platform/devtools/serviceRoutineModel.ts?raw';
import svcSourcesSrc from '../platform/devtools/serviceRoutineSources.ts?raw';
import svcScreenSrc from '../components/devtools/screens/ServiceRoutineScreen.tsx?raw';

const obd = vi.hoisted(() => ({
  snap: null as unknown,
  throws: false,
}));

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => {
    if (obd.throws) throw new Error('OBD okunamadı');
    return obd.snap;
  },
}));

import { readServiceRoutineSnapshot } from '../platform/devtools/serviceRoutineSources';
import {
  buildServiceRoutineViews, buildHumanGates, deriveServiceRoutineVerdict,
  SERVICE_ROUTINE_ORDER, SERVICE_VERDICT_LABEL, READINESS_LABEL,
} from '../platform/devtools/serviceRoutineModel';
import { SERVICE_ROUTINES } from '../platform/obd/serviceFunctions';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { ServiceRoutineScreen } from '../components/devtools/screens/ServiceRoutineScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Duran araç, motor kapalı, bağlantı TAZE.
 *
 * `lastSeenMs` gerçek `Date.now()`'dan türer: kaynak katmanı `nowMs`'i kendi okur,
 * sabit bir geçmiş damga kullansaydık kapı her koşumda "bayat" derdi ve testler
 * yanlış nedenle yeşil/kırmızı olurdu. Sistem saati MOCK'LANMAZ (kalıcı yan etki yok).
 */
function parked(over: Record<string, unknown> = {}) {
  return {
    connectionState: 'connected',
    speed: 0,
    rpm: 0,
    lastSeenMs: Date.now() - 500,
    dataFresh: true,
    source: 'real',
    ...over,
  };
}

function codeOnly(src: string): string {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

beforeEach(() => {
  obd.snap = parked();
  obd.throws = false;
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. BAĞLANTI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — kapı artık ürün yolundan çağrılıyor', () => {
  it('katalog AVAILABLE ve ekran çözülüyor', () => {
    expect(getCarosLabTool('service-routines')!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('service-routines')).not.toBeNull();
  });

  it('model gerçek kapıyı çağırır (kendi izin mantığını yazmaz)', () => {
    const code = codeOnly(svcModelSrc);
    expect(code, 'gerçek kapı çağrısı kaldırılmış').toMatch(/evaluateServiceRoutine\(/);
    /* İkinci izin motoru işareti: kapının içindeki eşikleri burada tekrar yazmak. */
    expect(code.includes('WRITE_GATE_MAX_DATA_AGE_MS'),
      'model kapının eşiğini kopyalıyor — ikinci izin motoru').toBe(false);
    expect(code.includes('evaluateDtcClearGate'),
      'model alt kapıyı doğrudan çağırıyor — sıra atlanır').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. YAZMA YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — hiçbir katman araca YAZMAZ', () => {
  it('kaynak/model/ekran native yazma çağrısı içermez', () => {
    for (const [name, src] of [
      ['kaynak', svcSourcesSrc], ['model', svcModelSrc], ['ekran', svcScreenSrc],
    ] as const) {
      const code = codeOnly(src);
      for (const forbidden of ['sendCommand', 'writeDataByIdentifier', 'routineControl',
        'CarLauncher.', 'clearDtc', 'startRoutine']) {
        expect(code.includes(forbidden),
          `${name} katmanı ${forbidden} kullanıyor — YAZMA yolu açılmış`).toBe(false);
      }
    }
  });

  it('ekranda rutin çalıştıran düğme YOKTUR (yalnız YENİLE)', () => {
    const html = renderToStaticMarkup(<ServiceRoutineScreen />);
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length, 'ekranda birden fazla düğme var — komut düğmesi eklenmiş olabilir').toBe(1);
    expect(html).toContain('data-testid="svc-refresh"');
  });

  it('kaynak katmanı onayı UYDURMAZ (confirmed sabit false)', () => {
    const snap = readServiceRoutineSnapshot();
    expect(snap.gate!.confirmed).toBe(false);
    expect(codeOnly(svcSourcesSrc)).toMatch(/confirmed:\s*false/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. ARAÇ ÖNKOŞULLARI GERÇEKTEN ÖLÇÜLÜR
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — araç önkoşulları', () => {
  it('duran araç + motor kapalı: motor DURMALI rutinleri uygun', () => {
    const views = buildServiceRoutineViews(readServiceRoutineSnapshot());
    const reset = views.find((v) => v.kind === 'service_reset')!;
    expect(reset.readiness).toBe('READY');
    expect(reset.blockedMessage).toBeNull();
  });

  it('motor kapalıyken DPF (motor ÇALIŞMALI) KAPALI ve kapının mesajı görünür', () => {
    const dpf = buildServiceRoutineViews(readServiceRoutineSnapshot())
      .find((v) => v.kind === 'dpf_regeneration')!;
    expect(dpf.readiness).toBe('BLOCKED');
    expect(dpf.blockedMessage).toMatch(/motor/i);
  });

  it('motor çalışırken tersine döner (DPF uygun, reset kapalı)', () => {
    obd.snap = parked({ rpm: 800 });
    const views = buildServiceRoutineViews(readServiceRoutineSnapshot());
    expect(views.find((v) => v.kind === 'dpf_regeneration')!.readiness).toBe('READY');
    expect(views.find((v) => v.kind === 'service_reset')!.readiness).toBe('BLOCKED');
  });

  it('araç hareket ederken HEPSİ kapalı', () => {
    obd.snap = parked({ speed: 40, rpm: 2000 });
    const views = buildServiceRoutineViews(readServiceRoutineSnapshot());
    expect(views.every((v) => v.readiness === 'BLOCKED')).toBe(true);
  });

  it('telemetri BAYATSA "duruyor" iddiası kabul edilmez', () => {
    obd.snap = parked({ lastSeenMs: Date.now() - 60_000 });
    const views = buildServiceRoutineViews(readServiceRoutineSnapshot());
    expect(views.every((v) => v.readiness === 'BLOCKED')).toBe(true);
  });

  it('bağlantı yoksa hepsi kapalı', () => {
    obd.snap = parked({ connectionState: 'disconnected' });
    expect(buildServiceRoutineViews(readServiceRoutineSnapshot())
      .every((v) => v.readiness === 'BLOCKED')).toBe(true);
  });

  it('OBD okunamazsa BİLİNMİYOR olur — "uygun" DA "kapalı" DA denmez', () => {
    obd.throws = true;
    const snap = readServiceRoutineSnapshot();
    expect(snap.gate).toBeNull();
    const views = buildServiceRoutineViews(snap);
    expect(views.every((v) => v.readiness === 'UNKNOWN')).toBe(true);
    expect(views.every((v) => v.klass === 'UNAVAILABLE')).toBe(true);
    expect(deriveServiceRoutineVerdict(snap, views).status).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. "ARAÇ UYGUN" ≠ "ÇALIŞTIRILABİLİR"
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — insan/kanıt kapıları DAİMA kapalı', () => {
  it('üç kapı da kapalı ve rutin destek kanalı YOK olarak beyan edilir', () => {
    const gates = buildHumanGates();
    expect(gates.map((g) => g.id).sort()).toEqual(['confirmation', 'risk-ack', 'routine-support']);
    expect(gates.find((g) => g.id === 'routine-support')!.state).toBe('NO_EVIDENCE_CHANNEL');
    expect(gates.filter((g) => g.state === 'CLOSED')).toHaveLength(2);
  });

  it('hüküm "araç uygun" derken yazma kapılarının kapalı olduğunu SÖYLER', () => {
    const snap = readServiceRoutineSnapshot();
    const v = deriveServiceRoutineVerdict(snap, buildServiceRoutineViews(snap));
    expect(v.status).toBe('VEHICLE_READY_GATES_CLOSED');
    expect(v.reasons.join(' ')).toMatch(/komut gönderilmez/i);
  });

  it('hiçbir hüküm etiketi "çalıştırılabilir/hazır" iddiası taşımaz', () => {
    for (const label of Object.values(SERVICE_VERDICT_LABEL)) {
      expect(/çalıştır/i.test(label), `yanıltıcı etiket: ${label}`).toBe(false);
    }
    for (const label of Object.values(READINESS_LABEL)) {
      expect(/çalıştır/i.test(label), `yanıltıcı etiket: ${label}`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. RİSK METNİ HAM GÖSTERİLİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — bilgilendirilmiş rıza metni kısaltılmaz', () => {
  it('her rutinin risk metni model çıktısında AYNEN taşınır', () => {
    const views = buildServiceRoutineViews(readServiceRoutineSnapshot());
    for (const kind of SERVICE_ROUTINE_ORDER) {
      const v = views.find((x) => x.kind === kind)!;
      expect(v.risk).toBe(SERVICE_ROUTINES[kind].risk);
    }
  });

  it('ekran DPF risk metnini tam olarak basar', () => {
    const html = renderToStaticMarkup(<ServiceRoutineScreen />);
    /* HTML kaçışları nedeniyle ayırt edici bir parça aranır. */
    expect(html).toContain('DPF zarar görebilir');
    expect(html).toContain('data-testid="svc-human-gates"');
  });

  it('ekran her rutini kendi hazırlık durumuyla işaretler', () => {
    const html = renderToStaticMarkup(<ServiceRoutineScreen />);
    for (const kind of SERVICE_ROUTINE_ORDER) {
      expect(html).toContain(`data-testid="svc-routine-${kind}"`);
    }
    expect(html).toMatch(/data-readiness="(READY|BLOCKED|UNKNOWN)"/);
  });
});
