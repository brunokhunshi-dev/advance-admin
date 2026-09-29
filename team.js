import {
    app, $, db, collection, getDocs, requireAdmin, setupLayout, escapeHtml,
    asDate, formatDateTime, formatDuration
} from "./core.js";
import {
    doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import {
    getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-functions.js";

const functions = getFunctions(app);
const requestDeletion = httpsCallable(functions, "requestTeamMemberDeletion");
const confirmDeletion = httpsCallable(functions, "confirmTeamMemberDeletion");
const updateMemberEmail = httpsCallable(functions, "updateTeamMemberEmail");

let members = { promotores: [], assistencia: [] };
let activities = [];
let clients = new Map();
let activeTab = "promotores";
let selectedMember = null;
let deleteRequestId = null;

const defaultPermissions = {
    acessoApp: true,
    agendarVisitas: true,
    cadastrarClientes: true,
    finalizarVisitas: true,
    verHistorico: true
};

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "—";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function memberRole(member) {
    return member.cargo || member.funcao || (member.collection === "promotores" ? "Promotor Técnico" : "Assistente Técnico");
}

function memberActive(member) {
    return member.ativo !== false && member.permissoes?.acessoApp !== false;
}

function activityDurationMinutes(activity) {
    const start = asDate(activity.checkinDataHora);
    const end = asDate(activity.checkoutDataHora);
    if (!start || !end || end < start) return null;
    return (end - start) / 60000;
}

function memberStats(member) {
    const list = activities
        .filter(activity => activity.ptvId === member.id)
        .sort((a,b) => (asDate(b.data)?.getTime() || 0) - (asDate(a.data)?.getTime() || 0));

    const completed = list.filter(activity => activity.status === "Concluída");
    const durations = completed.map(activityDurationMinutes).filter(Number.isFinite);
    const totalMinutes = durations.reduce((sum,value) => sum + value, 0);
    const uniqueClients = new Set(list.map(activity => activity.clienteId).filter(Boolean)).size;
    const trainings = list.filter(activity => String(activity.tipoVisita || "").toLowerCase() === "treinamento").length;

    return {
        list,
        total: list.length,
        completed: completed.length,
        progress: list.filter(activity => activity.status === "Em andamento").length,
        pending: list.filter(activity => activity.status === "Pendente").length,
        completion: list.length ? completed.length / list.length * 100 : 0,
        totalMinutes,
        averageMinutes: durations.length ? totalMinutes / durations.length : null,
        uniqueClients,
        trainings,
        lastActivity: list[0]?.data || null
    };
}

function currentMembers() {
    const term = $("#team-search").value.trim().toLowerCase();
    return members[activeTab].filter(member => {
        if (!term) return true;
        return [member.nome, member.email, member.telefone, memberRole(member)]
            .some(value => String(value || "").toLowerCase().includes(term));
    });
}

function renderOverview() {
    const all = [...members.promotores, ...members.assistencia];
    const stats = all.map(memberStats);
    const totalMinutes = stats.reduce((sum,item) => sum + item.totalMinutes, 0);

    $("#team-total").textContent = all.length;
    $("#team-active").textContent = all.filter(memberActive).length;
    $("#team-visits").textContent = stats.reduce((sum,item) => sum + item.total, 0);
    $("#team-field-time").textContent = formatDuration(totalMinutes);

    $("#promotores-count").textContent = members.promotores.length;
    $("#assistencia-count").textContent = members.assistencia.length;
}

function renderTable() {
    const body = $("#team-table-body");
    const rows = currentMembers();

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum profissional encontrado.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(member => {
        const stats = memberStats(member);
        const active = memberActive(member);
        return '<tr data-member-id="' + escapeHtml(member.id) + '">' +
            '<td><div class="person-cell"><span class="person-avatar">' + escapeHtml(initials(member.nome)) + '</span><div><strong>' + escapeHtml(member.nome || "Sem nome") + '</strong><small>' + escapeHtml(memberRole(member)) + '</small></div></div></td>' +
            '<td><span class="account-status ' + (active ? "is-active" : "is-inactive") + '">' + (active ? "Ativo" : "Inativo") + '</span></td>' +
            '<td><strong class="kpi-table-value">' + stats.total + '</strong></td>' +
            '<td><span class="table-completion"><strong>' + stats.completed + '</strong><small>' + Math.round(stats.completion) + '%</small></span></td>' +
            '<td>' + formatDuration(stats.totalMinutes) + '</td>' +
            '<td>' + formatDuration(stats.averageMinutes) + '</td>' +
            '<td>' + (stats.lastActivity ? formatDateTime(stats.lastActivity) : "—") + '</td>' +
            '<td><div class="row-actions"><button type="button" class="row-link" data-action="profile" data-id="' + escapeHtml(member.id) + '">Ver perfil</button><button type="button" class="row-menu" data-action="manage" data-id="' + escapeHtml(member.id) + '" aria-label="Gerenciar">•••</button></div></td>' +
        '</tr>';
    }).join("");
}

function renderAll() {
    renderOverview();
    renderTable();
}

async function loadData() {
    const [promotersSnap, assistSnap, activitiesSnap, clientsSnap] = await Promise.all([
        getDocs(collection(db, "promotores")),
        getDocs(collection(db, "assistencia")),
        getDocs(collection(db, "atividades")),
        getDocs(collection(db, "clientes"))
    ]);

    members.promotores = promotersSnap.docs.map(item => ({ id:item.id, collection:"promotores", ...item.data() }))
        .sort((a,b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    members.assistencia = assistSnap.docs.map(item => ({ id:item.id, collection:"assistencia", ...item.data() }))
        .sort((a,b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    activities = activitiesSnap.docs.map(item => ({ id:item.id, ...item.data() }));
    clients = new Map(clientsSnap.docs.map(item => [item.id, { id:item.id, ...item.data() }]));

    renderAll();
}

function findMember(id) {
    return [...members.promotores, ...members.assistencia].find(member => member.id === id) || null;
}

function openModal(name) {
    const modal = $("#" + name + "-modal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
}

function closeModal(name) {
    const modal = $("#" + name + "-modal");
    if (!modal) return;
    modal.hidden = true;
    if (![...document.querySelectorAll(".team-modal")].some(item => !item.hidden)) {
        document.body.classList.remove("modal-open");
    }
}

function renderActivityBars(member) {
    const stats = memberStats(member);
    const dayMap = new Map();
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const key = date.toISOString().slice(0,10);
        dayMap.set(key, { date, count:0 });
    }

    stats.list.forEach(activity => {
        const date = asDate(activity.data);
        const key = date?.toISOString().slice(0,10);
        if (key && dayMap.has(key)) dayMap.get(key).count++;
    });

    const days = [...dayMap.values()];
    const max = Math.max(1, ...days.map(day => day.count));

    $("#profile-activity-bars").innerHTML = days.map(day =>
        '<div class="activity-bar-column"><div class="activity-bar-value">' + day.count + '</div><div class="activity-bar-track"><span style="height:' + Math.max(day.count ? 12 : 2, (day.count/max)*100) + '%"></span></div><small>' + day.date.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","") + '</small></div>'
    ).join("");
}

function openProfile(member) {
    selectedMember = member;
    const stats = memberStats(member);

    $("#profile-avatar").textContent = initials(member.nome);
    $("#profile-area").textContent = member.collection === "promotores" ? "PROMOTORIA" : "ASSISTÊNCIA";
    $("#profile-name").textContent = member.nome || "Sem nome";
    $("#profile-role").textContent = memberRole(member);
    $("#profile-email").textContent = member.email || "E-mail não cadastrado";
    $("#profile-email").href = member.email ? "mailto:" + member.email : "#";
    $("#profile-phone").textContent = member.telefone || "Telefone não cadastrado";
    $("#profile-status").textContent = memberActive(member) ? "Ativo" : "Inativo";
    $("#profile-status").className = "profile-status " + (memberActive(member) ? "is-active" : "is-inactive");

    $("#profile-visits").textContent = stats.total;
    $("#profile-completed").textContent = stats.completed;
    $("#profile-completion").textContent = Math.round(stats.completion) + "%";
    $("#profile-field-time").textContent = formatDuration(stats.totalMinutes);
    $("#profile-average").textContent = formatDuration(stats.averageMinutes);
    $("#profile-clients").textContent = stats.uniqueClients;

    renderActivityBars(member);

    $("#profile-recent-visits").innerHTML = stats.list.length
        ? stats.list.slice(0,5).map(activity => {
            const client = clients.get(activity.clienteId);
            return '<div class="recent-visit"><span class="recent-status-dot status-' + escapeHtml(String(activity.status || "").toLowerCase().replace(/\s+/g,"-")) + '"></span><div><strong>' + escapeHtml(client?.nome || "Cliente não encontrado") + '</strong><small>' + escapeHtml(activity.tipoVisita || activity.tipo || "Visita") + ' • ' + formatDateTime(activity.data) + '</small></div><span class="recent-visit-status">' + escapeHtml(activity.status || "—") + '</span></div>';
        }).join("")
        : '<div class="profile-empty">Nenhuma atividade registrada para este profissional.</div>';

    openModal("profile");
}

function permissionsOf(member) {
    return { ...defaultPermissions, ...(member.permissoes || {}) };
}

function openManage(member) {
    selectedMember = member;
    const permissions = permissionsOf(member);

    $("#manage-title").textContent = member.nome || "Editar profissional";
    $("#manage-collection-badge").textContent = member.collection === "promotores" ? "Promotoria" : "Assistência";
    $("#manage-name").value = member.nome || "";
    $("#manage-email").value = member.email || "";
    $("#manage-phone").value = member.telefone || "";
    $("#manage-role").value = memberRole(member);
    $("#manage-active").checked = member.ativo !== false;
    $("#perm-access").checked = permissions.acessoApp !== false;
    $("#perm-schedule").checked = permissions.agendarVisitas !== false;
    $("#perm-clients").checked = permissions.cadastrarClientes !== false;
    $("#perm-close").checked = permissions.finalizarVisitas !== false;
    $("#perm-history").checked = permissions.verHistorico !== false;
    $("#manage-active-label").textContent = $("#manage-active").checked ? "Ativo" : "Inativo";
    $("#manage-message").textContent = "";

    closeModal("profile");
    openModal("manage");
}

async function saveMember(event) {
    event.preventDefault();
    if (!selectedMember) return;

    const button = $("#save-user");
    button.disabled = true;
    button.textContent = "Salvando...";
    $("#manage-message").textContent = "";

    const newEmail = $("#manage-email").value.trim();
    const emailChanged = newEmail !== String(selectedMember.email || "");

    try {
        const payload = {
            nome: $("#manage-name").value.trim(),
            telefone: $("#manage-phone").value.trim(),
            cargo: $("#manage-role").value.trim(),
            ativo: $("#manage-active").checked,
            permissoes: {
                acessoApp: $("#perm-access").checked,
                agendarVisitas: $("#perm-schedule").checked,
                cadastrarClientes: $("#perm-clients").checked,
                finalizarVisitas: $("#perm-close").checked,
                verHistorico: $("#perm-history").checked
            },
            atualizadoEm: serverTimestamp()
        };

        await updateDoc(doc(db, selectedMember.collection, selectedMember.id), payload);

        Object.assign(selectedMember, payload, {
            atualizadoEm: new Date(),
            permissoes: payload.permissoes
        });

        if (emailChanged) {
            try {
                await updateMemberEmail({
                    collection: selectedMember.collection,
                    memberId: selectedMember.id,
                    newEmail
                });
                selectedMember.email = newEmail;
                $("#manage-message").textContent = "Alterações e e-mail de acesso atualizados com sucesso.";
            } catch (emailError) {
                console.error(emailError);
                $("#manage-message").textContent = "Dados salvos, mas o e-mail de login não foi alterado. Publique a função updateTeamMemberEmail para sincronizar com o Firebase Authentication.";
            }
        } else {
            $("#manage-message").textContent = "Alterações salvas com sucesso.";
        }

        renderAll();
    } catch(error) {
        console.error(error);
        $("#manage-message").textContent = error.code === "permission-denied"
            ? "O Firestore bloqueou a alteração. É necessário publicar as regras administrativas de escrita."
            : (error.message || "Não foi possível salvar as alterações.");
    } finally {
        button.disabled = false;
        button.textContent = "Salvar alterações";
    }
}

function openDelete() {
    if (!selectedMember) return;
    deleteRequestId = null;
    $("#delete-email").textContent = selectedMember.email || "e-mail não cadastrado";
    $("#delete-code").value = "";
    $("#delete-request-step").hidden = false;
    $("#delete-code-step").hidden = true;
    $("#delete-message").textContent = "";
    $("#delete-code-hint").textContent = "";
    closeModal("manage");
    openModal("delete");
}

async function sendDeleteCode() {
    if (!selectedMember) return;
    const button = $("#send-delete-code");
    button.disabled = true;
    button.textContent = "Enviando...";
    $("#delete-message").textContent = "";

    try {
        const result = await requestDeletion({
            collection: selectedMember.collection,
            memberId: selectedMember.id
        });

        deleteRequestId = result.data.requestId;
        $("#delete-request-step").hidden = true;
        $("#delete-code-step").hidden = false;
        $("#delete-code-hint").textContent = "Código enviado para " + (result.data.maskedEmail || selectedMember.email) + ". Válido por 10 minutos.";
        $("#delete-code").focus();
    } catch(error) {
        console.error(error);
        $("#delete-message").textContent = error.code === "functions/not-found" || error.code === "functions/internal"
            ? "O fluxo seguro de exclusão ainda precisa ser publicado no Firebase Functions."
            : (error.message || "Não foi possível enviar o código de confirmação.");
    } finally {
        button.disabled = false;
        button.textContent = "Enviar código de confirmação";
    }
}

async function confirmDelete() {
    const code = $("#delete-code").value.replace(/\D/g,"").slice(0,6);
    if (!deleteRequestId || code.length !== 6) {
        $("#delete-message").textContent = "Digite o código de 6 dígitos enviado por e-mail.";
        return;
    }

    const button = $("#confirm-delete-user");
    button.disabled = true;
    button.textContent = "Excluindo...";
    $("#delete-message").textContent = "";

    try {
        await confirmDeletion({ requestId:deleteRequestId, code });
        members[selectedMember.collection] = members[selectedMember.collection].filter(member => member.id !== selectedMember.id);
        renderAll();
        closeModal("delete");
        selectedMember = null;
    } catch(error) {
        console.error(error);
        $("#delete-message").textContent = error.message || "Não foi possível confirmar a exclusão.";
    } finally {
        button.disabled = false;
        button.textContent = "Confirmar exclusão";
    }
}

function bindEvents() {
    document.querySelectorAll("[data-team-tab]").forEach(button => {
        button.addEventListener("click", () => {
            activeTab = button.dataset.teamTab;
            document.querySelectorAll("[data-team-tab]").forEach(tab => {
                const active = tab === button;
                tab.classList.toggle("active", active);
                tab.setAttribute("aria-selected", String(active));
            });
            renderTable();
        });
    });

    $("#team-search").addEventListener("input", renderTable);
    $("#refresh-team").addEventListener("click", loadData);

    $("#team-table-body").addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const member = findMember(button.dataset.id);
        if (!member) return;
        if (button.dataset.action === "profile") openProfile(member);
        if (button.dataset.action === "manage") openManage(member);
    });

    document.querySelectorAll("[data-close-modal]").forEach(button => {
        button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });

    $("#profile-manage").addEventListener("click", () => selectedMember && openManage(selectedMember));
    $("#manage-form").addEventListener("submit", saveMember);
    $("#manage-active").addEventListener("change", () => {
        $("#manage-active-label").textContent = $("#manage-active").checked ? "Ativo" : "Inativo";
    });

    $("#delete-user").addEventListener("click", openDelete);
    $("#send-delete-code").addEventListener("click", sendDeleteCode);
    $("#resend-delete-code").addEventListener("click", sendDeleteCode);
    $("#confirm-delete-user").addEventListener("click", confirmDelete);
    $("#delete-code").addEventListener("input", event => {
        event.target.value = event.target.value.replace(/\D/g,"").slice(0,6);
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        ["delete","manage","profile"].forEach(name => {
            const modal = $("#" + name + "-modal");
            if (modal && !modal.hidden) closeModal(name);
        });
    });
}

(async() => {
    try {
        const {user,admin} = await requireAdmin();
        setupLayout("team", admin, user);
        bindEvents();
        await loadData();
    } catch(error) {
        console.error(error);
        $("#team-table-body").innerHTML = '<tr><td colspan="8" class="empty-row">Não foi possível carregar a equipe.</td></tr>';
    }
})();