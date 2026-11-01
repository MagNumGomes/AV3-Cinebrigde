import { randomUUID } from "node:crypto";
import { DadosProjeto, Papel, Projeto } from "./entities";
import { ValidadorAnimacao, ValidadorDocumentario, ValidadorPublicitario } from "../visitors/family-validators";
import { GeradorRelatorioAnimacao } from "../visitors/project-visitors";
import { RecomendadorAnimacao, RecomendadorDocumentario, RecomendadorPublicitario } from "../recommendation/family-strategies";
import { criarEstrategia, type RecomendacaoStrategy } from "../recommendation/strategies";
import { NotificadorAnimacao, NotificadorDocumentario, NotificadorPublicitario } from "../events/family-notifiers";
import { ConsoleLogger, EventEmitterBus, type EventBus, type Observador } from "../events/recommendation-events";

/** Valores de modelo são exemplos configuráveis, não dados extraídos do diagrama. */
export abstract class ProjetoTipado extends Projeto {
  constructor(dados: DadosProjeto, genero: string, papeis: Papel[], competencias: Record<string, number>) {
    super(dados.id ?? randomUUID(), dados.genero ?? genero, dados.orcamento ?? 1000,
      dados.prazo ?? new Date(Date.now() + 30 * 86_400_000), dados.servicoPrincipal ?? dados.papeisObrigatorios ?? papeis,
      dados.competencias ?? competencias, dados.equipe, dados.duracao ?? 1, dados.restricoes ?? { diasProducao: 1 });
  }
}

export class ProjetoDocumentario extends ProjetoTipado {
  override readonly tipo: string = "documentario";
  tema: string;
  entrevistados: string[];

  constructor(dados: DadosProjeto = {}) {
    super(dados, "documentario", [Papel.DIRETOR, Papel.DIRETOR_FOTOGRAFIA, Papel.SONOPLASTA, Papel.EDITOR],
      { pesquisa: 1, entrevista: 1 });
    this.tema = dados.tema ?? "Tema a definir";
    this.entrevistados = dados.entrevistados ?? [];
  }

  override clonar(): this { return super.clonar(); }
  override criarValidador(): ValidadorDocumentario { return new ValidadorDocumentario(); }
  override criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy {
    return new RecomendadorDocumentario(criarEstrategia(estrategia));
  }
  override criarNotificador(bus: EventBus = new EventEmitterBus(new ConsoleLogger())): Observador {
    return new NotificadorDocumentario(bus);
  }
  override dadosEspecificos(): Record<string, unknown> { return { tema: this.tema, entrevistados: this.entrevistados }; }
}

export class ProjetoAnimacao extends ProjetoTipado {
  override readonly tipo: string = "animacao";
  software: string;
  quadrosPorSegundo: number;

  constructor(dados: DadosProjeto = {}) {
    super(dados, "animacao", [Papel.DIRETOR, Papel.ROTEIRISTA, Papel.EFETOS_VISUAIS, Papel.EDITOR],
      { "modelagem 3d": 1, animacao: 1 });
    this.software = dados.software ?? "Blender";
    this.quadrosPorSegundo = dados.quadrosPorSegundo ?? 24;
  }

  override clonar(): this { return super.clonar(); }
  override criarValidador(): ValidadorAnimacao { return new ValidadorAnimacao(); }
  override criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy {
    return new RecomendadorAnimacao(criarEstrategia(estrategia));
  }
  override criarNotificador(bus: EventBus = new EventEmitterBus(new ConsoleLogger())): Observador {
    return new NotificadorAnimacao(bus);
  }
  override criarGeradorRelatorio(): GeradorRelatorioAnimacao { return new GeradorRelatorioAnimacao(); }
  override dadosEspecificos(): Record<string, unknown> { return { software: this.software, quadrosPorSegundo: this.quadrosPorSegundo }; }
}

export class ProjetoPublicitario extends ProjetoTipado {
  override readonly tipo: string = "publicitario";
  cliente: string;
  canais: string[];

  constructor(dados: DadosProjeto = {}) {
    super(dados, "publicitario", [Papel.DIRETOR, Papel.ROTEIRISTA, Papel.EDITOR],
      { publicidade: 1, branding: 1 });
    this.cliente = dados.cliente ?? "Cliente a definir";
    this.canais = dados.canais ?? ["digital"];
  }

  override clonar(): this { return super.clonar(); }
  override criarValidador(): ValidadorPublicitario { return new ValidadorPublicitario(); }
  override criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy {
    return new RecomendadorPublicitario(criarEstrategia(estrategia));
  }
  override criarNotificador(bus: EventBus = new EventEmitterBus(new ConsoleLogger())): Observador {
    return new NotificadorPublicitario(bus);
  }
  override dadosEspecificos(): Record<string, unknown> { return { cliente: this.cliente, canais: this.canais }; }
}
