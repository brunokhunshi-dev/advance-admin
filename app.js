import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, getCountFromServer, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let firebaseInitError = null;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    firebaseInitError = error;
    console.error("[Advance Admin] Falha ao inicializar Firebase:", error);
}

const $ = (selector) => document.querySelector(selector);
const state = { clients: new Map(), admin: null };
const debugState = { rows: [], running: false };

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

function formatDebugError(error) {
    if (!error) return "";
    return [
        error.code ? "code=" + error.code : "",
        error.name ? "name=" + error.name : "",
        error.message ? error.message : ""
    ].filter(Boolean).join(" • ");
}

function maskApiKey(key) {
    if (!key) return "ausente";
    if (key.length <= 10) return "********";
    return key.slice(0, 6) + "…" + key.slice(-4);
}

function addDebugRow(status, title, detail = "") {
    const icons = { ok: "✓", fail: "×", warn: "!", running: "…" };
    debugState.rows.push({ status, title, detail });
    $("#debug-results").insertAdjacentHTML("beforeend",
        '<div class="debug-row"><div class="debug-' + status + '">' + icons[status] + '</div>' +
        '<div><strong>' + escapeHtml(title) + '</strong>' +
        (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') +
        '</div></div>'
    );
}

async function testFirebaseApiKey() {
    const key = firebaseConfig?.apiKey;
    if (!key) throw new Error("apiKey não existe na configuração.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
        const url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + encodeURIComponent(key);
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: controller.signal
        });
        const raw = await response.text();
        let payload = null;
        try { payload = JSON.parse(raw); } catch (_) {}

        const apiMessage = String(payload?.error?.message || raw || "sem corpo de resposta");
        if (response.ok || apiMessage === "MISSING_EMAIL" || apiMessage === "MISSING_PASSWORD") {
            return { detail: "HTTP " + response.status + " • a chave foi aceita pelo Firebase Auth." };
        }

        if (/INVALID_API_KEY|API_KEY_INVALID|API key not valid/i.test(apiMessage)) {
            throw new Error("HTTP " + response.status + " • " + apiMessage);
        }

        return { detail: "HTTP " + response.status + " • Firebase Auth respondeu " + apiMessage + " (isso indica que a chave chegou ao serviço)." };
    } finally {
        clearTimeout(timer);
    }
}

async function runDiagnostics() {
    if (debugState.running) return;

    debugState.running = true;
    $("#debug-run").disabled = true;
    $("#debug-copy").disabled = true;
    $("#debug-results").innerHTML = "";
    debugState.rows = [];
    $("#debug-summary").textContent = "Executando testes…";

    addDebugRow("ok", "Página carregada", "URL: " + location.href);

    const origin = location.origin;
    addDebugRow(
        origin === "null" ? "warn" : "ok",
        "Origem do navegador",
        "origin=" + origin + " • hostname=" + location.hostname + " • protocolo=" + location.protocol
    );

    const configOk = Boolean(
        firebaseConfig?.apiKey &&
        firebaseConfig?.authDomain &&
        firebaseConfig?.projectId &&
        firebaseConfig?.messagingSenderId &&
        firebaseConfig?.appId
    );
    addDebugRow(
        configOk ? "ok" : "fail",
        "Configuração do Firebase",
        configOk
            ? "projectId=" + firebaseConfig.projectId + " • authDomain=" + firebaseConfig.authDomain + " • apiKey=" + maskApiKey(firebaseConfig.apiKey)
            : "Campo obrigatório ausente na configuração."
    );

    addDebugRow(
        firebaseInitError ? "fail" : "ok",
        "Inicialização do SDK",
        firebaseInitError ? formatDebugError(firebaseInitError) : "Firebase App, Auth e Firestore foram inicializados."
    );

    try {
        const apiResult = await testFirebaseApiKey();
        addDebugRow("ok", "Validação da API key no Firebase Auth", apiResult.detail);
    } catch (error) {
        const detail = formatDebugError(error);
        let hint = detail;
        if (/INVALID_API_KEY|API_KEY_INVALID|API key not valid/i.test(detail)) {
            hint = detail + " • A chave foi rejeitada; verifique restrições da API key no Google Cloud e o domínio autorizado no Firebase Authentication.";
        } else if (/403/.test(detail)) {
            hint = detail + " • Verifique as restrições HTTP referrer da API key.";
        } else if (/Failed to fetch|AbortError/i.test(detail)) {
            hint = detail + " • O navegador não conseguiu completar a requisição; verifique conexão, extensões, CSP ou bloqueadores.";
        }
        addDebugRow("fail", "Validação da API key no Firebase Auth", hint);
    }

    if (firebaseInitError) {
        addDebugRow("fail", "Firebase não está pronto para login", "Corrija a falha de inicialização acima.");
    } else {
        addDebugRow("ok", "Objeto Auth disponível", "getAuth(app) retornou uma instância válida.");
        addDebugRow("ok", "Objeto Firestore disponível", "getFirestore(app) retornou uma instância válida.");
    }

    if (location.hostname.endsWith(".github.io")) {
        addDebugRow("warn", "Domínio do GitHub Pages detectado", "No Firebase Authentication, " + location.hostname + " precisa estar em Authorized domains. A API key também pode estar limitada por HTTP referrer.");
    } else if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        addDebugRow("ok", "Ambiente local detectado", "Para produção, execute o diagnóstico novamente no domínio publicado.");
    } else {
        addDebugRow("warn", "Domínio atual", "Confirme este hostname em Firebase Authentication > Authorized domains e nas restrições HTTP referrer da API key.");
    }

    const failures = debugState.rows.filter((row) => row.status === "fail").length;
    const warnings = debugState.rows.filter((row) => row.status === "warn").length;
    $("#debug-summary").textContent = failures
        ? failures + " teste(s) falharam e " + warnings + " aviso(s) foram encontrados."
        : warnings
            ? "Nenhuma falha direta na API key. Há " + warnings + " ponto(s) que merecem conferência."
            : "Diagnóstico concluído sem falhas detectadas.";

    $("#debug-copy").disabled = false;
    $("#debug-run").disabled = false;
    debugState.running = false;
}

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
if (auth) {
    $("#logout-button").addEventListener("click", () => signOut(auth));
}

$("#debug-toggle").addEventListener("click", () => {
    const panel = $("#debug-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("#debug-toggle").setAttribute("aria-expanded", String(open));
});

$("#debug-run").addEventListener("click", runDiagnostics);

$("#debug-copy").addEventListener("click", async () => {
    const result = debugState.rows
        .map((row) => "[" + row.status.toUpperCase() + "] " + row.title + (row.detail ? " — " + row.detail : ""))
        .join("\n");

    try {
        await navigator.clipboard.writeText(result);
        $("#debug-summary").textContent = "Resultado copiado para a área de transferência.";
    } catch (_) {
        $("#debug-summary").textContent = result;
    }
});

window.addEventListener("error", (event) => {
    if (event.message) {
        console.error("[Advance Admin] Erro global:", event.error || event.message);
    }
});

window.addEventListener("unhandledrejection", (event) => {
    console.error("[Advance Admin] Promise rejeitada:", event.reason);
});

$("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    button.disabled = true; button.textContent = "Entrando..."; loginMessage("");
    try {
        if (!auth) throw new Error("Firebase Auth não foi inicializado. Abra o Diagnóstico técnico.");
        const credential = await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-password").value);
        const admin = await requireAdmin(credential.user);
        $("#login-password").value = "";
        showAdmin(credential.user, admin);
    } catch (error) {
        await signOut(auth).catch(() => {});
        loginMessage(error.message || "Não foi possível entrar.");
        addDebugRow("fail", "Tentativa de login", formatDebugError(error));
    } finally { button.disabled = false; button.textContent = "Entrar"; }
});

if (auth) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) { showLogin(); return; }
        try {
            showAdmin(user, await requireAdmin(user));
        } catch (error) {
            loginMessage(error.message || "Esta conta não possui acesso administrativo.");
            await signOut(auth).catch(() => {});
        }
    });
} else {
    showLogin();
    loginMessage("O Firebase não foi inicializado. Abra o Diagnóstico técnico.");
}

if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}
