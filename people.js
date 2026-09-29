import { $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml } from "./core.js";

(async()=>{
    try{
        const {user,admin}=await requireAdmin();
        setupLayout("people",admin,user);
        const [assist,promoters]=await Promise.all([getDocs(collection(db,"assistencia")),getDocs(collection(db,"promotores"))]);
        const render=(docs,selector)=>{
            const rows=docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.nome||"").localeCompare(String(b.nome||""),"pt-BR"));
            $(selector).innerHTML=rows.length?rows.map(p=>'<tr><td>'+escapeHtml(p.nome||"—")+'</td><td>'+escapeHtml(p.email||"—")+'</td><td>'+escapeHtml(p.cargo||p.funcao||"—")+'</td><td>'+escapeHtml(p.status||"Ativo")+'</td></tr>').join(""):'<tr><td colspan="4" class="empty-row">Nenhum profissional encontrado.</td></tr>';
        };
        render(assist.docs,"#assistencia-table");
        render(promoters.docs,"#promotores-table");
        $("#refresh").addEventListener("click",()=>location.reload());
    }catch(error){console.error(error);}
})();
