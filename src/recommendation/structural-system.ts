import { Equipe, MembroEquipe, Projeto } from "../domain/entities";
import { AdaptadorArmazenamento } from "../adapters/storage";
import { AdaptadorPagamento } from "../adapters/payment";
import { AdaptadorProfissional } from "../adapters/professional";
import { RecomendacaoStrategy } from "./strategies";
import { ResultadoRanking } from "./decorators";
import { ProjetoInvalido } from "../visitors/family-validators";

export class SistemaRecomendacao {
  constructor(
    private adaptadorArmazenamento: AdaptadorArmazenamento,
    private adaptadorPagamento: AdaptadorPagamento,
    private adaptadorProfissional: AdaptadorProfissional,
    private estrategiaAtual: RecomendacaoStrategy
  ) {}

  definirEstrategia(estrategia: RecomendacaoStrategy): void {
    this.estrategiaAtual = estrategia;
  }

  configurarAdaptadores(
    armazenamento: AdaptadorArmazenamento,
    pagamento: AdaptadorPagamento,
    profissional: AdaptadorProfissional
  ): void {
    this.adaptadorArmazenamento = armazenamento;
    this.adaptadorPagamento = pagamento;
    this.adaptadorProfissional = profissional;
  }

  recomendar(projeto: Projeto): ResultadoRanking {
    const validador = projeto.criarValidador();
    if (!validador.visitarProjeto(projeto)) {
      throw new ProjetoInvalido(validador.diagnosticarProjeto?.(projeto).join("; ") ?? "Projeto inválido");
    }
    const profissionais = this.adaptadorProfissional.listarProfissionais({ prazo: projeto.prazo })
      .filter((profissional) => validador.visitarProfissional(profissional));
    return this.estrategiaAtual.recomendar(projeto, profissionais);
  }

  executarRecomendacao(projeto: Projeto): Equipe {
    const ranking = this.recomendar(projeto);
    const usados = new Set<string>();
    const membros: MembroEquipe[] = [];
    for (const papel of projeto.servicoPrincipal.obterPapeis()) {
      const profissional = ranking.get(papel)?.find((p) => !usados.has(p.id));
      if (profissional) {
        membros.push(new MembroEquipe(papel, profissional));
        usados.add(profissional.id);
      }
    }
    return new Equipe(membros);
  }

  salvarArquivo(conteudo: Buffer, metadados: Record<string, string> = {}): string {
    return this.adaptadorArmazenamento.salvarArquivo(conteudo, metadados);
  }

  recuperarArquivo(id: string): Buffer {
    return this.adaptadorArmazenamento.recuperarArquivo(id);
  }

  listarArquivos(prefixo = ""): string[] {
    return this.adaptadorArmazenamento.listarArquivos(prefixo);
  }

  efetuarPagamento(valor: number, origem: string, destino: string): string {
    return this.adaptadorPagamento.efetuarPagamento(valor, origem, destino);
  }

  cancelarPagamento(id: string): boolean {
    return this.adaptadorPagamento.cancelarPagamento(id);
  }

  verificarPagamento(id: string): string {
    return this.adaptadorPagamento.verificarPagamento(id);
  }
}
