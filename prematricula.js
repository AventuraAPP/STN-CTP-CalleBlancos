const SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyyeomXgKMvXwOJsZq3bjx56tJ0hRpmZcKJ8V9OAUgAOZdDUOJvpVzyd8WLNEcgJCjE/exec';

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
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('El archivo supera el límite de 8 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No fue posible leer el archivo adjunto.'));
    reader.onload = () => resolve({ name: file.name, mime: file.type || 'application/octet-stream', base64: String(reader.result || '').split(',').pop() || '' });
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
const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
function requestRemoteSnapshot() {
  return new Promise((resolve, reject) => {
    if (!SYNC_ENDPOINT || SYNC_ENDPOINT.includes('PASTE_')) { reject(new Error('El servicio institucional no está configurado.')); return; }
    const callback = `stnSyncCheck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => { window.clearTimeout(timer); delete window[callback]; script.remove(); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('La base institucional no respondió a tiempo.')); }, 10000);
    window[callback] = payload => { cleanup(); payload?.ok ? resolve(payload) : reject(new Error(payload?.message || 'La base institucional rechazó la consulta.')); };
    script.onerror = () => { cleanup(); reject(new Error('No fue posible contactar la base institucional.')); };
    script.src = `${SYNC_ENDPOINT}?callback=${callback}&_=${Date.now()}`;
    document.body.append(script);
  });
}
function remotePayloadHasSyncId(payload, syncId) {
  const headers = payload?.headers || [];
  const idColumn = headers.findIndex(header => /id de sincronizaci[oó]n|syncid/i.test(String(header)));
  return idColumn >= 0 && (payload.rows || []).some(row => String(row?.[idColumn] || '') === String(syncId));
}
async function waitForRemoteRecord(syncId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const snapshot = await requestRemoteSnapshot();
    if (remotePayloadHasSyncId(snapshot, syncId)) return snapshot;
    await wait(900);
  }
  throw new Error('La base institucional no confirmó el registro.');
}
async function sendRecordToRemote(record) {
  if (!navigator.onLine) throw new Error('No hay conexión a Internet.');
  const payload = JSON.stringify({ action: 'create', ...nativeRecordToRemotePayload(record) });
  await fetch(SYNC_ENDPOINT, { method: 'POST', mode: 'no-cors', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload });
  return waitForRemoteRecord(record.syncId || record.createdAt);
}
async function syncPrematriculaToRemote(record) {
  queuePendingSync(record);
  await flushPendingSync();
  const pending = readPendingSync().some(item => (item.syncId || item.createdAt) === (record.syncId || record.createdAt));
  return { ok: !pending, pending };
}
window.addEventListener('online', flushPendingSync);
setInterval(flushPendingSync, 30000);

const form = document.querySelector('#public-prematricula-form');
const message = document.querySelector('#public-prematricula-message');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const file = form.querySelector('[name="titleFile"]')?.files?.[0];
  const submitButton = form.querySelector('[type="submit"]');
  let attachment = null;
  try { attachment = await readAttachmentForSync(file); }
  catch (error) { message.textContent = error.message; message.classList.add('error'); return; }
  const record = { ...values, titleFile: file?.name || '', status: 'Pre-matriculado', createdAt: new Date().toISOString(), syncId: (crypto.randomUUID?.() || `stn-${Date.now()}-${Math.random().toString(36).slice(2)}`) };
  if (submitButton) submitButton.disabled = true;
  message.textContent = 'Guardando y verificando la respuesta de la base institucional…';
  message.classList.remove('error');
  const remoteRecord = attachment ? { ...record, titleFileContent: attachment.base64, titleFileMime: attachment.mime } : record;
  try {
    const result = await syncPrematriculaToRemote(remoteRecord);
    if (!result?.ok) throw new Error('La base institucional no confirmó el registro.');
    message.textContent = `✓ Prematrícula confirmada en la base institucional para ${values.name}${attachment ? ', con su documento adjunto' : ''}.`;
    form.reset();
    window.opener?.postMessage({ type: 'stn-prematricula-saved', createdAt: record.createdAt }, window.location.origin);
  } catch (error) {
    queuePendingSync(remoteRecord);
    message.classList.add('error');
    message.textContent = `No se confirmó la prematrícula en la base institucional. El envío quedó pendiente solo en este dispositivo: ${error.message || 'revisá la conexión e intentá de nuevo.'}`;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});
