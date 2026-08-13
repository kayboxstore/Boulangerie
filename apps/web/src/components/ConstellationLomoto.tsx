import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AnniversairesDuJourDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
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
 * appel réseau par session applicative (le `QueryClient` vit tant que l'onglet
 * n'est pas rechargé), sans avoir besoin d'un second indicateur dans
 * `localStorage` : la réponse serveur (`dejaAffiche`) fait déjà foi pour tout
 * rechargement complet de page.
 *
 * Ne montre jamais ni âge ni date de naissance : le DTO `AnniversairesDuJourDTO`
 * ne contient que `date`/`noms`/`dejaAffiche`, rien d'autre à filtrer.
 */
export function ConstellationLomoto() {
  const { t } = useTranslation();
  const reduireMouvement = usePrefersReducedMotion();
  const [ferme, setFerme] = useState(false);

  const { data } = useQuery({
    queryKey: ["anniversaires-aujourdhui"],
    queryFn: () => api<AnniversairesDuJourDTO>("/api/auth/anniversaires/aujourdhui", { method: "POST" }),
    staleTime: Infinity,
    gcTime: Infinity,
    // Échec réseau (F3) : ne doit jamais bloquer l'application authentifiée —
    // pas de nouvelle tentative agressive, pas d'affichage d'erreur, la
    // célébration est simplement absente ce jour-là.
    retry: false,
  });

  const noms = data?.noms ?? [];
  // Couvre les deux cas où rien ne doit s'afficher (§ contrat) : aucun
  // anniversaire aujourd'hui, ET célébration déjà affichée plus tôt dans la
  // session — dans les deux cas le serveur renvoie une liste vide.
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
