import { CODE_SESSION_REMPLACEE } from "@lomoto/shared";

const TOKEN_KEY = "lomoto_token";

// Session unique (section 3.7) : callback appelé dès qu'une réponse HTTP
// signale que la session courante a été remplacée (connexion depuis un autre
// appareil). Enregistré par AuthProvider — évite une dépendance circulaire
// entre ce module et lib/auth.tsx.
type EcouteurSessionRemplacee = (message: string) => void;
let ecouteurSessionRemplacee: EcouteurSessionRemplacee | null = null;

export function surSessionRemplacee(fn: EcouteurSessionRemplacee | null) {
  ecouteurSessionRemplacee = fn;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Corps JSON complet de la réponse — certaines erreurs portent des données
     *  exploitables (ex. 409 de doublon de commande : la commande en conflit). */
    public corps?: unknown,
  ) {
    super(message);
  }
}

// Ton des textes (section 3.8) : un utilisateur ne code pas — jamais de code
// HTTP brut ni de message technique du navigateur affiché tel quel. Ce
// message de repli ne sert que si le serveur répond sans corps JSON
// exploitable (ex. panne en amont du serveur applicatif) ; en fonctionnement
// normal, chaque route renvoie déjà un champ `erreur` en français.
const MESSAGE_ERREUR_GENERIQUE = "Une erreur est survenue. Réessayez dans un instant.";
const MESSAGE_SERVEUR_INJOIGNABLE = "Impossible de contacter le serveur — vérifiez votre connexion internet.";

/** Appel API JSON avec le jeton JWT courant. Lance ApiError en cas d'échec. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // Le serveur n'a jamais répondu (réseau coupé, hors ligne…) : fetch() lève
    // un TypeError au message anglais et technique ("Failed to fetch") — on ne
    // le laisse jamais remonter tel quel jusqu'à l'écran.
    throw new ApiError(0, MESSAGE_SERVEUR_INJOIGNABLE);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body?.erreur === "string" ? body.erreur : MESSAGE_ERREUR_GENERIQUE;
    if (res.status === 401 && body?.code === CODE_SESSION_REMPLACEE) {
      ecouteurSessionRemplacee?.(message);
    }
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
