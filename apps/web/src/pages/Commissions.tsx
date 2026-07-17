import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, RotateCcw } from "lucide-react";
import { formatFc, type CommissionLigneDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function CommissionsPage() {
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");

  const params = new URLSearchParams();
  if (du) params.set("du", du);
  if (au) params.set("au", au);

  const { data, isLoading, error } = useQuery({
    queryKey: ["commissions", { du, au }],
    queryFn: () =>
      api<{ commissions: CommissionLigneDTO[]; totalCommissions: number }>(`/api/commissions?${params}`),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Commissions</h1>
        <p className="mt-1 text-muted-foreground">
          Vue en lecture seule, dérivée des commandes des clientes « Maman » — calcul automatique, aucune saisie.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        {/* Filtres */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="commissions-du">Du</Label>
              <Input id="commissions-du" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commissions-au">Au</Label>
              <Input id="commissions-au" type="date" value={au} onChange={(e) => setAu(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setDu("");
                setAu("");
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Tout afficher
            </Button>
          </CardContent>
        </Card>

        {/* Total période */}
        <Card className="border-or/50 bg-or/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-or/15 text-terracotta">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total commissions {du || au ? "(période)" : ""}</p>
              <p className="text-xl font-bold text-marine dark:text-or">
                {formatFc(data?.totalCommissions ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commandes « Maman »</CardTitle>
          <CardDescription>Commission : 1 650 Fc par bac (27,5 %) — montants en Fc.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-muted-foreground">Chargement…</p>}
          {error && (
            <p className="py-8 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : "Erreur de chargement"}
            </p>
          )}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Nom du client</TableHead>
                  <TableHead className="text-right">Bacs reçus</TableHead>
                  <TableHead className="text-right">Montant total payé</TableHead>
                  <TableHead className="text-right">Commission disponible</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.commissions.map((l) => (
                  <TableRow key={l.commandeId}>
                    <TableCell className="font-medium">{l.numero}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(l.dateCreation)}
                    </TableCell>
                    <TableCell className="font-medium">{l.clientNom}</TableCell>
                    <TableCell className="text-right">{l.quantiteBacs}</TableCell>
                    <TableCell className="text-right">{formatFc(l.montantTotalPaye)}</TableCell>
                    <TableCell className="text-right font-semibold text-terracotta dark:text-or">
                      {formatFc(l.commission)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.commissions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Aucune commission pour ces critères.
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
