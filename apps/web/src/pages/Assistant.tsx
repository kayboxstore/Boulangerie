import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ROLE_ADMINISTRATEUR,
  type ConversationSupportDTO,
  type MessageSupportDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ChargementModule } from "@/components/ChargementModule";
import { cn } from "@/lib/utils";

// 3 Mo bruts ≈ un peu moins de 4 Mo une fois encodés en base64 — cohérent avec
// TAILLE_MAX_CAPTURE_BASE64 (packages/shared) et la limite JSON de l'API (5 Mo).
const TAILLE_MAX_FICHIER = 3 * 1024 * 1024;

function fichierVersBase64(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(lecteur.result as string);
    lecteur.onerror = () => reject(lecteur.error);
    lecteur.readAsDataURL(fichier);
  });
}

const formatHeure = (iso: string) => new Date(iso).toLocaleString();

function BulleMessage({ message, estMoi }: { message: MessageSupportDTO; estMoi: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex", estMoi ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
          estMoi ? "bg-terracotta text-creme" : "bg-secondary text-secondary-foreground",
        )}
      >
        <p className="mb-0.5 text-xs font-medium opacity-70">{estMoi ? t("assistant.you") : message.auteur.nom}</p>
        {message.contenu && <p className="whitespace-pre-wrap">{message.contenu}</p>}
        {message.captureEcran && (
          <img
            src={message.captureEcran}
            alt={t("assistant.screenshotPreviewAlt")}
            className="mt-2 max-h-64 max-w-full rounded-lg border border-black/10"
          />
        )}
        <p className="mt-1 text-right text-[10px] opacity-60">{formatHeure(message.dateCreation)}</p>
      </div>
    </div>
  );
}

/** Zone de saisie — réutilisée par la vue utilisateur et la vue Admin. */
function Composeur({
  onEnvoyer,
  enCours,
}: {
  onEnvoyer: (contenu: string, captureEcran: string | null) => void;
  enCours: boolean;
}) {
  const { t } = useTranslation();
  const { toastErreur } = useFeedback();
  const [texte, setTexte] = useState("");
  const [capture, setCapture] = useState<string | null>(null);
  const inputFichierRef = useRef<HTMLInputElement>(null);

  async function choisirFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier ensuite
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX_FICHIER) {
      toastErreur(t("assistant.screenshotTooLarge"));
      return;
    }
    setCapture(await fichierVersBase64(fichier));
  }

  function envoyer() {
    if (!texte.trim() && !capture) return;
    onEnvoyer(texte.trim(), capture);
    setTexte("");
    setCapture(null);
  }

  return (
    <div className="space-y-2 border-t bg-card p-3">
      {capture && (
        <div className="relative inline-block">
          <img src={capture} alt={t("assistant.screenshotPreviewAlt")} className="h-20 rounded-md border" />
          <button
            type="button"
            onClick={() => setCapture(null)}
            aria-label={t("assistant.removeScreenshot")}
            className="absolute -right-2 -top-2 rounded-full bg-marine p-0.5 text-creme shadow"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={inputFichierRef} type="file" accept="image/*" className="hidden" onChange={choisirFichier} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => inputFichierRef.current?.click()}
          aria-label={t("assistant.attachScreenshot")}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={t("assistant.placeholder")}
          className="min-h-9"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              envoyer();
            }
          }}
        />
        <Button type="button" variant="cta" className="shrink-0" onClick={envoyer} disabled={enCours || (!texte.trim() && !capture)}>
          <Send className="h-4 w-4" />
          {t("assistant.send")}
        </Button>
      </div>
    </div>
  );
}

function BandeauFermeture({ conversation }: { conversation: ConversationSupportDTO }) {
  const { t } = useTranslation();
  return (
    <div className="border-t bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
      {t("assistant.closedBanner")}
      {conversation.fermeePar && conversation.dateFermeture && (
        <>
          {" "}
          — {t("assistant.closedBannerBy", { nom: conversation.fermeePar.nom, date: formatHeure(conversation.dateFermeture) })}
        </>
      )}
    </div>
  );
}

// --- Vue utilisateur : sa propre conversation -------------------------------

function VueUtilisateur() {
  const { t } = useTranslation();
  const { utilisateur } = useAuth();
  const { toastErreur } = useFeedback();
  const queryClient = useQueryClient();
  const finRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["assistant-ma-conversation"],
    queryFn: () => api<{ conversation: ConversationSupportDTO | null }>("/api/assistant/ma-conversation"),
  });
  const conversation = data?.conversation ?? null;

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length]);

  const envoyer = useMutation({
    mutationFn: (body: { contenu: string; captureEcran: string | null }) =>
      api<{ conversation: ConversationSupportDTO }>("/api/assistant/messages", {
        method: "POST",
        body: JSON.stringify({ contenu: body.contenu || undefined, captureEcran: body.captureEcran || undefined }),
      }),
    onSuccess: (r) => queryClient.setQueryData(["assistant-ma-conversation"], { conversation: r.conversation }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("assistant.sendError")),
  });

  if (isLoading) return <ChargementModule />;

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-2xl flex-col">
      <div className="mb-4">
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("assistant.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("assistant.subtitleUser")}</p>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex-1 space-y-3 overflow-y-auto p-4">
          {(!conversation || conversation.messages.length === 0) && (
            <p className="py-10 text-center text-muted-foreground">{t("assistant.emptyMessages")}</p>
          )}
          {conversation?.messages.map((m) => (
            <BulleMessage key={m.id} message={m} estMoi={m.auteur.id === utilisateur?.id} />
          ))}
          <div ref={finRef} />
        </CardContent>
        {conversation?.statut === "FERMEE" && <BandeauFermeture conversation={conversation} />}
        <Composeur onEnvoyer={(contenu, captureEcran) => envoyer.mutate({ contenu, captureEcran })} enCours={envoyer.isPending} />
      </Card>
    </div>
  );
}

// --- Vue Admin : file de toutes les conversations ---------------------------

function VueAdmin() {
  const { t } = useTranslation();
  const { utilisateur } = useAuth();
  const { confirmer, toastErreur } = useFeedback();
  const queryClient = useQueryClient();
  const [selectionneeId, setSelectionneeId] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["assistant-conversations"],
    queryFn: () => api<{ conversations: ConversationSupportDTO[] }>("/api/assistant/conversations"),
    refetchInterval: 20000,
  });
  const conversations = data?.conversations ?? [];
  const selectionnee = conversations.find((c) => c.id === selectionneeId) ?? null;

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectionnee?.messages.length]);

  const envoyer = useMutation({
    mutationFn: (body: { conversationId: string; contenu: string; captureEcran: string | null }) =>
      api<{ conversation: ConversationSupportDTO }>(`/api/assistant/conversations/${body.conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ contenu: body.contenu || undefined, captureEcran: body.captureEcran || undefined }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("assistant.sendError")),
  });

  const fermer = useMutation({
    mutationFn: (conversationId: string) => api(`/api/assistant/conversations/${conversationId}/fermer`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("assistant.closeError")),
  });

  if (isLoading) return <ChargementModule />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("assistant.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("assistant.subtitleAdmin")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        {/* File — masquée sur mobile dès qu'une conversation est sélectionnée. */}
        <Card className={cn("h-fit md:block md:max-h-[calc(100vh-15rem)] md:overflow-y-auto", selectionnee ? "hidden" : "block")}>
          <CardHeader>
            <CardTitle className="text-base">{t("assistant.queueTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {conversations.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("assistant.queueEmpty")}</p>
            )}
            {conversations.map((c) => {
              const dernier = c.messages[c.messages.length - 1];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectionneeId(c.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    selectionneeId === c.id ? "bg-or/15" : "hover:bg-secondary",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-marine dark:text-creme">{c.utilisateur.nom}</span>
                    <Badge variant={c.statut === "OUVERTE" ? "gold" : "secondary"} className="shrink-0 text-[10px]">
                      {c.statut === "OUVERTE" ? t("assistant.statusOpen") : t("assistant.statusClosed")}
                    </Badge>
                  </div>
                  {dernier && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {dernier.contenu || t("assistant.screenshotAttached")}
                    </p>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Fil — masqué sur mobile tant que rien n'est sélectionné. */}
        <Card className={cn("flex h-[calc(100vh-15rem)] flex-col overflow-hidden md:flex", selectionnee ? "flex" : "hidden")}>
          {!selectionnee ? (
            <CardContent className="flex flex-1 items-center justify-center text-center text-muted-foreground">
              {t("assistant.selectConversation")}
            </CardContent>
          ) : (
            <>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 md:hidden"
                    onClick={() => setSelectionneeId(null)}
                    aria-label={t("assistant.queueTitle")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="text-base">{selectionnee.utilisateur.nom}</CardTitle>
                </div>
                {selectionnee.statut === "OUVERTE" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (await confirmer({ description: t("assistant.confirmClose") })) fermer.mutate(selectionnee.id);
                    }}
                  >
                    {t("assistant.closeConversation")}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex-1 space-y-3 overflow-y-auto">
                {selectionnee.messages.length === 0 && (
                  <p className="py-10 text-center text-muted-foreground">{t("assistant.emptyMessages")}</p>
                )}
                {selectionnee.messages.map((m) => (
                  <BulleMessage key={m.id} message={m} estMoi={m.auteur.id === utilisateur?.id} />
                ))}
                <div ref={finRef} />
              </CardContent>
              {selectionnee.statut === "FERMEE" ? (
                <BandeauFermeture conversation={selectionnee} />
              ) : (
                <Composeur
                  onEnvoyer={(contenu, captureEcran) => envoyer.mutate({ conversationId: selectionnee.id, contenu, captureEcran })}
                  enCours={envoyer.isPending}
                />
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export function AssistantPage() {
  const { utilisateur } = useAuth();
  const estAdmin = utilisateur?.role.nom === ROLE_ADMINISTRATEUR;
  return estAdmin ? <VueAdmin /> : <VueUtilisateur />;
}
