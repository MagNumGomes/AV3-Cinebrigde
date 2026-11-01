import { Papel, Projeto, Profissional, PontuacaoProfissional } from "../domain/entities";

export interface RecomendacaoStrategy {
  readonly nome: string;
  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[];
  recomendar(projeto: Projeto, profissionais: Profissional[]): Map<Papel, Profissional[]>;
}

function candidatosDoPapel(papel: Papel, profissionais: Profissional[]): Profissional[] {
  return profissionais.filter((profissional) => profissional.papeis.includes(papel));
}

function mediaAvaliacao(profissional: Profissional): number {
  if (profissional.avaliacoes.length === 0) return 3;
  return profissional.avaliacoes.reduce((total, avaliacao) => total + avaliacao.nota, 0)
    / profissional.avaliacoes.length;
}

function similaridadeCosseno(projeto: Projeto, profissional: Profissional): number {
  const chaves = new Set([
    ...Object.keys(projeto.competencias),
    ...profissional.competencias.map((competencia) => competencia.nome)
  ]);
  if (chaves.size === 0) return 0;

  let produto = 0;
  let normaProjeto = 0;
  let normaProfissional = 0;
  for (const chave of chaves) {
    const valorProjeto = projeto.competencias[chave] ?? 0;
    const valorProfissional = profissional.competencias
      .find((competencia) => competencia.nome === chave)?.peso ?? 0;
    produto += valorProjeto * valorProfissional;
    normaProjeto += valorProjeto ** 2;
    normaProfissional += valorProfissional ** 2;
  }
  if (normaProjeto === 0 || normaProfissional === 0) return 0;
  return produto / (Math.sqrt(normaProjeto) * Math.sqrt(normaProfissional));
}

export function recomendarPorPapeis(
  estrategia: Pick<RecomendacaoStrategy, "pontuar">,
  projeto: Projeto,
  profissionais: Profissional[]
): Map<Papel, Profissional[]> {
  const mapa = new Map<Papel, Profissional[]>();
  const papeis = projeto.papeisObrigatorios.length > 0 ? projeto.papeisObrigatorios : Object.values(Papel);
  for (const papel of papeis) {
    mapa.set(
      papel,
      estrategia.pontuar(projeto, papel, profissionais).map((item) => item.profissional)
    );
  }
  return mapa;
}

export class SimilaridadeCosseno implements RecomendacaoStrategy {
  readonly nome = "similaridade";

  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[] {
    return candidatosDoPapel(papel, profissionais)
      .map((profissional) => {
        const fit = similaridadeCosseno(projeto, profissional);
        const genero = profissional.generos.includes(projeto.genero) ? 1 : 0;
        const avaliacao = mediaAvaliacao(profissional) / 5;
        return {
          profissional,
          pontuacao: fit * 0.7 + genero * 0.2 + avaliacao * 0.1,
          motivo: `Similaridade de competências ${fit.toFixed(2)} e aderência ao gênero ${genero ? "compatível" : "neutra"}`
        };
      })
      .sort((a, b) => b.pontuacao - a.pontuacao || a.profissional.id.localeCompare(b.profissional.id));
  }

  recomendar(projeto: Projeto, profissionais: Profissional[]): Map<Papel, Profissional[]> {
    return recomendarPorPapeis(this, projeto, profissionais);
  }
}

export class RecomendadorBase extends SimilaridadeCosseno {}

export class FiltragemColaborativa implements RecomendacaoStrategy {
  readonly nome = "colaborativa";

  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[] {
    return candidatosDoPapel(papel, profissionais)
      .map((profissional) => {
        const avaliacoesGenero = profissional.avaliacoes.filter(
          (avaliacao) => avaliacao.generoProjeto === projeto.genero
        );
        const notaHistorica = avaliacoesGenero.length > 0
          ? avaliacoesGenero.reduce((total, avaliacao) => total + avaliacao.nota, 0) / avaliacoesGenero.length
          : mediaAvaliacao(profissional);
        const compatibilidade = profissional.generos.includes(projeto.genero) ? 1 : 0;
        return {
          profissional,
          pontuacao: (notaHistorica / 5) * 0.8 + compatibilidade * 0.2,
          motivo: `Histórico de avaliações no gênero ${projeto.genero}: ${notaHistorica.toFixed(1)}/5`
        };
      })
      .sort((a, b) => b.pontuacao - a.pontuacao || a.profissional.id.localeCompare(b.profissional.id));
  }

  recomendar(projeto: Projeto, profissionais: Profissional[]): Map<Papel, Profissional[]> {
    return recomendarPorPapeis(this, projeto, profissionais);
  }
}

export class RegrasOrcamento implements RecomendacaoStrategy {
  readonly nome = "orcamento";

  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[] {
    const quantidadePapeis = Math.max(projeto.papeisObrigatorios.length, 1);
    const verbaPorPapel = projeto.orcamento / quantidadePapeis;
    return candidatosDoPapel(papel, profissionais)
      .filter((profissional) => profissional.valorDiaria <= verbaPorPapel)
      .map((profissional) => {
        const eficiencia = 1 - profissional.valorDiaria / Math.max(verbaPorPapel, 1);
        const avaliacao = mediaAvaliacao(profissional) / 5;
        return {
          profissional,
          pontuacao: eficiencia * 0.65 + avaliacao * 0.35,
          motivo: `Compatível com a verba estimada de ${verbaPorPapel.toFixed(2)} por papel`
        };
      })
      .sort((a, b) => b.pontuacao - a.pontuacao || a.profissional.id.localeCompare(b.profissional.id));
  }

  recomendar(projeto: Projeto, profissionais: Profissional[]): Map<Papel, Profissional[]> {
    return recomendarPorPapeis(this, projeto, profissionais);
  }
}

export function criarEstrategia(nome: string): RecomendacaoStrategy {
  switch (nome) {
    case "similaridade": return new SimilaridadeCosseno();
    case "colaborativa": return new FiltragemColaborativa();
    case "orcamento": return new RegrasOrcamento();
    default: throw new Error(`Estratégia desconhecida: ${nome}`);
  }
}
