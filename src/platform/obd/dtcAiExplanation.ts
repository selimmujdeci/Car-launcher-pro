/**
 * dtcAiExplanation — bulunan arıza kayıtlarının YAPAY ZEKÂ ile açıklanması.
 *
 * GİRDİ YALNIZ ÖLÇÜLEN GERÇEKLERDİR: kod · alt kod (UDS arıza tipi baytı) · ECU
 * etiketi · durum sınıfı · kaynak servis. Ham hex, VIN, konum GİTMEZ (companion
 * sohbet hattının gizlilik kuralı ile aynı). Araç için yalnız VIN'in üretici kodu
 * (WMI, ör. "VF1") gider — marka ADI türetilmez (vinDecode: tablo yok, uydurulmaz).
 *
 * ÇIKTI BİR YORUMDUR, kanıt DEĞİLDİR: `pidDescriptionGate` aynı sebeple doğrulanmış
 * kayıt metni ister. UI metni "yapay zekâ yorumu" etiketiyle gösterir; hiçbir
 * domain truth'u (DTC defteri, hüküm, silme kapısı) bu metinden BESLENMEZ.
 */

import type { AiGateway, AiMessage } from '../ai/gateway/types';
import { getDefaultAiGateway } from '../ai/gateway/concrete/defaultAiGateway';
import { getObdSessionEpoch } from '../obdService';
import { getVehicleIdentity } from '../vehicle/vehicleIdentity';
import { UDS_DTC_STATE_LABEL, type UdsDtcState } from './udsDtc';

/** Açıklanacak tek ölçülmüş kayıt. */
export interface DtcExplainItem {
  readonly code: string;
  /** UDS/KWP alt kodu (FTB); ölçülmediyse null — uydurulmaz. */
  readonly subCode: string | null;
  /** Kodu okuyan ECU'nun ekrandaki etiketi (ör. "Motor (ECM)", "ECU 7E1"). */
  readonly ecu: string;
  /** Ölçülen durum: UDS status baytından ya da standart mod sınıfından. */
  readonly state: UdsDtcState | 'MODE03_STORED' | 'MODE07_PENDING' | 'MODE0A_PERMANENT';
  readonly source: 'UDS' | 'KWP' | 'OBD';
}

export type DtcAiExplanationResult =
  | { readonly ok: true; readonly text: string; readonly model: string }
  | { readonly ok: false; readonly reason: string };

const STATE_TEXT: Readonly<Record<DtcExplainItem['state'], string>> = {
  ...UDS_DTC_STATE_LABEL,
  MODE03_STORED:    'KAYITLI (Mode 03, onaylı)',
  MODE07_PENDING:   'BEKLEYEN (Mode 07)',
  MODE0A_PERMANENT: 'KALICI (Mode 0A)',
};

const SYSTEM_PROMPT = [
  'Sen deneyimli bir otomotiv arıza teşhis uzmanısın. Bir OBD taramasında ÖLÇÜLEN arıza kayıtlarını araç sahibine Türkçe, sade ve ayrıntılı açıklayacaksın.',
  'KURALLAR:',
  '1. Yalnız verilen kayıtları kullan. Listede olmayan arıza, ölçüm, belirti ya da araç bilgisi UYDURMA.',
  '2. Durum sınıfı belirleyicidir. AKTİF, ONAYLI, BEKLEYEN, KAYITLI ve KALICI gerçek arıza kayıtlarıdır; bunları tek tek ayrıntılı açıkla. "TEST TAMAMLANMADI" arıza DEĞİLDİR: ECU o öz-testi henüz bitirmemiştir. Bunları tek bir kısa bölümde toplu anlat, tek tek açıklama.',
  '3. P0xxx, P2xxx, U0xxx, C0xxx, B0xxx kodlarının anlamı SAE J2012 ile standarttır; anlamını söyle. P1xxx, P3xxx, U1xxx, U2xxx, U3xxx, C1xxx, B1xxx kodları ÜRETİCİYE ÖZGÜDÜR: kesin anlam verme, "üreticiye özgü kod" de, bilinen olası anlamı ancak "olası" diye belirt ve kesin tanım için yetkili servisi öner.',
  '4. Parantez içindeki iki haneli değer arıza tipi baytıdır (SAE J2012-DA). Anlamını biliyorsan kısaca söyle; bilmiyorsan uydurma.',
  '5. Her gerçek arıza için sırasıyla: ne anlama geliyor, olası nedenler, sürücünün fark edebileceği belirtiler, aciliyet (hemen servis / yakın zamanda kontrol / izlemek yeterli) ve sürücünün ne yapması gerektiği.',
  '6. Fren, direksiyon, hava yastığı, motor hararet, yağ basıncı ya da şanzıman gibi sürüş güvenliğini etkileyebilecek bir sistem söz konusuysa bunu açıkça belirt ve vakit kaybetmeden servise gitmeyi öner. Sürüşe devam etmenin kesin olarak güvenli olduğunu SÖYLEME.',
  '7. Kesin teşhis koyma; "olası" dilini kullan. Kod silerek, sensör çıkararak ya da muayeneyi atlatmaya yönelik öneriler VERME.',
  '8. Biçim: düz metin. Başlıkları ayrı satıra BÜYÜK HARFLE yaz, maddeler için "• " kullan; markdown (**, #, tablo) kullanma. En ciddi arıza en üstte. En fazla yaklaşık 450 kelime.',
].join('\n');

/**
 * Modele gidecek mesajlar — SAF (I/O yok). Test ve denetim için ayrı tutulur:
 * modele NE gittiği tek yerde görülebilir.
 */
export function buildDtcExplainMessages(
  items: readonly DtcExplainItem[],
  vehicleWmi: string | null,
): AiMessage[] {
  const lines = items.map((d) => {
    const code = d.subCode ? `${d.code}(${d.subCode})` : d.code;
    return `- ${code} · ${d.ecu} · ${STATE_TEXT[d.state]} · kaynak ${d.source}`;
  });
  const wmi = vehicleWmi && /^[A-HJ-NPR-Z0-9]{3}$/.test(vehicleWmi) ? vehicleWmi : null;
  const user = [
    wmi ? `Araç: VIN üretici kodu (WMI) ${wmi}.` : 'Araç: marka bilinmiyor.',
    `Bu oturumda ECU'lardan okunan ${items.length} kayıt:`,
    ...lines,
    '',
    'Bu kayıtları kurallara uyarak açıkla.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  no_api_key:          'Yapay zekâ anahtarı tanımlı değil — Ayarlar’dan bir yapay zekâ anahtarı ekleyin.',
  no_provider:         'Kullanılabilir yapay zekâ sağlayıcısı yok.',
  offline:             'İnternet bağlantısı yok — açıklama alınamadı.',
  network:             'Ağ hatası — açıklama alınamadı.',
  timeout:             'Yapay zekâ zamanında yanıt vermedi — tekrar deneyin.',
  rate_limited:        'Yapay zekâ kotası doldu — biraz sonra tekrar deneyin.',
  auth:                'Yapay zekâ anahtarı reddedildi.',
  insufficient_credit: 'Yapay zekâ hesabında kredi yok.',
};

/** Model kurala rağmen markdown yazarsa ekranda yıldız/diyez görünmesin (SAF). */
export function toPlainExplanation(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bu oturumun VIN'inden yalnız üretici kodu (WMI); kimlik tek/doğrulanmış değilse null. */
function currentVehicleWmi(): string | null {
  try {
    const id = getVehicleIdentity(getObdSessionEpoch(), new Date().getFullYear());
    return id.state === 'SINGLE' || id.state === 'VERIFIED' ? id.facts.wmi : null;
  } catch {
    return null;
  }
}

/**
 * Kayıtları yapay zekâya açıklatır. Kayıt yoksa istek GÖNDERİLMEZ (boş listeyi
 * "temiz araç" diye yorumlatmak, ölçülmemiş bir hüküm üretmek olurdu).
 */
export async function explainDtcsWithAi(
  items: readonly DtcExplainItem[],
  opts: { readonly vehicleWmi?: string | null; readonly gateway?: AiGateway } = {},
): Promise<DtcAiExplanationResult> {
  if (items.length === 0) return { ok: false, reason: 'Açıklanacak arıza kaydı yok.' };
  const gateway = opts.gateway ?? getDefaultAiGateway();
  const wmi = opts.vehicleWmi === undefined ? currentVehicleWmi() : opts.vehicleWmi;
  const res = await gateway.generateResponse({
    messages: buildDtcExplainMessages(items, wmi),
    temperature: 0.2,
    maxTokens: 1600,
    timeoutMs: 45_000,
  });
  if (!res.ok) {
    return { ok: false, reason: FAILURE_TEXT[res.error.kind] ?? 'Yapay zekâ açıklaması alınamadı.' };
  }
  const text = toPlainExplanation(res.text);
  if (text.length === 0) return { ok: false, reason: 'Yapay zekâ boş yanıt verdi.' };
  return { ok: true, text, model: res.model };
}
