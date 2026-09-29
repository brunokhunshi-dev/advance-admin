import { $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml } from "./core.js";

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("clients",admin,user);
        const snap=await getDocs(collection(db,"clientes"));
        const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.nome||"").localeCompare(String(b.nome||""),"pt-BR"));
        $("#clients-table").innerHTML=rows.length?rows.map(c=>'<tr><td>'+escapeHtml(c.id)+'</td><td>'+escapeHtml(c.nome||"—")+'</td><td>'+escapeHtml(c.cidade||"—")+'</td><td>'+escapeHtml(c.uf||"—")+'</td><td>'+escapeHtml(c.status||"—")+'</td><td>'+escapeHtml(c.codigoCnpj||"—")+'</td><td>'+escapeHtml(c.enderecoCompleto||"—")+'</td></tr>').join(""):'<tr><td colspan="7" class="empty-row">Nenhum cliente encontrado.</td></tr>';
        $("#refresh").addEventListener("click",()=>location.reload());
    }catch(error){console.error(error);$("#clients-table").innerHTML='<tr><td colspan="7" class="empty-row">Não foi possível carregar os clientes.</td></tr>';}
})();
