import {
  Equipe,
  MembroEquipe,
  Papel,
  Projeto
} from "../src/domain/entities";
import { ProjetoDocumentario } from "../src/domain/projects";
import { FabricaDocumentario, FabricaPadrao } from "../src/factories/project-factory";
import { OrquestradorEquipe, OrquestradorPadrao } from "../src/team/orchestrator";
import { ValidadorDocumentario, type VisitanteValidacao } from "../src/visitors/family-validators";
import {
  CalculadorCompatibilidade,
  GeradorRelatorio,
  ValidadorConsistencia
} from "../src/visitors/project-visitors";
import { profissional, projeto } from "./fixtures";

describe("Template Method de montagem de equipe", () => {
  it("mantém a ordem invariável validar, normalizar e pós-processar", async () => {
    const passos: string[] = [];
    class OrquestradorDeTeste extends OrquestradorEquipe {
      protected validarRestricoes(): boolean { passos.push("validar"); return true; }
      protected normalizarDados(valor: Projeto): Projeto { passos.push("normalizar"); return valor; }
      protected posProcessar(_valor: Projeto, membros: never[]): never[] { passos.push("pos-processar"); return membros; }
    }
    await new OrquestradorDeTeste(new FabricaPadrao())
      .montarEquipe(projeto(), [profissional("p1", Papel.DIRETOR)]);
    expect(passos).toEqual(["validar", "normalizar", "pos-processar"]);
  });

  it("normaliza gênero e evita selecionar o mesmo profissional duas vezes", async () => {
    const projetoMisto = new Projeto("p", " Drama ", 1000, new Date("2030-06-01"), [Papel.DIRETOR, Papel.EDITOR]);
    const umProfissional = profissional("multi", Papel.DIRETOR);
    const resultado = await new OrquestradorPadrao(new FabricaPadrao()).montarEquipe(
      projetoMisto,
      [umProfissional]
    );
    expect(resultado.projeto.genero).toBe("drama");
    expect(resultado.membros).toHaveLength(1);
    expect(resultado.parcial).toBe(true);
  });

  it("executa orquestrar(projeto, estrategia): Equipe conforme o diagrama de classes", () => {
    const fabrica = new FabricaDocumentario();
    const doc = fabrica.criarProjeto({ papeisObrigatorios: [Papel.EDITOR, Papel.DIRETOR] });
    const dir = profissional("dir", Papel.DIRETOR);
    const edi = profissional("edi", Papel.EDITOR);
    const orquestrador = new OrquestradorPadrao(fabrica, undefined, [dir, edi]);
    const equipe = orquestrador.orquestrar(doc, fabrica.criarRecomendador());
    expect(equipe).toBeInstanceOf(Equipe);
    expect(equipe.membros.map((m) => m.profissional.id).sort()).toEqual(["dir", "edi"]);
    expect(doc.equipe).toBe(equipe);
  });

  it("distingue catálogo ausente de catálogo vazio e permite fornecer candidatos por chamada", () => {
    const fabrica = new FabricaDocumentario();
    const doc = fabrica.criarProjeto({ papeisObrigatorios: [Papel.DIRETOR] });
    const orquestrador = new OrquestradorPadrao(fabrica);
    expect(() => orquestrador.orquestrar(doc, fabrica.criarRecomendador())).toThrow("catálogo de profissionais");
    expect(doc.equipe).toBeUndefined();
    expect(orquestrador.orquestrar(doc, fabrica.criarRecomendador(), []).membros).toEqual([]);
    expect(orquestrador.orquestrar(doc, fabrica.criarRecomendador(), [profissional("dir", Papel.DIRETOR)]).membros)
      .toHaveLength(1);
  });

  it("interrompe os dois fluxos quando uma subclasse retorna false na validação", async () => {
    const fabrica = new FabricaPadrao();
    const estrategia = fabrica.criarRecomendador();
    const recomendar = jest.spyOn(estrategia, "recomendar");
    const pontuar = jest.spyOn(estrategia, "pontuar");
    jest.spyOn(fabrica, "criarRecomendador").mockReturnValue(estrategia);
    const normalizar = jest.fn();
    class OrquestradorRejeita extends OrquestradorPadrao {
      protected override validarRestricoes(): boolean { return false; }
      protected override normalizarProjetoBase(valor: Projeto): Projeto {
        normalizar();
        return super.normalizarProjetoBase(valor);
      }
    }
    const catalogo = [profissional("dir", Papel.DIRETOR)];
    const orquestrador = new OrquestradorRejeita(fabrica, undefined, catalogo);
    const alvo = projeto();
    expect(() => orquestrador.orquestrar(alvo, estrategia)).toThrow("não atende às restrições");
    await expect(orquestrador.montarEquipe(alvo, catalogo)).rejects.toThrow("não atende às restrições");
    expect(normalizar).not.toHaveBeenCalled();
    expect(recomendar).not.toHaveBeenCalled();
    expect(pontuar).not.toHaveBeenCalled();
    expect(alvo.equipe).toBeUndefined();
  });

  it("aceita um visitante booleano sem diagnósticos e respeita a rejeição de projeto e profissional", async () => {
    const validador: VisitanteValidacao = {
      visitarProjeto: (alvo) => alvo.orcamento > 0,
      visitarProfissional: (pessoa) => pessoa.id === "permitido"
    };
    const fabrica = new FabricaPadrao();
    jest.spyOn(fabrica, "criarValidador").mockReturnValue(validador);
    const catalogo = [profissional("bloqueado", Papel.DIRETOR), profissional("permitido", Papel.DIRETOR)];
    const orquestrador = new OrquestradorPadrao(fabrica, undefined, catalogo);
    const invalido = projeto();
    invalido.orcamento = 0;
    expect(() => orquestrador.orquestrar(invalido)).toThrow("não atende às restrições");
    await expect(orquestrador.montarEquipe(invalido, catalogo)).rejects.toThrow("não atende às restrições");
    expect(orquestrador.orquestrar(projeto()).membros[0]?.profissional.id).toBe("permitido");
    expect((await orquestrador.montarEquipe(projeto(), catalogo)).membros[0]?.profissional.id).toBe("permitido");
  });

  it("rejeita membros fixos duplicados com o diagnóstico do visitante booleano", async () => {
    const pessoa = profissional("dir", Papel.DIRETOR);
    const membro = { papel: Papel.DIRETOR, profissional: pessoa, pontuacao: 1, motivo: "fixo" };
    const orquestrador = new OrquestradorPadrao(new FabricaPadrao());
    await expect(orquestrador.montarEquipe(projeto(), [pessoa], {
      papeisAlvo: [], membrosFixos: [membro, membro]
    })).rejects.toThrow("papéis ou profissionais duplicados");
  });

  it("rejeita projeto sem papéis ou com orçamento inválido", async () => {
    await expect(new OrquestradorPadrao(new FabricaPadrao()).montarEquipe(
      new Projeto("p", "drama", 0, new Date("2030-06-01"), [Papel.DIRETOR]), []
    )).rejects.toThrow("orçamento");
  });
});

describe("visitors", () => {
  it("detecta papel faltante, orçamento excedido, duplicidade e expõe validação booleana", () => {
    const pessoa = profissional("p1", Papel.DIRETOR, { valorDiaria: 1500 });
    const equipe = new Equipe([
      new MembroEquipe(Papel.DIRETOR, pessoa),
      new MembroEquipe(Papel.DIRETOR, pessoa)
    ]);
    const projetoComEquipe = new Projeto(
      "p", "drama", 100, new Date("2030-06-01"), [Papel.DIRETOR, Papel.EDITOR], {}, equipe
    );
    const validador = new ValidadorConsistencia();
    expect(validador.visitarProjeto(projetoComEquipe)).toEqual(expect.arrayContaining([
      "Papel obrigatório ausente: EDITOR",
      "Equipe excede o orçamento do projeto"
    ]));
    expect(validador.visitarEquipe(equipe)).toEqual(["A equipe contém papéis duplicados"]);
    expect(validador.visitarProfissional(profissional("negativo", Papel.DIRETOR, { valorDiaria: -1 })))
      .toEqual(["Valor diário inválido"]);
    expect(validador.visitarProjeto(new Projeto("zero", "drama", 0, new Date(), [], {}, new Equipe([]))))
      .toContain("Orçamento deve ser positivo");
    expect(validador.visitarEquipe(new Equipe([]))).toEqual([]);
    const validadorDoc = new ValidadorDocumentario();
    expect(validadorDoc.validarProjeto(new ProjetoDocumentario())).toBe(true);
    expect(validadorDoc.validarProjeto(new ProjetoDocumentario({ tema: "" }))).toBe(false);
    expect(validadorDoc.validarProfissional(pessoa)).toBe(true);
    expect(validadorDoc.validarProfissional(profissional("neg", Papel.DIRETOR, { valorDiaria: -5 }))).toBe(false);
  });

  it("calcula compatibilidade e exporta relatório sem alterar domínio", () => {
    const pessoa = profissional("p1", Papel.DIRETOR, { nota: 5 });
    const equipe = new Equipe([new MembroEquipe(Papel.DIRETOR, pessoa)]);
    const projetoComEquipe = new Projeto("p", "drama", 1000, new Date("2030-06-01"), [Papel.DIRETOR], {}, equipe);
    const compatibilidade = new CalculadorCompatibilidade();
    expect(compatibilidade.visitarProjeto(projetoComEquipe)).toBe(100);
    expect(compatibilidade.visitarProjeto(projeto())).toBe(0);
    expect(compatibilidade.visitarEquipe(new Equipe([]))).toBe(0);
    expect(compatibilidade.visitarEquipe(equipe)).toBe(100);
    expect(compatibilidade.visitarProfissional(profissional("sem-avaliacao", Papel.DIRETOR, { nota: 0 }))).toBe(0);
    const relatorio = new GeradorRelatorio().visitarProjeto(projetoComEquipe);
    expect(relatorio).toMatchObject({ id: "p", genero: "drama", papeisObrigatorios: [Papel.DIRETOR] });
    expect(new GeradorRelatorio().visitarProfissional(pessoa)).toMatchObject({ nome: "Profissional p1" });
    expect(new GeradorRelatorio().visitarEquipe(equipe)).toMatchObject({ totalMembros: 1 });
  });
});
