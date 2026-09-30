import {
    $, auth, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml,
    asDate, formatDateTime, formatDuration, statusClass, normalizeVisitType
} from "./core.js";
import { preparePrintWindow, printDocument } from "./print-document.js";

let activities=[];
let clients=new Map();
let professionals=new Map();
let reportsByActivity=new Map();
let reportsByKey=new Map();
let activeTab="commercial";
let selectedActivity=null;

const REPORT_COLLECTIONS=[
    "relatorios",
    "relatorios_comerciais",
    "relatorios_treinamentos",
    "relatorios_assistencia_tecnica"
];

const MEDIA_API_BASE="https://advance-media-api.brunokhunshi.workers.dev";
let currentReportMedia=new Map();

function activityType(activity){return normalizeVisitType(activity)}
function typeKey(activity){
    const type=activityType(activity);
    if(type==="Treinamento")return"training";
    if(type==="Assistência técnica")return"assistance";
    return"commercial";
}
function typeLabel(activity){return activityType(activity)}
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
function reportFor(activity){
    if(!activity)return null;
    const byActivity=reportsByActivity.get(activity.id);
    if(byActivity)return byActivity;
    if(activity.relatorioId&&activity.relatorioColecao){
        const byKey=reportsByKey.get(activity.relatorioColecao+":"+activity.relatorioId);
        if(byKey)return byKey;
    }
    if(activity.relatorioId){
        for(const collectionName of REPORT_COLLECTIONS){
            const report=reportsByKey.get(collectionName+":"+activity.relatorioId);
            if(report)return report;
        }
    }
    return null;
}
function assistanceData(report){
    if(!report)return{};
    if(report.assistenciaTecnica)return{...report.assistenciaTecnica};
    return{
        ...(report.clienteAplicacao||{}),
        ...(report.produtoQueixa||{}),
        ...(report.preparoAplicacao||{}),
        ...(report.verificacao||{}),
        fotosSelecionadas:Array.isArray(report.evidencias?.fotos)?report.evidencias.fotos:[],
        acoesDefinidas:report.fechamento?.acoesDefinidas||"",
        conclusaoTecnica:report.fechamento?.conclusaoTecnica||"",
        resultado:report.fechamento?.resultado||"",
        proximoPasso:report.fechamento?.proximoPasso||""
    };
}
function visibleActivities(){
    const search=$("#visit-search").value.trim().toLowerCase();
    const status=$("#visit-status-filter").value;
    return activities.filter(activity=>{
        if(typeKey(activity)!==activeTab)return false;
        if(status&&activity.status!==status)return false;
        if(search){
            const report=reportFor(activity);
            const assistance=assistanceData(report);
            const haystack=[
                clientName(activity.clienteId),personName(activity.ptvId),
                activity.objetivo,activity.oportunidadeIdentificada,
                activity.categoriaTreinamento,activity.publicoAtendido,
                assistance.produto,assistance.clienteFinal,assistance.queixa,
                assistance.empresaAplicacao,assistance.responsavelEmpresa
            ].join(" ").toLowerCase();
            if(!haystack.includes(search))return false;
        }
        return true;
    }).sort((a,b)=>(asDate(b.data)?.getTime()||0)-(asDate(a.data)?.getTime()||0));
}

function renderCounts(){
    $("#commercial-count").textContent=activities.filter(a=>typeKey(a)==="commercial").length;
    $("#training-count").textContent=activities.filter(a=>typeKey(a)==="training").length;
    $("#assistance-count").textContent=activities.filter(a=>typeKey(a)==="assistance").length;
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
        $("#visit-metric-total-label").textContent="Treinamentos";
        $("#visit-metric-total-sub").textContent=new Set(rows.map(a=>a.clienteId).filter(Boolean)).size+" clientes atendidos";
        $("#visit-metric-special-label").textContent="Participantes";
        $("#visit-metric-special").textContent=participants;
        $("#visit-metric-special-sub").textContent=rows.filter(a=>trainingParticipants(a)>0).length+" treinamentos com público informado";
        $("#visit-metric-duration-label").textContent="Duração média";
    }else if(activeTab==="assistance"){
        const resolved=rows.filter(a=>{
            const report=reportFor(a),data=assistanceData(report);
            return String(data.resultado||a.resultadoAssistencia||a.resultado||"").toLowerCase()==="resolvido";
        }).length;
        $("#visit-metric-total-label").textContent="Assistências técnicas";
        $("#visit-metric-total-sub").textContent=new Set(rows.map(a=>a.clienteId).filter(Boolean)).size+" clientes atendidos";
        $("#visit-metric-special-label").textContent="Resolvidas";
        $("#visit-metric-special").textContent=resolved;
        $("#visit-metric-special-sub").textContent=rows.length?Math.round(resolved/rows.length*100)+"% das assistências":"Sem assistências";
        $("#visit-metric-duration-label").textContent="Tempo médio em campo";
    }else{
        const opportunities=rows.filter(hasOpportunity).length;
        $("#visit-metric-total-label").textContent="Visitas comerciais";
        $("#visit-metric-total-sub").textContent=new Set(rows.map(a=>a.clienteId).filter(Boolean)).size+" clientes atendidos";
        $("#visit-metric-special-label").textContent="Oportunidades";
        $("#visit-metric-special").textContent=opportunities;
        $("#visit-metric-special-sub").textContent=rows.length?Math.round(opportunities/rows.length*100)+"% das visitas":"Sem visitas";
        $("#visit-metric-duration-label").textContent="Tempo médio em campo";
    }

    $("#visit-metric-duration").textContent=formatDuration(avg);
    $("#visit-metric-duration-sub").textContent=durations.length+" registros com checkout";
}

function actionButtons(activity){
    const hasReport=!!reportFor(activity)||!!activity.relatorioId;
    return '<div class="row-actions visit-row-actions">'+
        '<button class="row-link" type="button" data-visit-action="detail" data-id="'+escapeHtml(activity.id)+'">Ver visita</button>'+
        '<button class="visit-report-button'+(hasReport?"":" is-muted")+'" type="button" data-visit-action="report" data-id="'+escapeHtml(activity.id)+'">'+(hasReport?"Relatório":"Sem relatório")+'</button>'+
    '</div>';
}
function clientCell(activity){
    return '<div class="visit-client-cell"><strong>'+escapeHtml(clientName(activity.clienteId))+'</strong><small>'+escapeHtml(clients.get(activity.clienteId)?.cidade||"")+'</small></div>';
}
function renderTables(){
    const rows=visibleActivities();
    ["commercial","training","assistance"].forEach(tab=>{
        const wrap=$("#"+tab+"-table-wrap");
        if(wrap)wrap.hidden=tab!==activeTab;
    });

    if(activeTab==="training"){
        $("#training-visits-table").innerHTML=rows.length?rows.map(a=>
            '<tr data-activity-id="'+escapeHtml(a.id)+'">'+
            '<td>'+clientCell(a)+'</td>'+
            '<td>'+escapeHtml(personName(a.ptvId))+'</td>'+
            '<td>'+formatDateTime(a.data)+'</td>'+
            '<td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td>'+
            '<td>'+escapeHtml(a.categoriaTreinamento||"—")+'</td>'+
            '<td><strong>'+trainingParticipants(a)+'</strong></td>'+
            '<td>'+escapeHtml(a.publicoAtendido||"—")+'</td>'+
            '<td>'+formatDuration(activityDuration(a))+'</td>'+
            '<td>'+actionButtons(a)+'</td></tr>'
        ).join(""):'<tr><td colspan="9" class="empty-row">Nenhum treinamento encontrado.</td></tr>';
        return;
    }

    if(activeTab==="assistance"){
        $("#assistance-visits-table").innerHTML=rows.length?rows.map(a=>{
            const data=assistanceData(reportFor(a));
            const result=data.resultado||a.resultadoAssistencia||a.resultado||"—";
            return '<tr data-activity-id="'+escapeHtml(a.id)+'">'+
                '<td>'+clientCell(a)+'</td>'+
                '<td>'+escapeHtml(personName(a.ptvId))+'</td>'+
                '<td>'+formatDateTime(a.data)+'</td>'+
                '<td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td>'+
                '<td>'+escapeHtml(data.produto||"—")+'</td>'+
                '<td>'+escapeHtml(data.clienteFinal||"—")+'</td>'+
                '<td>'+escapeHtml(result)+'</td>'+
                '<td>'+formatDuration(activityDuration(a))+'</td>'+
                '<td>'+actionButtons(a)+'</td></tr>';
        }).join(""):'<tr><td colspan="9" class="empty-row">Nenhuma assistência técnica encontrada.</td></tr>';
        return;
    }

    $("#commercial-visits-table").innerHTML=rows.length?rows.map(a=>
        '<tr data-activity-id="'+escapeHtml(a.id)+'">'+
        '<td>'+clientCell(a)+'</td>'+
        '<td>'+escapeHtml(personName(a.ptvId))+'</td>'+
        '<td>'+formatDateTime(a.data)+'</td>'+
        '<td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td>'+
        '<td class="visit-text-cell">'+escapeHtml(a.objetivo||"—")+'</td>'+
        '<td class="visit-text-cell">'+escapeHtml(a.oportunidadeIdentificada||"—")+'</td>'+
        '<td>'+formatDuration(activityDuration(a))+'</td>'+
        '<td>'+actionButtons(a)+'</td></tr>'
    ).join(""):'<tr><td colspan="8" class="empty-row">Nenhuma visita comercial encontrada.</td></tr>';
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
function visitDetailEntries(activity,report=reportFor(activity)){
    const type=activityType(activity);
    const assistance=assistanceData(report);

    if(type==="Treinamento"){
        return[
            {label:"Categoria",value:activity.categoriaTreinamento||"—"},
            {label:"Participantes",value:String(trainingParticipants(activity))},
            {label:"Público atendido",value:activity.publicoAtendido||"—"},
            {label:"Resultado",value:activity.resultado||"—",wide:true},
            {label:"Motivo de fechamento",value:activity.motivoFechamentoManual||"—",wide:true}
        ];
    }

    if(type==="Assistência técnica"){
        return[
            {label:"Produto",value:assistance.produto||"—"},
            {label:"Cliente final",value:assistance.clienteFinal||"—"},
            {label:"Resultado",value:assistance.resultado||activity.resultadoAssistencia||activity.resultado||"—"},
            {label:"Queixa",value:assistance.queixa||"—",wide:true},
            {label:"Próximo passo",value:assistance.proximoPasso||activity.proximoPassoAssistencia||"—",wide:true}
        ];
    }

    return[
        {label:"Objetivo",value:activity.objetivo||"—",wide:true},
        {label:"Oportunidade identificada",value:activity.oportunidadeIdentificada||"—",wide:true},
        {label:"Resultado",value:activity.resultado||"—"},
        {label:"Tipo de fechamento",value:activity.fechamentoTipo||"—"},
        {label:"Análise do fechamento",value:activity.fechamentoAnaliseStatus||"—"}
    ];
}

function openDetail(activity){
    selectedActivity=activity;
    const type=activityType(activity);
    const report=reportFor(activity);
    const hasReport=!!(report||activity.relatorioId);

    $("#visit-detail-type").textContent=type.toUpperCase();
    $("#visit-detail-client").textContent=clientName(activity.clienteId);
    $("#visit-detail-meta").textContent=type+" • registro operacional";
    $("#visit-detail-status").textContent=activity.status||"—";
    $("#visit-detail-status").className="profile-status "+(activity.status==="Concluída"?"is-active":"");
    $("#visit-detail-duration").textContent=formatDuration(activityDuration(activity));
    $("#visit-detail-professional").textContent=personName(activity.ptvId);
    $("#visit-detail-date").textContent=formatDateTime(activity.data);
    $("#visit-detail-report-status").textContent=hasReport?"Disponível":"Não disponível";

    $("#visit-detail-grid").innerHTML=visitDetailEntries(activity,report)
        .map(item=>detailItem(item.label,item.value,item.wide))
        .join("");

    $("#visit-field-timeline").innerHTML=fieldTimeline(activity);
    $("#visit-detail-note").textContent=activity.nota||"Nenhuma observação registrada.";
    $("#visit-open-report").textContent=hasReport?"Ver relatório":"Relatório não disponível";
    $("#visit-open-report").disabled=!hasReport;
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
    objetivo:"Objetivo",oportunidadeIdentificada:"Oportunidade identificada",
    categoriaTreinamento:"Categoria do treinamento",quantidadeParticipantes:"Quantidade de participantes",
    publicoAtendido:"Público atendido",resultado:"Resultado",fechamentoTipo:"Tipo de fechamento",
    fechamentoAnaliseStatus:"Status da análise",motivoFechamentoManual:"Motivo do fechamento manual",
    checkoutDataHora:"Checkout",checkoutEndereco:"Endereço do checkout",
    checkinDataHora:"Check-in",checkinEndereco:"Endereço do check-in"
};
function historyText(entry,index){
    if(typeof entry==="string")return '<article class="report-history-item"><strong>Versão '+(index+1)+'</strong><p>'+escapeHtml(entry)+'</p></article>';
    const text=entry?.texto||entry?.textoAtual||entry?.conteudo||entry?.relatorio||"";
    const date=entry?.salvoEm||entry?.data||entry?.criadoEm||entry?.atualizadoEm;
    return '<article class="report-history-item"><strong>Versão '+(index+1)+'</strong><small>'+(date?formatDateTime(date):"")+'</small>'+(text?'<p>'+escapeHtml(text)+'</p>':"")+'</article>';
}
function assistanceField(label,value){
    const text=Array.isArray(value)?value.filter(Boolean).join(", "):String(value??"").trim();
    return '<div class="admin-assistance-field"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(text||"Não informado")+'</strong></div>';
}
function assistanceSection(title,fields){
    return '<section class="admin-assistance-section"><h3>'+escapeHtml(title)+'</h3>'+fields.join("")+'</section>';
}
function renderAssistanceReport(report){
    const d=assistanceData(report);
    const specification=d.houveEspecificacao==="Sim"
        ?"Sim"+(d.numeroEspecificacao?" • "+d.numeroEspecificacao:"")
        :(d.houveEspecificacao||"Não informado");
    const climate=d.impactoClimatico==="Sim"
        ?"Sim"+(d.impactoClimaticoDetalhe?" • "+d.impactoClimaticoDetalhe:"")
        :(d.impactoClimatico||"Não informado");

    return [
        assistanceSection("Cliente e aplicação",[
            assistanceField("Cliente final",d.clienteFinal),
            assistanceField("Contato / setor",[d.contato,d.setor].filter(Boolean).join(" / ")),
            assistanceField("Endereço de aplicação",d.enderecoAplicacao),
            assistanceField("Empresa de aplicação",d.empresaAplicacao),
            assistanceField("Responsável da empresa",d.responsavelEmpresa),
            assistanceField("Acompanhado por",d.acompanhadoPor),
            assistanceField("Equipamento / superfície",d.superficie),
            assistanceField("Data da aplicação",d.dataAplicacao),
            assistanceField("Especificação",specification)
        ]),
        assistanceSection("Produto e queixa",[
            assistanceField("Produto",d.produto),
            assistanceField("Lote",d.lote),
            assistanceField("Cor",d.cor),
            assistanceField("Queixa",d.queixa),
            assistanceField("Esquema de pintura",d.esquemaPintura)
        ]),
        assistanceSection("Preparo e condições de aplicação",[
            assistanceField("Preparo da superfície",d.preparoSuperficie),
            assistanceField("Métodos de limpeza",d.metodosLimpeza),
            assistanceField("Impacto climático / intempéries",climate),
            assistanceField("Ferramenta de aplicação",d.ferramentasAplicacao)
        ]),
        assistanceSection("O que foi verificado",[
            assistanceField("Itens verificados",d.itensVerificados),
            assistanceField("Umidade medida",d.umidade),
            assistanceField("Referência / limite",d.umidadeReferencia),
            assistanceRichField("Relatório técnico",reportStructuredMarkup(report,d.constatacoes))
        ]),
        assistanceSection("Fechamento",[
            assistanceField("Ações definidas",d.acoesDefinidas),
            assistanceField("Conclusão técnica",d.conclusaoTecnica),
            assistanceField("Resultado da assistência",d.resultado),
            assistanceField("Próximo passo",d.proximoPasso)
        ])
    ].join("");
}
function reportMediaBlocks(report){
    const blocks=report?.conteudoRelatorio?.blocos;
    return Array.isArray(blocks)?blocks:[];
}

function isImageBlock(block){
    if(block?.kind!=="media"||!block.id)return false;
    const type=String(block.type||"").toLowerCase();
    const name=String(block.name||block.originalName||"").toLowerCase();
    return type.startsWith("image/")||/\.(jpe?g|png|webp|avif|heic|heif)$/i.test(name);
}

function reportStructuredMarkup(report,fallbackText=""){
    const blocks=reportMediaBlocks(report);
    const usable=blocks.filter(block=>block?.kind==="text"||isImageBlock(block));

    if(!usable.length){
        return '<span class="report-structured-text">'+escapeHtml(fallbackText||"Nenhum texto final salvo neste relatório.")+'</span>';
    }

    currentReportMedia=new Map(
        usable
            .filter(isImageBlock)
            .map(block=>[block.id,block])
    );

    return usable.map(block=>{
        if(block?.kind==="text"){
            return '<span class="report-structured-text">'+escapeHtml(String(block.text||""))+'</span>';
        }

        const label=block.originalName||block.name||"Imagem do relatório";
        return '<button type="button" class="report-media-anchor" data-report-media-id="'+escapeHtml(block.id)+'" title="Abrir '+escapeHtml(label)+'">'+escapeHtml(label)+'</button>';
    }).join("");
}

function assistanceRichField(label,html){
    return '<div class="admin-assistance-field"><span>'+escapeHtml(label)+'</span><div class="admin-assistance-rich">'+html+'</div></div>';
}

async function mediaReadUrl(activityId,mediaId,variant="original"){
    if(!auth.currentUser)throw new Error("Sessão expirada. Entre novamente.");
    const token=await auth.currentUser.getIdToken();
    const response=await fetch(MEDIA_API_BASE+"/v1/media/read-url",{
        method:"POST",
        headers:{
            "Authorization":"Bearer "+token,
            "Content-Type":"application/json"
        },
        body:JSON.stringify({activityId,mediaId,variant})
    });

    let data=null;
    try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data?.error||"Não foi possível acessar a imagem.");
    if(!data?.url)throw new Error("URL da imagem não retornada.");
    return data.url;
}

async function openReportMedia(block){
    if(!selectedActivity||!block)return;

    const modal=$("#report-media-modal");
    const title=$("#report-media-viewer-title");
    const img=$("#report-media-viewer-image");
    const loading=$("#report-media-viewer-loading");
    const openLink=$("#report-media-viewer-open");

    title.textContent=block.originalName||block.name||"Imagem do relatório";
    img.hidden=true;
    img.removeAttribute("src");
    img.alt=block.originalName||block.name||"Imagem do relatório";
    loading.hidden=false;
    loading.textContent="Carregando imagem...";
    openLink.hidden=true;
    openLink.removeAttribute("href");
    openModal("report-media");

    try{
        const url=await mediaReadUrl(selectedActivity.id,block.id,"original");
        if(modal.hidden)return;

        img.onload=()=>{
            loading.hidden=true;
            img.hidden=false;
        };
        img.onerror=()=>{
            loading.hidden=false;
            loading.textContent="Não foi possível exibir esta imagem.";
        };
        img.src=url;
        openLink.href=url;
        openLink.hidden=false;
    }catch(error){
        loading.hidden=false;
        loading.textContent=error.message||"Não foi possível abrir a imagem.";
    }
}

function openReport(activity){
    selectedActivity=activity;
    const report=reportFor(activity);
    const type=activityType(activity);

    $("#report-type-label").textContent="RELATÓRIO • "+type.toUpperCase();
    $("#report-title").textContent=clientName(activity.clienteId);
    $("#report-document-subtitle").textContent=personName(activity.ptvId)+" • "+formatDateTime(activity.data);
    $("#report-document-status").textContent=activity.status||"—";
    $("#report-document-status").className="profile-status "+(activity.status==="Concluída"?"is-active":"");
    $("#report-summary-grid").innerHTML=[
        detailItem("Profissional",personName(activity.ptvId)),
        detailItem("Data da atividade",formatDateTime(activity.data)),
        detailItem("Tempo em campo",formatDuration(activityDuration(activity))),
        detailItem("Relatório",report?"Salvo":"Não disponível")
    ].join("");

    currentReportMedia=new Map();

    const standard=$("#report-standard-content");
    const assistance=$("#report-assistance-content");

    if(type==="Assistência técnica"){
        standard.hidden=true;
        assistance.hidden=false;
        assistance.innerHTML=report
            ?renderAssistanceReport(report)
            :'<div class="profile-empty">Nenhum relatório de assistência técnica encontrado.</div>';
    }else{
        standard.hidden=false;
        assistance.hidden=true;
        assistance.innerHTML="";
        $("#report-current-text").innerHTML=reportStructuredMarkup(
            report,
            report?.textoAtual||"Nenhum texto final salvo neste relatório."
        );

        const keys=type==="Treinamento"
            ?["categoriaTreinamento","quantidadeParticipantes","publicoAtendido","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"]
            :["objetivo","oportunidadeIdentificada","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"];
        $("#report-fields").innerHTML=keys.map(key=>detailItem(FIELD_LABELS[key]||key,reportValue(report,activity,key),["objetivo","oportunidadeIdentificada","resultado","motivoFechamentoManual"].includes(key))).join("");

        const history=Array.isArray(report?.historico)?report.historico:[];
        $("#report-history").innerHTML=history.length?history.map(historyText).join(""):'<div class="profile-empty">Nenhuma versão anterior registrada.</div>';
    }
    openModal("visit-report");
}

function printFieldGrid(items){
    return '<div class="field-grid">'+items.map(item=>
        '<div class="field '+(item.wide?"wide":"")+'"><span>'+escapeHtml(item.label)+'</span><strong>'+escapeHtml(item.value??"—")+'</strong></div>'
    ).join("")+'</div>';
}

function printTimeline(activity){
    return '<div class="timeline">'+[
        {label:"Check-in",date:activity.checkinDataHora,address:activity.checkinEndereco||activity.checkinGps||"Localização não registrada"},
        {label:"Checkout",date:activity.checkoutDataHora,address:activity.checkoutEndereco||activity.checkoutGps||"Localização não registrada"}
    ].map(item=>
        '<div class="timeline-item"><b>'+escapeHtml(item.label)+'</b><div><strong>'+escapeHtml(formatDateTime(item.date))+'</strong><small>'+escapeHtml(item.address)+'</small></div></div>'
    ).join("")+'</div>';
}

function exportVisitPdf(){
    if(!selectedActivity)return;
    const activity=selectedActivity;
    const report=reportFor(activity);
    const type=activityType(activity);

    printDocument({
        kicker:"Registro de visita • "+type,
        title:clientName(activity.clienteId),
        subtitle:personName(activity.ptvId),
        badge:activity.status||"—",
        meta:[
            {label:"Data",value:formatDateTime(activity.data)},
            {label:"Tempo em campo",value:formatDuration(activityDuration(activity))},
            {label:"Profissional",value:personName(activity.ptvId)},
            {label:"Relatório",value:report||activity.relatorioId?"Disponível":"Não disponível"}
        ],
        sections:[
            {
                eyebrow:"Atividade",
                title:"Informações registradas",
                html:printFieldGrid(visitDetailEntries(activity,report))
            },
            {
                eyebrow:"Campo",
                title:"Check-in e checkout",
                html:printTimeline(activity)
            },
            {
                eyebrow:"Observações",
                title:"Notas da atividade",
                html:'<div class="note">'+escapeHtml(activity.nota||"Nenhuma observação registrada.")+'</div>'
            }
        ]
    });
}

function reportPrintMarkup(report,fallbackText,mediaUrls){
    const blocks=reportMediaBlocks(report).filter(block=>block?.kind==="text"||isImageBlock(block));
    if(!blocks.length)return '<div class="prose">'+escapeHtml(fallbackText||"Nenhum texto registrado.")+'</div>';

    return blocks.map(block=>{
        if(block?.kind==="text"){
            const text=String(block.text||"").trim();
            return text?'<p class="report-block">'+escapeHtml(text)+'</p>':"";
        }
        const label=block.originalName||block.name||"Imagem do relatório";
        const url=mediaUrls.get(block.id);
        if(!url)return '<div class="field wide"><span>Imagem anexada</span><strong>'+escapeHtml(label)+'</strong></div>';
        return '<figure class="attachment"><img src="'+escapeHtml(url)+'" alt="'+escapeHtml(label)+'"><figcaption>'+escapeHtml(label)+'</figcaption></figure>';
    }).join("");
}

function assistancePrintSections(report,mediaUrls){
    const d=assistanceData(report);
    const specification=d.houveEspecificacao==="Sim"
        ?"Sim"+(d.numeroEspecificacao?" • "+d.numeroEspecificacao:"")
        :(d.houveEspecificacao||"Não informado");
    const climate=d.impactoClimatico==="Sim"
        ?"Sim"+(d.impactoClimaticoDetalhe?" • "+d.impactoClimaticoDetalhe:"")
        :(d.impactoClimatico||"Não informado");

    return[
        {
            eyebrow:"Cliente e aplicação",
            title:"Contexto do atendimento",
            html:printFieldGrid([
                {label:"Cliente final",value:d.clienteFinal||"Não informado"},
                {label:"Contato / setor",value:[d.contato,d.setor].filter(Boolean).join(" / ")||"Não informado"},
                {label:"Endereço de aplicação",value:d.enderecoAplicacao||"Não informado",wide:true},
                {label:"Empresa de aplicação",value:d.empresaAplicacao||"Não informado"},
                {label:"Responsável da empresa",value:d.responsavelEmpresa||"Não informado"},
                {label:"Acompanhado por",value:d.acompanhadoPor||"Não informado"},
                {label:"Equipamento / superfície",value:d.superficie||"Não informado"},
                {label:"Data da aplicação",value:d.dataAplicacao||"Não informado"},
                {label:"Especificação",value:specification}
            ])
        },
        {
            eyebrow:"Produto",
            title:"Produto e queixa",
            html:printFieldGrid([
                {label:"Produto",value:d.produto||"Não informado"},
                {label:"Lote",value:d.lote||"Não informado"},
                {label:"Cor",value:d.cor||"Não informado"},
                {label:"Queixa",value:d.queixa||"Não informado",wide:true},
                {label:"Esquema de pintura",value:d.esquemaPintura||"Não informado",wide:true}
            ])
        },
        {
            eyebrow:"Aplicação",
            title:"Preparo e condições",
            html:printFieldGrid([
                {label:"Preparo da superfície",value:d.preparoSuperficie||"Não informado",wide:true},
                {label:"Métodos de limpeza",value:Array.isArray(d.metodosLimpeza)?d.metodosLimpeza.join(", "):(d.metodosLimpeza||"Não informado"),wide:true},
                {label:"Impacto climático / intempéries",value:climate,wide:true},
                {label:"Ferramenta de aplicação",value:Array.isArray(d.ferramentasAplicacao)?d.ferramentasAplicacao.join(", "):(d.ferramentasAplicacao||"Não informado"),wide:true}
            ])
        },
        {
            eyebrow:"Verificação",
            title:"Relatório técnico",
            html:printFieldGrid([
                {label:"Itens verificados",value:Array.isArray(d.itensVerificados)?d.itensVerificados.join(", "):(d.itensVerificados||"Não informado")},
                {label:"Umidade medida",value:d.umidade||"Não informado"},
                {label:"Referência / limite",value:d.umidadeReferencia||"Não informado"}
            ])+reportPrintMarkup(report,d.constatacoes,mediaUrls)
        },
        {
            eyebrow:"Fechamento",
            title:"Conclusão e próximos passos",
            html:printFieldGrid([
                {label:"Ações definidas",value:d.acoesDefinidas||"Não informado",wide:true},
                {label:"Conclusão técnica",value:d.conclusaoTecnica||"Não informado",wide:true},
                {label:"Resultado da assistência",value:d.resultado||"Não informado"},
                {label:"Próximo passo",value:d.proximoPasso||"Não informado",wide:true}
            ])
        }
    ];
}

async function exportReportPdf(){
    if(!selectedActivity)return;
    const activity=selectedActivity;
    const report=reportFor(activity);
    const type=activityType(activity);
    const popup=preparePrintWindow("Preparando relatório");

    try{
        const imageBlocks=reportMediaBlocks(report).filter(isImageBlock);
        const mediaUrls=new Map();
        const results=await Promise.allSettled(imageBlocks.map(async block=>({
            id:block.id,
            url:await mediaReadUrl(activity.id,block.id,"original")
        })));
        results.forEach(result=>{
            if(result.status==="fulfilled")mediaUrls.set(result.value.id,result.value.url);
        });

        let sections=[];
        if(type==="Assistência técnica"){
            sections=assistancePrintSections(report,mediaUrls);
        }else{
            const keys=type==="Treinamento"
                ?["categoriaTreinamento","quantidadeParticipantes","publicoAtendido","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"]
                :["objetivo","oportunidadeIdentificada","resultado","checkinDataHora","checkinEndereco","checkoutDataHora","checkoutEndereco","fechamentoTipo","fechamentoAnaliseStatus","motivoFechamentoManual"];
            const history=Array.isArray(report?.historico)?report.historico:[];

            sections=[
                {
                    eyebrow:"Relatório final",
                    title:"Registro da atividade",
                    html:reportPrintMarkup(report,report?.textoAtual||"Nenhum texto final salvo neste relatório.",mediaUrls)
                },
                {
                    eyebrow:"Dados registrados",
                    title:"Informações complementares",
                    html:printFieldGrid(keys.map(key=>({label:FIELD_LABELS[key]||key,value:reportValue(report,activity,key),wide:["objetivo","oportunidadeIdentificada","resultado","motivoFechamentoManual"].includes(key)})))
                }
            ];

            if(history.length){
                sections.push({
                    eyebrow:"Histórico",
                    title:"Versões anteriores",
                    html:'<table><thead><tr><th>Versão</th><th>Data</th><th>Conteúdo</th></tr></thead><tbody>'+
                        history.map((entry,index)=>{
                            const text=typeof entry==="string"?entry:(entry?.texto||entry?.textoAtual||entry?.conteudo||entry?.relatorio||"");
                            const date=typeof entry==="object"?(entry?.salvoEm||entry?.data||entry?.criadoEm||entry?.atualizadoEm):null;
                            return '<tr><td>'+(index+1)+'</td><td>'+escapeHtml(date?formatDateTime(date):"—")+'</td><td>'+escapeHtml(text||"—")+'</td></tr>';
                        }).join("")+
                    '</tbody></table>'
                });
            }
        }

        printDocument({
            kicker:"Relatório • "+type,
            title:clientName(activity.clienteId),
            subtitle:personName(activity.ptvId)+" • "+formatDateTime(activity.data),
            badge:activity.status||"—",
            meta:[
                {label:"Profissional",value:personName(activity.ptvId)},
                {label:"Data",value:formatDateTime(activity.data)},
                {label:"Tempo em campo",value:formatDuration(activityDuration(activity))},
                {label:"Cliente",value:clientName(activity.clienteId)}
            ],
            sections
        },popup);
    }catch(error){
        popup.close();
        alert(error.message||"Não foi possível preparar o relatório para impressão.");
    }
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
    $("#commercial-visits-table").addEventListener("click",handleAction);
    $("#training-visits-table").addEventListener("click",handleAction);
    $("#assistance-visits-table").addEventListener("click",handleAction);
    document.querySelectorAll("[data-close-visit-modal]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.closeVisitModal)));
    $("#visit-export-pdf").addEventListener("click",exportVisitPdf);
    $("#report-export-pdf").addEventListener("click",exportReportPdf);
    $("#visit-open-report").addEventListener("click",()=>selectedActivity&&openReport(selectedActivity));
    $("#visit-open-client").addEventListener("click",()=>{if(selectedActivity?.clienteId)location.href="./clients.html?client="+encodeURIComponent(selectedActivity.clienteId)});
    $("#visit-open-professional").addEventListener("click",()=>{if(selectedActivity?.ptvId)location.href="./team.html?member="+encodeURIComponent(selectedActivity.ptvId)});
    $("#visit-report-modal").addEventListener("click",event=>{
        const button=event.target.closest("[data-report-media-id]");
        if(!button)return;
        const block=currentReportMedia.get(button.dataset.reportMediaId);
        if(block)openReportMedia(block);
    });
    document.addEventListener("keydown",event=>{
        if(event.key==="Escape"){
            closeModal("report-media");
            closeModal("visit-report");
            closeModal("visit-detail");
        }
    });
}
async function safeCollection(name){
    try{
        const snap=await getDocs(collection(db,name));
        return snap.docs.map(d=>({id:d.id,collection:name,...d.data()}));
    }catch(error){
        console.warn("[Visitas] Não foi possível ler "+name,error);
        return[];
    }
}
async function loadData(){
    const [acts,clientSnap,assistSnap,promoterSnap,...reportLists]=await Promise.all([
        getDocs(collection(db,"atividades")),
        getDocs(collection(db,"clientes")),
        getDocs(collection(db,"assistencia")),
        getDocs(collection(db,"promotores")),
        ...REPORT_COLLECTIONS.map(safeCollection)
    ]);
    activities=acts.docs.map(d=>({id:d.id,...d.data()}));
    clients=new Map(clientSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    professionals=new Map([...assistSnap.docs,...promoterSnap.docs].map(d=>[d.id,{id:d.id,...d.data()}]));

    reportsByActivity=new Map();
    reportsByKey=new Map();
    reportLists.flat().forEach(report=>{
        reportsByKey.set(report.collection+":"+report.id,report);
        if(report.atividadeId)reportsByActivity.set(report.atividadeId,report);
    });
    renderAll();

    const params=new URLSearchParams(location.search);
    const activityId=params.get("activity");
    if(activityId){
        const activity=findActivity(activityId);
        if(activity){
            selectTab(typeKey(activity));
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
        $("#commercial-visits-table").innerHTML='<tr><td colspan="8" class="empty-row">Não foi possível carregar as visitas.</td></tr>';
        $("#training-visits-table").innerHTML='<tr><td colspan="9" class="empty-row">Não foi possível carregar os treinamentos.</td></tr>';
        $("#assistance-visits-table").innerHTML='<tr><td colspan="9" class="empty-row">Não foi possível carregar as assistências técnicas.</td></tr>';
    }
})();