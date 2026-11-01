# Cinebridge — AV3

Refatoração estrutural e extensão do microsserviço de recomendação da plataforma Cinebridge (`docs/atv3.pdf`), introduzindo os padrões **Adapter**, **Composite** e **Decorator** sobre a base consolidada nas atividades anteriores (AV1 e AV2).

## Executar

Requisitos: **Node.js 22 ou 24** e npm, compatível com Windows 10+ e Linux Ubuntu 24.04.03+ (e derivados).

```sh
cd AV3-Cinebridge
npm ci
npm run prisma:generate
npm run build
npm run demo
npm start
```

O microsserviço inicia em `http://localhost:3000`. Funciona integralmente em memória quando `DATABASE_URL` não está definida, sem exigir banco de dados ou credenciais externas.

## Padrões estruturais implementados (AV3)

| Padrão | Contratos e Classes |
|---|---|
| **Adapter (Armazenamento)** | `AdaptadorArmazenamento`, `AdaptadorS3` (`S3Simulado`), `AdaptadorGoogleCloud` (`GoogleCloudSimulado`) |
| **Adapter (Pagamento)** | `AdaptadorPagamento`, `AdaptadorStripe` (`StripeSimulado`), `AdaptadorPagSeguro` (`PagSeguroSimulado`) |
| **Adapter (Profissionais)** | `AdaptadorProfissional`, `AdaptadorLinkedIn` (`LinkedInSimulado`), `AdaptadorInterno` (`CadastroInternoSimulado`) |
| **Composite (Serviços)** | `ServicoProjeto`, `ServicoAtomico`, `PacoteServico`, `Projeto.servicoPrincipal` e `Projeto.calcularCustoTotal()` |
| **Decorator (Recomendação)** | `RecomendacaoStrategy` (inalterada), `RecomendadorBase`, `RecomendacaoDecorator`, `CacheDecorator`, `AuditoriaDecorator`, `CompressaoDecorator` |
| **Injeção e Orquestração** | `SistemaRecomendacao` (`configurarAdaptadores`, `definirEstrategia`, `recomendar`, `executarRecomendacao`) e `configurarDecoradores` |

Todos os padrões criacionais e comportamentais anteriores (Abstract Factory, Factory Method, Prototype, Strategy, Observer, Template Method e Visitor) permanecem ativos e integrados ao domínio.

## API HTTP

- **`POST /v3/recommendations`**: endpoint estrutural da AV3. Recebe o projeto com a árvore `servicoPrincipal` e a lista opcional `decorators` (`["cache", "auditoria", "compressao"]` em qualquer ordem) e negocia `Accept-Encoding: gzip`.
- **`POST /recommendations`**, **`/replacements`**, **`/reassess`**, **`/invitations/:papel/respond`** e **`GET /health`**: endpoints da base AV1/AV2 preservados.

Exemplo de chamada (AV3):

```sh
curl --compressed -X POST http://localhost:3000/v3/recommendations -H "Content-Type: application/json" --data-binary @examples/av3.json
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/v3/recommendations -ContentType 'application/json; charset=utf-8' -InFile examples/av3.json
```

## Verificação e testes

```sh
npm run typecheck
npm run test:coverage
npm run build
npm run demo
npm run demo:av2
```

- [Relatório técnico da AV3](docs/AV3.md)
- [Diagrama de classes e sequência da AV3](../docs/diagrama-av3.md)
