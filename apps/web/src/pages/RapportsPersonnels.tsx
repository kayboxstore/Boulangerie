import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TYPES_ACTIVITE, type ActiviteDTO, type PorteeRapportsDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";

function formatDateHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

// Journal d'activité personnel (section 3.13) — distinct du Tableau de bord :
// portée par personne (soi-même, exceptions nommées, DG/Admins = tout le monde),
// résolue côté serveur par un mécanisme dédié, hors matrice de permissions.
export function RapportsPersonnelsPage() {
  const { utilisateur } = useAuth();
  const { t } = useTranslation();

  const { data: portee } = useQuery({
    queryKey: ["rapports-personnels", "portee"],
    queryFn: () => api<PorteeRapportsDTO>("/api/rapports-personnels/portee"),
  });

  const [filtreQui, setFiltreQui] = useState("");
  const [filtreDu, setFiltreDu] = useState("");
  const [filtreAu, setFiltreAu] = useState("");
  const [filtreType, setFiltreType] = useState("");

  const parametres = new URLSearchParams();
  if (filtreQui) parametres.set("utilisateurId", filtreQui);
  if (filtreDu) parametres.set("du", filtreDu);
  if (filtreAu) parametres.set("au", filtreAu);
  if (filtreType) parametres.set("type", filtreType);
  const chaineParams = parametres.toString();

  const { data: activitesData } = useQuery({
    queryKey: ["rapports-personnels", chaineParams],
    queryFn: () => api<{ activites: ActiviteDTO[] }>(`/api/rapports-personnels${chaineParams ? `?${chaineParams}` : ""}`),
  });

  const activites = activitesData?.activites ?? [];
  const filtresActifs = !!(filtreQui || filtreDu || filtreAu || filtreType);
  // Le filtre « Qui » n'a de sens que si la portée dépasse soi-même.
  const porteeElargie = !!portee && (portee.tous || portee.utilisateurs.length > 1);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("rapports.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {portee?.tous
            ? t("rapports.subtitleAll")
            : porteeElargie
              ? t("rapports.subtitleExtended")
              : t("rapports.subtitleSelf")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-or" />
            {t("rapports.journalTitle")}
          </CardTitle>
          <CardDescription>
            {filtresActifs
              ? t("rapports.countFiltered", { count: activites.length })
              : t("rapports.count", { count: activites.length })}{" "}
            — {t("rapports.chronological")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {porteeElargie && (
              <div className="w-56">
                <Label htmlFor="filtre-qui">{t("rapports.who")}</Label>
                <NativeSelect id="filtre-qui" value={filtreQui} onChange={(e) => setFiltreQui(e.target.value)}>
                  <option value="">{portee?.tous ? t("rapports.allTeam") : t("rapports.allScope")}</option>
                  {portee?.utilisateurs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nom} ({u.roleNom}){u.id === utilisateur?.id ? ` — ${t("common.me")}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="w-52">
              <Label htmlFor="filtre-type">{t("rapports.actionType")}</Label>
              <NativeSelect id="filtre-type" value={filtreType} onChange={(e) => setFiltreType(e.target.value)}>
                <option value="">{t("rapports.allTypes")}</option>
                {TYPES_ACTIVITE.map((type) => (
                  <option key={type} value={type}>
                    {t(`activiteType.${type}`)}
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
                  setFiltreQui("");
                  setFiltreDu("");
                  setFiltreAu("");
                  setFiltreType("");
                }}
              >
                {t("common.showAll")}
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                {porteeElargie && <TableHead>{t("common.by")}</TableHead>}
                <TableHead>{t("rapports.colType")}</TableHead>
                <TableHead>{t("rapports.summary")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activites.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateHeure(a.date)}</TableCell>
                  {porteeElargie && (
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium">{a.utilisateur.nom}</span>
                      {a.utilisateur.id === utilisateur?.id && (
                        <span className="ml-1 text-xs text-muted-foreground">({t("common.me")})</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant="secondary">{t(`activiteType.${a.type}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{a.resume}</TableCell>
                </TableRow>
              ))}
              {activites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={porteeElargie ? 4 : 3} className="py-8 text-center text-muted-foreground">
                    {filtresActifs ? t("rapports.emptyFiltered") : t("rapports.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
