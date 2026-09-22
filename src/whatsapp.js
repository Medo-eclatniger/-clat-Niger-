// src/whatsapp.js
// Envoi et réception de messages via l'API WhatsApp Business Cloud (Meta Graph API)

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH_VERSION = "v21.0";

const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

/**
 * Envoie un message texte simple à un numéro WhatsApp.
 * @param {string} to - numéro au format international sans "+" (ex: "22790000000")
 * @param {string} body - texte du message
 */
async function sendText(to, body) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Erreur envoi WhatsApp:", res.status, errText);
  }
  return res.ok;
}

/**
 * Envoie une notification à Medo (le propriétaire) — commande finalisée
 * ou demande d'intervention humaine.
 */
async function notifyOwner(text) {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!ownerNumber) {
    console.warn("OWNER_WHATSAPP_NUMBER non configuré — notification non envoyée.");
    return;
  }
  await sendText(ownerNumber, text);
}

/**
 * Extrait le message entrant depuis le payload du webhook Meta.
 * Retourne null si ce n'est pas un message texte utilisateur.
 */
function parseIncomingMessage(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null;

    const from = message.from; // numéro de l'expéditeur
    const text =
      message.text?.body ??
      message.button?.text ??
      message.interactive?.button_reply?.title ??
      null;

    const contactName = value?.contacts?.[0]?.profile?.name ?? "Client";

    if (!text) return null;
    return { from, text, contactName };
  } catch (e) {
    console.error("Erreur parsing webhook:", e);
    return null;
  }
}

module.exports = { sendText, notifyOwner, parseIncomingMessage };