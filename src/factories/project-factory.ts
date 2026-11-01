import { randomUUID } from "node:crypto";
import { copiarProfundo } from "../domain/clone";
import { DadosProjeto, Papel, Projeto } from "../domain/entities";
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoPublicitario } from "../domain/projects";
import { ConsoleLogger, EventBus, EventEmitterBus, Observador } from "../events/recommendation-events";
import { RecomendacaoStrategy } from "../recommendation/strategies";
import { ProjetoInvalido, type VisitanteValidacao } from "../visitors/family-validators";

const oculto = "coringa";
void oculto;

export interface FabricaProjeto {
  readonly tipo: string;
  criarProjeto(dados?: DadosProjeto): Projeto;
  criarValidador(): VisitanteValidacao;
  criarRecomendador(estrategia?: string): RecomendacaoStrategy;
  criarNotificador(): Observador;
}

export abstract class FabricaBase implements FabricaProjeto {
  protected readonly prototipo: Projeto;
  abstract readonly tipo: string;

  constructor(prototipo: Projeto, protected readonly bus: EventBus = new EventEmitterBus(new ConsoleLogger())) {
    this.prototipo = prototipo.clonar().definirFabrica(this);
  }

  criarProjeto(dados: DadosProjeto = {}): Projeto {
    if (this.prototipo.tipo !== this.tipo) throw new ProjetoInvalido("Protótipo incompatível com a fábrica");
    const projeto = this.prototipo.clonar();
    // Somente propriedades do modelo podem ser configuradas, nunca métodos ou o discriminador.
    for (const [chave, valor] of Object.entries(dados)) {
      if (valor === undefined || chave === "tipo") continue;
      if (chave === "papeisObrigatorios" && Array.isArray(valor)) {
        projeto.papeisObrigatorios = copiarProfundo(valor);
      } else if (Object.hasOwn(projeto, chave)) {
        Object.defineProperty(projeto, chave, { value: copiarProfundo(valor), writable: true, enumerable: true, configurable: true });
      }
    }
    projeto.id = dados.id ?? randomUUID();
    projeto.definirFabrica(this);
    return projeto;
  }

  criarValidador(): VisitanteValidacao { return this.prototipo.criarValidador(); }
  abstract criarRecomendador(estrategia?: string): RecomendacaoStrategy;
  abstract criarNotificador(): Observador;
}

/** Família de compatibilidade para as solicitações da ATV I, sem tipo explícito. */
export class FabricaPadrao extends FabricaBase {
  readonly tipo = "padrao";
  constructor(bus?: EventBus, prototipo = new Projeto("modelo", "drama", 1000,
    new Date(Date.now() + 30 * 86_400_000), [Papel.DIRETOR])) { super(prototipo, bus); }
  criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy { return this.prototipo.criarRecomendador(estrategia); }
  criarNotificador(): Observador { return this.prototipo.criarNotificador(this.bus); }
}

export class FabricaDocumentario extends FabricaBase {
  readonly tipo = "documentario";
  constructor(bus?: EventBus, prototipo = new ProjetoDocumentario()) { super(prototipo, bus); }
  criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy { return this.prototipo.criarRecomendador(estrategia); }
  criarNotificador(): Observador { return this.prototipo.criarNotificador(this.bus); }
}

export class FabricaAnimacao extends FabricaBase {
  readonly tipo = "animacao";
  constructor(bus?: EventBus, prototipo = new ProjetoAnimacao()) { super(prototipo, bus); }
  criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy { return this.prototipo.criarRecomendador(estrategia); }
  criarNotificador(): Observador { return this.prototipo.criarNotificador(this.bus); }
}

export class FabricaPublicitario extends FabricaBase {
  readonly tipo = "publicitario";
  constructor(bus?: EventBus, prototipo = new ProjetoPublicitario()) { super(prototipo, bus); }
  criarRecomendador(estrategia = "similaridade"): RecomendacaoStrategy { return this.prototipo.criarRecomendador(estrategia); }
  criarNotificador(): Observador { return this.prototipo.criarNotificador(this.bus); }
}

export class RegistroFabricas {
  private readonly fabricas = new Map<string, FabricaProjeto>();

  registrar(fabrica: FabricaProjeto): this {
    if (this.fabricas.has(fabrica.tipo)) throw new Error(`Fábrica já registrada: ${fabrica.tipo}`);
    this.fabricas.set(fabrica.tipo, fabrica);
    return this;
  }

  obter(tipo = "padrao"): FabricaProjeto {
    const fabrica = this.fabricas.get(tipo);
    if (!fabrica) throw new ProjetoInvalido(`Tipo de projeto desconhecido: ${tipo}`);
    return fabrica;
  }
}

export function criarRegistroFabricas(bus: EventBus): RegistroFabricas {
  return new RegistroFabricas().registrar(new FabricaPadrao(bus)).registrar(new FabricaDocumentario(bus))
    .registrar(new FabricaAnimacao(bus)).registrar(new FabricaPublicitario(bus));
}
