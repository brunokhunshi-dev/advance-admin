import { $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml, formatDate, formatDateTime, statusClass } from "./core.js";

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("visits",admin,user);

        const [acts,clients] = await Promise.all([
            getDocs(collection(db,"atividades")),
            getDocs(collection(db,"clientes"))
        ]);
        const clientMap=new Map(clients.docs.map(d=>[d.id,d.data()?.nome||d.id]));
        const rows=acts.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.data?.toMillis?.()||0)-(a.data?.toMillis?.()||0));
        $("#visits-table").innerHTML=rows.length?rows.map(a=>'<tr><td>'+escapeHtml(a.id)+'</td><td>'+escapeHtml(clientMap.get(a.clienteId)||"Cliente não encontrado")+'</td><td>'+escapeHtml(a.tipoVisita||a.tipo||"—")+'</td><td><span class="status-text '+statusClass(a.status)+'">'+escapeHtml(a.status||"—")+'</span></td><td>'+formatDateTime(a.data)+'</td><td>'+escapeHtml(a.ptvId||"—")+'</td></tr>').join(""):'<tr><td colspan="6" class="empty-row">Nenhuma visita encontrada.</td></tr>';
        $("#refresh").addEventListener("click",()=>location.reload());
    }catch(error){console.error(error);$("#visits-table").innerHTML='<tr><td colspan="6" class="empty-row">Não foi possível carregar as visitas.</td></tr>';}
})();
