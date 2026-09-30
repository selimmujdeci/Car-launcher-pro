/**
 * externalNavCommand — "Yandex'ten / Waze ile / Google Haritalar'dan … rota kur".
 *
 * Sağlayıcı ifadesi çıkarılır, KALAN cümle mevcut `parseCommandFull`e verilir.
 * Yalnız gerçek bir adres/yer navigasyonu çıkarsa (`navigate_address` /
 * `navigate_place`) komut sağlayıcıyla işaretlenir; "Yandex müzik aç" gibi
 * rota olmayan cümleler DOKUNULMADAN normal akışa bırakılır (null).
 *
 * Neden beyinden ÖNCE: sağlayıcı bilgisi beyin şemasında YOK; beyne giderse
 * düşer ve rota bizim haritada açılır. Karar deterministik ve internetsiz de
 * çalışır; yürütme yine aynı `dispatch` otoritesinden geçer.
 */
import { parseCommandFull, type ParsedCommand } from '../commandParser';
import { extractExternalNavProvider, EXTERNAL_NAV_LABEL } from '../navigation/externalNavHandoff';

export function matchExternalNavCommand(raw: string): ParsedCommand | null {
  const ext = extractExternalNavProvider(raw);
  if (!ext) return null;
  const inner = parseCommandFull(ext.rest).command;
  if (!inner || (inner.type !== 'navigate_address' && inner.type !== 'navigate_place')) return null;
  const destination = (inner.extra?.destination ?? '').trim();
  if (!destination || destination.startsWith('__')) return null;   // yakın-POI nöbetçileri kapsam dışı
  return {
    ...inner,
    raw,
    extra:    { ...inner.extra, destination, provider: ext.provider },
    feedback: `${destination} için rota ${EXTERNAL_NAV_LABEL[ext.provider]} ile hazırlanıyor`,
  };
}
