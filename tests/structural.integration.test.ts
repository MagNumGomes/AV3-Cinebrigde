import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { Avaliacao, Papel, Profissional, Projeto } from "../src/domain/entities";
import { PacoteServico, ServicoAtomico, lerServico } from "../src/domain/services";
import { AdaptadorGoogleCloud, AdaptadorS3 } from "../src/adapters/storage";
import { AdaptadorPagSeguro, AdaptadorStripe, PagSeguroSimulado, StripeSimulado } from "../src/adapters/payment";
import { AdaptadorInterno, AdaptadorLinkedIn, CadastroInternoSimulado, LinkedInSimulado } from "../src/adapters/professional";
import { SistemaRecomendacao } from "../src/recommendation/structural-system";
import { AuditoriaDecorator, CacheDecorator, CompressaoDecorator, configurarDecoradores, obterTransmissao,
  RegistroAuditoria, serializarRanking, TipoDecorator } from "../src/recommendation/decorators";
import { RecomendadorBase } from "../src/recommendation/strategies";
import { profissional, projeto } from "./fixtures";

const catalogo = () => new AdaptadorInterno(new CadastroInternoSimulado([profissional("editor", Papel.EDITOR), profissional("som", Papel.SONOPLASTA)]));
const sistema = () => new SistemaRecomendacao(new AdaptadorS3(), new AdaptadorStripe(), catalogo(), new RecomendadorBase());
const folha = () => new ServicoAtomico("Edição", 100.10, 3, Papel.EDITOR);

describe("AV3 — Adapter integrado ao sistema", () => {
  it("troca armazenamento e pagamento na mesma instância sem mudar o fluxo", () => {
    const servico = sistema();
    for (const [storage, payment] of [[new AdaptadorS3(), new AdaptadorStripe()], [new AdaptadorGoogleCloud(), new AdaptadorPagSeguro()]] as const) {
      servico.configurarAdaptadores(storage, payment, catalogo());
      const bytes = Buffer.from([0, 255, 42]);
      const id = servico.salvarArquivo(bytes, { prefixo: "midia/", tipo: "video" });
      bytes.fill(1);
      expect(servico.recuperarArquivo(id)).toEqual(Buffer.from([0, 255, 42]));
      expect(servico.listarArquivos("midia/")).toEqual([id]);
      expect(servico.listarArquivos("outro/")).toEqual([]);
      const copia = servico.recuperarArquivo(id);
      copia.fill(2);
      expect(servico.recuperarArquivo(id)[0]).toBe(0);
      expect(() => servico.recuperarArquivo("ausente")).toThrow();
      const transacao = servico.efetuarPagamento(123.45, "produtor", "editor");
      expect(servico.verificarPagamento(transacao)).toBe("aprovado");
      expect(servico.cancelarPagamento(transacao)).toBe(true);
      expect(servico.cancelarPagamento(transacao)).toBe(false);
      expect(servico.verificarPagamento(transacao)).toBe("cancelado");
      expect(() => servico.verificarPagamento("ausente")).toThrow();
      expect(() => servico.efetuarPagamento(-1, "p", "e")).toThrow();
      expect(servico.executarRecomendacao(projeto([Papel.EDITOR])).membros[0]?.profissional.id).toBe("editor");
    }
  });
  it("traduz valores monetários para centavos Stripe e texto PagSeguro", () => {
    const stripe = new StripeSimulado();
    const pagseguro = new PagSeguroSimulado();
    const id1 = new AdaptadorStripe(stripe).efetuarPagamento(10.25, "a", "b");
    const id2 = new AdaptadorPagSeguro(pagseguro).efetuarPagamento(10.25, "a", "b");
    expect(stripe.retrieveCharge(id1).amount).toBe(1025);
    expect(pagseguro.consultar(id2).reais).toBe("10.25");
  });
  it("traduz perfis externos, filtros e avaliações nos dois cadastros", () => {
    const externo = new AdaptadorLinkedIn(new LinkedInSimulado([{ urn: "editor", fullName: "Editor",
      contact: "editor@test", roles: [Papel.EDITOR], genres: ["drama"], skills: [{ label: "edicao", level: 1 }],
      dailyRateCents: 12550, reviews: [], availableUntil: "2031-01-01" }]));
    for (const adapter of [externo, catalogo()]) {
      expect(adapter.listarProfissionais({ papel: Papel.DIRETOR })).toEqual([]);
      expect(adapter.listarProfissionais({ papel: Papel.EDITOR })).toHaveLength(1);
      adapter.registrarAvaliacao("editor", new Avaliacao(5, "drama"));
      expect(adapter.detalharProfissional("editor").avaliacoes.at(-1)?.nota).toBe(5);
      expect(() => adapter.registrarAvaliacao("editor", new Avaliacao(6, "drama"))).toThrow();
      expect(() => adapter.detalharProfissional("ausente")).toThrow();
      expect(() => adapter.registrarAvaliacao("ausente", new Avaliacao(5, "drama"))).toThrow();
      const app = sistema();
      app.configurarAdaptadores(new AdaptadorGoogleCloud(), new AdaptadorPagSeguro(), adapter);
      expect(app.executarRecomendacao(projeto([Papel.EDITOR])).membros).toHaveLength(1);
    }
    expect(externo.detalharProfissional("editor").valorDiaria).toBe(125.5);
    expect(externo.listarProfissionais({ prazo: new Date("2032-01-01") })).toEqual([]);
  });

  it("respeita disponibilidade e impede reutilizar o mesmo profissional na equipe", () => {
    const pessoa = profissional("multipapel", Papel.EDITOR);
    pessoa.papeis.push(Papel.SONOPLASTA);
    const vencido = new Profissional(
      "vencido", "Vencido", "v@test", [Papel.EDITOR], [], [], [], 10, new Date("2020-01-01"));
    const cadastro = new AdaptadorInterno(new CadastroInternoSimulado([pessoa, vencido]));
    const app = sistema();
    app.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), cadastro);
    const p = projeto([Papel.EDITOR, Papel.SONOPLASTA]);
    expect(app.executarRecomendacao(p).membros).toHaveLength(1);
    expect(app.executarRecomendacao(p).membros[0]?.profissional.id).toBe("multipapel");
    const copia = cadastro.detalharProfissional("vencido");
    copia.disponivelAte!.setUTCFullYear(2040);
    expect(cadastro.detalharProfissional("vencido").disponivelAte?.getUTCFullYear()).toBe(2020);
  });
});

describe("AV3 — Composite e recomendação recursiva", () => {
  it("agrega custos e prazos em três níveis e recomenda os papéis de toda a árvore", () => {
    const paralelo = new PacoteServico("Som", [new ServicoAtomico("Mix", 200.20, 5, Papel.SONOPLASTA), folha()], "paralela");
    const raiz = new PacoteServico("Filme", [folha(), new PacoteServico("Pós", [paralelo])]);
    const p = new Projeto("filme", "drama", 1000, new Date("2030-01-01"), raiz);
    expect(p.calcularCustoTotal()).toBe(400.4);
    expect(raiz.obterPrazo()).toBe(8);
    expect(raiz.validar()).toBe(true);
    expect(folha().listarSubservicos()).toEqual([]);
    expect(sistema().executarRecomendacao(p).membros.map((m) => m.papel)).toEqual([Papel.EDITOR, Papel.SONOPLASTA]);
    raiz.listarSubservicos().pop();
    expect(raiz.listarSubservicos()).toHaveLength(2);
    raiz.remover(paralelo);
    expect(raiz.listarSubservicos()).toHaveLength(2);
  });

  it("valida custo e prazo em várias profundidades e desserializa JSON com segurança", () => {
    let raiz = new PacoteServico("Início", [new ServicoAtomico("a", 0.1, 1, Papel.EDITOR)]);
    for (let nivel = 1; nivel <= 10; nivel++) {
      raiz = new PacoteServico(`Nível ${nivel}`, [raiz, new ServicoAtomico("b", 0.2, 2, Papel.SONOPLASTA)]);
      expect(raiz.calcularCusto()).toBeCloseTo(0.1 + nivel * 0.2);
      expect(raiz.obterPrazo()).toBe(1 + nivel * 2);
      expect(raiz.validar()).toBe(true);
    }
    expect(raiz.obterPapeis()).toEqual([Papel.EDITOR, Papel.SONOPLASTA]);
    expect(new PacoteServico("vazio", [], "paralela").obterPrazo()).toBe(0);
    for (const valor of [null, [], {}, { tipo: "outro", nome: "a" },
      { tipo: "atomico", nome: "a", custo: 1, prazo: 1, papel: "EDITOR", disponivel: "sim" },
      { tipo: "atomico", nome: "a", custo: 1, prazo: 1, papel: "EDITOR", disponivel: false },
      { tipo: "pacote", nome: "a", servicos: [] }]) {
      expect(() => lerServico(valor)).toThrow();
    }
    const jsonFolha = { tipo: "atomico", nome: "a", custo: 10, prazo: 2, papel: "EDITOR" };
    const lido = lerServico({ tipo: "pacote", nome: "p", servicos: [jsonFolha, jsonFolha] });
    expect(lido.calcularCusto()).toBe(20);
    expect(lido.obterPrazo()).toBe(4);
    let profunda: unknown = jsonFolha;
    for (let i = 0; i < 52; i++) profunda = { tipo: "pacote", nome: "p", servicos: [profunda] };
    expect(() => lerServico(profunda)).toThrow("profunda");
  });

  it("rejeita ciclos, folhas inválidas, indisponibilidade, orçamento e prazo insuficientes", () => {
    const raiz = new PacoteServico("Raiz", [folha()]);
    const filho = new PacoteServico("Filho", [raiz]);
    expect(() => raiz.adicionar(filho)).toThrow("Ciclo");
    expect(() => raiz.adicionar(raiz)).toThrow("Ciclo");
    for (const invalido of [new ServicoAtomico("a", -1, 1, Papel.EDITOR),
      new ServicoAtomico("a", 1, 0, Papel.EDITOR), new ServicoAtomico("a", 1, 1, "invalido" as Papel),
      new ServicoAtomico("a", 1, 1, Papel.EDITOR, false), new PacoteServico("vazio")]) {
      expect(new PacoteServico("Pai", [invalido]).validar()).toBe(false);
    }
    const p = new Projeto("p", "drama", 50, new Date("2030-01-01"), raiz);
    expect(() => sistema().recomendar(p)).toThrow("orçamento");
    p.orcamento = 1000;
    p.prazo = new Date(Date.now() + 86_400_000);
    expect(() => sistema().recomendar(p)).toThrow("Prazo insuficiente");
    const unico = raiz.listarSubservicos()[0]!;
    raiz.remover(unico);
    expect(raiz.validar()).toBe(false);
    expect(raiz.obterPrazo()).toBe(0);
    expect(() => lerServico({ tipo: "pacote", nome: "p", execucao: "errado", servicos: [] })).toThrow();
  });
});

describe("AV3 — Decorator", () => {
  it("reduz o tempo repetido, evita nova execução e isola os resultados em cache", () => {
    class RecomendadorCustoso extends RecomendadorBase {
      chamadas = 0;
      override recomendar(...args: Parameters<RecomendadorBase["recomendar"]>) {
        this.chamadas++;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
        return super.recomendar(...args);
      }
    }
    const base = new RecomendadorCustoso();
    const cache = new CacheDecorator(base);
    const p = projeto([Papel.EDITOR]);
    const pessoas = catalogo().listarProfissionais({});
    const inicio = performance.now();
    const primeiro = cache.recomendar(p, pessoas);
    const frio = performance.now() - inicio;
    primeiro.get(Papel.EDITOR)!.pop();
    const repeticao = performance.now();
    const segundo = cache.recomendar(p, pessoas);
    const quente = performance.now() - repeticao;
    expect(segundo.get(Papel.EDITOR)).toHaveLength(1);
    expect(base.chamadas).toBe(1);
    expect(quente).toBeLessThan(frio);
    expect(cache.acertos).toBe(1);
  });
  it("invalida por catálogo/projeto, expira por TTL e limita entradas", () => {
    let agora = 0;
    const cache = new CacheDecorator(new RecomendadorBase(), 10, 1, () => agora);
    const p = projeto([Papel.EDITOR]);
    const pessoas = catalogo().listarProfissionais({});
    cache.recomendar(p, pessoas);
    cache.recomendar(p, pessoas);
    agora = 11;
    cache.recomendar(p, pessoas);
    pessoas[0]!.avaliacoes.push(new Avaliacao(1, "drama"));
    cache.recomendar(p, pessoas);
    p.orcamento += 1;
    cache.recomendar(p, pessoas);
    p.orcamento -= 1;
    cache.recomendar(p, pessoas);
    expect(cache.falhas).toBe(5);
    cache.limpar();
    cache.recomendar(p, pessoas);
    expect(cache.falhas).toBe(6);
    expect(() => new CacheDecorator(new RecomendadorBase(), 0)).toThrow();
  });
  it.each<TipoDecorator[]>([
    ["cache", "auditoria", "compressao"], ["cache", "compressao", "auditoria"],
    ["auditoria", "cache", "compressao"], ["auditoria", "compressao", "cache"],
    ["compressao", "cache", "auditoria"], ["compressao", "auditoria", "cache"]
  ])(
    "combina a pilha %j mantendo o contrato, gzip e semântica da auditoria", (...ordem) => {
      const registros: RegistroAuditoria[] = [];
      const estrategia = configurarDecoradores(new RecomendadorBase(), ordem, (r) => registros.push(r));
      const app = sistema();
      app.definirEstrategia(estrategia);
      const p = projeto([Papel.EDITOR, Papel.SONOPLASTA]);
      const primeiro = app.recomendar(p);
      const segundo = app.recomendar(p);
      expect(segundo).toEqual(primeiro);
      const { corpo, encoding } = obterTransmissao(segundo);
      expect(encoding).toBe("gzip");
      expect(corpo.length).toBeLessThan(serializarRanking(segundo).length);
      expect(gunzipSync(corpo)).toEqual(serializarRanking(segundo));
      expect(registros).toHaveLength(ordem.indexOf("auditoria") > ordem.indexOf("cache") ? 2 : 1);
      expect(registros.every((r) => r.sucesso && r.duracaoMs >= 0)).toBe(true);
      expect(estrategia.pontuar(p, Papel.EDITOR, catalogo().listarProfissionais({}))).toHaveLength(1);
      expect(estrategia.nome).toBe("similaridade");
    }
  );
  it("audita falhas e não guarda falhas no cache", () => {
    const registros: RegistroAuditoria[] = [];
    const base = new RecomendadorBase();
    const chamada = jest.spyOn(base, "recomendar").mockImplementation(() => { throw new Error("Falha externa"); });
    const estrategia = new AuditoriaDecorator(new CacheDecorator(base), (r) => registros.push(r));
    for (let i = 0; i < 2; i++) expect(() => estrategia.recomendar(projeto(), [])).toThrow("Falha externa");
    expect(chamada).toHaveBeenCalledTimes(2);
    expect(registros).toHaveLength(2);
    expect(registros[0]).toMatchObject({ sucesso: false, erro: "Falha externa" });
  });

  it("reutiliza projetos equivalentes com IDs diferentes e audita cada ID corretamente", () => {
    const registros: RegistroAuditoria[] = [];
    const base = new RecomendadorBase();
    const chamada = jest.spyOn(base, "recomendar");
    const cache = new CacheDecorator(base);
    const estrategia = new AuditoriaDecorator(cache, (r) => registros.push(r));
    const p = projeto([Papel.EDITOR]);
    p.competencias = { fotografia: 1, edicao: 2 };
    const pessoas = catalogo().listarProfissionais({});
    const primeiro = estrategia.recomendar(p, pessoas);
    p.id = "outro-projeto";
    p.competencias = { edicao: 2, fotografia: 1 };
    expect(estrategia.recomendar(p, pessoas)).toEqual(primeiro);
    expect(chamada).toHaveBeenCalledTimes(1);
    expect(cache.acertos).toBe(1);
    expect(registros.map((r) => r.projetoId)).toEqual(["projeto-1", "outro-projeto"]);
    p.servicoPrincipal = new PacoteServico("Alterado", [folha()]);
    estrategia.recomendar(p, pessoas);
    expect(chamada).toHaveBeenCalledTimes(2);
  });

  it("preserva conteúdo transmitido após mutações e evita gzip maior que o original", () => {
    const estrategia = new CompressaoDecorator(new RecomendadorBase());
    const resultado = estrategia.recomendar(projeto([Papel.EDITOR]), catalogo().listarProfissionais({}));
    const bytes = obterTransmissao(resultado);
    expect(bytes.encoding).toBe("gzip");
    bytes.corpo.fill(0);
    expect(gunzipSync(obterTransmissao(resultado).corpo)).toEqual(serializarRanking(resultado));
    resultado.clear();
    expect(obterTransmissao(resultado)).toEqual({ corpo: Buffer.from("{}") });
    const pequeno = estrategia.recomendar(projeto([Papel.EDITOR]), []);
    expect(obterTransmissao(pequeno)).toEqual({ corpo: Buffer.from('{"EDITOR":[]}') });
  });

  it("troca a pilha em execução e preserva o resultado do recomendador base", () => {
    const app = sistema();
    const p = projeto([Papel.EDITOR]);
    const original = app.executarRecomendacao(p);
    const registros: RegistroAuditoria[] = [];
    app.definirEstrategia(configurarDecoradores(new RecomendadorBase(), ["cache", "auditoria", "compressao"], (r) => registros.push(r)));
    expect(app.executarRecomendacao(p)).toEqual(original);
    app.definirEstrategia(configurarDecoradores(new RecomendadorBase(), [], (r) => registros.push(r)));
    expect(app.executarRecomendacao(p)).toEqual(original);
    expect(registros).toHaveLength(1);
    expect(() => configurarDecoradores(new RecomendadorBase(), ["invalido" as TipoDecorator], () => {})).toThrow("desconhecido");
  });
});
