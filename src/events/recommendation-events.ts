import { EventEmitter } from "node:events";
import { Papel } from "../domain/entities";

export type TipoEventoRecomendacao =
  | "profissional_recomendado"
  | "convite_aceito"
  | "convite_recusado";

export interface EventoRecomendacao {
  tipo: TipoEventoRecomendacao;
  projetoId: string;
  papel: Papel;
  profissionalId: string;
  recomendacaoId: string;
  ocorridoEm: string;
  tipoProjeto?: string;
  assunto?: string;
  mensagem?: string;
}

export interface Observador {
  atualizar(evento: EventoRecomendacao): void | Promise<void>;
}

/** Alias de compatibilidade com a nomenclatura da ATV I. */
export type Observer = Observador;

export interface EventBus {
  publicar(evento: EventoRecomendacao): void;
  inscrever(observer: Observador): () => void;
}

export interface Logger {
  info(dados: Record<string, unknown>, mensagem: string): void;
  warn(dados: Record<string, unknown>, mensagem: string): void;
  error(dados: Record<string, unknown>, mensagem: string): void;
}

export class ConsoleLogger implements Logger {
  info(dados: Record<string, unknown>, mensagem: string): void {
    console.info(JSON.stringify({ nivel: "info", mensagem, ...dados }));
  }

  warn(dados: Record<string, unknown>, mensagem: string): void {
    console.warn(JSON.stringify({ nivel: "warn", mensagem, ...dados }));
  }

  error(dados: Record<string, unknown>, mensagem: string): void {
    console.error(JSON.stringify({ nivel: "error", mensagem, ...dados }));
  }
}

export class EventEmitterBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor(private readonly logger: Logger) {}

  publicar(evento: EventoRecomendacao): void {
    this.emitter.emit("evento", evento);
  }

  inscrever(observer: Observador): () => void {
    const listener = (evento: EventoRecomendacao): void => {
      void Promise.resolve().then(() => observer.atualizar(evento)).catch((erro: unknown) => {
        this.logger.error({ erro: erro instanceof Error ? erro.message : String(erro) }, "Falha no observer");
      });
    };
    this.emitter.on("evento", listener);
    return () => this.emitter.off("evento", listener);
  }
}

export interface NotificationGateway {
  enviarEmail(evento: EventoRecomendacao): Promise<void>;
  enviarNotificacaoInterna(evento: EventoRecomendacao): Promise<void>;
}

export class NotificadorEmail implements Observador {
  constructor(private readonly gateway: NotificationGateway) {}

  atualizar(evento: EventoRecomendacao): Promise<void> {
    return this.gateway.enviarEmail(evento);
  }
}

export class NotificadorInterno implements Observador {
  constructor(private readonly gateway: NotificationGateway) {}

  atualizar(evento: EventoRecomendacao): Promise<void> {
    return this.gateway.enviarNotificacaoInterna(evento);
  }
}

export class AuditoriaRecomendacao implements Observador {
  constructor(private readonly logger: Logger) {}

  atualizar(evento: EventoRecomendacao): void {
    this.logger.info({ evento: "recomendacao", ...evento }, "Evento de recomendação auditado");
  }
}

export class LogNotificationGateway implements NotificationGateway {
  constructor(private readonly logger: Logger) {}

  async enviarEmail(evento: EventoRecomendacao): Promise<void> {
    this.logger.info({ canal: "email", ...evento }, "Notificação de email enfileirada");
  }

  async enviarNotificacaoInterna(evento: EventoRecomendacao): Promise<void> {
    this.logger.info({ canal: "interno", ...evento }, "Notificação interna enfileirada");
  }
}
