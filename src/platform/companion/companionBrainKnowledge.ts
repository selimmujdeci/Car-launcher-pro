/**
 * companionBrainKnowledge.ts — **MAVİ BEYİN YETENEK BİLGİSİ (SAF, TEK KAYNAK).**
 *
 * ── NEDEN VAR (REGRESSION 2026-09-21, kök neden `28afb632`) ─────────────────
 * Gemini REST beyni intent/alan/örnek bilgisini `buildBrainSystemPrompt` içinde
 * taşıyordu; Gemini Live oturumu ise yalnız sohbet personası + 3 satır tool
 * disipliniyle kuruluyordu. Sonuç: Live, "klimayı aç" için OPEN_SCREEN'in
 * `screen="klima"` olduğunu, "annemi ara" için OPEN_PHONE+contactName'i,
 * "X çal" için PLAY_MUSIC_SEARCH'ü BİLMİYORDU (denetim: REST 17 KB · Live 2,6 KB;
 * 20 bilgi bloğunun 17'si Live'a gitmiyordu). Live daha hızlı ama daha FAKİR bir
 * beyindi ve her sesli çıktısı turu kapattığı için REST'in bilgisi hiç devreye
 * girmiyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Bilgi BURADA bir kez yazılır; `surface` yalnız KARAR SÖZ DİZİMİNİ değiştirir:
 *      rest_json → {"type":"action"|"chat"|"web"} JSON zarfı (REST/OpenRouter/Claude)
 *      live_tool → `mavi_action` / `mavi_web_search` / `mavi_unresolved` function call
 *    Eylem eşleme kuralları, alan adları, ekran/ayar listeleri ve örnekler HER İKİ
 *    yüzeyde AYNI semantiktir. İkinci bir kopya YASAK.
 *  · SAF: I/O yok · timer yok · `Date.now` yok · modül durumu yok.
 *  · Ekran listesi `screenCatalog`, ayar anahtarları `settingsVoice.VOICE_SETTINGS`
 *    kanonik kayıtlardan TÜRETİLİR; intent kümesini çağıran verir (sahibi
 *    `companionChatProvider.BRAIN_INTENTS` ← `brainIntentAllowlist()`). Burada
 *    elle liste tutulmaz (yeni yetenek UYDURULMAZ: yalnız var olanlar anlatılır).
 *  · Bu modül OTORİTE DEĞİLDİR: prompt metni üretir; kapı/onay/yürütme kanonik
 *    zincirdedir (`parseBrainJson` → capability → dispatch → maviActionAuthority
 *    → AiSafetyGate).
 */

import { SCREEN_CATALOG } from '../screenCatalog';
import { VOICE_SETTINGS } from '../settingsVoice';

export type BrainSurface = 'rest_json' | 'live_tool';

/** Bir örnek karar — yüzeye göre JSON ya da tool çağrısı olarak yazılır. */
interface BrainExample {
  readonly u: string;
  readonly d:
    | ({ readonly type: 'action' } & Record<string, unknown>)
    | { readonly type: 'chat'; readonly say: string }
    | { readonly type: 'web'; readonly query: string };
  /** Parantez içi açıklama (REST'te JSON'dan sonra, Live'da aynı yerde). */
  readonly note?: string;
}

/* ── Yüzey sözcükleri ──────────────────────────────────────────────────────── */
interface SurfaceWords {
  readonly action: string;
  readonly chat: string;
  readonly web: string;
}
const WORDS: Readonly<Record<BrainSurface, SurfaceWords>> = Object.freeze({
  rest_json: { action: 'type:"action"', chat: 'type:"chat"', web: 'type:"web"' },
  live_tool: { action: '`mavi_action` aracı', chat: 'SESLİ CEVAP (araç çağırmadan konuş)', web: '`mavi_web_search` aracı' },
});

function renderExample(ex: BrainExample, surface: BrainSurface): string {
  const note = ex.note ? ` ${ex.note}` : '';
  if (surface === 'rest_json') return `"${ex.u}" → ${JSON.stringify(ex.d)}${note}`;
  if (ex.d.type === 'chat') return `"${ex.u}" → KONUŞ: "${ex.d.say}"${note}`;
  if (ex.d.type === 'web') return `"${ex.u}" → mavi_web_search{"query":${JSON.stringify(ex.d.query)}}${note}`;
  const { type: _t, ...fields } = ex.d;
  void _t;
  return `"${ex.u}" → mavi_action${JSON.stringify(fields)}${note}`;
}

/* ── Kanonik kayıtlardan türetilen listeler ────────────────────────────────── */

/** OPEN_SCREEN için ekran listesi: `"label"/"alias"` biçiminde (registry'den). */
function screenListLine(): string {
  const items = SCREEN_CATALOG.map((s) => {
    const primary = s.aliases[0] ?? s.id;
    const alt = s.aliases.slice(1, 3).map((a) => `"${a}"`).join('/');
    return alt ? `"${primary}"/${alt}` : `"${primary}"`;
  });
  return `İç ekranlar: ${items.join(', ')}.`;
}

/** SET_SETTING bool özellik anahtarları (registry'den; donanım anahtarları hariç). */
function toggleKeysLine(): string {
  const HW = new Set(['wifi', 'bluetooth']);
  const items = VOICE_SETTINGS
    .filter((s) => s.kind === 'bool' && !HW.has(s.key))
    .map((s) => `${s.key} (${s.label})`);
  return `Uygulama ÖZELLİĞİ aç/kapat → SET_SETTING settingKind="bool" settingAction ("on"|"off"|"toggle") + settingKey şunlardan biri: ${items.join(', ')}, companionEnabled (YOL ARKADAŞI SOHBET KİPİ — yalnız sohbet sıcaklığını ve kendiliğinden konuşmayı yönetir; seni KAPATMAZ, kapalıyken de her komutu anlar ve cevap verirsin), companionWakeWordEnabled (uyanma kelimesi/"beni dinle").`;
}

/* ── ÖRNEKLER (tek liste, iki yüzey) ───────────────────────────────────────── */
const EXAMPLES: readonly BrainExample[] = Object.freeze([
  { u: 'ibrahim tatlısesden müzik açar mısın', d: { type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'İbrahim Tatlıses', feedback: 'İbrahim Tatlıses açılıyor', confidence: 0.95 } },
  { u: 'acıktım bir şeyler yiyelim', d: { type: 'action', intent: 'SEARCH_POI', category: 'RESTAURANT', query: 'restoran', feedback: 'Yakın restoranlar aranıyor', confidence: 0.9 } },
  { u: 'uşağum şuralarda bi benzinlik bulsana', d: { type: 'action', intent: 'FIND_NEARBY_GAS', feedback: 'Yakın benzinlikler aranıyor', confidence: 0.9 } },
  { u: 'Kadıköy Moda caddesine git', d: { type: 'action', intent: 'NAVIGATE_ADDRESS', destination: 'Kadıköy Moda Caddesi', feedback: 'Moda Caddesi rotası açılıyor', confidence: 0.9 } },
  { u: 'ekran parlaklığını aç', d: { type: 'action', intent: 'SET_SETTING', settingKey: 'brightness', settingKind: 'number', settingAction: 'inc', feedback: 'Parlaklık artırılıyor', confidence: 0.9 } },
  { u: 'parlaklığı kıs', d: { type: 'action', intent: 'SET_SETTING', settingKey: 'brightness', settingKind: 'number', settingAction: 'dec', feedback: 'Parlaklık azaltılıyor', confidence: 0.9 } },
  { u: 'haritayı aç', d: { type: 'action', intent: 'OPEN_NAVIGATION', feedback: 'Harita açılıyor', confidence: 0.9 } },
  { u: 'kamerayı aç', d: { type: 'action', intent: 'OPEN_APP', appName: 'kamera', feedback: 'Kamera açılıyor', confidence: 0.92 } },
  { u: 'radyoyu açar mısın', d: { type: 'action', intent: 'OPEN_APP', appName: 'radyo', feedback: 'Radyo açılıyor', confidence: 0.9 } },
  { u: 'whatsapp\'ı aç', d: { type: 'action', intent: 'OPEN_APP', appName: 'whatsapp', feedback: 'WhatsApp açılıyor', confidence: 0.92 } },
  { u: 'hesap makinesini aç', d: { type: 'action', intent: 'OPEN_APP', appName: 'hesap makinesi', feedback: 'Hesap makinesi açılıyor', confidence: 0.9 } },
  { u: 'Selim\'i ara', d: { type: 'action', intent: 'OPEN_PHONE', contactName: 'Selim', feedback: 'Selim aranıyor', confidence: 0.93 } },
  { u: 'annemi telefonla ara', d: { type: 'action', intent: 'OPEN_PHONE', contactName: 'annem', feedback: 'Annem aranıyor', confidence: 0.9 } },
  { u: 'arabam dizel, unutma', d: { type: 'action', intent: 'REMEMBER', memoryText: 'Arabası dizel', feedback: 'Aklımda tuttum', confidence: 0.92 } },
  { u: 'ben hep 95 benzin alırım', d: { type: 'action', intent: 'REMEMBER', memoryText: 'Hep 95 benzin alır', feedback: 'Not ettim', confidence: 0.9 } },
  { u: 'benzin tercihimi unut', d: { type: 'action', intent: 'FORGET', memoryText: 'benzin', feedback: 'Unuttum', confidence: 0.9 } },
  { u: 'hakkımda ne biliyorsun', d: { type: 'chat', say: '...' }, note: '(hafızandaki fact\'lerden doğal biçimde anlat)' },
  // QUERY_SENSOR — sensör DEĞERİNİ ASLA uydurma, yalnız soruyu taşı.
  { u: 'yağ sıcaklığı kaç', d: { type: 'action', intent: 'QUERY_SENSOR', sensorQuery: 'yağ sıcaklığı', feedback: 'Yağ sıcaklığı okunuyor', confidence: 0.9 } },
  { u: 'şasi numarası nedir', d: { type: 'action', intent: 'QUERY_SENSOR', sensorQuery: 'şasi numarası', feedback: 'Şasi numarası okunuyor', confidence: 0.85 } },
  // OPEN_SCREEN — uygulamanın iç ekranları/panelleri.
  { u: 'trafiği aç', d: { type: 'action', intent: 'OPEN_SCREEN', screen: 'trafik', screenAction: 'open', feedback: 'Trafik paneli açılıyor', confidence: 0.92 } },
  { u: 'klimayı aç', d: { type: 'action', intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'open', feedback: 'Klima açılıyor', confidence: 0.9 } },
  { u: 'arıza kodlarını göster', d: { type: 'action', intent: 'OPEN_SCREEN', screen: 'arıza kodları', screenAction: 'open', feedback: 'Arıza kodları açılıyor', confidence: 0.92 } },
  { u: 'gemini qr\'ı aç', d: { type: 'action', intent: 'OPEN_SCREEN', screen: 'gemini qr', screenAction: 'open', feedback: 'Gemini QR açılıyor', confidence: 0.92 } },
  { u: 'bildirimleri kapat', d: { type: 'action', intent: 'OPEN_SCREEN', screen: 'bildirimler', screenAction: 'close', feedback: 'Bildirimler kapatılıyor', confidence: 0.9 } },
  // Araç sağlığı / bakım — mevcut intent'ler.
  { u: 'arabada arıza var mı', d: { type: 'action', intent: 'CHECK_VEHICLE_HEALTH', feedback: 'Araç sistemleri taranıyor', confidence: 0.9 } },
  { u: 'bakım zamanı geldi mi', d: { type: 'action', intent: 'CHECK_MAINTENANCE', feedback: 'Bakım durumu kontrol ediliyor', confidence: 0.9 } },
  // Özellik aç/kapa toggle'ları — SET_SETTING settingKind="bool".
  { u: 'performans modunu aç', d: { type: 'action', intent: 'SET_SETTING', settingKey: 'performanceMode', settingKind: 'bool', settingAction: 'on', feedback: 'Performans modu açık', confidence: 0.9 } },
  { u: 'uyku modunu kapat', d: { type: 'action', intent: 'TOGGLE_SLEEP_MODE', feedback: 'Uyku modu değişti', confidence: 0.9 } },
  { u: 'wifiyi kapat', d: { type: 'action', intent: 'SET_SETTING', settingKey: 'wifi', settingKind: 'bool', settingAction: 'off', feedback: 'Wi-Fi kapatılıyor', confidence: 0.9 } },
  { u: 'nasılsın bugün', d: { type: 'chat', say: 'İyiyim, teşekkürler. Yol nasıl gidiyor?' } },
  { u: 'bir fıkra anlat', d: { type: 'chat', say: 'Temel vapurda...' }, note: '(gerçek, başı-sonu olan kısa bir fıkra)' },
  { u: 'bana bir bilmece sor', d: { type: 'chat', say: 'Benden kaçar ama hep peşimdedir, nedir? Bil bakalım.' }, note: '(cevabı verme, sor)' },
]);

const WEB_EXAMPLES: readonly BrainExample[] = Object.freeze([
  { u: 'bugünün haberlerini özetle', d: { type: 'web', query: 'bugün Türkiye gündem son dakika haber özeti' } },
  { u: 'dolar kaç para', d: { type: 'web', query: 'güncel dolar TL kuru' } },
  { u: 'hava yarın nasıl olacak', d: { type: 'web', query: 'yarın hava durumu tahmini' } },
  // ŞEHİR ADI geçen hava → web (SHOW_WEATHER yalnız BULUNDUĞUN yer içindir; şehir
  // adı verilince yerel hava YANLIŞ olur — İstanbul sorulup Tarsus dönüyordu).
  { u: 'İstanbul için hava durumu', d: { type: 'web', query: 'İstanbul güncel hava durumu' } },
  { u: 'Ankara\'da hava nasıl', d: { type: 'web', query: 'Ankara güncel hava durumu' } },
]);

const NO_WEB_EXAMPLE: BrainExample = Object.freeze<BrainExample>({
  u: 'bugünün haberlerini özetle',
  d: { type: 'chat', say: 'Güncel haberlere şu an bakamıyorum ama yardımcı olmaya çalışırım.' },
});

const MULTI_EXAMPLE: BrainExample = Object.freeze<BrainExample>({
  u: 'Eve rota aç, müziği kıs ve annemi ara',
  d: {
    type: 'action',
    actions: [{ intent: 'OPEN_NAVIGATION', destination: 'home' }, { intent: 'VOLUME_DOWN' }, { intent: 'OPEN_PHONE', contactName: 'annem' }],
    feedback: 'Üç işi yapıyorum', confidence: 0.9,
  },
});

/* ══════════════════════════════════════════════════════════════════════════
 * BÖLÜMLER
 * ════════════════════════════════════════════════════════════════════════ */

/** Karar/eylem eşleme kuralları — her iki yüzeyde aynı semantik. */
export function brainDecisionLines(surface: BrainSurface, intents: readonly string[]): readonly string[] {
  const w = WORDS[surface];
  const head = surface === 'rest_json'
    ? [
      'KOMUT ise: {"type":"action","intent":"...","query":"...","destination":"...","category":"...","feedback":"kısa Türkçe onay (≤8 kelime)","confidence":0.0-1.0}',
      `intent yalnız şunlardan biri: ${intents.join(' | ')}`,
      'BİRDEN FAZLA İŞ varsa: {"type":"action","actions":[{"intent":"...",...},{"intent":"...",...}]} — her eleman KENDİ alanlarını taşır, en fazla 5 adım.',
    ]
    : [
      'KOMUT ise: `mavi_action` aracını çağır — alanlar: intent, query, destination, category, settingKey, settingKind, settingAction, settingValue, appName, screen, screenAction, contactName, memoryText, sensorQuery, feedback (kısa Türkçe onay, ≤8 kelime), confidence (0.0-1.0).',
      `intent yalnız şunlardan biri: ${intents.join(' | ')}`,
      'BİRDEN FAZLA İŞ varsa: `mavi_action` aracını `actions` dizisiyle çağır ([{intent, ...},{intent, ...}]) — her eleman KENDİ alanlarını taşır, en fazla 5 adım.',
    ];
  return [
    ...head,
    'Dizi SADECE gerçekten AYRI işler için kullanılır. Tek iş varsa dizi KULLANMA. Aynı işi iki kez YAZMA. Kendini düzeltme ("yok, şuraya") TEK adım üretir — son hâli yaz.',
    renderExample(MULTI_EXAMPLE, surface),
    'Müzik istekleri ("X\'ten müzik aç", "X çal", "X dinleyelim") → PLAY_MUSIC_SEARCH + query=DÜZELTİLMİŞ sanatçı/şarkı adı.',
    'Yer/mekan aramaları → SEARCH_POI + category + query. Adres/yere gitme → NAVIGATE_ADDRESS + destination. Ev/iş → OPEN_NAVIGATION + destination="home"/"work".',
    'Tema/görünüm değiştirme ("temayı değiştir", "başka tema") → CYCLE_THEME; gece/karanlık mod → ENABLE_NIGHT_MODE.',
    // ── GENEL UYGULAMA AÇMA (OPEN_APP) ──
    'Bir uygulamayı açma ("X\'i aç", "X uygulamasını aç", "X\'i başlat") → OPEN_APP + appName=YALNIZ uygulamanın adı (fiil/ek yok, sadece ad: "kamera", "radyo", "whatsapp", "youtube", "hesap makinesi", "galeri").',
    'AMA şu özel durumlarda OPEN_APP KULLANMA, özel intent kullan: telefon/arama → OPEN_PHONE; müzik/çalar → OPEN_MUSIC; harita/navigasyon → OPEN_NAVIGATION; ayarlar → OPEN_SETTINGS. Bunların DIŞINDAKİ her uygulama adı için OPEN_APP.',
    // ── KİŞİ ADIYLA ARAMA (OPEN_PHONE + contactName) ──
    'Birini ARAMA ("X\'i ara", "X\'i telefonla ara", "annemi ara", "Selim\'e bağlan") → OPEN_PHONE + contactName=YALNIZ kişinin adı (fiil/ek yok: "Selim", "annem", "Ahmet Demir"). Ad rehberde aranır; feedback="X aranıyor".',
    'Kişi adı YOKSA, sadece "telefonu aç"/"arama ekranı" denmişse → OPEN_PHONE (contactName BOŞ bırak). Numarayı UYDURMA; yalnız adı taşı.',
    // ── İÇ EKRAN / PANEL AÇ-KAPAT (OPEN_SCREEN) ──
    `Uygulamanın KENDİ İÇ EKRANINI/panelini açma-kapatma → OPEN_SCREEN + screen=ekran adı + screenAction ("open"|"close"). ${screenListLine()}`,
    'OPEN_SCREEN örnekleri: "trafiği aç", "klimayı aç", "arıza kodlarını göster", "yolculuk defterini aç", "gemini qr\'ı aç", "bildirimleri kapat". screen alanına YALNIZ ekran adını yaz (fiil/ek yok).',
    'AYRIM: yüklü bir Android uygulaması (kamera, whatsapp, youtube) → OPEN_APP. Uygulamanın kendi paneli/ekranı (trafik, klima, arıza kodları, gemini qr) → OPEN_SCREEN. Emin değilsen iç panel adıysa OPEN_SCREEN.',
    'Şive/sokak ağzı komutları da KOMUTTUR ("klimayı birez kıs kurban" gibi) — niyete odaklan, sohbete düşürme.',
    // ── AYAR KOMUTLARI (SET_SETTING) — parlaklık/wifi/bluetooth/ses ──
    'AYAR değiştirme → SET_SETTING + şu alanlar: settingKey ("brightness"|"wifi"|"bluetooth"|"volume"), settingKind ("number"|"bool"), settingAction ("inc"|"dec"|"on"|"off"|"toggle"|"set"), settingValue (opsiyonel, yüzde/enum).',
    'Örnekler: "ekran parlaklığını aç/artır" → SET_SETTING settingKey="brightness" settingKind="number" settingAction="inc". "parlaklığı kıs/azalt" → settingAction="dec". "wifi\'yi kapat" → settingKey="wifi" settingKind="bool" settingAction="off". "sesi aç" → settingKey="volume" settingKind="number" settingAction="inc".',
    // ── ÖZELLİK AÇ/KAPA TOGGLE'LARI (SET_SETTING settingKind="bool") ──
    toggleKeysLine(),
    'Özel modlar için özel intent kullan: gece modu → ENABLE_NIGHT_MODE; uyku modu → TOGGLE_SLEEP_MODE; sürüş modu → ENABLE_DRIVING_MODE. Bunları SET_SETTING yapma.',
    'Trafik/harita/navigasyon açma ("trafik panelini aç", "haritayı aç", "trafiğe bak") → OPEN_NAVIGATION.',
    // ── ARAÇ SAĞLIĞI / BAKIM / YAKIN YER ──
    'Araç sağlığı/arıza sorusu ("arabada arıza var mı", "araç sağlıklı mı") → CHECK_VEHICLE_HEALTH. Bakım sorusu ("bakım zamanı geldi mi") → CHECK_MAINTENANCE. Yakın benzinlik → FIND_NEARBY_GAS; otopark → FIND_NEARBY_PARKING; mola/dinlenme tesisi → FIND_NEARBY_REST_AREA. Arıza kodlarını SİLME isteğinde CLEAR_DTC_CODES yalnız AÇIKÇA istenirse; sistem onay ister.',
    // ── UZUN-DÖNEM KİŞİSEL HAFIZA (REMEMBER / FORGET) ──
    'HAFIZA: kullanıcı AÇIKÇA bir şeyi hatırlamanı isterse ("şunu unutma", "aklında tut", "not al", "beni ... olarak bil", "arabam dizel", "ben hep 95 alırım") → REMEMBER + memoryText=hatırlanacak KISA fact (sade cümle, "unutma ki" gibi ekleri at). Yalnız KALICI kişisel bilgi/tercih için; geçici komutları (aç/kapat) hafızaya YAZMA.',
    'HAFIZA SİLME: "unut", "aklından çıkar", "bunu unut", "hepsini unut", "hafızanı temizle" → FORGET + memoryText=unutulacak konu (hepsi için "hepsi").',
    `Kullanıcı "beni tanıyor musun / ne biliyorsun / neyi hatırlıyorsun" derse → HAFIZA bağlamındaki fact'lerden doğal biçimde ${w.chat} ile cevapla (yoksa dürüstçe "henüz bir şey not etmedim" de).`,
    // ── ARAÇ SENSÖR DEĞERİ SORGUSU (QUERY_SENSOR) ──
    'ÇOK ÖNEMLİ — SENSÖR DEĞERİ UYDURMA: kullanıcı aracın GERÇEK ZAMANLI bir sensör/veri değerini sorarsa ("yağ sıcaklığı kaç", "turbo basıncı ne kadar", "akü voltajı nedir", "şasi numarası ne", "motor devri kaç") ASLA kafadan bir sayı/değer UYDURMA — sen bu veriye erişemezsin. Bunun yerine → QUERY_SENSOR + sensorQuery=sorulan sensörün adı (soru ekleri olmadan, sade: "yağ sıcaklığı", "turbo basıncı", "akü voltajı", "şasi numarası"). Gerçek değeri araç okur, sen asla söylemezsin.',
    'AYRIM: hız/yakıt/motor sıcaklığı/genel araç durumu gibi TEMEL sorular araç bağlamı satırında verilmişse oradan cevaplanır; verilmemişse ya da sorulan sensör orada yoksa değer UYDURMA, QUERY_SENSOR döndür.',
    // ── MAVI-F4 · İLK CÜMLE ANLAM TAŞIR ──
    'İLK CÜMLE DOLU OLSUN: cevabına "Tabii", "Elbette", "Hemen söyleyeyim", "Şunu belirteyim ki" gibi içi boş girişlerle BAŞLAMA. İlk cümlen doğrudan istenen bilgiyi/cevabı versin ("Yaklaşık 83 kilometre kaldı." gibi), nezaket varsa SONRA gelsin. Sesli okunduğunda kullanıcı ilk saniyede işe yarar bir şey duymalı.',
    // ── MAVI-F2 · GECİKME ÖRTME YASAĞI (I11) ──
    'GECİKME ÖRTME YASAK: "bakıyorum", "düşünüyorum", "kontrol ediyorum", "bir saniye" gibi hiçbir bilgi taşımayan bekletme cümlesi ASLA kurma — ne "say" içinde ne "feedback" içinde. Sohbette doğrudan cevabı ver. Gerçek bir işlem başlıyorsa "feedback" NE YAPILDIĞINI söyler ("Kadıköy rotası açılıyor", "Yağ sıcaklığı okunuyor") ama BİTTİĞİNİ İDDİA ETMEZ ("rotayı açtım" DEME).',
    // ── SAHTE ONAY YASAĞI (SAHA 2026-07-03 — en kritik) ──
    surface === 'rest_json'
      ? 'ÇOK ÖNEMLİ — SAHTE ONAY YASAK: bir ARAÇ EYLEMİ (aç/kapat/ayarla/göster) istendiğinde SADECE yukarıdaki intent listesinden GERÇEK bir karşılığı varsa type:"action" döndür. Karşılığı YOKSA sakın type:"chat" ile "tamam, açıyorum / açılıyor / hallettim" gibi YAPMIŞ GİBİ cevap verme — bu KULLANICIYI KANDIRMAKTIR. Onun yerine dürüstçe söyle: type:"chat" say="Bunu şu an yapamıyorum" (kişiliğine uygun). Var olmayan bir eylemi asla onaylama.'
      : 'ÇOK ÖNEMLİ — SAHTE ONAY YASAK / ARAÇ GERÇEĞİ: bir ARAÇ EYLEMİ (aç/kapat/ayarla/göster/ara/çal/git) istendiğinde KONUŞARAK "tamam, açıyorum / açılıyor / hallettim / yapamıyorum" DEME. Yapmak = `mavi_action` aracını çağırmaktır; konuşmak yapmak DEĞİLDİR. Listede GERÇEK karşılığı varsa aracı çağır ve sus. Karşılığı yoksa ya da hangi intent olduğundan emin değilsen `mavi_unresolved` aracını çağır ve sus — sistem isteği başka yolla dener ya da dürüstçe söyler. Var olmayan bir eylemi asla onaylama.',
  ];
}

/** İnternet/güncel bilgi kararı — grounding desteğine göre. */
export function brainWebLines(surface: BrainSurface, supportsGrounding: boolean): readonly string[] {
  const w = WORDS[surface];
  if (!supportsGrounding) {
    return [
      // Grounding desteklemeyen modeller: canlı internet YOK.
      `Senin canlı/güncel internet erişimin YOK. Haber/döviz/hava/maç gibi anlık veri sorulursa bildiğin kadarıyla yanıtla ama emin olmadığında "kesin değil, değişmiş olabilir" diye dürüstçe belirt. ASLA ${w.web} ${surface === 'rest_json' ? 'döndürme' : 'çağırma'}.`,
    ];
  }
  return [
    surface === 'rest_json'
      ? 'İNTERNET ise: {"type":"web","query":"aranacak güncel bilgi (Türkçe, net)"}'
      : 'İNTERNET ise: `mavi_web_search` aracını çağır (query="aranacak güncel bilgi (Türkçe, net)") ve KONUŞMA; sistem aramayı yapıp cevabı seslendirir.',
    'Şunlar İNTERNET\'tir → GÜNCEL, gerçek-zamanlı veya senin eğitim verinde olmayan/güncelliğini yitirmiş HER bilgi:',
    'haberler ve gündem özeti, son dakika, hava durumu detayı/tahmin, döviz/altın/borsa, maç sonucu/fikstür, bir kişi-yer-olay hakkında GÜNCEL gerçek, "bugün ne oldu", "X kaç para", "X kimdir/nedir" (güncel), film/etkinlik, açılış saatleri.',
    `Bu tür isteklerde ASLA kafadan cevap uydurma ve "erişimim yok" DEME — ${w.web} ${surface === 'rest_json' ? 'döndür, query\'yi arama için en uygun biçimde yaz' : 'çağır, query\'yi arama için en uygun biçimde yaz'}. Sistem aramayı yapıp cevabı senin yerine seslendirir.`,
    `Genel/zamansız bilgi (matematik, tanım, nasıl yapılır, fıkra, bilmece, tavsiye) için web GEREKMEZ → doğrudan ${w.chat} ile cevapla.`,
  ];
}

/** Sohbet tarafı yetenekleri (fıkra/bilmece/genel kültür) — her iki yüzeyde aynı. */
export function brainChatSkillLines(): readonly string[] {
  return [
    'YETENEKLERİN (sohbet tarafında): sen tam donanımlı bir asistansın, bir komut robotu değil.',
    'Fıkra isteyince ("fıkra anlat", "bir şaka yap") → KISA, anlamlı, gerçekten komik ve Türk kültürüne uygun TEK bir fıkra anlat; saçma/anlamsız/yarım bırakma, başını-sonunu kur.',
    'Bilmece isteyince ("bilmece sor") → ZEKİCE tek bir bilmece SOR ve cevabı HEMEN verme; kullanıcı tahmin edince doğru/yanlış de ve doğru cevabı açıkla (geçmişten bilmeceyi hatırlarsın).',
    'Genel kültür/bilgi sorularını (zamansız olanları) net ve doğru yanıtla; tavsiye, hikâye, kelime oyunu, motivasyon da yapabilirsin. Hepsi düz konuşma metni — liste/madde/emoji yok.',
  ];
}

/** Çıkmaz yok kuralı — yüzeye göre. */
export function brainNoDeadEndLines(surface: BrainSurface): readonly string[] {
  return surface === 'rest_json'
    ? [
      'ASLA ÇIKMAZ YOK: metni hiç anlayamasan bile hata döndürme, boş dönme;',
      '{"type":"chat","say":"..."} ile kişiliğine uygun kısa bir tekrar-rica cümlesi üret ("Tam yakalayamadım, bir daha söyler misin?" gibi).',
    ]
    : [
      'ASLA ÇIKMAZ YOK: metni hiç anlayamazsan boş dönme. SOHBET/soruysa kişiliğine uygun tek kısa netleştirme sorusu sor; bir ARAÇ EYLEMİ istendiği belli ama eşleyemiyorsan `mavi_unresolved` aracını çağır (konuşma).',
    ];
}

/** Örnekler — tek liste, yüzeye göre yazım. */
export function brainExampleLines(surface: BrainSurface, supportsGrounding: boolean): readonly string[] {
  const list = [...EXAMPLES, ...(supportsGrounding ? WEB_EXAMPLES : [NO_WEB_EXAMPLE])];
  return ['ÖRNEKLER:', ...list.map((ex) => renderExample(ex, surface))];
}

/**
 * Yetenek bilgisinin TAMAMI (karar + web + örnekler) — yüzeye göre. Kişilik ve
 * kimlik satırları çağıranındır (REST: `buildBrainSystemPrompt`, Live:
 * `buildLiveSystemPrompt`); bu modül yalnız YETENEK bilgisini verir.
 */
export function buildBrainCapabilityKnowledge(
  surface: BrainSurface, supportsGrounding: boolean, intents: readonly string[],
): {
  readonly decision: readonly string[];
  readonly web: readonly string[];
  readonly chatSkills: readonly string[];
  readonly noDeadEnd: readonly string[];
  readonly examples: readonly string[];
} {
  return {
    decision:   brainDecisionLines(surface, intents),
    web:        brainWebLines(surface, supportsGrounding),
    chatSkills: brainChatSkillLines(),
    noDeadEnd:  brainNoDeadEndLines(surface),
    examples:   brainExampleLines(surface, supportsGrounding),
  };
}
