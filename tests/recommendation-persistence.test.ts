import { Prisma, PrismaClient } from "@prisma/client";
import { MembroSugerido, Papel, StatusConvite } from "../src/domain/entities";
import { Logger } from "../src/events/recommendation-events";
import {
  InMemoryRecommendationPersistence,
  PrismaRecommendationPersistence,
  ResilientRecommendationPersistence
} from "../src/repositories/recommendation-persistence";
import { ResultadoRecomendacao } from "../src/recommendation/recommendation-service";
import { profissional, projeto } from "./fixtures";
import { ProjetoAnimacao } from "../src/domain/projects";

function recomendacao(): ResultadoRecomendacao {
  const pessoa = profissional("prof-db", Papel.DIRETOR);
  const membro: MembroSugerido = {
    papel: Papel.DIRETOR,
    profissional: pessoa,
    pontuacao: 0.9,
    motivo: "fit"
  };
  return {
    id: "rec-db",
    criadaEm: new Date().toISOString(),
    projeto: projeto(),
    estrategia: "similaridade",
    membros: [membro],
    parcial: false
  };
}

describe("persistência de recomendações", () => {
  it("persiste os atributos da subclasse tanto na criação quanto na atualização", async () => {
    const upsert = jest.fn();
    const prismaFalso = { $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      projeto: { upsert }, equipe: { upsert: jest.fn() }, recomendacao: { createMany: jest.fn() }
    }) } as unknown as PrismaClient;
    const resultado = recomendacao();
    resultado.projeto = new ProjetoAnimacao({ software: "Maya", quadrosPorSegundo: 60, duracao: 20,
      restricoes: { diasProducao: 3, competenciasObrigatorias: ["modelagem 3d"] } });
    await new PrismaRecommendationPersistence(prismaFalso).salvar(resultado);
    const esperado = expect.objectContaining({ tipo: "animacao", duracao: 20,
      restricoes: { diasProducao: 3, competenciasObrigatorias: ["modelagem 3d"] },
      dadosEspecificos: { software: "Maya", quadrosPorSegundo: 60 } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: esperado, update: esperado }));
  });

  it("grava projeto, equipe, membros e histórico de recomendações", async () => {
    const projetoUpsert = jest.fn();
    const equipeUpsert = jest.fn();
    const recomendacaoCreateMany = jest.fn();
    const prismaFalso = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) => callback({
        projeto: { upsert: projetoUpsert },
        equipe: { upsert: equipeUpsert },
        recomendacao: { createMany: recomendacaoCreateMany }
      }))
    } as unknown as PrismaClient;
    const persistence = new PrismaRecommendationPersistence(prismaFalso);
    await persistence.salvar(recomendacao());
    expect(projetoUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "projeto-1" },
      create: expect.objectContaining({ competencias: { fotografia: 1 } as Prisma.InputJsonValue })
    }));
    expect(equipeUpsert).toHaveBeenCalledTimes(1);
    expect(recomendacaoCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ profissionalId: "prof-db" })] });
  });

  it("registra convites e trata projeto sem membro", async () => {
    const conviteCreate = jest.fn();
    const prismaFalso = { convite: { create: conviteCreate } } as unknown as PrismaClient;
    const persistence = new PrismaRecommendationPersistence(prismaFalso);
    await persistence.registrarConvite(recomendacao(), Papel.DIRETOR, StatusConvite.ACEITO);
    expect(conviteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ACEITO", profissionalId: "prof-db" })
    }));
    const semMembro = { ...recomendacao(), membros: [] };
    await persistence.registrarConvite(semMembro, Papel.DIRETOR, StatusConvite.RECUSADO);
    expect(conviteCreate).toHaveBeenCalledTimes(1);
  });

  it("isola erros do banco e executa persistência alternativa", async () => {
    const logger: jest.Mocked<Logger> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const primary = {
      salvar: jest.fn().mockRejectedValue(new Error("offline")),
      registrarConvite: jest.fn().mockRejectedValue(new Error("offline"))
    };
    const fallback = { salvar: jest.fn().mockResolvedValue(undefined), registrarConvite: jest.fn().mockResolvedValue(undefined) };
    const persistence = new ResilientRecommendationPersistence(primary, fallback, logger);
    await persistence.salvar(recomendacao());
    await persistence.registrarConvite(recomendacao(), Papel.DIRETOR, StatusConvite.RECUSADO);
    await new InMemoryRecommendationPersistence().salvar(recomendacao());
    expect(fallback.salvar).toHaveBeenCalledTimes(1);
    expect(fallback.registrarConvite).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
