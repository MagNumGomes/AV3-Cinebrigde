import { FastifyInstance } from "fastify";
import { Competencia, Papel } from "../src/domain/entities";
import { EventEmitterBus, EventoRecomendacao, Logger } from "../src/events/recommendation-events";
import { criarApp } from "../src/http/app";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { profissional } from "./fixtures";

describe("famílias na API REST e entrega aos observers", () => {
  let app: FastifyInstance;
  let eventos: EventoRecomendacao[];
  const base = { genero: "drama", orcamento: 1000, prazo: "2030-06-01", papeisObrigatorios: [Papel.DIRETOR] };

  beforeEach(async () => {
    eventos = [];
    const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const bus = new EventEmitterBus(logger);
    bus.inscrever({ atualizar: (evento) => { eventos.push(evento); } });
    app = criarApp(new InMemoryProfessionalRepository([
      profissional("doc", Papel.DIRETOR, { competencias: [new Competencia("pesquisa"), new Competencia("entrevista")] }),
      profissional("ani", Papel.DIRETOR, { competencias: [new Competencia("modelagem 3d"), new Competencia("animacao")] }),
      profissional("pub", Papel.DIRETOR, { competencias: [new Competencia("publicidade"), new Competencia("branding")] })
    ]), bus, "similaridade");
    await app.ready();
  });
  afterEach(async () => app.close());

  it("alterna as três fábricas em requisições concorrentes sem misturar os produtos", async () => {
    const casos = [
      { tipo: "documentario", tema: "Cinema independente", entrevistados: ["Ana"] },
      { tipo: "animacao", software: "Maya", quadrosPorSegundo: 30 },
      { tipo: "publicitario", cliente: "Estúdio", canais: ["digital", "tv"] }
    ];
    const respostas = await Promise.all(casos.map((caso) => app.inject({
      method: "POST", url: "/recommendations", payload: { ...base, ...caso, duracao: 10, restricoes: { diasProducao: 2 } }
    })));
    expect(respostas.map((resposta) => resposta.statusCode)).toEqual([201, 201, 201]);
    expect(respostas.map((resposta) => resposta.json().membros[0].profissional.id)).toEqual(["doc", "ani", "pub"]);
    respostas.forEach((resposta, indice) => {
      expect(resposta.json().projeto).toMatchObject({ ...casos[indice], duracao: 10, restricoes: { diasProducao: 2 } });
      expect(eventos.find((evento) => evento.recomendacaoId === resposta.json().id)).toMatchObject({
        tipoProjeto: casos[indice]!.tipo, profissionalId: resposta.json().membros[0].profissional.id,
        assunto: expect.any(String), mensagem: expect.any(String)
      });
    });
    expect(eventos).toHaveLength(3);
  });

  it.each([
    { tipo: "inexistente" }, { tipo: 1 }, { tipo: "" }, { tema: [] }, { entrevistados: [1] },
    { entrevistados: "Ana" }, { canais: null }, { canais: [""] }, { duracao: 0 }, { duracao: "10" },
    { quadrosPorSegundo: -1 }, { tipo: "animacao", quadrosPorSegundo: 1.5 },
    { tipo: "animacao", software: " " }, { tipo: "publicitario", cliente: "" },
    { tipo: "publicitario", canais: [] }, { restricoes: null }, { restricoes: [] },
    { restricoes: { diasProducao: 0 } }, { restricoes: { diasProducao: "2" } },
    { restricoes: { competenciasObrigatorias: "3d" } }, { restricoes: { competenciasObrigatorias: [1] } },
    { competencias: { pesquisa: -1 } }
  ])("rejeita configuração inválida com HTTP 400: %j", async (configuracao) => {
    const resposta = await app.inject({ method: "POST", url: "/recommendations", payload: { ...base, ...configuracao } });
    expect(resposta.statusCode).toBe(400);
    expect(eventos).toEqual([]);
  });

  it("preserva modelo e dados específicos pela rota de reavaliação", async () => {
    const inicial = await app.inject({ method: "POST", url: "/recommendations",
      payload: { ...base, tipo: "animacao", software: "Maya", quadrosPorSegundo: 60, duracao: 5 } });
    const id = inicial.json().id;
    const semMudanca = await app.inject({ method: "POST", url: `/recommendations/${id}/reassess`, payload: { project: base } });
    expect(semMudanca.statusCode).toBe(400);
    const resposta = await app.inject({ method: "POST", url: `/recommendations/${id}/reassess`,
      payload: { project: { ...base, orcamento: 2000 } } });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().projeto).toMatchObject({ tipo: "animacao", software: "Maya", quadrosPorSegundo: 60, duracao: 5 });
    expect(eventos.at(-1)?.tipoProjeto).toBe("animacao");
  });
});
