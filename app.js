const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

// Acceso por departamento para el Portal docente. En GitHub Pages este control
// protege la interfaz, pero no sustituye un backend con autenticación real.
const TEACHER_ADMIN_PASSWORD = 'RoyAdmSTN';
// Endpoint público de Google Apps Script para sincronizar prematrículas,
// consultar el panel docente y enviar confirmaciones por correo.
const SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyyeomXgKMvXwOJsZq3bjx56tJ0hRpmZcKJ8V9OAUgAOZdDUOJvpVzyd8WLNEcgJCjE/exec';
const DEPARTMENT_PASSWORDS = Object.freeze({
  'Ciberseguridad': 'STNCiber27!',
  'Contabilidad': 'STNConta27!',
  'Ejecutivo Comercial y Servicio al Cliente': 'STNComercial27!',
  'Mantenimiento de Sistemas de Aire Acondicionado Industrial': 'STNAire27!',
  'Electromecánica': 'STNElectro27!',
  'Diseño de Productos Industriales Textiles': 'STNTextil27!'
});
const teacherAccess = { role: null, specialty: null };
let loadTeacherDatabaseForSession = () => {};
const getDepartmentPasswords = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('stn-department-passwords') || 'null');
    return stored && typeof stored === 'object' ? { ...DEPARTMENT_PASSWORDS, ...stored } : { ...DEPARTMENT_PASSWORDS };
  } catch (_) { return { ...DEPARTMENT_PASSWORDS }; }
};
const allowedTeacherSpecialty = () => teacherAccess.role === 'department' ? teacherAccess.specialty : null;

function nativeRecordToRemotePayload(record) {
  return {
    'Marca temporal': record.createdAt || new Date().toISOString(),
    'Nombre completo y apellidos - Como aparece en la cédula': record.name || '',
    'Cédula o documento de identidad = Formato 0-0000-0000': record.identification || '',
    'Edad': record.age || '',
    'Teléfono Principal = Formato 0000-0000': record.phone || '',
    'Estudios últimos alcanzados': record.education || '',
    'Adjunta el título de noveno año o bachillerato de secundaria obtenido': record.titleFile || '—',
    'Especialidad que desearía matricular para el 2027': record.specialty || '',
    '¿Porque medio se entero de la prematrícula?': record.source || '',
    'Correo electrónico personal': record.email || '',
    'País de origen': record.country || '',
    'Provincia donde vive': record.province || '',
    'Cantón donde vive': record.canton || '',
    'Dirección exacta de su residencia actual': record.address || '',
    'Posee Adecuaciones curriculares de': record.accommodations || '',
    'Es usted madre, padre de familia o encargado de alguien': record.guardian || '',
    'Cuántos hijos tiene': record.children || '',
    'Posee discapacidad': record.disability || '',
    'Estado': record.status || 'Pre-matriculado'
  };
}

const PENDING_SYNC_KEY = 'stn-pending-prematriculas';
function readPendingSync() { try { return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]'); } catch (_) { return []; } }
function writePendingSync(records) { localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(records)); }
function queuePendingSync(record) {
  const pending = readPendingSync();
  if (!pending.some(item => item.createdAt === record.createdAt)) { pending.push(record); writePendingSync(pending); }
}
async function flushPendingSync() {
  if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_') || !navigator.onLine) return;
  const pending = readPendingSync();
  if (!pending.length) return;
  const remaining = [];
  for (const record of pending) {
    try {
      await fetch(SYNC_ENDPOINT, { method: 'POST', mode: 'no-cors', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(nativeRecordToRemotePayload(record)) });
    } catch (_) {
      try {
        const beaconSent = navigator.sendBeacon(SYNC_ENDPOINT, new Blob([JSON.stringify(nativeRecordToRemotePayload(record))], { type: 'text/plain;charset=utf-8' }));
        if (!beaconSent) remaining.push(record);
      } catch (_) { remaining.push(record); }
    }
  }
  writePendingSync(remaining);
}
async function syncPrematriculaToRemote(record) { queuePendingSync(record); await flushPendingSync(); }
window.addEventListener('online', flushPendingSync);
setInterval(flushPendingSync, 30000);

async function deletePrematriculaFromRemote(record) {
  if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) return;
  try {
    await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'delete', identification: record.id || '', name: record.name || '' })
    });
  } catch (_) { /* La eliminación local no se revierte por una falla de red. */ }
}
function deletedRecordKey(record) { return `${String(record.id || '').trim().toLowerCase()}|${String(record.name || '').trim().toLowerCase()}`; }
function getDeletedRecordKeys() { try { return new Set(JSON.parse(localStorage.getItem('stn-deleted-records') || '[]')); } catch (_) { return new Set(); } }
function rememberDeletedRecord(record) { const keys = [...getDeletedRecordKeys(), deletedRecordKey(record)]; localStorage.setItem('stn-deleted-records', JSON.stringify([...new Set(keys)])); }

const menu = $('.menu-toggle');
const nav = $('.main-nav');
document.querySelector('.teams-link')?.remove();
const portalHeading = document.querySelector('.teacher-access h3');
if (portalHeading) portalHeading.textContent = 'Portal docente';
menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', open); menu.textContent = open ? '×' : '☰'; });
$$('.main-nav a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menu.textContent = '☰'; menu.setAttribute('aria-expanded', 'false'); }));

const dialog = $('#curriculum-dialog');
const mallas = {
  'image3.png': ['assets/mallas-2026/image3.png', 'Malla curricular adjunta: Ciberseguridad.'],
  'image4.png': ['assets/mallas-2026/image4.png', 'Malla curricular adjunta: Diseño de Productos Industriales Textiles.'],
  'image5.png': ['assets/mallas-2026/image5.png', 'Malla curricular adjunta: Contabilidad.'],
  'image6.png': ['assets/mallas-2026/image6.png', 'Malla curricular adjunta: Ejecutivo Comercial y Servicio al Cliente.'],
  'image7.png': ['assets/mallas-2026/image7.png', 'Malla curricular de referencia: Electromecánica.'],
  'textiles-2027.png': ['assets/malla-textiles-2027.png', 'Estructura curricular adjunta: Diseño de Productos Industriales Textiles.']
};
$$('.curriculum-trigger').forEach(button => button.addEventListener('click', () => { if (!button.dataset.curriculum) return; const [src, caption] = mallas[button.dataset.curriculum]; $('#curriculum-image').src = src; $('#curriculum-caption').textContent = caption; dialog.showModal(); }));
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

const choices = { electro: 'Opción proyectada: mantenimiento industrial, refrigeración, control y sistemas de aire acondicionado.', moda: 'Opción proyectada: creación, confección, diseño y emprendimiento textil.' };
$$('.choice').forEach(btn => btn.addEventListener('click', () => { $$('.choice').forEach(x => x.classList.remove('active')); btn.classList.add('active'); $('#choice-text').textContent = choices[btn.dataset.option]; }));

$$('[data-date]').forEach(item => { const passed = new Date(`${item.dataset.date}T23:59:00`) < new Date(); if (passed) { item.classList.add('completed'); item.setAttribute('aria-label', 'Fecha cumplida'); item.querySelector('i').textContent = '✓'; } });

const samplePosts = [
  { id: 'welcome', name: 'Equipo STN', initials: 'ST', time: 'Información oficial', text: '¡Bienvenidas y bienvenidos! Usá este espacio para consultar sobre el proceso de admisión 2027.', likes: 14 },
  { id: 'guide', name: 'Orientación STN', initials: 'OR', time: 'Hace poco', text: 'Recordá completar la prematrícula y reservar tu cita para entrevista o examen.', likes: 8 }
];
function loadPosts() { return JSON.parse(localStorage.getItem('stn-posts') || 'null') || samplePosts; }
function savePosts(posts) { localStorage.setItem('stn-posts', JSON.stringify(posts)); }
function renderPosts() {
  const posts = loadPosts();
  $('#feed').innerHTML = posts.map(post => `<article class="post"><div class="post-meta"><span class="avatar">${post.initials}</span><div><b>${post.name}</b><small>${post.time}</small></div></div><p class="post-body">${escapeHtml(post.text)}</p><div class="post-actions"><button class="like-button ${post.liked ? 'liked' : ''}" data-id="${post.id}">♡ ${post.likes || 0} Me interesa</button><button type="button">◌ Consultar</button></div></article>`).join('');
  $$('.like-button').forEach(button => button.addEventListener('click', () => { const items = loadPosts(); const post = items.find(x => x.id === button.dataset.id); post.liked = !post.liked; post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1)); savePosts(items); renderPosts(); }));
}

// Mejoras institucionales: dashboard general, base persistente del repositorio y buzón identificado.
setTimeout(() => {
const endTeacherArea = $('.teacher-section'), teacherAgendaSection = $('.agenda-section');
if (endTeacherArea && teacherAgendaSection) { endTeacherArea.parentNode.insertBefore(teacherAgendaSection, endTeacherArea); teacherAgendaSection.classList.add('teacher-agenda-end'); endTeacherArea.classList.add('teacher-portal-end'); }
const institutional = $('.teacher-section');
const teacherCopy = $('.teacher-copy');
const teacherAgendaGeneral = $('.teacher-agenda');
// El dashboard institucional se mantiene disponible dentro del portal docente;
// se omite el botón público «Datos generales» para mantener el acceso discreto.
$('#doc-upload')?.closest('.upload-label')?.remove();
const generalDashboard = $('#database-summary');
window.addEventListener('stn-prematricula-saved', event => {
  if (!generalDashboard || typeof generalState === 'undefined' || typeof prepareGeneralRecords !== 'function') return;
  const native = event.detail ? [event.detail] : JSON.parse(localStorage.getItem('stn-prematriculas') || '[]');
  const toRaw = record => ({ __nativeKey: record.createdAt || `${record.identification}-${record.name}`, 'Marca temporal': record.createdAt || '', 'Nombre completo y apellidos - Como aparece en la cédula': record.name || '', 'Cédula o documento de identidad = Formato 0-0000-0000': record.identification || '', Edad: record.age || '', 'Teléfono Principal = Formato 0000-0000': record.phone || '', 'Estudios últimos alcanzados': record.education || '', 'Adjunta el título de noveno año o bachillerato de secundaria obtenido': record.titleFile || '—', 'Especialidad que desearía matricular para el 2027': record.specialty || '', '¿Porque medio se entero de la prematrícula?': record.source || '', 'Correo electrónico personal': record.email || '', 'País de origen': record.country || '', 'Provincia donde vive': record.province || '', 'Cantón donde vive': record.canton || '', 'Dirección exacta de su residencia actual': record.address || '', 'Posee Adecuaciones curriculares de': record.accommodations || '', 'Es usted madre, padre de familia o encargado de alguien': record.guardian || '', 'Cuántos hijos tiene': record.children || '', 'Posee discapacidad': record.disability || '', Estado: record.status || 'Pre-matriculado' });
  const existingKeys = new Set(generalState.records.map(record => record.raw.__nativeKey).filter(Boolean));
  const additions = native.filter(record => !existingKeys.has(record.createdAt || `${record.identification}-${record.name}`)).map(toRaw);
  if (additions.length) { generalState.records = prepareGeneralRecords([...generalState.records.map(record => record.raw), ...additions]); renderGeneralDashboard(); }
});
window.addEventListener('storage', event => { if (event.key === 'stn-prematriculas') window.dispatchEvent(new CustomEvent('stn-prematricula-saved')); });
if (generalDashboard) {
  generalDashboard.innerHTML = '<div class="general-dashboard-head"><div><span class="eyebrow"><span></span> Datos generales</span><h3>Resumen de prematrícula y matrícula</h3><p>Base institucional sincronizada · docentes consultan y administración gestiona registros</p></div><span class="status-pill">Actualizable por administración</span></div><div class="database-summary-cards"><div><b id="db-total">0</b><span>Total de registros</span></div><div><b id="db-visible">0</b><span>Registros filtrados</span></div><div><b id="db-duplicates">0</b><span>Duplicados</span></div></div><div class="specialty-metrics" id="specialty-metrics"></div><div class="duplicate-list" id="duplicate-list"></div><div class="database-table-wrap"><table class="database-table"><thead><tr><th>Estudiante</th><th>Identificación</th><th>Especialidad</th><th>Correo / contacto</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="csv-table-body"><tr><td colspan="6">Cargando base institucional…</td></tr></tbody></table></div><p id="db-source" class="database-source">La base se actualiza mediante el servicio de sincronización institucional.</p>';
  const generalState = { records: [], filter: 'Todas' };
  function parseCsvGeneral(text) { const rows = [], row = []; let cell = '', quoted = false; for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row.splice(0)); cell = ''; } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim()); return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))); }
  function getGeneralField(record, matcher) { const k = Object.keys(record).find(key => matcher.test(key)); return k ? record[k] : ''; }
  function normalizeGeneralSpecialty(value) { const v = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (v.includes('refriger') || v.includes('aire acondicionado')) return 'Mantenimiento de Sistemas de Aire Acondicionado Industrial'; if (v.includes('ciber')) return 'Ciberseguridad'; if (v.includes('contab')) return 'Contabilidad'; if (v.includes('comercial') || v.includes('servicio al cliente')) return 'Ejecutivo Comercial y Servicio al Cliente'; if (v.includes('textil') || v.includes('diseño de productos')) return 'Diseño de Productos Industriales Textiles'; if (v.includes('electrom')) return 'Electromecánica'; return value || 'Sin especialidad'; }
  function prepareGeneralRecords(raw) { const records = raw.map((r, index) => ({ raw: r, index, name: getGeneralField(r, /nombre completo/i) || 'Sin nombre', id: getGeneralField(r, /cedula|documento de identidad/i), email: getGeneralField(r, /correo electr/i), phone: getGeneralField(r, /telefono principal/i), specialty: normalizeGeneralSpecialty(getGeneralField(r, /especialidad.*matricular/i)), province: getGeneralField(r, /provincia/i), canton: getGeneralField(r, /canton/i) })); const groups = {}; records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(); (groups[key] ||= []).push(r); }); records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(), group = groups[key] || []; r.duplicateSpecialties = [...new Set(group.map(x => x.specialty))]; r.duplicate = group.length > 1; }); return records; }
  function renderGeneralDashboard() { const activeFilter = allowedTeacherSpecialty() || generalState.filter; const rows = generalState.records.filter(r => activeFilter === 'Todas' || r.specialty === activeFilter), counts = {}; generalState.records.forEach(r => { counts[r.specialty] = (counts[r.specialty] || 0) + 1; }); $('#db-total').textContent = generalState.records.length; $('#db-visible').textContent = rows.length; $('#db-duplicates').textContent = rows.filter(r => r.duplicate).length; $('#specialty-metrics').innerHTML = Object.entries(counts).filter(([name]) => !allowedTeacherSpecialty() || name === allowedTeacherSpecialty()).map(([name, count]) => `<button class="metric-card ${activeFilter === name ? 'active' : ''}" data-metric="${escapeHtml(name)}"><b>${count}</b><span>${escapeHtml(name)}</span></button>`).join(''); const duplicateGroups = rows.filter(r => r.duplicate && r.duplicateSpecialties.length > 1); $('#duplicate-list').innerHTML = duplicateGroups.length ? `<h4>Estudiantes con matrícula o prematrícula en más de una especialidad</h4>${duplicateGroups.map(r => `<span class="duplicate-chip">${escapeHtml(r.name)} · ${escapeHtml(r.duplicateSpecialties.join(' / '))}</span>`).join('')}` : '<h4>Duplicados</h4><p>No se detectan duplicados en el filtro actual.</p>'; $('#csv-table-body').innerHTML = rows.length ? rows.map(r => `<tr class="${r.duplicate ? 'is-duplicate' : ''}"><td><b>${escapeHtml(r.name)}</b><details><summary>Todos los datos</summary><dl>${Object.entries(r.raw).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || '—')}</dd>`).join('')}</dl></details></td><td>${escapeHtml(r.id || '—')}</td><td>${escapeHtml(r.specialty)}</td><td><a href="mailto:${encodeURIComponent(r.email)}">${escapeHtml(r.email || '—')}</a><small>${escapeHtml(r.phone || '')}</small></td><td>${r.duplicate ? `<span class="duplicate-badge">Duplicado en: ${escapeHtml(r.duplicateSpecialties.join(' / '))}</span>` : '<span class="ok-badge">Registro único</span>'}</td><td><button class="table-action" data-general-record="${r.index}" type="button">Agendar</button></td></tr>`).join('') : '<tr><td colspan="6">No hay registros para este filtro.</td></tr>'; $$('.metric-card', generalDashboard).forEach(card => card.addEventListener('click', () => { if (!allowedTeacherSpecialty()) generalState.filter = card.dataset.metric; renderGeneralDashboard(); })); $$('.table-action', generalDashboard).forEach(button => button.addEventListener('click', () => { const r = generalState.records.find(x => x.index === Number(button.dataset.generalRecord)); if (!r || (allowedTeacherSpecialty() && r.specialty !== allowedTeacherSpecialty())) return; $('#teacher-candidate').value = r.name; $('#teacher-candidate-email').value = r.email; $('#teacher-candidate-contact').value = r.phone; $('#teacher-specialty').value = r.specialty; teacherAgendaGeneral?.scrollIntoView({ behavior: 'smooth', block: 'center' }); })); }
  const renderGeneralDashboardBase = renderGeneralDashboard;
  function installAdminDeleteControls() {
    if (teacherAccess.role !== 'admin') return;
    $$('.table-action', generalDashboard).forEach(button => {
      const cell = button.closest('td');
      if (!cell || cell.querySelector('.table-delete')) return;
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'table-delete';
      removeButton.textContent = 'Eliminar';
      removeButton.addEventListener('click', () => {
        const record = generalState.records.find(item => item.index === Number(button.dataset.generalRecord));
        if (!record) return;
        const confirmed = window.confirm(`¿Confirmás eliminar a ${record.name} de la base de prematrícula? Esta acción no se puede deshacer.`);
        if (!confirmed) return;
        const timestamp = record.raw['Marca temporal'] || '';
        const localRecords = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]');
        localStorage.setItem('stn-prematriculas', JSON.stringify(localRecords.filter(item => !(item.identification === record.id && item.name === record.name && (!timestamp || item.createdAt === timestamp)))));
        const students = getStudents();
        localStorage.setItem('stn-students', JSON.stringify(students.filter(item => item.identification !== record.id || item.name !== record.name)));
        generalState.records = generalState.records.filter(item => item !== record);
        rememberDeletedRecord(record);
        deletePrematriculaFromRemote(record);
        renderGeneralDashboard();
        $('#db-source').textContent = `Registro eliminado por administración · ${generalState.records.length} registros restantes`;
      });
      cell.append(removeButton);
    });
  }
  renderGeneralDashboard = function () { renderGeneralDashboardBase(); installAdminDeleteControls(); };

  function loadRemotePrematriculas() {
    if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) return;
    window.stnReceiveRemoteDatabase = payload => {
      if (!payload?.ok || !Array.isArray(payload.rows)) return;
      const headers = payload.headers || [];
      const remoteRaw = payload.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
      const deletedKeys = getDeletedRecordKeys();
      generalState.records = prepareGeneralRecords(remoteRaw).filter(record => !deletedKeys.has(deletedRecordKey(record)));
      renderGeneralDashboard();
      $('#db-source').textContent = `Base sincronizada en tiempo real · ${generalState.records.length} registros · hoja de respuestas de Google`;
    };
    const script = document.createElement('script');
    script.src = `${SYNC_ENDPOINT}?callback=stnReceiveRemoteDatabase&_=${Date.now()}`;
    script.onload = () => script.remove();
    script.onerror = () => script.remove();
    document.body.append(script);
  }
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.data?.type !== 'stn-prematricula-saved') return;
    loadRemotePrematriculas();
    loadTeacherDatabaseForSession?.();
  });
  async function loadRepositoryDatabase() { try { const imported = localStorage.getItem('stn-imported-csv'); let csvText = imported; if (!csvText) { const response = await fetch('data/base-datos-2026.csv?v=20261006-database-128'); if (!response.ok) throw new Error('No se pudo cargar la base'); csvText = await response.text(); } generalState.records = prepareGeneralRecords(parseCsvGeneral(csvText)); renderGeneralDashboard(); $('#db-source').textContent = `${imported ? 'Base importada en este dispositivo' : 'Base institucional'} · ${generalState.records.length} registros · solo lectura`; loadRemotePrematriculas(); } catch (error) { $('#db-source').textContent = 'No fue posible cargar la base institucional. Verificá la conexión y el último commit.'; } }
  if (SYNC_ENDPOINT && !SYNC_ENDPOINT.includes('PASTE_')) setInterval(loadRemotePrematriculas, 30000);
  $$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { generalState.filter = tab.dataset.specialty; renderGeneralDashboard(); }));
  $('#teacher-login')?.addEventListener('submit', () => setTimeout(loadRepositoryDatabase, 250));
  if (sessionStorage.getItem('stn-teacher-session')) loadRepositoryDatabase();
  document.querySelector('.nav-lock')?.addEventListener('click', () => setTimeout(loadRepositoryDatabase, 250));
  renderGeneralDashboard();
}

// Buzón identificado con respuesta manual y asistente IA contextual por consulta.
const communityForm = $('#post-form'), communityFeed = $('#feed');
if (communityForm && communityFeed) {
  const registration = document.createElement('div'); registration.className = 'community-registration'; registration.innerHTML = '<label>Nombre<input id="community-name" placeholder="Tu nombre" required></label><label>Correo<input id="community-email" type="email" placeholder="tu@correo.com" required></label>'; communityForm.prepend(registration);
  const freshForm = communityForm.cloneNode(true); communityForm.replaceWith(freshForm);
  const form = $('#post-form');
  renderPosts = function () { const posts = loadPosts(); $('#feed').innerHTML = posts.map(post => `<article class="post" data-post-id="${escapeHtml(post.id)}"><div class="post-meta"><span class="avatar">${escapeHtml(post.initials || 'CV')}</span><div><b>${escapeHtml(post.name || 'Consulta')}</b><small>${escapeHtml(post.email || '')} · ${escapeHtml(post.time || 'Ahora')}</small></div></div><p class="post-body">${escapeHtml(post.text)}</p>${(post.replies || []).map(reply => `<div class="post-reply"><b>${escapeHtml(reply.author)}</b><span>${escapeHtml(reply.text)}</span></div>`).join('')}<div class="post-actions"><button class="like-button ${post.liked ? 'liked' : ''}" data-id="${escapeHtml(post.id)}">♡ ${post.likes || 0} Me interesa</button><button class="reply-post" data-id="${escapeHtml(post.id)}">Responder</button><button class="ai-post" data-id="${escapeHtml(post.id)}">✦ Asistente IA</button></div></article>`).join(''); $$('.like-button', communityFeed).forEach(button => button.addEventListener('click', () => { const items = loadPosts(), post = items.find(x => x.id === button.dataset.id); post.liked = !post.liked; post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1)); savePosts(items); renderPosts(); })); };
  form.addEventListener('input', e => { if (e.target.id === 'post-text') $('.character-count', form).textContent = `${e.target.value.length} / 400`; });
  form.addEventListener('submit', e => { e.preventDefault(); const name = $('#community-name').value.trim(), email = $('#community-email').value.trim(), text = $('#post-text').value.trim(); if (!name || !email || !text) return; const posts = loadPosts(); posts.unshift({ id: Date.now().toString(), name, email, initials: name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(), time: 'Ahora', text, likes: 0, replies: [] }); savePosts(posts); form.reset(); $('.character-count', form).textContent = '0 / 400'; renderPosts(); });
  communityFeed.addEventListener('click', e => { const button = e.target.closest('.reply-post,.ai-post'); if (!button) return; const posts = loadPosts(), post = posts.find(x => x.id === button.dataset.id); if (!post) return; const isAi = button.classList.contains('ai-post'), reply = isAi ? assistantReply(post.text) : prompt(`Responder a ${post.name}:`); if (!reply?.trim()) return; (post.replies ||= []).push({ author: isAi ? 'Asistente IA STN' : 'Equipo STN', text: reply.trim() }); savePosts(posts); renderPosts(); });
  renderPosts();
}
}, 0);
setTimeout(() => { if (localStorage.getItem('stn-prematriculas')) window.dispatchEvent(new CustomEvent('stn-prematricula-saved')); }, 1800);
function escapeHtml(text) { const el = document.createElement('div'); el.textContent = text; return el.innerHTML; }
const postText = $('#post-text');
postText.addEventListener('input', () => $('.character-count').textContent = `${postText.value.length} / 400`);
$('#post-form').addEventListener('submit', e => { e.preventDefault(); const text = postText.value.trim(); if (!text) return; const posts = loadPosts(); posts.unshift({ id: Date.now().toString(), name: 'Consulta de visitante', initials: 'CV', time: 'Ahora', text, likes: 0 }); savePosts(posts); postText.value = ''; $('.character-count').textContent = '0 / 400'; renderPosts(); });
renderPosts();

function getStudents() { return JSON.parse(localStorage.getItem('stn-students') || '[]'); }
function getDocs() { return JSON.parse(localStorage.getItem('stn-documents') || '[]'); }
function getAppointments() { return JSON.parse(localStorage.getItem('stn-appointments') || '[]'); }
function renderAppointments(filter = 'Todas') { const admin = teacherAccess.role === 'admin', activeFilter = allowedTeacherSpecialty() || (admin ? 'Todas' : filter); const list = getAppointments().filter(a => activeFilter === 'Todas' || a.specialty === activeFilter); const title = $('#appointments-title'); if (title) title.textContent = admin ? 'Todas las citas reservadas' : `Citas de ${activeFilter}`; $('#appointments-list').innerHTML = list.length ? list.map(a => `<div class="appointment-row"><div><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.specialty)} · ${escapeHtml(a.type)} · Prof. ${escapeHtml(a.professor || 'Por asignar')}</small></div><strong>${escapeHtml(a.date)} · ${escapeHtml(a.time)}</strong></div>`).join('') : `<p>${admin ? 'No hay citas reservadas.' : 'No hay citas para esta especialidad.'}</p>`; }
function updateDashboard() {
  const students = getStudents(), docs = getDocs(), appointments = getAppointments();
  $('#pre-count').textContent = students.filter(s => s.status === 'Pre-matriculado').length; $('#mat-count').textContent = students.filter(s => s.status === 'Matriculado').length; $('#doc-count').textContent = docs.length; $('#appointment-count').textContent = appointments.length;
  $('#student-table').innerHTML = '<tr class="empty-row"><td colspan="4">Los registros completos se muestran en la base institucional detallada.</td></tr>';
  $('#documents-list').innerHTML = docs.length ? docs.map(d => `<div class="document-item"><span>▧ ${escapeHtml(d.name)}</span><small>${d.date}</small></div>`).join('') : '<p>Los documentos cargados aparecerán aquí.</p>';
  renderAppointments($('.specialty-tab.active')?.dataset.specialty || 'Todas');
}
const teacherSection = document.querySelector('.teacher-section');
const teacherLogin = $('#teacher-login');
const teacherDashboard = $('#teacher-dashboard');
const teacherDepartmentNames = Object.keys(DEPARTMENT_PASSWORDS);
const teacherGate = document.createElement('div');
teacherGate.className = 'teacher-entry-gate';
teacherGate.innerHTML = '<span class="lock-mark">⌁</span><h3>Acceso restringido al personal docente</h3><p>El portal, la base de datos y la agenda no son públicos.</p><button class="btn btn-primary" id="open-teacher-login" type="button">Ingresar al portal docente</button><small>Se requiere la clave del departamento o la clave administrativa.</small>';
if (teacherLogin) { teacherLogin.before(teacherGate); teacherLogin.classList.add('hidden'); teacherSection?.classList.add('teacher-locked'); }
$('#open-teacher-login')?.addEventListener('click', () => { teacherGate.classList.add('hidden'); teacherLogin?.classList.remove('hidden'); $('#teacher-password')?.focus(); });
const teacherDepartmentSelect = document.createElement('select');
teacherDepartmentSelect.id = 'teacher-department';
teacherDepartmentSelect.required = true;
teacherDepartmentSelect.innerHTML = teacherDepartmentNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
const departmentLabel = document.createElement('label');
departmentLabel.className = 'teacher-department-label';
departmentLabel.innerHTML = 'Departamento técnico';
departmentLabel.append(teacherDepartmentSelect);
const passwordLabel = $('#teacher-password')?.closest('label');
if (passwordLabel && !$('#teacher-department')) passwordLabel.before(departmentLabel);
if (teacherLogin && !$('.teacher-login-note', teacherLogin)) { const note = document.createElement('small'); note.className = 'teacher-login-note'; note.textContent = 'Cada departamento utiliza su propia contraseña. El administrador tiene acceso total.'; passwordLabel?.after(note); }

let adminPasswordPanel = $('#admin-password-panel'), adminPasswordToggle = $('#admin-password-toggle');
if (teacherDashboard && !adminPasswordPanel) {
  adminPasswordToggle = document.createElement('button');
  adminPasswordToggle.id = 'admin-password-toggle';
  adminPasswordToggle.className = 'admin-password-toggle hidden';
  adminPasswordToggle.type = 'button';
  adminPasswordToggle.setAttribute('aria-expanded', 'false');
  adminPasswordToggle.textContent = '▸ Contraseñas por departamento';
  $('#specialty-tabs', teacherDashboard)?.after(adminPasswordToggle);
  adminPasswordPanel = document.createElement('section');
  adminPasswordPanel.id = 'admin-password-panel';
  adminPasswordPanel.className = 'admin-password-panel hidden';
  adminPasswordPanel.innerHTML = '<div class="admin-password-head"><div><span class="eyebrow"><span></span> Administración</span><h3>Contraseñas por departamento</h3><p>Solo el administrador puede visualizar y cambiar estas claves.</p></div><span class="status-pill">Acceso total</span></div><div id="department-password-list" class="department-password-list"></div><p id="password-admin-message" class="form-message" role="status"></p>';
  $('#specialty-tabs', teacherDashboard)?.after(adminPasswordPanel);
  adminPasswordToggle.addEventListener('click', () => { const open = adminPasswordPanel.classList.toggle('hidden'); adminPasswordToggle.setAttribute('aria-expanded', String(!open)); adminPasswordToggle.textContent = `${open ? '▸' : '▾'} Contraseñas por departamento`; });
}
function renderAdminPasswords() {
  if (!adminPasswordPanel) return;
  const list = $('#department-password-list', adminPasswordPanel), passwords = getDepartmentPasswords();
  list.innerHTML = teacherDepartmentNames.map(name => `<div class="department-password-row"><label>${escapeHtml(name)}<input type="text" value="${escapeHtml(passwords[name] || '')}" data-department-password="${escapeHtml(name)}" autocomplete="off"></label><button type="button" class="text-button save-department-password" data-department="${escapeHtml(name)}">Guardar</button></div>`).join('');
  $$('.save-department-password', adminPasswordPanel).forEach(button => button.addEventListener('click', () => { const input = $(`[data-department-password="${CSS.escape(button.dataset.department)}"]`, adminPasswordPanel); const value = input?.value.trim(); if (!value) return; const updated = getDepartmentPasswords(); updated[button.dataset.department] = value; localStorage.setItem('stn-department-passwords', JSON.stringify(updated)); $('#password-admin-message', adminPasswordPanel).textContent = `✓ Contraseña actualizada para ${button.dataset.department}.`; }));
}
function installPrematriculaPanel() {
  if (!teacherDashboard || $('#prematricula-panel', teacherDashboard)) return;
  const actions = $('.dashboard-actions', teacherDashboard);
  if (!actions) return;
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.id = 'open-prematricula'; trigger.textContent = '＋ Ingresar prematrícula'; actions.prepend(trigger);
  const panel = document.createElement('section'); panel.id = 'prematricula-panel'; panel.className = 'native-prematricula-panel hidden';
  panel.innerHTML = '<div class="native-prematricula-head"><div><span class="eyebrow"><span></span> Registro interno</span><h3>Prematrícula o matrícula de estudiante</h3><p>La información completa queda guardada y sincronizada con la base institucional.</p></div><button type="button" class="text-button" id="close-prematricula">Cerrar</button></div><div class="native-form-notice"><b>Información para la persona encargada</b><span>Completá todos los datos con base en la cédula y los documentos presentados.</span></div><form id="native-prematricula-form" class="native-prematricula-form"><label>Nombre completo y apellidos<input name="name" required placeholder="Como aparece en la cédula"></label><label>Cédula o documento de identidad<input name="identification" required placeholder="0-0000-0000"></label><label>Edad<input name="age" type="number" min="14" max="99" required></label><label>Teléfono principal<input name="phone" required placeholder="0000-0000"></label><label>Estudios últimos alcanzados<select name="education" required><option value="">Seleccioná una opción</option><option>Noveno año de Secundaria</option><option>Bachiller de Secundaria</option><option>Graduado de Técnico Medio</option><option>Diplomado Universitario</option><option>Bachiller Universitario</option><option>Licenciado(a)</option></select></label><label>Adjuntar título de noveno o bachillerato<input name="titleFile" type="file" accept=".pdf,image/*"></label><label>Especialidad que desea matricular<select name="specialty" required><option value="">Seleccioná una especialidad</option><option>Ciberseguridad</option><option>Electromecánica</option><option>Mantenimiento de Sistemas de Aire Acondicionado Industrial</option><option>Diseño de Productos Industriales Textiles</option><option>Ejecutivo Comercial y Servicio al Cliente</option><option>Contabilidad</option></select></label><label>Estado del registro<select name="status" required><option>Pre-matriculado</option><option>Matriculado</option></select></label><label>¿Por qué medio se enteró?<select name="source" required><option value="">Seleccioná una opción</option><option>Open House</option><option>Página Facebook de la Sección Técnica Nocturna</option><option>Redes sociales</option><option>Amigos o conocidos</option></select></label><label>Correo electrónico personal<input name="email" type="email" required placeholder="estudiante@correo.com"></label><label>País de origen<select name="country" required><option>Costa Rica</option><option>Nicaragua</option><option>Venezuela</option><option>Colombia</option><option>Otro</option></select></label><label>Provincia donde vive<select name="province" required><option>San José</option><option>Heredia</option><option>Alajuela</option><option>Cartago</option></select></label><label>Cantón donde vive<select name="canton" required><option>Central</option><option>San José</option><option>Escazú</option><option>Desamparados</option><option>Goicoechea</option><option>Alajuelita</option><option>Vásquez de Coronado</option><option>Tibás</option><option>Moravia</option><option>Montes de Oca</option><option>Curridabat</option><option>Otro</option></select></label><label class="full-field">Dirección exacta de su residencia actual<textarea name="address" rows="2" required></textarea></label><label>Posee adecuaciones curriculares<select name="accommodations" required><option>No tengo adecuaciones</option><option>Adecuaciones de acceso</option><option>Adecuaciones no significativas</option><option>Adecuaciones significativas</option></select></label><label>¿Es madre, padre o encargado?<select name="guardian" required><option>Si</option><option>No</option></select></label><label>¿Cuántos hijos tiene?<select name="children" required><option>1-2</option><option>3-4</option><option>Más de 4</option><option>No tengo hijos</option></select></label><label>Posee discapacidad<select name="disability" required><option>Ninguna</option><option>Sensorial visual</option><option>Sensorial auditiva</option><option>Motriz</option><option>Otra</option></select></label><div class="native-prematricula-footer full-field"><b>Nota importante</b><span>Cuando el registro sea matriculado, todos sus datos permanecerán en la base institucional para consulta y seguimiento.</span></div><button class="btn btn-primary full-field" type="submit">Guardar registro completo en el sistema <span>→</span></button><p class="form-message full-field" id="native-prematricula-message" role="status"></p></form>';
  actions.after(panel);
  trigger.addEventListener('click', () => { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#close-prematricula', panel).addEventListener('click', () => panel.classList.add('hidden'));
  $('#native-prematricula-form', panel).addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form).entries()), file = form.querySelector('[name="titleFile"]')?.files?.[0]; const record = { ...values, titleFile: file?.name || '', status: values.status || 'Pre-matriculado', createdAt: new Date().toISOString() }; const records = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]'); records.unshift(record); localStorage.setItem('stn-prematriculas', JSON.stringify(records)); const students = getStudents(); students.unshift({ name: values.name, contact: values.phone || values.email, specialty: values.specialty, status: record.status, identification: values.identification, email: values.email }); localStorage.setItem('stn-students', JSON.stringify(students)); updateDashboard(); const statusMessage = $('#native-prematricula-message', panel); statusMessage.textContent = `✓ Todos los datos de ${values.name} fueron guardados en el sistema. Sincronizando con la base institucional…`; statusMessage.classList.remove('error'); syncPrematriculaToRemote(record).then(() => { const pending = readPendingSync().some(item => item.createdAt === record.createdAt); statusMessage.textContent = pending ? `✓ Datos guardados para ${values.name}. Quedaron pendientes de sincronización y se reintentará automáticamente.` : `✓ Confirmado: todos los datos de ${values.name} fueron guardados y enviados a la base institucional.`; }); form.reset(); });
  $('#native-prematricula-form', panel).addEventListener('submit', () => setTimeout(() => { const saved = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]')[0]; if (saved) window.dispatchEvent(new CustomEvent('stn-prematricula-saved', { detail: saved })); }, 0));
  if (localStorage.getItem('stn-prematriculas')) window.dispatchEvent(new CustomEvent('stn-prematricula-saved'));
}
function applyTeacherAccess() {
  const admin = teacherAccess.role === 'admin', specialty = allowedTeacherSpecialty();
  const roleLabel = $('.dashboard-head b', teacherDashboard);
  if (roleLabel) roleLabel.textContent = admin ? 'Portal docente · Administrador' : `Portal docente · ${specialty}`;
  $$('.specialty-tab', teacherDashboard).forEach(tab => { const visible = admin || tab.dataset.specialty === specialty; tab.classList.toggle('hidden', !visible); tab.classList.toggle('active', admin ? tab.dataset.specialty === 'Todas' : tab.dataset.specialty === specialty); });
  const specialtySelect = $('#teacher-specialty');
  if (specialtySelect) { if (specialty) specialtySelect.value = specialty; specialtySelect.disabled = Boolean(specialty); }
  const csvImportControl = $('#csv-import-control');
  csvImportControl?.classList.toggle('hidden', !admin);
  const exportDatabaseControl = $('#export-database');
  exportDatabaseControl?.classList.toggle('hidden', !admin);
  adminPasswordToggle?.classList.toggle('hidden', !admin);
  if (!admin) { adminPasswordPanel?.classList.add('hidden'); adminPasswordToggle?.setAttribute('aria-expanded', 'false'); if (adminPasswordToggle) adminPasswordToggle.textContent = '▸ Contraseñas por departamento'; }
  if (admin) renderAdminPasswords();
  renderAppointments(specialty || $('.specialty-tab.active')?.dataset.specialty || 'Todas');
}
function enterTeacherPortal(role, specialty = null) {
  teacherAccess.role = role; teacherAccess.specialty = specialty;
  installPrematriculaPanel();
  teacherGate?.classList.add('hidden'); teacherLogin?.classList.add('hidden'); teacherDashboard?.classList.remove('hidden'); teacherSection?.classList.remove('teacher-locked'); setTeacherPortalState(true); applyTeacherAccess();
  sessionStorage.setItem('stn-teacher-session', JSON.stringify({ role, specialty }));
  updateDashboard();
  loadTeacherDatabaseForSession();
}
const setTeacherPortalState = active => { if (!teacherSection) return; teacherSection.classList.toggle('teacher-portal-active', active); teacherSection.style.gridTemplateColumns = active ? '1fr' : ''; const copy = teacherSection.querySelector('.teacher-copy'); const access = teacherSection.querySelector('.teacher-access'); const note = teacherSection.querySelector('.security-note'); if (active) { copy?.style.setProperty('grid-column', '1 / -1'); access?.style.setProperty('grid-column', '1 / -1'); note?.style.setProperty('grid-column', '1 / -1'); } else { copy?.style.removeProperty('grid-column'); access?.style.removeProperty('grid-column'); note?.style.removeProperty('grid-column'); } };
teacherLogin?.addEventListener('submit', e => { e.preventDefault(); const message = $('#login-message'), password = $('#teacher-password')?.value || '', specialty = teacherDepartmentSelect.value, passwords = getDepartmentPasswords(); message.classList.remove('error'); if (password === TEACHER_ADMIN_PASSWORD) enterTeacherPortal('admin'); else if (passwords[specialty] === password) enterTeacherPortal('department', specialty); else { message.textContent = 'Contraseña incorrecta para este departamento.'; message.classList.add('error'); } });
try { const saved = JSON.parse(sessionStorage.getItem('stn-teacher-session') || 'null'); if (saved?.role === 'admin' || (saved?.role === 'department' && teacherDepartmentNames.includes(saved.specialty))) enterTeacherPortal(saved.role, saved.specialty); } catch (_) { sessionStorage.removeItem('stn-teacher-session'); }
$('#logout')?.addEventListener('click', () => { sessionStorage.removeItem('stn-teacher-session'); teacherAccess.role = null; teacherAccess.specialty = null; teacherDashboard?.classList.add('hidden'); teacherLogin?.classList.add('hidden'); teacherGate?.classList.remove('hidden'); teacherSection?.classList.add('teacher-locked'); setTeacherPortalState(false); $('#teacher-password').value = ''; applyTeacherAccess(); });
$('#add-student').addEventListener('click', () => { const nativeTrigger = $('#open-prematricula'); if (nativeTrigger) nativeTrigger.click(); else $('#native-prematricula-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#doc-upload').addEventListener('change', e => { const docs = getDocs(); [...e.target.files].forEach(file => docs.unshift({ name: file.name, date: new Date().toLocaleDateString('es-CR') })); localStorage.setItem('stn-documents', JSON.stringify(docs)); e.target.value = ''; updateDashboard(); });
$('#save-appointment').addEventListener('click', () => { const specialty = $('#teacher-specialty').value, type = $('#teacher-appointment-type').value, date = $('#teacher-appointment-date').value, time = $('#teacher-appointment-time').value, name = $('#teacher-candidate').value.trim(), email = $('#teacher-candidate-email').value.trim(), professor = $('#teacher-professor').value.trim(), contact = $('#teacher-candidate-contact').value.trim(), message = $('#teacher-appointment-message'); if (!date || !name || !email || !professor) { message.textContent = 'Completá estudiante, correo, profesor y fecha para guardar.'; message.classList.add('error'); return; } const appointment = { specialty, type, date, time, name, email, professor, contact }; const appointments = getAppointments(); appointments.push(appointment); localStorage.setItem('stn-appointments', JSON.stringify(appointments)); const subject = encodeURIComponent(`Confirmación de cita STN · ${date} · ${time}`); const body = encodeURIComponent(`Hola ${name},\n\nConfirmamos tu cita de ${type.toLowerCase()} en la Sección Técnica Nocturna.\n\nFecha: ${date}\nHora: ${time}\nEspecialidad: ${specialty}\nProfesor a cargo: ${professor}\n\nPara consultas: 6195-5775.`); message.classList.remove('error'); message.innerHTML = `✓ Cita guardada. <a class="confirmation-link" href="mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}">Abrir correo de confirmación para enviar ↗</a>`; $('#teacher-candidate').value = ''; $('#teacher-candidate-email').value = ''; $('#teacher-professor').value = ''; $('#teacher-candidate-contact').value = ''; updateDashboard(); });
$$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { $$('.specialty-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); renderAppointments(tab.dataset.specialty); }));
$('#edit-ticker').addEventListener('click', () => { const message = prompt('Mensaje institucional visible para la comunidad:', localStorage.getItem('stn-ticker') || $('#ticker-message').textContent); if (message?.trim()) { localStorage.setItem('stn-ticker', message.trim()); $('#ticker-message').textContent = message.trim(); } });
$('#ticker-message').textContent = localStorage.getItem('stn-ticker') || $('#ticker-message').textContent;

const assistantReplies = [
  { keys: ['prematr', 'formulario', 'inscrib', 'inscrip'], text: 'La prematrícula 2027 se completa en el formulario oficial. Usá el botón “Prematrícula 2027” o escribinos por WhatsApp al 6195-5775.' },
  { keys: ['especial', 'oferta', 'carrera', 'ciber', 'contab', 'comercial', 'aire', 'electrom', 'textil', 'diseño'], text: 'La oferta 2027 incluye Ciberseguridad, Contabilidad, Ejecutivo Comercial y Servicio al Cliente, Mantenimiento de Sistemas de Aire Acondicionado Industrial, Electromecánica y Diseño de Productos Industriales Textiles.' },
  { keys: ['hora', 'horario', 'noche', 'cita', 'examen', 'entrevista'], text: 'Las citas de entrevista y examen las administra cada docente desde el Portal para docentes, de lunes a viernes, entre las 6:00 p. m. y las 9:00 p. m.' },
  { keys: ['whatsapp', 'teléfono', 'telefono', 'contacto', 'ubicación', 'ubicacion'], text: 'Podés contactarnos por WhatsApp al 6195-5775. También encontrás el enlace directo en la página.' },
  { keys: ['docente', 'portal', 'teams'], text: 'El Portal para docentes está protegido y contiene una pestaña por especialidad, agenda, registros y documentos informativos.' }
];
function assistantReply(question) { const q = question.toLowerCase(); const found = assistantReplies.find(item => item.keys.some(key => q.includes(key))); return found?.text || 'Puedo orientarte sobre pre-matrícula, especialidades, horarios de examen y entrevista, Portal docente o WhatsApp. ¿Qué necesitás saber?'; }
const assistantLaunch = $('#assistant-launch'), assistantPanel = $('#assistant-panel'), assistantForm = $('#assistant-form'), assistantInput = $('#assistant-input'), assistantMessages = $('#assistant-messages');
assistantLaunch.addEventListener('click', () => { const open = assistantPanel.classList.toggle('hidden'); assistantLaunch.setAttribute('aria-expanded', String(!open)); if (!open) assistantInput.focus(); });
$('#assistant-close').addEventListener('click', () => { assistantPanel.classList.add('hidden'); assistantLaunch.setAttribute('aria-expanded', 'false'); });
assistantForm.addEventListener('submit', e => { e.preventDefault(); const question = assistantInput.value.trim(); if (!question) return; assistantMessages.insertAdjacentHTML('beforeend', `<div class="assistant-bubble user">${escapeHtml(question)}</div><div class="assistant-bubble">${escapeHtml(assistantReply(question))}</div>`); assistantInput.value = ''; assistantMessages.scrollTop = assistantMessages.scrollHeight; });

// Base CSV local para el portal docente. No se publica en GitHub: se procesa solo en el dispositivo del docente.
const teacherAgenda = $('.teacher-agenda');
if (teacherAgenda) {
  const senderWrap = document.createElement('label'); senderWrap.className = 'teacher-sender-email'; senderWrap.innerHTML = 'Correo del docente que envía<input id="teacher-sender-email" type="email" placeholder="docente@correo institucional" required>'; teacherAgenda.querySelector('.agenda-heading').after(senderWrap);
  const sendButton = document.createElement('button'); sendButton.className = 'btn btn-send-confirmation'; sendButton.id = 'send-confirmation'; sendButton.type = 'button'; sendButton.textContent = 'Enviar confirmación'; sendButton.disabled = true; teacherAgenda.querySelector('#save-appointment').after(sendButton);
  let pendingMailto = '';
  const csvState = { records: [], filter: 'Todas', search: '' };
  const actions = teacherAgenda.parentElement.querySelector('.dashboard-actions');
  const csvLabel = document.createElement('label'); csvLabel.className = 'upload-label hidden'; csvLabel.id = 'csv-import-control'; csvLabel.dataset.adminOnly = 'true'; csvLabel.title = 'Disponible únicamente para el administrador'; csvLabel.innerHTML = '▣ Importar base de datos<input id="csv-upload" type="file" accept=".csv,text/csv" hidden>'; actions.append(csvLabel);
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.id = 'export-database'; exportButton.className = 'upload-label'; exportButton.dataset.adminOnly = 'true'; exportButton.textContent = '⇩ Exportar respaldo'; exportButton.title = 'Descargar una copia CSV de la base sincronizada'; actions.append(exportButton);
  const searchBar = document.createElement('div'); searchBar.className = 'student-search-bar'; searchBar.innerHTML = '<label for="student-search">Buscar estudiante<input id="student-search" type="search" placeholder="Nombre, identificación, correo o teléfono" autocomplete="off"><button id="clear-student-search" type="button">Limpiar</button></label>'; actions.after(searchBar);
  const db = document.createElement('section'); db.className = 'database-summary'; db.id = 'database-summary'; db.innerHTML = '<div><b id="db-total">0</b><span>Registros CSV</span></div><div><b id="db-visible">0</b><span>En esta especialidad</span></div><div><b id="db-duplicates">0</b><span>Duplicados detectados</span></div><p id="db-source">Importá la base CSV desde este dispositivo para ver prematrícula y matrícula. La información no se publica.</p><div class="database-table-wrap"><table class="database-table"><thead><tr><th>Estudiante</th><th>Identificación</th><th>Especialidad</th><th>Contacto</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="csv-table-body"><tr><td colspan="6">No hay datos cargados.</td></tr></tbody></table></div>'; searchBar.after(db);
  function csvParse(text) { const rows = [], row = []; let cell = '', quoted = false; for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row.splice(0)); cell = ''; } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim()); return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))); }
  function field(record, matcher) { const key = Object.keys(record).find(k => matcher.test(k)); return key ? record[key] : ''; }
  function normalizeSpecialty(value) { const v = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (v.includes('refriger') || v.includes('aire acondicionado')) return 'Mantenimiento de Sistemas de Aire Acondicionado Industrial'; if (v.includes('ciber')) return 'Ciberseguridad'; if (v.includes('contab')) return 'Contabilidad'; if (v.includes('comercial') || v.includes('servicio al cliente')) return 'Ejecutivo Comercial y Servicio al Cliente'; if (v.includes('textil') || v.includes('diseño de productos')) return 'Diseño de Productos Industriales Textiles'; if (v.includes('electrom')) return 'Electromecánica'; return value || 'Sin especialidad'; }
  function prepareRecords(raw) { const records = raw.map((r, index) => ({ raw: r, index, name: field(r, /nombre completo/i) || 'Sin nombre', id: field(r, /cedula|documento de identidad/i), email: field(r, /correo electr/i), phone: field(r, /telefono principal/i), specialty: normalizeSpecialty(field(r, /especialidad.*matricular/i)), status: field(r, /estado|situacion|condicion/i) || 'Pre-matriculado', province: field(r, /provincia/i), canton: field(r, /canton/i), timestamp: field(r, /marca temporal/i) })); const groups = {}; records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(); (groups[key] ||= []).push(r); }); records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(), group = groups[key] || []; r.duplicateSpecialties = [...new Set(group.map(x => x.specialty))]; r.duplicate = group.length > 1; }); return records; }
  function loadRemoteTeacherDatabase() {
    if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) return;
    const callback = `stnReceiveTeacherDatabase_${Date.now()}`;
    window[callback] = payload => {
      if (!payload?.ok || !Array.isArray(payload.rows)) return;
      const headers = payload.headers || [];
      const raw = payload.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
      const deletedKeys = getDeletedRecordKeys();
      csvState.records.splice(0, csvState.records.length, ...prepareRecords(raw).filter(record => !deletedKeys.has(deletedRecordKey(record))));
      renderDatabase();
      updateDatabaseCounters();
      $('#db-source').textContent = `Base sincronizada en tiempo real · ${csvState.records.length} registros · búsqueda en todos los campos`;
      delete window[callback];
      script.remove();
    };
    const script = document.createElement('script');
    script.src = `${SYNC_ENDPOINT}?callback=${callback}&_=${Date.now()}`;
    script.onerror = () => { delete window[callback]; script.remove(); };
    document.body.append(script);
  }
  async function loadTeacherDatabase() {
    try {
      const imported = localStorage.getItem('stn-imported-csv');
      if (imported) csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(imported)));
      else {
        const response = await fetch('data/base-datos-2026.csv?v=20261006-database-128');
        if (response.ok) csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(await response.text())));
      }
      renderDatabase();
      $('#db-source').textContent = `Base institucional · ${csvState.records.length} registros · sincronizando…`;
      loadRemoteTeacherDatabase();
      startTeacherDatabaseRefresh();
    } catch (_) { $('#db-source').textContent = 'No fue posible cargar la base institucional.'; }
  }
  loadTeacherDatabaseForSession = loadTeacherDatabase;
  if (teacherAccess.role) loadTeacherDatabaseForSession();
  let teacherDatabaseTimer;
  function startTeacherDatabaseRefresh() { if (!teacherDatabaseTimer) teacherDatabaseTimer = setInterval(loadRemoteTeacherDatabase, 30000); }
  function updateDatabaseCounters() { const pre = csvState.records.filter(r => !/matriculad[oa]/i.test(r.status) || /pre.?matriculad/i.test(r.status)).length, mat = csvState.records.filter(r => /matriculad[oa]/i.test(r.status) && !/pre.?matriculad/i.test(r.status)).length; const preCount = $('#pre-count'); const matCount = $('#mat-count'); if (preCount) preCount.textContent = pre; if (matCount) matCount.textContent = mat; }
  function renderDatabase() {
    const activeFilter = allowedTeacherSpecialty() || csvState.filter;
    const search = csvState.search.trim().toLowerCase();
    const scopedRows = csvState.records.filter(r => activeFilter === 'Todas' || r.specialty === activeFilter);
    const rows = scopedRows.filter(r => !search || [r.name, r.id, r.email, r.phone, r.specialty, r.status, ...Object.values(r.raw)].join(' ').toLowerCase().includes(search));
    const duplicateCount = rows.filter(r => r.duplicate).length;
    $('#db-total').textContent = csvState.records.length;
    $('#db-visible').textContent = rows.length;
    $('#db-duplicates').textContent = duplicateCount;
    updateDatabaseCounters();
    $('#db-source').textContent = csvState.records.length ? `Base cargada en este dispositivo · filtro: ${activeFilter}${search ? ` · búsqueda: ${csvState.search.trim()}` : ''}` : 'Importá la base CSV desde este dispositivo para ver prematrícula y matrícula. La información no se publica.';
    $('#csv-table-body').innerHTML = rows.length ? rows.map(r => `<tr class="${r.duplicate ? 'is-duplicate' : ''}"><td><b>${escapeHtml(r.name)}</b><details><summary>Ver todos los datos</summary><dl>${Object.entries(r.raw).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || '—')}</dd>`).join('')}</dl></details></td><td>${escapeHtml(r.id || '—')}</td><td>${escapeHtml(r.specialty)}</td><td><a href="mailto:${encodeURIComponent(r.email)}">${escapeHtml(r.email || '—')}</a><small>${escapeHtml(r.phone || '')}</small></td><td>${r.duplicate ? `<span class="duplicate-badge">Duplicado en: ${escapeHtml(r.duplicateSpecialties.join(', '))}</span>` : '<span class="ok-badge">Registro único</span>'}</td><td><button class="table-action" data-record="${r.index}" type="button">Agendar</button>${teacherAccess.role === 'admin' ? `<button class="table-delete database-delete" data-record-delete="${r.index}" type="button">Eliminar</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="6">No hay registros para esta búsqueda o especialidad.</td></tr>';
    $$('.table-action', db).forEach(btn => btn.addEventListener('click', () => { const r = csvState.records.find(x => x.index === Number(btn.dataset.record)); if (!r || (allowedTeacherSpecialty() && r.specialty !== allowedTeacherSpecialty())) return; $('#teacher-candidate').value = r.name; $('#teacher-candidate-email').value = r.email; $('#teacher-candidate-contact').value = r.phone; $('#teacher-specialty').value = r.specialty; teacherAgenda.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    $$('.database-delete', db).forEach(btn => btn.addEventListener('click', () => {
      if (teacherAccess.role !== 'admin') return;
      const record = csvState.records.find(x => x.index === Number(btn.dataset.recordDelete));
      if (!record) return;
      if (!window.confirm(`¿Confirmás eliminar a ${record.name} de la base de datos? Esta acción no se puede deshacer.`)) return;
      csvState.records = csvState.records.filter(item => item !== record);
      const localRecords = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]');
      localStorage.setItem('stn-prematriculas', JSON.stringify(localRecords.filter(item => item.identification !== record.id || item.name !== record.name)));
      rememberDeletedRecord(record);
      deletePrematriculaFromRemote(record);
      renderDatabase();
      $('#db-source').textContent = `Registro eliminado por administración · ${csvState.records.length} registros restantes`;
    }));
  }
  $('#student-search').addEventListener('input', e => { csvState.search = e.target.value; renderDatabase(); });
  $('#clear-student-search').addEventListener('click', () => { csvState.search = ''; $('#student-search').value = ''; renderDatabase(); $('#student-search').focus(); });
  $('#csv-upload').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; const text = await file.text(); localStorage.setItem('stn-imported-csv', text); csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(text))); csvState.filter = $('.specialty-tab.active')?.dataset.specialty || 'Todas'; renderDatabase(); $('#db-source').textContent = `Base importada en este dispositivo · ${csvState.records.length} registros · solo lectura`; e.target.value = ''; });
  exportButton.addEventListener('click', () => { if (!csvState.records.length) { alert('No hay registros cargados para exportar.'); return; } const headers = Object.keys(csvState.records[0].raw); const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`; const csv = [headers.map(quote).join(','), ...csvState.records.map(record => headers.map(header => quote(record.raw[header])).join(','))].join('\r\n'); const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `respaldo-stn-prematriculas-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); });
  if (teacherAccess.role) applyTeacherAccess();
  $$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { csvState.filter = tab.dataset.specialty; renderDatabase(); }));
  renderDatabase();
  $('#save-appointment').addEventListener('click', e => { e.stopImmediatePropagation(); const date = $('#teacher-appointment-date').value, name = $('#teacher-candidate').value.trim(), email = $('#teacher-candidate-email').value.trim(), professor = $('#teacher-professor').value.trim(), sender = $('#teacher-sender-email').value.trim(), specialty = $('#teacher-specialty').value, type = $('#teacher-appointment-type').value, time = $('#teacher-appointment-time').value, message = $('#teacher-appointment-message'), allowed = allowedTeacherSpecialty(); if (allowed && specialty !== allowed) { message.textContent = `Esta agenda solo permite citas de ${allowed}.`; message.classList.add('error'); return; } if (!date || !name || !email || !professor || !sender) { message.textContent = 'Completá estudiante, correo del estudiante, profesor, fecha y correo del docente.'; message.classList.add('error'); sendButton.disabled = true; return; } const subject = encodeURIComponent(`Confirmación de cita STN · ${date} · ${time}`), body = encodeURIComponent(`Hola ${name},\n\nConfirmamos tu cita de ${type.toLowerCase()} en la Sección Técnica Nocturna.\n\nFecha: ${date}\nHora: ${time}\nEspecialidad: ${specialty}\nProfesor a cargo: ${professor}\nCorreo del docente: ${sender}\n\nPara consultas: 6195-5775.`); pendingMailto = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`; sendButton.disabled = false; message.classList.remove('error'); message.textContent = '✓ Cita preparada. Presioná “Enviar confirmación” para abrir el correo del docente.'; const appointments = getAppointments(); appointments.push({ specialty, type, date, time, name, email, professor, sender }); localStorage.setItem('stn-appointments', JSON.stringify(appointments)); updateDashboard(); }, true);
  sendButton.addEventListener('click', () => { if (pendingMailto) window.location.href = pendingMailto; });
}
