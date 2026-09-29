const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

initializeApp();

const db = getFirestore();
const auth = getAuth();

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
const SMTP_HOST = defineString("SMTP_HOST");
const SMTP_PORT = defineString("SMTP_PORT", { default: "587" });
const SMTP_SECURE = defineString("SMTP_SECURE", { default: "false" });
const SMTP_USER = defineString("SMTP_USER");
const SMTP_FROM = defineString("SMTP_FROM");

const ALLOWED_COLLECTIONS = new Set(["promotores", "assistencia"]);
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function requireAdmin(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Faça login novamente.");

  const adminSnap = await db.doc(`administradores/${request.auth.uid}`).get();
  if (!adminSnap.exists || adminSnap.data()?.ativo !== true) {
    throw new HttpsError("permission-denied", "Conta sem permissão administrativa.");
  }

  return { uid: request.auth.uid, ...adminSnap.data() };
}

function validateTarget(collectionName, memberId) {
  if (!ALLOWED_COLLECTIONS.has(collectionName)) {
    throw new HttpsError("invalid-argument", "Coleção de equipe inválida.");
  }
  if (!memberId || typeof memberId !== "string") {
    throw new HttpsError("invalid-argument", "Profissional inválido.");
  }
}

function hashCode(requestId, code, salt) {
  return crypto
    .createHash("sha256")
    .update(`${requestId}:${code}:${salt}`)
    .digest("hex");
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "e-mail cadastrado";
  const visible = local.slice(0, Math.min(2, local.length));
  return visible + "•••@" + domain;
}

function mailTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: Number(SMTP_PORT.value()),
    secure: SMTP_SECURE.value() === "true",
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASSWORD.value()
    }
  });
}

exports.requestTeamMemberDeletion = onCall(
  { secrets: [SMTP_PASSWORD] },
  async request => {
    const admin = await requireAdmin(request);
    const { collection: collectionName, memberId } = request.data || {};
    validateTarget(collectionName, memberId);

    const memberRef = db.doc(`${collectionName}/${memberId}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) throw new HttpsError("not-found", "Profissional não encontrado.");

    const member = memberSnap.data() || {};
    const email = String(member.email || "").trim().toLowerCase();
    if (!email) throw new HttpsError("failed-precondition", "Este profissional não possui e-mail cadastrado.");

    const requestRef = db.collection("exclusoes_usuario").doc();
    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);

    await requestRef.set({
      collection: collectionName,
      memberId,
      email,
      codeHash: hashCode(requestRef.id, code, salt),
      salt,
      expiresAt,
      requestedBy: admin.uid,
      requestedAt: FieldValue.serverTimestamp(),
      status: "pendente",
      attempts: 0
    });

    const transporter = mailTransport();
    await transporter.sendMail({
      from: SMTP_FROM.value(),
      to: email,
      subject: "Código de confirmação — exclusão de acesso Advance Check",
      text:
        `Foi solicitada a exclusão do seu acesso ao Advance Check.\n\n` +
        `Código de confirmação: ${code}\n\n` +
        `O código expira em 10 minutos. Se você não reconhece esta solicitação, contate seu gestor.`,
      html:
        `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#20202a">` +
        `<p>Foi solicitada a exclusão do seu acesso ao <strong>Advance Check</strong>.</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` +
        `<p>O código expira em 10 minutos. Se você não reconhece esta solicitação, contate seu gestor.</p>` +
        `</div>`
    });

    return {
      requestId: requestRef.id,
      maskedEmail: maskEmail(email),
      expiresInSeconds: CODE_TTL_MS / 1000
    };
  }
);

exports.confirmTeamMemberDeletion = onCall(async request => {
  const admin = await requireAdmin(request);
  const { requestId, code } = request.data || {};

  if (!requestId || !/^\d{6}$/.test(String(code || ""))) {
    throw new HttpsError("invalid-argument", "Código de confirmação inválido.");
  }

  const requestRef = db.doc(`exclusoes_usuario/${requestId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) throw new HttpsError("not-found", "Solicitação não encontrada.");

  const deletion = requestSnap.data() || {};
  if (deletion.requestedBy !== admin.uid) {
    throw new HttpsError("permission-denied", "Esta confirmação pertence a outro administrador.");
  }
  if (deletion.status !== "pendente") {
    throw new HttpsError("failed-precondition", "Esta solicitação já foi encerrada.");
  }
  if (deletion.expiresAt?.toMillis?.() < Date.now()) {
    await requestRef.update({ status: "expirado" });
    throw new HttpsError("deadline-exceeded", "O código expirou. Solicite um novo.");
  }
  if ((deletion.attempts || 0) >= MAX_ATTEMPTS) {
    throw new HttpsError("resource-exhausted", "Limite de tentativas excedido.");
  }

  const expected = Buffer.from(deletion.codeHash, "hex");
  const actual = Buffer.from(hashCode(requestId, String(code), deletion.salt), "hex");
  const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!valid) {
    await requestRef.update({ attempts: FieldValue.increment(1) });
    throw new HttpsError("permission-denied", "Código incorreto.");
  }

  validateTarget(deletion.collection, deletion.memberId);
  const memberRef = db.doc(`${deletion.collection}/${deletion.memberId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new HttpsError("not-found", "Profissional já removido.");

  const profile = memberSnap.data() || {};

  try {
    const authUser = await auth.getUserByEmail(deletion.email);
    await auth.deleteUser(authUser.uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  const archiveRef = db.collection("usuarios_excluidos").doc(
    `${deletion.collection}_${deletion.memberId}_${Date.now()}`
  );

  const batch = db.batch();
  batch.set(archiveRef, {
    colecaoOrigem: deletion.collection,
    memberId: deletion.memberId,
    perfil: profile,
    excluidoEm: FieldValue.serverTimestamp(),
    excluidoPor: admin.uid
  });
  batch.delete(memberRef);
  batch.update(requestRef, {
    status: "concluido",
    confirmedAt: FieldValue.serverTimestamp()
  });
  await batch.commit();

  return { success: true };
});

exports.updateTeamMemberEmail = onCall(async request => {
  const admin = await requireAdmin(request);
  const { collection: collectionName, memberId, newEmail } = request.data || {};
  validateTarget(collectionName, memberId);

  const normalized = String(newEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpsError("invalid-argument", "E-mail inválido.");
  }

  const memberRef = db.doc(`${collectionName}/${memberId}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new HttpsError("not-found", "Profissional não encontrado.");

  const oldEmail = String(memberSnap.data()?.email || "").trim().toLowerCase();
  if (oldEmail && oldEmail !== normalized) {
    try {
      const authUser = await auth.getUserByEmail(oldEmail);
      await auth.updateUser(authUser.uid, { email: normalized });
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }

  await memberRef.update({
    email: normalized,
    atualizadoEm: FieldValue.serverTimestamp(),
    atualizadoPor: admin.uid
  });

  return { success: true, email: normalized };
});
