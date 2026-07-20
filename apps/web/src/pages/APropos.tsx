import { Mail, MapPin, Phone } from "lucide-react";
import { TAGLINE, VERSION_APP } from "@lomoto/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Page À propos (section 3.12) — accessible à tous les rôles.
export function AProposPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <img
          src="/logo-lomoto.png"
          alt="Logo Boulangerie Lomoto"
          className="h-28 w-28 rounded-full object-contain ring-4 ring-or/60"
        />
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Boulangerie Lomoto</h1>
          <p className="mt-1 font-serif text-lg italic text-terracotta dark:text-or">« {TAGLINE} »</p>
        </div>
        <Badge variant="secondary">Application de gestion commerciale — v{VERSION_APP}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>La boulangerie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            La Boulangerie Lomoto produit et distribue du pain frais chaque jour : vente au comptoir,
            dépositaires et clientes « Mamans » revendeuses. Cette application couvre la caisse, les
            commandes clients et commissions, les stocks et la production, les achats fournisseurs et
            l'équipe — avec des notifications en temps réel selon le rôle de chacun.
          </p>
          <p>
            Devise : <span className="font-medium text-foreground">Franc Congolais (Fc)</span> — le pain
            est exonéré de TVA.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
          <CardDescription>Pour toute question sur la boutique ou l'application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-or" />
            Kinshasa, République démocratique du Congo
          </p>
          <p className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-or" />
            +243 810 000 000
          </p>
          <p className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-or" />
            contact@lomoto.cd
          </p>
        </CardContent>
      </Card>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Boulangerie Lomoto — {TAGLINE} · v{VERSION_APP}
      </p>
    </div>
  );
}
