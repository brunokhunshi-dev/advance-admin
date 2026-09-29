import {
    $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml,
    asDate, formatDateTime, formatDuration, statusClass
} from "./core.js";

let activities=[];
let clients=new Map();
let professionals=new Map();
let reportsByActivity=new Map();
let activeTab="technical";
let selectedActivity=null;

function isTraining(activity){
    return String(activity.tipoVisita||activity.tipo||activity.objetivo||"").toLowerCase().includes("trein");
}
function typeLabel(activity){return isTraining(activity)?"Treinamento":"Visita técnica"}
function personName(id){return professionals.get(id)?.nome||"Profissional não identificado"}
function clientName(id){return clients.get(id)?.nome||"Cliente não encontrado"}
function activityDuration(activity){
    const start=asDate(activity.checkinDataHora),end=asDate(activity.checkoutDataHora);
    return start&&end&&end>=start?(end-start)/60000:null;
}
function hasOpportunity(activity){
    const value=String(activity.oportunidadeIdentificada||"").trim().toLowerCase();
    return !!value&&!["não","nao","nenhuma","não identificado","nao identificado","-"].includes(value);
}
function trainingParticipants(activity){
    const value=Number(activity.quantidadeParticipantes);
    return Number.isFinite(value)&&value>=0?value:0;
}
function visibleActivities(){
    const search=$("#visit-search").value.trim().toLowerCase();
    const status=$("#visit-status-filter").value;
    return activities.filter(activity=>{
        if(activeTab==="training"&&!isTraining(activity))return false;
        if(activeTab==="technical"&&isTraining(activity))return false;
        if(status&&activity.status!==status)return false;
        if(search){
            const haystack=[
                clientName(activity.clienteId),personName(activity.ptvId),
                activity.objetivo,activity.oportunidadeIdentificada,
                activity.categoriaTreinamento,activity.publicoAtendido
            ].join(" ").toLowerCase();
            if(!haystack.includes(search))return false;
        }
        return true;
    }).sort((a,b)=>(asDate(b.data)?.getTime()||0)-(asDate(a.data)?.getTime()||0));
}

function renderCounts(){
    const technical=activities.filter(a=>!isTraining(a)).length;
    const training=activities.filter(isTraining).length;
    $("#technical-count").textContent=technical;
    $("#training-count").textContent=training;
}

function renderMetrics(){
    const rows=visibleActivities();
    const completed=rows.filter(a=>a.status==="Concluída").length;
    const durations=rows.map(activityDuration).filter(Number.isFinite);
    const avg=durations.length?durations.reduce((s,v)=>s+v,0)/durations.length:null;

    $("#visit-metric-total").textContent=rows.length;
    $("#visit-metric-completed").textContent=completed;
    $("#visit-metric-completed-sub").textContent=rows.length?Math.round(completed/rows.length*100)+"% do período filtrado":"Sem atividades";

    if(activeTab==="training"){
        const participants=rows.reduce((sum,a)=>sum+trainingParticipants(a),0);
        const withParticipants=rows.filter(a=>trainingParticipants(a)>0).length;
        $("#visit-metric-total-label").textContent="Treinamentos";
        $("#visit-metric-total-sub").textContent=new Set(rows.map(a=>a.clienteId).filter(Boolean)).size+" clientes atendidos";
        $("#visit-metric-special-label").textContent="Participantes";
        $("#visit-metric-special").textContent=participants;
        $("#visit-metric-special-sub").textContent=withParticipants+" treinamentos com público informado";
        $("#visit-metric-duration-label").textContent="Duração média";
        $("#visit-metric-duration").textContent=formatDuration(avg);
        $("#visit-metric-duration-sub").textContent=durations.length+" registros com checkout";
    }else{
        const opportunities=rows.filter(hasOpportunity).length;
        $("#visit-metric-total-label").textContent="Visitas técnicas";
        $("#visit-metric-total-sub").textContent=new Set(rows.map(a=>a.clienteId).filter(Boolean)).size+" clientes atendidos";
        $("#visit-metric-special-label").textContent="Oportunidades";
        $("#visit-metric-special").textContent=opportunities;
        $("#visit-metric-special-sub").textContent=rows.length?Math.round(opportunities/rows.length*100)+"% das visitas":"Sem visitas";
        $("#visit-metric-duration-label").textContent="Tempo médio em campo";
        $("#visit-metric-duration").textContent=formatDuration(avg);
        $("#visit-metric-duration-sub").textContent=durations.length+" registros com checkout";
    }
}

function actionButtons(activity){
    const hasReport=reportsByActivity.has(activity.id)||activity.relatorioId;
    return '<div class="row-actions visit-row-actions">'+
        '<button class="row-link" type="button" data-visit-action="detail" data-id="'+escapeHtml(activity.id)+'">Ver visita</button>'+
        '<button class="visit-report-button'+(hasReport?"":" is-muted")+'" type="button" data-visit-action="report" data-id="'+escapeHtml(activity.id)+'">'+(hasReport?"Relatório":"Sem relatório")+'</button>'+
    '</div>';
}
function renderTables(){
    const rows=visibleActivities();
    if(activeTab==="training"){
        $("#technical-table-wrap").hidden=true;
        $("#training-table-wrap").hidden=false;
        $("#training-visits-table").innerHTML=rows.length?rows.map(a=>
            '<tr data-activity-id="'+escapeHtml(a.id)+'">'+
            '<td><div class="visit-client-cell"><strong>'+escapeHtml(clientName(a.clienteId))+'</strong><small>'+escapeHtml(clients.get(a.clienteId)?.cidade||"")+'</small></div></td>'+
            '<td>'+escapeHtml(personName(a.ptvId))+'</td>'+
            '<td>'+formatDateTime(a.data)+'</td>'+
            '<td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td>'+
            '<td>'+escapeHtml(a.categoriaTreinamento||"—")+'</td>'+
            '<td><strong>'+trainingParticipants(a)+'</strong></td>'+
            '<td>'+escapeHtml(a.publicoAtendido||"—")+'</td>'+
            '<td>'+formatDuration(activityDuration(a))+'</td>'+
            '<td>'+actionButtons(a)+'</td></tr>'
        ).join(""):'<tr><td colspan="9" class="empty-row">Nenhum treinamento encontrado.</td></tr>';
    }else{
        $("#training-table-wrap").hidden=true;
        $("#technical-table-wrap").hidden=false;
        $("#technical-visits-table").innerHTML=rows.length?rows.map(a=>
            '<tr data-activity-id="'+escapeHtml(a.id)+'">'+
            '<td><div class="visit-client-cell"><strong>'+escapeHtml(clientName(a.clienteId))+'</strong><small>'+escapeHtml(clients.get(a.clienteId)?.cidade||"")+'</small></div></td>'+
            '<td>'+escapeHtml(personName(a.ptvId))+'</td>'+
            '<td>'+formatDateTime(a.data)+'</td>'+
            '<td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td>'+
            '<td class="visit-text-cell">'+escapeHtml(a.objetivo||"—")+'</td>'+
            '<td class="visit-text-cell">'+escapeHtml(a.oportunidadeIdentificada||"—")+'</td>'+
            '<td>'+formatDuration(activityDuration(a))+'</td>'+
            '<td>'+actionButtons(a)+'</td></tr>'
        ).join(""):'<tr><td colspan="8" class="empty-row">Nenhuma visita técnica encontrada.</td></tr>';
    }
}
function renderAll(){renderCounts();renderMetrics();renderTables()}

function detailItem(label,value,wide=false){
    return '<article class="visit-detail-item'+(wide?" is-wide":"")+'"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value??"—")+'</strong></article>';
}
function fieldTimeline(activity){
    const items=[
        ["Check-in",activity.checkinDataHora,activity.checkinEndereco,activity.checkinGps],
        ["Checkout",activity.checkoutDataHora,activity.checkoutEndereco,activity.checkoutGps]
    ];
    return items.map(([label,date,address,gps])=>
        '<article class="field-timeline-item"><span class="field-timeline-dot"></span><div><strong>'+label+'</strong><small>'+formatDateTime(date)+'</small><p>'+escapeHtml(address||gps||"Localização não registrada")+'</p></div></article>'
    ).join("");
}
function openDetail(activity){
    selectedActivity=activity;
    const training=isTraining(activity);
    $("#visit-detail-type").textContent=training?"TREINAMENTO":"VISITA TÉCNICA";
    $("#visit-detail-client").textContent=clientName(activity.clienteId);
    $("#visit-detail-meta").textContent=personName(activity.ptvId)+" • "+formatDateTime(activity.data);
    $("#visit-detail-status").textContent=activity.status||"—";
    $("#visit-detail-status").className="profile-status "+(activity.status==="Concluída"?"is-active":"");

    $("#visit-detail-grid").innerHTML=training?[
        detailItem("Categoria",activity.categoriaTreinamento||"—"),
        detailItem("Participantes",String(trainingParticipants(activity))),
        detailItem("Público atendido",activity.publicoAtendido||"—"),
        detailItem("Duração",formatDuration(activityDuration(activity))),
        detailItem("Resultado",activity.resultado||"—",true),
        detailItem("Motivo de fechamento",activity.motivoFechamentoManual||"—",true)
    ].join(""):[
        detailItem("Objetivo",activity.objetivo||"—",true),
        detailItem("Oportunidade identificada",activity.oportunidadeIdentificada||"—",true),
        detailItem("Duração",formatDuration(activityDuration(activity))),
        detailItem("Resultado",activity.resultado||"—"),
        detailItem("Tipo de fechamento",activity.fechamentoTipo||"—"),
        detailItem("Análise do fechamento",activity.fechamentoAnaliseStatus||"—")
    ].join("");

    $("#visit-field-timeline").innerHTML=fieldTimeline(activity);
    $("#visit-detail-note").textContent=activity.nota||"Nenhuma observação registrada.";
    $("#visit-open-report").textContent=reportsByActivity.has(activity.id)||activity.relatorioId?"Ver relatório":"Relatório não disponível";
    openModal("visit-detail");
}
function reportValue(report,activity,key){
    const value=report?.[key]??activity?.[key];
    if(value===undefined||value===null||value==="")return"—";
    if(typeof value?.toDate==="function"||value instanceof Date)return formatDateTime(value);
    if(typeof value==="boolean")return value?"Sim":"Não";
    if(Array.isArray(value))return value.map(item=>typeof item==="object"?JSON.stringify(item):String(item)).join(", ");
    if(typeof value==="object")return JSON.stringify(value);
    return String(value);
}
const FIELD_LABELS={
    tipoVisita:"Tipo de atividade",objetivo:"Objetivo",oportunidadeIdentificada:"Oportunidade identificada",
    categoriaTreinamento:"Categoria do treinamento",quantidadeParticipantes:"Quantidade de participantes",
    publicoAtendido:"Público atendido",resultado:"Resultado",fechamentoTipo:"Tipo de fechamento",
    fechamentoAnaliseStatus:"Status da análise",motivoFechamentoManual:"Motivo do fechamento manual",
    fechamentoSolicitadoEm:"Fechamento solicitado em",fechamentoSolicitadoPor:"Fechamento solicitado por",
    checkoutDataHora:"Checkout",checkoutEndereco:"Endereço do checkout",checkoutGps:"GPS do checkout",
    checkinDataHora:"Check-in",checkinEndereco:"Endereço do check-in",checkinGps:"GPS do check-in"
};
function historyText(entry,index){
    if(typeof entry==="string")return '<article class="report-history-item"><strong>Versão '+(index+1)+'</strong><p>'+escapeHtml(entry)+'</p></article>';
    const text=entry?.texto||entry?.textoAtual||entry?.conteudo||entry?.relatorio||JSON.stringify(entry);
    const date=entry?.data||entry?.criadoEm||entry?.atualizadoEm;
    return '<article class="report-history-item"><strong>Versão '+(index+1)+'</strong><small>'+(date?formatDateTime(date):"")+'</small><p>'+escapeHtml(text||"—")+'</p></article>';
}
function openReport(activity){
    selectedActivity=activity;
    const report=reportsByActivity.get(activity.id)||null;
    $("#report-type-label").textContent=isTraining(activity)?"RELATÓRIO • TREINAMENTO":"RELATÓRIO • VISITA TÉCNICA";
    $("#report-title").textContent=clientName(activity.clienteId);
    $("#report-summary-grid").innerHTML=[
        detailItem("Profissional",personName(activity.ptvId)),
        detailItem("Cliente",clientName(activity.clienteId)),
        detailItem("Data",formatDateTime(activity.data)),
        detailItem("Status",activity.status||"—")
    ].join("");
    $("#report-current-text").textContent=report?.textoAtual||"Nenhum texto final salvo neste relatório.";

    const keys=isTraining(activity)
        ?["categoriaTreinamento","quantidadeParticipantes","publicoAtendido","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"]
        :["objetivo","oportunidadeIdentificada","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"];
    $("#report-fields").innerHTML=keys.map(key=>detailItem(FIELD_LABELS[key]||key,reportValue(report,activity,key),["objetivo","oportunidadeIdentificada","resultado","motivoFechamentoManual"].includes(key))).join("");

    const history=Array.isArray(report?.historico)?report.historico:[];
    $("#report-history").innerHTML=history.length?history.map(historyText).join(""):'<div class="profile-empty">Nenhuma versão anterior registrada.</div>';
    openModal("visit-report");
}
function openModal(name){const modal=$("#"+name+"-modal");if(modal){modal.hidden=false;document.body.classList.add("modal-open")}}
function closeModal(name){const modal=$("#"+name+"-modal");if(modal)modal.hidden=true;if(![...document.querySelectorAll(".team-modal")].some(m=>!m.hidden))document.body.classList.remove("modal-open")}
function selectTab(tab){
    activeTab=tab;
    document.querySelectorAll("[data-visit-tab]").forEach(button=>{
        const active=button.dataset.visitTab===tab;
        button.classList.toggle("active",active);
        button.setAttribute("aria-selected",String(active));
    });
    renderAll();
}
function findActivity(id){return activities.find(a=>a.id===id)||null}
function handleAction(event){
    const button=event.target.closest("[data-visit-action]");
    if(!button)return;
    const activity=findActivity(button.dataset.id);
    if(!activity)return;
    if(button.dataset.visitAction==="detail")openDetail(activity);
    else openReport(activity);
}
function bindEvents(){
    document.querySelectorAll("[data-visit-tab]").forEach(button=>button.addEventListener("click",()=>selectTab(button.dataset.visitTab)));
    $("#visit-search").addEventListener("input",renderAll);
    $("#visit-status-filter").addEventListener("change",renderAll);
    $("#refresh-visits").addEventListener("click",loadData);
    $("#technical-visits-table").addEventListener("click",handleAction);
    $("#training-visits-table").addEventListener("click",handleAction);
    document.querySelectorAll("[data-close-visit-modal]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.closeVisitModal)));
    $("#visit-open-report").addEventListener("click",()=>selectedActivity&&openReport(selectedActivity));
    $("#visit-open-client").addEventListener("click",()=>{if(selectedActivity?.clienteId)location.href="./clients.html?client="+encodeURIComponent(selectedActivity.clienteId)});
    $("#visit-open-professional").addEventListener("click",()=>{if(selectedActivity?.ptvId)location.href="./team.html?member="+encodeURIComponent(selectedActivity.ptvId)});
    document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeModal("visit-report");closeModal("visit-detail")}});
}
async function loadData(){
    const [acts,clientSnap,assistSnap,promoterSnap,reportSnap]=await Promise.all([
        getDocs(collection(db,"atividades")),
        getDocs(collection(db,"clientes")),
        getDocs(collection(db,"assistencia")),
        getDocs(collection(db,"promotores")),
        getDocs(collection(db,"relatorios"))
    ]);
    activities=acts.docs.map(d=>({id:d.id,...d.data()}));
    clients=new Map(clientSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    professionals=new Map([...assistSnap.docs,...promoterSnap.docs].map(d=>[d.id,{id:d.id,...d.data()}]));
    reportsByActivity=new Map();
    reportSnap.docs.forEach(d=>{
        const report={id:d.id,...d.data()};
        if(report.atividadeId)reportsByActivity.set(report.atividadeId,report);
    });
    renderAll();

    const params=new URLSearchParams(location.search);
    const activityId=params.get("activity");
    if(activityId){
        const activity=findActivity(activityId);
        if(activity){
            selectTab(isTraining(activity)?"training":"technical");
            openDetail(activity);
        }
    }
}

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("visits",admin,user);
        bindEvents();
        await loadData();
    }catch(error){
        console.error(error);
        $("#technical-visits-table").innerHTML='<tr><td colspan="8" class="empty-row">Não foi possível carregar as visitas.</td></tr>';
        $("#training-visits-table").innerHTML='<tr><td colspan="9" class="empty-row">Não foi possível carregar os treinamentos.</td></tr>';
    }
})();