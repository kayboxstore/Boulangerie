import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Layers, Plus, RotateCcw, TriangleAlert, UserPlus, Users } from "lucide-react";
// TriangleAlert sert au doublon ET au bandeau de dettes non payées.
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  calculerCommande,
  formatFc,
  type ClientDTO,
  type AlerteDetteDTO,
  type CommandeDTO,
  type ConflitCommandeDTO,
  type ResumeCommandesJourDTO,
  type StrategieDoublon,
  type TypeClientDTO,
  type ZoneDepositaireDTO,
} from "@lomoto/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

interface Filtres {
  typeClientId: string;
  du: string;
  au: string;
}

const FILTRES_VIDES: Filtres = { typeClientId: "", du: "", au: "" };

export function CommandesPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("COMMANDES");

  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);

  const { data: typesData } = useQuery({
    queryKey: ["type-clients"],
    queryFn: () => api<{ typeClients: TypeClientDTO[] }>("/api/type-clients"),
  });
  // La liste des clients (gérée sur l'écran dédié /commandes/clients, 3.4) reste
  // lue ici pour le menu déroulant de la nouvelle commande.
  const { data: clientsData } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<{ clients: ClientDTO[] }>("/api/clients"),
  });
  const { data: zonesData } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });

  const paramsListe = new URLSearchParams();
  if (filtres.typeClientId) paramsListe.set("typeClientId", filtres.typeClientId);
  if (filtres.du) paramsListe.set("du", filtres.du);
  if (filtres.au) paramsListe.set("au", filtres.au);
  const { data, isLoading, error } = useQuery({
    queryKey: ["commandes", filtres],
    queryFn: () => api<{ commandes: CommandeDTO[] }>(`/api/commandes?${paramsListe}`),
  });
  // Tableau de bord journalier (section 3.4) — lecture pour tous les rôles
  // ayant accès au module.
  const { data: resumeJour } = useQuery({
    queryKey: ["commandes-resume-jour"],
    queryFn: () => api<ResumeCommandesJourDTO>("/api/commandes/resume-jour"),
  });
  // Dettes non payées (3.4) : même clé que le déclencheur du Layout — la liste
  // reste affichée tant que la dette n'est pas soldée, même si la notification
  // ponctuelle est déjà partie.
  const { data: alertesData } = useQuery({
    queryKey: ["alertes-dette"],
    queryFn: () => api<{ alertes: AlerteDetteDTO[] }>("/api/commandes/alertes-dette"),
  });
  const alertesDette = alertesData?.alertes ?? [];

  // --- Dialogue nouvelle commande -----------------------------------------
  const [dialogCommande, setDialogCommande] = useState(false);
  const [clientId, setClientId] = useState("");
  const [bacs, setBacs] = useState("");
  const [recu, setRecu] = useState("");
  const [erreurCommande, setErreurCommande] = useState<string | null>(null);

  const clientChoisi = clientsData?.clients.find((c) => c.id === clientId);
  const apercu = useMemo(() => {
    const nbBacs = Number(bacs);
    if (!clientChoisi || !Number.isInteger(nbBacs) || nbBacs < 1) return null;
    return calculerCommande({
      quantiteBacs: nbBacs,
      prixParBac: clientChoisi.typeClient.prixParBac,
      avanceExistante: clientChoisi.avanceDisponible,
      montantRecu: Number(recu) >= 0 ? Number(recu) || 0 : 0,
    });
  }, [clientChoisi, bacs, recu]);

  // Doublon détecté (même client, même jour) : l'API renvoie 409 avec la
  // commande en conflit ; on propose alors Modifier ou Remplacer, appliqué sur
  // CETTE commande (jamais une nouvelle).
  const [conflit, setConflit] = useState<ConflitCommandeDTO | null>(null);

  const rafraichirCommandes = () => {
    queryClient.invalidateQueries({ queryKey: ["commandes"] });
    queryClient.invalidateQueries({ queryKey: ["commandes-resume-jour"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["commissions"] });
  };

  const creerCommande = useMutation({
    mutationFn: (strategie?: StrategieDoublon) =>
      api("/api/commandes", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          quantiteBacs: Number(bacs),
          montantRecu: Number(recu) || 0,
          ...(strategie ? { strategie } : {}),
        }),
      }),
    onSuccess: () => {
      setDialogCommande(false);
      setConflit(null);
      rafraichirCommandes();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        const corps = e.corps as ConflitCommandeDTO | undefined;
        if (corps?.conflit) {
          setConflit(corps);
          return;
        }
      }
      setErreurCommande(e instanceof Error ? e.message : t("commandes.saveError"));
    },
  });

  function ouvrirDialogCommande() {
    setClientId("");
    setBacs("");
    setRecu("");
    setErreurCommande(null);
    setConflit(null);
    setDialogCommande(true);
  }

  function soumettreCommande(e: FormEvent) {
    e.preventDefault();
    setErreurCommande(null);
    if (!clientId) return setErreurCommande(t("commandes.errChooseClient"));
    const nbBacs = Number(bacs);
    if (!Number.isInteger(nbBacs) || nbBacs < 1) return setErreurCommande(t("commandes.errBacs"));
    const montantRecu = Number(recu) || 0;
    if (!Number.isInteger(montantRecu) || montantRecu < 0) return setErreurCommande(t("commandes.errReceived"));
    creerCommande.mutate(undefined);
  }

  // --- Dialogue règlement de dette ----------------------------------------
  const [commandeARegler, setCommandeARegler] = useState<CommandeDTO | null>(null);
  const [montantReglement, setMontantReglement] = useState("");
  const [erreurReglement, setErreurReglement] = useState<string | null>(null);

  const apercuReglement = useMemo(() => {
    const montant = Number(montantReglement);
    if (!commandeARegler || !Number.isInteger(montant) || montant < 1) return null;
    return calculerCommande({
      quantiteBacs: commandeARegler.quantiteBacs,
      prixParBac: commandeARegler.montantBrut / commandeARegler.quantiteBacs,
      avanceExistante: commandeARegler.avanceUtilisee,
      montantRecu: commandeARegler.montantRecu + montant,
    });
  }, [commandeARegler, montantReglement]);

  const enregistrerReglement = useMutation({
    mutationFn: () =>
      api(`/api/commandes/${commandeARegler!.id}/reglements`, {
        method: "POST",
        body: JSON.stringify({ montant: Number(montantReglement) }),
      }),
    onSuccess: () => {
      setCommandeARegler(null);
      rafraichirCommandes();
    },
    onError: (e) => setErreurReglement(e instanceof Error ? e.message : t("commandes.saveError")),
  });

  function ouvrirReglement(c: CommandeDTO) {
    setCommandeARegler(c);
    setMontantReglement("");
    setErreurReglement(null);
  }

  function soumettreReglement(e: FormEvent) {
    e.preventDefault();
    setErreurReglement(null);
    const montant = Number(montantReglement);
    if (!Number.isInteger(montant) || montant < 1) return setErreurReglement(t("commandes.errSettle"));
    enregistrerReglement.mutate();
  }

  // --- Dialogue nouveau client (création rapide depuis la commande) -------
  // La gestion complète (recherche, édition, suppression) vit sur l'écran
  // dédié /commandes/clients (3.4, sous-module de Commandes) — ici on garde
  // juste la création rapide, pour ne pas interrompre la saisie d'une commande.
  const [dialogClient, setDialogClient] = useState(false);
  const [nomClient, setNomClient] = useState("");
  const [telClient, setTelClient] = useState("");
  const [qualiteClient, setQualiteClient] = useState("");
  const [zoneClient, setZoneClient] = useState("");
  const [erreurClient, setErreurClient] = useState<string | null>(null);

  // La zone de dépôt (3.3 d) n'a de sens que pour la Qualité Dépositaire.
  const qualiteClientEstDepositaire =
    typesData?.typeClients.find((tc) => tc.id === qualiteClient)?.nom === "Dépositaire";

  function ouvrirNouveauClient() {
    setNomClient("");
    setTelClient("");
    setQualiteClient("");
    setZoneClient("");
    setErreurClient(null);
    setDialogClient(true);
  }

  const creerClient = useMutation({
    mutationFn: () =>
      api<{ client: ClientDTO }>("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          nom: nomClient.trim(),
          telephone: telClient.trim() || undefined,
          typeClientId: qualiteClient,
          zoneDepositaireId: qualiteClientEstDepositaire && zoneClient ? zoneClient : undefined,
        }),
      }),
    onSuccess: (r) => {
      setDialogClient(false);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientId(r.client.id); // pré-sélectionne le client créé dans le formulaire de commande
    },
    onError: (e) => setErreurClient(e instanceof Error ? e.message : t("commandes.clientCreateError")),
  });

  function soumettreClient(e: FormEvent) {
    e.preventDefault();
    setErreurClient(null);
    if (!nomClient.trim()) return setErreurClient(t("commandes.errNameRequired"));
    if (!qualiteClient) return setErreurClient(t("commandes.errChooseQuality"));
    creerClient.mutate();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("commandes.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("commandes.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/commandes/clients">
              <Users className="h-4 w-4" />
              {t("commandes.manageClients")}
            </Link>
          </Button>
          {editable && (
            <Button variant="cta" onClick={ouvrirDialogCommande}>
              <Plus className="h-4 w-4" />
              {t("commandes.newOrder")}
            </Button>
          )}
        </div>
      </div>

      {/* Dettes non payées (3.4) — bandeau visible tant que la dette dure */}
      {alertesDette.length > 0 && (
        <div
          role="status"
          className="rounded-lg border-2 border-rouge-alerte bg-rouge-alerte/10 px-4 py-3"
        >
          <p className="flex items-center gap-2 font-semibold text-rouge-alerte">
            <TriangleAlert className="h-4 w-4" />
            {t("commandes.unpaidDebtTitle", { count: alertesDette.length })}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {alertesDette.map((a) => (
              <li key={a.commandeId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-marine dark:text-creme">n°{a.numero}</span>
                <span>{a.clientNom}</span>
                <span className="font-semibold text-rouge-alerte">{formatFc(a.dette)}</span>
                <span className="text-xs text-muted-foreground">
                  {t("commandes.unpaidDebtSince", { count: a.joursDepuis })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tableau de bord journalier (section 3.4) */}
      {resumeJour && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Layers className="h-5 w-5 text-or" />
              {t("commandes.todayTitle")}
            </CardTitle>
            <CardDescription>{t("commandes.todayDesc", { date: resumeJour.date })}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { cle: "todayOrders", valeur: String(resumeJour.nombreCommandes) },
                { cle: "todayBacs", valeur: String(resumeJour.totalBacs) },
                { cle: "todayToCollect", valeur: formatFc(resumeJour.totalAPercevoir) },
                { cle: "todayReceived", valeur: formatFc(resumeJour.totalRecu) },
                {
                  cle: "todaySettled",
                  valeur: `${resumeJour.nbSoldees} / ${resumeJour.nbAvecDette}`,
                },
                { cle: "todayDebts", valeur: formatFc(resumeJour.totalDettes) },
              ].map(({ cle, valeur }) => (
                <div key={cle}>
                  <dt className="text-xs text-muted-foreground">{t(`commandes.${cle}`)}</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-marine dark:text-creme">{valeur}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Filtres : Qualité, dates, Tout afficher */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-44 space-y-1.5">
            <Label htmlFor="filtre-qualite">{t("commandes.filterQuality")}</Label>
            <NativeSelect
              id="filtre-qualite"
              value={filtres.typeClientId}
              onChange={(e) => setFiltres({ ...filtres, typeClientId: e.target.value })}
            >
              <option value="">{t("commandes.filterAll")}</option>
              {typesData?.typeClients.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.nom}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filtre-du">{t("common.from")}</Label>
            <Input
              id="filtre-du"
              type="date"
              value={filtres.du}
              onChange={(e) => setFiltres({ ...filtres, du: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filtre-au">{t("common.to")}</Label>
            <Input
              id="filtre-au"
              type="date"
              value={filtres.au}
              onChange={(e) => setFiltres({ ...filtres, au: e.target.value })}
            />
          </div>
          <Button variant="outline" onClick={() => setFiltres(FILTRES_VIDES)}>
            <RotateCcw className="h-4 w-4" />
            {t("common.showAll")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("commandes.cardTitle")}</CardTitle>
          <CardDescription>{editable ? t("commandes.descWrite") : t("commandes.descRead")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-8 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("commandes.loadError")}
            </p>
          )}
          {data && (
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("commandes.colClient")}</TableHead>
                  <TableHead>{t("commandes.colQuality")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colBacs")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colGross")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colAdvanceUsed")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colToCollect")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colReceived")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colDebt")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colAdvanceGen")}</TableHead>
                  <TableHead className="text-right">{t("commandes.colNewAdvance")}</TableHead>
                  {editable && <TableHead className="w-20 text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.commandes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.numero}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.dateCreation)}
                    </TableCell>
                    <TableCell className="font-medium">{c.client.nom}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{c.qualite}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.quantiteBacs}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatFc(c.montantBrut)}</TableCell>
                    <TableCell className="text-right">
                      {c.avanceUtilisee > 0 ? (
                        <span className="font-medium text-terracotta">− {formatFc(c.avanceUtilisee)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-marine dark:text-or">
                      {formatFc(c.montantAPercevoir)}
                    </TableCell>
                    <TableCell className="text-right">{formatFc(c.montantRecu)}</TableCell>
                    <TableCell className="text-right">
                      {c.dette > 0 ? (
                        <Badge variant="destructive">{formatFc(c.dette)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.avanceGeneree > 0 ? (
                        <Badge variant="gold">+ {formatFc(c.avanceGeneree)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatFc(c.nouvelleAvance)}</TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        {c.dette > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => ouvrirReglement(c)}
                            className="gap-1 border-terracotta/40 text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
                          >
                            <HandCoins className="h-3.5 w-3.5" />
                            {t("commandes.settle")}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {data.commandes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 13 : 12} className="py-8 text-center text-muted-foreground">
                      {t("commandes.emptyCriteria")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* Mobile : cartes — 12-13 colonnes est le tableau le plus dense de
              l'app, aucun scroll horizontal contenu ne le rendrait lisible. */}
          {data && (
            <div className="space-y-2 md:hidden">
              {data.commandes.map((c) => (
                <CarteLigne key={c.id}>
                  <CarteLigneTitre>
                    <span>
                      n°{c.numero} — {c.client.nom}
                    </span>
                    <Badge variant="secondary">{c.qualite}</Badge>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("common.date")} value={formatDate(c.dateCreation)} />
                  <CarteLigneChamp label={t("commandes.colBacs")} value={c.quantiteBacs} />
                  <CarteLigneChamp label={t("commandes.colGross")} value={formatFc(c.montantBrut)} />
                  {c.avanceUtilisee > 0 && (
                    <CarteLigneChamp
                      label={t("commandes.colAdvanceUsed")}
                      value={<span className="font-medium text-terracotta">− {formatFc(c.avanceUtilisee)}</span>}
                    />
                  )}
                  <CarteLigneChamp
                    label={t("commandes.colToCollect")}
                    value={<span className="font-semibold text-marine dark:text-or">{formatFc(c.montantAPercevoir)}</span>}
                  />
                  <CarteLigneChamp label={t("commandes.colReceived")} value={formatFc(c.montantRecu)} />
                  {c.dette > 0 && (
                    <CarteLigneChamp label={t("commandes.colDebt")} value={<Badge variant="destructive">{formatFc(c.dette)}</Badge>} />
                  )}
                  {c.avanceGeneree > 0 && (
                    <CarteLigneChamp label={t("commandes.colAdvanceGen")} value={<Badge variant="gold">+ {formatFc(c.avanceGeneree)}</Badge>} />
                  )}
                  <CarteLigneChamp label={t("commandes.colNewAdvance")} value={<span className="font-medium">{formatFc(c.nouvelleAvance)}</span>} />
                  {editable && c.dette > 0 && (
                    <CarteLigneActions>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => ouvrirReglement(c)}
                        className="gap-1 border-terracotta/40 text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
                      >
                        <HandCoins className="h-3.5 w-3.5" />
                        {t("commandes.settle")}
                      </Button>
                    </CarteLigneActions>
                  )}
                </CarteLigne>
              ))}
              {data.commandes.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("commandes.emptyCriteria")}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogue nouvelle commande */}
      <Dialog open={dialogCommande} onOpenChange={setDialogCommande}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commandes.newOrder")}</DialogTitle>
            <DialogDescription>{t("commandes.newOrderDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={soumettreCommande} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="commande-client">{t("commandes.client")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={ouvrirNouveauClient}
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t("commandes.newClient")}
                </Button>
              </div>
              <NativeSelect id="commande-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">{t("commandes.chooseClient")}</option>
                {clientsData?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom} · {c.typeClient.nom}
                    {c.avanceDisponible > 0 ? t("commandes.optionAdvance", { montant: formatFc(c.avanceDisponible) }) : ""}
                  </option>
                ))}
              </NativeSelect>
              {clientChoisi && (
                <p className="text-xs text-muted-foreground">
                  {t("commandes.clientHintPrice", {
                    qualite: clientChoisi.typeClient.nom,
                    prix: formatFc(clientChoisi.typeClient.prixParBac),
                  })}
                  {clientChoisi.avanceDisponible > 0 &&
                    t("commandes.clientHintAdvance", { montant: formatFc(clientChoisi.avanceDisponible) })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="commande-bacs">{t("commandes.bacsReceived")}</Label>
                <Input
                  id="commande-bacs"
                  type="number"
                  min={1}
                  step={1}
                  value={bacs}
                  onChange={(e) => setBacs(e.target.value)}
                  placeholder="3"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="commande-recu">{t("commandes.amountReceived")}</Label>
                <Input
                  id="commande-recu"
                  type="number"
                  min={0}
                  step={1}
                  value={recu}
                  onChange={(e) => setRecu(e.target.value)}
                  placeholder="18000"
                />
              </div>
            </div>

            {apercu && (
              <div className="rounded-lg border border-or/40 bg-or/5 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("commandes.previewGross", { bacs, prix: formatFc(clientChoisi!.typeClient.prixParBac) })}</span>
                  <span>{formatFc(apercu.montantBrut)}</span>
                </div>
                {apercu.avanceUtilisee > 0 && (
                  <div className="flex justify-between text-terracotta">
                    <span>{t("commandes.previewAdvanceUsed")}</span>
                    <span>− {formatFc(apercu.avanceUtilisee)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                  <span>{t("commandes.previewToCollect")}</span>
                  <span>{formatFc(apercu.montantAPercevoir)}</span>
                </div>
                {apercu.dette > 0 && (
                  <div className="flex justify-between font-medium text-terracotta">
                    <span>{t("commandes.previewDebt")}</span>
                    <span>{formatFc(apercu.dette)}</span>
                  </div>
                )}
                {apercu.avanceGeneree > 0 && (
                  <div className="flex justify-between font-medium text-or">
                    <span>{t("commandes.previewAdvanceGen")}</span>
                    <span>+ {formatFc(apercu.avanceGeneree)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("commandes.previewNewAdvance")}</span>
                  <span>{formatFc(apercu.nouvelleAvance)}</span>
                </div>
              </div>
            )}

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
                {t("commandes.saveOrder")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Doublon détecté : Modifier ou Remplacer — toujours sur LA MÊME commande */}
      <Dialog open={!!conflit} onOpenChange={(o) => !o && setConflit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-terracotta dark:text-or" />
              {t("commandes.duplicateTitle")}
            </DialogTitle>
            <DialogDescription>
              {conflit &&
                t("commandes.duplicateDesc", {
                  client: conflit.commandeExistante.client.nom,
                  numero: conflit.commandeExistante.numero,
                })}
            </DialogDescription>
          </DialogHeader>

          {conflit && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">{t("commandes.duplicateExisting")}</p>
                <p className="text-muted-foreground">
                  {t("commandes.duplicateLine", {
                    bacs: conflit.commandeExistante.quantiteBacs,
                    recu: formatFc(conflit.commandeExistante.montantRecu),
                  })}
                </p>
              </div>

              {(["MODIFIER", "REMPLACER"] as StrategieDoublon[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={creerCommande.isPending}
                  onClick={() => creerCommande.mutate(s)}
                  className="w-full rounded-lg border border-input px-3 py-2.5 text-left transition-colors hover:border-or hover:bg-or/10 disabled:opacity-50"
                >
                  <p className="font-semibold text-marine dark:text-creme">{t(`commandes.strategy.${s}`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`commandes.strategyHelp.${s}`)}</p>
                  <p className="mt-1 text-sm font-medium text-terracotta dark:text-or">
                    {t("commandes.duplicateResult", {
                      numero: conflit.commandeExistante.numero,
                      bacs: conflit.apercu[s].quantiteBacs,
                      recu: formatFc(conflit.apercu[s].montantRecu),
                    })}
                  </p>
                </button>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConflit(null)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue règlement de dette */}
      <Dialog open={!!commandeARegler} onOpenChange={(o) => !o && setCommandeARegler(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("commandes.settleTitle", { numero: commandeARegler?.numero, client: commandeARegler?.client.nom })}
            </DialogTitle>
            <DialogDescription>{t("commandes.settleDesc")}</DialogDescription>
          </DialogHeader>
          {commandeARegler && (
            <form onSubmit={soumettreReglement} className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-terracotta/10 px-3 py-2 text-sm">
                <span className="font-medium text-terracotta">{t("commandes.currentDebt")}</span>
                <span className="font-bold text-terracotta">{formatFc(commandeARegler.dette)}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reglement-montant">{t("commandes.settleAmount")}</Label>
                <Input
                  id="reglement-montant"
                  type="number"
                  min={1}
                  step={1}
                  value={montantReglement}
                  onChange={(e) => setMontantReglement(e.target.value)}
                  placeholder={String(commandeARegler.dette)}
                  autoFocus
                  required
                />
              </div>

              {apercuReglement && (
                <div className="rounded-lg border border-or/40 bg-or/5 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>{t("commandes.newDebt")}</span>
                    <span className={apercuReglement.dette > 0 ? "font-medium text-terracotta" : "font-medium"}>
                      {apercuReglement.dette > 0 ? formatFc(apercuReglement.dette) : t("commandes.settled")}
                    </span>
                  </div>
                  {apercuReglement.avanceGeneree > 0 && (
                    <div className="flex justify-between font-medium text-or">
                      <span>{t("commandes.advanceForClient")}</span>
                      <span>+ {formatFc(apercuReglement.avanceGeneree)}</span>
                    </div>
                  )}
                </div>
              )}

              {commandeARegler.reglements.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{t("commandes.previousSettlements")}</p>
                  {commandeARegler.reglements.map((r) => (
                    <p key={r.id}>
                      {formatDate(r.date)} — {formatFc(r.montant)}
                      {r.enregistrePar ? ` ${t("commandes.settledBy", { nom: r.enregistrePar.nom })}` : ""}
                    </p>
                  ))}
                </div>
              )}

              {erreurReglement && (
                <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                  {erreurReglement}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCommandeARegler(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" variant="cta" disabled={enregistrerReglement.isPending}>
                  {t("commandes.saveSettlement")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialogue nouveau client (création rapide) */}
      <Dialog open={dialogClient} onOpenChange={setDialogClient}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commandes.newClientTitle")}</DialogTitle>
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
              <Button type="submit" variant="cta" disabled={creerClient.isPending}>
                {t("commandes.createClient")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
