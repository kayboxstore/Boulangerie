import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import {
  STATUT_PRESENCE_LABELS,
  STATUTS_PRESENCE,
  type PresenceDTO,
  type StatutPresence,
  type TravailleurDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));
}

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

const BADGE_STATUT: Record<StatutPresence, string> = {
  PRESENT: "bg-or/15 text-terracotta dark:text-or border-transparent",
  ABSENT: "bg-terracotta text-creme border-transparent",
  RETARD: "bg-beige/60 text-marine dark:bg-beige/20 dark:text-creme border-transparent",
};

interface CompteLiable {
  id: string;
  nom: string;
  email: string;
}

export function TravailleursPage() {
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
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

  // --- Filtres présence (pattern Commandes : travailleur, dates, Tout afficher)
  const [filtreTravailleur, setFiltreTravailleur] = useState("");
  const [filtreDu, setFiltreDu] = useState("");
  const [filtreAu, setFiltreAu] = useState("");

  const parametres = new URLSearchParams();
  if (filtreTravailleur) parametres.set("travailleurId", filtreTravailleur);
  if (filtreDu) parametres.set("du", filtreDu);
  if (filtreAu) parametres.set("au", filtreAu);
  const chaineParams = parametres.toString();

  const { data: presencesData } = useQuery({
    queryKey: ["presences", chaineParams],
    queryFn: () => api<{ presences: PresenceDTO[] }>(`/api/travailleurs/presences${chaineParams ? `?${chaineParams}` : ""}`),
  });

  const travailleurs = travailleursData?.travailleurs ?? [];
  const presences = presencesData?.presences ?? [];
  const comptes = comptesData?.comptes ?? [];
  const filtresActifs = !!(filtreTravailleur || filtreDu || filtreAu);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["travailleurs"] });
    queryClient.invalidateQueries({ queryKey: ["presences"] });
  };

  // --- Dialog fiche travailleur ---------------------------------------------
  const [dialogFiche, setDialogFiche] = useState(false);
  const [ficheEditee, setFicheEditee] = useState<TravailleurDTO | null>(null);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [poste, setPoste] = useState("");
  const [dateEmbauche, setDateEmbauche] = useState(aujourdhui());
  const [compteLie, setCompteLie] = useState("");
  const [erreurFiche, setErreurFiche] = useState<string | null>(null);

  function ouvrirFiche(t: TravailleurDTO | null) {
    setFicheEditee(t);
    setNom(t?.nom ?? "");
    setTelephone(t?.telephone ?? "");
    setPoste(t?.poste ?? "");
    setDateEmbauche(t?.dateEmbauche ?? aujourdhui());
    setCompteLie(t?.compte?.id ?? "");
    setErreurFiche(null);
    setDialogFiche(true);
  }

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
            body: JSON.stringify({ ...commun, utilisateurId: compteLie || null }),
          })
        : api("/api/travailleurs", {
            method: "POST",
            body: JSON.stringify({ ...commun, utilisateurId: compteLie || undefined }),
          });
    },
    onSuccess: () => {
      setDialogFiche(false);
      rafraichir();
    },
    onError: (e) => setErreurFiche(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerFiche = useMutation({
    mutationFn: (id: string) => api(`/api/travailleurs/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Suppression impossible"),
  });

  // --- Dialog pointage -------------------------------------------------------
  const [dialogPointage, setDialogPointage] = useState(false);
  const [ptTravailleurId, setPtTravailleurId] = useState("");
  const [ptDate, setPtDate] = useState(aujourdhui());
  const [ptStatut, setPtStatut] = useState<StatutPresence>("PRESENT");
  const [ptArrivee, setPtArrivee] = useState("");
  const [ptDepart, setPtDepart] = useState("");
  const [erreurPointage, setErreurPointage] = useState<string | null>(null);

  function ouvrirPointage(travailleurId?: string) {
    setPtTravailleurId(travailleurId ?? travailleurs[0]?.id ?? "");
    setPtDate(aujourdhui());
    setPtStatut("PRESENT");
    setPtArrivee("");
    setPtDepart("");
    setErreurPointage(null);
    setDialogPointage(true);
  }

  const pointer = useMutation({
    mutationFn: () =>
      api("/api/travailleurs/presences", {
        method: "POST",
        body: JSON.stringify({
          travailleurId: ptTravailleurId,
          date: ptDate,
          statut: ptStatut,
          heureArrivee: ptStatut !== "ABSENT" && ptArrivee ? ptArrivee : undefined,
          heureDepart: ptStatut !== "ABSENT" && ptDepart ? ptDepart : undefined,
        }),
      }),
    onSuccess: () => {
      setDialogPointage(false);
      rafraichir();
    },
    onError: (e) => setErreurPointage(e instanceof Error ? e.message : "Pointage impossible"),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Travailleurs</h1>
          <p className="mt-1 text-muted-foreground">
            Roster du personnel et pointage quotidien — y compris le personnel sans accès à l'application.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => ouvrirPointage()} disabled={travailleurs.length === 0}>
              <CalendarCheck className="h-4 w-4" />
              Pointer
            </Button>
            <Button variant="cta" onClick={() => ouvrirFiche(null)}>
              <UserPlus className="h-4 w-4" />
              Nouveau travailleur
            </Button>
          </div>
        )}
      </div>

      {/* Roster */}
      <Card>
        <CardHeader>
          <CardTitle>Fiches du personnel</CardTitle>
          <CardDescription>{travailleurs.length} travailleur(s).</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Poste</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Embauché le</TableHead>
                <TableHead>Compte app</TableHead>
                {editable && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {travailleurs.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nom}</TableCell>
                  <TableCell>{t.poste}</TableCell>
                  <TableCell className="text-muted-foreground">{t.telephone ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.dateEmbauche)}</TableCell>
                  <TableCell>
                    {t.compte ? (
                      <Badge variant="gold">
                        <Link2 className="mr-1 h-3 w-3" />
                        {t.compte.email}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">Sans accès</span>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="mr-1" onClick={() => ouvrirPointage(t.id)}>
                        <CalendarCheck className="h-3.5 w-3.5" />
                        Pointer
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFiche(t)} aria-label={`Modifier ${t.nom}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(`Supprimer la fiche de ${t.nom} (et ses pointages) ?`) && supprimerFiche.mutate(t.id)}
                        aria-label={`Supprimer ${t.nom}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {travailleurs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    Aucun travailleur enregistré.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Présences */}
      <Card>
        <CardHeader>
          <CardTitle>Présence / pointage</CardTitle>
          <CardDescription>Une ligne par travailleur et par jour — re-pointer un jour corrige la ligne.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Label htmlFor="filtre-travailleur">Travailleur</Label>
              <NativeSelect id="filtre-travailleur" value={filtreTravailleur} onChange={(e) => setFiltreTravailleur(e.target.value)}>
                <option value="">Tous</option>
                {travailleurs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="filtre-du">Du</Label>
              <Input id="filtre-du" type="date" value={filtreDu} onChange={(e) => setFiltreDu(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="filtre-au">Au</Label>
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
                Tout afficher
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Travailleur</TableHead>
                <TableHead>Poste</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Arrivée</TableHead>
                <TableHead>Départ</TableHead>
                <TableHead>Enregistré par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presences.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(p.date)}</TableCell>
                  <TableCell className="font-medium">{p.travailleur.nom}</TableCell>
                  <TableCell className="text-muted-foreground">{p.travailleur.poste}</TableCell>
                  <TableCell>
                    <Badge className={cn(BADGE_STATUT[p.statut])}>{STATUT_PRESENCE_LABELS[p.statut]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.heureArrivee ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.heureDepart ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.enregistrePar?.nom ?? "—"}</TableCell>
                </TableRow>
              ))}
              {presences.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {filtresActifs ? "Aucun pointage pour ces filtres." : "Aucun pointage enregistré."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
              <DialogTitle>{ficheEditee ? `Modifier ${ficheEditee.nom}` : "Nouveau travailleur"}</DialogTitle>
              <DialogDescription>
                Le lien vers un compte est optionnel — le personnel sans accès à l'app a aussi sa fiche.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fiche-nom">Nom</Label>
                <Input id="fiche-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-poste">Poste</Label>
                <Input id="fiche-poste" value={poste} onChange={(e) => setPoste(e.target.value)} placeholder="Livreur, boulanger…" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-tel">Téléphone (optionnel)</Label>
                <Input id="fiche-tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fiche-embauche">Date d'embauche</Label>
                <Input id="fiche-embauche" type="date" value={dateEmbauche} onChange={(e) => setDateEmbauche(e.target.value)} required />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="fiche-compte">Compte de l'application (optionnel)</Label>
                <NativeSelect id="fiche-compte" value={compteLie} onChange={(e) => setCompteLie(e.target.value)}>
                  <option value="">— Aucun (pas d'accès à l'app) —</option>
                  {comptes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom} ({c.email})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {erreurFiche && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurFiche}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogFiche(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={sauverFiche.isPending}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog pointage */}
      <Dialog open={dialogPointage} onOpenChange={setDialogPointage}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pointer.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Pointage</DialogTitle>
              <DialogDescription>Statut du jour pour un travailleur — heures optionnelles.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pt-travailleur">Travailleur</Label>
                  <NativeSelect id="pt-travailleur" value={ptTravailleurId} onChange={(e) => setPtTravailleurId(e.target.value)} required>
                    {travailleurs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nom}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt-date">Date</Label>
                  <Input id="pt-date" type="date" value={ptDate} onChange={(e) => setPtDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Statut</Label>
                <div className="grid grid-cols-3 gap-2">
                  {STATUTS_PRESENCE.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPtStatut(s)}
                      className={cn(
                        "rounded-lg border p-2 text-sm font-medium transition-colors",
                        ptStatut === s
                          ? "border-or bg-or/15 text-terracotta dark:text-or"
                          : "border-input text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {STATUT_PRESENCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              {ptStatut !== "ABSENT" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pt-arrivee">Heure d'arrivée (optionnel)</Label>
                    <Input id="pt-arrivee" type="time" value={ptArrivee} onChange={(e) => setPtArrivee(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pt-depart">Heure de départ (optionnel)</Label>
                    <Input id="pt-depart" type="time" value={ptDepart} onChange={(e) => setPtDepart(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
            {erreurPointage && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurPointage}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogPointage(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={pointer.isPending}>
                <CalendarCheck className="h-4 w-4" />
                Enregistrer le pointage
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
