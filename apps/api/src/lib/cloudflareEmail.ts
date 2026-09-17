/**
 * Adresse email professionnelle (section 3.18) — Cloudflare Email Routing.
 * Appel REST direct (pas de SDK). Deux endpoints DISTINCTS et non
 * substituables, avec des portées différentes :
 *   - Adresses de destination : niveau COMPTE (/accounts/{account_id}/...) —
 *     nécessite CLOUDFLARE_ACCOUNT_ID et la permission de jeton
 *     "Email Routing Addresses: Edit" (Compte).
 *   - Règles de routage : niveau ZONE (/zones/{zone_id}/...) — nécessite
 *     CLOUDFLARE_ZONE_ID et la permission "Email Routing Rules: Edit" (Zone).
 * Un jeton limité à la seule permission Zone → Email Routing Rules ne suffit
 * PAS pour créer une adresse de destination : voir docs/spec-boulangerie.md
 * et le message renvoyé à l'Admin en cas d'échec (jamais silencieux).
 */

const BASE = "https://api.cloudflare.com/client/v4";

export class ErreurCloudflare extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ErreurCF {
  code: number;
  message: string;
}
interface ReponseCF<T> {
  success: boolean;
  errors: ErreurCF[];
  result: T;
}

async function appelerCloudflare<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jeton = process.env.CLOUDFLARE_API_TOKEN;
  if (!jeton) throw new ErreurCloudflare(0, "CLOUDFLARE_API_TOKEN absent de l'environnement");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}`, ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new ErreurCloudflare(0, `Impossible de joindre l'API Cloudflare — ${message}`);
  }
  const corps = (await res.json().catch(() => null)) as ReponseCF<T> | null;
  if (!res.ok || !corps?.success) {
    const detail = corps?.errors?.length
      ? corps.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
      : `HTTP ${res.status}`;
    throw new ErreurCloudflare(res.status, detail);
  }
  return corps.result;
}

export interface DestinationCloudflare {
  id: string;
  email: string;
  /** Date de vérification, ou null tant que l'employé n'a pas cliqué le lien reçu. */
  verified: string | null;
}

/**
 * Vérifie d'abord si l'adresse de destination existe déjà (plutôt que de se
 * fier au texte d'une erreur "duplicate" non documenté de façon stable) —
 * utile si deux employés partagent la même boîte perso, ou en cas de
 * nouvelle tentative après un échec précédent.
 */
async function trouverDestinationExistante(accountId: string, email: string): Promise<DestinationCloudflare | null> {
  const cible = email.trim().toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const liste = await appelerCloudflare<DestinationCloudflare[]>(
      `/accounts/${accountId}/email/routing/addresses?page=${page}&per_page=50`,
    );
    const trouvee = liste.find((d) => d.email.toLowerCase() === cible);
    if (trouvee) return trouvee;
    if (liste.length < 50) break; // dernière page
  }
  return null;
}

/** Crée l'adresse de destination (déclenche l'email de vérification côté Cloudflare), ou réutilise une entrée déjà existante. */
export async function creerOuObtenirDestination(email: string): Promise<DestinationCloudflare> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new ErreurCloudflare(0, "CLOUDFLARE_ACCOUNT_ID absent de l'environnement");

  const existante = await trouverDestinationExistante(accountId, email);
  if (existante) return existante;

  return appelerCloudflare<DestinationCloudflare>(`/accounts/${accountId}/email/routing/addresses`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Relit l'état de vérification d'une adresse de destination déjà créée. */
export async function obtenirDestination(id: string): Promise<DestinationCloudflare> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new ErreurCloudflare(0, "CLOUDFLARE_ACCOUNT_ID absent de l'environnement");
  return appelerCloudflare<DestinationCloudflare>(`/accounts/${accountId}/email/routing/addresses/${id}`);
}

/** Crée la règle de routage adresse pro → destination. À appeler UNE FOIS la destination vérifiée. */
export async function creerRegleRoutage(adressePro: string, destination: string): Promise<{ id: string }> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) throw new ErreurCloudflare(0, "CLOUDFLARE_ZONE_ID absent de l'environnement");
  return appelerCloudflare<{ id: string }>(`/zones/${zoneId}/email/routing/rules`, {
    method: "POST",
    body: JSON.stringify({
      name: `Boîte pro — ${adressePro}`,
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: adressePro }],
      actions: [{ type: "forward", value: [destination] }],
    }),
  });
}
