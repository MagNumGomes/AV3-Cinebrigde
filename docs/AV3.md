# AV3 — Relatório da atividade

## Objetivo e origem

A atividade foi implementada a partir do microsserviço TypeScript da AV2, tomando `../../docs/atv3.pdf` e `../../docs/diagrama-3.png` como referências. O código resultante está em `AV3-Cinebridge`, preservando todas as capacidades criacionais e comportamentais das etapas anteriores e integrando os três padrões estruturais (**Adapter**, **Composite** e **Decorator**). O [diagrama Mermaid](../../docs/diagrama-av3.md) registra os contratos e relacionamentos da implementação.

## 1. Análise crítica e refatorações

Um anti-padrão não é simplesmente a ausência de um padrão: é uma solução recorrente cujos efeitos negativos justificam uma refatoração. A análise abaixo distingue evidências presentes na base de riscos introduzidos pelos novos requisitos.

| Evidência/contexto | Risco ou anti-padrão | Refatoração na AV3 |
|---|---|---|
| `Projeto` armazenava apenas `papeisObrigatorios: Papel[]`; estratégias e orquestrador percorriam essa lista | Modelo plano insuficiente: tentativas de representar pacotes com listas paralelas e condicionais espalhados gerariam divergência de custo, prazo e papéis | `ServicoProjeto`, `ServicoAtomico` e `PacoteServico`; projeto delega custo e obtém papéis recursivamente da árvore |
| `RecommendationService` já coordena recomendação, sessões, substituições, convites e persistência | Risco de Objeto Deus se também receber SDKs, conversões monetárias, cache e compressão | Fluxo estrutural em `SistemaRecomendacao` com contratos de integração e estratégia injetados; detalhes de provedores ficam nos adaptadores |
| O repositório de profissionais existente já abstraía acesso a dados; pagamentos e armazenamento ainda não existiam | Acoplamento a fornecedores surgiria se APIs externas fossem chamadas diretamente no domínio | Duas implementações por contrato e simuladores com APIs heterogêneas; núcleo importa apenas interfaces |
| `RecomendacaoStrategy` já era extensível, mas não oferecia cache nem compressão | Duplicar o algoritmo em variantes como “com cache”, “com auditoria” e suas combinações causaria explosão de subclasses | Decoradores compostos dinamicamente, mantendo a interface e reutilizando o algoritmo de cosseno |
| Cache e auditoria poderiam ser globais para facilitar acesso | Estado global oculto prejudicaria isolamento e testes | Estado por instância, TTL/capacidade explícitos e função de auditoria injetada |

Não se adicionou Singleton ou uma nova hierarquia de fábricas para cada combinação de recursos: isso aumentaria complexidade sem atender a uma necessidade adicional.

## 2. Adapter

Arquivos: `src/adapters/storage.ts`, `payment.ts`, `professional.ts`.

- Armazenamento: salvar `Buffer` e metadados, recuperar uma cópia e listar por prefixo. S3 usa objetos com campos próprios; Google Cloud recebe argumentos posicionais.
- Pagamentos: valor em reais na interface de domínio; Stripe recebe centavos inteiros; PagSeguro recebe texto decimal. Status externos são normalizados para `aprovado`/`cancelado`. Repetir cancelamento retorna `false`.
- Profissionais: LinkedIn expõe `urn`, `fullName`, competências e avaliações em outro formato; o adaptador constrói `Profissional`, `Competencia` e `Avaliacao`. Os dois cadastros filtram por papel/disponibilidade e registram avaliações de 0 a 5.
- `SistemaRecomendacao` recebe os três adaptadores no construtor e permite substituí-los juntos via `configurarAdaptadores`. A mesma rotina de salvar, recuperar, pagar, consultar e cancelar funciona com ambos os conjuntos de provedores.

Os simuladores são a implementação pedida pelo enunciado, não clientes dos serviços reais. Seus dados duram enquanto suas instâncias existirem.

## 3. Composite

Arquivos: `src/domain/services.ts`, `entities.ts`, `projects.ts`; integração nas fábricas, validação (`ValidadorProjeto`) e normalização do orquestrador.

`Projeto` armazena um único `servicoPrincipal: ServicoProjeto`. O acesso `papeisObrigatorios` passa a ser uma projeção recursiva (`servicoPrincipal.obterPapeis()`), preservando os consumidores existentes das etapas anteriores; atribuir uma lista cria um pacote de compatibilidade com custo zero e um dia, enquanto o novo fluxo recebe custos e prazos explícitos. A árvore é a única fonte de verdade dos dados.

Exemplo demonstrado:

```text
Pós-produção (sequencial) = R$ 1.200 / 7 dias
├── Edição: R$ 500 / 3 dias
└── Finalização (paralela): R$ 700 / 4 dias
    ├── Mixagem: R$ 300 / 2 dias
    └── Efeitos visuais: R$ 400 / 4 dias
```

A validação percorre todos os filhos. A disponibilidade é uma propriedade do serviço atômico, e os candidatos profissionais também são filtrados por disponibilidade até a data final. Pacotes vazios e ciclos são recusados. A clonagem profunda mantém os tipos da árvore e isola alterações. O desserializador HTTP verifica tipos e limita a profundidade a 50 níveis.

## 4. Decorator

Arquivo: `src/recommendation/decorators.ts`.

- `RecomendadorBase` herda de `SimilaridadeCosseno`, mantendo a ponderação de competências (70%), gênero (20%) e avaliações (10%) da base original.
- `RecomendacaoDecorator` implementa a interface original `RecomendacaoStrategy` sem alterá-la. `pontuar` delega à estratégia interna; as funcionalidades transversais são aplicadas em `recomendar`.
- `CacheDecorator` armazena cópias profundas das listas do `Map`, evitando que o consumidor contamine futuras respostas. A chave SHA-256 inclui critérios do projeto, árvore e catálogo (desconsiderando apenas o ID para permitir reutilização entre projetos equivalentes). TTL e capacidade são configuráveis, e exceções não são armazenadas.
- `AuditoriaDecorator` usa `performance.now()` para duração e registra também falhas, preservando a exceção original. O registrador é uma função injetada.
- `CompressaoDecorator` serializa as entradas do `Map` como JSON e gera gzip. Um `WeakMap` associa os bytes ao resultado sem modificar a interface pública. O HTTP envia efetivamente os bytes e `Content-Encoding: gzip` quando o cliente aceita e o comprimido é menor que o JSON original.

### Efeito da ordem

| Configuração (interior → exterior) | Comportamento em repetição |
|---|---|
| `cache, auditoria, compressao` | Auditoria registra toda chamada; compressão executa também nos acertos |
| `compressao, cache, auditoria` | Cache reutiliza ranking e bytes comprimidos; auditoria registra toda chamada |
| `compressao, auditoria, cache` | Acerto é respondido pela camada externa; auditoria interna não é executada |

A alteração é feita por `configurarDecoradores` e `definirEstrategia`, sem mudar o sistema. A API permite preferências por requisição e mantém uma instância por configuração.

## 5. Testes de integração e resultados

| Requisito | Evidência executável |
|---|---|
| Trocar armazenamento/pagamento sem alterar negócio | `structural.integration.test.ts`: mesma instância de sistema e mesmo fluxo com S3/Stripe e GoogleCloud/PagSeguro |
| Traduzir interfaces de profissionais | Filtros, conversão de centavos/competências, avaliações, ausência de perfil e troca de cadastro |
| Custos/prazos em hierarquias | Três e dez níveis, pacotes paralelos/sequenciais, clonagem, remoção e total em centavos |
| Validação recursiva | Folhas inválidas, papel inválido, indisponibilidade, pacote vazio, ciclos, orçamento e prazo |
| Redução de tempo com cache | Estratégia instrumentada com atraso controlado de 40 ms; compara tempos e exige somente uma execução base |
| Validade do cache | TTL, limite, mudança de catálogo e orçamento, projetos equivalentes, limpeza, isolamento e exclusão de falhas |
| Auditoria completa e ordem | Sucesso e erro, duração não negativa, quantidade de registros conforme posição do cache nas 6 permutações |
| Compressão real | Descompactação gzip igual ao JSON original; payload menor, inclusive em acerto de cache |
| Integração HTTP | `structural-http.integration.test.ts` (`/v3/recommendations`): bytes gzip, negociação de encoding, política dinâmica e erros 400 |
| Regressão AV1/AV2 | Todas as 10 suítes anteriores continuam passando sem regressão (`factories`, `families-http`, `http`, `prototype`, `team-visitors`, `strategies`, `events-repositories`, `recommendation-service`, `recommendation-persistence`, `performance`) |

Verificação local concluída: `npm run prisma:generate`, `npm run typecheck`, `npm run build`, `npm run test:coverage`, `npm run demo` e `npm run demo:av2`. Total: **126 testes em 12 suítes**; **98,54% de linhas** e **90,46% de ramificações** cobertas. A demonstração reduziu o payload de 1.822 para 383 bytes.

## 6. Compatibilidade e execução

Usa APIs multiplataforma do Node e scripts npm sem comandos exclusivos de shell Unix. A configuração CI (`.github/workflows/ci.yml`) testa Windows e Ubuntu 24.04 com Node 22 e 24. O [README](../README.md) contém instalação, comandos e exemplos HTTP.
