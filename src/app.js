import {glossary} from './glossary.js';
import {normalizeWord, isSingleWord, localPronunciation, onlinePronunciation} from './pronunciation.js';
import {listDocuments, getDocument as getLibraryDocument, saveDocuments} from './library.js';
import {getDocument, GlobalWorkerOptions, TextLayer} from '../public/vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('../public/vendor/pdf.worker.mjs', import.meta.url).href;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = 'ebookstudio-v1';
let saved; try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
const state = saved && Array.isArray(saved.notes) && Array.isArray(saved.words) && saved.books ? saved : {notes:[], words:[], books:{}};
if(!Array.isArray(state.highlights))state.highlights=[];
let pdf, docId, pageNo = 1, zoom = 1, generation = 0, loadGeneration = 0, lookupGeneration = 0, currentWord, selection = null, editId = null, toastTimer, pageObserver, scrollObserver, currentLibraryId = 'sample';
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').style.display = 'none', 4000); }
function persist() { try {localStorage.setItem(key, JSON.stringify(state)); return true;} catch {toast('Bộ nhớ đã đầy hoặc bị chặn. Hãy xuất ghi chú để sao lưu.'); return false;} }
function tab(name) { document.body.classList.remove('focused'); document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== name); document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('selected', b.dataset.tab === name)); renderLists(); }
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
$('#notes-nav').onclick = () => tab('notes'); $('#vocab-nav').onclick = () => tab('words'); $('#library').onclick = showLibrary;
$('#focus').onclick = () => document.body.classList.toggle('focused');
const formatBytes = bytes => bytes < 1048576 ? `${Math.max(1,Math.round(bytes/1024))} KB` : `${(bytes/1048576).toFixed(1)} MB`;
const progressFor = (fingerprint, pages) => {
  if(!fingerprint)return {current:0,total:pages||1,percent:0};
  const current=fingerprint&&state.books[fingerprint]?.page||1,total=pages||1;
  return {current,total,percent:Math.max(0,Math.min(100,Math.round(current/total*100)))};
};
async function renderLibrary(){
  const grid=$('#library-grid');grid.innerHTML='<p class="library-loading">Đang mở thư viện…</p>';
  try{
    const documents=(await listDocuments()).sort((a,b)=>new Date(b.addedAt)-new Date(a.addedAt));
    $('#library-count').textContent=String(documents.length+1).padStart(2,'0');
    const sampleProgress=progressFor(state.sampleFingerprint,301);
    const sampleCard=`<article class="library-card sample-card"><button class="library-open" data-open-id="sample"><div class="library-cover"><span>INTRODUCTION TO</span><strong>COSMOLOGY</strong><i>BARBARA RYDEN</i><b>✦</b></div><div class="library-meta"><h3>Introduction to Cosmology</h3><p>Barbara Ryden · 301 trang</p><div class="library-progress"><span style="width:${sampleProgress.percent}%"></span></div><small>Trang ${sampleProgress.current} · ${sampleProgress.percent}%</small></div></button></article>`;
    const cards=documents.map((document,index)=>{const metadata=state.libraryMeta?.[document.id]||{},progress=progressFor(metadata.fingerprint,metadata.pages);return `<article class="library-card tone-${index%4}"><button class="library-open" data-open-id="${esc(document.id)}"><div class="library-cover"><span>PDF DOCUMENT</span><strong>${esc(document.name.replace(/\.pdf$/i,'').slice(0,32))}</strong><i>${formatBytes(document.size)}</i><b>▤</b></div><div class="library-meta"><h3>${esc(document.name.replace(/\.pdf$/i,''))}</h3><p>${metadata.pages?`${metadata.pages} trang · `:''}${formatBytes(document.size)}</p><div class="library-progress"><span style="width:${progress.percent}%"></span></div><small>${metadata.fingerprint?`Trang ${progress.current} · ${progress.percent}%`:'Chưa đọc'}</small></div></button></article>`}).join('');
    grid.innerHTML=sampleCard+cards+`<button class="library-add-card" id="library-empty-add"><span>＋</span><strong>Thêm tài liệu</strong><small>PDF từ máy của bạn</small></button>`;
    $('#library-empty-add').onclick=()=>$('#file').click();
  }catch(error){console.error(error);grid.innerHTML='<p class="library-loading">Không thể kết nối với thư mục Libaries. Hãy chạy ứng dụng bằng start.ps1.</p>';$('#library-count').textContent='01';}
}
async function showLibrary(){document.body.classList.remove('focused');$('#library-view').hidden=false;$('#library-close').hidden=!pdf;document.body.classList.add('library-opened');await renderLibrary();}
function closeLibrary(force=false){if(!pdf&&!force)return;$('#library-view').hidden=true;document.body.classList.remove('library-opened');}
async function openStoredDocument(id){
  try{const document=await getLibraryDocument(id);if(!document)throw new Error('Missing document');closeLibrary(true);await openPdf(new Uint8Array(await document.file.arrayBuffer()),document.name,false,id);}
  catch(error){console.error(error);toast('Không thể mở tài liệu đã lưu.');}
}
$('#library-add').onclick=()=>$('#file').click();$('#library-close').onclick=closeLibrary;
$('#library-view').onclick=e=>{if(e.target===$('#library-view')&&pdf)closeLibrary();const button=e.target.closest('[data-open-id]');if(!button)return;button.dataset.openId==='sample'?(closeLibrary(true),openPdf('/api/library/file?name=Ryden_IntroCosmo.pdf','Ryden_IntroCosmo.pdf',true,'sample')):openStoredDocument(button.dataset.openId);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#library-view').hidden&&pdf)closeLibrary();});
async function openPdf(source, filename, sample = false, libraryId = sample ? 'sample' : null) {
  const token = ++loadGeneration; ++generation; ++lookupGeneration; currentWord = null; selection = null; editId = null;
  $('#status').textContent = 'Đang mở tài liệu…'; $('#paper').replaceChildren(); $('#note-input').value = ''; $('#quote').hidden = true; $('#cancel-edit').hidden=true; $('#save-note').textContent='＋ Lưu ghi chú'; $('#selection-actions').hidden = true; hideSelectionMenu();
  const old = pdf; pdf = null; if (old) await old.destroy();
  try {
    const task = getDocument(typeof source === 'string' ? {url:source} : {data:source});
    task.onPassword = (update, reason) => { const password = prompt(reason === 2 ? 'Mật khẩu chưa đúng. Nhập lại:' : 'Nhập mật khẩu PDF:'); if (password === null) task.destroy(); else update(password); };
    const loaded = await task.promise; if(token !== loadGeneration) {loaded.destroy(); return;}
    pdf = loaded; docId = pdf.fingerprints[0]; currentLibraryId=libraryId; state.books[docId] ??= {page:1, bookmarks:[]};
    if(sample){state.sampleFingerprint=docId;}else if(libraryId){state.libraryMeta??={};state.libraryMeta[libraryId]={fingerprint:docId,pages:pdf.numPages};}persist();
    pageNo = Math.max(1, Math.min(pdf.numPages, state.books[docId].page || 1)); zoom = 1;
    $('#filename').textContent = filename; $('#book-title').textContent = sample ? 'Introduction to Cosmology' : filename.replace(/\.pdf$/i,'');
    $('#book-subtitle').textContent = sample ? 'Barbara Ryden  •  English  •  PDF document' : 'Tài liệu cá nhân  •  PDF document';
    $('#sample strong').textContent=$('#book-title').textContent;$('#sample small').textContent=sample?'Barbara Ryden · PDF':'Tài liệu cá nhân · PDF';
    $('#sample .cover').innerHTML=sample?'INTRODUCTION<br>TO<br><b>COSMOLOGY</b><i>BARBARA RYDEN</i><span>✦</span>':`PDF DOCUMENT<br><b>${esc(filename.replace(/\.pdf$/i,'').slice(0,24))}</b><i>YOUR LIBRARY</i><span>▤</span>`;
    $('#page-total').textContent = `/ ${pdf.numPages}`; $('#page-number').max = pdf.numPages;
    renderLists(); await buildPages(pageNo);
  } catch(error) {if(token !== loadGeneration) return; $('#status').textContent = 'Không mở được PDF. Tệp có thể bị hỏng hoặc mật khẩu chưa đúng. Hãy mở lại tài liệu.'; console.error(error);}
}
async function buildPages(targetPage=1) {
  if(!pdf)return; const token=++generation, documentRef=pdf;
  pageObserver?.disconnect(); scrollObserver?.disconnect(); $('#paper').replaceChildren(); $('#status').textContent='Đang chuẩn bị các trang…';
  try {
    const sample=await documentRef.getPage(1); if(token!==generation)return;
    const base=sample.getViewport({scale:1}), available=Math.max(260,$('#reader').clientWidth-52), scale=Math.min(available/base.width,1.5)*zoom;
    for(let n=1;n<=documentRef.numPages;n++){
      const shell=document.createElement('section'); shell.className='pdf-page'; shell.dataset.page=n; shell.dataset.scale=scale; shell.style.width=`${base.width*scale}px`; shell.style.height=`${base.height*scale}px`; shell.setAttribute('aria-label',`Trang ${n}`); shell.innerHTML=`<span class="page-badge">${n}</span>`; $('#paper').append(shell);
    }
    pageObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)renderPage(entry.target,token);else if(entry.target.dataset.rendered){entry.target.querySelectorAll('canvas,.textLayer,.highlight').forEach(el=>el.remove());delete entry.target.dataset.rendered;}}),{root:$('#reader'),rootMargin:'1200px 0px',threshold:0});
    document.querySelectorAll('.pdf-page').forEach(el=>pageObserver.observe(el));
    scrollObserver=new IntersectionObserver(updateCurrentPage,{root:$('#reader'),rootMargin:'-35% 0px -55% 0px',threshold:0});
    document.querySelectorAll('.pdf-page').forEach(el=>scrollObserver.observe(el));
    $('#status').textContent=''; $('#zoom-label').textContent=`${Math.round(zoom*100)}%`;setCurrentPage(targetPage,true);
    requestAnimationFrame(()=>document.querySelector(`.pdf-page[data-page="${targetPage}"]`)?.scrollIntoView({block:'start'}));
  } catch(error){if(token===generation){$('#status').textContent='Không dựng được tài liệu. Hãy mở lại PDF.';console.error(error);}}
}
async function renderPage(shell,token){
  if(shell.dataset.rendering||shell.dataset.rendered||token!==generation||!pdf)return; shell.dataset.rendering='1'; const n=Number(shell.dataset.page);
  try{
    const page=await pdf.getPage(n);if(token!==generation)return;const viewport=page.getViewport({scale:Number(shell.dataset.scale)}),ratio=Math.min(devicePixelRatio||1,2);
    shell.style.width=`${viewport.width}px`;shell.style.height=`${viewport.height}px`;shell.style.setProperty('--scale-factor',viewport.scale);
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;shell.append(canvas);
    await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]}).promise;if(token!==generation)return;
    const content=await page.getTextContent();if(token!==generation)return;const layer=document.createElement('div');layer.className='textLayer';shell.append(layer);await new TextLayer({textContentSource:content,container:layer,viewport}).render();
    shell.dataset.rendered='1';drawHighlights(n);
  }catch(error){if(token===generation){shell.innerHTML=`<span class="page-error">Không thể hiển thị trang ${n}</span>`;console.error(error);}}finally{delete shell.dataset.rendering;}
}
function updateCurrentPage(entries){
  const visible=entries.filter(e=>e.isIntersecting);if(!visible.length)return;setCurrentPage(Number(visible.sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top))[0].target.dataset.page));
}
function setCurrentPage(next,force=false){if(!pdf||(!force&&next===pageNo))return;pageNo=next;$('#page-number').value=pageNo;$('#page-status').textContent=`${pageNo} / ${pdf.numPages} TRANG`;$('#progress-bar').style.width=`${pageNo/pdf.numPages*100}%`;$('#progress-text').textContent=`Trang ${pageNo} / ${pdf.numPages} · ${Math.round(pageNo/pdf.numPages*100)}%`;state.books[docId].page=pageNo;persist();updateBookmark();}
function navigate(value){if(!pdf)return;const target=Math.max(1,Math.min(pdf.numPages,Math.trunc(Number(value))||1));selection=null;$('#selection-actions').hidden=true;setCurrentPage(target,true);document.querySelector(`.pdf-page[data-page="${target}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});}
$('#page-number').onchange=e=>navigate(e.target.value);
$('#zoom-in').onclick=()=>{zoom=Math.min(2,zoom+.1);buildPages(pageNo);};$('#zoom-out').onclick=()=>{zoom=Math.max(.5,zoom-.1);buildPages(pageNo);};$('#fit').onclick=()=>{zoom=1;buildPages(pageNo);};
let resizeTimer,lastReaderWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(!pdf||Math.abs(width-lastReaderWidth)<10)return;lastReaderWidth=width;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>buildPages(pageNo),250);}).observe($('#reader'));
function updateBookmark() {$('#bookmark').textContent = state.books[docId]?.bookmarks.includes(pageNo) ? '★ Đã đánh dấu' : '☆ Đánh dấu';}
$('#bookmark').onclick = () => {if(!pdf)return; const marks=state.books[docId].bookmarks; const index=marks.indexOf(pageNo); if(index<0)marks.push(pageNo);else marks.splice(index,1);persist();updateBookmark();renderLists();};
$('#open').onclick = () => $('#file').click();
$('#file').onchange = async e => {const files=[...e.target.files],valid=files.filter(file=>file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'));e.target.value='';if(!valid.length){if(files.length)toast('Tệp đã chọn không phải PDF.');return;}try{const result=await saveDocuments(valid);const count=result.saved?.length||0;if(count)toast(`Đã lưu ${count} tài liệu vào thư mục Libaries.`);if(result.errors?.length)toast(result.errors[0]);await showLibrary();}catch(error){console.error(error);toast('Không thể lưu vào Libaries. Hãy chạy ứng dụng bằng start.ps1.');}};
$('#sample').onclick = async () => {if(currentLibraryId==='sample')openPdf('/api/library/file?name=Ryden_IntroCosmo.pdf','Ryden_IntroCosmo.pdf',true,'sample');else if(currentLibraryId)openStoredDocument(currentLibraryId);};
const selectionKey=item=>`${item.docId}:${item.page}:${item.text}:${(item.rects||[]).map(r=>`${r.x.toFixed(3)},${r.y.toFixed(3)}`).join(';')}`;
function hideSelectionMenu(){$('#selection-menu').hidden=true;}
function beginNoteFromSelection(){if(!selection)return;hideSelectionMenu();editId=null;$('#note-input').value='';$('#quote').textContent=selection.text;$('#quote').hidden=false;tab('notes');$('#note-input').focus();}
function positionSelectionMenu(rect){const menu=$('#selection-menu');menu.hidden=false;requestAnimationFrame(()=>{const left=Math.max(10,Math.min(innerWidth-menu.offsetWidth-10,rect.left+rect.width/2-menu.offsetWidth/2));const below=rect.bottom+10,top=below+menu.offsetHeight<innerHeight?below:Math.max(10,rect.top-menu.offsetHeight-10);Object.assign(menu.style,{left:`${left}px`,top:`${top}px`});});}
$('#paper').addEventListener('mouseup', () => setTimeout(() => {
  const s = window.getSelection(); if(!s || s.isCollapsed || !$('#paper').contains(s.anchorNode) || !$('#paper').contains(s.focusNode))return;
  const closestPage=node=>(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('.pdf-page');const pageElement=closestPage(s.anchorNode);if(!pageElement||pageElement!==closestPage(s.focusNode))return;const selectedPage=Number(pageElement.dataset.page);
  const text = s.toString().trim(); if(!text)return; const box = pageElement.getBoundingClientRect();
  const rects = [...s.getRangeAt(0).getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({x:(r.left-box.left)/box.width,y:(r.top-box.top)/box.height,w:r.width/box.width,h:r.height/box.height}));
  selection = {text,page:selectedPage,docId,rects}; $('#query').value = text; $('#selection-actions').hidden = false;const exists=state.highlights.some(item=>selectionKey(item)===selectionKey(selection));$('#selection-highlight').textContent=exists?'◇ Bỏ highlight':'◆ Highlight';positionSelectionMenu(s.getRangeAt(0).getBoundingClientRect());
}, 20));
$('#selection-lookup').onclick=()=>{if(!selection)return;hideSelectionMenu();tab('lookup');lookup(selection.text);};
$('#selection-note').onclick=beginNoteFromSelection;
$('#selection-close').onclick=hideSelectionMenu;
$('#selection-highlight').onclick=()=>{if(!selection)return;const key=selectionKey(selection),index=state.highlights.findIndex(item=>selectionKey(item)===key);if(index>=0){state.highlights.splice(index,1);toast('Đã bỏ highlight.');}else{state.highlights.push({...selection,id:crypto.randomUUID(),created:new Date().toISOString()});toast('Đã highlight đoạn được chọn.');}persist();drawHighlights(selection.page);hideSelectionMenu();window.getSelection()?.removeAllRanges();};
$('#selection-menu').onmousedown=e=>e.preventDefault();
$('#reader').addEventListener('scroll',hideSelectionMenu,{passive:true});
document.addEventListener('mousedown',e=>{if(!$('#selection-menu').contains(e.target)&&!$('#paper').contains(e.target))hideSelectionMenu();});
async function fetchJson(url) {const r = await fetch(url,{signal:AbortSignal.timeout(12000)}); if(!r.ok)throw new Error(`HTTP ${r.status}`); return r.json();}
async function lookup(text) {
  text = text.trim(); if(!text)return; tab('lookup'); const token=++lookupGeneration; currentWord=null;
  if(new TextEncoder().encode(text).length>500){$('#result').textContent='Hãy chọn đoạn ngắn hơn (tối đa 500 byte) để dịch. Bạn vẫn có thể ghi chú đoạn này.';return;}
  $('#result').textContent='Đang tra nghĩa và phiên âm…';
  const context={page:selection?.docId===docId?selection.page:pageNo,docId,book:$('#book-title').textContent};
  const word=normalizeWord(text), single=isSingleWord(word);
  const local=glossary[word];
  let pronunciation=null, localFailed=false;
  try {pronunciation=await localPronunciation(text);} catch {localFailed=true;}
  if(token!==lookupGeneration)return;
  if(!pronunciation && local?.ipa) pronunciation={ipa:local.ipa,accent:'Anh–Anh',source:'Từ điển chuyên ngành có sẵn'};
  // Display local IPA immediately; a slow translation service cannot hide it.
  if(pronunciation) $('#result').innerHTML=`<div class="lookup-word"><h3 class="word-title">${esc(text)}</h3><button disabled aria-label="Đang tải">♫</button></div><div class="ipa">${esc(pronunciation.ipa)}</div><p class="muted">Đang tra nghĩa…</p>`;
  const [translation,dictionary] = await Promise.allSettled([fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(single?word:text)}&langpair=en%7Cvi`),single&&!pronunciation?fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`):Promise.resolve(null)]);
  if(token!==lookupGeneration)return;
  const onlineTranslation=translation.status==='fulfilled' && Number(translation.value.responseStatus)===200 ? translation.value.responseData?.translatedText : null;
  const entry=dictionary.status==='fulfilled' && Array.isArray(dictionary.value)?dictionary.value[0]:null;
  const tr=onlineTranslation || local?.translation || null;
  const ipa=pronunciation?.ipa || onlinePronunciation(dictionary.status==='fulfilled'?dictionary.value:null);
  const ipaSource=pronunciation?`${pronunciation.accent} · ${pronunciation.source}`:ipa?'Dictionary API':'';
  const missingIpa=!single?'IPA có khi tra từng từ':localFailed?'Không tải được bộ IPA trên máy. Hãy tải lại trang.':dictionary.status==='rejected'?'Từ này chưa có trong bộ IPA trên máy; dịch vụ dự phòng đang không kết nối được.':'Chưa có IPA cho từ này trong các nguồn hiện tại.';
  currentWord={text,translation:tr||'',ipa,ipaSource,definition:entry?.meanings?.[0]?.definitions?.[0]?.definition||'',...context};
  $('#result').innerHTML=`<div class="lookup-word"><h3 class="word-title">${esc(text)}</h3><button id="speak" title="Nghe phát âm" aria-label="Nghe phát âm">♫</button></div><div class="ipa">${esc(ipa || missingIpa)}</div><p class="translation">${esc(tr || 'Chưa tìm thấy nghĩa tiếng Việt.')}</p><button id="save-word" class="primary" ${!tr&&!ipa?'disabled':''}>＋ Lưu từ</button>${!tr?'<button id="retry">Thử lại</button>':''}`;
  if($('#retry'))$('#retry').onclick=()=>lookup(text);
  $('#speak').onclick=()=>{if(!('speechSynthesis' in window)){toast('Trình duyệt chưa hỗ trợ đọc phát âm.');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=pronunciation?.accent==='Anh–Anh'?'en-GB':'en-US';u.rate=.85;speechSynthesis.speak(u);};
  $('#save-word').onclick=()=>{const existing=state.words.find(w=>normalizeWord(w.text)===word);if(existing){existing.ipa=currentWord.ipa||existing.ipa;existing.ipaSource=currentWord.ipaSource||existing.ipaSource;existing.translation=currentWord.translation||existing.translation;}else state.words.unshift({...currentWord,id:crypto.randomUUID()});persist();renderLists();toast('Đã lưu từ vựng.');};
}
$('#lookup-form').onsubmit=e=>{e.preventDefault();lookup($('#query').value);};
$('#quote-note').onclick=beginNoteFromSelection;
$('#save-note').onclick=()=>{if(!pdf){toast('Hãy mở PDF trước khi ghi chú.');return;}const text=$('#note-input').value.trim();if(!text){toast('Hãy nhập nội dung ghi chú.');return;}let affectedPage=pageNo;if(editId){const note=state.notes.find(n=>n.id===editId);if(note){note.text=text;affectedPage=note.page;}}else{const quote=!$('#quote').hidden&&selection?.docId===docId?selection:null;affectedPage=quote?.page||pageNo;state.notes.unshift({id:crypto.randomUUID(),docId,page:affectedPage,text,quote:quote?.text||'',rects:quote?.rects||[],created:new Date().toISOString()});}persist();resetNote();renderLists();drawHighlights(affectedPage);toast('Đã lưu ghi chú.');};
function resetNote(){editId=null;selection=null;$('#note-input').value='';$('#quote').hidden=true;$('#cancel-edit').hidden=true;$('#save-note').textContent='＋ Lưu ghi chú';$('#selection-actions').hidden=true;}
$('#cancel-edit').onclick=resetNote;
function drawHighlights(targetPage){const shell=document.querySelector(`.pdf-page[data-page="${targetPage}"]`);if(!shell)return;shell.querySelectorAll('.highlight').forEach(el=>el.remove());const marks=[...state.highlights.filter(item=>item.docId===docId&&item.page===targetPage).map(item=>({...item,kind:'saved'})),...state.notes.filter(item=>item.docId===docId&&item.page===targetPage&&item.rects?.length).map(item=>({...item,kind:'note'}))];for(const mark of marks){for(const r of mark.rects||[]){const el=document.createElement('div');el.className=`highlight ${mark.kind}-highlight`;Object.assign(el.style,{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.w*100}%`,height:`${r.h*100}%`});shell.append(el);}}}
function renderLists(){
  const notes=state.notes.filter(n=>n.docId===docId);$('#note-count').textContent=notes.length;$('#vocab-count').textContent=state.words.length;
  const marks=state.books[docId]?.bookmarks||[];
  $('#notes-list').innerHTML=(marks.length?`<div class="card"><small>TRANG ĐÃ ĐÁNH DẤU</small><div>${marks.map(p=>`<button data-page="${p}">★ ${p}</button>`).join('')}</div></div>`:'')+notes.map(n=>`<article class="card"><button data-page="${n.page}">Trang ${n.page} ↗</button>${n.quote?`<blockquote>${esc(n.quote)}</blockquote>`:''}<p>${esc(n.text)}</p><div class="actions"><button data-edit="${esc(n.id)}">Sửa</button><button data-delete-note="${esc(n.id)}">Xóa</button></div></article>`).join('')+(!notes.length?'<p class="muted">Chưa có ghi chú. Viết một ý tưởng, hoặc bôi đen một đoạn trong sách để bắt đầu.</p>':'');
  $('#words-list').innerHTML=state.words.map(w=>`<article class="card"><h3>${esc(w.text)}</h3><div class="ipa">${esc(w.ipa)}</div><p>${esc(w.translation)}</p><small>${esc(w.book)} · trang ${w.page}</small><div class="actions"><button data-lookup="${esc(w.id)}">Tra lại</button>${w.docId===docId?`<button data-page="${w.page}">Về trang</button>`:''}<button data-delete-word="${esc(w.id)}">Xóa</button></div></article>`).join('')||'<p class="muted">Những từ bạn lưu sẽ xuất hiện ở đây.</p>';
}
$('.inspector').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.page)navigate(b.dataset.page);if(b.dataset.deleteNote){const removed=state.notes.find(n=>n.id===b.dataset.deleteNote);state.notes=state.notes.filter(n=>n.id!==b.dataset.deleteNote);if(editId===b.dataset.deleteNote)resetNote();persist();renderLists();if(removed)drawHighlights(removed.page);}if(b.dataset.deleteWord){state.words=state.words.filter(w=>w.id!==b.dataset.deleteWord);persist();renderLists();}if(b.dataset.edit){const n=state.notes.find(n=>n.id===b.dataset.edit);editId=n.id;$('#note-input').value=n.text;$('#quote').textContent=n.quote;$('#quote').hidden=!n.quote;$('#cancel-edit').hidden=false;$('#save-note').textContent='Lưu thay đổi';$('#note-input').focus();}if(b.dataset.lookup){const w=state.words.find(w=>w.id===b.dataset.lookup);$('#query').value=w.text;lookup(w.text);}});
$('#export').onclick=()=>{const notes=state.notes.filter(n=>n.docId===docId);const words=state.words.filter(w=>w.docId===docId);const text=`# ${$('#book-title').textContent}\n\n## Ghi chú\n\n`+notes.map(n=>`### Trang ${n.page}\n${n.quote?'> '+n.quote.replaceAll('\n','\n> ')+'\n\n':''}${n.text}`).join('\n\n')+'\n\n## Từ vựng\n\n'+words.map(w=>`- **${w.text}** ${w.ipa}: ${w.translation} (trang ${w.page})`).join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='EbookStudio-notes.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
showLibrary();
