const SK='immogestion_v5'; // stable key
// ── OBFUSCATION (Supprimé car l'authentification est gérée par Supabase) ──// ── UTILITAIRES DE SECURITE ──
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
let _license        = null;
let _sessionTimer   = null;
let _rapCurrentType = '';
let _rapAmortData   = null;
let _rapSortCol     = '';
let _rapSortAsc     = true;
// xorEncrypt et xorDecrypt ont été supprimés (obsolètes avec le backend)

// Migrate from older keys
(function migrateOldData(){
  const oldKeys=['immogestion_v2','immogestion_v3','immogestion_v4'];
  for(const k of oldKeys){
    const old=localStorage.getItem(k);
    if(old&&!localStorage.getItem(SK)){
      localStorage.setItem(SK,old);
      console.log('Migrated from',k);
      break;
    }
  }
})();
let DB={
  immobilisations:[],sorties:[],affectations:[],journal:[],
  roles:[
    {id:'admin',libelle:'Administrateur',badge:'b',perms:{canWrite:true,canDelete:true,canValidate:true,canAdmin:true,canExport:true}},
    {id:'comptable',libelle:'Comptable',badge:'g',perms:{canWrite:true,canDelete:false,canValidate:true,canAdmin:false,canExport:true}},
    {id:'gestionnaire',libelle:'Gestionnaire',badge:'a',perms:{canWrite:true,canDelete:false,canValidate:false,canAdmin:false,canExport:true}},
    {id:'consultation',libelle:'Consultation',badge:'gr',perms:{canWrite:false,canDelete:false,canValidate:false,canAdmin:false,canExport:false}}
  ],
  categories:[
    {id:'INFO',libelle:'Matériel informatique',duree:5,methode:'lin',cptImmo:'2414',cptAmort:'2814',cptDot:'6813'},
    {id:'MOB',libelle:'Mobilier de bureau',duree:10,methode:'lin',cptImmo:'2441',cptAmort:'2841',cptDot:'6813'},
    {id:'TRANS',libelle:'Matériel de transport',duree:5,methode:'lin',cptImmo:'2245',cptAmort:'2845',cptDot:'6813'},
    {id:'INCORP',libelle:'Immobilisations incorporelles',duree:3,methode:'lin',cptImmo:'2111',cptAmort:'2801',cptDot:'6811'},
    {id:'AUTRE',libelle:'Autres matériels',duree:5,methode:'lin',cptImmo:'2498',cptAmort:'2898',cptDot:'6813'},
  ],
  utilisateurs:[], // Les utilisateurs sont maintenant gérés par Supabase Auth
  params:{methode:'lin',cal:360,coef1:1.5,coef2:2.0,coef3:2.5,pfx:'IMM',pfx2:'IMM',sep:'.',sep2:'-',yr:'ddmmyy',len:4,lennum:3,incyr:1,nxt:1,codifModel:'sequential',entite:{rs:'',adresse:'',tel:'',email:'',ninea:'',logo:'',ex:''}}
};

// ── SHA-256 (client-side, pour hachage des mots de passe) ──
async function sha256(str){
  if(typeof crypto!=='undefined' && crypto.subtle){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  // Fallback simple si exécuté en local sans HTTPS/Secure Context (file://)
  let h=0; for(let i=0;i<str.length;i++) h=Math.imul(31,h)+str.charCodeAt(i)|0;
  return 'fallback_'+Math.abs(h).toString(16);
}

function can(perm){
  if(!currentUser)return false;
  const role = (DB.roles || []).find(r => r.id === currentUser.role);
  return !!(role && role.perms && role.perms[perm]);
}
function guardWrite(action){
  if(!can('canWrite')){toast('Accès refusé — rôle insuffisant','e');return false;}
  return true;
}
function guardDelete(){
  if(!can('canDelete')){toast('Suppression non autorisée pour votre rôle','e');return false;}
  return true;
}
function guardAdmin(){
  if(!can('canAdmin')){toast('Section réservée aux administrateurs','e');return false;}
  return true;
}
function applyRoleUI(){
  document.querySelectorAll('[data-need-write]').forEach(el=>{
    el.style.display=can('canWrite')?'':'none';
  });
  document.querySelectorAll('[data-need-delete]').forEach(el=>{
    el.style.display=can('canDelete')?'':'none';
  });
  document.querySelectorAll('[data-need-admin]').forEach(el=>{
    el.style.display=can('canAdmin')?'':'none';
  });
  // Admin nav items
  document.querySelectorAll('.nav-admin').forEach(el=>el.style.display=can('canAdmin')?'':'none');
}

// ── STOCKAGE ──
let _dbSaveTimer = null;
function dbSave(){
  if(_dbSaveTimer) clearTimeout(_dbSaveTimer);
  _dbSaveTimer = setTimeout(() => {
    try{
      const enc = xorEncrypt(JSON.stringify(DB), CIPHER_KEY);
      localStorage.setItem(SK, enc);
    } catch(e){ console.warn('dbSave error', e); }
  }, 300);
}
function showStorageWarning(info){
  let w=document.getElementById('storage-warn');
  if(!w){
    w=document.createElement('div');
    w.id='storage-warn';
    w.style.cssText='position:fixed;top:60px;right:1rem;background:var(--amber-light);color:var(--amber);border:1px solid #FAC775;border-radius:var(--r);padding:.6rem 1rem;font-size:12px;z-index:9998;max-width:320px;box-shadow:var(--shadow)';
    document.body.appendChild(w);
  }
  w.innerHTML=`⚠ Stockage à ${info} — <strong>Exportez une sauvegarde</strong> pour éviter toute perte. <button onclick="exportBackupJSON()" style="background:var(--amber);color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;margin-left:4px">Exporter</button> <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:14px;margin-left:4px;color:var(--amber)">×</button>`;
}

// ── EXPORT / IMPORT JSON COMPLET ──
async function exportBackupJSON(){
  const data=JSON.stringify(DB,null,2);
  const date=new Date().toISOString().split('T')[0];
  const filename = 'immogestion_backup_'+date+'.json';
  
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Fichier JSON',
          accept: {'application/json': ['.json']},
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      toast('Sauvegarde exportée');
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast('Erreur lors de la sauvegarde: ' + err.message, 'e');
      }
    }
  } else {
    dlFile(filename,data,'application/json');
    toast('Sauvegarde exportée');
  }
}
function importBackupJSON(){
  if(!guardAdmin())return;
  const inp=document.createElement('input');
  inp.type='file';inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{
      try{
        const parsed=JSON.parse(ev.target.result);
        if(!parsed.immobilisations||!parsed.params){toast('Fichier invalide — format non reconnu','e');return;}
        // Vérification de compatibilité basique
        if(!Array.isArray(parsed.immobilisations)){toast('Structure invalide','e');return;}
        if(!confirm(`Importer cette sauvegarde ?\n\n${parsed.immobilisations.length} immobilisation(s) trouvée(s).\n\nToutes les données actuelles seront remplacées.`))return;
        // Migration des champs manquants
        if(!Array.isArray(parsed.sorties)) parsed.sorties=[];
        if(!Array.isArray(parsed.affectations)) parsed.affectations=[];
        if(!Array.isArray(parsed.ecritures_log)) parsed.ecritures_log=[];
        if(!Array.isArray(parsed.categories)||parsed.categories.length===0) delete parsed.categories;
        if(!Array.isArray(parsed.utilisateurs)||parsed.utilisateurs.length===0) delete parsed.utilisateurs;
        Object.assign(DB,parsed);
        dbSave();
        toast('Sauvegarde importée — rechargement...');
        setTimeout(()=>location.reload(),800);
      }catch(err){toast('Erreur de lecture du fichier JSON','e');}
    };
    r.readAsText(f);
  };
  inp.click();
}

function toggleSidebar(force){
  const sb=document.getElementById('sb');
  const ov=document.getElementById('sb-overlay');
  const open=typeof force==='boolean'?force:!sb.classList.contains('open');
  sb.classList.toggle('open',open);
  ov.classList.toggle('open',open);
}

function toggleSection(sec) {
  const isExpanded = sec.classList.contains('expanded');
  sec.classList.toggle('expanded', !isExpanded);
  let next = sec.nextElementSibling;
  while (next && next.classList.contains('ni')) {
    // Check if it's an admin link that should be hidden
    if (next.classList.contains('nav-admin') && !can('canAdmin')) {
      next.style.display = 'none';
    } else {
      next.style.display = isExpanded ? 'none' : 'flex';
    }
    next = next.nextElementSibling;
  }
}

let currentUser=null;
async function bypassLogin(){
  var msg="Réinitialiser les accès et se connecter en tant qu'administrateur ?"+
    "\n\nVos immobilisations ne seront PAS supprimées.";
  if(!confirm(msg))return;
  // Le compte administrateur par défaut est configuré
  const hash=await sha256('admin123'); // Utilisé uniquement pour bypass local
  DB.utilisateurs=[{id:1,nom:'Administrateur',email:'admin@org.sn',role:'admin',statut:'actif',connexion:'—',pwdHash:hash}];
  dbSave();
  currentUser={id:1,nom:'Administrateur',email:'admin@org.sn',role:'admin',statut:'actif'};
  document.getElementById('login-page').style.display='none';
  document.getElementById('app').style.display='flex';
  updateLicenseBanner();
  updateBackupStatus();
  checkBackupAlert();
  initSessionWatcher();
  logAction('LOGIN','Session','Connexion de '+currentUser.nom);
  document.getElementById('unom').textContent='Administrateur';
  document.getElementById('urole').textContent='Administrateur';
  document.getElementById('uav').textContent='AD';
  applyRoleUI();rdDash();
  toast("Accès réinitialisés — connecté en tant qu'Administrateur");
}

function generateSalt() { return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }

async function doLogin(){
  try{
    const email=(document.getElementById('login-email').value||'').trim().toLowerCase();
    const pwd=document.getElementById('login-pwd').value.trim();
    if(!email||!pwd){
      const err=document.getElementById('login-err');err.textContent='Email et mot de passe requis';err.style.display='block';return;
    }
    
    // 1. Authentification locale (pour les utilisateurs créés depuis l'interface)
    const localUser = DB.utilisateurs.find(u => u.email && u.email.toLowerCase() === email && u.statut !== 'inactif');
    if (localUser && localUser.pwdHash && localUser.salt) {
      const hash = await sha256(localUser.salt + pwd);
      if (hash === localUser.pwdHash) {
        currentUser = {
          id: localUser.id,
          nom: localUser.nom,
          email: localUser.email,
          role: localUser.role,
          statut: localUser.statut
        };
        localUser.connexion = new Date().toLocaleString('fr-FR');
        dbSave();
        
        document.getElementById('login-page').style.display='none';
        document.getElementById('app').style.display='flex';
        document.getElementById('unom').textContent=currentUser.nom;
        const currRoleObj = (DB.roles||[]).find(r=>r.id===currentUser.role);
        document.getElementById('urole').textContent=currRoleObj ? currRoleObj.libelle : currentUser.role;
        document.getElementById('uav').textContent=currentUser.nom.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
        
        applyRoleUI();
        rdDash();
        nav('dashboard');
        console.log('Connecté en local !');
        return;
      }
    }
    
    // 2. Auth with Supabase (fallback)
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: pwd
    });
    
    if (error || !data.session) {
      const err=document.getElementById('login-err');err.textContent='Email ou mot de passe incorrect';err.style.display='block';
      return;
    }
    
    // Fetch user profile from Supabase
    const { data: profile, error: profErr } = await supabaseClient
      .from('utilisateurs')
      .select('*')
      .eq('id', data.user.id)
      .single();
      
    if (profErr || !profile) {
       const err=document.getElementById('login-err');err.textContent='Profil utilisateur non configuré dans la table utilisateurs.';err.style.display='block';
       return;
    }
    
    currentUser = {
      id: profile.id,
      nom: profile.nom,
      email: profile.email,
      role: profile.role,
      statut: profile.statut
    };
    
    document.getElementById('login-page').style.display='none';
    document.getElementById('app').style.display='flex';
    document.getElementById('unom').textContent=currentUser.nom;
    const currRoleObj = (DB.roles||[]).find(r=>r.id===currentUser.role);
    document.getElementById('urole').textContent=currRoleObj ? currRoleObj.libelle : currentUser.role;
    document.getElementById('uav').textContent=currentUser.nom.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
    
    applyRoleUI();
    rdDash();
    nav('dashboard');
    console.log('Connecté via Supabase !');
  } catch(err) {
    console.error('Login error:',err);
    const e2=document.getElementById('login-err');
    if(e2){e2.textContent='Erreur technique: '+err.message;e2.style.display='block';}
  }
}
async function changePwdSelf(){
  if(!currentUser)return;
  const old=prompt('Mot de passe actuel :');
  if(old===null)return;
  const u=DB.utilisateurs.find(x=>x.id===currentUser.id);
  if(!u)return;
  
  let validOld = false;
  if(u.salt && u.pwdHash) {
    validOld = (await sha256(u.salt + old) === u.pwdHash);
  } else if(u.pwdHash) {
    validOld = (await sha256(old) === u.pwdHash);
  } else if(u.pwd) {
    validOld = (u.pwd === old);
  }

  if(!validOld){toast('Mot de passe actuel incorrect','e');return;}
  const n1=prompt('Nouveau mot de passe (min 6 caractères) :');
  if(!n1||n1.trim().length<6){toast('Minimum 6 caractères','e');return;}
  const n2=prompt('Confirmer le nouveau mot de passe :');
  if(n1!==n2){toast('Les mots de passe ne correspondent pas','e');return;}
  
  u.salt = generateSalt();
  u.pwdHash=await sha256(u.salt + n1.trim());
  delete u.pwd;
  dbSave();
  toast('Mot de passe modifié avec succès');
}
function doLogout(){
  if(currentUser) logAction('LOGOUT','Session','Déconnexion de '+currentUser.nom);
  if(!confirm('Se déconnecter ?'))return;
  currentUser=null;
  document.getElementById('app').style.display='none';
  document.getElementById('login-page').style.display='flex';
  document.getElementById('login-pwd').value='';
  document.getElementById('login-err').style.display='none';
}
function dbLoad(){
  try{
    const raw = localStorage.getItem(SK);
    if(raw){
      let jsonStr = null;
      const dec = xorDecrypt(raw, CIPHER_KEY);
      if(dec){ try{ JSON.parse(dec); jsonStr=dec; }catch(e){console.warn('dbLoad: erreur parsing dec', e);} }
      if(!jsonStr){ try{ JSON.parse(raw); jsonStr=raw; }catch(e){console.warn('dbLoad: erreur parsing raw', e);} }
      if(!jsonStr){ seed(); return; }
      const saved = JSON.parse(jsonStr);
      const def = DB.params;
      Object.assign(DB, saved);
      // Toujours s'assurer que journal et roles existent
      if(!DB.journal) DB.journal = [];
      if(!DB.roles) {
        DB.roles = [
          {id:'admin',libelle:'Administrateur',badge:'b',perms:{canWrite:true,canDelete:true,canValidate:true,canAdmin:true,canExport:true}},
          {id:'comptable',libelle:'Comptable',badge:'g',perms:{canWrite:true,canDelete:false,canValidate:true,canAdmin:false,canExport:true}},
          {id:'gestionnaire',libelle:'Gestionnaire',badge:'a',perms:{canWrite:true,canDelete:false,canValidate:false,canAdmin:false,canExport:true}},
          {id:'consultation',libelle:'Consultation',badge:'gr',perms:{canWrite:false,canDelete:false,canValidate:false,canAdmin:false,canExport:false}}
        ];
      }
      DB.params = Object.assign({}, def, saved.params||{});
      if(saved.params?.entite) DB.params.entite = Object.assign({rs:'',adresse:'',tel:'',email:'',ninea:'',logo:'',ex:''}, saved.params.entite);
      if(saved.params?.comptes) DB.params.comptes = Object.assign({}, saved.params.comptes);
    } else { seed(); }
  } catch(e){ console.warn('dbLoad error', e); seed(); }
}
function seed(){
  DB.immobilisations=[
    {id:'i1',code:'IMM-2024-001',designation:'Serveur Dell PowerEdge R740',categorie:'Matériel informatique',nature:'Unité',financement:'Fonds propres',vo:4500000,fournisseur:'Dell Sénégal',affectation:'Direction informatique',methode:'lin',duree:5,taux:0.20,dateAcq:'2024-03-15',cal:360,statut:'actif',ci:'2414',ca:'2814'},
    {id:'i2',code:'IMM-2024-002',designation:'Toyota Hilux Double Cabine 4x4',categorie:'Matériel de transport',nature:'Véhicule',financement:'Fonds propres',vo:22000000,fournisseur:'Eiffage Automobile',affectation:'Direction générale',methode:'lin',duree:5,taux:0.20,dateAcq:'2024-01-02',cal:360,statut:'actif',ci:'2245',ca:'2845'},
    {id:'i3',code:'IMM-2024-003',designation:'Logiciel ERP Sage X3',categorie:'Immobilisations incorporelles',nature:'Licence',financement:'Subventions',vo:8000000,fournisseur:'Sage Afrique',affectation:'Comptabilité',methode:'lin',duree:3,taux:0.333,dateAcq:'2024-07-01',cal:360,statut:'actif',ci:'2111',ca:'2801'},
    {id:'i4',code:'IMM-2023-015',designation:'Bureau direction acajou massif',categorie:'Mobilier de bureau',nature:'Meuble',financement:'Fonds propres',vo:850000,fournisseur:'Mbaye Meubles',affectation:'Direction générale',methode:'lin',duree:10,taux:0.10,dateAcq:'2023-06-10',cal:360,statut:'actif',ci:'2441',ca:'2841'},
    {id:'i5',code:'IMM-2022-008',designation:'Climatiseur Daikin 18000 BTU',categorie:'Autres matériels',nature:'Appareil',financement:'Fonds propres',vo:450000,fournisseur:'Froid Sénégal',affectation:'Salle serveurs',methode:'lin',duree:5,taux:0.20,dateAcq:'2022-03-15',cal:360,statut:'actif',ci:'2498',ca:'2898'},
    {id:'i6',code:'IMM-2023-005',designation:'Chaises de réunion (lot de 20)',categorie:'Mobilier de bureau',nature:'Lot',financement:'Fonds propres',vo:600000,fournisseur:'Bureau Sénégal',affectation:'Salle de réunion',methode:'lin',duree:10,taux:0.10,dateAcq:'2023-01-15',cal:360,statut:'actif',ci:'2441',ca:'2841'},
    {id:'i7',code:'IMM-2021-003',designation:'Groupe électrogène Cummins 50KVA',categorie:'Autres matériels',nature:'Unité',financement:'Fonds propres',vo:6500000,fournisseur:'Sogelec',affectation:'Site principal',methode:'lin',duree:10,taux:0.10,dateAcq:'2021-09-01',cal:360,statut:'actif',ci:'2498',ca:'2898'},
  ];
  DB.affectations=[
    {id:'a1',date:'2024-06-01',immoId:'i1',code:'IMM-2024-001',designation:'Serveur Dell PowerEdge R740',ancien:'Magasin',nouveau:'Direction informatique',resp:'Omar Seck',motif:'Mise en service'},
    {id:'a2',date:'2024-02-15',immoId:'i2',code:'IMM-2024-002',designation:'Toyota Hilux',ancien:'Parc auto',nouveau:'Direction générale',resp:'Amadou Diallo',motif:'Attribution direction'},
  ];
  dbSave();
}

const F=n=>Math.round(n).toLocaleString('fr-FR');
const FD=d=>{if(!d)return'—';const p=d.split('-');return p[2]+'/'+p[1]+'/'+p[0]};
const TD=()=>new Date().toISOString().split('T')[0];
const DB2=(d1,d2)=>Math.round((new Date(d2)-new Date(d1))/86400000);
const UID=()=>'i'+Date.now()+Math.random().toString(36).slice(2,5);
const CC=c=>({'Matériel informatique':'b','Mobilier de bureau':'gr','Matériel de transport':'a','Immobilisations incorporelles':'pu'}[c]||'gr');

function toast(msg,t=''){
  const el=document.createElement('div');el.className='toast';
  el.style.background=t==='e'?'var(--red)':t==='i'?'var(--blue)':'var(--text)';
  el.textContent=msg;document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),300)},2600);
}

// ── AMORTISSEMENT ──
function getCoef(d){const n=+d;return n<=4?+(DB.params.coef1||1.5):n<=6?+(DB.params.coef2||2.0):+(DB.params.coef3||2.5)}
function joursProrata(dateAcq,cal){
  // Calcul du nombre de jours restants dans l'année à partir de la date d'acquisition
  // Calendrier civil 360j : mois de 30 jours — formule : (mois restants après mois acq × 30) + (30 - jour + 1)
  // Calendrier financier 365j : jours réels jusqu'au 31/12
  const d=new Date(dateAcq);
  const moisAcq=d.getMonth()+1; // 1-12
  const jourAcq=d.getDate();
  const yr=d.getFullYear();
  if(+cal===360){
    const moisRestants=12-moisAcq; // mois complets après le mois d'acquisition
    const joursRestantsDansMois=30-jourAcq+1;
    return moisRestants*30+joursRestantsDansMois;
  } else {
    // 365 : jours réels du jour d'acquisition au 31/12 inclus
    const dec31=new Date(yr,11,31);
    return DB2(dateAcq,dec31.toISOString().split('T')[0])+1;
  }
}
function dot1(vo,taux,dateAcq,cal){
  const jours=joursProrata(dateAcq,cal);
  return Math.round(vo*taux*(jours/+cal));
}
// ── APPROCHE PAR COMPOSANTS IAS 16 ──
function buildPlanComposants(im){
  const comps=im.composants||[];
  if(!comps.length) return null;
  // Plan individuel de chaque composant (mêmes dates que le bien parent)
  const plans=comps.map(comp=>buildPlan({
    vo:comp.vo, vr:comp.vr||0,
    methode:comp.methode||im.methode||'lin',
    duree:comp.duree, taux:1/comp.duree,
    dateAcq:im.dateAcq, dateMis:im.dateMis||im.dateAcq,
    cal:im.cal||360
  }).map(r=>({...r,_comp:comp.designation})));
  // Collecter tous les exercices
  const yrs=[...new Set(plans.flat().map(r=>r.yrNum))].sort((a,b)=>a-b);
  const voTotal=comps.reduce((a,c)=>a+c.vo,0)||im.vo;
  let cumTotal=0;
  const rows=[];
  for(const yr of yrs){
    let dtTotal=0;
    const detail=[];
    plans.forEach((plan,pi)=>{
      const row=plan.find(r=>r.yrNum===yr);
      if(row&&row.dt>0){dtTotal+=row.dt;detail.push({designation:comps[pi].designation,dt:row.dt});}
    });
    if(dtTotal<=0) break;
    cumTotal+=dtTotal;
    const vncTotal=Math.max(0,voTotal-cumTotal);
    const label=plans[0].find(r=>r.yrNum===yr)?.yr||String(yr);
    rows.push({yr:label,yrNum:yr,vd:voTotal-(cumTotal-dtTotal),dt:dtTotal,cum:cumTotal,vnc:vncTotal,rt:voTotal>0?dtTotal/voTotal:0,detail});
    if(vncTotal<=0) break;
  }
  return rows;
}

function buildPlan(im){
  // ── COMPOSANTS IAS 16 : plan consolidé si composants définis ──
  if(im.composants&&im.composants.length>0){
    const p=buildPlanComposants(im);
    if(p&&p.length) return p;
  }
  // Méthode unités d'œuvre
  if(im.methode==='uo'&&im.uo?.historique?.length) return buildPlanUO(im);

  const vo    = im.vo;
  const vr    = im.vr||0;
  const base  = vo - vr;           // base amortissable
  const dur   = im.duree;
  const meth  = im.methode;
  const cal   = +(im.cal||360);
  const refDate = im.dateMis||im.dateAcq;
  const d     = new Date(refDate);
  const yrAcq = d.getFullYear();
  const moisAcq = d.getMonth()+1;  // 1–12
  const jourAcq = d.getDate();     // 1–30 (on travaille en 360)

  // ── LINÉAIRE ──────────────────────────────────────────────
  if(meth==='lin'){
    const taux = 1/dur;
    const rows=[];
    let cum=0;
    for(let i=0;i<=dur+1;i++){
      let dt, yrNum=yrAcq+i, yrLabel;
      if(i===0){
        // Prorata temporis : jours entiers depuis jourAcq jusqu'à fin exercice
        // Calendrier 360 : jours restants = (12-moisAcq)*30 + (30-jourAcq+1)
        const jours = cal===360
          ? (12-moisAcq)*30 + (30-jourAcq+1)
          : Math.round((new Date(yrAcq,11,31)-d)/(1000*60*60*24))+1;
        dt = Math.round(base * taux * jours/cal);
        yrLabel = yrAcq+' (prorata)';
      } else {
        dt = Math.round(base * taux);
        yrLabel = String(yrAcq+i);
      }
      dt = Math.min(dt, base-cum);
      if(dt<=0) break;
      cum+=dt;
      rows.push({yr:yrLabel,yrNum,vd:vo-(cum-dt),dt,cum,vnc:Math.max(vr,vo-cum),rt:taux});
      if(cum>=base) break;
    }
    return rows;
  }

  // ── DÉGRESSIF COMPTABLE SYSCOHADA ─────────────────────────
  if(meth==='deg'){
    const S=dur*(dur+1)/2;
    // Prorata : si jourAcq=1, prorata en MOIS ENTIERS (12-moisAcq+1)/12
    //           sinon, en jours : jourAcq/360 + (12-moisAcq)/12
    const coefK=(k)=>Math.max(0,(dur+1-k)/S);
    function prorata(base,c){
      if(jourAcq===1) return Math.round(base*c*(12-moisAcq+1)/12);
      return Math.round(base*c*jourAcq/360)+Math.round(base*c*(12-moisAcq)/12);
    }
    function complement(base,c){
      if(jourAcq===1) return Math.round(base*c*(moisAcq-1)/12);
      return Math.round(base*c*(30-jourAcq)/360)+Math.round(base*c*(moisAcq-1)/12);
    }
    const rows=[];let cum=0;
    for(let k=1;k<=dur+2;k++){
      const cK=coefK(k),cKm=coefK(k-1);let dt=0,yrLabel;
      if(k===1){dt=prorata(base,cK);yrLabel=jourAcq===1&&moisAcq===1?String(yrAcq):yrAcq+' (prorata)';}
      else if(cK>0){dt=complement(base,cKm)+prorata(base,cK);yrLabel=String(yrAcq+k-1);}
      else{dt=complement(base,cKm);yrLabel=String(yrAcq+k-1)+' (compl.)';}
      dt=Math.min(dt,base-cum);if(dt<=0)break;cum+=dt;
      rows.push({yr:yrLabel,yrNum:yrAcq+k-1,vd:vo-(cum-dt),dt,cum,vnc:Math.max(vr,vo-cum),rt:cK||cKm});
      if(cum>=base)break;
    }
    return rows;
  }

  // ── DÉGRESSIF FISCAL (Sénégal — VNC × taux, prorata mois entiers depuis mois ACQUISITION) ──
  if(meth==='degf'){
    const tauxFisc = im.taux;
    // Prorata : mois d'ACQUISITION compté entier à partir du 1er jour
    const dAcqFisc = new Date(im.dateAcq);
    const moisAcqFisc = dAcqFisc.getMonth()+1;
    const moisEntiersFisc = 12 - moisAcqFisc + 1;
    const rows=[];
    let cum=0, vnc=base, exercicesEcoules=0;
    for(let i=0;i<=dur+5;i++){
      if(vnc<=0) break;
      let dt, yrNum=yrAcq+i, yrLabel;
      if(i===0){
        dt = Math.round(vnc * tauxFisc * moisEntiersFisc/12);
        yrLabel = yrAcq+' (prorata)';
      } else {
        // Années restantes = DUP - exercices écoulés
        const anneesRest = dur - exercicesEcoules;
        const dtDeg = Math.round(vnc * tauxFisc);
        const dtLin = anneesRest>0 ? Math.round(vnc / anneesRest) : vnc;
        dt = Math.max(dtDeg, dtLin);
        yrLabel = String(yrAcq+i);
      }
      dt = Math.min(dt, vnc);
      if(dt<=0) break;
      cum+=dt; vnc=Math.max(0,base-cum);
      rows.push({yr:yrLabel,yrNum,vd:vo-(cum-dt),dt,cum,vnc:vnc+vr,rt:tauxFisc});
      exercicesEcoules++;
      if(vnc<=0) break;
    }
    return rows;
  }

  return [];
}
function cumAt(im,dateStr){
  // Utilise la date de mise en service si disponible (SYSCOA/OHADA)
  const refDate=im.dateMis||im.dateAcq;
  const plan=buildPlan({...im,dateAcq:refDate}),yr=new Date(dateStr).getFullYear();
  let c=0;
  for(const r of plan){const ry=r.yrNum||+r.yr||new Date(refDate).getFullYear();if(ry<=yr)c+=r.dt;}
  return Math.min(c,im.vo-(im.vr||0));
}
function dotPeriod(im,y1,y2){
  const plan=buildPlan(im);let d=0;
  for(const r of plan){const ry=r.yrNum||+r.yr||new Date(im.dateAcq).getFullYear();if(ry>=y1&&ry<=y2)d+=r.dt;}
  return d;
}

// Dotation proratée du 01/01 à une date d'arrêté précise
function dotAtDate(im, arrete){
  if(!arrete) return dotPeriod(im, new Date().getFullYear(), new Date().getFullYear());
  const plan = buildPlan(im);
  const arrDate = new Date(arrete);
  const yr = arrDate.getFullYear();
  const cal = im.cal || 360;

  // Trouver la dotation annuelle pour cet exercice
  let dotAnn = 0;
  for(const r of plan){
    const ry = r.yrNum || +r.yr || new Date(im.dateMis||im.dateAcq).getFullYear();
    if(ry === yr){ dotAnn = r.dt; break; }
  }
  if(!dotAnn) return 0;

  // Si c'est le 31/12, dotation complète
  const isFullYear = arrete >= (yr + '-12-31');
  if(isFullYear) return dotAnn;

  // Prorata : jours courus du 01/01 jusqu'à l'arrêté
  let joursArrete, joursCal;
  const m = arrDate.getMonth() + 1;
  const j = arrDate.getDate();
  if(+cal === 360){
    joursArrete = (m - 1) * 30 + j;
    joursCal = 360;
  } else {
    // Jours réels du 01/01 au arrêté
    const debut = new Date(yr + '-01-01');
    joursArrete = Math.round((arrDate - debut) / (1000*60*60*24)) + 1;
    joursCal = 365;
  }

  // Mais si le bien a été acquis en cours d'année, on part de la date MES
  const refDate = im.dateMis || im.dateAcq;
  const refYr = new Date(refDate).getFullYear();
  if(refYr === yr){
    // Première année : déjà proraté dans buildPlan → retourner la dotation du plan
    return dotAnn;
  }

  return Math.round(dotAnn * joursArrete / joursCal);
}

// Dotation sur une période [d1..d2] avec prorata sur les bornes
function dotBetween(im, d1, d2){
  if(!d1 || !d2) return dotPeriod(im, new Date().getFullYear(), new Date().getFullYear());
  const plan = buildPlan(im);
  const date1 = new Date(d1), date2 = new Date(d2);
  const y1 = date1.getFullYear(), y2 = date2.getFullYear();
  const cal = im.cal || 360;
  let total = 0;

  for(const r of plan){
    const ry = r.yrNum || +r.yr || new Date(im.dateMis||im.dateAcq).getFullYear();
    if(ry < y1 || ry > y2) continue;

    if(y1 === y2){
      // Même année : prorata double
      let jDeb, jFin, jCal;
      if(+cal === 360){
        jDeb = (date1.getMonth())*30 + date1.getDate();
        jFin = (date2.getMonth())*30 + date2.getDate();
        jCal = 360;
      } else {
        const debut = new Date(ry+'-01-01');
        jDeb = Math.round((date1-debut)/(1000*60*60*24));
        jFin = Math.round((date2-debut)/(1000*60*60*24))+1;
        jCal = 365;
      }
      total += Math.round(r.dt * Math.max(0, jFin - jDeb) / jCal);
    } else if(ry === y1){
      // Première année : du début de période jusqu'au 31/12
      let jDeb, jCal;
      if(+cal === 360){
        jDeb = (date1.getMonth())*30 + date1.getDate();
        jCal = 360;
      } else {
        const debut = new Date(ry+'-01-01');
        jDeb = Math.round((date1-debut)/(1000*60*60*24));
        jCal = 365;
      }
      total += Math.round(r.dt * Math.max(0, jCal - jDeb) / jCal);
    } else if(ry === y2){
      // Dernière année : du 01/01 jusqu'à la fin de période
      let jFin, jCal;
      if(+cal === 360){
        jFin = (date2.getMonth())*30 + date2.getDate();
        jCal = 360;
      } else {
        const debut = new Date(ry+'-01-01');
        jFin = Math.round((date2-debut)/(1000*60*60*24))+1;
        jCal = 365;
      }
      total += Math.round(r.dt * jFin / jCal);
    } else {
      // Années intermédiaires : dotation complète
      total += r.dt;
    }
  }
  return total;
}
function dotPeriodInv(im,dateInv){
  // Dotation from Jan 1 of inventory year to dateInv
  const plan=buildPlan(im);
  const yrInv=new Date(dateInv).getFullYear();
  let d=0;
  for(const r of plan){
    const ry=r.yrNum||+r.yr||new Date(im.dateAcq).getFullYear();
    if(ry===yrInv) d+=r.dt;
  }
  return d;
}
function joursSortie(dateSortie,cal){
  // Nombre de jours du 01/01 au jour de sortie inclus
  // Civil 360j : (mois-1)*30 + jour  |  Financier 365j : jours réels
  const d=new Date(dateSortie);
  const mois=d.getMonth()+1,jour=d.getDate(),ys=d.getFullYear();
  if(+cal===360){return (mois-1)*30+jour;}
  else{return DB2(ys+'-01-01',dateSortie)+1;}
}
function dotComp(im,dateSortie){
  const ys=new Date(dateSortie).getFullYear();
  const cal=+im.cal||360;
  const dotAnn=Math.round(im.vo*im.taux);
  if(!dotAnn)return 0;
  const cumAvant=cumAt(im,(ys)+'-01-01');
  if(cumAvant>=im.vo)return 0;
  const jours=joursSortie(dateSortie,cal);
  return Math.round(dotAnn*(jours/cal));
}

// ══════════════════════════════════════════
// CODE GEN — 3 modèles : charte / séquentiel / libre
// ══════════════════════════════════════════

function getCodifModel(){ return DB.params.codifModel || 'sequential'; }

// --- Charte : Nlettres.marque.jj/mm/aa.seq ---
function genCodeCharte(designation, marque, dateAcq){
  const p = DB.params;
  const sep = p.sep || '.';
  const lenPfx = +p.len || 4;
  const dateFmt = p.yr || 'ddmmyy';

  const des = (designation || 'IMMO')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z]/g,'').toUpperCase().slice(0, lenPfx);

  const mq = (marque || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0, 10);

  let dateSeg = '';
  if(dateFmt !== 'none' && dateAcq){
    const d = new Date(dateAcq);
    if(!isNaN(d)){
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yy = dateFmt === 'ddmmyyyy' ? String(d.getFullYear()) : String(d.getFullYear()).slice(2);
      dateSeg = dd + '/' + mm + '/' + yy;
    }
  }
  const seq = String(p.nxt || 1);
  const parts = [];
  if(des) parts.push(des);
  if(mq)  parts.push(mq);
  if(dateSeg) parts.push(dateSeg);
  parts.push(seq);
  return parts.join(sep);
}

// --- Séquentiel : PRF-AAAA-001 ---
function genCodeSeq(){
  const p = DB.params;
  const pfx  = p.pfx2 || p.pfx || 'IMM';
  const sep  = p.sep2 || '-';
  const incYr= p.incyr != null ? +p.incyr : 1;
  const lenN = +p.lennum || 3;
  const yr   = new Date().getFullYear();
  const num  = String(p.nxt || 1).padStart(lenN, '0');
  const parts = [pfx];
  if(incYr) parts.push(yr);
  parts.push(num);
  return parts.join(sep);
}

// --- Entrée unique selon le modèle actif ---
function genCodeAuto(designation, marque, dateAcq){
  const model = getCodifModel();
  if(model === 'charte')     return genCodeCharte(designation, marque, dateAcq);
  if(model === 'sequential') return genCodeSeq();
  return ''; // libre : vide, saisie manuelle
}

function genCode(){
  return genCodeAuto('IMMO','', new Date().toISOString().split('T')[0]);
}

function nextCode(designation, marque, dateAcq){
  const code = genCodeAuto(
    designation || 'IMMO',
    marque || '',
    dateAcq || new Date().toISOString().split('T')[0]
  );
  DB.params.nxt = (+DB.params.nxt || 1) + 1;
  dbSave();
  return code;
}

// Alias kept for import
function genCodeFromFields(des,mq,date){ return genCodeCharte(des,mq,date); }


// ── NAV ──
const plabels={dashboard:['Tableau de bord',''],fiches:['Fiches immobilisations','Registre des actifs'],inventaire:['Inventaire','Valorisation à une date donnée'],amortissements:['Plans amortissements','Linéaire et dégressif'],affectations:['Affectations','Mouvements des immobilisations'],sorties:['Sorties actifs','Cession - Rebut - Vol'],ecritures:['Ecritures comptables','Journal automatique'],rapports:['Rapports et états','Documents de synthèse'],parametres:['Paramètres','Configuration générale'],utilisateurs:['Utilisateurs et droits','Gestion des accès'],revision:['Révision de plan','Modifications prospectives IAS 8 / SYSCOHADA'],budget:['Budget prévisionnel','Projection des dotations et acquisitions futures'],journal:['Journal d\'audit','Traçabilité & historique'],journal:['Journal d\'audit','Traçabilité']};
function nav(id,el){
  if((id==='parametres'||id==='utilisateurs')&&!can('canAdmin')){
    toast('Section réservée aux administrateurs','e');return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#sb .ni').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+id);if(pg)pg.classList.add('active');
  if(el)el.classList.add('active');
  else document.querySelectorAll('#sb .ni').forEach(n=>{if((n.getAttribute('onclick')||'').includes("'"+id+"'"))n.classList.add('active');});
  const [t,s]=plabels[id]||['',''];
  document.getElementById('tbt').textContent=t;
  document.getElementById('tbs').textContent=s?' — '+s:'';
  if(id==='dashboard')rdDash();
  if(id==='fiches'){rdFiches();popAmortSel();}
  if(id==='amortissements'){popAmortSel();calcSim();}
  if(id==='inventaire')popLieuSel();
  if(id==='affectations')rdAff();
  if(id==='sorties')rdSorties();
  if(id==='ecritures'){
    const arrEl=document.getElementById('ec-arrete');
    if(arrEl&&!arrEl.value)arrEl.value=TD();
    initEcFilters();
    ecUpdateHint();
    rdEc();
  }
  if(id==='parametres'){rdPrmCat();loadParams();}
  if(id==='utilisateurs'){populateRoleSelects();rdRoles();rdUsers();}
  if(id==='journal')rdJournal();
  if(id==='rapports'){document.getElementById('rap-card').style.display='none';document.querySelectorAll('.rap-card-btn').forEach(b=>b.classList.remove('rap-active'));const gf=document.getElementById('rap-global-filter');if(gf)gf.style.display='none';}
  if(id==='revision')rdRevision();
  if(id==='budget'){rdBudgetCats();rdBudget();}
  toggleSidebar(false);
}

// ── MODAL ──
function openM(id){document.getElementById(id).classList.add('open')}
function closeM(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.mb').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open')}));

// ── TABS ──
function genPlanPreview(){
  const g=(id)=>document.getElementById(id)?.value||'';
  const vo=+g('fc7'), vr=+g('fc-vr')||0, dur=+g('fca'), date=g('fc8');
  if(!vo||!dur||!date){toast('Renseignez la valeur d\u2019origine, la durée et la date d\u2019acquisition','e');return;}
  const tmp={
    vo,vr,duree:dur,
    methode:g('fc9')||'lin',
    cal:+g('fcc2')||360,
    dateAcq:date,
    dateMis:g('fc-mis')||date,
    uo:g('fc9')==='uo'?{...getUOFromForm(),historique:[]}:null,
  };
  let plan;
  try{plan=buildPlan(tmp);}catch(e){toast('Impossible de générer le plan avec ces valeurs','e');return;}
  if(!plan||!plan.length){toast('Impossible de générer le plan avec ces valeurs','e');return;}
  document.getElementById('n-amtb').innerHTML=plan.map(r=>
    `<tr><td>${r.yr}</td><td class="n">${F(r.vd)}</td><td class="n">${(r.rt*100).toFixed(2)}%</td><td class="n">${F(r.dt)}</td><td class="n">${F(r.cum)}</td><td class="n" style="color:${r.vnc<=0?'var(--red)':'inherit'}">${F(r.vnc)}</td></tr>`
  ).join('');
  document.getElementById('n-amort-empty').style.display='none';
  document.getElementById('n-amort-wrap').style.display='block';
}
function stab(el,pid){
  // Trouver le conteneur parent qui contient à la fois les .tabs et les .tp
  // On remonte jusqu'à trouver un ancêtre qui contient des .tp
  let container = el.parentElement; // = .tabs div
  // Chercher dans le parent du parent qui contient des .tp
  let scope = container.parentElement;
  // Parfois les .tp sont dans le même niveau que .tabs, parfois dans un wrapper
  // On cherche le premier ancêtre qui contient au moins un .tp
  let tps = scope ? scope.querySelectorAll(':scope > .tp') : [];
  if(!tps.length && scope) {
    // Essayer un niveau plus haut (cas .card > .ch + .tabs + .tp)
    scope = scope.parentElement;
    tps = scope ? scope.querySelectorAll(':scope > .tp') : [];
  }
  // Désactiver tous les onglets du groupe
  container.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  // Désactiver tous les panneaux trouvés
  tps.forEach(tp=>tp.classList.remove('active'));
  // Activer le panneau cible
  const tg = pid ? document.getElementById(pid) : null;
  if(tg) tg.classList.add('active');
}

// ── DASHBOARD ──
function rdDash(){
  popCatSelectors();
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const tVO=immos.reduce((a,b)=>a+b.vo,0);
  const tCum=immos.reduce((a,b)=>a+cumAt(b,TD()),0);
  const tVNC=tVO-tCum;
  const yr=new Date().getFullYear();
  const tDot=immos.reduce((a,b)=>a+dotPeriod(b,yr,yr),0);
  
  const hh=new Date().getHours();
  const greet=hh<12?'Bonjour':hh<18?'Bon après-midi':'Bonsoir';
  
  const dateOpts = { day: 'numeric', month: 'long', year: 'numeric' };
  const todayStr = new Date().toLocaleDateString('fr-FR', dateOpts);

  // === 1. Render Header ===
  const saasHero = document.getElementById('saas-hero');
  if(saasHero) {
      saasHero.innerHTML = ``;
    applyRoleUI();
  }

  // === 2. Render KPIs ===
  const saasKpiGrid = document.getElementById('saas-kpi-grid');
  if(saasKpiGrid) {
    const icCoin = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 10h4M6 6h4" stroke-linecap="round"/></svg>';
    const icDown = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 5v4l2.5 2.5" stroke-linecap="round"/></svg>';
    const icShield = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2l5 2v4.5c0 3-2.5 5.5-5 6.5-2.5-1-5-3.5-5-6.5V4l5-2z"/></svg>';
    const icCal = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2 2" stroke-linecap="round"/></svg>';

    // Fake variations
    saasKpiGrid.innerHTML = `
      <div class="saas-kpi-card">
        <div class="saas-kpi-header">
          <div class="saas-kpi-icon" style="background:var(--blue-light);color:var(--blue);">${icCoin}</div>
          <div class="saas-kpi-title">Valeur Brute</div>
        </div>
        <div class="saas-kpi-val">${F(tVO)}<span>FCFA</span></div>
        <div class="saas-kpi-footer">
          <div class="saas-kpi-var pos"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 10V2m0 0L2 6m4-4l4 4"/></svg> 2.4%</div>
          <svg class="saas-kpi-spark" viewBox="0 0 60 24" preserveAspectRatio="none"><path d="M0 24 Q 15 10 30 15 T 60 5" fill="none" stroke="var(--green)" stroke-width="2"/></svg>
        </div>
      </div>
      <div class="saas-kpi-card">
        <div class="saas-kpi-header">
          <div class="saas-kpi-icon" style="background:#FEF2F2;color:var(--red);">${icDown}</div>
          <div class="saas-kpi-title">Amortissements</div>
        </div>
        <div class="saas-kpi-val">${F(tCum)}<span>FCFA</span></div>
        <div class="saas-kpi-footer">
          <div class="saas-kpi-var neg"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v8m0 0L2 6m4 4l4-4"/></svg> 1.1%</div>
          <svg class="saas-kpi-spark" viewBox="0 0 60 24" preserveAspectRatio="none"><path d="M0 5 Q 15 20 30 15 T 60 24" fill="none" stroke="var(--red)" stroke-width="2"/></svg>
        </div>
      </div>
      <div class="saas-kpi-card">
        <div class="saas-kpi-header">
          <div class="saas-kpi-icon" style="background:#ECFDF5;color:var(--green);">${icShield}</div>
          <div class="saas-kpi-title">VNC Totale</div>
        </div>
        <div class="saas-kpi-val">${F(tVNC)}<span>FCFA</span></div>
        <div class="saas-kpi-footer">
          <div class="saas-kpi-var pos"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 10V2m0 0L2 6m4-4l4 4"/></svg> 0.8%</div>
          <svg class="saas-kpi-spark" viewBox="0 0 60 24" preserveAspectRatio="none"><path d="M0 20 Q 20 5 40 10 T 60 2" fill="none" stroke="var(--green)" stroke-width="2"/></svg>
        </div>
      </div>
      <div class="saas-kpi-card">
        <div class="saas-kpi-header">
          <div class="saas-kpi-icon" style="background:#F5F3FF;color:#7C3AED;">${icCal}</div>
          <div class="saas-kpi-title">Dotations ${yr}</div>
        </div>
        <div class="saas-kpi-val">${F(tDot)}<span>FCFA</span></div>
        <div class="saas-kpi-footer">
          <div class="saas-kpi-var neu"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6h8"/></svg> 0.0%</div>
          <svg class="saas-kpi-spark" viewBox="0 0 60 24" preserveAspectRatio="none"><path d="M0 12 L 60 12" fill="none" stroke="var(--border2)" stroke-width="2"/></svg>
        </div>
      </div>
    `;
  }

  // === 3. Render Top 5 Table ===
  const saasRecent = document.getElementById('saas-recent');
  if(saasRecent) {
    saasRecent.innerHTML = DB.immobilisations.slice(-5).reverse().map(im=>{
      const vnc=im.vo-cumAt(im,TD());
      const d=new Date(im.dateAcq);
      const dStr = ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear();
      const icCube = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1L1 4v6l6 3 6-3V4z"/><path d="M1 4l6 3 6-3M7 7v7"/></svg>';
      return `<tr class="clk" onclick="openDet('${im.id}')">
        <td><div style="display:flex;align-items:center;gap:6px;"><div class="saas-table-icon">${icCube}</div><span style="white-space:normal;word-break:break-word;">${escapeHtml(im.code)}</span></div></td>
        <td style="font-weight:500;white-space:normal;word-break:break-word;">${escapeHtml(im.designation)}</td>
        <td>${F(im.vo)}</td>
        <td style="font-weight:600;color:var(--text);">${F(vnc)}</td>
        <td style="text-align:right;color:var(--text3);">${dStr}</td>
      </tr>`;
    }).join('');
  }

  // === 4. Render Alerts ===
  const saasAlert = document.getElementById('saas-alert');
  if(saasAlert) {
    const alerte=immos.filter(i=>cumAt(i,TD())>=(i.vo-(i.vr||0)));
    const pendSorties=DB.sorties.filter(s=>s.statut==='attente');
    let alertHtml = '';
    const icAlert = (bg, color, path) => `<div class="saas-alert-icon" style="background:${bg};color:${color};"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg></div>`;
    const oPath = '<path d="M8 2.5L1.5 14h13L8 2.5z"/><path d="M8 7v3M8 12h.01"/>';
    const aPath = '<path d="M8 4v4l2 2"/><circle cx="8" cy="8" r="6"/>';
    const pPath = '<path d="M4 4h8M4 8h8M4 12h5"/><rect x="2" y="2" width="12" height="12" rx="2"/>';
    const gPath = '<path d="M3 8l3 3 7-7"/>';

    if(pendSorties.length){
      alertHtml += `<div class="saas-alert-item" onclick="nav('sorties',null)">
        ${icAlert('#FEF2F2', '#EF4444', oPath)}
        <div class="saas-alert-content"><div class="saas-alert-title">${pendSorties.length} sortie(s) en attente</div><div class="saas-alert-desc">À valider par le comptable</div></div>
        <div class="saas-alert-arrow">›</div>
      </div>`;
    }
    if(alerte.length){
      alertHtml += `<div class="saas-alert-item" onclick="nav('fiches',null)">
        ${icAlert('#FEF0C7', '#D97706', aPath)}
        <div class="saas-alert-content"><div class="saas-alert-title">${alerte.length} plans à réviser</div><div class="saas-alert-desc">Biens totalement amortis</div></div>
        <div class="saas-alert-arrow">›</div>
      </div>`;
    }
    alertHtml += `<div class="saas-alert-item">
      ${icAlert('#EFF6FF', '#2563EB', pPath)}
      <div class="saas-alert-content"><div class="saas-alert-title">Inventaire à venir</div><div class="saas-alert-desc">Prochain inventaire le 31/12/${yr}</div></div>
      <div class="saas-alert-arrow">›</div>
    </div>`;
    if(!pendSorties.length && !alerte.length){
      alertHtml += `<div class="saas-alert-item">
        ${icAlert('#ECFDF5', '#10B981', gPath)}
        <div class="saas-alert-content"><div class="saas-alert-title">Aucune anomalie</div><div class="saas-alert-desc">Tout est en ordre 👍</div></div>
        <div class="saas-alert-arrow">›</div>
      </div>`;
    }
    saasAlert.innerHTML = alertHtml;
    
    // Update badge in sidebar just in case
    const nbadge = document.getElementById('nb-alerte');
    if(nbadge) {
      nbadge.textContent=(alerte.length+pendSorties.length)||'';
      nbadge.style.display=(alerte.length+pendSorties.length)?'':'none';
    }
  }

  // === 5. Initialize Chart.js ===
  if(typeof Chart !== 'undefined') {
    // 5a. Vue d'ensemble (6 KPIs)
    const ovGrid = document.getElementById('saas-overview-grid');
    if(ovGrid) {
      const nbImmos = immos.length;
      const nwThisMonth = immos.filter(i=>{const d=new Date(i.dateAcq); const n=new Date(); return d.getMonth()===n.getMonth() && d.getFullYear()===n.getFullYear();}).length;
      const tauxMoy = tVO > 0 ? ((tDot / tVO)*100).toFixed(1) : 0;
      const vRes = F(tVNC);

      const ic1 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>';
      const ic2 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>';
      const ic3 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
      const ic4 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>';
      const ic5 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
      const ic6 = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';

      ovGrid.innerHTML = `
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#e8f4fd;color:#2563eb">${ic1}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Nombre d'immobilisations</div>
            <div class="saas-overview-val">${nbImmos}</div>
            <div class="saas-overview-sub">Actifs enregistrés</div>
          </div>
        </div>
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#ecfdf5;color:#10b981">${ic2}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Nouvelles acquisitions</div>
            <div class="saas-overview-val">${nwThisMonth}</div>
            <div class="saas-overview-sub">Ce mois</div>
          </div>
        </div>
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#fef3c7;color:#d97706">${ic3}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Immobilisations en cours</div>
            <div class="saas-overview-val">0</div>
            <div class="saas-overview-sub">En cours d'acquisition</div>
          </div>
        </div>
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#fee2e2;color:#ef4444">${ic4}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Taux d'amortissement moyen</div>
            <div class="saas-overview-val">${tauxMoy}%</div>
            <div class="saas-overview-sub">Du total amortissable</div>
          </div>
        </div>
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#f3e8ff;color:#9333ea">${ic5}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Valeur résiduelle</div>
            <div class="saas-overview-val">${vRes} <span style="font-size:0.75em;color:var(--text3)">FCFA</span></div>
            <div class="saas-overview-sub">Valeur nette estimée</div>
          </div>
        </div>
        <div class="saas-overview-kpi">
          <div class="saas-overview-icon" style="background:#f3f4f6;color:#4b5563">${ic6}</div>
          <div class="saas-overview-content">
            <div class="saas-overview-title">Documents associés</div>
            <div class="saas-overview-val">0</div>
            <div class="saas-overview-sub">Pièces enregistrées</div>
          </div>
        </div>
      `;
    }

    // 5b. Donut Chart
    const ctxDonut = document.getElementById('saasDonutChart');
    if(ctxDonut) {
      if(window.saasDonutInst) window.saasDonutInst.destroy();
      
      const bc={};
      immos.forEach(im=>{
        if(!bc[im.categorie])bc[im.categorie]=0;
        bc[im.categorie]+=(im.vo-cumAt(im,TD()));
      });
      const clrs={'Matériel informatique':'#137A47','Matériel de transport':'#F59E0B','Mobilier de bureau':'#8B5CF6','Immobilisations incorporelles':'#10B981','Autres matériels':'#334155'};
      const sorted = Object.entries(bc).sort((a,b)=>b[1]-a[1]);
      const dLabels = sorted.map(x=>x[0]);
      const dData = sorted.map(x=>x[1]);
      const dColors = dLabels.map(cat => clrs[cat]||'#2563EB');

      window.saasDonutInst = new Chart(ctxDonut, {
        type: 'doughnut',
        data: {
          labels: dLabels,
          datasets: [{ data: dData, backgroundColor: dColors, borderWidth: 0, cutout: '75%' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(context) { return ' ' + F(context.parsed) + ' FCFA'; } } } }
        }
      });
      
      // Donut Legend & Center
      const totalVnc = dData.reduce((a,b)=>a+b, 0);
      const dTotalDiv = document.getElementById('saas-donut-total');
      if(dTotalDiv) dTotalDiv.textContent = F(totalVnc);
      
      const legDiv = document.getElementById('saas-donut-legend');
      if(legDiv) {
        legDiv.innerHTML = sorted.map((s,i) => `
          <div class="saas-legend-item">
            <div class="saas-legend-left">
              <div class="saas-legend-dot" style="background:${dColors[i]}"></div>
              ${s[0]}
            </div>
            <div class="saas-legend-right">
              <div class="saas-legend-val">${F(s[1])}</div>
              <div class="saas-legend-pct">${totalVnc>0?((s[1]/totalVnc)*100).toFixed(1):0}%</div>
            </div>
          </div>
        `).join('');
      }
    }
  }
}

// ── FICHES ──
let vMode='table';
function setView(v){
  vMode=v;
  document.getElementById('ftv').style.display=v==='table'?'block':'none';
  document.getElementById('fcv').style.display=v==='cards'?'block':'none';
  document.getElementById('vbt').classList.toggle('active',v==='table');
  document.getElementById('vbc').classList.toggle('active',v==='cards');
  rdFiches();
}
function filt(){
  const qEl=document.getElementById('flt-search');
  const catEl=document.getElementById('flt-cat');
  const stEl=document.getElementById('flt-st');
  const finEl=document.getElementById('flt-fin');
  const q=qEl?(qEl.value||'').toLowerCase():'';
  const cat=catEl?catEl.value:'';
  const st=stEl?stEl.value:'';
  const fin=finEl?finEl.value:'';
  return DB.immobilisations.filter(im=>{
    if(q&&!im.code.toLowerCase().includes(q)&&!im.designation.toLowerCase().includes(q)&&!(im.fournisseur||'').toLowerCase().includes(q)&&!(im.affectation||'').toLowerCase().includes(q))return false;
    if(cat&&im.categorie!==cat)return false;
    if(st==='amorti'){const cum=cumAt(im,new Date().toISOString().split('T')[0]);if(im.statut==='sorti'||im.vo-cum>0)return false;}
    else if(st&&im.statut!==st)return false;
    if(fin&&im.financement!==fin)return false;
    return true;
  });
}
function rdFiches(){
  const list=filt();
  document.getElementById('fiches-count').textContent=`${list.length} immobilisation(s) • ${DB.immobilisations.filter(i=>i.statut==='actif').length} actives`;
  if(vMode==='table'){
    document.getElementById('ftb').innerHTML=list.map((im,_idx)=>{
      const cum=cumAt(im,TD()),vnc=im.vo-cum;
      return`<tr class="clk" onclick="openDet('${im.id}')">
        <td class="center" style="color:var(--text3);font-size:11px;font-family:var(--m)">${_idx+1}</td>
        <td class="no-trunc"><code class="tc-sm" title="${escapeHtml(im.code)}">${escapeHtml(im.code)}</code></td>
        <td><span class="tc-lg" title="${escapeHtml(im.designation)}">${escapeHtml(im.designation)}</span></td>
        <td class="no-trunc"><span class="badge ${CC(im.categorie)} tc-sm" title="${im.categorie}" style="max-width:110px">${im.categorie}</span></td>
        <td class="no-trunc"><span class="badge ${im.financement==='Subventions'?'b':'g'}">${im.financement==='Subventions'?'Subv.':'F. propres'}</span></td>
        <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${F(im.vo)}</td>
        <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${(im.taux*100).toFixed(1)}%</td>
        <td class="no-trunc" style="font-family:var(--m);font-size:12px;color:var(--red);text-align:right">${F(cum)}</td>
        <td class="no-trunc" style="font-family:var(--m);font-size:12px;color:${vnc<=0?'var(--red)':'var(--green)'};text-align:right">${F(vnc)}</td>
        <td><span class="tc-sm" title="${escapeHtml(im.affectation||'')}" style="font-size:12px;color:var(--text3)">${escapeHtml(im.affectation||'')}</span></td>
        <td class="no-trunc"><span class="st ${im.statut}">${im.statut==='actif'?'Actif':'Sorti'}</span></td>
        <td onclick="event.stopPropagation()" class="no-trunc" style="text-align:center">
          <button class="btn xs" onclick="openDet('${im.id}')" title="Voir la fiche" style="padding:4px 8px;color:var(--blue);border-color:var(--blue-light)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="7" cy="7" rx="6" ry="4"/><circle cx="7" cy="7" r="2" fill="currentColor" stroke="none"/></svg>
          </button>
          <button class="btn xs" onclick="editImmo('${im.id}')" title="Modifier" style="padding:4px 8px">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 2l2 2-7 7H2v-2z"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('')||'<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:2rem">Aucun résultat</td></tr>';
  } else {
    document.getElementById('fcc').innerHTML=list.map(im=>{
      const cum=cumAt(im,TD()),vnc=im.vo-cum,pct=im.vo>0?(cum/im.vo*100):0;
      return`<div class="ic" onclick="openDet('${im.id}')">
        <div class="ic-top"><span class="ic-code">${escapeHtml(im.code)}</span><span class="badge ${CC(im.categorie)}">${im.categorie.split(' ')[0]}</span></div>
        <div class="ic-name">${escapeHtml(im.designation)}</div>
        <div class="ic-cat">${escapeHtml(im.nature||'')} • ${escapeHtml(im.affectation||'')}</div>
        <div class="progress" style="margin-top:.5rem"><div class="pf" style="width:${pct.toFixed(0)}%"></div></div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px">${pct.toFixed(0)}% amorti</div>
        <div class="ic-vals">
          <div class="ic-val">V. Origine<strong>${F(im.vo)}</strong></div>
          <div class="ic-val">VNC<strong style="color:${vnc<=0?'var(--red)':'var(--green)'}">${F(vnc)}</strong></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--border)" onclick="event.stopPropagation()">
          <button class="btn xs" style="flex:1;justify-content:center;color:var(--blue);border-color:var(--blue-light)" onclick="openDet('${im.id}')" title="Voir la fiche">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="7" cy="7" rx="6" ry="4"/><circle cx="7" cy="7" r="2" fill="currentColor" stroke="none"/></svg>
            Voir
          </button>
          <button class="btn xs" onclick="editImmo('${im.id}')" title="Modifier">
            <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 2l2 2-7 7H2v-2z"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');
  }
}

// ── DETAIL ──
let curDetId=null;
function openDet(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  curDetId=id;
  const cum=cumAt(im,TD()),vnc=im.vo-cum;
  document.getElementById('det-title').textContent=im.designation;
  document.getElementById('det-sub').textContent=im.code+(im.invNum?' • Étiq: '+im.invNum:'')+(im.serie?' • S/N: '+im.serie:'')+' • '+im.categorie;
  const ETAT_LBL={bon:'Bon état',usage:'Usagé',degrade:'Dégradé',horsservice:'Hors service'};
  const ETAT_COL={bon:'g',usage:'a',degrade:'r',horsservice:'r'};
  const etatLbl=ETAT_LBL[im.etat||'bon'];
  const etatCol=ETAT_COL[im.etat||'bon'];
  const fiscalInfo=im.fiscal&&im.fiscal.duree>0?`Fiscal : ${im.fiscal.methode==='lin'?'Linéaire':'Dégressif'} — ${im.fiscal.duree} ans (${(im.fiscal.taux*100).toFixed(2)}%)`:'Non';
  const fields=[
    ['Code',`<code>\</code>`],['N° inventaire',im.invNum?`<code>\</code>`:'—'],
    ['Désignation',im.designation],['Plan comptable',im.classSYSCOA||'—'],
    ['Catégorie',`<span class="badge ${CC(im.categorie)}">${im.categorie}</span>`],['État physique',`<span class="badge ${etatCol}">${etatLbl}</span>`],
    ['Financement',`<span class="badge ${im.financement==='Subventions'?'b':'g'}">${im.financement}</span>`],['Marque / Modèle',im.marque||im.nature||'—'],
    ['N° facture',im.factureNum?`<code>${im.factureNum}</code>`:'—'],['Fournisseur',im.fournisseur||'—'],
    ['Affectation',im.affectation||'—'],['Centre de coût',im.centreCoût?`<code style="color:var(--blue)">${im.centreCoût}</code>`:'—'],
    ['Axe analytique',im.axe?`<span class="badge b" style="font-size:11px">${im.axe}</span>`:'—'],["Date d'acquisition",FD(im.dateAcq)],
    ['Date mise en service',FD(im.dateMis||im.dateAcq)],
    ["Valeur d'origine",`<strong style="font-family:var(--m)">${F(im.vo)} FCFA</strong>`],['Valeur résiduelle',`<span style="font-family:var(--m)">${F(im.vr||0)} FCFA</span>`],
    ['Méthode éco.',im.methode==='lin'?'Linéaire':'Dégressif'],['Durée & taux éco.',`${im.duree} ans — ${(im.taux*100).toFixed(2)}%`],
    ['Amort. dérogatoire',fiscalInfo],['Calendrier',`${im.cal||360} jours`],
    ['Cumul amortissements',`<span style="color:var(--red);font-family:var(--m)">${F(cum)} FCFA</span>`],['VNC actuelle',`<strong style="color:${vnc<=0?'var(--red)':'var(--green)'};font-family:var(--m)">${F(vnc)} FCFA</strong>`],
    ['Compte immo.',`<code>${im.ci||'—'}</code>`],['Compte amort.',`<code>${im.ca||'—'}</code>`],
  ];
  document.getElementById('det-grid').innerHTML=`
    <div style="grid-column:1/-1;display:flex;gap:1rem;align-items:flex-start">
      <div style="flex:1">${fields.map(([k,v])=>`<div style="padding:7px 10px;background:var(--surface2);border-radius:var(--r);margin-bottom:6px;display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center"><div style="font-size:11px;color:var(--text3)">${k}</div><div style="font-size:13px">${v}</div></div>`).join('')}</div>
      <div style="flex-shrink:0;text-align:center">
        <div id="det-qr" style="padding:8px;background:#fff;border-radius:8px;border:1px solid var(--border);display:inline-block"></div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">\</div>
        <button class="btn xs" onclick="printQR('${im.id}')" style="margin-top:6px;font-size:11px">🖨 Imprimer étiquette</button>
      </div>
    </div>`;
  genQR(im.code+'\n'+(im.invNum||im.designation),document.getElementById('det-qr'));
  const plan=buildPlan(im);
  const _hasComp=!!(im.composants&&im.composants.length>0);
  // Bannière composants
  const _cb=document.getElementById('det-comp-banner');if(_cb)_cb.style.display=_hasComp?'block':'none';
  const _cth=document.getElementById('comp-detail-th');if(_cth)_cth.style.display=_hasComp?'':'none';
  let fiscalRows='';
  if(im.fiscal&&im.fiscal.duree>0){
    const fplan=buildPlan({...im,methode:im.fiscal.methode,duree:im.fiscal.duree,taux:im.fiscal.taux,composants:undefined});
    const _nc=_hasComp?7:6;
    fiscalRows=`<tr><td colspan="${_nc}" style="background:var(--amber-light);color:var(--amber);font-weight:600;font-size:11px;padding:4px 8px">AMORTISSEMENT FISCAL (dérogatoire)</td></tr>`+
      fplan.map(r=>`<tr style="opacity:.8"><td>${r.yr} F</td><td class="n">${F(r.vd)}</td><td class="n">${(r.rt*100).toFixed(2)}%</td><td class="n" style="color:var(--amber)">${F(r.dt)}</td><td class="n">${F(r.cum)}</td><td class="n" style="color:${r.vnc<=0?'var(--red)':'inherit'}">${F(r.vnc)}</td>${_hasComp?'<td></td>':''}</tr>`).join('');
  }
  document.getElementById('det-amtb').innerHTML=plan.map(r=>{
    const det=_hasComp&&r.detail?`<td style="font-size:10px;color:var(--text3);line-height:1.6">${r.detail.map(d=>`<span style="display:block"><b>${d.designation.substring(0,18)}</b> ${F(d.dt)}</span>`).join('')}</td>`:'';
    return`<tr><td>${r.yr}</td><td class="n">${F(r.vd)}</td><td class="n">${(r.rt*100).toFixed(2)}%</td><td class="n">${F(r.dt)}</td><td class="n">${F(r.cum)}</td><td class="n" style="color:${r.vnc<=0?'var(--red)':'inherit'}">${F(r.vnc)}</td>${det}</tr>`;
  }).join('')+fiscalRows;
  const histAff=DB.affectations.filter(a=>a.immoId===id);
  const logHtml=(im._log||[]).length?`<div style="margin-top:1rem"><div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:6px">Journal des modifications</div>`+im._log.slice().reverse().map(l=>`<div style="font-size:12px;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border)"><span style="font-family:var(--m)">${l.ts.split('T')[0]}</span> — ${l.by} — ${l.action}</div>`).join('')+'</div>':'';
  document.getElementById('det-hist').innerHTML=(histAff.length?`<table><thead><tr><th>Date</th><th>De</th><th>Vers</th><th>Responsable</th><th>Motif</th></tr></thead><tbody>${histAff.map(a=>`<tr><td>${FD(a.date)}</td><td>${a.ancien}</td><td>${a.nouveau}</td><td>${a.resp||'—'}</td><td>\</td></tr>`).join('')}</tbody></table>`:`<p style="color:var(--text3);font-size:13px;padding:.5rem 0">Aucun mouvement enregistré.</p>`)+logHtml;
  document.querySelectorAll('#m-detail .tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  document.querySelectorAll('#m-detail .tp').forEach((p,i)=>p.classList.toggle('active',i===0));
  document.getElementById('btn-det-sort').onclick=()=>{closeM('m-detail');openSortie(id)};
  const printBtn=document.getElementById('btn-det-print');
  if(printBtn) printBtn.onclick=()=>printFiche(id);
  document.getElementById('btn-det-edit').onclick=()=>editImmo(id);
  document.getElementById('btn-det-del').onclick=()=>delImmo(id);
  openM('m-detail');
  loadDetTabs(id);
}

// ── QR CODE (simple SVG basé sur les données) ──
function genQR(text, container){
  if(!container)return;
  // QR code simple via qrcode CDN
  container.innerHTML='';
  try{
    const size=100;
    // Fallback: afficher le texte en petit si pas de lib
    const d=document.createElement('div');
    d.style.cssText=`width:${size}px;height:${size}px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;color:#333;text-align:center;padding:4px;word-break:break-all;font-family:monospace`;
    d.textContent=text.split('\n')[0];
    container.appendChild(d);
  }catch(e){console.warn('Erreur génération code-barre', e); toast('Erreur génération code-barre', 'e');}
}
function printQR(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const ent=DB.params.entite||{};
  const w=window.open('','_blank','width=400,height=350');
  if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette \</title>
  <style>body{font-family:Arial,sans-serif;padding:20px;display:flex;justify-content:center}
  .tag{border:2px solid #000;border-radius:8px;padding:16px;width:280px;text-align:center}
  .org{font-size:11px;color:#666;margin-bottom:8px}
  .code{font-size:18px;font-weight:700;font-family:monospace;margin:8px 0;color:#1A5FB4}
  .des{font-size:12px;margin:4px 0}
  .meta{font-size:10px;color:#666;margin-top:8px;border-top:1px solid #eee;padding-top:8px}
  @media print{button{display:none}}
  </style></head><body>
  <div class="tag">
    <div class="org">${escapeHtml(ent.rs||'Organisation')}</div>
    <div style="font-size:40px;margin:8px 0">📦</div>
    <div class="code">\</div>
    ${im.invNum?`<div style="font-size:12px;color:#666">Inv. : \</div>`:''}
    <div class="des">\</div>
    <div class="meta">
      ${im.categorie} • ${FD(im.dateAcq)}<br>
      V.O. : ${F(im.vo)} FCFA
    </div>
    <button onclick="window.print()" style="margin-top:12px;padding:6px 16px;background:#1A5FB4;color:#fff;border:none;border-radius:4px;cursor:pointer">🖨 Imprimer</button>
  </div>
  </body></html>`);
  w.document.close();
}

// ── IMPRESSION FICHE PDF ──
function printFiche(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const cum=cumAt(im,TD());
  const vnc=Math.max(0,im.vo-cum);
  const pct=im.vo>0?(cum/im.vo*100).toFixed(1):0;
  const plan=buildPlan(im);
  const ent=DB.params.entite||{};
  const today=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const histAff=DB.affectations.filter(a=>a.immoId===id);

  // Barre de progression SVG
  const barW=400,barFill=Math.min(+pct,100);
  const progressBar=`<svg width="${barW}" height="14" style="display:block;margin-top:4px"><rect width="${barW}" height="14" rx="7" fill="#E8EDF7"/><rect width="${barW*barFill/100}" height="14" rx="7" fill="${+pct>=100?'#991B1B':'#1A5FB4'}"/><text x="${barW/2}" y="10.5" text-anchor="middle" font-size="9" fill="white" font-family="Arial" font-weight="600">${pct}% amorti</text></svg>`;

  // Tableau plan d'amortissement
  const planRows=plan.map(r=>`<tr>
    <td>${r.yr}</td>
    <td>${F(r.vd)}</td>
    <td>${(r.rt*100).toFixed(2)}%</td>
    <td><strong>${F(r.dt)}</strong></td>
    <td>${F(r.cum)}</td>
    <td style="color:${r.vnc<=0?'#991B1B':'#166534'};font-weight:${r.vnc<=0?'700':'400'}">${F(r.vnc)}</td>
  </tr>`).join('');

  // Historique affectations
  const histRows=histAff.length
    ?histAff.map(a=>`<tr><td>${FD(a.date)}</td><td>${escapeHtml(a.ancien)}</td><td>${escapeHtml(a.nouveau)}</td><td>${escapeHtml(a.resp||'—')}</td><td>${escapeHtml(a.motif||'—')}</td></tr>`).join('')
    :(im.affectation?`<tr><td>${FD(im.dateAcq)}</td><td>—</td><td>${escapeHtml(im.affectation)}</td><td>—</td><td>Affectation initiale</td></tr>`:'<tr><td colspan="5" style="color:#6B7280;font-style:italic">Aucun mouvement enregistré</td></tr>');

  const html=`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Fiche — ${escapeHtml(im.code)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111827;background:#fff;padding:28px 32px}
  /* EN-TÊTE ORGANISATION */
  .org-header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:14px;border-bottom:2px solid #1A5FB4;margin-bottom:18px}
  .org-name{font-size:17px;font-weight:700;color:#0F2252;letter-spacing:-.3px}
  .org-meta{font-size:10px;color:#6B7280;margin-top:3px;line-height:1.6}
  .doc-label{text-align:right}
  .doc-label .badge{display:inline-block;background:#1A5FB4;color:#fff;font-size:10px;font-weight:600;padding:3px 10px;border-radius:12px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px}
  .doc-label .date{font-size:10px;color:#6B7280}
  .doc-label .ref{font-size:11px;font-weight:600;color:#1A5FB4;margin-top:2px}
  /* TITRE FICHE */
  .fiche-header{background:linear-gradient(135deg,#0F2252 0%,#1A5FB4 100%);color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:16px;display:flex;align-items:center;gap:14px}
  .fiche-code{font-family:monospace;font-size:11px;background:rgba(255,255,255,.2);padding:3px 9px;border-radius:4px;letter-spacing:.05em}
  .fiche-title{font-size:15px;font-weight:700;margin-top:4px;line-height:1.2}
  .fiche-cat{font-size:10px;opacity:.8;margin-top:3px}
  /* KPI STRIP */
  .kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
  .kpi{background:#F5F7FC;border:1px solid #DDE5F3;border-radius:8px;padding:10px 12px}
  .kpi-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:4px}
  .kpi-val{font-size:16px;font-weight:700;line-height:1;font-family:monospace}
  .kpi-val.blue{color:#1A5FB4}.kpi-val.red{color:#991B1B}.kpi-val.green{color:#166534}.kpi-val.amber{color:#92400E}
  /* GRILLE INFOS */
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1A5FB4;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #DDE5F3}
  .info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px}
  .info-cell{background:#F5F7FC;border:1px solid #DDE5F3;border-radius:6px;padding:8px 10px}
  .info-cell .lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6B7280;margin-bottom:3px}
  .info-cell .val{font-size:12px;font-weight:500;color:#111827}
  .info-cell .val.mono{font-family:monospace}
  /* TABLEAU */
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px}
  thead th{background:#1A5FB4;color:#fff;padding:7px 10px;text-align:right;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  thead th:first-child{text-align:left;border-radius:4px 0 0 0}
  thead th:last-child{border-radius:0 4px 0 0}
  tbody td{padding:7px 10px;border-bottom:1px solid #EEF1F8;text-align:right;font-family:monospace}
  tbody td:first-child{text-align:left;font-family:'Segoe UI',Arial,sans-serif;font-weight:500}
  tbody tr:nth-child(even){background:#F8FAFF}
  tbody tr:last-child td{font-weight:700;background:#EFF3FA}
  tfoot td{padding:8px 10px;background:#DBEAFE;color:#1A5FB4;font-weight:700;border-top:2px solid #1A5FB4;text-align:right;font-family:monospace}
  tfoot td:first-child{text-align:left;font-family:'Segoe UI',Arial,sans-serif}
  /* FOOTER */
  .page-footer{margin-top:22px;padding-top:10px;border-top:1px solid #DDE5F3;display:flex;justify-content:space-between;font-size:9px;color:#9CA3AF}
  .signature-block{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:18px}
  .sig-box{border-top:1px solid #6B7280;padding-top:6px;font-size:10px;color:#6B7280}
  @media print{
    body{padding:14px 18px}
    @page{size:A4;margin:14mm 14mm 14mm 14mm}
    .no-print{display:none}
  }
</style>
</head><body>

<!-- BOUTON IMPRESSION -->
<div class="no-print" style="text-align:right;margin-bottom:16px">
  <button onclick="window.print()" style="background:#1A5FB4;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:500">
    Imprimer / Enregistrer en PDF
  </button>
</div>

<!-- EN-TÊTE ORGANISATION -->
<div class="org-header">
  <div style="display:flex;align-items:center;gap:14px">
    ${ent.logo?`<img src="${ent.logo}" style="max-height:56px;max-width:130px;object-fit:contain;flex-shrink:0" alt="Logo">`:''}
    <div>
      <div class="org-name">${escapeHtml(ent.rs||'Organisation')}</div>
      <div class="org-meta">
        ${ent.adresse?ent.adresse+'<br>':''}
        ${ent.tel?'Tél : '+ent.tel+'  ':''}${ent.email?'Email : '+ent.email:''}
        ${ent.ninea?'<br>NINEA : '+ent.ninea:''}
      </div>
    </div>
  </div>
  <div class="doc-label">
    <div class="badge">Fiche d'immobilisation</div>
    <div class="date">Édité le ${today}</div>
    <div class="ref">${escapeHtml(im.code)}</div>
  </div>
</div>

<!-- TITRE FICHE -->
<div class="fiche-header">
  <div style="flex:1">
    <div class="fiche-code">${escapeHtml(im.code)}</div>
    <div class="fiche-title">${escapeHtml(im.designation)}</div>
    <div class="fiche-cat">${escapeHtml(im.categorie)} • ${im.methode==='lin'?'Amortissement linéaire':'Amortissement dégressif'} • ${im.duree} ans</div>
  </div>
  <div style="text-align:right;opacity:.85">
    <div style="font-size:10px;margin-bottom:3px">Date d'acquisition</div>
    <div style="font-size:14px;font-weight:700">${FD(im.dateAcq)}</div>
  </div>
</div>

<!-- KPI STRIP -->
<div class="kpi-strip">
  <div class="kpi"><div class="kpi-lbl">Valeur d'origine</div><div class="kpi-val blue">${F(im.vo)}</div><div style="font-size:9px;color:#6B7280;margin-top:2px">FCFA</div></div>
  <div class="kpi"><div class="kpi-lbl">Cumul amorti</div><div class="kpi-val red">${F(cum)}</div><div style="font-size:9px;color:#6B7280;margin-top:2px">FCFA</div></div>
  <div class="kpi"><div class="kpi-lbl">VNC actuelle</div><div class="kpi-val ${vnc<=0?'red':'green'}">${F(vnc)}</div><div style="font-size:9px;color:#6B7280;margin-top:2px">FCFA</div></div>
  <div class="kpi"><div class="kpi-lbl">Taux annuel</div><div class="kpi-val amber">${(im.taux*100).toFixed(2)}%</div><div style="font-size:9px;color:#6B7280;margin-top:2px">${im.duree} ans</div></div>
</div>

<!-- BARRE D'AVANCEMENT -->
<div style="margin-bottom:14px">${progressBar}</div>

<!-- INFORMATIONS GÉNÉRALES -->
<div class="section-title">Informations générales</div>
<div class="info-grid">
  <div class="info-cell"><div class="lbl">Désignation</div><div class="val">${escapeHtml(im.designation)}</div></div>
  <div class="info-cell"><div class="lbl">Catégorie</div><div class="val">${escapeHtml(im.categorie)}</div></div>
  <div class="info-cell"><div class="lbl">Nature</div><div class="val">${escapeHtml(im.nature||'—')}</div></div>
  <div class="info-cell"><div class="lbl">Fournisseur</div><div class="val">${escapeHtml(im.fournisseur||'—')}</div></div>
  <div class="info-cell"><div class="lbl">Financement</div><div class="val">${escapeHtml(im.financement||'—')}</div></div>
  <div class="info-cell"><div class="lbl">Affectation actuelle</div><div class="val">${escapeHtml(im.affectation||'—')}</div></div>
</div>

<!-- INFORMATIONS COMPTABLES -->
<div class="section-title">Paramètres comptables</div>
<div class="info-grid">
  <div class="info-cell"><div class="lbl">Méthode</div><div class="val">${im.methode==='lin'?'Linéaire':'Dégressif'}</div></div>
  <div class="info-cell"><div class="lbl">Durée / Taux</div><div class="val">${im.duree} ans — ${(im.taux*100).toFixed(2)}%</div></div>
  <div class="info-cell"><div class="lbl">Calendrier</div><div class="val">${im.cal||360} jours</div></div>
  <div class="info-cell"><div class="lbl">Compte immobilisation</div><div class="val mono">${im.ci||'—'}</div></div>
  <div class="info-cell"><div class="lbl">Compte amortissement</div><div class="val mono">${im.ca||'—'}</div></div>
  <div class="info-cell"><div class="lbl">Statut</div><div class="val">${im.statut==='actif'?'Actif':'Sorti'}</div></div>
</div>

<!-- PLAN D'AMORTISSEMENT -->
<div class="section-title">Plan d'amortissement</div>
<table>
  <thead><tr>
    <th style="text-align:left">Exercice</th>
    <th>V. Début</th><th>Taux</th><th>Dotation</th><th>Cumul</th><th>VNC Fin</th>
  </tr></thead>
  <tbody>${planRows}</tbody>
  <tfoot><tr>
    <td>TOTAL</td><td></td><td></td>
    <td>${F(plan.reduce((a,r)=>a+r.dt,0))}</td>
    <td>${F(cum)}</td>
    <td>${F(vnc)}</td>
  </tr></tfoot>
</table>

<!-- HISTORIQUE DES AFFECTATIONS -->
<div class="section-title">Historique des affectations</div>
<table>
  <thead><tr>
    <th style="text-align:left">Date</th>
    <th style="text-align:left">Précédente</th>
    <th style="text-align:left">Nouvelle</th>
    <th style="text-align:left">Responsable</th>
    <th style="text-align:left">Motif</th>
  </tr></thead>
  <tbody>${histRows}</tbody>
</table>

<!-- SIGNATURES -->
<div class="signature-block">
  <div class="sig-box">Le Gestionnaire des actifs<br><br><br></div>
  <div class="sig-box">Le Responsable financier<br><br><br></div>
</div>

<!-- FOOTER -->
<div class="page-footer">
  <span>ImmoGestion — Fiche d'immobilisation — ${escapeHtml(im.code)}</span>
  <span>Document généré le ${today}</span>
</div>

<scr` + `ipt>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));<\/script>
</body></html>`;

  const w=window.open('','_blank','width=900,height=700');
  if(!w){toast('Autorisez les popups pour imprimer','e');return;}
  w.document.write(html);
  w.document.close();
}
// ══════════════════════════════════════════
// PIÈCES JOINTES (base64)
// ══════════════════════════════════════════
let _pjTemp = [];  // pièces jointes temporaires pendant la saisie d'une nouvelle fiche

function handlePJ(files){
  Array.from(files).forEach(f=>{
    if(f.size>1.2*1024*1024){toast(f.name+' dépasse 1 Mo — ignoré','e');return;}
    const r=new FileReader();
    r.onload=ev=>{
      const pj={name:f.name,type:f.type,size:f.size,data:ev.target.result,date:TD()};
      _pjTemp.push(pj);
      renderPJList(document.getElementById('pj-list'),_pjTemp,true);
    };
    r.readAsDataURL(f);
  });
  document.getElementById('pj-input').value='';
}
function renderPJList(container,pjs,editable){
  if(!container)return;
  container.innerHTML=pjs.map((pj,i)=>{
    const isImg=pj.type&&pj.type.startsWith('image/');
    const icon=isImg?`<img src="${pj.data}" style="width:100%;height:52px;object-fit:cover;border-radius:4px 4px 0 0">`
      :`<div style="width:100%;height:52px;background:var(--surface2);display:flex;align-items:center;justify-content:center;border-radius:4px 4px 0 0;font-size:20px">${pj.type?.includes('pdf')?'📄':pj.type?.includes('sheet')||pj.type?.includes('excel')?'📊':'📎'}</div>`;
    return`<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;width:130px;flex-shrink:0">
      <div onclick="previewPJ(${i})" style="cursor:pointer">${icon}</div>
      <div style="padding:5px 6px;font-size:10px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${pj.name}">${pj.name}</div>
      <div style="display:flex;gap:2px;padding:0 4px 4px">
        <button class="btn xs" onclick="downloadPJ(${i})" style="flex:1;font-size:10px">⬇</button>
        ${editable?`<button class="btn xs d" onclick="delPJTemp(${i})" style="font-size:10px">×</button>`:''}
      </div>
    </div>`;
  }).join('');
}
function previewPJ(i){
  const pjs=_pjTemp;
  const pj=pjs[i];if(!pj)return;
  if(pj.type?.startsWith('image/')){const w=window.open('','_blank');w.document.write(`<img src="${pj.data}" style="max-width:100%">`);w.document.close();}
  else{downloadPJ(i);}
}
function downloadPJ(i){
  const pj=_pjTemp[i];if(!pj)return;
  const a=document.createElement('a');a.href=pj.data;a.download=pj.name;a.click();
}
function delPJTemp(i){_pjTemp.splice(i,1);renderPJList(document.getElementById('pj-list'),_pjTemp,true);}

// PJ sur fiche existante
function handlePJDet(files){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  if(!im.pj)im.pj=[];
  let pending=files.length;
  Array.from(files).forEach(f=>{
    if(f.size>1.2*1024*1024){toast(f.name+' dépasse 1 Mo','e');pending--;return;}
    const r=new FileReader();
    r.onload=ev=>{
      im.pj.push({name:f.name,type:f.type,size:f.size,data:ev.target.result,date:TD(),by:currentUser?.nom||'?'});
      pending--;
      if(pending<=0){dbSave();loadPJDet(curDetId);toast('Pièce(s) jointe(s) enregistrée(s)');}
    };
    r.readAsDataURL(f);
  });
  document.getElementById('pj-det-input').value='';
}
function loadPJDet(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const pjs=im.pj||[];
  const badge=document.getElementById('det-pj-count');
  if(badge){badge.textContent=pjs.length;badge.style.display=pjs.length?'':'none';}
  const grid=document.getElementById('det-pj-grid');if(!grid)return;
  grid.innerHTML=pjs.map((pj,i)=>{
    const isImg=pj.type&&pj.type.startsWith('image/');
    const icon=isImg?`<img src="${pj.data}" style="width:100%;height:60px;object-fit:cover;border-radius:4px 4px 0 0">`
      :`<div style="width:100%;height:60px;background:var(--surface2);display:flex;align-items:center;justify-content:center;border-radius:4px 4px 0 0;font-size:24px">${pj.type?.includes('pdf')?'📄':pj.type?.includes('sheet')||pj.type?.includes('excel')?'📊':'📎'}</div>`;
    return`<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <div onclick="previewPJDet('${id}',${i})" style="cursor:pointer">${icon}</div>
      <div style="padding:5px 6px">
        <div style="font-size:10px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px" title="${pj.name}">${pj.name}</div>
        <div style="font-size:9px;color:var(--text3)">${pj.date||''} — ${pj.by||''}</div>
        <div style="display:flex;gap:3px;margin-top:4px">
          <button class="btn xs" onclick="downloadPJDet('${id}',${i})" style="flex:1;font-size:10px">⬇</button>
          <button class="btn xs d" onclick="delPJDet('${id}',${i})" style="font-size:10px">×</button>
        </div>
      </div>
    </div>`;
  }).join('')||'<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:2rem;font-size:13px">Aucune pièce jointe — cliquez "Ajouter" pour joindre une facture ou photo.</div>';
}
function previewPJDet(id,i){const im=DB.immobilisations.find(x=>x.id===id);const pj=im?.pj?.[i];if(!pj)return;if(pj.type?.startsWith('image/')){const w=window.open('','_blank');w.document.write(`<img src="${pj.data}" style="max-width:100%">`);w.document.close();}else downloadPJDet(id,i);}
function downloadPJDet(id,i){const im=DB.immobilisations.find(x=>x.id===id);const pj=im?.pj?.[i];if(!pj)return;const a=document.createElement('a');a.href=pj.data;a.download=pj.name;a.click();}
function delPJDet(id,i){const im=DB.immobilisations.find(x=>x.id===id);if(!im?.pj)return;if(!confirm('Supprimer cette pièce jointe ?'))return;im.pj.splice(i,1);dbSave();loadPJDet(id);toast('Pièce jointe supprimée');}

// ══════════════════════════════════════════
// AXES ANALYTIQUES & CENTRES DE COÛT
// ══════════════════════════════════════════
function rdAxes(){
  if(!DB.axes)DB.axes=[];
  // Alimenter le select fc-axe dans le formulaire
  const sel=document.getElementById('fc-axe');
  if(sel){
    const prev=sel.value;
    sel.innerHTML='<option value="">— Aucun —</option>'+DB.axes.map(a=>`<option value="\">\ — ${a.lib}</option>`).join('');
    if(DB.axes.find(a=>a.code===prev))sel.value=prev;
  }
  // Alimenter datalist cc-list
  const dl=document.getElementById('cc-list');
  if(dl)dl.innerHTML=DB.axes.map(a=>`<option value="\">\ — ${a.lib}</option>`).join('');
  // Rendre la liste dans les paramètres
  const list=document.getElementById('axe-list');if(!list)return;
  list.innerHTML=DB.axes.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--surface2);border-radius:var(--r)">
      <code style="color:var(--blue);font-size:12px;min-width:80px">\</code>
      <span style="flex:1;font-size:13px">${a.lib}</span>
      <span class="badge ${a.type==='projet'?'b':a.type==='activite'?'g':a.type==='site'?'a':'gr'}" style="font-size:10px">${a.type}</span>
      <button class="btn xs d" onclick="delAxe(${i})">×</button>
    </div>`).join('')||'<div style="color:var(--text3);font-size:13px;text-align:center;padding:.75rem">Aucun axe défini</div>';
}
function addAxe(){
  const code=document.getElementById('axe-code').value.trim().toUpperCase();
  const lib=document.getElementById('axe-lib').value.trim();
  const type=document.getElementById('axe-type').value;
  if(!code||!lib){toast('Code et libellé obligatoires','e');return;}
  if(!DB.axes)DB.axes=[];
  if(DB.axes.find(a=>a.code===code)){toast('Ce code existe déjà','e');return;}
  DB.axes.push({code,lib,type});
  document.getElementById('axe-code').value='';document.getElementById('axe-lib').value='';
  dbSave();rdAxes();toast('Axe analytique ajouté');
}
function saveAxe(){addAxe();}
function delAxe(i){
  if(!confirm('Supprimer cet axe ?'))return;
  DB.axes.splice(i,1);dbSave();rdAxes();toast('Axe supprimé');
}
function genRapAnalytique(){
  if(!DB.axes||!DB.axes.length){toast('Définissez d\'abord des axes analytiques','e');return;}
  const yr=new Date().getFullYear();
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const groups={};
  immos.forEach(im=>{
    const cc=im.centreCoût||im.cc||'—';
    const axe=im.axe||'—';
    const key=cc+'||'+axe;
    if(!groups[key])groups[key]={cc,axe,n:0,vo:0,dot:0};
    groups[key].n++;
    groups[key].vo+=im.vo;
    groups[key].dot+=dotPeriod(im,yr,yr);
  });
  const totDot=Object.values(groups).reduce((a,g)=>a+g.dot,0);
  const tb=document.getElementById('axe-rapport-tb');
  if(!tb)return;
  tb.innerHTML=Object.values(groups).sort((a,b)=>b.dot-a.dot).map(g=>`<tr>
    <td style="font-family:var(--m);font-size:12px">${g.cc}</td>
    <td><span class="badge b" style="font-size:10px">${g.axe}</span></td>
    <td>${g.n}</td>
    <td style="font-family:var(--m);font-size:12px;text-align:right">${F(g.vo)}</td>
    <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber)">${F(g.dot)}</td>
    <td style="font-family:var(--m);font-size:12px;text-align:right">${totDot>0?(g.dot/totDot*100).toFixed(1):0}%</td>
  </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1rem">Aucune immobilisation avec centre de coût renseigné</td></tr>';
  const rap=document.getElementById('axe-rapport');if(rap)rap.style.display='block';
}

// ══════════════════════════════════════════
// SYNCHRONISATION CLOUD SUPABASE
// ══════════════════════════════════════════
let _cloudConnected=false;
let _cloudAutoSync=false;
let _cloudSyncInterval=null;

function cloudLog(msg,type){
  const log=document.getElementById('cloud-log');if(!log)return;
  log.style.display='block';
  const ts=new Date().toLocaleTimeString('fr-FR');
  const col=type==='ok'?'var(--green)':type==='err'?'var(--red)':'var(--text3)';
  log.innerHTML=`<span style="color:${col}">[${ts}] ${msg}</span>\n`+log.innerHTML;
}
async function cloudConnect(){
  const url=(document.getElementById('cloud-url').value||'').trim().replace(/\/$/,'');
  const key=(document.getElementById('cloud-key').value||'').trim();
  const table=(document.getElementById('cloud-table').value||'immogestion_data').trim();
  if(!url||!key){toast('URL et clé API obligatoires','e');return;}
  cloudLog('Test de connexion à '+url+'...');
  try{
    // Test : récupérer la liste des tables (endpoint Supabase REST)
    const res=await fetch(`${url}/rest/v1/${table}?select=id&limit=1`,{
      headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    });
    if(res.status===200||res.status===206){
      _cloudConnected=true;
      DB.params.cloud={url,key,table,id:document.getElementById('cloud-id').value||'default'};
      dbSave();
      document.getElementById('cloud-status-badge').textContent='Connecté ✓';
      document.getElementById('cloud-status-badge').className='badge g';
      document.getElementById('btn-cloud-push').style.display='';
      document.getElementById('btn-cloud-pull').style.display='';
      document.getElementById('btn-cloud-sync').style.display='';
      document.getElementById('btn-cloud-disc').style.display='';
      cloudLog('Connexion réussie à '+url,'ok');
      toast('Cloud connecté — '+url);
    } else if(res.status===404){
      cloudLog('Table "'+table+'" introuvable — créez-la dans Supabase','err');
      toast('Table introuvable — consultez le guide Supabase','e');
      showCloudSetupGuide(url,table);
    } else {
      cloudLog('Erreur '+res.status+' — vérifiez votre clé API','err');
      toast('Erreur de connexion : '+res.status,'e');
    }
  }catch(e){
    cloudLog('Impossible d\'atteindre '+url+' — '+e.message,'err');
    toast('Connexion impossible — vérifiez l\'URL','e');
  }
}
async function cloudPush(){
  if(!DB.params.cloud){toast('Non connecté','e');return;}
  const {url,key,table,id}=DB.params.cloud;
  cloudLog('Envoi des données...');
  try{
    const payload={id:id||'default',data:JSON.stringify(DB),updated_at:new Date().toISOString()};
    const res=await fetch(`${url}/rest/v1/${table}`,{
      method:'POST',
      headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify(payload)
    });
    if(res.ok){cloudLog('Données envoyées avec succès','ok');toast('Données synchronisées vers le cloud ✓');}
    else{const err=await res.text();cloudLog('Erreur envoi: '+err,'err');toast('Erreur d\'envoi: '+res.status,'e');}
  }catch(e){cloudLog('Erreur: '+e.message,'err');toast('Erreur réseau','e');}
}
async function cloudPull(){
  if(!DB.params.cloud){toast('Non connecté','e');return;}
  const {url,key,table,id}=DB.params.cloud;
  cloudLog('Récupération des données...');
  try{
    const res=await fetch(`${url}/rest/v1/${table}?id=eq.${id||'default'}&select=data,updated_at`,{
      headers:{'apikey':key,'Authorization':'Bearer '+key}
    });
    if(res.ok){
      const rows=await res.json();
      if(!rows||!rows.length){cloudLog('Aucune donnée trouvée dans le cloud','err');toast('Aucune donnée cloud','e');return;}
      const remote=JSON.parse(rows[0].data);
      if(!confirm(`Remplacer les données locales par la version cloud ?\nDernière mise à jour cloud : ${rows[0].updated_at}`))return;
      const cloudCfg=DB.params.cloud;
      Object.assign(DB,remote);
      DB.params.cloud=cloudCfg;// conserver la config locale
      dbSave();location.reload();
    }else{const err=await res.text();cloudLog('Erreur pull: '+err,'err');toast('Erreur récupération: '+res.status,'e');}
  }catch(e){cloudLog('Erreur: '+e.message,'err');toast('Erreur réseau','e');}
}
function cloudSync(){
  if(_cloudAutoSync){
    clearInterval(_cloudSyncInterval);_cloudAutoSync=false;
    document.getElementById('btn-cloud-sync').textContent='⟳ Synchronisation auto';
    toast('Synchronisation automatique désactivée');
  } else {
    _cloudAutoSync=true;
    document.getElementById('btn-cloud-sync').textContent='⏹ Arrêter la sync auto (30s)';
    cloudPush();
    _cloudSyncInterval=setInterval(cloudPush,30000);
    toast('Synchronisation automatique activée — toutes les 30s');
  }
}
function cloudDisconnect(){
  if(!confirm('Déconnecter le cloud ?'))return;
  _cloudConnected=false;_cloudAutoSync=false;
  clearInterval(_cloudSyncInterval);
  if(DB.params)delete DB.params.cloud;
  dbSave();
  document.getElementById('cloud-status-badge').textContent='Non connecté';
  document.getElementById('cloud-status-badge').className='badge b';
  ['btn-cloud-push','btn-cloud-pull','btn-cloud-sync','btn-cloud-disc'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  toast('Cloud déconnecté');
}
function showCloudSetupGuide(url,table){
  const sql=`-- Créer la table dans Supabase SQL Editor :\nCREATE TABLE ${table} (\n  id TEXT PRIMARY KEY,\n  data JSONB NOT NULL,\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n);\n-- Activer RLS (Row Level Security) :\nALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;\n-- Politique lecture/écriture (API key) :\nCREATE POLICY "Allow all with key" ON ${table}\n  FOR ALL USING (true) WITH CHECK (true);`;
  const w=window.open('','_blank','width=700,height=500');
  if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Guide Supabase</title>
  <style>body{font-family:sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0}h2{color:#60a5fa}pre{background:#1e293b;padding:1rem;border-radius:8px;font-size:13px;overflow-x:auto;white-space:pre-wrap}button{background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}button:hover{background:#2563eb}</style>
  </head><body><h2>Configuration Supabase pour ImmoGestion</h2>
  <p>Copiez et exécutez ce SQL dans l'éditeur SQL de votre projet Supabase :</p>
  <pre>${sql}</pre>
  <button onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent);this.textContent='Copié ✓'">Copier le SQL</button>
  <p style="margin-top:1rem;color:#94a3b8;font-size:13px">URL projet : ${url} | Table : ${table}</p>
  </body></html>`);w.document.close();
}

// Init cloud au chargement
function initCloud(){
  if(!DB.params?.cloud)return;
  const {url,key,table}=DB.params.cloud;
  document.getElementById('cloud-url').value=url||'';
  document.getElementById('cloud-key').value=key||'';
  document.getElementById('cloud-table').value=table||'immogestion_data';
  document.getElementById('cloud-id').value=DB.params.cloud.id||'';
  if(url&&key){
    _cloudConnected=true;
    document.getElementById('cloud-status-badge').textContent='Connecté ✓';
    document.getElementById('cloud-status-badge').className='badge g';
    ['btn-cloud-push','btn-cloud-pull','btn-cloud-sync','btn-cloud-disc'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='';});
    cloudLog('Connexion cloud restaurée depuis les paramètres','ok');
  }
}

// ══════════════════════════════════════════
// TVA SUR IMMOBILISATIONS
// ══════════════════════════════════════════
function calcTVA(){
  const vo=+document.getElementById('fc7')?.value||0;
  const taux=+document.getElementById('fc-tva-taux')?.value||0;
  const tvaEl=document.getElementById('fc-tva');
  if(tvaEl&&taux>0&&vo>0)tvaEl.value=Math.round(vo*taux/100);
}
function getTVAFromForm(){
  return{
    montant:+document.getElementById('fc-tva')?.value||0,
    taux:+document.getElementById('fc-tva-taux')?.value||0,
    compte:document.getElementById('fc-tva-cpt')?.value||'445362',
  };
}
function loadTVAToForm(im){
  const tva=im.tva||{};
  if(document.getElementById('fc-tva'))document.getElementById('fc-tva').value=tva.montant||0;
  if(document.getElementById('fc-tva-taux'))document.getElementById('fc-tva-taux').value=tva.taux||0;
  if(document.getElementById('fc-tva-cpt'))document.getElementById('fc-tva-cpt').value=tva.compte||'445362';
}
function calcRegularisationTVA(im,dateCession){
  // Régularisation TVA si cession avant 5 ans
  if(!im.tva||!im.tva.montant)return 0;
  const acq=new Date(im.dateAcq||im.dateMis);
  const cess=new Date(dateCession);
  const anneesUse=Math.floor((cess-acq)/(1000*60*60*24*365));
  if(anneesUse>=5)return 0;
  // Reversement prorata = TVA × (5 - années utilisées) / 5
  return Math.round(im.tva.montant*(5-anneesUse)/5);
}

// ══════════════════════════════════════════
// AMORTISSEMENT PAR UNITÉS D'ŒUVRE
// ══════════════════════════════════════════
function togUO(){
  const meth=document.getElementById('fc9')?.value;
  const wrap=document.getElementById('fc-uo-wrap');
  if(wrap)wrap.style.display=meth==='uo'?'block':'none';
  // Masquer durée si UO
  const fcaWrap=document.getElementById('fca')?.closest('.fgr');
  if(fcaWrap)fcaWrap.style.opacity=meth==='uo'?'.4':'1';
}
function getUOFromForm(){
  return{
    total:+document.getElementById('fc-uo-total')?.value||0,
    unite:document.getElementById('fc-uo-unite')?.value||'',
    cumul:+document.getElementById('fc-uo-cumul')?.value||0,
    historique:[],
  };
}
function loadUOToForm(im){
  const uo=im.uo||{};
  if(document.getElementById('fc-uo-total'))document.getElementById('fc-uo-total').value=uo.total||0;
  if(document.getElementById('fc-uo-unite'))document.getElementById('fc-uo-unite').value=uo.unite||'';
  if(document.getElementById('fc-uo-cumul'))document.getElementById('fc-uo-cumul').value=uo.cumul||0;
  togUO();
}
function buildPlanUO(im){
  // Construit le plan UO à partir de l'historique
  if(!im.uo||!im.uo.total)return[];
  const base=im.vo-(im.vr||0);
  const hist=im.uo.historique||[];
  const rows=[];let cumVol=0,cumDot=0;
  hist.forEach(h=>{
    const dt=Math.round(base*(h.vol/im.uo.total));
    cumVol+=h.vol;cumDot+=dt;
    rows.push({yr:h.yr,yrNum:h.yr,vd:im.vo-cumDot+dt,dt,cum:cumDot,vnc:Math.max(0,im.vo-cumDot),rt:h.vol/im.uo.total,vol:h.vol});
  });
  return rows;
}
function loadUODet(id){
  const im=DB.immobilisations.find(x=>x.id===id);
  if(!im||im.methode!=='uo')return;
  const wrap=document.getElementById('det-uo-wrap');if(!wrap)return;
  wrap.style.display='block';
  const uniteLbl=document.getElementById('uo-unite-lbl');
  if(uniteLbl)uniteLbl.textContent='Volume période ('+(im.uo?.unite||'unités')+')';
  const yrEl=document.getElementById('uo-yr');
  if(yrEl&&!yrEl.value)yrEl.value=new Date().getFullYear();
  const hist=im.uo?.historique||[];
  const base=im.vo-(im.vr||0);
  const total=im.uo?.total||1;
  document.getElementById('uo-hist-tb').innerHTML=hist.map((h,i)=>{
    const dt=Math.round(base*(h.vol/total));
    return`<tr>
      <td>${h.yr}</td>
      <td style="font-family:var(--m);text-align:right">${h.vol.toLocaleString()} ${im.uo?.unite||''}</td>
      <td style="font-family:var(--m);text-align:right;color:var(--amber)">${F(dt)}</td>
      <td style="font-family:var(--m);text-align:right">${(h.vol/total*100).toFixed(2)}%</td>
      <td><button class="btn xs d" onclick="delUOPeriod('${id}',${i})">×</button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:.75rem">Aucune période saisie</td></tr>';
  const cumVol=hist.reduce((a,h)=>a+h.vol,0);
  const cumDot=Math.round(base*(cumVol/total));
  document.getElementById('uo-total-info').textContent=`Volume cumulé : ${cumVol.toLocaleString()} / ${total.toLocaleString()} ${im.uo?.unite||''} (${(cumVol/total*100).toFixed(1)}%) — Dotation cumulée : ${F(cumDot)}`;
}
function saveUOPeriod(){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im||!im.uo)return;
  const yr=+document.getElementById('uo-yr').value;
  const vol=+document.getElementById('uo-vol').value;
  if(!yr||!vol){toast('Exercice et volume obligatoires','e');return;}
  if(!im.uo.historique)im.uo.historique=[];
  const existing=im.uo.historique.findIndex(h=>h.yr===yr);
  if(existing>=0)im.uo.historique[existing].vol=vol;
  else im.uo.historique.push({yr,vol});
  im.uo.historique.sort((a,b)=>a.yr-b.yr);
  im.uo.cumul=im.uo.historique.reduce((a,h)=>a+h.vol,0);
  if(!im._log)im._log=[];
  im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:`Saisie UO ${yr} : ${vol} ${im.uo.unite||''}`});
  dbSave();loadUODet(curDetId);
  // Recalculer le plan dans l'onglet amortissement
  const planRows=buildPlanUO(im);
  const tb=document.getElementById('det-amtb');
  if(tb)tb.innerHTML=planRows.map(r=>`<tr><td>${r.yr} (${r.vol} ${im.uo?.unite||''})</td><td class="n">${F(r.vd)}</td><td class="n">${(r.rt*100).toFixed(2)}%</td><td class="n">${F(r.dt)}</td><td class="n">${F(r.cum)}</td><td class="n" style="color:${r.vnc<=0?'var(--red)':'inherit'}">${F(r.vnc)}</td></tr>`).join('');
  toast('Volume enregistré');
}
function delUOPeriod(id,i){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im?.uo?.historique)return;
  im.uo.historique.splice(i,1);
  im.uo.cumul=im.uo.historique.reduce((a,h)=>a+h.vol,0);
  dbSave();loadUODet(id);toast('Période supprimée');
}

// ══════════════════════════════════════════
// APPROCHE PAR COMPOSANTS
// ══════════════════════════════════════════
function calcCompTaux(){
  const dur=+document.getElementById('comp-dur')?.value||0;
  const tauxEl=document.getElementById('comp-taux');
  if(tauxEl)tauxEl.value=dur>0?(100/dur).toFixed(2)+'%':'—';
  // MAJ pct
  const im=DB.immobilisations.find(x=>x.id===curDetId);
  const vo=im?.vo||0;
  const compVo=+document.getElementById('comp-vo')?.value||0;
  const pctEl=document.getElementById('comp-pct');
  if(pctEl&&vo>0)pctEl.value=compVo>0?(compVo/vo*100).toFixed(1)+'%':'—';
}
function loadComposants(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const comps=im.composants||[];
  const badge=document.getElementById('det-comp-count');
  if(badge){badge.textContent=comps.length;badge.style.display=comps.length?'':'none';}
  const tb=document.getElementById('comp-tb');if(!tb)return;
  const totalVO=comps.reduce((a,c)=>a+c.vo,0);
  const METH={lin:'Linéaire',deg:'Dég. SYSCOHADA',degf:'Dég. fiscal',uo:'UO'};

  // ── Tableau des composants ──
  tb.innerHTML=comps.map((comp,i)=>{
    // Plan individuel du composant
    const planComp=buildPlan({
      vo:comp.vo,vr:comp.vr||0,
      methode:comp.methode||im.methode||'lin',
      duree:comp.duree,taux:1/comp.duree,
      dateAcq:im.dateAcq,dateMis:im.dateMis||im.dateAcq,
      cal:im.cal||360
    });
    const dotAnn=planComp[1]?.dt||planComp[0]?.dt||0; // dotation exercice plein
    const pctVO=im.vo>0?(comp.vo/im.vo*100).toFixed(1):0;
    const cumComp=planComp.reduce((a,r)=>a+r.dt,0);
    return`<tr>
      <td style="font-weight:500">${escapeHtml(comp.designation)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right">${F(comp.vo)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--text3)">${pctVO}%</td>
      <td>${METH[comp.methode]||comp.methode||'Lin.'}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right">${comp.duree} ans</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right">${(100/comp.duree).toFixed(2)}%</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber);font-weight:600">${F(dotAnn)}</td>
      <td><button class="btn xs d" onclick="delComposant('${id}',${i})">×</button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:1rem">Aucun composant — ajoutez-en ci-dessus.</td></tr>';

  // ── Récapitulatif ──
  const summary=document.getElementById('comp-summary');
  if(summary){
    if(comps.length>0){
      const totDot=comps.reduce((a,c)=>{
        const p=buildPlan({vo:c.vo,vr:c.vr||0,methode:c.methode||'lin',duree:c.duree,taux:1/c.duree,dateAcq:im.dateAcq,dateMis:im.dateMis||im.dateAcq,cal:im.cal||360});
        return a+(p[1]?.dt||p[0]?.dt||0);
      },0);
      const ecart=im.vo-totalVO;
      const ok=Math.abs(ecart)<=100;
      summary.innerHTML=`<div style="display:flex;gap:1rem;font-size:12px;flex-wrap:wrap;padding:8px 10px;background:${ok?'var(--surface2)':'var(--amber-light)'};border-radius:var(--r);margin-bottom:1rem">
        <span>ΣVO composants : <strong style="font-family:var(--m)">${F(totalVO)}</strong></span>
        <span>V.O. bien : <strong style="font-family:var(--m)">${F(im.vo)}</strong></span>
        <span style="color:${ok?'var(--green)':'var(--red)'}">Écart : <strong>${ecart>=0?'+':''}${F(ecart)}</strong> ${ok?'✓':'⚠ ajustement requis'}</span>
        <span>Dotation annuelle totale : <strong style="color:var(--amber);font-family:var(--m)">${F(totDot)}</strong></span>
      </div>`;

      // ── Plan consolidé ──
      const planConsolide=buildPlanComposants(im);
      if(planConsolide&&planConsolide.length){
        summary.innerHTML+=`
        <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,10 4,6 7,8 10,3 12,5"/></svg>
          Plan d'amortissement consolidé (IAS 16)
        </div>
        <div class="tw" style="margin-top:0"><table style="font-size:11px">
          <thead><tr>
            <th>Exercice</th>
            ${comps.map(c=>`<th style="text-align:right;color:var(--text3)">${c.designation.substring(0,14)}</th>`).join('')}
            <th style="text-align:right;color:var(--blue)">Total dotation</th>
            <th style="text-align:right">Cumul</th>
            <th style="text-align:right">VNC fin</th>
          </tr></thead>
          <tbody>
            ${planConsolide.map((r,ri)=>`<tr style="${ri%2===0?'background:var(--surface2)':''}">
              <td>${r.yr}</td>
              ${(r.detail||[]).map(d=>`<td style="font-family:var(--m);text-align:right;color:var(--text3)">${d.dt>0?F(d.dt):'—'}</td>`).join('')}
              <td style="font-family:var(--m);text-align:right;font-weight:600;color:var(--amber)">${F(r.dt)}</td>
              <td style="font-family:var(--m);text-align:right;color:var(--red)">${F(r.cum)}</td>
              <td style="font-family:var(--m);text-align:right;color:${r.vnc<=0?'var(--red)':'var(--green)'}"><strong>${F(r.vnc)}</strong></td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--blue-light);color:var(--blue);font-weight:700">
              <td>TOTAL</td>
              ${comps.map(c=>`<td style="font-family:var(--m);text-align:right">${F(planConsolide.reduce((a,r)=>a+(r.detail?.find(d=>d.designation===c.designation)?.dt||0),0))}</td>`).join('')}
              <td style="font-family:var(--m);text-align:right">${F(planConsolide.reduce((a,r)=>a+r.dt,0))}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table></div>`;
      }
    } else {
      summary.innerHTML='';
    }
  }
  const compVoEl=document.getElementById('comp-vo');
  if(compVoEl&&!compVoEl.value&&im.vo)compVoEl.placeholder=`ex: ${Math.round(im.vo*0.7).toLocaleString()} (70%)`;
}
function addComposant(){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  const des=document.getElementById('comp-des').value.trim();
  const vo=+document.getElementById('comp-vo').value;
  const dur=+document.getElementById('comp-dur').value;
  const meth=document.getElementById('comp-meth').value;
  if(!des||!vo||!dur){toast('Désignation, valeur et durée obligatoires','e');return;}
  if(!im.composants)im.composants=[];
  im.composants.push({designation:des,vo,duree:dur,methode:meth,vr:0,dateCreation:TD()});
  if(!im._log)im._log=[];
  im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:`Composant ajouté : ${des} (${F(vo)}, ${dur} ans)`});
  dbSave();loadComposants(curDetId);
  ['comp-des','comp-vo','comp-dur','comp-taux','comp-pct'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  toast('Composant ajouté');
}
function delComposant(id,i){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im?.composants)return;
  if(!confirm('Supprimer ce composant ?'))return;
  im.composants.splice(i,1);dbSave();loadComposants(id);toast('Composant supprimé');
}

// ══════════════════════════════════════════
// RÉVISION DE DURÉE — IAS 8 / PROSPECTIF
// ══════════════════════════════════════════
function calcRevision(){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  const dateRev=document.getElementById('rev-date')?.value;
  const newDur=+document.getElementById('rev-dur')?.value||0;
  const newMeth=document.getElementById('rev-meth')?.value||'lin';
  if(!dateRev||!newDur)return;
  const cumRevision=cumAt(im,dateRev);
  const vncRevision=Math.max(0,im.vo-(im.vr||0)-cumRevision);
  const newTaux=1/newDur;
  const newDotAnn=newMeth==='lin'?Math.round(vncRevision/newDur):Math.round(vncRevision*newTaux);
  const prev=document.getElementById('rev-preview');
  if(prev){
    prev.style.display='block';
    prev.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><strong>Situation au ${FD(dateRev)}</strong><br>VNC : ${F(vncRevision)} FCFA<br>Durée restante actuelle : ${im.duree-(new Date(dateRev).getFullYear()-new Date(im.dateMis||im.dateAcq).getFullYear())} ans</div>
        <div><strong>Après révision (prospectif)</strong><br>Nouvelle durée résiduelle : ${newDur} ans<br>Nouvelle dotation annuelle : <span style="color:var(--amber);font-weight:600">${F(newDotAnn)} FCFA</span><br>Taux : ${(newTaux*100).toFixed(2)}%</div>
      </div>`;
  }
}
function appliquerRevision(){
  if(!guardWrite())return;
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  const dateRev=document.getElementById('rev-date')?.value;
  const newDur=+document.getElementById('rev-dur')?.value||0;
  const newMeth=document.getElementById('rev-meth')?.value||'lin';
  const motif=document.getElementById('rev-motif')?.value.trim();
  if(!dateRev||!newDur){toast('Date et nouvelle durée obligatoires','e');return;}
  if(!motif){toast('Le motif est obligatoire pour IAS 8','e');return;}
  const cumRevision=cumAt(im,dateRev);
  const vncRevision=Math.max(0,im.vo-(im.vr||0)-cumRevision);
  if(!confirm(`Appliquer la révision ?\n\nVNC au ${FD(dateRev)} : ${F(vncRevision)} FCFA\nNouvelle durée : ${newDur} ans à partir de ${FD(dateRev)}\n\nCette action est conforme IAS 8 (prospectif uniquement).`))return;
  if(!im.revisions)im.revisions=[];
  im.revisions.push({
    date:dateRev,
    ancienneDuree:im.duree,ancienneMethode:im.methode,
    nouvelleDuree:newDur,nouvelleMethode:newMeth,
    vncRevision,motif,
    by:currentUser?.nom||'?'
  });
  // Appliquer la révision : on crée un "point de départ" pour le calcul futur
  // Stocker la révision active
  im.revisionActive={date:dateRev,dureeRestante:newDur,methode:newMeth,vncBase:vncRevision};
  im.duree=newDur;
  im.methode=newMeth;
  im.taux=1/newDur;
  if(!im._log)im._log=[];
  im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:`Révision IAS 8 : durée → ${newDur} ans, motif : ${escapeHtml(motif)}`});
  dbSave();
  loadRevisions(curDetId);
  openDet(curDetId);
  toast(`Révision appliquée — durée résiduelle : ${newDur} ans à partir du ${FD(dateRev)}`);
}
function loadRevisions(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const revs=im.revisions||[];
  const badge=document.getElementById('det-rev-count');
  if(badge){badge.textContent=revs.length;badge.style.display=revs.length?'':'none';}
  const tb=document.getElementById('rev-tb');if(!tb)return;
  tb.innerHTML=revs.slice().reverse().map(r=>`<tr>
    <td>${FD(r.date)}</td>
    <td style="font-size:12px;color:var(--text3)">${r.ancienneDuree} ans — ${r.ancienneMethode==='lin'?'Lin.':'Dég.'}</td>
    <td style="font-size:12px;color:var(--blue)">${r.nouvelleDuree} ans — ${r.nouvelleMethode==='lin'?'Lin.':'Dég.'}</td>
    <td style="font-family:var(--m);font-size:12px;color:var(--amber)">${F(r.vncRevision)} FCFA</td>
    <td style="font-size:12px">\</td>
    <td style="font-size:11px;color:var(--text3)">${r.by||'—'}</td>
  </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1rem">Aucune révision enregistrée</td></tr>';
  // Init date du jour
  const dateEl=document.getElementById('rev-date');if(dateEl&&!dateEl.value)dateEl.value=TD();
  const methEl=document.getElementById('rev-meth');if(methEl)methEl.value=im.methode||'lin';
}

function togIFRS16(){
  const v=document.getElementById('fc6').value;
  const wrap=document.getElementById('fc-ifrs16-wrap');
  if(wrap)wrap.style.display=v==='Crédit-bail'?'block':'none';
}
function togFiscalAmort(){
  const tog=document.getElementById('fc-fiscal-toggle');
  const wrap=document.getElementById('fc-fiscal-wrap');
  if(wrap)wrap.style.display=tog.checked?'block':'none';
}
function onFdurCh(){
  const dur=+document.getElementById('fc-fdur')?.value||0;
  if(dur>0)document.getElementById('fc-ftaux').value=(100/dur).toFixed(2)+'%';
  else document.getElementById('fc-ftaux').value='';
}
function openNewImmo(){
  document.getElementById('f-eid').value='';
  document.getElementById('m-new-title').textContent="Nouvelle fiche d'immobilisation";
  // Reset code mode based on active model
  const activeModel = getCodifModel();
  _codeManualMode = (activeModel === 'libre');
  const togEl = document.getElementById('code-mode-toggle');
  if(togEl){ togEl.checked = _codeManualMode; }
  const trackEl = document.getElementById('code-mode-track');
  const thumbEl = document.getElementById('code-mode-thumb');
  if(trackEl) trackEl.style.background = _codeManualMode ? 'var(--blue)' : 'var(--border2)';
  if(thumbEl) thumbEl.style.left = _codeManualMode ? '16px' : '2px';
  const hintEl = document.getElementById('code-auto-hint');
  if(hintEl){
    hintEl.textContent = activeModel==='charte'
      ? 'Charte : désignation · marque · date · n°séq'
      : activeModel==='sequential'
        ? 'Séquentiel : préfixe · année · numéro incrémenté'
        : 'Saisie manuelle (modèle libre actif)';
  }
  document.getElementById('fc0').value = '';
  if(!_codeManualMode) updateCodePreview();
  ['fc1','fc3','fc4','fc5','fc7','fc8','fca','fcb','fc-inv-num','fc-serie','fc-facture','fc-vr','fc-mis','fc-nature','nm-gar-fin','nm-gar-frs','nm-gar-cond','nm-pres','nm-cout','nm-debut','nm-fin','nm-freq','nm-num'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  _pjTemp=[];
  renderPJList(document.getElementById('pj-list'),_pjTemp,true);
  const syscoaEl=document.getElementById('fc-syscoa');if(syscoaEl)syscoaEl.value='';
  const etatEl=document.getElementById('fc-etat');if(etatEl)etatEl.value='bon';
  const fiscalTog=document.getElementById('fc-fiscal-toggle');if(fiscalTog)fiscalTog.checked=false;
  const fiscalWrap=document.getElementById('fc-fiscal-wrap');if(fiscalWrap)fiscalWrap.style.display='none';
  document.getElementById('f-prev').textContent="Renseignez la valeur et la date d'acquisition";
  const fp2=document.getElementById('f-prev2');if(fp2)fp2.textContent="Renseignez la valeur et la date d'acquisition";
  const naE=document.getElementById('n-amort-empty'),naW=document.getElementById('n-amort-wrap');
  if(naE)naE.style.display='block';if(naW)naW.style.display='none';
  const nmw=document.getElementById('m-new');
  if(nmw){nmw.querySelectorAll('.tabs .tab').forEach((t,i)=>t.classList.toggle('active',i===0));nmw.querySelectorAll('.tp').forEach((t,i)=>t.classList.toggle('active',i===0));}
  popCatSelectors();
  // Reset lot fields
  const fqty=document.getElementById('fc-qty');if(fqty)fqty.value='1';
  const fpu=document.getElementById('fc-prix-unit');if(fpu){fpu.value='';fpu.readOnly=false;}
  const fvo=document.getElementById('fc7');if(fvo){fvo.value='';fvo.readOnly=true;}
  const flm=document.getElementById('fc-lot-mode');if(flm)flm.value='groupe';
  const flmd=document.getElementById('fgr-lot-mode');if(flmd)flmd.style.display='none';
  onCatCh();openM('m-new');
}
function editImmo(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  closeM('m-detail');
  document.getElementById('f-eid').value=id;
  document.getElementById('m-new-title').textContent='Modifier — '+im.designation;
  document.getElementById('fc0').value=im.code;
  // Switch to manual mode for edit (preserve existing code)
  _codeManualMode = true;
  const tog2=document.getElementById('code-mode-toggle');
  if(tog2){ tog2.checked=true; }
  const track2=document.getElementById('code-mode-track');
  const thumb2=document.getElementById('code-mode-thumb');
  if(track2) track2.style.background='var(--blue)';
  if(thumb2) thumb2.style.left='16px';
  const hint2=document.getElementById('code-auto-hint');
  if(hint2) hint2.textContent='Mode modification — vous pouvez ajuster le code existant';
  document.getElementById('fc1').value=im.designation;
  document.getElementById('fc2').value=im.categorie;
  popCatSelectors();
  document.getElementById('fc2').value=im.categorie;
  document.getElementById('fc-syscoa').value=im.classSYSCOA||'';
  document.getElementById('fc-inv-num').value=im.invNum||'';
  document.getElementById('fc-serie').value=im.serie||'';
  const fcNatEl=document.getElementById('fc-nature');if(fcNatEl)fcNatEl.value=im.nature||'';
  document.getElementById('fc3').value=im.marque||im.nature||'';
  document.getElementById('fc4').value=im.fournisseur||'';
  document.getElementById('fc-facture').value=im.factureNum||'';
  document.getElementById('fc5').value=im.affectation||'';
  const ccEl=document.getElementById('fc-cc');if(ccEl)ccEl.value=im.centreCoût||'';
  const axeEl=document.getElementById('fc-axe');if(axeEl){rdAxes();axeEl.value=im.axe||'';}
  document.getElementById('fc6').value=im.financement;
  document.getElementById('fc-etat').value=im.etat||'bon';
  document.getElementById('fc7').value=im.vo;
  const epuEl=document.getElementById('fc-prix-unit');
  if(epuEl){epuEl.value=im.vo;} // En modification: prix unitaire = valeur origine
  const eqtyEl=document.getElementById('fc-qty');
  if(eqtyEl)eqtyEl.value='1';
  document.getElementById('fc-vr').value=im.vr||0;
  document.getElementById('fc8').value=im.dateAcq;
  document.getElementById('fc-mis').value=im.dateMis||im.dateAcq;
  document.getElementById('fc9').value=im.methode;
  togUO();
  loadTVAToForm(im);
  if(im.methode==='uo')loadUOToForm(im);
  document.getElementById('fca').value=im.duree;
  document.getElementById('fcc2').value=im.cal;
  document.getElementById('fcd').value=im.ci||'';
  document.getElementById('fce').value=im.ca||'';
  // Fiscal
  const hasFiscal=!!(im.fiscal&&im.fiscal.duree>0);
  document.getElementById('fc-fiscal-toggle').checked=hasFiscal;
  document.getElementById('fc-fiscal-wrap').style.display=hasFiscal?'block':'none';
  if(hasFiscal){document.getElementById('fc-fmeth').value=im.fiscal.methode||'lin';document.getElementById('fc-fdur').value=im.fiscal.duree||'';}
  // Garantie & maintenance
  const m=im.maintenance||{};
  const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  setV('nm-gar-fin',m.garFin);setV('nm-gar-frs',m.garFrs);setV('nm-gar-cond',m.garCond);
  setV('nm-pres',m.prestataire);setV('nm-cout',m.cout||'');setV('nm-debut',m.debut);setV('nm-fin',m.fin);setV('nm-freq',m.freq);setV('nm-num',m.numContrat);
  const nmw2=document.getElementById('m-new');
  if(nmw2){nmw2.querySelectorAll('.tabs .tab').forEach((t,i)=>t.classList.toggle('active',i===0));nmw2.querySelectorAll('.tp').forEach((t,i)=>t.classList.toggle('active',i===0));}
  onVOCh();genPlanPreview();openM('m-new');
}
function onCatCh(){
  const cat=document.getElementById('fc2').value;
  const c=DB.categories.find(x=>x.libelle===cat);
  if(c){document.getElementById('fca').value=c.duree;document.getElementById('fc9').value=c.methode;document.getElementById('fcd').value=c.cptImmo;document.getElementById('fce').value=c.cptAmort;onVOCh();}
}
function onVOCh(){
  const vo=+document.getElementById('fc7').value||0;
  const dur=+document.getElementById('fca').value||0;
  const date=document.getElementById('fc8').value;
  const cal=+document.getElementById('fcc2').value||360;
  if(dur>0){
    const taux=1/dur;document.getElementById('fcb').value=(taux*100).toFixed(2)+'%';
    if(vo>0&&date){const d=dot1(vo,taux,date,cal);const txt=`1ère dotation : ${F(d)} FCFA (prorata)`;document.getElementById('f-prev').textContent=txt;const fp2=document.getElementById('f-prev2');if(fp2)fp2.textContent=txt;}
  }
  // Regenerate code preview if new immo (not edit mode)
  const eid=document.getElementById('f-eid').value;
  if(!eid) updateCodePreview();
}
let _codeManualMode = false;

function toggleCodeMode(){
  const tog = document.getElementById('code-mode-toggle');
  const track = document.getElementById('code-mode-track');
  const thumb = document.getElementById('code-mode-thumb');
  const hint = document.getElementById('code-auto-hint');
  const lbl = document.getElementById('code-mode-label');
  const inp = document.getElementById('fc0');
  _codeManualMode = tog.checked;
  if(_codeManualMode){
    // MANUEL
    track.style.background = 'var(--blue)';
    thumb.style.left = '16px';
    lbl.style.fontWeight = '500';
    inp.style.color = 'var(--text)';
    inp.placeholder = 'Saisissez le code manuellement';
    inp.focus();
    if(hint) hint.textContent = 'Saisie libre — le code ne sera pas recalculé';
  } else {
    // AUTO
    track.style.background = 'var(--border2)';
    thumb.style.left = '2px';
    inp.style.color = 'var(--blue)';
    const model = getCodifModel();
    if(model === 'libre'){
      // even in "auto" tab, libre model = manual always
      _codeManualMode = true;
      tog.checked = true;
      track.style.background = 'var(--blue)';
      thumb.style.left = '16px';
      inp.placeholder = 'Saisie manuelle (modèle libre)';
      if(hint) hint.textContent = 'Modèle "saisie libre" actif dans les paramètres';
    } else {
      inp.placeholder = model === 'charte' ? 'Auto-généré (charte)' : 'Auto-généré (séquentiel)';
      if(hint){
        hint.textContent = model === 'charte'
          ? 'Charte : désignation · marque · date · n°séq'
          : 'Séquentiel : préfixe · année · numéro incrémenté';
      }
      updateCodePreview();
    }
  }
}

function updateCodePreview(){
  if(_codeManualMode) return;
  const model = getCodifModel();
  if(model === 'libre'){ _codeManualMode=true; return; }
  const des   = document.getElementById('fc1').value.trim();
  const marque= document.getElementById('fc3').value.trim();
  const date  = document.getElementById('fc8').value;
  let code;
  if(model === 'charte'){
    code = genCodeCharte(des||'IMMO', marque, date||new Date().toISOString().split('T')[0]);
  } else {
    code = genCodeSeq();
  }
  document.getElementById('fc0').value = code;
}
function delImmo(id){
  if(!guardDelete())return;
  const im = DB.immobilisations.find(x => x.id === id);
  if(!im) return;
  const hasSortie = DB.sorties.some(s => s.immoId === id);
  const hasAff = DB.affectations.some(a => a.immoId === id);
  let msg = `Supprimer définitivement "\" ?\nCette action est irréversible.`;
  if(hasSortie) msg += '\n\nAttention : des sorties d\u2019actif liées seront également supprimées.';
  if(hasAff) msg += '\n\nAttention : l\u2019historique des affectations sera supprimé.';
  if(!confirm(msg)) return;
  DB.immobilisations = DB.immobilisations.filter(x => x.id !== id);
  if(hasSortie) DB.sorties = DB.sorties.filter(s => s.immoId !== id);
  if(hasAff) DB.affectations = DB.affectations.filter(a => a.immoId !== id);
  dbSave(); closeM('m-detail'); rdFiches(); rdDash();
  toast('Immobilisation supprimée');
}
function saveImmo(){
  if(!guardWrite())return;
  
  const sanitize = (str) => str ? String(str).replace(/</g, '«').replace(/>/g, '»') : str;
  
  const eid=document.getElementById('f-eid').value;
  const des=sanitize(document.getElementById('fc1').value.trim());
  const vo=+document.getElementById('fc7').value;
  const dur=+document.getElementById('fca').value;
  const date=document.getElementById('fc8').value;
  if(!des||!vo||!dur||!date){toast('Champs obligatoires manquants','e');return;}
  const taux=1/dur;
  const vr=+document.getElementById('fc-vr')?.value||0;
  const dateMs=document.getElementById('fc-mis')?.value||date;
  const fiscalOn=document.getElementById('fc-fiscal-toggle')?.checked||false;
  const fdur=+document.getElementById('fc-fdur')?.value||0;
  const fmeth=document.getElementById('fc-fmeth')?.value||'lin';
  const ftaux=fdur>0?1/fdur:0;
  // Audit trail
  const prevIm=eid?DB.immobilisations.find(x=>x.id===eid):null;
  const obj={
    id:eid||UID(),
    code:sanitize((()=>{const ex=document.getElementById('fc0').value.trim();if(eid)return ex;if(ex)return ex;return nextCode(des,document.getElementById('fc3').value.trim(),date);})()),
    designation:des,
    categorie:sanitize(document.getElementById('fc2').value),
    classSYSCOA:sanitize(document.getElementById('fc-syscoa')?.value||''),
    invNum:sanitize(document.getElementById('fc-inv-num')?.value.trim()||''),
    serie:sanitize(document.getElementById('fc-serie')?.value.trim()||''),
    nature:sanitize(document.getElementById('fc-nature')?.value||''),
    marque:sanitize(document.getElementById('fc3').value),
    fournisseur:sanitize(document.getElementById('fc4').value),
    factureNum:sanitize(document.getElementById('fc-facture')?.value.trim()||''),
    financement:sanitize(document.getElementById('fc6').value),
    affectation:sanitize(document.getElementById('fc5').value),
    centreCoût:sanitize(document.getElementById('fc-cc')?.value.trim()||''),
    axe:document.getElementById('fc-axe')?.value||'',
    etat:document.getElementById('fc-etat')?.value||'bon',
    vo,vr,
    dateAcq:date,
    dateMis:dateMs,
    methode:document.getElementById('fc9').value,
    duree:dur,taux,
    cal:+document.getElementById('fcc2').value||360,
    statut:'actif',
    ci:document.getElementById('fcd').value,
    ca:document.getElementById('fce').value,
    pj:eid?(DB.immobilisations.find(x=>x.id===eid)?.pj||[]):[..._pjTemp],
    tva:getTVAFromForm(),
    uo:document.getElementById('fc9')?.value==='uo'?{...getUOFromForm(),historique:eid?(DB.immobilisations.find(x=>x.id===eid)?.uo?.historique||[]):[]}:null,
    // Préserver les données complexes lors d'une modification
    composants:eid?(DB.immobilisations.find(x=>x.id===eid)?.composants||[]):undefined,
    revisions:eid?(DB.immobilisations.find(x=>x.id===eid)?.revisions||[]):undefined,
    revisionActive:eid?(DB.immobilisations.find(x=>x.id===eid)?.revisionActive||null):null,
    // Amortissement fiscal
    fiscal:fiscalOn?{methode:fmeth,duree:fdur,taux:ftaux}:null,
    // Garantie & maintenance (saisissable dès la création)
    maintenance:(()=>{
      const g=(id)=>document.getElementById(id)?.value||'';
      const mo={garFin:g('nm-gar-fin'),garFrs:g('nm-gar-frs'),garCond:g('nm-gar-cond'),prestataire:g('nm-pres'),cout:+g('nm-cout')||0,debut:g('nm-debut'),fin:g('nm-fin'),freq:g('nm-freq'),numContrat:g('nm-num')};
      const hasData=Object.values(mo).some(v=>v);
      return hasData?mo:(eid?(DB.immobilisations.find(x=>x.id===eid)?.maintenance||null):null);
    })(),
    // Dépenses ultérieures (préservées en modification)
    depenses:eid?(DB.immobilisations.find(x=>x.id===eid)?.depenses||[]):[],
    // Modification log
    _log:prevIm?[...(prevIm._log||[]),{ts:new Date().toISOString(),by:currentUser?.nom||'?',action:'modif'}]:[]
  };
  if(eid){const i=DB.immobilisations.findIndex(x=>x.id===eid);if(i>-1)DB.immobilisations[i]=obj;}
  else {
    // Gestion lot : quantité et mode
    const fcQty = parseInt(document.getElementById('fc-qty')?.value)||1;
    const fcMode = document.getElementById('fc-lot-mode')?.value||'groupe';
    if(fcQty <= 1 || fcMode === 'groupe'){
      DB.immobilisations.push(obj);
      logAction('CREATE','Immobilisation',obj.code+' — '+obj.designation);
    } else {
      // Éclater en fiches individuelles
      const voUnit = Math.round(obj.vo / fcQty);
      const codeBase = obj.code;
      for(let i=1;i<=fcQty;i++){
        const suffix = String(i).padStart(2,'0');
        const nim = Object.assign({},obj,{
          id:UID(),
          code:codeBase+'-'+suffix,
          designation:obj.designation+' N°'+i,
          vo:voUnit
        });
        DB.immobilisations.push(nim);
        logAction('CREATE','Immobilisation',nim.code+' — '+nim.designation);
      }
    }
  }
  dbSave();closeM('m-new');rdFiches();rdDash();
  const fcQty2=parseInt(document.getElementById('fc-qty')?.value)||1;
  const fcMode2=document.getElementById('fc-lot-mode')?.value||'groupe';
  if(!eid && fcQty2>1 && fcMode2==='individuel'){
    toast(fcQty2+' fiches individuelles créées avec succès');
  } else {
    toast(eid?'Immobilisation modifiée':'Immobilisation enregistrée');
  }
}

// ══════════════════════════════════════════
// INVENTAIRE CONTRADICTOIRE
// ══════════════════════════════════════════
let _icState={};  // {immoId: {found:bool, etatConstate:'', obs:''}}
let _icSurplus=[];// [{code,designation,lieu,obs}]

function openInvContra(){
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  _icState={};_icSurplus=[];
  immos.forEach(im=>{_icState[im.id]={found:false,etatConstate:im.etat||'bon',obs:''};});
  document.getElementById('inv-res').style.display='none';
  document.getElementById('inv-contra-wrap').style.display='block';
  document.getElementById('ic-scan').value='';
  renderIC();
}
function closeInvContra(){document.getElementById('inv-contra-wrap').style.display='none';}
function renderIC(){
  const date=document.getElementById('inv-d')?.value||TD();
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const found=immos.filter(im=>_icState[im.id]?.found);
  const missing=immos.filter(im=>!_icState[im.id]?.found);
  document.getElementById('ic-found-badge').textContent=found.length+' trouvés';
  document.getElementById('ic-missing-badge').textContent=missing.length+' manquants';
  document.getElementById('ic-surplus-badge').textContent=_icSurplus.length+' en surplus';
  document.getElementById('ic-nb-all').textContent=immos.length;
  document.getElementById('ic-nb-missing').textContent=missing.length;
  document.getElementById('ic-nb-surplus').textContent=_icSurplus.length;
  const ETAT_LBL={bon:'Bon état',usage:'Usagé',degrade:'Dégradé',horsservice:'Hors service'};

  // ── Tableau TOUS ──
  document.getElementById('ic-tb-all').innerHTML=immos.map(im=>{
    const st=_icState[im.id];
    const isFound=st?.found;
    const cum=cumAt(im,date);
    const vnc=Math.max(0,im.vo-cum);
    return`<tr style="${isFound?'':'background:var(--red-light)'}">
      <td><input type="checkbox" ${isFound?'checked':''} onchange="icToggle('${im.id}',this.checked)" style="width:14px;height:14px;accent-color:var(--green)"></td>
      <td class="no-trunc"><code class="tc-sm" title="\" style="font-size:11px;color:var(--blue)">\</code></td>
      <td class="no-trunc" style="font-family:var(--m);font-size:11px;color:var(--text3)"><span class="tc" title="\">\</span></td>
      <td><span class="tc-lg" title="\" style="font-size:12px;font-weight:500">\</span></td>
      <td class="no-trunc"><span class="tc-sm" title="${im.nature||'—'}" style="font-size:11px;color:var(--text2)">${im.nature||'—'}</span></td>
      <td class="no-trunc"><span class="badge ${CC(im.categorie)} tc-sm" title="${im.categorie}" style="font-size:10px;max-width:120px">${im.categorie}</span></td>
      <td class="no-trunc"><span class="tc-sm" title="\" style="font-size:12px;color:var(--text2)">\</span></td>
      <td style="font-family:var(--m);font-size:11px;text-align:right">${F(im.vo)}</td>
      <td style="font-family:var(--m);font-size:11px;text-align:right;color:${vnc<=0?'var(--red)':'var(--green)'}">${F(vnc)}</td>
      <td style="font-size:12px">${ETAT_LBL[im.etat||'bon']}</td>
      <td><select style="font-size:11px;padding:2px 4px;border:1px solid var(--border2);border-radius:4px" onchange="icSetEtat('${im.id}',this.value)">
        ${Object.entries(ETAT_LBL).map(([v,l])=>`<option value="${v}" ${(st?.etatConstate||im.etat||'bon')===v?'selected':''}>${l}</option>`).join('')}
      </select></td>
      <td><input type="text" value="${st?.obs||''}" placeholder="Observations…" style="font-size:11px;padding:2px 6px;border:1px solid var(--border2);border-radius:4px;width:120px" onchange="icSetObs('${im.id}',this.value)"></td>
    </tr>`;
  }).join('');

  // ── Tableau MANQUANTS ──
  document.getElementById('ic-tb-missing').innerHTML=missing.map(im=>{
    const cum=cumAt(im,date);
    const vnc=Math.max(0,im.vo-cum);
    const pct=im.vo>0?Math.round(cum/im.vo*100):0;
    return`<tr style="background:var(--red-light)">
      <td class="no-trunc"><code class="tc-sm" title="\" style="font-size:11px;color:var(--blue)">\</code></td>
      <td class="no-trunc" style="font-family:var(--m);font-size:11px;color:var(--text3)"><span class="tc" title="\">\</span></td>
      <td><span class="tc-lg" title="\" style="font-weight:500">\</span></td>
      <td class="no-trunc"><span class="tc-sm" title="${im.nature||'—'}" style="font-size:11px;color:var(--text2)">${im.nature||'—'}</span></td>
      <td class="no-trunc"><span class="badge ${CC(im.categorie)} tc-sm" title="${im.categorie}" style="font-size:10px;max-width:120px">${im.categorie}</span></td>
      <td class="no-trunc"><span class="tc-sm" title="\" style="font-size:12px">\</span></td>
      <td style="font-family:var(--m);font-size:12px;text-align:right">${F(im.vo)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--red)">${F(cum)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber);font-weight:600">${F(vnc)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--text3)">${pct}%</td>
    </tr>`;
  }).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--green);padding:1rem;font-weight:500">✓ Aucun bien manquant</td></tr>';

  // ── Tableau SURPLUS ──
  document.getElementById('ic-tb-surplus').innerHTML=_icSurplus.map((s,i)=>`<tr style="background:var(--amber-light)">
    <td style="font-family:var(--m);font-size:12px">\</td>
    <td style="font-weight:500">\</td>
    <td style="font-size:12px">${s.lieu||'—'}</td>
    <td style="font-size:12px;color:var(--text3)">${s.obs||'—'}</td>
    <td><button class="btn xs d" onclick="icDelSurplus(${i})">×</button></td>
  </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:.75rem">Aucun bien en surplus</td></tr>';
}
function icToggle(id,checked){_icState[id].found=checked;renderIC();}
function icSetEtat(id,val){_icState[id].etatConstate=val;}
function icSetObs(id,val){_icState[id].obs=val;}
function icScan(){
  const q=(document.getElementById('ic-scan').value||'').toLowerCase().trim();
  if(!q)return;
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const match=immos.find(im=>im.code.toLowerCase()===q||im.invNum?.toLowerCase()===q||(im.code+' '+im.designation).toLowerCase().includes(q));
  if(match&&!_icState[match.id]?.found){
    _icState[match.id].found=true;
    document.getElementById('ic-scan').value='';
    renderIC();
    toast('✓ '+match.code+' — '+match.designation,'ok');
  }
}
function icMarkAll(){const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');immos.forEach(im=>{_icState[im.id].found=true;});renderIC();}
function icReset(){const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');immos.forEach(im=>{_icState[im.id]={found:false,etatConstate:im.etat||'bon',obs:''};});_icSurplus=[];renderIC();}
function icAddSurplus(){
  const code=document.getElementById('ic-surplus-code').value.trim();
  const des=document.getElementById('ic-surplus-des').value.trim();
  const lieu=document.getElementById('ic-surplus-lieu').value.trim();
  if(!code&&!des){toast('Saisissez au moins un code ou une désignation','e');return;}
  _icSurplus.push({code,designation:des,lieu});
  document.getElementById('ic-surplus-code').value='';document.getElementById('ic-surplus-des').value='';document.getElementById('ic-surplus-lieu').value='';
  renderIC();
}
function icDelSurplus(i){_icSurplus.splice(i,1);renderIC();}
function validerInvContra(){
  if(!confirm('Valider l\'inventaire contradictoire ?\nLes états physiques constatés seront mis à jour.'))return;
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  immos.forEach(im=>{
    const st=_icState[im.id];
    if(st){
      if(st.etatConstate)im.etat=st.etatConstate;
      if(st.obs&&!st.found){
        if(!im._log)im._log=[];
        im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:'Manquant à l\'inventaire — '+st.obs});
      }
    }
  });
  // Sauvegarder le rapport d'inventaire contradictoire
  if(!DB.inventairesContradictoires)DB.inventairesContradictoires=[];
  DB.inventairesContradictoires.push({
    date:TD(),by:currentUser?.nom||'?',
    found:Object.values(_icState).filter(s=>s.found).length,
    missing:Object.values(_icState).filter(s=>!s.found).length,
    surplus:_icSurplus.length,
    surplusItems:_icSurplus.slice()
  });
  dbSave();closeInvContra();rdDash();
  toast('Inventaire contradictoire validé — états mis à jour');
}
function printInvContra(){
  const ent=DB.params.entite||{};
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const ETAT_LBL={bon:'Bon état',usage:'Usagé',degrade:'Dégradé',horsservice:'Hors service'};
  const found=immos.filter(im=>_icState[im.id]?.found);
  const missing=immos.filter(im=>!_icState[im.id]?.found);
  const today=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const rows=immos.map(im=>{
    const st=_icState[im.id]||{};
    const cls=st.found?'':'background:#fee2e2';
    return`<tr style="${cls}">
      <td>\</td><td>\</td><td>\</td>
      <td>\</td><td>${ETAT_LBL[im.etat||'bon']}</td>
      <td style="font-weight:600;color:${st.found?'#166534':'#991B1B'}">${st.found?'✓ Trouvé':'✗ Manquant'}</td>
      <td>${st.etatConstate?ETAT_LBL[st.etatConstate]||st.etatConstate:'—'}</td>
      <td>${st.obs||'—'}</td>
    </tr>`;
  }).join('');
  const surplusRows=_icSurplus.map(s=>`<tr style="background:#fef3c7"><td>\</td><td>—</td><td>\</td><td>${s.lieu||'—'}</td><td>—</td><td style="font-weight:600;color:#92400e">⚠ En surplus</td><td>—</td><td>${s.obs||'—'}</td></tr>`).join('');
  const w=window.open('','_blank','width=900,height=700');if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Inventaire contradictoire</title>
  <style>body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
  h2{color:#0F2252;margin-bottom:4px}
  .meta{color:#6B7280;font-size:11px;margin-bottom:16px}
  .kpis{display:flex;gap:20px;margin-bottom:16px}
  .kpi{background:#f5f7fa;border-radius:6px;padding:10px 16px;text-align:center}
  .kpi-v{font-size:20px;font-weight:700}.kpi-l{font-size:10px;color:#6B7280}
  .kpi-v.g{color:#166534}.kpi-v.r{color:#991B1B}.kpi-v.a{color:#92400e}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#1A5FB4;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
  td{padding:5px 8px;border-bottom:1px solid #e2e8f0}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:24px}
  .sig-box{border-top:1px solid #6B7280;padding-top:6px;font-size:11px;color:#6B7280}
  @media print{@page{size:A4;margin:12mm} button{display:none}}</style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div><h2>Inventaire contradictoire</h2><div class="meta">${escapeHtml(ent.rs||'Organisation')} — Édité le ${today}</div></div>
    <button onclick="window.print()" style="background:#1A5FB4;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">🖨 Imprimer</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-v g">${found.length}</div><div class="kpi-l">Trouvés</div></div>
    <div class="kpi"><div class="kpi-v r">${missing.length}</div><div class="kpi-l">Manquants</div></div>
    <div class="kpi"><div class="kpi-v a">${_icSurplus.length}</div><div class="kpi-l">En surplus</div></div>
    <div class="kpi"><div class="kpi-v">${immos.length}</div><div class="kpi-l">Total attendus</div></div>
  </div>
  <table><thead><tr><th>Code</th><th>N° Inventaire</th><th>Désignation</th><th>Lieu attendu</th><th>État attendu</th><th>Statut</th><th>État constaté</th><th>Observations</th></tr></thead>
  <tbody>${rows}${surplusRows}</tbody></table>
  <div class="sig"><div class="sig-box">Le Gestionnaire des actifs<br><br><br></div><div class="sig-box">Le Responsable financier<br><br><br></div></div>
  </body></html>`);
  w.document.close();
}
function exportInvContra(){
  immos.forEach(im=>{
    const st=_icState[im.id]||{};
    csv+=`\;\;\;\;${ETAT_LBL[im.etat||'bon']};${st.found?'OUI':'NON'};${ETAT_LBL[st.etatConstate]||''};${st.obs||''}\n`;
  });
  if(_icSurplus.length){
    csv+='\nBIENS EN SURPLUS\nCode;Désignation;Lieu\n';
    _icSurplus.forEach(s=>csv+=`\;\;${s.lieu}\n`);
  }
  dlFile('inventaire_contradictoire_'+TD()+'.csv',csv,'text/csv');
}

// ══════════════════════════════════════════
// GARANTIE & MAINTENANCE
// ══════════════════════════════════════════
function loadMaintenance(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const m=im.maintenance||{};
  document.getElementById('maint-gar-fin').value=m.garFin||'';
  document.getElementById('maint-gar-frs').value=m.garFrs||'';
  document.getElementById('maint-gar-cond').value=m.garCond||'';
  document.getElementById('maint-pres').value=m.prestataire||'';
  document.getElementById('maint-cout').value=m.cout||'';
  document.getElementById('maint-debut').value=m.debut||'';
  document.getElementById('maint-fin').value=m.fin||'';
  document.getElementById('maint-freq').value=m.freq||'';
  document.getElementById('maint-num').value=m.numContrat||'';
  // Alertes
  const now=new Date();
  const alerts=[];
  if(m.garFin){const d=new Date(m.garFin);const diff=Math.round((d-now)/(1000*60*60*24));if(diff<0)alerts.push(`<div class="alert e">Garantie expirée depuis ${Math.abs(diff)} jours</div>`);else if(diff<=90)alerts.push(`<div class="alert w">Garantie expire dans ${diff} jours</div>`);}
  if(m.fin){const d=new Date(m.fin);const diff=Math.round((d-now)/(1000*60*60*24));if(diff<0)alerts.push(`<div class="alert e">Contrat de maintenance expiré depuis ${Math.abs(diff)} jours</div>`);else if(diff<=90)alerts.push(`<div class="alert w">Contrat expire dans ${diff} jours</div>`);}
  const alertEl=document.getElementById('maint-alert');
  if(alertEl){alertEl.innerHTML=alerts.join('');alertEl.style.display=alerts.length?'block':'none';}
}
function saveMaintenance(){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  im.maintenance={
    garFin:document.getElementById('maint-gar-fin').value,
    garFrs:document.getElementById('maint-gar-frs').value,
    garCond:document.getElementById('maint-gar-cond').value,
    prestataire:document.getElementById('maint-pres').value,
    cout:+document.getElementById('maint-cout').value||0,
    debut:document.getElementById('maint-debut').value,
    fin:document.getElementById('maint-fin').value,
    freq:document.getElementById('maint-freq').value,
    numContrat:document.getElementById('maint-num').value,
  };
  if(!im._log)im._log=[];
  im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:'Maintenance mise à jour'});
  dbSave();toast('Garantie & maintenance enregistrées');
}

// ══════════════════════════════════════════
// DÉPENSES ULTÉRIEURES CAPITALISABLES
// ══════════════════════════════════════════
function loadDepenses(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const deps=im.depenses||[];
  document.getElementById('dep-tb').innerHTML=deps.map((d,i)=>`<tr>
    <td>${FD(d.date)}</td>
    <td style="font-family:var(--m);font-size:12px;color:var(--green)">${F(d.montant)}</td>
    <td>${d.nature||'—'}</td>
    <td>${escapeHtml(d.fournisseur||'—')}</td>
    <td style="font-family:var(--m);font-size:11px">${d.facture||'—'}</td>
    <td>${d.nouvelleDuree?d.nouvelleDuree+' ans':'—'}</td>
    <td><button class="btn xs d" onclick="delDepense(${i})">×</button></td>
  </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:1rem">Aucune dépense enregistrée</td></tr>';
  const total=deps.reduce((a,d)=>a+d.montant,0);
  document.getElementById('dep-total').innerHTML=total>0?`Total capitalisé : <strong style="font-family:var(--m);color:var(--green)">${F(total)} FCFA</strong> — V.O. initiale : ${F(im.vo)} FCFA — <strong>V.O. totale : ${F(im.vo+total)} FCFA</strong>`:'';
  ['dep-date','dep-mont','dep-nat','dep-frs','dep-fac','dep-dur'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
}
function addDepense(){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im)return;
  const date=document.getElementById('dep-date').value;
  const montant=+document.getElementById('dep-mont').value;
  if(!date||!montant){toast('Date et montant obligatoires','e');return;}
  if(!im.depenses)im.depenses=[];
  const nd=+document.getElementById('dep-dur').value||0;
  im.depenses.push({
    date,montant,
    nature:document.getElementById('dep-nat').value,
    fournisseur:document.getElementById('dep-frs').value,
    facture:document.getElementById('dep-fac').value,
    nouvelleDuree:nd||null,
  });
  // Mettre à jour la valeur d'origine et éventuellement la durée
  im.vo+=montant;
  if(nd>0){im.duree=nd;im.taux=1/nd;}
  if(!im._log)im._log=[];
  im._log.push({ts:new Date().toISOString(),by:currentUser?.nom||'?',action:`Dépense capitalisée +${F(montant)} FCFA`});
  dbSave();loadDepenses(curDetId);rdFiches();rdDash();
  toast(`Dépense de ${F(montant)} FCFA capitalisée — VO mise à jour`);
}
function delDepense(i){
  const im=DB.immobilisations.find(x=>x.id===curDetId);if(!im||!im.depenses)return;
  const dep=im.depenses[i];
  if(!confirm(`Supprimer cette dépense de ${F(dep.montant)} FCFA ?`))return;
  im.vo-=dep.montant;
  im.depenses.splice(i,1);
  dbSave();loadDepenses(curDetId);rdDash();toast('Dépense supprimée');
}

// ══════════════════════════════════════════
// COMPARAISON MULTI-EXERCICES
// ══════════════════════════════════════════
function genRapMultiYr(){
  const immos=getRapFilteredImmos(false);
  const yr=new Date().getFullYear();
  const years=[yr-2,yr-1,yr,yr+1,yr+2];
  return{years,rows:immos.map(im=>{
    const yData=years.map(y=>({yr:y,dot:dotPeriod(im,y,y),cum:cumAt(im,y+'-12-31'),vnc:Math.max(0,(im.vo-(im.vr||0))-cumAt(im,y+'-12-31'))}));
    return{im,yData};
  }),totals:years.map((y,yi)=>({yr:y,dot:immos.reduce((a,im)=>a+dotPeriod(im,y,y),0),cum:immos.reduce((a,im)=>a+cumAt(im,y+'-12-31'),0),vnc:immos.reduce((a,im)=>a+Math.max(0,(im.vo-(im.vr||0))-cumAt(im,y+'-12-31')),0)}))};
}

// ══════════════════════════════════════════
// Hook openDet pour charger les nouveaux onglets
// ══════════════════════════════════════════
// Appelé depuis openDet après ouverture du modal
function loadDetTabs(id){
  setTimeout(()=>{
    loadMaintenance(id);
    loadDepenses(id);
    loadPJDet(id);
    loadComposants(id);
    loadRevisions(id);
    loadUODet(id);
  },60);
}

// ── INVENTAIRE ──
function getInvList(){
  const date=document.getElementById('inv-d').value;
  const cat=document.getElementById('inv-c').value;
  const lieu=(document.getElementById('inv-l').value||'').toLowerCase();
  const stFilter=document.getElementById('inv-st').value;
  let list=DB.immobilisations;
  if(stFilter==='actif')list=list.filter(im=>im.statut!=='sorti');
  else if(stFilter==='rebut')list=list.filter(im=>im.statut==='sorti'&&DB.sorties.find(s=>s.immoId===im.id&&s.motif==='rebut'));
  else list=list.filter(im=>im.statut!=='sorti');
  if(cat)list=list.filter(im=>im.categorie===cat);
  if(lieu)list=list.filter(im=>(im.affectation||'').toLowerCase().includes(lieu));
  return{list,date};
}
// Cache mémoire — évite de recalculer à la sauvegarde
let _invCache = null;

function genInv(){
  const{list,date}=getInvList();
  if(!date){toast('Sélectionnez une date d\'inventaire','e');return;}
  const label=(document.getElementById('inv-label')?.value||'').trim()||('Inventaire au '+FD(date));
  let tVO=0,tCum=0,tVNC=0;
  const rows=list.map(im=>{
    const cum=cumAt(im,date);
    const vnc=Math.max(0,im.vo-cum);
    tVO+=im.vo;tCum+=cum;tVNC+=vnc;
    // Stocker une copie sérialisable (pas l'objet im complet)
    return{id:im.id,code:im.code,designation:im.designation,nature:im.nature||'',
      categorie:im.categorie,affectation:im.affectation||'',dateAcq:im.dateAcq,
      vo:im.vo,cum,vnc,etat:im.etat||'bon',statut:im.statut||'actif'};
  });
  // Mettre en cache pour sauvegarde immédiate
  _invCache={date,label,rows,tVO,tCum,tVNC};
  document.getElementById('inv-title').textContent=label;
  document.getElementById('inv-cnt').textContent=list.length+' immobilisation(s)';
  document.getElementById('inv-kpi').innerHTML=`
    <div class="kpi"><div class="kpi-l">Valeur d'origine totale</div><div class="kpi-v b">${F(tVO)}</div></div>
    <div class="kpi"><div class="kpi-l">Cumul amortissements</div><div class="kpi-v r">${F(tCum)}</div></div>
    <div class="kpi"><div class="kpi-l">VNC globale au ${FD(date)}</div><div class="kpi-v g">${F(tVNC)}</div></div>
    <div class="kpi"><div class="kpi-l">Nb immobilisations</div><div class="kpi-v a">${list.length}</div></div>`;
  document.getElementById('inv-tb').innerHTML=rows.map(r=>{
    const pct=r.vo>0?Math.round(r.cum/r.vo*100):0;
    const etatLabel=r.statut==='sorti'?'Sorti':r.vnc<=0?'Amorti':pct>=75?'Presque amorti':'Actif';
    const etatBadge=r.statut==='sorti'?'r':r.vnc<=0?'a':pct>=75?'a':'g';
    return`<tr>
      <td class="no-trunc"><code class="tc-sm" title="${escapeHtml(r.code)}">${escapeHtml(r.code)}</code></td>
      <td><span class="tc-lg" title="${escapeHtml(r.designation)}">${escapeHtml(r.designation)}</span></td>
      <td><span class="tc-xs" title="${r.nature||''}" style="font-size:12px;color:var(--text2)">${r.nature||'—'}</span></td>
      <td class="no-trunc"><span class="badge ${CC(r.categorie)} tc-sm" title="${r.categorie}" style="max-width:110px">${r.categorie}</span></td>
      <td><span class="tc-sm" title="${r.affectation||''}" style="font-size:12px">${r.affectation||'—'}</span></td>
      <td class="no-trunc"><span class="badge ${etatBadge}">${etatLabel}</span></td>
      <td class="no-trunc">${FD(r.dateAcq)}</td>
      <td class="n no-trunc">${F(r.vo)}</td>
      <td class="n no-trunc" style="color:var(--red)">${F(r.cum)}</td>
      <td class="n no-trunc" style="color:${r.vnc<=0?'var(--red)':'var(--green)'}"><strong>${F(r.vnc)}</strong></td>
      <td class="n no-trunc" style="color:var(--text3)">${pct}%</td>
      <td class="no-trunc">${r.statut!=='sorti'?`<button class="btn xs" style="color:var(--amber);border-color:var(--amber-light)" onclick="propSortieFromInv('${r.id}')">Sortie</button>`:'—'}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:1rem">Aucune immobilisation trouvée</td></tr>';
  document.getElementById('inv-res').style.display='block';
}

function saveInvSituation(){
  // Utiliser le cache — pas de recalcul
  if(!_invCache||!_invCache.rows||_invCache.rows.length===0){
    toast('Générez d\'abord un inventaire avant de sauvegarder','e');
    return;
  }
  // Permettre de changer le label au moment de la sauvegarde
  const labelInput=(document.getElementById('inv-label')?.value||'').trim();
  const label=labelInput||_invCache.label||('Inventaire au '+FD(_invCache.date));
  if(!DB.inventaires)DB.inventaires=[];
  const existing=DB.inventaires.findIndex(s=>s.date===_invCache.date&&s.label===label);
  const sit={
    id:'inv'+Date.now(),
    date:_invCache.date,
    label,
    rows:_invCache.rows,
    tVO:_invCache.tVO,
    tCum:_invCache.tCum,
    tVNC:_invCache.tVNC,
    savedAt:new Date().toISOString(),
    by:currentUser?.nom||'?'
  };
  if(existing>=0){
    if(!confirm('La situation "'+label+'" au '+FD(_invCache.date)+' existe déjà. Écraser ?'))return;
    DB.inventaires[existing]=sit;
  } else {
    DB.inventaires.push(sit);
  }
  try{
    dbSave();
    toast('✓ Situation sauvegardée — '+label);
  } catch(e){
    toast('Erreur de sauvegarde (localStorage plein ?)','e');
    console.error('saveInv error:',e);
  }
}

function showSavedInv(){
  const wrap=document.getElementById('inv-saved-wrap');
  if(!DB.inventaires||!DB.inventaires.length){
    document.getElementById('inv-saved-list').innerHTML='<p style="color:var(--text3);font-size:13px">Aucune situation sauvegardée.</p>';
    wrap.style.display='block';return;
  }
  document.getElementById('inv-saved-list').innerHTML=DB.inventaires.slice().reverse().map(s=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface2);border-radius:var(--r);flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-weight:500;font-size:13px">${s.label}</div>
        <div style="font-size:11px;color:var(--text3)">Au ${FD(s.date)} — ${s.rows.length} immos — Sauvegardé le ${new Date(s.savedAt).toLocaleDateString('fr-FR')} par ${s.by}</div>
      </div>
      <div style="font-size:12px;font-family:var(--m);text-align:right;flex-shrink:0">
        <div style="color:var(--blue)">VO : ${F(s.tVO)}</div>
        <div style="color:var(--green)">VNC : ${F(s.tVNC)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn sm" onclick="restoreInvSituation('${s.id}')">Reprendre</button>
        <button class="btn sm" onclick="printSavedInv('${s.id}')">🖨 Imprimer</button>
        <button class="btn xs d" onclick="deleteSavedInv('${s.id}')">×</button>
      </div>
    </div>`).join('');
  wrap.style.display='block';
}

function restoreInvSituation(id){
  const s=DB.inventaires.find(x=>x.id===id);if(!s)return;
  // Restaurer les filtres
  document.getElementById('inv-d').value=s.date;
  if(document.getElementById('inv-label'))document.getElementById('inv-label').value=s.label;
  // Afficher le résultat sauvegardé
  const tVO=s.tVO,tCum=s.tCum,tVNC=s.tVNC;
  document.getElementById('inv-title').textContent=s.label;
  document.getElementById('inv-cnt').textContent=s.rows.length+' immobilisation(s)';
  document.getElementById('inv-kpi').innerHTML=`
    <div class="kpi"><div class="kpi-l">Valeur d'origine totale</div><div class="kpi-v b">${F(tVO)}</div></div>
    <div class="kpi"><div class="kpi-l">Cumul amortissements</div><div class="kpi-v r">${F(tCum)}</div></div>
    <div class="kpi"><div class="kpi-l">VNC globale au ${FD(s.date)}</div><div class="kpi-v g">${F(tVNC)}</div></div>
    <div class="kpi"><div class="kpi-l">Nb immobilisations</div><div class="kpi-v a">${s.rows.length}</div></div>`;
  document.getElementById('inv-tb').innerHTML=s.rows.map(r=>{
    const pct=r.vo>0?Math.round(r.cum/r.vo*100):0;
    const etatLabel=r.vnc<=0?'Amorti':pct>=75?'Presque amorti':'Actif';
    const etatBadge=r.vnc<=0?'a':pct>=75?'a':'g';
    return`<tr>
      <td><code>${escapeHtml(r.code)}</code></td><td>${escapeHtml(r.designation)}</td>
      <td style="font-size:12px;color:var(--text2)">${r.nature||'—'}</td>
      <td><span class="badge ${CC(r.categorie)}">${r.categorie}</span></td>
      <td style="font-size:12px">${r.affectation||'—'}</td>
      <td><span class="badge ${etatBadge}">${etatLabel}</span></td>
      <td>${FD(r.dateAcq)}</td>
      <td class="n">${F(r.vo)}</td>
      <td class="n" style="color:var(--red)">${F(r.cum)}</td>
      <td class="n" style="color:${r.vnc<=0?'var(--red)':'var(--green)'}"><strong>${F(r.vnc)}</strong></td>
      <td class="n" style="color:var(--text3)">${pct}%</td>
      <td>—</td>
    </tr>`;
  }).join('');
  document.getElementById('inv-res').style.display='block';
  document.getElementById('inv-saved-wrap').style.display='none';
  toast('Situation restaurée : '+s.label);
}

function deleteSavedInv(id){
  if(!confirm('Supprimer cette situation sauvegardée ?'))return;
  DB.inventaires=DB.inventaires.filter(x=>x.id!==id);
  dbSave();showSavedInv();toast('Situation supprimée');
}

function printInv(){
  const date=document.getElementById('inv-d')?.value||TD();
  const label=document.getElementById('inv-label')?.value||('Inventaire au '+FD(date));
  _printInvHTML(label,date,_getCurrentInvRows());
}
function printSavedInv(id){
  const s=DB.inventaires.find(x=>x.id===id);if(!s)return;
  _printInvHTML(s.label,s.date,s.rows);
}
function _getCurrentInvRows(){
  const{list,date}=getInvList();if(!date)return[];
  return list.map(im=>{const cum=cumAt(im,date);return{code:im.code,designation:im.designation,nature:im.nature||'',categorie:im.categorie,affectation:im.affectation||'',dateAcq:im.dateAcq,vo:im.vo,cum,vnc:Math.max(0,im.vo-cum),etat:im.etat||'bon'};});
}
function _printInvHTML(label,date,rows){
  const ent=DB.params.entite||{};
  const today=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const tVO=rows.reduce((a,r)=>a+r.vo,0);
  const tCum=rows.reduce((a,r)=>a+r.cum,0);
  const tVNC=rows.reduce((a,r)=>a+r.vnc,0);
  const tableRows=rows.map((r,i)=>{
    const pct=r.vo>0?Math.round(r.cum/r.vo*100):0;
    return`<tr style="${i%2===0?'':'background:#f8faff'}">
      <td>\</td><td>\</td><td>${r.nature||'—'}</td>
      <td>${r.categorie}</td><td>\</td>
      <td>${FD(r.dateAcq)}</td>
      <td style="text-align:right;font-family:monospace">${F(r.vo)}</td>
      <td style="text-align:right;font-family:monospace;color:#991B1B">${F(r.cum)}</td>
      <td style="text-align:right;font-family:monospace;font-weight:600;color:${r.vnc<=0?'#991B1B':'#166534'}">${F(r.vnc)}</td>
      <td style="text-align:right">${pct}%</td>
    </tr>`;
  }).join('');
  const w=window.open('','_blank','width=1100,height=750');if(!w)return;
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>${label}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:24px 28px}
    .org-header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid #1A5FB4;margin-bottom:16px}
    .org-name{font-size:16px;font-weight:700;color:#0F2252}
    .org-meta{font-size:10px;color:#6B7280;margin-top:3px;line-height:1.6}
    .doc-badge{background:#1A5FB4;color:#fff;font-size:9px;font-weight:600;padding:3px 10px;border-radius:12px;margin-bottom:4px;display:inline-block}
    .doc-date{font-size:10px;color:#6B7280}
    .inv-title{font-size:14px;font-weight:700;color:#0F2252;margin-bottom:4px}
    .inv-date{font-size:12px;color:#1A5FB4;font-weight:500;margin-bottom:14px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:#F5F7FA;border:1px solid #DDE5F3;border-radius:6px;padding:8px 10px}
    .kpi-l{font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
    .kpi-v{font-size:14px;font-weight:600;font-family:monospace}
    .kpi-v.b{color:#1A5FB4}.kpi-v.r{color:#991B1B}.kpi-v.g{color:#166534}
    table{width:100%;border-collapse:collapse;font-size:10px}
    thead th{background:#1A5FB4;color:#fff;padding:6px 8px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    thead th:nth-child(n+7){text-align:right}
    tbody td{padding:5px 8px;border-bottom:1px solid #EEF1F8}
    tfoot td{padding:7px 8px;background:#EFF3FA;font-weight:700;border-top:2px solid #1A5FB4;font-family:monospace}
    tfoot td:nth-child(n+7){text-align:right}
    .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:24px}
    .sig-box{border-top:1px solid #6B7280;padding-top:6px;font-size:10px;color:#6B7280}
    .footer{margin-top:18px;padding-top:8px;border-top:1px solid #DDE5F3;display:flex;justify-content:space-between;font-size:9px;color:#9CA3AF}
    @media print{body{padding:10px 14px}@page{size:A4 landscape;margin:10mm 12mm} button{display:none}}
  </style>
  </head><body>
  <button onclick="window.print()" style="position:fixed;top:12px;right:12px;background:#1A5FB4;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">🖨 Imprimer / PDF</button>
  <div class="org-header">
    <div style="display:flex;align-items:center;gap:12px">
      ${ent.logo?`<img src="${ent.logo}" style="max-height:48px;max-width:100px;object-fit:contain">`:''}
      <div>
        <div class="org-name">${escapeHtml(ent.rs||'Organisation')}</div>
        <div class="org-meta">${escapeHtml(ent.adresse||'')}${ent.tel?' — Tél : '+ent.tel:''}<br>${ent.ninea?'NINEA : '+ent.ninea:''}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div class="doc-badge">État de l'inventaire</div>
      <div class="doc-date">Édité le ${today}</div>
    </div>
  </div>
  <div class="inv-title">${label}</div>
  <div class="inv-date">Date d'inventaire : ${new Date(date).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-l">Valeur d'origine</div><div class="kpi-v b">${F(tVO)} FCFA</div></div>
    <div class="kpi"><div class="kpi-l">Cumul amorti</div><div class="kpi-v r">${F(tCum)} FCFA</div></div>
    <div class="kpi"><div class="kpi-l">VNC au ${FD(date)}</div><div class="kpi-v g">${F(tVNC)} FCFA</div></div>
    <div class="kpi"><div class="kpi-l">Nb immobilisations</div><div class="kpi-v">${rows.length}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Code</th><th>Désignation</th><th>Nature</th><th>Catégorie</th>
      <th>Lieu</th><th>Date acq.</th>
      <th style="text-align:right">V. Origine</th>
      <th style="text-align:right">Cumul amort.</th>
      <th style="text-align:right">VNC au ${FD(date)}</th>
      <th style="text-align:right">% amorti</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
    <tfoot><tr>
      <td colspan="6">TOTAL GÉNÉRAL — ${rows.length} immobilisation(s)</td>
      <td style="text-align:right">${F(tVO)}</td>
      <td style="text-align:right;color:#991B1B">${F(tCum)}</td>
      <td style="text-align:right;color:#166534">${F(tVNC)}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div class="sig">
    <div class="sig-box">Le Gestionnaire des actifs<br><br><br></div>
    <div class="sig-box">Le Responsable administratif<br><br><br></div>
    <div class="sig-box">Le Directeur / DG<br><br><br></div>
  </div>
  <div class="footer">
    <span>ImmoGestion — État de l'inventaire — ${label}</span>
    <span>Édité le ${today}</span>
  </div>
  <scr`+`ipt>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));<\/script>
  </body></html>`);
  w.document.close();
}

function exportInv(){
  const{list,date}=getInvList();if(!date)return;
  let csv='Code;Désignation;Nature;Catégorie;Lieu d\'affectation;État;Date acq.;Valeur origine;Cumul amort.;VNC;% amorti\n';
  list.forEach(im=>{
    const cum=cumAt(im,date);const vnc=Math.max(0,im.vo-cum);
    const pct=im.vo>0?Math.round(cum/im.vo*100):0;
    const etat=im.statut==='sorti'?'Sorti':vnc<=0?'Amorti':pct>=75?'Presque amorti':'Actif';
    csv+=`\;\;${im.nature||''};${im.categorie};\;${etat};${im.dateAcq};${im.vo};${cum};${vnc};${pct}%\n`;
  });
  dlFile('inventaire_'+date+'.csv',csv,'text/csv');
}

// ── AMORTISSEMENTS ──
function popAmortSel(){ /* remplacé par la recherche dynamique */ }

// ── RECHERCHE IMMO dans page Amortissements ──
let _amortSearchIdx=-1;
function amortSearchInput(){
  _amortSearchIdx=-1;
  const q=(document.getElementById('asel-search').value||'').toLowerCase().trim();
  const list=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const results=q?list.filter(im=>im.code.toLowerCase().includes(q)||im.designation.toLowerCase().includes(q)||(im.categorie||'').toLowerCase().includes(q)||(im.affectation||'').toLowerCase().includes(q)):list;
  amortRenderDropdown(results,q);
}
function amortRenderDropdown(results,q){
  const dd=document.getElementById('asel-dropdown');
  const listEl=document.getElementById('asel-list');
  const hl=(txt,q)=>{if(!q)return txt;const i=txt.toLowerCase().indexOf(q.toLowerCase());if(i<0)return txt;return txt.slice(0,i)+`<mark style="background:#FEF3C7;border-radius:2px;padding:0 1px">`+txt.slice(i,i+q.length)+`</mark>`+txt.slice(i+q.length);};
  if(!results.length){listEl.innerHTML=`<div style="padding:12px 14px;font-size:13px;color:var(--text3);text-align:center">Aucune immobilisation trouvée</div>`;dd.style.display='block';return;}
  const METH={lin:'Linéaire',deg:'Dég. SYSCOHADA',degf:'Dég. fiscal',uo:'UO'};
  listEl.innerHTML=results.map((im,idx)=>{
    const cum=cumAt(im,TD()),vnc=Math.max(0,im.vo-cum),pct=im.vo>0?Math.round(cum/im.vo*100):0;
    return`<div class="amort-item" data-id="${im.id}" data-idx="${idx}"
      onclick="amortSelectImmo('${im.id}')" onmouseenter="amortHoverItem(${idx})"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <code style="font-size:11px;color:var(--blue);background:var(--blue-light);padding:1px 6px;border-radius:4px">${hl(im.code,q)}</code>
          <span class="badge ${CC(im.categorie)}" style="font-size:10px">${im.categorie}</span>
        </div>
        <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hl(im.designation,q)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;display:flex;gap:10px">
          <span>${METH[im.methode]||im.methode} — ${im.duree} ans</span>
          <span style="color:${pct>=100?'var(--red)':'var(--text3)'}">Amorti ${pct}%</span>
          <span style="font-family:var(--m)">VNC ${F(vnc)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  dd.style.display='block';
}
function amortSearchOpen(){if(!document.getElementById('asel').value)amortSearchInput();}
function amortSearchKey(e){
  const items=document.querySelectorAll('.amort-item');if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_amortSearchIdx=Math.min(_amortSearchIdx+1,items.length-1);amortHighlight();}
  else if(e.key==='ArrowUp'){e.preventDefault();_amortSearchIdx=Math.max(_amortSearchIdx-1,0);amortHighlight();}
  else if(e.key==='Enter'){e.preventDefault();if(_amortSearchIdx>=0)items[_amortSearchIdx].click();}
  else if(e.key==='Escape'){document.getElementById('asel-dropdown').style.display='none';}
}
function amortHighlight(){
  document.querySelectorAll('.amort-item').forEach((el,i)=>{el.style.background=i===_amortSearchIdx?'var(--blue-light)':'';});
  const active=document.querySelectorAll('.amort-item')[_amortSearchIdx];
  if(active)active.scrollIntoView({block:'nearest'});
}
function amortHoverItem(idx){_amortSearchIdx=idx;amortHighlight();}
function amortSelectImmo(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  document.getElementById('asel').value=id;
  document.getElementById('asel-search').value=im.code+' — '+im.designation;
  document.getElementById('asel-dropdown').style.display='none';
  loadAmortImmo();
}
function amortSearchClear(){
  document.getElementById('asel-search').value='';document.getElementById('asel').value='';
  document.getElementById('asel-dropdown').style.display='none';
  ['aivo','aivnc','aimeth','aicum'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  document.getElementById('apt').textContent='Plan d\'amortissement';
  document.getElementById('atb').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem">Sélectionnez une immobilisation ci-dessus</td></tr>';
  document.getElementById('asel-search').focus();
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#asel-search')&&!e.target.closest('#asel-dropdown')){
    const dd=document.getElementById('asel-dropdown');if(dd)dd.style.display='none';
  }
});
function loadAmortImmo(){
  const id=document.getElementById('asel').value;
  const METH_LBL={lin:'Linéaire',deg:'Dégressif comptable (SYSCOHADA)',degf:'Dégressif fiscal (Sénégal)',uo:'Unités d\'œuvre'};
  if(!id){
    ['aivo','aimeth','aicum','aivnc'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
    document.getElementById('apt').textContent='Plan d\'amortissement';
    document.getElementById('atb').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem">Sélectionnez une immobilisation ci-dessus</td></tr>';
    return;
  }
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const cum=cumAt(im,TD());
  const el_vo=document.getElementById('aivo');if(el_vo)el_vo.value=F(im.vo)+' FCFA';
  const el_m=document.getElementById('aimeth');if(el_m)el_m.value=METH_LBL[im.methode]||im.methode;
  const el_c=document.getElementById('aicum');if(el_c)el_c.value=F(cum)+' FCFA';
  const el_v=document.getElementById('aivnc');if(el_v)el_v.value=F(Math.max(0,im.vo-cum))+' FCFA';
  const plan=buildPlan(im);
  const infoBar=document.getElementById('amort-info-bar');
  if(infoBar){
    infoBar.style.display='block';
    infoBar.innerHTML=`
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px">
        <div><span style="color:var(--text3)">Code</span> <strong style="font-family:var(--m);color:var(--blue)">${escapeHtml(im.code)}</strong></div>
        <div><span style="color:var(--text3)">Désignation</span> <strong>${escapeHtml(im.designation)}</strong></div>
        <div><span style="color:var(--text3)">Référence</span> ${escapeHtml(im.invNum||im.serie||'—')}</div>
        <div><span style="color:var(--text3)">V. Origine</span> <strong style="font-family:var(--m);color:var(--blue)">${F(im.vo)} FCFA</strong></div>
        <div><span style="color:var(--text3)">Date achat</span> ${FD(im.dateAcq)}</div>
        <div><span style="color:var(--text3)">Fournisseur</span> ${escapeHtml(im.fournisseur||'—')}</div>
        <div><span style="color:var(--text3)">Méthode</span> ${METH_LBL[im.methode]||im.methode}</div>
        <div><span style="color:var(--text3)">Taux</span> <strong>${(im.taux*100).toFixed(2)}%</strong></div>
      </div>`;
  }
  document.getElementById('apt').textContent='Plan — '+im.code+' — '+im.designation;
  document.getElementById('atb').innerHTML=plan.map(r=>{
    const pct=im.vo>0?(r.cum/im.vo*100):0;
    return`<tr><td>${r.yr}</td><td class="n">${F(r.vd)}</td><td class="n">${(r.rt*100).toFixed(2)}%</td><td class="n">${F(r.dt)}</td><td class="n">${F(r.cum)}</td><td class="n" style="color:${r.vnc<=0?'var(--red)':'inherit'}">${F(r.vnc)}</td><td class="n" style="color:var(--text3)">${pct.toFixed(0)}%</td></tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:1rem">Aucune donnée</td></tr>';
}
function calcSim(){}

// ── AFFECTATIONS ──
function rdAff(){
  // Réinitialiser le champ de recherche modal
  document.getElementById('af1-search').value='';
  document.getElementById('af1').value='';
  document.getElementById('af1-preview').style.display='none';
  document.getElementById('af1-dropdown').style.display='none';
  document.getElementById('af2').value=TD();
  document.getElementById('af3').value='';
  // Populate filter dropdowns
  const allImmos=[...new Set(DB.affectations.map(a=>a.code+'|'+a.designation))].sort();
  const allLieux=[...new Set([...DB.affectations.map(a=>a.ancien),...DB.affectations.map(a=>a.nouveau)].filter(x=>x&&x!=='—'))].sort();
  const allResps=[...new Set(DB.affectations.map(a=>a.resp).filter(Boolean))].sort();
  const fImmo=document.getElementById('aff-flt-immo');
  const fLieu=document.getElementById('aff-flt-lieu');
  const fResp=document.getElementById('aff-flt-resp');
  const prevImmo=fImmo.value,prevLieu=fLieu.value,prevResp=fResp.value;
  fImmo.innerHTML='<option value="">Toutes les immobilisations</option>'+allImmos.map(v=>{const[c,d]=v.split('|');return`<option value="${v}">${c} — ${d}</option>`;}).join('');
  fLieu.innerHTML='<option value="">Tous les lieux</option>'+allLieux.map(l=>`<option value="${l}">${l}</option>`).join('');
  fResp.innerHTML='<option value="">Tous les responsables</option>'+allResps.map(r=>`<option value="${r}">${r}</option>`).join('');
  fImmo.value=prevImmo;fLieu.value=prevLieu;fResp.value=prevResp;
  let filtered=DB.affectations;
  if(prevImmo){const[c]=prevImmo.split('|');filtered=filtered.filter(a=>a.code===c);}
  if(prevLieu)filtered=filtered.filter(a=>a.nouveau===prevLieu||a.ancien===prevLieu);
  if(prevResp)filtered=filtered.filter(a=>a.resp===prevResp);
  const cnt=document.getElementById('aff-flt-count');
  if(cnt)cnt.textContent=filtered.length+' résultat(s)';
  document.getElementById('aff-tb').innerHTML=filtered.map(a=>`<tr><td>${FD(a.date)}</td><td><code>${escapeHtml(a.code)}</code></td><td>${escapeHtml(a.designation)}</td><td style="color:var(--text3)">${escapeHtml(a.ancien)}</td><td><strong>${escapeHtml(a.nouveau)}</strong></td><td>${escapeHtml(a.resp||'—')}</td><td style="color:var(--text3)">${escapeHtml(a.motif||'—')}</td><td style="text-align:center"><button class="btn sm" data-need-write onclick="if(guardWrite())editAff('${a.id}')" title="Modifier" style="padding:2px 6px">✏️</button><button class="btn sm d" data-need-delete onclick="if(guardDelete())deleteAff('${a.id}')" title="Supprimer" style="padding:2px 6px;margin-left:4px">🗑️</button></td></tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:2rem">Aucune affectation trouvée</td></tr>';
  applyRoleUI();
  const bl={};DB.immobilisations.filter(i=>i.statut!=='sorti').forEach(im=>{const l=im.affectation||'Non affecté';if(!bl[l])bl[l]=0;bl[l]++;});
  document.getElementById('aff-chart').innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">'+Object.entries(bl).sort((a,b)=>b[1]-a[1]).map(([l,n])=>`<div style="background:var(--surface2);border-radius:var(--r);padding:.75rem;text-align:center"><div style="font-size:24px;font-weight:700;color:var(--blue)">${n}</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${l}</div></div>`).join('')+'</div>';
}

// ── RECHERCHE IMMO dans modal affectation ──
let _affSearchIdx=-1;
function affSearchInput(){
  _affSearchIdx=-1;
  const q=(document.getElementById('af1-search').value||'').toLowerCase().trim();
  const list=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const results=q?list.filter(im=>
    im.code.toLowerCase().includes(q)||
    im.designation.toLowerCase().includes(q)||
    (im.categorie||'').toLowerCase().includes(q)||
    (im.affectation||'').toLowerCase().includes(q)||
    (im.nature||'').toLowerCase().includes(q)
  ):list;
  affRenderDropdown(results,q);
}
function affRenderDropdown(results,q){
  const dd=document.getElementById('af1-dropdown');
  const listEl=document.getElementById('af1-list');
  if(!results.length){
    listEl.innerHTML=`<div style="padding:12px 14px;font-size:13px;color:var(--text3);text-align:center">Aucune immobilisation trouvée</div>`;
    dd.style.display='block';return;
  }
  const hl=(txt,q)=>{
    if(!q)return txt;
    const i=txt.toLowerCase().indexOf(q.toLowerCase());
    if(i<0)return txt;
    return txt.slice(0,i)+`<mark style="background:#FEF3C7;border-radius:2px;padding:0 1px">`+txt.slice(i,i+q.length)+`</mark>`+txt.slice(i+q.length);
  };
  listEl.innerHTML=results.map((im,idx)=>{
    const cum=cumAt(im,TD());
    const vnc=Math.max(0,im.vo-cum);
    const pct=im.vo>0?Math.round(cum/im.vo*100):0;
    return`<div class="aff-item" data-id="${im.id}" data-idx="${idx}"
      onclick="affSelectImmo('${im.id}')"
      onmouseenter="affHoverItem(${idx})"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <code style="font-size:11px;color:var(--blue);background:var(--blue-light);padding:1px 6px;border-radius:4px">${hl(im.code,q)}</code>
          <span class="badge ${CC(im.categorie)}" style="font-size:10px">${im.categorie}</span>
        </div>
        <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hl(im.designation,q)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;display:flex;gap:10px">
          <span>\</span>
          <span style="color:${pct>=100?'var(--red)':'var(--text3)'}">Amorti ${pct}%</span>
          <span style="font-family:var(--m)">VNC ${F(vnc)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  dd.style.display='block';
}
function affSearchOpen(){
  const q=(document.getElementById('af1-search').value||'').trim();
  if(!document.getElementById('af1').value){
    affSearchInput();
  }
}
function affSearchKey(e){
  const items=document.querySelectorAll('.aff-item');
  if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();_affSearchIdx=Math.min(_affSearchIdx+1,items.length-1);affHighlight();}
  else if(e.key==='ArrowUp'){e.preventDefault();_affSearchIdx=Math.max(_affSearchIdx-1,0);affHighlight();}
  else if(e.key==='Enter'){e.preventDefault();if(_affSearchIdx>=0)items[_affSearchIdx].click();}
  else if(e.key==='Escape'){affSearchClose();}
}
function affHighlight(){
  document.querySelectorAll('.aff-item').forEach((el,i)=>{
    el.style.background=i===_affSearchIdx?'var(--blue-light)':'';
  });
  const active=document.querySelectorAll('.aff-item')[_affSearchIdx];
  if(active)active.scrollIntoView({block:'nearest'});
}
function affHoverItem(idx){_affSearchIdx=idx;affHighlight();}
function affSelectImmo(id){
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  document.getElementById('af1').value=id;
  document.getElementById('af1-search').value=im.code+' — '+im.designation;
  document.getElementById('af1-dropdown').style.display='none';
  document.getElementById('af3').value=im.affectation||'Non affecté';
  // Afficher l'aperçu
  const cum=cumAt(im,TD());
  const vnc=Math.max(0,im.vo-cum);
  const pct=im.vo>0?Math.round(cum/im.vo*100):0;
  const prev=document.getElementById('af1-preview');
  prev.style.display='block';
  prev.innerHTML=`<div style="display:flex;gap:16px;flex-wrap:wrap">
    <div><span style="opacity:.7">Catégorie</span><br><strong>${im.categorie}</strong></div>
    <div><span style="opacity:.7">Affectation actuelle</span><br><strong>\</strong></div>
    <div><span style="opacity:.7">V. Origine</span><br><strong style="font-family:var(--m)">${F(im.vo)}</strong></div>
    <div><span style="opacity:.7">VNC</span><br><strong style="font-family:var(--m)">${F(vnc)}</strong></div>
    <div><span style="opacity:.7">% Amorti</span><br><strong>${pct}%</strong></div>
  </div>`;
}
function affSearchClear(){
  document.getElementById('af1-search').value='';
  document.getElementById('af1').value='';
  document.getElementById('af1-preview').style.display='none';
  document.getElementById('af3').value='';
  document.getElementById('af1-dropdown').style.display='none';
  document.getElementById('af1-search').focus();
}
function affSearchClose(){
  document.getElementById('af1-dropdown').style.display='none';
}
// Fermer le dropdown en cliquant ailleurs
document.addEventListener('click',e=>{
  if(!e.target.closest('#m-aff'))affSearchClose();
});

function onAffCh(){const id=document.getElementById('af1').value;const im=DB.immobilisations.find(x=>x.id===id);document.getElementById('af3').value=im?im.affectation||'—':'';}
function saveAff(){
  if(!guardWrite())return;
  const editId=document.getElementById('m-aff').dataset.editId;
  const id=document.getElementById('af1').value;const im=DB.immobilisations.find(x=>x.id===id);
  const nouv=document.getElementById('af4').value.trim();const date=document.getElementById('af2').value;
  if(!im||!nouv||!date){toast('Champs obligatoires manquants — sélectionnez une immobilisation','e');return;}
  if(editId){
    const aff=DB.affectations.find(a=>a.id===editId);
    if(aff){
      aff.date=date;aff.immoId=id;aff.code=im.code;aff.designation=im.designation;
      aff.nouveau=nouv;aff.resp=document.getElementById('af5').value;aff.motif=document.getElementById('af6').value;
    }
  }else{
    DB.affectations.push({id:'a'+Date.now(),date,immoId:id,code:im.code,designation:im.designation,ancien:im.affectation||'—',nouveau:nouv,resp:document.getElementById('af5').value,motif:document.getElementById('af6').value});
  }
  im.affectation=nouv;dbSave();closeM('m-aff');rdAff();toast(editId?'Affectation modifiée':'Affectation enregistrée');
}
function deleteAff(id){
  if(!guardDelete())return;
  const idx=DB.affectations.findIndex(a=>a.id===id);
  if(idx===-1)return;
  if(confirm("Voulez-vous vraiment supprimer cette affectation ?")){
    DB.affectations.splice(idx,1);
    dbSave();rdAff();toast("Affectation supprimée");
  }
}
function editAff(id) {
  if(!guardWrite())return;
  const aff = DB.affectations.find(a=>a.id===id);
  if(!aff)return;
  openAffModal();
  document.getElementById('af1-search').value = aff.code + ' — ' + aff.designation;
  document.getElementById('af1').value = aff.immoId;
  document.getElementById('af2').value = aff.date;
  document.getElementById('af3').value = aff.ancien;
  document.getElementById('af4').value = aff.nouveau;
  document.getElementById('af5').value = aff.resp || '';
  document.getElementById('af6').value = aff.motif || '';
  document.getElementById('m-aff').dataset.editId = id;
}

// ── SORTIES ──
function propSortieFromInv(immoId){
  nav('sorties', document.querySelector('.ni[onclick*="sorties"]'));
  setTimeout(()=>openSortie(immoId, true), 150);
}
function openAffModal(immoId){
  delete document.getElementById('m-aff').dataset.editId;
  // Réinitialiser le modal
  affSearchClear();
  document.getElementById('af2').value=TD();
  document.getElementById('af4').value='';
  document.getElementById('af5').value='';
  document.getElementById('af6').value='';
  // Pré-sélectionner une immo si fournie
  if(immoId) affSelectImmo(immoId);
  openM('m-aff');
  setTimeout(()=>document.getElementById('af1-search').focus(),80);
}
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
    return`<div class="aff-item" data-idx="${idx}" onclick="sortSelectImmo('${im.id}')" onmouseenter="sortHoverItem(${idx})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="font-size:11px;color:var(--blue);background:var(--blue-light);padding:1px 6px;border-radius:4px">${hl(im.code,q)}</code><span class="badge ${CC(im.categorie)}" style="font-size:10px">${im.categorie}</span></div><div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hl(im.designation,q)}</div></div></div>`;
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

function popSortSel(){}
function openSortie(immoId, asPending){
  delete document.getElementById('m-sort').dataset.editId;
  sortSearchClear();
  if(immoId) sortSelectImmo(immoId);
  document.getElementById('so3').value=TD();document.getElementById('so4').value='';document.getElementById('so5').value='';document.getElementById('so6').value='';
  // Toggle pending vs direct
  const pendEl=document.getElementById('so-pending-flag');
  if(pendEl) pendEl.checked = !!asPending;
  calcSort();openM('m-sort');
}
function togSort(){const m=document.getElementById('so2').value;document.getElementById('so-pg').style.display=m==='cession'?'flex':'none';calcSort();}
function calcSort(){
  const id=document.getElementById('so1').value;const date=document.getElementById('so3').value;
  if(!id||!date)return;
  const im=DB.immobilisations.find(x=>x.id===id);if(!im)return;
  const cum=cumAt(im,date);const dc=dotComp(im,date);const vnc=Math.max(0,im.vo-cum-dc);
  const prix=+document.getElementById('so4').value||0;
  const motif=document.getElementById('so2').value;
  let res='';
  if(motif==='cession'){const pm=prix-vnc;res=`<br>Prix de cession : <strong>${F(prix)} FCFA</strong> — Résultat : <strong style="color:${pm>=0?'var(--green)':'var(--red)'}">${pm>=0?'+':''}${F(pm)} FCFA</strong>`;}
  document.getElementById('so-info').innerHTML=`<strong>Calcul automatique :</strong><br>Cumul amortissements au ${FD(date)} : <strong>${F(cum)} FCFA</strong><br>Dotation complémentaire : <strong>${F(dc)} FCFA</strong><br>VNC à la date de sortie : <strong style="color:var(--amber)">${F(vnc)} FCFA</strong>${res}`;
}
function saveSort(){
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
      s.immoId=id;s.code=im?im.code:s.code;s.designation=im?im.designation:s.designation;
      s.motif=motif;s.date=date;s.vo=im?im.vo:s.vo;s.cum=cum;s.dc=dc;s.vnc=vnc;
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
    if(im && s.statut!=='attente') im.statut = 'actif';
    dbSave();rdSorties();rdFiches();rdDash();
    toast("Sortie supprimée");
  }
}
function rdSorties(){
  const attente=DB.sorties.filter(s=>s.statut==='attente');
  let validees=DB.sorties.filter(s=>s.statut!=='attente');
  
  const dDeb=document.getElementById('sort-flt-deb');
  const dFin=document.getElementById('sort-flt-fin');
  if(dDeb && dDeb.value) {
    const min = new Date(dDeb.value).getTime();
    validees = validees.filter(s => new Date(s.date).getTime() >= min);
  }
  if(dFin && dFin.value) {
    const max = new Date(dFin.value).getTime() + 86400000;
    validees = validees.filter(s => new Date(s.date).getTime() < max);
  }
  const cess=validees.filter(s=>s.motif==='cession');
  const reb=validees.filter(s=>s.motif==='rebut');
  const vol=validees.filter(s=>s.motif==='vol');
  document.getElementById('snb-att').textContent=attente.length;
  document.getElementById('snb-att').style.display=attente.length?'inline-flex':'none';
  const nbBadge=document.getElementById('nb-sort-att');
  if(nbBadge){nbBadge.textContent=attente.length;nbBadge.style.display=attente.length?'':' none';}
  document.getElementById('snbc').textContent=cess.length;document.getElementById('snbr').textContent=reb.length;document.getElementById('snbv').textContent=vol.length;
  const mb={'cession':'b','rebut':'r','vol':'a'};const ml={'cession':'Cession','rebut':'Rebut','vol':'Vol'};
  // Pending tab
  document.getElementById('sort-att-tb').innerHTML=attente.map(s=>`<tr>
    <td><code>${escapeHtml(s.code)}</code></td><td>${escapeHtml(s.designation)}</td>
    <td><span class="badge ${mb[s.motif]||'gr'}">${ml[s.motif]||s.motif}</span></td>
    <td>${FD(s.date)}</td>
    <td class="n" style="font-family:var(--m);font-size:12px">${F(s.vo)}</td>
    <td class="n" style="font-family:var(--m);font-size:12px;color:var(--amber)">${F(s.vnc)}</td>
    <td style="display:flex;gap:4px">
      <button class="btn xs s" onclick="validerSortie('${s.id}')">✓ Valider</button>
      <button class="btn xs d" onclick="rejeterSortie('${s.id}')">✗ Rejeter</button>
      <button class="btn xs" onclick="editSort('${s.id}')" title="Détails" style="padding:2px 6px">👁️</button>
    </td>
  </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:2rem">Aucune sortie en attente</td></tr>';
  // Validated tab
  document.getElementById('sort-tb').innerHTML=validees.map(s=>{
    const isCes=s.motif==='cession';
    const res=isCes?s.prix-s.vnc:null;
    return`<tr><td style="white-space:nowrap"><code>${escapeHtml(s.code)}</code></td><td style="min-width:200px">${escapeHtml(s.designation)}</td>
    <td style="white-space:nowrap"><span class="badge ${mb[s.motif]||'gr'}">${ml[s.motif]||s.motif}</span></td>
    <td style="white-space:nowrap">${FD(s.date)}</td><td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px">${F(s.vo)}</td>
    <td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px;color:var(--red)">${F(s.cum)}</td>
    <td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px;color:var(--amber)">${F(s.dc)}</td>
    <td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px;color:var(--amber)">${F(s.vnc)}</td>
    ${isCes?`<td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px">${F(s.prix)}</td><td class="n" style="white-space:nowrap;font-family:var(--m);font-size:12px;color:${res>=0?'var(--green)':'var(--red)'}">${(res>=0?'+':'')+F(res)}</td>`:'<td colspan="2" style="white-space:nowrap;text-align:center;color:var(--text3);font-size:12px">—</td>'}
    <td style="white-space:nowrap"><button class="btn xs" onclick="showEcSort('${s.id}')">Écriture</button></td>
    <td style="white-space:nowrap;text-align:center;display:flex;gap:4px;justify-content:center">
      <button class="btn sm" data-need-write onclick="if(guardWrite())editSort('${s.id}')" title="Modifier" style="padding:2px 6px">✏️</button>
      <button class="btn sm d" data-need-delete onclick="if(guardDelete())deleteSort('${s.id}')" title="Supprimer" style="padding:2px 6px">🗑️</button>
      <button class="btn sm" onclick="printSortie('${s.id}')" title="Imprimer" style="padding:2px 6px">🖨️</button>
    </td></tr>`;
  }).join('')||'<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:2rem">Aucune sortie validée</td></tr>';
  popSortSel();
  applyRoleUI();
}

function printSortiesPeriod() {
  const dDeb=document.getElementById('sort-flt-deb');
  const dFin=document.getElementById('sort-flt-fin');
  let validees=DB.sorties.filter(s=>s.statut!=='attente');
  
  let pDeb = dDeb && dDeb.value ? dDeb.value : '';
  let pFin = dFin && dFin.value ? dFin.value : '';

  if(pDeb) {
    const min = new Date(pDeb).getTime();
    validees = validees.filter(s => new Date(s.date).getTime() >= min);
  }
  if(pFin) {
    const max = new Date(pFin).getTime() + 86400000;
    validees = validees.filter(s => new Date(s.date).getTime() < max);
  }

  const e = DB.params.entite || {};
  const ml={'cession':'Cession','rebut':'Mise au rebut','vol':'Vol / Sinistre'};

  const rows = validees.map(s => {
    const isCes=s.motif==='cession';
    const res=isCes?s.prix-s.vnc:null;
    return `<tr>
      <td>${escapeHtml(s.code)}</td>
      <td>${escapeHtml(s.designation)}</td>
      <td>${ml[s.motif]||s.motif}</td>
      <td>${FD(s.date)}</td>
      <td style="text-align:right">${F(s.vo)}</td>
      <td style="text-align:right">${F(s.cum)}</td>
      <td style="text-align:right">${F(s.dc)}</td>
      <td style="text-align:right">${F(s.vnc)}</td>
      <td style="text-align:right">${isCes ? F(s.prix) : '—'}</td>
      <td style="text-align:right">${isCes ? (res>=0?'+':'')+F(res) : '—'}</td>
    </tr>`;
  }).join('');

  let periodeText = '';
  if (pDeb && pFin) periodeText = `Du ${FD(pDeb)} au ${FD(pFin)}`;
  else if (pDeb) periodeText = `À partir du ${FD(pDeb)}`;
  else if (pFin) periodeText = `Jusqu'au ${FD(pFin)}`;
  else periodeText = `Toutes les sorties validées`;

  const html = `<!DOCTYPE html>
  <html><head><meta charset="utf-8"><title>État des Sorties</title>
  <style>
    body{font-family:'Inter',sans-serif;font-size:11px;color:#000;margin:0;padding:20px}
    .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    th,td{border:1px solid #000;padding:4px 6px;text-align:left}
    th{background:#f0f0f0;font-weight:bold}
    .tot{font-weight:bold;background:#f9f9f9}
  </style>
  </head><body>
    <div class="hdr">
      <div>
        <strong>${escapeHtml(e.rs||'ENTREPRISE')}</strong><br>
        ${e.adresse ? escapeHtml(e.adresse)+'<br>':''}
        ${e.ninea ? 'NINEA: '+escapeHtml(e.ninea):''}
      </div>
      <div style="text-align:right">
        <h2 style="margin:0">ÉTAT DES SORTIES D'ACTIFS</h2>
        <div style="font-size:12px;margin-top:5px">${periodeText}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Désignation</th>
          <th>Motif</th>
          <th>Date</th>
          <th style="text-align:right">V. Origine</th>
          <th style="text-align:right">Cumul Amort.</th>
          <th style="text-align:right">Dot. Compl.</th>
          <th style="text-align:right">VNC Sortie</th>
          <th style="text-align:right">Prix Cession</th>
          <th style="text-align:right">Résultat</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="10" style="text-align:center">Aucune sortie pour cette période</td></tr>'}</tbody>
    </table>
    <div style="font-size:9px;text-align:center;color:#666">Imprimé le ${FD(TD())} via ImmoGestion</div>
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  window.open(URL.createObjectURL(blob),'_blank');

}
function validerSortie(id){
  if(!can('canValidate')){toast('Validation non autorisée pour votre rôle','e');return;}
  const s=DB.sorties.find(x=>x.id===id);if(!s)return;
  const im=DB.immobilisations.find(x=>x.id===s.immoId);
  s.statut='validee';
  if(im)im.statut='sorti';
  dbSave();rdSorties();rdFiches();rdDash();toast('Sortie validée — écriture disponible');
}
function rejeterSortie(id){
  if(!confirm('Rejeter cette demande de sortie ?'))return;
  const idx=DB.sorties.findIndex(x=>x.id===id);
  if(idx>=0)DB.sorties.splice(idx,1);
  dbSave();rdSorties();toast('Demande de sortie rejetée');
}
function showEcSort(id){
  const s=DB.sorties.find(x=>x.id===id);if(!s)return;
  const im=DB.immobilisations.find(x=>x.id===s.immoId)||{ci:'2400',ca:'2800'};
  const res=s.motif==='cession'?s.prix-s.vnc:null;
  // Écriture comptable selon motif
  // Principe : Débit total = Crédit total
  // CESSION : Amort. cumulés(D) + Prix cession(D) + Dot.compl(D) = Immo(C) + Plus-value(C) / Moins-value(D)
  // REBUT/VOL : Amort. cumulés(D) + Dot.compl(D) + Perte(D) = Immo(C)
  const rows=[];
  const cptAmort=s.ca||im.ca||'2800';
  const cptImmo=s.ci||im.ci||'2400';
  const cptPerte=s.motif==='vol'?'6516':'6514';
  const totalAmortDot=s.cum+s.dc;
  if(s.motif==='cession'){
    // Débits
    rows.push({date:s.date,cpt:cptAmort,lib:'Amortissements cumulés',db:s.cum,cr:null});
    if(s.dc>0)rows.push({date:s.date,cpt:'6512',lib:'Dotation complémentaire cession',db:s.dc,cr:null});
    rows.push({date:s.date,cpt:'5211',lib:'Banque — encaissement cession',db:s.prix,cr:null});
    if(res<0)rows.push({date:s.date,cpt:'6514',lib:'Moins-value de cession',db:Math.abs(res),cr:null});
    // Crédits
    rows.push({date:s.date,cpt:cptImmo,lib:'Sortie immobilisation — '+s.designation,db:null,cr:s.vo});
    if(res>0)rows.push({date:s.date,cpt:'7512',lib:'Plus-value de cession',db:null,cr:res});
  } else {
    // REBUT ou VOL : Débit = Amort. cumulés + Dot.compl + VNC restante | Crédit = Valeur d'origine
    rows.push({date:s.date,cpt:cptAmort,lib:'Amortissements cumulés',db:s.cum,cr:null});
    if(s.dc>0)rows.push({date:s.date,cpt:'6512',lib:'Dotation complémentaire',db:s.dc,cr:null});
    if(s.vnc>0)rows.push({date:s.date,cpt:cptPerte,lib:'Perte sur '+s.motif+' — '+s.designation,db:s.vnc,cr:null});
    rows.push({date:s.date,cpt:cptImmo,lib:'Sortie immobilisation — '+s.designation,db:null,cr:s.vo});
  }
  const td=rows.reduce((a,r)=>a+(r.db||0),0),tc=rows.reduce((a,r)=>a+(r.cr||0),0);
  document.getElementById('ecd-title').textContent='Écriture — '+s.designation;
  document.getElementById('ecd-body').innerHTML=`<div class="jnl"><div class="jh"><span>Date</span><span>Compte</span><span>Libellé</span><span style="text-align:right">Débit</span><span style="text-align:right">Crédit</span></div>${rows.map(r=>`<div class="jr"><span>${FD(r.date)}</span><span><code>${r.cpt}</code></span><span>${r.lib}</span><span class="db">${r.db?F(r.db):'—'}</span><span class="cr">${r.cr?F(r.cr):'—'}</span></div>`).join('')}<div class="jt"><span></span><span></span><span style="color:var(--text3)">Totaux</span><span class="db">${F(td)}</span><span class="cr">${F(tc)}</span></div></div>`;
  openM('m-ecdet');
}

// ── ECRITURES ──
function togEcDateMode(){
  const m=document.getElementById('ec-date-mode').value;
  document.getElementById('ec-yr-wrap').style.display=m==='yr'?'':'none';
  document.getElementById('ec-period-wrap').style.display=m==='period'?'':'none';
  document.getElementById('ec-date-wrap').style.display=m==='date'?'':'none';
}
function rdEc(mode, yr, ecLabel, arrete, d1, d2){
  rdClotures();
  mode=mode||'date';
  yr=yr||new Date().getFullYear();
  arrete=arrete||(yr+'-12-31');
  ecLabel=ecLabel||('Arrêté au '+FD(arrete));
  const isLocked=DB.exercicesClos&&DB.exercicesClos.includes(yr);
  
  const rub = document.getElementById('ec-flt-rubrique')?.value;
  const sousRub = document.getElementById('ec-flt-sousrubrique')?.value;
  
  const immos=DB.immobilisations.filter(i=>{
    if(i.statut==='sorti') return false;
    if(rub && i.categorie!==rub) return false;
    if(sousRub && i.nature!==sousRub) return false;
    return true;
  });
  const dotCard=document.getElementById('ec-dot-title');if(dotCard)dotCard.textContent='Dotations — '+ecLabel;
  const ecDate=arrete;
  // Calcul dotations selon mode — PRORATA EXACT
  const getDot=(im)=>{
    if(d1&&d2){
      // Dotation sur la période exacte avec prorata aux bornes
      return dotBetween(im, d1, d2);
    } else {
      // Dotation proratée jusqu'à la date d'arrêté
      return dotAtDate(im, arrete);
    }
  };
  // Dotations
  const bc={};
  immos.forEach(im=>{const dt=getDot(im);if(dt>0){const c=DB.categories.find(x=>x.libelle===im.categorie)||{cptAmort:'2800',cptDot:'6813',libelle:im.categorie};if(!bc[c.cptAmort])bc[c.cptAmort]={ca:c.cptAmort,cd:c.cptDot,lib:c.libelle,dt:0};bc[c.cptAmort].dt+=dt;}});
  const dByCd={};Object.values(bc).forEach(b=>{if(!dByCd[b.cd])dByCd[b.cd]=0;dByCd[b.cd]+=b.dt;});
  const tD=Object.values(dByCd).reduce((a,b)=>a+b,0);
  let dotH=`<div class="jnl" style="margin-top:1rem"><div class="jh"><span>Date</span><span>Compte</span><span>Libellé</span><span style="text-align:right">Débit</span><span style="text-align:right">Crédit</span></div>`;
  Object.entries(dByCd).forEach(([cpt,dt])=>{dotH+=`<div class="jr"><span>${FD(ecDate)}</span><span><code>${cpt}</code></span><span>Dotations aux amortissements — ${ecLabel}</span><span class="db">${F(dt)}</span><span>—</span></div>`;});
  Object.values(bc).forEach(b=>{dotH+=`<div class="jr"><span>${FD(ecDate)}</span><span><code>${b.ca}</code></span><span>Amortissements ${b.lib}</span><span>—</span><span class="cr">${F(b.dt)}</span></div>`;});
  dotH+=`<div class="jt"><span></span><span></span><span style="color:var(--text3)">Totaux</span><span class="db">${F(tD)}</span><span class="cr">${F(tD)}</span></div></div>`;
  document.getElementById('ec-dot-c').innerHTML=dotH;
  // Acquisitions — filtrées selon la période/arrêté
  const immosFiltrees = d1&&d2
    ? immos.filter(im => im.dateAcq >= d1 && im.dateAcq <= d2)
    : immos.filter(im => im.dateAcq <= arrete);
  let acqH=`<div class="jnl" style="margin-top:1rem"><div class="jh"><span>Date</span><span>Compte</span><span>Libellé</span><span style="text-align:right">Débit</span><span style="text-align:right">Crédit</span></div>`;
  let aT=0;
  if(!immosFiltrees.length) acqH+='<div style="padding:.75rem;color:var(--text3);font-size:13px">Aucune acquisition sur cette période.</div>';
  immosFiltrees.forEach(im=>{
    acqH+=`<div class="jr"><span>${FD(im.dateAcq)}</span><span><code>${im.ci||'2400'}</code></span><span>\</span><span class="db">${F(im.vo)}</span><span>—</span></div>`;
    acqH+=`<div class="jr"><span>${FD(im.dateAcq)}</span><span><code>4011</code></span><span>Fournisseur — ${im.fournisseur||im.designation}</span><span>—</span><span class="cr">${F(im.vo+(im.tva?.montant||0))}</span></div>`;
    if(im.tva?.montant>0){
      acqH+=`<div class="jr"><span>${FD(im.dateAcq)}</span><span><code>${im.tva.compte||'445362'}</code></span><span>TVA déductible — \</span><span class="db">${F(im.tva.montant)}</span><span>—</span></div>`;
    }
    aT+=im.vo;
  });
  acqH+=`<div class="jt"><span></span><span></span><span style="color:var(--text3)">Totaux</span><span class="db">${F(aT)}</span><span class="cr">${F(aT)}</span></div></div>`;
  document.getElementById('ec-acq-c').innerHTML=acqH;
  // Sorties — filtrées selon la période/arrêté
  const filtSorties = DB.sorties.filter(s=>{
    if(s.statut==='attente') return false;
    if(d1&&d2 ? (s.date<d1||s.date>d2) : (s.date>arrete)) return false;
    
    // Apply the same Rubrique/Sous-rubrique filter
    const im = DB.immobilisations.find(x=>x.id===s.immoId);
    if(im) {
      if(rub && im.categorie!==rub) return false;
      if(sousRub && im.nature!==sousRub) return false;
    }
    return true;
  });
  const validSorties=filtSorties;
  let sH=validSorties.length===0?'<p style="color:var(--text3);padding:1rem 0;font-size:13px">Aucune sortie validée.</p>':'';
  validSorties.forEach(s=>{
    const im=DB.immobilisations.find(x=>x.id===s.immoId)||{ci:'2400',ca:'2800'};
    const res=s.motif==='cession'?s.prix-s.vnc:null;
    sH+=`<div style="font-size:12px;font-weight:600;color:var(--text3);padding:.5rem 0;margin-top:.75rem;border-top:1px solid var(--border)">\ — ${FD(s.date)}</div>`;
    sH+=`<div class="jnl"><div class="jh"><span>Date</span><span>Compte</span><span>Libellé</span><span style="text-align:right">Débit</span><span style="text-align:right">Crédit</span></div>`;
    sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>${s.ca||im.ca}</code></span><span>Amortissements cumulés</span><span class="db">${F(s.cum)}</span><span>—</span></div>`;
    if(s.dc>0)sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>6512</code></span><span>Dotation complémentaire</span><span class="db">${F(s.dc)}</span><span>—</span></div>`;
    sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>${s.ci||im.ci}</code></span><span>Sortie actif — \</span><span>—</span><span class="cr">${F(s.vo)}</span></div>`;
    if(s.motif==='cession'){
      sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>5211</code></span><span>Banque</span><span class="db">${F(s.prix)}</span><span>—</span></div>`;
      if(res>0)sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>7512</code></span><span>Plus-value cession</span><span>—</span><span class="cr">${F(res)}</span></div>`;
      else if(res<0)sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>6514</code></span><span>Moins-value cession</span><span class="db">${F(Math.abs(res))}</span><span>—</span></div>`;
    }
    // Régularisation TVA si cession avant 5 ans
    const regTVA=calcRegularisationTVA(im,s.date);
    if(regTVA>0){
      sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>445362</code></span><span>Régularisation TVA — cession avant 5 ans (\)</span><span>—</span><span class="cr">${F(regTVA)}</span></div>`;
      sH+=`<div class="jr"><span>${FD(s.date)}</span><span><code>63583</code></span><span>Reversement TVA DGI</span><span class="db">${F(regTVA)}</span><span>—</span></div>`;
    }
    sH+=`</div>`;
  });
  document.getElementById('ec-sor-c').innerHTML=sH;
  // Dérogatoires
  const derogRows=genRapDerog(immos);
  const derEl=document.getElementById('ec-der-c');
  if(derEl){
    if(!derogRows.length){
      derEl.innerHTML='<p style="color:var(--text3);font-size:13px;padding:1rem 0">Aucune immobilisation avec amortissement dérogatoire.</p>';
    } else {
      let dH=`<div class="jnl" style="margin-top:1rem"><div class="jh"><span>Date</span><span>Compte</span><span>Libellé</span><span style="text-align:right">Débit</span><span style="text-align:right">Crédit</span></div>`;
      derogRows.forEach(r=>{
        const dateEc=arrete||`${yr}-12-31`;
        if(r.diff>0){
          dH+=`<div class="jr"><span>${FD(dateEc)}</span><span><code>68725</code></span><span>Dot.dérog. ${r.im.code} — ${r.im.designation}</span><span class="db">${F(r.diff)}</span><span>—</span></div>`;
          dH+=`<div class="jr"><span>${FD(dateEc)}</span><span><code>15200</code></span><span>Prov.régl. ${r.im.code}</span><span>—</span><span class="cr">${F(r.diff)}</span></div>`;
        } else if(r.diff<0){
          const rep=Math.abs(r.diff);
          dH+=`<div class="jr"><span>${FD(dateEc)}</span><span><code>15200</code></span><span>Reprise dérog. ${r.im.code}</span><span class="db">${F(rep)}</span><span>—</span></div>`;
          dH+=`<div class="jr"><span>${FD(dateEc)}</span><span><code>78725</code></span><span>Rep.prov.régl. ${r.im.code}</span><span>—</span><span class="cr">${F(rep)}</span></div>`;
        }
      });
      const totD=derogRows.reduce((a,r)=>a+(r.diff>0?r.diff:0),0);
      const totR=derogRows.reduce((a,r)=>a+(r.diff<0?Math.abs(r.diff):0),0);
      dH+=`<div class="jt"><span></span><span></span><span style="color:var(--text3)">Totaux</span><span class="db">${F(totD+totR)}</span><span class="cr">${F(totD+totR)}</span></div></div>`;
      derEl.innerHTML=dH;
    }
  }
}
function ecSetPredefined(mode){
  const arrete=document.getElementById('ec-arrete');
  const d1=document.getElementById('ec-d1');
  const d2=document.getElementById('ec-d2');
  const now=new Date();
  const yr=now.getFullYear();
  if(mode==='today'){
    arrete.value=TD();
    d1.value='';d2.value='';
  } else if(mode==='fin-annee'){
    arrete.value=yr+'-12-31';
    d1.value='';d2.value='';
  } else if(mode==='exercice'){
    arrete.value=yr+'-12-31';
    d1.value=yr+'-01-01';
    d2.value=yr+'-12-31';
  }
  ecUpdateHint();
  genEc();
}
function ecUpdateHint(){
  const arrete=document.getElementById('ec-arrete')?.value;
  const d1=document.getElementById('ec-d1')?.value;
  const d2=document.getElementById('ec-d2')?.value;
  const hint=document.getElementById('ec-arrete-hint');
  if(!hint)return;
  if(!arrete){hint.textContent='Sélectionnez une date pour générer les écritures.';return;}
  const dateLabel=new Date(arrete).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const yr=new Date(arrete).getFullYear();
  if(d1&&d2){
    const s=new Date(d1).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
    const e=new Date(d2).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
    hint.textContent=`Arrêté au ${dateLabel} — Dotations sur la période ${s} → ${e}`;
  } else {
    hint.textContent=`Arrêté au ${dateLabel} — Exercice ${yr}`;
  }
}
function genEc(){
  const arrete=document.getElementById('ec-arrete')?.value||TD();
  const d1=document.getElementById('ec-d1')?.value||'';
  const d2=document.getElementById('ec-d2')?.value||'';
  const yr=new Date(arrete).getFullYear();
  let mode,ecLabel;
  if(d1&&d2){
    mode='period';
    const s=new Date(d1).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
    const e=new Date(d2).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
    ecLabel=`Période du ${s} au ${e} — arrêté au ${new Date(arrete).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}`;
  } else {
    mode='date';
    ecLabel=`Arrêté au ${new Date(arrete).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}`;
  }
  // Mettre à jour le titre de l'onglet dotations
  const dotTitle=document.getElementById('ec-dot-title');
  if(dotTitle)dotTitle.textContent='Dotations — '+ecLabel;
  // Persister un snapshot
  if(!DB.ecritures_log)DB.ecritures_log=[];
  DB.ecritures_log.push({id:'ec'+Date.now(),date:TD(),label:ecLabel,genBy:currentUser?.nom||'Système',mode,yr,arrete,d1,d2});
  dbSave();
  rdEc(mode,yr,ecLabel,arrete,d1,d2);
  toast('Écritures générées — '+ecLabel);
}

function getEcFilteredImmos(){
  const rub = document.getElementById('ec-flt-rubrique')?.value;
  const sousRub = document.getElementById('ec-flt-sousrubrique')?.value;
  return DB.immobilisations.filter(i=>{
    if(i.statut==='sorti') return false;
    if(rub && i.categorie!==rub) return false;
    if(sousRub && i.nature!==sousRub) return false;
    return true;
  });
}

function exportEc(){
  const yr=new Date().getFullYear();let csv='Date;Compte;Libellé;Débit;Crédit\n';
  getEcFilteredImmos().forEach(im=>{const dt=dotPeriod(im,yr,yr);csv+=`31/12/${yr};${im.ca||'2800'};Amortissement \;${dt};0\n`;});
  dlFile('ecritures_'+yr+'.csv',csv,'text/csv');
}

// ── EXPORT FORMAT SAGE/CIEL ──
function exportEcSage(){
  const yr=new Date().getFullYear();
  // Format Sage : JNL;DATE;COMPTE;LIBELLE;DEBIT;CREDIT;PIECE;REF
  let csv='JNL;DATE;COMPTE;INTITULE;DEBIT;CREDIT;PIECE;REF\n';
  const immos=getEcFilteredImmos();
  // Écritures de dotations
  immos.forEach(im=>{
    const dt=dotPeriod(im,yr,yr);
    if(dt>0){
      const c=DB.categories.find(x=>x.libelle===im.categorie)||{cptDot:'6813',cptAmort:'2800'};
      const dateEc=`31/12/${yr}`;
      const lib=`Dot.amort. \ - ${im.designation.substring(0,30)}`;
      csv+=`JAMORT;${dateEc};${c.cptDot};${lib};${dt};0;DOT${yr};\\n`;
      csv+=`JAMORT;${dateEc};${im.ca||c.cptAmort};${lib};0;${dt};DOT${yr};\\n`;
    }
  });
  // Écritures d'acquisitions
  immos.forEach(im=>{
    const dateEc=im.dateAcq.split('-').reverse().join('/');
    const lib=`Acq. \ - ${im.designation.substring(0,30)}`;
    csv+=`JA;${dateEc};${im.ci||'2400'};${lib};${im.vo};0;ACQ-${im.factureNum||im.code};\\n`;
    csv+=`JA;${dateEc};4011;${lib} - Frs \;0;${im.vo};ACQ-${im.factureNum||im.code};\\n`;
  });
  // Amortissements dérogatoires
  immos.forEach(im=>{
    if(!im.fiscal||!im.fiscal.duree)return;
    const dtEco=dotPeriod(im,yr,yr);
    const dtFisc=dotPeriod({...im,methode:im.fiscal.methode,duree:im.fiscal.duree,taux:im.fiscal.taux},yr,yr);
    const diff=dtFisc-dtEco;
    if(Math.abs(diff)>0){
      const dateEc=`31/12/${yr}`;
      const lib=`Amort.derog. ${escapeHtml(im.code)}`;
      if(diff>0){
        csv+=`JDER;${dateEc};68725;${lib};${diff};0;DER${yr};\n`;
        csv+=`JDER;${dateEc};15200;${lib};0;${diff};DER${yr};\n`;
      } else {
        csv+=`JDER;${dateEc};15200;Reprise derog. ${escapeHtml(im.code)};${Math.abs(diff)};0;DER${yr};\n`;
        csv+=`JDER;${dateEc};78725;Reprise derog. ${escapeHtml(im.code)};0;${Math.abs(diff)};DER${yr};\n`;
      }
    }
  });
  dlFile(`ecritures_sage_${yr}.csv`,csv,'text/csv');
  toast('Export Sage/Ciel généré — exercice '+yr);
}

// ── CLÔTURE D'EXERCICE ──
function openCloture(){
  if(!guardAdmin())return;
  const yr=new Date().getFullYear()-1;
  document.getElementById('clo-yr').value=yr;
  document.getElementById('clo-confirm').value='';
  openM('m-cloture');
}
function cloturerExercice(){
  const yr=+document.getElementById('clo-yr').value;
  const conf=document.getElementById('clo-confirm').value.trim();
  if(!yr||yr<2000){toast('Exercice invalide','e');return;}
  if(conf!==String(yr)){toast('La confirmation ne correspond pas à l\'exercice saisi','e');return;}
  if(!DB.exercicesClos)DB.exercicesClos=[];
  if(DB.exercicesClos.includes(yr)){toast('Cet exercice est déjà clôturé','e');return;}
  DB.exercicesClos.push(yr);
  dbSave();closeM('m-cloture');
  rdEc();
  toast(`Exercice ${yr} clôturé — écritures verrouillées`);
}
function rdClotures(){
  if(!DB.exercicesClos||DB.exercicesClos.length===0){
    const w=document.getElementById('ec-clotures-wrap');if(w)w.style.display='none';return;
  }
  const w=document.getElementById('ec-clotures-wrap');if(w)w.style.display='block';
  const l=document.getElementById('ec-clotures-list');
  if(l)l.textContent=DB.exercicesClos.sort().join(', ');
}

// ── TABLEAU SYSCOA OFFICIEL ──
function genRapSYSCOA(){
  const yr=new Date().getFullYear();
  const yrStart=yr+'-01-01';const yrEnd=yr+'-12-31';
  const immos=getRapFilteredImmos(true); // inclure sortis pour SYSCOA (cessions)
  const cats=[...new Set(immos.map(i=>i.categorie))].sort();
  const rows=cats.map(cat=>{
    const list=immos.filter(i=>i.categorie===cat);
    let vo_deb=0,acqN=0,cesN=0,vo_fin=0,am_deb=0,dotN=0,repN=0,am_fin=0;
    list.forEach(im=>{
      const isNew=im.dateAcq>=yrStart&&im.dateAcq<=yrEnd;
      const isCed=im.statut==='sorti'&&DB.sorties.find(s=>s.immoId===im.id&&s.date>=yrStart&&s.date<=yrEnd);
      if(isNew){acqN+=im.vo;}
      else{vo_deb+=im.vo;}
      if(isCed){cesN+=im.vo;} else{vo_fin+=im.vo;}
      const cumDeb=cumAt(im,yrStart);
      const cumFin=cumAt(im,yrEnd);
      const dt=cumFin-cumDeb;
      am_deb+=cumDeb;
      if(dt>=0)dotN+=dt; else repN+=Math.abs(dt);
      if(!isCed)am_fin+=cumFin;
    });
    const vnc_fin=vo_fin-am_fin;
    return{cat,vo_deb,acqN,cesN,vo_fin,am_deb,dotN,repN,am_fin,vnc_fin};
  });
  const tot=rows.reduce((a,r)=>({cat:'TOTAL',vo_deb:a.vo_deb+r.vo_deb,acqN:a.acqN+r.acqN,cesN:a.cesN+r.cesN,vo_fin:a.vo_fin+r.vo_fin,am_deb:a.am_deb+r.am_deb,dotN:a.dotN+r.dotN,repN:a.repN+r.repN,am_fin:a.am_fin+r.am_fin,vnc_fin:a.vnc_fin+r.vnc_fin}),{cat:'',vo_deb:0,acqN:0,cesN:0,vo_fin:0,am_deb:0,dotN:0,repN:0,am_fin:0,vnc_fin:0});
  return{rows,tot,yr};
}

// ── TABLEAU DES AMORTISSEMENTS DÉROGATOIRES ──
function genRapDerog(immosOverride){
  const yr=new Date().getFullYear();
  const immos=(immosOverride || getRapFilteredImmos(false)).filter(i=>i.fiscal&&i.fiscal.duree>0);
  return immos.map(im=>{
    const dtEco=dotPeriod(im,yr,yr);
    const dtFisc=dotPeriod({...im,methode:im.fiscal.methode,duree:im.fiscal.duree,taux:im.fiscal.taux},yr,yr);
    const diff=dtFisc-dtEco;
    const cumEco=cumAt(im,yr+'-12-31');
    const cumFisc=Math.min(dotPeriod({...im,methode:im.fiscal.methode,duree:im.fiscal.duree,taux:im.fiscal.taux},2000,yr),im.vo);
    return{im,dtEco,dtFisc,diff,cumEco,cumFisc,solde152:cumFisc-cumEco};
  });
}

// ── RAPPORTS ──
// ── RAPPORT SORT STATE ──
let _rapViewMode = 'detail'; // 'detail' | 'agg'

function setRapView(mode){
  _rapViewMode = mode;
  document.getElementById('rap-view-detail').classList.toggle('active', mode==='detail');
  document.getElementById('rap-view-agg').classList.toggle('active', mode==='agg');
  genRap(_rapCurrentType);
}

// ── Show "Recalculer les natures" button when Par nature is selected and data is missing ──
function checkNatureBtn(){
  const sel = document.getElementById('rap-agg-by');
  const btn = document.getElementById('btn-fix-nature');
  if(!sel || !btn) return;
  const isNature = sel.value === 'nature' && _rapViewMode === 'agg';
  const hasMissing = isNature && DB.immobilisations.some(im => im.statut !== 'sorti' && !im.nature);
  btn.style.display = hasMissing ? 'inline-flex' : 'none';
}

// ── Recalcule les natures vides depuis la catégorie pour toutes les immobilisations ──
function fixAllNatures(){
  const CAT_NAT = typeof CAT_TO_NATURE !== 'undefined' ? CAT_TO_NATURE : {};
  let fixed = 0;
  DB.immobilisations.forEach(im => {
    if(!im.nature){
      const nat = CAT_NAT[im.categorie] || im.categorie || '';
      if(nat){ im.nature = nat; fixed++; }
    }
  });
  dbSave();
  toast(fixed + ' nature(s) recalculée(s) depuis la catégorie');
  checkNatureBtn();
  genRap(_rapCurrentType);
}

function buildAggBody(rows, groupKey, selYr, isDot){
  // rows: flat array with fields: cat/categorie, nature, financement, affectation, vo, dt, cum, vnc, n
  // 'categorie' and 'cat' are aliases for the same field
  const resolveKey = (r, k) => {
    if(k === 'categorie') return r.categorie || r.cat || '—';
    return r[k] || '—';
  };
  const groups = {};
  rows.forEach(r => {
    const key = resolveKey(r, groupKey);
    if(!groups[key]) groups[key] = {label:key, vo:0, cum:0, vnc:0, dt:0, n:0};
    groups[key].vo += r.vo;
    groups[key].cum += r.cum;
    groups[key].vnc += r.vnc;
    groups[key].dt += r.dt||0;
    groups[key].n += r.n||1;
  });
  const entries = Object.values(groups);
  const totVO = entries.reduce((a,b)=>a+b.vo,0);
  const totCum = entries.reduce((a,b)=>a+b.cum,0);
  const totVNC = entries.reduce((a,b)=>a+b.vnc,0);
  const totDot = entries.reduce((a,b)=>a+b.dt,0);
  const totN = entries.reduce((a,b)=>a+b.n,0);

  const groupLabels = {categorie:'Catégorie', nature:'Nature', financement:'Financement', affectation:'Affectation'};

  const pctBar = (val, tot) => {
    const pct = tot>0 ? Math.round(val/tot*100) : 0;
    return `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--blue);border-radius:3px"></div></div><span style="font-size:11px;color:var(--text3);min-width:32px;text-align:right">${pct}%</span></div>`;
  };

  let dotCol = isDot ? `<th style="text-align:right">DOTATION ${selYr}</th>` : '';
  let dotColFoot = isDot ? `<td style="font-family:var(--m);text-align:right;font-weight:700;color:var(--amber)">${totDot>0?F(totDot):'—'}</td>` : '';

  let rows_html = entries.map(g => {
    const pctAmort = g.vo>0 ? (g.cum/g.vo*100).toFixed(1) : 0;
    const dotCell = isDot ? `<td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber)">${g.dt>0?F(g.dt):'—'}</td>` : '';
    return `<tr>
      <td style="font-weight:600">${g.label}</td>
      <td style="text-align:right;font-size:12px">${g.n}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right">${F(g.vo)}</td>
      ${dotCell}
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--red)">${F(g.cum)}</td>
      <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--green);font-weight:600">${F(g.vnc)}</td>
      <td style="min-width:120px">${pctBar(g.cum, g.vo)}</td>
    </tr>`;
  }).join('');

  return `<div class="tw"><table>
    <thead><tr>
      <th>${groupLabels[groupKey]||groupKey}</th>
      <th style="text-align:right">NB</th>
      <th style="text-align:right">V. ORIGINE</th>
      ${dotCol}
      <th style="text-align:right">CUMUL AMORT.</th>
      <th style="text-align:right">VNC</th>
      <th style="min-width:120px">% AMORTI</th>
    </tr></thead>
    <tbody>${rows_html}</tbody>
    <tfoot><tr style="background:var(--blue-light);font-weight:700;color:var(--blue)">
      <td>TOTAL</td>
      <td style="text-align:right">${totN}</td>
      <td style="font-family:var(--m);text-align:right">${F(totVO)}</td>
      ${dotColFoot}
      <td style="font-family:var(--m);text-align:right">${F(totCum)}</td>
      <td style="font-family:var(--m);text-align:right">${F(totVNC)}</td>
      <td></td>
    </tr></tfoot>
  </table></div>`;
}

function setArretePredefined(mode){
  const el=document.getElementById('rap-arrete');if(!el)return;
  const now=new Date();
  if(mode==='today'){el.value=TD();}
  else if(mode==='yr'){el.value=now.getFullYear()+'-12-31';}
  genRap('amort');
}
function rapSortBy(col){
  if(_rapSortCol === col){
    _rapSortAsc = !_rapSortAsc;
  } else {
    _rapSortCol = col;
    _rapSortAsc = true;
  }
  // Update select to match
  const sel=document.getElementById('rap-sort-col');
  if(sel)sel.value=col;
  genRap(_rapCurrentType);
}

function rapSort(){
  const sel=document.getElementById('rap-sort-col');
  if(sel)_rapSortCol=sel.value;
  genRap(_rapCurrentType);
}

function rapSortToggle(){
  _rapSortAsc=!_rapSortAsc;
  genRap(_rapCurrentType);
}

function exportRapExcel(){
  if(!_rapAmortData||!_rapAmortData.rows.length){toast('Aucune donnée à exporter','e');return;}
  const NL='\n';
  // For VNC type (by category)
  if(_rapCurrentType==='vnc'){
    const e=DB.params.entite||{};
    let csv='\uFEFF';
    if(e.rs)csv+=e.rs+NL;
    csv+='VNC par catégorie — '+new Date().toLocaleDateString('fr-FR')+NL+NL;
    csv+='Catégorie;Nb immobilisations;Valeur origine;Cumul amort.;VNC;% amorti'+NL;
    _rapAmortData.rows.forEach(r=>{
      const pct=r.vo>0?((r.cum/r.vo)*100).toFixed(1):0;
      csv+=r.cat+';'+r.n+'; '+r.vo+'; '+r.cum+'; '+r.vnc+';'+pct+'%'+NL;
    });
    const totVO=_rapAmortData.rows.reduce((a,b)=>a+b.vo,0);
    const totCum=_rapAmortData.rows.reduce((a,b)=>a+b.cum,0);
    const totVNC=_rapAmortData.rows.reduce((a,b)=>a+b.vnc,0);
    csv+=NL+'TOTAL;'+_rapAmortData.rows.reduce((a,b)=>a+b.n,0)+'; '+totVO+'; '+totCum+'; '+totVNC+NL;
    dlFile('vnc_categories.csv',csv,'text/csv;charset=utf-8');
    logAction('EXPORT','Rapport Excel',_rapCurrentType||'état');
  toast('Export Excel téléchargé');
    return;
  }
  // For immo type (no year grouping)
  if(_rapCurrentType==='immo'){
    const e=DB.params.entite||{};
    let csv='\uFEFF';
    if(e.rs)csv+=e.rs+NL;
    csv+='État des immobilisations — '+new Date().toLocaleDateString('fr-FR')+NL+NL;
    csv+='Code;Désignation;Catégorie;Date acquisition;Valeur origine;Taux;Cumul amort.;VNC'+NL;
    _rapAmortData.rows.forEach(r=>{
      csv+=r.code+';'+r.designation+';'+r.cat+';'+(r.dateAcq?r.dateAcq.split('-').reverse().join('/'):'')
        +'; '+r.vo+';'+(r.taux*100).toFixed(1)+'%;'+r.cum+';'+r.vnc+NL;
    });
    const totVO=_rapAmortData.rows.reduce((a,b)=>a+b.vo,0);
    const totCum=_rapAmortData.rows.reduce((a,b)=>a+b.cum,0);
    const totVNC=_rapAmortData.rows.reduce((a,b)=>a+b.vnc,0);
    csv+=NL+'TOTAL;;;;  '+totVO+';;'+totCum+';'+totVNC+NL;
    dlFile('etat_immobilisations.csv',csv,'text/csv;charset=utf-8');
    toast('Export Excel téléchargé');
    return;
  }
  const{selYr,rows}=_rapAmortData;
  const e=DB.params.entite||{};
  let csv='\uFEFF';
  // Header
  if(e.rs)csv+=e.rs+NL;
  if(e.adresse)csv+=e.adresse+NL;
  csv+='Dotations aux amortissements — arrêté au '+(_rapAmortData.arrete||_rapAmortData.selYr)+NL;
  csv+='Généré le '+new Date().toLocaleDateString('fr-FR')+NL+NL;
  // Column headers
  csv+='Catégorie;Code;Désignation;Date acquisition;Valeur origine;Taux;Dotation '+selYr+';Cumul amortissements;VNC au 31/12/'+selYr+NL;
  // Data rows
  let prevCat='';
  let stVO=0,stDot=0,stCum=0,stVNC=0;
  let totVO=0,totDot=0,totCum=0,totVNC=0;
  rows.forEach(r=>{
    if(r.cat!==prevCat){
      if(prevCat){
        csv+='Sous-total — '+prevCat+';;;; '+stVO+';; '+stDot+'; '+stCum+'; '+stVNC+NL+NL;
        stVO=stDot=stCum=stVNC=0;
      }
      prevCat=r.cat;
    }
    csv+=r.cat+';'+r.code+';'+r.designation+';'+(r.dateAcq?r.dateAcq.split('-').reverse().join('/'):'')
      +'; '+r.vo+';'+(r.taux*100).toFixed(1)+'%;'+(r.dt||0)+';'+r.cum+';'+r.vnc+NL;
    stVO+=r.vo;stDot+=r.dt||0;stCum+=r.cum;stVNC+=r.vnc;
    totVO+=r.vo;totDot+=r.dt||0;totCum+=r.cum;totVNC+=r.vnc;
  });
  if(prevCat){
    csv+='Sous-total — '+prevCat+';;;; '+stVO+';; '+stDot+'; '+stCum+'; '+stVNC+NL;
  }
  csv+=NL+'TOTAL GÉNÉRAL;;;; '+totVO+';; '+totDot+'; '+totCum+'; '+totVNC+NL;
  dlFile('amortissements_'+selYr+'.csv',csv,'text/csv;charset=utf-8');
  toast('Export Excel téléchargé');
}

function resetRapFilters(){
  ['rap-flt-cat','rap-flt-st','rap-flt-fin','rap-flt-aff'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  genRap(_rapCurrentType);
}
function popRapFltSelectors(){
  const cats=DB.categories||[];
  const catSel=document.getElementById('rap-flt-cat');
  if(catSel){
    const prev=catSel.value;
    catSel.innerHTML='<option value="">Toutes les catégories</option>'+cats.map(c=>`<option value="${escapeHtml(c.libelle)}">${escapeHtml(c.libelle)}</option>`).join('');
    if(cats.find(c=>c.libelle===prev))catSel.value=prev;
  }
  const affSel=document.getElementById('rap-flt-aff');
  if(affSel){
    const prev=affSel.value;
    const lieux=[...new Set(DB.immobilisations.map(i=>i.affectation||'').filter(Boolean))].sort();
    affSel.innerHTML='<option value="">Toutes les affectations</option>'+lieux.map(l=>`<option value="${l}">${l}</option>`).join('');
    if(lieux.includes(prev))affSel.value=prev;
  }
}
function getRapFilteredImmos(includeAll){
  const fCat=document.getElementById('rap-flt-cat')?.value||'';
  const fSt=document.getElementById('rap-flt-st')?.value||'';
  const fFin=document.getElementById('rap-flt-fin')?.value||'';
  const fAff=document.getElementById('rap-flt-aff')?.value||'';
  return DB.immobilisations.filter(i=>{
    if(!includeAll&&i.statut==='sorti'&&fSt!=='sorti') return false;
    if(fCat&&i.categorie!==fCat) return false;
    if(fFin&&i.financement!==fFin) return false;
    if(fAff&&i.affectation!==fAff) return false;
    if(fSt==='actif'&&i.statut!=='actif') return false;
    if(fSt==='amorti'){const cum=cumAt(i,TD());if(Math.max(0,i.vo-cum)>0)return false;}
    return true;
  });
}
function selectRap(type, el){
  // Désactiver toutes les cartes
  document.querySelectorAll('.rap-card-btn').forEach(c=>c.classList.remove('rap-active'));
  // Activer la carte cliquée
  if(el) el.classList.add('rap-active');
  // Lancer le rapport
  genRap(type);
  // Scroll doux vers le résultat
  setTimeout(()=>{
    const rc = document.getElementById('rap-card');
    if(rc && rc.style.display !== 'none'){
      rc.scrollIntoView({behavior:'smooth', block:'start'});
    }
  }, 300);
}

function genRap(type){
  _rapCurrentType=type;
  // Spinner sur carte active
  const activeCard = document.querySelector('.rap-card-btn.rap-active');
  if(activeCard){
    activeCard.style.opacity='0.7';
    setTimeout(()=>{activeCard.style.opacity='1';},400);
  }
  const el=document.getElementById('rap-card');el.style.display='block';
  document.getElementById('rap-amort-filter').style.display=type==='amort'?'block':'none';
  // Show/populate global filter bar for all types
  const gf=document.getElementById('rap-global-filter');
  if(gf){gf.style.display='block';popRapFltSelectors();}
  // Hide sort controls for non-amort reports, reset for new type
  const sortSel=document.getElementById('rap-sort-col');
  const sortDir=document.getElementById('rap-sort-dir');
  const excelBtn=document.getElementById('btn-rap-excel');
  if(sortSel)sortSel.style.display=type==='amort'&&_rapViewMode==='detail'?'':'none';
  if(sortDir)sortDir.style.display=type==='amort'&&_rapViewMode==='detail'?'':'none';
  if(excelBtn)excelBtn.style.display='';  // always show Excel
  const pdfBtn=document.getElementById('btn-rap-pdf');
  if(pdfBtn)pdfBtn.style.display='';  // always show PDF

  // Aggregate toggle — show for immo and amort
  const aggWrap=document.getElementById('rap-agg-wrap');
  if(aggWrap) aggWrap.style.display=(type==='immo'||type==='amort')?'flex':'none';

  const enteteEl=document.getElementById('rap-entete');
  const enteteHtml=buildEnteteHTML();
  if(enteteHtml){enteteEl.innerHTML=enteteHtml;enteteEl.style.display='block';}
  else{enteteEl.style.display='none';}
  let title='',body='';
  if(type==='immo'){
    title="État des immobilisations";
    if(excelBtn)excelBtn.style.display='';
    const immoList=getRapFilteredImmos(false);
    // Sort
    const sortMap={code:'code',designation:'designation',dateAcq:'dateAcq',vo:'vo',taux:'taux',cum:'cum',vnc:'vnc'};
    if(_rapSortCol&&sortMap[_rapSortCol]){
      immoList.sort((a,b)=>{
        let va,vb;
        const cum_a=cumAt(a,TD()),cum_b=cumAt(b,TD());
        if(_rapSortCol==='cum'){va=cum_a;vb=cum_b;}
        else if(_rapSortCol==='vnc'){va=a.vo-cum_a;vb=b.vo-cum_b;}
        else{va=a[_rapSortCol];vb=b[_rapSortCol];}
        if(va<vb)return _rapSortAsc?-1:1;
        if(va>vb)return _rapSortAsc?1:-1;
        return 0;
      });
    }
    // Store for excel
    _rapAmortData={selYr:new Date().getFullYear(),rows:immoList.map(im=>{const cum=cumAt(im,TD());return{cat:im.categorie,categorie:im.categorie,nature:im.nature||'—',financement:im.financement,affectation:im.affectation||'—',code:im.code,designation:im.designation,dateAcq:im.dateAcq,vo:im.vo,taux:im.taux,dt:0,cum,vnc:Math.max(0,im.vo-cum)};}),bycat:{}};

    if(_rapViewMode==='agg'){
      const groupKey=document.getElementById('rap-agg-by')?.value||'categorie';
      body=buildAggBody(_rapAmortData.rows, groupKey, new Date().getFullYear(), false);
    } else {
    body=`<div class="rap-tw"><table style="table-layout:fixed;min-width:860px;width:100%"><thead><tr>
      <th style="width:140px;cursor:pointer" onclick="rapSortBy('code')">CODE${_rapSortCol==='code'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:auto;cursor:pointer" onclick="rapSortBy('designation')">DÉSIGNATION${_rapSortCol==='designation'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:120px">CATÉGORIE</th>
      <th style="width:100px;text-align:right;cursor:pointer" onclick="rapSortBy('dateAcq')">DATE ACQ.${_rapSortCol==='dateAcq'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('vo')">V. ORIGINE${_rapSortCol==='vo'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:60px;text-align:right;cursor:pointer" onclick="rapSortBy('taux')">TAUX${_rapSortCol==='taux'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('cum')">CUMUL${_rapSortCol==='cum'?(_rapSortAsc?' ↑':' ↓'):''}</th>
      <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('vnc')">VNC${_rapSortCol==='vnc'?(_rapSortAsc?' ↑':' ↓'):''}</th>
    </tr></thead><tbody>${immoList.map(im=>{const cum=cumAt(im,TD());return`<tr>
      <td class="no-trunc"><code class="tc-sm" title="${escapeHtml(im.code)}" style="color:var(--blue);font-size:11px">${escapeHtml(im.code)}</code></td>
      <td><span class="tc-lg" title="${escapeHtml(im.designation)}">${escapeHtml(im.designation)}</span></td>
      <td class="no-trunc"><span class="badge ${CC(im.categorie)} tc-sm" title="${escapeHtml(im.categorie)}" style="max-width:110px">${escapeHtml(im.categorie)}</span></td>
      <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${FD(im.dateAcq)}</td>
      <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${F(im.vo)}</td>
      <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${(im.taux*100).toFixed(1)}%</td>
      <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right;color:var(--red)">${F(cum)}</td>
      <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right;color:${cum>=im.vo?'var(--red)':'var(--green)'}">${F(Math.max(0,im.vo-cum))}</td>
    </tr>`;}).join('')}</tbody></table></div>`;
    }
  } else if(type==='vnc'){
    title='VNC par catégorie';
    const bc={};getRapFilteredImmos(false).forEach(im=>{const cum=cumAt(im,TD());if(!bc[im.categorie])bc[im.categorie]={vo:0,cum:0,n:0};bc[im.categorie].vo+=im.vo;bc[im.categorie].cum+=cum;bc[im.categorie].n++;});
    _rapAmortData={selYr:new Date().getFullYear(),rows:Object.entries(bc).map(([cat,v])=>({cat,n:v.n,vo:v.vo,cum:v.cum,vnc:v.vo-v.cum,dt:0})),bycat:{}};
    body=`<div class="tw"><table><thead><tr><th>Catégorie</th><th>Nb</th><th>V. Origine</th><th>Cumul amort.</th><th>VNC</th><th>% amorti</th></tr></thead><tbody>${Object.entries(bc).map(([cat,v])=>`<tr><td><span class="badge ${CC(cat)}">${cat}</span></td><td>${v.n}</td><td style="font-family:var(--m);font-size:12px">${F(v.vo)}</td><td style="font-family:var(--m);font-size:12px;color:var(--red)">${F(v.cum)}</td><td style="font-family:var(--m);font-size:12px;color:var(--green)">${F(v.vo-v.cum)}</td><td style="font-family:var(--m);font-size:12px">${v.vo>0?(v.cum/v.vo*100).toFixed(1):0}%</td></tr>`).join('')}</tbody></table></div>`;

  } else if(type==='analytique'){
    title='Répartition analytique des dotations';
    const yr=new Date().getFullYear();
    const immos=getRapFilteredImmos(false);
    const groups={};
    immos.forEach(im=>{
      const cc=im.centreCoût||'—';const axe=im.axe||'—';const key=cc+'|||'+axe;
      if(!groups[key])groups[key]={cc,axe,n:0,vo:0,dot:0,cum:0,vnc:0};
      groups[key].n++;groups[key].vo+=im.vo;
      groups[key].dot+=dotPeriod(im,yr,yr);
      const cum=cumAt(im,TD());groups[key].cum+=cum;groups[key].vnc+=(im.vo-cum);
    });
    const entries=Object.values(groups).sort((a,b)=>b.dot-a.dot);
    const totDot=entries.reduce((a,g)=>a+g.dot,0);
    body=`<div style="margin-bottom:.75rem;font-size:12px;color:var(--text3)">Répartition des dotations de l'exercice ${yr} par centre de coût et axe analytique.</div>
    <div class="tw"><table>
      <thead><tr>
        <th>Centre de coût</th><th>Axe</th><th>Immos</th>
        <th style="text-align:right">V. Origine</th>
        <th style="text-align:right">Dotation ${yr}</th>
        <th style="text-align:right">% total</th>
        <th style="text-align:right">Cumul amort.</th>
        <th style="text-align:right">VNC</th>
      </tr></thead>
      <tbody>${entries.map(g=>`<tr>
        <td style="font-family:var(--m);font-size:12px;color:var(--blue)">${g.cc}</td>
        <td><span class="badge b" style="font-size:10px">${g.axe}</span></td>
        <td>${g.n}</td>
        <td style="font-family:var(--m);font-size:11px;text-align:right">${F(g.vo)}</td>
        <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber);font-weight:600">${F(g.dot)}</td>
        <td style="font-family:var(--m);font-size:11px;text-align:right">${totDot>0?(g.dot/totDot*100).toFixed(1):0}%</td>
        <td style="font-family:var(--m);font-size:11px;text-align:right;color:var(--red)">${F(g.cum)}</td>
        <td style="font-family:var(--m);font-size:11px;text-align:right;color:var(--green)">${F(g.vnc)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="background:var(--blue-light);font-weight:700;color:var(--blue)">
        <td colspan="4">TOTAL</td>
        <td style="font-family:var(--m);text-align:right">${F(totDot)}</td>
        <td style="font-family:var(--m);text-align:right">100%</td>
        <td style="font-family:var(--m);text-align:right">${F(entries.reduce((a,g)=>a+g.cum,0))}</td>
        <td style="font-family:var(--m);text-align:right">${F(entries.reduce((a,g)=>a+g.vnc,0))}</td>
      </tr></tfoot>
    </table></div>`;
  } else if(type==='multiyr'){
    title='Comparaison multi-exercices — N-2 à N+2';
    const {years,rows,totals}=genRapMultiYr();
    const yrNow=new Date().getFullYear();
    const thYr=years.map(y=>`<th style="text-align:right;${y===yrNow?'color:var(--blue);font-weight:700':''}">${y}${y===yrNow?' ◀':''}</th>`).join('');
    body=`<div style="margin-bottom:.75rem;font-size:12px;color:var(--text3)">Dotations annuelles — Comparaison de N-2 à N+2. N+1 et N+2 sont des projections.</div>
    <div class="tw"><table style="font-size:12px">
      <thead><tr><th>Immobilisation</th>${thYr.replace(/text-align:right/g,'text-align:right')}</tr></thead>
      <tbody>
        ${rows.map(({im,yData})=>`<tr>
          <td style="font-size:12px"><code style="font-size:10px;color:var(--blue)">\</code> ${im.designation.substring(0,30)}</td>
          ${yData.map(d=>`<td style="font-family:var(--m);font-size:11px;text-align:right;${d.yr===yrNow?'font-weight:600;color:var(--blue)':''}">${d.dot>0?F(d.dot):'—'}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--blue-light);font-weight:600;color:var(--blue)">
          <td>TOTAL DOTATIONS</td>
          ${totals.map(t=>`<td style="font-family:var(--m);font-size:11px;text-align:right">${F(t.dot)}</td>`).join('')}
        </tr>
        <tr style="background:var(--surface2)">
          <td style="color:var(--text3);font-size:11px">Cumul amort.</td>
          ${totals.map(t=>`<td style="font-family:var(--m);font-size:11px;text-align:right;color:var(--red)">${F(t.cum)}</td>`).join('')}
        </tr>
        <tr style="background:var(--surface2)">
          <td style="color:var(--text3);font-size:11px">VNC globale</td>
          ${totals.map(t=>`<td style="font-family:var(--m);font-size:11px;text-align:right;color:var(--green)">${F(t.vnc)}</td>`).join('')}
        </tr>
      </tfoot>
    </table></div>`;
  } else if(type==='syscoa'){
    title='Tableau des immobilisations SYSCOA — Annexe OHADA';
    const {rows,tot,yr}=genRapSYSCOA();
    const TH=t=>`<th style="text-align:right;font-size:11px">${t}</th>`;
    const TD2=(v,col)=>`<td style="font-family:var(--m);font-size:11px;text-align:right${col?';color:'+col:''}">${v>0?F(v):'—'}</td>`;
    body=`<div class="tw"><table style="font-size:12px">
      <thead>
        <tr style="background:var(--blue);color:#fff">
          <th rowspan="2" style="padding:8px">CATÉGORIE</th>
          <th colspan="3" style="text-align:center;border-bottom:1px solid rgba(255,255,255,.3)">VALEURS BRUTES</th>
          <th colspan="4" style="text-align:center;border-bottom:1px solid rgba(255,255,255,.3)">AMORTISSEMENTS</th>
          <th rowspan="2" style="text-align:right">VNC FIN N</th>
        </tr>
        <tr style="background:var(--blue-dark,#0F2252);color:#fff">
          ${TH('VO Début N')}${TH('Acq. N')}${TH('Cessions N')}${TH('Amort. Début N')}${TH('Dotations N')}${TH('Reprises N')}${TH('Amort. Fin N')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i)=>`<tr style="${i%2===0?'background:var(--surface2)':''}">
          <td style="font-weight:500">${r.cat}</td>
          ${TD2(r.vo_deb)}${TD2(r.acqN,'var(--green)')}${TD2(r.cesN,'var(--red)')}
          ${TD2(r.am_deb,'var(--red)')}${TD2(r.dotN,'var(--amber)')}${TD2(r.repN)}${TD2(r.am_fin,'var(--red)')}
          <td style="font-family:var(--m);font-size:11px;text-align:right;font-weight:600;color:${r.vnc_fin<=0?'var(--red)':'var(--green)'}">${F(r.vnc_fin)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--blue-light);font-weight:700;color:var(--blue)">
          <td>TOTAL GÉNÉRAL</td>
          ${TD2(tot.vo_deb)}${TD2(tot.acqN)}${TD2(tot.cesN)}
          ${TD2(tot.am_deb)}${TD2(tot.dotN)}${TD2(tot.repN)}${TD2(tot.am_fin)}
          <td style="font-family:var(--m);font-size:11px;text-align:right;font-weight:700;color:var(--blue)">${F(tot.vnc_fin)}</td>
        </tr>
      </tfoot>
    </table></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Tableau conforme au modèle SYSCOA 2022 — Exercice ${yr} — Annexe du bilan</div>`;

  } else if(type==='derog'){
    title='Amortissements dérogatoires — Provisions réglementées';
    const derogRows=genRapDerog();
    if(!derogRows.length){
      body=`<div style="text-align:center;padding:3rem;color:var(--text3)"><div style="font-size:2rem;margin-bottom:1rem">⚠</div><div>Aucune immobilisation avec amortissement fiscal distinct.<br>Activez le champ "Amortissement dérogatoire" dans les fiches concernées.</div></div>`;
    } else {
      const totDiff=derogRows.reduce((a,r)=>a+(r.diff>0?r.diff:0),0);
      const totRep=derogRows.reduce((a,r)=>a+(r.diff<0?Math.abs(r.diff):0),0);
      const totSolde=derogRows.reduce((a,r)=>a+r.solde152,0);
      body=`<div class="tw"><table>
        <thead><tr>
          <th>Code</th><th>Désignation</th>
          <th style="text-align:right">Dot. éco.</th><th style="text-align:right">Dot. fiscale</th>
          <th style="text-align:right">Dotation dérog.</th><th style="text-align:right">Reprise dérog.</th>
          <th style="text-align:right">Solde cpt 152</th>
        </tr></thead>
        <tbody>${derogRows.map(r=>`<tr>
          <td><code>${r.im.code}</code></td><td>${r.im.designation}</td>
          <td style="font-family:var(--m);font-size:12px;text-align:right">${F(r.dtEco)}</td>
          <td style="font-family:var(--m);font-size:12px;text-align:right">${F(r.dtFisc)}</td>
          <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber)">${r.diff>0?F(r.diff):'—'}</td>
          <td style="font-family:var(--m);font-size:12px;text-align:right;color:var(--green)">${r.diff<0?F(Math.abs(r.diff)):'—'}</td>
          <td style="font-family:var(--m);font-size:12px;text-align:right;font-weight:600">${F(r.solde152)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--amber-light);font-weight:700;color:var(--amber)">
          <td colspan="4">TOTAL EXERCICE</td>
          <td style="font-family:var(--m);text-align:right">${F(totDiff)}</td>
          <td style="font-family:var(--m);text-align:right">${F(totRep)}</td>
          <td style="font-family:var(--m);text-align:right">${F(totSolde)}</td>
        </tr></tfoot>
      </table></div>`;
    }
  } else if(type==='amort'){
    // ── Date d'arrêté ──
    const arreteEl=document.getElementById('rap-arrete');
    const arrete=arreteEl?.value||TD();
    const arreteDate=new Date(arrete);
    const selYr=arreteDate.getFullYear();
    const arreteLabel=new Date(arrete).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});

    // Période de dotation (optionnel)
    const periodStart=document.getElementById('rap-period-start')?.value||'';
    const periodEnd=document.getElementById('rap-period-end')?.value||arrete;
    const hasPeriod=!!periodStart;

    document.getElementById('rap-amort-filter').style.display='block';
    title='Dotations aux amortissements — Arrêté au '+arreteLabel;
    if(hasPeriod){
      const s=new Date(periodStart).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
      const e=new Date(periodEnd).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
      title+=' | Période : '+s+' → '+e;
    }

    // Hint
    const hint=document.getElementById('rap-arrete-hint');
    if(hint)hint.textContent=`Arrêté au ${arreteLabel} — Exercice ${selYr}${hasPeriod?' | Dotations filtrées sur la période':''}`;

    // Show sort controls and Excel button
    const sortSel=document.getElementById('rap-sort-col');
    const sortDir=document.getElementById('rap-sort-dir');
    const excelBtn=document.getElementById('btn-rap-excel');
    if(sortSel){sortSel.style.display='';sortSel.value=_rapSortCol||'';}
    if(sortDir)sortDir.style.display='';
    if(excelBtn)excelBtn.style.display='';

    // Build data rows
    const immos=getRapFilteredImmos(false).filter(i=>{
      // Inclure seulement les immos acquises avant ou à la date d'arrêté
      return i.dateAcq<=arrete;
    });
    const bycat={};
    immos.forEach(im=>{
      const plan=buildPlan(im);
      let dt=0;
      if(hasPeriod){
        // Dotation sur la période définie
        const startDate=new Date(periodStart);
        const endDate=new Date(periodEnd);
        for(const r of plan){
          const ry=r.yrNum||+r.yr;
          if(ry>=startDate.getFullYear()&&ry<=endDate.getFullYear()){
            // Prorata si l'année est partiellement dans la période
            if(ry===startDate.getFullYear()&&ry===endDate.getFullYear()){
              // Même année : prorata des deux bornes
              const daysTotal=360;
              const dStart=startDate.getMonth()*30+startDate.getDate();
              const dEnd=endDate.getMonth()*30+endDate.getDate();
              dt+=r.dt*(dEnd-dStart+1)/daysTotal;
            } else if(ry===startDate.getFullYear()){
              const dStart=startDate.getMonth()*30+startDate.getDate();
              dt+=r.dt*(360-dStart)/360;
            } else if(ry===endDate.getFullYear()){
              const dEnd=endDate.getMonth()*30+endDate.getDate();
              dt+=r.dt*dEnd/360;
            } else {
              dt+=r.dt;
            }
          }
        }
      } else {
        // Dotation de l'exercice contenant la date d'arrêté, proratée si nécessaire
        for(const r of plan){
          const ry=r.yrNum||+r.yr;
          if(ry===selYr){
            // Prorata jusqu'à la date d'arrêté dans l'année
            const isFullYear=arrete>=(selYr+'-12-31');
            if(isFullYear){
              dt=r.dt;
            } else {
              const cal=im.cal||360;
              const acqDate=new Date(im.dateAcq);
              // Jours courus dans l'exercice jusqu'à l'arrêté
              const startOfYr=new Date(selYr+'-01-01');
              const refStart=acqDate>startOfYr?acqDate:startOfYr;
              const daysRun=Math.max(0,Math.round((arreteDate-refStart)/(1000*60*60*24))+1);
              dt=Math.round(r.dt*Math.min(daysRun,cal)/cal);
            }
          }
        }
      }
      if(!bycat[im.categorie])bycat[im.categorie]=[];
      const cum=cumAt(im,arrete);
      const vnc=Math.max(0,im.vo-cum);
      bycat[im.categorie].push({im,dt,cum,vnc});
    });

    // Apply sort within each category
    const sortCol=_rapSortCol||'';
    const sortAsc=_rapSortAsc;
    const sortFn=(a,b)=>{
      let va,vb;
      if(sortCol==='code'){va=a.im.code;vb=b.im.code;}
      else if(sortCol==='designation'){va=a.im.designation;vb=b.im.designation;}
      else if(sortCol==='dateAcq'){va=a.im.dateAcq;vb=b.im.dateAcq;}
      else if(sortCol==='vo'){va=a.im.vo;vb=b.im.vo;}
      else if(sortCol==='taux'){va=a.im.taux;vb=b.im.taux;}
      else if(sortCol==='dot'){va=a.dt;vb=b.dt;}
      else if(sortCol==='cum'){va=a.cum;vb=b.cum;}
      else if(sortCol==='vnc'){va=a.vnc;vb=b.vnc;}
      else return 0;
      if(va<vb)return sortAsc?-1:1;
      if(va>vb)return sortAsc?1:-1;
      return 0;
    };

    let totalVO=0,totalDot=0,totalCum=0,totalVNC=0;
    let tbody='';
    _rapAmortData={selYr,arrete,rows:[],bycat:{}};

    Object.entries(bycat).forEach(([cat,rows])=>{
      if(sortCol)rows.sort(sortFn);
      let stVO=0,stDot=0,stCum=0,stVNC=0;
      _rapAmortData.bycat[cat]=rows;
      rows.forEach(({im,dt,cum,vnc})=>{
        stVO+=im.vo;stDot+=dt;stCum+=cum;stVNC+=vnc;
        _rapAmortData.rows.push({cat,categorie:cat,nature:im.nature||'—',financement:im.financement,affectation:im.affectation||'—',code:im.code,designation:im.designation,dateAcq:im.dateAcq,vo:im.vo,taux:im.taux,duree:im.duree,dt,cum,vnc});
        tbody+=`<tr>
          <td class="no-trunc"><code class="tc-sm" title="${escapeHtml(im.code)}" style="color:var(--blue);font-size:11px">${escapeHtml(im.code)}</code></td>
          <td><span class="tc-lg" title="${escapeHtml(im.designation)}">${escapeHtml(im.designation)}</span></td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${FD(im.dateAcq)}</td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${F(im.vo)}</td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right">${(im.taux*100).toFixed(1)}%</td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right;color:var(--amber)">${dt>0?F(dt):'—'}</td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right;color:var(--red)">${F(cum)}</td>
          <td class="no-trunc" style="font-family:var(--m);font-size:12px;text-align:right;color:${vnc<=0?'var(--red)':'var(--green)'}"><strong>${F(vnc)}</strong></td>
        </tr>`;
      });
      totalVO+=stVO;totalDot+=stDot;totalCum+=stCum;totalVNC+=stVNC;
      tbody+=`<tr style="background:var(--surface2);font-weight:600;font-size:12px">
        <td colspan="3" style="padding-left:1.5rem;color:var(--text2)">Sous-total — ${cat}</td>
        <td style="font-family:var(--m);text-align:right">${F(stVO)}</td>
        <td></td>
        <td style="font-family:var(--m);text-align:right;color:var(--amber)">${stDot>0?F(stDot):'—'}</td>
        <td style="font-family:var(--m);text-align:right;color:var(--red)">${F(stCum)}</td>
        <td style="font-family:var(--m);text-align:right;color:var(--green)">${F(stVNC)}</td>
      </tr>`;
    });

    // Sort info label
    const sortInfo=document.getElementById('rap-sort-info');
    if(sortInfo&&sortCol&&_rapViewMode==='detail'){
      const colLabels={code:'Code',designation:'Désignation',dateAcq:"Date d'acq.",vo:'V. Origine',taux:'Taux',dot:'Dotation',cum:'Cumul',vnc:'VNC'};
      sortInfo.textContent=`Trié par ${colLabels[sortCol]||sortCol} (${sortAsc?'↑ croissant':'↓ décroissant'})`;
      if(sortDir)sortDir.textContent=sortAsc?'↑ Croissant':'↓ Décroissant';
    } else if(sortInfo){
      sortInfo.textContent='';
    }

    if(_rapViewMode==='agg'){
      const groupKey=document.getElementById('rap-agg-by')?.value||'categorie';
      body=buildAggBody(_rapAmortData.rows, groupKey, arrete, true);
    } else {
    body=`<div class="rap-tw"><table style="table-layout:fixed;min-width:860px;width:100%">
      <thead><tr>
        <th style="width:140px;cursor:pointer" onclick="rapSortBy('code')">CODE ${_rapSortCol==='code'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:auto;cursor:pointer" onclick="rapSortBy('designation')">DÉSIGNATION ${_rapSortCol==='designation'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:100px;text-align:right;cursor:pointer" onclick="rapSortBy('dateAcq')">DATE ACQ. ${_rapSortCol==='dateAcq'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('vo')">V. ORIGINE ${_rapSortCol==='vo'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:60px;text-align:right;cursor:pointer" onclick="rapSortBy('taux')">TAUX ${_rapSortCol==='taux'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('dot')">DOT. ${hasPeriod?'PÉRIODE':selYr} ${_rapSortCol==='dot'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:120px;text-align:right;cursor:pointer" onclick="rapSortBy('cum')">CUMUL ${_rapSortCol==='cum'?(_rapSortAsc?'↑':'↓'):''}</th>
        <th style="width:110px;text-align:right;cursor:pointer" onclick="rapSortBy('vnc')">VNC ${_rapSortCol==='vnc'?(_rapSortAsc?'↑':'↓'):''}</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
      <tfoot><tr style="background:var(--blue-light);font-weight:700;color:var(--blue)">
        <td colspan="3">TOTAL GÉNÉRAL</td>
        <td style="font-family:var(--m);text-align:right">${F(totalVO)}</td>
        <td></td>
        <td style="font-family:var(--m);text-align:right">${totalDot>0?F(totalDot):'—'}</td>
        <td style="font-family:var(--m);text-align:right">${F(totalCum)}</td>
        <td style="font-family:var(--m);text-align:right">${F(totalVNC)}</td>
      </tr></tfoot>
    </table></div>`;
    }
  }
  document.getElementById('rap-title').textContent=title;document.getElementById('rap-body').innerHTML=body;
}

// Écritures: filtres Rubrique/Sous-rubrique
function initEcFilters(){
  const selR = document.getElementById('ec-flt-rubrique');
  if(!selR) return;
  const cats = DB.categories || [];
  selR.innerHTML = '<option value="">Toutes</option>' + cats.map(c=>`<option value="${escapeHtml(c.libelle)}">${escapeHtml(c.libelle)}</option>`).join('');
  ecUpdateSousRubrique();
}
function ecUpdateSousRubrique(){
  const selR = document.getElementById('ec-flt-rubrique');
  const selS = document.getElementById('ec-flt-sousrubrique');
  if(!selR || !selS) return;
  
  const rub = selR.value;
  let natures = new Set();
  
  DB.immobilisations.forEach(im => {
    if(im.nature) {
      if(!rub || im.categorie === rub) {
        natures.add(im.nature);
      }
    }
  });
  
  const prevVal = selS.value;
  selS.innerHTML = '<option value="">Toutes</option>' + Array.from(natures).sort().map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if(Array.from(natures).includes(prevVal)) selS.value = prevVal;
}

// ── PARAMETRES ──
function rdPrmCat(){
  document.getElementById('prm-cat-tb').innerHTML=DB.categories.map(c=>`<tr>
    <td><code>${c.id}</code></td><td>${escapeHtml(c.libelle)}</td><td>${c.duree} ans</td>
    <td>${c.methode==='lin'?'Linéaire':'Dégressif'}</td>
    <td><code>${c.cptImmo}</code></td><td><code>${c.cptAmort}</code></td><td><code>${c.cptDot}</code></td>
    <td style="display:flex;gap:4px">
      <button class="btn xs" onclick="openCatModal('${c.id}')">Modifier</button>
      <button class="btn xs d" onclick="delCat('${c.id}')">Supprimer</button>
    </td>
  </tr>`).join('');
  upvNum();
}
let _editCatId=null;
function openCatModal(id){
  _editCatId=id;
  const c=id?DB.categories.find(x=>x.id===id):null;
  document.getElementById('m-cat-title').textContent=id?'Modifier catégorie':'Nouvelle catégorie';
  document.getElementById('cat-id').value=c?c.id:'';
  document.getElementById('cat-id').readOnly=!!id;
  document.getElementById('cat-lib').value=c?c.libelle:'';
  document.getElementById('cat-dur').value=c?c.duree:5;
  document.getElementById('cat-meth').value=c?c.methode:'lin';
  document.getElementById('cat-ci').value=c?c.cptImmo:'';
  document.getElementById('cat-ca').value=c?c.cptAmort:'';
  document.getElementById('cat-cd').value=c?c.cptDot:'';
  openM('m-cat');
}
function saveCat(){
  if(!guardAdmin())return;
  const id=(document.getElementById('cat-id').value||'').trim().toUpperCase();
  const lib=document.getElementById('cat-lib').value.trim();
  if(!id||!lib){toast('Code et libellé obligatoires','e');return;}
  const obj={id,libelle:lib,duree:+document.getElementById('cat-dur').value||5,methode:document.getElementById('cat-meth').value,cptImmo:document.getElementById('cat-ci').value,cptAmort:document.getElementById('cat-ca').value,cptDot:document.getElementById('cat-cd').value};
  if(_editCatId){const i=DB.categories.findIndex(x=>x.id===_editCatId);if(i>-1)DB.categories[i]=obj;}
  else{if(DB.categories.find(x=>x.id===id)){toast('Code déjà existant','e');return;}DB.categories.push(obj);}
  dbSave();closeM('m-cat');rdPrmCat();popCatSelectors();toast('Catégorie enregistrée');
}
function delCat(id){
  if(!guardAdmin())return;
  const used=DB.immobilisations.some(i=>i.categorie===DB.categories.find(c=>c.id===id)?.libelle);
  if(used){toast('Catégorie utilisée par des immobilisations','e');return;}
  if(!confirm('Supprimer cette catégorie ?'))return;
  DB.categories=DB.categories.filter(c=>c.id!==id);
  dbSave();rdPrmCat();popCatSelectors();toast('Catégorie supprimée');
}
function savePrm(){
  if(!guardAdmin())return;
  const p=DB.params;
  p.coef1=+document.getElementById('pc1')?.value||1.5;
  p.coef2=+document.getElementById('pc2')?.value||2.0;
  p.coef3=+document.getElementById('pc3')?.value||2.5;
  // Save codification model
  const selModel=document.querySelector('input[name="codif-model"]:checked');
  if(selModel) p.codifModel=selModel.value;
  // Charte params
  p.sep=document.getElementById('psep')?.value||'.';
  p.yr=document.getElementById('pyr')?.value||'ddmmyy';
  p.len=+document.getElementById('plen')?.value||4;
  // Sequential params
  p.pfx2=document.getElementById('ppfx')?.value||'IMM';
  p.pfx=p.pfx2;
  p.sep2=document.getElementById('psep2')?.value||'-';
  p.incyr=+(document.getElementById('pincyr')?.value??1);
  p.lennum=+document.getElementById('plennum')?.value||3;
  const activeNxt=document.getElementById('pnxt-charte')||document.getElementById('pnxt-seq');
  const nxtCharte=document.getElementById('pnxt-charte');
  const nxtSeq=document.getElementById('pnxt-seq');
  if(nxtCharte)p.nxt=+nxtCharte.value||p.nxt||1;
  if(nxtSeq&&document.getElementById('opt-seq')?.checked)p.nxt=+nxtSeq.value||p.nxt||1;
  p.methode=document.getElementById('pm')?.value||'lin';
  p.cal=+document.getElementById('pcal')?.value||360;
  p.devise=document.getElementById('pdev')?.value||'FCFA';
  p.financement=document.getElementById('pfin')?.value||'Fonds propres';
  saveCptx();
  dbSave();
}
function saveEntite(){
  if(!DB.params.entite)DB.params.entite={};
  const e=DB.params.entite;
  e.rs     = document.getElementById('prs')?.value||'';
  e.adresse= document.getElementById('padr')?.value||'';
  e.tel    = document.getElementById('ptel')?.value||'';
  e.email  = document.getElementById('pmail')?.value||'';
  e.ninea  = document.getElementById('pnin')?.value||'';
  e.logo   = document.getElementById('plogo')?.value||''; // base64 ou URL
  e.ex     = document.getElementById('pex')?.value||'';
  dbSave();
}

// ── LOGO UPLOAD ──
function handleLogoFile(file){
  if(!file)return;
  if(!file.type.startsWith('image/')){toast('Fichier non supporté — choisissez une image','e');return;}
  if(file.size>600*1024){toast('Image trop lourde (max 500 Ko) — compressez-la d\'abord','e');return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    const base64=ev.target.result;
    document.getElementById('plogo').value=base64;
    showLogoPreview(base64, file.name, Math.round(file.size/1024)+'Ko');
    // Mettre à jour le logo dans la sidebar
    updateSidebarLogo(base64);
  };
  reader.readAsDataURL(file);
}
function handleLogoDrop(event){
  event.preventDefault();
  const zone=document.getElementById('logo-drop-zone');
  zone.style.borderColor='var(--border2)';
  zone.style.background='var(--surface2)';
  const file=event.dataTransfer.files[0];
  if(file)handleLogoFile(file);
}
function showLogoPreview(src, name, size){
  document.getElementById('logo-drop-content').style.display='none';
  const prev=document.getElementById('logo-drop-preview');
  prev.style.display='flex';
  document.getElementById('logo-img-preview').src=src;
  document.getElementById('logo-file-info').textContent=(name?name+' — ':'')+size;
}
function clearLogo(){
  document.getElementById('plogo').value='';
  document.getElementById('logo-drop-content').style.display='block';
  document.getElementById('logo-drop-preview').style.display='none';
  document.getElementById('logo-img-preview').src='';
  updateSidebarLogo('');
  // Persister immédiatement en DB
  if(DB.params.entite) DB.params.entite.logo='';
  dbSave();
  toast('Logo supprimé');
}
function updateSidebarLogo(src){
  // Remplacer l'icône de la sidebar par le logo de l'entité
  const icon=document.getElementById('sb-logo-icon');
  if(!icon)return;
  if(src){
    icon.innerHTML=`<img src="${src}" style="width:32px;height:32px;object-fit:contain;border-radius:4px">`;
  } else {
    icon.innerHTML=`<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="7" height="7" rx="1.5"/><rect x="10" y="1" width="7" height="7" rx="1.5"/><rect x="1" y="10" width="7" height="7" rx="1.5"/><rect x="10" y="10" width="7" height="7" rx="1.5"/></svg>`;
  }
}
function prevLogo(){
  // Compatibilité legacy — plus utilisée mais gardée pour éviter erreur
}
function loadEntite(){
  if(!DB.params.entite) DB.params.entite={rs:'',adresse:'',tel:'',email:'',ninea:'',logo:'',ex:''};
  const e=DB.params.entite;
  const fields=[['prs',e.rs],['padr',e.adresse],['ptel',e.tel],['pmail',e.email],['pnin',e.ninea]];
  fields.forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val||'';});
  const pex=document.getElementById('pex');
  if(pex&&e.ex)pex.value=e.ex;
  // Charger le logo
  document.getElementById('plogo').value=e.logo||'';
  if(e.logo){
    const sizeApprox=Math.round(e.logo.length*0.75/1024)+'Ko';
    showLogoPreview(e.logo,'',sizeApprox);
    updateSidebarLogo(e.logo);
  } else {
    document.getElementById('logo-drop-content').style.display='block';
    document.getElementById('logo-drop-preview').style.display='none';
  }
}
function loadParams(){
  rdAxes();
  initCloud();
  // Load plan comptable
  const cpts=DB.params.comptes||{};
  const cptDefs={'pc6813':'6813','pc6811':'6811','pc6512':'6512','pc7512':'7512','pc6514':'6514','pc6516':'6516','pc4011':'4011','pc5211':'5211','pc1411':'1411','pc7412':'7412'};
  Object.entries(cptDefs).forEach(([id,def])=>{const el=document.getElementById(id);if(el)el.value=cpts[id]||def;});
  // Load méthodes
  const p=DB.params;
  const pm=document.getElementById('pm');if(pm)pm.value=p.methode||'lin';
  const pcal=document.getElementById('pcal');if(pcal)pcal.value=p.cal||360;
  const pdev=document.getElementById('pdev');if(pdev)pdev.value=p.devise||'FCFA (XOF)';
  const pfin=document.getElementById('pfin');if(pfin)pfin.value=p.financement||'Fonds propres';
  const pc1=document.getElementById('pc1');if(pc1)pc1.value=p.coef1||1.5;
  const pc2=document.getElementById('pc2');if(pc2)pc2.value=p.coef2||2.0;
  const pc3=document.getElementById('pc3');if(pc3)pc3.value=p.coef3||2.5;
  // Load codification model
  const model = p.codifModel || 'sequential';
  const radios = document.querySelectorAll('input[name="codif-model"]');
  radios.forEach(r=>{ r.checked = (r.value === model); });

  // Load charte config
  const psep=document.getElementById('psep');if(psep)psep.value=p.sep||'.';
  const pyr=document.getElementById('pyr');if(pyr)pyr.value=p.yr||'ddmmyy';
  const plen=document.getElementById('plen');if(plen)plen.value=p.len||4;
  const pnxtC=document.getElementById('pnxt-charte');if(pnxtC)pnxtC.value=p.nxt||1;

  // Load sequential config
  const ppfxEl=document.getElementById('ppfx');if(ppfxEl)ppfxEl.value=p.pfx2||p.pfx||'IMM';
  const psep2=document.getElementById('psep2');if(psep2)psep2.value=p.sep2||'-';
  const pincyr=document.getElementById('pincyr');if(pincyr)pincyr.value=p.incyr!=null?p.incyr:1;
  const plennum=document.getElementById('plennum');if(plennum)plennum.value=p.lennum||3;
  const pnxtS=document.getElementById('pnxt-seq');if(pnxtS)pnxtS.value=p.nxt||1;

  // Trigger UI update (show/hide panels, highlight)
  onCodifModelChange();
  loadEntite();
}
function autoSaveCpt(){saveCptx();}
function saveCptx(){
  if(!DB.params.comptes)DB.params.comptes={};
  ['pc6813','pc6811','pc6512','pc7512','pc6514','pc6516','pc4011','pc5211','pc1411','pc7412'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)DB.params.comptes[id]=el.value||id.replace('pc','');
  });
  dbSave();
}
function getCpt(id,def){
  return(DB.params.comptes&&DB.params.comptes[id])||def;
}
function buildEnteteHTML(){
  const e=DB.params.entite||{};
  if(!e.rs)return '';
  return`<div style="display:flex;align-items:center;gap:1.5rem;padding-bottom:1rem;border-bottom:2px solid var(--blue);margin-bottom:1rem">
    ${e.logo?`<img src="${e.logo}" style="max-height:64px;max-width:120px;object-fit:contain">`:''}
    <div>
      <div style="font-size:18px;font-weight:700;color:var(--blue)">${escapeHtml(e.rs)}</div>
      ${e.adresse?`<div style="font-size:12px;color:var(--text2)">${escapeHtml(e.adresse)}</div>`:''}
      <div style="font-size:12px;color:var(--text2)">${[e.tel,e.email,e.ninea?'NINEA : '+e.ninea:''].filter(Boolean).join(' | ')}</div>
    </div>
  </div>`;
}
function onCodifModelChange(){
  const model = document.querySelector('input[name="codif-model"]:checked')?.value || 'sequential';
  DB.params.codifModel = model;
  dbSave();

  // Highlight selected option
  ['opt-charte-wrap','opt-seq-wrap','opt-libre-wrap'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.borderColor='var(--border)';
  });
  const activeWrap = model==='charte'?'opt-charte-wrap':model==='sequential'?'opt-seq-wrap':'opt-libre-wrap';
  const aw=document.getElementById(activeWrap);
  if(aw) aw.style.borderColor='var(--blue)';

  // Show/hide config panels
  const cfgCharte=document.getElementById('cfg-charte');
  const cfgSeq=document.getElementById('cfg-seq');
  if(cfgCharte) cfgCharte.style.display = model==='charte'?'block':'none';
  if(cfgSeq)    cfgSeq.style.display    = model==='sequential'?'block':'none';

  upvNum();
  toast(model==='charte'?'Mode charte activé':model==='sequential'?'Mode séquentiel activé':'Mode saisie libre activé','i');
}

function upvNum(){
  const model = getCodifModel();
  const today = new Date().toISOString().split('T')[0];

  // Read charte config
  const sepEl  = document.getElementById('psep');
  const lenEl  = document.getElementById('plen');
  const yrEl   = document.getElementById('pyr');
  const nxtCharteEl = document.getElementById('pnxt-charte');
  const nxtSeqEl    = document.getElementById('pnxt-seq');
  if(sepEl)  DB.params.sep = sepEl.value || '.';
  if(lenEl)  DB.params.len = +lenEl.value || 4;
  if(yrEl)   DB.params.yr  = yrEl.value || 'ddmmyy';
  if(nxtCharteEl) DB.params.nxt = +nxtCharteEl.value || DB.params.nxt || 1;
  if(nxtSeqEl && document.getElementById('opt-seq')?.checked)
    DB.params.nxt = +nxtSeqEl.value || DB.params.nxt || 1;

  // Read sequential config
  const pfxEl   = document.getElementById('ppfx');
  const sep2El  = document.getElementById('psep2');
  const incyrEl = document.getElementById('pincyr');
  const lennEl  = document.getElementById('plennum');
  if(pfxEl)   DB.params.pfx2   = pfxEl.value   || 'IMM';
  if(sep2El)  DB.params.sep2   = sep2El.value   || '-';
  if(incyrEl) DB.params.incyr  = +incyrEl.value;
  if(lennEl)  DB.params.lennum = +lennEl.value  || 3;

  // Preview charte
  const prevC = genCodeCharte('Ordinateur','HP', today);
  const elPC = document.getElementById('prev-charte');
  if(elPC) elPC.textContent = prevC;

  // Preview seq
  const prevS = genCodeSeq();
  const elPS = document.getElementById('prev-seq');
  const elPrevSeq = document.getElementById('pprev-seq');if(elPrevSeq)elPrevSeq.value=prevS;
  if(elPS) elPS.textContent = prevS;

  // Main preview field (inside active cfg block)
  const elPrev = document.getElementById('pprev');
  if(elPrev){
    if(model === 'charte')     elPrev.value = prevC;
    else if(model === 'sequential') elPrev.value = prevS;
    else elPrev.value = '— saisie manuelle —';
  }
  const el2 = document.getElementById('pprev2');
  if(el2) el2.textContent = model === 'charte' ? prevC : model === 'sequential' ? prevS : '—';
}

// ── UTILISATEURS ──
function rdUsers(){
  try{
  if(!DB.utilisateurs||!DB.utilisateurs.length){
    document.getElementById('usr-tb').innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:2rem">Aucun utilisateur enregistré</td></tr>';
    return;
  }
  document.getElementById('usr-tb').innerHTML=DB.utilisateurs.map(u=>{
    const initials=((u.nom||'?').split(' ').map(x=>x[0]||'').join('').toUpperCase()||'?').slice(0,2);
    const isActif=(u.statut||'actif')==='actif';
    const role = (DB.roles||[]).find(r=>r.id===u.role) || {libelle: u.role, badge: 'gr'};
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="av u" style="width:32px;height:32px;font-size:11px;opacity:${isActif?1:0.5}">${initials}</div>
        <div><div style="font-weight:500">\</div><div style="font-size:11px;color:var(--text3)">\</div></div>
      </div></td>
      <td><span class="badge ${role.badge}">${escapeHtml(role.libelle||'—')}</span></td>
      <td style="font-size:12px;color:var(--text3)">${u.connexion||'—'}</td>
      <td><span class="st ${isActif?'actif':'sorti'}">${isActif?'Actif':'Inactif'}</span></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn xs" onclick="openEditUser(${u.id})">Modifier</button>
        <button class="btn xs" onclick="openChangePwd(${u.id})">Mot de passe</button>
        <button class="btn xs ${isActif?'d':''}" onclick="toggleUserStatut(${u.id})">${isActif?'Désactiver':'Activer'}</button>
      </div></td>
    </tr>`;
  }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:2rem">Aucun utilisateur</td></tr>';
  }catch(err){
    console.error('rdUsers error:', err);
    document.getElementById('usr-tb').innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--red);padding:2rem">Erreur de chargement: '+err.message+'</td></tr>';
  }
}
function openEditUser(id){
  const u=DB.utilisateurs.find(x=>x.id===id);if(!u)return;
  document.getElementById('un').value=u.nom;
  document.getElementById('ue').value=u.email;
  document.getElementById('ur').value=u.role;
  document.getElementById('up').value='';
  document.getElementById('up').placeholder='Laisser vide pour ne pas modifier';
  document.getElementById('m-user').dataset.editId=id;
  document.getElementById('m-user').querySelector('h3').textContent='Modifier — '+u.nom;
  openM('m-user');
}
function toggleUserStatut(id){
  const u=DB.utilisateurs.find(x=>x.id===id);if(!u)return;
  if(!confirm('Voulez-vous '+(u.statut==='actif'?'désactiver':'activer')+' cet utilisateur ?'))return;
  u.statut=u.statut==='actif'?'inactif':'actif';
  dbSave();rdUsers();toast('Statut modifié');
}
let _pwdUserId=null;
function openChangePwd(id){
  if(!guardAdmin())return;
  _pwdUserId=id;
  const u=DB.utilisateurs.find(x=>x.id===id);if(!u)return;
  document.getElementById('m-changepwd').querySelector('h3').textContent='Mot de passe — '+u.nom;
  document.getElementById('pwd-new').value='';
  document.getElementById('pwd-conf').value='';
  openM('m-changepwd');
}
async function saveChangePwd(){
  const n=document.getElementById('pwd-new').value.trim();
  const conf=document.getElementById('pwd-conf').value.trim();
  if(!n||n.length<6){toast('Minimum 6 caractères','e');return;}
  if(n!==conf){toast('Les mots de passe ne correspondent pas','e');return;}
  const u=DB.utilisateurs.find(x=>x.id===_pwdUserId);if(!u)return;
  u.salt = generateSalt();
  u.pwdHash=await sha256(u.salt + n);
  delete u.pwd;
  dbSave();closeM('m-changepwd');rdUsers();toast('Mot de passe modifié');
}
async function saveUser(){
  if(!guardAdmin())return;
  const modal=document.getElementById('m-user');
  const editId=modal.dataset.editId?+modal.dataset.editId:null;
  const nom=document.getElementById('un').value.trim();
  const email=document.getElementById('ue').value.trim().toLowerCase();
  const pwd=document.getElementById('up').value.trim();
  const role=document.getElementById('ur').value;
  if(!nom||!email){toast('Nom et email obligatoires','e');return;}
  
  const existingUser = DB.utilisateurs.find(u => u.email && u.email.toLowerCase() === email && u.id !== editId);
  if(existingUser){toast('Cet email est déjà utilisé par un autre utilisateur','e');return;}
  if(editId){
    const u=DB.utilisateurs.find(x=>x.id===editId);
    if(!u){toast('Utilisateur introuvable','e');return;}
    u.nom=nom;u.email=email;u.role=role;
    if(pwd){
      u.salt = generateSalt();
      u.pwdHash=await sha256(u.salt + pwd);
      delete u.pwd;
    }
    dbSave();closeM('m-user');rdUsers();toast('Utilisateur modifié');
  } else {
    if(!pwd){toast('Mot de passe obligatoire','e');return;}
    if(pwd.length<6){toast('Mot de passe : minimum 6 caractères','e');return;}
    const salt = generateSalt();
    const pwdHash=await sha256(salt + pwd);
    DB.utilisateurs.push({id:Date.now(),nom,email,role,statut:'actif',connexion:'Jamais',pwdHash,salt});
    dbSave();closeM('m-user');rdUsers();toast('Utilisateur créé');
  }
  modal.dataset.editId='';
}

// ── ROLES ──
function rdRoles(){
  try{
    if(!DB.roles || !DB.roles.length){
      document.getElementById('role-tb').innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:2rem">Aucun rôle enregistré</td></tr>';
      return;
    }
    document.getElementById('role-tb').innerHTML=DB.roles.map(r=>{
      const perms = r.perms||{};
      const permsArr = [];
      if(perms.canWrite) permsArr.push('Écriture');
      if(perms.canDelete) permsArr.push('Suppression');
      if(perms.canValidate) permsArr.push('Validation');
      if(perms.canAdmin) permsArr.push('Administration');
      if(perms.canExport) permsArr.push('Export');
      const permsStr = permsArr.length ? permsArr.join(', ') : 'Aucune';
      
      return `<tr>
        <td><span class="badge ${r.badge||'gr'}">${r.libelle||r.id}</span></td>
        <td><span style="font-family:var(--m);font-size:11px;color:var(--text3)">${r.id}</span></td>
        <td style="font-size:12px;color:var(--text2)">${permsStr}</td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn xs" onclick="openMRole('${r.id}')">Modifier</button>
          ${['admin','comptable','gestionnaire','consultation'].includes(r.id) ? '' : `<button class="btn xs d" onclick="deleteRole('${r.id}')">Supprimer</button>`}
        </div></td>
      </tr>`;
    }).join('');
  } catch(err) {
    console.error('rdRoles error:', err);
    const el = document.getElementById('role-tb');
    if(el) el.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--red);padding:2rem">Erreur de chargement</td></tr>';
  }
}

function openMRole(id){
  if(!guardAdmin())return;
  document.getElementById('m-role-id').value = '';
  document.getElementById('m-role-libelle').value = '';
  document.getElementById('m-role-badge').value = 'gr';
  ['canWrite','canDelete','canValidate','canAdmin','canExport'].forEach(p => {
    document.getElementById('m-role-'+p).checked = false;
  });
  
  if(id){
    const r = DB.roles.find(x => x.id === id);
    if(r){
      document.getElementById('m-role-id').value = r.id;
      document.getElementById('m-role-id').disabled = true;
      document.getElementById('m-role-libelle').value = r.libelle;
      document.getElementById('m-role-badge').value = r.badge || 'gr';
      const perms = r.perms || {};
      ['canWrite','canDelete','canValidate','canAdmin','canExport'].forEach(p => {
        document.getElementById('m-role-'+p).checked = !!perms[p];
      });
      document.getElementById('m-role-title').textContent = 'Modifier un rôle';
    }
  } else {
    document.getElementById('m-role-id').disabled = false;
    document.getElementById('m-role-title').textContent = 'Créer un rôle';
  }
  openM('m-role');
}

function saveRole(){
  if(!guardAdmin())return;
  const idInp = document.getElementById('m-role-id');
  const id = idInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const libelle = document.getElementById('m-role-libelle').value.trim();
  const badge = document.getElementById('m-role-badge').value;
  
  if(!id || !libelle){toast('ID et libellé obligatoires','e');return;}
  
  const perms = {};
  ['canWrite','canDelete','canValidate','canAdmin','canExport'].forEach(p => {
    perms[p] = document.getElementById('m-role-'+p).checked;
  });
  
  const existing = DB.roles.findIndex(x => x.id === id);
  if(idInp.disabled){ // Modifying
    if(existing > -1){
      DB.roles[existing].libelle = libelle;
      DB.roles[existing].badge = badge;
      DB.roles[existing].perms = perms;
      toast('Rôle modifié');
    }
  } else { // Creating
    if(existing > -1){toast('Cet ID de rôle existe déjà','e');return;}
    DB.roles.push({id, libelle, badge, perms});
    toast('Rôle créé');
  }
  
  dbSave();
  closeM('m-role');
  rdRoles();
  populateRoleSelects();
  rdUsers();
  applyRoleUI();
}

function deleteRole(id){
  if(!guardAdmin())return;
  if(['admin','comptable','gestionnaire','consultation'].includes(id)){
    toast('Impossible de supprimer un rôle système','e');return;
  }
  const inUse = DB.utilisateurs.some(u => u.role === id);
  if(inUse){
    toast('Rôle utilisé par un ou plusieurs utilisateurs','e');return;
  }
  if(!confirm('Voulez-vous supprimer ce rôle ?'))return;
  DB.roles = DB.roles.filter(r => r.id !== id);
  dbSave();
  rdRoles();
  populateRoleSelects();
  toast('Rôle supprimé');
}

function populateRoleSelects(){
  const sel = document.getElementById('ur');
  if(sel){
    const val = sel.value;
    sel.innerHTML = (DB.roles||[]).map(r => `<option value="${r.id}">${escapeHtml(r.libelle)}</option>`).join('');
    if((DB.roles||[]).find(r=>r.id===val)) sel.value = val;
  }
}

// ── UTILS ──
function dlFile(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();}
function exportAmortXLS(){
  const rows=document.querySelectorAll('#atb tr');
  if(!rows.length){toast('Générez d\u2019abord un plan','e');return;}
  const title=document.getElementById('apt').textContent;
  const im=getAmortImmoInfo();
  let csv=title+'\n';
  if(im){
    csv+=`Code;\\nDésignation;\\nDate d'achat;${im.dateAcq||''}\nValeur d'origine;${im.vo}\nMéthode;${im.methode==='lin'?'Linéaire':'Dégressif'}\nDurée;${im.duree} ans\nTaux;${(im.taux*100).toFixed(2)}%\nAffectation;\\n\n`;
  }
  csv+='Exercice;V. Début;Taux;Dotation;Cumul amort.;VNC fin;% amorti\n';
  rows.forEach(r=>{const cells=[...r.querySelectorAll('td')];if(cells.length)csv+=cells.map(cc=>cc.textContent.trim().replace(/\s+/g,' ').replace(/;/g,',')).join(';')+'\n';});
  dlFile('plan_amortissement.csv',csv,'text/csv');
  toast('Export Excel (CSV) téléchargé');
}
function getAmortImmoInfo(){
  const id=document.getElementById('asel')?.value;
  if(!id)return null;
  return DB.immobilisations.find(x=>x.id===id)||null;
}
function buildAmortImmoCard(im){
  if(!im)return '';
  const cum=cumAt(im,new Date().toISOString().split('T')[0]);
  return`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;padding:12px;background:#F0F5FC;border-radius:8px;border:1px solid #D8E2EE">
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Code</div><div style="font-weight:600;color:#1B6EC2;font-family:monospace">\</div></div>
    <div style="grid-column:span 2"><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Désignation</div><div style="font-weight:600">\</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Date d'acquisition</div><div>${im.dateAcq?im.dateAcq.split('-').reverse().join('/'):'—'}</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Valeur d'origine</div><div style="font-weight:600">${Math.round(im.vo).toLocaleString('fr-FR')} FCFA</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Fournisseur</div><div>\</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Nature / Unité</div><div>${im.nature||'—'}</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Méthode / Durée</div><div>${im.methode==='lin'?'Linéaire':'Dégressif'} — ${im.duree} ans (${(im.taux*100).toFixed(1)}%)</div></div>
    <div><div style="font-size:10px;color:#8896A8;text-transform:uppercase;letter-spacing:.05em">Affectation</div><div>\</div></div>
  </div>`;
}
function exportAmortPDF(){
  const title=document.getElementById('apt').textContent;
  const tableHTML=document.querySelector('#atb')?.closest('table')?.outerHTML||'';
  const entete=buildEnteteHTML();
  const im=getAmortImmoInfo();
  const imCard=buildAmortImmoCard(im);
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#0F1923}h2{color:#1B6EC2;margin-bottom:8px;font-size:16px}table{width:100%;border-collapse:collapse}th{background:#EBF4FF;color:#1B6EC2;padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em}th:first-child{text-align:left}td{padding:7px 8px;border-bottom:1px solid #E4EAF2;text-align:right;font-family:monospace;font-size:11px}td:first-child{text-align:left;font-family:Arial}tfoot td{font-weight:700;background:#F4F7FB}@media print{body{padding:0}}</style>
  </head><body>${entete}<h2>${title}</h2>${imCard}${tableHTML}<scr` + `ipt>window.print();window.close();<\/script></body></html>`);
  win.document.close();
}
function exportRapPDF(){
  logAction('PRINT','Rapport PDF',document.getElementById('rap-title')?document.getElementById('rap-title').textContent:'rapport');
  const title=document.getElementById('rap-title').textContent;
  const rawBody=document.getElementById('rap-body').innerHTML;
  const entete=buildEnteteHTML();
  const date=new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const win=window.open('','_blank');
  if(!win){toast('Autorisez les popups pour exporter en PDF','e');return;}

  // Neutraliser les styles "écran" : table-layout:fixed, min-width, classes de troncature
  const body=rawBody
    .replace(/table-layout:fixed;?/g,'table-layout:auto;')
    .replace(/min-width:\d+px;?/g,'')
    .replace(/class="rap-tw"/g,'class="print-tw"')
    .replace(/class="tw"/g,'class="print-tw"');

  win.document.write(`<!DOCTYPE html><html lang="fr"><head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page{size:A4 landscape;margin:10mm 12mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:9.5px;color:#1a1a2e;background:#fff}
    /* ── En-tête ── */
    .page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #1A5FB4}
    .page-header h1{font-size:13px;color:#1A5FB4;font-weight:700}
    .page-header .date{font-size:9px;color:#666;margin-top:3px}
    .entete{margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #E5E7EB}
    .entete .org{font-size:13px;font-weight:700;color:#1A5FB4}
    .entete .info{font-size:9px;color:#6B7280;margin-top:2px}
    /* ── Tableau flexible ── */
    .print-tw{overflow:visible!important;width:100%}
    table{width:100%;border-collapse:collapse;table-layout:auto!important;margin-bottom:12px}
    col,th,td{max-width:none!important;min-width:0!important}
    /* colonnes clés */
    th:nth-child(1),td:nth-child(1){width:14%;word-break:break-all;max-width:130px}
    th:nth-child(2),td:nth-child(2){width:auto}
    /* Header */
    thead th{
      background:#EBF4FF;color:#1A5FB4;
      padding:5px 6px;font-size:8.5px;font-weight:700;
      text-transform:uppercase;letter-spacing:.04em;
      text-align:left;border-bottom:2px solid #1A5FB4;
      white-space:nowrap
    }
    thead th:not(:nth-child(1)):not(:nth-child(2)){text-align:right}
    /* Cellules */
    tbody td{
      padding:4px 6px;border-bottom:1px solid #E8EDF5;
      font-size:9px;vertical-align:top;
      word-break:break-word;overflow-wrap:anywhere
    }
    tbody td:not(:nth-child(1)):not(:nth-child(2)){text-align:right;font-family:'Courier New',monospace;word-break:normal}
    /* Alternance */
    tbody tr:nth-child(even) td{background:#FAFBFF}
    /* Sous-totaux catégorie */
    tbody tr[style*="background:var(--surface2)"] td,
    tbody tr[style*="surface2"] td,
    tbody tr.subtotal td{background:#F0F5FF!important;font-weight:600;font-size:9px;color:#374151}
    /* Totaux */
    tfoot td{padding:5px 6px;font-weight:700;background:#EBF4FF;color:#1A5FB4;font-size:9.5px;border-top:2px solid #1A5FB4}
    tfoot td:not(:first-child){text-align:right;font-family:'Courier New',monospace}
    /* Badges et codes */
    .badge,.tc,.tc-sm,.tc-lg,.tc-xs,.tc-md{
      display:inline!important;
      overflow:visible!important;
      text-overflow:clip!important;
      white-space:normal!important;
      max-width:none!important;
      font-size:8.5px;
      background:#EBF4FF;color:#1A5FB4;
      padding:1px 4px;border-radius:6px;font-weight:500
    }
    code{font-family:'Courier New',monospace;background:#F3F4F6;padding:1px 3px;border-radius:2px;font-size:8.5px;color:#1A5FB4;word-break:break-all}
    /* styles inline var() → couleurs réelles */
    [style*="color:var(--red)"]{color:#991B1B!important}
    [style*="color:var(--green)"]{color:#166534!important}
    [style*="color:var(--blue)"]{color:#1A5FB4!important}
    [style*="color:var(--amber)"]{color:#92400E!important}
    [style*="background:var(--surface2)"],[style*="background:var(--blue-light)"]{background:#EBF4FF!important}
    /* No-trunc override */
    .no-trunc{max-width:none!important}
    /* Cacher les boutons d'action */
    button,.btn{display:none!important}
    @media print{
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      thead{display:table-header-group}
      tfoot{display:table-footer-group}
      tr{page-break-inside:avoid}
    }
  </style>
  </head><body>
  ${entete?`<div class="entete"><span class="org">${(DB?.params?.entite?.rs)||''}</span><div class="info">${[(DB?.params?.entite?.adresse||''),(DB?.params?.entite?.tel||''),(DB?.params?.entite?.ninea?'NINEA : '+(DB?.params?.entite?.ninea):'')].filter(Boolean).join(' | ')}</div></div>`:''}
  <div class="page-header">
    <div><h1>${title}</h1><div class="date">Édité le ${date}</div></div>
  </div>
  ${body}
  <scr`+`ipt>setTimeout(()=>{window.print();},500);<\/script>
  </body></html>`);
  win.document.close();
}


// ════════════════════════════════════════════
// IMPORT EXCEL / CSV
// ════════════════════════════════════════════
// Mapping catégorie → nature par défaut (pour auto-remplissage à l'import)
const CAT_TO_NATURE = {
  'Matériel informatique':     'Matériel informatique',
  'Mobilier de bureau':        'Mobilier de bureau',
  'Matériel de transport':     'Matériel de transport',
  'Immobilisations incorporelles': 'Immobilisations incorporelles',
  'Autres matériels':          'Équipements divers',
  'Équipements divers':        'Équipements divers',
  'Bâtiments':                 'Bâtiments',
  'Terrains':                  'Terrains',
  'Agencements & installations': 'Agencements & installations',
  'Matériel et outillage':     'Matériel et outillage',
};
const IMPORT_COLS = ['designation','categorie','valeur_origine','date_acquisition','duree_amortissement','methode','financement','fournisseur','affectation','nature','calendrier','compte_immo','compte_amort','code'];
const CATS_VALID = ['Matériel informatique','Mobilier de bureau','Matériel de transport','Autres matériels','Immobilisations incorporelles','Équipements divers','Bâtiments','Terrains','Agencements & installations','Matériel et outillage'];

let _importRows = []; // parsed rows ready to import

function dlTemplate(){
  const header = IMPORT_COLS.join(';');
  const example = [
    'Serveur Dell PowerEdge R740',
    'Matériel informatique',
    '4500000',
    '15/03/2024',
    '5',
    'lin',
    'Fonds propres',
    'Dell Sénégal',
    'Direction informatique',
    'Unité',
    '360',
    '2414',
    '2814',
    ''
  ].join(';');
  const example2 = [
    'Toyota Hilux Double Cabine',
    'Matériel de transport',
    '22000000',
    '02/01/2024',
    '5',
    'lin',
    'Fonds propres',
    'Eiffage Automobile',
    'Direction générale',
    'Véhicule',
    '360',
    '2245',
    '2845',
    ''
  ].join(';');
  const csv = header + '\n' + example + '\n' + example2 + '\n';
  dlFile('modele_import_immobilisations.csv', csv, 'text/csv;charset=utf-8');
  toast('Modèle téléchargé');
}

function handleFileDrop(file){ handleFileSelect(file); }
function handleFileSelect(file){
  if(!file){ return; }
  const ext = file.name.split('.').pop().toLowerCase();
  if(!['csv','txt'].includes(ext)){
    toast('Format non supporté — utilisez un fichier .csv ou .txt','e');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    let text = e.target.result;
    // Detect garbled ISO-8859-1 read as UTF-8: presence of replacement chars or typical garbled patterns
    // Re-read as ISO-8859-1 if the first line contains replacement characters or garbled sequences
    if(text.includes('\uFFFD') || /[\x80-\x9F]/.test(text)){
      const reader2 = new FileReader();
      reader2.onload = e2 => parseCSV(e2.target.result);
      reader2.readAsText(file, 'ISO-8859-1');
      return;
    }
    parseCSV(text);
  };
  reader.onerror = () => toast('Erreur de lecture du fichier','e');
  reader.readAsText(file, 'UTF-8');
}

function parseCSV(text){
  // Normalize line endings
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if(lines.length < 2){
    toast('Fichier vide ou sans données','e');
    return;
  }

  // Detect separator (; or ,)
  const sep = lines[0].includes(';') ? ';' : ',';

  // Parse header — normalize accents first (NFD) so DÉSIGNATION → DESIGNATION
  const normalizeHdr = s => s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // strip accents: é→e, û→u, etc.
    .replace(/[^a-z0-9]/g,'_')
    .replace(/__+/g,'_')
    .replace(/^_|_$/g,'');

  const rawHeaders = lines[0].split(sep).map(normalizeHdr);

  // Alias dictionary: maps normalized variants → canonical IMPORT_COLS key
  const COL_ALIASES = {
    'designation':'designation','designation_du_bien':'designation','libelle':'designation',
    'intitule':'designation','nom_du_bien':'designation','nom':'designation',
    'bien':'designation','immobilisation':'designation','objet':'designation',
    'categorie':'categorie','categorie_du_bien':'categorie','type':'categorie',
    'famille':'categorie','rubrique':'categorie','classe':'categorie',
    'valeur_origine':'valeur_origine','valeur_brute':'valeur_origine',
    'valeur_acquisition':'valeur_origine','cout_acquisition':'valeur_origine',
    'valeur':'valeur_origine','prix':'valeur_origine','montant':'valeur_origine',
    'vo':'valeur_origine','valeur_d_origine':'valeur_origine',
    'date_acquisition':'date_acquisition','date_achat':'date_acquisition',
    'date_mise_en_service':'date_acquisition','dateacq':'date_acquisition',
    'date_acq':'date_acquisition','date':'date_acquisition',
    'duree_amortissement':'duree_amortissement','duree':'duree_amortissement',
    'dur_e':'duree_amortissement','dureeamortissement':'duree_amortissement',
    'duree_de_vie':'duree_amortissement','duree_utile':'duree_amortissement',
    'methode':'methode','methode_amortissement':'methode','mode':'methode',
    'financement':'financement','source_financement':'financement',
    'fournisseur':'fournisseur','vendeur':'fournisseur','prestataire':'fournisseur',
    'affectation':'affectation','lieu':'affectation','localisation':'affectation',
    'service':'affectation','direction':'affectation','site':'affectation',
    'nature':'nature','type_bien':'nature',
    'code':'code','code_immo':'code','numero':'code','num':'code','reference':'code',
    'calendrier':'calendrier','compte_immo':'compte_immo','compte_amort':'compte_amort',
  };

  // Map CSV headers to expected columns
  const colMap = {};
  // Pass 1: alias dictionary (exact match on normalized header)
  rawHeaders.forEach((h, i) => {
    const canon = COL_ALIASES[h];
    if(canon && colMap[canon] === undefined) colMap[canon] = i;
  });
  // Pass 2: partial alias match (header contains or is contained by an alias key)
  rawHeaders.forEach((h, i) => {
    Object.entries(COL_ALIASES).forEach(([alias, canon]) => {
      if(colMap[canon] !== undefined) return;
      if(alias.length >= 4 && (h.includes(alias) || alias.includes(h) && h.length >= 4)){
        colMap[canon] = i;
      }
    });
  });

  // Check required columns
  const required = ['designation','categorie','valeur_origine','date_acquisition','duree_amortissement'];
  const missing = required.filter(col => colMap[col] === undefined);
  if(missing.length > 0){
    showImportError(
      'Colonnes obligatoires manquantes : <b>' + missing.join(', ') + '</b><br>' +
      'En-têtes détectés dans votre fichier : <code>' + rawHeaders.join(' | ') + '</code><br>' +
      'Conseil : téléchargez le modèle et copiez vos données dedans.'
    );
    return;
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  for(let i = 1; i < lines.length; i++){
    const line = lines[i];
    if(!line.trim()) continue;
    
    // Handle quoted fields
    const cells = parseCsvLine(line, sep);
    
    const get = col => colMap[col] !== undefined ? (cells[colMap[col]]||'').trim() : '';

    const designation = get('designation');
    const categorie = get('categorie') || 'Autres matériels';
    const voRaw = get('valeur_origine').replace(/[\s,']/g,'').replace(',','.');
    const vo = parseFloat(voRaw);
    const dateRaw = get('date_acquisition');
    const dureeRaw = get('duree_amortissement');
    const duree = parseInt(dureeRaw);

    const rowErrors = [];
    const rowWarnings = [];

    if(!designation) rowErrors.push('Désignation vide');
    if(isNaN(vo) || vo <= 0) rowErrors.push('Valeur d\u2019origine invalide: ' + get('valeur_origine'));
    if(isNaN(duree) || duree <= 0) rowErrors.push('Durée invalide: ' + dureeRaw);
    
    // Parse date JJ/MM/AAAA
    let dateAcq = '';
    const dm = dateRaw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(dm){
      dateAcq = `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
    } else if(dateRaw.match(/^\d{4}-\d{2}-\d{2}$/)){
      dateAcq = dateRaw; // already ISO format
    } else {
      rowErrors.push('Date invalide: ' + dateRaw + ' (attendu JJ/MM/AAAA)');
    }

    // Validate category
    if(!CATS_VALID.includes(categorie) && categorie){
      // Try to find closest match
      const match = CATS_VALID.find(c => c.toLowerCase().includes(categorie.toLowerCase().split(' ')[0]));
      if(match){
        rowWarnings.push(`Catégorie "${categorie}" → remplacée par "${match}"`);
      } else {
        rowWarnings.push(`Catégorie "${categorie}" inconnue → "Autres matériels"`);
      }
    }

    const methode = ['lin','deg'].includes(get('methode').toLowerCase()) ? get('methode').toLowerCase() : 'lin';
    const financement = get('financement') === 'Subventions' ? 'Subventions' : 'Fonds propres';
    const cal = [360, 365].includes(parseInt(get('calendrier'))) ? parseInt(get('calendrier')) : 360;

    if(rowErrors.length > 0){
      errors.push(`Ligne ${i+1} (\) : ${rowErrors.join(', ')}`);
    }
    if(rowWarnings.length > 0){
      warnings.push(`Ligne ${i+1} : ${rowWarnings.join(', ')}`);
    }

    // Get category defaults for accounts
    const catDef = DB.categories.find(cat => cat.libelle === categorie) || {};

    const taux = duree > 0 ? 1/duree : 0;
    // Code: use CSV value if provided, else mark as auto-generated (will be assigned at import)
    const csvCode = get('code');
    const importCode = csvCode || ''; // leave empty = auto-generated at import time
    rows.push({
      _line: i+1,
      _hasError: rowErrors.length > 0,
      _warnings: rowWarnings,
      _autoCode: !csvCode, // flag: needs auto-generation
      id: UID(),
      code: importCode,
      designation: designation || '?',
      categorie: CATS_VALID.includes(categorie) ? categorie : (CATS_VALID.find(cat=>cat.toLowerCase().includes(categorie.toLowerCase().split(' ')[0]))||'Autres matériels'),
      nature: get('nature') || CAT_TO_NATURE[categorie] || CAT_TO_NATURE[CATS_VALID.find(c=>c.toLowerCase().includes(categorie.toLowerCase().split(' ')[0]))||''] || '',
      financement,
      vo: isNaN(vo) ? 0 : vo,
      fournisseur: get('fournisseur') || '',
      affectation: get('affectation') || '',
      methode,
      duree: isNaN(duree) ? 0 : duree,
      taux,
      dateAcq,
      cal,
      statut: 'actif',
      ci: get('compte_immo') || catDef.cptImmo || '',
      ca: get('compte_amort') || catDef.cptAmort || '',
    });
  }

  _importRows = rows;
  showImportPreview(rows, errors, warnings);
}

function parseCsvLine(line, sep){
  // Handle quoted fields properly
  const cells = [];
  let cur = '';
  let inQuote = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(ch === '"'){
      inQuote = !inQuote;
    } else if(ch === sep && !inQuote){
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function showImportError(msg){
  const preview = document.getElementById('import-preview');
  const errList = document.getElementById('import-err-list');
  preview.style.display = 'block';
  errList.style.display = 'block';
  errList.innerHTML = `<div class="alert danger" style="font-size:12px">${msg}</div>`;
  document.getElementById('import-tbody').innerHTML = '';
  document.getElementById('import-summary').textContent = '0 lignes';
  document.getElementById('btn-do-import').style.display = 'none';
}

function showImportPreview(rows, errors, warnings){
  const preview = document.getElementById('import-preview');
  const tbody = document.getElementById('import-tbody');
  const errList = document.getElementById('import-err-list');
  const summary = document.getElementById('import-summary');
  const warnBadge = document.getElementById('import-warn-badge');
  const errBadge = document.getElementById('import-err-badge');
  
  preview.style.display = 'block';
  
  const valid = rows.filter(r => !r._hasError);
  const invalid = rows.filter(r => r._hasError);
  
  summary.textContent = valid.length + ' ligne(s) valides';
  
  if(warnings.length > 0){
    warnBadge.style.display = 'inline-flex';
    warnBadge.textContent = warnings.length + ' avertissement(s)';
  } else {
    warnBadge.style.display = 'none';
  }
  
  if(invalid.length > 0 || errors.length > 0){
    errBadge.style.display = 'inline-flex';
    errBadge.textContent = invalid.length + ' erreur(s)';
    errList.style.display = 'block';
    errList.innerHTML = [...errors, ...warnings].map(e => 
      `<div class="alert ${errors.includes(e)?'danger':'warning'}" style="font-size:11px;margin-bottom:4px;padding:.4rem .75rem">${e}</div>`
    ).join('');
  } else {
    errBadge.style.display = 'none';
    errList.style.display = 'none';
  }

  tbody.innerHTML = rows.map(row => {
    const ok = !row._hasError;
    const bg = !ok ? 'background:var(--red-light)' : (row._warnings.length ? 'background:var(--amber-light)' : '');
    return `<tr style="${bg}">
      <td style="color:var(--text3)">${row._line}</td>
      <td style="font-weight:500">${escapeHtml(row.designation)}</td>
      <td><span class="badge ${CC(row.categorie)}">${row.categorie}</span></td>
      <td style="font-family:var(--m);text-align:right">${row.vo?F(row.vo):'—'}</td>
      <td>${row.dateAcq?row.dateAcq.split('-').reverse().join('/'):'—'}</td>
      <td style="text-align:center">${row.duree||'—'} ans</td>
      <td style="text-align:center">${row.methode==='lin'?'Linéaire':'Dégressif'}</td>
      <td>${row.financement}</td>
      <td style="color:var(--text3)">${escapeHtml(row.affectation||'—')}</td>
      <td>${ok ? '<span class="badge g">✓ Valide</span>' : '<span class="badge r">✗ Erreur</span>'}</td>
    </tr>`;
  }).join('');

  document.getElementById('btn-do-import').style.display = valid.length > 0 ? 'inline-flex' : 'none';
  document.getElementById('btn-do-import').textContent = '';
  document.getElementById('btn-do-import').innerHTML = `
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 7l3 3 6-6"/></svg>
    Importer ${valid.length} immobilisation(s)`;
}

function doImport(){
  const valid = _importRows.filter(r => !r._hasError);
  if(!valid.length){ toast('Aucune ligne valide à importer','e'); return; }
  
  let imported = 0;
  let skipped = 0;
  const skippedCodes = [];
  // Track codes used in THIS import AND already in DB — single source of truth
  const usedInBatch = new Set(DB.immobilisations.map(i => i.code));
  
  valid.forEach(row => {
    let code = row.code;
    // If no code provided in CSV, generate a unique one
    if(!code){
      let attempts = 0;
      do {
        code = genCodeAuto(row.designation, row.nature, row.dateAcq);
        DB.params.nxt = (+DB.params.nxt || 1) + 1;
        attempts++;
      } while(usedInBatch.has(code) && attempts < 200);
      // Last resort fallback if generator still produces a duplicate after 200 attempts
      if(usedInBatch.has(code)){
        code = 'IMP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
      }
    }
    
    // Single duplicate check against usedInBatch (covers both existing DB codes AND already-imported batch codes)
    if(usedInBatch.has(code)){
      skipped++;
      skippedCodes.push(code);
      return;
    }
    
    usedInBatch.add(code);
    DB.immobilisations.push({
      id: row.id,
      code,
      designation: row.designation,
      categorie: row.categorie,
      nature: row.nature,
      financement: row.financement,
      vo: row.vo,
      fournisseur: row.fournisseur,
      affectation: row.affectation,
      methode: row.methode,
      duree: row.duree,
      taux: row.taux,
      dateAcq: row.dateAcq,
      cal: row.cal,
      statut: 'actif',
      ci: row.ci,
      ca: row.ca,
    });
    imported++;
  });
  
  dbSave();
  closeM('m-import');
  resetImport();
  rdFiches();
  rdDash();
  popLieuSel();
  
  logAction('IMPORT','Import CSV',imported+' immos importées, '+skipped+' ignorées');
  let msg = imported + ' immobilisation(s) importée(s)';
  if(skipped > 0) msg += ' — ' + skipped + ' ignorée(s) (code déjà présent en base)';
  toast(msg, skipped > 0 ? 'i' : '');
}

function resetImport(){
  _importRows = [];
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('btn-do-import').style.display = 'none';
  const fi = document.getElementById('file-inp');
  if(fi) fi.value = '';
}


// ══════════════════════════════════════════════════════════
// ── RÉVISION DE PLAN (page globale) ──
// ══════════════════════════════════════════════════════════
let _gRevImmo=null; // immobilisation en cours de révision

// --- Recherche autocomplete ---
function revSearchInput(){
  const q=(document.getElementById('rev-search').value||'').toLowerCase().trim();
  const dd=document.getElementById('rev-dropdown');
  const list=document.getElementById('rev-dropdown-list');
  if(!q){dd.style.display='none';return;}
  const hits=DB.immobilisations.filter(i=>i.statut!=='sorti'&&(i.code.toLowerCase().includes(q)||i.designation.toLowerCase().includes(q))).slice(0,10);
  if(!hits.length){dd.style.display='none';return;}
  list.innerHTML=hits.map(i=>`<div onclick="revSelectImmo('${i.id}')" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px" onmouseover="this.style.background='var(--blue-light)'" onmouseout="this.style.background=''">
    <span style="font-family:var(--m);font-size:11px;color:var(--blue)">${escapeHtml(i.code)}</span> — ${escapeHtml(i.designation)}
    <span style="font-size:11px;color:var(--text3);margin-left:6px">${escapeHtml(i.categorie)}</span>
  </div>`).join('');
  dd.style.display='block';
}
function revSearchOpen(){revSearchInput();}
function revSearchKey(e){if(e.key==='Escape')document.getElementById('rev-dropdown').style.display='none';}
function revSearchClear(){
  document.getElementById('rev-search').value='';
  document.getElementById('rev-immo-id').value='';
  document.getElementById('rev-dropdown').style.display='none';
  document.getElementById('rev-vnc-now').value='';
  document.getElementById('rev-dur-rest').value='';
  document.getElementById('rev-meth-now').value='';
  document.getElementById('grev-preview').style.display='none';
  document.getElementById('grev-compare').style.display='none';
  _gRevImmo=null;
}
function revSelectImmo(id){
  const im=DB.immobilisations.find(i=>i.id===id);
  if(!im) return;
  _gRevImmo=im;
  document.getElementById('rev-immo-id').value=id;
  document.getElementById('rev-search').value=im.code+' — '+im.designation;
  document.getElementById('rev-dropdown').style.display='none';
  // Calculer VNC actuelle
  const vnc=Math.max(0,im.vo-cumAt(im,TD()));
  document.getElementById('rev-vnc-now').value=F(vnc)+' FCFA';
  // Durée restante
  const plan=buildPlan(im);
  const yrNow=new Date().getFullYear();
  const futureRows=plan.filter(r=>(r.yrNum||+r.yr||0)>=yrNow);
  const durRest=futureRows.length;
  document.getElementById('rev-dur-rest').value=durRest+' an(s)';
  document.getElementById('rev-meth-now').value=({lin:'Linéaire',deg:'Dégressif SYSCOHADA',degf:'Dégressif fiscal',uo:'Unités d\'œuvre'}[im.methode]||im.methode);
  // Préremplir les champs
  document.getElementById('grev-date').value=TD();
  document.getElementById('grev-dur').value=durRest||im.duree||'';
  document.getElementById('grev-meth').value=im.methode==='lin'?'lin':'deg';
  document.getElementById('grev-motif').value='';
  calcGRevision();
}
function calcGRevision(){
  const im=_gRevImmo;
  if(!im){document.getElementById('grev-preview').style.display='none';return;}
  const dateRev=document.getElementById('grev-date').value;
  const newDur=+document.getElementById('grev-dur').value;
  const newMeth=document.getElementById('grev-meth').value;
  if(!dateRev||!newDur) {document.getElementById('grev-preview').style.display='none';return;}
  const vncRev=Math.max(0,im.vo-cumAt(im,dateRev));
  const oldDotAnn=Math.round(im.vo*im.taux);
  const newTaux=1/newDur;
  const newDotAnn=Math.round(vncRev*newTaux);
  const delta=newDotAnn-oldDotAnn;
  const prev=document.getElementById('grev-preview');
  prev.style.display='block';
  prev.innerHTML=`<strong>Impact de la révision :</strong><br>
    VNC à la date de révision : <strong style="font-family:var(--m)">${F(vncRev)} FCFA</strong><br>
    Nouvelle dotation annuelle : <strong style="font-family:var(--m)">${F(newDotAnn)} FCFA/an</strong>
    (ancienne : ${F(oldDotAnn)} FCFA/an — écart : <span style="color:${delta>0?'var(--red)':'var(--green)'}">${delta>0?'+':''}${F(delta)} FCFA</span>)<br>
    Durée résiduelle : <strong>${newDur} an(s)</strong>`;
  // Plan comparatif
  const yrRev=new Date(dateRev).getFullYear();
  const planAvant=buildPlan(im);
  // Plan après = bien fictif avec VNC comme VO, à partir de l'exercice de révision
  const fakeIM={...im,vo:vncRev,vr:0,dateAcq:dateRev,dateMis:dateRev,methode:newMeth,duree:newDur,taux:newTaux};
  const planApres=buildPlan(fakeIM);
  const apresMap={};
  planApres.forEach(r=>{const y=r.yrNum||+r.yr||yrRev;apresMap[y]=r.dt;});
  const rows=planAvant.filter(r=>(r.yrNum||+r.yr||0)>=yrRev);
  const tb=document.getElementById('grev-compare-tb');
  let cumVNC=vncRev;
  tb.innerHTML=rows.map((r,i)=>{
    const y=r.yrNum||+r.yr||yrRev;
    const ap=apresMap[y]||0;
    const ec=ap-r.dt;
    cumVNC=Math.max(0,cumVNC-ap);
    return `<tr>
      <td>${r.yr}</td>
      <td style="text-align:right;font-family:var(--m)">${F(r.dt)}</td>
      <td style="text-align:right;font-family:var(--m);color:var(--blue)">${F(ap)}</td>
      <td style="text-align:right;font-family:var(--m);color:${ec>0?'var(--red)':'var(--green)'}">${ec>0?'+':''}${F(ec)}</td>
      <td style="text-align:right;font-family:var(--m)">${F(cumVNC)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="5" style="color:var(--text3);text-align:center">Aucune dotation future</td></tr>';
  document.getElementById('grev-compare').style.display='block';
}
function appliquerGRevision(){
  if(!guardWrite())return;
  const im=_gRevImmo;
  if(!im){toast('Sélectionnez une immobilisation','e');return;}
  const dateRev=document.getElementById('grev-date').value;
  const newDur=+document.getElementById('grev-dur').value;
  const newMeth=document.getElementById('grev-meth').value;
  const motif=document.getElementById('grev-motif').value.trim();
  if(!dateRev||!newDur){toast('Date de révision et durée résiduelle requis','e');return;}
  if(!motif){toast('Le motif est obligatoire','e');return;}
  const vncRev=Math.max(0,im.vo-cumAt(im,dateRev));
  const oldDotAnn=Math.round(im.vo*im.taux);
  const newTaux=1/newDur;
  const newDotAnn=Math.round(vncRev*newTaux);
  if(!im.revisions)im.revisions=[];
  im.revisions.push({
    date:dateRev,ancDuree:im.duree,ancMeth:im.methode,ancTaux:im.taux,
    newDuree:newDur,newMeth:newMeth,newTaux:newTaux,
    vncRevision:vncRev,motif,par:currentUser?.nom||'Admin',
    ancDotAnn:oldDotAnn,newDotAnn
  });
  // Appliquer prospective : modifier le bien
  im.duree=newDur;
  im.methode=newMeth;
  im.taux=newTaux;
  im.dateRevision=dateRev;
  // Recalculer VO fictive = VNC à la révision (pour le calcul futur)
  im._voRev=vncRev;
  im._dateRevMis=dateRev;
  dbSave();
  toast('Révision appliquée avec succès');
  revSearchClear();
  rdRevision();
}
function rdRevision(){
  // Construire l'historique global des révisions
  const tb=document.getElementById('grev-hist-tb');
  let rows=[];
  DB.immobilisations.forEach(im=>{
    if(!im.revisions||!im.revisions.length) return;
    im.revisions.forEach(r=>{
      rows.push({im,r});
    });
  });
  rows.sort((a,b)=>b.r.date.localeCompare(a.r.date));
  document.getElementById('rev-hist-count').textContent=rows.length;
  if(!rows.length){
    tb.innerHTML='<tr><td colspan="10" style="color:var(--text3);text-align:center;padding:2rem">Aucune révision enregistrée</td></tr>';
    return;
  }
  tb.innerHTML=rows.map(({im,r})=>`<tr>
    <td>${FD(r.date)}</td>
    <td><code>${escapeHtml(im.code)}</code></td>
    <td class="clk" onclick="revSelectImmo('${im.id}')">${escapeHtml(im.designation)}</td>
    <td><span class="badge ${CC(im.categorie)}">${escapeHtml(im.categorie)}</span></td>
    <td style="font-size:12px;color:var(--text3)">${({lin:'Lin.',deg:'Dégr.',degf:'Fisc.'}[r.ancMeth]||r.ancMeth)} / ${r.ancDuree} ans</td>
    <td style="font-size:12px;color:var(--blue)">${({lin:'Lin.',deg:'Dégr.',degf:'Fisc.'}[r.newMeth]||r.newMeth)} / ${r.newDuree} ans</td>
    <td style="text-align:right;font-family:var(--m)">${F(r.vncRevision||0)}</td>
    <td style="text-align:right;font-family:var(--m);color:${(r.newDotAnn-r.ancDotAnn)>0?'var(--red)':'var(--green)'}">${(r.newDotAnn-r.ancDotAnn)>0?'+':''}${F((r.newDotAnn||0)-(r.ancDotAnn||0))}</td>
    <td style="font-size:12px">${escapeHtml(r.motif)}</td>
    <td style="font-size:12px;color:var(--text3)">${escapeHtml(r.par||'—')}</td>
  </tr>`).join('');
}
function exportRevisions(){
  const rows=[];
  DB.immobilisations.forEach(im=>{
    (im.revisions||[]).forEach(r=>{
      rows.push([FD(r.date),im.code,im.designation,im.categorie,r.ancMeth,r.ancDuree,r.newMeth,r.newDuree,F(r.vncRevision||0),F(r.ancDotAnn||0),F(r.newDotAnn||0),r.motif,r.par].join(';'));
    });
  });
  if(!rows.length){toast('Aucune révision à exporter','e');return;}
  const hdr='Date révision;Code;Désignation;Catégorie;Anc. méthode;Anc. durée;Nouv. méthode;Nouv. durée;VNC révision;Anc. dot./an;Nouv. dot./an;Motif;Par';
  dlFile('revisions_plan_'+TD()+'.csv',hdr+'\n'+rows.join('\n'),'text/csv');
  toast('Export révisions OK');
}

function printRevisions() {
  const rows = [];
  DB.immobilisations.forEach(im => {
    (im.revisions || []).forEach(r => rows.push({im, r}));
  });
  if(!rows.length) { toast("Aucune révision enregistrée", 'e'); return; }
  
  rows.sort((a,b) => b.r.date.localeCompare(a.r.date));
  const e = DB.params.entite || {};
  
  const trs = rows.map(({im,r}) => `<tr>
    <td>${FD(r.date)}</td>
    <td>${escapeHtml(im.code)}</td>
    <td>${escapeHtml(im.designation)}</td>
    <td>${({lin:'Lin',deg:'Dégr'}[r.ancMeth]||r.ancMeth)}/${r.ancDuree}a ➔ ${({lin:'Lin',deg:'Dégr'}[r.newMeth]||r.newMeth)}/${r.newDuree}a</td>
    <td style="text-align:right">${F(r.vncRevision||0)}</td>
    <td style="text-align:right">${F(r.ancDotAnn||0)} ➔ ${F(r.newDotAnn||0)}</td>
    <td>${escapeHtml(r.motif)}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html>
  <html><head><meta charset="utf-8"><title>Historique des Révisions</title>
  <style>
    body{font-family:'Inter',sans-serif;font-size:11px;color:#000;margin:0;padding:20px}
    .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    th,td{border:1px solid #000;padding:4px 6px;text-align:left}
    th{background:#f0f0f0;font-weight:bold}
  </style>
  </head><body>
    <div class="hdr">
      <div>
        <strong>${escapeHtml(e.rs||'ENTREPRISE')}</strong><br>
        ${e.adresse ? escapeHtml(e.adresse)+'<br>':''}
      </div>
      <div style="text-align:right">
        <h2 style="margin:0">HISTORIQUE DES RÉVISIONS DE PLAN</h2>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Code</th><th>Désignation</th><th>Modif. (Méth./Durée)</th><th style="text-align:right">VNC</th><th style="text-align:right">Dot. Annuelle</th><th>Motif</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
  window.open(URL.createObjectURL(new Blob([html],{type:'text/html'})),'_blank');
}

// ══════════════════════════════════════════════════════════
// ── BUDGET PRÉVISIONNEL ──
// ══════════════════════════════════════════════════════════
let _budEditId=null;
function rdBudgetCats(){
  const cats=DB.categories||[];
  ['bud-cat','bud-m-cat'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const prev=el.value;
    const firstOpt=id==='bud-cat'?'<option value="">Toutes les catégories</option>':'<option value="">— Choisir —</option>';
    el.innerHTML=firstOpt+cats.map(c=>`<option value="${escapeHtml(c.libelle)}">${escapeHtml(c.libelle)}</option>`).join('');
    if(cats.find(c=>c.libelle===prev))el.value=prev;
  });
}
function rdBudget(){
  const yrStart=+document.getElementById('bud-yr-start').value||new Date().getFullYear();
  const horizon=+document.getElementById('bud-horizon').value||5;
  const catFlt=document.getElementById('bud-cat').value||'';
  const years=Array.from({length:horizon},(_,i)=>yrStart+i);
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti'&&(!catFlt||i.categorie===catFlt));

  // ── 1. Dotations prévisionnelles parc existant ──
  const dotExist={}; // yr → total
  years.forEach(y=>dotExist[y]=0);
  immos.forEach(im=>{
    const plan=buildPlan(im);
    plan.forEach(r=>{
      const y=r.yrNum||+r.yr;
      if(years.includes(y)) dotExist[y]+=r.dt;
    });
  });

  // ── 2. Acquisitions planifiées ──
  const budLines=(DB.budgetLines||[]).filter(l=>l.statut!=='annule'&&(!catFlt||l.cat===catFlt));
  const dotPlan={}; const budAcqByYr={};
  years.forEach(y=>{dotPlan[y]=0;budAcqByYr[y]=0;});
  budLines.forEach(l=>{
    const yrAcq=+l.yr;
    if(!yrAcq) return;
    budAcqByYr[yrAcq]=(budAcqByYr[yrAcq]||0)+(+l.vo||0);
    // Calculer les dotations de cette ligne sur la période
    const fakeIM={vo:+l.vo||0,vr:0,methode:l.meth||'lin',duree:+l.dur||5,taux:1/(+l.dur||5),dateAcq:`${yrAcq}-01-01`,dateMis:`${yrAcq}-01-01`,cal:360};
    const lplan=buildPlan(fakeIM);
    lplan.forEach(r=>{
      const y=r.yrNum||+r.yr;
      if(years.includes(y)) dotPlan[y]+= r.dt;
    });
  });

  // ── KPIs ──
  const tDotExist=Object.values(dotExist).reduce((a,b)=>a+b,0);
  const tDotPlan=Object.values(dotPlan).reduce((a,b)=>a+b,0);
  const tAcqPlan=Object.values(budAcqByYr).reduce((a,b)=>a+b,0);
  const kpi=document.getElementById('bud-kpi');
  kpi.innerHTML=`
    <div class="kpi"><div class="kpi-l">Total dotations parc</div><div class="kpi-v b">${F(tDotExist)}</div><div class="kpi-s">Projeté sur ${horizon} ans (FCFA)</div></div>
    <div class="kpi"><div class="kpi-l">Dotations acquisitions</div><div class="kpi-v a">${F(tDotPlan)}</div><div class="kpi-s">Issu des achats planifiés</div></div>
    <div class="kpi"><div class="kpi-l">Budget acquisitions</div><div class="kpi-v r">${F(tAcqPlan)}</div><div class="kpi-s">${budLines.length} ligne(s) planifiée(s)</div></div>
    <div class="kpi"><div class="kpi-l">Total dotations globales</div><div class="kpi-v g">${F(tDotExist+tDotPlan)}</div><div class="kpi-s">Parc + acquisitions planifiées</div></div>
  `;

  // ── Tableau ──
  const thead=document.getElementById('bud-thead');
  const tbody=document.getElementById('bud-tbody');
  const tfoot=document.getElementById('bud-tfoot');
  thead.innerHTML='<tr><th>Poste</th>'+years.map(y=>`<th style="text-align:right">${y}</th>`).join('')+'<th style="text-align:right">Total</th></tr>';
  const rowsData=[
    {label:'Dotations parc existant',vals:years.map(y=>dotExist[y]||0),cls:'b'},
    {label:'Dotations acquisitions planifiées',vals:years.map(y=>dotPlan[y]||0),cls:'a'},
    {label:'Budget acquisitions prévues',vals:years.map(y=>budAcqByYr[y]||0),cls:'r'},
  ];
  tbody.innerHTML=rowsData.map(r=>{
    const tot=r.vals.reduce((a,b)=>a+b,0);
    return `<tr><td style="font-weight:500">${r.label}</td>${r.vals.map(v=>`<td style="text-align:right;font-family:var(--m);color:var(--${r.cls})">${F(v)}</td>`).join('')}<td style="text-align:right;font-family:var(--m);font-weight:600">${F(tot)}</td></tr>`;
  }).join('');
  const totals=years.map(y=>(dotExist[y]||0)+(dotPlan[y]||0));
  const grandTotal=totals.reduce((a,b)=>a+b,0);
  tfoot.innerHTML=`<tr style="background:var(--blue-light)"><td style="font-weight:700">TOTAL DOTATIONS</td>${totals.map(v=>`<td style="text-align:right;font-family:var(--m);font-weight:700;color:var(--blue)">${F(v)}</td>`).join('')}<td style="text-align:right;font-family:var(--m);font-weight:700;color:var(--blue)">${F(grandTotal)}</td></tr>`;

  // ── Graphique SVG ──
  renderBudgetChart(years,dotExist,dotPlan);

  // ── Acquisitions planifiées ──
  rdBudgetLines();
}
function renderBudgetChart(years, dotExist, dotPlan){
  const el=document.getElementById('bud-chart');
  const W=Math.max(600,years.length*120);const H=200;const PAD=50;const BAR=Math.min(40,Math.floor((W-PAD*2)/(years.length*2.5)));
  const allVals=[...Object.values(dotExist),...Object.values(dotPlan)];
  const maxV=Math.max(...allVals,1);
  const yScale=v=>(H-PAD-20)*(v/maxV);
  let svg=`<svg viewBox="0 0 ${W} ${H+30}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px">`;
  svg+=`<line x1="${PAD}" y1="20" x2="${PAD}" y2="${H-20}" stroke="var(--border2)" stroke-width="1"/>`;
  svg+=`<line x1="${PAD}" y1="${H-20}" x2="${W-PAD/2}" y2="${H-20}" stroke="var(--border2)" stroke-width="1"/>`;
  years.forEach((y,i)=>{
    const x=PAD+i*(W-PAD*2)/years.length+(W-PAD*2)/years.length/2-BAR;
    const h1=yScale(dotExist[y]||0);const h2=yScale(dotPlan[y]||0);
    svg+=`<rect x="${x}" y="${H-20-h1}" width="${BAR}" height="${h1}" fill="var(--blue)" rx="2" opacity=".8" title="Parc ${y}: ${F(dotExist[y]||0)}"/>`;
    svg+=`<rect x="${x+BAR+2}" y="${H-20-h2}" width="${BAR}" height="${h2}" fill="var(--amber)" rx="2" opacity=".8" title="Planifié ${y}: ${F(dotPlan[y]||0)}"/>`;
    svg+=`<text x="${x+BAR}" y="${H+10}" text-anchor="middle" font-size="11" fill="var(--text3)">${y}</text>`;
    if(dotExist[y]>0) svg+=`<text x="${x+BAR/2}" y="${H-22-h1}" text-anchor="middle" font-size="9" fill="var(--blue-dark)">${Math.round((dotExist[y]||0)/1000000*10)/10}M</text>`;
  });
  // Légende
  svg+=`<rect x="${PAD}" y="4" width="12" height="12" fill="var(--blue)" rx="2"/><text x="${PAD+16}" y="14" font-size="11" fill="var(--text2)">Parc existant</text>`;
  svg+=`<rect x="${PAD+120}" y="4" width="12" height="12" fill="var(--amber)" rx="2"/><text x="${PAD+136}" y="14" font-size="11" fill="var(--text2)">Acquisitions planifiées</text>`;
  svg+='</svg>';
  el.innerHTML=svg;
}
function rdBudgetLines(){
  if(!Array.isArray(DB.budgetLines)) DB.budgetLines=[];
  const tb=document.getElementById('bud-acq-tb');
  if(!DB.budgetLines.length){
    tb.innerHTML='<tr><td colspan="10" style="color:var(--text3);text-align:center;padding:1.5rem">Aucune acquisition planifiée. Cliquez sur « + Ajouter » pour commencer.</td></tr>';
    return;
  }
  tb.innerHTML=DB.budgetLines.map(l=>{
    const dotAnn=Math.round((+l.vo||0)/(+l.dur||5));
    const stBadge={planifie:'<span class="badge a">Planifié</span>',valide:'<span class="badge g">Validé</span>',annule:'<span class="badge r">Annulé</span>'}[l.statut]||'';
    return `<tr>
      <td style="font-family:var(--m);font-weight:600">${l.yr}</td>
      <td>${l.des||'—'}</td>
      <td><span class="badge ${CC(l.cat)}">${l.cat||'—'}</span></td>
      <td style="text-align:right;font-family:var(--m)">${F(+l.vo||0)}</td>
      <td>${{lin:'Linéaire',deg:'Dégressif'}[l.meth]||l.meth}</td>
      <td style="text-align:right">${l.dur||'—'} ans</td>
      <td style="text-align:right;font-family:var(--m);color:var(--blue)">${F(dotAnn)}</td>
      <td style="font-size:12px">${l.fin||'—'}</td>
      <td>${stBadge}</td>
      <td style="text-align:center">
        <button class="btn xs" onclick="openBudgetModal('${l.id}')">Édit.</button>
        <button class="btn xs d" onclick="deleteBudgetLine('${l.id}')">×</button>
      </td>
    </tr>`;
  }).join('');
}
function openBudgetModal(id){
  _budEditId=id||null;
  rdBudgetCats();
  if(id){
    const l=(DB.budgetLines||[]).find(x=>x.id===id);
    if(l){
      document.getElementById('bud-m-yr').value=l.yr||'';
      document.getElementById('bud-m-cat').value=l.cat||'';
      document.getElementById('bud-m-des').value=l.des||'';
      document.getElementById('bud-m-vo').value=l.vo||'';
      document.getElementById('bud-m-dur').value=l.dur||5;
      document.getElementById('bud-m-meth').value=l.meth||'lin';
      document.getElementById('bud-m-fin').value=l.fin||'Fonds propres';
      document.getElementById('bud-m-st').value=l.statut||'planifie';
      document.getElementById('bud-m-obs').value=l.obs||'';
    }
  } else {
    document.getElementById('bud-m-yr').value=new Date().getFullYear()+1;
    document.getElementById('bud-m-cat').value='';
    document.getElementById('bud-m-des').value='';
    document.getElementById('bud-m-vo').value='';
    document.getElementById('bud-m-dur').value=5;
    document.getElementById('bud-m-meth').value='lin';
    document.getElementById('bud-m-fin').value='Fonds propres';
    document.getElementById('bud-m-st').value='planifie';
    document.getElementById('bud-m-obs').value='';
  }
  calcBudgetPreview();
  openM('m-budget');
}
function calcBudgetPreview(){
  const vo=+document.getElementById('bud-m-vo').value||0;
  const dur=+document.getElementById('bud-m-dur').value||5;
  const dotAnn=Math.round(vo/dur);
  const prev=document.getElementById('bud-m-preview');
  if(vo&&dur){
    prev.style.display='block';
    prev.innerHTML=`Dotation estimée : <strong style="font-family:var(--m)">${F(dotAnn)} FCFA/an</strong> pendant <strong>${dur} ans</strong> — Total : <strong style="font-family:var(--m)">${F(dotAnn*dur)} FCFA</strong>`;
  } else {
    prev.style.display='none';
  }
}
function saveBudgetLine(){
  if(!guardWrite())return;
  const yr=+document.getElementById('bud-m-yr').value;
  const des=document.getElementById('bud-m-des').value.trim();
  const vo=+document.getElementById('bud-m-vo').value;
  const cat=document.getElementById('bud-m-cat').value;
  if(!yr||!des||!vo||!cat){toast('Exercice, désignation, catégorie et montant requis','e');return;}
  if(!Array.isArray(DB.budgetLines)) DB.budgetLines=[];
  if(_budEditId){
    const l=DB.budgetLines.find(x=>x.id===_budEditId);
    if(l){Object.assign(l,{yr,des,cat,vo,dur:+document.getElementById('bud-m-dur').value||5,meth:document.getElementById('bud-m-meth').value,fin:document.getElementById('bud-m-fin').value,statut:document.getElementById('bud-m-st').value,obs:document.getElementById('bud-m-obs').value});}
  } else {
    DB.budgetLines.push({id:'bl'+Date.now(),yr,des,cat,vo,dur:+document.getElementById('bud-m-dur').value||5,meth:document.getElementById('bud-m-meth').value,fin:document.getElementById('bud-m-fin').value,statut:document.getElementById('bud-m-st').value,obs:document.getElementById('bud-m-obs').value});
  }
  DB.budgetLines.sort((a,b)=>a.yr-b.yr);
  dbSave();
  closeM('m-budget');
  toast('Ligne budgétaire enregistrée');
  rdBudget();
}
function deleteBudgetLine(id){
  if(!guardDelete())return;
  if(!confirm('Supprimer cette ligne budgétaire ?'))return;
  DB.budgetLines=(DB.budgetLines||[]).filter(x=>x.id!==id);
  dbSave();
  rdBudget();
  toast('Ligne supprimée');
}
function resetBudgetLines(){
  if(!confirm('Effacer toutes les acquisitions planifiées ?'))return;
  DB.budgetLines=[];
  dbSave();
  rdBudget();
  toast('Lignes réinitialisées');
}
function exportBudget(){
  const yrStart=+document.getElementById('bud-yr-start').value||new Date().getFullYear();
  const horizon=+document.getElementById('bud-horizon').value||5;
  const years=Array.from({length:horizon},(_,i)=>yrStart+i);
  const immos=DB.immobilisations.filter(i=>i.statut!=='sorti');
  const dotExist={};
  years.forEach(y=>dotExist[y]=0);
  immos.forEach(im=>{buildPlan(im).forEach(r=>{const y=r.yrNum||+r.yr;if(years.includes(y))dotExist[y]+=r.dt;});});
  const dotPlan={};years.forEach(y=>dotPlan[y]=0);
  (DB.budgetLines||[]).filter(l=>l.statut!=='annule').forEach(l=>{
    const fakeIM={vo:+l.vo||0,vr:0,methode:l.meth||'lin',duree:+l.dur||5,taux:1/(+l.dur||5),dateAcq:`${l.yr}-01-01`,dateMis:`${l.yr}-01-01`,cal:360};
    buildPlan(fakeIM).forEach(r=>{const y=r.yrNum||+r.yr;if(years.includes(y))dotPlan[y]+=r.dt;});
  });
  const lines=['Exercice;Dotations parc;Dotations planifiées;Total'];
  years.forEach(y=>lines.push(`${y};${dotExist[y]||0};${dotPlan[y]||0};${(dotExist[y]||0)+(dotPlan[y]||0)}`));
  dlFile('budget_previsionnel_'+TD()+'.csv',lines.join('\n'),'text/csv');
  toast('Export budget OK');
}

// ── INIT ──
dbLoad();
loadLicense();
loadJournalFromStorage();

// ── DB INTEGRITY — ensure all required arrays/objects exist ──
// ── SELECTS DYNAMIQUES ──
function popLieuSel(){
  const sel=document.getElementById('inv-l-sel');if(!sel)return;
  const lieux=[...new Set(DB.immobilisations.map(i=>i.affectation||'').filter(Boolean))].sort();
  sel.innerHTML='<option value="">Tous les lieux</option>'+lieux.map(l=>`<option value="${l}">${l}</option>`).join('');
}
function popCatSelectors(){
  const cats=DB.categories||[];
  const ids=['flt-cat','inv-c','fc2'];
  ids.forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const prev=el.value;
    const firstOpt=id==='fc2'?'<option value="">Choisir une catégorie...</option>':'<option value="">Toutes les catégories</option>';
    el.innerHTML=firstOpt+cats.map(c=>`<option value="${escapeHtml(c.libelle)}">${escapeHtml(c.libelle)}</option>`).join('');
    if(cats.find(c=>c.libelle===prev))el.value=prev;
  });
  // Alimenter le select plan comptable avec les comptes immo des catégories
  const syscoaEl=document.getElementById('fc-syscoa');
  if(syscoaEl){
    const prev=syscoaEl.value;
    syscoaEl.innerHTML='<option value="">— Sélectionner —</option>'+cats.filter(c=>c.cptImmo).map(c=>`<option value="${c.cptImmo}">${c.cptImmo} — ${escapeHtml(c.libelle)}</option>`).join('');
    if(cats.find(c=>c.cptImmo===prev))syscoaEl.value=prev;
  }
}

(function ensureDB(){
  if(!Array.isArray(DB.immobilisations)) DB.immobilisations=[];
  if(!Array.isArray(DB.sorties)) DB.sorties=[];
  if(!Array.isArray(DB.affectations)) DB.affectations=[];
  if(!Array.isArray(DB.ecritures_log)) DB.ecritures_log=[];
  if(!Array.isArray(DB.inventairesContradictoires)) DB.inventairesContradictoires=[];
  if(!DB.exercicesClos) DB.exercicesClos=[];
  if(!Array.isArray(DB.axes)) DB.axes=[];
  if(!Array.isArray(DB.inventaires)) DB.inventaires=[];
  if(!Array.isArray(DB.budgetLines)) DB.budgetLines=[];
  if(!Array.isArray(DB.categories)||DB.categories.length===0){
    DB.categories=[
      {id:'INFO',libelle:'Matériel informatique',duree:5,methode:'lin',cptImmo:'2414',cptAmort:'2814',cptDot:'6813'},
      {id:'MOB',libelle:'Mobilier de bureau',duree:10,methode:'lin',cptImmo:'2441',cptAmort:'2841',cptDot:'6813'},
      {id:'TRANS',libelle:'Matériel de transport',duree:5,methode:'lin',cptImmo:'2245',cptAmort:'2845',cptDot:'6813'},
      {id:'INCORP',libelle:'Immobilisations incorporelles',duree:3,methode:'lin',cptImmo:'2111',cptAmort:'2801',cptDot:'6811'},
      {id:'AUTRE',libelle:'Autres matériels',duree:5,methode:'lin',cptImmo:'2498',cptAmort:'2898',cptDot:'6813'},
    ];
  }
  if(!Array.isArray(DB.utilisateurs)||DB.utilisateurs.length===0){
    // Compte administrateur par défaut (voir documentation pour le mot de passe initial)
    DB.utilisateurs=[
      {id:1,nom:'Administrateur',email:'admin@org.sn',role:'admin',statut:'actif',connexion:'—',pwdHash:'240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'},
    ];
  }
  // Migration : purger les mots de passe en clair restants dans la DB
  DB.utilisateurs.forEach(u=>{if(u.pwd&&!u.pwdHash)console.warn('User',u.email,'has plain pwd — will hash on next login');});
  if(!DB.params) DB.params={};
  const pd=DB.params;
  if(!pd.codifModel) pd.codifModel='sequential';
  if(!pd.nxt) pd.nxt=1;
  if(!pd.pfx2) pd.pfx2='IMM';
  if(!pd.sep2) pd.sep2='-';
  if(pd.incyr==null) pd.incyr=1;
  if(!pd.lennum) pd.lennum=3;
  if(!pd.sep) pd.sep='.';
  if(!pd.yr) pd.yr='ddmmyy';
  if(!pd.len) pd.len=4;
  if(!pd.entite) pd.entite={rs:'',adresse:'',tel:'',email:'',ninea:'',logo:'',ex:''};
  if(!pd.comptes) pd.comptes={};
  if(!pd.coef1) pd.coef1=1.5;
  if(!pd.coef2) pd.coef2=2.0;
  if(!pd.coef3) pd.coef3=2.5;
  if(!pd.methode) pd.methode='lin';
  if(!pd.cal) pd.cal=360;
  dbSave();
})();
document.getElementById('unom').textContent='Amadou Diallo';
document.getElementById('urole').textContent='Administrateur';
document.getElementById('tbd').textContent=new Date().toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
document.getElementById('btn-f-new').onclick=()=>{if(guardWrite())openNewImmo();};
rdPrmCat();popSortSel();popCatSelectors();popRapFltSelectors();
const _budYrEl=document.getElementById('bud-yr-start');
if(_budYrEl&&!_budYrEl.value)_budYrEl.value=new Date().getFullYear();
const _arreteEl=document.getElementById('rap-arrete');
if(_arreteEl&&!_arreteEl.value) _arreteEl.value=TD();
// Fix 8 — Fermer les modals en cliquant sur l'overlay
document.addEventListener('click',e=>{
  if(e.target.classList.contains('mb')){
    const modal=e.target.querySelector('.modal');
    if(modal&&!modal.contains(e.target)){closeM(e.target.id);}
  }
});
// Fix 4 — Restaurer la session après refresh
const _savedSession=sessionStorage.getItem('immo_user');
if(_savedSession){
  try{
    const _su=JSON.parse(_savedSession);
    const _uDB=DB.utilisateurs.find(u=>u.id===_su.id&&u.statut!=='inactif');
    if(_uDB){
      currentUser=_uDB;
      document.getElementById('app').style.display='flex';
      document.getElementById('login-page').style.display='none';
      document.getElementById('unom').textContent=currentUser.nom;
      const currRoleObj = (DB.roles||[]).find(r=>r.id===currentUser.role);
      document.getElementById('urole').textContent=currRoleObj ? currRoleObj.libelle : currentUser.role;
      document.getElementById('uav').textContent=currentUser.nom.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
      if(DB.params?.entite?.logo)updateSidebarLogo(DB.params.entite.logo);
      applyRoleUI();rdDash();
    } else {document.getElementById('app').style.display='none';document.getElementById('login-page').style.display='flex';}
  }catch(e){document.getElementById('app').style.display='none';document.getElementById('login-page').style.display='flex';}
} else {
  document.getElementById('app').style.display='none';
  document.getElementById('login-page').style.display='flex';
}
// Sauvegarder avant refresh/fermeture
window.addEventListener('beforeunload',()=>{if(currentUser)sessionStorage.setItem('immo_user',JSON.stringify({id:currentUser.id}));});

// ═══════════════════════════════════════════════════════════════
// IMMOGESTION — SÉCURITÉ, LICENCE & SAUVEGARDE
// ═══════════════════════════════════════════════════════════════

// [chiffrement déplacé en haut]

// ── 2. PROTECTION DEVTOOLS & F12 (Désactivée) ──
/* Protection supprimée pour permettre le clic droit et l'inspection */

// ── 3. SYSTÈME DE LICENCE ──
const LIC_SK     = 'immogestion_license';
const DEMO_LIMIT = 10;
const CONTACT    = 'contact@immogestion.sn';

function licHash(str) {
  let h = 0x12AF;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return Math.abs(h).toString(16).toUpperCase().slice(0, 4);
}

function validateKey(key) {
  if (!key || typeof key !== 'string') return null;
  const parts = key.trim().toUpperCase().split('-');
  if (parts.length < 5 || parts[0] !== 'IMMO') return null;
  const hash = parts[parts.length-1];
  const limite = parts[parts.length-2];
  const date   = parts[parts.length-3];
  const client = parts.slice(1, parts.length-3).join('-');
  if (!client || !date || !limite || !hash) return null;
  if (!/^\d{8}$/.test(date) || !/^\d+$/.test(limite)) return null;
  if (licHash('IMMO-' + client + '-' + date + '-' + limite) !== hash)
    return { valid: false, reason: 'Clé invalide ou corrompue' };
  const yr = +date.slice(0,4), mo = +date.slice(4,6)-1, dy = +date.slice(6,8);
  const expiry = new Date(yr, mo, dy, 23, 59, 59);
  if (expiry < new Date())
    return { valid: false, reason: 'Licence expirée le ' + expiry.toLocaleDateString('fr-FR'), expired: true };
  const daysLeft = Math.ceil((expiry - new Date()) / (1000*60*60*24));
  return { valid: true, client, expiry, expiryStr: expiry.toLocaleDateString('fr-FR'),
           limite: +limite === 0 ? Infinity : +limite, daysLeft, key: key.trim().toUpperCase() };
}

function loadLicense() {
  try {
    const raw = localStorage.getItem(LIC_SK);
    if (raw) {
      const dec = xorDecrypt(raw, CIPHER_KEY);
      const key = dec || raw;
      _license = validateKey(key.trim());
      if (_license && _license.valid) return;
    }
  } catch(e) {}
  _license = null;
}

function saveLicense(key) {
  try { localStorage.setItem(LIC_SK, xorEncrypt(key.trim().toUpperCase(), CIPHER_KEY)); } catch(e) {}
}

function isDemo() { return !_license || !_license.valid; }
function getLicenseLimit() { return _license && _license.valid ? _license.limite : DEMO_LIMIT; }

function checkImmoLimit() {
  const limit = getLicenseLimit();
  const count = (DB.immobilisations||[]).filter(i => i.statut !== 'sorti').length;
  return { ok: count < limit, count, limit };
}

function getDemoExpiry(){
  // Expiration démo = 1 mois après première utilisation
  const KEY = 'immogestion_demo_start';
  let start = localStorage.getItem(KEY);
  if(!start){ start = new Date().toISOString(); localStorage.setItem(KEY, start); }
  const d = new Date(start);
  d.setMonth(d.getMonth() + 1);
  return d;
}
function isDemoExpired(){
  if(!isDemo()) return false;
  return new Date() > getDemoExpiry();
}
function updateLicenseBanner() {
  const banner = document.getElementById('license-banner');
  if (!banner) return;
  if (isDemo()) {
    const expiry = getDemoExpiry();
    const daysLeft = Math.max(0, Math.ceil((expiry - new Date()) / (1000*60*60*24)));
    const expiryStr = expiry.toLocaleDateString('fr-FR');
    if(isDemoExpired()){
      banner.style.display = 'flex';
      banner.style.background = '#FEE2E2';
      banner.style.borderColor = '#EF4444';
      banner.style.color = '#991B1B';
      banner.innerHTML = '<span style="flex:1">⚠ <strong>Période démo expirée</strong> — ' +
        '<span style="cursor:pointer;text-decoration:underline;font-weight:700" onclick="openLicenseModal()">Activez votre licence pour continuer</span></span>';
    } else {
      banner.style.display = 'flex';
      banner.style.background = 'var(--amber-light,#FEF3C7)';
      banner.style.borderColor = '#D97706';
      banner.style.color = '#92400E';
      banner.innerHTML = '<span style="flex:1"><strong>Version démo</strong> — ' + daysLeft + ' jour(s) restant(s) (expire le ' + expiryStr + ') — ' +
        '<span style="cursor:pointer;text-decoration:underline" onclick="openLicenseModal()">Activer la licence complète</span></span>';
    }
  } else if (_license && _license.daysLeft <= 30) {
    banner.style.display = 'flex';
    banner.style.color = 'var(--amber)';
    banner.innerHTML = '<span style="flex:1">Licence <strong>' + _license.client + '</strong> expire dans <strong>' +
      _license.daysLeft + ' jour(s)</strong> (' + _license.expiryStr + ') — ' +
      '<span style="cursor:pointer;text-decoration:underline" onclick="openLicenseModal()">Renouveler</span></span>';
  } else {
    banner.style.display = 'none';
  }
}

function openLicenseModal() {
  const m = document.getElementById('m-license');
  if (!m) return;
  const deactBtn = document.getElementById('btn-lic-deact');
  if (deactBtn) deactBtn.style.display = (!isDemo() && _license && _license.valid) ? 'inline-flex' : 'none';
  const info = document.getElementById('lic-info');
  if (info) {
    if (!isDemo() && _license && _license.valid) {
      info.innerHTML = '<div style="background:var(--green-light);border:1px solid var(--green);border-radius:var(--r);padding:.75rem 1rem;margin-bottom:1rem">' +
        '<strong style="color:var(--green)">✓ Licence active</strong><br>' +
        'Client : <strong>' + _license.client + '</strong><br>' +
        'Expire le : <strong>' + _license.expiryStr + '</strong> (dans ' + _license.daysLeft + ' jours)<br>' +
        'Limite : <strong>' + (_license.limite === Infinity ? 'Illimitée' : _license.limite + ' immobilisations') + '</strong></div>';
    } else if (_license && _license.expired) {
      info.innerHTML = '<div style="background:var(--red-light);border:1px solid var(--red);border-radius:var(--r);padding:.75rem 1rem;margin-bottom:1rem">' +
        '<strong style="color:var(--red)">Licence expirée</strong> — ' + (_license.reason||'') + '<br>' +
        'Contactez <strong>' + CONTACT + '</strong> pour renouveler.</div>';
    } else {
      const demoExp = getDemoExpiry();
      const demoDays = Math.max(0, Math.ceil((demoExp - new Date()) / (1000*60*60*24)));
      const demoExpStr = demoExp.toLocaleDateString('fr-FR');
      info.innerHTML = '<div style="background:var(--amber-light,#FEF3C7);border:1px solid #D97706;border-radius:var(--r);padding:.75rem 1rem;margin-bottom:1rem">' +
        '<strong>Version démo</strong> — expire le <strong>' + demoExpStr + '</strong> (' + demoDays + ' jour(s))<br>' +
        'Fonctionnalités complètes disponibles.<br>' +
        'Contactez <strong>' + CONTACT + '</strong> pour obtenir une licence.</div>';
    }
  }
  const inp = document.getElementById('lic-key-input');
  if (inp) inp.value = '';
  const err = document.getElementById('lic-err');
  if (err) err.style.display = 'none';
  openM('m-license');
}

function activateLicense() {
  const key = (document.getElementById('lic-key-input')?.value||'').trim();
  const err = document.getElementById('lic-err');
  if (!key) { if(err){err.textContent='Saisissez une clé.';err.style.display='block';} return; }
  const r = validateKey(key);
  if (!r || !r.valid) { if(err){err.textContent=(r&&r.reason)||'Clé invalide.';err.style.display='block';} return; }
  _license = r; saveLicense(key);
  closeM('m-license'); updateLicenseBanner(); if(typeof rdDash==='function')rdDash();
  toast('Licence activée — ' + r.client + ' — expire le ' + r.expiryStr);
}

function deactivateLicense() {
  if (!confirm('Désactiver la licence et revenir en mode démo ?')) return;
  localStorage.removeItem(LIC_SK); _license = null;
  updateLicenseBanner(); if(typeof rdDash==='function')rdDash();
  closeM('m-license'); toast('Licence désactivée — mode démo actif', 'i');
}

function generateKey(client, expiryDate, limite) {
  const payload = 'IMMO-' + client.toUpperCase() + '-' + expiryDate + '-' + limite;
  return payload + '-' + licHash(payload);
}

function genLicKey() {
  const client = (document.getElementById('gen-client')?.value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  const date   = (document.getElementById('gen-date')?.value||'').replace(/-/g,'');
  const limit  = document.getElementById('gen-limit')?.value||'0';
  if (!client || !/^\d{8}$/.test(date)) { toast('Client et date requis','e'); return; }
  const key = generateKey(client, date, limit);
  const el = document.getElementById('gen-result');
  if (el) el.value = key;
  toast('Clé générée !');
}

// ── 4. SAUVEGARDE & RESTAURATION ──
function backupData() {
  const json = JSON.stringify({ version: 'v5', date: new Date().toISOString(), db: DB }, null, 2);
  const date = new Date().toLocaleDateString('fr-FR').replace(/\//g,'-');
  dlFile('ImmoGestion_backup_' + date + '.json', json, 'application/json;charset=utf-8');
  localStorage.setItem('immogestion_last_backup', new Date().toISOString());
  updateBackupStatus();
  toast('Sauvegarde téléchargée — conservez ce fichier !');
}

function restoreData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        let payload = JSON.parse(ev.target.result);
        // Accepter format v5 {version, db} ET format direct {immobilisations, ...}
        let saved;
        if (payload && payload.db) {
          saved = payload.db;  // format backup {version, db} ou {db}
        } else if (payload && (payload.immobilisations !== undefined || payload.categories !== undefined)) {
          saved = payload;      // format DB direct
        } else {
          toast('Fichier invalide — vérifiez le format','e'); return;
        }
        if (!confirm('Restaurer depuis "' + file.name + '" ?\n\nRemplace TOUTES les données actuelles.')) return;
        const def = DB.params;
        Object.assign(DB, saved);
        DB.params = Object.assign({}, def, saved.params||{});
        if (saved.params?.entite) DB.params.entite = Object.assign({rs:'',adresse:'',tel:'',email:'',ninea:'',logo:'',ex:''}, saved.params.entite);
        dbSave();
        if(typeof rdDash==='function')rdDash();
        if(typeof rdFiches==='function')rdFiches();
        logAction('RESTORE','Sauvegarde','Restauration depuis fichier JSON');
        toast('Données restaurées — ' + (DB.immobilisations||[]).length + ' immobilisations récupérées');
      } catch(err) { toast('Erreur : ' + err.message, 'e'); }
    };
    reader.readAsText(file, 'UTF-8');
  };
  input.click();
}

function updateBackupStatus() {
  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = localStorage.getItem('immogestion_last_backup');
  if (last) {
    const diff = Math.floor((Date.now() - new Date(last).getTime()) / (1000*60*60*24));
    el.textContent = diff === 0 ? 'Sauvegarde : aujourd\'hui' : diff <= 7 ? 'Sauvegarde : il y a ' + diff + ' j' : '⚠ Sauvegarde : il y a ' + diff + ' jours !';
    el.style.color = diff <= 7 ? 'var(--green)' : 'var(--red)';
  } else {
    el.textContent = '⚠ Aucune sauvegarde'; el.style.color = 'var(--red)';
  }
}

function checkBackupAlert() {
  const nb = (DB.immobilisations||[]).length;
  const last = localStorage.getItem('immogestion_last_backup');
  if (!last && nb > 0) { setTimeout(()=>toast('💾 Rappel : sauvegardez vos données (' + nb + ' immos)','i'), 3000); return; }
  if (last) { const diff = Math.floor((Date.now()-new Date(last).getTime())/(1000*60*60*24)); if(diff>=7) setTimeout(()=>toast('⚠ Sauvegarde non effectuée depuis '+diff+' jours','i'),3000); }
}

// ── 5. SESSION TIMEOUT ──
const SESSION_TIMEOUT = 30 * 60 * 1000;

function resetSessionTimer() {
  if (!currentUser) return;
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    if (currentUser) { toast('Session expirée — reconnectez-vous','i'); setTimeout(doLogout, 2000); }
  }, SESSION_TIMEOUT);
}

function initSessionWatcher() {
  ['mousemove','keydown','click','scroll','touchstart'].forEach(evt =>
    document.addEventListener(evt, resetSessionTimer, { passive: true })
  );
  resetSessionTimer();
}

function updateSessionTimeout() {
  const sel = document.getElementById('sec-timeout');
  if (!sel) return;
  const mins = +sel.value;
  if (mins === 0) { clearTimeout(_sessionTimer); toast('Déconnexion auto désactivée'); }
  else { resetSessionTimer(); toast('Délai : ' + mins + ' min'); }
}



// ═══════════════════════════════════════════════════════
// JOURNAL D'AUDIT — Tracking complet des actions
// ═══════════════════════════════════════════════════════

const JOURNAL_SK = 'immogestion_journal';

function loadJournalFromStorage(){
  try{
    const raw = localStorage.getItem(JOURNAL_SK);
    if(raw){ DB.journal = JSON.parse(raw); }
    else DB.journal = [];
  }catch(e){ DB.journal = []; }
}

function saveJournalToStorage(){
  try{
    if(!DB.journal)DB.journal=[];
    localStorage.setItem(JOURNAL_SK, JSON.stringify(DB.journal));
  }catch(e){console.warn('Erreur sauvegarde journal', e); toast('Erreur sauvegarde journal', 'e');}
}

function logAction(action,entity,detail,meta){
  if(!DB.journal) loadJournalFromStorage();
  const entry = {
    id: UID(),
    ts: new Date().toISOString(),
    user: currentUser ? currentUser.nom : 'Système',
    role: currentUser ? currentUser.role : '—',
    action, entity, detail,
    meta: meta || null
  };
  DB.journal.unshift(entry);
  if(DB.journal.length > 1000) DB.journal = DB.journal.slice(0,1000);
  saveJournalToStorage();
}

function logImmo(action,im,before){
  const detail=(im.code||'—')+' — '+(im.designation||'—');
  const meta=action==='UPDATE'&&before?{avant:{designation:before.designation,vo:before.vo,taux:before.taux,categorie:before.categorie,affectation:before.affectation},apres:{designation:im.designation,vo:im.vo,taux:im.taux,categorie:im.categorie,affectation:im.affectation}}:null;
  logAction(action,'Immobilisation',detail,meta);
}

function rdJournal(){
  loadJournalFromStorage();
  const journal=DB.journal||[];
  const el=document.getElementById('journal-tb');
  const countEl=document.getElementById('journal-count');
  if(countEl)countEl.textContent=journal.length+' entrée(s)';
  const fAction=(document.getElementById('jf-action')||{}).value||'';
  const fUser=((document.getElementById('jf-user')||{}).value||'').toLowerCase();
  const fDate=(document.getElementById('jf-date')||{}).value||'';
  const filtered=journal.filter(e=>{
    if(fAction&&e.action!==fAction)return false;
    if(fUser&&!(e.user||'').toLowerCase().includes(fUser))return false;
    if(fDate&&!e.ts.startsWith(fDate))return false;
    return true;
  });
  if(!el)return;
  const AC={CREATE:{bg:'#DCFCE7',color:'#166534',label:'Création'},UPDATE:{bg:'#DBEAFE',color:'#1E40AF',label:'Modification'},DELETE:{bg:'#FEE2E2',color:'#991B1B',label:'Suppression'},LOGIN:{bg:'#F0FDF4',color:'#166534',label:'Connexion'},LOGOUT:{bg:'#F1F5F9',color:'#475569',label:'Déconnexion'},EXPORT:{bg:'#FEF3C7',color:'#92400E',label:'Export'},PRINT:{bg:'#F3E8FF',color:'#5B21B6',label:'Impression'},IMPORT:{bg:'#DBEAFE',color:'#1E40AF',label:'Import'},RESTORE:{bg:'#FEF3C7',color:'#92400E',label:'Restauration'}};
  if(!filtered.length){el.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:3rem">Aucune entrée dans le journal</td></tr>';return;}
  const rows = filtered.slice(0,300).map(function(e){
    const ac = AC[e.action] || {bg:'#F1F5F9', color:'#475569', label:e.action};
    const d  = new Date(e.ts);
    const ds = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const mb = e.meta ? '<button class="btn xs" onclick="showJournalMeta(\'' + e.id + '\')" style="font-size:10px;padding:2px 6px">Détail</button>' : '';
    return '<tr>' +
      '<td style="font-size:11px;color:var(--text3);white-space:nowrap">' + ds + '</td>' +
      '<td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:' + ac.bg + ';color:' + ac.color + '">' + ac.label + '</span></td>' +
      '<td style="font-size:12px;color:var(--text3)">' + (e.entity||'—') + '</td>' +
      '<td style="font-size:12px;font-weight:500">' + (e.detail||'—') + '</td>' +
      '<td style="font-size:12px"><strong>' + (e.user||'—') + '</strong><br><span style="font-size:10px;color:var(--text3)">' + (e.role||'') + '</span></td>' +
      '<td>' + mb + '</td>' +
    '</tr>';
  });
  el.innerHTML = rows.join('');
}

function showJournalMeta(id){
  const e=(DB.journal||[]).find(x=>x.id===id);
  if(!e||!e.meta)return;
  const msg=e.meta.avant?'AVANT:\n'+JSON.stringify(e.meta.avant,null,2)+'\n\nAPRÈS:\n'+JSON.stringify(e.meta.apres,null,2):JSON.stringify(e.meta,null,2);
  alert(msg);
}

function clearJournal(){
  if(!confirm('Effacer tout le journal ? Action irréversible.'))return;
  DB.journal=[];dbSave();rdJournal();toast('Journal effacé');
}

function exportJournal(){
  const j=DB.journal||[];const NL='\n';const e=DB.params.entite||{};
  let csv='\uFEFF';if(e.rs)csv+=e.rs+NL;
  csv+='Journal audit — '+new Date().toLocaleDateString('fr-FR')+NL+NL;
  csv+='Date;Heure;Action;Entité;Détail;Utilisateur;Rôle'+NL;
  j.forEach(e=>{const d=new Date(e.ts);csv+=d.toLocaleDateString('fr-FR')+';'+d.toLocaleTimeString('fr-FR')+';'+(e.action||'')+';'+(e.entity||'')+';'+(e.detail||'').replace(/;/g,',')+';'+(e.user||'')+';'+(e.role||'')+NL;});
  dlFile('journal_audit_'+new Date().toLocaleDateString('fr-FR').replace(/\//g,'-')+'.csv',csv,'text/csv;charset=utf-8');
  logAction('EXPORT','Journal','Export CSV du journal');
  toast('Journal exporté');
}


// ── CHANGEMENT MOT DE PASSE ──
function openChangePwd(){
  document.getElementById('pwd-current').value='';
  document.getElementById('pwd-new').value='';
  document.getElementById('pwd-confirm').value='';
  document.getElementById('pwd-err').style.display='none';
  openM('m-chgpwd');
}

function doChangePassword(){
  const current = document.getElementById('pwd-current').value;
  const newPwd  = document.getElementById('pwd-new').value;
  const confirm = document.getElementById('pwd-confirm').value;
  const errEl   = document.getElementById('pwd-err');
  const showErr = (msg) => { errEl.textContent=msg; errEl.style.display='block'; };

  if(!current || !newPwd || !confirm){ showErr('Tous les champs sont obligatoires.'); return; }
  if(!currentUser){ showErr('Aucun utilisateur connecté.'); return; }

  const user = DB.utilisateurs.find(u => u.id === currentUser.id);
  if(!user){ showErr('Utilisateur introuvable.'); return; }
  if(user.pwd !== current){ showErr('Mot de passe actuel incorrect.'); return; }
  if(newPwd.length < 6){ showErr('Le nouveau mot de passe doit contenir au moins 6 caractères.'); return; }
  if(newPwd !== confirm){ showErr('Les mots de passe ne correspondent pas.'); return; }

  user.pwd = newPwd;
  dbSave();
  logAction('UPDATE','Utilisateur','Changement de mot de passe — '+currentUser.nom);
  closeM('m-chgpwd');
  toast('Mot de passe changé avec succès ✓');
}

// ── GÉNÉRATION MOT DE PASSE ALÉATOIRE ──
function genPassword(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let pwd = '';
  for(let i=0;i<10;i++) pwd += chars[Math.floor(Math.random()*chars.length)];
  const el = document.getElementById('up');
  if(el){ el.value=pwd; el.type='text'; setTimeout(()=>el.type='password',3000); }
  // Copier dans presse-papier
  navigator.clipboard.writeText(pwd).then(()=>toast('Mot de passe généré et copié : '+pwd))
    .catch(()=>toast('Mot de passe généré : '+pwd));
}


// ── IMPRESSION SORTIE D'ACTIF ──
function printSortie(sid){
  let immoId, type, date, motif, obs, prix;
  let im;
  let s = typeof sid==='string' ? DB.sorties.find(x=>x.id===sid) : null;
  if(s){
    immoId = s.immoId;
    im = DB.immobilisations.find(x=>x.id===immoId) || {code:s.code, designation:s.designation, categorie:'—', dateAcq:s.date, vo:s.vo};
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
  }
  const e = DB.params.entite || {};

  const cum = im ? cumAt(im, date) : 0;
  const vnc = im ? Math.max(0, im.vo - cum) : 0;
  const dot = im ? dotPeriod(im, new Date(date).getFullYear(), new Date(date).getFullYear()) : 0;

  const win = window.open('','_blank');
  if(!win){ toast('Autorisez les popups','e'); return; }
  win.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<title>Sortie d\'actif</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Arial,sans-serif;font-size:11px;padding:15mm 12mm;color:#111}' +
    '.header{display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid #1A5FB4;margin-bottom:14px}' +
    '.org{font-size:14px;font-weight:700;color:#1A5FB4}' +
    '.title{font-size:16px;font-weight:700;text-align:center;padding:8px;background:#EBF4FF;border-radius:6px;color:#1A5FB4;margin-bottom:14px}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;border:1px solid #ddd;border-radius:6px;overflow:hidden;margin-bottom:12px}' +
    '.field{padding:7px 10px;background:#F8FAFF;border-bottom:1px solid #EEF2FF}' +
    '.field label{display:block;font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}' +
    '.field value{font-size:12px;font-weight:600}' +
    '.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}' +
    '.kpi{text-align:center;padding:8px;border-radius:6px;border:1px solid #ddd}' +
    '.kpi label{font-size:9px;color:#888;text-transform:uppercase;display:block}' +
    '.kpi value{font-size:13px;font-weight:700;display:block;margin-top:3px}' +
    '.obs{background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:10px;margin-bottom:12px}' +
    '.sig{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:2rem}' +
    '.sig-box{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:10px;color:#666}' +
    '.footer{margin-top:16px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:8px}' +
    '@media print{body{padding:8mm}}' +
    '</style></head><body>' +
    '<div class="header">' +
      '<div>' + (e.rs?'<div class="org">'+e.rs+'</div>':'') + (e.adresse?'<div>'+e.adresse+'</div>':'') + (e.ninea?'<div>NINEA : '+e.ninea+'</div>':'') + '</div>' +
      '<div style="text-align:right;font-size:10px;color:#666">Date d\'édition : '+new Date().toLocaleDateString('fr-FR')+'</div>' +
    '</div>' +
    '<div class="title">PROCÈS-VERBAL DE SORTIE D\'ACTIF</div>' +
    '<div class="grid">' +
      (im?'<div class="field"><label>Code immobilisation</label><value style="color:#1A5FB4;font-family:monospace">'+im.code+'</value></div>':'') +
      (im?'<div class="field"><label>Désignation</label><value>'+im.designation+'</value></div>':'') +
      '<div class="field"><label>Type de sortie</label><value>'+type+'</value></div>' +
      '<div class="field"><label>Date de sortie</label><value>'+new Date(date).toLocaleDateString('fr-FR')+'</value></div>' +
      (im?'<div class="field"><label>Catégorie</label><value>'+im.categorie+'</value></div>':'') +
      (im?'<div class="field"><label>Date d\'acquisition</label><value>'+new Date(im.dateAcq).toLocaleDateString('fr-FR')+'</value></div>':'') +
    '</div>' +
    '<div class="kpis">' +
      '<div class="kpi"><label>Valeur d\'origine</label><value style="color:#1A5FB4">'+(im?F(im.vo)+' F':'—')+'</value></div>' +
      '<div class="kpi"><label>Cumul amortissements</label><value style="color:#EF4444">'+F(cum)+' F</value></div>' +
      '<div class="kpi"><label>VNC à la date de sortie</label><value style="color:'+(vnc>0?'#16A34A':'#EF4444')+'">'+F(vnc)+' F</value></div>' +
    '</div>' +
    (motif?'<div class="obs"><strong>Motif :</strong> '+motif+'</div>':'') +
    (obs?'<div class="obs"><strong>Observations :</strong> '+obs+'</div>':'') +
    '<div class="sig">' +
      '<div class="sig-box">Établi par<br><br><br></div>' +
      '<div class="sig-box">Validé par<br><br><br></div>' +
    '</div>' +
    '<div class="footer">Document généré par ImmoGestion v5 — '+new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})+'</div>' +
    '<script>setTimeout(()=>{window.print();},300);<\/script>' +
    '</body></html>');
  win.document.close();
  logAction('PRINT','Sortie actif', im ? im.code+' — '+im.designation : 'PV sortie');
}


// ═══════════════════════════════════════════════════════════
// GESTION PAR LOTS — Quantité & amortissement individuel
// ═══════════════════════════════════════════════════════════

function calcVO(){
  const pu  = parseFloat(document.getElementById('fc-prix-unit')?.value) || 0;
  const qty = parseInt(document.getElementById('fc-qty')?.value) || 1;
  const vo  = document.getElementById('fc7');
  const lotMode = document.getElementById('fgr-lot-mode');
  // Calculer la valeur totale
  if(vo){ vo.value = qty > 0 ? Math.round(pu * qty) : ''; onVOCh(); }
  // Afficher le sélecteur de mode uniquement si qty > 1
  if(lotMode) lotMode.style.display = qty > 1 ? '' : 'none';
}

function toggleLotMode(){
  // Mise à jour visuelle si besoin
  const mode = document.getElementById('fc-lot-mode')?.value;
  const qty  = parseInt(document.getElementById('fc-qty')?.value) || 1;
  if(mode === 'individuel' && qty > 1){
    toast('Mode individuel : ' + qty + ' fiches seront créées automatiquement', 'i');
  }
}

function saveLot(baseImmo, qty, mode, codeBase){
  // Crée les immobilisations selon le mode choisi
  const created = [];
  if(mode === 'groupe' || qty <= 1){
    // Fiche unique : valeur totale
    const nim = Object.assign({}, baseImmo, {id: UID()});
    DB.immobilisations.push(nim);
    logImmo('CREATE', nim, null);
    created.push(nim);
  } else {
    // Éclater : une fiche par unité avec valeur unitaire
    const voUnit = Math.round(baseImmo.vo / qty);
    for(let i = 1; i <= qty; i++){
      const suffix = String(i).padStart(2, '0');
      const nim = Object.assign({}, baseImmo, {
        id: UID(),
        code: codeBase + '-' + suffix,
        designation: baseImmo.designation + ' N°' + i,
        vo: voUnit,
      });
      DB.immobilisations.push(nim);
      logImmo('CREATE', nim, null);
      created.push(nim);
    }
    toast(qty + ' fiches individuelles créées (codes : ' + codeBase + '-01 à ' + codeBase + '-' + String(qty).padStart(2,'0') + ')');
  }
  return created;
}

