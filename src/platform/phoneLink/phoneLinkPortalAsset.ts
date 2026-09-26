/**
 * phoneLinkPortalAsset.ts — PHONE LINK F3 · misafir portalının TEK varlığı.
 *
 * ── TAMAMEN YEREL ────────────────────────────────────────────────────────────
 * Hiçbir CDN, font, script veya görsel DIŞARIDAN çekilmez (F3.11). Portal
 * internet erişimine İHTİYAÇ DUYMAZ — head unit'in kendi yerel arayüzünden
 * servis edilir ve `Content-Security-Policy: default-src 'none'` ile kilitlenir.
 *
 * ── NEDEN TEK DOSYA / SATIR İÇİ ──────────────────────────────────────────────
 * İkinci bir statik dosya sunmak, "keyfi dosya erişimi YOK" kuralını korumak
 * için bir dosya haritası gerektirirdi. Tek satır-içi belge ile sunucunun
 * servis edebileceği dosya kümesi YAPISAL OLARAK BOŞ kalır (bkz.
 * `phoneLinkPortalHttp.ts` — yol allowlist'i).
 *
 * ── POLLING YOK (F3.7) ───────────────────────────────────────────────────────
 * Durum TEK bir `EventSource` (SSE) bağlantısından PUSH edilir. Sayfada
 * `setInterval` YOKTUR; yeniden bağlanma tarayıcının kendi SSE geri çekilme
 * davranışına bırakılır (kendi timer'ımızı KURMAYIZ).
 */

/**
 * Portal kabuğu. Bootstrap token'ı yalnız URL FRAGMENT'inden okur — fragment
 * sunucuya HİÇ gönderilmez, bu yüzden access log'a/Referer'a DÜŞMEZ. Token
 * tek kullanımlıktır; sayfa onu portal token'ıyla değiştirir ve yalnız
 * `Authorization` başlığında taşır (query'de ASLA).
 */
export const PHONE_LINK_PORTAL_HTML = `<!DOCTYPE html><html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>CarOS Müzik</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#0a0f1a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
padding:32px 20px;gap:28px;user-select:none;-webkit-user-select:none}
.tag{font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:rgba(248,250,252,.35)}
.card{width:100%;max-width:360px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
border-radius:20px;padding:26px 20px;text-align:center}
#t{font-size:19px;font-weight:650;line-height:1.3;word-break:break-word}
#a{font-size:13px;color:rgba(248,250,252,.55);margin-top:7px;word-break:break-word}
#s{font-size:11px;color:rgba(248,250,252,.4);margin-top:14px}
.row{display:flex;gap:14px;align-items:center;justify-content:center}
button{width:64px;height:64px;border-radius:50%;border:1px solid rgba(255,255,255,.12);
background:rgba(255,255,255,.06);color:#f8fafc;font-size:22px;cursor:pointer;
display:flex;align-items:center;justify-content:center;touch-action:manipulation}
button:disabled{opacity:.3}
button.pp{width:78px;height:78px;background:#2563eb;border-color:#2563eb;font-size:26px}
.err{color:#f87171;font-size:13px;text-align:center;max-width:320px;line-height:1.5}
</style></head><body>
<div class="tag" id="hdr">CarOS Müzik Uzaktan Kumanda</div>
<div class="card"><div id="t">—</div><div id="a"></div><div id="s">Bağlanıyor…</div></div>
<div class="row">
<button id="pv" disabled>&#9664;&#9664;</button>
<button id="pp" class="pp" disabled>&#9654;</button>
<button id="nx" disabled>&#9654;&#9654;</button>
</div>
<div class="err" id="e"></div>
<script>
(function(){
var PT=null,SK=null,ES=null,PLAYING=false;
var $=function(i){return document.getElementById(i)};
var BTN=['pv','pp','nx'];
function lock(v){BTN.forEach(function(i){$(i).disabled=v})}
function fail(m){$('e').textContent=m;$('s').textContent='';lock(true);
  if(ES){ES.close();ES=null}}
function paint(d){
  PLAYING=!!d.playing;
  $('t').textContent=d.title||'Calmiyor';
  $('a').textContent=[d.artist,d.album].filter(Boolean).join(' · ');
  $('s').textContent=(PLAYING?'Caliyor':'Duraklatildi')+(d.queueCount?' · kuyrukta '+d.queueCount:'');
  $('pp').innerHTML=PLAYING?'&#10074;&#10074;':'&#9654;';
  lock(false);}
function send(c){
  if(!PT)return;
  lock(true);
  fetch('/command',{method:'POST',headers:{'Authorization':'Bearer '+PT,'Content-Type':'application/json'},
    body:JSON.stringify({c:c})}).then(function(r){
      if(r.status===401||r.status===403){fail('Baglanti sona erdi. QR kodunu yeniden okutun.');return null}
      return r.json();})
    .then(function(j){if(j&&j.state)paint(j.state);else lock(false)})
    .catch(function(){lock(false)});}
$('pv').onclick=function(){send('PREVIOUS')};
$('nx').onclick=function(){send('NEXT')};
$('pp').onclick=function(){send(PLAYING?'PAUSE':'PLAY')};
function openStream(){
  if(!SK)return;
  /* Salt-okunur akis anahtari — komut VEREMEZ. Portal token'i (komut yetkisi)
     ASLA URL'e konmaz; yalniz Authorization basliginda tasinir. */
  ES=new EventSource('/events?k='+encodeURIComponent(SK));
  ES.onmessage=function(ev){try{paint(JSON.parse(ev.data))}catch(x){}};
  ES.onerror=function(){$('s').textContent='Baglanti kesildi'};}
var m=/[#&]t=([A-Za-z0-9_-]+)/.exec(location.hash||'');
if(!m){fail('Gecersiz baglanti. QR kodunu yeniden okutun.');return}
var bt=m[1];
/* Bootstrap token adres cubugundan DERHAL silinir. */
try{history.replaceState(null,'',location.pathname)}catch(x){}
fetch('/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:bt})})
 .then(function(r){
   if(!r.ok){fail(r.status===409
     ?'Bu QR kodu zaten kullanildi. Aractan yeni kod isteyin.'
     :'Baglanti reddedildi. QR kodunu yeniden okutun.');return null}
   return r.json();})
 .then(function(j){
   if(!j)return;
   PT=j.portalToken;SK=j.streamToken;
   if(j.state)paint(j.state);
   openStream();})
 .catch(function(){fail('Araca ulasilamadi.')});
})();
</script></body></html>`;
