// src/claude.js
// Appel à l'API Claude avec définition d'outils métier (créer commande / escalader)

const catalog = require("./catalog.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

const catalogSummary = catalog.produits
  .map(
    (p) =>
      `- ${p.nom} (${p.categorie}) — ${p.prix ? p.prix + " " + catalog.devise : "prix à confirmer"} — ${
        p.stock ? "en stock" : "rupture"
      } — ${p.description}`
  )
  .join("\n");

const SYSTEM_PROMPT = `Tu es l'assistant WhatsApp de la boutique "${catalog.boutique}", basée à Dosso, au Niger. Tu vends des vêtements modestes et accessoires : abayas, hijabs, boubous, jallabiyas, foulards.

Langues : réponds TOUJOURS dans la langue utilisée par le client (français ou haoussa). Si le client mélange les deux ou est ambigu, réponds en français par défaut.

Ton rôle :
1. Répondre aux questions sur les produits, prix et disponibilité, en te basant uniquement sur le catalogue ci-dessous.
2. Aider le client à passer une commande complète (produit(s), quantité, couleur/taille si pertinent, nom du client, numéro de téléphone, ville/quartier de livraison).
3. Une fois TOUTES les informations de commande réunies et confirmées par le client, appelle l'outil create_order.
4. Si le client demande explicitement à parler à un humain, ou si sa demande sort du cadre de la boutique (réclamation, problème technique, négociation de prix), appelle l'outil escalate_human.

Catalogue actuel :
${catalogSummary}

Sois chaleureux, concis, et adapté à une conversation WhatsApp (messages courts, pas de longs paragraphes). Ne confirme jamais un prix qui n'est pas dans le catalogue.`;

const TOOLS = [
  {
    name: "create_order",
    description:
      "Enregistre une commande finalisée et confirmée par le client. À appeler uniquement quand toutes les informations sont réunies.",
    input_schema: {
      type: "object",
      properties: {
        client_nom: { type: "string" },
        client_telephone: { type: "string" },
        ville_quartier: { type: "string" },
        articles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nom_produit: { type: "string" },
              quantite: { type: "integer" },
              details: { type: "string", description: "couleur, taille, etc." },
            },
            required: ["nom_produit", "quantite"],
          },
        },
        total_estime: { type: "string" },
      },
      required: ["client_nom", "client_telephone", "ville_quartier", "articles"],
    },
  },
  {
    name: "escalate_human",
    description:
      "Signale qu'un humain (Medo) doit prendre le relais de la conversation.",
    input_schema: {
      type: "object",
      properties: {
        raison: { type: "string" },
      },
      required: ["raison"],
    },
  },
];

/**
 * Envoie l'historique de conversation à Claude et retourne la réponse structurée.
 * @param {Array} history - liste de messages {role, content}
 * @returns {Promise<{replyText: string, toolCalls: Array}>}
 */
async function askClaude(history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Erreur API Claude:", res.status, errText);
    return {
      replyText:
        "Désolé, une erreur technique est survenue. Réessaie dans un instant. 🙏",
      toolCalls: [],
      rawContent: null,
    };
  }

  const data = await res.json();

  let replyText = "";
  const toolCalls = [];

  for (const block of data.content) {
    if (block.type === "text") replyText += block.text;
    if (block.type === "tool_use") toolCalls.push(block);
  }

  return { replyText, toolCalls, rawContent: data.content, stopReason: data.stop_reason };
}

module.exports = { askClaude };