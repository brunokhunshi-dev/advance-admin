import { db, collection, getDocs } from "./core.js";

async function getInactiveMembers(){
  const [promotores, assistencia] = await Promise.all([
    getDocs(collection(db, "promotores")),
    getDocs(collection(db, "assistencia"))
  ]);
  const inactive = new Map();
  for (const [area, snap] of [["promotores", promotores], ["assistencia", assistencia]]) {
    snap.docs.forEach(d => {
      const data = d.data() || {};
      const isActive = data.ativo !== false && data.permissoes?.acessoApp !== false;
      if (!isActive) inactive.set(String(data.nome || "").trim().toLowerCase(), area);
    });
  }
  return inactive;
}

function applyInactiveFilter(inactive){
  document.querySelectorAll("#team-table-body tr").forEach(row => {
    if (row.querySelector(".account-status.is-inactive")) row.remove();
  });

  document.querySelectorAll(".comparison-person").forEach(card => {
    const name = String(card.querySelector(".person-cell strong")?.textContent || "").trim().toLowerCase();
    if (inactive.has(name)) card.remove();
  });

  const activePromotores = [...document.querySelectorAll("#comparison-promotores .comparison-person")].length;
  const activeAssistencia = [...document.querySelectorAll("#comparison-assistencia .comparison-person")].length;
  const totalActive = activePromotores + activeAssistencia;

  const total = document.querySelector("#team-total");
  const active = document.querySelector("#team-active");
  const promotoresCount = document.querySelector("#promotores-count");
  const assistenciaCount = document.querySelector("#assistencia-count");
  if (total) total.textContent = String(totalActive);
  if (active) active.textContent = String(totalActive);
  if (promotoresCount) promotoresCount.textContent = String(activePromotores);
  if (assistenciaCount) assistenciaCount.textContent = String(activeAssistencia);

  for (const id of ["comparison-promotores", "comparison-assistencia"]) {
    const container = document.getElementById(id);
    if (container && !container.querySelector(".comparison-person")) {
      container.innerHTML = '<div class="comparison-empty">Nenhum profissional ativo nesta equipe.</div>';
    }
  }

  const body = document.querySelector("#team-table-body");
  if (body && !body.querySelector("tr")) {
    body.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum profissional ativo encontrado.</td></tr>';
  }
}

let inactiveMembers = new Map();
let scheduled = false;
function scheduleFilter(){
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyInactiveFilter(inactiveMembers);
  });
}

try {
  inactiveMembers = await getInactiveMembers();
  scheduleFilter();
  const observer = new MutationObserver(scheduleFilter);
  observer.observe(document.body, { childList: true, subtree: true });
} catch (error) {
  console.error("[Equipe] Não foi possível filtrar membros inativos:", error);
}