import { FastifyInstance } from "fastify";
import { Papel } from "../src/domain/entities";
import { EventBus, EventoRecomendacao } from "../src/events/recommendation-events";
import { criarApp } from "../src/http/app";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { profissional } from "./fixtures";

class EventBusIntegracao implements EventBus {
  readonly eventos: EventoRecomendacao[] = [];
  publicar(evento: EventoRecomendacao): void { this.eventos.push(evento); }
  inscrever(): () => void { return () => undefined; }
}

describe("API REST de recomendações", () => {
  let app: FastifyInstance;
  let bus: EventBusIntegracao;

  beforeEach(async () => {
    bus = new EventBusIntegracao();
    app = criarApp(new InMemoryProfessionalRepository([
      profissional("dir-1", Papel.DIRETOR),
      profissional("dir-2", Papel.DIRETOR, { nota: 3 }),
      profissional("edit-1", Papel.EDITOR),
      profissional("edit-2", Papel.EDITOR, { nota: 3 })
    ]), bus, "similaridade");
    await app.ready();
  });

  afterEach(async () => app.close());

  const requestBody = {
    genero: "drama",
    orcamento: 2000,
    prazo: "2030-06-01",
    papeisObrigatorios: [Papel.DIRETOR, Papel.EDITOR],
    competencias: { fotografia: 1 }
  };

  it("cria recomendação completa usando estratégia enviada dinamicamente", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/recommendations",
      payload: { ...requestBody, strategy: "colaborativa" }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ estrategia: "colaborativa", parcial: false });
    expect(response.json().membros).toHaveLength(2);
  });

  it("substitui somente o papel pedido e dispara resposta de convite", async () => {
    const criado = await app.inject({ method: "POST", url: "/recommendations", payload: requestBody });
    const inicial = criado.json();
    const editorInicial = inicial.membros.find((membro: { papel: Papel }) => membro.papel === Papel.EDITOR);
    const substituido = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/roles/${Papel.DIRETOR}/replacements`,
      payload: { rejeitadoId: "dir-1" }
    });
    expect(substituido.statusCode).toBe(200);
    expect(substituido.json().membros.find((membro: { papel: Papel }) => membro.papel === Papel.EDITOR).profissional.id)
      .toBe(editorInicial.profissional.id);
    const resposta = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/invitations/${Papel.DIRETOR}/respond`,
      payload: { status: "ACEITO" }
    });
    expect(resposta.statusCode).toBe(200);
    expect(bus.eventos.at(-1)?.tipo).toBe("convite_aceito");
  });

  it("exige mudança significativa para reavaliar e valida entrada", async () => {
    const criado = await app.inject({ method: "POST", url: "/recommendations", payload: requestBody });
    const inicial = criado.json();
    const invalido = await app.inject({ method: "POST", url: "/recommendations", payload: { ...requestBody, orcamento: -1 } });
    expect(invalido.statusCode).toBe(400);
    const reavaliacao = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/reassess`,
      payload: { project: { ...requestBody, orcamento: 2500 } }
    });
    expect(reavaliacao.statusCode).toBe(200);
    expect(reavaliacao.json().membros).toHaveLength(2);
  });

  it("responde à verificação de saúde e trata recomendação inexistente", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    const missing = await app.inject({
      method: "POST",
      url: "/recommendations/unknown/roles/DIRETOR/replacements",
      payload: {}
    });
    expect(missing.statusCode).toBe(404);
  });

  it.each([
    ["corpo nulo", null],
    ["gênero vazio", { ...requestBody, genero: " " }],
    ["orçamento em texto", { ...requestBody, orcamento: "alto" }],
    ["orçamento zero", { ...requestBody, orcamento: 0 }],
    ["prazo inválido", { ...requestBody, prazo: "ontem" }],
    ["prazo ausente", { genero: "drama", orcamento: 1000, papeisObrigatorios: [Papel.DIRETOR] }],
    ["papéis vazios", { ...requestBody, papeisObrigatorios: [] }],
    ["papel desconhecido", { ...requestBody, papeisObrigatorios: ["PRODUTOR"] }],
    ["competências nulas", { ...requestBody, competencias: null }],
    ["competências em array", { ...requestBody, competencias: ["fotografia"] }],
    ["peso de competência inválido", { ...requestBody, competencias: { fotografia: "alto" } }],
    ["estratégia não textual", { ...requestBody, strategy: 1 }],
    ["estratégia desconhecida", { ...requestBody, strategy: "aleatoria" }]
  ])("valida entrada: %s", async (_descricao, payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/recommendations",
      headers: { "content-type": "application/json" },
      payload: payload === null ? "null" : payload as never
    });
    expect(response.statusCode).toBe(400);
  });

  it("valida os dados de substituição e os papéis", async () => {
    const criado = await app.inject({ method: "POST", url: "/recommendations", payload: requestBody });
    const inicial = criado.json();
    const invalidRole = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/roles/PRODUTOR/replacements`,
      payload: {}
    });
    const invalidBody = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/roles/${Papel.DIRETOR}/replacements`,
      headers: { "content-type": "application/json" },
      payload: "null"
    });
    const invalidId = await app.inject({
      method: "POST",
      url: `/recommendations/${inicial.id}/roles/${Papel.DIRETOR}/replacements`,
      payload: { substitutoId: 10 }
    });
    expect([invalidRole.statusCode, invalidBody.statusCode, invalidId.statusCode]).toEqual([400, 400, 400]);
  });
});