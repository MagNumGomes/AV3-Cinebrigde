import { Competencia, Papel, Profissional } from "./domain/entities";
import { ConsoleLogger, EventEmitterBus, AuditoriaRecomendacao } from "./events/recommendation-events";
import { RecommendationService } from "./recommendation/recommendation-service";
import { InMemoryProfessionalRepository, profissionaisDeExemplo } from "./repositories/professional-repository";

async function demonstrar(): Promise<void> {
  const bus = new EventEmitterBus(new ConsoleLogger());
  bus.inscrever(new AuditoriaRecomendacao(new ConsoleLogger()));
  const especialidades = [["pesquisa", "entrevista"], ["modelagem 3d", "animacao"], ["publicidade", "branding"]];
  const profissionais = profissionaisDeExemplo().filter((_, indice) => indice % 2 === 0)
    .flatMap((pessoa) => especialidades.map((nomes, indice) => new Profissional(
      `${pessoa.id}-${indice}`, `${pessoa.nome} (${nomes[0]})`, `${pessoa.id}-${indice}@cinebridge.local`,
      [...pessoa.papeis], ["documentario", "animacao", "publicitario"],
      nomes.map((nome) => new Competencia(nome)), [...pessoa.avaliacoes], pessoa.valorDiaria
    )));
  const service = new RecommendationService(new InMemoryProfessionalRepository(profissionais), bus, "similaridade");
  for (const tipo of ["documentario", "animacao", "publicitario"]) {
    const resultado = await service.recomendar({ tipo, genero: tipo, orcamento: 5000,
      prazo: new Date(Date.now() + 30 * 86_400_000).toISOString(), duracao: 10,
      papeisObrigatorios: [Papel.DIRETOR, Papel.EDITOR], restricoes: { diasProducao: 2 } });
    console.info(JSON.stringify({ tipo, classe: resultado.projeto.constructor.name, parcial: resultado.parcial,
      membros: resultado.membros.map((membro) => ({ papel: membro.papel, nome: membro.profissional.nome, motivo: membro.motivo })) }, null, 2));
  }
}

void demonstrar().catch((erro: unknown) => { console.error(erro); process.exitCode = 1; });
