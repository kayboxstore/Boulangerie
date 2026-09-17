import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronDown, Globe, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type DemandeCommandePubliqueDTO, type ProduitDTO, NOMS_PRODUITS_SCHEMA_COMMANDE } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useCleIdempotence } from "@/lib/idempotence";
import { useFeedback } from "@/components/FeedbackProvider";
import { formaterDateFr } from "@/components/ui/dateHeureFr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Statut → variante de badge, pour l'historique ET le badge inline des CONFIRMEE. */
const BADGE_STATUT: Record<"CONFIRMEE" | "REJETEE" | "ANNULEE", { variant: "gold" | "destructive" | "outline" }> = {
  CONFIRMEE: { variant: "gold" },
  REJETEE: { variant: "destructive" },
  ANNULEE: { variant: "outline" },
};

/**
 * File d'attente des demandes de commande publiques (V2, canal site vitrine) —
 * module Commandes. Consomme l'API existante (`/api/demandes-commande-
 * publiques`, déjà testée) sans y toucher ; ce composant ne fait QUE
 * l'interface. Confirmer alimente le Schéma de commande (Prévision) du jour
 * souhaité — JAMAIS une commande facturable directe.
 *
 * Une demande EN_ATTENTE reste actionnable (Confirmer/Modifier/Rejeter) ; une
 * fois CONFIRMEE, elle reste ELLE AUSSI actionnable (Modifier/Annuler) — donc
 * les deux sont affichées dans la MÊME liste principale (les CONFIRMEE
 * portent juste un badge de statut), plutôt que reléguées à l'historique
 * replié dès leur confirmation. L'historique replié ne garde que REJETEE et
 * ANNULEE, strictement en lecture seule.
 *
 * Modifier réutilise le même PUT que la création (mêmes produitId réels,
 * catalogue chargé via /api/produits, filtré aux produits éligibles au
 * Schéma de commande — voir NOMS_PRODUITS_SCHEMA_COMMANDE) : sur EN_ATTENTE
 * c'est une simple mise à jour, sur CONFIRMEE le serveur répercute lui-même
 * la différence sur le Planning déjà fusionné — aucun recalcul ici.
 */
export function DemandesCommandePubliquesCard({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toastErreur } = useFeedback();
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["demandes-commande-publiques"],
    queryFn: () => api<{ demandes: DemandeCommandePubliqueDTO[] }>("/api/demandes-commande-publiques"),
  });

  const { data: produitsData } = useQuery({
    queryKey: ["produits"],
    queryFn: () => api<{ produits: ProduitDTO[] }>("/api/produits"),
  });
  const produitsEligibles = useMemo(() => {
    const eligibles = (produitsData?.produits ?? []).filter(
      (p) => p.actif && (NOMS_PRODUITS_SCHEMA_COMMANDE as readonly string[]).includes(p.nom),
    );
    return [...eligibles].sort((a, b) => a.prixVente - b.prixVente || a.nom.localeCompare(b.nom));
  }, [produitsData]);

  const demandes = data?.demandes ?? [];
  const enAttente = demandes.filter((d) => d.statut === "EN_ATTENTE");
  const confirmees = demandes.filter((d) => d.statut === "CONFIRMEE");
  const visibles = [...enAttente, ...confirmees];
  const historique = demandes.filter((d) => d.statut === "REJETEE" || d.statut === "ANNULEE");

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["demandes-commande-publiques"] });
    queryClient.invalidateQueries({ queryKey: ["commandes"] });
    queryClient.invalidateQueries({ queryKey: ["commandes-resume-jour"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["commissions"] });
    // Confirmer/Modifier/Annuler répercutent sur le Schéma de commande —
    // sans ça, un Planning déjà ouvert dans un autre onglet resterait affiché
    // périmé tant que sa propre requête n'expire pas naturellement.
    queryClient.invalidateQueries({ queryKey: ["schema-commande"] });
    queryClient.invalidateQueries({ queryKey: ["plannings"] });
  };

  // --- Confirmer (alimente la Prévision du jour — voir doc de tête) ---
  const cleIdempotenceConfirmer = useCleIdempotence();
  const confirmer = useMutation({
    mutationFn: (demande: DemandeCommandePubliqueDTO) => {
      const empreinte = JSON.stringify({ demandeId: demande.id });
      return api<{ commandeId?: string }>(`/api/demandes-commande-publiques/${demande.id}/confirmer`, {
        method: "POST",
        headers: { "Idempotency-Key": cleIdempotenceConfirmer(empreinte) },
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => rafraichir(),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("demandesPubliques.confirmError")),
  });

  // --- Rejeter (EN_ATTENTE uniquement, motif obligatoire) ---
  const [demandeARejeter, setDemandeARejeter] = useState<DemandeCommandePubliqueDTO | null>(null);
  const [motifRejet, setMotifRejet] = useState("");
  const [erreurRejet, setErreurRejet] = useState<string | null>(null);

  const rejeter = useMutation({
    mutationFn: () =>
      api(`/api/demandes-commande-publiques/${demandeARejeter!.id}/rejeter`, {
        method: "POST",
        body: JSON.stringify({ motif: motifRejet.trim() }),
      }),
    onSuccess: () => {
      setDemandeARejeter(null);
      rafraichir();
    },
    onError: (e) => setErreurRejet(e instanceof Error ? e.message : t("demandesPubliques.rejectError")),
  });

  function ouvrirRejet(d: DemandeCommandePubliqueDTO) {
    setDemandeARejeter(d);
    setMotifRejet("");
    setErreurRejet(null);
  }

  function soumettreRejet(e: FormEvent) {
    e.preventDefault();
    setErreurRejet(null);
    if (!motifRejet.trim()) return setErreurRejet(t("demandesPubliques.motifRequired"));
    rejeter.mutate();
  }

  // --- Annuler (CONFIRMEE uniquement, motif obligatoire — retire du Planning) ---
  const [demandeAAnnuler, setDemandeAAnnuler] = useState<DemandeCommandePubliqueDTO | null>(null);
  const [motifAnnulation, setMotifAnnulation] = useState("");
  const [erreurAnnulation, setErreurAnnulation] = useState<string | null>(null);

  const annuler = useMutation({
    mutationFn: () =>
      api(`/api/demandes-commande-publiques/${demandeAAnnuler!.id}/annuler`, {
        method: "POST",
        body: JSON.stringify({ motif: motifAnnulation.trim() }),
      }),
    onSuccess: () => {
      setDemandeAAnnuler(null);
      rafraichir();
    },
    onError: (e) => setErreurAnnulation(e instanceof Error ? e.message : t("demandesPubliques.cancelError")),
  });

  function ouvrirAnnulation(d: DemandeCommandePubliqueDTO) {
    setDemandeAAnnuler(d);
    setMotifAnnulation("");
    setErreurAnnulation(null);
  }

  function soumettreAnnulation(e: FormEvent) {
    e.preventDefault();
    setErreurAnnulation(null);
    if (!motifAnnulation.trim()) return setErreurAnnulation(t("demandesPubliques.motifRequired"));
    annuler.mutate();
  }

  // --- Modifier (EN_ATTENTE : simple mise à jour — CONFIRMEE : le serveur
  // répercute lui-même la différence sur le Planning déjà fusionné) ---
  const [demandeAModifier, setDemandeAModifier] = useState<DemandeCommandePubliqueDTO | null>(null);
  const [dateModif, setDateModif] = useState("");
  const [lignesModif, setLignesModif] = useState<Record<string, string>>({});
  const [noteModif, setNoteModif] = useState("");
  const [erreurModif, setErreurModif] = useState<string | null>(null);

  // Produits à afficher dans le formulaire : le catalogue éligible actuel,
  // complété par tout produit déjà présent sur CETTE demande mais qui n'y
  // serait plus (désactivé depuis) — sinon sa quantité disparaîtrait
  // silencieusement de l'écran, puis serait effacée par la sauvegarde.
  const produitsFormulaireModif = useMemo(() => {
    if (!demandeAModifier) return produitsEligibles;
    const idsConnus = new Set(produitsEligibles.map((p) => p.id));
    const supplementaires = demandeAModifier.lignes
      .filter((l) => !idsConnus.has(l.produitId))
      .map((l) => ({ id: l.produitId, nom: l.produitNom }));
    return [...produitsEligibles, ...supplementaires];
  }, [produitsEligibles, demandeAModifier]);

  function ouvrirModification(d: DemandeCommandePubliqueDTO) {
    setDemandeAModifier(d);
    setDateModif(d.dateSouhaitee);
    setLignesModif(Object.fromEntries(d.lignes.map((l) => [l.produitId, String(l.quantite)])));
    setNoteModif(d.note ?? "");
    setErreurModif(null);
  }

  function quantiteLigneModif(produitId: string): string {
    return lignesModif[produitId] ?? "";
  }

  function totalBacsModif(): number {
    return Object.values(lignesModif).reduce((s, v) => {
      const n = Number.parseInt(v, 10);
      return s + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
  }

  const modifier = useMutation({
    mutationFn: () => {
      const lignes = Object.entries(lignesModif)
        .map(([produitId, valeur]) => ({ produitId, quantite: Number.parseInt(valeur, 10) }))
        .filter((l) => Number.isFinite(l.quantite) && l.quantite > 0);
      return api(`/api/demandes-commande-publiques/${demandeAModifier!.id}`, {
        method: "PUT",
        body: JSON.stringify({ dateSouhaitee: dateModif, lignes, note: noteModif.trim() || undefined }),
      });
    },
    onSuccess: () => {
      setDemandeAModifier(null);
      rafraichir();
    },
    onError: (e) => setErreurModif(e instanceof Error ? e.message : t("demandesPubliques.modifyError")),
  });

  function soumettreModification(e: FormEvent) {
    e.preventDefault();
    setErreurModif(null);
    if (!dateModif) return setErreurModif(t("demandesPubliques.dateRequired"));
    if (totalBacsModif() === 0) return setErreurModif(t("demandesPubliques.atLeastOneProductRequired"));
    modifier.mutate();
  }

  const enCours = confirmer.isPending || rejeter.isPending || annuler.isPending || modifier.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-or" />
            {t("demandesPubliques.title")}
            {enAttente.length > 0 && <Badge variant="destructive">{enAttente.length}</Badge>}
          </CardTitle>
          <CardDescription>{t("demandesPubliques.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="py-6 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-6 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("demandesPubliques.loadError")}
            </p>
          )}

          {data && (
            <div className="space-y-2">
              {visibles.length === 0 && (
                <p className="py-6 text-center text-muted-foreground">{t("demandesPubliques.empty")}</p>
              )}
              {visibles.map((d) => (
                <CarteLigne key={d.id}>
                  <CarteLigneTitre>
                    <span>{d.client.nom}</span>
                    <span className="flex gap-1.5">
                      <Badge variant="secondary">{d.client.typeClient}</Badge>
                      {d.statut === "CONFIRMEE" && (
                        <Badge variant={BADGE_STATUT.CONFIRMEE.variant}>{t("demandesPubliques.status.CONFIRMEE")}</Badge>
                      )}
                    </span>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("demandesPubliques.colBacs")} value={d.totalBacs} />
                  <CarteLigneChamp
                    label={t("demandesPubliques.colDetail")}
                    value={
                      <span className="italic">
                        {d.lignes.map((l) => `${l.quantite} ${l.produitNom}`).join(", ")}
                      </span>
                    }
                  />
                  <CarteLigneChamp
                    label={t("demandesPubliques.colWantedDate")}
                    value={formaterDateFr(d.dateSouhaitee)}
                  />
                  {d.note && (
                    <CarteLigneChamp
                      label={t("demandesPubliques.colNote")}
                      value={<span className="italic">{d.note}</span>}
                    />
                  )}
                  {editable && (
                    <CarteLigneActions>
                      {d.statut === "EN_ATTENTE" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => ouvrirRejet(d)}
                          disabled={enCours}
                          className="gap-1 border-terracotta/40 text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
                        >
                          <X className="h-3.5 w-3.5" />
                          {t("demandesPubliques.reject")}
                        </Button>
                      )}
                      {d.statut === "CONFIRMEE" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => ouvrirAnnulation(d)}
                          disabled={enCours}
                          className="gap-1 border-terracotta/40 text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          {t("demandesPubliques.cancelRequest")}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => ouvrirModification(d)}
                        disabled={enCours}
                        className="gap-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("demandesPubliques.modify")}
                      </Button>
                      {d.statut === "EN_ATTENTE" && (
                        <Button
                          variant="cta"
                          size="sm"
                          onClick={() => confirmer.mutate(d)}
                          disabled={enCours}
                          className="gap-1"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("demandesPubliques.confirm")}
                        </Button>
                      )}
                    </CarteLigneActions>
                  )}
                </CarteLigne>
              ))}
            </div>
          )}

          {data && historique.length > 0 && (
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setHistoriqueOuvert((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-marine dark:hover:text-creme"
              >
                {t("demandesPubliques.history", { count: historique.length })}
                <ChevronDown className={`h-4 w-4 transition-transform ${historiqueOuvert ? "rotate-180" : ""}`} />
              </button>
              {historiqueOuvert && (
                <div className="mt-2 space-y-2">
                  {historique.map((d) => (
                    <CarteLigne key={d.id} className="opacity-80">
                      <CarteLigneTitre>
                        <span>{d.client.nom}</span>
                        <Badge variant={BADGE_STATUT[d.statut as "REJETEE" | "ANNULEE"].variant}>
                          {t(`demandesPubliques.status.${d.statut}`)}
                        </Badge>
                      </CarteLigneTitre>
                      <CarteLigneChamp label={t("demandesPubliques.colBacs")} value={d.totalBacs} />
                      <CarteLigneChamp
                        label={t("demandesPubliques.colDetail")}
                        value={
                          <span className="italic">
                            {d.lignes.map((l) => `${l.quantite} ${l.produitNom}`).join(", ")}
                          </span>
                        }
                      />
                      {d.statut === "REJETEE" && d.motifRejet && (
                        <CarteLigneChamp
                          label={t("demandesPubliques.colRejectReason")}
                          value={<span className="italic">{d.motifRejet}</span>}
                        />
                      )}
                      {d.statut === "ANNULEE" && d.motifAnnulation && (
                        <CarteLigneChamp
                          label={t("demandesPubliques.colCancelReason")}
                          value={<span className="italic">{d.motifAnnulation}</span>}
                        />
                      )}
                    </CarteLigne>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rejet (EN_ATTENTE) : motif obligatoire avant soumission */}
      <Dialog open={!!demandeARejeter} onOpenChange={(o) => !o && setDemandeARejeter(null)}>
        <DialogContent>
          <form onSubmit={soumettreRejet} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("demandesPubliques.rejectTitle", { nom: demandeARejeter?.client.nom })}</DialogTitle>
              <DialogDescription>{t("demandesPubliques.rejectDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="demande-motif-rejet">{t("demandesPubliques.motifLabel")}</Label>
              <AutoTextarea
                id="demande-motif-rejet"
                value={motifRejet}
                onChange={(e) => setMotifRejet(e.target.value)}
                maxLength={500}
                required
                autoFocus
              />
            </div>
            {erreurRejet && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurRejet}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDemandeARejeter(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={rejeter.isPending}>
                {t("demandesPubliques.rejectSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Annulation (CONFIRMEE) : motif obligatoire, retire du Planning */}
      <Dialog open={!!demandeAAnnuler} onOpenChange={(o) => !o && setDemandeAAnnuler(null)}>
        <DialogContent>
          <form onSubmit={soumettreAnnulation} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("demandesPubliques.cancelTitle", { nom: demandeAAnnuler?.client.nom })}</DialogTitle>
              <DialogDescription>{t("demandesPubliques.cancelDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="demande-motif-annulation">{t("demandesPubliques.motifCancelLabel")}</Label>
              <AutoTextarea
                id="demande-motif-annulation"
                value={motifAnnulation}
                onChange={(e) => setMotifAnnulation(e.target.value)}
                maxLength={500}
                required
                autoFocus
              />
            </div>
            {erreurAnnulation && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurAnnulation}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDemandeAAnnuler(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={annuler.isPending}>
                {t("demandesPubliques.cancelSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modification (EN_ATTENTE ou CONFIRMEE) : mêmes champs qu'à la création */}
      <Dialog open={!!demandeAModifier} onOpenChange={(o) => !o && setDemandeAModifier(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={soumettreModification} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("demandesPubliques.modifyTitle", { nom: demandeAModifier?.client.nom })}</DialogTitle>
              <DialogDescription>
                {demandeAModifier?.statut === "CONFIRMEE"
                  ? t("demandesPubliques.modifyDescConfirmed")
                  : t("demandesPubliques.modifyDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="demande-date-modif">{t("demandesPubliques.dateLabel")}</Label>
              <Input
                id="demande-date-modif"
                type="date"
                value={dateModif}
                onChange={(e) => setDateModif(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("demandesPubliques.productsLabel")}</Label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {produitsFormulaireModif.map((p) => (
                  <div key={p.id} className="space-y-1">
                    <Label htmlFor={`demande-modif-${p.id}`} className="text-xs font-normal text-muted-foreground">
                      {p.nom}
                    </Label>
                    <Input
                      id={`demande-modif-${p.id}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={quantiteLigneModif(p.id)}
                      onChange={(e) =>
                        setLignesModif((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("demandesPubliques.totalBacs", { count: totalBacsModif() })}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="demande-note-modif">{t("demandesPubliques.noteLabel")}</Label>
              <AutoTextarea
                id="demande-note-modif"
                value={noteModif}
                onChange={(e) => setNoteModif(e.target.value)}
                maxLength={500}
              />
            </div>

            {erreurModif && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurModif}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDemandeAModifier(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={modifier.isPending}>
                {t("demandesPubliques.modifySubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
