import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { EtatInitialDTO, Langue, LoginResponse, Module, UtilisateurDTO } from "@lomoto/shared";
import { aAcces, LANGUE_DEFAUT_PAR_DEFAUT, langueEffective } from "@lomoto/shared";
import { api, getToken, setToken, surSessionRemplacee } from "./api";
import { appliquerLangue } from "@/i18n";

interface AuthContextValue {
  utilisateur: UtilisateurDTO | null;
  chargement: boolean;
  login: (email: string, motDePasse: string) => Promise<void>;
  logout: () => void;
  peutLire: (module: Module) => boolean;
  peutEcrire: (module: Module) => boolean;
  /** Langue par défaut de la boutique (repli quand l'utilisateur n'a pas de préférence). */
  langueDefautBoutique: Langue;
  /** Change sa propre préférence de langue (null = suivre la boutique). */
  changerLangue: (langue: Langue | null) => Promise<void>;
  /** Session unique (section 3.7) : message à afficher sur /connexion après une
   *  déconnexion forcée (autre appareil), distinct d'une erreur de connexion. */
  messageSessionRemplacee: string | null;
  /** Déconnecte immédiatement avec un message dédié (401 SESSION_REMPLACEE ou
   *  événement Socket.io `sessionInvalidee`). */
  deconnexionForcee: (message: string) => void;
  /** Assistant de premier lancement (3.7) : true si la base ne contient aucun
   *  compte Utilisateur (premier démarrage, ou juste après une réinitialisation). */
  premierLancement: boolean;
  /**
   * Identifiant opaque et monotone de la session d'authentification courante
   * (F3, isolation de session de Constellation Lomoto). Change après chaque
   * authentification EFFECTIVE (restauration initiale réussie via
   * `GET /api/auth/me`, `login()` réussi) ; `null` quand personne n'est
   * connecté. Ne change JAMAIS pour une simple mise à jour d'identité dans la
   * même session (`rafraichirIdentite()`). Ne contient jamais le jeton JWT
   * brut — sert uniquement à qualifier des données mises en cache (ex. clé
   * React Query) par session, pour qu'aucune donnée d'une session précédente
   * ne survive à une déconnexion/reconnexion dans le même onglet.
   */
  sessionAuthId: string | null;
  /**
   * Recharge l'identité depuis `GET /api/auth/me` sans repasser par `login()`
   * (F3, changement de mot de passe obligatoire) : après un `POST
   * /api/auth/mot-de-passe` réussi, `motDePasseDoitChanger` doit repasser à
   * `false` UNIQUEMENT une fois confirmé par le serveur — jamais en local en
   * anticipant la réponse.
   *
   * Retourne `true` si l'identité a bien été appliquée, `false` si la réponse
   * a été ignorée parce que la session a changé pendant l'attente réseau
   * (déconnexion, ou nouvelle connexion) — dans ce cas, aucun état n'est
   * modifié : ni ancien utilisateur restauré, ni nouvel utilisateur écrasé.
   */
  rafraichirIdentite: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<UtilisateurDTO | null>(null);
  const [langueDefautBoutique, setLangueDefautBoutique] = useState<Langue>(LANGUE_DEFAUT_PAR_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [messageSessionRemplacee, setMessageSessionRemplacee] = useState<string | null>(null);
  const [premierLancement, setPremierLancement] = useState(false);
  const [sessionAuthId, setSessionAuthId] = useState<string | null>(null);

  // Génération de session (F3, même principe que socket.tsx) : incrémentée à
  // chaque événement qui peut invalider une réponse réseau encore en vol
  // (authentification effective OU déconnexion). `rafraichirIdentite()`
  // capture la génération courante avant son appel réseau et la revérifie au
  // retour — si elle a changé, la réponse tardive est intégralement ignorée.
  const generationAuthRef = useRef(0);

  const avancerGenerationAuth = useCallback((authentifie: boolean) => {
    generationAuthRef.current += 1;
    setSessionAuthId(authentifie ? `sess-${generationAuthRef.current}` : null);
  }, []);

  // Applique la langue effective : préférence de l'utilisateur, sinon boutique.
  const appliquer = useCallback((u: UtilisateurDTO | null, defautBoutique: Langue) => {
    appliquerLangue(langueEffective(u?.languePreferee ?? null, defautBoutique));
  }, []);

  // Assistant de premier lancement (3.7) : revérifié après toute déconnexion
  // forcée (ex. réinitialisation de la base, section 3.15) — le premier
  // chargement seul ne suffit pas, l'état peut changer en cours de session.
  const rafraichirEtatInitial = useCallback(async () => {
    try {
      const r = await api<EtatInitialDTO>("/api/auth/etat-initial");
      setPremierLancement(r.premierLancement);
    } catch {
      // Au pire, l'écran de connexion normal reste affiché.
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      // Pré-connexion : la page de connexion suit la langue par défaut boutique.
      Promise.all([
        api<{ langueDefaut: Langue }>("/api/auth/langue-defaut").catch(() => null),
        api<EtatInitialDTO>("/api/auth/etat-initial").catch(() => null),
      ])
        .then(([langueRes, etatRes]) => {
          if (langueRes) {
            setLangueDefautBoutique(langueRes.langueDefaut);
            appliquer(null, langueRes.langueDefaut);
          }
          if (etatRes) setPremierLancement(etatRes.premierLancement);
        })
        .finally(() => setChargement(false));
      return;
    }
    api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/me")
      .then((r) => {
        setUtilisateur(r.utilisateur);
        setLangueDefautBoutique(r.langueDefautBoutique);
        appliquer(r.utilisateur, r.langueDefautBoutique);
        // Authentification effective (restauration initiale) : nouvel
        // identifiant de session public (F3).
        avancerGenerationAuth(true);
      })
      .catch(() => setToken(null))
      .finally(() => setChargement(false));
  }, [appliquer, avancerGenerationAuth]);

  const login = useCallback(
    async (email: string, motDePasse: string) => {
      const r = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, motDePasse }),
      });
      setToken(r.token);
      setUtilisateur(r.utilisateur);
      setLangueDefautBoutique(r.langueDefautBoutique);
      setMessageSessionRemplacee(null);
      appliquer(r.utilisateur, r.langueDefautBoutique);
      // Authentification effective (nouvelle connexion) : nouvel identifiant
      // de session public, distinct de toute session précédente (F3).
      avancerGenerationAuth(true);
    },
    [appliquer, avancerGenerationAuth],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUtilisateur(null);
    setMessageSessionRemplacee(null);
    // Retour à la langue par défaut de la boutique après déconnexion.
    appliquer(null, langueDefautBoutique);
    // Plus aucune session : invalide aussi toute réponse réseau encore en vol
    // pour la session précédente (F3, ex. rafraichirIdentite()).
    avancerGenerationAuth(false);
  }, [appliquer, langueDefautBoutique, avancerGenerationAuth]);

  const deconnexionForcee = useCallback(
    (message: string) => {
      setToken(null);
      setUtilisateur(null);
      setMessageSessionRemplacee(message);
      appliquer(null, langueDefautBoutique);
      avancerGenerationAuth(false);
      // Couvre le cas réinitialisation (3.15) : plus aucun compte n'existe,
      // l'écran de connexion doit céder la place à l'assistant de premier lancement.
      rafraichirEtatInitial();
    },
    [appliquer, langueDefautBoutique, rafraichirEtatInitial, avancerGenerationAuth],
  );

  // Enregistre l'écouteur de session-remplacée auprès de lib/api.ts (401
  // SESSION_REMPLACEE sur n'importe quelle requête) ; socket.tsx appelle
  // deconnexionForcee directement pour le cas temps réel.
  useEffect(() => {
    surSessionRemplacee(deconnexionForcee);
    return () => surSessionRemplacee(null);
  }, [deconnexionForcee]);

  const rafraichirIdentite = useCallback(async (): Promise<boolean> => {
    // Barrière de fraîcheur (F3) : capture la génération courante avant
    // l'appel réseau. Si une déconnexion ou une nouvelle connexion survient
    // pendant l'attente (`logout()`/`deconnexionForcee()`/`login()`, tous
    // incrémentent `generationAuthRef`), la réponse doit être intégralement
    // ignorée — jamais restaurer un ancien utilisateur, jamais écraser un
    // nouvel utilisateur déjà connecté.
    const generationCapturee = generationAuthRef.current;
    const r = await api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/me");
    if (generationAuthRef.current !== generationCapturee) return false;
    setUtilisateur(r.utilisateur);
    setLangueDefautBoutique(r.langueDefautBoutique);
    appliquer(r.utilisateur, r.langueDefautBoutique);
    return true;
  }, [appliquer]);

  const changerLangue = useCallback(
    async (langue: Langue | null) => {
      const r = await api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/langue", {
        method: "PUT",
        body: JSON.stringify({ languePreferee: langue }),
      });
      setUtilisateur(r.utilisateur);
      setLangueDefautBoutique(r.langueDefautBoutique);
      appliquer(r.utilisateur, r.langueDefautBoutique);
    },
    [appliquer],
  );

  const peutLire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "LECTURE"),
    [utilisateur],
  );
  const peutEcrire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "ECRITURE"),
    [utilisateur],
  );

  return (
    <AuthContext.Provider
      value={{
        utilisateur,
        chargement,
        login,
        logout,
        peutLire,
        peutEcrire,
        langueDefautBoutique,
        changerLangue,
        messageSessionRemplacee,
        deconnexionForcee,
        premierLancement,
        sessionAuthId,
        rafraichirIdentite,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
