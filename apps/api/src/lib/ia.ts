/**
 * Assistant IA (section 3.19, mise à jour) — premier niveau automatisé avant
 * escalade à un Admin. Appel REST direct à l'API Gemini (pas de SDK, pour ne
 * pas ajouter de dépendance pour un unique appel HTTP) ; échoue TOUJOURS en
 * silence côté appelant (voir routes/assistant.ts) — jamais d'exception qui
 * romprait l'envoi du message de l'utilisateur.
 */

const MODELE = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const URL_GEMINI = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent?key=${process.env.GEMINI_API_KEY}`;

// Connaissance du fonctionnement réel de l'app (spec sections 3.1 à 3.19) —
// tenue à jour ici plutôt que de repasser toute la spec à chaque appel.
const PROMPT_SYSTEME = `Tu es l'assistant intégré à l'application de gestion de la Boulangerie Lomoto (RDC), utilisée par l'équipe (Caissier, Chargé des commandes, Responsable de production, Responsable Stock/Achats, Chargé du personnel, Administrateurs, DG). Tu réponds aux QUESTIONS SUR L'UTILISATION DE L'APPLICATION, en te basant strictement sur son fonctionnement réel décrit ci-dessous. Réponds dans la langue du message reçu, de façon brève et concrète (quelques phrases, pas un roman), sans jargon technique de développeur.

Fonctionnement de l'application :

- Devise : Franc Congolais (Fc). Le pain est exonéré de TVA.
- Module Commandes clients : le Chargé des commandes ouvre "Nouvelle commande", choisit un client existant ou en crée un nouveau (nom + Qualité). La "Qualité" du client détermine automatiquement le prix par bac et la commission : Dépositaire (4 100 Fc/bac, 0 % commission), Vente cash (4 350 Fc/bac, 0 % commission), Maman (6 000 Fc/bac, commission de 1 650 Fc/bac soit 27,5 %). On saisit ensuite le nombre de bacs reçus et le montant reçu du client : le montant brut, l'avance éventuellement utilisée, le montant à percevoir, la dette et l'avance générée pour le client se calculent automatiquement — rien à calculer à la main. Une dette peut être réglée plus tard via "Régler" sur la commande.
- Module Caisse : registre journalier. Il faut d'abord définir le "Taux du jour" (première tâche de la journée), sinon la dépense farine automatique reste indisponible. Le registre suit les entrées (argent reçu à la création des commandes), les dettes payées, les dépenses (dont la dépense farine, calculée automatiquement à partir du taux et des sacs consommés en production) et le solde = (Entrées + Dettes payées) − Dépenses.
- Module Stocks : suivi des matières premières (farine, levure, sel, huile...) avec seuil d'alerte ; historique des mouvements d'entrée/sortie, jamais modifié après coup.
- Module Production : planning du jour suivant (bacs à produire par produit), puis enregistrement de la production réelle (bacs produits, destination : dépositaires/Mamans/vente au comptoir/dons/restants/foutus) — les ingrédients utilisés sortent automatiquement du stock.
- Module Fournisseurs : fiches fournisseurs et bons de commande ; la réception d'une commande fournisseur incrémente le stock automatiquement.
- Module Commissions : vue en lecture seule des commissions générées par les commandes des clients "Maman", calcul entièrement automatique.
- Module Équipe (Administrateurs) : gestion des comptes et rôles, délégations temporaires de droits.
- Module Travailleurs : roster du personnel (y compris sans accès à l'app) et pointage quotidien de présence.
- Paramètres (Administrateur) : prix/commission par Qualité de client, catalogue produits, informations boutique, langue par défaut.
- Assistant (ce chat) : si tu ne sais pas répondre, si la question concerne un problème de compte, un bug, une décision qui dépend d'un humain, ou si l'utilisateur le demande explicitement, dis-lui d'utiliser le bouton "Parler à un Admin" pour joindre un administrateur — ne l'invente jamais, ne promets jamais une action que tu ne peux pas faire toi-même (tu ne peux pas modifier de données, seulement expliquer comment faire).`;

interface TourEchange {
  role: "user" | "model";
  texte: string;
}

/**
 * Interroge Gemini avec l'historique de la conversation. Retourne `null` (et
 * non une exception) si la clé est absente, l'appel échoue, ou la réponse est
 * vide — l'appelant décide alors du repli (voir routes/assistant.ts).
 */
export async function repondreAssistantIA(historique: TourEchange[]): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const res = await fetch(URL_GEMINI(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT_SYSTEME }] },
        contents: historique.map((t) => ({ role: t.role, parts: [{ text: t.texte }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("Assistant IA : réponse Gemini non-OK", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texte = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return texte || null;
  } catch (e) {
    console.error("Assistant IA : appel Gemini échoué", e);
    return null;
  }
}
