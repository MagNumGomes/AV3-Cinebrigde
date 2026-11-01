import { Equipe, MembroEquipe, MembroSugerido, Papel, Projeto, Profissional } from "../domain/entities";
import { FabricaProjeto } from "../factories/project-factory";
import { EventoRecomendacao, Observador } from "../events/recommendation-events";
import { RecomendacaoStrategy } from "../recommendation/strategies";
import { ProjetoInvalido, type VisitanteValidacao } from "../visitors/family-validators";

export interface OpcoesOrquestracao {
  papeisAlvo?: Papel[];
  membrosFixos?: MembroSugerido[];
  profissionaisExcluidos?: string[];
}

export interface ResultadoOrquestracao {
  projeto: Projeto;
  estrategia: string;
  membros: MembroSugerido[];
  parcial: boolean;
}

export abstract class OrquestradorEquipe {
  protected readonly estrategia: RecomendacaoStrategy;
  protected readonly validador: VisitanteValidacao;
  private readonly notificador: Observador;

  constructor(
    protected readonly fabrica: FabricaProjeto,
    estrategiaNome?: string,
    private readonly profissionais?: Profissional[]
  ) {
    this.estrategia = fabrica.criarRecomendador(estrategiaNome);
    this.validador = fabrica.criarValidador();
    this.notificador = fabrica.criarNotificador();
  }

  criarProjeto(dados: Parameters<FabricaProjeto["criarProjeto"]>[0]): Projeto {
    return this.fabrica.criarProjeto(dados);
  }

  async notificar(evento: EventoRecomendacao): Promise<void> {
    await this.notificador.atualizar(evento);
  }

  /** A assinatura de dois argumentos usa o catálogo injetado no construtor. */
  orquestrar(
    projeto: Projeto,
    estrategia: RecomendacaoStrategy = this.estrategia,
    profissionais: Profissional[] | undefined = this.profissionais
  ): Equipe {
    if (profissionais === undefined) throw new ProjetoInvalido("Informe o catálogo de profissionais no construtor ou na chamada de orquestrar");
    if (projeto.tipo !== this.fabrica.tipo) throw new ProjetoInvalido("Projeto incompatível com a fábrica");
    if (!this.validarRestricoes(projeto, profissionais)) throw new ProjetoInvalido("Projeto não atende às restrições");
    const resultadoNormalizacao = this.normalizarDados(projeto, profissionais);
    const projetoNormalizado = resultadoNormalizacao instanceof Projeto ? resultadoNormalizacao : this.normalizarProjetoBase(projeto);
    const profissionaisValidos = Array.isArray(resultadoNormalizacao)
      ? resultadoNormalizacao
      : this.filtrarProfissionaisValidos(projetoNormalizado, profissionais);
    const recomendacoes = estrategia.recomendar(projetoNormalizado, profissionaisValidos);
    const processadas = this.posProcessar(recomendacoes);
    const mapa = processadas instanceof Map ? processadas : recomendacoes;
    const idsUsados = new Set<string>();
    const membros: MembroEquipe[] = [];
    for (const papel of projetoNormalizado.papeisObrigatorios) {
      const candidatos = mapa.get(papel) ?? [];
      const escolhido = candidatos.find((candidato) => !idsUsados.has(candidato.id));
      if (!escolhido) continue;
      membros.push(new MembroEquipe(papel, escolhido));
      idsUsados.add(escolhido.id);
    }
    const equipe = new Equipe(membros);
    projeto.equipe = equipe;
    return equipe;
  }

  async montarEquipe(
    projeto: Projeto,
    profissionais: Profissional[],
    opcoes: OpcoesOrquestracao = {}
  ): Promise<ResultadoOrquestracao> {
    if (projeto.tipo !== this.fabrica.tipo) throw new ProjetoInvalido("Projeto incompatível com a fábrica");
    if (!this.validarRestricoes(projeto, profissionais)) throw new ProjetoInvalido("Projeto não atende às restrições");
    const normalizado = this.normalizarDados(projeto);
    const projetoNormalizado = normalizado instanceof Projeto ? normalizado : this.normalizarProjetoBase(projeto);
    const profissionaisValidos = this.filtrarProfissionaisValidos(projetoNormalizado, profissionais);
    const papeisAlvo = opcoes.papeisAlvo ?? projetoNormalizado.papeisObrigatorios;
    const membros = [...(opcoes.membrosFixos ?? [])];
    for (const membro of membros) {
      const elegivel = this.estrategia.pontuar(projetoNormalizado, membro.papel, profissionaisValidos)
        .some((item) => item.profissional.id === membro.profissional.id);
      if (!elegivel) throw new ProjetoInvalido("Membro fixo incompatível com as restrições do projeto");
    }
    const equipeFixa = new Equipe(membros.map((membro) => new MembroEquipe(membro.papel, membro.profissional)));
    if (this.validador.visitarEquipe?.(equipeFixa) === false) {
      const erros = this.validador.diagnosticarEquipe?.(equipeFixa);
      throw new ProjetoInvalido(erros?.length ? erros.join("; ") : "Equipe não atende às restrições");
    }
    const idsUsados = new Set(membros.map((membro) => membro.profissional.id));
    const excluidos = new Set(opcoes.profissionaisExcluidos ?? []);

    for (const papel of papeisAlvo) {
      const ranking = this.estrategia.pontuar(projetoNormalizado, papel, profissionaisValidos);
      const escolhido = ranking.find((item) => !idsUsados.has(item.profissional.id)
        && !excluidos.has(item.profissional.id));
      if (!escolhido) continue;
      membros.push({ papel, ...escolhido });
      idsUsados.add(escolhido.profissional.id);
    }

    const pos = this.posProcessar(projetoNormalizado, membros);
    const membrosPosProcessados = Array.isArray(pos) ? pos : membros;
    projetoNormalizado.equipe = new Equipe(membrosPosProcessados.map((membro) => new MembroEquipe(membro.papel, membro.profissional)));
    return {
      projeto: projetoNormalizado.clonar(),
      estrategia: this.estrategia.nome,
      membros: membrosPosProcessados,
      parcial: membrosPosProcessados.length < projetoNormalizado.papeisObrigatorios.length
    };
  }

  protected filtrarProfissionaisValidos(projeto: Projeto, profissionais: Profissional[]): Profissional[] {
    return profissionais.filter((profissional) => this.validador.visitarProfissional(profissional)
      && (!profissional.disponivelAte || profissional.disponivelAte >= projeto.prazo));
  }

  protected normalizarProjetoBase(projeto: Projeto): Projeto {
    const competencias = Object.fromEntries(
      Object.entries(projeto.competencias).map(([nome, peso]) => [nome.trim().toLowerCase(), peso])
    );
    const copia = projeto.clonar();
    copia.genero = projeto.genero.trim().toLowerCase();
    copia.competencias = competencias;
    return copia;
  }

  protected abstract validarRestricoes(projeto: Projeto, profissionais: Profissional[]): boolean;
  protected abstract normalizarDados(projeto: Projeto, profissionais?: Profissional[]): Projeto | Profissional[];
  protected abstract posProcessar(
    projetoOuRecomendacoes: Projeto | Map<Papel, Profissional[]>,
    membros?: MembroSugerido[]
  ): MembroSugerido[] | Map<Papel, Profissional[]>;
}

export class OrquestradorPadrao extends OrquestradorEquipe {
  protected validarRestricoes(projeto: Projeto): boolean {
    if (!projeto.aceitar(this.validador)) {
      const erros = this.validador.diagnosticarProjeto?.(projeto);
      throw new ProjetoInvalido(erros?.length ? erros.join("; ") : "Projeto não atende às restrições");
    }
    return true;
  }

  protected override normalizarDados(projeto: Projeto): Projeto;
  protected override normalizarDados(projeto: Projeto, profissionais: Profissional[]): Profissional[];
  protected override normalizarDados(projeto: Projeto, profissionais?: Profissional[]): Projeto | Profissional[] {
    const copia = this.normalizarProjetoBase(projeto);
    if (profissionais !== undefined) {
      return this.filtrarProfissionaisValidos(copia, profissionais);
    }
    return copia;
  }

  protected override posProcessar(recomendacoes: Map<Papel, Profissional[]>): Map<Papel, Profissional[]>;
  protected override posProcessar(projeto: Projeto, membros: MembroSugerido[]): MembroSugerido[];
  protected override posProcessar(
    projetoOuRecomendacoes: Projeto | Map<Papel, Profissional[]>,
    membros: MembroSugerido[] = []
  ): Map<Papel, Profissional[]> | MembroSugerido[] {
    if (projetoOuRecomendacoes instanceof Map) {
      const ordenado = new Map<Papel, Profissional[]>();
      const entradas = [...projetoOuRecomendacoes.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [papel, lista] of entradas) {
        ordenado.set(papel, [...lista]);
      }
      return ordenado;
    }
    return [...membros].sort((a, b) => a.papel.localeCompare(b.papel));
  }
}
