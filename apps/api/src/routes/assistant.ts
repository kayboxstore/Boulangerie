import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import {
  ROLE_ADMINISTRATEUR,
  envoyerMessageSupportSchema,
  type ConversationSupportDTO,
  type MessageSupportDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { getIo, roomRole, roomUtilisateur } from "../lib/realtime.js";

export const assistantRouter = Router();

assistantRouter.use(requireAuth);

const estAdmin = (req: Request) => req.utilisateur!.role.nom === ROLE_ADMINISTRATEUR;

const INCLUDE_CONVERSATION = {
  utilisateur: { select: { id: true, nom: true, role: { select: { nom: true } } } },
  fermeePar: { select: { id: true, nom: true } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { auteur: { select: { id: true, nom: true } } },
  },
} satisfies Prisma.ConversationSupportInclude;

type ConversationAvecRelations = Prisma.ConversationSupportGetPayload<{ include: typeof INCLUDE_CONVERSATION }>;
type MessageAvecRelations = ConversationAvecRelations["messages"][number];

function versMessageDTO(m: MessageAvecRelations): MessageSupportDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    auteurType: m.auteurType,
    auteur: { id: m.auteur.id, nom: m.auteur.nom },
    contenu: m.contenu,
    captureEcran: m.captureEcran,
    dateCreation: m.createdAt.toISOString(),
  };
}

function versConversationDTO(c: ConversationAvecRelations): ConversationSupportDTO {
  return {
    id: c.id,
    utilisateur: { id: c.utilisateur.id, nom: c.utilisateur.nom, roleNom: c.utilisateur.role.nom },
    statut: c.statut,
    dateFermeture: c.dateFermeture?.toISOString() ?? null,
    fermeePar: c.fermeePar,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messages: c.messages.map(versMessageDTO),
  };
}

// Le rôle Administrateur ne change pas au fil de l'exécution — mémorisé pour
// éviter une requête supplémentaire à chaque message.
let idRoleAdminCache: string | null = null;
async function idRoleAdmin(): Promise<string | null> {
  if (idRoleAdminCache) return idRoleAdminCache;
  const role = await prisma.role.findUnique({ where: { nom: ROLE_ADMINISTRATEUR }, select: { id: true } });
  idRoleAdminCache = role?.id ?? null;
  return idRoleAdminCache;
}

/** Pousse le message en direct à l'utilisateur concerné ET à tous les Admins connectés. */
async function diffuserMessage(message: MessageSupportDTO, utilisateurId: string) {
  const io = getIo();
  io.to(roomUtilisateur(utilisateurId)).emit("messageSupport", message);
  const idRole = await idRoleAdmin();
  if (idRole) io.to(roomRole(idRole)).emit("messageSupport", message);
}

// --- Vue utilisateur : sa propre conversation ------------------------------

assistantRouter.get("/ma-conversation", async (req, res, next) => {
  try {
    // La PLUS RÉCENTE, ouverte ou fermée : sans ça, une conversation qui vient
    // d'être fermée par un Admin disparaîtrait instantanément de l'écran de
    // l'utilisateur (perte de l'historique + du bandeau « fermée »). Envoyer un
    // nouveau message reste ce qui ouvre un nouveau cycle (voir POST /messages).
    const conversation = await prisma.conversationSupport.findFirst({
      where: { utilisateurId: req.utilisateur!.id },
      include: INCLUDE_CONVERSATION,
      orderBy: { createdAt: "desc" },
    });
    res.json({ conversation: conversation ? versConversationDTO(conversation) : null });
  } catch (e) {
    next(e);
  }
});

// Envoie un message en tant qu'utilisateur : reprend sa conversation ouverte,
// ou en ouvre une nouvelle si aucune n'est en cours (ex. la précédente a été
// fermée par un Admin) — historique propre, comme des tickets successifs.
assistantRouter.post("/messages", async (req, res, next) => {
  try {
    const parsed = envoyerMessageSupportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { contenu, captureEcran } = parsed.data;
    const auteur = req.utilisateur!;

    let conversation = await prisma.conversationSupport.findFirst({
      where: { utilisateurId: auteur.id, statut: "OUVERTE" },
    });
    if (!conversation) {
      conversation = await prisma.conversationSupport.create({ data: { utilisateurId: auteur.id } });
    }

    await prisma.messageSupport.create({
      data: {
        conversationId: conversation.id,
        auteurType: "UTILISATEUR",
        auteurId: auteur.id,
        contenu: contenu?.trim() || null,
        captureEcran: captureEcran ?? null,
      },
    });
    // updatedAt sert au tri de la file Admin par activité récente.
    await prisma.conversationSupport.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    const complete = await prisma.conversationSupport.findUniqueOrThrow({
      where: { id: conversation.id },
      include: INCLUDE_CONVERSATION,
    });
    const dto = versConversationDTO(complete);
    const dernierMessage = dto.messages[dto.messages.length - 1]!;

    await diffuserMessage(dernierMessage, auteur.id);

    const idsAdmins = (
      await prisma.utilisateur.findMany({ where: { role: { nom: ROLE_ADMINISTRATEUR }, actif: true }, select: { id: true } })
    ).map((a) => a.id);
    if (idsAdmins.length > 0) {
      busEvenements.emettreEvenement({
        type: "MESSAGE_SUPPORT",
        module: "EQUIPE",
        emetteurId: auteur.id,
        evenementRef: conversation.id,
        priorite: "HAUTE",
        destinataireIdsDirects: idsAdmins,
        message: `Nouveau message de ${auteur.nom} — Assistant`,
        donnees: { conversationId: conversation.id },
      });
    }

    res.status(201).json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});

// --- Vue Admin : file de toutes les conversations --------------------------

assistantRouter.get("/conversations", async (req, res, next) => {
  try {
    if (!estAdmin(req)) return res.status(403).json({ erreur: "Réservé aux Administrateurs" });
    const conversations = await prisma.conversationSupport.findMany({
      include: INCLUDE_CONVERSATION,
      orderBy: [{ statut: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
    res.json({ conversations: conversations.map(versConversationDTO) });
  } catch (e) {
    next(e);
  }
});

// Réponse d'un Admin à une conversation précise de la file.
assistantRouter.post("/conversations/:id/messages", async (req, res, next) => {
  try {
    if (!estAdmin(req)) return res.status(403).json({ erreur: "Réservé aux Administrateurs" });
    const parsed = envoyerMessageSupportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { contenu, captureEcran } = parsed.data;
    const auteur = req.utilisateur!;

    const conversation = await prisma.conversationSupport.findUnique({ where: { id: req.params.id } });
    if (!conversation) return res.status(404).json({ erreur: "Conversation introuvable" });
    if (conversation.statut === "FERMEE") {
      return res.status(409).json({ erreur: "Cette conversation est fermée" });
    }

    await prisma.messageSupport.create({
      data: {
        conversationId: conversation.id,
        auteurType: "ADMIN",
        auteurId: auteur.id,
        contenu: contenu?.trim() || null,
        captureEcran: captureEcran ?? null,
      },
    });
    await prisma.conversationSupport.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    const complete = await prisma.conversationSupport.findUniqueOrThrow({
      where: { id: conversation.id },
      include: INCLUDE_CONVERSATION,
    });
    const dto = versConversationDTO(complete);
    const dernierMessage = dto.messages[dto.messages.length - 1]!;

    await diffuserMessage(dernierMessage, conversation.utilisateurId);

    busEvenements.emettreEvenement({
      type: "MESSAGE_SUPPORT",
      module: "EQUIPE",
      emetteurId: auteur.id,
      evenementRef: conversation.id,
      priorite: "HAUTE",
      destinataireIdsDirects: [conversation.utilisateurId],
      message: `${auteur.nom} (Administrateur) a répondu — Assistant`,
      donnees: { conversationId: conversation.id },
    });

    res.status(201).json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});

assistantRouter.post("/conversations/:id/fermer", async (req, res, next) => {
  try {
    if (!estAdmin(req)) return res.status(403).json({ erreur: "Réservé aux Administrateurs" });
    const conversation = await prisma.conversationSupport.findUnique({ where: { id: req.params.id } });
    if (!conversation) return res.status(404).json({ erreur: "Conversation introuvable" });
    if (conversation.statut === "FERMEE") {
      return res.status(200).json({ conversation: null }); // déjà fermée : idempotent
    }

    const maj = await prisma.conversationSupport.update({
      where: { id: conversation.id },
      data: { statut: "FERMEE", fermeeParId: req.utilisateur!.id, dateFermeture: new Date() },
      include: INCLUDE_CONVERSATION,
    });
    const dto = versConversationDTO(maj);

    const io = getIo();
    io.to(roomUtilisateur(conversation.utilisateurId)).emit("conversationSupportFermee", { conversationId: conversation.id });
    const idRole = await idRoleAdmin();
    if (idRole) io.to(roomRole(idRole)).emit("conversationSupportFermee", { conversationId: conversation.id });

    res.json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});
