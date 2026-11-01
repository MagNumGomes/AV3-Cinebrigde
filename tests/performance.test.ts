import { performance } from "node:perf_hooks";
import { EventBus, EventoRecomendacao } from "../src/events/recommendation-events";
import { criarApp } from "../src/http/app";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { Avaliacao, Competencia, Papel, Profissional } from "../src/domain/entities";
import { OrquestradorPadrao } from "../src/team/orchestrator";
import { FabricaPadrao } from "../src/factories/project-factory";
import { projeto } from "./fixtures";

class EventBusCarga implements EventBus {
  publicar(_evento: EventoRecomendacao): void {}
  inscrever(): () => void { return () => undefined; }
}

function catalogo(tamanho: number): Profissional[] {
  return Array.from({ length: tamanho }, (_, indice) => new Profissional(
    `prof-${indice}`,
    `Profissional ${indice}`,
    `prof-${indice}@cinebridge.test`,
    [Papel.DIRETOR],
    ["drama"],
    [new Competencia("fotografia", (indice % 10 + 1) / 10)],
    [new Avaliacao(4, "drama")],
    100
  ));
}

describe("carga inicial", () => {
  it("recomenda entre 10 mil profissionais em menos de dois segundos", async () => {
    const profissionais = catalogo(10_000);
    const inicio = performance.now();
    const resultado = await new OrquestradorPadrao(new FabricaPadrao()).montarEquipe(projeto(), profissionais);
    expect(performance.now() - inicio).toBeLessThan(2000);
    expect(resultado.membros).toHaveLength(1);
  });

  it("atende 100 requisições concorrentes pela API", async () => {
    const app = criarApp(new InMemoryProfessionalRepository(catalogo(500)), new EventBusCarga(), "similaridade");
    await app.ready();
    const payload = {
      genero: "drama",
      orcamento: 1000,
      prazo: "2030-06-01",
      papeisObrigatorios: [Papel.DIRETOR],
      competencias: { fotografia: 1 }
    };
    const respostas = await Promise.all(Array.from({ length: 100 }, () => app.inject({
      method: "POST",
      url: "/recommendations",
      payload
    })));
    expect(respostas.every((resposta) => resposta.statusCode === 201)).toBe(true);
    await app.close();
  });
});
