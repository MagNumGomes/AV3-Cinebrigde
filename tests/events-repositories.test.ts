import { Papel } from "../src/domain/entities";
import {
  AuditoriaRecomendacao,
  EventEmitterBus,
  Logger,
  NotificadorEmail,
  NotificadorInterno,
  NotificationGateway
} from "../src/events/recommendation-events";
import {
  CachedFallbackProfessionalRepository,
  InMemoryProfessionalRepository,
  PrismaProfessionalRepository,
  profissionaisDeExemplo
} from "../src/repositories/professional-repository";
import { PrismaClient } from "@prisma/client";
import { profissional, projeto } from "./fixtures";

const loggerDeTeste = (): jest.Mocked<Logger> => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

describe("Observers e EventEmitter", () => {
  it("notifica email, canal interno e auditoria independentemente", async () => {
    const logger = loggerDeTeste();
    const gateway: jest.Mocked<NotificationGateway> = {
      enviarEmail: jest.fn().mockResolvedValue(undefined),
      enviarNotificacaoInterna: jest.fn().mockResolvedValue(undefined)
    };
    const bus = new EventEmitterBus(logger);
    bus.inscrever(new NotificadorEmail(gateway));
    bus.inscrever(new NotificadorInterno(gateway));
    bus.inscrever(new AuditoriaRecomendacao(logger));
    bus.publicar({
      tipo: "convite_recusado",
      projetoId: "p1",
      papel: Papel.DIRETOR,
      profissionalId: "prof1",
      recomendacaoId: "rec1",
      ocorridoEm: new Date().toISOString()
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(gateway.enviarEmail).toHaveBeenCalledTimes(1);
    expect(gateway.enviarNotificacaoInterna).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ tipo: "convite_recusado" }), expect.any(String));
  });

  it("isola falha assíncrona de observer e permite desinscrição", async () => {
    const logger = loggerDeTeste();
    const bus = new EventEmitterBus(logger);
    const unsubscribe = bus.inscrever({ atualizar: async () => { throw new Error("falha externa"); } });
    const evento = {
      tipo: "profissional_recomendado" as const,
      projetoId: "p1",
      papel: Papel.DIRETOR,
      profissionalId: "prof1",
      recomendacaoId: "rec1",
      ocorridoEm: new Date().toISOString()
    };
    bus.publicar(evento);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledWith({ erro: "falha externa" }, "Falha no observer");
    unsubscribe();
    bus.publicar(evento);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("normaliza erro não-Error do observer e registra notificações estruturadas", async () => {
    const logger = loggerDeTeste();
    const bus = new EventEmitterBus(logger);
    bus.inscrever({ atualizar: () => Promise.reject("falha textual") });
    bus.publicar({
      tipo: "profissional_recomendado",
      projetoId: "p1",
      papel: Papel.DIRETOR,
      profissionalId: "prof1",
      recomendacaoId: "r1",
      ocorridoEm: new Date().toISOString()
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledWith({ erro: "falha textual" }, "Falha no observer");
  });

  it("não permite que exceção síncrona interrompa os demais observers", async () => {
    const logger = loggerDeTeste();
    const bus = new EventEmitterBus(logger);
    const outroObserver = jest.fn();
    bus.inscrever({ atualizar: () => { throw new Error("falha imediata"); } });
    bus.inscrever({ atualizar: outroObserver });
    expect(() => bus.publicar({
      tipo: "convite_aceito",
      projetoId: "p1",
      papel: Papel.DIRETOR,
      profissionalId: "prof1",
      recomendacaoId: "r1",
      ocorridoEm: new Date().toISOString()
    })).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(outroObserver).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith({ erro: "falha imediata" }, "Falha no observer");
  });
});

describe("fallback de profissionais", () => {
  it("usa o catálogo de fallback quando o repositório primário falha", async () => {
    const logger = loggerDeTeste();
    const primary = { listarDisponiveis: jest.fn().mockRejectedValue(new Error("database indisponível")) };
    const fallback = new InMemoryProfessionalRepository([profissional("fallback", Papel.DIRETOR)]);
    const repository = new CachedFallbackProfessionalRepository(primary, fallback, logger);
    await expect(repository.listarDisponiveis(projeto())).resolves.toMatchObject([{ id: "fallback" }]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("usa o último catálogo válido antes do fallback de demonstração", async () => {
    const logger = loggerDeTeste();
    const profissionalEmCache = profissional("cache", Papel.DIRETOR);
    const primary = {
      listarDisponiveis: jest.fn()
        .mockResolvedValueOnce([profissionalEmCache])
        .mockRejectedValueOnce(new Error("indisponibilidade transitória"))
    };
    const fallback = { listarDisponiveis: jest.fn().mockResolvedValue([]) };
    const repository = new CachedFallbackProfessionalRepository(primary, fallback, logger);
    await expect(repository.listarDisponiveis(projeto())).resolves.toMatchObject([{ id: "cache" }]);
    await expect(repository.listarDisponiveis(projeto())).resolves.toMatchObject([{ id: "cache" }]);
    expect(fallback.listarDisponiveis).not.toHaveBeenCalled();
  });

  it("mapeia os relacionamentos opcionais do Prisma e gera catálogo demonstrativo", async () => {
    const prismaMock = {
      profissional: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "db-1", nome: "DB 1", email: "db1@test", papeis: [Papel.DIRETOR], generos: ["drama"],
            competencias: [{ nome: "luz", peso: 0.8 }],
            avaliacoes: [{ nota: 5, generoProjeto: "drama", comentario: null }],
            valorDiaria: 100, disponivelAte: null
          },
          {
            id: "db-2", nome: "DB 2", email: "db2@test", papeis: [Papel.EDITOR], generos: [],
            competencias: [],
            avaliacoes: [{ nota: 4, generoProjeto: "comedia", comentario: "bom" }],
            valorDiaria: 80, disponivelAte: new Date("2030-01-01")
          }
        ])
      }
    } as unknown as PrismaClient;
    const resultado = await new PrismaProfessionalRepository(prismaMock).listarDisponiveis(projeto());
    expect(resultado[0]?.avaliacoes[0]?.comentario).toBeUndefined();
    expect(resultado[0]?.disponivelAte).toBeUndefined();
    expect(resultado[1]?.avaliacoes[0]?.comentario).toBe("bom");
    expect(resultado[1]?.disponivelAte).toEqual(new Date("2030-01-01"));
    expect(profissionaisDeExemplo()).toHaveLength(12);
  });
});