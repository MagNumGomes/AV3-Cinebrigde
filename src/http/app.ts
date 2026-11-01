import Fastify, { FastifyInstance } from "fastify";
import { Papel } from "../domain/entities";
import { EventBus } from "../events/recommendation-events";
import { ProfessionalRepository } from "../repositories/professional-repository";
import { ApiError, ProjetoInput, RecommendationService } from "../recommendation/recommendation-service";
import { criarEstrategia } from "../recommendation/strategies";
import { InMemoryRecommendationPersistence, RecommendationPersistence } from "../repositories/recommendation-persistence";
import { ProjetoInvalido } from "../visitors/family-validators";
import { RegistroFabricas } from "../factories/project-factory";
import { registrarRotasEstruturais } from "./structural-routes";

const papeisValidos = new Set<string>(Object.values(Papel));

function validarProjeto(body: unknown): ProjetoInput {
  if (typeof body !== "object" || body === null) throw new ApiError(400, "Corpo da requisição inválido");
  const dado = body as Record<string, unknown>;
  if (typeof dado.genero !== "string" || dado.genero.trim().length === 0) {
    throw new ApiError(400, "Gênero é obrigatório");
  }
  if (typeof dado.orcamento !== "number" || !Number.isFinite(dado.orcamento) || dado.orcamento <= 0) {
    throw new ApiError(400, "Orçamento deve ser um número positivo");
  }
  if (typeof dado.prazo !== "string" || !Number.isFinite(new Date(dado.prazo).getTime())) {
    throw new ApiError(400, "Prazo deve ser uma data válida");
  }
  if (!Array.isArray(dado.papeisObrigatorios) || dado.papeisObrigatorios.length === 0
    || !dado.papeisObrigatorios.every((papel) => typeof papel === "string" && papeisValidos.has(papel))) {
    throw new ApiError(400, "Informe papéis obrigatórios válidos");
  }
  if (dado.competencias !== undefined && (typeof dado.competencias !== "object" || dado.competencias === null
    || Array.isArray(dado.competencias)
    || !Object.values(dado.competencias).every((peso) => typeof peso === "number" && Number.isFinite(peso)))) {
    throw new ApiError(400, "Competências devem mapear nomes para pesos numéricos");
  }
  for (const campo of ["tipo", "tema", "software", "cliente"] as const) {
    if (dado[campo] !== undefined && (typeof dado[campo] !== "string" || !dado[campo].trim())) {
      throw new ApiError(400, `${campo} deve ser um texto não vazio`);
    }
  }
  for (const campo of ["entrevistados", "canais"] as const) {
    if (dado[campo] !== undefined && (!Array.isArray(dado[campo])
      || !dado[campo].every((item: unknown) => typeof item === "string" && item.trim().length > 0))) {
      throw new ApiError(400, `${campo} deve ser uma lista de textos não vazios`);
    }
  }
  for (const campo of ["duracao", "quadrosPorSegundo"] as const) {
    if (dado[campo] !== undefined && (typeof dado[campo] !== "number" || !Number.isFinite(dado[campo]) || dado[campo] <= 0)) {
      throw new ApiError(400, `${campo} deve ser um número positivo`);
    }
  }
  if (dado.restricoes !== undefined) {
    if (typeof dado.restricoes !== "object" || dado.restricoes === null || Array.isArray(dado.restricoes)) {
      throw new ApiError(400, "Restrições devem ser um objeto");
    }
    const restricoes = dado.restricoes as Record<string, unknown>;
    if (restricoes.diasProducao !== undefined && (typeof restricoes.diasProducao !== "number"
      || !Number.isInteger(restricoes.diasProducao) || restricoes.diasProducao < 1)) {
      throw new ApiError(400, "Dias de produção devem ser um inteiro positivo");
    }
    if (restricoes.competenciasObrigatorias !== undefined && (!Array.isArray(restricoes.competenciasObrigatorias)
      || !restricoes.competenciasObrigatorias.every((nome: unknown) => typeof nome === "string" && nome.trim().length > 0))) {
      throw new ApiError(400, "Competências obrigatórias devem ser uma lista de textos");
    }
  }
  return {
    genero: dado.genero,
    orcamento: dado.orcamento,
    prazo: dado.prazo,
    papeisObrigatorios: dado.papeisObrigatorios as Papel[],
    competencias: dado.competencias as Record<string, number> | undefined,
    tipo: dado.tipo as string | undefined,
    duracao: dado.duracao as number | undefined,
    tema: dado.tema as string | undefined,
    entrevistados: dado.entrevistados as string[] | undefined,
    software: dado.software as string | undefined,
    quadrosPorSegundo: dado.quadrosPorSegundo as number | undefined,
    cliente: dado.cliente as string | undefined,
    canais: dado.canais as string[] | undefined,
    restricoes: dado.restricoes as ProjetoInput["restricoes"]
  };
}

export function criarApp(
  repository: ProfessionalRepository,
  eventBus: EventBus,
  estrategiaPadrao: string,
  persistence: RecommendationPersistence = new InMemoryRecommendationPersistence(),
  fabricas?: RegistroFabricas
): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const service = new RecommendationService(repository, eventBus, estrategiaPadrao, persistence, undefined, fabricas);

  app.setErrorHandler((erro, _request, reply) => {
    const statusHttp = erro instanceof Error && "statusCode" in erro ? erro.statusCode : undefined;
    const statusCode = erro instanceof ApiError ? erro.statusCode
      : erro instanceof ProjetoInvalido ? 400
      : typeof statusHttp === "number" && statusHttp >= 400 && statusHttp < 500 ? statusHttp : 500;
    if (statusCode >= 500) app.log.error(erro);
    const mensagem = erro instanceof Error ? erro.message : "Erro interno";
    reply.status(statusCode).send({ erro: statusCode === 500 ? "Erro interno" : mensagem });
  });

  app.get("/health", async () => ({ status: "ok" }));
  registrarRotasEstruturais(app);

  app.post("/recommendations", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projeto = validarProjeto(request.body);
    const strategy = body?.strategy;
    if (strategy !== undefined && typeof strategy !== "string") throw new ApiError(400, "strategy deve ser texto");
    if (typeof strategy === "string") {
      try { criarEstrategia(strategy); } catch { throw new ApiError(400, "Estratégia desconhecida"); }
    }
    const resultado = await service.recomendar(projeto, strategy as string | undefined);
    return reply.status(201).send(resultado);
  });

  app.post<{ Params: { recommendationId: string; papel: string } }>(
    "/recommendations/:recommendationId/roles/:papel/replacements",
    async (request) => {
      if (!papeisValidos.has(request.params.papel)) throw new ApiError(400, "Papel inválido");
      if (typeof request.body !== "object" || request.body === null) throw new ApiError(400, "Corpo da requisição inválido");
      const body = request.body as Record<string, unknown>;
      if (body.rejeitadoId !== undefined && typeof body.rejeitadoId !== "string") {
        throw new ApiError(400, "rejeitadoId deve ser texto");
      }
      if (body.substitutoId !== undefined && typeof body.substitutoId !== "string") {
        throw new ApiError(400, "substitutoId deve ser texto");
      }
      return service.substituirPapel(request.params.recommendationId, request.params.papel as Papel, {
        rejeitadoId: body.rejeitadoId as string | undefined,
        substitutoId: body.substitutoId as string | undefined
      });
    }
  );

  app.post<{ Params: { recommendationId: string } }>(
    "/recommendations/:recommendationId/reassess",
    async (request) => {
      const body = request.body as Record<string, unknown>;
      const projeto = validarProjeto(body?.project);
      const strategy = body?.strategy;
      if (strategy !== undefined && typeof strategy !== "string") throw new ApiError(400, "strategy deve ser texto");
      if (typeof strategy === "string") {
        try { criarEstrategia(strategy); } catch { throw new ApiError(400, "Estratégia desconhecida"); }
      }
      return service.reavaliar(request.params.recommendationId, projeto, strategy as string | undefined);
    }
  );

  app.post<{ Params: { recommendationId: string; papel: string } }>(
    "/recommendations/:recommendationId/invitations/:papel/respond",
    async (request) => {
      if (!papeisValidos.has(request.params.papel)) throw new ApiError(400, "Papel inválido");
      const body = request.body as Record<string, unknown>;
      if (body?.status !== "ACEITO" && body?.status !== "RECUSADO") {
        throw new ApiError(400, "status deve ser ACEITO ou RECUSADO");
      }
      return service.responderConvite(
        request.params.recommendationId,
        request.params.papel as Papel,
        body.status
      );
    }
  );

  return app;
}
