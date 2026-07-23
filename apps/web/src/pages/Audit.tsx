import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ACTION_AUDIT_LABELS,
  MODULE_LABELS,
  MODULES,
  TYPE_ENTITE_LABELS,
  type AuditLogDTO,
  type CompteDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { ChargementModule } from "@/components/ChargementModule";

// Champs techniques masqués dans le diff (bruit sans valeur métier).
const CHAMPS_MASQUES = new Set(["updatedAt", "createdAt", "id"]);

const fmtValeur = (v: unknown): string => {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "vrai" : "faux";
  return String(v);
};

/** Champs modifiés (avant≠après) ou, pour une suppression, l'instantané supprimé. */
function champsPertinents(entree: AuditLogDTO): string[] {
  const source = entree.avant ?? entree.apres ?? {};
  const cles = Object.keys(source).filter((k) => !CHAMPS_MASQUES.has(k));
  if (entree.action === "MODIFICATION" && entree.avant && entree.apres) {
    return cles.filter((k) => JSON.stringify(entree.avant![k]) !== JSON.stringify(entree.apres![k]));
  }
  return cles;
}

export function AuditPage() {
  const { t } = useTranslation();
  const [utilisateurId, setUtilisateurId] = useState("");
  const [module, setModule] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [depliees, setDepliees] = useState<Set<string>>(new Set());

  const parametres = useMemo(() => {
    const p = new URLSearchParams();
    if (utilisateurId) p.set("utilisateurId", utilisateurId);
    if (module) p.set("module", module);
    if (dateDebut) p.set("dateDebut", dateDebut);
    if (dateFin) p.set("dateFin", dateFin);
    return p.toString();
  }, [utilisateurId, module, dateDebut, dateFin]);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", parametres],
    queryFn: () => api<{ entrees: AuditLogDTO[] }>(`/api/audit${parametres ? `?${parametres}` : ""}`),
  });

  // Liste des auteurs pour le filtre (accessible au DG et aux Admins).
  const { data: equipeData } = useQuery({
    queryKey: ["equipe"],
    queryFn: () => api<{ comptes: CompteDTO[] }>("/api/equipe"),
  });
  const comptes = equipeData?.comptes ?? [];

  const entrees = data?.entrees ?? [];

  const basculer = (id: string) =>
    setDepliees((prev) => {
      const suivant = new Set(prev);
      suivant.has(id) ? suivant.delete(id) : suivant.add(id);
      return suivant;
    });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("audit.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("audit.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("audit.filters")}</CardTitle>
          <CardDescription>{t("audit.filtersSub")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="f-user">{t("audit.user")}</Label>
              <NativeSelect id="f-user" value={utilisateurId} onChange={(e) => setUtilisateurId(e.target.value)}>
                <option value="">{t("audit.allUsers")}</option>
                {comptes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-module">{t("audit.module")}</Label>
              <NativeSelect id="f-module" value={module} onChange={(e) => setModule(e.target.value)}>
                <option value="">{t("audit.allModules")}</option>
                {MODULES.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-debut">{t("common.from")}</Label>
              <Input id="f-debut" type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-fin">{t("common.to")}</Label>
              <Input id="f-fin" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-or" />
            {t("audit.entries")}
          </CardTitle>
          <CardDescription>{t("audit.entriesSub", { count: entrees.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChargementModule />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("audit.user")}</TableHead>
                  <TableHead>{t("audit.module")}</TableHead>
                  <TableHead>{t("audit.entity")}</TableHead>
                  <TableHead>{t("audit.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entrees.map((e) => {
                  const ouverte = depliees.has(e.id);
                  const champs = champsPertinents(e);
                  return (
                    <Fragment key={e.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => basculer(e.id)}
                      >
                        <TableCell className="text-muted-foreground">
                          {ouverte ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {new Date(e.date).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-medium">{e.utilisateur.nom}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{MODULE_LABELS[e.module]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {TYPE_ENTITE_LABELS[e.typeEntite] ?? e.typeEntite}
                          <span className="ml-1 text-xs text-muted-foreground">#{e.entiteId.slice(0, 8)}</span>
                        </TableCell>
                        <TableCell>
                          {e.action === "SUPPRESSION" ? (
                            <Badge className="border-transparent bg-terracotta text-creme">
                              {ACTION_AUDIT_LABELS[e.action]}
                            </Badge>
                          ) : (
                            <Badge className="border-transparent bg-or text-marine">
                              {ACTION_AUDIT_LABELS[e.action]}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {ouverte && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={5} className="py-3">
                            {champs.length === 0 ? (
                              <p className="text-sm text-muted-foreground">{t("audit.noFieldChange")}</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs uppercase text-muted-foreground">
                                    <th className="pb-1 pr-4 font-medium">{t("audit.field")}</th>
                                    <th className="pb-1 pr-4 font-medium">{t("audit.before")}</th>
                                    <th className="pb-1 font-medium">{t("audit.after")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {champs.map((k) => (
                                    <tr key={k} className="border-t border-border/40">
                                      <td className="py-1 pr-4 font-mono text-xs">{k}</td>
                                      <td className="py-1 pr-4 text-terracotta">{fmtValeur(e.avant?.[k])}</td>
                                      <td className="py-1 text-marine dark:text-creme">
                                        {e.action === "SUPPRESSION" ? "—" : fmtValeur(e.apres?.[k])}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {entrees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {t("audit.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
