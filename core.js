import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { collection, doc, getDoc, getDocs, onAuthStateChanged, signOut };

export const $ = selector => document.querySelector(selector);

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[char]));
}

export function asDate(value) {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
    const date = asDate(value);
    return date ? date.toLocaleDateString("pt-BR") : "—";
}

export function formatDateTime(value) {
    const date = asDate(value);
    return date ? date.toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" }) : "—";
}

export function formatDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "—";
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (!hours) return mins + "min";
    return hours + "h " + String(mins).padStart(2, "0") + "min";
}

export function parseGps(value) {
    if (typeof value !== "string") return null;
    const [lat, lng] = value.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

export function normalizeVisitType(activity) {
    const raw = String(activity?.tipoVisita || activity?.tipo || activity?.objetivo || "").trim().toLowerCase();
    if (raw.includes("trein")) return "Treinamento";
    if (raw.includes("assist") && raw.includes("técn")) return "Assistência técnica";
    if (raw.includes("assist") && raw.includes("tecn")) return "Assistência técnica";
    if (raw === "visita técnica" || raw === "visita tecnica" || raw === "visita comercial" || raw === "comercial") return "Visita comercial";
    return "Visita comercial";
}

export function statusClass(status) {
    return ({
        "Concluída":"status-completed",
        "Em andamento":"status-progress",
        "Pendente":"status-pending",
        "Cancelada":"status-cancelled"
    })[status] || "status-neutral";
}

export async function waitForUser() {
    return new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            unsubscribe();
            resolve(user);
        });
    });
}

export async function requireAdmin() {
    const user = await waitForUser();
    if (!user) {
        window.location.href = "./index.html";
        throw new Error("Usuário não autenticado.");
    }

    const snap = await getDoc(doc(db, "administradores", user.uid));
    if (!snap.exists() || snap.data()?.ativo !== true) {
        await signOut(auth).catch(() => {});
        window.location.href = "./index.html?erro=admin";
        throw new Error("Usuário sem autorização administrativa.");
    }

    return { user, admin: { uid:user.uid, ...snap.data() } };
}

export function setupLayout(activePage, admin, user) {
    document.body.dataset.page = activePage;
    const name = $("#user-name");
    const email = $("#user-email");
    if (name) name.textContent = admin.nome || "Administrador";
    if (email) email.textContent = user.email || "";

    document.querySelectorAll("[data-page]").forEach(link => {
        link.classList.toggle("active", link.dataset.page === activePage);
    });

    $("#logout-button")?.addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "./index.html";
    });
}

if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js", { scope: "./" })
            .then(registration => registration.update())
            .catch(error => console.error("[Advance Admin] Service Worker:", error));
    });
}

export async function loadCollection(name) {
    const snap = await getDocs(collection(db, name));
    return snap.docs.map(item => ({ id:item.id, ...item.data() }));
}
