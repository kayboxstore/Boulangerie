import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Pencil, Trash2, UserPlus } from "lucide-react";
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
    onError: (e) => setErreur(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerCompte = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Suppression impossible"),
  });

  const transfererPrincipal = useMutation({
    mutationFn: (id: string) => api(`/api/equipe/${id}/principal`, { method: "POST" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Transfert impossible"),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Équipe</h1>
          <p className="mt-1 text-muted-foreground">
            Comptes utilisateurs et rôles — jusqu'à 3 comptes Administrateur (1 Principal + 2 secondaires).
          </p>
        </div>
        {editable && (
          <Button variant="cta" onClick={() => ouvrirCompte(null)}>
            <UserPlus className="h-4 w-4" />
            Nouveau compte
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
          <CardDescription>{comptes.length} compte(s) — chacun rattaché à un rôle de la matrice.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                {editable && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comptes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.nom}
                    {c.id === utilisateur?.id && <span className="ml-2 text-xs text-muted-foreground">(vous)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{c.role.nom}</Badge>
                      {c.estAdminPrincipal && (
                        <Badge variant="gold">
                          <Crown className="mr-1 h-3 w-3" />
                          Principal
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.actif ? (
                      <Badge variant="secondary">Actif</Badge>
                    ) : (
                      <Badge className="border-transparent bg-terracotta text-creme">Désactivé</Badge>
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
                            confirm(`Faire de ${c.nom} l'Administrateur principal ?`) && transfererPrincipal.mutate(c.id)
                          }
                        >
                          <Crown className="h-3.5 w-3.5" />
                          Rendre Principal
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirCompte(c)} aria-label={`Modifier ${c.nom}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(`Supprimer le compte de ${c.nom} ?`) && supprimerCompte.mutate(c.id)}
                        disabled={c.id === utilisateur?.id}
                        aria-label={`Supprimer ${c.nom}`}
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
                    Aucun compte.
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
              <DialogTitle>{compteEdite ? `Modifier ${compteEdite.nom}` : "Nouveau compte"}</DialogTitle>
              <DialogDescription>
                {compteEdite
                  ? "Nom, e-mail et rôle. Le mot de passe se change depuis « Mon profil » de l'employé."
                  : "L'employé se connectera avec ce mot de passe initial, puis pourra le changer depuis « Mon profil »."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="compte-nom">Nom</Label>
                <Input id="compte-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compte-email">E-mail</Label>
                <Input id="compte-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compte-role">Rôle</Label>
                <NativeSelect id="compte-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                  <option value="">— Choisir un rôle —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nom}
                      {r.roleParentNom ? ` (rattaché : ${r.roleParentNom})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {!compteEdite && (
                <div className="space-y-1.5">
                  <Label htmlFor="compte-mdp">Mot de passe initial</Label>
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
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={sauverCompte.isPending}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
