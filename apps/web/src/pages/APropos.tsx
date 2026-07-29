import { Code2, Mail, MapPin, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CREDIT_DEVELOPPEUR, TAGLINE, VERSION_APP } from "@lomoto/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Page À propos (section 3.12) — accessible à tous les rôles.
export function AProposPage() {
  const { t } = useTranslation();
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
        <Badge variant="secondary">{t("apropos.subtitle", { version: VERSION_APP })}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("apropos.bakery")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>{t("apropos.bakeryText")}</p>
          <p>{t("apropos.currency")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("apropos.contact")}</CardTitle>
          <CardDescription>{t("apropos.contactSub")}</CardDescription>
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

      {/* Crédit développeur (section 3.12) — également destiné au pied de page
          des rapports exportés, quand l'export PDF arrivera. */}
      <Card className="border-or/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="h-4 w-4 text-or" />
            {t("apropos.developer")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-serif text-lg font-semibold text-marine dark:text-creme">
            {CREDIT_DEVELOPPEUR.mention}
          </p>
          <a
            href={`tel:${CREDIT_DEVELOPPEUR.telephone.replace(/\s/g, "")}`}
            className="mt-1 inline-flex items-center gap-2 text-sm text-terracotta hover:underline dark:text-or"
          >
            <Phone className="h-4 w-4 shrink-0" />
            {CREDIT_DEVELOPPEUR.telephone}
          </a>
        </CardContent>
      </Card>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Boulangerie Lomoto — {TAGLINE} · v{VERSION_APP}
      </p>
    </div>
  );
}
