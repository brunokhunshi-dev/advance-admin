import { $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml, asDate, formatDateTime, formatDuration, normalizeVisitType } from "./core.js";
import { doc, setDoc, updateDoc, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { printDocument } from "./print-document.js";

const ADVANCE_ADDRESS="Rua Alberto Guizo, 489, Distrito Industrial João Narezzi, Indaiatuba, SP, Brasil";
const IMPORTANCE_ORDER={"Estratégico":4,"Alta":3,"Média":2,"Baixa":1,"Não definida":0};
let clients=[],activities=[],people=new Map(),advanceCoords=null,selectedClient=null,currentAdmin=null,registerMode="cnpj";

function initials(name){const parts=String(name||"").trim().split(/\s+/).filter(Boolean);return parts.length?(parts[0][0]+(parts.length>1?parts[parts.length-1][0]:"")).toUpperCase():"—"}
function normalizeStatus(status){return status==="Provisorio"?"Provisório":status||"—"}
function clientImportance(client){return client.importancia||"Não definida"}
function clientActivities(client){return activities.filter(a=>a.clienteId===client.id).sort((a,b)=>(asDate(b.data)?.getTime()||0)-(asDate(a.data)?.getTime()||0))}
function durationMinutes(activity){const a=asDate(activity.checkinDataHora),b=asDate(activity.checkoutDataHora);return a&&b&&b>=a?(b-a)/60000:null}
function clientStats(client){const list=clientActivities(client),completed=list.filter(a=>a.status==="Concluída"),durations=completed.map(durationMinutes).filter(Number.isFinite),totalMinutes=durations.reduce((s,v)=>s+v,0);return{list,total:list.length,completed:completed.length,totalMinutes,average:durations.length?totalMinutes/durations.length:null,professionals:new Set(list.map(a=>a.ptvId).filter(Boolean)).size,last:list[0]?.data||null}}
function validCoords(lat,lng){return Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180}
function haversineKm(lat1,lng1,lat2,lng2){const R=6371,rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLng=(lng2-lng1)*rad,a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function distanceLabel(client){if(!advanceCoords||!validCoords(client.lat,client.lng))return"—";const km=haversineKm(advanceCoords.lat,advanceCoords.lng,Number(client.lat),Number(client.lng));return km<1?Math.round(km*1000)+" m":km.toFixed(1).replace(".",",")+" km"}
async function fetchJson(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw new Error("Consulta indisponível (HTTP "+r.status+").");return await r.json()}finally{clearTimeout(timer)}}
async function geocode(address){const data=await fetchJson("https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&q="+encodeURIComponent(address)+"&limit=1");if(!Array.isArray(data)||!data.length)return null;const coords={lat:Number(data[0].lat),lng:Number(data[0].lon)};return validCoords(coords.lat,coords.lng)?coords:null}
async function geocodeClientAddress(parts){
    const candidates=[
        parts.address,
        [parts.street,parts.number,parts.neighborhood,parts.city,parts.uf,"Brasil"].filter(Boolean).join(", "),
        [parts.street,parts.number,parts.city,parts.uf,"Brasil"].filter(Boolean).join(", "),
        [parts.street,parts.city,parts.uf,"Brasil"].filter(Boolean).join(", ")
    ].filter((value,index,array)=>value&&array.indexOf(value)===index);

    for(const candidate of candidates){
        try{
            const coords=await geocode(candidate);
            if(coords)return{...coords,source:"endereco"};
        }catch(error){
            console.warn("[Clientes] Geocode falhou:",candidate,error);
        }
    }

    const rawCep=String(parts.cep||"").replace(/\D/g,"");
    if(/^\d{8}$/.test(rawCep)){
        try{
            const cepData=await fetchJson("https://brasilapi.com.br/api/cep/v2/"+rawCep);
            const lat=Number(cepData?.location?.coordinates?.latitude);
            const lng=Number(cepData?.location?.coordinates?.longitude);
            if(validCoords(lat,lng))return{lat,lng,source:"cep"};
        }catch(error){
            console.warn("[Clientes] CEP V2 sem coordenadas:",error);
        }
    }
    return null;
}
async function loadAdvanceCoords(){try{const cached=JSON.parse(localStorage.getItem("advanceAdminBaseCoords")||"null");if(cached&&validCoords(cached.lat,cached.lng)){advanceCoords=cached;return}advanceCoords=await geocode(ADVANCE_ADDRESS);if(advanceCoords)localStorage.setItem("advanceAdminBaseCoords",JSON.stringify(advanceCoords))}catch(e){console.warn("Não foi possível localizar a sede da Advance",e)}}
function cnpjValid(value){if(!/^\d{14}$/.test(value)||/^(\d)\1{13}$/.test(value))return false;const digit=base=>{let weight=base.length-7,sum=0;for(const n of base){sum+=Number(n)*weight--;if(weight<2)weight=9}const rest=sum%11;return rest<2?"0":String(11-rest)};return digit(value.slice(0,12))===value[12]&&digit(value.slice(0,13))===value[13]}
function normalizeCnpj(value){return String(value||"").replace(/\D/g,"").slice(0,14)}
function formatCnpj(value){const raw=normalizeCnpj(value);return /^\d{14}$/.test(raw)?raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5"):raw}
function legacyCnpjCode(raw){return"C-"+(BigInt(raw)*999999937n).toString(16).toUpperCase()}
function cnpjFromLegacyCode(code){try{if(!/^C-[0-9A-F]+$/i.test(String(code||"")))return"";const value=BigInt("0x"+String(code).slice(2))/999999937n;const raw=value.toString().padStart(14,"0");return cnpjValid(raw)?raw:""}catch{return""}}
function clientCnpj(client){
    const direct=normalizeCnpj(client?.cnpj)||normalizeCnpj(client?.codigoCnpj);
    return /^\d{14}$/.test(direct)?direct:cnpjFromLegacyCode(client?.codigoCnpj);
}
function randomSuffix(){const arr=new Uint8Array(4);crypto.getRandomValues(arr);return Array.from(arr,b=>b.toString(36).padStart(2,"0")).join("").slice(0,6).toUpperCase()}
function provisionalId(){const d=new Date(),stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0"),String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0")].join("");return"CLI-PROV-"+stamp+"-ADM-"+randomSuffix()}
function importanceClass(value){return"importance-"+String(value||"Não definida").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-")}

async function loadData(){const [clientSnap,activitySnap,assistSnap,promoterSnap]=await Promise.all([getDocs(collection(db,"clientes")),getDocs(collection(db,"atividades")),getDocs(collection(db,"assistencia")),getDocs(collection(db,"promotores"))]);clients=clientSnap.docs.map(d=>({id:d.id,...d.data()}));activities=activitySnap.docs.map(d=>({id:d.id,...d.data()}));people=new Map([...assistSnap.docs,...promoterSnap.docs].map(d=>[d.id,{id:d.id,...d.data()}]));renderAll()}
function filteredClients(){const term=$("#client-search").value.trim().toLowerCase(),onlyActive=$("#only-active-clients")?.checked!==false;return clients.filter(c=>(!onlyActive||c.status==="Ativo")&&(!term||[c.nome,c.cidade,c.uf,c.enderecoCompleto,c.status,clientCnpj(c),formatCnpj(clientCnpj(c))].some(v=>String(v||"").toLowerCase().includes(term)))).sort((a,b)=>(IMPORTANCE_ORDER[clientImportance(b)]||0)-(IMPORTANCE_ORDER[clientImportance(a)]||0)||String(a.nome||"").localeCompare(String(b.nome||""),"pt-BR"))}
function renderOverview(){const active=clients.filter(c=>c.status!=="Inativo").length,priority=clients.filter(c=>["Estratégico","Alta"].includes(clientImportance(c))).length;$("#client-total").textContent=clients.length;$("#client-active").textContent=active;$("#client-priority").textContent=priority;$("#client-visits-total").textContent=activities.length}
function renderTable(){const rows=filteredClients(),body=$("#clients-table");if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty-row">Nenhum cliente encontrado.</td></tr>';return}body.innerHTML=rows.map(c=>{const s=clientStats(c);return'<tr data-client-id="'+escapeHtml(c.id)+'"><td><div class="person-cell"><span class="client-table-avatar">'+escapeHtml(initials(c.nome))+'</span><div><strong>'+escapeHtml(c.nome||"Sem nome")+'</strong><small>'+escapeHtml(c.enderecoCompleto||"Endereço não informado")+'</small></div></div></td><td><select class="inline-importance '+importanceClass(clientImportance(c))+'" data-importance-id="'+escapeHtml(c.id)+'"><option'+(clientImportance(c)==="Não definida"?" selected":"")+'>Não definida</option><option'+(clientImportance(c)==="Baixa"?" selected":"")+'>Baixa</option><option'+(clientImportance(c)==="Média"?" selected":"")+'>Média</option><option'+(clientImportance(c)==="Alta"?" selected":"")+'>Alta</option><option'+(clientImportance(c)==="Estratégico"?" selected":"")+'>Estratégico</option></select></td><td><span class="account-status '+(c.status==="Inativo"?"is-inactive":"is-active")+'">'+escapeHtml(normalizeStatus(c.status))+'</span></td><td><strong class="kpi-table-value">'+s.total+'</strong></td><td>'+(s.last?formatDateTime(s.last):"—")+'</td><td><strong>'+distanceLabel(c)+'</strong></td><td>'+escapeHtml((c.cidade||"—")+(c.uf?" / "+c.uf:""))+'</td><td><div class="row-actions"><button class="row-link" data-client-action="profile" data-id="'+escapeHtml(c.id)+'">Ver perfil</button><button class="row-menu" data-client-action="edit" data-id="'+escapeHtml(c.id)+'">•••</button></div></td></tr>'}).join("")}
function renderAll(){renderOverview();renderTable()}
function findClient(id){return clients.find(c=>c.id===id)||null}
function openModal(name){const m=$("#"+name+"-modal");if(m){m.hidden=false;document.body.classList.add("modal-open")}}
function closeModal(name){const m=$("#"+name+"-modal");if(m)m.hidden=true;if(![...document.querySelectorAll(".team-modal")].some(x=>!x.hidden))document.body.classList.remove("modal-open")}
function renderMonthChart(client){const list=clientActivities(client),months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({year:d.getFullYear(),month:d.getMonth(),label:d.toLocaleDateString("pt-BR",{month:"short"}).replace(".",""),count:0})}list.forEach(a=>{const d=asDate(a.data),m=months.find(x=>d&&x.year===d.getFullYear()&&x.month===d.getMonth());if(m)m.count++});const max=Math.max(1,...months.map(m=>m.count));$("#client-month-chart").innerHTML=months.map(m=>'<div class="activity-bar-column"><div class="activity-bar-value">'+m.count+'</div><div class="activity-bar-track"><span style="height:'+Math.max(m.count?10:2,(m.count/max)*100)+'%"></span></div><small>'+escapeHtml(m.label)+'</small></div>').join("")}
function openProfile(client){selectedClient=client;const s=clientStats(client);$("#client-profile-avatar").textContent=initials(client.nome);$("#client-profile-name").textContent=client.nome||"Sem nome";$("#client-profile-address").textContent=client.enderecoCompleto||"Endereço não informado";$("#client-profile-city").textContent=(client.cidade||"—")+(client.uf?" / "+client.uf:"");$("#client-profile-distance").textContent=distanceLabel(client)+" da Advance";$("#client-profile-code").textContent=clientCnpj(client)?"CNPJ • "+formatCnpj(clientCnpj(client)):"Cadastro sem CNPJ";$("#client-profile-importance").textContent=clientImportance(client);$("#client-profile-importance").className="importance-badge "+importanceClass(clientImportance(client));$("#client-profile-status").textContent=normalizeStatus(client.status);$("#client-profile-status").className="profile-status "+(client.status==="Inativo"?"is-inactive":"is-active");$("#client-kpi-visits").textContent=s.total;$("#client-kpi-completed").textContent=s.completed;$("#client-kpi-time").textContent=formatDuration(s.totalMinutes);$("#client-kpi-average").textContent=formatDuration(s.average);$("#client-kpi-professionals").textContent=s.professionals;$("#client-kpi-last").textContent=s.last?new Intl.DateTimeFormat("pt-BR").format(asDate(s.last)):"—";renderMonthChart(client);$("#client-recent-visits").innerHTML=s.list.length?s.list.slice(0,6).map(a=>'<a class="recent-visit recent-visit-button" href="./visits.html?activity='+encodeURIComponent(a.id)+'"><span class="recent-status-dot"></span><div><strong>'+escapeHtml(normalizeVisitType(a))+'</strong><small>'+formatDateTime(a.data)+' • '+escapeHtml(people.get(a.ptvId)?.nome||a.ptvId||"Profissional não identificado")+'</small><span class="visit-link-inline">Abrir visita</span></div><span class="recent-visit-status">'+escapeHtml(a.status||"—")+'</span></a>').join(""):'<div class="profile-empty">Nenhuma visita registrada para este cliente.</div>';openModal("client-profile")}
function openEdit(client){selectedClient=client;$("#edit-client-title").textContent=client.nome||"Cliente";$("#edit-client-name").value=client.nome||"";$("#edit-client-importance").value=clientImportance(client);$("#edit-client-city").value=client.cidade||"";$("#edit-client-uf").value=client.uf||"";$("#edit-client-address").value=client.enderecoCompleto||"";$("#edit-client-status").value=client.status||"Ativo";$("#edit-client-coords").value=validCoords(client.lat,client.lng)?Number(client.lat).toFixed(6)+", "+Number(client.lng).toFixed(6):"Sem coordenadas";$("#edit-client-message").textContent="";closeModal("client-profile");openModal("edit-client")}
async function saveClient(event){event.preventDefault();if(!selectedClient)return;const b=$("#save-client");b.disabled=true;b.textContent="Salvando...";$("#edit-client-message").textContent="";try{const address=$("#edit-client-address").value.trim(),addressChanged=address!==String(selectedClient.enderecoCompleto||"");let lat=selectedClient.lat,lng=selectedClient.lng;if(addressChanged||!validCoords(lat,lng)){const coords=await geocodeClientAddress({address,city:$("#edit-client-city").value.trim(),uf:$("#edit-client-uf").value.trim().toUpperCase()});if(!coords)throw new Error("Não foi possível localizar o endereço. Confira os dados e tente novamente.");lat=coords.lat;lng=coords.lng}const payload={nome:$("#edit-client-name").value.trim(),importancia:$("#edit-client-importance").value,cidade:$("#edit-client-city").value.trim(),uf:$("#edit-client-uf").value.trim().toUpperCase(),enderecoCompleto:address,lat:Number(lat),lng:Number(lng),status:$("#edit-client-status").value,atualizadoEm:serverTimestamp()};await updateDoc(doc(db,"clientes",selectedClient.id),payload);Object.assign(selectedClient,payload,{atualizadoEm:new Date()});$("#edit-client-coords").value=Number(lat).toFixed(6)+", "+Number(lng).toFixed(6);$("#edit-client-message").textContent="Cliente atualizado com sucesso.";renderAll()}catch(e){console.error(e);$("#edit-client-message").textContent=e.code==="permission-denied"?"As regras atuais do Firestore bloquearam a edição administrativa.":e.message||"Não foi possível salvar."}finally{b.disabled=false;b.textContent="Salvar alterações"}}
async function updateImportance(id,value){const client=findClient(id);if(!client)return;try{await updateDoc(doc(db,"clientes",id),{importancia:value,atualizadoEm:serverTimestamp()});client.importancia=value;renderAll()}catch(e){console.error(e);renderTable()}}
function setRegisterMode(mode){registerMode=mode;document.querySelectorAll("[data-client-mode]").forEach(b=>b.classList.toggle("active",b.dataset.clientMode===mode));$("#cnpj-fields").hidden=mode!=="cnpj";if(mode==="manual"){$("#new-client-cnpj").value="";$("#cnpj-status").textContent=""}}
async function lookupCnpj(){const raw=$("#new-client-cnpj").value.replace(/\D/g,""),status=$("#cnpj-status");if(!cnpjValid(raw)){status.textContent="CNPJ inválido";return}status.textContent="Consultando...";try{let existing=await getDocs(query(collection(db,"clientes"),where("codigoCnpj","==",raw)));if(existing.empty)existing=await getDocs(query(collection(db,"clientes"),where("cnpj","==",raw)));if(existing.empty)existing=await getDocs(query(collection(db,"clientes"),where("codigoCnpj","==",legacyCnpjCode(raw))));if(!existing.empty)throw new Error("Este CNPJ já está cadastrado como "+(existing.docs[0].data().nome||"cliente")+".");const d=await fetchJson("https://brasilapi.com.br/api/cnpj/v1/"+raw);$("#new-client-name").value=d.nome_fantasia||d.razao_social||"";$("#new-client-cep").value=String(d.cep||"").replace(/\D/g,"");$("#new-client-street").value=d.logradouro||"";$("#new-client-number").value=d.numero||"";$("#new-client-neighborhood").value=d.bairro||"";$("#new-client-city").value=d.municipio||"";$("#new-client-uf").value=d.uf||"";status.textContent="Dados encontrados"}catch(e){console.error(e);status.textContent=e.message||"Não foi possível consultar o CNPJ."}}
async function lookupCep(){const raw=$("#new-client-cep").value.replace(/\D/g,""),status=$("#address-status");if(!/^\d{8}$/.test(raw)){status.textContent="CEP inválido";return}status.textContent="Consultando...";try{const d=await fetchJson("https://brasilapi.com.br/api/cep/v2/"+raw);$("#new-client-street").value=d.street||"";$("#new-client-neighborhood").value=d.neighborhood||"";$("#new-client-city").value=d.city||"";$("#new-client-uf").value=d.state||"";status.textContent="CEP encontrado"}catch(e){status.textContent="Preencha o endereço manualmente"}}
function fullNewAddress(){return[$("#new-client-street").value.trim(),$("#new-client-number").value.trim(),$("#new-client-neighborhood").value.trim(),$("#new-client-city").value.trim(),$("#new-client-uf").value.trim().toUpperCase()].filter(Boolean).join(", ")}
async function createClient(event){event.preventDefault();const b=$("#create-client");b.disabled=true;b.textContent="Localizando...";$("#new-client-message").textContent="";try{const name=$("#new-client-name").value.trim(),city=$("#new-client-city").value.trim(),uf=$("#new-client-uf").value.trim().toUpperCase(),address=fullNewAddress();if(!name||!city||!uf||!$("#new-client-street").value.trim()||!$("#new-client-number").value.trim())throw new Error("Preencha nome, logradouro, número, cidade e UF.");const coords=await geocodeClientAddress({street:$("#new-client-street").value.trim(),number:$("#new-client-number").value.trim(),neighborhood:$("#new-client-neighborhood").value.trim(),city,uf,cep:$("#new-client-cep").value,address});if(!coords)throw new Error("Não foi possível localizar este endereço nem pelo CEP. Confira endereço, número, cidade, UF e CEP.");let id,cnpj=null,status="Provisorio";if(registerMode==="cnpj"){const raw=$("#new-client-cnpj").value.replace(/\D/g,"");if(!cnpjValid(raw))throw new Error("Informe um CNPJ válido.");let existing=await getDocs(query(collection(db,"clientes"),where("codigoCnpj","==",raw)));if(existing.empty)existing=await getDocs(query(collection(db,"clientes"),where("cnpj","==",raw)));if(existing.empty)existing=await getDocs(query(collection(db,"clientes"),where("codigoCnpj","==",legacyCnpjCode(raw))));if(!existing.empty)throw new Error("Este CNPJ já está cadastrado.");cnpj=raw;id="CLI-CNPJ-"+raw;status="Ativo"}else{id=provisionalId()}const now=new Date(),payload={nome:name,cidade:city,uf,enderecoCompleto:address,lat:coords.lat,lng:coords.lng,status,importancia:$("#new-client-importance").value,criadoEm:now,atualizadoEm:now};if(cnpj)payload.codigoCnpj=cnpj;else payload.criadoPor=currentAdmin.uid;await setDoc(doc(db,"clientes",id),payload);clients.push({id,...payload});renderAll();closeModal("new-client")}catch(e){console.error(e);$("#new-client-message").textContent=e.code==="permission-denied"?"As regras atuais do Firestore bloquearam o cadastro administrativo.":e.message||"Não foi possível cadastrar o cliente."}finally{b.disabled=false;b.textContent="Cadastrar cliente"}}
function openNewClient(){registerMode="cnpj";$("#new-client-form").reset();$("#new-client-importance").value="Não definida";$("#new-client-message").textContent="";$("#cnpj-status").textContent="";$("#address-status").textContent="";setRegisterMode("cnpj");openModal("new-client")}
function openDeleteClient(){if(!selectedClient)return;$("#delete-client-message").textContent="";closeModal("edit-client");openModal("delete-client")}
async function confirmDeleteClient(){if(!selectedClient)return;const b=$("#confirm-delete-client");b.disabled=true;b.textContent="Excluindo...";try{await updateDoc(doc(db,"clientes",selectedClient.id),{status:"Inativo",excluidoEm:serverTimestamp(),excluidoPor:currentAdmin.uid,atualizadoEm:serverTimestamp()});selectedClient.status="Inativo";renderAll();closeModal("delete-client");selectedClient=null}catch(e){console.error(e);$("#delete-client-message").textContent=e.message||"Não foi possível excluir o cliente."}finally{b.disabled=false;b.textContent="Excluir cliente"}}

function exportClientPdf(){
    if(!selectedClient)return;
    const client=selectedClient;
    const stats=clientStats(client);
    const rows=stats.list.map(activity=>{
        const professional=people.get(activity.ptvId);
        return '<tr><td>'+escapeHtml(formatDateTime(activity.data))+'</td><td>'+escapeHtml(normalizeVisitType(activity))+'</td><td>'+escapeHtml(professional?.nome||activity.ptvId||"Profissional não identificado")+'</td><td>'+escapeHtml(activity.status||"—")+'</td><td>'+escapeHtml(formatDuration(durationMinutes(activity)))+'</td></tr>';
    }).join("");

    printDocument({
        kicker:"Perfil de cliente",
        title:client.nome||"Cliente",
        subtitle:client.enderecoCompleto||"Endereço não informado",
        badge:normalizeStatus(client.status),
        meta:[
            {label:"Cidade",value:(client.cidade||"—")+(client.uf?" / "+client.uf:"")},
            {label:"Importância",value:clientImportance(client)},
            {label:"Distância da Advance",value:distanceLabel(client)},
            {label:"CNPJ",value:clientCnpj(client)?formatCnpj(clientCnpj(client)):"Sem CNPJ"}
        ],
        sections:[
            {
                eyebrow:"Resumo operacional",
                title:"Indicadores do cliente",
                html:'<div class="field-grid">'+
                    '<div class="field"><span>Visitas</span><strong>'+stats.total+'</strong></div>'+
                    '<div class="field"><span>Concluídas</span><strong>'+stats.completed+'</strong></div>'+
                    '<div class="field"><span>Tempo em campo</span><strong>'+escapeHtml(formatDuration(stats.totalMinutes))+'</strong></div>'+
                    '<div class="field"><span>Média por visita</span><strong>'+escapeHtml(formatDuration(stats.average))+'</strong></div>'+
                    '<div class="field"><span>Profissionais envolvidos</span><strong>'+stats.professionals+'</strong></div>'+
                    '<div class="field"><span>Última visita</span><strong>'+escapeHtml(stats.last?formatDateTime(stats.last):"—")+'</strong></div>'+
                '</div>'
            },
            {
                eyebrow:"Cadastro",
                title:"Informações do cliente",
                html:'<div class="field-grid">'+
                    '<div class="field wide"><span>Endereço</span><strong>'+escapeHtml(client.enderecoCompleto||"Não informado")+'</strong></div>'+
                    '<div class="field"><span>Cidade / UF</span><strong>'+escapeHtml((client.cidade||"—")+(client.uf?" / "+client.uf:""))+'</strong></div>'+
                    '<div class="field"><span>Status</span><strong>'+escapeHtml(normalizeStatus(client.status))+'</strong></div>'+
                    '<div class="field"><span>Importância</span><strong>'+escapeHtml(clientImportance(client))+'</strong></div>'+
                    '<div class="field"><span>Distância</span><strong>'+escapeHtml(distanceLabel(client))+'</strong></div>'+
                '</div>'
            },
            {
                eyebrow:"Histórico",
                title:"Visitas registradas",
                html:rows
                    ?'<table><thead><tr><th>Data</th><th>Tipo</th><th>Profissional</th><th>Status</th><th>Duração</th></tr></thead><tbody>'+rows+'</tbody></table>'
                    :'<p class="prose">Nenhuma visita registrada para este cliente.</p>'
            }
        ]
    });
}

function bindEvents(){
$("#client-search").addEventListener("input",renderTable);$("#only-active-clients").addEventListener("change",renderTable);$("#refresh-clients").addEventListener("click",loadData);$("#new-client").addEventListener("click",openNewClient);
$("#clients-table").addEventListener("click",e=>{const b=e.target.closest("[data-client-action]");if(!b)return;const c=findClient(b.dataset.id);if(!c)return;if(b.dataset.clientAction==="profile")openProfile(c);else openEdit(c)});
$("#clients-table").addEventListener("change",e=>{const select=e.target.closest("[data-importance-id]");if(select)updateImportance(select.dataset.importanceId,select.value)});
document.querySelectorAll("[data-close-client-modal]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.closeClientModal)));
$("#client-export-pdf").addEventListener("click",exportClientPdf);$("#edit-client-from-profile").addEventListener("click",()=>selectedClient&&openEdit(selectedClient));$("#edit-client-form").addEventListener("submit",saveClient);$("#delete-client").addEventListener("click",openDeleteClient);$("#confirm-delete-client").addEventListener("click",confirmDeleteClient);
document.querySelectorAll("[data-client-mode]").forEach(b=>b.addEventListener("click",()=>setRegisterMode(b.dataset.clientMode)));$("#lookup-cnpj").addEventListener("click",lookupCnpj);$("#new-client-cnpj").addEventListener("blur",()=>{const raw=$("#new-client-cnpj").value.replace(/\D/g,"");if(raw.length===14)lookupCnpj()});$("#lookup-cep").addEventListener("click",lookupCep);$("#new-client-cep").addEventListener("blur",()=>{if($("#new-client-cep").value.replace(/\D/g,"").length===8)lookupCep()});$("#new-client-form").addEventListener("submit",createClient);
document.addEventListener("keydown",e=>{if(e.key==="Escape")["client-profile","edit-client","new-client","delete-client"].forEach(closeModal)});
}

(async()=>{try{const{user,admin}=await requireAdmin();currentAdmin=admin;setupLayout("clients",admin,user);bindEvents();await loadAdvanceCoords();await loadData();const clientId=new URLSearchParams(location.search).get("client");if(clientId){const client=findClient(clientId);if(client)openProfile(client)}}catch(e){console.error(e);$("#clients-table").innerHTML='<tr><td colspan="8" class="empty-row">Não foi possível carregar os clientes.</td></tr>'}})();