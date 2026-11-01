import { PrismaClient } from "@prisma/client";
import { Avaliacao, Competencia, Papel, Profissional, Projeto } from "../domain/entities";
import { Logger } from "../events/recommendation-events";

export interface ProfessionalRepository {
  listarDisponiveis(projeto: Projeto): Promise<Profissional[]>;
}

export class InMemoryProfessionalRepository implements ProfessionalRepository {
  constructor(private readonly profissionais: Profissional[]) {}

  async listarDisponiveis(_projeto: Projeto): Promise<Profissional[]> {
    return [...this.profissionais];
  }
}

export class CachedFallbackProfessionalRepository implements ProfessionalRepository {
  private ultimoCatalogo: Profissional[] | undefined;

  constructor(
    private readonly primary: ProfessionalRepository,
    private readonly fallback: ProfessionalRepository,
    private readonly logger: Logger
  ) {}

  async listarDisponiveis(projeto: Projeto): Promise<Profissional[]> {
    try {
      const profissionais = await this.primary.listarDisponiveis(projeto);
      this.ultimoCatalogo = profissionais;
      return [...profissionais];
    } catch (erro) {
      this.logger.warn({ erro: erro instanceof Error ? erro.message : String(erro) }, "Repositório indisponível; usando fallback");
      if (this.ultimoCatalogo) return [...this.ultimoCatalogo];
      return this.fallback.listarDisponiveis(projeto);
    }
  }
}

export class PrismaProfessionalRepository implements ProfessionalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listarDisponiveis(projeto: Projeto): Promise<Profissional[]> {
    const registros = await this.prisma.profissional.findMany({
      where: {
        papeis: { hasSome: projeto.papeisObrigatorios },
        OR: [{ disponivelAte: null }, { disponivelAte: { gte: new Date() } }]
      },
      include: { competencias: true, avaliacoes: true }
    });
    return registros.map((registro) => new Profissional(
      registro.id,
      registro.nome,
      registro.email,
      registro.papeis as Papel[],
      registro.generos,
      registro.competencias.map((item) => new Competencia(item.nome, item.peso)),
      registro.avaliacoes.map((item) => new Avaliacao(item.nota, item.generoProjeto, item.comentario ?? undefined)),
      registro.valorDiaria,
      registro.disponivelAte ?? undefined
    ));
  }
}

export function profissionaisDeExemplo(): Profissional[] {
  const papeis = Object.values(Papel);
  return papeis.flatMap((papel, indice) => [0, 1].map((variante) => new Profissional(
    `demo-${indice}-${variante}`,
    `Profissional ${papel} ${variante + 1}`,
    `demo-${indice}-${variante}@cinebridge.local`,
    [papel],
    variante === 0 ? ["drama", "documentario"] : ["comedia", "drama"],
    [new Competencia(papel.toLowerCase(), variante === 0 ? 0.9 : 0.7), new Competencia("producao", 0.6)],
    [new Avaliacao(variante === 0 ? 4.7 : 4.1, "drama")],
    variante === 0 ? 120 : 80
  )));
}