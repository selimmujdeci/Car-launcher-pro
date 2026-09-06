JSON.stringify({globals:Object.keys(window).filter(k=>/__|store/i.test(k)),text:document.body.innerText.slice(0,6500),scripts:[...document.scripts].map(s=>s.src)})
