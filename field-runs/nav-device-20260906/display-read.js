(()=>({text:document.body.innerText.slice(-3500),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(t=>/Gece|Gündüz|GERİ/.test(t))}))()
