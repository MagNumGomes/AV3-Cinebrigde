import type { Equipe, Profissional, Projeto } from "../domain/entities";
import type { ProjetoAnimacao, ProjetoDocumentario, ProjetoPublicitario } from "../domain/projects";
import type { VisitanteProjeto } from "./project-visitors";

export class ProjetoInvalido extends Error {}

/** Contrato booleano do diagrama, com diagnósticos opcionais para a API. */
export interface VisitanteValidacao extends VisitanteProjeto<boolean> {
  diagnosticarProjeto?(projeto: Projeto): string[];
  diagnosticarEquipe?(equipe: Equipe): string[];
}

export class ValidadorProjeto implements VisitanteValidacao {
  visitarProjeto(projeto: Projeto): boolean {
    return this.diagnosticarProjeto(projeto).length === 0;
  }

  visitarProfissional(profissional: Profissional): boolean {
    return this.diagnosticarProfissional(profissional).length === 0;
  }

  visitarEquipe(equipe: Equipe): boolean {
    return this.diagnosticarEquipe(equipe).length === 0;
  }

  diagnosticarProjeto(projeto: Projeto): string[] {
    const erros: string[] = [];
    if (!Number.isFinite(projeto.orcamento) || projeto.orcamento <= 0) erros.push("O orçamento deve ser maior que zero");
    if (!Number.isFinite(projeto.prazo.getTime())) erros.push("Prazo inválido");
    if (!projeto.genero.trim()) erros.push("Gênero é obrigatório");
    if (!projeto.papeisObrigatorios.length) erros.push("Informe ao menos um papel obrigatório");
    if (!projeto.servicoPrincipal.validar()) erros.push("Hierarquia de serviços inválida ou indisponível");
    if (projeto.calcularCustoTotal() > projeto.orcamento) erros.push("Serviços excedem o orçamento");
    if (projeto.calcularCustoTotal() > 0 && Number.isFinite(projeto.prazo.getTime())
      && projeto.servicoPrincipal.obterPrazo() * 86_400_000 > projeto.prazo.getTime() - Date.now()) {
      erros.push("Prazo insuficiente para os serviços");
    }
    if (!Number.isFinite(projeto.duracao) || projeto.duracao <= 0) erros.push("Duração deve ser positiva");
    if (Object.values(projeto.competencias).some((peso) => !Number.isFinite(peso) || peso < 0)) {
      erros.push("Pesos das competências devem ser não negativos");
    }
    const dias = projeto.restricoes.diasProducao ?? 1;
    if (!Number.isInteger(dias) || dias < 1) erros.push("Dias de produção devem ser um inteiro positivo");
    if (projeto.restricoes.competenciasObrigatorias?.some((nome) => !nome.trim())) {
      erros.push("Competências obrigatórias não podem estar vazias");
    }
    return erros;
  }

  diagnosticarProfissional(profissional: Profissional): string[] {
    return Number.isFinite(profissional.valorDiaria) && profissional.valorDiaria >= 0
      ? [] : ["Valor diário inválido"];
  }

  diagnosticarEquipe(equipe: Equipe): string[] {
    const papeis = equipe.membros.map((membro) => membro.papel);
    const ids = equipe.membros.map((membro) => membro.profissional.id);
    return new Set(papeis).size === papeis.length && new Set(ids).size === ids.length
      ? [] : ["A equipe contém papéis ou profissionais duplicados"];
  }

  validarProjeto(projeto: Projeto): boolean {
    return this.visitarProjeto(projeto);
  }

  validarProfissional(profissional: Profissional): boolean {
    return this.visitarProfissional(profissional);
  }
}

export class ValidadorDocumentario extends ValidadorProjeto {
  override diagnosticarProjeto(projeto: Projeto): string[] {
    const erros = super.diagnosticarProjeto(projeto);
    const documentario = projeto as ProjetoDocumentario;
    if (projeto.tipo !== "documentario") erros.push("Validador incompatível com o tipo de projeto");
    if (typeof documentario.tema !== "string" || !documentario.tema.trim()) erros.push("Tema do documentário é obrigatório");
    if (!Array.isArray(documentario.entrevistados) || documentario.entrevistados.some((nome) => !nome.trim())) {
      erros.push("Entrevistados devem conter nomes válidos");
    }
    return erros;
  }
}

export class ValidadorAnimacao extends ValidadorProjeto {
  override diagnosticarProjeto(projeto: Projeto): string[] {
    const erros = super.diagnosticarProjeto(projeto);
    const animacao = projeto as ProjetoAnimacao;
    if (projeto.tipo !== "animacao") erros.push("Validador incompatível com o tipo de projeto");
    if (typeof animacao.software !== "string" || !animacao.software.trim()) erros.push("Software de animação é obrigatório");
    if (!Number.isInteger(animacao.quadrosPorSegundo) || animacao.quadrosPorSegundo <= 0) {
      erros.push("Quadros por segundo devem ser um inteiro positivo");
    }
    return erros;
  }
}

export class ValidadorPublicitario extends ValidadorProjeto {
  override diagnosticarProjeto(projeto: Projeto): string[] {
    const erros = super.diagnosticarProjeto(projeto);
    const publicitario = projeto as ProjetoPublicitario;
    if (projeto.tipo !== "publicitario") erros.push("Validador incompatível com o tipo de projeto");
    if (typeof publicitario.cliente !== "string" || !publicitario.cliente.trim()) erros.push("Cliente é obrigatório");
    if (!Array.isArray(publicitario.canais) || !publicitario.canais.length || publicitario.canais.some((canal) => !canal.trim())) {
      erros.push("Informe ao menos um canal publicitário válido");
    }
    return erros;
  }
}
