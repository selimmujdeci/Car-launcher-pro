(async () => {
 const btn = () => { const i = document.querySelector('.lucide-navigation-2'); return i ? i.closest('button') : null; };
 const on = b => /bg-amber-500/.test(b.className);
 const wait = ms => new Promise(r => setTimeout(r, ms));
 let b = btn(); if (!b) return { error: 'sürüş modu butonu yok' };
 const started = on(b);
 if (started) { b.click(); await wait(1500); b = btn(); }   // deterministik OFF→ON kenarı
 const before = window.__navFollow ? __navFollow() : null;
 __NAV_AFTER__.__camMark = __NAV_AFTER__.events.length;      // sayaç TAM kenarda sıfırlanır
 b.click();
 await wait(200);
 return { onceAcikti: started, before, after: window.__navFollow ? __navFollow() : null, mark: __NAV_AFTER__.__camMark };
})()
