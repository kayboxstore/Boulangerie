/**
 * Client HTTP vers le service central de licences (dépôt et déploiement
 * séparés — kayboxstore/licences-activation). Cette instance ne fait jamais
 * confiance à un état stocké uniquement en local : voir services/licenceLocale.ts
 * pour la logique de cache et le calcul de blocage.
 *
 * Variables d'environnement requises (placeholders tant que le service
 * central n'est pas déployé — voir SECRET_SERVICE_LICENCES, URL_SERVICE_LICENCES,
 * IDENTIFIANT_INSTANCE dans .env.example) :
 *  - URL_SERVICE_LICENCES : base URL du service (sans slash final), ex.
 *    https://licences.boulangerie-lomoto.com
 *  - SECRET_SERVICE_LICENCES : secret partagé, envoyé dans l'en-tête
 *    X-Secret-Service — jamais exposé au navigateur.
 *  - IDENTIFIANT_INSTANCE : identifiant fixe de CE déploiement, indépendant
 *    de toute donnée en base (survit à une réinitialisation).
 */

export interface ReponseServiceLicences {
  statut: "ACTIVE" | "ESSAI" | "EXPIREE";
  joursRestants?: number;
  nomClient?: string;
  erreurActivation?: string;
}

export class ErreurServiceLicences extends Error {}

const DELAI_TIMEOUT_MS = 10_000;

/**
 * Appelle POST {URL_SERVICE_LICENCES}/verifier. Sans `cleLicence`, c'est une
 * simple vérification périodique ; avec, c'est une tentative d'association
 * (voir services/licenceLocale.ts::activerLicence).
 *
 * Lève `ErreurServiceLicences` sur tout échec (variables d'environnement
 * absentes, réseau, timeout, réponse HTTP non 2xx, corps JSON inexploitable)
 * — jamais de valeur de repli silencieuse : l'appelant décide explicitement
 * quoi faire d'un échec (le job périodique l'ignore en conservant le cache,
 * la route d'activation le traduit en 503).
 */
export async function appellerServiceLicences(cleLicence?: string): Promise<ReponseServiceLicences> {
  const url = process.env.URL_SERVICE_LICENCES;
  const secret = process.env.SECRET_SERVICE_LICENCES;
  const identifiantInstance = process.env.IDENTIFIANT_INSTANCE;
  if (!url || !secret || !identifiantInstance) {
    throw new ErreurServiceLicences(
      "Variables d'environnement du service de licences absentes (URL_SERVICE_LICENCES / SECRET_SERVICE_LICENCES / IDENTIFIANT_INSTANCE)",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${url}/verifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Secret-Service": secret },
      body: JSON.stringify({ identifiantInstance, ...(cleLicence ? { cleLicence } : {}) }),
      signal: AbortSignal.timeout(DELAI_TIMEOUT_MS),
    });
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new ErreurServiceLicences(`Impossible de joindre le service de licences — ${message}`);
  }

  const corps = (await res.json().catch(() => null)) as { statut?: unknown } | null;
  if (!res.ok || !corps || typeof corps.statut !== "string") {
    throw new ErreurServiceLicences(`Réponse invalide du service de licences (HTTP ${res.status})`);
  }

  return corps as ReponseServiceLicences;
}
