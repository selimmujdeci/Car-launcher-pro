const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.layout = "LAYOUT_WIDE";          // 13.3 x 7.5
p.author = "CarOS Pro";
p.title  = "CarOS Pro — B2B Lisanslama";

const BG="0D0F13", CARD="14181F", CARD2="1A1F28", ACC="F2871C", ACC2="E07B14",
      TXT="F2F4F7", DIM="9AA2AD", FAINT="5A636F", LINE="2A2F38";
const HEAD="Arial", MONO="Consolas", BODY="Calibri";
const W=13.3, H=7.5, MX=0.75;
const sh=()=>({type:"outer",color:"000000",blur:9,offset:3,angle:135,opacity:0.35});

function base(title, kicker){
  const s=p.addSlide(); s.background={color:BG};
  if(kicker){
    s.addText(kicker.toUpperCase(),{x:MX,y:0.55,w:8,h:0.3,fontFace:MONO,fontSize:11,
      color:ACC,charSpacing:5,align:"left",margin:0});
  }
  if(title){
    s.addText(title,{x:MX,y:0.9,w:W-2*MX,h:0.95,fontFace:HEAD,fontSize:34,bold:true,
      color:TXT,align:"left",margin:0});
  }
  return s;
}

/* 1 — KAPAK */
(()=>{
  const s=p.addSlide(); s.background={color:BG};
  s.addShape(p.shapes.RECTANGLE,{x:0,y:0,w:0.18,h:H,fill:{color:ACC}});
  s.addText("CAR  OS  PRO",{x:MX,y:2.0,w:11,h:0.4,fontFace:MONO,fontSize:15,color:DIM,charSpacing:8,margin:0});
  s.addText("Arabanızın ekranı,",{x:MX,y:2.55,w:11.5,h:1.0,fontFace:HEAD,fontSize:56,bold:true,color:TXT,margin:0});
  s.addText("yeniden doğdu.",{x:MX,y:3.5,w:11.5,h:1.0,fontFace:HEAD,fontSize:56,bold:true,color:ACC,margin:0});
  s.addText("Aftermarket araç ekranları için offline-first premium araç-içi işletim sistemi.",
    {x:MX,y:4.75,w:10,h:0.5,fontFace:BODY,fontSize:17,color:DIM,margin:0});
  s.addShape(p.shapes.RECTANGLE,{x:MX,y:5.7,w:3.4,h:0.62,fill:{color:ACC},shadow:sh()});
  s.addText("B2B LİSANSLAMA SUNUMU",{x:MX,y:5.7,w:3.4,h:0.62,fontFace:MONO,fontSize:12,bold:true,
    color:"0A0A0A",align:"center",valign:"middle",charSpacing:2,margin:0});
  s.addText("Offline · Türkçe · Güvenli · Premium",{x:W-5.2,y:6.95,w:4.45,h:0.3,fontFace:MONO,
    fontSize:10,color:FAINT,align:"right",charSpacing:2,margin:0});
})();

/* 2 — SORUN */
(()=>{
  const s=base("İyi donanım. Kötü yazılım.","Sorun");
  const probs=[
    ["Yavaş & çirkin arayüz","Stock launcher'lar kararsız, eski, kullanışsız."],
    ["İnternet bağımlı","Yerelleştirme zayıf; sinyalsizken işlevsiz kalır."],
    ["Araç verisi kullanılmıyor","OBD/CAN potansiyeli boşa gidiyor."],
    ["Güncelleme & güvenlik yok","OTA yok, güvenlik altyapısı yok."],
  ];
  let y=2.15;
  probs.forEach((pr,i)=>{
    s.addShape(p.shapes.RECTANGLE,{x:MX,y,w:W-2*MX,h:0.92,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y,w:0.07,h:0.92,fill:{color:ACC}});
    s.addText(String(i+1).padStart(2,"0"),{x:MX+0.25,y,w:0.8,h:0.92,fontFace:MONO,fontSize:24,
      bold:true,color:ACC,align:"left",valign:"middle",margin:0});
    s.addText(pr[0],{x:MX+1.15,y:y+0.14,w:5.2,h:0.4,fontFace:HEAD,fontSize:18,bold:true,color:TXT,valign:"middle",margin:0});
    s.addText(pr[1],{x:MX+6.4,y,w:W-2*MX-6.6,h:0.92,fontFace:BODY,fontSize:14,color:DIM,valign:"middle",margin:0});
    y+=1.07;
  });
  s.addText("→ Son kullanıcı memnuniyetsizliği · iade · düşük marka değeri.",
    {x:MX,y:6.85,w:11,h:0.35,fontFace:MONO,fontSize:12,color:FAINT,margin:0,charSpacing:1});
})();

/* 3 — ÇÖZÜM */
(()=>{
  const s=base("","Çözüm");
  s.addText("CarOS Pro",{x:MX,y:1.55,w:11,h:0.6,fontFace:MONO,fontSize:16,color:ACC,charSpacing:4,margin:0});
  s.addText([
    {text:"Cihazınıza ",options:{color:TXT}},
    {text:"anahtar teslim ",options:{color:ACC}},
    {text:"premium yazılım katmanı.",options:{color:TXT}},
  ],{x:MX,y:2.1,w:11.8,h:1.6,fontFace:HEAD,fontSize:44,bold:true,margin:0,lineSpacingMultiple:1.0});
  s.addText("Aynı donanım. 10× deneyim.",{x:MX,y:3.95,w:11,h:0.5,fontFace:BODY,fontSize:18,italic:true,color:DIM,margin:0});
  const cols=[
    ["Hızlı kurulum","Mevcut Android head unit'lere kurulabilir."],
    ["Tam yerel","İnternetsiz çalışan navigasyon, asistan, harita."],
    ["Markalanabilir","White-label, OEM kimliğinize uyarlanır."],
  ];
  let x=MX;
  cols.forEach(c=>{
    s.addShape(p.shapes.RECTANGLE,{x,y:5.0,w:3.78,h:1.7,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x,y:5.0,w:3.78,h:0.06,fill:{color:ACC}});
    s.addText(c[0],{x:x+0.28,y:5.25,w:3.3,h:0.4,fontFace:HEAD,fontSize:16,bold:true,color:TXT,margin:0});
    s.addText(c[1],{x:x+0.28,y:5.72,w:3.3,h:0.85,fontFace:BODY,fontSize:13,color:DIM,margin:0});
    x+=4.0;
  });
})();

/* 4 — FARKLILAŞTIRICILAR */
(()=>{
  const s=base("Neden CarOS Pro?","Farklılaştırıcılar");
  const items=[
    ["Offline-First","Head unit'ler internetsiz; navigasyon/asistan/POI çevrimdışı çalışır."],
    ["OBD + CAN Derinliği","K24/Hiworld/NWD protokolleri çözülmüş — kopyalanması zor hendek."],
    ["Düşük Donanım Opt.","Mali-400 sınıfı GPU'da akıcı; termal & akü koruması."],
    ["Türkçe & Yerel","Vosk Türkçe ses tanıma, yerel radar/POI — pazara hazır."],
    ["Güvenlik Mimarisi","E2E şifreli uzaktan komut, RLS backend, Keystore."],
    ["Filo Yönetimi","Uzaktan yapılandırma, feature flags, kademeli güncelleme."],
  ];
  const cw=3.78, gap=0.13, ch=1.62; let x=MX, y=2.1, col=0;
  items.forEach((it,i)=>{
    s.addShape(p.shapes.RECTANGLE,{x,y,w:cw,h:ch,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x,y,w:0.06,h:ch,fill:{color:ACC}});
    s.addText(it[0],{x:x+0.26,y:y+0.16,w:cw-0.5,h:0.4,fontFace:HEAD,fontSize:16,bold:true,color:ACC,margin:0});
    s.addText(it[1],{x:x+0.26,y:y+0.6,w:cw-0.5,h:0.92,fontFace:BODY,fontSize:12.5,color:DIM,margin:0});
    col++; if(col===3){col=0;x=MX;y+=ch+0.15;} else x+=cw+gap;
  });
})();

/* 5 — ÖZELLİKLER */
(()=>{
  const s=base("Tek ekranda, eksiksiz.","Özellikler");
  const f=[
    ["Navigasyon","Offline harita, turn-by-turn, POI, tünel modu."],
    ["Araç Teşhisi","OBD/CAN canlı telemetri, arıza kodları, bakım tahmini."],
    ["Güvenlik","Radar, geri vites kamera, kaza kara kutusu, hız/mesafe."],
    ["Sesli Asistan","Çevrimdışı Türkçe komut + isteğe bağlı AI (BYOK)."],
    ["Medya","Akış servisleri, radyo, yerel, sinema modu, DSP ses."],
    ["Uzaktan Kontrol","Telefondan E2E şifreli kilit/korna/rota gönder."],
  ];
  const cw=3.78, gap=0.13, ch=1.55; let x=MX, y=2.1, col=0;
  f.forEach((it)=>{
    s.addShape(p.shapes.RECTANGLE,{x,y,w:cw,h:ch,fill:{color:CARD2},shadow:sh()});
    s.addText(it[0],{x:x+0.28,y:y+0.2,w:cw-0.5,h:0.4,fontFace:HEAD,fontSize:17,bold:true,color:TXT,margin:0});
    s.addText(it[1],{x:x+0.28,y:y+0.66,w:cw-0.5,h:0.8,fontFace:BODY,fontSize:13,color:DIM,margin:0});
    col++; if(col===3){col=0;x=MX;y+=ch+0.15;} else x+=cw+gap;
  });
})();

/* 6 — ENTEGRASYON */
(()=>{
  const s=base("Entegrasyon modeli","Nasıl Kurulur");
  const steps=[
    ["01","Android / Capacitor","Mevcut Android head unit'lere yazılım katmanı olarak kurulur."],
    ["02","Per-Vehicle CAN Profili","Cihaza özel CAN/MCU yapılandırması — donanım fragmentasyonu yönetilir."],
    ["03","OTA & Uzaktan Yapılandırma","Kademeli güncelleme, feature flags ve remote config hazır."],
  ];
  let y=2.25;
  steps.forEach(st=>{
    s.addShape(p.shapes.RECTANGLE,{x:MX,y,w:W-2*MX,h:1.25,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.OVAL,{x:MX+0.35,y:y+0.3,w:0.65,h:0.65,fill:{color:ACC}});
    s.addText(st[0],{x:MX+0.35,y:y+0.3,w:0.65,h:0.65,fontFace:MONO,fontSize:18,bold:true,
      color:"0A0A0A",align:"center",valign:"middle",margin:0});
    s.addText(st[1],{x:MX+1.35,y:y+0.22,w:5.3,h:0.45,fontFace:HEAD,fontSize:18,bold:true,color:TXT,valign:"middle",margin:0});
    s.addText(st[2],{x:MX+6.7,y,w:W-2*MX-7.0,h:1.25,fontFace:BODY,fontSize:14,color:DIM,valign:"middle",margin:0});
    y+=1.45;
  });
})();

/* 7 — LİSANSLAMA */
(()=>{
  const s=base("Lisanslama","Ticari Model");
  s.addText([
    {text:"Ticari satışa uygun. ",options:{color:ACC,bold:true}},
    {text:"Kopyaleft lisans yok, gömülü 3. taraf API anahtarı yok (BYOK).",options:{color:TXT}},
  ],{x:MX,y:2.0,w:11.5,h:0.7,fontFace:BODY,fontSize:18,margin:0});
  const models=[
    ["Cihaz-Başı","Tekil cihaz lisansı — küçük ölçek ve pilot için."],
    ["OEM Toplu","Üretim hattına toplu lisans — en yüksek ölçek."],
    ["White-Label","Markanıza uyarlanmış tam özelleştirme."],
  ];
  let x=MX;
  models.forEach(m=>{
    s.addShape(p.shapes.RECTANGLE,{x,y:3.0,w:3.78,h:2.6,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x,y:3.0,w:3.78,h:0.07,fill:{color:ACC}});
    s.addText(m[0],{x:x+0.3,y:3.35,w:3.2,h:0.5,fontFace:HEAD,fontSize:19,bold:true,color:ACC,margin:0});
    s.addText(m[1],{x:x+0.3,y:3.95,w:3.2,h:1.4,fontFace:BODY,fontSize:14,color:DIM,margin:0});
    x+=4.0;
  });
  s.addText("Mevcut bağımlılıklar permissive (MIT/Apache/BSD) — kopyaleft denetimi temiz.",
    {x:MX,y:6.1,w:11.5,h:0.4,fontFace:MONO,fontSize:12,color:FAINT,margin:0,charSpacing:1});
})();

/* 8 — OLGUNLUK & YOL HARİTASI */
(()=>{
  const s=base("Olgunluk & yol haritası","Şeffaflık");
  const cols=[
    ["TAMAMLANAN","Çekirdek üretim-kalitesi: eşzamanlılık, kripto, persistence. OBD/BLE, CAN bridge, offline harita/asistan, uzaktan komut.",ACC],
    ["SERTLEŞTİRME","Cihaz-bazlı QA, performans aktivasyonu, BYOK ayar arayüzü, backend deploy doğrulaması — devam ediyor.","CFA15A"],
    ["DOĞRULAMA","Bağımsız güvenlik denetiminden geçti; baş-kritik bulgular giderildi. Sürekli denetim planlı.","9AA2AD"],
  ];
  let x=MX;
  cols.forEach(c=>{
    s.addShape(p.shapes.RECTANGLE,{x,y:2.2,w:3.78,h:4.0,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x,y:2.2,w:3.78,h:0.5,fill:{color:c[2]}});
    s.addText(c[0],{x:x+0.05,y:2.2,w:3.68,h:0.5,fontFace:MONO,fontSize:13,bold:true,color:"0A0A0A",
      align:"center",valign:"middle",charSpacing:2,margin:0});
    s.addText(c[1],{x:x+0.3,y:2.95,w:3.2,h:3.0,fontFace:BODY,fontSize:14,color:DIM,margin:0});
    x+=4.0;
  });
  s.addText("Dürüst konum: güçlü çekirdek + sürmekte olan üretim sertleştirmesi.",
    {x:MX,y:6.5,w:11.5,h:0.4,fontFace:MONO,fontSize:12,color:FAINT,margin:0,charSpacing:1});
})();

/* 9 — HEDEF PAZAR */
(()=>{
  const s=base("Hedef pazar","Fırsat");
  s.addText([
    {text:"Türkiye · MENA · Doğu Avrupa",options:{color:ACC,bold:true}},
  ],{x:MX,y:2.0,w:11.5,h:0.6,fontFace:HEAD,fontSize:28,margin:0});
  s.addText("Aftermarket head unit pazarı büyük ve büyüyor; yazılım kalitesi düşük — premium katmana net talep.",
    {x:MX,y:2.85,w:11.5,h:0.7,fontFace:BODY,fontSize:17,color:DIM,margin:0});
  const segs=[
    ["Sürücü","Stock yazılımdan memnun olmayan, premium & Türkçe deneyim isteyen son kullanıcılar."],
    ["Üretici / OEM","Donanımı iyi, yazılımı zayıf cihazlara anahtar teslim katman arayan markalar."],
    ["EV & Filo","Elektrikli araç artışı ve filo telemetrisi — ikincil büyüme ekseni."],
  ];
  let x=MX;
  segs.forEach(g=>{
    s.addShape(p.shapes.RECTANGLE,{x,y:3.9,w:3.78,h:2.6,fill:{color:CARD},shadow:sh()});
    s.addShape(p.shapes.RECTANGLE,{x,y:3.9,w:0.06,h:2.6,fill:{color:ACC}});
    s.addText(g[0],{x:x+0.3,y:4.2,w:3.2,h:0.5,fontFace:HEAD,fontSize:18,bold:true,color:TXT,margin:0});
    s.addText(g[1],{x:x+0.3,y:4.8,w:3.2,h:1.5,fontFace:BODY,fontSize:13.5,color:DIM,margin:0});
    x+=4.0;
  });
})();

/* 10 — KAPANIŞ */
(()=>{
  const s=p.addSlide(); s.background={color:BG};
  s.addShape(p.shapes.RECTANGLE,{x:0,y:0,w:W,h:0.18,fill:{color:ACC}});
  s.addText("Aynı donanım.",{x:MX,y:2.2,w:12,h:0.9,fontFace:HEAD,fontSize:48,bold:true,color:TXT,margin:0});
  s.addText("Premium deneyim.",{x:MX,y:3.1,w:12,h:0.9,fontFace:HEAD,fontSize:48,bold:true,color:TXT,margin:0});
  s.addText("Anahtar teslim.",{x:MX,y:4.0,w:12,h:0.9,fontFace:HEAD,fontSize:48,bold:true,color:ACC,margin:0});
  s.addText("Demo, lisanslama ve iş birliği için iletişime geçin.",
    {x:MX,y:5.25,w:11,h:0.5,fontFace:BODY,fontSize:17,color:DIM,margin:0});
  s.addText("CAR OS PRO  ·  Offline · Türkçe · Güvenli · Premium",
    {x:MX,y:6.85,w:12,h:0.3,fontFace:MONO,fontSize:11,color:FAINT,charSpacing:3,margin:0});
})();

p.writeFile({fileName:"CarOS_Pro_B2B_Pitch.pptx"}).then(f=>console.log("OK:",f));
