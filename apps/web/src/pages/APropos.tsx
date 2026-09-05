import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Code2, Globe, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CREDIT_DEVELOPPEUR, TAGLINE, VERSION_APP, type AProposDTO, type ReseauSocial } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Défense en profondeur : le schéma serveur (packages/shared) rejette déjà
// tout lien qui ne commence pas par http(s)://, mais un lien enregistré avant
// ce durcissement ne doit pas non plus être rendu en <a href> (schéma
// javascript: exécutable au clic sur cette page, visible par tous les rôles).
const estLienHttpSur = (lien: string) => /^https?:\/\//i.test(lien);

// Page À propos (section 3.12) — accessible à tous les rôles ; nom/adresse/
// contact/présentation/horaires/réseaux sociaux éditables par l'Admin
// (Principal ou secondaire — pas une tâche critique de la section 2).
export function AProposPage() {
  const { t } = useTranslation();
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
  const editable = peutEcrire("PARAMETRES");

  const { data } = useQuery({
    queryKey: ["apropos"],
    queryFn: () => api<{ apropos: AProposDTO }>("/api/apropos"),
  });
  const apropos = data?.apropos;

  const [enEdition, setEnEdition] = useState(false);
  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [boutiqueAdresse, setBoutiqueAdresse] = useState("");
  const [boutiqueContact, setBoutiqueContact] = useState("");
  const [presentation, setPresentation] = useState("");
  const [horaires, setHoraires] = useState("");
  const [reseauxSociaux, setReseauxSociaux] = useState<ReseauSocial[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  function ouvrirEdition() {
    if (!apropos) return;
    setBoutiqueNom(apropos.boutiqueNom);
    setBoutiqueAdresse(apropos.boutiqueAdresse);
    setBoutiqueContact(apropos.boutiqueContact);
    setPresentation(apropos.presentation);
    setHoraires(apropos.horaires);
    setReseauxSociaux(apropos.reseauxSociaux);
    setErreur(null);
    setEnEdition(true);
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      api<{ apropos: AProposDTO }>("/api/apropos", {
        method: "PUT",
        body: JSON.stringify({
          boutiqueNom: boutiqueNom.trim(),
          boutiqueAdresse: boutiqueAdresse.trim(),
          boutiqueContact: boutiqueContact.trim(),
          presentation: presentation.trim(),
          horaires: horaires.trim(),
          reseauxSociaux: reseauxSociaux
            .map((r) => ({ plateforme: r.plateforme.trim(), lien: r.lien.trim() }))
            .filter((r) => r.plateforme && r.lien),
        }),
      }),
    onSuccess: () => {
      setEnEdition(false);
      queryClient.invalidateQueries({ queryKey: ["apropos"] });
      // Nom/adresse/contact sont la MÊME donnée que Paramètres (3.9), pas une
      // copie séparée : si cette page-là est déjà en cache, elle doit se
      // mettre à jour aussi, sans attendre un rechargement.
      queryClient.invalidateQueries({ queryKey: ["parametres"] });
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("apropos.saveError")),
  });

  useEffect(() => {
    if (!editable && enEdition) setEnEdition(false);
  }, [editable, enEdition]);

  const nomAffiche = apropos?.boutiqueNom || "Boulangerie Lomoto";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <img
          src="/logo-lomoto.png"
          alt="Logo Boulangerie Lomoto"
          className="h-28 w-28 rounded-full object-contain ring-4 ring-or/60"
        />
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{nomAffiche}</h1>
          <p className="mt-1 font-serif text-lg italic text-terracotta dark:text-or">« {TAGLINE} »</p>
        </div>
        <Badge variant="secondary">{t("apropos.subtitle", { version: VERSION_APP })}</Badge>
      </div>

      {editable && !enEdition && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={ouvrirEdition}>
            <Pencil className="h-3.5 w-3.5" />
            {t("apropos.edit")}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("apropos.bakery")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>{t("apropos.bakeryText")}</p>
          <p>{t("apropos.currency")}</p>
        </CardContent>
      </Card>

      {enEdition ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enregistrer.mutate();
          }}
          className="space-y-4"
        >
          <Card>
            <CardHeader>
              <CardTitle>{t("apropos.contact")}</CardTitle>
              <CardDescription>{t("apropos.editSharedHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ap-nom">{t("parametres.boutiqueName")}</Label>
                <Input id="ap-nom" value={boutiqueNom} onChange={(e) => setBoutiqueNom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-adresse">{t("parametres.boutiqueAddress")}</Label>
                <Input id="ap-adresse" value={boutiqueAdresse} onChange={(e) => setBoutiqueAdresse(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-contact">{t("parametres.boutiqueContact")}</Label>
                <Input
                  id="ap-contact"
                  value={boutiqueContact}
                  onChange={(e) => setBoutiqueContact(e.target.value)}
                  placeholder={t("parametres.contactPlaceholder")}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("apropos.presentationTitle")}</CardTitle>
              <CardDescription>{t("apropos.presentationHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={presentation}
                onChange={(e) => setPresentation(e.target.value)}
                rows={4}
                placeholder={t("apropos.presentationPlaceholder")}
              />
              <div className="space-y-1.5">
                <Label htmlFor="ap-horaires">{t("apropos.hoursTitle")}</Label>
                <Textarea
                  id="ap-horaires"
                  value={horaires}
                  onChange={(e) => setHoraires(e.target.value)}
                  rows={2}
                  placeholder={t("apropos.hoursPlaceholder")}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("apropos.socialTitle")}</CardTitle>
              <CardDescription>{t("apropos.socialHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reseauxSociaux.map((reseau, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`ap-reseau-plateforme-${i}`}>{t("apropos.socialPlatform")}</Label>
                    <Input
                      id={`ap-reseau-plateforme-${i}`}
                      value={reseau.plateforme}
                      onChange={(e) =>
                        setReseauxSociaux((liste) => liste.map((r, j) => (j === i ? { ...r, plateforme: e.target.value } : r)))
                      }
                      placeholder="Facebook, Instagram, WhatsApp…"
                    />
                  </div>
                  <div className="flex-[2] space-y-1.5">
                    <Label htmlFor={`ap-reseau-lien-${i}`}>{t("apropos.socialLink")}</Label>
                    <Input
                      id={`ap-reseau-lien-${i}`}
                      value={reseau.lien}
                      onChange={(e) =>
                        setReseauxSociaux((liste) => liste.map((r, j) => (j === i ? { ...r, lien: e.target.value } : r)))
                      }
                      placeholder="https://…"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-terracotta hover:text-terracotta"
                    onClick={() => setReseauxSociaux((liste) => liste.filter((_, j) => j !== i))}
                    aria-label={t("apropos.socialRemove")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReseauxSociaux((liste) => [...liste, { plateforme: "", lien: "" }])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("apropos.socialAdd")}
              </Button>
            </CardContent>
          </Card>

          {erreur && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {erreur}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEnEdition(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="cta" disabled={enregistrer.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("apropos.contact")}</CardTitle>
              <CardDescription>{t("apropos.contactSub")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {apropos?.boutiqueAdresse && (
                <p className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-or" />
                  {apropos.boutiqueAdresse}
                </p>
              )}
              {apropos?.boutiqueContact && (
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-or" />
                  {apropos.boutiqueContact}
                </p>
              )}
              {!apropos?.boutiqueAdresse && !apropos?.boutiqueContact && (
                <p className="text-muted-foreground">{t("apropos.contactEmpty")}</p>
              )}
            </CardContent>
          </Card>

          {apropos?.presentation && (
            <Card>
              <CardHeader>
                <CardTitle>{t("apropos.presentationTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{apropos.presentation}</p>
              </CardContent>
            </Card>
          )}

          {apropos?.horaires && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-or" />
                  {t("apropos.hoursTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{apropos.horaires}</p>
              </CardContent>
            </Card>
          )}

          {!!apropos?.reseauxSociaux.length && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4 text-or" />
                  {t("apropos.socialTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {apropos.reseauxSociaux.filter((reseau) => estLienHttpSur(reseau.lien)).map((reseau, i) => (
                  <a
                    key={i}
                    href={reseau.lien}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-terracotta hover:bg-secondary dark:text-or"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {reseau.plateforme}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Crédit développeur (section 3.12) — non modifiable, également destiné
          au pied de page des rapports exportés. */}
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
