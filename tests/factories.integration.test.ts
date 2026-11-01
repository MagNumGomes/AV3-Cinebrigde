import { Competencia, DadosProjeto, Papel, Projeto } from "../src/domain/entities";
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoPublicitario } from "../src/domain/projects";
import { EventBus, EventoRecomendacao, Observer } from "../src/events/recommendation-events";
import { FabricaAnimacao, FabricaBase, FabricaDocumentario, FabricaPadrao, FabricaPublicitario, criarRegistroFabricas } from "../src/factories/project-factory";
import { RecommendationService } from "../src/recommendation/recommendation-service";
import { criarEstrategia, RecomendacaoStrategy } from "../src/recommendation/strategies";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { OrquestradorPadrao } from "../src/team/orchestrator";
import { ValidadorProjeto } from "../src/visitors/family-validators";
import { profissional } from "./fixtures";

class BusTeste implements EventBus {
  readonly eventos: EventoRecomendacao[] = [];
  publicar(evento: EventoRecomendacao): void { this.eventos.push(evento); }
  inscrever(): () => void { return () => undefined; }
}

const entrada = { genero: "drama", orcamento: 1000, prazo: "2030-06-01", papeisObrigatorios: [Papel.DIRETOR] };
const catalogo = [
  profissional("doc", Papel.DIRETOR, { competencias: [new Competencia("pesquisa"), new Competencia("entrevista")] }),
  profissional("ani", Papel.DIRETOR, { competencias: [new Competencia("modelagem 3d"), new Competencia("animacao")] }),
  profissional("pub", Papel.DIRETOR, { competencias: [new Competencia("publicidade"), new Competencia("branding")] })
];

describe("integração das famílias criacionais", () => {
  it.each([
    ["documentario", "doc", ProjetoDocumentario, "Equipe documental"],
    ["animacao", "ani", ProjetoAnimacao, "Equipe de animação e renderização"],
    ["publicitario", "pub", ProjetoPublicitario, "Equipe da campanha publicitária"]
  ] as const)("alterna para %s com projeto, ranking, validação e notificação coerentes", async (tipo, esperado, classe, assunto) => {
    const bus = new BusTeste();
    const service = new RecommendationService(new InMemoryProfessionalRepository(catalogo), bus, "similaridade");
    const resultado = await service.recomendar({ ...entrada, tipo });
    expect(resultado.projeto).toBeInstanceOf(classe);
    expect(resultado.projeto.aceitar(resultado.projeto.criarValidador())).toBe(true);
    expect(resultado.membros[0]!.profissional.id).toBe(esperado);
    expect(resultado.membros[0]!.motivo).toContain(`especialização ${tipo}`);
    expect(bus.eventos).toEqual([expect.objectContaining({ tipoProjeto: tipo, assunto, profissionalId: esperado })]);
    await service.responderConvite(resultado.id, Papel.DIRETOR, "ACEITO");
    expect(bus.eventos.at(-1)).toMatchObject({ tipoProjeto: tipo, assunto, tipo: "convite_aceito" });
    const substituida = await service.substituirPapel(resultado.id, Papel.DIRETOR, {});
    expect(substituida.projeto).toBeInstanceOf(classe);
    expect(substituida.membros[0]!.profissional.id).not.toBe(esperado);
    expect(bus.eventos.at(-1)?.tipoProjeto).toBe(tipo);
  });

  it.each([
    [new FabricaDocumentario(), { tema: "" }, "Tema"],
    [new FabricaDocumentario(), { entrevistados: [""] }, "Entrevistados"],
    [new FabricaAnimacao(), { software: "" }, "Software"],
    [new FabricaAnimacao(), { quadrosPorSegundo: 0 }, "Quadros"],
    [new FabricaPublicitario(), { cliente: "" }, "Cliente"],
    [new FabricaPublicitario(), { canais: [] }, "canal"]
  ] as const)("executa a validação especializada antes do ranking: %#", async (fabrica, dados, mensagem) => {
    const orquestrador = new OrquestradorPadrao(fabrica);
    const projeto = fabrica.criarProjeto(dados as DadosProjeto);
    await expect(orquestrador.montarEquipe(projeto, catalogo)).rejects.toThrow(mensagem);
  });

  it("impede mistura de famílias e protege o registro de sobrescritas acidentais", async () => {
    const fabrica = new FabricaAnimacao();
    await expect(new OrquestradorPadrao(fabrica).montarEquipe(new ProjetoDocumentario(), catalogo)).rejects.toThrow("incompatível");
    const validador = fabrica.criarValidador();
    expect(validador.visitarProjeto(new ProjetoDocumentario())).toBe(false);
    expect(validador.diagnosticarProjeto?.(new ProjetoDocumentario())).toContain("Validador incompatível com o tipo de projeto");
    const registro = criarRegistroFabricas(new BusTeste());
    expect(() => registro.obter("desconhecido")).toThrow("desconhecido");
    expect(() => registro.registrar(new FabricaAnimacao())).toThrow("já registrada");
    expect(() => new FabricaPadrao(undefined, new ProjetoAnimacao()).criarProjeto()).toThrow("incompatível");
  });

  it("aplica dias de produção, competências obrigatórias e disponibilidade inclusive na substituição manual", async () => {
    const bus = new BusTeste();
    const caro = profissional("caro", Papel.DIRETOR, { valorDiaria: 600, competencias: [new Competencia("modelagem 3d")] });
    const indisponivel = Object.assign(profissional("vencido", Papel.DIRETOR), { disponivelAte: new Date("2020-01-01") });
    const invalido = profissional("invalido", Papel.DIRETOR, { valorDiaria: -1 });
    const service = new RecommendationService(new InMemoryProfessionalRepository([...catalogo, caro, indisponivel, invalido]), bus, "similaridade");
    const resultado = await service.recomendar({ ...entrada, tipo: "animacao",
      restricoes: { diasProducao: 2, competenciasObrigatorias: ["modelagem 3d"] } });
    expect(resultado.membros.map((membro) => membro.profissional.id)).toEqual(["ani"]);
    await expect(service.substituirPapel(resultado.id, Papel.DIRETOR, { substitutoId: "caro" })).rejects.toThrow("pontuar");
    const parcial = await service.recomendar({ ...entrada, tipo: "animacao", orcamento: 1 });
    expect(parcial.parcial).toBe(true);
    expect(parcial.membros).toEqual([]);
  });

  it("preserva atributos e a família na reavaliação; mudanças de família ou configuração também disparam o cálculo", async () => {
    const service = new RecommendationService(new InMemoryProfessionalRepository(catalogo), new BusTeste(), "similaridade");
    const inicial = await service.recomendar({ ...entrada, tipo: "documentario", tema: "Cinema", entrevistados: ["Ana"], duracao: 90 });
    const reavaliada = await service.reavaliar(inicial.id, { ...entrada, orcamento: 2000, tema: undefined, duracao: undefined });
    expect(reavaliada.projeto).toMatchObject({ tipo: "documentario", tema: "Cinema", entrevistados: ["Ana"], duracao: 90 });
    const animacao = await service.reavaliar(inicial.id, { ...entrada, tipo: "animacao" });
    expect(animacao.projeto).toBeInstanceOf(ProjetoAnimacao);
    expect(animacao.membros[0]!.profissional.id).toBe("ani");
    const novaConfiguracao = await service.reavaliar(inicial.id, { ...entrada, tema: "Outro tema" });
    expect(novaConfiguracao.projeto.dadosEspecificos().tema).toBe("Outro tema");
  });

  it("adiciona uma quarta família somente por extensão e registro, reutilizando o mesmo orquestrador", async () => {
    class ProjetoVR extends Projeto {
      override readonly tipo: string = "realidade-virtual";
      override criarValidador(): ValidadorProjeto {
        return new class extends ValidadorProjeto {
          override diagnosticarProjeto(projeto: Projeto): string[] {
            return [...super.diagnosticarProjeto(projeto), ...(projeto.duracao > 30 ? ["VR limitada a 30 minutos"] : [])];
          }
        }();
      }
    }
    class FabricaVR extends FabricaBase {
      readonly tipo = "realidade-virtual";
      constructor(bus: EventBus) { super(new ProjetoVR("vr", "vr", 1000, new Date("2030-06-01"), [Papel.DIRETOR]), bus); }
      criarRecomendador(estrategia = "colaborativa"): RecomendacaoStrategy { return criarEstrategia(estrategia); }
      criarNotificador(): Observer { return { atualizar: (evento) => this.bus.publicar({ ...evento, tipoProjeto: this.tipo, assunto: "Equipe imersiva" }) }; }
    }
    const bus = new BusTeste();
    const registro = criarRegistroFabricas(bus).registrar(new FabricaVR(bus));
    const service = new RecommendationService(new InMemoryProfessionalRepository(catalogo), bus, "colaborativa", undefined, undefined, registro);
    const resultado = await service.recomendar({ ...entrada, tipo: "realidade-virtual" });
    expect(resultado.projeto).toBeInstanceOf(ProjetoVR);
    expect(resultado.membros).toHaveLength(1);
    expect(bus.eventos[0]).toMatchObject({ tipoProjeto: "realidade-virtual", assunto: "Equipe imersiva" });
    await expect(service.recomendar({ ...entrada, tipo: "realidade-virtual", duracao: 60 })).rejects.toThrow("VR limitada");
  });
});
