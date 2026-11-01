import { FastifyInstance } from "fastify";
import { Projeto } from "../domain/entities";
import { lerServico } from "../domain/services";
import { AdaptadorS3 } from "../adapters/storage";
import { AdaptadorStripe } from "../adapters/payment";
import { AdaptadorInterno, CadastroInternoSimulado } from "../adapters/professional";
import { profissionaisDeExemplo } from "../repositories/professional-repository";
import { ApiError } from "../recommendation/recommendation-service";
import { SistemaRecomendacao } from "../recommendation/structural-system";
import { configurarDecoradores, obterTransmissao, TipoDecorator } from "../recommendation/decorators";
import { RecomendacaoStrategy, RecomendadorBase } from "../recommendation/strategies";

function aceitaGzip(header = ""): boolean {
  const encodings = header.split(",").map((parte) => {
    const [nome = "", ...parametros] = parte.trim().toLowerCase().split(";");
    const qualidade = parametros.find((parametro) => parametro.trim().startsWith("q="));
    const q = qualidade ? Number(qualidade.trim().slice(2)) : 1;
    return { nome: nome.trim(), q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  return ((encodings.find((item) => item.nome === "gzip") ?? encodings.find((item) => item.nome === "*"))?.q ?? 0) > 0;
}

export function registrarRotasEstruturais(app: FastifyInstance): void {
  const sistema = new SistemaRecomendacao(new AdaptadorS3(), new AdaptadorStripe(),
    new AdaptadorInterno(new CadastroInternoSimulado(profissionaisDeExemplo())), new RecomendadorBase());
  const pilhas = new Map<string, RecomendacaoStrategy>();
  app.post("/v3/recommendations", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || typeof body.id !== "string" || !body.id.trim()
      || typeof body.genero !== "string" || typeof body.orcamento !== "number" || typeof body.prazo !== "string") {
      throw new ApiError(400, "Informe id, genero, orcamento, prazo e servicoPrincipal");
    }
    const ordem = body.decorators ?? ["cache", "auditoria", "compressao"];
    if (!Array.isArray(ordem) || ordem.length > 3 || new Set(ordem).size !== ordem.length
      || ordem.some((tipo) => !["cache", "auditoria", "compressao"].includes(tipo))) throw new ApiError(400, "Decoradores inválidos");
    const competencias = body.competencias ?? {};
    if (!competencias || typeof competencias !== "object" || Array.isArray(competencias)
      || Object.values(competencias).some((peso) => typeof peso !== "number" || !Number.isFinite(peso) || peso < 0)) {
      throw new ApiError(400, "Competências inválidas");
    }
    let servico;
    try { servico = lerServico(body.servicoPrincipal); }
    catch (erro) { throw new ApiError(400, (erro as Error).message); }
    const projeto = new Projeto(body.id, body.genero, body.orcamento, new Date(body.prazo), servico,
      competencias as Record<string, number>);
    const chave = JSON.stringify(ordem);
    let estrategia = pilhas.get(chave);
    if (!estrategia) {
      estrategia = configurarDecoradores(new RecomendadorBase(), ordem as TipoDecorator[],
        (registro) => app.log.info(registro, "Auditoria AV3"));
      pilhas.set(chave, estrategia);
    }
    sistema.definirEstrategia(estrategia);
    const ranking = sistema.recomendar(projeto);
    const transmissao = obterTransmissao(ranking);
    reply.header("Vary", "Accept-Encoding").type("application/json; charset=utf-8");
    if (aceitaGzip(request.headers["accept-encoding"]) && transmissao.encoding) {
      reply.header("Content-Encoding", transmissao.encoding);
      return reply.send(transmissao.corpo);
    }
    return reply.send(Object.fromEntries(ranking));
  });
}
