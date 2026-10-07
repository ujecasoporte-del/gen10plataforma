'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const files = window.G10Files;
  const roles = {admin:'Administración', docente:'Docente', estudiante:'Estudiante'};
  const labels = {perfil:'Mi perfil', expediente:'Datos y documentos del alumno',inicio:'Mi inicio', cursos:'Mis cursos', tareas:'Tareas', examenes:'Exámenes', seguimiento:'Notas y avance', administracion:'Administración', curso:'Mi curso'};
  let token = sessionStorage.getItem('gen10Sesion') || '', data = null, view = 'inicio', courseId = '', courseTab = 'lecciones', pendingEmail = '', editorSave = null, loading = false, saving = false;
  let authPurpose = 'activar', authBusy = false;
  let pendingRequests=0;
  const loadingDialog=$('loadingDialog');
  loadingDialog.addEventListener('cancel',event=>event.preventDefault());
  function loadingState(active,action) {
    pendingRequests=Math.max(0,pendingRequests+(active?1:-1));
    if(active){
      $('loadingMessage').textContent=action==='gen10Login'?'Verificando tu acceso…':action==='gen10SolicitarCodigo'?'Preparando tu código de acceso…':action==='gen10Estado'?'Preparando tu campus…':'Procesando tu solicitud…';
      if(!loadingDialog.open)loadingDialog.showModal();
    }else if(!pendingRequests&&loadingDialog.open)loadingDialog.close();
  }
  document.querySelectorAll('[data-password]').forEach(button=>button.addEventListener('click',()=>{
    const input=$(button.dataset.password),show=input.type==='password';
    input.type=show?'text':'password';button.textContent=show?'Ocultar':'Mostrar';
    button.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');button.setAttribute('aria-pressed',String(show));
  }));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(value).toLocaleString('es-CO', {dateStyle:'medium', timeStyle:'short'}) : 'Sin fecha límite';
  const student = () => data.usuario.rol === 'estudiante';
  const admin = () => data.usuario.rol === 'admin';
  const inCourse = (key,id) => data[key].filter(r => r.curso === id);
  const person = email => data.usuarios.find(u => u.email === email)?.nombre || (email === data.usuario.email ? data.usuario.nombre : email);
  const badge = (text,kind='') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const button = (text,action,id='',quiet=true) => {
    const tables={completar:'lecciones',leccion:'lecciones',tarea:'tareas',examen:'tareas',entregar:'tareas','responder-examen':'tareas',calificar:'entregas',inscribir:'inscritos'};
    if(tables[action]||action==='editar-curso'){
      const entry=data?.[tables[action]]?.find(r=>r.id===id);
      const c=data?.cursos.find(c=>c.id===(action==='editar-curso'?id:entry?.curso||(view==='curso'?courseId:'')));
      if(c?.estado&&c.estado!=='Activo'&&(action!=='calificar'||c.estado==='Culminado'))return '';
    }
    return `<button type="button" ${quiet?'class="quiet"':''} data-action="${action}" data-id="${esc(id)}">${esc(text)}</button>`;
  };
  const empty = text => `<p class="empty">${esc(text)}</p>`;
  const isExam = t => t.tipo === 'examen';
  const validGrade = e => e && typeof e.nota === 'number' && Number.isFinite(e.nota) && e.nota >= 0 && e.nota <= 5;
  const score = value => value === null ? 'Pendiente' : value.toFixed(1);
  function requireEvaluations() {
    if(data.evaluaciones!=='gen10-examenes-v1')throw Error('Publica la nueva versión de Apps Script para configurar porcentajes y exámenes automáticos.');
  }
  function gradeBreakdown(course,email) {
    const rows=inCourse('tareas',course.id).filter(t=>t.publicado).map(t=>({task:t,submission:data.entregas.find(e=>e.tarea===t.id && e.email===email)}));
    function group(exam) {
      const items=rows.filter(r=>isExam(r.task)===exam), graded=items.filter(r=>validGrade(r.submission));
      return {items,graded:graded.length,average:graded.length?graded.reduce((sum,r)=>sum+r.submission.nota,0)/graded.length:null};
    }
    const tasks=group(false),exams=group(true),configured=Number.isInteger(course.pesoTareas) && course.pesoTareas>0 && course.pesoTareas<100;
    const partial=configured && tasks.average!==null && exams.average!==null ? (tasks.average*course.pesoTareas+exams.average*(100-course.pesoTareas))/100 : null;
    const complete=tasks.items.length>0 && exams.items.length>0 && tasks.graded===tasks.items.length && exams.graded===exams.items.length;
    return {rows,tasks,exams,configured,partial,final:complete?partial:null};
  }
  const resource = url => /^https:\/\/[^\s/@]+(?:[/:?#][^\s]*)?$/i.test(url || '') ? `<p><a class="resource" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir material o recurso <i class="bi bi-arrow-up-right" aria-hidden="true"></i></a></p>` : '';
  function notice(message, kind='info') { $('notice').textContent=message; $('notice').dataset.kind=kind; $('notice').hidden=false; }
  function clearNotice() { $('notice').hidden=true; }
  async function api(accion, fields={}) {
    const url = window.IFOBE_INSCRIPCION?.apiUrl;
    if (!url) throw Error('El campus todavía no tiene conexión configurada. Contacta a administración.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    const foreground=!['gen10LeerArchivo','gen10GuardarRespuestaExamen'].includes(accion);
    if(foreground)loadingState(true,accion);
    try {
      const response = await fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, redirect:'follow', credentials:'omit', signal:controller.signal, body:JSON.stringify({...fields, accion, token})});
      if (!response.ok) throw Error('No pudimos conectar con el campus. Intenta más tarde.');
      let result;
      try { result = await response.json(); } catch (_) { throw Error('El servicio no respondió correctamente. Contacta a administración.'); }
      if (result.ok !== true) throw Error(result.mensaje || 'No se confirmó la operación.');
      if (result.portal !== 'gen10-v1') throw Error('Es necesario publicar la versión de Apps Script que incluye el portal Gen10.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Se agotó el tiempo de espera. Actualiza antes de repetir la operación para comprobar si se guardó.');
      if (error instanceof TypeError) throw Error('No pudimos conectar. Revisa tu conexión y vuelve a intentar.');
      throw error;
    } finally { clearTimeout(timer); if(foreground)loadingState(false); }
  }
  function showAccess() {
    files.clear();
    window.G10Profile?.header();
    if ($('welcomeDialog').open) $('welcomeDialog').close();
    $('notifications').open=false;$('notificationList').replaceChildren();
    data=null; token=''; sessionStorage.removeItem('gen10Sesion'); $('campus').hidden=true; $('account').hidden=true; $('access').hidden=false;
    authScreen('login'); $('email').disabled=false;
    if ($('editor').open) $('editor').close();
    $('view').replaceChildren();
  }
  async function refresh(welcomeOnLogin=false) {
    if (loading) return;
    loading=true; $('refresh').disabled=true;
    try {
      data=await api('gen10Estado');
      rememberAccount(data.usuario.email);
      $('access').hidden=true; $('campus').hidden=false; $('account').hidden=false;
      $('accountName').textContent=`${data.usuario.nombre} · ${roles[data.usuario.rol]}`;
      window.G10Profile?.header(data.perfil);
      $('adminNav').hidden=!admin();
      $('profileNav').hidden=false;
      $('studentDataNav').hidden=!student()&&!admin();
      if(view==='expediente'&&!student()&&!admin())view='perfil';
      if (view==='administracion' && !admin()) view='inicio';
      if (view==='curso' && !data.cursos.some(c=>c.id===courseId)) view='cursos';
      render();
      window.G10Profile?.welcome(data.usuario,welcomeOnLogin===true);
    } catch (error) {
      if (/sesión|acceso no está activo/.test(error.message)) showAccess();
      throw error;
    } finally { loading=false; $('refresh').disabled=false; }
  }
  function progress(id,email=data.usuario.email) {
    const lessons=inCourse('lecciones',id).filter(l=>l.publicado);
    const done=lessons.filter(l=>data.progreso.some(p=>p.leccion===l.id && p.email===email)).length;
    return {total:lessons.length,done,percent:lessons.length ? Math.round(done/lessons.length*100):0};
  }
  function progressBar(p) { return `<div class="progress-label"><span>${p.done} de ${p.total} lecciones completadas</span><strong>${p.percent}%</strong></div><progress max="100" value="${p.percent}" aria-label="Progreso de lecciones: ${p.percent}%"></progress>`; }
  function courseCard(c) {
    return `<article class="course-card"><div class="course-cover"><i class="bi bi-journal-richtext" aria-hidden="true"></i>${files.cover(c)}${badge(c.publicado?'PUBLICADO':'BORRADOR',c.publicado?'':'draft')}</div><div class="course-body"><span class="course-kicker">CAMPUS GEN10 · IFOBE</span><h3>${esc(c.titulo)}</h3>${c.estado && c.estado!=='Activo'?badge(c.estado):''}<p>${esc(c.descripcion || 'Tu espacio de aprendizaje y actividades.')}</p><div class="course-meta"><span><i class="bi bi-journal-text" aria-hidden="true"></i> ${inCourse('lecciones',c.id).length} lecciones</span><span><i class="bi bi-check2-square" aria-hidden="true"></i> ${inCourse('tareas',c.id).filter(t=>!isExam(t)).length} tareas · ${inCourse('tareas',c.id).filter(isExam).length} exámenes</span></div>${student()?progressBar(progress(c.id)): `<p class="hint">${inCourse('inscritos',c.id).filter(e=>e.activo).length} estudiantes asignados</p>`}${button(student()?'Continuar aprendiendo →':'Gestionar curso →','curso',c.id,false)}</div></article>`;
  }
  function heading(title,action='') { return `<div class="section-heading"><h2>${esc(title)}</h2>${action}</div>`; }
  function renderStudentOverview() {
    const pending=data.tareas.filter(t=>t.publicado&&!data.entregas.some(e=>e.tarea===t.id&&e.email===data.usuario.email)).sort((a,b)=>(a.fechaLimite||'9999').localeCompare(b.fechaLimite||'9999'));
    return '<div class="learning-overview"><section class="panel agenda-panel">'+heading('Tu próximo paso')+(pending.length?pending.slice(0,3).map(t=>`<div class="agenda-item"><span class="agenda-icon"><i class="bi bi-${isExam(t)?'ui-checks':'journal-check'}"></i></span><div><small>${esc(data.cursos.find(c=>c.id===t.curso)?.titulo||'')}</small><h3>${esc(t.titulo)}</h3><p class="hint">${esc(date(t.fechaLimite))}</p></div>${button(isExam(t)?'Ver examen':'Ver tarea',isExam(t)?'vista-examenes':'vista-tareas')}</div>`).join(''):empty('Vas al día con tus entregas. Continúa con tus lecciones.'))+'</section><section class="panel grades-preview">'+heading('Tus resultados',button('Ver detalle','vista-seguimiento'))+data.cursos.map(c=>{const b=gradeBreakdown(c,data.usuario.email);return `<div class="grade-preview-row"><div><strong>${esc(c.titulo)}</strong><small>${b.rows.filter(r=>validGrade(r.submission)).length} de ${b.rows.length} evaluaciones calificadas</small></div><span>${score(b.final??b.partial)}<small>${b.final!==null?'Final':'Parcial'}</small></span></div>`;}).join('')+'</section></div>';
  }
  function renderHome() {
    const tasks=student()?data.tareas.filter(t=>!isExam(t) && t.publicado && !data.entregas.some(e=>e.tarea===t.id)):data.entregas.filter(e=>e.nota===null);
    const completed=student()?data.progreso.filter(p=>data.lecciones.some(l=>l.id===p.leccion && l.publicado)).length:data.inscritos.filter(e=>e.activo).length;
    return `<div class="welcome-banner"><p class="eyebrow">GEN10 / ${esc(roles[data.usuario.rol].toUpperCase())}</p><h1>Hola, ${esc(data.usuario.nombre.split(' ')[0])}.</h1><p>${student()?'Este es tu espacio para aprender. Retoma tus lecciones, encuentra tus próximas tareas y celebra lo que ya has avanzado.':'Acompaña el aprendizaje de tu comunidad. Organiza contenidos, revisa entregas y sigue el avance de tus estudiantes.'}</p></div><div class="stats-grid"><article class="stat"><strong>${data.cursos.length}</strong><span>Cursos asignados</span></article><article class="stat"><strong>${tasks.length}</strong><span>${student()?'Tareas por entregar':'Entregas por calificar'}</span></article><article class="stat"><strong>${completed}</strong><span>${student()?'Lecciones completadas':'Inscripciones en cursos'}</span></article></div>${student()?renderStudentOverview():''}${heading(student()?'Continúa aprendiendo':admin()?'Supervisión de cursos':'Mis cursos a cargo',button('Ver todos','vista-cursos'))}${data.cursos.length?`<div class="course-grid">${data.cursos.slice(0,4).map(courseCard).join('')}</div>`:empty(admin()?'Empieza habilitando docentes y estudiantes en Administración. Después crea tu primer curso.':'Aún no tienes cursos asignados. Coordinación Académica te indicará cuándo estarán disponibles.')}`;
  }
  function renderLesson(l) {
    const completed=data.progreso.some(p=>p.leccion===l.id && p.email===data.usuario.email);
    return `<article class="panel"><div class="task-top"><h3>${l.orden}. ${esc(l.titulo)}</h3>${!l.publicado?badge('Borrador','draft'):''}</div><div class="prose">${esc(l.contenido)}</div>${files.render(l.archivos,"Lecciones",l.id)}${resource(l.url)}<div class="actions">${student()?(completed?badge('Lección completada'):button('Marcar como completada','completar',l.id,false)):button('Editar lección','leccion',l.id)}</div></article>`;
  }
  function submissionDetails(e) {
    return `<div class="submission"><h4>${esc(person(e.email))}</h4><p class="hint">Entregada: ${esc(date(e.entregada))} ${e.tardia?badge('Fuera de plazo','late'):''}</p><div class="prose">${esc(e.contenido)}</div>${files.render(e.archivos,"Entregas",e.id)}${resource(e.url)}<p><strong>${e.nota===null?'Pendiente de calificar':`Nota: ${Number(e.nota).toFixed(1)} / 5.0`}</strong></p>${e.comentario?`<p class="prose">${esc(e.comentario)}</p>`:''}${student()?'':button(e.nota===null?'Calificar':'Revisar calificación','calificar',e.id)}${!student() && e.historial?.length?`<details><summary>Historial de calificación (${e.historial.length})</summary>${e.historial.map(h=>`<p class="hint">${esc(date(h.fecha))} · ${esc(h.docente)} · ${Number(h.nota).toFixed(1)}<br>${esc(h.comentario)}</p>`).join('')}</details>`:''}</div>`;
  }
  function renderTask(t,showCourse=false) {
    const submissions=data.entregas.filter(e=>e.tarea===t.id), own=submissions.find(e=>e.email===data.usuario.email);
    const course=data.cursos.find(c=>c.id===t.curso);
    return `<article class="panel">${showCourse?`<p class="eyebrow">${esc(course?.titulo)}</p>`:''}<div class="task-top"><h3>${esc(t.titulo)}</h3>${t.publicado?'':badge('Borrador','draft')}</div><p class="hint">Fecha límite: ${esc(date(t.fechaLimite))}</p><div class="prose">${esc(t.contenido)}</div>${files.render(t.archivos,"Tareas",t.id)}${resource(t.url)}<div class="actions">${student()?(own && own.nota!==null?'':button(own?'Actualizar mi entrega':'Entregar tarea','entregar',t.id,false)):button('Editar tarea','tarea',t.id)}</div>${student()?(own?submissionDetails(own):'<p class="hint">Todavía no has entregado esta tarea. Las entregas fuera de plazo quedan identificadas para el docente.</p>'):`<details><summary>Entregas (${submissions.length}) · ${submissions.filter(e=>e.nota===null).length} por calificar</summary>${submissions.length?submissions.map(submissionDetails).join(''):'<p class="hint">Todavía no hay entregas.</p>'}</details>`}</article>`;
  }
  function renderExam(t,showCourse=false) {
    const own=data.entregas.find(e=>e.tarea===t.id && e.email===data.usuario.email), submissions=data.entregas.filter(e=>e.tarea===t.id);
    const active=data.intentosExamen?.find(a=>a.tarea===t.id && a.email===data.usuario.email && !a.finalizado),used=own?(own.historialIntentos?.length||1):0;
    const expired=!!t.fechaLimite && Date.now()>Date.parse(t.fechaLimite);
    return `<article class="panel">${showCourse?`<p class="eyebrow">${esc(data.cursos.find(c=>c.id===t.curso)?.titulo)}</p>`:''}<div class="task-top"><h3>${esc(t.titulo)}</h3>${badge(t.publicado?'Examen':'Borrador',t.publicado?'':'draft')}</div><div class="prose">${esc(t.contenido)}</div><p class="hint">${t.preguntas?.length||0} preguntas · Selección múltiple · ${t.intentosPermitidos||1} intento(s) · ${t.duracionMinutos?`${t.duracionMinutos} minutos`:'Sin límite de duración'} · Fecha límite: ${esc(date(t.fechaLimite))}</p>${files.render(t.archivos,'Tareas',t.id)}${resource(t.url)}${student()?(own?`<p><strong>Mejor nota: ${score(own.nota)} / 5.0</strong></p><p>${esc(own.comentario)}</p>${active||(!expired&&used<(t.intentosPermitidos||1))?button(active?'Continuar examen':'Nuevo intento','responder-examen',t.id,false):''}`:expired&&!active?badge('Plazo terminado','late'):button('Responder examen','responder-examen',t.id,false)):`${button('Editar examen','examen',t.id)}<details><summary>Resultados (${submissions.length})</summary>${submissions.map(e=>`<p><strong>${esc(person(e.email))}: ${score(e.nota)} / 5.0</strong><br>${esc(e.comentario)}<br><span class="hint">${esc(date(e.entregada))}</span></p>`).join('')||'<p class="hint">Todavía no hay respuestas.</p>'}</details>`}</article>`;
  }
  function tracking(id) {
    const courses=id?data.cursos.filter(c=>c.id===id):data.cursos;
    return `<p class="grades-note">Escala de 0.0 a 5.0. Cada categoría promedia sus evaluaciones publicadas y calificadas con el mismo peso; 0.0 sí cuenta. Las pendientes no se convierten en cero. El docente define los porcentajes de tareas y exámenes. La nota final aparece cuando ambas categorías tienen evaluaciones y todas están calificadas. Las evaluaciones se vinculan al expediente académico del estudiante.</p>${courses.map(c=>{
      const members=student()?[{email:data.usuario.email,activo:true}]:inCourse('inscritos',c.id).filter(e=>e.activo);
      return `<section class="panel"><h3>${esc(c.titulo)}</h3>${student()&&['Cerrado','Culminado'].includes(c.estado)?button('Descargar calificaciones','descargar-notas',c.id):''}<p class="hint">${Number.isInteger(c.pesoTareas)?`Tareas: ${c.pesoTareas}% · Exámenes: ${100-c.pesoTareas}%.`:'Porcentajes pendientes de configurar por el docente.'}</p>${members.map(m=>{
        const b=gradeBreakdown(c,m.email),p=progress(c.id,m.email);
        const summary=(name,g,weight)=>`<article class="stat"><strong>${score(g.average)}</strong><span>${name} · ${g.graded}/${g.items.length} calificadas${b.configured?` · ${weight}%`:''}</span><p class="hint">Aporte: ${b.configured && g.average!==null?(g.average*weight/100).toFixed(2):'Pendiente'}</p></article>`;
        return `<div class="grade-student"><h4>${esc(person(m.email))}</h4>${progressBar(p)}<div class="stats-grid">${summary('Tareas',b.tasks,c.pesoTareas)}${summary('Exámenes',b.exams,100-c.pesoTareas)}<article class="stat"><strong>${score(b.final)}</strong><span>Nota final / 5.0</span><p class="hint">Resultado ponderado parcial: ${score(b.partial)}</p></article></div><div class="table-wrap"><table><thead><tr><th>Evaluación</th><th>Tipo</th><th>Estado</th><th>Nota / 5.0</th><th>Retroalimentación</th><th>Acción</th></tr></thead><tbody>${b.rows.map(({task:t,submission:e})=>`<tr><td>${esc(t.titulo)}</td><td>${isExam(t)?'Examen':'Tarea'}</td><td>${validGrade(e)?'Calificada':e?'Por calificar':'Sin entregar'}</td><td><strong>${validGrade(e)?score(e.nota):'Pendiente'}</strong></td><td>${esc(e?.comentario||'—')}</td><td>${!student()&&e&&!e.automatica?button(validGrade(e)?'Revisar nota':'Calificar','calificar',e.id):'—'}</td></tr>`).join('')||'<tr><td colspan="6">Todavía no hay evaluaciones publicadas.</td></tr>'}</tbody></table></div></div>`;
      }).join('')||empty('Este curso todavía no tiene estudiantes asignados.')}</section>`;
    }).join('') || empty('No hay cursos para mostrar.')}`;
  }
  function renderCourse() {
    const c=data.cursos.find(r=>r.id===courseId);
    if (!c) return empty('Curso no disponible.');
    const tabs=[['lecciones','Lecciones'],['tareas','Tareas'],['examenes','Exámenes'],['seguimiento','Notas y avance']];
    if (!student()) tabs.push(['grupo','Estudiantes'],['ajustes','Ajustes del curso']);
    let body='';
    if (courseTab==='lecciones') {
      const lessons=inCourse('lecciones',c.id).sort((a,b)=>a.orden-b.orden);
      body=heading('Contenido del curso',student()?'':button('Nueva lección','leccion'))+(lessons.map(renderLesson).join('')||empty('Las lecciones aparecerán aquí cuando el docente las publique.'));
    } else if (courseTab==='tareas') body=heading('Actividades',student()?'':button('Nueva tarea','tarea'))+(inCourse('tareas',c.id).filter(t=>!isExam(t)).map(t=>renderTask(t)).join('')||empty('Todavía no hay tareas en este curso.'));
    else if (courseTab==='examenes') body=heading('Exámenes',student()?'':button('Nuevo examen','examen'))+(inCourse('tareas',c.id).filter(isExam).map(t=>renderExam(t)).join('')||empty('Todavía no hay exámenes en este curso.'));
    else if (courseTab==='seguimiento') body=tracking(c.id);
    else if (courseTab==='ajustes' && !student()) {
      body=`<section class="panel course-settings"><p class="eyebrow">${admin()?'Administración general':'Gestión docente'}</p><h3>Configuración del curso</h3><dl><dt>Visibilidad</dt><dd>${c.publicado?'Publicado: disponible para estudiantes asignados.':'Borrador: oculto para los estudiantes.'}</dd><dt>Docente responsable</dt><dd>${esc(person(c.docente)||'Sin asignar')}</dd><dt>Materiales generales</dt><dd>${(c.archivos||[]).length} archivos adjuntos</dd></dl><p class="hint">${admin()?'Actualiza el docente responsable, la portada, los materiales y la publicación del curso.':'Actualiza el nombre, la descripción, la portada, los materiales y la publicación de tu curso.'}</p>${button('Editar configuración','editar-curso',c.id,false)}</section>`;
    }
    else if (!student()) {
      const members=inCourse('inscritos',c.id);
      body=heading('Estudiantes del curso',button('Asignar estudiante','inscribir'))+`<p class="staff-note">Asigna el correo de un estudiante que administración haya habilitado previamente. Esta asignación da acceso al curso dentro de Gen10.</p>`+(members.length?`<div class="panel table-wrap"><table><thead><tr><th>Estudiante</th><th>Correo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${members.map(m=>`<tr><td>${esc(person(m.email))}</td><td>${esc(m.email)}</td><td>${m.activo?'Activo':'Retirado'}</td><td>${button('Editar acceso','inscribir',m.id)}</td></tr>`).join('')}</tbody></table></div>`:empty('No hay estudiantes asignados.'));
    }
    const status=c.estado||'Activo';
    const lifecycle=`<section class="course-lifecycle"><div><strong>${esc(status)}</strong><p>${status==='Culminado'?'Curso culminado. Conserva sus materiales, notas y entregas para consulta.':status==='Cerrado'?'Nuevas actividades cerradas. El docente puede terminar de calificar.':'Curso abierto para actividades y entregas.'}</p></div>${!student()?(status==='Culminado'&&!admin()?'':button('Cambiar estado','estado-curso',c.id)):''}</section>`;
    return `${button('← Mis cursos','vista-cursos')}<div class="section-heading"><h2>${esc(c.titulo)}</h2>${!student()?button('Editar curso','editar-curso',c.id):''}</div>${lifecycle}<div class="course-hero">${files.cover(c)}</div><p class="prose muted">${esc(c.descripcion)}</p>${files.render(c.archivos,"Cursos",c.id)}${student()?progressBar(progress(c.id)):badge(c.publicado?'Publicado':'Borrador',c.publicado?'':'draft')}<div class="tabs" role="group" aria-label="Secciones del curso">${tabs.map(([key,label])=>`<button type="button" data-action="tab" data-id="${key}" aria-pressed="${courseTab===key}">${label}</button>`).join('')}</div>${body}`;
  }
  function renderAdmin() {
    return `${heading('Administración del campus',button('Habilitar usuario','usuario','',false))}<p class="staff-note">Habilita primero a docentes y estudiantes. Luego crea cursos, asigna un docente y agrega estudiantes al grupo. Las solicitudes públicas de inscripción no conceden acceso automáticamente.</p><div class="panel table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${data.usuarios.map(u=>`<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${esc(roles[u.rol])}</td><td>${u.activo?'Activo':'Inactivo'}</td><td>${button('Editar','usuario',u.id)}</td></tr>`).join('')}</tbody></table></div>${heading('Cursos',button('Crear curso','editar-curso','',false))}${data.cursos.length?`<div class="course-grid">${data.cursos.map(courseCard).join('')}</div>`:empty('Crea un curso y asígnalo a un docente activo.')}`;
  }
  function render() {
    if (!data) return;
    files.clear();
    $('campus').setAttribute('data-role',data.usuario.rol);
    document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view || (view==='curso'&&b.dataset.view==='cursos'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('breadcrumb').textContent=labels[view];
    let html;
    if(view==='perfil') html=renderUserProfile();
    else if(view==='expediente') html=renderProfile();
    else if(view==='inicio') html=renderHome();
    else if(view==='cursos') html=heading(student()?'Mis cursos':admin()?'Todos los cursos':'Cursos a mi cargo',admin()?button('Crear curso','editar-curso','',false):'')+(data.cursos.length?`<div class="course-grid">${data.cursos.map(courseCard).join('')}</div>`:empty('No tienes cursos asignados todavía.'));
    else if(view==='curso') html=renderCourse();
    else if(view==='tareas') html=heading(student()?'Mis tareas':'Tareas y entregas')+(data.tareas.filter(t=>!isExam(t)).map(t=>renderTask(t,true)).join('')||empty('Las tareas de tus cursos aparecerán aquí.'));
    else if(view==='examenes') html=heading('Exámenes')+(data.tareas.filter(isExam).map(t=>renderExam(t,true)).join('')||empty('Los exámenes de tus cursos aparecerán aquí.'));
    else if(view==='seguimiento') html=heading('Notas y avance')+tracking();
    else html=renderAdmin();
    $('view').innerHTML=html;
    renderNotices();
    files.hydrate(api);
  }
  function field(label,name,value='',type='text',required=true,max=140) { return `<label for="edit-${name}">${label}${required?' *':''}</label><input id="edit-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} maxlength="${max}"${type==='url'?' placeholder="https://…"':''}>`; }
  function area(label,name,value='',required=true,max=18000) { return `<label for="edit-${name}">${label}${required?' *':''}</label><textarea id="edit-${name}" name="${name}" maxlength="${max}" ${required?'required':''}>${esc(value)}</textarea>`; }
  function check(label,name,value) { return `<label class="checkbox-label"><input name="${name}" type="checkbox" ${value?'checked':''}>${label}</label>`; }
  function select(label,name,options,value) { return `<label for="edit-${name}">${label} *</label><select id="edit-${name}" name="${name}" required>${options.map(([key,text])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(text)}</option>`).join('')}</select>`; }
  let examTimer=null;
  let editorBeforeSubmit=null, editorSubmitLabel='Guardar';
  function openEditor(title,html,save) { editorBeforeSubmit=null;editorSubmitLabel='Guardar';$('saveEditor').textContent=editorSubmitLabel;$('editorTitle').textContent=title; $('editorFields').innerHTML=html; $('editorError').hidden=true; editorSave=save; $('editor').showModal(); }
  function localDate(iso) { if(!iso)return ''; const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
  function editUser(id) {
    const u=data.usuarios.find(r=>r.id===id);
    openEditor(u?'Editar acceso':'Habilitar usuario',field('Nombre','nombre',u?.nombre)+field('Correo','email',u?.email,'email',true,150)+field('Documento del estudiante','cedula',u?.cedula,'text',false,40)+select('Rol','rol',Object.entries(roles),u?.rol||'estudiante')+check('Acceso activo','activo',u?u.activo:true),f=>api('gen10GuardarUsuario',{cedula:f.cedula,nombre:f.nombre,email:u?.email||f.email,rol:f.rol,activo:f.activo==='on',revision:u?.revision||0}));
    if(u)$('edit-email').readOnly=true;
  }
  function renderNotices() {
    const notices=(data.notificaciones||[]).filter(n=>n.email===data.usuario.email);
    const unread=notices.filter(n=>!n.leida).length;
    $('notificationCount').hidden=!unread;
    $('notificationCount').textContent=unread>99?'99+':String(unread);
    $('notificationList').innerHTML=notices.length?notices.slice(0,20).map(n=>'<details class="notification-item"><summary>'+esc(n.titulo)+'</summary><p>'+esc(n.mensaje)+'</p>'+(n.leida?'':'<button type="button" class="quiet" data-notice-id="'+esc(n.id)+'">Marcar como leído</button>')+'</details>').join(''):empty('No tienes avisos.');
  }
  async function downloadGrades(id) {
    const c=data.cursos.find(c=>c.id===id);
    if(!student()||!c||!['Cerrado','Culminado'].includes(c.estado))throw Error('La descarga se habilita al cerrar el curso.');
    await window.IFOBEGradesPDF({course:c,user:data.usuario,breakdown:gradeBreakdown(c,data.usuario.email),score,isExam,validGrade});
  }
  function renderUserProfile() {
    const p=data.perfil||data.usuario;
    return heading('Mi perfil',button('Editar mis datos','editar-datos-usuario','',false))+
      '<section class="panel">'+(window.G10Profile?.avatar(p)||'')+'<h3>'+esc(p.nombre)+'</h3><p>'+esc(roles[p.rol])+'</p><p>Correo: '+esc(p.email)+'</p><p>Teléfono: '+esc(p.telefono||'Pendiente')+'</p><p>Dirección: '+esc(p.direccion||'Pendiente')+'</p><p>Ciudad: '+esc(p.ciudad||'Pendiente')+'</p><p>Contacto de emergencia: '+esc(p.contactoEmergencia||'Pendiente')+'</p></section>';
  }
  function editUserProfile() {
    const p=data.perfil||data.usuario;
    openEditor('Editar mi perfil',(window.G10Profile?.fields(p)||'')+field('Nombre completo','nombre',p.nombre,'text',true,120)+field('Teléfono','telefono',p.telefono,'tel',false,120)+field('Dirección','direccion',p.direccion,'text',false,300)+field('Ciudad','ciudad',p.ciudad,'text',false,120)+field('Contacto de emergencia','contactoEmergencia',p.contactoEmergencia,'text',false,120),async f=>api('gen10GuardarDatosUsuario',{...f,...await window.G10Profile?.collect(),revision:p.revision}));
  }
  function renderProfile() {
    const profiles=student()?[data.expediente||data.perfil]:admin()?data.expedientes:[];
    return heading(student()?'Mis datos y documentos':'Expedientes de estudiantes',student()?button('Actualizar datos y documentos','editar-perfil','',false):'')+(profiles||[]).filter(Boolean).map(p=>{
      const documents=(data.documentosRequeridos||[]).map(r=>{
        const attachments=(p.archivos||[]).filter(f=>f.categoria===r.id);
        return '<details class="document-section"><summary>'+esc(r.nombre)+' · '+(attachments.length?'Entregado':'Pendiente')+'</summary>'+files.render(attachments,'Usuarios',p.id)+(attachments.length?'':empty('No se ha adjuntado este documento.'))+'</details>';
      }).join('');
      const previous=(p.archivos||[]).filter(f=>!f.categoria);
      return '<details class="panel student-record"><summary>'+esc(p.nombre)+'</summary><p>Documento: '+esc(p.cedula||'Pendiente')+'<br>Correo: '+esc(p.email)+'</p><details class="document-section"><summary>Datos del alumno</summary><p>Teléfono: '+esc(p.telefono||'Pendiente')+'<br>Dirección: '+esc(p.direccion||'Pendiente')+'<br>Ciudad: '+esc(p.ciudad||'Pendiente')+'<br>Contacto de emergencia: '+esc(p.contactoEmergencia||'Pendiente')+'</p></details>'+documents+(previous.length?'<details class="document-section"><summary>Otros adjuntos</summary>'+files.render(previous,'Usuarios',p.id)+'</details>':'')+'</details>';
    }).join('');
  }
  function editProfile() {
    const p=data.expediente||data.perfil;
    if(!student()||!p)throw Error('Publica la nueva versión de Apps Script para habilitar el perfil.');
    openEditor('Actualizar mis datos y documentos',field('Nombre completo','nombre',p.nombre,'text',true,120)+field('Documento','cedula',p.cedula,'text',true,40)+field('Teléfono','telefono',p.telefono,'tel',false,120)+field('Dirección','direccion',p.direccion,'text',false,300)+field('Ciudad','ciudad',p.ciudad,'text',false,120)+field('Contacto de emergencia (nombre y teléfono)','contactoEmergencia',p.contactoEmergencia,'text',false,120)+`<p class="hint">Adjunta tu cédula, acta de bachiller y resultados de las pruebas ICFES. Solo tú y administración pueden consultarlos. Para corregir tu documento o correo de acceso, contacta a administración.</p>`+files.documentFields(data.documentosRequeridos||[],p.archivos),async f=>api('gen10GuardarPerfil',{...f,...await files.collectDocuments(data.documentosRequeridos||[],p.archivos),revision:p.revision}));
    if(p.cedula)$('edit-cedula').readOnly=true;
  }
  function editCourseState(id) {
    const c=data.cursos.find(c=>c.id===id);
    if(!c||student())return;
    const options=[['Cerrado','Cerrado · terminar calificaciones'],['Culminado','Culminado · solo consulta']];
    if(admin())options.unshift(['Activo','Activo · reabrir actividades']);
    openEditor('Estado del curso o programa',`<p><strong>${esc(c.titulo)}</strong></p><p>Cerrar detiene nuevas entregas, exámenes y cambios de contenido. Culminar también bloquea las calificaciones. Las notas y archivos se conservan; esto no aprueba automáticamente a los estudiantes.</p><p class="hint">No se puede cerrar mientras haya exámenes en curso ni culminar con entregas por calificar. Solo administración puede reabrir.</p>`+select('Nuevo estado','estado',options,c.estado||'Cerrado')+check('Confirmo el cambio de estado de este curso','confirmar',false),async f=>{
      if(f.confirmar!=='on')throw Error('Confirma el cambio de estado antes de guardar.');
      return api('gen10EstadoCurso',{id:c.id,revision:c.revision,estado:f.estado});
    });
  }
  function editCourse(id) {
    requireEvaluations();
    const c=data.cursos.find(r=>r.id===id), courseKey=c?.id||crypto.randomUUID();
    const teachers=data.usuarios.filter(u=>u.rol==='docente'&&u.activo);
    if(admin()&&!teachers.length){notice('Habilita al menos un docente en Administración antes de crear un curso.');return;}
    openEditor(c?'Editar curso':'Crear curso',`<p class="editor-intro">Presenta tu curso con una portada y organiza sus materiales. Guarda como borrador mientras lo preparas.</p>`+field('Nombre del curso','titulo',c?.titulo)+area('Descripción','descripcion',c?.descripcion,false,4000)+(admin()?select('Docente responsable','docente',[['','Selecciona un docente'],...teachers.map(u=>[u.email,u.nombre+' · '+u.email])],c?.docente||''):'')+field('Porcentaje de tareas (%)','pesoTareas',c?.pesoTareas??'','number')+`<p class="hint">Exámenes usa el porcentaje restante hasta completar 100 %. Define un valor entre 1 y 99.</p>`+files.fields(c?.archivos,c?.portada||null)+check('Publicar curso para sus estudiantes','publicado',c?.publicado),async f=>api('gen10GuardarCurso',{...f,...await files.collect(),docente:admin()?f.docente:c.docente,pesoTareas:Number(f.pesoTareas),id:courseKey,revision:c?.revision||0,publicado:f.publicado==='on'}));
    $('edit-pesoTareas').min='1';$('edit-pesoTareas').max='99';$('edit-pesoTareas').step='1';
  }
  function editContent(kind,id) {
    const lesson=kind==='leccion', item=data[lesson?'lecciones':'tareas'].find(r=>r.id===id), key=item?.id||crypto.randomUUID();
    const cid=item?.curso||courseId;
    const order=item?.orden||Math.max(0,...inCourse('lecciones',cid).map(l=>l.orden))+1;
    openEditor(`${item?'Editar':'Nueva'} ${lesson?'lección':'tarea'}`,`<p class="editor-intro">Escribe las orientaciones y sube los archivos que tus estudiantes necesitan.</p>`+field('Título','titulo',item?.titulo)+area(lesson?'Contenido de la lección':'Instrucciones','contenido',item?.contenido)+files.fields(item?.archivos)+(lesson?field('Orden de la lección','orden',order,'number'):field('Fecha y hora límite (tu hora local)','fechaLimite',localDate(item?.fechaLimite),'datetime-local',false))+check('Publicar para estudiantes','publicado',item?.publicado)+`<p class="hint">Los estudiantes consultan los archivos desde el campus. Los borradores solo son visibles para el docente y administración.</p>`,async f=>api(lesson?'gen10GuardarLeccion':'gen10GuardarTarea',{...f,...await files.collect(),url:item?.url||'',id:key,curso:cid,revision:item?.revision||0,publicado:f.publicado==='on',orden:Number(f.orden),fechaLimite:f.fechaLimite?new Date(f.fechaLimite).toISOString():''}));
    if(lesson){$('edit-orden').min='1';$('edit-orden').max='999';$('edit-orden').step='1';}
  }
  function editEnrollment(id) {
    const member=data.inscritos.find(e=>e.id===id);
    openEditor('Acceso al curso',field('Correo del estudiante','email',member?.email,'email',true,150)+check('Estudiante activo en este curso','activo',member?member.activo:true),f=>{
      const existing=data.inscritos.find(e=>e.curso===courseId && e.email===f.email.trim().toLowerCase());
      return api('gen10Inscribir',{curso:courseId,email:f.email,activo:f.activo==='on',revision:existing?.revision||0});
    });
    if(member)$('edit-email').readOnly=true;
  }
  function editSubmission(id) {
    const task=data.tareas.find(t=>t.id===id), own=data.entregas.find(e=>e.tarea===id && e.email===data.usuario.email);
    openEditor(task.titulo,area('Tu respuesta','contenido',own?.contenido,false)+files.fields(own?.archivos)+`<p class="hint">Escribe tu respuesta o sube tu trabajo aquí. Puedes actualizarlo hasta que el docente lo califique.</p>`,async f=>api('gen10Entregar',{...f,...await files.collect(),url:own?.url||'',tarea:id,revision:own?.revision||0}));
  }
  function editGrade(id) {
    const e=data.entregas.find(r=>r.id===id);
    openEditor('Calificar · '+person(e.email),field('Nota de 0.0 a 5.0','nota',e.nota??'','number')+area('Retroalimentación','comentario',e.comentario,false,4000),f=>api('gen10Calificar',{entrega:id,nota:Number(f.nota),comentario:f.comentario,revision:e.revision}));
    $('edit-nota').min='0';$('edit-nota').max='5';$('edit-nota').step='0.1';
  }
  function editExam(id) {
    requireEvaluations();
    const item=data.tareas.find(t=>t.id===id),key=item?.id||crypto.randomUUID(),cid=item?.curso||courseId;
    const locked=!!item && (data.entregas.some(e=>e.tarea===id)||data.intentosExamen?.some(a=>a.tarea===id));
    let count=0;
    const letters=['A','B','C','D'];
    function question(p={enunciado:'',opciones:['','','',''],correcta:0}) {
      const i=count++;
      return `<fieldset class="exam-question" ${locked?'disabled':''}><legend>Pregunta ${i+1}</legend>${area('Enunciado',`pregunta-${i}`,p.enunciado,true,1000)}${p.opciones.map((o,j)=>field(`Opción ${letters[j]}`,`opcion-${i}-${j}`,o,'text',true,500)).join('')}${select('Respuesta correcta',`correcta-${i}`,letters.map((l,j)=>[String(j),l]),String(p.correcta))}</fieldset>`;
    }
    openEditor(item?'Editar examen':'Crear examen',`<p class="editor-intro">Cada pregunta tiene cuatro opciones y una respuesta correcta. Todas las preguntas valen lo mismo. La calificación es automática, de 0.0 a 5.0, y puedes configurar su duración y sus intentos. Se conserva la mejor nota. Después de recibir respuestas no podrás cambiar las preguntas.</p>`+field('Título','titulo',item?.titulo)+area('Instrucciones','contenido',item?.contenido)+files.fields(item?.archivos)+field('Fecha y hora límite (tu hora local)','fechaLimite',localDate(item?.fechaLimite),'datetime-local',false)+field('Duración en minutos (0 = sin límite)','duracionMinutos',item?.duracionMinutos||0,'number')+field('Intentos permitidos','intentosPermitidos',item?.intentosPermitidos||1,'number')+`<div id="examQuestions">${(item?.preguntas||[{enunciado:'',opciones:['','','',''],correcta:0}]).map(question).join('')}</div><button id="addExamQuestion" class="quiet" type="button">Añadir pregunta</button><button id="removeExamQuestion" class="quiet" type="button">Quitar última pregunta</button>`+check('Publicar para estudiantes','publicado',item?.publicado),async f=>api('gen10GuardarTarea',{id:key,curso:cid,tipo:'examen',duracionMinutos:Number(f.duracionMinutos),intentosPermitidos:Number(f.intentosPermitidos),titulo:f.titulo,contenido:f.contenido,url:item?.url||'',...await files.collect(),revision:item?.revision||0,publicado:f.publicado==='on',fechaLimite:f.fechaLimite?new Date(f.fechaLimite).toISOString():'',preguntas:locked?item.preguntas:Array.from({length:count},(_,i)=>({enunciado:f[`pregunta-${i}`],opciones:letters.map((_,j)=>f[`opcion-${i}-${j}`]),correcta:Number(f[`correcta-${i}`])}))}));
    $('edit-duracionMinutos').min='0';$('edit-duracionMinutos').max='600';$('edit-duracionMinutos').step='1';
    $('edit-intentosPermitidos').min='1';$('edit-intentosPermitidos').max='10';$('edit-intentosPermitidos').step='1';
    $('addExamQuestion').onclick=()=>{if(count<20)$('examQuestions').insertAdjacentHTML('beforeend',question());};
    $('removeExamQuestion').onclick=()=>{if(count>1){$('examQuestions').lastElementChild.remove();count--;}};
    if(locked){
      $('addExamQuestion').hidden=true;$('removeExamQuestion').hidden=true;
    }
  }
  async function answerExam(id) {
    requireEvaluations();
    const exam=data.tareas.find(t=>t.id===id && isExam(t));
    if(!exam)return;
    const preguntas=exam.preguntas||[],respuestas=Array(preguntas.length).fill(null);
    if(!preguntas.length)return;
    const attempt=data.limitesExamen?(await api('gen10IniciarExamen',{tarea:id})).registro:null;
    if(attempt?.respuestas)attempt.respuestas.forEach((r,i)=>respuestas[i]=r);
    let deadline=attempt?.vence?Date.parse(attempt.vence):null,queue=Promise.resolve(),actual=0;
    const persist=()=>{const snapshot=respuestas.slice();queue=queue.catch(()=>{}).then(()=>api('gen10GuardarRespuestaExamen',{tarea:id,numero:attempt.numero,respuestas:snapshot}));queue.catch(error=>{$('editorError').textContent='No se guardó tu respuesta: '+error.message;$('editorError').hidden=false;});};
    async function finishTimed(){
      if(saving)return;
      capture();saving=true;
      try{await queue.catch(()=>{});await api('gen10ResponderExamen',{tarea:id,numero:attempt.numero,respuestas});$('editor').close();await refresh();notice('Tiempo terminado. Se calificaron las respuestas guardadas.');}
      catch(error){$('editorError').textContent=error.message;$('editorError').hidden=false;if($('editor').open)examTimer=setTimeout(tick,5000);}
      finally{saving=false;}
    }
    function tick(){
      if(!deadline||!$('editor').open)return;
      const left=Math.max(0,Math.ceil((deadline-Date.now())/1000)),clock=$('examClock');
      if(clock)clock.textContent='Tiempo restante: '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
      if(!left){if(saving)examTimer=setTimeout(tick,1000);else finishTimed();return;}
      examTimer=setTimeout(tick,1000);
    }
    const capture=()=>{
      const value=new FormData($('editorForm')).get('respuesta');
      if(value!==null)respuestas[actual]=Number(value);
    };
    function showQuestion(){
      const p=preguntas[actual],ultima=actual===preguntas.length-1;
      $('editorFields').innerHTML=`<p class="editor-intro">Responde una pregunta a la vez. Puedes volver y cambiar tus respuestas antes de enviar. Se registra cada intento y se conserva la mejor nota.</p><p id="examClock" role="status">${deadline?'Tiempo restante: calculando…':'Sin límite de duración'}</p><div class="exam-progress"><strong id="examStep" tabindex="-1">Pregunta ${actual+1} de ${preguntas.length}</strong><span>${respuestas.filter(r=>r!==null).length} respondidas</span><progress value="${actual+1}" max="${preguntas.length}" aria-label="Avance del examen"></progress></div><fieldset class="exam-question"><legend>${esc(p.enunciado)}</legend>${p.opciones.map((o,j)=>`<label class="exam-option"><input type="radio" name="respuesta" value="${j}" required ${respuestas[actual]===j?'checked':''}><span><b>${String.fromCharCode(65+j)}.</b> ${esc(o)}</span></label>`).join('')}</fieldset><button id="examPrevious" class="quiet" type="button" ${actual===0?'disabled':''}>Anterior</button>${ultima?'<p class="hint">Revisa tus respuestas con Anterior. Cuando termines, pulsa Enviar examen para obtener tu calificación.</p>':''}`;
      editorSubmitLabel=ultima?'Enviar examen':'Siguiente';$('saveEditor').textContent=editorSubmitLabel;
      $('editorFields').onchange=()=>{capture();if(attempt)persist();};
      $('examPrevious').onclick=()=>{if(saving||actual===0)return;capture();actual--;showQuestion();};
      $('editorError').hidden=true;$('examStep').focus();
    }
    openEditor(exam.titulo,'',async()=>{await queue;return api('gen10ResponderExamen',{tarea:id,numero:attempt?.numero,respuestas});});
    editorBeforeSubmit=()=>{
      capture();
      if(respuestas[actual]===null){$('editorError').textContent='Selecciona una respuesta para continuar.';$('editorError').hidden=false;return false;}
      if(actual<preguntas.length-1){actual++;showQuestion();return false;}
      const pendiente=respuestas.indexOf(null);
      if(pendiente>=0){actual=pendiente;showQuestion();return false;}
      return true;
    };
    showQuestion();tick();
  }
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;clearNotice();render();}));
  $('notificationList').addEventListener('click',async event=>{
    const b=event.target.closest('[data-notice-id]');if(!b||!data)return;
    b.disabled=true;
    try{await api('gen10LeerNotificacion',{id:b.dataset.noticeId});await refresh();}
    catch(error){notice(error.message,'error');b.disabled=false;}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')$('notifications').open=false;});
  document.addEventListener('click',event=>{if(!$('notifications').contains(event.target))$('notifications').open=false;});
  $('view').addEventListener('click',async event=>{
    const b=event.target.closest('[data-action]'); if(!b || !data)return;
    const {action,id}=b.dataset;
    try {
      if(action==='leer-aviso'){b.disabled=true;await api('gen10LeerNotificacion',{id});await refresh();}
      else if(action==='descargar-notas'){b.disabled=true;try{await downloadGrades(id);}finally{b.disabled=false;}}
      else if(action==='curso'){courseId=id;courseTab='lecciones';view='curso';render();window.scrollTo({top:0,behavior:'auto'});}
      else if(action==='vista-cursos'){view='cursos';render();}
      else if(['vista-tareas','vista-examenes','vista-seguimiento'].includes(action)){view=action.slice(6);render();}
      else if(action==='tab'){courseTab=id;render();}
      else if(action==='usuario')editUser(id);
      else if(action==='editar-perfil')editProfile();
      else if(action==='editar-datos-usuario')editUserProfile();
      else if(action==='editar-curso')editCourse(id);
      else if(action==='estado-curso')editCourseState(id);
      else if(action==='leccion'||action==='tarea')editContent(action,id);
      else if(action==='examen')editExam(id);
      else if(action==='responder-examen')await answerExam(id);
      else if(action==='inscribir')editEnrollment(id);
      else if(action==='entregar')editSubmission(id);
      else if(action==='calificar')editGrade(id);
      else if(action==='archivo'){b.disabled=true;try{await files.open(api,b.dataset.table,b.dataset.record,id);}finally{b.disabled=false;}}
      else if(action==='completar'){b.disabled=true;await api('gen10Completar',{leccion:id});await refresh();notice('Lección completada. ¡Sigue avanzando!');}
    } catch(error){notice(error.message,'error');b.disabled=false;}
  });
  $('editorForm').addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    if(editorBeforeSubmit&&!editorBeforeSubmit())return;
    saving=true;$('saveEditor').disabled=true;$('saveEditor').textContent='Guardando archivos y contenido…';$('closeEditor').disabled=true;$('editorError').hidden=true;
    const controls=Array.from($('editorFields').querySelectorAll('input,select,textarea'));
    const values=Object.fromEntries(new FormData(event.target));controls.forEach(c=>c.disabled=true);
    try {
      const result=await editorSave(values);$('editor').close();
      const pendientes=result?.sincronizacion?.pendientes||[];
      notice(result?.avisoMensaje||(pendientes.length?'Guardado. Vinculación académica pendiente: '+pendientes.join(' '):'Guardado correctamente.'));
      try{await refresh();}catch(error){notice('Los cambios se guardaron, pero no pudimos actualizar la vista. '+error.message,'error');}
    }catch(error){$('editorError').textContent=error.message;$('editorError').hidden=false;}
    finally{saving=false;$('saveEditor').disabled=false;$('saveEditor').textContent=editorSubmitLabel;$('closeEditor').disabled=false;controls.forEach(c=>c.disabled=false);}
  });
  $('editor').addEventListener('close',()=>{clearTimeout(examTimer);examTimer=null;$('editorFields').onchange=null;});
  $('closeEditor').addEventListener('click',()=>$('editor').close());
  $('editor').addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  function authScreen(screen) {
    $('loginForm').hidden=screen!=='login';$('requestCode').hidden=screen!=='request';$('verifyCode').hidden=screen!=='verify';
    ['loginPassword','newPassword','confirmPassword','code'].forEach(id=>$(id).value='');
    document.querySelectorAll('[data-password]').forEach(button=>{ $(button.dataset.password).type='password';button.textContent='Mostrar';button.setAttribute('aria-label','Mostrar contraseña');button.setAttribute('aria-pressed','false'); });
    $('accessFormTitle').textContent=screen==='login'?'Iniciar sesión':screen==='request'?(authPurpose==='recuperar'?'Recupera tu acceso':'Activa tu cuenta'):'Confirma tu acceso';
    $('accessHelp').textContent=screen==='login'?'Ingresa con tu correo y la contraseña que creaste al activar tu cuenta.':
      authPurpose==='recuperar'?'Recibe un código único en tu correo para restablecer tu contraseña.':'Activa tu cuenta con un código único. Después entrarás con tu correo y contraseña.';
    updateActivation();
  }
  function knownAccount(email) {
    try{return JSON.parse(localStorage.getItem('gen10CuentasActivadas')||'[]').includes(email.trim().toLowerCase());}catch(_){return false;}
  }
  function updateActivation() {
    $('activationOptions').hidden=knownAccount($('loginEmail').value);
  }
  function rememberAccount(email) {
    if(!email)return;
    try{
      let emails=JSON.parse(localStorage.getItem('gen10CuentasActivadas')||'[]');if(!Array.isArray(emails))emails=[];
      localStorage.setItem('gen10CuentasActivadas',JSON.stringify([...new Set([...emails,email.trim().toLowerCase()])].slice(-20)));
      localStorage.setItem('gen10UltimoCorreo',email.trim().toLowerCase());
    }catch(_){}
    $('loginEmail').value=email;updateActivation();
  }
  async function enterCampus(result) {
    if(result.autenticacion!=='password-v1')throw Error('Es necesario publicar la nueva versión de Apps Script con acceso por contraseña.');
    if(typeof result.token!=='string'||!result.token)throw Error('No se confirmó el acceso. Intenta de nuevo.');
    token=result.token;sessionStorage.setItem('gen10Sesion',token);view='inicio';
    rememberAccount(result.usuario?.email || ($('verifyCode').hidden?$('loginEmail').value:pendingEmail));
    ['loginPassword','newPassword','confirmPassword','code'].forEach(id=>$(id).value='');
    clearNotice();await refresh(true);
  }
  function beginActivation(purpose) {
    if(authBusy)return;authPurpose=purpose;clearNotice();$('email').value=$('loginEmail').value;authScreen('request');$('email').focus();
  }
  $('activateAccount').addEventListener('click',()=>beginActivation('activar'));
  $('loginEmail').addEventListener('input',updateActivation);
  $('loginEmail').addEventListener('change',updateActivation);
  $('recoverPassword').addEventListener('click',()=>beginActivation('recuperar'));
  ['backToLogin','cancelActivation'].forEach(id=>$(id).addEventListener('click',()=>{if(authBusy)return;clearNotice();$('loginEmail').value=$('email').value;authScreen('login');$('loginEmail').focus();}));
  $('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();if(authBusy)return;authBusy=true;const b=event.target.querySelector('button[type="submit"]');b.disabled=true;b.textContent='Ingresando…';event.target.setAttribute('aria-busy','true');
    try{await enterCampus(await api('gen10Login',{email:$('loginEmail').value.trim(),password:$('loginPassword').value}));}
    catch(error){notice(error.message,'error');}finally{authBusy=false;b.disabled=false;b.textContent='Iniciar sesión';event.target.removeAttribute('aria-busy');$('loginPassword').value='';}
  });
  $('requestCode').addEventListener('submit',async event=>{
    event.preventDefault();const b=event.target.querySelector('button');if(authBusy)return;authBusy=true;b.disabled=true;$('email').disabled=true;
    try{pendingEmail=$('email').value.trim();const r=await api('gen10SolicitarCodigo',{email:pendingEmail,proposito:authPurpose});notice(r.mensaje);authScreen('verify');$('code').focus();}
    catch(error){notice(error.message,'error');}finally{authBusy=false;b.disabled=false;$('email').disabled=false;}
  });
  $('verifyCode').addEventListener('submit',async event=>{
    event.preventDefault();const b=event.target.querySelector('button');if(authBusy)return;
    if($('newPassword').value!==$('confirmPassword').value){notice('Las contraseñas no coinciden.','error');$('confirmPassword').focus();return;}
    authBusy=true;b.disabled=true;$('changeEmail').disabled=true;
    try{await enterCampus(await api('gen10VerificarCodigo',{email:pendingEmail,codigo:$('code').value,password:$('newPassword').value}));}
    catch(error){notice(error.message,'error');}finally{authBusy=false;b.disabled=false;$('changeEmail').disabled=false;}
  });
  $('changeEmail').addEventListener('click',()=>{if(authBusy)return;clearNotice();authScreen('request');$('email').focus();});
  $('refresh').addEventListener('click',async()=>{clearNotice();try{await refresh();}catch(error){notice(error.message,'error');}});
  $('logout').addEventListener('click',async()=>{
    $('logout').disabled=true;
    try{await api('gen10Salir');showAccess();clearNotice();}
    catch(error){showAccess();notice('Se cerró el acceso en este navegador. No pudimos confirmar el cierre en el servidor; la sesión remota vencerá automáticamente.','error');}
    finally{$('logout').disabled=false;}
  });
  try{$('loginEmail').value=localStorage.getItem('gen10UltimoCorreo')||'';}catch(_){}
  updateActivation();
  // Actualiza al entrar, al guardar y con el botón Actualizar para conservar
  // formularios, exámenes y materiales abiertos mientras se usa el campus.
  if(token)refresh().catch(error=>notice(error.message,'error'));
})();
