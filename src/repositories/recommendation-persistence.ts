import { Prisma, PrismaClient, StatusConvite as PrismaStatusConvite } from "@prisma/client";
import { Papel, StatusConvite } from "../domain/entities";
import { Logger } from "../events/recommendation-events";
import { ResultadoRecomendacao } from "../recommendation/recommendation-service";

export interface RecommendationPersistence {
  salvar(recomendacao: ResultadoRecomendacao): Promise<void>;
  registrarConvite(recomendacao: ResultadoRecomendacao, papel: Papel, status: StatusConvite): Promise<void>;
}

export class InMemoryRecommendationPersistence implements RecommendationPersistence {
  async salvar(_recomendacao: ResultadoRecomendacao): Promise<void> {}
  async registrarConvite(
    _recomendacao: ResultadoRecomendacao,
    _papel: Papel,
    _status: StatusConvite
  ): Promise<void> {}
}

export class PrismaRecommendationPersistence implements RecommendationPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  async salvar(recomendacao: ResultadoRecomendacao): Promise<void> {
    const projeto = recomendacao.projeto;
    const membros = recomendacao.membros;
    await this.prisma.$transaction(async (transacao) => {
      await transacao.projeto.upsert({
        where: { id: projeto.id },
        create: {
          id: projeto.id,
          genero: projeto.genero,
          tipo: projeto.tipo,
          duracao: projeto.duracao,
          restricoes: projeto.restricoes as Prisma.InputJsonValue,
          dadosEspecificos: projeto.dadosEspecificos() as Prisma.InputJsonValue,
          orcamento: projeto.orcamento,
          prazo: projeto.prazo,
          papeisObrigatorios: projeto.papeisObrigatorios,
          competencias: projeto.competencias as Prisma.InputJsonValue
        },
        update: {
          genero: projeto.genero,
          tipo: projeto.tipo,
          duracao: projeto.duracao,
          restricoes: projeto.restricoes as Prisma.InputJsonValue,
          dadosEspecificos: projeto.dadosEspecificos() as Prisma.InputJsonValue,
          orcamento: projeto.orcamento,
          prazo: projeto.prazo,
          papeisObrigatorios: projeto.papeisObrigatorios,
          competencias: projeto.competencias as Prisma.InputJsonValue
        }
      });
      await transacao.equipe.upsert({
        where: { projetoId: projeto.id },
        create: {
          projetoId: projeto.id,
          membros: {
            create: membros.map((membro) => ({
              papel: membro.papel,
              profissional: { connect: { id: membro.profissional.id } }
            }))
          }
        },
        update: {
          membros: {
            deleteMany: {},
            create: membros.map((membro) => ({
              papel: membro.papel,
              profissional: { connect: { id: membro.profissional.id } }
            }))
          }
        }
      });
      if (membros.length > 0) {
        await transacao.recomendacao.createMany({
          data: membros.map((membro) => ({
            projetoId: projeto.id,
            profissionalId: membro.profissional.id,
            papel: membro.papel,
            pontuacao: membro.pontuacao,
            motivo: membro.motivo
          }))
        });
      }
    });
  }

  async registrarConvite(recomendacao: ResultadoRecomendacao, papel: Papel, status: StatusConvite): Promise<void> {
    const membro = recomendacao.membros.find((item) => item.papel === papel);
    if (!membro) return;
    await this.prisma.convite.create({
      data: {
        projetoId: recomendacao.projeto.id,
        profissionalId: membro.profissional.id,
        status: status === StatusConvite.ACEITO ? PrismaStatusConvite.ACEITO : PrismaStatusConvite.RECUSADO
      }
    });
  }
}

export class ResilientRecommendationPersistence implements RecommendationPersistence {
  constructor(
    private readonly primary: RecommendationPersistence,
    private readonly fallback: RecommendationPersistence,
    private readonly logger: Logger
  ) {}

  async salvar(recomendacao: ResultadoRecomendacao): Promise<void> {
    try {
      await this.primary.salvar(recomendacao);
    } catch (erro) {
      this.logger.warn({ erro: erro instanceof Error ? erro.message : String(erro) }, "Falha ao persistir recomendação; usando fallback");
      await this.fallback.salvar(recomendacao);
    }
  }

  async registrarConvite(recomendacao: ResultadoRecomendacao, papel: Papel, status: StatusConvite): Promise<void> {
    try {
      await this.primary.registrarConvite(recomendacao, papel, status);
    } catch (erro) {
      this.logger.warn({ erro: erro instanceof Error ? erro.message : String(erro) }, "Falha ao persistir convite; usando fallback");
      await this.fallback.registrarConvite(recomendacao, papel, status);
    }
  }
}
