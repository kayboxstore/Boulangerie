import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AnniversairesDuJourDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePrefersReducedMotion } from "@/components/auth/prefersReducedMotion";
import { formaterListeNoms } from "./anniversairesLogique";

/** Cible du focus au retour, posée par Layout.tsx sur son élément `<main>`. */
const ID_CONTENU_PRINCIPAL = "contenu-principal";

/**
 * « Constellation Lomoto » (F3, contrat C3 `POST /api/auth/anniversaires/aujourdhui`).
 *
 * Montée une seule fois par authentification réussie (`App.tsx`,
 * `AppAuthentifiee`) — `useQuery` avec `staleTime: Infinity` garantit un seul
 * appel réseau par session applicative, sans avoir besoin d'un second
 * indicateur dans `localStorage` : la réponse serveur (`dejaAffiche`) fait
 * déjà foi pour tout rechargement complet de page.
 *
 * Isolation de session (revue Codex) : le `QueryClient` de `main.tsx` est
 * global et survit à une déconnexion/reconnexion dans le même onglet. La
 * queryKey inclut donc `sessionAuthId` (opaque, jamais le jeton JWT — voir
 * `lib/auth.tsx`) : une nouvelle session obtient toujours une clé différente,
 * ne peut jamais lire le cache d'une session précédente, et déclenche
 * systématiquement un nouvel appel serveur. `gcTime` par défaut (au lieu de
 * `Infinity`) permet en plus au cache d'une session révolue d'être élagué au
 * lieu d'être conservé indéfiniment en mémoire.
 *
 * Ne montre jamais ni âge ni date de naissance : le DTO `AnniversairesDuJourDTO`
 * ne contient que `date`/`noms`/`dejaAffiche`, rien d'autre à filtrer.
 */
export function ConstellationLomoto() {
  const { t } = useTranslation();
  const { sessionAuthId } = useAuth();
  const reduireMouvement = usePrefersReducedMotion();
  const [ferme, setFerme] = useState(false);

  const { data } = useQuery({
    queryKey: ["anniversaires-aujourdhui", sessionAuthId],
    queryFn: () => api<AnniversairesDuJourDTO>("/api/auth/anniversaires/aujourdhui", { method: "POST" }),
    // Ce composant n'est monté que pour un utilisateur authentifié (voir
    // App.tsx) donc `sessionAuthId` est toujours défini en pratique ; le
    // garde-fou `enabled` évite malgré tout tout appel avec une clé `null`
    // pendant un état transitoire.
    enabled: sessionAuthId !== null,
    staleTime: Infinity,
    // Échec réseau (F3) : ne doit jamais bloquer l'application authentifiée —
    // pas de nouvelle tentative agressive, pas d'affichage d'erreur, la
    // célébration est simplement absente ce jour-là.
    retry: false,
  });

  // Respect explicite du contrat (§ revue Codex) : `dejaAffiche: true` bloque
  // toujours l'affichage, même si une réponse défensive ou future contenait
  // accidentellement des noms — on ne se fie pas uniquement à `noms.length`.
  const noms = data && !data.dejaAffiche ? data.noms : [];
  if (noms.length === 0) return null;

  const texte = formaterListeNoms(noms, t("auth.anniversaires.and"));

  return (
    <Dialog open={!ferme} onOpenChange={(ouvert) => !ouvert && setFerme(true)}>
      <DialogContent
        className={cn(
          "overflow-hidden border-or/30 bg-marine text-creme sm:rounded-2xl",
          !reduireMouvement && "lomoto-constellation-content",
        )}
        onCloseAutoFocus={(e) => {
          // Retour du focus à un emplacement logique (§ contrat F3) : le
          // contenu principal de l'écran qui était affiché derrière la
          // célébration, plutôt que de le laisser retomber sur <body>.
          e.preventDefault();
          const principal = document.getElementById(ID_CONTENU_PRINCIPAL);
          if (principal) {
            principal.setAttribute("tabindex", "-1");
            principal.focus();
          }
        }}
      >
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", !reduireMouvement && "lomoto-constellation-etoiles")}
        />
        <DialogHeader className="relative">
          <DialogTitle className="font-serif text-2xl text-or">{t("auth.anniversaires.title")}</DialogTitle>
          <DialogDescription className="text-creme/80">{t("auth.anniversaires.body", { noms: texte })}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
