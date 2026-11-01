import { Avaliacao, Competencia, Papel, Profissional, Projeto } from "../src/domain/entities";

export function profissional(
  id: string,
  papel: Papel,
  opcoes: { valorDiaria?: number; generos?: string[]; nota?: number; competencias?: Competencia[] } = {}
): Profissional {
  return new Profissional(
    id,
    `Profissional ${id}`,
    `${id}@cinebridge.test`,
    [papel],
    opcoes.generos ?? ["drama"],
    opcoes.competencias ?? [new Competencia("fotografia", 1)],
    [new Avaliacao(opcoes.nota ?? 4, "drama")],
    opcoes.valorDiaria ?? 100
  );
}

export function projeto(papeis: Papel[] = [Papel.DIRETOR]): Projeto {
  return new Projeto("projeto-1", "drama", 1000, new Date("2030-06-01"), papeis, { fotografia: 1 });
}