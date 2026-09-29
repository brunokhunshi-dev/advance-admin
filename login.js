import { auth, db, $, getDoc, doc, signOut, onAuthStateChanged } from "./core.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

function showMessage(text) { $("#login-message").textContent = text || ""; }
function formatError(error) { return [error?.code, error?.message].filter(Boolean).join(" • "); }
function maskKey(key) { return key ? key.slice(0,6) + "…" + key.slice(-4) : "ausente"; }

function addDebug(status,title,detail="") {
    const symbols={ok:"✓",fail:"×",warn:"!"};
    $("#debug-results").insertAdjacentHTML("beforeend",
        '<div class="debug-row"><div class="debug-'+status+'">'+symbols[status]+'</div><div><strong>'+title+'</strong><small>'+detail+'</small></div></div>'
    );
}

async function runDebug() {
    const button=$("#debug-run");
    button.disabled=true; $("#debug-copy").disabled=true; $("#debug-results").innerHTML="";
    addDebug("ok","Página carregada",location.href);
    addDebug("ok","Domínio atual","hostname="+location.hostname+" • origin="+location.origin);
    addDebug("ok","Configuração Firebase","projectId="+firebaseConfig.projectId+" • apiKey="+maskKey(firebaseConfig.apiKey));
    try {
        const response=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key="+encodeURIComponent(firebaseConfig.apiKey),{
            method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
        });
        const payload=await response.json().catch(()=>({}));
        const message=payload?.error?.message || "";
        if(/API_KEY_INVALID|INVALID_API_KEY|API key not valid/i.test(message)) addDebug("fail","API key rejeitada","HTTP "+response.status+" • "+message);
        else addDebug("ok","Firebase Auth responde","HTTP "+response.status+" • "+(message||"endpoint alcançado"));
    } catch(error) { addDebug("fail","Teste da API key",formatError(error)); }
    const user=auth.currentUser;
    addDebug(user?"ok":"warn","Sessão atual",user?user.email+" • UID "+user.uid:"Nenhum usuário autenticado.");
    const failures=document.querySelectorAll(".debug-fail").length;
    $("#debug-summary").textContent=failures?failures+" falha(s) detectada(s).":"Diagnóstico concluído.";
    $("#debug-copy").disabled=false; button.disabled=false;
}

$("#debug-toggle").addEventListener("click",()=>{
    const panel=$("#debug-panel"),open=panel.hidden;
    panel.hidden=!open; $("#debug-toggle").setAttribute("aria-expanded",String(open));
});
$("#debug-run").addEventListener("click",runDebug);
$("#debug-copy").addEventListener("click",async()=>{
    const value=[...document.querySelectorAll(".debug-row")].map(row=>row.innerText.replace(/\n/g," — ")).join("\n");
    try { await navigator.clipboard.writeText(value); $("#debug-summary").textContent="Resultado copiado."; }
    catch { $("#debug-summary").textContent=value; }
});

const params=new URLSearchParams(location.search);
if(params.get("erro")==="admin") showMessage("A autenticação foi concluída, mas esta conta não está cadastrada como administradora.");

onAuthStateChanged(auth,user=>{
    if(!user) return;
    getDoc(doc(db,"administradores",user.uid)).then(snap=>{
        if(snap.exists() && snap.data()?.ativo===true) window.location.href="./dashboard.html";
    }).catch(console.error);
});

$("#login-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const button=$("#login-button");
    button.disabled=true; button.textContent="Entrando..."; showMessage("");
    try {
        const credential=await signInWithEmailAndPassword(auth,$("#login-email").value.trim(),$("#login-password").value);
        const snap=await getDoc(doc(db,"administradores",credential.user.uid));
        if(!snap.exists()){await signOut(auth);showMessage("Conta autenticada, mas sem cadastro em administradores. UID: "+credential.user.uid);return;}
        if(snap.data()?.ativo!==true){await signOut(auth);showMessage("A conta existe como administradora, mas está inativa.");return;}
        window.location.href="./dashboard.html";
    } catch(error) { console.error(error); showMessage(formatError(error)||"Não foi possível entrar."); }
    finally { button.disabled=false; button.textContent="Entrar"; }
});
