import { Equipe, Papel, Profissional, Projeto } from "../domain/entities";

export interface VisitanteProjeto<T = unknown> {
  visitarProjeto(projeto: Projeto): T;
  visitarProfissional(profissional: Profissional): T;
  visitarEquipe?(equipe: Equipe): T;
}

export class ValidadorConsistencia implements VisitanteProjeto<string[]> {
  private readonly problemas: string[] = [];

  visitarProjeto(projeto: Projeto): string[] {
    this.problemas.length = 0;
    if (projeto.orcamento <= 0) this.problemas.push("Orçamento deve ser positivo");
    const presentes = new Set((projeto.equipe?.membros ?? []).map((membro) => membro.papel));
    for (const papel of projeto.papeisObrigatorios) {
      if (!presentes.has(papel)) this.problemas.push(`Papel obrigatório ausente: ${papel}`);
    }
    const gasto = (projeto.equipe?.membros ?? [])
      .reduce((total, membro) => total + membro.profissional.valorDiaria, 0);
    if (gasto > projeto.orcamento) this.problemas.push("Equipe excede o orçamento do projeto");
    return [...this.problemas];
  }

  visitarProfissional(profissional: Profissional): string[] {
    return profissional.valorDiaria < 0 ? ["Valor diário inválido"] : [];
  }

  visitarEquipe(equipe: Equipe): string[] {
    const papeis = equipe.membros.map((membro) => membro.papel);
    return new Set(papeis).size !== papeis.length ? ["A equipe contém papéis duplicados"] : [];
  }
}

export class CalculadorCompatibilidade implements VisitanteProjeto<number> {
  visitarProjeto(projeto: Projeto): number {
    const membros = projeto.equipe?.membros ?? [];
    if (membros.length === 0) return 0;
    const papeisAtendidos = new Set(membros.map((membro) => membro.papel));
    const cobertura = projeto.papeisObrigatorios.length === 0
      ? 1
      : projeto.papeisObrigatorios.filter((papel) => papeisAtendidos.has(papel)).length
        / projeto.papeisObrigatorios.length;
    const afinidade = membros.reduce((total, membro) => {
      const nota = membro.profissional.avaliacoes.length === 0
        ? 3
        : membro.profissional.avaliacoes.reduce((soma, avaliacao) => soma + avaliacao.nota, 0)
          / membro.profissional.avaliacoes.length;
      return total + nota / 5;
    }, 0) / membros.length;
    return Math.round((cobertura * 0.6 + afinidade * 0.4) * 100);
  }

  visitarProfissional(profissional: Profissional): number {
    if (profissional.avaliacoes.length === 0) return 60;
    const media = profissional.avaliacoes.reduce((total, avaliacao) => total + avaliacao.nota, 0)
      / profissional.avaliacoes.length;
    return Math.round((media / 5) * 100);
  }

  visitarEquipe(equipe: Equipe): number {
    if (equipe.membros.length === 0) return 0;
    return Math.round(equipe.membros.reduce(
      (total, membro) => total + this.visitarProfissional(membro.profissional), 0
    ) / equipe.membros.length);
  }
}

export class GeradorRelatorio implements VisitanteProjeto<Record<string, unknown>> {
  visitarProjeto(projeto: Projeto): Record<string, unknown> {
    return {
      id: projeto.id,
      tipo: projeto.tipo,
      duracao: projeto.duracao,
      restricoes: projeto.clonar().restricoes,
      dadosEspecificos: projeto.clonar().dadosEspecificos(),
      genero: projeto.genero,
      orcamento: projeto.orcamento,
      prazo: projeto.prazo.toISOString(),
      papeisObrigatorios: projeto.papeisObrigatorios,
      equipe: projeto.equipe?.membros.map((membro) => ({
        papel: membro.papel,
        profissional: membro.profissional.nome,
        valorDiaria: membro.profissional.valorDiaria
      })) ?? []
    };
  }

  visitarProfissional(profissional: Profissional): Record<string, unknown> {
    return {
      id: profissional.id,
      nome: profissional.nome,
      papeis: profissional.papeis,
      competencias: profissional.competencias.map((competencia) => competencia.nome),
      valorDiaria: profissional.valorDiaria
    };
  }

  visitarEquipe(equipe: Equipe): Record<string, unknown> {
    return {
      totalMembros: equipe.membros.length,
      membros: equipe.membros.map((membro) => ({
        papel: membro.papel as Papel,
        profissional: membro.profissional.nome
      }))
    };
  }
}

export class GeradorRelatorioAnimacao extends GeradorRelatorio {
  override visitarProjeto(projeto: Projeto): Record<string, unknown> {
    const base = super.visitarProjeto(projeto);
    const especificos = projeto.dadosEspecificos();
    const qps = typeof especificos.quadrosPorSegundo === "number" ? especificos.quadrosPorSegundo : 24;
    const dias = Math.max(projeto.restricoes.diasProducao ?? 1, 1);
    const quadrosTotais = Math.max(projeto.duracao, 1) * 60 * qps;
    const quadrosPorDia = Math.round(quadrosTotais / dias);
    const membros3d = (projeto.equipe?.membros ?? []).filter((membro) =>
      membro.profissional.competencias.some((c) => ["modelagem 3d", "animacao"].includes(c.nome.trim().toLowerCase()))
    ).length;
    const eficienciaRenderizacao = Number(Math.min(1, (membros3d + 1) / Math.max(projeto.papeisObrigatorios.length, 1)).toFixed(2));
    return {
      ...base,
      metricasRenderizacao: {
        software: especificos.software ?? "Blender",
        quadrosPorSegundo: qps,
        quadrosTotais,
        quadrosPorDia,
        eficienciaRenderizacao
      }
    };
  }
}
