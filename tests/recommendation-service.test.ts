import { Papel } from "../src/domain/entities";
import { EventBus, EventoRecomendacao } from "../src/events/recommendation-events";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { ApiError, ProjetoInput, RecommendationService } from "../src/recommendation/recommendation-service";
import { profissional } from "./fixtures";

class EventBusDeTeste implements EventBus {
  readonly eventos: EventoRecomendacao[] = [];
  publicar(evento: EventoRecomendacao): void { this.eventos.push(evento); }
  inscrever(): () => void { return () => undefined; }
}

const input: ProjetoInput = {
  genero: "drama",
  orcamento: 2000,
  prazo: "2030-06-01",
  papeisObrigatorios: [Papel.DIRETOR, Papel.EDITOR],
  competencias: { fotografia: 1 }
};

function criarService(): { service: RecommendationService; bus: EventBusDeTeste } {
  const bus = new EventBusDeTeste();
  const repository = new InMemoryProfessionalRepository([
    profissional("diretor-1", Papel.DIRETOR),
    profissional("diretor-2", Papel.DIRETOR, { nota: 3 }),
    profissional("editor-1", Papel.EDITOR),
    profissional("editor-2", Papel.EDITOR, { nota: 3 })
  ]);
  return { service: new RecommendationService(repository, bus, "similaridade"), bus };
}

function criarServiceComLimite(limiteSessoes: number): RecommendationService {
  const repository = new InMemoryProfessionalRepository([
    profissional("diretor-1", Papel.DIRETOR),
    profissional("editor-1", Papel.EDITOR)
  ]);
  return new RecommendationService(repository, new EventBusDeTeste(), "similaridade", undefined, limiteSessoes);
}

describe("RecommendationService", () => {
  it("troca estratégia e emite um evento por membro recomendado", async () => {
    const { service, bus } = criarService();
    const resultado = await service.recomendar(input, "colaborativa");
    expect(resultado.estrategia).toBe("colaborativa");
    expect(resultado.membros).toHaveLength(2);
    expect(bus.eventos).toHaveLength(2);
  });

  it("recomenda novamente apenas o papel afetado e mantém os demais membros", async () => {
    const { service } = criarService();
    const inicial = await service.recomendar(input);
    const editorInicial = inicial.membros.find((membro) => membro.papel === Papel.EDITOR)?.profissional.id;
    const atualizado = await service.substituirPapel(inicial.id, Papel.DIRETOR, {});
    expect(atualizado.membros.find((membro) => membro.papel === Papel.EDITOR)?.profissional.id).toBe(editorInicial);
    expect(atualizado.membros.find((membro) => membro.papel === Papel.DIRETOR)?.profissional.id).not.toBe("diretor-1");
  });

  it("aceita substituto escolhido e publica aceite ou recusa de convite", async () => {
    const { service, bus } = criarService();
    const inicial = await service.recomendar(input);
    const atualizado = await service.substituirPapel(inicial.id, Papel.DIRETOR, { substitutoId: "diretor-2" });
    expect(atualizado.membros.find((membro) => membro.papel === Papel.DIRETOR)?.profissional.id).toBe("diretor-2");
    await service.responderConvite(inicial.id, Papel.DIRETOR, "RECUSADO");
    expect(bus.eventos.at(-1)?.tipo).toBe("convite_recusado");
    await service.responderConvite(inicial.id, Papel.EDITOR, "ACEITO");
    expect(bus.eventos.at(-1)?.tipo).toBe("convite_aceito");
  });

  it("exige mudança significativa para reavaliar a equipe completa", async () => {
    const { service } = criarService();
    const inicial = await service.recomendar(input);
    await expect(service.reavaliar(inicial.id, { ...input, orcamento: 2100 }))
      .rejects.toBeInstanceOf(ApiError);
    const nova = await service.reavaliar(inicial.id, { ...input, orcamento: 2500 });
    expect(nova.id).not.toBe(inicial.id);
    expect(nova.membros).toHaveLength(2);
  });

  it("rejeita sessão desconhecida e substituto incompatível", async () => {
    const { service } = criarService();
    await expect(service.substituirPapel("desconhecida", Papel.DIRETOR, {})).rejects.toMatchObject({ statusCode: 404 });
    const inicial = await service.recomendar(input);
    await expect(service.substituirPapel(inicial.id, Papel.DIRETOR, { substitutoId: "editor-1" }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("limita sessões em memória e rejeita limites inválidos", async () => {
    const service = criarServiceComLimite(2);
    const primeira = await service.recomendar(input);
    await service.recomendar(input);
    const terceira = await service.recomendar(input);
    await expect(service.substituirPapel(primeira.id, Papel.DIRETOR, {}))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(service.substituirPapel(terceira.id, Papel.DIRETOR, {})).resolves.toMatchObject({ id: terceira.id });
    expect(() => criarServiceComLimite(0)).toThrow("limite de sessões");
  });
});