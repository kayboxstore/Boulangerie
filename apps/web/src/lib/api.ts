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

/** Appel API JSON avec le jeton JWT courant. Lance ApiError en cas d'échec. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && body?.code === CODE_SESSION_REMPLACEE) {
      ecouteurSessionRemplacee?.(body.erreur ?? `Erreur ${res.status}`);
    }
    throw new ApiError(res.status, body?.erreur ?? `Erreur ${res.status}`, body);
  }
  return body as T;
}
