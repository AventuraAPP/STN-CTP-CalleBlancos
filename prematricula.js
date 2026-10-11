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
      await fetch(SYNC_ENDPOINT, { method: 'POST', mode: 'no-cors', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'create', ...nativeRecordToRemotePayload(record) }) });
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

const form = document.querySelector('#public-prematricula-form');
const message = document.querySelector('#public-prematricula-message');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const file = form.querySelector('[name="titleFile"]')?.files?.[0];
  let attachment = null;
  try { attachment = await readAttachmentForSync(file); }
  catch (error) { message.textContent = error.message; message.classList.add('error'); return; }
  const record = { ...values, titleFile: file?.name || '', status: 'Pre-matriculado', createdAt: new Date().toISOString(), syncId: (crypto.randomUUID?.() || `stn-${Date.now()}-${Math.random().toString(36).slice(2)}`) };
  const records = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]');
  records.unshift(record);
  localStorage.setItem('stn-prematriculas', JSON.stringify(records));
  message.textContent = `✓ Prematrícula de ${values.name} registrada localmente. ${attachment ? 'Cargando documento adjunto…' : (navigator.onLine ? 'Sincronizando con la base institucional…' : 'Quedó en cola y se enviará al recuperar la conexión.')}`;
  const remoteRecord = attachment ? { ...record, titleFileContent: attachment.base64, titleFileMime: attachment.mime } : record;
  syncPrematriculaToRemote(remoteRecord).then(() => {
    const pending = readPendingSync().some(item => item.createdAt === record.createdAt);
    message.textContent = pending ? `✓ Prematrícula guardada; pendiente de sincronización para ${values.name}.` : `✓ Prematrícula registrada y enviada a la base institucional para ${values.name}${attachment ? ', con su documento adjunto' : ''}.`;
  });
  const students = JSON.parse(localStorage.getItem('stn-students') || '[]');
  students.unshift({ name: values.name, contact: values.phone || values.email, specialty: values.specialty, status: 'Pre-matriculado', identification: values.identification, email: values.email });
  localStorage.setItem('stn-students', JSON.stringify(students));
  message.classList.remove('error');
  form.reset();
  window.opener?.postMessage({ type: 'stn-prematricula-saved', createdAt: record.createdAt }, window.location.origin);
});
