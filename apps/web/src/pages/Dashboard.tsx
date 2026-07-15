import { MODULE_LABELS, MODULES, type NiveauAcces } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function BadgeAcces({ niveau }: { niveau: NiveauAcces }) {
  if (niveau === "ECRITURE") return <Badge variant="gold">Écriture</Badge>;
  if (niveau === "LECTURE") return <Badge variant="secondary">Lecture seule</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Aucun accès</Badge>;
}

export function DashboardPage() {
  const { utilisateur } = useAuth();
  if (!utilisateur) return null;

  const permissions = new Map(utilisateur.role.permissions.map((p) => [p.module, p.niveauAcces]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">
          Bonjour, {utilisateur.nom}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Connecté(e) en tant que <span className="font-medium text-foreground">{utilisateur.role.nom}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vos droits d'accès</CardTitle>
          <CardDescription>
            Matrice de permissions de votre rôle — les modules s'activeront au fil des prochaines phases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead className="text-right">Niveau d'accès</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MODULES.map((m) => (
                <TableRow key={m}>
                  <TableCell className="font-medium">{MODULE_LABELS[m]}</TableCell>
                  <TableCell className="text-right">
                    <BadgeAcces niveau={permissions.get(m) ?? "AUCUN"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
