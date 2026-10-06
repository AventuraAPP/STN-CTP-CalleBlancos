const SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyyeomXgKMvXwOJsZq3bjx56tJ0hRpmZcKJ8V9OAUgAOZdDUOJvpVzyd8WLNEcgJCjE/exec';

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
    } catch (_) { remaining.push(record); }
  }
  writePendingSync(remaining);
}
async function syncPrematriculaToRemote(record) { queuePendingSync(record); await flushPendingSync(); }
window.addEventListener('online', flushPendingSync);
setInterval(flushPendingSync, 30000);

const form = document.querySelector('#public-prematricula-form');
const message = document.querySelector('#public-prematricula-message');
form?.addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const file = form.querySelector('[name="titleFile"]')?.files?.[0];
  const record = { ...values, titleFile: file?.name || '', status: 'Pre-matriculado', createdAt: new Date().toISOString() };
  const records = JSON.parse(localStorage.getItem('stn-prematriculas') || '[]');
  records.unshift(record);
  localStorage.setItem('stn-prematriculas', JSON.stringify(records));
  message.textContent = `✓ Prematrícula registrada localmente. ${navigator.onLine ? 'Sincronizando con la base institucional…' : 'Quedó en cola y se enviará al recuperar la conexión.'}`;
  syncPrematriculaToRemote(record).then(() => {
    const pending = readPendingSync().some(item => item.createdAt === record.createdAt);
    message.textContent = pending ? `✓ Prematrícula guardada; pendiente de sincronización para ${values.name}.` : `✓ Prematrícula registrada y enviada a la base institucional para ${values.name}.`;
  });
  const students = JSON.parse(localStorage.getItem('stn-students') || '[]');
  students.unshift({ name: values.name, contact: values.phone || values.email, specialty: values.specialty, status: 'Pre-matriculado', identification: values.identification, email: values.email });
  localStorage.setItem('stn-students', JSON.stringify(students));
  message.classList.remove('error');
  form.reset();
  window.opener?.postMessage({ type: 'stn-prematricula-saved' }, window.location.origin);
});
