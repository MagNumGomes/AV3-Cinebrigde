import { Papel } from "./entities";

export interface ServicoProjeto {
  calcularCusto(): number;
  listarSubservicos(): ServicoProjeto[];
  obterPrazo(): number;
  validar(): boolean;
  obterPapeis(): Papel[];
}

export class ServicoAtomico implements ServicoProjeto {
  constructor(readonly nome: string, readonly custo: number, readonly prazo: number,
    readonly papel: Papel, readonly disponivel = true) {}
  calcularCusto(): number { return this.custo; }
  listarSubservicos(): ServicoProjeto[] { return []; }
  obterPrazo(): number { return this.prazo; }
  obterPapeis(): Papel[] { return [this.papel]; }
  validar(): boolean {
    return Boolean(this.nome.trim()) && Number.isFinite(this.custo) && this.custo >= 0
      && Number.isInteger(this.prazo) && this.prazo > 0
      && Object.values(Papel).includes(this.papel) && this.disponivel;
  }
}

/** Prazo em dias: sequência soma durações; paralelo usa a maior duração. */
export class PacoteServico implements ServicoProjeto {
  private readonly servicos: ServicoProjeto[] = [];
  constructor(readonly nome: string, servicos: ServicoProjeto[] = [],
    readonly execucao: "sequencial" | "paralela" = "sequencial") {
    for (const servico of servicos) this.adicionar(servico);
  }
  adicionar(servico: ServicoProjeto): void {
    const visitar = (no: ServicoProjeto, caminho: Set<ServicoProjeto>): void => {
      if (no === this || caminho.has(no)) throw new Error("Ciclo na hierarquia de serviços");
      const novo = new Set(caminho).add(no);
      for (const filho of no.listarSubservicos()) visitar(filho, novo);
    };
    visitar(servico, new Set());
    this.servicos.push(servico);
  }
  remover(servico: ServicoProjeto): void {
    const indice = this.servicos.indexOf(servico);
    if (indice >= 0) this.servicos.splice(indice, 1);
  }
  listarSubservicos(): ServicoProjeto[] { return [...this.servicos]; }
  calcularCusto(): number {
    return this.servicos.reduce((total, servico) => total + Math.round(servico.calcularCusto() * 100), 0) / 100;
  }
  obterPrazo(): number {
    const prazos = this.servicos.map((servico) => servico.obterPrazo());
    return this.execucao === "paralela" ? Math.max(0, ...prazos) : prazos.reduce((a, b) => a + b, 0);
  }
  obterPapeis(): Papel[] { return [...new Set(this.servicos.flatMap((servico) => servico.obterPapeis()))]; }
  validar(): boolean {
    return Boolean(this.nome.trim()) && ["sequencial", "paralela"].includes(this.execucao)
      && this.servicos.length > 0 && this.servicos.every((servico) => servico.validar());
  }
}

/** Desserialização explícita: JSON nunca é tratado como instância de domínio. */
export function lerServico(valor: unknown, profundidade = 0): ServicoProjeto {
  if (profundidade > 50 || !valor || typeof valor !== "object") throw new Error("Serviço inválido ou hierarquia muito profunda");
  const dado = valor as Record<string, unknown>;
  if (typeof dado.nome !== "string") throw new Error("Nome de serviço obrigatório");
  let servico: ServicoProjeto;
  if (dado.tipo === "pacote" && Array.isArray(dado.servicos)) {
    if (dado.execucao !== undefined && dado.execucao !== "sequencial" && dado.execucao !== "paralela") throw new Error("Execução inválida");
    servico = new PacoteServico(dado.nome, dado.servicos.map((filho) => lerServico(filho, profundidade + 1)), dado.execucao);
  } else if (dado.tipo === "atomico" && typeof dado.custo === "number" && typeof dado.prazo === "number"
    && typeof dado.papel === "string" && (dado.disponivel === undefined || typeof dado.disponivel === "boolean")) {
    servico = new ServicoAtomico(dado.nome, dado.custo, dado.prazo, dado.papel as Papel, dado.disponivel);
  } else throw new Error("Formato de serviço inválido");
  if (!servico.validar()) throw new Error("Serviço indisponível ou dados inválidos");
  return servico;
}
