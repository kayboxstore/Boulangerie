/**
 * Origines web autorisées (CORS Express + Socket.io) et domaine canonique.
 *
 * Source UNIQUE partagée par app.ts et realtime.ts — Express et Socket.io ont
 * chacun leur propre configuration CORS, un piège classique où l'une des deux
 * est mise à jour et l'autre oubliée. En pratique, l'app fonctionne en
 * SAME-ORIGIN (le frontend appelle l'API en chemins relatifs, cf. app.ts) donc
 * CORS n'est pas ce qui ferait échouer une visite du nouveau domaine ; cette
 * liste sert de durcissement (elle empêche un site tiers d'appeler l'API
 * directement), pas de condition de fonctionnement.
 */
export const DOMAINE_CANONIQUE = "boulangerie-lomoto.com";

export const ORIGINES_AUTORISEES = [
  `https://${DOMAINE_CANONIQUE}`,
  `https://www.${DOMAINE_CANONIQUE}`,
  // Ancienne URL Render conservée accessible (liens déjà partagés, favoris).
  "https://boulangerie-lomoto.onrender.com",
];

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
