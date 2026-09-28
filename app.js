import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, getCountFromServer, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (selector) => document.querySelector(selector);

const state = { clients: new Map(), admin: null };

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
}

function formatDate(value) {
    if (!value) return "—";
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function statusHtml(status) {
    const classes = { "Concluída": "status-completed", "Em andamento": "status-progress", "Pendente": "status-pending", "Cancelada": "status-cancelled" };
    return '<span class="status-text ' + (classes[status] || "status-neutral") + '">' + escapeHtml(status || "—") + "</span>";
}

function message(text = "") {
    const el = $("#global-message");
    el.textContent = text;
    el.hidden = !text;
}

function loginMessage(text = "") { $("#login-message").textContent = text; }

async function requireAdmin(user) {
    const snap = await getDoc(doc(db, "administradores", user.uid));
    if (!snap.exists() || snap.data()?.ativo !== true) throw new Error("Esta conta não possui acesso ao painel administrativo.");
    return { uid: user.uid, ...snap.data() };
}

async function getClient(id) {
    if (!id) return null;
    if (state.clients.has(id)) return state.clients.get(id);
    const snap = await getDoc(doc(db, "clientes", id));
    const client = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    state.clients.set(id, client);
    return client;
}

async function loadOverview() {
    try {
        message("");
        const [clients, pending, progress, completed, reports] = await Promise.all([
            getCountFromServer(query(collection(db, "clientes"), where("status", "==", "Ativo"))),
            getCountFromServer(query(collection(db, "atividades"), where("status", "==", "Pendente"))),
            getCountFromServer(query(collection(db, "atividades"), where("status", "==", "Em andamento"))),
            getCountFromServer(query(collection(db, "atividades"), where("status", "==", "Concluída"))),
            getCountFromServer(collection(db, "relatorios"))
        ]);
        $("#metric-clients").textContent = clients.data().count;
        $("#metric-pending").textContent = pending.data().count;
        $("#metric-progress").textContent = progress.data().count;
        $("#metric-completed").textContent = completed.data().count;
        $("#metric-reports").textContent = reports.data().count;
        await loadRecentVisits();
    } catch (error) {
        message("Não foi possível ler o Firestore. Verifique as regras de segurança.");
        console.error(error);
    }
}

async function loadRecentVisits() {
    const body = $("#recent-visits");
    try {
        const snap = await getDocs(query(collection(db, "atividades"), orderBy("data", "desc"), limit(8)));
        if (snap.empty) { body.innerHTML = '<tr><td colspan="4" class="empty-row">Nenhuma visita encontrada.</td></tr>'; return; }
        const rows = [];
        for (const item of snap.docs) {
            const activity = { id: item.id, ...item.data() };
            const client = await getClient(activity.clienteId);
            rows.push("<tr><td>" + escapeHtml(client?.nome || "Cliente não encontrado") + "</td><td>" + escapeHtml(activity.tipoVisita || activity.tipo || "—") + "</td><td>" + statusHtml(activity.status) + "</td><td>" + formatDate(activity.data) + "</td></tr>");
        }
        body.innerHTML = rows.join("");
    } catch (error) { body.innerHTML = '<tr><td colspan="4" class="empty-row">Não foi possível carregar.</td></tr>'; console.error(error); }
}

async function loadVisits() {
    const body = $("#visits-table");
    try {
        const snap = await getDocs(query(collection(db, "atividades"), orderBy("data", "desc"), limit(100)));
        if (snap.empty) { body.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhuma visita encontrada.</td></tr>'; return; }
        const rows = [];
        for (const item of snap.docs) {
            const activity = { id: item.id, ...item.data() };
            const client = await getClient(activity.clienteId);
            rows.push("<tr><td>" + escapeHtml(activity.id) + "</td><td>" + escapeHtml(client?.nome || "Cliente não encontrado") + "</td><td>" + escapeHtml(activity.tipoVisita || activity.tipo || "—") + "</td><td>" + statusHtml(activity.status) + "</td><td>" + formatDate(activity.data) + "</td><td>" + escapeHtml(activity.ptvId || "—") + "</td></tr>");
        }
        body.innerHTML = rows.join("");
    } catch (error) { body.innerHTML = '<tr><td colspan="6" class="empty-row">Não foi possível carregar as visitas.</td></tr>'; console.error(error); }
}

async function loadClients() {
    const body = $("#clients-table");
    try {
        const snap = await getDocs(query(collection(db, "clientes"), orderBy("nome"), limit(200)));
        body.innerHTML = snap.empty ? '<tr><td colspan="6" class="empty-row">Nenhum cliente encontrado.</td></tr>' : snap.docs.map((item) => {
            const client = item.data();
            return "<tr><td>" + escapeHtml(item.id) + "</td><td>" + escapeHtml(client.nome || "—") + "</td><td>" + escapeHtml(client.cidade || "—") + "</td><td>" + escapeHtml(client.uf || "—") + "</td><td>" + escapeHtml(client.status || "—") + "</td><td>" + escapeHtml(client.codigoCnpj || "—") + "</td></tr>";
        }).join("");
    } catch (error) { body.innerHTML = '<tr><td colspan="6" class="empty-row">Não foi possível carregar os clientes.</td></tr>'; console.error(error); }
}

async function loadPeople() {
    for (const [name, selector] of [["assistencia", "#assistencia-table"], ["promotores", "#promotores-table"]]) {
        const body = $(selector);
        try {
            const snap = await getDocs(query(collection(db, name), orderBy("nome"), limit(100)));
            body.innerHTML = snap.empty ? '<tr><td colspan="2" class="empty-row">Nenhum profissional encontrado.</td></tr>' : snap.docs.map((item) => {
                const person = item.data();
                return "<tr><td>" + escapeHtml(person.nome || "—") + "</td><td>" + escapeHtml(person.email || "—") + "</td></tr>";
            }).join("");
        } catch (error) { body.innerHTML = '<tr><td colspan="2" class="empty-row">Não foi possível carregar.</td></tr>'; console.error(error); }
    }
}

async function loadReports() {
    const body = $("#reports-table");
    try {
        const snap = await getDocs(query(collection(db, "relatorios"), orderBy("atualizadoEm", "desc"), limit(100)));
        if (snap.empty) { body.innerHTML = '<tr><td colspan="4" class="empty-row">Nenhum relatório encontrado.</td></tr>'; return; }
        const rows = [];
        for (const item of snap.docs) {
            const report = { id: item.id, ...item.data() };
            const client = await getClient(report.clienteId);
            rows.push("<tr><td>" + escapeHtml(report.codigo || "#" + report.id) + "</td><td>" + escapeHtml(client?.nome || "Cliente não encontrado") + "</td><td>" + escapeHtml(report.atividadeId || "—") + "</td><td>" + formatDate(report.atualizadoEm) + "</td></tr>");
        }
        body.innerHTML = rows.join("");
    } catch (error) { body.innerHTML = '<tr><td colspan="4" class="empty-row">Não foi possível carregar os relatórios.</td></tr>'; console.error(error); }
}

async function showSection(section) {
    document.querySelectorAll(".nav-link[data-section]").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
    document.querySelectorAll(".page-section").forEach((s) => s.classList.remove("active-section"));
    $("#section-" + section)?.classList.add("active-section");
    const titles = { overview:"Visão geral", visits:"Visitas", clients:"Clientes", people:"Profissionais", reports:"Relatórios" };
    $("#page-title").textContent = titles[section];
    if (section === "overview") await loadOverview();
    if (section === "visits") await loadVisits();
    if (section === "clients") await loadClients();
    if (section === "people") await loadPeople();
    if (section === "reports") await loadReports();
}

function showAdmin(user, admin) {
    state.admin = admin;
    $("#login-screen").hidden = true;
    $("#admin-screen").hidden = false;
    $("#user-name").textContent = admin.nome || "Administrador";
    $("#user-email").textContent = user.email || "";
    showSection("overview");
}

function showLogin() { state.admin = null; $("#admin-screen").hidden = true; $("#login-screen").hidden = false; }

document.querySelectorAll(".nav-link[data-section]").forEach((b) => b.addEventListener("click", () => showSection(b.dataset.section)));
document.querySelectorAll("[data-section-link]").forEach((b) => b.addEventListener("click", () => showSection(b.dataset.sectionLink)));
$("#refresh-visits").addEventListener("click", loadVisits);
$("#refresh-clients").addEventListener("click", loadClients);
$("#refresh-people").addEventListener("click", loadPeople);
$("#refresh-reports").addEventListener("click", loadReports);
$("#logout-button").addEventListener("click", () => signOut(auth));

$("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    button.disabled = true; button.textContent = "Entrando..."; loginMessage("");
    try {
        const credential = await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-password").value);
        const admin = await requireAdmin(credential.user);
        $("#login-password").value = "";
        showAdmin(credential.user, admin);
    } catch (error) {
        await signOut(auth).catch(() => {});
        loginMessage(error.message || "Não foi possível entrar.");
    } finally { button.disabled = false; button.textContent = "Entrar"; }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) { showLogin(); return; }
    try { showAdmin(user, await requireAdmin(user)); }
    catch (error) { loginMessage(error.message || "Esta conta não possui acesso administrativo."); await signOut(auth).catch(() => {}); }
});

if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}
