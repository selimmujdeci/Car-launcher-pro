/**
 * Hız limiti levhası — OEM SUNUM sözleşmesi (OEM Navigation Experience · PR-1).
 *
 * Bu tur YALNIZ sunumu değiştirdi. Hüküm üretimi (`EffectiveSpeedLimit`),
 * gösterilebilirlik kapısı, kesinlik ayrımı ve kaynak etiketi AYNEN duruyor —
 * o katman gerçek araç doğrulaması bekliyor (kütük #388-390) ve bu testler
 * ona DOKUNMAZ.
 *
 * Kilitlenen iki kusur:
 *  1. Levha ORANSIZDI — halka çapın %9,6–10,5'iydi. Gerçek trafik levhasında
 *     (Viyana Sözleşmesi; Google Maps ve Android Automotive aynısını korur)
 *     kırmızı halka çapın ~%13'ü, rakam ~%47'sidir. İnce halka levhayı
 *     "trafik levhası" değil "beyaz daire" gibi gösteriyordu.
 *  2. Boyut SABİT PİKSELDİ (38/52). Head unit'te doğru duran levha telefon
 *     yatayında ve dikey navigasyonda ekranın çok büyük bölümünü kaplıyordu.
 *     HU için yazılmış mutlak ölçülerin küçük ekranda çökmesi bu üründe
 *     ölçülmüş bir kusur ailesidir (kütük #329/#330).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { SpeedLimitCard } from '../components/map/SpeedLimitCard';
import cardSrc from '../components/map/SpeedLimitCard.tsx?raw';
import type { EffectiveSpeedLimit } from '../platform/navigation/core/vehicleAwareSpeedLimitAuthority';

/* Proje idiomu: `renderToStaticMarkup` + jsdom ayrıştırma. Yeni test
   bağımlılığı EKLENMEZ (bkz. CLAUDE.md lisans/bağımlılık disiplini). */
function mount(el: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(el);
  return host;
}

/** Yorumları ayıklar — kilitler YALNIZ koda bakar (proje idiomu). */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/** Gösterilebilir bir hüküm üretir — hüküm MANTIĞI burada taklit EDİLMEZ,
 *  yalnız kartın çizim girdisi olarak sabit bir kayıt verilir. */
function verdict(over: Partial<EffectiveSpeedLimit> = {}): EffectiveSpeedLimit {
  return {
    roadLimitKmh: 50, vehicleClassCapKmh: null, effectiveLimitKmh: 50,
    effectiveLimitReason: 'ROAD_ONLY' as EffectiveSpeedLimit['effectiveLimitReason'],
    state: 'AVAILABLE', confidence: 0.9, sourceAgeMs: 1_000,
    roadClass: 'URBAN' as EffectiveSpeedLimit['roadClass'],
    sourceLabel: 'YOL' as EffectiveSpeedLimit['sourceLabel'],
    reason: 'test', policyCountry: 'TR', policyVersion: 'x',
    policyEffectiveFrom: 'x', policySourceAuthority: 'x',
    ...over,
  } as EffectiveSpeedLimit;
}

/** Ham `style` özniteliği — jsdom'un CSS ayrıştırıcısı `clamp()` ve `em`
 *  kısayollarını DÜŞÜRÜR, bu yüzden `el.style.*` yerine öznitelik okunur. */
function css(el: Element): string { return el.getAttribute('style') ?? ''; }

/** Kartın kökü (çap taşıyıcısı) ve daire elemanı. */
function parts(el: HTMLElement) {
  const root   = el.querySelector('[data-testid="speed-limit-card"]') as HTMLElement;
  const circle = root.firstElementChild as HTMLElement;
  const label  = root.lastElementChild as HTMLElement;
  return { root, circle, numeral: circle.firstElementChild as HTMLElement, label };
}

describe('OEM levha oranları', () => {
  it('🔒 çap TEK kaynaktan gelir; halka · rakam · etiket ondan ORANLA türer', () => {
    // İki ölçek arasında sapma imkânsız olmalı: elle yazılmış ikinci bir
    // boyut kümesi (eski `_DIM`) geri gelirse oranlar sessizce ayrışır.
    const src = code(cardSrc);
    expect(src).toContain('_DIAMETER');
    expect(src).not.toContain('circle: 38');
    expect(src).not.toContain('circle: 52');
  });

  it('🔒 halka kalınlığı Viyana bandındadır (çapın %11–15\'i)', () => {
    const m = code(cardSrc).match(/_RING\s*=\s*([0-9.]+)/);
    expect(m, '_RING oranı bulunamadı').not.toBeNull();
    const ring = Number(m![1]);
    expect(ring).toBeGreaterThanOrEqual(0.11);
    expect(ring).toBeLessThanOrEqual(0.15);
  });

  it('🔒 rakam yüksekliği çapın ~%47\'sidir ve üç hanede DARALIR', () => {
    const src = code(cardSrc);
    const two   = Number(src.match(/_NUMERAL\s*=\s*([0-9.]+)/)![1]);
    const three = Number(src.match(/_NUMERAL_3D\s*=\s*([0-9.]+)/)![1]);
    expect(two).toBeGreaterThanOrEqual(0.42);
    expect(two).toBeLessThanOrEqual(0.52);
    // Üç hane iki haneden GENİŞ olamaz — yoksa levhadan taşar.
    expect(three).toBeLessThan(two);
  });

  it('🔒 daire ve halka `em` ile türer — sabit px boyut KALMADI', () => {
    const { circle } = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    const st = css(circle);
    expect(st).toContain('width:1em');
    expect(st).toContain('height:1em');
    expect(st).toMatch(/border:[0-9.]+em/);
    expect(st, 'halka sabit piksele dönmüş').not.toMatch(/border:[0-9.]+px/);
  });

  it('🔒 rakam ve etiket de `em` zincirindedir', () => {
    const { numeral, label } = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    expect(css(numeral)).toMatch(/font-size:[0-9.]+em/);
    expect(css(label)).toMatch(/font-size:[0-9.]+em/);
  });
});

describe('Küçük ekran / dikey navigasyon ölçeklenmesi', () => {
  it('🔒 çap viewport\'a bağlıdır (kısa kenar) ve alt/üst sınırı vardır', () => {
    // `vmin` kısa kenardır → yatay ve dikey navigasyonda aynı fiziksel boy.
    // `clamp` tabanı en küçük ekranda okunabilirliği, tavanı head unit'te
    // ekranı kaplamamayı garanti eder.
    for (const size of ['mini', 'full'] as const) {
      const st = css(parts(mount(<SpeedLimitCard limit={verdict()} size={size} />)).root);
      expect(st, `${size} çapı sabit px kalmış`).toContain('font-size:clamp(');
      expect(st).toContain('vmin');
    }
  });

  it('🔒 tam ekran levhası mini levhadan BÜYÜKTÜR (hiyerarşi korunur)', () => {
    const base = (el: Element) => Number((css(el).match(/clamp\(\s*([0-9.]+)px/) ?? [])[1]);
    const mini = base(parts(mount(<SpeedLimitCard limit={verdict()} size="mini" />)).root);
    const full = base(parts(mount(<SpeedLimitCard limit={verdict()} size="full" />)).root);
    expect(Number.isFinite(mini) && Number.isFinite(full)).toBe(true);
    expect(full).toBeGreaterThan(mini);
  });

  it('🔒 ölçek JS dinleyicisiyle DEĞİL, CSS ile yapılır (yeniden render yok)', () => {
    // Bir resize/matchMedia aboneliği burada sızıntı ve gereksiz render demektir;
    // kart `memo` ve saf kalmalı.
    const src = code(cardSrc);
    for (const forbidden of ['addEventListener', 'matchMedia', 'useEffect', 'useState']) {
      expect(src, `${forbidden} eklenmiş — kart saf olmalı`).not.toContain(forbidden);
    }
  });
});

describe('Dürüstlük ve güvenlik davranışı KORUNUR', () => {
  it('🔒 gösterilemeyen hükümde kart HİÇ çizilmez', () => {
    const host = mount(
      <SpeedLimitCard limit={verdict({ effectiveLimitKmh: null, state: 'UNKNOWN' as EffectiveSpeedLimit['state'] })} />,
    );
    expect(host.querySelector('[data-testid="speed-limit-card"]')).toBeNull();
  });

  it('🔒 kesin OLMAYAN sayı KESİKLİ çerçeveyle ayrılır', () => {
    const { circle } = parts(mount(
      <SpeedLimitCard limit={verdict({ state: 'ROAD_ONLY' as EffectiveSpeedLimit['state'] })} size="full" />,
    ));
    expect(css(circle)).toContain('dashed');
  });

  it('🔒 kesin sayı DÜZ çerçeve alır', () => {
    const { circle } = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    expect(css(circle)).toContain('solid');
  });

  it('🔒 kaynak etiketi GÖSTERİLİR (sayı tek başına yeterli değil)', () => {
    const { label } = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    expect(label.textContent).toBe('YOL');
  });

  it('🔒 hız AŞIMI dışında animasyon YOKTUR (dikkat dağıtmaz)', () => {
    const normal = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    expect(normal.circle.className).not.toContain('animate-pulse');
    const over = parts(mount(<SpeedLimitCard limit={verdict()} size="full" overSpeed />));
    expect(over.circle.className).toContain('animate-pulse');
  });

  it('🔒 rakam tabular — sayı değişince levha OYNAMAZ', () => {
    const { numeral } = parts(mount(<SpeedLimitCard limit={verdict()} size="full" />));
    expect(css(numeral)).toContain('font-variant-numeric:tabular-nums');
  });

  it('🔒 kart ses ÇIKARMAZ ve uyarı ÜRETMEZ (yalnız gösterim)', () => {
    const src = code(cardSrc);
    for (const forbidden of ['speak', 'playAlert', 'new Audio']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
