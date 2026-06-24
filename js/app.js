
const { PDFDocument, rgb, StandardFonts } = PDFLib;

let S = {
  pdfBytes:null, pdfDoc:null, page:1, total:1, scale:1.5,
  fields:[], sel:null, history:[],
};
let counter = { text:0, checkbox:0, select:0, date:0 };

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
    counter = { text:0, checkbox:0, select:0, date:0 };

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
  const names = { text:'texte', checkbox:'case', select:'liste', date:'date' };
  // Tailles par défaut en pixels canvas (scale 1.5)
  const defs = {
    text:     { w:180, h:22 },
    checkbox: { w:18,  h:18 },
    select:   { w:160, h:24 },
    date:     { w:120, h:22 },
  };
  const d = defs[type];
  const wrap = document.getElementById('page-wrap');
  saveHist();
  const f = {
    id:'f'+Date.now(), type,
    name: names[type]+'_'+counter[type],
    placeholder: type==='date'?'jj/mm/aaaa':(type==='text'?'':''),
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
    el.className = 'field-el'+(f.id===S.sel?' selected':'');
    el.dataset.id = f.id;
    el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;`;

    if (f.type === 'date') {
      // Barre de drag (14px) en haut + input en dessous
      el.innerHTML =
        '<div class="field-inner" style="flex-direction:column;padding:0;overflow:visible;cursor:default;">'+
          '<div class="date-drag-handle" data-act="drag" '+
            'style="width:100%;height:14px;display:flex;align-items:center;'+
            'padding:0 4px;cursor:move;flex-shrink:0;user-select:none;background:rgba(55,138,221,.18);border-radius:3px 3px 0 0;">'+
            '<span style="font-size:9px;font-weight:600;color:var(--blue);'+
              'white-space:nowrap;overflow:hidden;flex:1;pointer-events:none;">'+f.name+'</span>'+
            '<span style="font-size:9px;opacity:.5;pointer-events:none;">&#x1F4C5;</span>'+
          '</div>'+
          '<input class="date-mask-input" type="text" maxlength="10" '+
            'value="'+(f._dateValue||'jj/mm/aaaa')+'" '+
            'style="flex:1;width:100%;min-height:0;border:none;background:transparent;'+
            'font-size:'+(f.fontSize||10)+'pt;font-family:monospace;'+
            'color:#1a1a1a;padding:0 4px;cursor:text;outline:none;box-sizing:border-box;">'+
          '<div class="resize-handle" data-act="resize"></div>'+
        '</div>'+
        '<div class="delete-btn" data-act="delete" title="Supprimer">'+
          '<svg viewBox="0 0 10 10" style="width:10px;height:10px;display:block;pointer-events:none;">'+
            '<path d="M2 2l6 6M8 2l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'+
        '</div>';

      const input = el.querySelector('.date-mask-input');
      attachDateMask(input, f);

      // Drag handle : mousedown => drag (preventDefault bloque le focus input)
      const handle = el.querySelector('.date-drag-handle');
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        if (S.sel !== f.id) {
          S.sel = f.id;
          document.querySelectorAll('.field-el').forEach(x => x.classList.toggle('selected', x.dataset.id===f.id));
          renderProps();
        }
        startDrag(e, f, el);
      });

      // Input : on selectionne le champ mais on laisse le focus se faire naturellement
      input.addEventListener('mousedown', e => {
        e.stopPropagation(); // empeche el.mousedown de lancer startDrag
        if (S.sel !== f.id) {
          S.sel = f.id;
          document.querySelectorAll('.field-el').forEach(x => x.classList.toggle('selected', x.dataset.id===f.id));
          renderProps();
        }
        // pas de preventDefault => l'input recoit le focus
      });

    } else {
      const icon = { text:'T', checkbox:'\u2611', select:'\u25be' }[f.type];
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
      if (t && t.dataset.act === 'drag')   return; // gere par le handle
      if (e.target.classList.contains('date-mask-input')) return; // gere par l'input
      e.preventDefault();
      if (S.sel !== f.id) {
        S.sel = f.id;
        document.querySelectorAll('.field-el').forEach(x => x.classList.toggle('selected', x.dataset.id===f.id));
        renderProps();
      }
      startDrag(e, f, el);
    });

    ov.appendChild(el);
  });
}

// Masque de saisie JJ/MM/AAAA pour un <input> HTML
function attachDateMask(input, f) {
  const SLOTS = [0,1,3,4,6,7,8,9];
  const MASK  = 'jj/mm/aaaa';

  function phAt(i) { return i < 2 ? 'j' : i < 5 ? 'm' : 'a'; }

  function firstEmpty(v) {
    for (var i = 0; i < SLOTS.length; i++) {
      var c = v[SLOTS[i]];
      if (c === 'j' || c === 'm' || c === 'a') return SLOTS[i];
    }
    return -1;
  }

  function lastFilled(v) {
    for (var i = SLOTS.length - 1; i >= 0; i--) {
      var c = v[SLOTS[i]];
      if (c !== 'j' && c !== 'm' && c !== 'a') return SLOTS[i];
    }
    return -1;
  }

  function moveCursor(afterPos) {
    var v = input.value;
    var target = -1;
    for (var i = 0; i < SLOTS.length; i++) {
      if (SLOTS[i] >= afterPos) {
        var c = v[SLOTS[i]];
        if (c === 'j' || c === 'm' || c === 'a') { target = SLOTS[i]; break; }
      }
    }
    if (target === -1) target = 10;
    requestAnimationFrame(function() {
      input.setSelectionRange(target, target < 10 ? target + 1 : target);
    });
  }

  input.addEventListener('focus', function() {
    if (!input.value || input.value.length !== 10) input.value = MASK;
    var fe = firstEmpty(input.value);
    var pos = fe === -1 ? 10 : fe;
    requestAnimationFrame(function() {
      input.setSelectionRange(pos, pos < 10 ? pos + 1 : pos);
    });
  });

  input.addEventListener('blur', function() {
    var v = input.value;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) { input.value = MASK; f._dateValue = ''; }
    else f._dateValue = v;
  });

  input.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.metaKey || e.key === 'Tab' || e.key === 'Escape') return;

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      var v = input.value;
      if (v.length !== 10) { input.value = MASK; return; }
      var lf = lastFilled(v);
      if (lf >= 0) {
        var arr = v.split('');
        arr[lf] = phAt(lf);
        input.value = arr.join('');
        requestAnimationFrame(function() { input.setSelectionRange(lf, lf + 1); });
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') return;

    if (!/^[0-9]$/.test(e.key)) { e.preventDefault(); return; }

    e.preventDefault();
    var v = input.value;
    if (!v || v.length !== 10) v = MASK;
    var pos = firstEmpty(v);
    if (pos === -1) return;
    var arr = v.split('');
    arr[pos] = e.key;
    input.value = arr.join('');
    f._dateValue = /^\d{2}\/\d{2}\/\d{4}$/.test(input.value) ? input.value : '';
    moveCursor(pos + 1);
  });

  input.addEventListener('paste', function(e) { e.preventDefault(); });
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
  document.getElementById('g-fontsize').style.display = f.type==='checkbox'?'none':'';
  document.getElementById('g-options').style.display = f.type==='select'?'':'none';
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

  // DA sur le widget et sur le champ parent
  const widgets = tf.acroField.getWidgets();
  widgets.forEach(widget => {
    widget.dict.set(doc.context.obj('DA'), doc.context.obj(daString));
  });
  tf.acroField.dict.set(doc.context.obj('DA'), doc.context.obj(daString));

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

/**
 * Ajoute le sélecteur de date Acrobat (format DD/MM/YYYY).
 */
function addAA(doc, tf, trigger, jsCode) {
  try {
    const acroField = tf.acroField;
    const ctx = doc.context;
    const aaKey = PDFLib.PDFName.of('AA');
    const triggerKey = PDFLib.PDFName.of(trigger);
    let aaDict = acroField.dict.lookupMaybe(aaKey);
    if (!aaDict || typeof aaDict.set !== 'function') aaDict = ctx.obj({});
    aaDict.set(triggerKey, ctx.obj({ S: PDFLib.PDFName.of('JavaScript'), JS: PDFLib.PDFString.of(jsCode) }));
    acroField.dict.set(aaKey, aaDict);
  } catch(e) { console.warn('addAA:', e.message); }
}

function addDatePickerAction(doc, tf, fontSize) {
  /*
   * Masque de saisie JJ/MM/AAAA pour Acrobat/PDF viewers.
   *
   * Principe :
   *   - La valeur du champ est TOUJOURS une chaîne de 10 caractères : "jj/mm/aaaa"
   *   - Les positions fixes : 0,1=jour  2='/'  3,4=mois  5='/'  6,7,8,9=année
   *   - Chaque chiffre saisi remplace le prochain placeholder (j, m ou a) en ordre
   *   - Backspace efface le dernier chiffre saisi (le remet en placeholder)
   *   - Les '/' ne sont jamais saisis par l'utilisateur, ils font partie du masque
   *   - À la frappe du 2e chiffre du jour ou du mois → le '/' suivant est "sauté"
   *     automatiquement (progression naturelle gauche→droite)
   *
   * Compatibilité : Acrobat Reader, Acrobat Pro. Chrome PDF viewer n'exécute pas
   * les AA scripts — comportement normal (champ texte libre dans ce cas).
   */

  // ── Focus (Fo) : initialise le masque et force le curseur en position 0 ──────
  const foJS = `
var v = event.value;
if (!v || v === "" || !/^\d\d\/\d\d\/\d{4}$/.test(v)) {
  event.value = "jj/mm/aaaa";
}
// Positionner le curseur sur le premier placeholder non rempli
var cur = event.value;
var slots = [0,1,3,4,6,7,8,9];
var firstEmpty = 0;
for (var i = 0; i < slots.length; i++) {
  var c = cur.charAt(slots[i]);
  if (c === 'j' || c === 'm' || c === 'a') { firstEmpty = slots[i]; break; }
}
event.target.select(firstEmpty, firstEmpty + 1);
`.trim();

  // ── Keystroke (K) : cœur du masque ─────────────────────────────────────────
  const kJS = `
if (event.willCommit) return;

var ch  = event.change;   // caractère tapé (null ou "" = Backspace/Delete)
var cur = event.value;    // valeur du champ AVANT cette frappe
var MASK = "jj/mm/aaaa";

// Normaliser la valeur courante
if (!cur || cur.length !== 10) cur = MASK;

// Positions des chiffres (hors séparateurs)
var slots = [0,1,3,4,6,7,8,9];
// Placeholder par position
function ph(idx) { return idx < 2 ? 'j' : idx < 5 ? 'm' : 'a'; }

// ── Effacement (Backspace / Delete) ──────────────────────────────────────────
if (ch === null || ch === "") {
  // Trouver le dernier slot rempli (chiffre réel)
  var lastFilled = -1;
  for (var i = slots.length - 1; i >= 0; i--) {
    var c = cur.charAt(slots[i]);
    if (c !== 'j' && c !== 'm' && c !== 'a') { lastFilled = slots[i]; break; }
  }
  if (lastFilled >= 0) {
    var arr = cur.split('');
    arr[lastFilled] = ph(lastFilled);
    event.value = arr.join('');
    // Replacer le curseur sur ce slot
    event.target.select(lastFilled, lastFilled + 1);
  }
  event.rc = false;
  return;
}

// ── Saisie d'un caractère ────────────────────────────────────────────────────
// Rejeter tout ce qui n'est pas un chiffre
if (!/^[0-9]$/.test(ch)) {
  event.rc = false;
  return;
}

// Trouver le premier slot vide (placeholder)
var pos = -1;
for (var i = 0; i < slots.length; i++) {
  var c = cur.charAt(slots[i]);
  if (c === 'j' || c === 'm' || c === 'a') { pos = slots[i]; break; }
}

// Masque déjà complet → bloquer
if (pos === -1) {
  event.rc = false;
  return;
}

// Écrire le chiffre à la bonne position
var arr = cur.split('');
arr[pos] = ch;
event.value = arr.join('');

// Avancer le curseur sur le prochain slot vide (sauter les '/')
var nextPos = -1;
for (var i = 0; i < slots.length; i++) {
  if (slots[i] > pos) {
    var c = event.value.charAt(slots[i]);
    if (c === 'j' || c === 'm' || c === 'a') { nextPos = slots[i]; break; }
  }
}
if (nextPos !== -1) {
  event.target.select(nextPos, nextPos + 1);
} else {
  // Masque complet : positionner après le dernier chiffre
  event.target.select(10, 10);
}

event.rc = false;
`.trim();

  // ── Format (F) : affiché après validation/perte de focus ────────────────────
  const fJS = `
var v = event.value;
if (!v || v === "" || v === "jj/mm/aaaa") {
  event.value = "jj/mm/aaaa";
  return;
}
// Si le masque est partiellement rempli, laisser tel quel (pas de reformatage)
`.trim();

  // ── Validate (V) : accepte le masque vide OU une vraie date DD/MM/YYYY ──────
  const vJS = `
var v = event.value;
if (!v || v === "" || v === "jj/mm/aaaa") {
  event.rc = true;
  return;
}
var m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
if (!m) { event.rc = false; return; }
var d = parseInt(m[1],10), mo = parseInt(m[2],10), y = parseInt(m[3],10);
var dt = new Date(y, mo - 1, d);
event.rc = (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d);
if (!event.rc) {
  app.alert("Date invalide : " + v + "\\nFormat attendu : jj/mm/aaaa", 1);
}
`.trim();

  addAA(doc, tf, 'Fo', foJS);
  addAA(doc, tf, 'K',  kJS);
  addAA(doc, tf, 'F',  fJS);
  addAA(doc, tf, 'V',  vJS);
}

// ── EXPORT ──────────────────────────────────────────────────────────────────
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

  // Synchroniser les valeurs des inputs date visibles avant export
  document.querySelectorAll('.date-mask-input').forEach(input => {
    const id = input.closest('.field-el')?.dataset.id;
    const f  = id && S.fields.find(x => x.id === id);
    if (f) {
      const v = input.value;
      f._dateValue = /^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v : '';
    }
  });
  loading('Génération du PDF remplissable...');
  try {
    const doc = await PDFDocument.load(S.pdfBytes.slice());
    const form = doc.getForm();
    const pages = doc.getPages();
    const used = new Set();

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
          const tf = form.createTextField(name);
          tf.addToPage(pg, { x:pdfX, y:pdfY, width:pdfW, height:pdfH, borderWidth:0.7, borderColor:blue, backgroundColor:bg });
          setTextFieldFontSize(doc, tf, fs);
          // Valeur initiale : date saisie dans l'UI ou masque vide
          try {
            const initVal = f._dateValue || 'jj/mm/aaaa';
            tf.acroField.dict.set(PDFLib.PDFName.of('V'),  PDFLib.PDFString.of(initVal));
            tf.acroField.dict.set(PDFLib.PDFName.of('DV'), PDFLib.PDFString.of('jj/mm/aaaa'));
          } catch(e) { /* silencieux */ }
          // Scripts Acrobat AA (masque interactif dans Acrobat Reader / Pro)
          addDatePickerAction(doc, tf, fs);
          if (f.required) tf.enableRequired();

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
        }
      } catch(err) { console.warn('Champ ignoré',name,err.message); }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type:'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'formulaire_modifiable.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
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
