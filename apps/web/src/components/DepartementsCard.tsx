import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DepartementDTO, TravailleurDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Départements & Groupes (section 3.18, nouveau) : purement organisationnel,
 * aucune permission propre — gouverné par le module TRAVAILLEURS. Card
 * autonome (requête react-query partagée via la clé "departements") montée
 * sur la page Travailleurs.
 */
export function DepartementsCard({ travailleurs, editable }: { travailleurs: TravailleurDTO[]; editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();

  const { data } = useQuery({
    queryKey: ["departements"],
    queryFn: () => api<{ departements: DepartementDTO[] }>("/api/departements"),
  });
  const departements = data?.departements ?? [];

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["departements"] });
    queryClient.invalidateQueries({ queryKey: ["travailleurs"] });
  };

  // --- Dialog département (création + modification/chef) --------------------
  const [dialogDepartement, setDialogDepartement] = useState(false);
  const [departementEditee, setDepartementEditee] = useState<DepartementDTO | null>(null);
  const [nomDepartement, setNomDepartement] = useState("");
  const [chefId, setChefId] = useState("");
  const [erreurDepartement, setErreurDepartement] = useState<string | null>(null);

  function ouvrirDepartement(dep: DepartementDTO | null) {
    setDepartementEditee(dep);
    setNomDepartement(dep?.nom ?? "");
    setChefId(dep?.chef?.id ?? "");
    setErreurDepartement(null);
    setDialogDepartement(true);
  }

  // Le chef ne peut être choisi que parmi les Travailleurs déjà membres de ce
  // département (spec 3.18) — vide à la création, puisque le département
  // n'a encore aucun membre.
  const membresDepartementEditee = departementEditee
    ? travailleurs.filter((tr) => tr.departement?.id === departementEditee.id)
    : [];

  const sauverDepartement = useMutation({
    mutationFn: () =>
      departementEditee
        ? api(`/api/departements/${departementEditee.id}`, {
            method: "PUT",
            body: JSON.stringify({ nom: nomDepartement.trim(), chefTravailleurId: chefId || null }),
          })
        : api("/api/departements", {
            method: "POST",
            body: JSON.stringify({ nom: nomDepartement.trim() }),
          }),
    onSuccess: () => {
      setDialogDepartement(false);
      rafraichir();
    },
    onError: (e) => setErreurDepartement(e instanceof Error ? e.message : t("departements.saveError")),
  });

  const supprimerDepartement = useMutation({
    mutationFn: (id: string) => api(`/api/departements/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("departements.deleteError")),
  });

  // --- Dialog groupe (création + renommage) -----------------------------------
  const [dialogGroupe, setDialogGroupe] = useState(false);
  const [groupeContexteDepartementId, setGroupeContexteDepartementId] = useState<string | null>(null);
  const [groupeEditee, setGroupeEditee] = useState<{ id: string; nom: string } | null>(null);
  const [nomGroupe, setNomGroupe] = useState("");
  const [erreurGroupe, setErreurGroupe] = useState<string | null>(null);

  function ouvrirNouveauGroupe(departementId: string) {
    setGroupeContexteDepartementId(departementId);
    setGroupeEditee(null);
    setNomGroupe("");
    setErreurGroupe(null);
    setDialogGroupe(true);
  }

  function ouvrirRenommerGroupe(departementId: string, groupe: { id: string; nom: string }) {
    setGroupeContexteDepartementId(departementId);
    setGroupeEditee(groupe);
    setNomGroupe(groupe.nom);
    setErreurGroupe(null);
    setDialogGroupe(true);
  }

  const sauverGroupe = useMutation({
    mutationFn: () =>
      groupeEditee
        ? api(`/api/groupes/${groupeEditee.id}`, {
            method: "PUT",
            body: JSON.stringify({ nom: nomGroupe.trim() }),
          })
        : api(`/api/departements/${groupeContexteDepartementId}/groupes`, {
            method: "POST",
            body: JSON.stringify({ nom: nomGroupe.trim() }),
          }),
    onSuccess: () => {
      setDialogGroupe(false);
      rafraichir();
    },
    onError: (e) => setErreurGroupe(e instanceof Error ? e.message : t("departements.saveError")),
  });

  const supprimerGroupe = useMutation({
    mutationFn: (id: string) => api(`/api/groupes/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("departements.deleteError")),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{t("departements.title")}</CardTitle>
          <CardDescription>{t("departements.subtitle")}</CardDescription>
        </div>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => ouvrirDepartement(null)}>
            <Plus className="h-4 w-4" />
            {t("departements.newDepartment")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {departements.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("departements.noDepartments")}</p>
        )}
        {departements.map((dep) => (
          <div key={dep.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-terracotta" />
                  <span className="font-medium text-marine dark:text-creme">{dep.nom}</span>
                  <span className="text-sm text-muted-foreground">{t("departements.membersCount", { count: dep.nombreTravailleurs })}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("departements.chiefLabel")} : {dep.chef ? dep.chef.nom : t("departements.chiefNoneOption")}
                </p>
              </div>
              {editable && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirDepartement(dep)} aria-label={t("departements.ariaEdit", { nom: dep.nom })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-terracotta hover:text-terracotta"
                    onClick={async () => {
                      if (await confirmer({ description: t("departements.confirmDeleteDepartment", { nom: dep.nom }), destructive: true }))
                        supprimerDepartement.mutate(dep.id);
                    }}
                    aria-label={t("departements.ariaDelete", { nom: dep.nom })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {dep.groupes.map((g) => (
                <Badge key={g.id} variant="outline" className="gap-1 pr-1">
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => editable && ouvrirRenommerGroupe(dep.id, g)}
                    className="disabled:cursor-default"
                  >
                    {g.nom} ({g.nombreTravailleurs})
                  </button>
                  {editable && (
                    <button
                      type="button"
                      aria-label={t("departements.ariaDeleteGroup", { nom: g.nom })}
                      onClick={async () => {
                        if (await confirmer({ description: t("departements.confirmDeleteGroup", { nom: g.nom }), destructive: true }))
                          supprimerGroupe.mutate(g.id);
                      }}
                      className="rounded-full p-0.5 hover:bg-secondary"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {dep.groupes.length === 0 && <span className="text-sm text-muted-foreground">{t("departements.noGroups")}</span>}
              {editable && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => ouvrirNouveauGroupe(dep.id)}>
                  <Plus className="h-3 w-3" />
                  {t("departements.newGroup")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      {/* Dialog département */}
      <Dialog open={dialogDepartement} onOpenChange={setDialogDepartement}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverDepartement.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{departementEditee ? t("departements.editDepartment", { nom: departementEditee.nom }) : t("departements.newDepartment")}</DialogTitle>
              <DialogDescription>{t("departements.dialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dep-nom">{t("departements.nameLabel")}</Label>
                <Input id="dep-nom" value={nomDepartement} onChange={(e) => setNomDepartement(e.target.value)} placeholder={t("departements.namePlaceholder")} required />
              </div>
              {departementEditee && (
                <div className="space-y-1.5">
                  <Label htmlFor="dep-chef">{t("departements.chiefLabel")}</Label>
                  <NativeSelect id="dep-chef" value={chefId} onChange={(e) => setChefId(e.target.value)}>
                    <option value="">{t("departements.chiefNoneOption")}</option>
                    {membresDepartementEditee.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.nom}
                      </option>
                    ))}
                  </NativeSelect>
                  {membresDepartementEditee.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("departements.chiefHelpEmpty")}</p>
                  )}
                </div>
              )}
            </div>
            {erreurDepartement && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurDepartement}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogDepartement(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverDepartement.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog groupe */}
      <Dialog open={dialogGroupe} onOpenChange={setDialogGroupe}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverGroupe.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{groupeEditee ? t("departements.editGroup", { nom: groupeEditee.nom }) : t("departements.newGroup")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="groupe-nom">{t("departements.nameLabel")}</Label>
              <Input id="groupe-nom" value={nomGroupe} onChange={(e) => setNomGroupe(e.target.value)} placeholder={t("departements.groupNamePlaceholder")} required />
            </div>
            {erreurGroupe && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurGroupe}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogGroupe(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverGroupe.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
