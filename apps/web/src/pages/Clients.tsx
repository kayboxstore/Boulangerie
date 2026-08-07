import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatFc, type ClientDTO, type TypeClientDTO, type ZoneDepositaireDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Sous-module de Commandes (3.4) : la fiche client (nom, téléphone, qualité,
 * zone de dépôt) est déplacée ici pour ne pas encombrer l'écran quotidien des
 * commandes — même permission (COMMANDES), simplement un écran à part.
 */
export function ClientsPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();
  const editable = peutEcrire("COMMANDES");

  const { data: typesData } = useQuery({
    queryKey: ["type-clients"],
    queryFn: () => api<{ typeClients: TypeClientDTO[] }>("/api/type-clients"),
  });
  const { data: clientsData } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<{ clients: ClientDTO[] }>("/api/clients"),
  });
  const { data: zonesData } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });

  const [recherche, setRecherche] = useState("");
  const clientsFiltres = useMemo(() => {
    const tous = clientsData?.clients ?? [];
    const terme = recherche.trim().toLowerCase();
    if (!terme) return tous;
    return tous.filter((c) => c.nom.toLowerCase().includes(terme));
  }, [clientsData, recherche]);

  const [dialogClient, setDialogClient] = useState(false);
  const [clientEnEdition, setClientEnEdition] = useState<ClientDTO | null>(null);
  const [nomClient, setNomClient] = useState("");
  const [telClient, setTelClient] = useState("");
  const [qualiteClient, setQualiteClient] = useState("");
  const [zoneClient, setZoneClient] = useState("");
  const [erreurClient, setErreurClient] = useState<string | null>(null);

  // La zone de dépôt (3.3 d) n'a de sens que pour la Qualité Dépositaire.
  const qualiteClientEstDepositaire =
    typesData?.typeClients.find((tc) => tc.id === qualiteClient)?.nom === "Dépositaire";

  function ouvrirNouveauClient() {
    setClientEnEdition(null);
    setNomClient("");
    setTelClient("");
    setQualiteClient("");
    setZoneClient("");
    setErreurClient(null);
    setDialogClient(true);
  }

  function ouvrirModifierClient(c: ClientDTO) {
    setClientEnEdition(c);
    setNomClient(c.nom);
    setTelClient(c.telephone ?? "");
    setQualiteClient(c.typeClient.id);
    setZoneClient(c.zoneDepositaireId ?? "");
    setErreurClient(null);
    setDialogClient(true);
  }

  const sauvegarderClient = useMutation({
    mutationFn: () => {
      const corps = {
        nom: nomClient.trim(),
        telephone: telClient.trim() || undefined,
        typeClientId: qualiteClient,
        // En édition, une qualité qui n'est plus Dépositaire (ou une zone
        // désélectionnée) doit effacer explicitement la zone (null) — à la
        // création, l'omettre suffit (le champ est simplement absent).
        zoneDepositaireId: qualiteClientEstDepositaire
          ? zoneClient || null
          : clientEnEdition
            ? null
            : undefined,
      };
      return clientEnEdition
        ? api<{ client: ClientDTO }>(`/api/clients/${clientEnEdition.id}`, {
            method: "PUT",
            body: JSON.stringify(corps),
          })
        : api<{ client: ClientDTO }>("/api/clients", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogClient(false);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientEnEdition(null);
    },
    onError: (e) => setErreurClient(e instanceof Error ? e.message : t("commandes.clientCreateError")),
  });

  const supprimerClient = useMutation({
    mutationFn: (id: string) => api(`/api/clients/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("commandes.clientDeleteError")),
  });

  function soumettreClient(e: FormEvent) {
    e.preventDefault();
    setErreurClient(null);
    if (!nomClient.trim()) return setErreurClient(t("commandes.errNameRequired"));
    if (!qualiteClient) return setErreurClient(t("commandes.errChooseQuality"));
    sauvegarderClient.mutate();
  }

  async function demanderSuppression(c: ClientDTO) {
    if (await confirmer({ description: t("commandes.confirmDeleteClient", { nom: c.nom }), destructive: true }))
      supprimerClient.mutate(c.id);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/commandes"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-marine dark:hover:text-creme"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("commandes.backToCommandes")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-serif text-3xl font-bold text-marine dark:text-creme">
              <Users className="h-7 w-7 text-or" />
              {t("commandes.clientsCardTitle")}
            </h1>
            <p className="mt-1 text-muted-foreground">{t("commandes.clientsCardDesc")}</p>
          </div>
          {editable && (
            <Button variant="cta" onClick={ouvrirNouveauClient}>
              <Plus className="h-4 w-4" />
              {t("commandes.newClient")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="w-full max-w-sm space-y-1.5">
            <Label htmlFor="client-recherche">{t("commandes.searchClient")}</Label>
            <Input
              id="client-recherche"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t("commandes.searchClientPlaceholder")}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("commandes.colPhone")}</TableHead>
                <TableHead>{t("commandes.colQuality")}</TableHead>
                <TableHead>{t("commandes.colZone")}</TableHead>
                <TableHead className="text-right">{t("commandes.colAdvance")}</TableHead>
                {editable && <TableHead className="w-24 text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientsFiltres.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nom}</TableCell>
                  <TableCell className="text-muted-foreground">{c.telephone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.typeClient.nom}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.zoneDepositaireNom ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {c.avanceDisponible > 0 ? (
                      <Badge variant="gold">{formatFc(c.avanceDisponible)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => ouvrirModifierClient(c)}
                          aria-label={t("commandes.ariaEditClient", { nom: c.nom })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-terracotta hover:text-terracotta"
                          onClick={() => demanderSuppression(c)}
                          aria-label={t("commandes.ariaDeleteClient", { nom: c.nom })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {clientsFiltres.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    {recherche ? t("commandes.noClientsFiltered") : t("commandes.noClients")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {clientsFiltres.map((c) => (
              <CarteLigne key={c.id}>
                <CarteLigneTitre>
                  <span>{c.nom}</span>
                  <Badge variant="secondary">{c.typeClient.nom}</Badge>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("commandes.colPhone")} value={c.telephone ?? "—"} />
                {c.zoneDepositaireNom && <CarteLigneChamp label={t("commandes.colZone")} value={c.zoneDepositaireNom} />}
                {c.avanceDisponible > 0 && (
                  <CarteLigneChamp label={t("commandes.colAdvance")} value={<Badge variant="gold">{formatFc(c.avanceDisponible)}</Badge>} />
                )}
                {editable && (
                  <CarteLigneActions>
                    <Button variant="outline" size="sm" onClick={() => ouvrirModifierClient(c)} className="gap-1">
                      <Pencil className="h-3.5 w-3.5" />
                      {t("commandes.editClient")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={() => demanderSuppression(c)}
                      aria-label={t("commandes.ariaDeleteClient", { nom: c.nom })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {clientsFiltres.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {recherche ? t("commandes.noClientsFiltered") : t("commandes.noClients")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogue nouveau client / modification client */}
      <Dialog
        open={dialogClient}
        onOpenChange={(o) => {
          setDialogClient(o);
          if (!o) setClientEnEdition(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clientEnEdition ? t("commandes.editClientTitle", { nom: clientEnEdition.nom }) : t("commandes.newClientTitle")}
            </DialogTitle>
            <DialogDescription>{t("commandes.newClientDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={soumettreClient} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-nom">{t("common.name")}</Label>
              <Input id="client-nom" value={nomClient} onChange={(e) => setNomClient(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="client-tel">{t("commandes.phoneOptional")}</Label>
                <Input id="client-tel" value={telClient} onChange={(e) => setTelClient(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-qualite">{t("commandes.colQuality")}</Label>
                <NativeSelect
                  id="client-qualite"
                  value={qualiteClient}
                  onChange={(e) => setQualiteClient(e.target.value)}
                >
                  <option value="">{t("commandes.chooseQuality")}</option>
                  {typesData?.typeClients.map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.nom} ({formatFc(tc.prixParBac)}/bac)
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {qualiteClientEstDepositaire && (
              <div className="space-y-2">
                <Label htmlFor="client-zone">{t("commandes.depositZoneOptional")}</Label>
                <NativeSelect id="client-zone" value={zoneClient} onChange={(e) => setZoneClient(e.target.value)}>
                  <option value="">{t("commandes.noDepositZone")}</option>
                  {zonesData?.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}

            {erreurClient && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurClient}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogClient(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauvegarderClient.isPending}>
                {clientEnEdition ? t("common.save") : t("commandes.createClient")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
