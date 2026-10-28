import {createReaderStore} from './reader-data.js';
import {glossary} from './glossary.js';
import {normalizeWord, isSingleWord, localPronunciation, onlinePronunciation} from './pronunciation.js';
import {listDocuments, getDocument as getLibraryDocument, saveDocuments, deleteDocument, loadLibraryLayout, saveLibraryLayout} from './library.js';
import {getDocument, GlobalWorkerOptions, TextLayer} from '../public/vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('../public/vendor/pdf.worker.mjs', import.meta.url).href;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readerToolbar=document.querySelector('.toolbar'),spreadButton=$('#spread');readerToolbar.insertBefore(spreadButton,readerToolbar.children[1]);
const outlineToggle=document.createElement('button');outlineToggle.id='outline-toggle';outlineToggle.disabled=true;outlineToggle.title='Tài liệu chưa có mục lục';outlineToggle.innerHTML='☰ <span>Mục lục</span>';readerToolbar.prepend(outlineToggle);
const outlineDrawer=document.createElement('aside');outlineDrawer.id='outline-drawer';outlineDrawer.hidden=true;outlineDrawer.innerHTML='<div class="outline-head"><div><span>MỤC LỤC TÀI LIỆU</span><h2>Đi đến phần</h2></div><button id="outline-close" aria-label="Đóng mục lục">×</button></div><nav id="outline-list" aria-label="Mục lục PDF"></nav>';document.querySelector('.toolbar').after(outlineDrawer);
const key = 'ebookstudio-v1';
let saved; try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
const state = saved && Array.isArray(saved.notes) && Array.isArray(saved.words) && saved.books ? saved : {notes:[], words:[], books:{}};
if(!Array.isArray(state.highlights))state.highlights=[];
if(!Array.isArray(state.libraryShelves)||!state.libraryShelves.length)state.libraryShelves=[{id:'general',name:'Chưa phân loại'}];
if(!state.libraryPlacement||typeof state.libraryPlacement!=='object')state.libraryPlacement={};
if(!Array.isArray(state.libraryOrder))state.libraryOrder=[];
let pdf, docId, pageNo = 1, zoom = 1, spreadMode = false, generation = 0, loadGeneration = 0, lookupGeneration = 0, currentWord, selection = null, editId = null, toastTimer, pageObserver, scrollObserver, coverObserver, currentLibraryId = 'sample';
const coverCache=new Map(),coverJobs=new Map();
let libraryLayoutLoaded=false,libraryLayoutTimer;
const normalizeSpreadPage = value => spreadMode && value > 1 && value % 2 === 1 ? value - 1 : value;
function updateSpreadButton(){
  $('#spread').setAttribute('aria-pressed',String(spreadMode));
  $('#spread').title=spreadMode?'Tắt chế độ ghép hai trang':'Ghép hai trang cạnh nhau';
}
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').style.display = 'none', 4000); }
const readerStore = createReaderStore(state, message => {
  toast(message);
  let status = document.querySelector('#reader-save-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'reader-save-status';
    status.setAttribute('role', 'alert');
    status.style.cssText = 'position:fixed;bottom:12px;left:12px;max-width:440px;padding:12px;background:#fff3cd;color:#664d03;z-index:10000;border-radius:8px';
    document.body.append(status);
  }
  status.textContent = message;
});
await readerStore.load();
function persist() {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  return readerStore.save().then(saved => {
    if (saved) document.querySelector('#reader-save-status')?.remove();
    return saved;
  });
}
async function hydrateLibraryLayout(){if(libraryLayoutLoaded)return;libraryLayoutLoaded=true;try{const layout=await loadLibraryLayout();if(Array.isArray(layout.shelves)&&layout.shelves.length)state.libraryShelves=layout.shelves;if(layout.placement&&typeof layout.placement==='object')state.libraryPlacement=layout.placement;if(Array.isArray(layout.order))state.libraryOrder=layout.order;persist();}catch(error){console.warn('Dùng bố cục thư viện trong trình duyệt vì chưa đọc được library.json.',error);}}
function persistLibraryLayout(){persist();clearTimeout(libraryLayoutTimer);libraryLayoutTimer=setTimeout(()=>saveLibraryLayout({version:1,shelves:state.libraryShelves,placement:state.libraryPlacement,order:state.libraryOrder,updatedAt:new Date().toISOString()}).catch(error=>{console.error(error);toast('Chưa thể lưu cách sắp xếp vào Libaries/library.json.');}),180);}
function tab(name) { document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== name); document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('selected', b.dataset.tab === name)); renderLists(); }
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
$('#notes-nav').onclick = () => tab('notes'); $('#vocab-nav').onclick = () => tab('words'); $('#library').onclick = showLibrary;
$('#reader-library').onclick=showLibrary;
function setFocus(active){document.body.classList.toggle('focused',active);$('#focus').setAttribute('aria-pressed',String(active));$('#focus').title=active?'Thoát chế độ tập trung':'Mở chế độ tập trung';$('#focus span').textContent=active?'Thoát tập trung':'Tập trung';}
$('#focus').onclick = () => setFocus(!document.body.classList.contains('focused'));
const formatBytes = bytes => bytes < 1048576 ? `${Math.max(1,Math.round(bytes/1024))} KB` : `${(bytes/1048576).toFixed(1)} MB`;
const librarySearchKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();
function filterLibrary(value){const query=librarySearchKey(value),cards=[...document.querySelectorAll('.library-card[data-library-name]')];let visible=0;for(const card of cards){card.hidden=!!query&&!card.dataset.libraryName.includes(query);if(!card.hidden)visible++;}document.querySelectorAll('.library-shelf').forEach(shelf=>{const matches=[...shelf.querySelectorAll('.library-card[data-library-name]')].some(card=>!card.hidden);shelf.hidden=!!query&&!matches;});const add=$('#library-empty-add');if(add)add.hidden=!!query;$('#library-no-results').hidden=!query||visible>0;}
async function makeCover(id){if(coverCache.has(id))return coverCache.get(id);if(coverJobs.has(id))return coverJobs.get(id);const job=(async()=>{let documentRef;try{const name=id==='sample'?'Ryden_IntroCosmo.pdf':id,task=getDocument({url:`/api/library/file?name=${encodeURIComponent(name)}`});documentRef=await task.promise;const page=await documentRef.getPage(1),base=page.getViewport({scale:1}),scale=Math.min(420/base.width,560/base.height),viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport}).promise;const url=canvas.toDataURL('image/webp',.82);coverCache.set(id,url);return url;}finally{coverJobs.delete(id);await documentRef?.destroy();}})();coverJobs.set(id,job);return job;}
async function showCover(image){const id=image.dataset.coverId;try{image.src=await makeCover(id);if(!image.isConnected)return;image.hidden=false;image.closest('.library-cover')?.classList.add('has-preview');}catch(error){console.warn(`Không thể tạo bìa cho ${id}`,error);}}
function observeLibraryCovers(){coverObserver?.disconnect();coverObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;coverObserver.unobserve(entry.target);showCover(entry.target);}),{root:$('#library-view'),rootMargin:'500px 0px'});document.querySelectorAll('.library-cover-image').forEach(image=>{image.hidden=false;if(coverCache.has(image.dataset.coverId))showCover(image);else coverObserver.observe(image);});}
const progressFor = (fingerprint, pages) => {
  if(!fingerprint)return {current:0,total:pages||1,percent:0};
  const current=fingerprint&&state.books[fingerprint]?.page||1,total=pages||1;
  return {current,total,percent:Math.max(0,Math.min(100,Math.round(current/total*100)))};
};
async function resolveOutline(items,documentRef){return Promise.all((items||[]).map(async item=>{let destination=item.dest,page=null;try{if(typeof destination==='string')destination=await documentRef.getDestination(destination);if(Array.isArray(destination)){const reference=destination[0];page=typeof reference==='number'?reference+1:(await documentRef.getPageIndex(reference))+1;}}catch{}return {title:item.title||'Không có tiêu đề',page,items:await resolveOutline(item.items,documentRef)};}));}
const outlineHtml=(items,depth=0)=>items.map(item=>`<div class="outline-item" style="--depth:${depth}"><button ${item.page?`data-outline-page="${item.page}"`: 'disabled'} title="${esc(item.title)}"><span>${esc(item.title)}</span>${item.page?`<small>${item.page}</small>`:''}</button>${item.items.length?outlineHtml(item.items,depth+1):''}</div>`).join('');
async function renderPdfOutline(token){outlineToggle.disabled=true;outlineToggle.title='Đang đọc mục lục…';outlineDrawer.hidden=true;$('#outline-list').innerHTML='<p>Đang đọc mục lục…</p>';try{const documentRef=pdf,raw=await documentRef.getOutline();if(token!==loadGeneration||documentRef!==pdf)return;if(!raw?.length){outlineToggle.title='PDF này không có mục lục heading';$('#outline-list').innerHTML='<p>PDF này không cung cấp mục lục.</p>';return;}const items=await resolveOutline(raw,documentRef);if(token!==loadGeneration||documentRef!==pdf)return;$('#outline-list').innerHTML=outlineHtml(items);outlineToggle.disabled=false;outlineToggle.title='Mở mục lục tài liệu';}catch(error){if(token===loadGeneration){outlineToggle.title='Không thể đọc mục lục PDF';$('#outline-list').innerHTML='<p>Không thể đọc mục lục tài liệu.</p>';console.error(error);}}}
outlineToggle.onclick=()=>{if(outlineToggle.disabled)return;outlineDrawer.hidden=!outlineDrawer.hidden;outlineToggle.setAttribute('aria-pressed',String(!outlineDrawer.hidden));};
$('#outline-close').onclick=()=>{outlineDrawer.hidden=true;outlineToggle.setAttribute('aria-pressed','false');};
$('#outline-list').onclick=e=>{const button=e.target.closest('[data-outline-page]');if(!button)return;navigate(button.dataset.outlinePage);outlineDrawer.hidden=true;outlineToggle.setAttribute('aria-pressed','false');};
async function renderLibrary(){
  const grid=$('#library-grid');grid.innerHTML='<p class="library-loading">Đang mở thư viện…</p>';
  try{
    await hydrateLibraryLayout();
    const documents=await listDocuments();
    $('#library-count').textContent=String(documents.length).padStart(2,'0');
    const sampleProgress=progressFor(state.sampleFingerprint,301);
    const items=[...documents];
    const known=new Set(items.map(item=>item.id));state.libraryOrder=state.libraryOrder.filter(id=>known.has(id));
    for(const item of items)if(!state.libraryOrder.includes(item.id))state.libraryOrder.push(item.id);
    const shelfIds=new Set(state.libraryShelves.map(shelf=>shelf.id));for(const id of Object.keys(state.libraryPlacement))if(!known.has(id)||!shelfIds.has(state.libraryPlacement[id]))delete state.libraryPlacement[id];
    state.libraryShelves=[...state.libraryShelves.filter(shelf=>shelf.id!=='general'),state.libraryShelves.find(shelf=>shelf.id==='general')||{id:'general',name:'Chưa phân loại'}];
    persistLibraryLayout();
    const options=state.libraryShelves.map(shelf=>`<option value="${esc(shelf.id)}">${esc(shelf.name)}</option>`).join('');
    const withoutTopicSelect=html=>html.replace(/<select data-move-id="[^"]+" aria-label="Chủ đề">.*?<\/select>/,'');
    const cardFor=(item,index)=>{const shelf=state.libraryPlacement[item.id]||'general';if(item.sample)return `<article class="library-card sample-card" draggable="true" data-doc-id="sample" data-library-name="${esc(librarySearchKey('Introduction to Cosmology Barbara Ryden'))}"><button class="library-open" data-open-id="sample"><div class="library-cover"><img class="library-cover-image" data-cover-id="sample" alt="Bìa Introduction to Cosmology" hidden><span>INTRODUCTION TO</span><strong>COSMOLOGY</strong><i>BARBARA RYDEN</i><b>✦</b></div><div class="library-meta"><h3>Introduction to Cosmology</h3><p>Barbara Ryden · 301 trang</p><div class="library-progress"><span style="width:${sampleProgress.percent}%"></span></div><small>Trang ${sampleProgress.current} · ${sampleProgress.percent}%</small></div></button><div class="library-card-actions"><span class="drag-hint" title="Kéo để sắp xếp">⠿</span><select data-move-id="sample" aria-label="Chủ đề">${options}</select></div></article>`.replace(`value="${esc(shelf)}"`,`value="${esc(shelf)}" selected`);const metadata=state.libraryMeta?.[item.id]||{},progress=progressFor(metadata.fingerprint,metadata.pages);return `<article class="library-card tone-${index%4}" draggable="true" data-doc-id="${esc(item.id)}" data-library-name="${esc(librarySearchKey(item.name))}"><button class="library-open" data-open-id="${esc(item.id)}"><div class="library-cover"><img class="library-cover-image" data-cover-id="${esc(item.id)}" alt="Bìa ${esc(item.name.replace(/\.pdf$/i,''))}" hidden><span>PDF DOCUMENT</span><strong>${esc(item.name.replace(/\.pdf$/i,'').slice(0,32))}</strong><i>${formatBytes(item.size)}</i><b>▤</b></div><div class="library-meta"><h3>${esc(item.name.replace(/\.pdf$/i,''))}</h3><p>${metadata.pages?`${metadata.pages} trang · `:''}${formatBytes(item.size)}</p><div class="library-progress"><span style="width:${progress.percent}%"></span></div><small>${metadata.fingerprint?`Trang ${progress.current} · ${progress.percent}%`:'Chưa đọc'}</small></div></button><div class="library-card-actions"><span class="drag-hint" title="Kéo để sắp xếp">⠿</span><select data-move-id="${esc(item.id)}" aria-label="Chủ đề">${options}</select><button class="library-delete" data-delete-id="${esc(item.id)}" title="Xóa tài liệu">×</button></div></article>`.replace(`value="${esc(shelf)}"`,`value="${esc(shelf)}" selected`);};
    const ordered=state.libraryOrder.map(id=>items.find(item=>item.id===id)).filter(Boolean);
    grid.innerHTML=state.libraryShelves.map(shelf=>{const shelfItems=ordered.filter(item=>(state.libraryPlacement[item.id]||'general')===shelf.id);return `<section class="library-shelf" data-shelf-card="${esc(shelf.id)}"><div class="library-shelf-head"><div>${shelf.id!=='general'?`<button class="shelf-drag" draggable="true" data-shelf-drag="${esc(shelf.id)}" title="Kéo để sắp xếp chủ đề">⠿</button>`:''}<h3>${esc(shelf.name)}</h3></div><span>${shelfItems.length} tài liệu</span></div><div class="library-shelf-grid" data-shelf-drop="${esc(shelf.id)}">${shelfItems.map((item,index)=>withoutTopicSelect(cardFor(item,index))).join('')||'<p class="library-empty-shelf">Kéo tài liệu vào chủ đề này</p>'}${shelf.id==='general'?`<button class="library-add-card" id="library-empty-add"><span>＋</span><strong>Thêm tài liệu</strong><small>PDF từ máy của bạn</small></button>`:''}</div></section>`}).join('');
    $('#library-empty-add').onclick=()=>$('#file').click();
    filterLibrary($('#library-search').value);
    observeLibraryCovers();
  }catch(error){console.error(error);grid.innerHTML='<p class="library-loading">Không thể kết nối với thư mục Libaries. Hãy chạy ứng dụng bằng start.ps1.</p>';$('#library-count').textContent='00';}
}
async function showLibrary(){setFocus(false);outlineDrawer.hidden=true;$('#library-view').hidden=false;$('#library-close').hidden=!pdf;document.body.classList.add('library-opened');await renderLibrary();}
function closeLibrary(force=false){if(!pdf&&!force)return;$('#library-view').hidden=true;document.body.classList.remove('library-opened');}
async function openStoredDocument(id){
  try{const document=await getLibraryDocument(id);if(!document)throw new Error('Missing document');closeLibrary(true);await openPdf(new Uint8Array(await document.file.arrayBuffer()),document.name,false,id);}
  catch(error){console.error(error);toast('Không thể mở tài liệu đã lưu.');}
}
$('#library-add').onclick=()=>$('#file').click();$('#library-close').onclick=closeLibrary;
$('#library-search').oninput=e=>filterLibrary(e.target.value);
function closeTopicDialog(){$('#topic-dialog').hidden=true;$('#topic-form').reset();}
$('#library-topic').onclick=()=>{$('#topic-dialog').hidden=false;requestAnimationFrame(()=>$('#topic-name').focus());};
$('#topic-cancel').onclick=closeTopicDialog;
$('#topic-dialog').onclick=e=>{if(e.target===$('#topic-dialog'))closeTopicDialog();};
$('#topic-form').onsubmit=e=>{e.preventDefault();const name=$('#topic-name').value.trim();if(!name)return;if(state.libraryShelves.some(shelf=>shelf.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('Chủ đề này đã tồn tại.');return;}const general=state.libraryShelves.pop();state.libraryShelves.push({id:crypto.randomUUID(),name:name.slice(0,60)},general);persistLibraryLayout();closeTopicDialog();renderLibrary();};
$('#library-grid').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-id]');if(!button)return;e.stopPropagation();const id=button.dataset.deleteId;if(!confirm(`Xóa "${id}" khỏi thư viện? Tệp có thể khôi phục từ Libaries/.Trash.`))return;button.disabled=true;try{await deleteDocument(id);state.libraryOrder=state.libraryOrder.filter(item=>item!==id);delete state.libraryPlacement[id];if(state.libraryMeta)delete state.libraryMeta[id];persistLibraryLayout();await renderLibrary();toast('Đã chuyển tài liệu vào Libaries/.Trash.');}catch(error){console.error(error);button.disabled=false;toast(error.message||'Không thể xóa tài liệu.');}});
$('#library-grid').addEventListener('dragstart',e=>{const handle=e.target.closest('[data-shelf-drag]');if(handle){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-ebook-shelf',handle.dataset.shelfDrag);handle.closest('[data-shelf-card]').classList.add('dragging-shelf');return;}const card=e.target.closest('[data-doc-id]');if(!card)return;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-ebook-document',card.dataset.docId);card.classList.add('dragging');});
$('#library-grid').addEventListener('dragend',e=>{e.target.closest('[data-doc-id]')?.classList.remove('dragging');e.target.closest('[data-shelf-card]')?.classList.remove('dragging-shelf');});
$('#library-grid').addEventListener('dragover',e=>{if(!e.target.closest('[data-shelf-drop],[data-shelf-card]'))return;e.preventDefault();e.dataTransfer.dropEffect='move';});
$('#library-grid').addEventListener('drop',e=>{const shelfId=e.dataTransfer.getData('application/x-ebook-shelf'),targetShelf=e.target.closest('[data-shelf-card]');if(shelfId&&targetShelf){e.preventDefault();const targetId=targetShelf.dataset.shelfCard;if(targetId===shelfId)return;const moving=state.libraryShelves.find(shelf=>shelf.id===shelfId);if(!moving||moving.id==='general')return;state.libraryShelves=state.libraryShelves.filter(shelf=>shelf.id!==shelfId);const index=targetId==='general'?state.libraryShelves.length-1:state.libraryShelves.findIndex(shelf=>shelf.id===targetId);state.libraryShelves.splice(Math.max(0,index),0,moving);persistLibraryLayout();renderLibrary();return;}const zone=e.target.closest('[data-shelf-drop]');if(!zone)return;e.preventDefault();const id=e.dataTransfer.getData('application/x-ebook-document');if(!state.libraryOrder.includes(id))return;const target=e.target.closest('[data-doc-id]');state.libraryPlacement[id]=zone.dataset.shelfDrop;state.libraryOrder=state.libraryOrder.filter(item=>item!==id);if(target&&target.dataset.docId!==id){const index=state.libraryOrder.indexOf(target.dataset.docId);state.libraryOrder.splice(index<0?state.libraryOrder.length:index,0,id);}else{const sameShelf=state.libraryOrder.filter(item=>(state.libraryPlacement[item]||'general')===zone.dataset.shelfDrop),last=sameShelf.at(-1),index=last?state.libraryOrder.indexOf(last)+1:state.libraryOrder.length;state.libraryOrder.splice(index,0,id);}persistLibraryLayout();renderLibrary();});
$('#library-view').onclick=e=>{if(e.target===$('#library-view')&&pdf)closeLibrary();const button=e.target.closest('[data-open-id]');if(!button)return;button.dataset.openId==='sample'?(closeLibrary(true),openPdf('/api/library/file?name=Ryden_IntroCosmo.pdf','Ryden_IntroCosmo.pdf',true,'sample')):openStoredDocument(button.dataset.openId);};
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('#topic-dialog').hidden){closeTopicDialog();return;}if(!$('#library-view').hidden&&pdf)closeLibrary();});
async function openPdf(source, filename, sample = false, libraryId = sample ? 'sample' : null) {
  const token = ++loadGeneration; ++generation; ++lookupGeneration; currentWord = null; selection = null; editId = null;
  outlineDrawer.hidden=true;outlineToggle.disabled=true;outlineToggle.setAttribute('aria-pressed','false');outlineToggle.title='Đang đọc mục lục…';
  $('#status').textContent = 'Đang mở tài liệu…'; $('#paper').replaceChildren(); $('#note-input').value = ''; $('#quote').hidden = true; $('#cancel-edit').hidden=true; $('#save-note').textContent='＋ Lưu ghi chú'; $('#selection-actions').hidden = true; hideSelectionMenu();
  const old = pdf; pdf = null; if (old) await old.destroy();
  try {
    const task = getDocument(typeof source === 'string' ? {url:source} : {data:source});
    task.onPassword = (update, reason) => { const password = prompt(reason === 2 ? 'Mật khẩu chưa đúng. Nhập lại:' : 'Nhập mật khẩu PDF:'); if (password === null) task.destroy(); else update(password); };
    const loaded = await task.promise; if(token !== loadGeneration) {loaded.destroy(); return;}
    pdf = loaded; docId = pdf.fingerprints[0]; currentLibraryId=libraryId; state.books[docId] ??= {page:1, bookmarks:[]};
    if(sample){state.sampleFingerprint=docId;}else if(libraryId){state.libraryMeta??={};state.libraryMeta[libraryId]={fingerprint:docId,pages:pdf.numPages};}persist();
    pageNo = Math.max(1, Math.min(pdf.numPages, state.books[docId].page || 1)); zoom = 1;
    spreadMode = filename.toLowerCase() === 'daihatsu gensets engine catalog.pdf'; updateSpreadButton();
    $('#book-title').textContent = sample ? 'Introduction to Cosmology' : filename.replace(/\.pdf$/i,'');
    $('#book-subtitle').textContent = sample ? 'Barbara Ryden  •  English  •  PDF document' : 'Tài liệu cá nhân  •  PDF document';
    $('#sample strong').textContent=$('#book-title').textContent;$('#sample small').textContent=sample?'Barbara Ryden · PDF':'Tài liệu cá nhân · PDF';
    $('#sample .cover').innerHTML=sample?'INTRODUCTION<br>TO<br><b>COSMOLOGY</b><i>BARBARA RYDEN</i><span>✦</span>':`PDF DOCUMENT<br><b>${esc(filename.replace(/\.pdf$/i,'').slice(0,24))}</b><i>YOUR LIBRARY</i><span>▤</span>`;
    $('#page-total').textContent = `/ ${pdf.numPages}`; $('#page-number').max = pdf.numPages;
    renderPdfOutline(token);renderLists();await buildPages(pageNo);
  } catch(error) {if(token !== loadGeneration) return; $('#status').textContent = 'Không mở được PDF. Tệp có thể bị hỏng hoặc mật khẩu chưa đúng. Hãy mở lại tài liệu.'; console.error(error);}
}
async function buildPages(targetPage=1,preservePosition=false) {
  if(!pdf)return; const token=++generation, documentRef=pdf,reader=$('#reader'),paper=$('#paper');
  const oldShell=document.querySelector(`.pdf-page[data-page="${targetPage}"]`),readerRect=reader.getBoundingClientRect();
  const oldRect=oldShell?.getBoundingClientRect(),anchor=preservePosition&&oldRect?{
    x:Math.max(0,Math.min(1,(readerRect.left+reader.clientWidth/2-oldRect.left)/oldRect.width)),
    y:Math.max(0,Math.min(1,(readerRect.top+reader.clientHeight/2-oldRect.top)/oldRect.height))
  }:null;
  try {
    const sample=await documentRef.getPage(1); if(token!==generation)return;
    const base=sample.getViewport({scale:1}), available=Math.max(260,$('#reader').clientWidth-52), gap=14;
    const pageWidth=spreadMode?(available-gap)/2:available, scale=Math.min(pageWidth/base.width,1.5)*zoom;
    pageObserver?.disconnect(); scrollObserver?.disconnect(); paper.replaceChildren(); $('#status').textContent='Đang chuẩn bị các trang…';
    paper.style.width=`${base.width*scale*(spreadMode?2:1)+(spreadMode?gap:0)}px`;paper.style.minWidth='100%';
    let spread;
    for(let n=1;n<=documentRef.numPages;n++){
      if(!spreadMode || n===1 || n%2===0){spread=document.createElement('div');spread.className=`pdf-spread ${!spreadMode||n===1?'single-spread':''}`;spread.setAttribute('role','group');spread.setAttribute('aria-label',spreadMode&&n>1?`Trang ${n} và ${Math.min(n+1,documentRef.numPages)}`:`Trang ${n}`);$('#paper').append(spread);}
      const shell=document.createElement('section'); shell.className='pdf-page'; shell.dataset.page=n; shell.dataset.scale=scale; shell.style.width=`${base.width*scale}px`; shell.style.height=`${base.height*scale}px`; shell.setAttribute('aria-label',`Trang ${n}`); shell.innerHTML=`<span class="page-badge">${n}</span>`; spread.append(shell);
    }
    pageObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)renderPage(entry.target,token);else if(entry.target.dataset.rendered){entry.target.querySelectorAll('canvas,.textLayer,.highlight').forEach(el=>el.remove());delete entry.target.dataset.rendered;}}),{root:$('#reader'),rootMargin:'1200px 0px',threshold:0});
    document.querySelectorAll('.pdf-page').forEach(el=>pageObserver.observe(el));
    scrollObserver=new IntersectionObserver(updateCurrentPage,{root:$('#reader'),rootMargin:'-35% 0px -55% 0px',threshold:0});
    document.querySelectorAll('.pdf-page').forEach(el=>scrollObserver.observe(el));
    $('#status').textContent=''; $('#zoom-label').textContent=`${Math.round(zoom*100)}%`;setCurrentPage(targetPage,true);
    const target=document.querySelector(`.pdf-page[data-page="${targetPage}"]`),freshReaderRect=reader.getBoundingClientRect(),targetRect=target?.getBoundingClientRect();
    if(targetRect){
      if(anchor){reader.scrollLeft+=targetRect.left+anchor.x*targetRect.width-(freshReaderRect.left+reader.clientWidth/2);reader.scrollTop+=targetRect.top+anchor.y*targetRect.height-(freshReaderRect.top+reader.clientHeight/2);}
      else reader.scrollTop+=targetRect.top-freshReaderRect.top-10;
    }
    reader.classList.toggle('pannable',reader.scrollWidth>reader.clientWidth+2);
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
  const visible=entries.filter(e=>e.isIntersecting);if(!visible.length)return;setCurrentPage(normalizeSpreadPage(Number(visible.sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top))[0].target.dataset.page)));
}
function setCurrentPage(next,force=false){if(!pdf)return;next=normalizeSpreadPage(next);if(!force&&next===pageNo)return;pageNo=next;const last=spreadMode&&pageNo>1?Math.min(pageNo+1,pdf.numPages):pageNo,shown=last>pageNo?`${pageNo}–${last}`:`${pageNo}`;$('#page-number').value=pageNo;$('#page-status').textContent=`${shown} / ${pdf.numPages} TRANG`;$('#progress-bar').style.width=`${last/pdf.numPages*100}%`;$('#progress-text').textContent=`Trang ${shown} / ${pdf.numPages} · ${Math.round(last/pdf.numPages*100)}%`;$('#prev-page').disabled=pageNo<=1;$('#next-page').disabled=last>=pdf.numPages;state.books[docId].page=pageNo;persist();updateBookmark();}
function navigate(value){if(!pdf)return;const target=Math.max(1,Math.min(pdf.numPages,Math.trunc(Number(value))||1));selection=null;$('#selection-actions').hidden=true;setCurrentPage(target,true);document.querySelector(`.pdf-page[data-page="${target}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});}
$('#page-number').onchange=e=>navigate(e.target.value);
function navigateRelative(direction){if(!pdf)return;const target=spreadMode?(direction>0?(pageNo===1?2:pageNo+2):(pageNo<=2?1:pageNo-2)):pageNo+direction;navigate(target);}
$('#prev-page').onclick=()=>navigateRelative(-1);$('#next-page').onclick=()=>navigateRelative(1);
$('#reader').addEventListener('keydown',e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();navigateRelative(e.key==='ArrowLeft'?-1:1);});
$('#zoom-in').onclick=()=>{zoom=Math.min(2,zoom+.1);buildPages(pageNo,true);};$('#zoom-out').onclick=()=>{zoom=Math.max(.5,zoom-.1);buildPages(pageNo,true);};$('#fit').onclick=()=>{zoom=1;buildPages(pageNo,true);};
$('#spread').onclick=()=>{spreadMode=!spreadMode;pageNo=normalizeSpreadPage(pageNo);updateSpreadButton();buildPages(pageNo);};
let resizeTimer,lastReaderWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(!pdf||Math.abs(width-lastReaderWidth)<10)return;lastReaderWidth=width;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>buildPages(pageNo,true),250);}).observe($('#reader'));
let panStart=null;
$('#reader').addEventListener('pointerdown',e=>{const reader=$('#reader');if(e.button!==0||!reader.classList.contains('pannable')||e.target.closest('.textLayer span'))return;panStart={id:e.pointerId,x:e.clientX,y:e.clientY,left:reader.scrollLeft,top:reader.scrollTop};reader.setPointerCapture(e.pointerId);reader.classList.add('is-panning');e.preventDefault();});
$('#reader').addEventListener('pointermove',e=>{if(!panStart||e.pointerId!==panStart.id)return;const reader=$('#reader');reader.scrollLeft=panStart.left-(e.clientX-panStart.x);reader.scrollTop=panStart.top-(e.clientY-panStart.y);e.preventDefault();});
const stopPan=e=>{if(!panStart||e.pointerId!==panStart.id)return;$('#reader').classList.remove('is-panning');panStart=null;};
$('#reader').addEventListener('pointerup',stopPan);$('#reader').addEventListener('pointercancel',stopPan);
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
  selection = {text,page:selectedPage,docId,rects}; $('#query').value = text; $('#selection-actions').hidden = false;const exists=state.highlights.some(item=>selectionKey(item)===selectionKey(selection));$('#selection-highlight').textContent=exists?'◇ Bỏ highlight':'◆ Highlight';positionSelectionMenu(s.getRangeAt(0).getBoundingClientRect());lookup(text);
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
  $('#save-word').onclick=async()=>{const existing=state.words.find(w=>normalizeWord(w.text)===word);if(existing){existing.ipa=currentWord.ipa||existing.ipa;existing.ipaSource=currentWord.ipaSource||existing.ipaSource;existing.translation=currentWord.translation||existing.translation;}else state.words.unshift({...currentWord,id:crypto.randomUUID()});const stored=await persist();renderLists();if(stored)toast('Đã lưu từ vựng.');};
}
$('#lookup-form').onsubmit=e=>{e.preventDefault();lookup($('#query').value);};
$('#quote-note').onclick=beginNoteFromSelection;
$('#save-note').onclick=async()=>{if(!pdf){toast('Hãy mở PDF trước khi ghi chú.');return;}const text=$('#note-input').value.trim();if(!text){toast('Hãy nhập nội dung ghi chú.');return;}let affectedPage=pageNo;if(editId){const note=state.notes.find(n=>n.id===editId);if(note){note.text=text;affectedPage=note.page;}}else{const quote=!$('#quote').hidden&&selection?.docId===docId?selection:null;affectedPage=quote?.page||pageNo;state.notes.unshift({id:crypto.randomUUID(),docId,page:affectedPage,text,quote:quote?.text||'',rects:quote?.rects||[],created:new Date().toISOString()});}const stored=await persist();resetNote();renderLists();drawHighlights(affectedPage);if(stored)toast('Đã lưu ghi chú.');};
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
