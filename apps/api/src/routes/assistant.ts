import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import {
  ROLE_ADMINISTRATEUR,
  envoyerMessageSupportSchema,
  type ConversationSupportDTO,
  type MessageSupportDTO,
  type TypeEvenement,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { getIo, roomRole, roomUtilisateur } from "../lib/realtime.js";
import { repondreAssistantIA } from "../lib/ia.js";

export const assistantRouter = Router();

assistantRouter.use(requireAuth);

const estAdmin = (req: Request) => req.utilisateur!.role.nom === ROLE_ADMINISTRATEUR;

const MESSAGE_ECHEC_IA =
  "Désolé, je rencontre un souci technique pour vous répondre. Un administrateur va prendre le relai.";

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
    auteur: m.auteur ? { id: m.auteur.id, nom: m.auteur.nom } : null,
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
    escaladee: c.escaladee,
    dateFermeture: c.dateFermeture?.toISOString() ?? null,
    fermeePar: c.fermeePar,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messages: c.messages.map(versMessageDTO),
  };
}

async function chargerConversation(id: string): Promise<ConversationSupportDTO> {
  const c = await prisma.conversationSupport.findUniqueOrThrow({ where: { id }, include: INCLUDE_CONVERSATION });
  return versConversationDTO(c);
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

/** Pousse un message en direct à l'utilisateur concerné ET à tous les Admins connectés. */
async function diffuserMessage(message: MessageSupportDTO, utilisateurId: string) {
  const io = getIo();
  io.to(roomUtilisateur(utilisateurId)).emit("messageSupport", message);
  const idRole = await idRoleAdmin();
  if (idRole) io.to(roomRole(idRole)).emit("messageSupport", message);
}

async function diffuserEscalade(conversationId: string, utilisateurId: string) {
  const io = getIo();
  io.to(roomUtilisateur(utilisateurId)).emit("conversationSupportEscaladee", { conversationId });
  const idRole = await idRoleAdmin();
  if (idRole) io.to(roomRole(idRole)).emit("conversationSupportEscaladee", { conversationId });
}

/** Notification (badge + historique) à tous les comptes Admin actifs. */
async function notifierAdmins(auteurId: string, conversationId: string, message: string, type: TypeEvenement) {
  const idsAdmins = (
    await prisma.utilisateur.findMany({ where: { role: { nom: ROLE_ADMINISTRATEUR }, actif: true }, select: { id: true } })
  ).map((a) => a.id);
  if (idsAdmins.length === 0) return;
  busEvenements.emettreEvenement({
    type,
    module: "EQUIPE",
    emetteurId: auteurId,
    evenementRef: conversationId,
    priorite: "HAUTE",
    destinataireIdsDirects: idsAdmins,
    message,
    donnees: { conversationId },
  });
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
//
// Premier niveau IA (section 3.19 mise à jour) : tant que la conversation
// n'est pas escaladée, l'IA répond automatiquement au message. Si l'appel
// échoue pour quelque raison que ce soit, la conversation est escaladée
// automatiquement plutôt que de laisser l'utilisateur sans réponse (point 5 —
// le chat lui-même ne plante jamais, quoi qu'il arrive côté IA).
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

    let dto = await chargerConversation(conversation.id);
    await diffuserMessage(dto.messages[dto.messages.length - 1]!, auteur.id);

    if (conversation.escaladee) {
      // Déjà escaladée (bouton, jonction d'un Admin, ou échec IA précédent) :
      // l'IA n'intervient plus, seule la notification humaine reste en jeu.
      await notifierAdmins(auteur.id, conversation.id, `Nouveau message de ${auteur.nom} — Assistant`, "MESSAGE_SUPPORT");
    } else {
      const historique = dto.messages
        .filter((m) => m.auteurType === "UTILISATEUR" || m.auteurType === "IA")
        .slice(-20)
        .map((m) => ({
          role: m.auteurType === "IA" ? ("model" as const) : ("user" as const),
          texte: m.contenu ?? "(capture d'écran jointe, sans texte)",
        }));
      const reponse = await repondreAssistantIA(historique);

      if (reponse) {
        await prisma.messageSupport.create({
          data: { conversationId: conversation.id, auteurType: "IA", contenu: reponse },
        });
        dto = await chargerConversation(conversation.id);
        await diffuserMessage(dto.messages[dto.messages.length - 1]!, auteur.id);
      } else {
        await prisma.conversationSupport.update({ where: { id: conversation.id }, data: { escaladee: true } });
        await prisma.messageSupport.create({
          data: { conversationId: conversation.id, auteurType: "IA", contenu: MESSAGE_ECHEC_IA },
        });
        dto = await chargerConversation(conversation.id);
        await diffuserMessage(dto.messages[dto.messages.length - 1]!, auteur.id);
        await diffuserEscalade(conversation.id, auteur.id);
        await notifierAdmins(
          auteur.id,
          conversation.id,
          `Escalade automatique (IA indisponible) — ${auteur.nom} — Assistant`,
          "ESCALADE_SUPPORT",
        );
      }
    }

    res.status(201).json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});

// Bouton "Parler à un Admin" : passe la conversation en escaladée sans
// attendre un échec IA. Crée la conversation si l'utilisateur n'a encore rien
// écrit (accès direct à un humain, sans passer par l'IA).
assistantRouter.post("/escalader", async (req, res, next) => {
  try {
    const auteur = req.utilisateur!;
    let conversation = await prisma.conversationSupport.findFirst({
      where: { utilisateurId: auteur.id, statut: "OUVERTE" },
    });
    if (!conversation) {
      conversation = await prisma.conversationSupport.create({ data: { utilisateurId: auteur.id } });
    }
    if (!conversation.escaladee) {
      await prisma.conversationSupport.update({
        where: { id: conversation.id },
        data: { escaladee: true, updatedAt: new Date() },
      });
    }
    const dto = await chargerConversation(conversation.id);

    await diffuserEscalade(conversation.id, auteur.id);
    await notifierAdmins(
      auteur.id,
      conversation.id,
      `${auteur.nom} souhaite parler à un administrateur — Assistant`,
      "ESCALADE_SUPPORT",
    );

    res.json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});

// --- Vue Admin : file de toutes les conversations ---------------------------

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

// Réponse d'un Admin à une conversation précise de la file. Escalade
// systématiquement la conversation (si ce n'était pas déjà fait) : dès qu'un
// humain répond, l'IA ne doit plus jamais intervenir sur ce fil.
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
    const donneesMaj: Prisma.ConversationSupportUpdateInput = { updatedAt: new Date() };
    if (!conversation.escaladee) donneesMaj.escaladee = true;
    await prisma.conversationSupport.update({ where: { id: conversation.id }, data: donneesMaj });

    const dto = await chargerConversation(conversation.id);
    await diffuserMessage(dto.messages[dto.messages.length - 1]!, conversation.utilisateurId);
    if (!conversation.escaladee) await diffuserEscalade(conversation.id, conversation.utilisateurId);

    await notifierAdmins(
      auteur.id,
      conversation.id,
      `${auteur.nom} (Administrateur) a répondu — Assistant`,
      "MESSAGE_SUPPORT",
    );

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

    await prisma.conversationSupport.update({
      where: { id: conversation.id },
      data: { statut: "FERMEE", fermeeParId: req.utilisateur!.id, dateFermeture: new Date() },
    });
    const dto = await chargerConversation(conversation.id);

    const io = getIo();
    io.to(roomUtilisateur(conversation.utilisateurId)).emit("conversationSupportFermee", { conversationId: conversation.id });
    const idRole = await idRoleAdmin();
    if (idRole) io.to(roomRole(idRole)).emit("conversationSupportFermee", { conversationId: conversation.id });

    res.json({ conversation: dto });
  } catch (e) {
    next(e);
  }
});
