// src/server.js
require("dotenv").config();
const express = require("express");
const { sendText, notifyOwner, parseIncomingMessage } = require("./whatsapp");
const { askClaude } = require("./claude");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Historique de conversation en mémoire, par numéro de téléphone client.
// ⚠️ En mémoire = perdu au redémarrage. Voir README pour une version persistante (base de données).
const conversations = new Map();
const MAX_HISTORY_MESSAGES = 20; // limite pour ne pas faire exploser le coût/contexte

function getHistory(from) {
  if (!conversations.has(from)) conversations.set(from, []);
  return conversations.get(from);
}

function pushMessage(from, role, content) {
  const history = getHistory(from);
  history.push({ role, content });
  if (history.length > MAX_HISTORY_MESSAGES) {
    conversations.set(from, history.slice(-MAX_HISTORY_MESSAGES));
  }
}

// --- 1. Vérification du webhook (obligatoire pour Meta) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook vérifié avec succès.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Réception des messages entrants ---
app.post("/webhook", async (req, res) => {
  // Répondre immédiatement à Meta pour éviter les retries/timeouts
  res.sendStatus(200);

  const incoming = parseIncomingMessage(req.body);
  if (!incoming) return; // pas un message texte exploitable (statut, accusé de lecture, etc.)

  const { from, text, contactName } = incoming;
  console.log(`Message reçu de ${contactName} (${from}): ${text}`);

  try {
    pushMessage(from, "user", text);

    let { replyText, toolCalls, rawContent, stopReason } = await askClaude(
      getHistory(from)
    );

    // Si Claude a répondu du texte, on l'enregistre et on l'envoie
    if (replyText.trim()) {
      pushMessage(from, "assistant", rawContent);
      await sendText(from, replyText.trim());
    }

    // Traitement des outils appelés par Claude
    for (const call of toolCalls) {
      if (call.name === "create_order") {
        await handleCreateOrder(from, contactName, call.input);
      }
      if (call.name === "escalate_human") {
        await handleEscalate(from, contactName, call.input);
      }
    }

    // Si Claude s'est arrêté pour appeler un outil, on doit lui répondre avec le
    // résultat de l'outil pour qu'il termine proprement la conversation avec le client.
    if (stopReason === "tool_use" && toolCalls.length > 0) {
      const toolResults = toolCalls.map((call) => ({
        type: "tool_result",
        tool_use_id: call.id,
        content: "OK, enregistré.",
      }));
      pushMessage(from, "user", toolResults);

      const followUp = await askClaude(getHistory(from));
      if (followUp.replyText.trim()) {
        pushMessage(from, "assistant", followUp.rawContent);
        await sendText(from, followUp.replyText.trim());
      }
    }
  } catch (err) {
    console.error("Erreur traitement message:", err);
    await sendText(
      from,
      "Désolé, une erreur est survenue. Un membre de notre équipe va te répondre bientôt. 🙏"
    );
    await notifyOwner(
      `⚠️ Erreur technique sur une conversation avec ${contactName} (${from}). Vérifie les logs du serveur.`
    );
  }
});

async function handleCreateOrder(from, contactName, order) {
  const articlesText = (order.articles || [])
    .map((a) => `  • ${a.quantite} × ${a.nom_produit}${a.details ? ` (${a.details})` : ""}`)
    .join("\n");

  const message =
    `🛒 NOUVELLE COMMANDE — Éclat Niger\n\n` +
    `Client : ${order.client_nom} (${contactName})\n` +
    `Téléphone : ${order.client_telephone}\n` +
    `Livraison : ${order.ville_quartier}\n\n` +
    `Articles :\n${articlesText}\n\n` +
    (order.total_estime ? `Total estimé : ${order.total_estime}\n\n` : "") +
    `Conversation WhatsApp : ${from}`;

  await notifyOwner(message);
}

async function handleEscalate(from, contactName, input) {
  const message =
    `🙋 DEMANDE D'ASSISTANCE HUMAINE\n\n` +
    `Client : ${contactName} (${from})\n` +
    `Raison : ${input.raison || "non précisée"}\n\n` +
    `Merci de répondre directement sur WhatsApp au client.`;

  await notifyOwner(message);
}

app.listen(PORT, () => {
  console.log(`Agent Éclat Niger démarré sur le port ${PORT}`);
});