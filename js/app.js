
const { PDFDocument, rgb, StandardFonts } = PDFLib;

let S = {
  pdfBytes:null, pdfDoc:null, page:1, total:1, scale:1.5,
  fields:[], sel:null, history:[],
};
let counter = { text:0, checkbox:0, select:0, date:0, signature:0 };
let clipboardField = null;
let pasteOffset = 0;

document.addEventListener('DOMContentLoaded', () => {
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
  };

  document.getElementById('canvas-area').addEventListener('mousedown', e => {
    if (e.target.id === 'canvas-area' || e.target.id === 'page-wrap' || e.target.id === 'pdf-canvas') deselect();
  });

  // Raccourcis clavier copier / coller / dupliquer
  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !typing) { e.preventDefault(); copyField(); }
    else if (k === 'v' && !typing) { e.preventDefault(); pasteField(); }
    else if (k === 'd') { e.preventDefault(); if (!typing) copyField(); pasteField(); }
  });
});

function cur() { return S.fields.find(f => f.id === S.sel); }

// ── LOAD PDF ──────────────────────────────────────────────────────────────
async function loadPdf(file) {
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

    await renderPage();
    await buildThumbs();
    renderProps();
    notify('PDF chargé ('+S.total+' page'+(S.total>1?'s':'')+') ✓','success');
  } catch(e) {
    console.error(e); notify('Erreur : '+e.message,'error');
  }
  done();
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
    signature:{ w:220, h:70 },
  };
  const d = defs[type];
  const wrap = document.getElementById('page-wrap');
  saveHist();
  const f = {
    id:'f'+Date.now(), type,
    name: names[type]+'_'+counter[type],
    placeholder: type==='date'?'jj/mm/aaaa':(type==='signature'?'Signature':''),
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
          '<span class="field-label">'+f.name+'</span>'+
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
        inp.addEventListener('mousedown', e => {
          // Sélectionner le champ sans bloquer le drag
          selectField(f.id);
          // Pas de stopPropagation → le drag peut démarrer
        });
      });

    } else {
      const icon = { text:'T', checkbox:'\u2611', select:'\u25be', signature:'\u270E' }[f.type];
      const hint = f.type==='checkbox'?'':(f.placeholder||'');
      el.innerHTML =
        '<div class="field-inner">'+
          '<span class="field-label">'+f.name+'</span>'+
          '<span style="font-size:10px;opacity:.55;margin-right:3px;">'+icon+'</span>'+
          '<span style="font-size:10px;opacity:.6;overflow:hidden;white-space:nowrap;flex:1;">'+hint+'</span>'+
          '<div class="resize-handle" data-act="resize"></div>'+
        '</div>'+
        '<div class="delete-btn" data-act="delete" title="Supprimer">'+
          '<svg viewBox="0 0 10 10" style="width:10px;height:10px;display:block;pointer-events:none;">'+
            '<path d="M2 2l6 6M8 2l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'+
        '</div>';
    }

    el.addEventListener('mousedown', e => {
      const t = e.target.closest('[data-act]');
      if (t && t.dataset.act === 'delete') { e.stopPropagation(); e.preventDefault(); delField(f.id); return; }
      if (t && t.dataset.act === 'resize') { e.stopPropagation(); e.preventDefault(); startResize(e, f, el); return; }
      // Si clic sur un input date : ne pas preventDefault (sinon le focus est bloqué)
      // mais démarrer le drag quand même — le navigateur donnera le focus au mouseup
      if (!e.target.classList.contains('di')) e.preventDefault();
      selectField(f.id);
      startDrag(e, f, el);
    });

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
    if (e.key === 'Tab' || e.key === 'Escape') return;
    if (e.key === 'Backspace') {
      if (inp.value === '' && next === null) return; // laisse effacer normalement
      return; // comportement natif
    }
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

  // Sauvegarder à chaque frappe
  [ij,im,ia].forEach(inp => inp.addEventListener('input', () => saveDateValue(ij,im,ia,f)));

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
function startDrag(e, f, el) {
  const ov = document.getElementById('overlay');
  const ovRect = ov.getBoundingClientRect();
  const offX = e.clientX - ovRect.left - f.x;
  const offY = e.clientY - ovRect.top - f.y;

  const move = me => {
    let nx = me.clientX - ovRect.left - offX;
    let ny = me.clientY - ovRect.top - offY;
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
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function startResize(e, f, el) {
  const sw=f.w, sh=f.h, sx=e.clientX, sy=e.clientY;
  const move = me => {
    f.w = Math.max(14, Math.round(sw + me.clientX - sx));
    f.h = Math.max(12, Math.round(sh + me.clientY - sy));
    el.style.width = f.w+'px'; el.style.height = f.h+'px';
    setSize(f);
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
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
  f.x = parseInt(document.getElementById('p-x').value)||f.x;
  f.y = parseInt(document.getElementById('p-y').value)||f.y;
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
      row.innerHTML = '<input value="'+o.replace(/"/g,'&quot;')+'"><button data-i="'+i+'">✕</button>';
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
  const names = { text:'texte', checkbox:'case', select:'liste', date:'date' };
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
 *  - DA = /Helv <fontSize> Tf 0 g
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
function setTextFieldFontSize(doc, tf, fontSize) {
  const daString = `/Helv ${fontSize} Tf 0 g`;
  const daValue = PDFLib.PDFString.of(daString);

  // DA sur le widget et sur le champ parent
  const widgets = tf.acroField.getWidgets();
  widgets.forEach(widget => {
    widget.dict.set(PDFLib.PDFName.of('DA'), daValue);
  });
  tf.acroField.dict.set(PDFLib.PDFName.of('DA'), daValue);

  // Flags : Multiline ON + DoNotScroll ON
  try {
    const ffKey = PDFLib.PDFName.of('Ff');
    let ffVal = tf.acroField.dict.lookupMaybe(ffKey);
    let ffNum = ffVal ? ffVal.asNumber() : 0;
    ffNum |= (1 << 12); // Multiline
    ffNum |= (1 << 23); // DoNotScroll
    tf.acroField.dict.set(ffKey, PDFLib.PDFNumber.of(ffNum));
  } catch(e) { /* fallback silencieux */ }
}
function addAA(doc, tf, trigger, jsCode) {
  try {
    const acroField = tf.acroField;
    const ctx = doc.context;
    const aaKey = PDFLib.PDFName.of('AA');
    const triggerKey = PDFLib.PDFName.of(trigger);
    let aaDict = acroField.dict.lookup(aaKey);
    if (!aaDict || typeof aaDict.set !== 'function') aaDict = ctx.obj({});
    aaDict.set(triggerKey, ctx.obj({ S: PDFLib.PDFName.of('JavaScript'), JS: PDFLib.PDFString.of(jsCode) }));
    acroField.dict.set(aaKey, aaDict);
  } catch(e) { console.warn('addAA:', e.message); }
}

// ── EXPORT ──────────────────────────────────────────────────────────────────

// Helper export : découper f._dateValue en [jj, mm, aaaa]
function splitDateValueExport(v) {
  if (!v) return ['','',''];
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? [m[1], m[2], m[3]] : ['','',''];
}

// AA Keystroke pour champ JJ ou MM ou AAAA :
// - n'accepte que les chiffres
// - quand maxLen chiffres saisis, passe le focus au champ suivant (nextName)
// Fonctionne dans Acrobat Reader/Pro. Chrome PDF viewer l'ignore (maxLength suffit).
function addDateFieldAA(doc, tf, maxLen, nextName) {
  // ── Focus (Fo) : curseur tout à gauche dès le clic ──────────────────────
  const foJS =
    'event.target.select(0, 0);';

  // ── Keystroke (K) : chiffres uniquement + tab auto après maxLen chiffres ─
  // event.value = valeur avant la frappe
  // event.change = caractère tapé (null/"" = effacement)
  // On reconstruit la valeur manuellement pour garder le contrôle total.
  const kJS =
    'if (event.willCommit) return;' +
    'var ch = event.change;' +
    'if (ch !== null && ch !== "" && !/^[0-9]$/.test(ch)) { event.rc = false; return; }' +
    'var cur = (event.value || "").replace(/[^0-9]/g, "");' +
    // Effacement
    'if (ch === null || ch === "") { event.rc = true; return; }' +
    // Champ déjà plein → bloquer
    'if (cur.length >= ' + maxLen + ') { event.rc = false; return; }' +
    // Avant-dernier chiffre → laisser passer normalement
    'event.rc = true;' +
    // Dernier chiffre → écrire et sauter au champ suivant
    'if (cur.length === ' + (maxLen - 1) + ') {' +
    '  event.value = cur + ch;' +
    (nextName
      ? '  var nf = this.getField("' + nextName + '"); if (nf) { nf.setFocus(); nf.select(0,0); }'
      : '') +
    '  event.rc = false;' +
    '}';

  function setAA(trigger, js) {
    try {
      const ctx    = doc.context;
      const aaKey  = PDFLib.PDFName.of('AA');
      const tKey   = PDFLib.PDFName.of(trigger);
      let aaDict   = tf.acroField.dict.lookup(aaKey);
      if (!aaDict || typeof aaDict.set !== 'function') aaDict = ctx.obj({});
      aaDict.set(tKey, ctx.obj({ S: PDFLib.PDFName.of('JavaScript'), JS: PDFLib.PDFString.of(js) }));
      tf.acroField.dict.set(aaKey, aaDict);
    } catch(e) { console.warn('addDateFieldAA', trigger, e.message); }
  }

  setAA('Fo', foJS);
  setAA('K',  kJS);
}

function clean(t) {
  if (!t) return '';
  return t.replace(/[\u2750-\u2767\u25a0-\u25ff\u2610-\u2612]/g,'[]')
          .replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'")
          .replace(/[\u201C\u201D]/g,'"').replace(/\u2026/g,'...')
          .replace(/\u00A0/g,' ').replace(/[\u2022\u2023\u2043]/g,'-')
          .replace(/[^\x00-\xFF]/g,'?');
}

async function exportPdf() {
  if (!S.fields.length) { notify('Ajoute au moins un champ.','error'); return; }

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
    const used = new Set();
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
      let name = base, n=1;
      while (used.has(name)) name = base+'_'+(n++);
      used.add(name);

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
          setTextFieldFontSize(doc, tf, isMultiline ? 0 : fs);
          if (f.required) tf.enableRequired();

        } else if (f.type==='date') {
          // 3 champs separes JJ / MM / AAAA — fonctionne dans Chrome, Acrobat, et tous viewers
          const [initJ, initM, initA] = splitDateValueExport(f._dateValue);
          const sepW  = Math.max(pdfW * 0.06, 4);
          const totalFields = pdfW - sepW * 2;
          const wJ = Math.round(totalFields * 2/8);
          const wM = Math.round(totalFields * 2/8);
          const wA = totalFields - wJ - wM;
          let cx = pdfX;

          const tfJ = form.createTextField(name+'_jj');
          tfJ.addToPage(pg, { x:cx, y:pdfY, width:wJ, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfJ, fs);
          tfJ.setMaxLength(2);
          try { tfJ.acroField.dict.set(PDFLib.PDFName.of('V'), PDFLib.PDFString.of(initJ||'jj')); } catch(e){}
          addDateFieldAA(doc, tfJ, 2, name+'_mm');
          if (f.required) tfJ.enableRequired();
          cx += wJ + sepW;

          const tfM = form.createTextField(name+'_mm');
          tfM.addToPage(pg, { x:cx, y:pdfY, width:wM, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfM, fs);
          tfM.setMaxLength(2);
          try { tfM.acroField.dict.set(PDFLib.PDFName.of('V'), PDFLib.PDFString.of(initM||'mm')); } catch(e){}
          addDateFieldAA(doc, tfM, 2, name+'_aaaa');
          if (f.required) tfM.enableRequired();
          cx += wM + sepW;

          const tfA = form.createTextField(name+'_aaaa');
          tfA.addToPage(pg, { x:cx, y:pdfY, width:wA, height:pdfH,
            borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tfA, fs);
          tfA.setMaxLength(4);
          try { tfA.acroField.dict.set(PDFLib.PDFName.of('V'), PDFLib.PDFString.of(initA||'aaaa')); } catch(e){}
          addDateFieldAA(doc, tfA, 4, null);
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
          const baseY = pdfY + Math.max(pdfH*0.18, 6);
          pg.drawLine({
            start:{ x:pdfX+4, y:baseY }, end:{ x:pdfX+pdfW-4, y:baseY },
            thickness:0.6, color: rgb(0.6,0.6,0.6),
          });
          const caption = clean(f.placeholder || 'Signature');
          const capSize = 7;
          pg.drawText(caption, {
            x: pdfX+4, y: pdfY+pdfH-capSize-3,
            size: capSize, font: helv, color: rgb(0.45,0.45,0.45),
          });
        }
      } catch(err) { console.warn('Champ ignoré',name,err.message); }
    }

    const bytes = await doc.save();
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
    notify('PDF remplissable exporté ✓','success');
  } catch(e) {
    console.error(e); notify('Erreur export : '+e.message,'error');
  }
  done();
}

// ── UI UTILS ────────────────────────────────────────────────────────────────
let loadEl=null;
function loading(msg) {
  if (loadEl) return;
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
