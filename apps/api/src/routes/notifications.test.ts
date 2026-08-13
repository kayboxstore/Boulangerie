import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    notification: {
      findMany: mocks.findMany,
      count: mocks.count,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "utilisateur-connecte" } as express.Request["utilisateur"];
    next();
  },
}));

import { notificationsRouter } from "./notifications.js";

function appNotifications() {
  const app = express();
  app.use(express.json());
  app.use(notificationsRouter);
  return app;
}

describe("isolation des notifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("charge uniquement l’historique du destinataire connecté", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "notification-1",
        type: "TEST",
        module: "COMMANDES",
        message: "Message",
        evenementRef: null,
        donnees: null,
        priorite: "NORMALE",
        lu: false,
        dateCreation: new Date("2026-08-13T08:00:00.000Z"),
        emetteur: null,
      },
    ]);
    mocks.count.mockResolvedValue(1);

    const res = await request(appNotifications()).get("/");

    expect(res.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { destinataireId: "utilisateur-connecte" } }),
    );
    expect(mocks.count).toHaveBeenCalledWith({
      where: { destinataireId: "utilisateur-connecte", lu: false },
    });
  });

  it("ne marque jamais la notification d’un autre utilisateur", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(appNotifications()).post("/notification-autre/lu");

    expect(res.status).toBe(404);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "notification-autre", destinataireId: "utilisateur-connecte" },
      data: { lu: true },
    });
  });

  it("marque en masse uniquement les notifications du compte connecté", async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });

    const res = await request(appNotifications()).post("/lu");

    expect(res.status).toBe(204);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { destinataireId: "utilisateur-connecte", lu: false },
      data: { lu: true },
    });
  });
});
