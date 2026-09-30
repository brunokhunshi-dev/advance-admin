import { createScenario, scenarioSummary } from "./populator.js";
import { printDocument } from "../print-document.js";

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=value=>value?new Date(value):null;
const fmtDate=value=>{const d=date(value);return d&&Number.isFinite(d.getTime())?d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"};
const fmtDuration=min=>Number.isFinite(min)?(min<60?Math.round(min)+"min":Math.floor(min/60)+"h "+Math.round(min%60)+"min"):"—";
const initials=name=>String(name||"").trim().split(/\s+/).filter(Boolean).map(x=>x[0]).filter(Boolean).slice(0,2).join("").toUpperCase()||"—";

let scenario=null;
let filtered=[];
let map=null;
let mapLayers=[];
let currentMapMode="points";

function professional(id){return scenario.professionals.find(p=>p.id===id)}
function client(id){return scenario.clients.find(c=>c.id===id)}
function duration(v){
  if(!v.checkinDataHora||!v.checkoutDataHora)return null;
  return Math.max(0,(new Date(v.checkoutDataHora)-new Date(v.checkinDataHora))/60000);
}
function statsForProfessional(p){
  const list=scenario.visits.filter(v=>v.ptvId===p.id);
  const done=list.filter(v=>v.status==="Concluída");
  const durations=done.map(duration).filter(Number.isFinite);
  return{
    list,total:list.length,done:done.length,
    rate:list.length?done.length/list.length*100:0,
    avg:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,
    clients:new Set(list.map(v=>v.clienteId)).size,
    last:list.slice().sort((a,b)=>new Date(b.data)-new Date(a.data))[0]
  };
}
function statsForClient(c){
  const list=scenario.visits.filter(v=>v.clienteId===c.id).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const done=list.filter(v=>v.status==="Concluída");
  const durations=done.map(duration).filter(Number.isFinite);
  return{
    list,total:list.length,done:done.length,
    avg:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,
    professionals:new Set(list.map(v=>v.ptvId)).size,last:list[0]
  };
}
function statusHtml(status){
  const cls=status==="Concluída"?"done":status==="Em andamento"?"progress":status==="Pendente"?"pending":"cancelled";
  return '<span class="demo-status '+cls+'">'+esc(status||"—")+'</span>';
}

function populateFilters(){
  $("#filter-professional").innerHTML='<option value="">Todos</option>'+scenario.professionals.map(p=>'<option value="'+p.id+'">'+esc(p.nome)+'</option>').join("");
  $("#filter-client").innerHTML='<option value="">Todos</option>'+scenario.clients.slice().sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR")).map(c=>'<option value="'+c.id+'">'+esc(c.nome)+'</option>').join("");
}
function applyDashboardFilters(){
  const pid=$("#filter-professional").value;
  const status=$("#filter-status").value;
  const type=$("#filter-type").value;
  const cid=$("#filter-client").value;
  filtered=scenario.visits.filter(v=>
    (!pid||v.ptvId===pid)&&(!status||v.status===status)&&(!type||v.tipoVisita===type)&&(!cid||v.clienteId===cid)
  );
  renderDashboard();
}
function renderMetrics(){
  const total=filtered.length;
  const done=filtered.filter(v=>v.status==="Concluída").length;
  const progress=filtered.filter(v=>v.status==="Em andamento").length;
  const pending=filtered.filter(v=>v.status==="Pendente").length;
  const trainings=filtered.filter(v=>v.tipoVisita==="Treinamento").length;
  const assist=filtered.filter(v=>v.tipoVisita==="Assistência técnica").length;
  const durations=filtered.map(duration).filter(Number.isFinite);
  const avg=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null;
  $("#metric-total").textContent=total;
  $("#metric-total-sub").textContent=new Set(filtered.map(v=>v.clienteId)).size+" clientes";
  $("#metric-completed").textContent=done;
  $("#metric-completed-sub").textContent=total?Math.round(done/total*100)+"% de conclusão":"Sem dados";
  $("#metric-progress").textContent=progress;
  $("#metric-progress-sub").textContent=progress?"operação ativa":"nenhuma aberta";
  $("#metric-pending").textContent=pending;
  $("#metric-pending-sub").textContent=pending?"visitas agendadas":"sem pendências";
  $("#metric-training").textContent=trainings+" / "+assist;
  $("#metric-duration").textContent=fmtDuration(avg);
  $("#metric-duration-sub").textContent=durations.length+" concluídas com duração";
}
function setupCanvas(id){
  const canvas=$("#"+id),ratio=window.devicePixelRatio||1,w=canvas.clientWidth||600,h=canvas.clientHeight||260;
  canvas.width=w*ratio;canvas.height=h*ratio;
  const ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  return{ctx,w,h};
}
function weeklySeries(){
  const buckets=new Map();
  filtered.forEach(v=>{
    const d=new Date(v.data);
    const monday=new Date(d);
    const day=(monday.getDay()+6)%7;
    monday.setDate(monday.getDate()-day);monday.setHours(0,0,0,0);
    const k=monday.toISOString().slice(0,10);
    buckets.set(k,(buckets.get(k)||0)+1);
  });
  return[...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12).map(([key,value])=>({label:key.slice(8,10)+"/"+key.slice(5,7),value}));
}
function drawLine(){
  const {ctx,w,h}=setupCanvas("chart-daily"),data=weeklySeries();
  const left=36,right=14,top=20,bottom=28,max=Math.max(1,...data.map(x=>x.value));
  ctx.font="10px Outfit";ctx.fillStyle="#8a8a92";
  for(let i=0;i<=4;i++){const y=h-bottom-(h-top-bottom)*i/4;ctx.strokeStyle="#ececef";ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText(String(Math.round(max*i/4)),5,y+3)}
  if(!data.length)return;
  const pts=data.map((x,i)=>({x:left+(w-left-right)*(data.length===1?.5:i/(data.length-1)),y:h-bottom-(h-top-bottom)*(x.value/max),label:x.label,value:x.value}));
  ctx.strokeStyle="#040438";ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  pts.forEach((p,i)=>{ctx.fillStyle="#f51e30";ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();if(i%2===0||data.length<8){ctx.fillStyle="#8a8a92";ctx.fillText(p.label,p.x-12,h-8)}});
}
function drawDonut(){
  const {ctx,w,h}=setupCanvas("chart-status");
  const statuses=["Pendente","Em andamento","Concluída","Cancelada"],colors=["#d89a00","#18378a","#22a928","#777780"];
  const values=statuses.map(s=>filtered.filter(v=>v.status===s).length),total=values.reduce((a,b)=>a+b,0);
  const cx=w/2,cy=h/2,r=Math.min(w,h)*.28;
  let angle=-Math.PI/2;
  values.forEach((value,i)=>{const slice=total?(value/total)*Math.PI*2:0;ctx.strokeStyle=colors[i];ctx.lineWidth=30;ctx.beginPath();ctx.arc(cx,cy,r,angle,angle+slice);ctx.stroke();angle+=slice});
  ctx.fillStyle="#040438";ctx.font="700 24px Outfit";ctx.textAlign="center";ctx.fillText(String(total),cx,cy+6);ctx.font="10px Outfit";ctx.fillStyle="#8a8a92";ctx.fillText("atividades",cx,cy+23);ctx.textAlign="start";
  $("#status-legend").innerHTML=statuses.map((s,i)=>'<div class="legend-item"><span class="legend-dot" style="background:'+colors[i]+'"></span><span>'+s+'</span><strong>'+values[i]+'</strong></div>').join("");
}
function drawBars(){
  const {ctx,w,h}=setupCanvas("chart-professionals");
  const items=scenario.professionals.map(p=>({p,value:filtered.filter(v=>v.ptvId===p.id).length})).sort((a,b)=>b.value-a.value).slice(0,9);
  const max=Math.max(1,...items.map(x=>x.value));
  ctx.font="10px Outfit";
  items.forEach((item,i)=>{
    const y=22+i*((h-36)/Math.max(items.length,1)),bar=(w-180)*(item.value/max);
    ctx.fillStyle="#4a4a55";ctx.fillText(item.p.nome.split(" ")[0],0,y+4);
    ctx.fillStyle="#040438";ctx.fillRect(90,y-8,Math.max(2,bar),16);
    ctx.fillStyle="#040438";ctx.font="700 10px Outfit";ctx.fillText(String(item.value),96+bar,y+4);ctx.font="10px Outfit";
  });
}
function renderRanking(){
  const rows=scenario.professionals.map(p=>({p,s:statsForProfessional(p)}))
    .filter(x=>!$("#filter-professional").value||x.p.id===$("#filter-professional").value)
    .sort((a,b)=>b.s.done-a.s.done||b.s.total-a.s.total);
  $("#ranking-table").innerHTML=rows.map((x,i)=>'<tr data-person="'+x.p.id+'"><td><span class="rank-number">'+(i+1)+'</span>'+esc(x.p.nome)+'</td><td>'+esc(x.p.collection==="promotores"?"Promotoria":"Assistência")+'</td><td>'+x.s.total+'</td><td>'+x.s.done+'</td><td>'+Math.round(x.s.rate)+'%</td><td>'+fmtDuration(x.s.avg)+'</td></tr>').join("");
}
function ensureMap(){
  if(map||!window.L)return;
  map=L.map("demo-map",{zoomControl:true,preferCanvas:true}).setView([-23.1,-47.2],9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"&copy; OpenStreetMap"}).addTo(map);
}
function renderMap(){
  ensureMap();if(!map)return;
  mapLayers.forEach(x=>x.remove());mapLayers=[];
  const points=filtered.filter(v=>v.checkinGps).map(v=>{const [lat,lng]=v.checkinGps.split(",").map(Number);return{v,lat,lng}}).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).slice(0,220);
  $("#map-count").textContent=points.length+" atividades localizadas na amostra.";
  if(currentMapMode==="routes"){
    const grouped=new Map();
    points.forEach(p=>{if(!grouped.has(p.v.ptvId))grouped.set(p.v.ptvId,[]);grouped.get(p.v.ptvId).push(p)});
    grouped.forEach(items=>{
      items.sort((a,b)=>new Date(a.v.data)-new Date(b.v.data));
      if(items.length<2)return;
      const line=L.polyline(items.map(x=>[x.lat,x.lng]),{color:"#040438",weight:2,opacity:.55}).addTo(map);mapLayers.push(line);
    });
  }
  points.forEach(p=>{
    const marker=L.circleMarker([p.lat,p.lng],{radius:5,color:"#ffffff",weight:2,fillColor:p.v.status==="Em andamento"?"#f51e30":"#040438",fillOpacity:.9}).addTo(map);
    marker.bindPopup('<strong>'+esc(client(p.v.clienteId)?.nome)+'</strong><br>'+esc(professional(p.v.ptvId)?.nome)+'<br>'+fmtDate(p.v.data));
    mapLayers.push(marker);
  });
  if(points.length)map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng])),{padding:[28,28],maxZoom:11});
}
function renderDashboard(){
  renderMetrics();drawLine();drawDonut();drawBars();renderRanking();renderMap();
}
function renderTeam(){
  const card=p=>{
    const s=statsForProfessional(p);
    return '<article class="demo-person-card" data-open-person="'+p.id+'"><div class="demo-person-main"><span class="demo-avatar">'+initials(p.nome)+'</span><div><strong>'+esc(p.nome)+'</strong><small>'+esc(p.cargo)+'</small></div></div><div class="demo-mini-kpi"><span>Visitas</span><strong>'+s.total+'</strong></div><div class="demo-mini-kpi"><span>Concluídas</span><strong>'+s.done+'</strong></div><div class="demo-mini-kpi"><span>Média</span><strong>'+fmtDuration(s.avg)+'</strong></div><span class="demo-score">'+Math.round(s.rate)+'%</span></article>';
  };
  $("#demo-promoters").innerHTML=scenario.professionals.filter(p=>p.collection==="promotores").map(card).join("");
  $("#demo-assistants").innerHTML=scenario.professionals.filter(p=>p.collection==="assistencia").map(card).join("");
}
function renderClients(){
  const term=$("#client-search").value.trim().toLowerCase();
  const rows=scenario.clients.filter(c=>!term||[c.nome,c.cnpjFormatado,c.cidade].some(v=>String(v).toLowerCase().includes(term))).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
  $("#clients-table").innerHTML=rows.map(c=>{
    const s=statsForClient(c);
    return '<tr><td><strong>'+esc(c.nome)+'</strong><br><small>'+esc(c.enderecoCompleto)+'</small></td><td>'+esc(c.cnpjFormatado)+'</td><td>'+esc(c.importancia)+'</td><td>'+statusHtml(c.status==="Ativo"?"Concluída":"Cancelada").replace("Concluída","Ativo").replace("Cancelada","Inativo")+'</td><td>'+s.total+'</td><td>'+fmtDate(s.last?.data)+'</td><td>'+esc(c.cidade+"/"+c.uf)+'</td><td><button class="demo-row-button" data-open-client="'+c.id+'">Ver perfil</button></td></tr>';
  }).join("");
}
function renderVisits(){
  const type=$("#visits-type").value,status=$("#visits-status").value;
  const rows=scenario.visits.filter(v=>(!type||v.tipoVisita===type)&&(!status||v.status===status)).slice(0,180);
  $("#visits-table").innerHTML=rows.map(v=>'<tr><td><strong>'+esc(client(v.clienteId)?.nome)+'</strong></td><td>'+esc(professional(v.ptvId)?.nome)+'</td><td>'+fmtDate(v.data)+'</td><td>'+esc(v.tipoVisita)+'</td><td>'+statusHtml(v.status)+'</td><td>'+fmtDuration(duration(v))+'</td><td>'+esc(v.resultado||v.report?.resultado||"—")+'</td><td><button class="demo-row-button" data-open-visit="'+v.id+'">Abrir</button></td></tr>').join("");
}
function showView(name){
  $$(".demo-view").forEach(v=>v.hidden=v.id!=="view-"+name);
  $$(".demo-sidebar [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("#view-title").textContent={dashboard:"Dashboard populado",team:"Equipe populada",clients:"Clientes populados",visits:"Visitas populadas"}[name];
  if(name==="dashboard")setTimeout(()=>{drawLine();drawDonut();drawBars();if(map)map.invalidateSize();renderMap()},0);
}
function openModal(html){
  $("#demo-modal-content").innerHTML=html;$("#demo-modal").hidden=false;document.body.classList.add("modal-open");
}
function closeModal(){$("#demo-modal").hidden=true;document.body.classList.remove("modal-open")}
function personModal(id){
  const p=professional(id),s=statsForProfessional(p);
  const recent=s.list.slice().sort((a,b)=>new Date(b.data)-new Date(a.data)).slice(0,8);
  openModal('<header class="demo-modal-hero"><div><span class="eyebrow">'+(p.collection==="promotores"?"PROMOTORIA":"ASSISTÊNCIA")+'</span><h2>'+esc(p.nome)+'</h2><p>'+esc(p.cargo)+' • '+esc(p.email)+'</p></div><span class="profile-status is-active">Ativo</span></header><div class="demo-modal-body"><div class="demo-kpi-strip"><div><span>Visitas</span><strong>'+s.total+'</strong></div><div><span>Concluídas</span><strong>'+s.done+'</strong></div><div><span>Conclusão</span><strong>'+Math.round(s.rate)+'%</strong></div><div><span>Clientes</span><strong>'+s.clients+'</strong></div></div><section class="demo-modal-section"><span class="eyebrow">HISTÓRICO</span><h3>Atividades recentes</h3><table class="demo-modal-table"><thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Status</th></tr></thead><tbody>'+recent.map(v=>'<tr><td>'+fmtDate(v.data)+'</td><td>'+esc(client(v.clienteId)?.nome)+'</td><td>'+esc(v.tipoVisita)+'</td><td>'+esc(v.status)+'</td></tr>').join("")+'</tbody></table></section><footer class="profile-actions"><button class="secondary-button" data-print-person="'+p.id+'" type="button">Exportar PDF</button><button class="primary-button compact" data-close-demo-modal type="button">Fechar</button></footer></div>');
}
function clientModal(id){
  const c=client(id),s=statsForClient(c),recent=s.list.slice(0,8);
  openModal('<header class="demo-modal-hero"><div><span class="eyebrow">CLIENTE FICTÍCIO</span><h2>'+esc(c.nome)+'</h2><p>'+esc(c.enderecoCompleto)+'</p></div><span class="importance-badge">'+esc(c.importancia)+'</span></header><div class="demo-modal-body"><div class="demo-modal-grid"><div><span>CNPJ fictício</span><strong>'+esc(c.cnpjFormatado)+'</strong></div><div><span>Cidade</span><strong>'+esc(c.cidade+"/"+c.uf)+'</strong></div><div><span>Status</span><strong>'+esc(c.status)+'</strong></div><div><span>Visitas</span><strong>'+s.total+'</strong></div><div><span>Concluídas</span><strong>'+s.done+'</strong></div><div><span>Profissionais</span><strong>'+s.professionals+'</strong></div></div><section class="demo-modal-section"><span class="eyebrow">HISTÓRICO</span><h3>Últimas visitas</h3><table class="demo-modal-table"><tbody>'+recent.map(v=>'<tr><td>'+fmtDate(v.data)+'</td><td>'+esc(v.tipoVisita)+'</td><td>'+esc(professional(v.ptvId)?.nome)+'</td><td>'+esc(v.status)+'</td></tr>').join("")+'</tbody></table></section><footer class="profile-actions"><button class="secondary-button" data-print-client="'+c.id+'" type="button">Exportar PDF</button><button class="primary-button compact" data-close-demo-modal type="button">Fechar</button></footer></div>');
}
function visitModal(id){
  const v=scenario.visits.find(x=>x.id===id),c=client(v.clienteId),p=professional(v.ptvId);
  const details=v.tipoVisita==="Assistência técnica"
    ?[["Produto",v.report?.produto||"—"],["Resultado",v.report?.resultado||v.resultado||"—"],["Queixa",v.report?.queixa||"—"],["Próximo passo",v.report?.proximoPasso||"—"]]
    :v.tipoVisita==="Treinamento"
    ?[["Categoria",v.categoriaTreinamento||"—"],["Participantes",v.quantidadeParticipantes||"—"],["Público",v.publicoAtendido||"—"],["Resultado",v.resultado||"—"]]
    :[["Objetivo",v.objetivo||"—"],["Oportunidade",v.oportunidadeIdentificada||"—"],["Resultado",v.resultado||"—"],["Observação",v.nota||"—"]];
  openModal('<header class="demo-modal-hero"><div><span class="eyebrow">'+esc(v.tipoVisita.toUpperCase())+'</span><h2>'+esc(c.nome)+'</h2><p>'+esc(p.nome)+' • '+fmtDate(v.data)+'</p></div>'+statusHtml(v.status)+'</header><div class="demo-modal-body"><div class="demo-modal-grid">'+details.map(x=>'<div><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join("")+'<div><span>Duração</span><strong>'+fmtDuration(duration(v))+'</strong></div><div><span>Check-in</span><strong>'+fmtDate(v.checkinDataHora)+'</strong></div></div>'+(v.report?'<section class="demo-modal-section"><span class="eyebrow">RELATÓRIO</span><h3>Registro da atividade</h3><div class="demo-report-copy">'+esc(v.report.textoAtual)+'</div></section>':'')+'<footer class="profile-actions"><button class="secondary-button" data-print-visit="'+v.id+'" type="button">Exportar PDF</button><button class="primary-button compact" data-close-demo-modal type="button">Fechar</button></footer></div>');
}
function printPerson(id){
  const p=professional(id),s=statsForProfessional(p);
  printDocument({kicker:"Simulação • Perfil profissional",title:p.nome,subtitle:p.cargo,badge:"DADOS FICTÍCIOS",meta:[{label:"Equipe",value:p.collection==="promotores"?"Promotoria":"Assistência"},{label:"Visitas",value:s.total},{label:"Concluídas",value:s.done},{label:"Conclusão",value:Math.round(s.rate)+"%"}],sections:[{eyebrow:"Resumo",title:"Indicadores simulados",html:'<div class="field-grid"><div class="field"><span>Duração média</span><strong>'+fmtDuration(s.avg)+'</strong></div><div class="field"><span>Clientes atendidos</span><strong>'+s.clients+'</strong></div><div class="field wide"><span>Observação</span><strong>Documento gerado exclusivamente a partir do ambiente fictício da simulação.</strong></div></div>'}]});
}
function printClient(id){
  const c=client(id),s=statsForClient(c);
  printDocument({kicker:"Simulação • Cliente fictício",title:c.nome,subtitle:c.enderecoCompleto,badge:"DADOS FICTÍCIOS",meta:[{label:"CNPJ fictício",value:c.cnpjFormatado},{label:"Cidade",value:c.cidade+"/"+c.uf},{label:"Visitas",value:s.total},{label:"Profissionais",value:s.professionals}],sections:[{eyebrow:"Cadastro",title:"Resumo simulado",html:'<div class="field-grid"><div class="field"><span>Importância</span><strong>'+esc(c.importancia)+'</strong></div><div class="field"><span>Status</span><strong>'+esc(c.status)+'</strong></div></div>'}]});
}
function printVisit(id){
  const v=scenario.visits.find(x=>x.id===id),c=client(v.clienteId),p=professional(v.ptvId);
  printDocument({kicker:"Simulação • "+v.tipoVisita,title:c.nome,subtitle:p.nome,badge:"DADOS FICTÍCIOS",meta:[{label:"Data",value:fmtDate(v.data)},{label:"Status",value:v.status},{label:"Duração",value:fmtDuration(duration(v))},{label:"Profissional",value:p.nome}],sections:[{eyebrow:"Atividade",title:"Registro simulado",html:'<div class="note">'+esc(v.report?.textoAtual||v.nota||"Visita gerada pelo populador de dados.")+'</div>'}]});
}
function exportJson(){
  const blob=new Blob([JSON.stringify(scenario,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="advance-demo-"+scenario.meta.seed+".json";a.click();URL.revokeObjectURL(url);
}
function exportCsv(){
  const rows=[["ID","Data","Cliente","Profissional","Tipo","Status","Duracao"]].concat(filtered.map(v=>[v.id,fmtDate(v.data),client(v.clienteId)?.nome,professional(v.ptvId)?.nome,v.tipoVisita,v.status,fmtDuration(duration(v))]));
  const csv=rows.map(row=>row.map(x=>'"'+String(x??"").replace(/"/g,'""')+'"').join(";")).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="advance-demo-dashboard.csv";a.click();URL.revokeObjectURL(url);
}
function generate(){
  scenario=createScenario($("#demo-seed").value.trim()||"ADVANCE-DEMO-2026",{visits:Number($("#demo-volume").value)});
  filtered=[...scenario.visits];
  const summary=scenarioSummary(scenario);
  $("#scenario-meta").textContent=summary.promoters+" promotores • "+summary.assistants+" assistentes • "+summary.clients+" clientes • "+summary.visits+" visitas";
  populateFilters();renderDashboard();renderTeam();renderClients();renderVisits();
  localStorage.setItem("advanceDemoSeed",scenario.meta.seed);
}
function bind(){
  $$(".demo-sidebar [data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("#generate-data").addEventListener("click",generate);
  $("#export-json").addEventListener("click",exportJson);
  $("#filters-form").addEventListener("submit",e=>{e.preventDefault();applyDashboardFilters()});
  $("#clear-filters").addEventListener("click",()=>{["filter-professional","filter-status","filter-type","filter-client"].forEach(id=>$("#"+id).value="");applyDashboardFilters()});
  $("#export-csv").addEventListener("click",exportCsv);
  $("#client-search").addEventListener("input",renderClients);
  $("#visits-type").addEventListener("change",renderVisits);
  $("#visits-status").addEventListener("change",renderVisits);
  $$("[data-map-mode]").forEach(b=>b.addEventListener("click",()=>{currentMapMode=b.dataset.mapMode;$$("[data-map-mode]").forEach(x=>x.classList.toggle("active",x===b));renderMap()}));
  document.addEventListener("click",e=>{
    const personBtn=e.target.closest("[data-open-person]");if(personBtn)return personModal(personBtn.dataset.openPerson);
    const clientBtn=e.target.closest("[data-open-client]");if(clientBtn)return clientModal(clientBtn.dataset.openClient);
    const visitBtn=e.target.closest("[data-open-visit]");if(visitBtn)return visitModal(visitBtn.dataset.openVisit);
    const printP=e.target.closest("[data-print-person]");if(printP)return printPerson(printP.dataset.printPerson);
    const printC=e.target.closest("[data-print-client]");if(printC)return printClient(printC.dataset.printClient);
    const printV=e.target.closest("[data-print-visit]");if(printV)return printVisit(printV.dataset.printVisit);
    if(e.target.closest("[data-close-demo-modal]"))closeModal();
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
  window.addEventListener("resize",()=>{if(!$("#view-dashboard").hidden){drawLine();drawDonut();drawBars();if(map)map.invalidateSize()}});
}

$("#demo-seed").value=localStorage.getItem("advanceDemoSeed")||"ADVANCE-DEMO-2026";
bind();
generate();
