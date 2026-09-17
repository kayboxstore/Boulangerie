import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, Link2, LogOut, Pencil, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  STATUT_DECISION_ABSENCE_LABELS,
  type AbsenceDTO,
  type AlerteAbsenceDTO,
  type DepartementDTO,
  type PointageDTO,
  type StatutDecisionAbsence,
  type TravailleurDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { PanneauEmailPro } from "@/components/PanneauEmailPro";
import { DepartementsCard } from "@/components/DepartementsCard";
import { PaieCard } from "@/components/PaieCard";
import { cn } from "@/lib/utils";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));
}

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Horodatage complet jour+heure — la différence de jour saute aux yeux (équipes de nuit à cheval sur minuit). */
function formatHorodatage(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** ISO -> valeur affichable dans un <input type="datetime-local"> (heure LOCALE du navigateur, pas UTC). */
function versInputLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Valeur d'un <input type="datetime-local"> -> ISO complet (non ambigu, quel que soit le fuseau du serveur). */
function versISO(valeurLocale: string): string {
  return new Date(valeurLocale).toISOString();
}

function maintenantLocal(): string {
  return versInputLocal(new Date().toISOString());
}

const BADGE_DECISION: Record<StatutDecisionAbsence, string> = {
  EN_ATTENTE: "bg-beige/60 text-marine dark:bg-beige/20 dark:text-creme border-transparent",
  JUSTIFIEE: "bg-or/15 text-terracotta dark:text-or border-transparent",
  NON_JUSTIFIEE: "bg-terracotta text-creme border-transparent",
};

interface CompteLiable {
  id: string;
  nom: string;
  email: string;
}

export function TravailleursPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();
  const editable = peutEcrire("TRAVAILLEURS");

  const { data: travailleursData } = useQuery({
    queryKey: ["travailleurs"],
    queryFn: () => api<{ travailleurs: TravailleurDTO[] }>("/api/travailleurs"),
  });
  const { data: comptesData } = useQuery({
    queryKey: ["comptes-liables"],
    queryFn: () => api<{ comptes: CompteLiable[] }>("/api/travailleurs/comptes-liables"),
    enabled: editable,
  });
  const { data: departementsData } = useQuery({
    queryKey: ["departements"],
    queryFn: () => api<{ departements: DepartementDTO[] }>("/api/departements"),
  });
  // Rappel « absence en attente » (3.18) — même clé de cache que la
  // vérification paresseuse déclenchée au chargement de l'app (Layout.tsx),
  // réservée aux rôles avec écriture (Admin secondaire + Principal).
  const { data: alertesAbsenceData } = useQuery({
    queryKey: ["alertes-absence"],
    queryFn: () => api<{ alertes: AlerteAbsenceDTO[] }>("/api/travailleurs/alertes-absence"),
    enabled: editable,
  });
  const alertesAbsence = alertesAbsenceData?.alertes ?? [];

  // --- Filtres pointage/absence (pattern Commandes : travailleur, dates, Tout afficher)
  const [filtreTravailleur, setFiltreTravailleur] = useState("");
  const [filtreDu, setFiltreDu] = useState("");
  const [filtreAu, setFiltreAu] = useState("");

  const parametres = new URLSearchParams();
  if (filtreTravailleur) parametres.set("travailleurId", filtreTravailleur);
  if (filtreDu) parametres.set("du", filtreDu);
  if (filtreAu) parametres.set("au", filtreAu);
  const chaineParams = parametres.toString();

  const { data: pointagesData } = useQuery({
    queryKey: ["pointages", chaineParams],
    queryFn: () => api<{ pointages: PointageDTO[] }>(`/api/travailleurs/pointages${chaineParams ? `?${chaineParams}` : ""}`),
  });
  const { data: absencesData } = useQuery({
    queryKey: ["absences", chaineParams],
    queryFn: () => api<{ absences: AbsenceDTO[] }>(`/api/travailleurs/absences${chaineParams ? `?${chaineParams}` : ""}`),
  });

  const travailleurs = travailleursData?.travailleurs ?? [];
  const pointages = pointagesData?.pointages ?? [];
  const absences = absencesData?.absences ?? [];
  const comptes = comptesData?.comptes ?? [];
  const departements = departementsData?.departements ?? [];
  const filtresActifs = !!(filtreTravailleur || filtreDu || filtreAu);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["travailleurs"] });
    queryClient.invalidateQueries({ queryKey: ["pointages"] });
  };
  const rafraichirAbsences = () => {
    queryClient.invalidateQueries({ queryKey: ["absences"] });
  };

  // --- Dialog fiche travailleur ---------------------------------------------
  const [dialogFiche, setDialogFiche] = useState(false);
  const [ficheEditee, setFicheEditee] = useState<TravailleurDTO | null>(null);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [poste, setPoste] = useState("");
  const [dateEmbauche, setDateEmbauche] = useState(aujourdhui());
  const [compteLie, setCompteLie] = useState("");
  const [departementId, setDepartementId] = useState("");
  const [groupeId, setGroupeId] = useState("");
  const [salaireMensuel, setSalaireMensuel] = useState("");
  const [joursTravaillesParMois, setJoursTravaillesParMois] = useState("");
  const [erreurFiche, setErreurFiche] = useState<string | null>(null);

  function ouvrirFiche(trav: TravailleurDTO | null) {
    setFicheEditee(trav);
    setNom(trav?.nom ?? "");
    setTelephone(trav?.telephone ?? "");
    setPoste(trav?.poste ?? "");
    setDateEmbauche(trav?.dateEmbauche ?? aujourdhui());
    setCompteLie(trav?.compte?.id ?? "");
    setDepartementId(trav?.departement?.id ?? "");
    setGroupeId(trav?.groupe?.id ?? "");
    setSalaireMensuel(trav?.salaireMensuel != null ? String(trav.salaireMensuel) : "");
    setJoursTravaillesParMois(trav?.joursTravaillesParMois != null ? String(trav.joursTravaillesParMois) : "");
    setErreurFiche(null);
    setDialogFiche(true);
  }

  // Le groupe choisi doit appartenir au département choisi (3.18) — changer
  // de département vide donc systématiquement le groupe sélectionné.
  function changerDepartement(id: string) {
    setDepartementId(id);
    setGroupeId("");
  }

  const groupesDuDepartementChoisi = departements.find((d) => d.id === departementId)?.groupes ?? [];

  // Version toujours à jour de la fiche ouverte (le cache react-query se
  // rafraîchit après chaque action email pro) — ficheEditee reste un instantané.
  const travailleurCourant = ficheEditee ? (travailleurs.find((t) => t.id === ficheEditee.id) ?? ficheEditee) : null;

  const sauverFiche = useMutation({
    mutationFn: () => {
      const commun = {
        nom: nom.trim(),
        telephone: telephone.trim() || undefined,
        poste: poste.trim(),
        dateEmbauche,
      };
      return ficheEditee
        ? api(`/api/travailleurs/${ficheEditee.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...commun,
              utilisateurId: compteLie || null,
              departementId: departementId || null,
              groupeId: groupeId || null,
              salaireMensuel: salaireMensuel ? Number(salaireMensuel) : null,
              joursTravaillesParMois: joursTravaillesParMois ? Number(joursTravaillesParMois) : null,
            }),
          })
        : api("/api/travailleurs", {
            method: "POST",
            body: JSON.stringify({
              ...commun,
              utilisateurId: compteLie || undefined,
              departementId,
              groupeId: groupeId || undefined,
              salaireMensuel: Number(salaireMensuel),
              joursTravaillesParMois: Number(joursTravaillesParMois),
            }),
          });
    },
    onSuccess: () => {
      setDialogFiche(false);
      rafraichir();
    },
    onError: (e) => setErreurFiche(e instanceof Error ? e.message : t("travailleurs.saveError")),
  });

  const supprimerFiche = useMutation({
    mutationFn: (id: string) => api(`/api/travailleurs/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.deleteError")),
  });

  // --- Dialog pointage (horodatage réel entrée/sortie, 3.18) -----------------
  const [dialogPointage, setDialogPointage] = useState(false);
  const [pointageEditee, setPointageEditee] = useState<PointageDTO | null>(null);
  const [ptTravailleurId, setPtTravailleurId] = useState("");
  const [ptEntree, setPtEntree] = useState(maintenantLocal());
  const [ptSortie, setPtSortie] = useState("");
  const [erreurPointage, setErreurPointage] = useState<string | null>(null);

  function ouvrirNouveauPointage(travailleurId?: string) {
    setPointageEditee(null);
    setPtTravailleurId(travailleurId ?? travailleurs[0]?.id ?? "");
    setPtEntree(maintenantLocal());
    setPtSortie("");
    setErreurPointage(null);
    setDialogPointage(true);
  }

  function ouvrirModifierPointage(p: PointageDTO) {
    setPointageEditee(p);
    setPtTravailleurId(p.travailleur.id);
    setPtEntree(versInputLocal(p.horodatageEntree));
    setPtSortie(p.horodatageSortie ? versInputLocal(p.horodatageSortie) : "");
    setErreurPointage(null);
    setDialogPointage(true);
  }

  const sauverPointage = useMutation({
    mutationFn: () => {
      const horodatageSortie = ptSortie ? versISO(ptSortie) : undefined;
      return pointageEditee
        ? api(`/api/travailleurs/pointages/${pointageEditee.id}`, {
            method: "PUT",
            body: JSON.stringify({ horodatageEntree: versISO(ptEntree), horodatageSortie: horodatageSortie ?? null }),
          })
        : api("/api/travailleurs/pointages", {
            method: "POST",
            body: JSON.stringify({ travailleurId: ptTravailleurId, horodatageEntree: versISO(ptEntree), horodatageSortie }),
          });
    },
    onSuccess: () => {
      setDialogPointage(false);
      rafraichir();
    },
    onError: (e) => setErreurPointage(e instanceof Error ? e.message : t("travailleurs.clockInError")),
  });

  const cloturerMaintenant = useMutation({
    mutationFn: (id: string) =>
      api(`/api/travailleurs/pointages/${id}`, {
        method: "PUT",
        body: JSON.stringify({ horodatageSortie: new Date().toISOString() }),
      }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.clockInError")),
  });

  const supprimerPointage = useMutation({
    mutationFn: (id: string) => api(`/api/travailleurs/pointages/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.deleteError")),
  });

  // --- Dialog absence (motif + décision distincte, 3.18) ---------------------
  const [dialogAbsence, setDialogAbsence] = useState(false);
  const [abTravailleurId, setAbTravailleurId] = useState("");
  const [abDate, setAbDate] = useState(aujourdhui());
  const [abMotif, setAbMotif] = useState("");
  const [erreurAbsence, setErreurAbsence] = useState<string | null>(null);

  function ouvrirNouvelleAbsence() {
    setAbTravailleurId(travailleurs[0]?.id ?? "");
    setAbDate(aujourdhui());
    setAbMotif("");
    setErreurAbsence(null);
    setDialogAbsence(true);
  }

  const declarerAbsence = useMutation({
    mutationFn: () =>
      api("/api/travailleurs/absences", {
        method: "POST",
        body: JSON.stringify({ travailleurId: abTravailleurId, date: abDate, motif: abMotif.trim() }),
      }),
    onSuccess: () => {
      setDialogAbsence(false);
      rafraichirAbsences();
    },
    onError: (e) => setErreurAbsence(e instanceof Error ? e.message : t("travailleurs.saveError")),
  });

  const trancherAbsence = useMutation({
    mutationFn: ({ id, decisionStatut }: { id: string; decisionStatut: "JUSTIFIEE" | "NON_JUSTIFIEE" }) =>
      api(`/api/travailleurs/absences/${id}/decision`, {
        method: "PUT",
        body: JSON.stringify({ decisionStatut }),
      }),
    onSuccess: rafraichirAbsences,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.saveError")),
  });

  const supprimerAbsence = useMutation({
    mutationFn: (id: string) => api(`/api/travailleurs/absences/${id}`, { method: "DELETE" }),
    onSuccess: rafraichirAbsences,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.deleteError")),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("travailleurs.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("travailleurs.subtitle")}</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => ouvrirNouveauPointage()} disabled={travailleurs.length === 0}>
              <CalendarCheck className="h-4 w-4" />
              {t("travailleurs.clockIn")}
            </Button>
            <Button variant="outline" onClick={ouvrirNouvelleAbsence} disabled={travailleurs.length === 0}>
              <CalendarX className="h-4 w-4" />
              {t("travailleurs.declareAbsence")}
            </Button>
            <Button variant="cta" onClick={() => ouvrirFiche(null)}>
              <UserPlus className="h-4 w-4" />
              {t("travailleurs.newWorker")}
            </Button>
          </div>
        )}
      </div>

      {/* Rappel absence en attente (3.18) — bandeau visible tant que la décision n'est pas tranchée */}
      {alertesAbsence.length > 0 && (
        <div role="status" className="rounded-lg border-2 border-rouge-alerte bg-rouge-alerte/10 px-4 py-3">
          <p className="flex items-center gap-2 font-semibold text-rouge-alerte">
            <TriangleAlert className="h-4 w-4" />
            {t("travailleurs.pendingAbsenceTitle", { count: alertesAbsence.length })}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {alertesAbsence.map((a) => (
              <li key={a.absenceId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-marine dark:text-creme">{a.travailleurNom}</span>
                <span className="text-muted-foreground">{a.motif}</span>
                <span className="text-xs text-muted-foreground">
                  {t("travailleurs.pendingAbsenceSince", { count: a.joursDepuis })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DepartementsCard travailleurs={travailleurs} editable={editable} />
      <PaieCard travailleurs={travailleurs} editable={editable} />

      {/* Roster */}
      <Card>
        <CardHeader>
          <CardTitle>{t("travailleurs.rosterTitle")}</CardTitle>
          <CardDescription>{t("travailleurs.rosterDesc", { count: travailleurs.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("travailleurs.post")}</TableHead>
                <TableHead>{t("common.phone")}</TableHead>
                <TableHead>{t("travailleurs.colHiredOn")}</TableHead>
                <TableHead>{t("travailleurs.department")}</TableHead>
                <TableHead>{t("travailleurs.colAppAccount")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {travailleurs.map((trav) => (
                <TableRow key={trav.id}>
                  <TableCell className="font-medium">{trav.nom}</TableCell>
                  <TableCell>{trav.poste}</TableCell>
                  <TableCell className="text-muted-foreground">{trav.telephone ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(trav.dateEmbauche)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {trav.departement ? (
                      <>
                        {trav.departement.nom}
                        {trav.groupe && <span className="text-sm"> · {trav.groupe.nom}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {trav.compte ? (
                      <Badge variant="gold">
                        <Link2 className="mr-1 h-3 w-3" />
                        {trav.compte.email}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("travailleurs.noAccess")}</span>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="mr-1" onClick={() => ouvrirNouveauPointage(trav.id)}>
                        <CalendarCheck className="h-3.5 w-3.5" />
                        {t("travailleurs.clockIn")}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFiche(trav)} aria-label={t("travailleurs.ariaEdit", { nom: trav.nom })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={async () => {
                          if (await confirmer({ description: t("travailleurs.confirmDelete", { nom: trav.nom }), destructive: true }))
                            supprimerFiche.mutate(trav.id);
                        }}
                        aria-label={t("travailleurs.ariaDelete", { nom: trav.nom })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {travailleurs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    {t("travailleurs.noWorker")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {travailleurs.map((trav) => (
              <CarteLigne key={trav.id}>
                <CarteLigneTitre>
                  <span>{trav.nom}</span>
                  <span className="text-sm font-normal text-muted-foreground">{trav.poste}</span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("common.phone")} value={trav.telephone ?? "—"} />
                <CarteLigneChamp label={t("travailleurs.colHiredOn")} value={formatDate(trav.dateEmbauche)} />
                <CarteLigneChamp
                  label={t("travailleurs.department")}
                  value={trav.departement ? `${trav.departement.nom}${trav.groupe ? ` · ${trav.groupe.nom}` : ""}` : "—"}
                />
                <CarteLigneChamp
                  label={t("travailleurs.colAppAccount")}
                  value={
                    trav.compte ? (
                      <Badge variant="gold">
                        <Link2 className="mr-1 h-3 w-3" />
                        {trav.compte.email}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{t("travailleurs.noAccess")}</span>
                    )
                  }
                />
                {editable && (
                  <CarteLigneActions>
                    <Button variant="outline" size="sm" onClick={() => ouvrirNouveauPointage(trav.id)}>
                      <CalendarCheck className="h-3.5 w-3.5" />
                      {t("travailleurs.clockIn")}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFiche(trav)} aria-label={t("travailleurs.ariaEdit", { nom: trav.nom })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                          if (await confirmer({ description: t("travailleurs.confirmDelete", { nom: trav.nom }), destructive: true }))
                            supprimerFiche.mutate(trav.id);
                        }}
                      aria-label={t("travailleurs.ariaDelete", { nom: trav.nom })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {travailleurs.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("travailleurs.noWorker")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filtres partagés pointage/absence */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Label htmlFor="filtre-travailleur">{t("travailleurs.worker")}</Label>
          <NativeSelect id="filtre-travailleur" value={filtreTravailleur} onChange={(e) => setFiltreTravailleur(e.target.value)}>
            <option value="">{t("travailleurs.filterAll")}</option>
            {travailleurs.map((trav) => (
              <option key={trav.id} value={trav.id}>
                {trav.nom}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="filtre-du">{t("common.from")}</Label>
          <Input id="filtre-du" type="date" value={filtreDu} onChange={(e) => setFiltreDu(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="filtre-au">{t("common.to")}</Label>
          <Input id="filtre-au" type="date" value={filtreAu} onChange={(e) => setFiltreAu(e.target.value)} />
        </div>
        {filtresActifs && (
          <Button
            variant="outline"
            onClick={() => {
              setFiltreTravailleur("");
              setFiltreDu("");
              setFiltreAu("");
            }}
          >
            {t("common.showAll")}
          </Button>
        )}
      </div>

      {/* Historique de pointage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("travailleurs.pointageTitle")}</CardTitle>
          <CardDescription>{t("travailleurs.pointageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("travailleurs.worker")}</TableHead>
                <TableHead>{t("travailleurs.post")}</TableHead>
                <TableHead>{t("travailleurs.colEntry")}</TableHead>
                <TableHead>{t("travailleurs.colExit")}</TableHead>
                <TableHead>{t("travailleurs.colRecordedBy")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pointages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.travailleur.nom}</TableCell>
                  <TableCell className="text-muted-foreground">{p.travailleur.poste}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatHorodatage(p.horodatageEntree)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.horodatageSortie ? (
                      formatHorodatage(p.horodatageSortie)
                    ) : (
                      <Badge variant="outline">{t("travailleurs.stillOnDuty")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{p.enregistrePar?.nom ?? "—"}</TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      {!p.horodatageSortie && (
                        <Button variant="outline" size="sm" className="mr-1" onClick={() => cloturerMaintenant.mutate(p.id)}>
                          <LogOut className="h-3.5 w-3.5" />
                          {t("travailleurs.clockOutNow")}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirModifierPointage(p)} aria-label={t("travailleurs.ariaEditClockIn")}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={async () => {
                          if (await confirmer({ description: t("travailleurs.confirmDeleteClockIn"), destructive: true }))
                            supprimerPointage.mutate(p.id);
                        }}
                        aria-label={t("travailleurs.ariaDeleteClockIn")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {pointages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    {filtresActifs ? t("travailleurs.emptyFiltered") : t("travailleurs.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {pointages.map((p) => (
              <CarteLigne key={p.id}>
                <CarteLigneTitre>
                  <span>{p.travailleur.nom}</span>
                  <span className="text-sm font-normal text-muted-foreground">{p.travailleur.poste}</span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("travailleurs.colEntry")} value={formatHorodatage(p.horodatageEntree)} />
                <CarteLigneChamp
                  label={t("travailleurs.colExit")}
                  value={p.horodatageSortie ? formatHorodatage(p.horodatageSortie) : <Badge variant="outline">{t("travailleurs.stillOnDuty")}</Badge>}
                />
                <CarteLigneChamp label={t("travailleurs.colRecordedBy")} value={p.enregistrePar?.nom ?? "—"} />
                {editable && (
                  <CarteLigneActions>
                    {!p.horodatageSortie && (
                      <Button variant="outline" size="sm" onClick={() => cloturerMaintenant.mutate(p.id)}>
                        <LogOut className="h-3.5 w-3.5" />
                        {t("travailleurs.clockOutNow")}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirModifierPointage(p)} aria-label={t("travailleurs.ariaEditClockIn")}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                        if (await confirmer({ description: t("travailleurs.confirmDeleteClockIn"), destructive: true }))
                          supprimerPointage.mutate(p.id);
                      }}
                      aria-label={t("travailleurs.ariaDeleteClockIn")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {pointages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {filtresActifs ? t("travailleurs.emptyFiltered") : t("travailleurs.empty")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Absences */}
      <Card>
        <CardHeader>
          <CardTitle>{t("travailleurs.absenceTitle")}</CardTitle>
          <CardDescription>{t("travailleurs.absenceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("travailleurs.worker")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("travailleurs.colMotive")}</TableHead>
                <TableHead>{t("travailleurs.colDeclaredBy")}</TableHead>
                <TableHead>{t("travailleurs.colDecision")}</TableHead>
                <TableHead>{t("travailleurs.colDecidedBy")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {absences.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.travailleur.nom}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(a.date)}</TableCell>
                  <TableCell className="max-w-xs text-muted-foreground">{a.motif}</TableCell>
                  <TableCell className="text-sm">{a.declarePar?.nom ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={cn(BADGE_DECISION[a.decisionStatut])}>{STATUT_DECISION_ABSENCE_LABELS[a.decisionStatut]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{a.decidePar?.nom ?? "—"}</TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      {a.decisionStatut === "EN_ATTENTE" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-1"
                            onClick={() => trancherAbsence.mutate({ id: a.id, decisionStatut: "JUSTIFIEE" })}
                          >
                            {t("travailleurs.markJustified")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-1"
                            onClick={() => trancherAbsence.mutate({ id: a.id, decisionStatut: "NON_JUSTIFIEE" })}
                          >
                            {t("travailleurs.markUnjustified")}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={async () => {
                          if (await confirmer({ description: t("travailleurs.confirmDeleteAbsence"), destructive: true }))
                            supprimerAbsence.mutate(a.id);
                        }}
                        aria-label={t("travailleurs.ariaDeleteAbsence")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {absences.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    {filtresActifs ? t("travailleurs.emptyFiltered") : t("travailleurs.emptyAbsence")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {absences.map((a) => (
              <CarteLigne key={a.id}>
                <CarteLigneTitre>
                  <span>{a.travailleur.nom}</span>
                  <Badge className={cn(BADGE_DECISION[a.decisionStatut])}>{STATUT_DECISION_ABSENCE_LABELS[a.decisionStatut]}</Badge>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("common.date")} value={formatDate(a.date)} />
                <CarteLigneChamp label={t("travailleurs.colMotive")} value={a.motif} />
                <CarteLigneChamp label={t("travailleurs.colDeclaredBy")} value={a.declarePar?.nom ?? "—"} />
                <CarteLigneChamp label={t("travailleurs.colDecidedBy")} value={a.decidePar?.nom ?? "—"} />
                {editable && (
                  <CarteLigneActions>
                    {a.decisionStatut === "EN_ATTENTE" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => trancherAbsence.mutate({ id: a.id, decisionStatut: "JUSTIFIEE" })}>
                          {t("travailleurs.markJustified")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => trancherAbsence.mutate({ id: a.id, decisionStatut: "NON_JUSTIFIEE" })}>
                          {t("travailleurs.markUnjustified")}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                        if (await confirmer({ description: t("travailleurs.confirmDeleteAbsence"), destructive: true }))
                          supprimerAbsence.mutate(a.id);
                      }}
                      aria-label={t("travailleurs.ariaDeleteAbsence")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {absences.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {filtresActifs ? t("travailleurs.emptyFiltered") : t("travailleurs.emptyAbsence")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog fiche */}
      <Dialog open={dialogFiche} onOpenChange={setDialogFiche}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverFiche.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{ficheEditee ? t("travailleurs.ficheDialogEdit", { nom: ficheEditee.nom }) : t("travailleurs.ficheDialogNew")}</DialogTitle>
              <DialogDescription>{t("travailleurs.ficheDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fiche-nom">{t("common.name")}</Label>
                <Input id="fiche-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-poste">{t("travailleurs.post")}</Label>
                <Input id="fiche-poste" value={poste} onChange={(e) => setPoste(e.target.value)} placeholder={t("travailleurs.postPlaceholder")} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-tel">{t("travailleurs.phoneOptional")}</Label>
                <Input id="fiche-tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-embauche">{t("travailleurs.hireDate")}</Label>
                <Input id="fiche-embauche" type="date" value={dateEmbauche} onChange={(e) => setDateEmbauche(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-departement">{t("travailleurs.department")}</Label>
                <NativeSelect
                  id="fiche-departement"
                  value={departementId}
                  onChange={(e) => changerDepartement(e.target.value)}
                  required={!ficheEditee}
                >
                  <option value="">{t("travailleurs.departmentOption")}</option>
                  {departements.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-groupe">{t("travailleurs.groupOptional")}</Label>
                <NativeSelect
                  id="fiche-groupe"
                  value={groupeId}
                  onChange={(e) => setGroupeId(e.target.value)}
                  disabled={!departementId}
                >
                  <option value="">{t("travailleurs.groupNoneOption")}</option>
                  {groupesDuDepartementChoisi.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-salaire">{t("travailleurs.monthlySalary")}</Label>
                <Input
                  id="fiche-salaire"
                  type="number"
                  min={1}
                  step={1}
                  value={salaireMensuel}
                  onChange={(e) => setSalaireMensuel(e.target.value)}
                  placeholder="300000"
                  required={!ficheEditee}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-jours">{t("travailleurs.workingDaysPerMonth")}</Label>
                <Input
                  id="fiche-jours"
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  value={joursTravaillesParMois}
                  onChange={(e) => setJoursTravaillesParMois(e.target.value)}
                  placeholder="26"
                  required={!ficheEditee}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="fiche-compte">{t("travailleurs.appAccountOptional")}</Label>
                <NativeSelect id="fiche-compte" value={compteLie} onChange={(e) => setCompteLie(e.target.value)}>
                  <option value="">{t("travailleurs.noAccountOption")}</option>
                  {comptes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom} ({c.email})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {travailleurCourant && (
              <PanneauEmailPro
                travailleurId={travailleurCourant.id}
                emailDestination={travailleurCourant.emailDestination}
                emailProAdresse={travailleurCourant.emailProAdresse}
                emailProStatut={travailleurCourant.emailProStatut}
                emailProErreur={travailleurCourant.emailProErreur}
                basePath="/api/travailleurs"
                onChange={() => queryClient.invalidateQueries({ queryKey: ["travailleurs"] })}
              />
            )}

            {erreurFiche && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurFiche}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogFiche(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverFiche.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog pointage — horodatage réel entrée/sortie */}
      <Dialog open={dialogPointage} onOpenChange={setDialogPointage}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverPointage.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{pointageEditee ? t("travailleurs.clockInEditTitle") : t("travailleurs.clockInTitle")}</DialogTitle>
              <DialogDescription>{t("travailleurs.clockInDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pt-travailleur">{t("travailleurs.worker")}</Label>
                <NativeSelect
                  id="pt-travailleur"
                  value={ptTravailleurId}
                  onChange={(e) => setPtTravailleurId(e.target.value)}
                  disabled={!!pointageEditee}
                  required
                >
                  {travailleurs.map((trav) => (
                    <option key={trav.id} value={trav.id}>
                      {trav.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pt-entree">{t("travailleurs.colEntry")}</Label>
                  <Input id="pt-entree" type="datetime-local" value={ptEntree} onChange={(e) => setPtEntree(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt-sortie">{t("travailleurs.exitOptional")}</Label>
                  <Input id="pt-sortie" type="datetime-local" value={ptSortie} onChange={(e) => setPtSortie(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("travailleurs.nightShiftHint")}</p>
            </div>
            {erreurPointage && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurPointage}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogPointage(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverPointage.isPending}>
                <CalendarCheck className="h-4 w-4" />
                {t("travailleurs.saveClockIn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog absence */}
      <Dialog open={dialogAbsence} onOpenChange={setDialogAbsence}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              declarerAbsence.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("travailleurs.declareAbsenceTitle")}</DialogTitle>
              <DialogDescription>{t("travailleurs.declareAbsenceDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ab-travailleur">{t("travailleurs.worker")}</Label>
                  <NativeSelect id="ab-travailleur" value={abTravailleurId} onChange={(e) => setAbTravailleurId(e.target.value)} required>
                    {travailleurs.map((trav) => (
                      <option key={trav.id} value={trav.id}>
                        {trav.nom}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ab-date">{t("common.date")}</Label>
                  <Input id="ab-date" type="date" value={abDate} onChange={(e) => setAbDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ab-motif">{t("travailleurs.colMotive")}</Label>
                <Textarea id="ab-motif" value={abMotif} onChange={(e) => setAbMotif(e.target.value)} required maxLength={500} />
              </div>
            </div>
            {erreurAbsence && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurAbsence}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogAbsence(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={declarerAbsence.isPending}>
                <CalendarX className="h-4 w-4" />
                {t("travailleurs.saveAbsence")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
