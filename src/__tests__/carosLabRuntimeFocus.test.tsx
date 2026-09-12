/**
 * carosLabRuntimeFocus.test.tsx — CAROS LAB UX-F1 KİLİTLERİ.
 *
 * KAPSAM: `queue-monitor` ve `poll-scheduler` ORTAK RuntimeSchedulingScreen'i
 * paylaşmaya DEVAM EDER; yalnız BAŞLANGIÇ SIRASI giriş yapılan araç kimliğine göre
 * değişir.
 *
 * BU KİLİTLER NEYİ KORUR:
 *  - hiçbir kanal gizlenmez / silinmez / birleştirilmez (TÜM kanallar her iki girişte de
 *    var — 2026-08-30 · P0-VDK-B3 ile 'poll-cost' kanalı eklendi: 6 → 7),
 *  - bağlam yokken ESKİ sıra bit bit korunur (geriye uyumluluk),
 *  - sıralama SAF bir fonksiyondur (imperative scroll / DOM hack / timer YOK),
 *  - iki katalog girdisi ayrı ayrı yaşar,
 *  - A4 / A5 / A6 kilitleri zayıflatılmaz.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  orderChannelsForFocus, resolveFocusChannel,
  SCHED_FOCUS_CHANNEL, SCHED_FOCUS_LABEL, SCHED_CHANNEL_ORDER,
  type SchedChannel, type SchedChannelId, type SchedFocusContext,
} from '../platform/devtools/runtimeSchedulingModel';
import { buildSchedChannels, type SchedRawSnapshot } from '../platform/devtools/runtimeSchedulingBuild';
import { getCarosLabTool, CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { RuntimeSchedulingScreen } from '../components/devtools/screens/RuntimeSchedulingScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Kanal kurucularının tam yolunu çalıştıran minimum ham anlık görüntü. */
function snapshot(): SchedRawSnapshot {
  return {
    readAt: NOW,
    pollEvidence: null,
    sessionHealth: { pollingActive: true, dataFresh: true, transportReady: true, sessionReady: true },
    obdStatus: { connectionState: 'connected', source: 'real', lastSeenMs: NOW - 500 },
    health: { isStale: false, lastPacketAgeMs: 500 },
    freshWindowMs: 12_000,
    handshake: null,
    kwp: null,
    deepScan: null,
    canCollect: { collecting: false, bufferLen: 0, bufferMax: 500 },
    capture: { obdRefs: 0, canRefs: 0 },
  };
}

/** Markup'taki kanal kartlarının GERÇEK DOM sırası. */
function renderedChannelOrder(html: string): string[] {
  const out: string[] = [];
  const re = /data-testid="sched-channel-([a-z-]+)"/g;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(html);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DEFAULT_ORDER = [...SCHED_CHANNEL_ORDER] as SchedChannelId[];

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — queue-monitor → command-exec ilk sırada
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — queue-monitor command-exec kanalını İLK gösterir', () => {
  it('saf sıralama command-exec\'i başa alır', () => {
    const ch = orderChannelsForFocus(buildSchedChannels(snapshot()), 'queue-monitor');
    expect(ch[0].id).toBe('command-exec');
    expect(SCHED_FOCUS_CHANNEL['queue-monitor']).toBe('command-exec');
    expect(resolveFocusChannel('queue-monitor')).toBe('command-exec');
  });

  it('gerçek DOM sırası da command-exec ile başlar ve kart BİRİNCİL işaretlenir', () => {
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen focus="queue-monitor" />);
    expect(renderedChannelOrder(html)[0]).toBe('command-exec');
    expect(html).toContain('data-focus="queue-monitor"');
    expect(html).toContain('data-focus-channel="command-exec"');
    expect(html).toContain('sched-primary-command-exec');
    // Odak YALNIZ tek kartta olur
    expect((html.match(/data-primary="true"/g) ?? []).length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — poll-scheduler → live-polling ilk sırada
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — poll-scheduler live-polling kanalını İLK gösterir', () => {
  /* Kanal id'si repo gerçeğidir: `live-polling`. Görev metnindeki "live-poll"
     kısaltması repoda YOKTUR — uydurulmadı, gerçek id kullanıldı. */
  it('saf sıralama live-polling\'i başa alır', () => {
    const ch = orderChannelsForFocus(buildSchedChannels(snapshot()), 'poll-scheduler');
    expect(ch[0].id).toBe('live-polling');
    expect(SCHED_FOCUS_CHANNEL['poll-scheduler']).toBe('live-polling');
  });

  it('gerçek DOM sırası da live-polling ile başlar', () => {
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen focus="poll-scheduler" />);
    expect(renderedChannelOrder(html)[0]).toBe('live-polling');
    expect(html).toContain('data-focus="poll-scheduler"');
    expect(html).toContain('data-focus-channel="live-polling"');
    expect(html).toContain('sched-primary-live-polling');
  });

  it('iki giriş FARKLI birincil kanal üretir (bağlam gerçekten aktarılıyor)', () => {
    const q = renderedChannelOrder(renderToStaticMarkup(<RuntimeSchedulingScreen focus="queue-monitor" />));
    const p = renderedChannelOrder(renderToStaticMarkup(<RuntimeSchedulingScreen focus="poll-scheduler" />));
    expect(q[0]).not.toBe(p[0]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — kalan 5 kanal HER İKİ girişte de görünür
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — kalan kanallar korunur (gizleme/silme/birleştirme YOK)', () => {
  it('her iki girişte de TÜM kanalların TAMAMI vardır', () => {
    const base = buildSchedChannels(snapshot());
    for (const focus of ['queue-monitor', 'poll-scheduler'] as const) {
      const ids = orderChannelsForFocus(base, focus).map((c) => c.id);
      expect(ids).toHaveLength(DEFAULT_ORDER.length);
      expect([...ids].sort()).toEqual([...DEFAULT_ORDER].sort());
      expect(new Set(ids).size).toBe(ids.length);           // kopya yok
    }
  });

  it('kalan kanalların GÖRELİ sırası bozulmaz', () => {
    const base = buildSchedChannels(snapshot());
    for (const focus of ['queue-monitor', 'poll-scheduler'] as const) {
      const target = SCHED_FOCUS_CHANNEL[focus];
      const rest = orderChannelsForFocus(base, focus).map((c) => c.id).slice(1);
      expect(rest).toEqual(DEFAULT_ORDER.filter((id) => id !== target));
      /* P0-VDK-B3 (2026-08-30): 'poll-cost' kanalı eklendi → 5 → 6. Kilit
         KALDIRILMADI, yeni doğru değere taşındı; sayı artık `DEFAULT_ORDER`den
         TÜRETİLİR ki bir sonraki kanal değişiminde sessizce kaymasın. */
      expect(rest).toHaveLength(DEFAULT_ORDER.length - 1);
    }
  });

  it('markup\'ta da 6 kanal kartı basılır', () => {
    for (const focus of ['queue-monitor', 'poll-scheduler'] as const) {
      const rendered = renderedChannelOrder(renderToStaticMarkup(<RuntimeSchedulingScreen focus={focus} />));
      expect([...rendered].sort()).toEqual([...DEFAULT_ORDER].sort());
    }
  });

  it('kanal NESNELERİ aynen taşınır — içerik değiştirilmez', () => {
    const base = buildSchedChannels(snapshot());
    const ordered = orderChannelsForFocus(base, 'queue-monitor');
    for (const c of base) {
      expect(ordered).toContain(c);                          // referans eşitliği
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — toolId yokken ESKİ sıra korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — bağlam yokken varsayılan sıra korunur (geriye uyumluluk)', () => {
  it('undefined / null / tanınmayan değer sırayı DEĞİŞTİRMEZ', () => {
    const base = buildSchedChannels(snapshot());
    const expected = base.map((c) => c.id);
    expect(orderChannelsForFocus(base, undefined).map((c) => c.id)).toEqual(expected);
    expect(orderChannelsForFocus(base, null).map((c) => c.id)).toEqual(expected);
    expect(
      orderChannelsForFocus(base, 'bilinmeyen-arac' as unknown as SchedFocusContext).map((c) => c.id),
    ).toEqual(expected);
    expect(resolveFocusChannel(undefined)).toBeNull();
    expect(resolveFocusChannel('bilinmeyen-arac' as unknown as SchedFocusContext)).toBeNull();
  });

  it('prop\'suz ekran hâlâ render olur ve varsayılan sırayı basar', () => {
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen />);
    expect(renderedChannelOrder(html)).toEqual(DEFAULT_ORDER);
    expect(html).toContain('data-focus="none"');
    expect(html).not.toContain('data-primary="true"');
    expect(html).not.toContain('sched-focus');
  });

  it('girdi dizisi MUTASYONA UĞRAMAZ', () => {
    const base = buildSchedChannels(snapshot());
    const before = base.map((c) => c.id);
    orderChannelsForFocus(base, 'poll-scheduler');
    expect(base.map((c) => c.id)).toEqual(before);
  });

  it('boş / geçersiz girdi güvenli döner (fail-soft)', () => {
    expect(orderChannelsForFocus([], 'queue-monitor')).toEqual([]);
    expect(orderChannelsForFocus(null as unknown as SchedChannel[], 'queue-monitor')).toEqual([]);
    // Odak kanal listede yoksa sıra korunur — uydurma kanal EKLENMEZ
    const only = buildSchedChannels(snapshot()).filter((c) => c.id !== 'command-exec');
    const out = orderChannelsForFocus(only, 'queue-monitor');
    expect(out.map((c) => c.id)).toEqual(only.map((c) => c.id));
    expect(out.map((c) => c.id)).not.toContain('command-exec');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — iki katalog girdisi korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — katalog girdileri silinmez veya birleştirilmez', () => {
  it('queue-monitor ve poll-scheduler ayrı ayrı, AVAILABLE ve runtime kategorisinde', () => {
    const ids = CAROS_LAB_TOOLS.map((t) => t.id);
    expect(ids).toContain('queue-monitor');
    expect(ids).toContain('poll-scheduler');

    const q = getCarosLabTool('queue-monitor')!;
    const p = getCarosLabTool('poll-scheduler')!;
    for (const t of [q, p]) {
      expect(t.status).toBe('AVAILABLE');
      expect(t.category).toBe('runtime');
    }
    expect(q.name).not.toBe(p.name);
    expect(q.name).toBe(SCHED_FOCUS_LABEL['queue-monitor']);
    expect(p.name).toBe(SCHED_FOCUS_LABEL['poll-scheduler']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — ORTAK ekran paylaşımı devam eder
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — iki araç AYNI ekranı paylaşmaya devam eder', () => {
  it('eşleme aynı lazy bileşene çözülür, yalnız focus prop\'u farklıdır', () => {
    const q = renderAvailableTool('queue-monitor') as unknown as { type: unknown; props: { focus?: string } };
    const p = renderAvailableTool('poll-scheduler') as unknown as { type: unknown; props: { focus?: string } };
    expect(q).not.toBeNull();
    expect(p).not.toBeNull();
    expect(q.type).toBe(p.type);                                   // ORTAK ekran
    expect((q.type as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'));
    expect(q.props.focus).toBe('queue-monitor');
    expect(p.props.focus).toBe('poll-scheduler');
  });

  it('yeni route / ekran / state sistemi eklenmedi', async () => {
    const { readFileSync } = await import('node:fs');
    const map = stripComments(readFileSync('src/components/devtools/carosLabScreenMap.tsx', 'utf8'));
    // Ayrı ekran dosyası YOK: her iki case de AYNI bileşeni döndürür
    expect(map).toContain('case \'queue-monitor\':      return <RuntimeSchedulingScreen focus="queue-monitor" />;');
    expect(map).toContain('case \'poll-scheduler\':     return <RuntimeSchedulingScreen focus="poll-scheduler" />;');
    expect(map).not.toContain('QueueMonitorScreen');
    expect(map).not.toContain('PollSchedulerScreen');
    // Global state / router / store eklenmedi
    for (const f of ['create(', 'zustand', 'useNavigate', 'Router', 'localStorage']) {
      expect(map).not.toContain(f);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — timer / listener / imperative DOM YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — sıralama SAF; timer/listener/DOM hack eklenmedi', () => {
  it('sıralama fonksiyonu hiçbir zamanlayıcı kurmaz', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    const base = buildSchedChannels(snapshot());
    orderChannelsForFocus(base, 'queue-monitor');
    orderChannelsForFocus(base, 'poll-scheduler');
    orderChannelsForFocus(base, undefined);
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('ekran kaynağında imperative scroll / DOM erişimi / zamanlayıcı YOK', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/RuntimeSchedulingScreen.tsx', 'utf8'));
    for (const f of [
      'setInterval', 'setTimeout', 'subscribe', 'addListener', 'requestAnimationFrame',
      'scrollIntoView', 'scrollTo', 'document.', 'getElementById', 'querySelector',
      'createRef', 'findDOMNode',
    ]) expect(src).not.toContain(f);
    // Sıralama SAF fonksiyonla yapılır
    expect(src).toContain('orderChannelsForFocus');
  });

  it('model saf kalır: I/O ve React importu yok', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/platform/devtools/runtimeSchedulingModel.ts', 'utf8');
    for (const f of ['from \'react\'', 'setInterval', 'setTimeout', 'localStorage', 'fetch(']) {
      expect(src).not.toContain(f);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — A4 / A5 / A6 kilitleri zayıflatılmadı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — A4/A5/A6 kilitleri zayıflatılmadı', () => {
  it('A4 ekran değişmezleri yerinde: tek atış efekt + zero-leak + salt-okunurluk', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/RuntimeSchedulingScreen.tsx', 'utf8'));
    expect(src).toMatch(/useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\)/);
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
    for (const f of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnect(', 'startDeepScan',
      'setDiagnosticBurst', 'clearDTC', 'setCollecting',
    ]) expect(src).not.toContain(f);
  });

  it('A4/A5/A6 araçları hâlâ AVAILABLE ve kendi ekranlarına eşlenir', () => {
    for (const id of ['kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics'] as const) {
      expect(getCarosLabTool(id)!.status).toBe('AVAILABLE');
      expect(renderAvailableTool(id)).not.toBeNull();
    }
    // Runtime Scheduling ekranı bu üçünden HİÇBİRİNE karışmaz
    const rs = renderAvailableTool('queue-monitor') as unknown as { type: unknown };
    for (const id of ['kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics'] as const) {
      expect((renderAvailableTool(id) as unknown as { type: unknown }).type).not.toBe(rs.type);
    }
  });

  it('odak bağlamı ham veriyi, hükmü veya sınıflandırmayı DEĞİŞTİRMEZ', () => {
    const base = buildSchedChannels(snapshot());
    for (const focus of [undefined, 'queue-monitor', 'poll-scheduler'] as const) {
      const ordered = orderChannelsForFocus(base, focus);
      for (const c of ordered) {
        const original = base.find((b) => b.id === c.id)!;
        expect(c.activity).toBe(original.activity);
        expect(c.fields).toBe(original.fields);
      }
    }
    // Ekran metni: sıralamanın veri anlamı taşımadığı AÇIKÇA yazılır
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen focus="queue-monitor" />);
    expect(html).toContain('yalnız SIRALAMAYI değiştirir');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toMatch(/data-summary="(ACTIVE|PARTIAL|IDLE|BLOCKED|UNKNOWN)"/);
  });
});
