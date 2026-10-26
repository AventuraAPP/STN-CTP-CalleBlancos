const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

// La autenticación y la base institucional viven en Apps Script. El sitio
// público nunca contiene contraseñas: solo recibe un token de sesión temporal.
const TEACHER_ADMIN_PASSWORD = null;
const ADMINISTRATIVE_STAFF_PASSWORD = null;
const SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzHK7CGLMVmoP3LPDumanRMMIXRWy1DSfkd9N7zRaZGRUBBm0Ch0e4j5CyiHEqsSxmh/exec';
const DEPARTMENT_PASSWORDS = Object.freeze({
  'Ciberseguridad': null,
  'Contabilidad': null,
  'Ejecutivo Comercial y Servicio al Cliente': null,
  'Mantenimiento de Sistemas de Aire Acondicionado Industrial': null,
  'Electromecánica': null,
  'Diseño de Productos Industriales Textiles': null
});
const teacherAccess = { role: null, specialty: null };
let loadTeacherDatabaseForSession = () => {};
const getDepartmentPasswords = () => ({ ...DEPARTMENT_PASSWORDS });
const allowedTeacherSpecialty = () => teacherAccess.role === 'department' ? teacherAccess.specialty : null;
const hasInstitutionalOverview = () => ['admin', 'administrative'].includes(teacherAccess.role);
const canManageRecords = () => teacherAccess.role === 'admin';
const AUTH_TOKEN_KEY = 'stn-auth-token';
const getAuthToken = () => sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function requestRemoteJson(params = {}) {
  if (!SYNC_ENDPOINT) return Promise.reject(new Error('El servicio institucional no está configurado.'));
  const query = new URLSearchParams({ ...params, _: String(Date.now()) });
  return fetch(`${SYNC_ENDPOINT}?${query.toString()}`, { cache: 'no-store', mode: 'cors', headers: { Accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(payload => { if (!payload?.ok) throw new Error(payload?.message || 'La base institucional rechazó la solicitud.'); return payload; });
}
async function authenticateTeacher(password) {
  const challenge = await requestRemoteJson({ action: 'challenge' });
  const passwordHash = await sha256Hex(password);
  const proof = await sha256Hex(`${passwordHash}${challenge.challenge}`);
  return requestRemoteJson({ action: 'auth', challenge: challenge.challenge, proof });
}

function nativeRecordToRemotePayload(record) {
  const syncId = record.syncId || record['ID de sincronización'] || record.createdAt || `${record.identification || ''}|${record.name || ''}|${record.specialty || ''}`;
  return {
    syncId,
    name: record.name || '',
    fullName: record.name || '',
    specialty: record.specialty || '',
    technicalSpecialty: record.specialty || '',
    'ID de sincronización': syncId,
    'Marca temporal': record.createdAt || new Date().toISOString(),
    'Nombre completo y apellidos - Como aparece en la cédula': record.name || '',
    'Cédula o documento de identidad = Formato 0-0000-0000': record.identification || '',
    'Edad': record.age || '',
    'Teléfono Principal = Formato 0000-0000': record.phone || '',
    'Estudios últimos alcanzados': record.education || '',
    'Adjunta el título de noveno año o bachillerato de secundaria obtenido': record.titleFile || '—',
    titleFileContent: record.titleFileContent || '',
    titleFileMime: record.titleFileMime || '',
    titleFileName: record.titleFile || '',
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

function readAttachmentForSync(file) {
  if (!file) return Promise.resolve(null);
  const maximumBytes = 8 * 1024 * 1024;
  if (file.size > maximumBytes) return Promise.reject(new Error('El archivo supera el límite de 8 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No fue posible leer el archivo adjunto.'));
    reader.onload = () => resolve({
      name: file.name,
      mime: file.type || 'application/octet-stream',
      base64: String(reader.result || '').split(',').pop() || ''
    });
    reader.readAsDataURL(file);
  });
}

const PENDING_SYNC_KEY = 'stn-pending-prematriculas';
function readPendingSync() { try { return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]'); } catch (_) { return []; } }
function writePendingSync(records) { localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(records)); }
function queuePendingSync(record) {
  const pending = readPendingSync();
  if (!pending.some(item => (item.syncId || item.createdAt) === (record.syncId || record.createdAt))) { pending.push(record); writePendingSync(pending); }
}
const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
function requestRemoteSnapshot() {
  return requestRemoteJson({ action: 'data', authToken: getAuthToken() });
}
function remotePayloadHasSyncId(payload, syncId) {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  const syncIndex = headers.findIndex(header => /id\s*de\s*sincronizaci[oó]n/i.test(String(header)));
  if (syncIndex < 0 || !syncId) return false;
  return (payload.rows || []).some(row => String(row?.[syncIndex] || '') === String(syncId));
}
async function waitForRemoteRecord(syncId, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const payload = await requestRemoteSnapshot();
      if (payload?.ok && remotePayloadHasSyncId(payload, syncId)) return true;
    } catch (_) { /* se vuelve a intentar hasta agotar el tiempo */ }
    await wait(1500);
  }
  return false;
}
async function waitForRemoteDeletion(record, timeout = 18000) {
  const syncId = record.syncId || record.raw?.['ID de sincronización'] || '';
  const timestamp = record.timestamp || record.raw?.['Marca temporal'] || '';
  if (!syncId && !timestamp) return false;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const payload = await requestRemoteSnapshot();
      if (payload?.ok) {
        const headers = Array.isArray(payload.headers) ? payload.headers : [];
        const syncIndex = headers.findIndex(header => /id\s*de\s*sincronizaci[oó]n/i.test(String(header)));
        const timestampIndex = headers.findIndex(header => /marca temporal/i.test(String(header)));
        const stillPresent = (payload.rows || []).some(row => {
          const sameSync = syncId && syncIndex >= 0 && String(row?.[syncIndex] || '') === String(syncId);
          const sameTimestamp = timestamp && timestampIndex >= 0 && String(row?.[timestampIndex] || '') === String(timestamp);
          return sameSync || sameTimestamp;
        });
        if (!stillPresent) return true;
      }
    } catch (_) { /* se vuelve a intentar hasta agotar el tiempo */ }
    await wait(1500);
  }
  return false;
}
async function sendRecordToRemote(record) {
  if (!navigator.onLine) throw new Error('Sin conexión a Internet.');
  const payload = { action: 'create', ...nativeRecordToRemotePayload(record) };
  await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    cache: 'no-store',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const confirmed = await waitForRemoteRecord(payload.syncId);
  if (!confirmed) throw new Error('No fue posible confirmar el registro en la base institucional.');
  return true;
}
async function flushPendingSync() {
  if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_') || !navigator.onLine) return;
  const pending = readPendingSync();
  if (!pending.length) return;
  const remaining = [];
  for (const record of pending) {
    try {
      await sendRecordToRemote(record);
    } catch (_) { remaining.push(record); }
  }
  writePendingSync(remaining);
}
async function syncPrematriculaToRemote(record) {
  queuePendingSync(record);
  await flushPendingSync();
  const pending = readPendingSync().some(item => (item.syncId || item.createdAt) === (record.syncId || record.createdAt));
  return { ok: !pending, pending };
}
window.addEventListener('online', flushPendingSync);
setInterval(flushPendingSync, 30000);

async function deletePrematriculaFromRemote(record) {
  if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) return { ok: false, error: 'Servicio no configurado.' };
  const syncId = record.syncId || record.raw?.['ID de sincronización'] || '';
  const timestamp = record.timestamp || record.raw?.['Marca temporal'] || '';
  let payload;
  try {
    payload = await requestRemoteJson({
      action: 'delete',
      authToken: getAuthToken(),
      syncId,
      recordId: syncId,
      timestamp,
      identification: record.id || '',
      name: record.name || '',
      specialty: record.specialty || ''
    });
  } catch (error) {
    return { ok: false, error: `No se pudo confirmar la eliminación: ${error.message || 'error de conexión'}.` };
  }
  const deleted = Number(payload?.deleted || 0);
  if (!payload?.ok || deleted < 1) return { ok: false, error: 'El servidor no eliminó ningún registro. La fila permanece intacta.' };
  const confirmedAbsent = await waitForRemoteDeletion(record);
  if (!confirmedAbsent) return { ok: false, error: 'El servidor respondió, pero el registro todavía aparece en la base remota.' };
  return { ok: true, deleted };
}
function canonicalDeletedValue(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function deletedRecordKey(record) { return `${canonicalDeletedValue(record.id)}|${canonicalDeletedValue(record.name)}`; }
function deletedRecordKeys(record) { const id = canonicalDeletedValue(record.id), name = canonicalDeletedValue(record.name), legacy = `${String(record.id || '').trim().toLowerCase()}|${String(record.name || '').trim().toLowerCase()}`; return [...new Set(id ? [`${id}|${name}`, legacy] : [`|${name}`, legacy])]; }
function isDeletedRecord(record, deletedKeys = getDeletedRecordKeys()) { return deletedRecordKeys(record).some(key => deletedKeys.has(key)); }
function shouldDisplayRecoveredRecord(record, deletedKeys = getDeletedRecordKeys()) { return !isDeletedRecord(record, deletedKeys); }
function getDeletedRecordKeys() { try { return new Set(JSON.parse(localStorage.getItem('stn-deleted-records') || '[]')); } catch (_) { return new Set(); } }
function rememberDeletedRecord(record) { const keys = [...getDeletedRecordKeys(), ...deletedRecordKeys(record)]; localStorage.setItem('stn-deleted-records', JSON.stringify([...new Set(keys)])); }

const menu = $('.menu-toggle');
const nav = $('.main-nav');
document.querySelector('.teams-link')?.remove();
const portalHeading = document.querySelector('.teacher-access h3');
if (portalHeading) portalHeading.textContent = 'Portal docente';
menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', open); menu.textContent = open ? '×' : '☰'; });
$$('.main-nav a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menu.textContent = '☰'; menu.setAttribute('aria-expanded', 'false'); }));

const sharePrematriculaButton = $('#share-prematricula'), sharePrematriculaMenu = $('#share-prematricula-menu'), copyPrematriculaLink = $('#copy-prematricula-link'), sharePrematriculaWhatsapp = $('#share-prematricula-whatsapp');
const prematriculaShareUrl = new URL('prematricula.html?v=20261020-confirmed-save', window.location.href).href;
const prematriculaShareText = 'Accedé a la prematrícula 2027 de la Sección Técnica Nocturna del CTP Calle Blancos.';
if (sharePrematriculaWhatsapp) sharePrematriculaWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(`${prematriculaShareText}\n${prematriculaShareUrl}`)}`;
async function copyPrematriculaUrl() {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prematriculaShareUrl);
    else {
      const temporary = document.createElement('textarea'); temporary.value = prematriculaShareUrl; temporary.setAttribute('readonly', ''); temporary.style.position = 'fixed'; temporary.style.opacity = '0'; document.body.append(temporary); temporary.select(); document.execCommand('copy'); temporary.remove();
    }
    if (copyPrematriculaLink) { copyPrematriculaLink.textContent = 'Enlace copiado ✓'; window.setTimeout(() => { copyPrematriculaLink.textContent = 'Copiar enlace'; }, 2200); }
  } catch (_) { window.prompt('Copiá y compartí este enlace de prematrícula:', prematriculaShareUrl); }
}
sharePrematriculaButton?.addEventListener('click', async () => {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile && navigator.share) {
    try { await navigator.share({ title: 'Prematrícula 2027 · STN CTP Calle Blancos', text: prematriculaShareText, url: prematriculaShareUrl }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  const open = sharePrematriculaMenu?.classList.toggle('hidden') === false;
  sharePrematriculaButton.setAttribute('aria-expanded', String(open));
});
copyPrematriculaLink?.addEventListener('click', async () => { await copyPrematriculaUrl(); });
document.addEventListener('click', event => { if (!event.target.closest('.share-control') && sharePrematriculaMenu && !sharePrematriculaMenu.classList.contains('hidden')) { sharePrematriculaMenu.classList.add('hidden'); sharePrematriculaButton?.setAttribute('aria-expanded', 'false'); } });

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
// Existe una única vista de base de datos: la que administra el Portal docente.
// El panel heredado duplicaba el mismo contenedor y provocaba que dos sincronizaciones
// alternaran los registros, el conteo y las eliminaciones.
const generalDashboard = null;
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
  generalDashboard.innerHTML = '<div class="general-dashboard-head"><div><span class="eyebrow"><span></span> Datos generales</span><h3>Resumen de prematrícula y matrícula</h3><p>Base institucional sincronizada · docentes consultan y administración gestiona registros</p></div><span class="status-pill">Actualizable por administración</span></div><div class="database-summary-cards"><div><b id="db-total">0</b><span>Total de registros</span></div><div><b id="db-visible">0</b><span>Registros filtrados</span></div><div><b id="db-duplicates">0</b><span>Duplicados</span></div></div><div class="specialty-metrics" id="specialty-metrics"></div><div class="duplicate-list" id="duplicate-list"></div><div class="database-table-wrap"><table class="database-table"><thead><tr><th>Estudiante</th><th>Identificación</th><th>Especialidad</th><th>Correo / contacto</th><th>Estado y fecha</th><th>Observación</th><th>Acción</th></tr></thead><tbody id="csv-table-body"><tr><td colspan="6">Cargando base institucional…</td></tr></tbody></table></div><p id="db-source" class="database-source">La base se actualiza mediante el servicio de sincronización institucional.</p>';
  const generalState = { records: [], filter: 'Todas' };
  function parseCsvGeneral(text) { const rows = [], row = []; let cell = '', quoted = false; for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row.splice(0)); cell = ''; } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim()); return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))); }
  function getGeneralField(record, matcher) { const k = Object.keys(record).find(key => matcher.test(key)); return k ? record[k] : ''; }
  function normalizeGeneralSpecialty(value) { const v = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (v.includes('refriger') || v.includes('aire acondicionado')) return 'Mantenimiento de Sistemas de Aire Acondicionado Industrial'; if (v.includes('ciber')) return 'Ciberseguridad'; if (v.includes('contab')) return 'Contabilidad'; if (v.includes('comercial') || v.includes('servicio al cliente')) return 'Ejecutivo Comercial y Servicio al Cliente'; if (v.includes('textil') || v.includes('diseño de productos')) return 'Diseño de Productos Industriales Textiles'; if (v.includes('electrom')) return 'Electromecánica'; return value || 'Sin especialidad'; }
  function prepareGeneralRecords(raw) { const records = raw.map((r, index) => ({ raw: r, index, name: getGeneralField(r, /nombre completo/i) || 'Sin nombre', id: getGeneralField(r, /cedula|documento de identidad/i), email: getGeneralField(r, /correo electr/i), phone: getGeneralField(r, /telefono principal/i), specialty: normalizeGeneralSpecialty(getGeneralField(r, /especialidad.*matricular/i)), province: getGeneralField(r, /provincia/i), canton: getGeneralField(r, /canton/i), syncId: getGeneralField(r, /id de sincronización/i) })); repairStudentRecordGaps(records); const groups = {}; records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(); (groups[key] ||= []).push(r); }); records.forEach(r => { const key = (r.id || r.name).toLowerCase().replace(/\s+/g, ' ').trim(), group = groups[key] || []; r.duplicateSpecialties = [...new Set(group.map(x => x.specialty))]; r.duplicate = group.length > 1; }); return records; }
  function renderGeneralDashboard() {
    const activeFilter = allowedTeacherSpecialty() || generalState.filter;
    const rows = generalState.records.filter(r => activeFilter === 'Todas' || r.specialty === activeFilter), counts = {};
    generalState.records.forEach(r => { counts[r.specialty] = (counts[r.specialty] || 0) + 1; });
    $('#db-total').textContent = generalState.records.length;
    $('#db-visible').textContent = rows.length;
    $('#db-duplicates').textContent = rows.filter(r => r.duplicate).length;
    $('#specialty-metrics').innerHTML = Object.entries(counts).filter(([name]) => !allowedTeacherSpecialty() || name === allowedTeacherSpecialty()).map(([name, count]) => `<button class="metric-card ${activeFilter === name ? 'active' : ''}" data-metric="${escapeHtml(name)}"><b>${count}</b><span>${escapeHtml(name)}</span></button>`).join('');
    const uniqueDuplicates = [...new Map(rows.filter(r => r.duplicate && r.duplicateSpecialties.length > 1).map(r => [r.id || r.name, r])).values()];
    $('#duplicate-list').innerHTML = uniqueDuplicates.length ? `<div class="duplicate-list-head"><div><span>Control de duplicados</span><h4>Registros en más de una especialidad</h4></div><b>${uniqueDuplicates.length}</b></div><div class="duplicate-list-grid">${uniqueDuplicates.map(r => `<article class="duplicate-card"><strong>${escapeHtml(r.name)}</strong><div class="duplicate-card-specialties">${r.duplicateSpecialties.map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div></article>`).join('')}</div>` : '<div class="duplicate-list-empty"><b>✓ Sin duplicados en este filtro</b><span>Cada estudiante tiene una sola especialidad registrada.</span></div>';
    $('#csv-table-body').innerHTML = rows.length ? rows.map(r => `<tr class="${r.duplicate ? 'is-duplicate' : ''}"><td><b>${escapeHtml(r.name)}</b><details><summary>Todos los datos</summary><dl>${Object.entries(r.raw).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || '—')}</dd>`).join('')}</dl></details></td><td>${escapeHtml(r.id || '—')}</td><td>${escapeHtml(r.specialty)}</td><td><a href="mailto:${encodeURIComponent(r.email)}">${escapeHtml(r.email || '—')}</a><small>${escapeHtml(r.phone || '')}</small></td><td>${r.duplicate ? duplicateSpecialtyMarkup(r.duplicateSpecialties) : '<span class="ok-badge">Registro único</span>'}</td><td><button class="table-action" data-general-record="${r.index}" type="button">Agendar</button></td></tr>`).join('') : '<tr><td colspan="6">No hay registros para este filtro.</td></tr>';
    $$('.metric-card', generalDashboard).forEach(card => card.addEventListener('click', () => { if (!allowedTeacherSpecialty()) generalState.filter = card.dataset.metric; renderGeneralDashboard(); }));
    $$('.table-action', generalDashboard).forEach(button => button.addEventListener('click', () => { const r = generalState.records.find(x => x.index === Number(button.dataset.generalRecord)); if (!r || (allowedTeacherSpecialty() && r.specialty !== allowedTeacherSpecialty())) return; $('#teacher-candidate').value = r.name; $('#teacher-candidate-email').value = r.email; $('#teacher-candidate-contact').value = r.phone; $('#teacher-specialty').value = r.specialty; teacherAgendaGeneral?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  }
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
  renderGeneralDashboard = function () {
    renderGeneralDashboardBase();
    // No dejes botones administrativos visibles si la sesión cambia de
    // administrador a docente de departamento sin recargar la página.
    if (teacherAccess.role !== 'admin') {
      $$('.table-delete', generalDashboard).forEach(button => button.remove());
      return;
    }
    installAdminDeleteControls();
  };

  function loadRemotePrematriculas() {
    if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_') || !getAuthToken()) return;
    requestRemoteJson({ action: 'data', authToken: getAuthToken() }).then(payload => {
      if (!payload?.ok || !Array.isArray(payload.rows)) return;
      const headers = payload.headers || [];
      const remoteRaw = payload.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
      const deletedKeys = getDeletedRecordKeys();
      generalState.records = prepareGeneralRecords(remoteRaw).filter(record => shouldDisplayRecoveredRecord(record, deletedKeys));
      renderGeneralDashboard();
      $('#db-source').textContent = `Base sincronizada en tiempo real · ${generalState.records.length} registros · hoja de respuestas de Google`;
    }).catch(() => {});
  }
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.data?.type !== 'stn-prematricula-saved') return;
    loadRemotePrematriculas();
    loadTeacherDatabaseForSession?.();
  });
  async function loadRepositoryDatabase() { try { const imported = localStorage.getItem('stn-imported-csv'); let csvText = imported; if (!csvText) { const response = await fetch('data/base-datos-2026.csv?v=20261011-database-145', { cache: 'no-store' }); if (!response.ok) throw new Error('No se pudo cargar la base'); csvText = await response.text(); } const deletedKeys = getDeletedRecordKeys(); generalState.records = prepareGeneralRecords(parseCsvGeneral(csvText)).filter(record => shouldDisplayRecoveredRecord(record, deletedKeys)); renderGeneralDashboard(); $('#db-source').textContent = `${imported ? 'Base importada en este dispositivo' : 'Base institucional'} · ${generalState.records.length} registros · solo lectura`; loadRemotePrematriculas(); } catch (error) { $('#db-source').textContent = 'No fue posible cargar la base institucional. Verificá la conexión y el último commit.'; } }
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

// Respaldo histórico de citas que se habían agendado antes de que la agenda
// quedara sincronizada en la base remota. Se conserva en el repositorio para
// que una limpieza de caché o una nueva computadora no borre el historial.
// Solo se incluyen datos completos que fueron verificados en el historial
// operativo de la STN; no se inventan reservas que no tengan fecha y hora.
// Las citas históricas se consultan desde la base institucional autenticada.
let HISTORICAL_APPOINTMENTS = Object.freeze([]);
const DELETED_APPOINTMENTS_KEY = 'stn-deleted-appointments';
function readDeletedAppointmentKeys() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_APPOINTMENTS_KEY) || '[]');
    return Array.isArray(value) ? new Set(value) : new Set();
  } catch (_) { return new Set(); }
}
function getAppointments() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem('stn-appointments') || '[]'); } catch (_) { stored = []; }
  const deleted = readDeletedAppointmentKeys();
  const candidates = [...HISTORICAL_APPOINTMENTS, ...(Array.isArray(stored) ? stored : [])];
  const unique = [];
  const seen = new Set();
  candidates.forEach(appointment => {
    const key = appointmentKey(appointment);
    if (!deleted.has(key) && !seen.has(key)) { seen.add(key); unique.push(appointment); }
  });
  return unique;
}
function appointmentKey(appointment) {
  return appointment.id || [appointment.date, appointment.time, appointment.email, appointment.name, appointment.specialty].map(value => String(value || '').trim().toLowerCase()).join('|');
}
function saveAppointments(appointments) {
  const unique = [];
  const seen = new Set();
  appointments.forEach(appointment => {
    const key = appointmentKey(appointment);
    if (!seen.has(key)) { seen.add(key); unique.push(appointment); }
  });
  localStorage.setItem('stn-appointments', JSON.stringify(unique));
  return unique;
}
async function syncAppointmentToRemote(appointment) {
  if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_') || !navigator.onLine) return;
  const payload = { action: 'appointment', id: appointment.id || appointmentKey(appointment), ...appointment };
  try {
    await fetch(SYNC_ENDPOINT, { method: 'POST', mode: 'no-cors', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  } catch (_) { /* La cita seguirá disponible en este navegador y se reintentará al volver a guardar. */ }
}

const appointmentsPanel = $('#teacher-appointments');
if (appointmentsPanel && !$('#appointment-specialty-summary')) appointmentsPanel.insertAdjacentHTML('afterbegin', '<div class="appointments-heading"><div><span class="eyebrow"><span></span> Agenda institucional</span><h3 id="appointments-title">Todas las citas reservadas</h3><p>Vista consolidada de entrevistas y exámenes por departamento técnico.</p></div><span class="appointments-live">● Agenda activa</span></div><div class="appointment-specialty-summary" id="appointment-specialty-summary"></div>');
function renderAppointments(filter = 'Todas') { const admin = teacherAccess.role === 'admin', overview = hasInstitutionalOverview(), activeFilter = allowedTeacherSpecialty() || (overview ? 'Todas' : filter), allAppointments = getAppointments(), list = allAppointments.filter(a => activeFilter === 'Todas' || a.specialty === activeFilter); const title = $('#appointments-title'); if (title) title.textContent = overview ? 'Todas las citas reservadas' : `Citas de ${activeFilter}`; const summary = $('#appointment-specialty-summary'); if (summary) { const groups = {}; allAppointments.forEach(a => { groups[a.specialty || 'Sin especialidad'] = (groups[a.specialty || 'Sin especialidad'] || 0) + 1; }); summary.innerHTML = overview ? Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([specialty, count]) => `<button class="appointment-specialty-card ${activeFilter === specialty ? 'active' : ''}" type="button" data-appointment-filter="${escapeHtml(specialty)}"><b>${count}</b><span>${escapeHtml(specialty)}</span></button>`).join('') : ''; $$('.appointment-specialty-card', summary).forEach(button => button.addEventListener('click', () => { renderAppointments(button.dataset.appointmentFilter); })); } $('#appointments-list').innerHTML = list.length ? list.map(a => `<div class="appointment-row ${a.restored ? 'appointment-restored' : ''}"><div><b>${escapeHtml(a.name)}</b><small><span class="appointment-department">${escapeHtml(a.specialty || 'Sin especialidad')}</span> · ${escapeHtml(a.type)} · Prof. ${escapeHtml(a.professor || 'Por asignar')}</small>${a.restoredLabel ? `<em class="appointment-restored-label">↻ ${escapeHtml(a.restoredLabel)}</em>` : ''}</div><strong>${escapeHtml(a.date)} · ${escapeHtml(a.time)}</strong>${admin ? `<button class="appointment-delete" data-appointment-delete="${escapeHtml(appointmentKey(a))}" type="button">Eliminar</button>` : ''}</div>`).join('') : `<p>${overview ? 'No hay citas reservadas en los departamentos técnicos.' : 'No hay citas para esta especialidad.'}</p>`; $$('.appointment-delete').forEach(button => button.addEventListener('click', () => { if (teacherAccess.role !== 'admin') return; const target = getAppointments().find(a => appointmentKey(a) === button.dataset.appointmentDelete); if (!target || !window.confirm(`¿Confirmás eliminar la cita de ${target.name}?`)) return; const key = appointmentKey(target); const deleted = readDeletedAppointmentKeys(); deleted.add(key); localStorage.setItem(DELETED_APPOINTMENTS_KEY, JSON.stringify([...deleted])); saveAppointments(getAppointments().filter(a => appointmentKey(a) !== key)); updateDashboard(); renderAppointments(filter); })); }
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
  $('#native-prematricula-form', panel).addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form).entries()), file = form.querySelector('[name="titleFile"]')?.files?.[0], statusMessage = $('#native-prematricula-message', panel); let attachment = null; try { attachment = await readAttachmentForSync(file); } catch (error) { statusMessage.textContent = error.message; statusMessage.classList.add('error'); return; } const record = { ...values, titleFile: file?.name || '', status: values.status || 'Pre-matriculado', createdAt: new Date().toISOString(), syncId: (crypto.randomUUID?.() || `stn-${Date.now()}-${Math.random().toString(36).slice(2)}`) }; const records = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]'); records.unshift(record); localStorage.setItem('stn-prematriculas', JSON.stringify(records)); const students = getStudents(); students.unshift({ name: values.name, contact: values.phone || values.email, specialty: values.specialty, status: record.status, identification: values.identification, email: values.email }); localStorage.setItem('stn-students', JSON.stringify(students)); updateDashboard(); statusMessage.textContent = `✓ Todos los datos de ${values.name} fueron guardados en el sistema. ${attachment ? 'Cargando el documento adjunto de forma segura…' : 'Sincronizando con la base institucional…'}`; statusMessage.classList.remove('error'); const remoteRecord = attachment ? { ...record, titleFileContent: attachment.base64, titleFileMime: attachment.mime } : record; syncPrematriculaToRemote(remoteRecord).then(() => { const pending = readPendingSync().some(item => item.createdAt === record.createdAt); statusMessage.textContent = pending ? `✓ Datos guardados para ${values.name}. Quedaron pendientes de sincronización y se reintentará automáticamente.` : `✓ Confirmado: todos los datos de ${values.name}${attachment ? ' y su archivo adjunto' : ''} fueron guardados y enviados a la base institucional.`; setTimeout(() => loadTeacherDatabaseForSession?.(), 2500); }); form.reset(); });
  $('#native-prematricula-form', panel).addEventListener('submit', () => setTimeout(() => { const saved = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]')[0]; if (saved) window.dispatchEvent(new CustomEvent('stn-prematricula-saved', { detail: saved })); }, 0));
  // Este controlador se ejecuta antes del antiguo flujo local. Un registro solo
  // se confirma cuando la fuente institucional remota devuelve su sincronización.
  const nativeForm = $('#native-prematricula-form', panel);
  if (nativeForm && !nativeForm.dataset.remoteSyncGuard) {
    nativeForm.dataset.remoteSyncGuard = 'true';
    nativeForm.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (nativeForm.dataset.submitting === 'true') return;
      const statusMessage = $('#native-prematricula-message', panel);
      const submitButton = $('button[type="submit"]', nativeForm);
      const values = Object.fromEntries(new FormData(nativeForm).entries());
      const file = nativeForm.querySelector('[name="titleFile"]')?.files?.[0];
      let attachment = null;
      try {
        attachment = await readAttachmentForSync(file);
        nativeForm.dataset.submitting = 'true';
        if (submitButton) submitButton.disabled = true;
        statusMessage.classList.remove('error');
        statusMessage.textContent = 'Guardando y verificando la respuesta de la base institucional…';
        const record = {
          ...values,
          titleFile: file?.name || '',
          status: values.status || 'Pre-matriculado',
          createdAt: new Date().toISOString(),
          syncId: crypto.randomUUID?.() || `stn-${Date.now()}-${Math.random().toString(36).slice(2)}`
        };
        const remoteRecord = attachment ? { ...record, titleFileContent: attachment.base64, titleFileMime: attachment.mime } : record;
        const result = await syncPrematriculaToRemote(remoteRecord);
        if (!result?.ok) throw new Error('La base institucional no confirmó el registro.');
        statusMessage.textContent = `✓ Confirmado: todos los datos de ${values.name} fueron guardados en la base institucional.`;
        nativeForm.reset();
        window.setTimeout(() => loadTeacherDatabaseForSession?.(), 500);
      } catch (error) {
        const fallback = {
          ...values,
          titleFile: file?.name || '',
          status: values.status || 'Pre-matriculado',
          createdAt: new Date().toISOString(),
          syncId: crypto.randomUUID?.() || `stn-${Date.now()}-${Math.random().toString(36).slice(2)}`
        };
        queuePendingSync(fallback);
        statusMessage.classList.add('error');
        statusMessage.textContent = `No se confirmó el registro en la base institucional. Se mantuvo como envío pendiente en este dispositivo: ${error.message || 'revisá la conexión e intentá de nuevo.'}`;
      } finally {
        delete nativeForm.dataset.submitting;
        if (submitButton) submitButton.disabled = false;
      }
    }, true);
  }
  if (localStorage.getItem('stn-prematriculas')) window.dispatchEvent(new CustomEvent('stn-prematricula-saved'));
}
function applyTeacherAccess() {
  const admin = canManageRecords(), overview = hasInstitutionalOverview(), specialty = allowedTeacherSpecialty();
  if (!admin) {
    // Limpieza defensiva para evitar que un control de otra sesión permanezca
    // en pantalla durante el cambio de rol o al cerrar sesión.
    // Buscar en todo el documento, no solo dentro del panel activo: esto
    // también limpia controles que una vista anterior haya dejado montados.
    $$('.table-delete, .database-delete, .appointment-delete').forEach(button => button.remove());
  }
  const roleLabel = $('.dashboard-head b', teacherDashboard);
  if (roleLabel) roleLabel.textContent = admin ? 'Portal docente · Administrador' : (teacherAccess.role === 'administrative' ? 'Portal docente · Personal administrativo' : `Portal docente · ${specialty}`);
  $$('.specialty-tab', teacherDashboard).forEach(tab => { const visible = overview || tab.dataset.specialty === specialty; tab.classList.toggle('hidden', !visible); tab.classList.toggle('active', overview ? tab.dataset.specialty === 'Todas' : tab.dataset.specialty === specialty); });
  const specialtySelect = $('#teacher-specialty');
  if (specialtySelect) { if (specialty) specialtySelect.value = specialty; specialtySelect.disabled = Boolean(specialty); }
  const csvImportControl = $('#csv-import-control');
  csvImportControl?.classList.toggle('hidden', !admin);
  const exportDatabaseControl = $('#export-database');
  exportDatabaseControl?.classList.toggle('hidden', !overview);
  $('#reporting-controls')?.classList.toggle('hidden', !overview);
  adminPasswordToggle?.classList.toggle('hidden', !admin);
  if (!admin) { adminPasswordPanel?.classList.add('hidden'); adminPasswordToggle?.setAttribute('aria-expanded', 'false'); if (adminPasswordToggle) adminPasswordToggle.textContent = '▸ Contraseñas por departamento'; }
  const adminOnlyNotice = $('#admin-only-notice');
  if (adminOnlyNotice) adminOnlyNotice.classList.toggle('hidden', teacherAccess.role !== 'administrative');
  if (admin) renderAdminPasswords();
  renderAppointments(specialty || $('.specialty-tab.active')?.dataset.specialty || 'Todas');
}
function enterTeacherPortal(role, specialty = null) {
  teacherAccess.role = role; teacherAccess.specialty = specialty;
  installPrematriculaPanel();
  teacherGate?.classList.add('hidden'); teacherLogin?.classList.add('hidden'); teacherDashboard?.classList.remove('hidden'); teacherSection?.classList.remove('teacher-locked'); setTeacherPortalState(true); applyTeacherAccess();
  sessionStorage.setItem('stn-teacher-session', JSON.stringify({ role, specialty, token: getAuthToken() }));
  updateDashboard();
  loadTeacherDatabaseForSession();
}
const setTeacherPortalState = active => { if (!teacherSection) return; teacherSection.classList.toggle('teacher-portal-active', active); teacherSection.style.gridTemplateColumns = active ? '1fr' : ''; const copy = teacherSection.querySelector('.teacher-copy'); const access = teacherSection.querySelector('.teacher-access'); const note = teacherSection.querySelector('.security-note'); if (active) { copy?.style.setProperty('grid-column', '1 / -1'); access?.style.setProperty('grid-column', '1 / -1'); note?.style.setProperty('grid-column', '1 / -1'); } else { copy?.style.removeProperty('grid-column'); access?.style.removeProperty('grid-column'); note?.style.removeProperty('grid-column'); } };
teacherLogin?.addEventListener('submit', async e => {
  e.preventDefault();
  const message = $('#login-message'), password = $('#teacher-password').value;
  if (!password) return;
  message.classList.remove('error'); message.textContent = 'Verificando credenciales institucionales…';
  try {
    const auth = await authenticateTeacher(password);
    if (!auth?.ok || !auth.token) throw new Error(auth?.message || 'No se pudo validar la cuenta.');
    sessionStorage.setItem(AUTH_TOKEN_KEY, auth.token);
    sessionStorage.setItem('stn-teacher-session', JSON.stringify({ role: auth.role, specialty: auth.specialty, token: auth.token }));
    enterTeacherPortal(auth.role, auth.specialty || null);
    message.textContent = '✓ Acceso autorizado. Base institucional sincronizada.';
  } catch (error) {
    message.classList.add('error'); message.textContent = error.message || 'No fue posible validar el acceso.';
  }
});
const savedTeacherSession = (() => { try { return JSON.parse(sessionStorage.getItem('stn-teacher-session') || 'null'); } catch (_) { return null; } })();
if (savedTeacherSession?.token) { sessionStorage.setItem(AUTH_TOKEN_KEY, savedTeacherSession.token); teacherAccess.role = savedTeacherSession.role || null; teacherAccess.specialty = savedTeacherSession.specialty || null; }
$('#logout')?.addEventListener('click', () => { sessionStorage.removeItem('stn-teacher-session'); sessionStorage.removeItem(AUTH_TOKEN_KEY); teacherAccess.role = null; teacherAccess.specialty = null; teacherDashboard?.classList.add('hidden'); teacherLogin?.classList.add('hidden'); teacherGate?.classList.remove('hidden'); teacherSection?.classList.add('teacher-locked'); setTeacherPortalState(false); $('#teacher-password').value = ''; applyTeacherAccess(); });
// La única entrada para nuevos registros es «Ingresar prematrícula».
// Se retira cualquier botón heredado «Registrar estudiante» de versiones anteriores.
$('#add-student')?.remove();
$('#doc-upload').addEventListener('change', e => { const docs = getDocs(); [...e.target.files].forEach(file => docs.unshift({ name: file.name, date: new Date().toLocaleDateString('es-CR') })); localStorage.setItem('stn-documents', JSON.stringify(docs)); e.target.value = ''; updateDashboard(); });
$('#save-appointment').addEventListener('click', () => { const specialty = $('#teacher-specialty').value, type = $('#teacher-appointment-type').value, date = $('#teacher-appointment-date').value, time = $('#teacher-appointment-time').value, name = $('#teacher-candidate').value.trim(), email = $('#teacher-candidate-email').value.trim(), professor = $('#teacher-professor').value.trim(), contact = $('#teacher-candidate-contact').value.trim(), message = $('#teacher-appointment-message'); if (!date || !name || !email || !professor) { message.textContent = 'Completá estudiante, correo, profesor y fecha para guardar.'; message.classList.add('error'); return; } const appointment = { id: crypto.randomUUID?.() || `cita-${Date.now()}-${Math.random().toString(36).slice(2)}`, specialty, type, date, time, name, email, professor, contact }; const appointments = getAppointments(); appointments.push(appointment); saveAppointments(appointments); syncAppointmentToRemote(appointment); const subject = encodeURIComponent(`Confirmación de cita STN · ${date} · ${time}`); const body = encodeURIComponent(`Hola ${name},\n\nConfirmamos tu cita de ${type.toLowerCase()} en la Sección Técnica Nocturna.\n\nFecha: ${date}\nHora: ${time}\nEspecialidad: ${specialty}\nProfesor a cargo: ${professor}\n\nPara consultas: 6195-5775.`); message.classList.remove('error'); message.innerHTML = `✓ Cita guardada. <a class="confirmation-link" href="mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}">Abrir correo de confirmación para enviar ↗</a>`; $('#teacher-candidate').value = ''; $('#teacher-candidate-email').value = ''; $('#teacher-professor').value = ''; $('#teacher-candidate-contact').value = ''; updateDashboard(); });
$$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { $$('.specialty-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); renderAppointments(tab.dataset.specialty); }));
const setTickerMessage = message => { $('#ticker-message').textContent = message; const copy = $('.ticker-message-copy'); if (copy) copy.textContent = message; };
$('#edit-ticker').addEventListener('click', () => { const message = prompt('Mensaje institucional visible para la comunidad:', localStorage.getItem('stn-ticker') || $('#ticker-message').textContent); if (message?.trim()) { localStorage.setItem('stn-ticker', message.trim()); setTickerMessage(message.trim()); } });
setTickerMessage(localStorage.getItem('stn-ticker') || $('#ticker-message').textContent);

const assistantReplies = [
  { keys: ['hola', 'buenas', 'buenos dias', 'buenas tardes'], text: '¡Hola! Soy el asistente STN. Puedo guiarte paso a paso por la oferta 2027, la prematrícula, las citas y los canales oficiales.' },
  { keys: ['prematr', 'formulario', 'inscrib', 'inscrip'], text: 'La prematrícula 2027 se completa en el formulario oficial. Al enviarlo, tus datos quedan registrados para el proceso de admisión. Podés abrirlo desde el botón Prematrícula 2027.', actions: [{ label: 'Abrir prematrícula', href: 'prematricula.html?v=20261020-confirmed-save' }] },
  { keys: ['ciber', 'seguridad'], text: 'Ciberseguridad prepara en protección de sistemas, redes, información y entornos digitales. Es una de las especialidades de la oferta técnica nocturna 2027.' },
  { keys: ['contab'], text: 'Contabilidad desarrolla competencias para registrar, analizar y comunicar información financiera y apoyar decisiones administrativas.' },
  { keys: ['comercial', 'servicio al cliente', 'ventas'], text: 'Ejecutivo Comercial y Servicio al Cliente forma en comunicación, ventas, relaciones comerciales y experiencias de servicio.' },
  { keys: ['aire', 'refriger', 'acondicionado'], text: 'Mantenimiento de Sistemas de Aire Acondicionado Industrial aborda instalación, diagnóstico, control y mantenimiento de sistemas industriales. La malla curricular está pendiente de publicación oficial del MEP.' },
  { keys: ['electrom'], text: 'Electromecánica integra electricidad, mecánica, automatización y mantenimiento para responder a las necesidades de la industria.' },
  { keys: ['textil', 'diseño', 'productos industriales'], text: 'Diseño de Productos Industriales Textiles combina diseño, producción, tecnologías aplicadas, acabados y emprendimiento.' },
  { keys: ['especial', 'oferta', 'carrera'], text: 'La oferta técnica nocturna 2027 contempla seis especialidades: Ciberseguridad, Contabilidad, Ejecutivo Comercial y Servicio al Cliente, Mantenimiento de Sistemas de Aire Acondicionado Industrial, Electromecánica y Diseño de Productos Industriales Textiles.' },
  { keys: ['hora', 'horario', 'noche', 'cita', 'examen', 'entrevista'], text: 'Las citas de entrevista y examen las administra el docente de cada especialidad desde el Portal docente, de lunes a viernes, entre las 6:00 p. m. y las 9:00 p. m. El estudiante recibe confirmación con fecha, hora y contacto del profesor.' },
  { keys: ['fecha', 'calendario', 'cuando', 'agosto', 'octubre'], text: 'El calendario incluye entrevistas y exámenes del lunes 12 al viernes 16 de octubre de 2026. Revisá la sección Proceso para conocer las demás etapas.' },
  { keys: ['whatsapp', 'teléfono', 'telefono', 'contacto', 'ubicación', 'ubicacion'], text: 'El canal oficial de contacto es WhatsApp 6195-5775. También podés usar el botón WhatsApp de esta página para abrir una conversación directa.', actions: [{ label: 'Abrir WhatsApp', href: 'https://wa.me/50661955775?text=Hola%20STN%2C%20tengo%20una%20consulta%20sobre%20Admisi%C3%B3n%202027' }] },
  { keys: ['docente', 'portal', 'teams', 'duplicado', 'base de datos'], text: 'El Portal docente está protegido. Cada departamento consulta su especialidad, revisa registros, detecta duplicados y organiza las citas de entrevistas y exámenes.' },
  { keys: ['requisito', 'documento', 'titulo', 'bachiller', 'noveno'], text: 'Completá el formulario con los datos de la cédula y adjuntá el título de noveno año o bachillerato cuando corresponda. Revisá cada campo antes de enviar.' }
];
function normalizeAssistantText(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function assistantReplyData(question) { const q = normalizeAssistantText(question); const found = assistantReplies.find(item => item.keys.some(key => q.includes(normalizeAssistantText(key)))); return found || { text: 'Puedo orientarte sobre especialidades, prematrícula, requisitos, calendario, citas, Portal docente o WhatsApp. Elegí una opción rápida o escribime tu pregunta con más detalle.' }; }
function assistantReply(question) { return assistantReplyData(question).text; }
const assistantLaunch = $('#assistant-launch'), assistantPanel = $('#assistant-panel'), assistantForm = $('#assistant-form'), assistantInput = $('#assistant-input'), assistantMessages = $('#assistant-messages');
function assistantAddMessage(question, data) { const actions = (data.actions || []).map(action => `<a class="assistant-action" href="${escapeHtml(action.href)}" target="${action.href.startsWith('http') ? '_blank' : '_self'}" rel="noopener">${escapeHtml(action.label)} ↗</a>`).join(''); assistantMessages.insertAdjacentHTML('beforeend', `<div class="assistant-bubble user">${escapeHtml(question)}</div><div class="assistant-bubble assistant-rich">${escapeHtml(data.text)}${actions ? `<div class="assistant-actions">${actions}</div>` : ''}</div>`); assistantMessages.scrollTop = assistantMessages.scrollHeight; }
assistantLaunch.addEventListener('click', () => { const open = assistantPanel.classList.toggle('hidden'); assistantLaunch.setAttribute('aria-expanded', String(!open)); if (!open) assistantInput.focus(); });
$('#assistant-close').addEventListener('click', () => { assistantPanel.classList.add('hidden'); assistantLaunch.setAttribute('aria-expanded', 'false'); });
assistantForm.addEventListener('submit', e => { e.preventDefault(); const question = assistantInput.value.trim(); if (!question) return; assistantAddMessage(question, assistantReplyData(question)); assistantInput.value = ''; });
assistantMessages?.addEventListener('click', event => { const chip = event.target.closest('[data-assistant-question]'); if (!chip) return; const question = chip.dataset.assistantQuestion; assistantAddMessage(question, assistantReplyData(question)); });

// Base CSV local para el portal docente. No se publica en GitHub: se procesa solo en el dispositivo del docente.
const teacherAgenda = $('.teacher-agenda');
if (teacherAgenda) {
  const senderWrap = document.createElement('div'); senderWrap.className = 'teacher-sender-email'; senderWrap.innerHTML = '<b>Datos de contacto del profesor a cargo</b><span>Estos datos se incluirán en la confirmación que recibe el estudiante.</span><div class="teacher-sender-fields"><label>Correo del docente que envía<input id="teacher-sender-email" type="email" placeholder="docente@correo institucional" required></label><label>Teléfono o WhatsApp del profesor<input id="teacher-professor-phone" type="tel" placeholder="0000-0000" required></label></div>'; teacherAgenda.querySelector('.agenda-heading').after(senderWrap);
  const sendButton = document.createElement('button'); sendButton.className = 'btn btn-send-confirmation'; sendButton.id = 'send-confirmation'; sendButton.type = 'button'; sendButton.textContent = 'Enviar confirmación'; sendButton.disabled = true; teacherAgenda.querySelector('#save-appointment').after(sendButton);
  let pendingMailto = '';
  const csvState = { records: [], filter: 'Todas', search: '' };
  // Conserva las fichas desplegadas si llega una actualización real de la base.
  // Sin esto, la recarga periódica reconstruía la tabla y cerraba «Ver todos los datos».
  const expandedRecordKeys = new Set();
  const recordViewKey = record => record.syncId || `${record.id}|${record.name}|${record.specialty}|${record.timestamp}`;
  const actions = teacherAgenda.parentElement.querySelector('.dashboard-actions');
  const csvLabel = document.createElement('label'); csvLabel.className = 'upload-label hidden'; csvLabel.id = 'csv-import-control'; csvLabel.dataset.adminOnly = 'true'; csvLabel.title = 'Disponible únicamente para el administrador'; csvLabel.innerHTML = '▣ Importar base de datos<input id="csv-upload" type="file" accept=".csv,text/csv" hidden>'; actions.append(csvLabel);
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.id = 'export-database'; exportButton.className = 'upload-label'; exportButton.dataset.adminOnly = 'true'; exportButton.textContent = '⇩ Exportar respaldo'; exportButton.title = 'Descargar una copia CSV de la base sincronizada'; actions.append(exportButton);
  const searchBar = document.createElement('div'); searchBar.className = 'student-search-bar'; searchBar.innerHTML = '<label for="student-search">Buscar estudiante<input id="student-search" type="search" placeholder="Nombre, identificación, correo o teléfono" autocomplete="off"><button id="clear-student-search" type="button">Limpiar</button></label>'; actions.after(searchBar);
  const reporting = document.createElement('section'); reporting.id = 'reporting-controls'; reporting.className = 'reporting-controls hidden'; reporting.innerHTML = '<div class="reporting-heading"><div><span>Informes institucionales</span><h3>Generar informe de estudiantes</h3><p>Aplicá los filtros requeridos y descargá el informe institucional en Excel, Word o como versión lista para imprimir/PDF.</p></div><span class="report-access">Administrador y personal administrativo</span></div><div class="report-filter-grid"><label>Especialidad<select id="report-specialty"><option value="Todas">Todas las especialidades</option></select></label><label>Estado<select id="report-status"><option value="Todas">Todos los estados</option></select></label><label>Provincia<select id="report-province"><option value="Todas">Todas las provincias</option></select></label><label>Cantón<select id="report-canton"><option value="Todas">Todos los cantones</option></select></label><label>Desde<input id="report-from" type="date"></label><label>Hasta<input id="report-to" type="date"></label><label>Ordenar por<select id="report-order"><option value="alphabetical">Nombre: A a Z</option><option value="date-desc">Fecha: más reciente</option><option value="date-asc">Fecha: más antigua</option></select></label><label class="report-query">Buscar en todos los campos<input id="report-query" type="search" placeholder="Nombre, cédula, correo, teléfono…"></label></div><fieldset class="report-fields"><legend>Campos adicionales que se incluirán en el informe</legend><label><input type="checkbox" data-report-field="phone" checked> Teléfono</label><label><input type="checkbox" data-report-field="address" checked> Dirección</label><label><input type="checkbox" data-report-field="accommodations" checked> Adecuación curricular</label><label><input type="checkbox" data-report-field="age" checked> Edad</label><label><input type="checkbox" data-report-field="education" checked> Estudios</label><label><input type="checkbox" data-report-field="children" checked> Hijos</label><label><input type="checkbox" data-report-field="country" checked> País de origen</label></fieldset><div class="report-actions"><button id="report-preview" type="button">▣ Vista para imprimir / PDF</button><button id="report-excel" type="button">⇩ Descargar Excel</button><button id="report-word" type="button">⇩ Descargar Word</button><small id="report-count">0 registros seleccionados</small></div></section>';
  const adminOnlyNotice = document.createElement('p'); adminOnlyNotice.id = 'admin-only-notice'; adminOnlyNotice.className = 'admin-only-notice hidden'; adminOnlyNotice.textContent = 'Acceso solo para el Administrador: la importación de bases, las contraseñas y la eliminación de registros requieren la cuenta administrativa.';
  searchBar.after(reporting); reporting.after(adminOnlyNotice);
  const db = document.createElement('section'); db.className = 'database-summary'; db.id = 'database-summary'; db.innerHTML = '<div><b id="db-total">0</b><span>Registros institucionales</span></div><div><b id="db-visible">0</b><span>En esta especialidad</span></div><div><b id="db-duplicates">0</b><span>Duplicados detectados</span></div><p id="db-source">Los registros se consultan automáticamente desde la base institucional centralizada.</p><section class="teacher-duplicate-summary" id="teacher-duplicate-list" aria-live="polite"></section><div class="database-table-wrap"><table class="database-table"><thead><tr><th>Estudiante</th><th>Identificación</th><th>Especialidad</th><th>Contacto</th><th>Estado y duplicados</th><th>Entrevista (60 %)</th><th>Puntaje examen</th><th>Porcentaje examen (40 %)</th><th>Ponderado / Nota</th><th>Acción</th></tr></thead><tbody id="csv-table-body"><tr><td colspan="10">No hay datos cargados.</td></tr></tbody></table></div>'; searchBar.after(db);
  const databaseTableWrap = $('.database-table-wrap', db);
  const databaseHorizontalScrollbar = document.createElement('div');
  databaseHorizontalScrollbar.className = 'database-horizontal-scroll';
  databaseHorizontalScrollbar.setAttribute('role', 'scrollbar');
  databaseHorizontalScrollbar.setAttribute('aria-label', 'Desplazamiento horizontal de la base de datos');
  const databaseHorizontalInner = document.createElement('div');
  databaseHorizontalScrollbar.append(databaseHorizontalInner);
  databaseTableWrap.before(databaseHorizontalScrollbar);
  let syncingDatabaseScroll = false;
  function syncDatabaseScrollbar() {
    if (!databaseTableWrap || !databaseHorizontalInner) return;
    databaseHorizontalInner.style.width = Math.max(databaseTableWrap.scrollWidth, databaseTableWrap.clientWidth + 1) + 'px';
    databaseHorizontalScrollbar.scrollLeft = databaseTableWrap.scrollLeft;
  }
  databaseHorizontalScrollbar.addEventListener('scroll', () => {
    if (syncingDatabaseScroll) return;
    syncingDatabaseScroll = true;
    databaseTableWrap.scrollLeft = databaseHorizontalScrollbar.scrollLeft;
    syncingDatabaseScroll = false;
  });
  databaseTableWrap.addEventListener('scroll', () => {
    if (syncingDatabaseScroll) return;
    syncingDatabaseScroll = true;
    databaseHorizontalScrollbar.scrollLeft = databaseTableWrap.scrollLeft;
    syncingDatabaseScroll = false;
  });
  window.addEventListener('resize', syncDatabaseScrollbar);
  function csvParse(text) { const rows = [], row = []; let cell = '', quoted = false; for (let i = 0; i < text.length; i++) { const ch = text[i], next = text[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { row.push(cell); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row.splice(0)); cell = ''; } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim()); return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))); }
  function field(record, matcher) { const key = Object.keys(record).find(k => matcher.test(k)); return key ? record[key] : ''; }
  function normalizeSpecialty(value) { const v = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (v.includes('refriger') || v.includes('aire acondicionado')) return 'Mantenimiento de Sistemas de Aire Acondicionado Industrial'; if (v.includes('ciber')) return 'Ciberseguridad'; if (v.includes('contab')) return 'Contabilidad'; if (v.includes('comercial') || v.includes('servicio al cliente')) return 'Ejecutivo Comercial y Servicio al Cliente'; if (v.includes('textil') || v.includes('diseno de productos')) return 'Diseño de Productos Industriales Textiles'; if (v.includes('electrom')) return 'Electromecánica'; return value || 'Sin especialidad'; }
  const NEW_PREMATRICULA_FROM = new Date('2026-10-01T00:00:00-06:00');
  function parseRecordDate(value) { const text = String(value || '').trim(); const parsed = new Date(text); if (!Number.isNaN(parsed.getTime())) return parsed; const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/); return match ? new Date(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T${match[4] || '00:00:00'}-06:00`) : null; }
  function repairStudentRecordGaps(records) { const groups = {}; records.forEach(record => { const key = String(record.id || record.email || '').toLowerCase().replace(/\s+/g, ' ').trim(); if (key) (groups[key] ||= []).push(record); }); records.forEach(record => { const key = String(record.id || record.email || '').toLowerCase().replace(/\s+/g, ' ').trim(), peers = groups[key] || []; const complete = peers.find(peer => peer.name && peer.name !== 'Sin nombre'); if ((!record.name || record.name === 'Sin nombre') && complete) { record.name = complete.name; const nameKey = Object.keys(record.raw || {}).find(k => /nombre completo/i.test(k)); if (nameKey) record.raw[nameKey] = complete.name; } if ((!record.specialty || record.specialty === 'Sin especialidad') && complete && complete.specialty && complete.specialty !== 'Sin especialidad') { record.specialty = complete.specialty; const specialtyKey = Object.keys(record.raw || {}).find(k => /especialidad.*matricular/i.test(k)); if (specialtyKey) record.raw[specialtyKey] = complete.specialty; } if (!record.email && complete?.email) record.email = complete.email; if (!record.phone && complete?.phone) record.phone = complete.phone; }); return records; }
  function prepareRecords(raw) { const records = raw.map((r, index) => { const status = field(r, /estado|situacion|condicion/i) || 'Pre-matriculado', timestamp = field(r, /marca temporal/i), recordDate = parseRecordDate(timestamp); return { raw: r, index, name: field(r, /nombre completo|nombre.*apellido/i) || 'Sin nombre', id: field(r, /cedula|documento de identidad/i), email: field(r, /correo electr/i), phone: field(r, /telefono principal|telefono|celular/i), specialty: normalizeSpecialty(field(r, /especialidad|carrera|tecnica.*interes/i)), status, province: field(r, /provincia/i), canton: field(r, /canton/i), timestamp, syncId: field(r, /id de sincronización/i), isNew: /pre.?matriculad|nuevo/i.test(status) && !!recordDate && recordDate >= NEW_PREMATRICULA_FROM }; }); repairStudentRecordGaps(records); const groups = {}; records.forEach(r => { const key = String(r.id || r.name || '').toLowerCase().replace(/\s+/g, ' ').trim(); (groups[key] ||= []).push(r); }); records.forEach(r => { const key = String(r.id || r.name || '').toLowerCase().replace(/\s+/g, ' ').trim(), group = groups[key] || []; r.duplicateSpecialties = [...new Set(group.map(x => x.specialty))]; r.duplicate = group.length > 1; }); return records; }
  let remoteRequestInFlight = false;
  let remoteRequestToken = 0;
  let lastRemoteSnapshot = '';
  let remoteDatabaseAvailable = false;
  let backupDatabaseLoaded = false;
  async function restoreTeacherDatabaseBackup() {
    if (remoteDatabaseAvailable || backupDatabaseLoaded || csvState.records.length) return;
    try {
      const response = await fetch('data/base-datos-2026.csv?v=20261011-database-145', { cache: 'no-store' });
      if (!response.ok) throw new Error('Respaldo no disponible');
      csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(await response.text())));
      backupDatabaseLoaded = true;
      renderDatabase();
      $('#db-source').textContent = `Respaldo institucional recuperado · ${csvState.records.length} registros · reconectando con la base en línea…`;
    } catch (_) {
      $('#db-source').textContent = 'No fue posible conectar con la base institucional ni recuperar el respaldo.';
    }
  }
  function loadRemoteTeacherDatabase() {
    if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) return;
    if (remoteRequestInFlight) return;
    remoteRequestInFlight = true;
    const requestToken = ++remoteRequestToken;
    let settled = false;
    let responseTimer;
    let fallbackScript;
    const finish = () => {
      window.clearTimeout(responseTimer);
      if (fallbackScript) fallbackScript.remove();
      remoteRequestInFlight = false;
    };
    const fail = message => {
      if (settled || requestToken !== remoteRequestToken) return;
      settled = true;
      finish();
      // Nunca se sustituye la fuente institucional con un CSV local: mostrar una
      // copia antigua sería confuso y permitiría que datos eliminados reaparezcan.
      csvState.records.splice(0, csvState.records.length);
      renderDatabase();
      $('#db-source').textContent = message;
    };
    const applyPayload = payload => {
      if (settled || requestToken !== remoteRequestToken) return true;
      if (!payload?.ok || !Array.isArray(payload.rows)) return false;
      settled = true;
      try {
        const headers = payload.headers || [];
        const snapshot = JSON.stringify([headers, payload.rows, payload.assessments || {}]);
        // La consulta automática no vuelve a pintar nada si la fuente no cambió.
        if (snapshot !== lastRemoteSnapshot) {
          lastRemoteSnapshot = snapshot;
          remoteDatabaseAvailable = true;
          const raw = payload.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
          if (Array.isArray(payload.appointments)) {
            saveAppointments([...getAppointments(), ...payload.appointments]);
            updateDashboard();
          }
          hydrateAssessments(payload.assessments || {});
          const recordsToDisplay = prepareRecords(raw);
          csvState.records.splice(0, csvState.records.length, ...recordsToDisplay);
          renderDatabase();
          updateDatabaseCounters();
          const synchronizedAt = payload.updatedAt || new Date().toLocaleString('es-CR');
          $('#db-source').textContent = `Base institucional sincronizada · ${csvState.records.length} registros · última consulta: ${synchronizedAt}`;
        }
      } catch (error) {
        settled = false;
        fail(`No se pudo procesar la respuesta institucional: ${error?.message || 'error desconocido'}.`);
        return true;
      }
      finish();
      return true;
    };
    const requestJsonpFallback = () => {
      if (settled || requestToken !== remoteRequestToken) return;
      const callback = `stnReceiveTeacherDatabase_${Date.now()}`;
      fallbackScript = document.createElement('script');
      window[callback] = payload => {
        delete window[callback];
        if (!applyPayload(payload)) fail('La base institucional respondió con un formato no válido.');
      };
      const fallbackParams = new URLSearchParams({ action: 'data', authToken: getAuthToken(), callback, _: String(Date.now()) });
      fallbackScript.src = `${SYNC_ENDPOINT}?${fallbackParams.toString()}`;
      fallbackScript.onerror = () => { delete window[callback]; fail('No fue posible consultar la base institucional.'); };
      document.body.append(fallbackScript);
    };
    // Fetch con CORS funciona de forma consistente en Chrome, Edge, Firefox y Safari.
    // JSONP queda como respaldo para redes que bloqueen solicitudes fetch.
    responseTimer = window.setTimeout(() => fail('No fue posible consultar la base institucional. No se muestran datos sin confirmación remota.'), 45000);
    const remoteParams = new URLSearchParams({ action: 'data', authToken: getAuthToken(), _: String(Date.now()) });
    fetch(`${SYNC_ENDPOINT}?${remoteParams.toString()}`, { cache: 'no-store', mode: 'cors', headers: { Accept: 'application/json' } })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(payload => { if (!applyPayload(payload)) requestJsonpFallback(); })
      .catch(() => requestJsonpFallback());
  }
  async function loadTeacherDatabase() {
    try {
      // La fuente institucional remota es la única fuente cuando está disponible.
      // Cargar primero la copia CSV local (124) y después la remota (137) hacía que
      // el contador alternara en cada refresco y parecía que los registros regresaban.
      if (SYNC_ENDPOINT && !SYNC_ENDPOINT.includes('PASTE_')) {
        $('#db-source').textContent = 'Consultando la base institucional compartida…';
        // No se muestran datos de una copia local mientras responde el servidor:
        // la información visible debe ser idéntica en todos los dispositivos.
        csvState.records.splice(0, csvState.records.length);
        renderDatabase();
        loadRemoteTeacherDatabase();
        startTeacherDatabaseRefresh();
        return;
      }
      // Solo sin sincronización remota se muestra un respaldo local/importado.
      const imported = localStorage.getItem('stn-imported-csv');
      const csvText = imported || await fetch('data/base-datos-2026.csv?v=20261011-database-145', { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(new Error('Sin respaldo')));
      csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(csvText)));
      renderDatabase();
      $('#db-source').textContent = `Respaldo local · ${csvState.records.length} registros · sin conexión al servicio institucional`;
    } catch (_) { $('#db-source').textContent = 'No fue posible cargar la base institucional.'; }
  }
  loadTeacherDatabaseForSession = loadTeacherDatabase;
  if (teacherAccess.role) loadTeacherDatabaseForSession();
  let teacherDatabaseTimer;
  // La base se sincroniza automáticamente; no depende de un botón manual.
  // Al volver a la pestaña se consulta de inmediato y, mientras permanece
  // abierta, se comprueba cada 30 segundos sin superponer solicitudes.
  function startTeacherDatabaseRefresh() {
    if (teacherDatabaseTimer) return;
    teacherDatabaseTimer = setInterval(loadRemoteTeacherDatabase, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRemoteTeacherDatabase(); });
    window.addEventListener('focus', loadRemoteTeacherDatabase);
  }
  function updateDatabaseCounters() { const pre = csvState.records.filter(r => !/matriculad[oa]/i.test(r.status) || /pre.?matriculad/i.test(r.status)).length, mat = csvState.records.filter(r => /matriculad[oa]/i.test(r.status) && !/pre.?matriculad/i.test(r.status)).length; const preCount = $('#pre-count'); const matCount = $('#mat-count'); if (preCount) preCount.textContent = pre; if (matCount) matCount.textContent = mat; }
  function normalizeSearchText(value) { return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, ' ').trim(); }
  const reportState = { specialty: 'Todas', status: 'Todas', province: 'Todas', canton: 'Todas', from: '', to: '', query: '', order: 'alphabetical', fields: { phone: true, address: true, accommodations: true, age: true, education: true, children: true, country: true } };
  const reportField = name => $(`#report-${name}`);
  const reportUniqueValues = key => [...new Set(csvState.records.map(record => String(record[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  function fillReportSelect(name, values, allLabel) {
    const select = reportField(name); if (!select) return;
    const current = reportState[name] || 'Todas';
    select.innerHTML = `<option value="Todas">${escapeHtml(allLabel)}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    select.value = values.includes(current) || current === 'Todas' ? current : 'Todas';
    reportState[name] = select.value;
  }
  function updateReportFilters() {
    fillReportSelect('specialty', reportUniqueValues('specialty'), 'Todas las especialidades');
    fillReportSelect('status', reportUniqueValues('status'), 'Todos los estados');
    fillReportSelect('province', reportUniqueValues('province'), 'Todas las provincias');
    fillReportSelect('canton', reportUniqueValues('canton'), 'Todos los cantones');
    const rows = getReportRows();
    const count = $('#report-count'); if (count) count.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} seleccionado${rows.length === 1 ? '' : 's'}`;
  }
  function getReportRows() {
    const from = reportState.from ? new Date(`${reportState.from}T00:00:00`) : null;
    const to = reportState.to ? new Date(`${reportState.to}T23:59:59`) : null;
    const query = normalizeSearchText(reportState.query);
    const filtered = csvState.records.filter(record => {
      const recordDate = parseRecordDate(record.timestamp);
      const matchesText = !query || normalizeSearchText([record.name, record.id, record.email, record.phone, record.specialty, record.status, record.province, record.canton, ...Object.values(record.raw)].join(' ')).includes(query);
      return (reportState.specialty === 'Todas' || record.specialty === reportState.specialty)
        && (reportState.status === 'Todas' || record.status === reportState.status)
        && (reportState.province === 'Todas' || record.province === reportState.province)
        && (reportState.canton === 'Todas' || record.canton === reportState.canton)
        && (!from || (recordDate && recordDate >= from))
        && (!to || (recordDate && recordDate <= to))
        && matchesText;
    });
    return filtered.sort((a, b) => {
      if (reportState.order === 'alphabetical') return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
      const aDate = parseRecordDate(a.timestamp)?.getTime() || 0, bDate = parseRecordDate(b.timestamp)?.getTime() || 0;
      return reportState.order === 'date-asc' ? aDate - bDate : bDate - aDate;
    });
  }
  const escapeXml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const reportFileStem = () => `informe-stn-${reportState.specialty === 'Todas' ? 'general' : normalizeSearchText(reportState.specialty).replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  const reportExtraColumns = [
    { key: 'phone', label: 'Teléfono', value: record => record.phone || field(record.raw, /tel[eé]fono principal|tel[eé]fono|celular/i) },
    { key: 'address', label: 'Dirección', value: record => field(record.raw, /direcci[oó]n exacta|direcci[oó]n.*residencia/i) },
    { key: 'accommodations', label: 'Adecuación curricular', value: record => field(record.raw, /adecuaciones/i) },
    { key: 'age', label: 'Edad', value: record => field(record.raw, /^edad$/i) },
    { key: 'education', label: 'Estudios alcanzados', value: record => field(record.raw, /estudios.*alcanzados/i) },
    { key: 'children', label: 'Hijos', value: record => field(record.raw, /cu[aá]ntos hijos/i) },
    { key: 'country', label: 'País de origen', value: record => field(record.raw, /pa[ií]s de origen/i) }
  ];
  const reportColumns = () => [
    { label: 'Estudiante', value: record => record.name }, { label: 'Identificación', value: record => record.id }, { label: 'Especialidad', value: record => record.specialty }, { label: 'Estado', value: record => record.status }, { label: 'Correo electrónico', value: record => record.email }, { label: 'Fecha de prematrícula', value: record => record.timestamp }, { label: 'Duplicado en otras especialidades', value: record => { const others = [...new Set((record.duplicateSpecialties || []).filter(specialty => specialty && specialty !== record.specialty))]; return others.length ? others.join(' · ') : 'No'; } },
    ...reportExtraColumns.filter(column => reportState.fields[column.key])
  ];
  const reportOrientation = columns => columns.length > 7 ? 'landscape' : 'portrait';
  const reportColumnWidth = column => /Dirección|Duplicado/i.test(column.label) ? 240 : (/Correo|Estudiante|Especialidad/i.test(column.label) ? 175 : 118);
  function downloadReportFile(content, type, extension) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${reportFileStem()}.${extension}`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  function requireReportRows() {
    if (!hasInstitutionalOverview()) return null;
    const rows = getReportRows();
    if (!rows.length) { alert('No hay registros para los filtros seleccionados.'); return null; }
    return rows;
  }
  function reportFilterText() {
    const orderLabel = reportState.order === 'alphabetical' ? 'Nombre: A a Z' : (reportState.order === 'date-asc' ? 'Fecha: más antigua' : 'Fecha: más reciente');
    const filters = [['Especialidad', reportState.specialty], ['Estado', reportState.status], ['Provincia', reportState.province], ['Cantón', reportState.canton], ['Desde', reportState.from || 'Sin límite'], ['Hasta', reportState.to || 'Sin límite'], ['Búsqueda', reportState.query || 'Sin filtro'], ['Orden', orderLabel]].filter(([, value]) => value && value !== 'Todas');
    return filters.length ? filters.map(([key, value]) => `${key}: ${value}`).join(' · ') : 'Informe general institucional, sin filtros.';
  }
  function downloadReportExcel() {
    const rows = requireReportRows(); if (!rows) return;
    const columns = reportColumns();
    const cell = (value, style = '') => `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
    const orientation = reportOrientation(columns) === 'landscape' ? 'Landscape' : 'Portrait';
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel"><Styles><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#FFFFFF"/><Interior ss:Color="#0A3B73" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="Subtitle"><Font ss:Bold="1" ss:Color="#0A3B73"/><Interior ss:Color="#DDF5F5" ss:Pattern="Solid"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#14558D" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:WrapText="1"/></Style><Style ss:ID="Text"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style></Styles><Worksheet ss:Name="Informe STN"><Table><Column ss:Width="42"/>${columns.map(column => `<Column ss:AutoFitWidth="1" ss:Width="${reportColumnWidth(column)}"/>`).join('')}<Row ss:Height="28"><Cell ss:MergeAcross="${columns.length}" ss:StyleID="Title"><Data ss:Type="String">SECCIÓN TÉCNICA NOCTURNA · CTP CALLE BLANCOS</Data></Cell></Row><Row><Cell ss:MergeAcross="${columns.length}" ss:StyleID="Subtitle"><Data ss:Type="String">Informe institucional de estudiantes · ${escapeXml(reportFilterText())}</Data></Cell></Row><Row><Cell ss:MergeAcross="${columns.length}" ss:StyleID="Subtitle"><Data ss:Type="String">Registros incluidos: ${rows.length} · Generado: ${escapeXml(new Date().toLocaleString('es-CR'))}</Data></Cell></Row><Row>${cell('#', 'Header')}${columns.map(column => cell(column.label, 'Header')).join('')}</Row>${rows.map((record, index) => `<Row>${cell(index + 1, 'Text')}${columns.map(column => cell(column.value(record) || '—', 'Text')).join('')}</Row>`).join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="${orientation}"/></PageSetup><FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight></Print></WorksheetOptions></Worksheet></Workbook>`;
    downloadReportFile(xml, 'application/vnd.ms-excel;charset=utf-8', 'xls');
  }
  function downloadReportWord() {
    const rows = requireReportRows(); if (!rows) return;
    const columns = reportColumns();
    const orientation = reportOrientation(columns);
    const assetUrl = file => new URL(`assets/${file}`, window.location.href).href;
    const table = `<table><thead><tr><th>#</th>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((record, index) => `<tr><td>${index + 1}</td>${columns.map(column => `<td>${escapeHtml(column.value(record) || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe STN</title><style>@page{size:${orientation};margin:1.5cm}body{font-family:Arial,sans-serif;color:#112f55}.brand{width:100%;border-bottom:4px solid #17a8be;padding-bottom:12px;margin-bottom:15px}.brand img{width:68px;height:68px;object-fit:contain;vertical-align:middle}.brand .stn{width:98px;margin-right:18px}.brand div{display:inline-block;vertical-align:middle}.brand h1{margin:0;color:#0a3b73;font-size:19pt}.brand p{margin:4px 0;color:#466882;font-size:10pt}.summary{padding:10px 12px;background:#e6f6f7;border-left:4px solid #17a8be;font-size:9pt;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:${orientation === 'landscape' ? '7.5pt' : '9pt'};table-layout:${orientation === 'landscape' ? 'fixed' : 'auto'}}th{background:#14558d;color:#fff;text-align:left}th,td{border:1px solid #b9cce0;padding:6px;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even){background:#f5f9fd}</style></head><body><section class="brand"><img class="stn" src="${assetUrl('logo-stn.jpeg')}" alt="Logo STN"><div><h1>Sección Técnica Nocturna · CTP Calle Blancos</h1><p>Informe institucional de estudiantes · Admisión 2027</p></div><img src="${assetUrl('escudo-ctp.png')}" alt="Escudo CTP Calle Blancos"></section><div class="summary"><b>Filtros aplicados:</b> ${escapeHtml(reportFilterText())}<br><b>Registros incluidos:</b> ${rows.length} &nbsp;|&nbsp; <b>Generado:</b> ${escapeHtml(new Date().toLocaleString('es-CR'))}</div>${table}</body></html>`;
    downloadReportFile(html, 'application/msword;charset=utf-8', 'doc');
  }
  function openPrintableReport() {
    if (!hasInstitutionalOverview()) return;
    const rows = getReportRows();
    if (!rows.length) { alert('No hay registros para los filtros seleccionados.'); return; }
    const popout = window.open('', '_blank');
    if (!popout) { alert('El navegador bloqueó la ventana del informe. Permití ventanas emergentes e intentá de nuevo.'); return; }
    const assetUrl = file => new URL(`assets/${file}`, window.location.href).href;
    const columns = reportColumns();
    const orientation = reportOrientation(columns);
    const filters = [['Especialidad', reportState.specialty], ['Estado', reportState.status], ['Provincia', reportState.province], ['Cantón', reportState.canton], ['Desde', reportState.from || 'Sin límite'], ['Hasta', reportState.to || 'Sin límite'], ['Búsqueda', reportState.query || 'Sin filtro']].filter(([, value]) => value && value !== 'Todas');
    const filterMarkup = filters.length ? filters.map(([key, value]) => `<span><b>${escapeHtml(key)}:</b> ${escapeHtml(value)}</span>`).join('') : '<span>Sin filtros: informe general institucional.</span>';
    const rowsMarkup = rows.map((record, index) => `<tr><td>${index + 1}</td>${columns.map(column => `<td>${escapeHtml(column.value(record) || '—')}</td>`).join('')}</tr>`).join('');
    popout.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe STN</title><style>body{font-family:Arial,sans-serif;color:#10294f;margin:0;background:#eef4fa}.sheet{max-width:${orientation === 'landscape' ? '1400px' : '900px'};margin:24px auto;background:#fff;padding:34px;box-shadow:0 8px 28px #001b3c22}.head{display:flex;align-items:center;gap:20px;border-bottom:4px solid #17a8be;padding-bottom:18px}.head img{width:78px;height:78px;object-fit:contain}.head .stn{width:105px;border-radius:8px}.head h1{margin:0;font-size:24px}.head p{margin:6px 0 0;color:#55708e}.meta{display:flex;justify-content:space-between;gap:20px;margin:18px 0;font-size:13px}.filters{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}.filters span{padding:6px 9px;background:#eaf5f7;border:1px solid #c4e5e8;border-radius:999px;font-size:12px}table{width:100%;border-collapse:collapse;font-size:${orientation === 'landscape' ? '9px' : '12px'};table-layout:${orientation === 'landscape' ? 'fixed' : 'auto'}}th{background:#123d70;color:#fff;text-align:left}th,td{padding:9px;border:1px solid #cedbe8;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even){background:#f5f9fd}.tools{margin-bottom:20px}.tools button{background:#0b6592;color:white;border:0;border-radius:6px;padding:9px 12px;font-weight:bold;cursor:pointer}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:0}.tools{display:none}@page{size:${orientation};margin:12mm}}</style></head><body><main class="sheet"><div class="tools"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div><header class="head"><img class="stn" src="${assetUrl('logo-stn.jpeg')}" alt="Logo STN"><div><h1>Sección Técnica Nocturna · CTP Calle Blancos</h1><p>Informe institucional de estudiantes · Admisión 2027</p></div><img src="${assetUrl('escudo-ctp.png')}" alt="Escudo CTP Calle Blancos"></header><div class="meta"><span><b>Registros incluidos:</b> ${rows.length}</span><span><b>Generado:</b> ${escapeHtml(new Date().toLocaleString('es-CR'))}</span></div><section class="filters">${filterMarkup}</section><table><thead><tr><th>#</th>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${rowsMarkup}</tbody></table></main></body></html>`);
    popout.document.close();
  }
  function renderRecordField(key, value) {
    const text = String(value || '');
    const isAttachment = /adjunta.*titulo|archivo adjunto|documento adjunto/i.test(key);
    if (isAttachment && /^https:\/\/drive\.google\.com\//i.test(text)) {
      return `<a class="attachment-link" href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer">↗ Ver archivo adjunto</a>`;
    }
    return escapeHtml(text || '—');
  }
  function duplicateSpecialtyMarkup(specialties) {
    const uniqueSpecialties = [...new Set((specialties || []).filter(Boolean))];
    return `<div class="duplicate-badge"><span class="duplicate-label">Duplicado en</span><span class="duplicate-specialties">${uniqueSpecialties.map(specialty => `<span class="duplicate-specialty">${escapeHtml(specialty)}</span>`).join('')}</span></div>`;
  }

  const assessmentPanel = document.createElement('section');
  assessmentPanel.className = 'assessment-panel hidden';
  assessmentPanel.id = 'assessment-panel';
  db.before(assessmentPanel);
  const assessmentState = { configs: Object.create(null), records: Object.create(null) };
  const assessmentNumber = value => {
    const parsed = Number(String(value == null ? '' : value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const assessmentKeyText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const assessmentDisplay = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('es-CR', { maximumFractionDigits: 2 });
  const canGradeAssessments = () => teacherAccess.role === 'admin' || teacherAccess.role === 'department';
  const canGradeRecord = record => canGradeAssessments() && (!allowedTeacherSpecialty() || record.specialty === allowedTeacherSpecialty());
  function hydrateAssessments(payload) {
    assessmentState.configs = payload && payload.configs && typeof payload.configs === 'object' ? payload.configs : Object.create(null);
    assessmentState.records = payload && payload.records && typeof payload.records === 'object' ? payload.records : Object.create(null);
  }
  function assessmentForRecord(record) {
    const syncId = String(record.syncId || record.raw?.['ID de sincronización'] || '');
    const id = assessmentKeyText(record.id);
    const name = assessmentKeyText(record.name);
    const specialty = assessmentKeyText(record.specialty);
    return Object.values(assessmentState.records).find(item => {
      if (syncId && String(item.syncId || '') === syncId) return true;
      return assessmentKeyText(item.identification) === id && assessmentKeyText(item.name) === name && assessmentKeyText(item.specialty) === specialty;
    }) || null;
  }
  function assessmentConfigFor(specialty) {
    const exact = assessmentState.configs[specialty];
    if (exact) return assessmentNumber(exact.total);
    const key = assessmentKeyText(specialty);
    const match = Object.entries(assessmentState.configs).find(([name]) => assessmentKeyText(name) === key);
    return match ? assessmentNumber(match[1]?.total) : null;
  }
  async function postInstitutional(payload) {
    const response = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, authToken: getAuthToken() })
    });
    if (!response.ok) throw new Error('No se recibió confirmación del servidor institucional.');
    const result = await response.json();
    if (!result?.ok) throw new Error(result?.message || 'La base institucional rechazó la actualización.');
    return result;
  }
  function calculateAssessment(interview, examScore, examTotal) {
    if (interview == null || examScore == null || examTotal == null || examTotal <= 0) return null;
    const interviewResult = Math.min(60, Math.max(0, Number(interview)));
    const examResult = Math.min(examTotal, Math.max(0, Number(examScore)));
    const percentage = Math.round((examResult / examTotal * 100) * 100) / 100;
    const interviewContribution = Math.round(interviewResult * 100) / 100;
    const examContribution = Math.round((examResult / examTotal * 40) * 100) / 100;
    const weighted = Math.round((interviewContribution + examContribution) * 100) / 100;
    return { percentage, interviewContribution, examContribution, weighted };
  }
  function renderAssessmentPanel(activeFilter) {
    if (!teacherAccess.role) { assessmentPanel.classList.add('hidden'); assessmentPanel.innerHTML = ''; return; }
    assessmentPanel.classList.remove('hidden');
    const assessmentSpecialties = ['Ciberseguridad', 'Contabilidad', 'Ejecutivo Comercial y Servicio al Cliente', 'Mantenimiento de Sistemas de Aire Acondicionado Industrial', 'Electromecánica', 'Diseño de Productos Industriales Textiles'];
    const specialtySelected = activeFilter && activeFilter !== 'Todas';
    const configSpecialty = specialtySelected ? activeFilter : '';
    const configuredTotal = configSpecialty ? assessmentConfigFor(configSpecialty) : null;
    const editable = canGradeAssessments() && Boolean(configSpecialty);
    const roleHint = teacherAccess.role === 'administrative'
      ? 'Consulta de solo lectura. Acceso solo para el Administrador o el departamento técnico autorizado para registrar calificaciones.'
      : specialtySelected
        ? 'Definí el puntaje máximo una vez para esta especialidad antes de ingresar los resultados de examen.'
        : 'Elegí una especialidad técnica en este panel o en las pestañas de la base para habilitar el puntaje total.';
    assessmentPanel.innerHTML =
      '<div class="assessment-panel-head"><div><span class="assessment-kicker">Evaluación de admisión</span><h3>Entrevista 60 % + examen 40 %</h3><p>La entrevista se ingresa directamente como aporte de 0 a 60 puntos y el examen aporta hasta 40 puntos; juntos forman una nota sobre 100.</p></div><div class="assessment-formula"><b>Nota final</b><span>(Aporte entrevista sobre 60) + (Aporte examen sobre 40)</span></div></div>' +
      '<div class="assessment-config"><div class="assessment-config-specialty">' +
      (teacherAccess.role === 'admin' && !specialtySelected ? '<label for="assessment-config-specialty">Especialidad para configurar<select id="assessment-config-specialty"><option value="">Seleccioná una especialidad</option>' + assessmentSpecialties.map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('') + '</select></label>' : '<span><b>Especialidad seleccionada</b><strong>' + escapeHtml(configSpecialty || allowedTeacherSpecialty() || '—') + '</strong></span>') +
      '<small>' + escapeHtml(roleHint) + '</small></div><div><label for="assessment-exam-total">Puntaje total de la prueba / examen de admisión</label>' +
      '<div class="assessment-config-control"><input id="assessment-exam-total" type="number" min="1" step="0.01" inputmode="decimal" placeholder="Ej. 100" value="' + (configuredTotal == null ? '' : escapeHtml(configuredTotal)) + '" ' + (editable ? '' : 'disabled') + '><button type="button" id="save-assessment-config" ' + (editable ? '' : 'disabled') + '>Guardar puntaje total</button></div></div></div>' +
      '<div class="assessment-legend"><span class="legend-interview">Entrevista · 60 %</span><span class="legend-exam">Examen · 40 %</span><span class="legend-weighted">Ponderado / Nota final</span></div>' +
      '<p class="assessment-explanation">Ingresá directamente el aporte de la entrevista entre 0 y 60 puntos. El examen se convierte proporcionalmente a un aporte máximo de 40 puntos según su puntaje total; ambos forman la nota final sobre 100.</p>';
    const configSelector = $('#assessment-config-specialty', assessmentPanel);
    configSelector?.addEventListener('change', () => {
      if (!configSelector.value) return;
      csvState.filter = configSelector.value;
      renderDatabase();
    });
    const saveConfig = $('#save-assessment-config', assessmentPanel);
    saveConfig?.addEventListener('click', async () => {
      const input = $('#assessment-exam-total', assessmentPanel);
      const total = assessmentNumber(input?.value);
      const specialtyToSave = configSpecialty || configSelector?.value || allowedTeacherSpecialty() || '';
      if (!specialtyToSave || total == null || total <= 0) { alert('Elegí una especialidad e ingresá un puntaje total mayor que cero.'); return; }
      saveConfig.disabled = true;
      saveConfig.textContent = 'Guardando…';
      try {
        const result = await postInstitutional({ action: 'assessment-config', specialty: specialtyToSave, examTotal: total });
        hydrateAssessments(result.assessments);
        renderDatabase();
        $('#db-source').textContent = 'Puntaje total guardado en la base institucional para ' + specialtyToSave + '.';
      } catch (error) {
        alert(error.message || 'No se pudo guardar el puntaje total.');
        saveConfig.disabled = false;
        saveConfig.textContent = 'Guardar puntaje total';
      }
    });
  }
  function assessmentInputs(record) {
    const score = assessmentForRecord(record);
    const total = assessmentConfigFor(record.specialty);
    const editable = canGradeRecord(record);
    const interview = score ? assessmentNumber(score.interview) : null;
    const exam = score ? assessmentNumber(score.examScore) : null;
    const calculated = calculateAssessment(interview, exam, total || assessmentNumber(score?.examTotal));
    if (!editable) return '<div class="assessment-readonly"><span>' + (calculated ? assessmentDisplay(calculated.interviewContribution) + ' / 60' : '—') + '</span><span>' + assessmentDisplay(exam) + (total ? ' / ' + assessmentDisplay(total) : '') + '</span><b>' + (calculated ? assessmentDisplay(calculated.percentage) + ' % → ' + assessmentDisplay(calculated.examContribution) + ' / 40' : '—') + '</b><strong>' + (calculated ? assessmentDisplay(calculated.weighted) + ' / 100' : '—') + '</strong></div>';
    const totalText = total == null ? 'Configurá el total' : 'de ' + assessmentDisplay(total);
    return '<div class="assessment-entry" data-assessment-row="' + record.index + '" data-exam-total="' + (total == null ? '' : total) + '">' +
      '<label><input class="assessment-input assessment-interview-input" data-assessment-interview type="number" min="0" max="60" step="0.01" inputmode="decimal" value="' + (interview == null ? '' : interview) + '" placeholder="0–60"><small>Aporte entrevista (0–60) <span data-assessment-interview-contribution>' + (calculated ? assessmentDisplay(calculated.interviewContribution) + ' / 60' : '— / 60') + '</span></small></label>' +
      '<label><input class="assessment-input assessment-exam-input" data-assessment-exam type="number" min="0" ' + (total == null ? 'disabled' : 'max="' + total + '"') + ' step="0.01" inputmode="decimal" value="' + (exam == null ? '' : exam) + '" placeholder="' + escapeHtml(totalText) + '"><small>Puntaje examen · aporte hasta 40</small></label>' +
      '<span class="assessment-percentage" data-assessment-percentage>' + (calculated ? assessmentDisplay(calculated.percentage) + ' % → ' + assessmentDisplay(calculated.examContribution) + ' / 40' : '—') + '</span>' +
      '<span class="assessment-weighted" data-assessment-weighted>' + (calculated ? assessmentDisplay(calculated.weighted) + ' / 100' : '—') + '</span>' +
      '<button type="button" class="assessment-save" data-assessment-save="' + record.index + '"' + (total == null ? ' disabled title="Configurá el puntaje total primero"' : '') + '>Guardar nota</button></div>';
  }
  function refreshAssessmentPreview(container) {
    const total = assessmentNumber(container.dataset.examTotal);
    const interview = assessmentNumber($('[data-assessment-interview]', container)?.value);
    const exam = assessmentNumber($('[data-assessment-exam]', container)?.value);
    const calculated = calculateAssessment(interview, exam, total);
    const percentage = $('[data-assessment-percentage]', container);
    const weighted = $('[data-assessment-weighted]', container);
    const interviewContribution = $('[data-assessment-interview-contribution]', container);
    if (interviewContribution) interviewContribution.textContent = calculated ? assessmentDisplay(calculated.interviewContribution) + ' / 60' : '— / 60';
    if (percentage) percentage.textContent = calculated ? assessmentDisplay(calculated.percentage) + ' % → ' + assessmentDisplay(calculated.examContribution) + ' / 40' : '—';
    if (weighted) weighted.textContent = calculated ? assessmentDisplay(calculated.weighted) + ' / 100' : '—';
  }
  async function saveAssessment(recordIndex, button) {
    const record = csvState.records.find(item => item.index === Number(recordIndex));
    const container = button.closest('[data-assessment-row]');
    const total = assessmentNumber(container?.dataset.examTotal);
    const interview = assessmentNumber($('[data-assessment-interview]', container)?.value);
    const examScore = assessmentNumber($('[data-assessment-exam]', container)?.value);
    if (!record || total == null || interview == null || interview < 0 || interview > 60 || examScore == null || examScore < 0 || examScore > total) {
      alert('Completá el aporte de entrevista entre 0 y 60 y un puntaje de examen válido según el total configurado.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      const result = await postInstitutional({ action: 'assessment', syncId: record.syncId || record.raw?.['ID de sincronización'] || '', identification: record.id || '', name: record.name || '', specialty: record.specialty, interview, examScore, examTotal: total });
      hydrateAssessments(result.assessments);
      renderDatabase();
      $('#db-source').textContent = 'Nota de ' + record.name + ' guardada y confirmada en la base institucional.';
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Guardar nota';
      alert(error.message || 'No se pudo guardar la evaluación.');
    }
  }
  function bindAssessmentEvents() {
    $$('.assessment-input', db).forEach(input => input.addEventListener('input', () => refreshAssessmentPreview(input.closest('[data-assessment-row]'))));
    $$('.assessment-save', db).forEach(button => button.addEventListener('click', () => saveAssessment(button.dataset.assessmentSave, button)));
  }

  function renderDatabase() {
    const activeFilter = allowedTeacherSpecialty() || csvState.filter;
    const search = normalizeSearchText(csvState.search);
    const scopedRows = csvState.records.filter(r => activeFilter === 'Todas' || r.specialty === activeFilter);
    const rows = scopedRows.filter(r => !search || normalizeSearchText([r.name, r.id, r.email, r.phone, r.specialty, r.status, ...Object.values(r.raw)].join(' ')).includes(search));
    const duplicateCount = rows.filter(r => r.duplicate).length;
    $('#db-total').textContent = csvState.records.length;
    $('#db-visible').textContent = rows.length;
    $('#db-duplicates').textContent = duplicateCount;
    updateDatabaseCounters();
    $('#db-source').textContent = csvState.records.length ? 'Base institucional · filtro: ' + activeFilter + (search ? ' · búsqueda: ' + csvState.search.trim() : '') : 'Consultando la base institucional…';
    renderAssessmentPanel(activeFilter);
    const uniqueDuplicates = [...new Map(rows.filter(r => r.duplicate && r.duplicateSpecialties.length > 1).map(r => [r.id || r.name, r])).values()];
    $('#teacher-duplicate-list').innerHTML = uniqueDuplicates.length
      ? '<div class="teacher-duplicate-head"><div><span>Revisión por especialidad</span><h3>Estudiantes registrados en más de una especialidad</h3><p>Verificá estos casos antes de programar entrevistas o exámenes.</p></div><b>' + uniqueDuplicates.length + '</b></div><div class="duplicate-list-grid">' + uniqueDuplicates.map(r => '<article class="duplicate-card"><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.id || 'Identificación no registrada') + '</small><div class="duplicate-card-specialties">' + r.duplicateSpecialties.map(s => '<span>' + escapeHtml(s) + '</span>').join('') + '</div></article>').join('') + '</div>'
      : '<div class="teacher-duplicate-empty"><b>✓ Sin duplicados en ' + escapeHtml(activeFilter) + '</b><span>Los registros visibles pertenecen a una única especialidad.</span></div>';
    $('#csv-table-body').innerHTML = rows.length ? rows.map(r => {
      const viewKey = recordViewKey(r);
      const duplicateInfo = r.duplicate ? duplicateSpecialtyMarkup(r.duplicateSpecialties) : '<span class="ok-badge">Registro único</span>';
      const action = '<button class="table-action" data-record="' + r.index + '" type="button">Agendar</button>' + (teacherAccess.role === 'admin' ? '<button class="table-delete database-delete" data-record-delete="' + r.index + '" type="button">Eliminar</button>' : '');
      return '<tr class="' + (r.duplicate ? 'is-duplicate' : '') + '"><td data-label="Estudiante"><b>' + escapeHtml(r.name) + '</b><details class="record-details" data-detail-key="' + escapeHtml(viewKey) + '"' + (expandedRecordKeys.has(viewKey) ? ' open' : '') + '><summary>Ver todos los datos</summary><dl>' + Object.entries(r.raw).map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd>' + renderRecordField(k, v) + '</dd>').join('') + '</dl></details></td><td data-label="Identificación">' + escapeHtml(r.id || '—') + '</td><td data-label="Especialidad">' + escapeHtml(r.specialty) + '</td><td data-label="Contacto"><a href="mailto:' + encodeURIComponent(r.email) + '">' + escapeHtml(r.email || '—') + '</a><small>' + escapeHtml(r.phone || '') + '</small></td><td data-label="Estado y duplicados"><span class="new-status-badge">' + escapeHtml(r.isNew ? 'NUEVO · PREMATRICULADO' : (r.status || 'Registrado')) + '</span><small class="record-timestamp">' + escapeHtml(r.timestamp || 'Fecha no disponible') + '</small><div class="duplicate-inline">' + duplicateInfo + '</div></td><td data-label="Evaluación de admisión" colspan="4">' + assessmentInputs(r) + '</td><td data-label="Acción">' + action + '</td></tr>';
    }).join('') : '<tr><td colspan="10">No hay registros para esta búsqueda o especialidad.</td></tr>';
    $$('.record-details', db).forEach(details => details.addEventListener('toggle', () => {
      const key = details.dataset.detailKey;
      if (!key) return;
      if (details.open) expandedRecordKeys.add(key); else expandedRecordKeys.delete(key);
    }));
    $$('.table-action', db).forEach(btn => btn.addEventListener('click', () => {
      const r = csvState.records.find(x => x.index === Number(btn.dataset.record));
      if (!r || (allowedTeacherSpecialty() && r.specialty !== allowedTeacherSpecialty())) return;
      $('#teacher-candidate').value = r.name;
      $('#teacher-candidate-email').value = r.email;
      $('#teacher-candidate-contact').value = r.phone;
      $('#teacher-specialty').value = r.specialty;
      teacherAgenda.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    $$('.database-delete', db).forEach(btn => btn.addEventListener('click', () => {
      if (teacherAccess.role !== 'admin') return;
      const record = csvState.records.find(x => x.index === Number(btn.dataset.recordDelete));
      if (!record || !window.confirm('¿Confirmás eliminar a ' + record.name + ' de la base de datos? Esta acción no se puede deshacer.')) return;
      btn.disabled = true; btn.textContent = 'Eliminando…';
      $('#db-source').textContent = 'Solicitando eliminación a la base institucional…';
      deletePrematriculaFromRemote(record).then(result => {
        if (!result?.ok) throw new Error(result?.message || 'El servidor no confirmó la eliminación.');
        rememberDeletedRecord(record);
        $('#db-source').textContent = 'Eliminación confirmada en la base institucional · actualizando datos…';
        window.setTimeout(() => loadTeacherDatabaseForSession?.(), 500);
      }).catch(error => {
        btn.disabled = false; btn.textContent = 'Eliminar';
        $('#db-source').textContent = 'No se pudo confirmar la eliminación: ' + (error.message || 'intentá de nuevo.');
      });
    }));
    bindAssessmentEvents();
    syncDatabaseScrollbar();
    if (hasInstitutionalOverview()) updateReportFilters();
  }
    $('#student-search').addEventListener('input', e => { csvState.search = e.target.value; renderDatabase(); });
  $('#clear-student-search').addEventListener('click', () => { csvState.search = ''; $('#student-search').value = ''; renderDatabase(); $('#student-search').focus(); });
  ['specialty', 'status', 'province', 'canton', 'from', 'to', 'order', 'query'].forEach(name => reportField(name)?.addEventListener(name === 'query' ? 'input' : 'change', event => { reportState[name] = event.target.value; const count = $('#report-count'); if (count) { const rows = getReportRows(); count.textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'} seleccionado${rows.length === 1 ? '' : 's'}`; } }));
  $$('[data-report-field]', reporting).forEach(input => input.addEventListener('change', event => { reportState.fields[event.currentTarget.dataset.reportField] = event.currentTarget.checked; }));
  $('#report-preview')?.addEventListener('click', openPrintableReport);
  $('#report-excel')?.addEventListener('click', downloadReportExcel);
  $('#report-word')?.addEventListener('click', downloadReportWord);
  $('#csv-upload').addEventListener('change', async e => { if (!canManageRecords()) { e.target.value = ''; alert('Acceso solo para el Administrador.'); return; } const file = e.target.files[0]; if (!file) return; const text = await file.text(); localStorage.setItem('stn-imported-csv', text); const deletedKeys = getDeletedRecordKeys(); csvState.records.splice(0, csvState.records.length, ...prepareRecords(csvParse(text)).filter(record => shouldDisplayRecoveredRecord(record, deletedKeys))); csvState.filter = $('.specialty-tab.active')?.dataset.specialty || 'Todas'; renderDatabase(); $('#db-source').textContent = `Base importada en este dispositivo · ${csvState.records.length} registros · solo lectura`; e.target.value = ''; });
  exportButton.addEventListener('click', () => { if (!hasInstitutionalOverview()) { alert('Acceso solo para el Administrador o el personal administrativo.'); return; } if (!csvState.records.length) { alert('No hay registros cargados para exportar.'); return; } const headers = Object.keys(csvState.records[0].raw); const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`; const csv = [headers.map(quote).join(','), ...csvState.records.map(record => headers.map(header => quote(record.raw[header])).join(','))].join('\r\n'); const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `respaldo-stn-prematriculas-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); });
  if (teacherAccess.role) applyTeacherAccess();
  $$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { csvState.filter = tab.dataset.specialty; renderDatabase(); }));
  renderDatabase();
  $('#save-appointment').addEventListener('click', e => { e.stopImmediatePropagation(); const date = $('#teacher-appointment-date').value, name = $('#teacher-candidate').value.trim(), email = $('#teacher-candidate-email').value.trim(), professor = $('#teacher-professor').value.trim(), sender = $('#teacher-sender-email').value.trim(), professorPhone = $('#teacher-professor-phone').value.trim(), specialty = $('#teacher-specialty').value, type = $('#teacher-appointment-type').value, time = $('#teacher-appointment-time').value, message = $('#teacher-appointment-message'), allowed = allowedTeacherSpecialty(); if (allowed && specialty !== allowed) { message.textContent = `Esta agenda solo permite citas de ${allowed}.`; message.classList.add('error'); return; } if (!date || !name || !email || !professor || !sender || !professorPhone) { message.textContent = 'Completá estudiante, correo, profesor, teléfono de contacto y fecha para enviar la confirmación.'; message.classList.add('error'); sendButton.disabled = true; return; } const subject = encodeURIComponent(`Confirmación de cita STN · ${date} · ${time}`), body = encodeURIComponent(`Hola ${name},\n\nLa Sección Técnica Nocturna del CTP Calle Blancos confirma tu cita de ${type.toLowerCase()}.\n\nFecha: ${date}\nHora: ${time}\nEspecialidad: ${specialty}\n\nProfesor a cargo: ${professor}\nContacto del profesor: ${professorPhone}\nCorreo del profesor: ${sender}\n\nEl profesor a cargo organizará las entrevistas y los exámenes de admisión correspondientes a tu especialidad. Posteriormente, se te incluirá en un grupo oficial de WhatsApp para compartir información y avisos relacionados con el proceso.\n\nSi necesitás apoyo, podés comunicarte con el profesor a cargo mediante los datos indicados.\n\nAtentamente,\nSección Técnica Nocturna\nCTP Calle Blancos`); pendingMailto = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`; sendButton.disabled = false; message.classList.remove('error'); message.textContent = '✓ Cita registrada. La confirmación incluye el contacto del profesor y la información del grupo oficial de WhatsApp.'; const appointments = getAppointments(); const appointment = { id: crypto.randomUUID?.() || `cita-${Date.now()}-${Math.random().toString(36).slice(2)}`, specialty, type, date, time, name, email, professor, sender, professorPhone }; appointments.push(appointment); saveAppointments(appointments); syncAppointmentToRemote(appointment); updateDashboard(); }, true);
  sendButton.addEventListener('click', () => { if (pendingMailto) window.location.href = pendingMailto; });
}
