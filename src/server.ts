import { PrismaClient } from "@prisma/client";
import { config } from "./config";
import {
  AuditoriaRecomendacao,
  ConsoleLogger,
  EventEmitterBus,
  LogNotificationGateway,
  NotificadorEmail,
  NotificadorInterno
} from "./events/recommendation-events";
import { criarApp } from "./http/app";
import {
  CachedFallbackProfessionalRepository,
  InMemoryProfessionalRepository,
  PrismaProfessionalRepository,
  profissionaisDeExemplo
} from "./repositories/professional-repository";
import {
  InMemoryRecommendationPersistence,
  PrismaRecommendationPersistence,
  ResilientRecommendationPersistence
} from "./repositories/recommendation-persistence";

const logger = new ConsoleLogger();
const eventBus = new EventEmitterBus(logger);
const notificationGateway = new LogNotificationGateway(logger);
eventBus.inscrever(new NotificadorEmail(notificationGateway));
eventBus.inscrever(new NotificadorInterno(notificationGateway));
eventBus.inscrever(new AuditoriaRecomendacao(logger));

const fallback = new InMemoryProfessionalRepository(profissionaisDeExemplo());
const prisma = config.databaseUrl ? new PrismaClient() : undefined;
const repository = prisma
  ? new CachedFallbackProfessionalRepository(new PrismaProfessionalRepository(prisma), fallback, logger)
  : fallback;
const persistence = prisma
  ? new ResilientRecommendationPersistence(new PrismaRecommendationPersistence(prisma), new InMemoryRecommendationPersistence(), logger)
  : new InMemoryRecommendationPersistence();
const app = criarApp(repository, eventBus, config.defaultStrategy, persistence);

const encerrar = async (): Promise<void> => {
  await app.close();
  await prisma?.$disconnect();
};

process.once("SIGINT", () => void encerrar());
process.once("SIGTERM", () => void encerrar());

void app.listen({ host: config.host, port: config.port }).catch(async (erro: unknown) => {
  app.log.error(erro);
  await encerrar();
  process.exitCode = 1;
});