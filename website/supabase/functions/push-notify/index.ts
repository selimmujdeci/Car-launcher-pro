/**
 * push-notify — Vehicle Push-to-Wake (FCM HTTP v1, data-only).
 *
 * Araç push aldığında CommandListener'ı tetikler. Görünür bildirim GÖNDERMEZ.
 *
 * Çağrı: POST /functions/v1/push-notify
 * Body: { event, vehicleId, payload? }
 *
 * ── BU FONKSİYON NE DEĞİLDİR (PROD-1A/1A2) ───────────────────────────────
 *   OAuth token alındı ≠ FCM kabul etti ≠ cihaz aldı ≠ araç uyandı
 *   ≠ komut alındı ≠ fiziksel işlem gerçekleşti.
 * Push yalnız bir HIZLANDIRICIDIR. Komutun kalıcı otoritesi `vehicle_commands`
 * + kanonik `CommandListener`dır ve 15 sn'lik yoklama her hâlükârda sürer.
 * Bu yüzden buradaki hiçbir hata komutu FAILED yapmaz.
 *
 * ── PROD-1A2: HTTP v1 KİMLİĞİ ────────────────────────────────────────────
 * Eskiden HTTP v1 ucuna `Bearer ${FCM_SERVER_KEY}` gönderiliyordu; v1 legacy
 * server key KABUL ETMEZ, kısa ömürlü OAuth2 access token ister. Artık kimlik
 * service-account → RS256 assertion → Google OAuth → access token zinciriyle
 * kurulur (`googleAuth.ts`).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { authorizePushRequest } from './pushAuth.ts';
import {
  parseServiceAccount,
  createAccessTokenProvider,
  type ServiceAccount,
  type AccessTokenProvider,
} from './googleAuth.ts';
import { FCM_SEND_ENDPOINT, isWakeEvent } from './fcmDelivery.ts';
import { dispatchWake } from './wakeDispatch.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;        // RLS-aware kullanıcı sorgusu için

/** TEK secret: service account JSON. `project_id` dâhil her şeyi taşır. */
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '';

/**
 * Geçiş dönemi kontrolü — ikinci bir project-id OTORİTESİ DEĞİLDİR.
 *
 * Kanonik project_id service account'ın içindedir; ayrı bir env ile iki ayrı
 * doğruluk kaynağı tutmak, birinin sessizce yanlış projeye push atmasına yol
 * açardı. Bu yüzden `FCM_PROJECT_ID` yalnız AYARLIYSA ve UYUŞMUYORSA
 * fail-closed bir çelişki sinyali olarak okunur; hiçbir koşulda service
 * account'ın değerinin yerine geçmez.
 */
const LEGACY_PROJECT_ID = (Deno.env.get('FCM_PROJECT_ID') ?? '').trim();

/**
 * Gövde sözleşmesi (MRI F-08): yalnız `event` + `vehicleId`. `payload` alanı
 * ARTIK OKUNMAZ — eski istemciler gönderse bile yok sayılır; wake mesajına
 * hiçbir çağıran alanı geçmez.
 */
interface PushBody {
  event:      string;
  vehicleId:  string;
}

/* ── Isolate ömürlü kimlik durumu ────────────────────────────────────────── */

const saResult = parseServiceAccount(FCM_SERVICE_ACCOUNT_JSON);
let account:  ServiceAccount | null = saResult.ok ? saResult.account : null;
let configReason = saResult.ok ? '' : saResult.reason;

if (account && LEGACY_PROJECT_ID && LEGACY_PROJECT_ID !== account.projectId) {
  /* İki kaynak çelişiyor → hangisinin doğru olduğunu TAHMİN ETMEYİZ. */
  configReason = 'PROJECT_ID_MISMATCH';
  account = null;
}

const tokenProvider: AccessTokenProvider | null =
  account ? createAccessTokenProvider(account, { now: () => Date.now(), fetch }) : null;

/** Yanıt yardımcıları — taşıma sağlığı, KOMUT sağlığı değildir (bkz. başlık). */
const json = (obj: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: PushBody;
  try {
    body = await req.json() as PushBody;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { event, vehicleId } = body;
  if (!vehicleId) return new Response('vehicleId required', { status: 400 });
  /* Bir slug = bir semantik. İnsan bildirimi olayı (vehicle_offline,
     command_completed, health_alert …) buraya gelirse bu bir ÇAĞIRAN
     HATASIDIR; sessizce araç uyandırılmaz, 400 ile geri çevrilir. */
  if (!isWakeEvent(event)) {
    return json({ ok: false, reason: 'NOT_A_WAKE_EVENT', accepted: 0 }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Auth (E1 + prod-şema fix) ────────────────────────────────────────────────
  // ÖNCE: sahte "Bearer X" kabul ediliyordu (JWT doğrulaması yok) → yetkisiz push-to-wake.
  // ŞİMDİ: service_role bypass'ı VEYA doğrulanmış JWT + araca RLS erişimi.
  // Prod şemada araç↔kullanıcı ilişkisi `vehicles` RLS policy'sindedir:
  //   company_id = auth_company_id() OR owner_id = auth.uid()  (001_init.sql:194-200)
  // Erişim, kullanıcının kendi JWT'siyle (RLS-aware) vehicles SELECT'ine delege edilir →
  // owner + şirket-üyesi senaryolarını DB'nin kendi mantığı çözer. Karar mantığı pushAuth.ts'te (test).
  // PROD-1A2 bu kapıya DOKUNMAZ — bu tur yalnız FCM TAŞIMA kimliğidir.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();

  const decision = await authorizePushRequest(token, vehicleId, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    verifyJwt: async (t) => {
      const { data: { user }, error } = await supabase.auth.getUser(t);
      return error || !user ? null : user.id;
    },
    vehicleExists: async (vid) => {
      const { data } = await supabase.from('vehicles').select('id').eq('id', vid).maybeSingle();
      return !!data;
    },
    userCanAccessVehicle: async (t, vid) => {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${t}` } },
        auth: { persistSession: false },
      });
      const { data } = await userClient.from('vehicles').select('id').eq('id', vid).maybeSingle();
      return !!data;
    },
  });

  if (!decision.ok) {
    const msg = decision.status === 401 ? 'Unauthorized'
              : decision.status === 404 ? 'Vehicle not found'
              : 'Forbidden';
    return new Response(msg, { status: decision.status });
  }

  // ── FCM taşıma kimliği yapılandırılmış mı ────────────────────────────────
  if (!account || !tokenProvider) {
    /* Sebep KATEGORİDİR; secret DEĞERİ hiçbir log/yanıta girmez. */
    console.warn(`[push-notify] FCM yapılandırması kullanılamıyor: ${configReason}`);
    return json({ ok: false, reason: 'FCM_NOT_CONFIGURED', detail: configReason, accepted: 0 });
  }

  // ── Araç FCM token'ları ──────────────────────────────────────────────────
  const { data: tokens, error } = await supabase
    .from('vehicle_push_tokens')
    .select('fcm_token')
    .eq('vehicle_id', vehicleId);

  if (error) {
    console.warn('[push-notify] Token okunamadı:', error.code ?? 'unknown');
    return json({ ok: false, reason: 'TOKEN_READ_FAILED', accepted: 0 });
  }

  if (!tokens?.length) {
    /* Yetkili araç ama kayıtlı cihaz YOK → güvenli no-op. "Uyandırıldı" DENMEZ;
       komut yoklama yoluyla zaten alınır. */
    return json({ ok: true, reason: 'NO_REGISTERED_DEVICE', accepted: 0, tokens: 0 });
  }

  // ── OAuth access token: döngüden ÖNCE, BİR KEZ ───────────────────────────
  // Her cihaz token'ı için ayrı OAuth turu atılmaz; tek tur bu yapıdan gelir.
  const auth = await tokenProvider.get();
  if (!auth.ok) {
    /* §OAuth başarısız → FCM'e HİÇ gidilmez, HİÇBİR token silinmez.
       Komut akışı etkilenmez: push yalnız hızlandırıcıdır. */
    console.warn(`[push-notify] OAuth başarısız: ${auth.reason}${auth.status ? ` (${auth.status})` : ''}`);
    return json({ ok: false, reason: 'FCM_AUTH_FAILED', detail: auth.reason, accepted: 0, tokens: tokens.length });
  }

  /* Gönderim/izolasyon/temizlik sayımı `wakeDispatch`tedir (saf, test edilebilir):
     bir token'ın ölmesi kardeşlerini SİLDİRMEZ, temizlik hatası gönderimi
     DURDURMAZ. Cihaz token'ı ve access token LOGLANMAZ. */
  const summary = await dispatchWake(
    tokens.map(({ fcm_token }) => fcm_token as string),
    event, vehicleId,
    {
      accessToken: auth.accessToken,
      endpoint:    FCM_SEND_ENDPOINT(account.projectId),
      now:         () => Date.now(),
      fetch,
      deleteToken: async (fcmToken) => {
        /* YALNIZ bu araç + bu token satırı. Toplu silme / TRUNCATE YOK. */
        const { error: delErr } = await supabase
          .from('vehicle_push_tokens')
          .delete()
          .eq('vehicle_id', vehicleId)
          .eq('fcm_token', fcmToken);
        return { ok: !delErr };
      },
      warn: (msg) => console.warn(`[push-notify] ${msg}`),
    },
  );

  /* Gözlemlenebilirlik (F-08): VEHICLE_WAKE_* etiketi — tüketici push'undan
     ayrı sayılır. Token/sır yok; yalnız sayı ve kategori. */
  console.log(`[push-notify] ${summary.accepted > 0 ? 'VEHICLE_WAKE_ACCEPTED' : 'VEHICLE_WAKE_FAILED'} ${event}@${vehicleId}: accepted=${summary.accepted} failed=${summary.failed} cleaned=${summary.cleaned}`);

  /* `accepted` = FCM HTTP v1'in KABUL ETTİĞİ mesaj sayısı.
     TESLİM EDİLDİ / UYANDI / ÇALIŞTIRILDI anlamına GELMEZ. */
  return json({
    ok: true,
    accepted: summary.accepted,
    failed:   summary.failed,
    tokens:   tokens.length,
    cleaned:  summary.cleaned,
    ...(summary.cleanupFailed ? { cleanupFailed: summary.cleanupFailed } : {}),
  });
});
