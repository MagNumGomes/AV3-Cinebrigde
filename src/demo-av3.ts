import { gunzipSync } from "node:zlib";
import { Papel, Projeto } from "./domain/entities";
import { PacoteServico, ServicoAtomico } from "./domain/services";
import { AdaptadorGoogleCloud, AdaptadorS3 } from "./adapters/storage";
import { AdaptadorPagSeguro, AdaptadorStripe } from "./adapters/payment";
import { AdaptadorInterno, CadastroInternoSimulado } from "./adapters/professional";
import { profissionaisDeExemplo } from "./repositories/professional-repository";
import { SistemaRecomendacao } from "./recommendation/structural-system";
import { configurarDecoradores, obterTransmissao, TipoDecorator } from "./recommendation/decorators";
import { RecomendadorBase } from "./recommendation/strategies";

const servicos = new PacoteServico("Pós-produção", [
  new ServicoAtomico("Edição", 500, 3, Papel.EDITOR),
  new PacoteServico("Finalização", [new ServicoAtomico("Mixagem", 300, 2, Papel.SONOPLASTA),
    new ServicoAtomico("Efeitos visuais", 400, 4, Papel.EFETOS_VISUAIS)], "paralela")
]);
const projeto = new Projeto("demo-av3", "drama", 2000, new Date(Date.now() + 30 * 86_400_000), servicos, { producao: 1 });
const profissionais = new AdaptadorInterno(new CadastroInternoSimulado(profissionaisDeExemplo()));
const sistema = new SistemaRecomendacao(new AdaptadorS3(), new AdaptadorStripe(), profissionais, new RecomendadorBase());
console.log("Composite:", { custo: projeto.calcularCustoTotal(), dias: servicos.obterPrazo(), valido: servicos.validar() });
for (const [armazenamento, pagamento] of [[new AdaptadorS3(), new AdaptadorStripe()],
  [new AdaptadorGoogleCloud(), new AdaptadorPagSeguro()]] as const) {
  sistema.configurarAdaptadores(armazenamento, pagamento, profissionais);
  const arquivo = sistema.salvarArquivo(Buffer.from("Roteiro de demonstração"), { prefixo: "projeto/" });
  const transacao = sistema.efetuarPagamento(projeto.calcularCustoTotal(), "produtor", "equipe");
  console.log("Adapter:", armazenamento.constructor.name, sistema.recuperarArquivo(arquivo).toString(), pagamento.constructor.name, sistema.verificarPagamento(transacao));
  sistema.cancelarPagamento(transacao);
}
const ordens: TipoDecorator[][] = [["cache", "auditoria", "compressao"], ["compressao", "auditoria", "cache"]];
for (const ordem of ordens) {
  sistema.definirEstrategia(configurarDecoradores(new RecomendadorBase(), ordem, (registro) => console.log("Auditoria:", registro)));
  for (let chamada = 0; chamada < 2; chamada++) {
    const resultado = sistema.recomendar(projeto);
    const { corpo, encoding } = obterTransmissao(resultado);
    const original = encoding ? gunzipSync(corpo) : corpo;
    console.log("Decorator:", ordem, { chamada, encoding, bytesOriginais: original.length, bytesTransmitidos: corpo.length });
  }
}
console.log("Equipe:", sistema.executarRecomendacao(projeto));
