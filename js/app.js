
const { PDFDocument, rgb, StandardFonts } = PDFLib;

let S = {
  pdfBytes:null, pdfDoc:null, page:1, total:1, scale:1.5,
  fields:[], sel:null, history:[],
};
let counter = { text:0, checkbox:0, select:0, date:0, signature:0 };
let clipboardField = null;
let pasteOffset = 0;

document.addEventListener('DOMContentLoaded', () => {
  // pdf.js est chargé en defer : on positionne le worker ici, une fois la lib réellement prête.
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.__WORKER__;

  // Avertir avant de quitter la page si des champs ont été placés sans export
  window.addEventListener('beforeunload', e => {
    if (S.fields.length) { e.preventDefault(); e.returnValue = ''; }
  });

  const fi = document.getElementById('file-input');
  document.getElementById('btn-open').onclick = () => fi.click();
  document.getElementById('drop').onclick = () => fi.click();
  fi.onchange = e => { if (e.target.files[0]) loadPdf(e.target.files[0]); };

  const drop = document.getElementById('drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag-over'); };
  drop.ondragleave = () => drop.classList.remove('drag-over');
  drop.ondrop = e => {
    e.preventDefault(); drop.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith('.pdf')) loadPdf(f);
    else notify('Dépose un fichier .pdf', 'error');
  };

  document.querySelectorAll('.add-field').forEach(b => b.onclick = () => addField(b.dataset.type));
  document.getElementById('btn-export').onclick = exportPdf;
  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-del').onclick = () => { if (S.sel) delField(S.sel); };
  document.getElementById('btn-copy').onclick = copyField;
  document.getElementById('btn-paste').onclick = pasteField;
  document.getElementById('btn-prev').onclick = () => { if (S.page>1){S.page--; renderPage();} };
  document.getElementById('btn-next').onclick = () => { if (S.page<S.total){S.page++; renderPage();} };
  document.getElementById('add-opt').onclick = () => {
    const f = cur(); if(!f) return;
    f.options.push('Option '+(f.options.length+1)); renderProps();
  };

  // Propriétés live
  ['p-name','p-ph','p-x','p-y','p-req'].forEach(id => {
    document.getElementById(id).oninput = syncProps;
  });
  document.getElementById('p-w').oninput = e => {
    const f = cur(); if(!f) return;
    f.w = +e.target.value; document.getElementById('v-w').textContent = f.w;
    renderFields();
  };
  document.getElementById('p-h').oninput = e => {
    const f = cur(); if(!f) return;
    f.h = +e.target.value; document.getElementById('v-h').textContent = f.h;
    renderFields();
  };
  document.getElementById('p-fs').oninput = e => {
    const f = cur(); if(!f) return;
    f.fontSize = +e.target.value; document.getElementById('v-fs').textContent = f.fontSize;
    renderFields();
  };

  document.getElementById('canvas-area').addEventListener('mousedown', e => {
    if (e.target.id === 'canvas-area' || e.target.id === 'page-wrap' || e.target.id === 'pdf-canvas' || e.target.id === 'overlay') deselect();
  });

  // Raccourcis clavier copier / coller / dupliquer
  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !typing) { e.preventDefault(); copyField(); }
    else if (k === 'v' && !typing) { e.preventDefault(); pasteField(); }
    else if (k === 'd' && !typing) { e.preventDefault(); copyField(); pasteField(); }
  });
});

function cur() { return S.fields.find(f => f.id === S.sel); }

function esc(s) {
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── LOAD PDF ──────────────────────────────────────────────────────────────
async function loadPdf(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50 Mo
  if (file.size > MAX_SIZE) {
    notify('Fichier trop volumineux (max 50 Mo).','error');
    return;
  }
  loading('Lecture du PDF...');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = window.__WORKER__;
    const buf = await file.arrayBuffer();
    S.pdfBytes = new Uint8Array(buf);
    S.pdfDoc = await pdfjsLib.getDocument({ data: S.pdfBytes.slice() }).promise;
    S.total = S.pdfDoc.numPages;
    S.page = 1; S.fields = []; S.sel = null; S.history = [];
    counter = { text:0, checkbox:0, select:0, date:0, signature:0 };
    clipboardField = null; pasteOffset = 0;
    document.getElementById('btn-paste').disabled = true;

    document.getElementById('empty').style.display = 'none';
    document.getElementById('page-wrap').style.display = '';
    document.getElementById('page-nav').style.display = S.total > 1 ? '' : 'none';
    document.querySelectorAll('.add-field').forEach(b => b.disabled = false);
    document.getElementById('btn-export').disabled = false;

    // Si le PDF chargé contient déjà des champs de formulaire (ex : un PDF déjà
    // exporté par cet outil), on les relit pour pouvoir continuer à les éditer.
    // Limite connue : les zones "Signature" ne sont pas de vrais champs PDF
    // (juste un rectangle dessiné), donc elles ne peuvent pas être détectées.
    let nbDetectes = 0;
    try {
      const formDoc = await PDFDocument.load(S.pdfBytes.slice());
      nbDetectes = importExistingFields(formDoc);
    } catch(e) { console.warn('Lecture des champs existants impossible :', e.message); }

    await renderPage();
    await buildThumbs();
    renderProps();
    const msgChamps = nbDetectes ? ' — '+nbDetectes+' champ'+(nbDetectes>1?'s':'')+' existant'+(nbDetectes>1?'s':'')+' retrouvé'+(nbDetectes>1?'s':'') : '';
    notify('PDF chargé ('+S.total+' page'+(S.total>1?'s':'')+')'+msgChamps+' ✓','success');
  } catch(e) {
    console.error(e);
    notify('Le PDF n\'a pas pu être ouvert. Vérifiez que le fichier n\'est pas corrompu.','error');
  }
  done();
}

// ── RELECTURE DES CHAMPS EXISTANTS ───────────────────────────────────────────
// Reconstruit S.fields à partir de l'AcroForm d'un PDF déjà exporté par cet
// outil (ou par un autre outil compatible), pour permettre de les ré-éditer.
function importExistingFields(doc) {
  let form, fields;
  try { form = doc.getForm(); fields = form.getFields(); } catch(e) { return 0; }
  if (!fields.length) return 0;

  const pages = doc.getPages();
  const pageHeights = pages.map(p => p.getSize().height);

  function widgetPageIndex(widget) {
    try {
      const pRef = widget.dict.get(PDFLib.PDFName.of('P'));
      if (pRef) {
        const i = pages.findIndex(p => p.ref && p.ref.toString() === pRef.toString());
        if (i !== -1) return i;
      }
    } catch(e) {}
    return 0; // repli : première page si on ne sait pas la retrouver
  }

  function parseFontSize(field) {
    try {
      const da = field.acroField.dict.get(PDFLib.PDFName.of('DA'));
      const str = da && da.asString ? da.asString() : '';
      const m = str.match(/\/[^\s]+\s+([\d.]+)\s+Tf/);
      if (m) { const n = parseFloat(m[1]); if (n > 0) return n; }
    } catch(e) {}
    return 10; // valeur de repli (ex : champ en taille auto à l'export, fontSize=0)
  }

  // 1) Regrouper les sous-champs date (base_jj / base_mm / base_aaaa) en un seul champ
  const dateGroups = {};
  const handled = new Set();
  fields.forEach(f => {
    const m = f.getName().match(/^(.+)_(jj|mm|aaaa)$/);
    if (m && f instanceof PDFLib.PDFTextField) {
      dateGroups[m[1]] = dateGroups[m[1]] || {};
      dateGroups[m[1]][m[2]] = f;
    }
  });

  const usedCounters = { text:0, checkbox:0, select:0, date:0, signature:0 };
  function bumpCounter(type, name) {
    const m = name.match(/_(\d+)$/);
    if (m) usedCounters[type] = Math.max(usedCounters[type], parseInt(m[1], 10));
  }

  let imported = 0;

  Object.keys(dateGroups).forEach(base => {
    const g = dateGroups[base];
    if (!g.jj || !g.mm || !g.aaaa) return; // groupe incomplet : ignoré
    handled.add(g.jj.getName()); handled.add(g.mm.getName()); handled.add(g.aaaa.getName());
    const wJ = g.jj.acroField.getWidgets()[0];
    const wA = g.aaaa.acroField.getWidgets()[0];
    if (!wJ || !wA) return;
    const rJ = wJ.getRectangle(), rA = wA.getRectangle();
    const pageIndex = widgetPageIndex(wJ);
    const pgH = pageHeights[pageIndex] || 841.89;
    const pdfX = rJ.x, pdfY = rJ.y, pdfW = (rA.x + rA.width) - rJ.x, pdfH = rJ.height;

    let dateValue = '';
    try {
      const vj=(g.jj.getText()||'').trim(), vm=(g.mm.getText()||'').trim(), va=(g.aaaa.getText()||'').trim();
      if (/^\d{1,2}$/.test(vj) && /^\d{1,2}$/.test(vm) && /^\d{4}$/.test(va)) {
        dateValue = vj.padStart(2,'0')+'/'+vm.padStart(2,'0')+'/'+va;
      }
    } catch(e) {}

    bumpCounter('date', base);
    S.fields.push({
      id: 'f'+Date.now()+Math.floor(Math.random()*100000), type:'date',
      name: base, placeholder:'jj/mm/aaaa',
      x: Math.round(pdfX * S.scale),
      y: Math.round((pgH - pdfY - pdfH) * S.scale),
      w: Math.round(pdfW * S.scale),
      h: Math.round(pdfH * S.scale),
      required: g.jj.isRequired ? g.jj.isRequired() : false,
      fontSize: parseFontSize(g.jj), options: [], page: pageIndex+1,
      _dateValue: dateValue,
    });
    imported++;
  });

  // 2) Champs simples (texte, case à cocher, liste déroulante)
  fields.forEach(f => {
    const name = f.getName();
    if (handled.has(name)) return;
    const widget = f.acroField.getWidgets()[0];
    if (!widget) return;
    const rect = widget.getRectangle();
    const pageIndex = widgetPageIndex(widget);
    const pgH = pageHeights[pageIndex] || 841.89;

    let type = null, options = [];
    if (f instanceof PDFLib.PDFTextField) type = 'text';
    else if (f instanceof PDFLib.PDFCheckBox) type = 'checkbox';
    else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) {
      type = 'select';
      try { options = f.getOptions() || []; } catch(e) {}
    }
    if (!type) return; // type non pris en charge par l'éditeur (ex : bouton) : ignoré

    bumpCounter(type, name);
    let required = false;
    try { required = f.isRequired(); } catch(e) {}

    S.fields.push({
      id: 'f'+Date.now()+Math.floor(Math.random()*100000), type, name,
      placeholder: '',
      x: Math.round(rect.x * S.scale),
      y: Math.round((pgH - rect.y - rect.height) * S.scale),
      w: Math.round(rect.width * S.scale),
      h: Math.round(rect.height * S.scale),
      required,
      fontSize: type==='checkbox' ? 10 : parseFontSize(f),
      options: options.length ? options : (type==='select' ? ['Option 1','Option 2'] : []),
      page: pageIndex+1,
    });
    imported++;
  });

  Object.keys(usedCounters).forEach(t => { counter[t] = Math.max(counter[t]||0, usedCounters[t]); });
  return imported;
}


async function renderPage() {
  const page = await S.pdfDoc.getPage(S.page);
  const vp = page.getViewport({ scale: S.scale });
  const c = document.getElementById('pdf-canvas');
  c.width = vp.width; c.height = vp.height;
  const ov = document.getElementById('overlay');
  ov.style.width = vp.width+'px'; ov.style.height = vp.height+'px';
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  document.getElementById('page-counter').textContent = 'Page '+S.page+' / '+S.total;
  document.querySelectorAll('.thumb').forEach((t,i) => t.classList.toggle('active', i+1===S.page));
  renderFields();
}

async function buildThumbs() {
  const cont = document.getElementById('thumbs');
  cont.innerHTML = '';
  for (let i=1;i<=S.total;i++) {
    const page = await S.pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 0.18 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext:c.getContext('2d'), viewport:vp }).promise;
    const w = document.createElement('div');
    w.className = 'thumb'+(i===1?' active':'');
    w.appendChild(c);
    w.onclick = () => { S.page=i; renderPage(); };
    cont.appendChild(w);
  }
}

// ── FIELDS ──────────────────────────────────────────────────────────────────
function addField(type) {
  counter[type]++;
  const names = { text:'texte', checkbox:'case', select:'liste', date:'date', signature:'signature' };
  // Tailles par défaut en pixels canvas (scale 1.5)
  const defs = {
    text:     { w:180, h:22 },
    checkbox: { w:18,  h:18 },
    select:   { w:160, h:24 },
    date:     { w:120, h:22 },
    signature:{ w:220, h:95 },
  };
  const d = defs[type];
  const wrap = document.getElementById('page-wrap');
  saveHist();
  const f = {
    id:'f'+Date.now()+Math.floor(Math.random()*100000), type,
    name: names[type]+'_'+counter[type],
    placeholder: type==='date'?'jj/mm/aaaa':(type==='signature'?'Signature :':''),
    x: Math.round((wrap.offsetWidth/2) - d.w/2),
    y: 100,
    w:d.w, h:d.h, required:false,
    fontSize: 10,
    options: type==='select'?['Option 1','Option 2']:[],
    page: S.page,
  };
  S.fields.push(f);
  S.sel = f.id;
  renderFields(); renderProps();
}

function renderFields() {
  const ov = document.getElementById('overlay');
  ov.innerHTML = '';
  S.fields.filter(f => f.page===S.page).forEach(f => {
    const el = document.createElement('div');
    el.className = 'field-el field-'+f.type+(f.id===S.sel?' selected':'');
    el.dataset.id = f.id;
    el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;`;

    if (f.type === 'date') {
      // Rendu : label + 3 mini-inputs JJ / MM / AAAA alignés horizontalement
      el.innerHTML =
        '<div class="field-inner" style="padding:0 4px;gap:1px;overflow:visible;">'+
          '<span class="field-label">'+esc(f.name)+'</span>'+
          '<input class="di dj" maxlength="2" placeholder="jj" '+
            'style="width:22px;'+getDateInputStyle(f)+'">'+
          '<span style="color:#888;font-size:'+(f.fontSize||10)+'pt;line-height:1;user-select:none;">/</span>'+
          '<input class="di dm" maxlength="2" placeholder="mm" '+
            'style="width:22px;'+getDateInputStyle(f)+'">'+
          '<span style="color:#888;font-size:'+(f.fontSize||10)+'pt;line-height:1;user-select:none;">/</span>'+
          '<input class="di da" maxlength="4" placeholder="aaaa" '+
            'style="flex:1;min-width:30px;'+getDateInputStyle(f)+'">'+
          '<div class="resize-handle" data-act="resize"></div>'+
        '</div>'+
        '<div class="delete-btn" data-act="delete" title="Supprimer">'+
          '<svg viewBox="0 0 10 10" style="width:10px;height:10px;display:block;pointer-events:none;">'+
            '<path d="M2 2l6 6M8 2l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'+
        '</div>';

      // Restituer les valeurs sauvegardées
      const [vj, vm, va] = splitDateValue(f._dateValue);
      const ij = el.querySelector('.dj');
      const im = el.querySelector('.dm');
      const ia = el.querySelector('.da');
      if (vj) ij.value = vj;
      if (vm) im.value = vm;
      if (va) ia.value = va;

      attachDateInputs(ij, im, ia, f);

      // Mousedown sur les inputs : NE PAS stopper la propagation
      // → le mousedown remonte vers el → startDrag se déclenche normalement
      // → le focus natif sur l'input se fait au mouseup si l'user n'a pas dragué
      [ij, im, ia].forEach(inp => {
        ['mousedown','touchstart'].forEach(evt => inp.addEventListener(evt, e => {
          // Sélectionner le champ sans bloquer le drag
          selectField(f.id);
          // Pas de stopPropagation → le drag peut démarrer
        }));
      });

    } else {
      const icon = { text:'T', checkbox:'\u2611', select:'\u25be', signature:'\u270E' }[f.type];
      const hint = f.type==='checkbox'?'':(f.placeholder||'');
      // Pour le texte, la lettre-aperçu est affichée à la taille réelle qu'aura
      // la police dans le PDF exporté (fontSize en pt PDF * échelle de rendu),
      // pour que l'admin voie d'avance le rendu final.
      const iconPx = f.type==='text' ? Math.round((f.fontSize||10) * S.scale) : 14;
      el.innerHTML =
        '<div class="field-inner">'+
          '<span class="field-label">'+esc(f.name)+'</span>'+
          '<span style="font-size:'+iconPx+'px;line-height:1;opacity:.55;margin-right:3px;font-family:serif;font-weight:700;display:inline-flex;align-items:center;">'+icon+'</span>'+
          '<span style="font-size:10px;opacity:.6;overflow:hidden;white-space:nowrap;flex:1;">'+esc(hint)+'</span>'+
          '<div class="resize-handle" data-act="resize"></div>'+
        '</div>'+
        '<div class="delete-btn" data-act="delete" title="Supprimer">'+
          '<svg viewBox="0 0 10 10" style="width:10px;height:10px;display:block;pointer-events:none;">'+
            '<path d="M2 2l6 6M8 2l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'+
        '</div>';
    }

    ['mousedown','touchstart'].forEach(evt => el.addEventListener(evt, e => {
      const t = e.target.closest('[data-act]');
      if (t && t.dataset.act === 'delete') { e.stopPropagation(); e.preventDefault(); delField(f.id); return; }
      if (t && t.dataset.act === 'resize') { e.stopPropagation(); e.preventDefault(); startResize(e, f, el); return; }
      // Si clic sur un input date : ne pas preventDefault (sinon le focus est bloqué)
      // mais démarrer le drag quand même — le navigateur donnera le focus au mouseup
      if (!e.target.classList.contains('di')) e.preventDefault();
      selectField(f.id);
      startDrag(e, f, el);
    }, { passive:false }));

    ov.appendChild(el);
  });
}

function selectField(id) {
  if (S.sel === id) return;
  S.sel = id;
  document.querySelectorAll('.field-el').forEach(x => x.classList.toggle('selected', x.dataset.id===id));
  renderProps();
}

function getDateInputStyle(f) {
  return 'border:none;background:transparent;outline:none;box-sizing:border-box;'+
    'font-size:'+(f.fontSize||10)+'pt;font-family:monospace;color:#1a1a1a;'+
    'padding:0 1px;text-align:center;';
}

function splitDateValue(v) {
  if (!v) return ['','',''];
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? [m[1],m[2],m[3]] : ['','',''];
}

function saveDateValue(ij, im, ia, f) {
  const j = ij.value.padStart(2,'0');
  const m = im.value.padStart(2,'0');
  const a = ia.value;
  if (/^\d{2}$/.test(j) && /^\d{2}$/.test(m) && /^\d{4}$/.test(a)) {
    f._dateValue = j+'/'+m+'/'+a;
  } else {
    f._dateValue = '';
  }
}

// Gestion des 3 inputs JJ / MM / AAAA
function attachDateInputs(ij, im, ia, f) {
  // Autoriser seulement les chiffres, avancer automatiquement au champ suivant
  function digitOnly(e, inp, maxLen, next) {
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'Backspace') return; // comportement natif
    if (!/^[0-9]$/.test(e.key)) { e.preventDefault(); return; }
    // Si on atteint maxLen après cette frappe → passer au suivant
    if (inp.value.length >= maxLen - 1 && next) {
      // laisser la touche s'inscrire normalement, puis focus
      setTimeout(() => { if (inp.value.length >= maxLen) { next.focus(); next.select(); } }, 0);
    }
  }

  ij.addEventListener('keydown', e => digitOnly(e, ij, 2, im));
  im.addEventListener('keydown', e => digitOnly(e, im, 2, ia));
  ia.addEventListener('keydown', e => digitOnly(e, ia, 4, null));

  // Backspace sur champ vide → revenir au précédent
  im.addEventListener('keydown', e => { if (e.key==='Backspace' && im.value==='') { ij.focus(); ij.setSelectionRange(2,2); } });
  ia.addEventListener('keydown', e => { if (e.key==='Backspace' && ia.value==='') { im.focus(); im.setSelectionRange(2,2); } });

  // Filet de sécurité pour le collage (paste) : digitOnly ne filtre que les
  // frappes clavier (keydown), pas un collage direct dans un des 3 champs.
  // On force ici un nettoyage non-numérique sur chaque saisie, quelle que
  // soit son origine, pour ne jamais afficher de caractères non numériques.
  [ij,im,ia].forEach(inp => inp.addEventListener('input', () => {
    const digits = inp.value.replace(/\D/g,'');
    if (digits !== inp.value) inp.value = digits;
    saveDateValue(ij,im,ia,f);
  }));

  // Sélectionner tout au focus pour faciliter la correction
  [ij,im,ia].forEach(inp => inp.addEventListener('focus', () => inp.select()));

  // Paste sur JJ : essayer de parser une date collée au format xx/xx/xxxx
  ij.addEventListener('paste', e => {
    e.preventDefault();
    const raw = (e.clipboardData||window.clipboardData).getData('text').trim();
    const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      ij.value = m[1].padStart(2,'0');
      im.value = m[2].padStart(2,'0');
      ia.value = m[3].length===2 ? '20'+m[3] : m[3];
      saveDateValue(ij,im,ia,f);
      ia.focus(); ia.select();
    }
  });
}





// FIX DRAG : on déplace directement l'élément DOM, sans renderFields() pendant le move
// Gère aussi bien la souris (mousedown/mousemove/mouseup) que le tactile
// (touchstart/touchmove/touchend), indispensable sur tablette (usage fréquent
// en établissement scolaire) où il n'y a ni souris ni trackpad.
function startDrag(e, f, el) {
  const ov = document.getElementById('overlay');
  const ovRect = ov.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  const offX = point.clientX - ovRect.left - f.x;
  const offY = point.clientY - ovRect.top - f.y;

  const move = me => {
    if (me.cancelable) me.preventDefault();
    const p = me.touches ? me.touches[0] : me;
    let nx = p.clientX - ovRect.left - offX;
    let ny = p.clientY - ovRect.top - offY;
    nx = Math.max(0, Math.min(nx, ov.offsetWidth - f.w));
    ny = Math.max(0, Math.min(ny, ov.offsetHeight - f.h));
    f.x = Math.round(nx); f.y = Math.round(ny);
    el.style.left = f.x+'px';
    el.style.top = f.y+'px';
    setPos(f);
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
    document.removeEventListener('touchcancel', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive:false });
  document.addEventListener('touchend', up);
  document.addEventListener('touchcancel', up);
}

function startResize(e, f, el) {
  const sw=f.w, sh=f.h;
  const point = e.touches ? e.touches[0] : e;
  const sx=point.clientX, sy=point.clientY;
  const move = me => {
    if (me.cancelable) me.preventDefault();
    const p = me.touches ? me.touches[0] : me;
    f.w = Math.max(14, Math.round(sw + p.clientX - sx));
    f.h = Math.max(12, Math.round(sh + p.clientY - sy));
    el.style.width = f.w+'px'; el.style.height = f.h+'px';
    setSize(f);
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
    document.removeEventListener('touchcancel', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive:false });
  document.addEventListener('touchend', up);
  document.addEventListener('touchcancel', up);
}

function setPos(f) {
  const x=document.getElementById('p-x'), y=document.getElementById('p-y');
  if (x) x.value = f.x; if (y) y.value = f.y;
}
function setSize(f) {
  document.getElementById('p-w').value = f.w; document.getElementById('v-w').textContent = f.w;
  document.getElementById('p-h').value = f.h; document.getElementById('v-h').textContent = f.h;
}

// ── PROPS ───────────────────────────────────────────────────────────────────
function syncProps() {
  const f = cur(); if(!f) return;
  f.name = document.getElementById('p-name').value;
  f.placeholder = document.getElementById('p-ph').value;
  const nx = parseInt(document.getElementById('p-x').value, 10);
  const ny = parseInt(document.getElementById('p-y').value, 10);
  f.x = Number.isNaN(nx) ? f.x : nx;
  f.y = Number.isNaN(ny) ? f.y : ny;
  f.required = document.getElementById('p-req').value==='true';
  renderFields();
}

function renderProps() {
  const f = cur();
  document.getElementById('no-sel').style.display = f?'none':'';
  document.getElementById('props').style.display = f?'':'none';
  if (!f) return;
  document.getElementById('p-name').value = f.name;
  document.getElementById('p-ph').value = f.placeholder||'';
  document.getElementById('p-x').value = f.x;
  document.getElementById('p-y').value = f.y;
  document.getElementById('p-w').value = f.w;
  document.getElementById('p-h').value = f.h;
  document.getElementById('v-w').textContent = f.w;
  document.getElementById('v-h').textContent = f.h;
  document.getElementById('p-req').value = f.required?'true':'false';
  // fontSize
  const fs = f.fontSize||10;
  document.getElementById('p-fs').value = fs;
  document.getElementById('v-fs').textContent = fs;
  // visibilité panneaux
  document.getElementById('g-placeholder').style.display = f.type==='checkbox'?'none':'';
  document.getElementById('g-fontsize').style.display = (f.type==='checkbox'||f.type==='signature')?'none':'';
  document.getElementById('g-required').style.display = f.type==='signature'?'none':'';
  document.getElementById('g-options').style.display = f.type==='select'?'':'none';
  const lblPh = document.getElementById('lbl-ph');
  if (lblPh) lblPh.textContent = f.type==='signature' ? 'Légende (au-dessus de la zone)' : 'Texte indicatif';
  if (f.type==='select') {
    const list = document.getElementById('opts-list');
    list.innerHTML = '';
    f.options.forEach((o,i) => {
      const row = document.createElement('div');
      row.className = 'opt-item';
      row.innerHTML = '<input value="'+esc(o)+'"><button data-i="'+i+'">✕</button>';
      row.querySelector('input').oninput = e => { f.options[i] = e.target.value; };
      row.querySelector('button').onclick = () => { f.options.splice(i,1); renderProps(); };
      list.appendChild(row);
    });
  }
}

function deselect() {
  S.sel = null;
  document.querySelectorAll('.field-el').forEach(x => x.classList.remove('selected'));
  renderProps();
}

function delField(id) {
  saveHist();
  S.fields = S.fields.filter(f => f.id!==id);
  if (S.sel===id) S.sel = null;
  renderFields(); renderProps();
}

// ── COPIER / COLLER ────────────────────────────────────────────────────────
// Copie toutes les caractéristiques visuelles du champ sélectionné
// (taille, police, type, requis, options...) sauf la position/valeur.
function copyField() {
  const f = cur();
  if (!f) { notify('Sélectionne d\'abord un champ à copier.','error'); return; }
  clipboardField = {
    type: f.type,
    w: f.w, h: f.h,
    fontSize: f.fontSize,
    placeholder: f.placeholder,
    required: f.required,
    options: f.options ? f.options.slice() : [],
    x: f.x, y: f.y,
  };
  pasteOffset = 0;
  document.getElementById('btn-paste').disabled = false;
  notify('Champ copié ✓','success');
}

function pasteField() {
  if (!clipboardField) { notify('Rien à coller. Copie un champ avec Ctrl+C.','error'); return; }
  const c = clipboardField;
  counter[c.type]++;
  const names = { text:'texte', checkbox:'case', select:'liste', date:'date', signature:'signature' };
  const wrap = document.getElementById('page-wrap');
  pasteOffset += 20;

  let x = c.x + pasteOffset;
  let y = c.y + pasteOffset;
  if (wrap) {
    if (x + c.w > wrap.offsetWidth) x = 20;
    if (y + c.h > wrap.offsetHeight) y = 20;
  }

  saveHist();
  const f = {
    id: 'f'+Date.now()+Math.floor(Math.random()*1000),
    type: c.type,
    name: names[c.type]+'_'+counter[c.type],
    placeholder: c.placeholder,
    x, y,
    w: c.w, h: c.h, required: c.required,
    fontSize: c.fontSize,
    options: c.options.slice(),
    page: S.page,
  };
  S.fields.push(f);
  S.sel = f.id;
  renderFields(); renderProps();
  notify('Champ collé ✓','success');
}

function saveHist() {
  S.history.push(JSON.stringify(S.fields));
  if (S.history.length>40) S.history.shift();
  document.getElementById('btn-undo').disabled = false;
}
function undo() {
  if (!S.history.length) return;
  S.fields = JSON.parse(S.history.pop());
  S.sel = null;
  if (!S.history.length) document.getElementById('btn-undo').disabled = true;
  renderFields(); renderProps();
}

// ── HELPERS PDF ──────────────────────────────────────────────────────────────

/**
 * Configure un TextField exactement comme le GEVA-Sco :
 *
 *  - DA = /Helvetica <fontSize> Tf 0 g
 *      → si fontSize > 0 : taille fixe (champ court, 1 ligne)
 *      → si fontSize = 0 : auto-size natif PDF (viewer calcule la meilleure taille)
 *
 *  - Multiline ON  + DoNotScroll ON
 *      → retour à la ligne automatique
 *      → pas de scroll : si ça déborde, le viewer réduit la police (comportement natif,
 *        fonctionne dans Acrobat Reader ET Chrome PDF viewer)
 *
 *  Aucun JavaScript requis.
 */
function setTextFieldFontSize(doc, tf, fontSize, isMultiline) {
  const daString = `/Helvetica ${fontSize} Tf 0 g`;
  const daValue = PDFLib.PDFString.of(daString);

  // DA sur le widget et sur le champ parent
  const widgets = tf.acroField.getWidgets();
  widgets.forEach(widget => {
    widget.dict.set(PDFLib.PDFName.of('DA'), daValue);
  });
  tf.acroField.dict.set(PDFLib.PDFName.of('DA'), daValue);

  // Flags Multiline + DoNotScroll : UNIQUEMENT pour les champs réellement
  // multiligne (auto-size, fontSize=0). Pour un champ court à 1 ligne
  // (texte_1, ou les sous-champs date jj/mm/aaaa), forcer Multiline+
  // DoNotScroll sur une hauteur d'1 ligne fait que certains lecteurs stricts
  // (Acrobat Reader Android) ne réaffichent que le dernier caractère tapé
  // pendant la saisie (la valeur reste correcte, seul l'affichage est cassé).
  // Sans ces flags, le champ reste un champ 1 ligne classique avec défilement
  // horizontal natif — comportement standard et fiable.
  if (isMultiline) {
    try {
      const ffKey = PDFLib.PDFName.of('Ff');
      let ffVal = tf.acroField.dict.lookupMaybe(ffKey);
      let ffNum = ffVal ? ffVal.asNumber() : 0;
      ffNum |= (1 << 12); // Multiline
      ffNum |= (1 << 23); // DoNotScroll
      tf.acroField.dict.set(ffKey, PDFLib.PDFNumber.of(ffNum));
    } catch(e) { /* fallback silencieux */ }
  }
}

// ── EXPORT ──────────────────────────────────────────────────────────────────

// Helper export : découper f._dateValue en [jj, mm, aaaa] (même logique que splitDateValue,
// utilisée ici aussi pour garder l'export indépendant du rendu si l'un des deux évolue).

function clean(t) {
  if (!t) return '';
  return t.replace(/œ/g,'oe').replace(/Œ/g,'OE').replace(/€/g,'EUR')
          .replace(/[\u2750-\u2767\u25a0-\u25ff\u2610-\u2612]/g,'[]')
          .replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'")
          .replace(/[\u201C\u201D]/g,'"').replace(/\u2026/g,'...')
          .replace(/\u00A0/g,' ').replace(/[\u2022\u2023\u2043]/g,'-')
          .replace(/[^\x00-\xFF]/g,'?');
}

async function exportPdf() {
  if (!S.fields.length) { notify('Ajoute au moins un champ.','error'); return; }
  const btnExport = document.getElementById('btn-export');
  if (btnExport.disabled) return; // export déjà en cours
  btnExport.disabled = true;

  // Synchroniser les valeurs des 3 inputs date (JJ/MM/AAAA) avant export
  document.querySelectorAll('.field-el').forEach(el => {
    const id = el.dataset.id;
    const f  = S.fields.find(x => x.id === id);
    if (!f || f.type !== 'date') return;
    const ij = el.querySelector('.dj');
    const im = el.querySelector('.dm');
    const ia = el.querySelector('.da');
    if (ij && im && ia) saveDateValue(ij, im, ia, f);
  });
  loading('Génération du PDF remplissable...');
  try {
    const doc = await PDFDocument.load(S.pdfBytes.slice());
    const form = doc.getForm();
    const pages = doc.getPages();
    // Pré-remplir avec les noms déjà présents dans le PDF source (ex : le PDF
    // chargé est déjà un formulaire exporté précédemment par cet outil).
    // Sans ça, pdf-lib refuse silencieusement de créer un champ "en double"
    // et le champ correspondant est ignoré à l'export.
    let existingNames = [];
    try { existingNames = form.getFields().map(ff => ff.getName()); } catch(e) {}
    const used = new Set(existingNames);
    const helv = await doc.embedFont(StandardFonts.Helvetica);

    const canvas = document.getElementById('pdf-canvas');

    for (const f of S.fields) {
      const pg = pages[Math.min(f.page-1, pages.length-1)];
      const { width:pgW, height:pgH } = pg.getSize();
      const ratio = 1 / S.scale;
      const pdfX = f.x * ratio;
      const pdfY = pgH - (f.y * ratio) - (f.h * ratio);
      const pdfW = Math.max(f.w * ratio, 6);
      const pdfH = Math.max(f.h * ratio, 6);
      const fs   = f.fontSize || 10;

      let base = (f.name.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')||'champ');
      // Pour une date, 3 sous-champs sont réellement créés (base_jj/_mm/_aaaa) :
      // il faut vérifier l'unicité de ces noms-là, pas seulement du nom de base.
      const namesFor = nm => f.type==='date' ? [nm+'_jj', nm+'_mm', nm+'_aaaa'] : [nm];
      let name = base, n=1;
      while (namesFor(name).some(x => used.has(x))) name = base+'_'+(n++);
      namesFor(name).forEach(x => used.add(x));

      const blue = rgb(0.22,0.37,0.65);
      const bg   = rgb(0.98,0.98,1);
      try {
        if (f.type==='text') {
          const tf = form.createTextField(name);
          tf.addToPage(pg, { x:pdfX, y:pdfY, width:pdfW, height:pdfH, borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          // Si le champ est assez haut pour plusieurs lignes (> 2× la taille de police) :
          // on utilise fontSize=0 (auto-size natif PDF, comme le GEVA-Sco)
          // Sinon on fixe la taille choisie par l'utilisateur (champ 1 ligne)
          const isMultiline = pdfH > fs * 2.5;
          setTextFieldFontSize(doc, tf, isMultiline ? 0 : fs, isMultiline);
          if (f.required) tf.enableRequired();

        } else if (f.type==='date') {
          // 3 champs separes JJ / MM / AAAA — fonctionne dans Chrome, Acrobat, et tous viewers
          const [initJ, initM, initA] = splitDateValue(f._dateValue);
          const sepW  = Math.max(pdfW * 0.06, 4);
          const totalFields = pdfW - sepW * 2;
          const wJ = Math.round(totalFields * 2/8);
          const wM = Math.round(totalFields * 2/8);
          const wA = totalFields - wJ - wM;
          let cx = pdfX;

          const tfJ = form.createTextField(name+'_jj');
          tfJ.addToPage(pg, { x:cx, y:pdfY, width:wJ, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfJ, fs, false);
          tfJ.setMaxLength(2);
          try { tfJ.acroField.dict.set(PDFLib.PDFName.of('TU'), PDFLib.PDFString.of('Jour (JJ)')); } catch(e){}
          if (/^\d{2}$/.test(initJ)) { try { tfJ.setText(initJ); } catch(e){} }
          if (f.required) tfJ.enableRequired();
          cx += wJ + sepW;

          const tfM = form.createTextField(name+'_mm');
          tfM.addToPage(pg, { x:cx, y:pdfY, width:wM, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfM, fs, false);
          tfM.setMaxLength(2);
          try { tfM.acroField.dict.set(PDFLib.PDFName.of('TU'), PDFLib.PDFString.of('Mois (MM)')); } catch(e){}
          if (/^\d{2}$/.test(initM)) { try { tfM.setText(initM); } catch(e){} }
          if (f.required) tfM.enableRequired();
          cx += wM + sepW;

          const tfA = form.createTextField(name+'_aaaa');
          tfA.addToPage(pg, { x:cx, y:pdfY, width:wA, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfA, fs, false);
          tfA.setMaxLength(4);
          try { tfA.acroField.dict.set(PDFLib.PDFName.of('TU'), PDFLib.PDFString.of('Année (AAAA)')); } catch(e){}
          if (/^\d{4}$/.test(initA)) { try { tfA.setText(initA); } catch(e){} }
          if (f.required) tfA.enableRequired();

        } else if (f.type==='checkbox') {
          const cb = form.createCheckBox(name);
          cb.addToPage(pg, { x:pdfX, y:pdfY, width:Math.min(pdfW,pdfH), height:Math.min(pdfW,pdfH) });
          if (f.required) cb.enableRequired();

        } else if (f.type==='select') {
          const dd = form.createDropdown(name);
          const opts = (f.options.length?f.options:['Option 1']).map(clean);
          dd.addOptions(opts); dd.select(opts[0]);
          dd.addToPage(pg, { x:pdfX, y:pdfY, width:pdfW, height:pdfH, borderWidth:0.7, borderColor:blue });
          if (f.required) dd.enableRequired();

        } else if (f.type==='signature') {
          // Pas de type de champ "dessin" en PDF standard (AcroForm ne connaît que
          // Tx/Ch/Btn/Sig), et un vrai champ /Sig n'est pas fiable sur tous les viewers.
          // On dessine donc juste une zone repère : l'utilisateur signe ensuite avec
          // l'outil natif "Remplir et signer" de son lecteur PDF (fonctionne partout,
          // y compris sur mobile, sans nécessiter de champ particulier).
          pg.drawRectangle({
            x:pdfX, y:pdfY, width:pdfW, height:pdfH,
            borderWidth:0.8, borderColor:blue, borderDashArray:[3,2],
            color: bg, opacity:1, borderOpacity:0.9,
          });
          const capSize = 7;
          const caption = clean(f.placeholder || 'Signature :');
          pg.drawText(caption, {
            x: pdfX+4, y: pdfY+pdfH-capSize-3,
            size: capSize, font: helv, color: rgb(0.45,0.45,0.45),
          });
          // Ligne de signature remontée (au lieu d'être collée en bas) pour
          // laisser la place aux instructions d'accès en dessous.
          const baseY = pdfY + pdfH * 0.42;
          pg.drawLine({
            start:{ x:pdfX+4, y:baseY }, end:{ x:pdfX+pdfW-4, y:baseY },
            thickness:0.6, color: rgb(0.6,0.6,0.6),
          });
          // Chemin d'accès à l'outil de signature manuscrite selon le lecteur PDF
          const instrSize = 6;
          const instrLines = [
            'Acrobat Reader : Outils > Remplir et signer',
            'Apple : icône Marqueur > Signature',
          ];
          instrLines.forEach((line, i) => {
            pg.drawText(clean(line), {
              x: pdfX+4, y: baseY - 9 - (i*(instrSize+3)),
              size: instrSize, font: helv, color: rgb(0.55,0.55,0.55),
            });
          });
        }
      } catch(err) { console.warn('Champ ignoré',name,err.message); }
    }

    // pdf-lib ne renseigne jamais /AcroForm/DR/Font (TODO non résolu dans son
    // propre code source). Sans ça, la police "/Helvetica" référencée par chaque
    // /DA n'est déclarée nulle part au niveau du formulaire — ce que Acrobat et
    // certains lecteurs Android (Acrobat Reader, Firefox) valident strictement
    // à l'ouverture. On utilise volontairement le même nom "/Helvetica" que
    // celui que pdf-lib utilise lui-même en interne (il régénère parfois
    // l'apparence d'un widget — ex. après setMaxLength — avec sa propre police
    // nommée "/Helvetica" lors du save() ; utiliser ce même nom partout évite
    // toute incohérence widget/champ qui ferait planter ces lecteurs stricts).
    try {
      const afDict = form.acroForm.dict;
      const drRef  = afDict.get(PDFLib.PDFName.of('DR'));
      let dr = drRef ? doc.context.lookup(drRef) : undefined;
      if (!dr || typeof dr.set !== 'function') {
        dr = doc.context.obj({});
        afDict.set(PDFLib.PDFName.of('DR'), dr);
      }
      const fontRef = dr.get(PDFLib.PDFName.of('Font'));
      let drFont = fontRef ? doc.context.lookup(fontRef) : undefined;
      if (!drFont || typeof drFont.set !== 'function') {
        drFont = doc.context.obj({});
        dr.set(PDFLib.PDFName.of('Font'), drFont);
      }
      if (!drFont.get(PDFLib.PDFName.of('Helvetica'))) {
        const helvDict = doc.context.obj({
          Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
        });
        drFont.set(PDFLib.PDFName.of('Helvetica'), doc.context.register(helvDict));
      }
      // Police de secours générique pour le formulaire (certains viewers la lisent)
      if (!afDict.get(PDFLib.PDFName.of('DA'))) {
        afDict.set(PDFLib.PDFName.of('DA'), PDFLib.PDFString.of('/Helvetica 10 Tf 0 g'));
      }
    } catch(e) { console.warn('Réparation DR/Font échouée:', e.message); }

    const bytes = await doc.save();

    // ── Vérification post-export ──────────────────────────────────────────
    // On recharge immédiatement le PDF généré avec pdf.js (le même moteur que
    // l'aperçu) pour s'assurer qu'il est réellement lisible avant de le
    // proposer au téléchargement. Mieux vaut bloquer ici avec un message
    // clair que laisser partir un fichier potentiellement cassé vers un parent.
    loading('Vérification du PDF généré...');
    try {
      const checkDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      if (checkDoc.numPages < 1) throw new Error('Document vide après vérification');
      await checkDoc.getPage(1);
    } catch (verifErr) {
      console.error('Vérification post-export échouée:', verifErr);
      notify('Échec : le PDF généré semble invalide. Réessaie, ou contacte le support si ça persiste.','error');
      done();
      return;
    }

    const blob = new Blob([bytes], { type:'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'formulaire_modifiable.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    // Délai long avant révocation : sur mobile (Android/Firefox notamment), le
    // téléchargement passe par un gestionnaire système asynchrone qui peut
    // prendre plusieurs secondes à lire le blob. Le révoquer trop tôt (1s avant)
    // produisait un fichier vide ou tronqué = "PDF corrompu" à l'ouverture.
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    notify('PDF remplissable exporté et vérifié ✓','success');
  } catch(e) {
    console.error(e);
    notify('Le PDF n\'a pas pu être généré. Vérifiez le fichier source ou réessayez.','error');
  } finally {
    btnExport.disabled = false;
    done();
  }
}

// ── UI UTILS ────────────────────────────────────────────────────────────────
let loadEl=null;
function loading(msg) {
  if (loadEl) {
    const p = loadEl.querySelector('p');
    if (p) p.textContent = msg || '...';
    return;
  }
  loadEl = document.createElement('div');
  loadEl.style.cssText='position:fixed;inset:0;background:rgba(255,255,255,.88);display:flex;align-items:center;justify-content:center;z-index:9998;flex-direction:column;gap:12px;';
  loadEl.innerHTML='<div class="spinner"></div><p style="font-size:14px;color:#5F5E5A;">'+(msg||'...')+'</p>';
  document.body.appendChild(loadEl);
}
function done() { if (loadEl){document.body.removeChild(loadEl);loadEl=null;} }
function notify(msg,type) {
  const el=document.createElement('div');
  el.className='notif '+(type||'success');
  el.innerHTML='<span>'+(type==='error'?'✕':'✓')+'</span> '+msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3500);
}
