import { copiarProfundo } from "./clone";
import { PacoteServico, ServicoAtomico, type ServicoProjeto } from "./services";
import { ValidadorProjeto, type VisitanteValidacao } from "../visitors/family-validators";
import { GeradorRelatorio, type VisitanteProjeto } from "../visitors/project-visitors";
import { criarEstrategia, type RecomendacaoStrategy } from "../recommendation/strategies";
import { ConsoleLogger, EventEmitterBus, type EventBus, type Observador } from "../events/recommendation-events";
import { NotificadorProjeto } from "../events/family-notifiers";
import type { FabricaProjeto } from "../factories/project-factory";

export enum Papel {
  DIRETOR = "DIRETOR",
  DIRETOR_FOTOGRAFIA = "DIRETOR_FOTOGRAFIA",
  SONOPLASTA = "SONOPLASTA",
  EDITOR = "EDITOR",
  ROTEIRISTA = "ROTEIRISTA",
  EFETOS_VISUAIS = "EFETOS_VISUAIS"
}

export enum StatusConvite {
  PENDENTE = "PENDENTE",
  ACEITO = "ACEITO",
  RECUSADO = "RECUSADO"
}

export class Competencia {
  constructor(readonly nome: string, readonly peso = 1) {}
}

export class Avaliacao {
  constructor(
    readonly nota: number,
    readonly generoProjeto: string,
    readonly comentario?: string
  ) {}
}

export class Profissional {
  constructor(
    readonly id: string,
    readonly nome: string,
    readonly email: string,
    readonly papeis: Papel[],
    readonly generos: string[],
    readonly competencias: Competencia[],
    readonly avaliacoes: Avaliacao[],
    readonly valorDiaria: number,
    readonly disponivelAte?: Date
  ) {}
}

export class MembroEquipe {
  constructor(readonly papel: Papel, readonly profissional: Profissional) {}
}

export class Equipe {
  constructor(readonly membros: MembroEquipe[]) {}
}

function paraServico(entrada: ServicoProjeto | Papel[]): ServicoProjeto {
  if (Array.isArray(entrada)) {
    return new PacoteServico("Serviços do projeto", entrada.map((papel, idx) => new ServicoAtomico(`Serviço ${idx + 1} (${papel})`, 0, 1, papel)));
  }
  return entrada;
}

const fabricasPorProjeto = new WeakMap<Projeto, FabricaProjeto>();

export class Projeto {
  readonly tipo: string = "padrao";
  public servicoPrincipal: ServicoProjeto;

  constructor(
    public id: string,
    public genero: string,
    public orcamento: number,
    public prazo: Date,
    servicoOuPapeis: ServicoProjeto | Papel[],
    public competencias: Record<string, number> = {},
    public equipe?: Equipe,
    public duracao = 1,
    public restricoes: RestricoesProjeto = {}
  ) {
    this.servicoPrincipal = paraServico(servicoOuPapeis);
  }

  get papeisObrigatorios(): Papel[] {
    return this.servicoPrincipal.obterPapeis();
  }

  set papeisObrigatorios(papeis: Papel[]) {
    this.servicoPrincipal = paraServico(papeis);
  }

  calcularCustoTotal(): number {
    return this.servicoPrincipal.calcularCusto();
  }

  aceitarRecomendacao(papel: Papel, profissional: Profissional): Equipe {
    const atuais = (this.equipe?.membros ?? []).filter(
      (membro) => membro.papel === papel || membro.profissional.id !== profissional.id
    );
    const indice = atuais.findIndex((membro) => membro.papel === papel);
    const novoMembro = new MembroEquipe(papel, profissional);
    const membros = indice >= 0
      ? atuais.map((membro, idx) => (idx === indice ? novoMembro : membro))
      : [...atuais, novoMembro];
    this.equipe = new Equipe(membros);
    return this.equipe;
  }

  substituirMembro(papel: Papel, profissional: Profissional): Equipe {
    return this.aceitarRecomendacao(papel, profissional);
  }

  solicitarReavaliacao(): this {
    this.equipe = undefined;
    return this;
  }

  definirFabrica(fabrica?: FabricaProjeto): this {
    if (fabrica) fabricasPorProjeto.set(this, fabrica);
    else fabricasPorProjeto.delete(this);
    return this;
  }

  obterFabrica(): FabricaProjeto | undefined {
    return fabricasPorProjeto.get(this);
  }

  clonar(): this {
    const copia = copiarProfundo(this);
    const fabrica = fabricasPorProjeto.get(this);
    if (fabrica) fabricasPorProjeto.set(copia, fabrica);
    return copia;
  }

  // Factory Methods: subclasses definem como seus componentes especializados são fabricados.
  criarValidador(): VisitanteValidacao { return new ValidadorProjeto(); }
  criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy { return criarEstrategia(estrategia); }
  criarNotificador(bus: EventBus = new EventEmitterBus(new ConsoleLogger())): Observador { return new NotificadorProjeto(bus); }
  criarGeradorRelatorio(): GeradorRelatorio { return new GeradorRelatorio(); }

  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProjeto(this); }

  dadosEspecificos(): Record<string, unknown> { return {}; }
}

export interface RestricoesProjeto {
  diasProducao?: number;
  competenciasObrigatorias?: string[];
}

export interface DadosProjeto {
  id?: string;
  genero?: string;
  orcamento?: number;
  prazo?: Date;
  servicoPrincipal?: ServicoProjeto;
  papeisObrigatorios?: Papel[];
  competencias?: Record<string, number>;
  equipe?: Equipe;
  duracao?: number;
  restricoes?: RestricoesProjeto;
  tema?: string;
  entrevistados?: string[];
  software?: string;
  quadrosPorSegundo?: number;
  cliente?: string;
  canais?: string[];
}

export class Recomendacao {
  constructor(
    readonly id: string,
    readonly projetoId: string,
    readonly papel: Papel,
    readonly profissional: Profissional,
    readonly pontuacao: number,
    readonly motivo: string
  ) {}
}

export class Convite {
  constructor(
    readonly id: string,
    readonly projetoId: string,
    readonly profissionalId: string,
    readonly status: StatusConvite
  ) {}
}

export interface PontuacaoProfissional {
  profissional: Profissional;
  pontuacao: number;
  motivo: string;
}

export interface MembroSugerido extends PontuacaoProfissional {
  papel: Papel;
}
