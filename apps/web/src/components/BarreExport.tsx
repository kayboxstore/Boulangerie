import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2, Mail, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Module } from "@lomoto/shared";
import { api, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SectionCSV } from "@/lib/csv";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  titre: string;
  sousTitre?: string;
  /** Modules dont le document tire ses données — vérifiés côté serveur. */
  modules: Module[];
  /** Construit les sections au moment du clic (données à jour). */
  construireSections: () => SectionCSV[];
}

/**
 * Barre d'export d'un rapport (section 3.13) : impression navigateur (qui sert
 * aussi à « Enregistrer en PDF »), téléchargement d'un PDF généré côté serveur,
 * et envoi de ce même PDF par email. Un seul composant pour les trois écrans
 * concernés — Rapports personnels, Tableau de bord et Commissions.
 */
export function BarreExport({ titre, sousTitre, modules, construireSections }: Props) {
  const { t } = useTranslation();
  const [dialogEmail, setDialogEmail] = useState(false);
  const [destinataire, setDestinataire] = useState("");
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  // L'envoi par email n'est proposé que si le serveur est configuré pour.
  const { data: capacites } = useQuery({
    queryKey: ["export-capacites"],
    queryFn: () => api<{ email: boolean }>("/api/export/capacites"),
    staleTime: 10 * 60 * 1000,
  });

  const corpsDocument = () => ({
    titre,
    sousTitre,
    modules,
    sections: construireSections(),
  });

  // Le PDF revient en binaire : fetch direct plutôt que le helper JSON.
  const telecharger = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(corpsDocument()),
      });
      if (!res.ok) {
        const corps = await res.json().catch(() => null);
        throw new Error(corps?.erreur ?? t("export.pdfError"));
      }
      const blob = await res.blob();
      const nom =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "rapport.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("export.pdfError")),
  });

  const envoyer = useMutation({
    mutationFn: () =>
      api<{ envoye: boolean }>("/api/export/email", {
        method: "POST",
        body: JSON.stringify({
          ...corpsDocument(),
          destinataire: destinataire.trim(),
          message: message.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogEmail(false);
      setSucces(t("export.emailSent", { destinataire: destinataire.trim() }));
      setDestinataire("");
      setMessage("");
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("export.emailError")),
  });

  return (
    <>
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {t("export.print")}
        </Button>
        <Button variant="outline" onClick={() => telecharger.mutate()} disabled={telecharger.isPending}>
          {telecharger.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t("export.downloadPdf")}
        </Button>
        {capacites?.email && (
          <Button
            variant="outline"
            onClick={() => {
              setErreur(null);
              setSucces(null);
              setDialogEmail(true);
            }}
          >
            <Mail className="h-4 w-4" />
            {t("export.sendEmail")}
          </Button>
        )}
      </div>

      {succes && (
        <p role="status" className="no-print rounded-md border border-or/50 bg-or/10 px-3 py-2 text-sm">
          {succes}
        </p>
      )}

      {/* Le pied de page d'impression (crédit développeur, 3.12) est rendu une
          seule fois par le Layout : ici, il hériterait du `.no-print` du
          conteneur d'actions de l'écran et ne s'imprimerait pas. */}

      <Dialog open={dialogEmail} onOpenChange={setDialogEmail}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErreur(null);
              envoyer.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("export.emailDialogTitle")}</DialogTitle>
              <DialogDescription>{t("export.emailDialogDesc", { titre })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="export-destinataire">{t("export.recipient")}</Label>
                <Input
                  id="export-destinataire"
                  type="email"
                  value={destinataire}
                  onChange={(e) => setDestinataire(e.target.value)}
                  placeholder="destinataire@exemple.cd"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="export-message">{t("export.messageOptional")}</Label>
                <Input
                  id="export-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("export.messagePlaceholder")}
                />
              </div>
            </div>
            {erreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogEmail(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={envoyer.isPending}>
                {envoyer.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("export.send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
