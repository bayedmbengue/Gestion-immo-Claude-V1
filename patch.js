const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// 1. Add sortSearch functions right before openSortie
const sortSearchFns = `
// ── RECHERCHE IMMO dans modal sortie ──
let _sortSearchIdx=-1;
function sortSearchInput(){
  _sortSearchIdx=-1;
  const q=(document.getElementById('so1-search').value||'').toLowerCase().trim();
  const list=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const results=q?list.filter(im=>
    im.code.toLowerCase().includes(q)||
    im.designation.toLowerCase().includes(q)||
    (im.categorie||'').toLowerCase().includes(q)
  ):list;
  sortRenderDropdown(results,q);
}
function sortRenderDropdown(results,q){
  const dd=document.getElementById('so1-dropdown');
  const listEl=document.getElementById('so1-list');
  if(!results.length){
    listEl.innerHTML='<div style="padding:12px 14px;font-size:13px;color:var(--text3);text-align:center">Aucune immobilisation trouvée</div>';
    dd.style.display='block';return;
  }
  const hl=(txt,q)=>{
    if(!q)return txt;
    const i=txt.toLowerCase().indexOf(q.toLowerCase());
    if(i<0)return txt;
    return txt.slice(0,i)+'<mark style="background:#FEF3C7;border-radius:2px;padding:0 1px">'+txt.slice(i,i+q.length)+'</mark>'+txt.slice(i+q.length);
  };
  listEl.innerHTML=results.map((im,idx)=>{
    return'<div class="aff-item" data-idx="'+idx+'" onclick="sortSelectImmo(\\''+im.id+'\\')" onmouseenter="sortHoverItem('+idx+')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="font-size:11px;color:var(--blue);background:var(--blue-light);padding:1px 6px;border-radius:4px">'+hl(im.code,q)+'</code><span class="badge '+CC(im.categorie)+'" style="font-size:10px">'+im.categorie+'</span></div><div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+hl(im.designation,q)+'</div></div></div>';
  }).join('');
  dd.style.display='block';
}
function sortSearchOpen(){
  if(!document.getElementById('so1').value) sortSearchInput();
}
function sortSearchKey(e){
  const items=document.getElementById('so1-list').querySelectorAll('.aff-item');
  if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_sortSearchIdx=Math.min(_sortSearchIdx+1,items.length-1);sortHighlight();}
  else if(e.key==='ArrowUp'){e.preventDefault();_sortSearchIdx=Math.max(_sortSearchIdx-1,0);sortHighlight();}
  else if(e.key==='Enter'){e.preventDefault();if(_sortSearchIdx>=0)items[_sortSearchIdx].click();}
  else if(e.key==='Escape'){sortSearchClose();}
}
function sortHighlight(){
  const items=document.getElementById('so1-list').querySelectorAll('.aff-item');
  items.forEach((el,i)=>el.style.background=i===_sortSearchIdx?'var(--blue-light)':'');
  if(items[_sortSearchIdx])items[_sortSearchIdx].scrollIntoView({block:'nearest'});
}
function sortHoverItem(idx){_sortSearchIdx=idx;sortHighlight();}
function sortSelectImmo(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  document.getElementById('so1').value=id;
  document.getElementById('so1-search').value=im.code+' — '+im.designation;
  document.getElementById('so1-dropdown').style.display='none';
  const prev=document.getElementById('so1-preview');
  prev.style.display='block';
  prev.innerHTML='<div><strong>'+im.designation+'</strong><br>Catégorie : '+im.categorie+'</div>';
  calcSort();
}
function sortSearchClear(){
  document.getElementById('so1-search').value='';
  document.getElementById('so1').value='';
  document.getElementById('so1-preview').style.display='none';
  document.getElementById('so1-dropdown').style.display='none';
  document.getElementById('so1-search').focus();
  calcSort();
}
function sortSearchClose(){document.getElementById('so1-dropdown').style.display='none';}

`;
code = code.replace('function openSortie(', sortSearchFns + 'function openSortie(');

// 2. Update popSortSel and openSortie
code = code.replace('function popSortSel(){\n  document.getElementById(\'so1\').innerHTML=DB.immobilisations.filter(i=>i.statut!==\'sorti\').map(im=>`<option value="\${im.id}">\\ — \\</option>`).join(\'\');\n}', 'function popSortSel(){}');
// Note: We're replacing it with a no-op just to satisfy calls in rdSorties without deleting them.

code = code.replace(
  'function openSortie(immoId, asPending){\n  popSortSel();\n  if(immoId)document.getElementById(\'so1\').value=immoId;\n  document.getElementById(\'so3\').value=TD();document.getElementById(\'so4\').value=\'\';document.getElementById(\'so5\').value=\'\';document.getElementById(\'so6\').value=\'\';',
  'function openSortie(immoId, asPending){\n  delete document.getElementById(\'m-sort\').dataset.editId;\n  sortSearchClear();\n  if(immoId) sortSelectImmo(immoId);\n  document.getElementById(\'so3\').value=TD();document.getElementById(\'so4\').value=\'\';document.getElementById(\'so5\').value=\'\';document.getElementById(\'so6\').value=\'\';'
);

// 3. Update saveSort to support editId
const oldSaveSort = \`function saveSort(){
  if(!guardWrite())return;
  const id=document.getElementById('so1').value;const date=document.getElementById('so3').value;
  if(!id||!date){toast('Champs obligatoires','e');return;}
  const im=DB.immobilisations.find(x=>x.id===id);
  const cum=cumAt(im,date);const dc=dotComp(im,date);const vnc=Math.max(0,im.vo-cum-dc);
  const prix=+document.getElementById('so4').value||0;const motif=document.getElementById('so2').value;
  const pendEl=document.getElementById('so-pending-flag');
  const isPending = pendEl && pendEl.checked;
  const sortieObj={id:'s'+Date.now(),immoId:id,code:im.code,designation:im.designation,motif,date,vo:im.vo,cum,dc,vnc,prix,acheteur:document.getElementById('so5').value,obs:document.getElementById('so6').value,statut:isPending?'attente':'validee'};
  DB.sorties.push(sortieObj);
  if(!isPending){ im.statut='sorti'; }
  dbSave();closeM('m-sort');rdSorties();rdFiches();rdDash();
  toast(isPending?'Sortie soumise — en attente de validation':'Sortie enregistrée et validée');
}\`;

const newSaveSort = \`function saveSort(){
  if(!guardWrite())return;
  const editId=document.getElementById('m-sort').dataset.editId;
  const id=document.getElementById('so1').value;const date=document.getElementById('so3').value;
  if(!id||!date){toast('Champs obligatoires','e');return;}
  const im=DB.immobilisations.find(x=>x.id===id);
  const cum=cumAt(im,date);const dc=dotComp(im,date);const vnc=Math.max(0,im.vo-cum-dc);
  const prix=+document.getElementById('so4').value||0;const motif=document.getElementById('so2').value;
  const pendEl=document.getElementById('so-pending-flag');
  const isPending = pendEl && pendEl.checked;
  
  if(editId){
    const s=DB.sorties.find(x=>x.id===editId);
    if(s){
      s.immoId=id;s.code=im.code;s.designation=im.designation;
      s.motif=motif;s.date=date;s.vo=im.vo;s.cum=cum;s.dc=dc;s.vnc=vnc;
      s.prix=prix;s.acheteur=document.getElementById('so5').value;s.obs=document.getElementById('so6').value;
      s.statut=isPending?'attente':'validee';
    }
  }else{
    const sortieObj={id:'s'+Date.now(),immoId:id,code:im.code,designation:im.designation,motif,date,vo:im.vo,cum,dc,vnc,prix,acheteur:document.getElementById('so5').value,obs:document.getElementById('so6').value,statut:isPending?'attente':'validee'};
    DB.sorties.push(sortieObj);
  }
  if(!isPending && im){ im.statut='sorti'; }
  dbSave();closeM('m-sort');rdSorties();rdFiches();rdDash();
  toast(editId?(isPending?'Sortie modifiée (en attente)':'Sortie modifiée'):(isPending?'Sortie soumise — en attente de validation':'Sortie enregistrée et validée'));
}
function editSort(id){
  if(!guardWrite())return;
  const s = DB.sorties.find(x=>x.id===id);
  if(!s)return;
  openSortie();
  document.getElementById('m-sort').dataset.editId = id;
  sortSelectImmo(s.immoId);
  document.getElementById('so2').value = s.motif;
  document.getElementById('so3').value = s.date;
  document.getElementById('so4').value = s.prix || '';
  document.getElementById('so5').value = s.acheteur || '';
  document.getElementById('so6').value = s.obs || '';
  const pendEl=document.getElementById('so-pending-flag');
  if(pendEl) pendEl.checked = (s.statut==='attente');
  togSort();
}
function deleteSort(id){
  if(!guardDelete())return;
  const idx = DB.sorties.findIndex(x=>x.id===id);
  if(idx===-1)return;
  if(confirm("Voulez-vous vraiment supprimer cette sortie ?")){
    const s = DB.sorties[idx];
    DB.sorties.splice(idx,1);
    const im = DB.immobilisations.find(x=>x.id===s.immoId);
    if(im && s.statut!=='attente') im.statut = 'actif'; // restore status
    dbSave();rdSorties();rdFiches();rdDash();
    toast("Sortie supprimée");
  }
}\`;
code = code.replace(oldSaveSort, newSaveSort);

// 4. Update rdSorties for the table display
code = code.replace('<td><code>\\\\</code></td><td>\\\\</td>', '<td><code>\${escapeHtml(s.code)}</code></td><td>\${escapeHtml(s.designation)}</td>');
code = code.replace(
  '<td><button class="btn xs" onclick="showEcSort(\\'\${s.id}\\')">Écriture</button></td></tr>\`;',
  '<td><button class="btn xs" onclick="showEcSort(\\'\${s.id}\\')">Écriture</button></td><td style="text-align:center;display:flex;gap:4px;justify-content:center"><button class="btn sm" data-need-write onclick="if(guardWrite())editSort(\\'\${s.id}\\')" title="Modifier" style="padding:2px 6px">✏️</button><button class="btn sm d" data-need-delete onclick="if(guardDelete())deleteSort(\\'\${s.id}\\')" title="Supprimer" style="padding:2px 6px">🗑️</button><button class="btn sm" onclick="printSortie(\\'\${s.id}\\')" title="Imprimer" style="padding:2px 6px">🖨️</button></td></tr>\`;'
);
// Add applyRoleUI() to rdSorties
code = code.replace('popSortSel();\\n}', 'popSortSel();\\n  applyRoleUI();\\n}');

// 5. Update printSortie to take an ID argument (if provided) and fix its variables
const oldPrintSortie = \`function printSortie(){
  const immoId = (document.getElementById('so1')||{}).value;
  const im = immoId ? DB.immobilisations.find(x=>x.id===immoId) : null;
  const type = (document.getElementById('so4')||{}).value || '—';
  const date = (document.getElementById('so3')||{}).value || TD();
  const motif = (document.getElementById('so5')||{}).value || '—';
  const obs = (document.getElementById('so-obs')||{}).value || '';\`;

const newPrintSortie = \`function printSortie(sid){
  let immoId, type, date, motif, obs, prix;
  let im;
  let s = typeof sid==='string' ? DB.sorties.find(x=>x.id===sid) : null;
  if(s){
    immoId = s.immoId;
    im = DB.immobilisations.find(x=>x.id===immoId);
    type = s.motif==='cession'?'Cession':(s.motif==='rebut'?'Mise au rebut':'Vol / Sinistre');
    date = s.date;
    motif = s.acheteur || '—';
    obs = s.obs || '';
    prix = s.prix || 0;
  } else {
    immoId = (document.getElementById('so1')||{}).value;
    im = immoId ? DB.immobilisations.find(x=>x.id===immoId) : null;
    const m = (document.getElementById('so2')||{}).value;
    type = m==='cession'?'Cession':(m==='rebut'?'Mise au rebut':'Vol / Sinistre');
    date = (document.getElementById('so3')||{}).value || TD();
    motif = (document.getElementById('so5')||{}).value || '—';
    obs = (document.getElementById('so-obs')||{}).value || '';
    prix = +(document.getElementById('so4')||{}).value || 0;
  }\`;

code = code.replace(oldPrintSortie, newPrintSortie);

fs.writeFileSync('app.js', code, 'utf8');
console.log('app.js patched successfully');
