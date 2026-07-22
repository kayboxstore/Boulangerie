import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Pencil, Trash2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ROLE_ADMINISTRATEUR, type CompteDTO } from "@lomoto/shared";
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

interface RoleListe {
  id: string;
  nom: string;
  roleParentNom: string | null;
}

export function EquipePage() {
  const { utilisateur, peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("EQUIPE");

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
    onSuccess: () => {
      setDialogCompte(false);
      rafraichir();
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("parametres.saveError")),
  });

  const supprimerCompte = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.deleteError")),
  });

  const transfererPrincipal = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}/principal`, { method: "POST" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("parametres.saveError")),
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

      <Card>
        <CardHeader>
          <CardTitle>{t("equipe.accounts")}</CardTitle>
          <CardDescription>{t("equipe.accountsSub", { count: comptes.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
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
        </CardContent>
      </Card>

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
    </div>
  );
}
