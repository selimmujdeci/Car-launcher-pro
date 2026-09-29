/**
 * EPDK il bazlı yakıt fiyatı — ayrıştırma, özet, 429/önbellek davranışı.
 * Örnek satırlar 2026-09-29 canlı EPDK cevabından (Ankara, sorguNo 72) birebir alındı.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildSoapRequest,
  CACHE_TTL_MS,
  COOLDOWN_429_MS,
  createEpdkFuelCache,
  parseEpdkResponse,
  resolveProvince,
  summarizeRows,
  type FetchLike,
} from '@/lib/fuel/epdkFuelPrice';

function row(day: string, fuel: string, brand: string, price: string): string {
  return `<PetrolPiyasasiIllereGoreAkaryakitFiyatlari>
            <Tarih>${day} 00:00:00.0</Tarih>
            <YakitTipi>${fuel}</YakitTipi>
            <Il>ANKARA</Il>
            <FirmaMarkasi>${brand}</FirmaMarkasi>
            <Fiyat>${price}</Fiyat>
         </PetrolPiyasasiIllereGoreAkaryakitFiyatlari>`;
}

/** EPDK iç XML'i `<return>` içinde ESCAPE'li gönderir (`&lt;...>`). */
function envelope(rows: string[]): string {
  const inner = `<PetrolPiyasasiIllereGoreAkaryakitFiyatlariResult>${rows.join('')}</PetrolPiyasasiIllereGoreAkaryakitFiyatlariResult>`
    .replace(/</g, '&lt;');
  return "<?xml version='1.0' encoding='UTF-8'?><S:Envelope xmlns:S=\"http://schemas.xmlsoap.org/soap/envelope/\">"
    + '<S:Body><ns2:genelSorguResponse xmlns:ns2="http://genel.service.ws.epvys.g222.tubitak.gov.tr/">'
    + `<return>${inner}</return></ns2:genelSorguResponse></S:Body></S:Envelope>`;
}

const B95 = 'Kurşunsuz Benzin 95 Oktan';
const ANKARA_ROWS = [
  row('2016-06-10', B95, 'ALFOİL', '4.395959'),
  row('2016-06-10', 'Motorin', 'ALFOİL', '3.821483'),
  row('2026-09-25', B95, 'BP', '81.4'),
  row('2026-09-25', 'Motorin', 'BP', '94.6'),
  row('2026-09-25', B95, 'ES ES', '39.23'),
  row('2026-09-25', B95, 'OPET', '81.43'),
  row('2026-09-25', 'Motorin', 'OPET', '94.55'),
  row('2026-09-25', 'Gazyağı', 'OPET', '96.78'),
  row('2026-09-25', B95, 'SHELL', '81.4'),
  row('2026-09-25', 'Motorin', 'SHELL', '94.5'),
];
const ANKARA_XML = envelope(ANKARA_ROWS);

const FAULT_XML = '<?xml version=\'1.0\' encoding=\'utf-8\'?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
  + '<soapenv:Body><soapenv:Fault><faultcode>soap11Env:Client</faultcode><faultstring>Sorgu Yetkisi Yok!</faultstring>'
  + '</soapenv:Fault></soapenv:Body></soapenv:Envelope>';

describe('EPDK ayrıştırma', () => {
  it('gerçek cevap örneğini satırlara çevirir', () => {
    const rows = parseEpdkResponse(ANKARA_XML);
    expect(rows).toHaveLength(10);
    expect(rows[2]).toEqual({ day: '2026-09-25', fuel: B95, province: 'ANKARA', brand: 'BP', price: 81.4 });
  });

  it('pencere + medyan: eski marka ve aykırı değer (39,23) elenir', () => {
    const r = summarizeRows(parseEpdkResponse(ANKARA_XML), 'Ankara');
    expect(r).toEqual({
      schema: 1,
      currency: 'TRY',
      source: expect.stringContaining('EPDK'),
      observedOn: '2026-09-25',
      province: 'Ankara',
      pricePerLiter: { petrol: 81.4, diesel: 94.55 },
    });
  });

  it('SOAP Fault → hata (veri yok ile karışmaz)', () => {
    expect(() => parseEpdkResponse(FAULT_XML)).toThrow(/Sorgu Yetkisi Yok/);
  });

  it('bozuk veri → null fiyat, asla 0 ya da sahte sayı', () => {
    expect(() => parseEpdkResponse('<html>bakım</html>')).toThrow();
    const broken = envelope([
      row('2026-09-25', B95, 'X', 'abc'),
      row('2026-09-25', 'Motorin', 'Y', ''),
      row('tarih-yok', B95, 'Z', '81'),
      row('2026-09-25', B95, 'W', '0'),
    ]);
    const r = summarizeRows(parseEpdkResponse(broken), 'Ankara');
    expect(r.pricePerLiter).toEqual({ petrol: null, diesel: null });
    expect(r.observedOn).toBeNull();
  });

  it('yalnız motorin varsa benzin null kalır', () => {
    const r = summarizeRows(parseEpdkResponse(envelope([row('2026-09-25', 'Motorin', 'BP', '94.6')])), 'Ankara');
    expect(r.pricePerLiter).toEqual({ petrol: null, diesel: 94.6 });
  });
});

describe('il çözümleme', () => {
  it('ad, Türkçe harfsiz yazım ve plaka kodu', () => {
    expect(resolveProvince('Adana')).toEqual({ code: 1, name: 'Adana' });
    expect(resolveProvince('izmir')?.code).toBe(35);
    expect(resolveProvince('ŞANLIURFA')?.code).toBe(63);
    expect(resolveProvince('06')?.code).toBe(6);
    expect(resolveProvince('İstanbul')?.code).toBe(342);
    expect(resolveProvince('istanbul-anadolu')?.code).toBe(341);
  });

  it('eksik ya da bilinmeyen il → null', () => {
    expect(resolveProvince(null)).toBeNull();
    expect(resolveProvince('')).toBeNull();
    expect(resolveProvince('Atlantis')).toBeNull();
    expect(resolveProvince('99')).toBeNull();
  });

  it('SOAP isteği sorguNo 72 + plaka kodu taşır', () => {
    const x = buildSoapRequest(6);
    expect(x).toContain('<sorguNo>72</sorguNo>');
    expect(x).toContain('<parametreler>6</parametreler>');
  });
});

describe('önbellek ve 429', () => {
  const ANKARA = { code: 6, name: 'Ankara' };

  function setup(responses: Array<() => Response>) {
    let t = Date.UTC(2026, 8, 29, 9);
    const fetchFn = vi.fn<FetchLike>(async () => responses.shift()!());
    const cache = createEpdkFuelCache({ fetchFn, now: () => t });
    return { cache, fetchFn, advance: (ms: number) => { t += ms; } };
  }
  const ok = () => new Response(ANKARA_XML, { status: 200 });
  const throttled = () => new Response('{"fault":{"faultString":"Because of reaching Throttling limit, message is BLOCKED!"}}', { status: 429 });

  it('6 saat içinde EPDK\'ya ikinci kez gidilmez', async () => {
    const { cache, fetchFn, advance } = setup([ok, ok]);
    expect((await cache.get(ANKARA)).state).toBe('fresh');
    advance(CACHE_TTL_MS - 1);
    expect((await cache.get(ANKARA)).state).toBe('fresh');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    advance(2);
    await cache.get(ANKARA);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('429 → son iyi veri döner, bekleme süresince tekrar denenmez', async () => {
    const { cache, fetchFn, advance } = setup([ok, throttled, ok]);
    const first = await cache.get(ANKARA);
    advance(CACHE_TTL_MS + 1);
    const second = await cache.get(ANKARA);
    expect(second.state).toBe('fallback');
    expect(second.body).toEqual(first.body);
    for (let i = 0; i < 5; i++) await cache.get(ANKARA);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    advance(COOLDOWN_429_MS + 1);
    expect((await cache.get(ANKARA)).state).toBe('fresh');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('ilk istekte 429 → fiyatlar null (sahte değer yok)', async () => {
    const { cache } = setup([throttled]);
    const r = await cache.get(ANKARA);
    expect(r.state).toBe('none');
    expect(r.body.pricePerLiter).toEqual({ petrol: null, diesel: null });
    expect(r.body.observedOn).toBeNull();
  });

  it('eşzamanlı istekler tek EPDK çağrısında birleşir', async () => {
    const { cache, fetchFn } = setup([ok]);
    await Promise.all([cache.get(ANKARA), cache.get(ANKARA), cache.get(ANKARA)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
