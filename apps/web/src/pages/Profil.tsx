import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfilPage() {
  const { utilisateur } = useAuth();

  const [motDePasseActuel, setMotDePasseActuel] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);

  const changerMotDePasse = useMutation({
    mutationFn: () =>
      api("/api/auth/mot-de-passe", {
        method: "POST",
        body: JSON.stringify({ motDePasseActuel, nouveauMotDePasse }),
      }),
    onSuccess: () => {
      setMotDePasseActuel("");
      setNouveauMotDePasse("");
      setConfirmation("");
      setErreur(null);
      setSucces(true);
    },
    onError: (e) => {
      setSucces(false);
      setErreur(e instanceof Error ? e.message : "Changement impossible");
    },
  });

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setSucces(false);
    if (nouveauMotDePasse !== confirmation) {
      setErreur("La confirmation ne correspond pas au nouveau mot de passe");
      return;
    }
    setErreur(null);
    changerMotDePasse.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Mon profil</h1>
        <p className="mt-1 text-muted-foreground">Vos informations de compte et votre mot de passe.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Nom : </span>
            <span className="font-medium">{utilisateur?.nom}</span>
          </p>
          <p>
            <span className="text-muted-foreground">E-mail : </span>
            <span className="font-medium">{utilisateur?.email}</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="text-muted-foreground">Rôle :</span>
            <Badge variant="gold">{utilisateur?.role.nom}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            Le nom, l'e-mail et le rôle sont gérés par l'Administrateur (module Équipe).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Changer mon mot de passe</CardTitle>
          <CardDescription>Au moins 8 caractères. Votre mot de passe actuel fait foi.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={soumettre} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mdp-actuel">Mot de passe actuel</Label>
              <Input
                id="mdp-actuel"
                type="password"
                value={motDePasseActuel}
                onChange={(e) => setMotDePasseActuel(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mdp-nouveau">Nouveau mot de passe</Label>
                <Input
                  id="mdp-nouveau"
                  type="password"
                  value={nouveauMotDePasse}
                  onChange={(e) => setNouveauMotDePasse(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mdp-confirmation">Confirmation</Label>
                <Input
                  id="mdp-confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
            {erreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}
            {succes && (
              <p className="rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-terracotta dark:text-or">
                ✓ Mot de passe changé.
              </p>
            )}
            <Button type="submit" variant="cta" disabled={changerMotDePasse.isPending}>
              <KeyRound className="h-4 w-4" />
              Changer le mot de passe
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
