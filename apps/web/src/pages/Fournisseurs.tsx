import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatFc,
  formatQuantite,
  type CommandeFournisseurDTO,
  type FournisseurDTO,
  type MatierePremiereDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
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

function formatDateHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

interface LigneAchat {
  matierePremiereId: string;
  quantite: string;
  prixUnitaire: string;
}

export function FournisseursPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("FOURNISSEURS");

  const { data: fournisseursData } = useQuery({
    queryKey: ["fournisseurs"],
    queryFn: () => api<{ fournisseurs: FournisseurDTO[] }>("/api/fournisseurs"),
  });
  const { data: commandesData } = useQuery({
    queryKey: ["commandes-fournisseur"],
    queryFn: () => api<{ commandes: CommandeFournisseurDTO[] }>("/api/fournisseurs/commandes"),
  });
  const { data: matieresData } = useQuery({
    queryKey: ["matieres"],
    queryFn: () => api<{ matieres: MatierePremiereDTO[] }>("/api/stocks/matieres"),
    enabled: editable,
  });

  const fournisseurs = fournisseursData?.fournisseurs ?? [];
  const commandes = commandesData?.commandes ?? [];
  const matieres = matieresData?.matieres ?? [];
  const enAttente = commandes.filter((c) => c.statut === "EN_ATTENTE");

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["fournisseurs"] });
    queryClient.invalidateQueries({ queryKey: ["commandes-fournisseur"] });
    queryClient.invalidateQueries({ queryKey: ["matieres"] });
    queryClient.invalidateQueries({ queryKey: ["mouvements"] });
  };

  // --- Dialog fournisseur ----------------------------------------------------
  const [dialogFournisseur, setDialogFournisseur] = useState(false);
  const [fournisseurEdite, setFournisseurEdite] = useState<FournisseurDTO | null>(null);
  const [nom, setNom] = useState("");
  const [contact, setContact] = useState("");
  const [erreurFournisseur, setErreurFournisseur] = useState<string | null>(null);

  function ouvrirFournisseur(f: FournisseurDTO | null) {
    setFournisseurEdite(f);
    setNom(f?.nom ?? "");
    setContact(f?.contact ?? "");
    setErreurFournisseur(null);
    setDialogFournisseur(true);
  }

  const sauverFournisseur = useMutation({
    mutationFn: () => {
      const corps = { nom: nom.trim(), contact: contact.trim() || undefined };
      return fournisseurEdite
        ? api(`/api/fournisseurs/${fournisseurEdite.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/fournisseurs", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogFournisseur(false);
      rafraichir();
    },
    onError: (e) => setErreurFournisseur(e instanceof Error ? e.message : t("fournisseurs.saveError")),
  });

  const supprimerFournisseur = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("fournisseurs.deleteError")),
  });

  // --- Dialog bon de commande ------------------------------------------------
  const [dialogCommande, setDialogCommande] = useState(false);
  const [cmdFournisseurId, setCmdFournisseurId] = useState("");
  const [lignes, setLignes] = useState<LigneAchat[]>([]);
  const [erreurCommande, setErreurCommande] = useState<string | null>(null);

  function ouvrirCommande() {
    setCmdFournisseurId(fournisseurs[0]?.id ?? "");
    setLignes([{ matierePremiereId: matieres[0]?.id ?? "", quantite: "", prixUnitaire: "" }]);
    setErreurCommande(null);
    setDialogCommande(true);
  }

  const totalCommande = lignes.reduce(
    (s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0),
    0,
  );

  const creerCommande = useMutation({
    mutationFn: () =>
      api("/api/fournisseurs/commandes", {
        method: "POST",
        body: JSON.stringify({
          fournisseurId: cmdFournisseurId,
          lignes: lignes.map((l) => ({
            matierePremiereId: l.matierePremiereId,
            quantite: Number(l.quantite),
            prixUnitaire: Number(l.prixUnitaire),
          })),
        }),
      }),
    onSuccess: () => {
      setDialogCommande(false);
      rafraichir();
    },
    onError: (e) => setErreurCommande(e instanceof Error ? e.message : t("fournisseurs.saveError")),
  });

  const supprimerCommande = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/commandes/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("fournisseurs.cancelError")),
  });

  // --- Réception -------------------------------------------------------------
  const [commandeAReceptionner, setCommandeAReceptionner] = useState<CommandeFournisseurDTO | null>(null);
  const [erreurReception, setErreurReception] = useState<string | null>(null);
  const receptionner = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/commandes/${id}/reception`, { method: "POST" }),
    onSuccess: () => {
      setCommandeAReceptionner(null);
      setErreurReception(null);
      rafraichir();
    },
    onError: (e) => setErreurReception(e instanceof Error ? e.message : t("fournisseurs.receptionError")),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("fournisseurs.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("fournisseurs.subtitle")}</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => ouvrirFournisseur(null)}>
              <Truck className="h-4 w-4" />
              {t("fournisseurs.supplier")}
            </Button>
            <Button variant="cta" onClick={ouvrirCommande} disabled={fournisseurs.length === 0 || matieres.length === 0}>
              <Plus className="h-4 w-4" />
              {t("fournisseurs.purchaseOrder")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Fournisseurs */}
        <Card>
          <CardHeader>
            <CardTitle>{t("fournisseurs.suppliersTitle")}</CardTitle>
            <CardDescription>{t("fournisseurs.suppliersDesc", { count: fournisseurs.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("fournisseurs.contact")}</TableHead>
                  <TableHead className="text-right">{t("fournisseurs.colOrders")}</TableHead>
                  {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fournisseurs.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nom}</TableCell>
                    <TableCell className="max-w-48 truncate text-sm text-muted-foreground">{f.contact ?? "—"}</TableCell>
                    <TableCell className="text-right">{f.nombreCommandes}</TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFournisseur(f)} aria-label={t("fournisseurs.ariaEdit", { nom: f.nom })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-terracotta hover:text-terracotta"
                          onClick={() => confirm(t("fournisseurs.confirmDelete", { nom: f.nom })) && supprimerFournisseur.mutate(f.id)}
                          aria-label={t("fournisseurs.ariaDelete", { nom: f.nom })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {fournisseurs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 4 : 3} className="py-8 text-center text-muted-foreground">
                      {t("fournisseurs.noSupplier")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="space-y-2 md:hidden">
              {fournisseurs.map((f) => (
                <CarteLigne key={f.id}>
                  <CarteLigneTitre>
                    <span>{f.nom}</span>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("fournisseurs.contact")} value={f.contact ?? "—"} />
                  <CarteLigneChamp label={t("fournisseurs.colOrders")} value={f.nombreCommandes} />
                  {editable && (
                    <CarteLigneActions>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFournisseur(f)} aria-label={t("fournisseurs.ariaEdit", { nom: f.nom })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("fournisseurs.confirmDelete", { nom: f.nom })) && supprimerFournisseur.mutate(f.id)}
                        aria-label={t("fournisseurs.ariaDelete", { nom: f.nom })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </CarteLigneActions>
                  )}
                </CarteLigne>
              ))}
              {fournisseurs.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("fournisseurs.noSupplier")}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Commandes en attente */}
        <Card className={enAttente.length > 0 ? "border-or/40" : undefined}>
          <CardHeader>
            <CardTitle>{t("fournisseurs.pendingTitle")}</CardTitle>
            <CardDescription>{t("fournisseurs.pendingDesc", { count: enAttente.length })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enAttente.map((c) => (
              <div key={c.id} className="rounded-lg border border-beige/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-marine dark:text-creme">
                      {t("fournisseurs.orderLine", { numero: c.numero, fournisseur: c.fournisseur.nom })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("fournisseurs.placedOn", { date: formatDateHeure(c.date) })}
                      {c.creePar ? t("fournisseurs.placedBy", { nom: c.creePar.nom }) : ""}
                    </p>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="cta" size="sm" onClick={() => { setErreurReception(null); setCommandeAReceptionner(c); }}>
                        <PackageCheck className="h-3.5 w-3.5" />
                        {t("fournisseurs.markReceived")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("fournisseurs.confirmCancel", { numero: c.numero })) && supprimerCommande.mutate(c.id)}
                        aria-label={t("fournisseurs.ariaCancel", { numero: c.numero })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {c.lignes.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>
                        {formatQuantite(l.quantite, l.matierePremiere.unite)} {l.matierePremiere.nom} ×{" "}
                        {formatFc(l.prixUnitaire)}
                      </span>
                      <span className="font-medium text-foreground">{formatFc(l.sousTotal)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t pt-1 font-semibold text-foreground">
                    <span>{t("common.total")}</span>
                    <span className="text-marine dark:text-or">{formatFc(c.total)}</span>
                  </li>
                </ul>
              </div>
            ))}
            {enAttente.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("fournisseurs.noPending")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historique */}
      <Card>
        <CardHeader>
          <CardTitle>{t("fournisseurs.historyTitle")}</CardTitle>
          <CardDescription>{t("fournisseurs.historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>{t("fournisseurs.colSupplier")}</TableHead>
                <TableHead>{t("fournisseurs.colPlacedOn")}</TableHead>
                <TableHead>{t("fournisseurs.colLines")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("fournisseurs.colReceivedOn")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commandes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.numero}</TableCell>
                  <TableCell className="font-medium">{c.fournisseur.nom}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateHeure(c.date)}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">
                    {c.lignes.map((l) => `${formatQuantite(l.quantite, l.matierePremiere.unite)} ${l.matierePremiere.nom}`).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.statut === "RECUE" ? "gold" : "secondary"}>{t(`statutFournisseur.${c.statut}`)}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.dateReception ? formatDateHeure(c.dateReception) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">{formatFc(c.total)}</TableCell>
                </TableRow>
              ))}
              {commandes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {t("fournisseurs.noOrder")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {commandes.map((c) => (
              <CarteLigne key={c.id}>
                <CarteLigneTitre>
                  <span>
                    n°{c.numero} — {c.fournisseur.nom}
                  </span>
                  <Badge variant={c.statut === "RECUE" ? "gold" : "secondary"}>{t(`statutFournisseur.${c.statut}`)}</Badge>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("fournisseurs.colPlacedOn")} value={formatDateHeure(c.date)} />
                <CarteLigneChamp label={t("fournisseurs.colReceivedOn")} value={c.dateReception ? formatDateHeure(c.dateReception) : "—"} />
                <p className="py-1 text-xs text-muted-foreground">
                  {c.lignes.map((l) => `${formatQuantite(l.quantite, l.matierePremiere.unite)} ${l.matierePremiere.nom}`).join(", ")}
                </p>
                <CarteLigneChamp
                  label={t("common.total")}
                  value={<span className="font-semibold text-marine dark:text-or">{formatFc(c.total)}</span>}
                />
              </CarteLigne>
            ))}
            {commandes.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("fournisseurs.noOrder")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog fournisseur */}
      <Dialog open={dialogFournisseur} onOpenChange={setDialogFournisseur}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverFournisseur.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{fournisseurEdite ? t("fournisseurs.supplierDialogEdit", { nom: fournisseurEdite.nom }) : t("fournisseurs.supplierDialogNew")}</DialogTitle>
              <DialogDescription>{t("fournisseurs.supplierDialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fournisseur-nom">{t("common.name")}</Label>
                <Input id="fournisseur-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fournisseur-contact">{t("fournisseurs.contactOptional")}</Label>
                <Input
                  id="fournisseur-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder={t("fournisseurs.contactPlaceholder")}
                />
              </div>
            </div>
            {erreurFournisseur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurFournisseur}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogFournisseur(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverFournisseur.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog bon de commande */}
      <Dialog open={dialogCommande} onOpenChange={setDialogCommande}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              creerCommande.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("fournisseurs.orderDialogTitle")}</DialogTitle>
              <DialogDescription>{t("fournisseurs.orderDialogDesc")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="cmd-fournisseur">{t("fournisseurs.supplier")}</Label>
              <NativeSelect id="cmd-fournisseur" value={cmdFournisseurId} onChange={(e) => setCmdFournisseurId(e.target.value)} required>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label>{t("fournisseurs.linesLabel")}</Label>
              {lignes.map((l, index) => {
                const matiere = matieres.find((m) => m.id === l.matierePremiereId);
                return (
                  <div key={index} className="flex items-center gap-2">
                    <NativeSelect
                      value={l.matierePremiereId}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, matierePremiereId: e.target.value } : x)))
                      }
                      required
                      aria-label={t("fournisseurs.ariaLineMatiere", { n: index + 1 })}
                    >
                      <option value="">{t("fournisseurs.chooseMatiere")}</option>
                      {matieres.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nom}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      type="number"
                      min="0.001"
                      step="0.001"
                      className="w-24 shrink-0"
                      placeholder={matiere ? matiere.unite : t("fournisseurs.qtyPlaceholder")}
                      value={l.quantite}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, quantite: e.target.value } : x)))
                      }
                      required
                      aria-label={t("fournisseurs.ariaLineQty", { n: index + 1 })}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="w-28 shrink-0"
                      placeholder={t("fournisseurs.pricePlaceholder")}
                      value={l.prixUnitaire}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, prixUnitaire: e.target.value } : x)))
                      }
                      required
                      aria-label={t("fournisseurs.ariaLinePrice", { n: index + 1 })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-terracotta hover:text-terracotta"
                      onClick={() => setLignes((prev) => prev.filter((_, i) => i !== index))}
                      disabled={lignes.length === 1}
                      aria-label={t("fournisseurs.ariaRemoveLine", { n: index + 1 })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLignes((prev) => [...prev, { matierePremiereId: "", quantite: "", prixUnitaire: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("fournisseurs.addLine")}
                </Button>
                <p className="text-sm font-semibold">
                  {t("common.total")} : <span className="text-marine dark:text-or">{formatFc(totalCommande)}</span>
                </p>
              </div>
            </div>

            {erreurCommande && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurCommande}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCommande(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={creerCommande.isPending}>
                {t("fournisseurs.placeOrder")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation de réception */}
      <Dialog open={!!commandeAReceptionner} onOpenChange={(open) => !open && setCommandeAReceptionner(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("fournisseurs.receptionTitle", { numero: commandeAReceptionner?.numero })}</DialogTitle>
            <DialogDescription>{t("fournisseurs.receptionDesc")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {commandeAReceptionner?.lignes.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>{l.matierePremiere.nom}</span>
                <span className="font-medium text-foreground">
                  +{formatQuantite(l.quantite, l.matierePremiere.unite)}
                </span>
              </li>
            ))}
          </ul>
          {erreurReception && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {erreurReception}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommandeAReceptionner(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="cta"
              disabled={receptionner.isPending}
              onClick={() => commandeAReceptionner && receptionner.mutate(commandeAReceptionner.id)}
            >
              <PackageCheck className="h-4 w-4" />
              {t("fournisseurs.confirmReception")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
