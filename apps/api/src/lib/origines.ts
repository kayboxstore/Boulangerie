/**
 * Origines web autorisées (CORS Express + Socket.io) et domaine canonique.
 *
 * Source UNIQUE partagée par app.ts et realtime.ts — Express et Socket.io ont
 * chacun leur propre configuration CORS, un piège classique où l'une des deux
 * est mise à jour et l'autre oubliée. En pratique, l'app fonctionne en
 * SAME-ORIGIN (le frontend appelle l'API en chemins relatifs, cf. app.ts) donc
 * CORS n'est pas ce qui ferait échouer une visite du domaine ; cette liste
 * sert de durcissement (elle empêche un site tiers d'appeler l'API
 * directement), pas de condition de fonctionnement.
 */
// APEX = le domaine de base (boulangerie-lomoto.com), utilisé pour la
// génération des adresses email professionnelles (services/emailPro.ts,
// Cloudflare Email Routing) — un domaine EST toujours à un seul niveau
// (Cloudflare gère les emails pour tout le domaine), indépendamment de quel
// sous-domaine sert l'app de gestion. Ne pas réutiliser APEX pour une
// redirection web ou une origine CORS : depuis la migration vers un site
// vitrine sur l'apex, cette app ne possède plus ce domaine côté web, seul
// DOMAINE_CANONIQUE (le sous-domaine gestion.) compte pour ça.
export const APEX = "boulangerie-lomoto.com";

// Domaine CANONIQUE de l'app de gestion = un sous-domaine dédié
// (gestion.boulangerie-lomoto.com), destiné à remplacer www/apex une fois
// qu'un site vitrine public sera en place sur la racine du domaine.
export const DOMAINE_CANONIQUE = `gestion.${APEX}`;

export const ORIGINES_AUTORISEES = [
  `https://${DOMAINE_CANONIQUE}`,
  // www/apex : ENCORE autorisés pendant la transition — l'app de gestion y
  // répond toujours aujourd'hui, tant que le site vitrine n'est pas déployé
  // et le DNS pas repointé. À retirer explicitement une fois la bascule
  // confirmée (voir docs/coordination/ pour le suivi de cette migration),
  // pas avant : les retirer prématurément casserait l'accès réel de
  // l'équipe à l'app pendant la période de transition.
  `https://www.${APEX}`,
  `https://${APEX}`,
  // Ancienne URL Render conservée accessible (liens déjà partagés, favoris).
  "https://boulangerie-lomoto.onrender.com",
  // URL Render réelle du service courant — injectée automatiquement par
  // Render (aucune configuration requise), donc toujours à jour même après
  // un changement de compte/service qui change le suffixe .onrender.com
  // (ex. boulangerie-lomoto-0cls.onrender.com). Absente hors Render (dev
  // local) : filtrée avant d'être ajoutée, jamais une chaîne vide dans la
  // liste.
  process.env.RENDER_EXTERNAL_URL,
].filter((origine): origine is string => Boolean(origine));

/**
 * Callback de validation d'origine, au format attendu à la fois par le paquet
 * `cors` (Express) et par les options `cors` de Socket.io — une seule
 * implémentation, utilisée aux deux endroits.
 */
export function verifierOrigine(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) {
  // Pas d'en-tête Origin : requête same-origin, appel serveur à serveur, ou
  // outil en ligne de commande — rien à valider.
  if (!origin) return callback(null, true);
  if (ORIGINES_AUTORISEES.includes(origin)) return callback(null, true);
  // Hors production (dev local sur le réseau Wi-Fi, port/IP variables), on
  // reste permissif : le trafic dev passe de toute façon par le proxy Vite,
  // qui rend cette branche same-origin et donc rarement sollicitée.
  if (process.env.NODE_ENV !== "production") return callback(null, true);
  callback(new Error("Origine non autorisée"));
}
