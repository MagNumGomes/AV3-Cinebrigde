import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { copiarProfundo } from "../domain/clone";
import { Papel, Profissional, Projeto, PontuacaoProfissional } from "../domain/entities";
import { RecomendacaoStrategy } from "./strategies";

export type ResultadoRanking = Map<Papel, Profissional[]>;
const transmissoes = new WeakMap<ResultadoRanking, { original: Buffer; comprimido: Buffer }>();
export function serializarRanking(resultado: ResultadoRanking): Buffer {
  return Buffer.from(JSON.stringify(Object.fromEntries(resultado)), "utf8");
}
export function obterTransmissao(resultado: ResultadoRanking): { corpo: Buffer; encoding?: "gzip" } {
  const transmissao = transmissoes.get(resultado);
  const original = serializarRanking(resultado);
  return transmissao?.original.equals(original)
    ? { corpo: Buffer.from(transmissao.comprimido), encoding: "gzip" } : { corpo: original };
}
function copiarRanking(resultado: ResultadoRanking): ResultadoRanking {
  const copia = new Map([...resultado].map(([papel, lista]) => [papel, copiarProfundo(lista)]));
  const bytes = transmissoes.get(resultado);
  if (bytes) transmissoes.set(copia, { original: Buffer.from(bytes.original), comprimido: Buffer.from(bytes.comprimido) });
  return copia;
}

export abstract class RecomendacaoDecorator implements RecomendacaoStrategy {
  constructor(protected readonly interno: RecomendacaoStrategy) {}
  get nome(): string { return this.interno.nome; }
  pontuar(projeto: Projeto, papel: Papel, profissionais: Profissional[]): PontuacaoProfissional[] {
    return this.interno.pontuar(projeto, papel, profissionais);
  }
  abstract recomendar(projeto: Projeto, profissionais: Profissional[]): ResultadoRanking;
}

export class CacheDecorator extends RecomendacaoDecorator {
  private readonly cache = new Map<string, { expira: number; resultado: ResultadoRanking }>();
  acertos = 0;
  falhas = 0;
  constructor(interno: RecomendacaoStrategy, private readonly ttlMs = 60_000, private readonly capacidade = 100,
    private readonly agora: () => number = Date.now) {
    super(interno);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(capacidade) || capacidade < 1) throw new Error("Configuração de cache inválida");
  }
  recomendar(projeto: Projeto, profissionais: Profissional[]): ResultadoRanking {
    // IDs não afetam o ranking: projetos com os mesmos critérios podem compartilhar resultados.
    // Mantém árvore, prazo, orçamento e catálogo para invalidar resultados quando os dados mudam.
    const { id: _id, ...criterios } = projeto;
    const chave = createHash("sha256").update(JSON.stringify({ criterios, profissionais }, (_chave, valor: unknown) => {
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        return Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a.localeCompare(b)));
      }
      return valor;
    })).digest("hex");
    const entrada = this.cache.get(chave);
    if (entrada && entrada.expira > this.agora()) {
      this.acertos++;
      this.cache.delete(chave);
      this.cache.set(chave, entrada);
      return copiarRanking(entrada.resultado);
    }
    this.falhas++;
    this.cache.delete(chave);
    const resultado = this.interno.recomendar(projeto, profissionais);
    if (this.cache.size >= this.capacidade) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(chave, { expira: this.agora() + this.ttlMs, resultado: copiarRanking(resultado) });
    return resultado;
  }
  limpar(): void { this.cache.clear(); }
}

export interface RegistroAuditoria {
  projetoId: string; ocorridoEm: string; duracaoMs: number; sucesso: boolean; erro?: string;
}
export class AuditoriaDecorator extends RecomendacaoDecorator {
  constructor(interno: RecomendacaoStrategy, private readonly registrar: (registro: RegistroAuditoria) => void) { super(interno); }
  recomendar(projeto: Projeto, profissionais: Profissional[]): ResultadoRanking {
    const inicio = performance.now();
    let sucesso = false;
    let erro: string | undefined;
    try {
      const resultado = this.interno.recomendar(projeto, profissionais);
      sucesso = true;
      return resultado;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : String(falha);
      throw falha;
    } finally {
      this.registrar({ projetoId: projeto.id, ocorridoEm: new Date().toISOString(), duracaoMs: performance.now() - inicio, sucesso, erro });
    }
  }
}

export class CompressaoDecorator extends RecomendacaoDecorator {
  recomendar(projeto: Projeto, profissionais: Profissional[]): ResultadoRanking {
    const resultado = this.interno.recomendar(projeto, profissionais);
    const original = serializarRanking(resultado);
    const comprimido = gzipSync(original);
    // Dados muito pequenos podem crescer com gzip; nesse caso enviamos o JSON original.
    if (comprimido.length < original.length) transmissoes.set(resultado, { original, comprimido });
    else transmissoes.delete(resultado);
    return resultado;
  }
}

export type TipoDecorator = "cache" | "auditoria" | "compressao";
/** Ordem de construção: o último item torna-se a camada externa. */
export function configurarDecoradores(base: RecomendacaoStrategy, ordem: readonly TipoDecorator[],
  registrar: (registro: RegistroAuditoria) => void, ttlMs = 60_000): RecomendacaoStrategy {
  return ordem.reduce<RecomendacaoStrategy>((interno, tipo) => {
    switch (tipo) {
      case "cache": return new CacheDecorator(interno, ttlMs);
      case "auditoria": return new AuditoriaDecorator(interno, registrar);
      case "compressao": return new CompressaoDecorator(interno);
      default: throw new Error(`Decorator desconhecido: ${String(tipo)}`);
    }
  }, base);
}
