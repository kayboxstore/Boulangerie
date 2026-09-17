import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LicenceEtatDTO } from "@lomoto/shared";
import { api } from "@/lib/api";

/** Clé de cache React Query partagée par le bandeau et l'écran de blocage. */
export const CLE_LICENCE_ETAT = ["licence-etat"] as const;

// 15 minutes : assez réactif pour refléter un rafraîchissement fait depuis un
// autre onglet/appareil (ex. activation par un collègue) sans bombarder l'API
// — le job serveur, lui, ne recontacte le service central qu'une fois par heure.
const INTERVALLE_RAFRAICHISSEMENT_MS = 15 * 60 * 1000;

/**
 * État de licence de CETTE instance (voir GET /api/licence/etat). `actif`
 * doit être `false` tant qu'aucun utilisateur n'est connecté — la route est
 * authentifiée, un appel avant connexion échouerait systématiquement en 401.
 */
export function useLicenceEtat(actif: boolean) {
  return useQuery({
    queryKey: CLE_LICENCE_ETAT,
    queryFn: () => api<LicenceEtatDTO>("/api/licence/etat"),
    enabled: actif,
    refetchInterval: actif ? INTERVALLE_RAFRAICHISSEMENT_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Invalide le cache de l'état de licence — après une activation réussie ou un rafraîchissement forcé. */
export function useInvaliderLicenceEtat() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CLE_LICENCE_ETAT });
}
