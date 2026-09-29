import {
    $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml, asDate,
    formatDuration, formatDateTime, parseGps, normalizeVisitType
} from "./core.js";

let allActivities = [];
let allClients = [];
let professionals = new Map();
let filteredActivities = [];
let map = null;
let mapLayers = [];
let chartInstances = {};
let mapPoints = [];

const statusOptions = ["Pendente", "Em andamento", "Concluída", "Cancelada"];

function activityTypeLabel(activity) {
    return normalizeVisitType(activity);
}

function activityPersonName(activity) {
    return professionals.get(activity.ptvId)?.nome || activity.ptvId || "Não identificado";
}

async function loadData() {
    const [activitiesSnap, clientsSnap, assistSnap, promotersSnap] = await Promise.all([
        getDocs(collection(db, "atividades")),
        getDocs(collection(db, "clientes")),
        getDocs(collection(db, "assistencia")),
        getDocs(collection(db, "promotores"))
    ]);

    allActivities = activitiesSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    allClients = clientsSnap.docs.map(d => ({ id:d.id, ...d.data() }));

    professionals = new Map();
    assistSnap.docs.forEach(d => {
        const data = d.data() || {};
        professionals.set(d.id, { id:d.id, ...data, cargo:data.cargo || data.funcao || "Assistente Técnico" });
    });
    promotersSnap.docs.forEach(d => {
        const data = d.data() || {};
        professionals.set(d.id, { id:d.id, ...data, cargo:data.cargo || data.funcao || "Promotor Técnico" });
    });

    populateFilters();
    applyFilters();
}

function populateFilters() {
    const personSelect = $("#filter-professional");
    const clientSelect = $("#filter-client");

    const people = [...professionals.values()].sort((a,b) => String(a.nome||"").localeCompare(String(b.nome||""), "pt-BR"));
    personSelect.innerHTML = '<option value="">Todos os profissionais</option>' +
        people.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.nome || p.email || p.id) + " — " + escapeHtml(p.cargo || p.funcao || "Profissional") + "</option>").join("");

    const clients = [...allClients].sort((a,b) => String(a.nome||"").localeCompare(String(b.nome||""), "pt-BR"));
    clientSelect.innerHTML = '<option value="">Todos os clientes</option>' +
        clients.map(c => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nome || c.id) + "</option>").join("");
}

function activityPasses(activity) {
    const start = $("#filter-start").value ? new Date($("#filter-start").value + "T00:00:00") : null;
    const end = $("#filter-end").value ? new Date($("#filter-end").value + "T23:59:59") : null;
    const date = asDate(activity.data);
    const person = $("#filter-professional").value;
    const status = $("#filter-status").value;
    const type = $("#filter-type").value;
    const client = $("#filter-client").value;

    if (start && (!date || date < start)) return false;
    if (end && (!date || date > end)) return false;
    if (person && activity.ptvId !== person) return false;
    if (status && activity.status !== status) return false;
    if (client && activity.clienteId !== client) return false;
    const activityType = activityTypeLabel(activity);
    if (type === "commercial" && activityType !== "Visita comercial") return false;
    if (type === "training" && activityType !== "Treinamento") return false;
    if (type === "assistance" && activityType !== "Assistência técnica") return false;
    return true;
}

function applyFilters() {
    filteredActivities = allActivities.filter(activityPasses).sort((a,b) => (asDate(b.data)?.getTime() || 0) - (asDate(a.data)?.getTime() || 0));
    renderMetrics();
    renderDailyChart();
    renderStatusChart();
    renderProfessionalChart();
    renderMap();
    renderRanking();
}

function getClientName(id) {
    return allClients.find(c => c.id === id)?.nome || "Cliente não encontrado";
}

function getCompletedDurations(items) {
    return items.map(item => {
        const start = asDate(item.checkinDataHora);
        const end = asDate(item.checkoutDataHora);
        return start && end ? (end - start) / 60000 : null;
    }).filter(value => Number.isFinite(value) && value >= 0);
}

function renderMetrics() {
    const total = filteredActivities.length;
    const completed = filteredActivities.filter(a => a.status === "Concluída").length;
    const progress = filteredActivities.filter(a => a.status === "Em andamento").length;
    const pending = filteredActivities.filter(a => a.status === "Pendente").length;
    const trainings = filteredActivities.filter(a => activityTypeLabel(a) === "Treinamento").length;
    const assistances = filteredActivities.filter(a => activityTypeLabel(a) === "Assistência técnica").length;
    const clients = new Set(filteredActivities.map(a => a.clienteId).filter(Boolean)).size;
    const durations = getCompletedDurations(filteredActivities);
    const avg = durations.length ? durations.reduce((sum,v) => sum+v,0) / durations.length : null;

    $("#metric-total").textContent = total;
    $("#metric-total-sub").textContent = clients + (clients === 1 ? " cliente" : " clientes");
    $("#metric-completed").textContent = completed;
    $("#metric-completed-sub").textContent = total ? Math.round(completed / total * 100) + "% de conclusão" : "Sem atividades";
    $("#metric-progress").textContent = progress;
    $("#metric-progress-sub").textContent = progress ? "Visitas abertas" : "Nenhuma visita aberta";
    $("#metric-pending").textContent = pending;
    $("#metric-pending-sub").textContent = pending ? "Visitas agendadas" : "Nenhuma visita pendente";
    $("#metric-training").textContent = trainings + " / " + assistances;
    $("#metric-training-sub").textContent = "treinamentos / assistências";
    $("#metric-duration").textContent = avg == null ? "—" : formatDuration(avg);
    $("#metric-duration-sub").textContent = durations.length + (durations.length === 1 ? " visita concluída" : " visitas concluídas");
}

function destroyChart(name) {
    const canvas = document.getElementById(name);
    const ctx = canvas.getContext("2d");
    const previous = chartInstances[name];
    if (previous) cancelAnimationFrame(previous.animation);
    ctx.clearRect(0,0,canvas.width,canvas.height);
}

function setupCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 260;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio,0,0,ratio,0,0);
    return { ctx, width, height };
}

function drawLineChart(canvasId, labels, values) {
    const canvas = document.getElementById(canvasId);
    const {ctx,width,height} = setupCanvas(canvas);
    ctx.clearRect(0,0,width,height);
    const left=42, right=18, top=18, bottom=34;
    const max=Math.max(1,...values);
    ctx.font="12px Outfit, sans-serif";
    ctx.fillStyle="#8A8A92";
    for(let i=0;i<=4;i++){
        const value=Math.round(max*i/4);
        const y=height-bottom-(height-top-bottom)*i/4;
        ctx.fillText(String(value),8,y+4);
        ctx.strokeStyle="#ECECEF"; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(left,y+.5); ctx.lineTo(width-right,y+.5); ctx.stroke();
    }
    if(!values.length) return;
    const points=values.map((v,i)=>({
        x: values.length===1 ? (width+left-right)/2 : left + (width-left-right)*i/(values.length-1),
        y: height-bottom-(height-top-bottom)*(v/max)
    }));
    ctx.strokeStyle="#040438"; ctx.lineWidth=2; ctx.beginPath();
    points.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }); ctx.stroke();
    points.forEach(p=>{ctx.fillStyle="#F51E30";ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle="#8A8A92";
    labels.forEach((label,i)=>{
        const p=points[i];
        ctx.fillText(label,p.x-14,height-10);
    });
}

function drawDonutChart(canvasId, values, colors) {
    const canvas=document.getElementById(canvasId), {ctx,width,height}=setupCanvas(canvas);
    ctx.clearRect(0,0,width,height);
    const total=values.reduce((a,b)=>a+b,0);
    const cx=width/2, cy=height/2, radius=Math.min(width,height)*.32;
    if(!total){ctx.strokeStyle="#E7E7EB";ctx.lineWidth=34;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#8A8A92";ctx.font="13px Outfit";ctx.textAlign="center";ctx.fillText("Sem dados",cx,cy+4);ctx.textAlign="start";return;}
    let angle=-Math.PI/2;
    values.forEach((value,i)=>{
        const slice=(value/total)*Math.PI*2;
        ctx.strokeStyle=colors[i]; ctx.lineWidth=34; ctx.beginPath();ctx.arc(cx,cy,radius,angle,angle+slice);ctx.stroke();
        angle+=slice;
    });
    ctx.fillStyle="#040438";ctx.font="700 24px Outfit";ctx.textAlign="center";ctx.fillText(String(total),cx,cy+8);
    ctx.font="12px Outfit";ctx.fillStyle="#8A8A92";ctx.fillText("atividades",cx,cy+28);ctx.textAlign="start";
}

function drawBarChart(canvasId, items) {
    const canvas=document.getElementById(canvasId), {ctx,width,height}=setupCanvas(canvas);
    ctx.clearRect(0,0,width,height);
    const rows=items.slice(0,8), max=Math.max(1,...rows.map(x=>x.value));
    ctx.font="12px Outfit";
    rows.forEach((row,i)=>{
        const y=25+i*((height-45)/Math.max(rows.length,1));
        const barW=(width-180)*(row.value/max);
        ctx.fillStyle="#040438"; ctx.fillRect(155,y-9,Math.max(2,barW),18);
        ctx.fillStyle="#4B4B55";ctx.fillText(row.label,0,y+4);
        ctx.fillStyle="#040438";ctx.font="700 12px Outfit";ctx.fillText(String(row.value),160+barW,y+4);
        ctx.font="12px Outfit";
    });
}

function renderDailyChart() {
    const dates=[...new Set(filteredActivities.map(a=>asDate(a.data)).filter(Boolean).map(d=>d.toISOString().slice(0,10)))].sort();
    const labels=dates.map(d=>{const [y,m,day]=d.split("-");return day+"/"+m;});
    const values=dates.map(d=>filteredActivities.filter(a=>{const date=asDate(a.data);return date?.toISOString().slice(0,10)===d;}).length);
    drawLineChart("chart-daily",labels,values);
    $("#daily-caption").textContent = dates.length ? "Período filtrado: " + labels[0] + " a " + labels[labels.length-1] : "Nenhuma atividade no período selecionado.";
}

function renderStatusChart() {
    const values=statusOptions.map(s=>filteredActivities.filter(a=>a.status===s).length);
    drawDonutChart("chart-status",values,["#D89A00","#040438","#22A928","#555"]);
    $("#status-legend").innerHTML=statusOptions.map((s,i)=>'<div class="legend-item"><span class="legend-dot" style="background:'+["#D89A00","#040438","#22A928","#555"][i]+'"></span><span>'+escapeHtml(s)+'</span><strong>'+values[i]+'</strong></div>').join("");
}

function renderProfessionalChart() {
    const totals=new Map();
    filteredActivities.forEach(a=>totals.set(a.ptvId,(totals.get(a.ptvId)||0)+1));
    const items=[...totals.entries()].map(([id,value])=>({label:professionals.get(id)?.nome||id||"Não identificado",value})).sort((a,b)=>b.value-a.value);
    drawBarChart("chart-professionals",items);
    $("#professional-caption").textContent=items.length ? items.length + " profissionais com atividades no período." : "Nenhuma atividade encontrada.";
}

function clearMap() {
    mapLayers.forEach(layer=>layer.remove());
    mapLayers=[];
}

function ensureMap() {
    if(map || !window.L) return;
    map=L.map("visit-map",{zoomControl:true,preferCanvas:true}).setView([-23.1,-47.2],10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
        attribution:"&copy; OpenStreetMap contributors",
        maxZoom:19
    }).addTo(map);
}

function activityMapPoint(activity){
    const gps=parseGps(activity.checkinGps)||parseGps(activity.checkoutGps);
    if(gps) return {...gps,activity,source:"GPS da visita"};

    const client=allClients.find(item=>item.id===activity.clienteId);
    const lat=Number(client?.lat),lng=Number(client?.lng);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180){
        return {lat,lng,activity,source:"Localização do cliente"};
    }
    return null;
}

function makeAdvanceMarker(point){
    const icon=L.divIcon({
        className:"advance-map-marker",
        html:'<span class="advance-map-marker-ring"><i></i></span>',
        iconSize:[28,28],
        iconAnchor:[14,14],
        popupAnchor:[0,-13]
    });
    return L.marker([point.lat,point.lng],{icon});
}

function renderMap(mode="points") {
    ensureMap();
    if(!map) return;
    clearMap();

    const heatLegend=$("#heat-legend");
    if(heatLegend) heatLegend.hidden=mode!=="heat";

    mapPoints=filteredActivities.map(activityMapPoint).filter(Boolean);
    $("#map-count").textContent=mapPoints.length + (mapPoints.length===1 ? " atividade localizada." : " atividades localizadas.");

    if(!mapPoints.length){
        map.setView([-23.1,-47.2],10);
        return;
    }

    if(mode==="heat"){
        if(typeof L.heatLayer==="function"){
            const heat=L.heatLayer(
                mapPoints.map(point=>[point.lat,point.lng,0.8]),
                {
                    radius:42,
                    blur:30,
                    maxZoom:14,
                    minOpacity:.28,
                    gradient:{
                        .12:"#18378A",
                        .32:"#00A9E8",
                        .52:"#F4E94E",
                        .72:"#FF8A00",
                        1:"#F51E30"
                    }
                }
            ).addTo(map);
            mapLayers.push(heat);
        }
    } else {
        if(mode==="routes"){
            const grouped=new Map();
            mapPoints.forEach(point=>{
                const key=point.activity.ptvId||"sem-profissional";
                if(!grouped.has(key)) grouped.set(key,[]);
                grouped.get(key).push(point);
            });
            grouped.forEach(points=>{
                points.sort((a,b)=>(asDate(a.activity.data)?.getTime()||0)-(asDate(b.activity.data)?.getTime()||0));
                if(points.length<2) return;
                const latlngs=points.map(point=>[point.lat,point.lng]);
                const halo=L.polyline(latlngs,{color:"#F51E30",weight:7,opacity:.18,lineCap:"round",lineJoin:"round"}).addTo(map);
                const line=L.polyline(latlngs,{color:"#040438",weight:3,opacity:.88,lineCap:"round",lineJoin:"round"}).addTo(map);
                mapLayers.push(halo,line);
            });
        }

        mapPoints.forEach(point=>{
            const marker=makeAdvanceMarker(point);
            marker.bindPopup(
                '<div class="advance-map-popup">'+
                '<span class="eyebrow">VISITA</span>'+
                '<strong>'+escapeHtml(getClientName(point.activity.clienteId))+'</strong>'+
                '<small>'+escapeHtml(activityPersonName(point.activity))+'</small>'+
                '<small>'+formatDateTime(point.activity.data)+'</small>'+
                '<em>'+escapeHtml(point.source)+'</em>'+
                '</div>'
            );
            marker.addTo(map);
            mapLayers.push(marker);
        });
    }

    const bounds=L.latLngBounds(mapPoints.map(point=>[point.lat,point.lng]));
    map.fitBounds(bounds,{padding:[34,34],maxZoom:13});
}

function renderRanking() {
    const grouped=new Map();
    filteredActivities.forEach(a=>{
        const id=a.ptvId||"unknown";
        if(!grouped.has(id)) grouped.set(id,{id,total:0,completed:0,durations:[]});
        const row=grouped.get(id);
        row.total++;
        if(a.status==="Concluída") row.completed++;
        const start=asDate(a.checkinDataHora),end=asDate(a.checkoutDataHora);
        if(start&&end&&end>=start) row.durations.push((end-start)/60000);
    });
    const rows=[...grouped.values()].map(r=>({
        ...r,
        name:professionals.get(r.id)?.nome||r.id||"Não identificado",
        completion:r.total ? r.completed/r.total*100 : 0,
        average:r.durations.length ? r.durations.reduce((a,b)=>a+b,0)/r.durations.length : null
    })).sort((a,b)=>b.completed-a.completed||b.total-a.total||a.name.localeCompare(b.name,"pt-BR"));

    $("#ranking-table").innerHTML=rows.length?rows.map((r,i)=>'<tr><td><span class="rank-number">'+(i+1)+'</span>'+escapeHtml(r.name)+'</td><td>'+r.total+'</td><td>'+r.completed+'</td><td>'+Math.round(r.completion)+'%</td><td>'+formatDuration(r.average)+'</td></tr>').join(""):'<tr><td colspan="5" class="empty-row">Nenhuma atividade encontrada.</td></tr>';
}

function exportCsv() {
    const headers=["ID","Data","Cliente","Profissional","Tipo","Status"];
    const rows=filteredActivities.map(a=>[a.id,formatDateTime(a.data),getClientName(a.clienteId),activityPersonName(a),activityTypeLabel(a),a.status||""]);
    const csv=[headers,...rows].map(row=>row.map(value=>'"'+String(value??"").replace(/"/g,'""')+'"').join(";")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=url;link.download="advance-admin-dashboard.csv";link.click();URL.revokeObjectURL(url);
}

function clearFilters() {
    ["filter-start","filter-end","filter-professional","filter-status","filter-type","filter-client"].forEach(id=>$("#"+id).value="");
    applyFilters();
}

function bindEvents() {
    $("#filters-form").addEventListener("submit",event=>{event.preventDefault();applyFilters();});
    $("#clear-filters").addEventListener("click",clearFilters);
    $("#export-csv").addEventListener("click",exportCsv);
    $("#map-points").addEventListener("click",()=>{document.querySelectorAll(".map-mode").forEach(b=>b.classList.remove("active"));$("#map-points").classList.add("active");renderMap("points");});
    $("#map-heat").addEventListener("click",()=>{document.querySelectorAll(".map-mode").forEach(b=>b.classList.remove("active"));$("#map-heat").classList.add("active");renderMap("heat");});
    $("#map-routes").addEventListener("click",()=>{document.querySelectorAll(".map-mode").forEach(b=>b.classList.remove("active"));$("#map-routes").classList.add("active");renderMap("routes");});
    $("#maps-button").addEventListener("click",()=>{
        const first=mapPoints[0];
        if(first) window.open("https://www.google.com/maps/search/?api=1&query="+first.lat+","+first.lng,"_blank","noopener");
    });
    window.addEventListener("resize",()=>{renderDailyChart();renderStatusChart();renderProfessionalChart();if(map) map.invalidateSize();});
}

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("dashboard",admin,user);
        bindEvents();
        await loadData();
        setTimeout(()=>{ensureMap();renderMap("points");},0);
    }catch(error){console.error(error);}
})();
