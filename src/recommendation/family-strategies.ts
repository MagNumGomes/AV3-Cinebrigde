import { Papel, PontuacaoProfissional, Profissional, Projeto } from "../domain/entities";
import { RecomendacaoStrategy, recomendarPorPapeis } from "./strategies";

abstract class RecomendadorFamilia implements RecomendacaoStrategy {
  constructor(private readonly base: RecomendacaoStrategy, private readonly prioridades: string[]) {}
  get nome(): string { return this.base.nome; }

  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[] {
    const dias = projeto.restricoes.diasProducao ?? 1;
    const verba = projeto.orcamento / Math.max(new Set(projeto.papeisObrigatorios).size, 1);
    const elegiveis = profissionais.filter((profissional) => {
      const competencias = new Set(profissional.competencias.filter((item) => item.peso > 0)
        .map((item) => item.nome.trim().toLowerCase()));
      return profissional.valorDiaria * dias <= verba
        && (projeto.restricoes.competenciasObrigatorias ?? []).every((nome) => competencias.has(nome.trim().toLowerCase()));
    });
    return this.base.pontuar(projeto, papel, elegiveis).map((item) => {
      const competencias = new Set(item.profissional.competencias.filter((competencia) => competencia.peso > 0)
        .map((competencia) => competencia.nome.trim().toLowerCase()));
      const aderencia = this.prioridades.filter((nome) => competencias.has(nome)).length / this.prioridades.length;
      return {
        ...item,
        pontuacao: item.pontuacao * 0.6 + aderencia * 0.4,
        motivo: `${item.motivo}; especialização ${projeto.tipo}: ${aderencia.toFixed(2)}`
      };
    }).sort((a, b) => b.pontuacao - a.pontuacao || a.profissional.id.localeCompare(b.profissional.id));
  }

  recomendar(projeto: Projeto, profissionais: Profissional[]): Map<Papel, Profissional[]> {
    return recomendarPorPapeis(this, projeto, profissionais);
  }
}

export class RecomendadorDocumentario extends RecomendadorFamilia {
  constructor(base: RecomendacaoStrategy) { super(base, ["pesquisa", "entrevista"]); }
}
export class RecomendadorAnimacao extends RecomendadorFamilia {
  constructor(base: RecomendacaoStrategy) { super(base, ["modelagem 3d", "animacao"]); }
}
export class RecomendadorPublicitario extends RecomendadorFamilia {
  constructor(base: RecomendacaoStrategy) { super(base, ["publicidade", "branding"]); }
}
