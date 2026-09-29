import { app, $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml, asDate, formatDateTime, formatDuration } from "./core.js";
import { doc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, deleteUser, signOut as signOutSecondary, updateProfile } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

const functions=getFunctions(app);
const requestDeletion=httpsCallable(functions,"requestTeamMemberDeletion");
const confirmDeletion=httpsCallable(functions,"confirmTeamMemberDeletion");
const updateMemberEmail=httpsCallable(functions,"updateTeamMemberEmail");
let members={promotores:[],assistencia:[]},activities=[],clients=new Map(),activeTab="promotores",selectedMember=null,deleteRequestId=null,profileRouteMap=null,profileRouteLayers=[];
const defaultPermissions={acessoApp:true,agendarVisitas:true,cadastrarClientes:true,finalizarVisitas:true,verHistorico:true};
const initials=n=>{const p=String(n||"").trim().split(/\s+/).filter(Boolean);return p.length?(p[0][0]+(p.length>1?p[p.length-1][0]:"")).toUpperCase():"—"};
const memberRole=m=>m.cargo||m.funcao||(m.collection==="promotores"?"Promotor Técnico":"Assistente Técnico");
const memberActive=m=>m.ativo!==false&&m.permissoes?.acessoApp!==false;
function activityDurationMinutes(a){const s=asDate(a.checkinDataHora),e=asDate(a.checkoutDataHora);return !s||!e||e<s?null:(e-s)/60000}
function parseGps(value){
    if(typeof value!=="string")return null;
    const parts=value.split(",").map(Number);
    if(parts.length<2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1]))return null;
    if(Math.abs(parts[0])>90||Math.abs(parts[1])>180)return null;
    return{lat:parts[0],lng:parts[1]};
}
function routePointForActivity(activity){
    const checkin=parseGps(activity.checkinGps),checkout=parseGps(activity.checkoutGps);
    const client=clients.get(activity.clienteId);
    if(checkin)return{...checkin,source:"check-in",activity,client};
    if(checkout)return{...checkout,source:"checkout",activity,client};
    if(client&&Number.isFinite(Number(client.lat))&&Number.isFinite(Number(client.lng)))return{lat:Number(client.lat),lng:Number(client.lng),source:"cliente",activity,client};
    return null;
}
function memberStats(m){const list=activities.filter(a=>a.ptvId===m.id).sort((a,b)=>(asDate(b.data)?.getTime()||0)-(asDate(a.data)?.getTime()||0));const completed=list.filter(a=>a.status==="Concluída"),durations=completed.map(activityDurationMinutes).filter(Number.isFinite),totalMinutes=durations.reduce((s,v)=>s+v,0);return{list,total:list.length,completed:completed.length,completion:list.length?completed.length/list.length*100:0,totalMinutes,averageMinutes:durations.length?totalMinutes/durations.length:null,uniqueClients:new Set(list.map(a=>a.clienteId).filter(Boolean)).size,lastActivity:list[0]?.data||null}}
function currentMembers(){const term=$("#team-search").value.trim().toLowerCase();return members[activeTab].filter(m=>!term||[m.nome,m.email,m.telefone,memberRole(m)].some(v=>String(v||"").toLowerCase().includes(term)))}
function renderOverview(){const all=[...members.promotores,...members.assistencia],stats=all.map(memberStats);$("#team-total").textContent=all.length;$("#team-active").textContent=all.filter(memberActive).length;$("#team-visits").textContent=stats.reduce((s,i)=>s+i.total,0);$("#team-field-time").textContent=formatDuration(stats.reduce((s,i)=>s+i.totalMinutes,0));$("#promotores-count").textContent=members.promotores.length;$("#assistencia-count").textContent=members.assistencia.length}
function renderTable(){const rows=currentMembers(),body=$("#team-table-body");if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty-row">Nenhum profissional encontrado.</td></tr>';return}body.innerHTML=rows.map(m=>{const s=memberStats(m),active=memberActive(m);return '<tr><td><div class="person-cell"><span class="person-avatar">'+escapeHtml(initials(m.nome))+'</span><div><strong>'+escapeHtml(m.nome||"Sem nome")+'</strong><small>'+escapeHtml(memberRole(m))+'</small></div></div></td><td><span class="account-status '+(active?'is-active':'is-inactive')+'">'+(active?'Ativo':'Inativo')+'</span></td><td><strong class="kpi-table-value">'+s.total+'</strong></td><td><span class="table-completion"><strong>'+s.completed+'</strong><small>'+Math.round(s.completion)+'%</small></span></td><td>'+formatDuration(s.totalMinutes)+'</td><td>'+formatDuration(s.averageMinutes)+'</td><td>'+(s.lastActivity?formatDateTime(s.lastActivity):'—')+'</td><td><div class="row-actions"><button class="row-link" data-action="profile" data-id="'+escapeHtml(m.id)+'">Ver perfil</button><button class="row-menu" data-action="manage" data-id="'+escapeHtml(m.id)+'">•••</button></div></td></tr>'}).join('')}
function renderComparison(collectionName, targetId){
    const list=members[collectionName]||[];
    const target=$("#"+targetId);
    if(!target) return;
    if(!list.length){target.innerHTML='<div class="comparison-empty">Nenhum profissional nesta equipe.</div>';return;}
    const enriched=list.map(member=>({member,stats:memberStats(member)}));
    const maxVisits=Math.max(1,...enriched.map(item=>item.stats.total));
    target.innerHTML=enriched.map(({member,stats})=>{
        const completion=Math.round(stats.completion);
        const fieldHours=stats.totalMinutes/60;
        return '<article class="comparison-person">'+
            '<div class="comparison-person-head"><div class="person-cell"><span class="person-avatar">'+escapeHtml(initials(member.nome))+'</span><div><strong>'+escapeHtml(member.nome||"Sem nome")+'</strong><small>'+escapeHtml(memberRole(member))+'</small></div></div><button class="row-link" type="button" data-compare-profile="'+escapeHtml(member.id)+'">Perfil</button></div>'+
            '<div class="comparison-kpis"><div><span>Visitas</span><strong>'+stats.total+'</strong></div><div><span>Conclusão</span><strong>'+completion+'%</strong></div><div><span>Campo</span><strong>'+formatDuration(stats.totalMinutes)+'</strong></div><div><span>Clientes</span><strong>'+stats.uniqueClients+'</strong></div></div>'+
            '<div class="comparison-bar"><span style="width:'+Math.max(4,(stats.total/maxVisits)*100)+'%"></span></div>'+
        '</article>';
    }).join("");
}
function renderAll(){renderOverview();renderTable();renderComparison("promotores","comparison-promotores");renderComparison("assistencia","comparison-assistencia")}
async function loadData(){const [p,a,v,c]=await Promise.all([getDocs(collection(db,"promotores")),getDocs(collection(db,"assistencia")),getDocs(collection(db,"atividades")),getDocs(collection(db,"clientes"))]);members.promotores=p.docs.map(x=>({id:x.id,collection:"promotores",...x.data()})).sort((x,y)=>String(x.nome||"").localeCompare(String(y.nome||""),"pt-BR"));members.assistencia=a.docs.map(x=>({id:x.id,collection:"assistencia",...x.data()})).sort((x,y)=>String(x.nome||"").localeCompare(String(y.nome||""),"pt-BR"));activities=v.docs.map(x=>({id:x.id,...x.data()}));clients=new Map(c.docs.map(x=>[x.id,{id:x.id,...x.data()}]));renderAll()}
const findMember=id=>[...members.promotores,...members.assistencia].find(m=>m.id===id)||null;
function openModal(name){const m=$("#"+name+"-modal");if(m){m.hidden=false;document.body.classList.add("modal-open")}}
function closeModal(name){const m=$("#"+name+"-modal");if(m)m.hidden=true;if(![...document.querySelectorAll(".team-modal")].some(x=>!x.hidden))document.body.classList.remove("modal-open")}
function clearProfileRouteMap(){
    profileRouteLayers.forEach(layer=>{try{layer.remove()}catch(_){}});
    profileRouteLayers=[];
}
function renderProfileRoute(member){
    const target=$("#profile-route-timeline"),summary=$("#profile-route-summary");
    const ordered=memberStats(member).list.slice().sort((a,b)=>(asDate(a.data)?.getTime()||0)-(asDate(b.data)?.getTime()||0));
    const points=ordered.map(routePointForActivity).filter(Boolean);

    target.innerHTML=points.length?points.map((point,index)=>{
        const clientName=point.client?.nome||"Cliente não encontrado";
        const date=asDate(point.activity.data);
        return '<article class="route-timeline-item" data-route-index="'+index+'">'+
            '<div class="route-timeline-marker"><span>'+(index+1)+'</span></div>'+
            '<div class="route-timeline-copy"><strong>'+escapeHtml(clientName)+'</strong><small>'+escapeHtml(point.activity.tipoVisita||point.activity.tipo||"Visita")+' • '+formatDateTime(point.activity.data)+'</small><span>'+escapeHtml(point.activity.status||"—")+' • localização: '+escapeHtml(point.source)+'</span></div>'+
        '</article>';
    }).join(""):'<div class="profile-empty">Nenhuma visita com localização disponível.</div>';

    summary.textContent=points.length?points.length+(points.length===1?" ponto localizado":" pontos localizados"):"Sem pontos";

    if(!window.L)return;
    if(!profileRouteMap){
        profileRouteMap=L.map("profile-route-map",{zoomControl:true,attributionControl:true}).setView([-23.1,-47.2],10);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"&copy; OpenStreetMap contributors"}).addTo(profileRouteMap);
    }
    clearProfileRouteMap();

    if(!points.length){
        profileRouteMap.setView([-23.1,-47.2],10);
        setTimeout(()=>profileRouteMap.invalidateSize(),0);
        return;
    }

    const latlngs=points.map(point=>[point.lat,point.lng]);
    if(latlngs.length>1){
        const line=L.polyline(latlngs,{color:"#040438",weight:4,opacity:.82}).addTo(profileRouteMap);
        profileRouteLayers.push(line);
    }

    points.forEach((point,index)=>{
        const icon=L.divIcon({
            className:"route-map-div-icon",
            html:'<span>'+(index+1)+'</span>',
            iconSize:[28,28],
            iconAnchor:[14,14]
        });
        const marker=L.marker([point.lat,point.lng],{icon}).addTo(profileRouteMap);
        marker.bindPopup('<strong>'+escapeHtml(point.client?.nome||"Cliente não encontrado")+'</strong><br>'+escapeHtml(point.activity.tipoVisita||point.activity.tipo||"Visita")+'<br>'+formatDateTime(point.activity.data));
        marker.on("click",()=>{
            document.querySelectorAll(".route-timeline-item").forEach(item=>item.classList.remove("active"));
            const item=document.querySelector('[data-route-index="'+index+'"]');
            item?.classList.add("active");
            item?.scrollIntoView({block:"nearest",behavior:"smooth"});
        });
        profileRouteLayers.push(marker);
    });

    profileRouteMap.fitBounds(L.latLngBounds(latlngs),{padding:[28,28],maxZoom:14});
    setTimeout(()=>profileRouteMap.invalidateSize(),50);

    target.querySelectorAll("[data-route-index]").forEach(item=>{
        item.addEventListener("click",()=>{
            const index=Number(item.dataset.routeIndex);
            const point=points[index];
            if(!point)return;
            profileRouteMap.setView([point.lat,point.lng],14,{animate:true});
            const marker=profileRouteLayers.find(layer=>layer instanceof L.Marker && layer.getLatLng && Math.abs(layer.getLatLng().lat-point.lat)<1e-7 && Math.abs(layer.getLatLng().lng-point.lng)<1e-7);
            marker?.openPopup();
            target.querySelectorAll(".route-timeline-item").forEach(row=>row.classList.remove("active"));
            item.classList.add("active");
        });
    });
}
function renderActivityBars(m){const stats=memberStats(m),map=new Map(),today=new Date();for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(today.getDate()-i);map.set(d.toISOString().slice(0,10),{date:d,count:0})}stats.list.forEach(a=>{const d=asDate(a.data),k=d?.toISOString().slice(0,10);if(k&&map.has(k))map.get(k).count++});const days=[...map.values()],max=Math.max(1,...days.map(d=>d.count));$("#profile-activity-bars").innerHTML=days.map(d=>'<div class="activity-bar-column"><div class="activity-bar-value">'+d.count+'</div><div class="activity-bar-track"><span style="height:'+Math.max(d.count?12:2,(d.count/max)*100)+'%"></span></div><small>'+d.date.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","")+'</small></div>').join('')}
function openProfile(m){selectedMember=m;const s=memberStats(m);$("#profile-avatar").textContent=initials(m.nome);$("#profile-area").textContent=m.collection==="promotores"?"PROMOTORIA":"ASSISTÊNCIA";$("#profile-name").textContent=m.nome||"Sem nome";$("#profile-role").textContent=memberRole(m);$("#profile-email").textContent=m.email||"E-mail não cadastrado";$("#profile-email").href=m.email?"mailto:"+m.email:"#";$("#profile-phone").textContent=m.telefone||"Telefone não cadastrado";$("#profile-status").textContent=memberActive(m)?"Ativo":"Inativo";$("#profile-status").className="profile-status "+(memberActive(m)?"is-active":"is-inactive");$("#profile-visits").textContent=s.total;$("#profile-completed").textContent=s.completed;$("#profile-completion").textContent=Math.round(s.completion)+"%";$("#profile-field-time").textContent=formatDuration(s.totalMinutes);$("#profile-average").textContent=formatDuration(s.averageMinutes);$("#profile-clients").textContent=s.uniqueClients;renderActivityBars(m);renderProfileRoute(m);$("#profile-recent-visits").innerHTML=s.list.length?s.list.slice(0,5).map(a=>{const c=clients.get(a.clienteId);return '<div class="recent-visit"><span class="recent-status-dot"></span><div><strong>'+escapeHtml(c?.nome||"Cliente não encontrado")+'</strong><small>'+escapeHtml(a.tipoVisita||a.tipo||"Visita")+' • '+formatDateTime(a.data)+'</small></div><span class="recent-visit-status">'+escapeHtml(a.status||"—")+'</span></div>'}).join(''):'<div class="profile-empty">Nenhuma atividade registrada para este profissional.</div>';openModal("profile")}
const permissionsOf=m=>({...defaultPermissions,...(m.permissoes||{})});
function openManage(m){selectedMember=m;const p=permissionsOf(m);$("#manage-title").textContent=m.nome||"Editar profissional";$("#manage-collection-badge").textContent=m.collection==="promotores"?"Promotoria":"Assistência";$("#manage-name").value=m.nome||"";$("#manage-email").value=m.email||"";$("#manage-phone").value=m.telefone||"";$("#manage-role").value=memberRole(m);$("#manage-active").checked=m.ativo!==false;$("#perm-access").checked=p.acessoApp!==false;$("#perm-schedule").checked=p.agendarVisitas!==false;$("#perm-clients").checked=p.cadastrarClientes!==false;$("#perm-close").checked=p.finalizarVisitas!==false;$("#perm-history").checked=p.verHistorico!==false;$("#manage-active-label").textContent=$("#manage-active").checked?"Ativo":"Inativo";$("#manage-message").textContent="";closeModal("profile");openModal("manage")}
async function saveMember(e){e.preventDefault();if(!selectedMember)return;const b=$("#save-user"),newEmail=$("#manage-email").value.trim(),changed=newEmail!==String(selectedMember.email||"");b.disabled=true;b.textContent="Salvando...";$("#manage-message").textContent="";try{const payload={nome:$("#manage-name").value.trim(),telefone:$("#manage-phone").value.trim(),cargo:$("#manage-role").value.trim(),ativo:$("#manage-active").checked,permissoes:{acessoApp:$("#perm-access").checked,agendarVisitas:$("#perm-schedule").checked,cadastrarClientes:$("#perm-clients").checked,finalizarVisitas:$("#perm-close").checked,verHistorico:$("#perm-history").checked},atualizadoEm:serverTimestamp()};await updateDoc(doc(db,selectedMember.collection,selectedMember.id),payload);Object.assign(selectedMember,payload,{atualizadoEm:new Date()});if(changed){await updateMemberEmail({collection:selectedMember.collection,memberId:selectedMember.id,newEmail});selectedMember.email=newEmail}$("#manage-message").textContent="Alterações salvas com sucesso.";renderAll()}catch(err){console.error(err);$("#manage-message").textContent=err.message||"Não foi possível salvar as alterações."}finally{b.disabled=false;b.textContent="Salvar alterações"}}
function openNewMember(){const f=$("#new-member-form");f.reset();$("#new-member-team").value=activeTab;["#new-perm-access","#new-perm-schedule","#new-perm-clients","#new-perm-close","#new-perm-history"].forEach(id=>$(id).checked=true);$("#new-member-role").value=activeTab==="promotores"?"Promotor Técnico":"Assistente Técnico";$("#new-member-message").textContent="";openModal("new-member")}
async function createMember(e){
    e.preventDefault();
    const b=$("#create-member");
    b.disabled=true;
    b.textContent="Cadastrando...";
    $("#new-member-message").textContent="";

    const payload={
        collection:$("#new-member-team").value,
        nome:$("#new-member-name").value.trim(),
        email:$("#new-member-email").value.trim().toLowerCase(),
        telefone:$("#new-member-phone").value.trim(),
        cargo:$("#new-member-role").value.trim(),
        password:$("#new-member-password").value,
        permissoes:{
            acessoApp:$("#new-perm-access").checked,
            agendarVisitas:$("#new-perm-schedule").checked,
            cadastrarClientes:$("#new-perm-clients").checked,
            finalizarVisitas:$("#new-perm-close").checked,
            verHistorico:$("#new-perm-history").checked
        }
    };

    const secondaryApp=initializeApp(firebaseConfig,"team-member-"+Date.now());
    const secondaryAuth=getAuth(secondaryApp);
    let credential=null;

    try{
        credential=await createUserWithEmailAndPassword(secondaryAuth,payload.email,payload.password);
        await updateProfile(credential.user,{displayName:payload.nome});

        const ref=doc(collection(db,payload.collection));
        await setDoc(ref,{
            nome:payload.nome,
            email:payload.email,
            telefone:payload.telefone,
            cargo:payload.cargo||(payload.collection==="promotores"?"Promotor Técnico":"Assistente Técnico"),
            ativo:true,
            permissoes:payload.permissoes,
            authUid:credential.user.uid,
            criadoEm:serverTimestamp(),
            atualizadoEm:serverTimestamp()
        });

        await signOutSecondary(secondaryAuth).catch(()=>{});
        activeTab=payload.collection;
        document.querySelectorAll("[data-team-tab]").forEach(t=>{
            const on=t.dataset.teamTab===activeTab;
            t.classList.toggle("active",on);
            t.setAttribute("aria-selected",String(on));
        });
        await loadData();
        closeModal("new-member");
    }catch(err){
        console.error("[Equipe] Cadastro:",err);
        if(credential?.user)await deleteUser(credential.user).catch(()=>{});
        const messages={
            "auth/email-already-in-use":"Este e-mail já possui uma conta no Firebase Authentication.",
            "auth/invalid-email":"Informe um e-mail válido.",
            "auth/weak-password":"A senha inicial precisa ter pelo menos 6 caracteres.",
            "auth/operation-not-allowed":"O cadastro por e-mail e senha está desativado no Firebase Authentication.",
            "permission-denied":"A conta foi criada, mas as regras do Firestore bloquearam o perfil. A conta temporária foi removida."
        };
        $("#new-member-message").textContent=messages[err.code]||err.message||"Não foi possível cadastrar o membro.";
    }finally{
        await signOutSecondary(secondaryAuth).catch(()=>{});
        await deleteApp(secondaryApp).catch(()=>{});
        b.disabled=false;
        b.textContent="Cadastrar membro";
    }
}
function openDelete(){if(!selectedMember)return;deleteRequestId=null;$("#delete-email").textContent=selectedMember.email||"e-mail não cadastrado";$("#delete-code").value="";$("#delete-request-step").hidden=false;$("#delete-code-step").hidden=true;$("#delete-message").textContent="";closeModal("manage");openModal("delete")}
async function sendDeleteCode(){if(!selectedMember)return;const b=$("#send-delete-code");b.disabled=true;b.textContent="Enviando...";try{const r=await requestDeletion({collection:selectedMember.collection,memberId:selectedMember.id});deleteRequestId=r.data.requestId;$("#delete-request-step").hidden=true;$("#delete-code-step").hidden=false;$("#delete-code-hint").textContent="Código enviado para "+(r.data.maskedEmail||selectedMember.email)+". Válido por 10 minutos."}catch(e){$("#delete-message").textContent=e.message||"Não foi possível enviar o código."}finally{b.disabled=false;b.textContent="Enviar código de confirmação"}}
async function confirmDelete(){const code=$("#delete-code").value.replace(/\D/g,"").slice(0,6);if(!deleteRequestId||code.length!==6){$("#delete-message").textContent="Digite o código de 6 dígitos.";return}try{await confirmDeletion({requestId:deleteRequestId,code});await loadData();closeModal("delete");selectedMember=null}catch(e){$("#delete-message").textContent=e.message||"Não foi possível confirmar a exclusão."}}
function bindEvents(){document.querySelectorAll("[data-team-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.teamTab;document.querySelectorAll("[data-team-tab]").forEach(t=>{const on=t===b;t.classList.toggle("active",on);t.setAttribute("aria-selected",String(on))});renderTable()}));$("#team-search").addEventListener("input",renderTable);$("#refresh-team").addEventListener("click",loadData);$("#new-member").addEventListener("click",openNewMember);$("#new-member-team").addEventListener("change",e=>{$("#new-member-role").value=e.target.value==="promotores"?"Promotor Técnico":"Assistente Técnico"});$("#new-member-form").addEventListener("submit",createMember);document.querySelectorAll(".comparison-list").forEach(list=>list.addEventListener("click",e=>{const b=e.target.closest("[data-compare-profile]");if(!b)return;const m=findMember(b.dataset.compareProfile);if(m)openProfile(m)}));$("#team-table-body").addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(!b)return;const m=findMember(b.dataset.id);if(b.dataset.action==="profile")openProfile(m);else if(b.dataset.action==="manage")openManage(m)});document.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.closeModal)));$("#profile-manage").addEventListener("click",()=>selectedMember&&openManage(selectedMember));$("#manage-form").addEventListener("submit",saveMember);$("#manage-active").addEventListener("change",()=>$("#manage-active-label").textContent=$("#manage-active").checked?"Ativo":"Inativo");$("#delete-user").addEventListener("click",openDelete);$("#send-delete-code").addEventListener("click",sendDeleteCode);$("#resend-delete-code").addEventListener("click",sendDeleteCode);$("#confirm-delete-user").addEventListener("click",confirmDelete);$("#delete-code").addEventListener("input",e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,6));document.addEventListener("keydown",e=>{if(e.key==="Escape")["delete","manage","profile","new-member"].forEach(closeModal)})}
(async()=>{try{const{user,admin}=await requireAdmin();setupLayout("team",admin,user);bindEvents();await loadData()}catch(e){console.error(e);$("#team-table-body").innerHTML='<tr><td colspan="8" class="empty-row">Não foi possível carregar a equipe.</td></tr>'}})();