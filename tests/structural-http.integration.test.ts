import { gunzipSync } from "node:zlib";
import { Papel } from "../src/domain/entities";
import { EventEmitterBus, Logger } from "../src/events/recommendation-events";
import { criarApp } from "../src/http/app";
import { InMemoryProfessionalRepository } from "../src/repositories/professional-repository";
import { profissional } from "./fixtures";

describe("AV3 — transporte HTTP", () => {
  const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const app = criarApp(new InMemoryProfessionalRepository([
    profissional("ed-1", Papel.EDITOR),
    profissional("ed-2", Papel.EDITOR)
  ]), new EventEmitterBus(logger), "similaridade");
  afterAll(async () => app.close());

  const payload = {
    id: "av3", genero: "drama", orcamento: 2000, prazo: "2030-01-01", decorators: ["cache", "auditoria", "compressao"],
    servicoPrincipal: { tipo: "pacote", nome: "Pós", servicos: [
      { tipo: "atomico", nome: "Edição", custo: 100, prazo: 2, papel: "EDITOR" }
    ] }
  };

  it("transmite bytes gzip reais e respeita clientes sem suporte", async () => {
    const normal = await app.inject({ method: "POST", url: "/v3/recommendations", payload });
    expect(normal.statusCode).toBe(200);
    expect(normal.headers["content-encoding"]).toBeUndefined();
    const comprimido = await app.inject({ method: "POST", url: "/v3/recommendations", headers: { "accept-encoding": "gzip" }, payload });
    expect(comprimido.statusCode).toBe(200);
    expect(comprimido.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(comprimido.rawPayload).toString())).toEqual(normal.json());
    expect(comprimido.rawPayload.length).toBeLessThan(normal.rawPayload.length);
    const recusado = await app.inject({ method: "POST", url: "/v3/recommendations", headers: { "accept-encoding": "gzip;q=0" }, payload });
    expect(recusado.headers["content-encoding"]).toBeUndefined();
  });

  it("aceita outra ordem e rejeita árvores e políticas inválidas", async () => {
    for (const decorators of [[], ["compressao", "auditoria", "cache"]]) {
      expect((await app.inject({ method: "POST", url: "/v3/recommendations", payload: { ...payload, decorators } })).statusCode).toBe(200);
    }
    for (const alteracao of [{ decorators: ["invalido"] }, { decorators: ["cache", "cache"] },
      { servicoPrincipal: null }, { competencias: { edicao: "a" } }, { orcamento: 1 }, { prazo: "invalido" }, { id: "" }]) {
      expect((await app.inject({ method: "POST", url: "/v3/recommendations", payload: { ...payload, ...alteracao } })).statusCode).toBe(400);
    }
  });

  it.each([
    ["gzip;q=0.5", true], ["GZIP; q=1", true], ["*;q=0.8", true],
    ["gzip;q=0, *;q=1", false], ["gzip;q=0.0", false], ["gzip;q=invalid", false], ["br", false]
  ])("negocia Accept-Encoding %s", async (encoding, comprimir) => {
    const resposta = await app.inject({ method: "POST", url: "/v3/recommendations", headers: { "accept-encoding": encoding as string }, payload });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-encoding"]).toBe(comprimir ? "gzip" : undefined);
  });

  it("aplica a política padrão e rejeita JSON malformado", async () => {
    const { decorators: _decorators, ...padrao } = payload;
    const resposta = await app.inject({ method: "POST", url: "/v3/recommendations", payload: padrao });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().EDITOR).toHaveLength(2);
    const invalido = await app.inject({ method: "POST", url: "/v3/recommendations", headers: { "content-type": "application/json" }, payload: "{" });
    expect(invalido.statusCode).toBe(400);
  });

  it("mantém resultados independentes em requisições simultâneas com políticas diferentes", async () => {
    const respostas = await Promise.all(Array.from({ length: 12 }, (_, indice) => app.inject({
      method: "POST", url: "/v3/recommendations", headers: { "accept-encoding": "gzip" },
      payload: { ...payload, id: `p-${indice}`, decorators: indice % 2 ? ["cache", "auditoria"] : ["compressao", "cache", "auditoria"] }
    })));
    for (const [indice, resposta] of respostas.entries()) {
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers["content-encoding"]).toBe(indice % 2 ? undefined : "gzip");
      const conteudo = indice % 2 ? resposta.json() : JSON.parse(gunzipSync(resposta.rawPayload).toString());
      expect(conteudo.EDITOR).toHaveLength(2);
    }
  });
});
