/**
 * webSearchService — Tavily üzerinden web araması (Groq'a internet grounding).
 *
 * Groq/Llama'nın canlı internet erişimi yoktur. Bu servis kullanıcının Tavily
 * anahtarıyla web'i arar ve sonuçları LLM'in sentezleyebileceği düz metne çevirir.
 * Tavily LLM-için optimize: include_answer ile hazır bir özet de döner.
 *
 * Anahtar: app.tavily.com (ücretsiz, aylık 1000 arama, kart gerektirmez). `tvly-` ile başlar.
 * Saklama: sensitiveKeyStore 'tavilyApiKey'.
 *
 * CORS/WebView: api.tavily.com CORS'a izin verir; Gemini/Groq çağrılarıyla aynı
 * fetch yolu kullanılır (ekstra native köprü gerekmez).
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const SEARCH_TIMEOUT_MS = 7000;

export interface WebSearchResult {
  /** Tavily'nin hazır kısa cevabı (include_answer) — boş olabilir. */
  answer: string;
  /** LLM'e beslenecek kaynak özetleri (başlık + içerik kırpılmış). */
  context: string;
  /** Kaynak sayısı (0 = sonuç yok). */
  count: number;
}

/** WebView-güvenli timeout'lu AbortSignal (Chrome <103'te AbortSignal.timeout yok). */
function _timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * Web'de arama yapar. Hata/timeout/boş sonuçta null döner (çağıran graceful fallback yapar).
 */
export async function tavilySearch(query: string, apiKey: string): Promise<WebSearchResult | null> {
  const q = query.trim();
  if (!q || !apiKey) return null;

  try {
    const resp = await fetch(TAVILY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        apiKey,
        query:          q,
        search_depth:   'basic',   // 'basic' hızlı + ucuz; araç içi gecikme için yeterli
        include_answer: true,
        max_results:    5,
      }),
      signal: _timeoutSignal(SEARCH_TIMEOUT_MS),
    });

    if (!resp.ok) return null;

    const data = await resp.json() as {
      answer?: string;
      results?: { title?: string; url?: string; content?: string }[];
    };

    const results = Array.isArray(data.results) ? data.results : [];
    const context = results
      .slice(0, 5)
      .map((r, i) => {
        const title = (r.title ?? '').trim();
        const body  = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
        return `[${i + 1}] ${title}\n${body}`;
      })
      .join('\n\n');

    const answer = (data.answer ?? '').trim();
    if (!answer && !context) return null;

    return { answer, context, count: results.length };
  } catch {
    return null; // ağ/timeout/iptal — çağıran "şu an erişemedim" der
  }
}
