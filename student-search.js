(function(){
  const styleId='stn-student-search-style';
  function session(){try{return JSON.parse(sessionStorage.getItem('stn-teacher-session')||'null')}catch(_){return null}}
  function applyAccess(root){
    const current=session();
    if(!current)return;
    const admin=current.role==='admin', specialty=current.specialty;
    root.querySelectorAll('.specialty-tab').forEach(tab=>{
      const all=tab.dataset.specialty==='Todas';
      const visible=admin||(!all&&tab.dataset.specialty===specialty);
      tab.classList.toggle('hidden',!visible);
      tab.setAttribute('aria-hidden',String(!visible));
    });
  }
  function installSearch(root){
    const anchor=root.querySelector('#database-summary')||root.querySelector('.dashboard-actions');
    if(!anchor||root.querySelector('.student-search-bar'))return;
    const bar=document.createElement('div');
    bar.className='student-search-bar';
    bar.innerHTML='<label for="student-search">Buscar estudiante<input id="student-search" type="search" placeholder="Nombre, identificación, correo o teléfono" autocomplete="off"><button id="clear-student-search" type="button">Limpiar</button></label>';
    anchor.parentNode.insertBefore(bar,anchor);
    const input=bar.querySelector('#student-search'), clear=bar.querySelector('#clear-student-search');
    const apply=()=>{
      const q=input.value.trim().toLocaleLowerCase();
      const body=root.querySelector('#csv-table-body');
      if(!body)return;
      let shown=0;
      body.querySelectorAll('tr').forEach(row=>{
        const match=!q||row.textContent.toLocaleLowerCase().includes(q);
        row.hidden=!match;
        if(match&&row.querySelector('.table-action'))shown++;
      });
      const visible=root.querySelector('#db-visible');
      if(visible&&q)visible.textContent=String(shown);
    };
    input.addEventListener('input',apply);
    clear.addEventListener('click',()=>{input.value='';apply();input.focus()});
    const body=root.querySelector('#csv-table-body');
    if(body)new MutationObserver(apply).observe(body,{childList:true,subtree:true});
    apply();
  }
  function run(){const root=document.querySelector('#teacher-dashboard');if(!root)return;applyAccess(root);installSearch(root)}
  if(!document.getElementById(styleId)){
    const style=document.createElement('style');style.id=styleId;style.textContent='.student-search-bar{display:flex;align-items:end;gap:10px;margin:14px 0 0;padding:11px 13px;border:1px solid #31517b;border-radius:11px;background:#0b315f}.student-search-bar label{display:flex;align-items:center;gap:10px;width:100%;color:#c7d8ed;font-size:.72rem;font-weight:800}.student-search-bar input{flex:1;min-width:0;background:#071f43;border:1px solid #4775a8;border-radius:7px;color:#fff;padding:9px 11px}.student-search-bar input::placeholder{color:#91abcd}.student-search-bar button{border:1px solid #5c7ca4;background:transparent;color:#cfe4fb;border-radius:8px;padding:9px 11px;font:700 .72rem "DM Sans",sans-serif;cursor:pointer}.student-search-bar button:hover{background:#164676}.specialty-tab.hidden{display:none}@media(max-width:700px){.student-search-bar label{align-items:stretch;flex-direction:column;gap:7px}.student-search-bar button{width:100%}}';document.head.appendChild(style)
  }
  new MutationObserver(run).observe(document.body,{childList:true,subtree:true});
  run();
})();
