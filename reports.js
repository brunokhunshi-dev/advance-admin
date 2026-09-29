import { $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml, formatDateTime } from "./core.js";

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("reports",admin,user);
        const [reports,clients]=await Promise.all([getDocs(collection(db,"relatorios")),getDocs(collection(db,"clientes"))]);
        const clientMap=new Map(clients.docs.map(d=>[d.id,d.data()?.nome||d.id]));
        const rows=reports.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.atualizadoEm?.toMillis?.()||0)-(a.atualizadoEm?.toMillis?.()||0));
        $("#reports-table").innerHTML=rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.codigo||("#"+r.id))+'</td><td>'+escapeHtml(clientMap.get(r.clienteId)||"Cliente não encontrado")+'</td><td>'+escapeHtml(r.atividadeId||"—")+'</td><td>'+formatDateTime(r.atualizadoEm)+'</td><td>'+escapeHtml(r.resultado||"—")+'</td></tr>').join(""):'<tr><td colspan="5" class="empty-row">Nenhum relatório encontrado.</td></tr>';
        $("#refresh").addEventListener("click",()=>location.reload());
    }catch(error){console.error(error);}
})();
