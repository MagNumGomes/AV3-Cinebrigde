import { Avaliacao, Competencia, Convite, Equipe, MembroEquipe, Papel, Profissional, Projeto, Recomendacao, StatusConvite } from "../src/domain/entities";
import { PacoteServico, ServicoAtomico } from "../src/domain/services";
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoPublicitario } from "../src/domain/projects";
import { FabricaAnimacao, FabricaDocumentario, FabricaPublicitario } from "../src/factories/project-factory";
import { GeradorRelatorioAnimacao } from "../src/visitors/project-visitors";
import { profissional } from "./fixtures";

describe("Prototype: cópia profunda do agregado", () => {
  it.each([new ProjetoDocumentario(), new ProjetoAnimacao(), new ProjetoPublicitario()])(
    "preserva a classe e isola todos os agregados de $tipo", (projeto) => {
      projeto.prazo = new Date("2030-06-01");
      projeto.restricoes = { diasProducao: 2, competenciasObrigatorias: ["pesquisa"] };
      projeto.equipe = new Equipe([new MembroEquipe(Papel.DIRETOR, profissional("diretor", Papel.DIRETOR))]);
      const copia = projeto.clonar();
      expect(copia).toBeInstanceOf(projeto.constructor);
      expect(copia).toEqual(projeto);
      expect(copia.id).toBe(projeto.id);
      copia.prazo.setFullYear(2040);
      const papelAdicional = Object.values(Papel).find((p) => !projeto.papeisObrigatorios.includes(p))!;
      (copia.servicoPrincipal as PacoteServico).adicionar(new ServicoAtomico("Extra", 0, 1, papelAdicional));
      copia.competencias.nova = 2;
      copia.restricoes.competenciasObrigatorias!.push("outra");
      const pessoa = copia.equipe!.membros[0]!.profissional;
      expect(copia.equipe).toBeInstanceOf(Equipe);
      expect(copia.equipe!.membros[0]).toBeInstanceOf(MembroEquipe);
      expect(pessoa).toBeInstanceOf(Profissional);
      expect(pessoa.competencias[0]).toBeInstanceOf(Competencia);
      expect(pessoa.avaliacoes[0]).toBeInstanceOf(Avaliacao);
      pessoa.competencias.push(new Competencia("nova"));
      pessoa.generos.push("novo");
      pessoa.papeis.push(Papel.EDITOR);
      pessoa.avaliacoes.push(new Avaliacao(5, "novo"));
      expect(projeto.prazo.getFullYear()).toBe(2030);
      expect(projeto.competencias.nova).toBeUndefined();
      expect(projeto.restricoes.competenciasObrigatorias).toEqual(["pesquisa"]);
      expect(projeto.equipe!.membros[0]!.profissional.competencias).toHaveLength(1);
      expect(projeto.equipe!.membros[0]!.profissional.avaliacoes).toHaveLength(1);
      expect(projeto.equipe!.membros[0]!.profissional.generos).toEqual(["drama"]);
      expect(projeto.equipe!.membros[0]!.profissional.papeis).toEqual([Papel.DIRETOR]);
      expect(copia.papeisObrigatorios.length).toBe(projeto.papeisObrigatorios.length + 1);
    }
  );

  it("isola listas específicas, preserva datas compartilhadas e referências internas", () => {
    const data = new Date("2030-06-01");
    const pessoa = new Profissional("p", "Nome", "email", [Papel.DIRETOR], [], [], [], 100, data);
    const original = new ProjetoDocumentario({ prazo: data, entrevistados: ["Ana"],
      equipe: new Equipe([new MembroEquipe(Papel.DIRETOR, pessoa), new MembroEquipe(Papel.EDITOR, pessoa)]) });
    const copia = original.clonar();
    copia.entrevistados.push("Bia");
    expect(original.entrevistados).toEqual(["Ana"]);
    expect(copia.equipe!.membros[0]!.profissional).toBe(copia.equipe!.membros[1]!.profissional);
    expect(copia.equipe!.membros[0]!.profissional.disponivelAte).toBe(copia.prazo);
    expect(copia.prazo).not.toBe(data);
    const anuncio = new ProjetoPublicitario({ canais: ["tv"] });
    anuncio.clonar().canais.push("digital");
    expect(anuncio.canais).toEqual(["tv"]);
  });

  it("protege o protótipo registrado, vincula a fábrica e isola dados entre criações", () => {
    const modelo = new ProjetoDocumentario({ tema: "Natureza", entrevistados: ["Ana"] });
    const fabrica = new FabricaDocumentario(undefined, modelo);
    modelo.entrevistados.push("externa");
    const papeis = [Papel.EDITOR];
    const primeiro = fabrica.criarProjeto({ papeisObrigatorios: papeis }) as ProjetoDocumentario;
    expect(primeiro.obterFabrica()).toBe(fabrica);
    expect(primeiro.clonar().obterFabrica()).toBe(fabrica);
    primeiro.definirFabrica(undefined);
    expect(primeiro.obterFabrica()).toBeUndefined();
    primeiro.entrevistados.push("interna");
    papeis.push(Papel.DIRETOR);
    const segundo = fabrica.criarProjeto() as ProjetoDocumentario;
    expect(primeiro.papeisObrigatorios).toEqual([Papel.EDITOR]);
    expect(segundo.entrevistados).toEqual(["Ana"]);
    expect(segundo.tema).toBe("Natureza");
    expect(segundo.id).not.toBe(primeiro.id);
    expect(segundo.id).not.toBe(modelo.id);
    expect(new FabricaAnimacao().criarProjeto()).toBeInstanceOf(ProjetoAnimacao);
    expect(new FabricaPublicitario().criarProjeto()).toBeInstanceOf(ProjetoPublicitario);
  });

  it("seleciona componentes por Factory Method da subclasse e executa operações de Projeto do diagrama", () => {
    const modelos: Projeto[] = [new ProjetoDocumentario(), new ProjetoAnimacao(), new ProjetoPublicitario()];
    for (const modelo of modelos) {
      expect(modelo.aceitar(modelo.criarValidador())).toBe(true);
      expect(modelo.criarValidador().constructor.name).toBe(`Validador${modelo.constructor.name.replace("Projeto", "")}`);
      expect(modelo.criarRecomendador().nome).toBe("similaridade");
      expect(typeof modelo.criarNotificador().atualizar).toBe("function");
    }
    const personalizado = new ProjetoAnimacao({ software: "Maya", quadrosPorSegundo: 60, duracao: 2 });
    expect(personalizado.criarGeradorRelatorio()).toBeInstanceOf(GeradorRelatorioAnimacao);
    const dir1 = profissional("dir1", Papel.DIRETOR);
    const dir2 = profissional("dir2", Papel.DIRETOR);
    personalizado.aceitarRecomendacao(Papel.DIRETOR, dir1);
    expect(personalizado.equipe?.membros[0]?.profissional.id).toBe("dir1");
    personalizado.substituirMembro(Papel.DIRETOR, dir2);
    expect(personalizado.equipe?.membros[0]?.profissional.id).toBe("dir2");
    const relatorio = personalizado.aceitar(personalizado.criarGeradorRelatorio());
    expect(relatorio).toMatchObject({
      metricasRenderizacao: { software: "Maya", quadrosPorSegundo: 60, quadrosTotais: 7200 }
    });
    personalizado.solicitarReavaliacao();
    expect(personalizado.equipe).toBeUndefined();
    const clone = personalizado.clonar();
    clone.software = "Blender";
    expect(personalizado.dadosEspecificos()).toEqual({ software: "Maya", quadrosPorSegundo: 60 });
    const rec = new Recomendacao("r1", personalizado.id, Papel.DIRETOR, dir1, 0.9, "ok");
    const conv = new Convite("c1", personalizado.id, dir1.id, StatusConvite.ACEITO);
    expect(rec.pontuacao).toBe(0.9);
    expect(conv.status).toBe(StatusConvite.ACEITO);
  });
});
