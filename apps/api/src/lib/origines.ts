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
// Domaine CANONIQUE = www, pas l'apex. Contre-intuitif (l'usage récent va
// plutôt vers l'apex sans www), mais Render redirige DÉJÀ l'apex vers www à
// son edge (avant même que cette app ne reçoive la requête — probablement
// « www » choisi comme domaine principal au moment d'ajouter le domaine
// personnalisé dans Render). Un premier essai en sens inverse (apex
// canonique) a provoqué une boucle de redirection infinie : Render renvoie
// apex→www, cette app renvoyait www→apex. Sans accès au tableau de bord
// Render pour changer leur réglage, la seule sortie de boucle est de suivre
// leur choix plutôt que de le contredire.
export const APEX = "boulangerie-lomoto.com";
export const DOMAINE_CANONIQUE = `www.${APEX}`;
export const DOMAINE_A_REDIRIGER = APEX;

export const ORIGINES_AUTORISEES = [
  `https://${DOMAINE_CANONIQUE}`,
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
