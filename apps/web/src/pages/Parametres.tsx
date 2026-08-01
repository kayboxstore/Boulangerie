import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Globe, Pencil, Plus, Store, Trash2, Wheat } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatFc,
  LANGUE_LABELS,
  LANGUES,
  type Langue,
  type ParametresBoutiqueDTO,
  type TypeClientDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export function ParametresPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();

  // --- Types de clients (Qualité) -------------------------------------------
  const { data: typeClientsData } = useQuery({
    queryKey: ["type-clients"],
    queryFn: () => api<{ typeClients: TypeClientDTO[] }>("/api/type-clients"),
  });
  const typeClients = typeClientsData?.typeClients ?? [];

  const [dialogQualite, setDialogQualite] = useState(false);
  const [qualiteEditee, setQualiteEditee] = useState<TypeClientDTO | null>(null);
  const [nomQualite, setNomQualite] = useState("");
  const [prixParBac, setPrixParBac] = useState("");
  const [commissionParBac, setCommissionParBac] = useState("");
  const [erreurQualite, setErreurQualite] = useState<string | null>(null);

  function ouvrirQualite(tc: TypeClientDTO | null) {
    setQualiteEditee(tc);
    setNomQualite(tc?.nom ?? "");
    setPrixParBac(tc ? String(tc.prixParBac) : "");
    setCommissionParBac(tc ? String(tc.commissionParBac) : "0");
    setErreurQualite(null);
    setDialogQualite(true);
  }

  const sauverQualite = useMutation({
    mutationFn: () => {
      const corps = {
        nom: nomQualite.trim(),
        prixParBac: Number(prixParBac),
        commissionParBac: Number(commissionParBac || 0),
      };
      return qualiteEditee
        ? api(`/api/type-clients/${qualiteEditee.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/type-clients", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogQualite(false);
      queryClient.invalidateQueries({ queryKey: ["type-clients"] });
    },
    onError: (e) => setErreurQualite(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  const supprimerQualite = useMutation({
    mutationFn: (id: string) => api(`/api/type-clients/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["type-clients"] }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("parametres.deleteError")),
  });

  // --- Paramètres boutique + langue -----------------------------------------
  const { data: parametresData } = useQuery({
    queryKey: ["parametres"],
    queryFn: () => api<{ parametres: ParametresBoutiqueDTO }>("/api/parametres"),
  });

  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [boutiqueAdresse, setBoutiqueAdresse] = useState("");
  const [boutiqueContact, setBoutiqueContact] = useState("");
  const [langueDefaut, setLangueDefaut] = useState<Langue>("FR");
  const [erreurParams, setErreurParams] = useState<string | null>(null);
  const [succesParams, setSuccesParams] = useState(false);

  useEffect(() => {
    const p = parametresData?.parametres;
    if (!p) return;
    setBoutiqueNom(p.boutiqueNom);
    setBoutiqueAdresse(p.boutiqueAdresse);
    setBoutiqueContact(p.boutiqueContact);
    setLangueDefaut(p.langueDefaut);
  }, [parametresData]);

  const enregistrerParams = useMutation({
    mutationFn: () =>
      api<{ parametres: ParametresBoutiqueDTO }>("/api/parametres", {
        method: "PUT",
        body: JSON.stringify({
          boutiqueNom: boutiqueNom.trim(),
          boutiqueAdresse: boutiqueAdresse.trim(),
          boutiqueContact: boutiqueContact.trim(),
          langueDefaut,
        }),
      }),
    onSuccess: () => {
      setErreurParams(null);
      setSuccesParams(true);
      queryClient.invalidateQueries({ queryKey: ["parametres"] });
      // Nom/adresse/contact sont partagés avec À propos (3.12) — même donnée,
      // pas une copie séparée : sa page doit refléter ce changement aussi.
      queryClient.invalidateQueries({ queryKey: ["apropos"] });
    },
    onError: (e) => {
      setSuccesParams(false);
      setErreurParams(e instanceof Error ? e.message : t("parametres.saveError"));
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("parametres.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("parametres.subtitle")}</p>
      </div>

      {/* Types de clients / Qualités */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("parametres.typeClientsTitle")}</CardTitle>
            <CardDescription>{t("parametres.typeClientsSub")}</CardDescription>
          </div>
          <Button variant="cta" onClick={() => ouvrirQualite(null)}>
            <Plus className="h-4 w-4" />
            {t("parametres.quality")}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead className="text-right">{t("parametres.pricePerBac")}</TableHead>
                <TableHead className="text-right">{t("parametres.commissionPerBac")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeClients.map((tc) => (
                <TableRow key={tc.id}>
                  <TableCell className="font-medium">{tc.nom}</TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">{formatFc(tc.prixParBac)}</TableCell>
                  <TableCell className="text-right">{tc.commissionParBac > 0 ? formatFc(tc.commissionParBac) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirQualite(tc)} aria-label={t("parametres.editQuality", { nom: tc.nom })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                        if (await confirmer({ description: t("parametres.confirmDeleteQuality", { nom: tc.nom }), destructive: true }))
                          supprimerQualite.mutate(tc.id);
                      }}
                      aria-label={t("parametres.ariaDelete", { nom: tc.nom })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {typeClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    {t("parametres.noQuality")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Réglages boutique */}
      <Card>
        <CardHeader>
          <CardTitle>{t("parametres.boutiqueTitle")}</CardTitle>
          <CardDescription>{t("parametres.boutiqueSub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSuccesParams(false);
              enregistrerParams.mutate();
            }}
            className="space-y-5"
          >
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-marine dark:text-creme">
                <Store className="h-4 w-4 text-or" />
                {t("parametres.boutiqueInfos")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="boutique-nom">{t("parametres.boutiqueName")}</Label>
                  <Input id="boutique-nom" value={boutiqueNom} onChange={(e) => setBoutiqueNom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="boutique-contact">{t("parametres.boutiqueContact")}</Label>
                  <Input id="boutique-contact" value={boutiqueContact} onChange={(e) => setBoutiqueContact(e.target.value)} placeholder={t("parametres.contactPlaceholder")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="boutique-adresse">{t("parametres.boutiqueAddress")}</Label>
                  <Input id="boutique-adresse" value={boutiqueAdresse} onChange={(e) => setBoutiqueAdresse(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="langue" className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-or" />
                  {t("parametres.defaultLanguage")}
                </Label>
                <NativeSelect id="langue" value={langueDefaut} onChange={(e) => setLangueDefaut(e.target.value as Langue)}>
                  {LANGUES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUE_LABELS[l]}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">{t("parametres.defaultLanguageHelp")}</p>
              </div>
            </div>

            {erreurParams && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurParams}
              </p>
            )}
            {succesParams && (
              <p className="rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-terracotta dark:text-or">
                ✓ {t("parametres.paramsSaved")}
              </p>
            )}
            <Button type="submit" variant="cta" disabled={enregistrerParams.isPending}>
              {t("parametres.saveParams")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Renvoi vers le catalogue Produits (édité sur sa propre page) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wheat className="h-4 w-4 text-or" />
            {t("parametres.catalogTitle")}
          </CardTitle>
          <CardDescription>{t("parametres.catalogSub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/produits">
              <Wheat className="h-4 w-4" />
              {t("parametres.openCatalog")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Dialog qualité */}
      <Dialog open={dialogQualite} onOpenChange={setDialogQualite}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverQualite.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{qualiteEditee ? t("parametres.editQuality", { nom: qualiteEditee.nom }) : t("parametres.newQuality")}</DialogTitle>
              <DialogDescription>{t("parametres.qualityHelp")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="qualite-nom">{t("common.name")}</Label>
                <Input id="qualite-nom" value={nomQualite} onChange={(e) => setNomQualite(e.target.value)} placeholder={t("parametres.qualityNamePlaceholder")} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qualite-prix">{t("parametres.pricePerBacFc")}</Label>
                  <Input id="qualite-prix" type="number" min="0" step="1" value={prixParBac} onChange={(e) => setPrixParBac(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qualite-commission">{t("parametres.commissionPerBacFc")}</Label>
                  <Input id="qualite-commission" type="number" min="0" step="1" value={commissionParBac} onChange={(e) => setCommissionParBac(e.target.value)} />
                </div>
              </div>
            </div>
            {erreurQualite && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurQualite}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogQualite(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverQualite.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
