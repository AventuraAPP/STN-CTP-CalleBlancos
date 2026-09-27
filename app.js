const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const menu = $('.menu-toggle');
const nav = $('.main-nav');
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
  { id: 'guide', name: 'Orientación STN', initials: 'OR', time: 'Hace poco', text: 'Recordá completar la pre-matrícula y reservar tu cita para entrevista o examen.', likes: 8 }
];
function loadPosts() { return JSON.parse(localStorage.getItem('stn-posts') || 'null') || samplePosts; }
function savePosts(posts) { localStorage.setItem('stn-posts', JSON.stringify(posts)); }
function renderPosts() {
  const posts = loadPosts();
  $('#feed').innerHTML = posts.map(post => `<article class="post"><div class="post-meta"><span class="avatar">${post.initials}</span><div><b>${post.name}</b><small>${post.time}</small></div></div><p class="post-body">${escapeHtml(post.text)}</p><div class="post-actions"><button class="like-button ${post.liked ? 'liked' : ''}" data-id="${post.id}">♡ ${post.likes || 0} Me interesa</button><button type="button">◌ Consultar</button></div></article>`).join('');
  $$('.like-button').forEach(button => button.addEventListener('click', () => { const items = loadPosts(); const post = items.find(x => x.id === button.dataset.id); post.liked = !post.liked; post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1)); savePosts(items); renderPosts(); }));
}
function escapeHtml(text) { const el = document.createElement('div'); el.textContent = text; return el.innerHTML; }
const postText = $('#post-text');
postText.addEventListener('input', () => $('.character-count').textContent = `${postText.value.length} / 400`);
$('#post-form').addEventListener('submit', e => { e.preventDefault(); const text = postText.value.trim(); if (!text) return; const posts = loadPosts(); posts.unshift({ id: Date.now().toString(), name: 'Consulta de visitante', initials: 'CV', time: 'Ahora', text, likes: 0 }); savePosts(posts); postText.value = ''; $('.character-count').textContent = '0 / 400'; renderPosts(); });
renderPosts();

function getStudents() { return JSON.parse(localStorage.getItem('stn-students') || '[]'); }
function getDocs() { return JSON.parse(localStorage.getItem('stn-documents') || '[]'); }
function getAppointments() { return JSON.parse(localStorage.getItem('stn-appointments') || '[]'); }
function renderAppointments(filter = 'Todas') { const list = getAppointments().filter(a => filter === 'Todas' || a.specialty === filter); $('#appointments-list').innerHTML = list.length ? list.map(a => `<div class="appointment-row"><div><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.specialty)} · ${escapeHtml(a.type)} · Prof. ${escapeHtml(a.professor || 'Por asignar')}</small></div><strong>${escapeHtml(a.date)} · ${escapeHtml(a.time)}</strong></div>`).join('') : '<p>No hay citas para esta especialidad.</p>'; }
function updateDashboard() {
  const students = getStudents(), docs = getDocs(), appointments = getAppointments();
  $('#pre-count').textContent = students.filter(s => s.status === 'Pre-matriculado').length; $('#mat-count').textContent = students.filter(s => s.status === 'Matriculado').length; $('#doc-count').textContent = docs.length; $('#appointment-count').textContent = appointments.length;
  $('#student-table').innerHTML = students.length ? students.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.status)}</td><td>${escapeHtml(s.specialty || 'Sin asignar')}</td><td>${escapeHtml(s.contact)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="4">Aún no hay registros cargados.</td></tr>';
  $('#documents-list').innerHTML = docs.length ? docs.map(d => `<div class="document-item"><span>▧ ${escapeHtml(d.name)}</span><small>${d.date}</small></div>`).join('') : '<p>Los documentos cargados aparecerán aquí.</p>';
  renderAppointments($('.specialty-tab.active')?.dataset.specialty || 'Todas');
}
$('#teacher-login').addEventListener('submit', e => { e.preventDefault(); const message = $('#login-message'); if ($('#teacher-password').value === 'RoyAdmSTN') { $('#teacher-login').classList.add('hidden'); $('#teacher-dashboard').classList.remove('hidden'); sessionStorage.setItem('stn-teacher', 'true'); updateDashboard(); } else { message.textContent = 'Contraseña incorrecta.'; message.classList.add('error'); } });
if (sessionStorage.getItem('stn-teacher')) { $('#teacher-login').classList.add('hidden'); $('#teacher-dashboard').classList.remove('hidden'); updateDashboard(); }
$('#logout').addEventListener('click', () => { sessionStorage.removeItem('stn-teacher'); $('#teacher-dashboard').classList.add('hidden'); $('#teacher-login').classList.remove('hidden'); $('#teacher-password').value = ''; });
$('#add-student').addEventListener('click', () => { const name = prompt('Nombre completo del estudiante:'); if (!name?.trim()) return; const contact = prompt('Teléfono o correo de contacto:') || 'Sin dato'; const choice = prompt('Escribí 1 para Pre-matriculado o 2 para Matriculado:', '1'); const specialty = $('#teacher-specialty').value; const students = getStudents(); students.push({ name: name.trim(), contact: contact.trim(), specialty, status: choice === '2' ? 'Matriculado' : 'Pre-matriculado' }); localStorage.setItem('stn-students', JSON.stringify(students)); updateDashboard(); });
$('#doc-upload').addEventListener('change', e => { const docs = getDocs(); [...e.target.files].forEach(file => docs.unshift({ name: file.name, date: new Date().toLocaleDateString('es-CR') })); localStorage.setItem('stn-documents', JSON.stringify(docs)); e.target.value = ''; updateDashboard(); });
$('#save-appointment').addEventListener('click', () => { const specialty = $('#teacher-specialty').value, type = $('#teacher-appointment-type').value, date = $('#teacher-appointment-date').value, time = $('#teacher-appointment-time').value, name = $('#teacher-candidate').value.trim(), email = $('#teacher-candidate-email').value.trim(), professor = $('#teacher-professor').value.trim(), contact = $('#teacher-candidate-contact').value.trim(), message = $('#teacher-appointment-message'); if (!date || !name || !email || !professor) { message.textContent = 'Completá estudiante, correo, profesor y fecha para guardar.'; message.classList.add('error'); return; } const appointment = { specialty, type, date, time, name, email, professor, contact }; const appointments = getAppointments(); appointments.push(appointment); localStorage.setItem('stn-appointments', JSON.stringify(appointments)); const subject = encodeURIComponent(`Confirmación de cita STN · ${date} · ${time}`); const body = encodeURIComponent(`Hola ${name},\n\nConfirmamos tu cita de ${type.toLowerCase()} en la Sección Técnica Nocturna.\n\nFecha: ${date}\nHora: ${time}\nEspecialidad: ${specialty}\nProfesor a cargo: ${professor}\n\nPara consultas: 6195-5775.`); message.classList.remove('error'); message.innerHTML = `✓ Cita guardada. <a class="confirmation-link" href="mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}">Abrir correo de confirmación para enviar ↗</a>`; $('#teacher-candidate').value = ''; $('#teacher-candidate-email').value = ''; $('#teacher-professor').value = ''; $('#teacher-candidate-contact').value = ''; updateDashboard(); });
$$('.specialty-tab').forEach(tab => tab.addEventListener('click', () => { $$('.specialty-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); renderAppointments(tab.dataset.specialty); }));
$('#edit-ticker').addEventListener('click', () => { const message = prompt('Mensaje institucional visible para la comunidad:', localStorage.getItem('stn-ticker') || $('#ticker-message').textContent); if (message?.trim()) { localStorage.setItem('stn-ticker', message.trim()); $('#ticker-message').textContent = message.trim(); } });
$('#ticker-message').textContent = localStorage.getItem('stn-ticker') || $('#ticker-message').textContent;

const assistantReplies = [
  { keys: ['prematr', 'formulario', 'inscrib', 'inscrip'], text: 'La pre-matrícula 2027 se completa en el formulario oficial. Usá el botón “Pre-matrícula 2027” o escribinos por WhatsApp al 6195-5775.' },
  { keys: ['especial', 'oferta', 'carrera', 'ciber', 'contab', 'comercial', 'aire', 'electrom', 'textil', 'diseño'], text: 'La oferta 2027 incluye Ciberseguridad, Contabilidad, Ejecutivo Comercial y Servicio al Cliente, Mantenimiento de Sistemas de Aire Acondicionado Industrial, Electromecánica y Diseño de Productos Industriales Textiles.' },
  { keys: ['hora', 'horario', 'noche', 'cita', 'examen', 'entrevista'], text: 'Las citas de entrevista y examen las administra cada docente desde el Portal para docentes, de lunes a viernes entre 6:00 p. m. y 9:00 p. m.' },
  { keys: ['whatsapp', 'teléfono', 'telefono', 'contacto', 'ubicación', 'ubicacion'], text: 'Podés contactarnos por WhatsApp al 6195-5775. También encontrás el enlace directo en la página.' },
  { keys: ['docente', 'portal', 'teams'], text: 'El Portal para docentes está protegido y contiene una pestaña por especialidad, agenda, registros y documentos informativos.' }
];
function assistantReply(question) { const q = question.toLowerCase(); const found = assistantReplies.find(item => item.keys.some(key => q.includes(key))); return found?.text || 'Puedo orientarte sobre pre-matrícula, especialidades, horarios de examen y entrevista, Portal docente o WhatsApp. ¿Qué necesitás saber?'; }
const assistantLaunch = $('#assistant-launch'), assistantPanel = $('#assistant-panel'), assistantForm = $('#assistant-form'), assistantInput = $('#assistant-input'), assistantMessages = $('#assistant-messages');
assistantLaunch.addEventListener('click', () => { const open = assistantPanel.classList.toggle('hidden'); assistantLaunch.setAttribute('aria-expanded', String(!open)); if (!open) assistantInput.focus(); });
$('#assistant-close').addEventListener('click', () => { assistantPanel.classList.add('hidden'); assistantLaunch.setAttribute('aria-expanded', 'false'); });
assistantForm.addEventListener('submit', e => { e.preventDefault(); const question = assistantInput.value.trim(); if (!question) return; assistantMessages.insertAdjacentHTML('beforeend', `<div class="assistant-bubble user">${escapeHtml(question)}</div><div class="assistant-bubble">${escapeHtml(assistantReply(question))}</div>`); assistantInput.value = ''; assistantMessages.scrollTop = assistantMessages.scrollHeight; });
