/**
 * StandardPidRegistry — SAE J1979 / ISO 15031-5 Mode 01 standart PID tablosu (Patch 8).
 *
 * KAYNAK: yalnız kamu standardı (SAE J1979 Tablo B.1 formülleri). Hiçbir üçüncü-taraf
 * uygulamadan liste/formül alınmadı — ticari lisans kuralı (CLAUDE.md) gereği.
 *
 * KAPSAM v1: formülü tanımlı SAYISAL PID'ler (~55 adet). Bit/enum kodlu durum PID'leri
 * (0x03 yakıt sistemi durumu, 0x12, 0x13, 0x1C-0x1E…) StandardPidEnums'ta ayrı çözülür.
 *
 * KAPSAM v2 (PR-PID-1): 0x64-0x98 dizel/egzoz/emisyon aralığından yalnız formülü kamu
 * standardında NET olan skaler PID'ler eklendi (EGR/EGT/DPF sıcaklığı, NOx, sürtünme
 * torku). Bu PID'lerin çoğu ilk baytta bir "veri destek" bitmask'i taşır; decode İLK
 * sensörü (A'dan sonraki baytlar) çözer. İç yapısı belirsiz olanlar (DPF fark basıncı
 * 0x7A/0x7B, 0x8B Diesel Aftertreatment bit-durum) sahada doğrulanana dek DIŞARIDA.
 *
 * TASARIM: veri-güdümlü — her PID bir kayıt: ham veri baytları → değer saf fonksiyonla
 * çözülür, sınır dışı NaN döner (çağıran atlar, paket düşmez — obdSanitizer felsefesi).
 * Çekirdek PID'ler (obdData ana yolundan zaten akan 0x05/0x0B/0x0C/0x0D/0x0F/0x11/0x2F)
 * `core: true` işaretli — extendedPidService bunları native EXTENDED grubuna GÖNDERMEZ
 * (çift sorgu israfı olmasın), değerlerini ana akıştan besler.
 */

/** Bir PID kaydı. decode: ham data baytları (mode/pid başlığı SOYULMUŞ) → değer. */
export interface StandardPidDef {
  /** PID numarası, 2 haneli büyük-harf hex ('04', '0C', '5E'…). */
  pid: string;
  /** Türkçe kısa ad — UI/sesli asistan bu adı kullanır. */
  name: string;
  /** Birim ('%', '°C', 'kPa', 'V'…) — boş string birimsiz demek. */
  unit: string;
  /** Beklenen minimum data bayt sayısı. */
  bytes: number;
  /** Formülün teorik alt/üst sınırı — decode bu aralık dışına çıkamaz. */
  min: number;
  max: number;
  /** Gösterge gruplama kategorisi. */
  category: 'motor' | 'yakit' | 'sicaklik' | 'basinc' | 'o2' | 'emisyon' | 'elektrik' | 'tork' | 'mesafe';
  /** true = obdData ana yolundan zaten akıyor; EXTENDED grubunda sorgulanmaz. */
  core?: boolean;
  /** Ham data baytları → fiziksel değer. Geçersiz girişte NaN. */
  decode: (b: number[]) => number;
}

/* ── Formül yardımcıları (SAE J1979 Tablo B.1) ─────────────────────────── */
const A = (b: number[]) => b[0]!;
const AB = (b: number[]) => b[0]! * 256 + b[1]!;
const pct = (b: number[]) => A(b) / 2.55;              // A×100/255
const trim = (b: number[]) => A(b) / 1.28 - 100;       // A/1.28 − 100
const temp = (b: number[]) => A(b) - 40;               // A − 40
const lambda = (b: number[]) => (AB(b) * 2) / 65536;   // 2AB/65536

/* ── Tablo ──────────────────────────────────────────────────────────────── */
// NOT: sıra PID numarasına göre; her kayıt tam şekilli (hidden-class kararlılığı için
// opsiyonel 'core' alanı bile her kayıtta açıkça yazılmadı — TS derleyicisi şekli sabitler,
// runtime'da Map'e normalize edilir).
const DEFS: StandardPidDef[] = [
  { pid: '04', name: 'Hesaplanan motor yükü',        unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '05', name: 'Soğutma sıvısı sıcaklığı',     unit: '°C',   bytes: 1, min: -40,  max: 215,   category: 'sicaklik', core: true, decode: temp },
  { pid: '06', name: 'Kısa dönem yakıt trim (B1)',   unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'yakit',    decode: trim },
  { pid: '07', name: 'Uzun dönem yakıt trim (B1)',   unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'yakit',    decode: trim },
  { pid: '08', name: 'Kısa dönem yakıt trim (B2)',   unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'yakit',    decode: trim },
  { pid: '09', name: 'Uzun dönem yakıt trim (B2)',   unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'yakit',    decode: trim },
  { pid: '0A', name: 'Yakıt basıncı (gösterge)',     unit: 'kPa',  bytes: 1, min: 0,    max: 765,   category: 'basinc',   decode: (b) => A(b) * 3 },
  { pid: '0B', name: 'Emme manifoldu basıncı (MAP)', unit: 'kPa',  bytes: 1, min: 0,    max: 255,   category: 'basinc',   core: true, decode: A },
  { pid: '0C', name: 'Motor devri',                  unit: 'rpm',  bytes: 2, min: 0,    max: 16383.75, category: 'motor', core: true, decode: (b) => AB(b) / 4 },
  { pid: '0D', name: 'Araç hızı',                    unit: 'km/h', bytes: 1, min: 0,    max: 255,   category: 'motor',    core: true, decode: A },
  { pid: '0E', name: 'Ateşleme avansı',              unit: '°',    bytes: 1, min: -64,  max: 63.5,  category: 'motor',    decode: (b) => A(b) / 2 - 64 },
  { pid: '0F', name: 'Emme havası sıcaklığı',        unit: '°C',   bytes: 1, min: -40,  max: 215,   category: 'sicaklik', core: true, decode: temp },
  { pid: '10', name: 'Hava kütle akışı (MAF)',       unit: 'g/s',  bytes: 2, min: 0,    max: 655.35, category: 'motor',   decode: (b) => AB(b) / 100 },
  { pid: '11', name: 'Gaz kelebeği konumu',          unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    core: true, decode: pct },
  { pid: '14', name: 'O2 sensör voltajı (B1S1)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '15', name: 'O2 sensör voltajı (B1S2)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '16', name: 'O2 sensör voltajı (B1S3)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '17', name: 'O2 sensör voltajı (B1S4)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '18', name: 'O2 sensör voltajı (B2S1)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '19', name: 'O2 sensör voltajı (B2S2)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '1A', name: 'O2 sensör voltajı (B2S3)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '1B', name: 'O2 sensör voltajı (B2S4)',     unit: 'V',    bytes: 2, min: 0,    max: 1.275, category: 'o2',       decode: (b) => A(b) / 200 },
  { pid: '1F', name: 'Motor çalışma süresi',         unit: 's',    bytes: 2, min: 0,    max: 65535, category: 'motor',    decode: AB },
  { pid: '21', name: 'MIL yanarken kat edilen yol',  unit: 'km',   bytes: 2, min: 0,    max: 65535, category: 'mesafe',   decode: AB },
  { pid: '22', name: 'Yakıt ray basıncı (manifold göreli)', unit: 'kPa', bytes: 2, min: 0, max: 5177.27, category: 'basinc', decode: (b) => AB(b) * 0.079 },
  { pid: '23', name: 'Yakıt ray basıncı (yüksek)',   unit: 'kPa',  bytes: 2, min: 0,    max: 655350, category: 'basinc',  decode: (b) => AB(b) * 10 },
  { pid: '24', name: 'O2 lambda (S1)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '25', name: 'O2 lambda (S2)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '26', name: 'O2 lambda (S3)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '27', name: 'O2 lambda (S4)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '28', name: 'O2 lambda (S5)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '29', name: 'O2 lambda (S6)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '2A', name: 'O2 lambda (S7)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '2B', name: 'O2 lambda (S8)',               unit: 'λ',    bytes: 4, min: 0,    max: 2,     category: 'o2',       decode: lambda },
  { pid: '2C', name: 'Komutlanan EGR',               unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'emisyon',  decode: pct },
  { pid: '2D', name: 'EGR hatası',                   unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'emisyon',  decode: trim },
  { pid: '2E', name: 'Komutlanan EVAP temizleme',    unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'emisyon',  decode: pct },
  { pid: '2F', name: 'Yakıt deposu seviyesi',        unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'yakit',    core: true, decode: pct },
  { pid: '30', name: 'Kod silindiğinden beri ısınma sayısı', unit: '', bytes: 1, min: 0, max: 255,  category: 'emisyon',  decode: A },
  { pid: '31', name: 'Kod silindiğinden beri yol',   unit: 'km',   bytes: 2, min: 0,    max: 65535, category: 'mesafe',   decode: AB },
  { pid: '32', name: 'EVAP buhar basıncı',           unit: 'Pa',   bytes: 2, min: -8192, max: 8191.75, category: 'emisyon', decode: (b) => {
      // İki baytlık İŞARETLİ tam sayı / 4 (two's complement)
      const raw = AB(b);
      return (raw > 32767 ? raw - 65536 : raw) / 4;
    } },
  { pid: '33', name: 'Barometrik basınç',            unit: 'kPa',  bytes: 1, min: 0,    max: 255,   category: 'basinc',   decode: A },
  { pid: '3C', name: 'Katalizör sıcaklığı (B1S1)',   unit: '°C',   bytes: 2, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => AB(b) / 10 - 40 },
  { pid: '3D', name: 'Katalizör sıcaklığı (B2S1)',   unit: '°C',   bytes: 2, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => AB(b) / 10 - 40 },
  { pid: '3E', name: 'Katalizör sıcaklığı (B1S2)',   unit: '°C',   bytes: 2, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => AB(b) / 10 - 40 },
  { pid: '3F', name: 'Katalizör sıcaklığı (B2S2)',   unit: '°C',   bytes: 2, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => AB(b) / 10 - 40 },
  { pid: '42', name: 'Kontrol ünitesi voltajı',      unit: 'V',    bytes: 2, min: 0,    max: 65.535, category: 'elektrik', decode: (b) => AB(b) / 1000 },
  { pid: '43', name: 'Mutlak motor yükü',            unit: '%',    bytes: 2, min: 0,    max: 25700, category: 'motor',    decode: (b) => AB(b) / 2.55 },
  { pid: '44', name: 'Komutlanan hava-yakıt oranı',  unit: 'λ',    bytes: 2, min: 0,    max: 2,     category: 'yakit',    decode: lambda },
  { pid: '45', name: 'Bağıl gaz kelebeği konumu',    unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '46', name: 'Ortam hava sıcaklığı',         unit: '°C',   bytes: 1, min: -40,  max: 215,   category: 'sicaklik', decode: temp },
  { pid: '47', name: 'Gaz kelebeği konumu B',        unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '48', name: 'Gaz kelebeği konumu C',        unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '49', name: 'Gaz pedalı konumu D',          unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '4A', name: 'Gaz pedalı konumu E',          unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '4B', name: 'Gaz pedalı konumu F',          unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '4C', name: 'Komutlanan gaz kelebeği',      unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '4D', name: 'MIL yanarken çalışma süresi',  unit: 'dk',   bytes: 2, min: 0,    max: 65535, category: 'motor',    decode: AB },
  { pid: '4E', name: 'Kod silindiğinden beri süre',  unit: 'dk',   bytes: 2, min: 0,    max: 65535, category: 'motor',    decode: AB },
  { pid: '50', name: 'Maksimum MAF değeri',          unit: 'g/s',  bytes: 4, min: 0,    max: 2550,  category: 'motor',    decode: (b) => A(b) * 10 },
  { pid: '52', name: 'Etanol yakıt oranı',           unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'yakit',    decode: pct },
  { pid: '53', name: 'Mutlak EVAP buhar basıncı',    unit: 'kPa',  bytes: 2, min: 0,    max: 327.675, category: 'emisyon', decode: (b) => AB(b) / 200 },
  { pid: '54', name: 'EVAP buhar basıncı (geniş)',   unit: 'Pa',   bytes: 2, min: -32767, max: 32768, category: 'emisyon', decode: (b) => AB(b) - 32767 },
  { pid: '55', name: 'İkincil O2 kısa trim (B1)',    unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'o2',       decode: trim },
  { pid: '56', name: 'İkincil O2 uzun trim (B1)',    unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'o2',       decode: trim },
  { pid: '57', name: 'İkincil O2 kısa trim (B2)',    unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'o2',       decode: trim },
  { pid: '58', name: 'İkincil O2 uzun trim (B2)',    unit: '%',    bytes: 1, min: -100, max: 99.2,  category: 'o2',       decode: trim },
  { pid: '59', name: 'Yakıt ray basıncı (mutlak)',   unit: 'kPa',  bytes: 2, min: 0,    max: 655350, category: 'basinc',  decode: (b) => AB(b) * 10 },
  { pid: '5A', name: 'Bağıl gaz pedalı konumu',      unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'motor',    decode: pct },
  { pid: '5B', name: 'Hibrit batarya kalan ömür',    unit: '%',    bytes: 1, min: 0,    max: 100,   category: 'elektrik', decode: pct },
  { pid: '5C', name: 'Motor yağı sıcaklığı',         unit: '°C',   bytes: 1, min: -40,  max: 215,   category: 'sicaklik', decode: temp },
  { pid: '5D', name: 'Yakıt enjeksiyon zamanlaması', unit: '°',    bytes: 2, min: -210, max: 301.99, category: 'yakit',   decode: (b) => AB(b) / 128 - 210 },
  { pid: '5E', name: 'Motor yakıt tüketim hızı',     unit: 'L/h',  bytes: 2, min: 0,    max: 3276.75, category: 'yakit',  decode: (b) => AB(b) / 20 },
  { pid: '61', name: 'Sürücü talep torku',           unit: '%',    bytes: 1, min: -125, max: 130,   category: 'tork',     decode: (b) => A(b) - 125 },
  { pid: '62', name: 'Gerçek motor torku',           unit: '%',    bytes: 1, min: -125, max: 130,   category: 'tork',     decode: (b) => A(b) - 125 },
  { pid: '63', name: 'Referans motor torku',         unit: 'Nm',   bytes: 2, min: 0,    max: 65535, category: 'tork',     decode: AB },

  /* ── v2 dizel / egzoz / emisyon genişlemesi (PR-PID-1) ──────────────────────
   * SAE J1979-2 Service 01 0x64-0x98 aralığı. Bu PID'lerin ÇOĞU ilk baytta bir
   * "veri destek / mevcudiyet" bitmask'i (A) taşır; sensör değerleri onu izler.
   * Bu yüzden decode İLK sensörü (A'dan SONRAKİ baytlar) çözer — A atlanır.
   * Yalnızca formülü kamu standardında NET olan skaler PID'ler eklendi; DPF fark
   * basıncı (0x7A/0x7B iç yapı belirsizliği) ve 0x8B "Diesel Aftertreatment"
   * (bit/durum) sahada doğrulanana dek KASITLI dışarıda — uydurma çözümleme yok.
   * Not: 0x6B standartta EGR sıcaklığıdır (DPF fark basıncı DEĞİL). */
  // egtTemp: [A=destek] B,C = sensör 1 sıcaklığı = (256B+C)/10 − 40  (EGT/DPF sıcaklık ölçeği)
  { pid: '6B', name: 'EGR sıcaklığı (Banka 1)',       unit: '°C',   bytes: 2, min: -40,  max: 215,    category: 'emisyon',  decode: (b) => b[1]! - 40 },
  { pid: '78', name: 'Egzoz gazı sıcaklığı (EGT B1)', unit: '°C',   bytes: 3, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => (b[1]! * 256 + b[2]!) / 10 - 40 },
  { pid: '79', name: 'Egzoz gazı sıcaklığı (EGT B2)', unit: '°C',   bytes: 3, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => (b[1]! * 256 + b[2]!) / 10 - 40 },
  { pid: '7C', name: 'DPF sıcaklığı (Banka 1)',        unit: '°C',   bytes: 3, min: -40,  max: 6513.5, category: 'sicaklik', decode: (b) => (b[1]! * 256 + b[2]!) / 10 - 40 },
  { pid: '83', name: 'NOx konsantrasyonu (Sensör 1)', unit: 'ppm',  bytes: 3, min: 0,    max: 65535,  category: 'emisyon',  decode: (b) => b[1]! * 256 + b[2]! },
  { pid: '8E', name: 'Motor sürtünme torku',          unit: '%',    bytes: 1, min: -125, max: 130,    category: 'tork',     decode: (b) => A(b) - 125 },
];

/** PID ('04') → tanım. Büyük-harf 2 hane hex anahtar. */
export const STANDARD_PID_MAP: ReadonlyMap<string, StandardPidDef> = new Map(
  DEFS.map((d) => [d.pid, d]),
);

/** Tüm kayıtlar (PID sırasına göre, salt-okunur). */
export const STANDARD_PIDS: readonly StandardPidDef[] = DEFS;

/** EXTENDED grupta sorgulanabilir (core olmayan) PID'ler. */
export const EXTENDED_CANDIDATE_PIDS: readonly string[] =
  DEFS.filter((d) => !d.core).map((d) => d.pid);

/**
 * Ham hex data string'ini ('7D' veya '1A F8'…) verilen PID formülüyle çözer.
 * Mode/PID başlığı ('41 XX') SOYULMUŞ data baytları beklenir.
 *
 * @returns fiziksel değer; tanımsız PID / eksik bayt / sınır dışı → NaN (çağıran atlar).
 */
export function decodeStandardPid(pid: string, dataHex: string): number {
  const def = STANDARD_PID_MAP.get(pid.toUpperCase());
  if (!def) return NaN;
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length < def.bytes * 2) return NaN;
  const bytes: number[] = [];
  for (let i = 0; i < def.bytes; i++) {
    bytes.push(parseInt(clean.substring(i * 2, i * 2 + 2), 16));
  }
  if (bytes.some((x) => Number.isNaN(x))) return NaN;
  const value = def.decode(bytes);
  if (!Number.isFinite(value) || value < def.min || value > def.max) return NaN;
  return value;
}
