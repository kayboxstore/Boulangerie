import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Crown, Pencil, Power, Trash2, UserPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MODULE_LABELS,
  MODULES,
  ROLE_ADMINISTRATEUR,
  type CompteDTO,
  type DelegationDTO,
  type Module,
  type ResultatActionCritique,
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

interface RoleListe {
  id: string;
  nom: string;
  roleParentNom: string | null;
}

/** Détecte une réponse d'action critique différée (Admin secondaire → demande). */
function messageApprobation(res: unknown): string | null {
  if (res && typeof res === "object" && "statut" in res) {
    const r = res as ResultatActionCritique;
    if (r.statut === "en_attente_approbation") return r.message;
  }
  return null;
}

const auTdefaut = () => new Date().toISOString().slice(0, 10);

export function EquipePage() {
  const { utilisateur, peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("EQUIPE");

  // Bandeau « demande soumise à l'approbation de l'Admin Principal ».
  const [avisApprobation, setAvisApprobation] = useState<string | null>(null);

  const { data: comptesData } = useQuery({
    queryKey: ["equipe"],
    queryFn: () => api<{ comptes: CompteDTO[] }>("/api/equipe"),
  });
  const { data: rolesData } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleListe[] }>("/api/roles"),
  });

  const comptes = comptesData?.comptes ?? [];
  const roles = rolesData?.roles ?? [];

  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ["equipe"] });

  // --- Dialog création / édition --------------------------------------------
  const [dialogCompte, setDialogCompte] = useState(false);
  const [compteEdite, setCompteEdite] = useState<CompteDTO | null>(null);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  function ouvrirCompte(c: CompteDTO | null) {
    setCompteEdite(c);
    setNom(c?.nom ?? "");
    setEmail(c?.email ?? "");
    setRoleId(c?.role.id ?? "");
    setMotDePasse("");
    setErreur(null);
    setDialogCompte(true);
  }

  const sauverCompte = useMutation({
    mutationFn: () =>
      compteEdite
        ? api(`/api/equipe/${compteEdite.id}`, {
            method: "PUT",
            body: JSON.stringify({ nom: nom.trim(), email: email.trim(), roleId }),
          })
        : api("/api/equipe", {
            method: "POST",
            body: JSON.stringify({ nom: nom.trim(), email: email.trim(), roleId, motDePasse }),
          }),
    onSuccess: (res) => {
      setDialogCompte(false);
      const avis = messageApprobation(res);
      if (avis) setAvisApprobation(avis);
      rafraichir();
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  const supprimerCompte = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}`, { method: "DELETE" }),
    onSuccess: (res) => {
      const avis = messageApprobation(res);
      if (avis) setAvisApprobation(avis);
      rafraichir();
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.deleteError")),
  });

  const basculerActivation = useMutation({
    mutationFn: (c: CompteDTO) =>
      api(`/api/equipe/${c.id}/activation`, {
        method: "PUT",
        body: JSON.stringify({ actif: !c.actif }),
      }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  const transfererPrincipal = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}/principal`, { method: "POST" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  // --- Délégations temporaires (section 3.7) --------------------------------
  const { data: delegationsData } = useQuery({
    queryKey: ["delegations"],
    queryFn: () => api<{ delegations: DelegationDTO[] }>("/api/delegations"),
    enabled: editable,
  });
  const delegations = delegationsData?.delegations ?? [];
  const rafraichirDelegations = () => queryClient.invalidateQueries({ queryKey: ["delegations"] });

  const [dialogDelegation, setDialogDelegation] = useState(false);
  const [delUtilisateurId, setDelUtilisateurId] = useState("");
  const [delModule, setDelModule] = useState<Module>("STOCKS");
  const [delDebut, setDelDebut] = useState(auTdefaut());
  const [delFin, setDelFin] = useState(auTdefaut());
  const [delErreur, setDelErreur] = useState<string | null>(null);

  function ouvrirDelegation() {
    setDelUtilisateurId("");
    setDelModule("STOCKS");
    setDelDebut(auTdefaut());
    setDelFin(auTdefaut());
    setDelErreur(null);
    setDialogDelegation(true);
  }

  const creerDelegation = useMutation({
    mutationFn: () =>
      api("/api/delegations", {
        method: "POST",
        body: JSON.stringify({
          utilisateurId: delUtilisateurId,
          module: delModule,
          dateDebut: delDebut,
          dateFin: delFin,
        }),
      }),
    onSuccess: () => {
      setDialogDelegation(false);
      rafraichirDelegations();
    },
    onError: (e) => setDelErreur(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  const revoquerDelegation = useMutation({
    mutationFn: (id: string) => api(`/api/delegations/${id}`, { method: "DELETE" }),
    onSuccess: rafraichirDelegations,
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.deleteError")),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("equipe.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("equipe.subtitle")}</p>
        </div>
        {editable && (
          <Button variant="cta" onClick={() => ouvrirCompte(null)}>
            <UserPlus className="h-4 w-4" />
            {t("equipe.newAccount")}
          </Button>
        )}
      </div>

      {avisApprobation && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-md border border-or/40 bg-or/10 px-4 py-3 text-sm text-marine dark:text-creme"
        >
          <span>
            <strong className="font-semibold">{t("equipe.approvalPendingTitle")}</strong> {avisApprobation}
          </span>
          <button
            type="button"
            onClick={() => setAvisApprobation(null)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("equipe.accounts")}</CardTitle>
          <CardDescription>{t("equipe.accountsSub", { count: comptes.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.email")}</TableHead>
                <TableHead>{t("common.role")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comptes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.nom}
                    {c.id === utilisateur?.id && <span className="ml-2 text-xs text-muted-foreground">({t("equipe.you")})</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{c.role.nom}</Badge>
                      {c.estAdminPrincipal && (
                        <Badge variant="gold">
                          <Crown className="mr-1 h-3 w-3" />
                          {t("equipe.principal")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.actif ? (
                      <Badge variant="secondary">{t("equipe.active")}</Badge>
                    ) : (
                      <Badge className="border-transparent bg-terracotta text-creme">{t("equipe.disabled")}</Badge>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      {c.role.nom === ROLE_ADMINISTRATEUR && !c.estAdminPrincipal && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mr-1"
                          onClick={() =>
                            confirm(t("equipe.confirmMakePrincipal", { nom: c.nom })) && transfererPrincipal.mutate(c.id)
                          }
                        >
                          <Crown className="h-3.5 w-3.5" />
                          {t("equipe.makePrincipal")}
                        </Button>
                      )}
                      {/* Activation / désactivation (3.14) — pas sur soi-même. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          confirm(
                            c.actif
                              ? t("equipe.confirmDeactivate", { nom: c.nom })
                              : t("equipe.confirmActivate", { nom: c.nom }),
                          ) && basculerActivation.mutate(c)
                        }
                        disabled={c.id === utilisateur?.id}
                        aria-label={c.actif ? t("equipe.deactivate", { nom: c.nom }) : t("equipe.activate", { nom: c.nom })}
                        title={c.actif ? t("equipe.deactivate", { nom: c.nom }) : t("equipe.activate", { nom: c.nom })}
                      >
                        <Power className={c.actif ? "h-3.5 w-3.5 text-or" : "h-3.5 w-3.5 text-muted-foreground"} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirCompte(c)} aria-label={t("equipe.editAccount", { nom: c.nom })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("equipe.confirmDelete", { nom: c.nom })) && supprimerCompte.mutate(c.id)}
                        disabled={c.id === utilisateur?.id}
                        aria-label={t("equipe.ariaDelete", { nom: c.nom })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {comptes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 5 : 4} className="py-8 text-center text-muted-foreground">
                    {t("equipe.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {comptes.map((c) => (
              <CarteLigne key={c.id}>
                <CarteLigneTitre>
                  <span>
                    {c.nom}
                    {c.id === utilisateur?.id && <span className="ml-1 text-xs font-normal text-muted-foreground">({t("equipe.you")})</span>}
                  </span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("common.email")} value={c.email} />
                <CarteLigneChamp
                  label={t("common.role")}
                  value={
                    <span className="flex items-center gap-1">
                      <Badge variant="secondary">{c.role.nom}</Badge>
                      {c.estAdminPrincipal && (
                        <Badge variant="gold">
                          <Crown className="mr-1 h-3 w-3" />
                          {t("equipe.principal")}
                        </Badge>
                      )}
                    </span>
                  }
                />
                <CarteLigneChamp
                  label={t("common.status")}
                  value={
                    c.actif ? (
                      <Badge variant="secondary">{t("equipe.active")}</Badge>
                    ) : (
                      <Badge className="border-transparent bg-terracotta text-creme">{t("equipe.disabled")}</Badge>
                    )
                  }
                />
                {editable && (
                  <CarteLigneActions className="flex-wrap">
                    {c.role.nom === ROLE_ADMINISTRATEUR && !c.estAdminPrincipal && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          confirm(t("equipe.confirmMakePrincipal", { nom: c.nom })) && transfererPrincipal.mutate(c.id)
                        }
                      >
                        <Crown className="h-3.5 w-3.5" />
                        {t("equipe.makePrincipal")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() =>
                        confirm(
                          c.actif ? t("equipe.confirmDeactivate", { nom: c.nom }) : t("equipe.confirmActivate", { nom: c.nom }),
                        ) && basculerActivation.mutate(c)
                      }
                      disabled={c.id === utilisateur?.id}
                      aria-label={c.actif ? t("equipe.deactivate", { nom: c.nom }) : t("equipe.activate", { nom: c.nom })}
                    >
                      <Power className={c.actif ? "h-3.5 w-3.5 text-or" : "h-3.5 w-3.5 text-muted-foreground"} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirCompte(c)} aria-label={t("equipe.editAccount", { nom: c.nom })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={() => confirm(t("equipe.confirmDelete", { nom: c.nom })) && supprimerCompte.mutate(c.id)}
                      disabled={c.id === utilisateur?.id}
                      aria-label={t("equipe.ariaDelete", { nom: c.nom })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {comptes.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("equipe.empty")}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Délégations temporaires de rôle (section 3.7) */}
      {editable && (
        <Card>
          <CardHeader className="flex flex-col items-start gap-3 space-y-0 sm:flex-row sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-or" />
                {t("delegations.title")}
              </CardTitle>
              <CardDescription>{t("delegations.subtitle")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={ouvrirDelegation}>
              {t("delegations.new")}
            </Button>
          </CardHeader>
          <CardContent>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("delegations.user")}</TableHead>
                  <TableHead>{t("delegations.module")}</TableHead>
                  <TableHead>{t("delegations.period")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delegations.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.utilisateur.nom}
                      <span className="ml-2 text-xs text-muted-foreground">{d.utilisateur.roleNom}</span>
                    </TableCell>
                    <TableCell>{MODULE_LABELS[d.module]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.dateDebut} → {d.dateFin}
                    </TableCell>
                    <TableCell>
                      {d.active ? (
                        <Badge className="border-transparent bg-or text-marine">{t("delegations.active")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("delegations.inactive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("delegations.confirmRevoke")) && revoquerDelegation.mutate(d.id)}
                        aria-label={t("delegations.revoke")}
                        title={t("delegations.revoke")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {delegations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t("delegations.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="space-y-2 md:hidden">
              {delegations.map((d) => (
                <CarteLigne key={d.id}>
                  <CarteLigneTitre>
                    <span>
                      {d.utilisateur.nom}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">{d.utilisateur.roleNom}</span>
                    </span>
                    {d.active ? (
                      <Badge className="border-transparent bg-or text-marine">{t("delegations.active")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("delegations.inactive")}</Badge>
                    )}
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("delegations.module")} value={MODULE_LABELS[d.module]} />
                  <CarteLigneChamp label={t("delegations.period")} value={`${d.dateDebut} → ${d.dateFin}`} />
                  <CarteLigneActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={() => confirm(t("delegations.confirmRevoke")) && revoquerDelegation.mutate(d.id)}
                      aria-label={t("delegations.revoke")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                </CarteLigne>
              ))}
              {delegations.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("delegations.empty")}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog compte */}
      <Dialog open={dialogCompte} onOpenChange={setDialogCompte}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverCompte.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{compteEdite ? t("equipe.editAccount", { nom: compteEdite.nom }) : t("equipe.createTitle")}</DialogTitle>
              <DialogDescription>{compteEdite ? t("equipe.editHelp") : t("equipe.createHelp")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="compte-nom">{t("common.name")}</Label>
                <Input id="compte-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compte-email">{t("common.email")}</Label>
                <Input id="compte-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compte-role">{t("common.role")}</Label>
                <NativeSelect id="compte-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                  <option value="">{t("equipe.chooseRole")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nom}
                      {r.roleParentNom ? ` (${t("equipe.attachedTo", { role: r.roleParentNom })})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {!compteEdite && (
                <div className="space-y-1.5">
                  <Label htmlFor="compte-mdp">{t("equipe.initialPassword")}</Label>
                  <Input
                    id="compte-mdp"
                    type="password"
                    value={motDePasse}
                    onChange={(e) => setMotDePasse(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </div>
              )}
            </div>
            {erreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCompte(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverCompte.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog délégation */}
      <Dialog open={dialogDelegation} onOpenChange={setDialogDelegation}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              creerDelegation.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("delegations.createTitle")}</DialogTitle>
              <DialogDescription>{t("delegations.createHelp")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="del-user">{t("delegations.user")}</Label>
                <NativeSelect id="del-user" value={delUtilisateurId} onChange={(e) => setDelUtilisateurId(e.target.value)} required>
                  <option value="">{t("delegations.chooseUser")}</option>
                  {comptes
                    .filter((c) => c.actif)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom} — {c.role.nom}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="del-module">{t("delegations.module")}</Label>
                <NativeSelect id="del-module" value={delModule} onChange={(e) => setDelModule(e.target.value as Module)} required>
                  {MODULES.map((m) => (
                    <option key={m} value={m}>
                      {MODULE_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="del-debut">{t("common.from")}</Label>
                  <Input id="del-debut" type="date" value={delDebut} onChange={(e) => setDelDebut(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="del-fin">{t("common.to")}</Label>
                  <Input id="del-fin" type="date" value={delFin} onChange={(e) => setDelFin(e.target.value)} required />
                </div>
              </div>
            </div>
            {delErreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {delErreur}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogDelegation(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={creerDelegation.isPending}>
                {t("delegations.grant")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
