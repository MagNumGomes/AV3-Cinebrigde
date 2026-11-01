import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DadosProjeto, MembroSugerido, Papel, StatusConvite } from "../domain/entities";
import { EventBus } from "../events/recommendation-events";
import { ProfessionalRepository } from "../repositories/professional-repository";
import { InMemoryRecommendationPersistence, RecommendationPersistence } from "../repositories/recommendation-persistence";
import { OrquestradorPadrao, ResultadoOrquestracao } from "../team/orchestrator";
import { criarRegistroFabricas, RegistroFabricas } from "../factories/project-factory";

export interface ProjetoInput extends Omit<DadosProjeto, "prazo" | "id" | "equipe"> {
  tipo?: string;
  genero: string;
  orcamento: number;
  prazo: string;
  papeisObrigatorios: Papel[];
  competencias?: Record<string, number>;
}

export interface ResultadoRecomendacao extends ResultadoOrquestracao {
  id: string;
  criadaEm: string;
}

export class ApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export class RecommendationService {
  private readonly sessoes = new Map<string, ResultadoRecomendacao>();
  private readonly limiteSessoes: number;
  private readonly fabricas: RegistroFabricas;

  constructor(
    private readonly repository: ProfessionalRepository,
    eventBus: EventBus,
    private readonly estrategiaPadrao: string,
    private readonly persistence: RecommendationPersistence = new InMemoryRecommendationPersistence(),
    limiteSessoes = 10_000,
    fabricas: RegistroFabricas = criarRegistroFabricas(eventBus)
  ) {
    if (!Number.isInteger(limiteSessoes) || limiteSessoes < 1) {
      throw new Error("O limite de sessões deve ser um inteiro positivo");
    }
    this.limiteSessoes = limiteSessoes;
    this.fabricas = fabricas;
  }

  async recomendar(input: ProjetoInput, estrategiaNome = this.estrategiaPadrao): Promise<ResultadoRecomendacao> {
    const orquestrador = new OrquestradorPadrao(this.fabricas.obter(input.tipo), estrategiaNome);
    const { tipo: _tipo, ...dados } = input;
    const projeto = orquestrador.criarProjeto({ ...dados, prazo: new Date(input.prazo) });
    const profissionais = await this.repository.listarDisponiveis(projeto);
    const resultado = await orquestrador.montarEquipe(projeto, profissionais);
    const recomendacao: ResultadoRecomendacao = {
      ...resultado,
      id: randomUUID(),
      criadaEm: new Date().toISOString()
    };
    await this.persistence.salvar(recomendacao);
    this.salvarSessao(recomendacao);
    for (const membro of recomendacao.membros) await this.publicarEvento(recomendacao, membro, "profissional_recomendado", orquestrador);
    return recomendacao;
  }

  async substituirPapel(
    recomendacaoId: string,
    papel: Papel,
    opcoes: { rejeitadoId?: string; substitutoId?: string }
  ): Promise<ResultadoRecomendacao> {
    const atual = this.obterSessao(recomendacaoId);
    if (!atual.projeto.papeisObrigatorios.includes(papel)) {
      throw new ApiError(400, "O papel não faz parte do projeto");
    }
    const membroAtual = atual.membros.find((membro) => membro.papel === papel);
    const papeisFixos = atual.membros.filter((membro) => membro.papel !== papel);
    const profissionais = await this.repository.listarDisponiveis(atual.projeto);
    const fabrica = this.fabricas.obter(atual.projeto.tipo);
    const estrategia = fabrica.criarRecomendador(atual.estrategia);
    const excluidos = new Set([opcoes.rejeitadoId, membroAtual?.profissional.id].filter(
      (id): id is string => Boolean(id)
    ));

    if (opcoes.substitutoId) {
      const profissional = profissionais.find((item) => item.id === opcoes.substitutoId);
      if (!profissional || !profissional.papeis.includes(papel)) {
        throw new ApiError(400, "O substituto não está disponível para o papel solicitado");
      }
      if (papeisFixos.some((membro) => membro.profissional.id === profissional.id)) {
        throw new ApiError(400, "O profissional já ocupa outro papel na equipe");
      }
      excluidos.delete(profissional.id);
    }

    const orquestrador = new OrquestradorPadrao(fabrica, atual.estrategia);
    let resultado: ResultadoOrquestracao;
    if (opcoes.substitutoId) {
      const ranking = estrategia.pontuar(atual.projeto, papel, profissionais);
      const item = ranking.find((candidato) => candidato.profissional.id === opcoes.substitutoId);
      if (!item) throw new ApiError(400, "Não foi possível pontuar o substituto");
      resultado = await orquestrador.montarEquipe(atual.projeto, profissionais, {
        papeisAlvo: [],
        membrosFixos: [...papeisFixos, { papel, ...item }]
      });
    } else {
      resultado = await orquestrador.montarEquipe(atual.projeto, profissionais, {
        papeisAlvo: [papel],
        membrosFixos: papeisFixos,
        profissionaisExcluidos: [...excluidos]
      });
    }

    const novoMembro = resultado.membros.find((membro) => membro.papel === papel);
    if (novoMembro) {
      resultado.projeto.substituirMembro(papel, novoMembro.profissional);
    }

    const atualizada: ResultadoRecomendacao = {
      ...atual,
      projeto: resultado.projeto,
      membros: resultado.membros,
      parcial: resultado.membros.length < atual.projeto.papeisObrigatorios.length,
      criadaEm: new Date().toISOString()
    };
    await this.persistence.salvar(atualizada);
    this.salvarSessao(atualizada);
    if (novoMembro) await this.publicarEvento(atualizada, novoMembro, "profissional_recomendado", orquestrador);
    return atualizada;
  }

  async reavaliar(
    recomendacaoId: string,
    input: ProjetoInput,
    estrategiaNome?: string
  ): Promise<ResultadoRecomendacao> {
    const anterior = this.obterSessao(recomendacaoId);
    const tipo = input.tipo ?? anterior.projeto.tipo;
    const informados = Object.fromEntries(Object.entries(input).filter(([, valor]) => valor !== undefined)) as ProjetoInput;
    const dados = {
      ...(tipo === anterior.projeto.tipo ? anterior.projeto.dadosEspecificos() : {}),
      duracao: anterior.projeto.duracao,
      restricoes: anterior.projeto.restricoes,
      competencias: tipo === anterior.projeto.tipo ? anterior.projeto.competencias : undefined,
      ...informados,
      tipo
    };
    const prazoAnterior = anterior.projeto.prazo.getTime();
    const prazoNovo = new Date(input.prazo).getTime();
    const variacaoOrcamento = Math.abs(input.orcamento - anterior.projeto.orcamento)
      / Math.max(anterior.projeto.orcamento, 1);
    const variacaoPrazoDias = Math.abs(prazoNovo - prazoAnterior) / (1000 * 60 * 60 * 24);
    const papeisAlterados = input.papeisObrigatorios.some((papel) => !anterior.projeto.papeisObrigatorios.includes(papel))
      || anterior.projeto.papeisObrigatorios.some((papel) => !input.papeisObrigatorios.includes(papel));
    const configuracaoAlterada = tipo !== anterior.projeto.tipo || input.genero !== anterior.projeto.genero
      || !isDeepStrictEqual(dados.competencias, anterior.projeto.competencias)
      || dados.duracao !== anterior.projeto.duracao
      || !isDeepStrictEqual(dados.restricoes, anterior.projeto.restricoes)
      || Object.entries(anterior.projeto.dadosEspecificos()).some(([chave, valor]) =>
        !isDeepStrictEqual((dados as Record<string, unknown>)[chave], valor));
    if (variacaoOrcamento < 0.2 && variacaoPrazoDias < 7 && !papeisAlterados && !configuracaoAlterada) {
      throw new ApiError(400, "A alteração não atinge o limite para reavaliação completa");
    }
    return this.recomendar(dados, estrategiaNome ?? anterior.estrategia);
  }

  async responderConvite(
    recomendacaoId: string,
    papel: Papel,
    status: "ACEITO" | "RECUSADO"
  ): Promise<ResultadoRecomendacao> {
    const recomendacao = this.obterSessao(recomendacaoId);
    const membro = recomendacao.membros.find((item) => item.papel === papel);
    if (!membro) throw new ApiError(404, "Não há convite associado a este papel");
    if (status === "ACEITO") {
      recomendacao.projeto.aceitarRecomendacao(papel, membro.profissional);
    }
    await this.persistence.registrarConvite(
      recomendacao,
      papel,
      status === "ACEITO" ? StatusConvite.ACEITO : StatusConvite.RECUSADO
    );
    await this.publicarEvento(recomendacao, membro, status === "ACEITO" ? "convite_aceito" : "convite_recusado",
      new OrquestradorPadrao(this.fabricas.obter(recomendacao.projeto.tipo), recomendacao.estrategia));
    return recomendacao;
  }

  private obterSessao(id: string): ResultadoRecomendacao {
    const sessao = this.sessoes.get(id);
    if (!sessao) throw new ApiError(404, "Recomendação não encontrada");
    return sessao;
  }

  private salvarSessao(recomendacao: ResultadoRecomendacao): void {
    this.sessoes.delete(recomendacao.id);
    if (this.sessoes.size >= this.limiteSessoes) {
      const maisAntiga = this.sessoes.keys().next().value as string | undefined;
      if (maisAntiga !== undefined) this.sessoes.delete(maisAntiga);
    }
    this.sessoes.set(recomendacao.id, recomendacao);
  }

  private async publicarEvento(
    recomendacao: ResultadoRecomendacao,
    membro: MembroSugerido,
    tipo: "profissional_recomendado" | "convite_aceito" | "convite_recusado",
    orquestrador: OrquestradorPadrao
  ): Promise<void> {
    await orquestrador.notificar({
      tipo,
      projetoId: recomendacao.projeto.id,
      papel: membro.papel,
      profissionalId: membro.profissional.id,
      recomendacaoId: recomendacao.id,
      ocorridoEm: new Date().toISOString()
    });
  }
}

// Nome do enunciado, mantendo o contrato público da ATV I.
export { RecommendationService as SistemaRecomendacao };
