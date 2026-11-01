import { EventBus, EventoRecomendacao, Observador } from "./recommendation-events";

/** O observador de família formata e encaminha ao barramento; os gateways existentes entregam. */
export class NotificadorProjeto implements Observador {
  constructor(protected readonly bus: EventBus) {}
  atualizar(evento: EventoRecomendacao): void { this.bus.publicar(evento); }
}

abstract class NotificadorFamilia extends NotificadorProjeto {
  constructor(bus: EventBus, private readonly tipoProjeto: string, private readonly titulo: string) { super(bus); }
  override atualizar(evento: EventoRecomendacao): void {
    this.bus.publicar({ ...evento, tipoProjeto: this.tipoProjeto, assunto: this.titulo,
      mensagem: `${this.titulo}: ${evento.tipo} para ${evento.papel} no projeto ${evento.projetoId}.` });
  }
}

export class NotificadorDocumentario extends NotificadorFamilia {
  constructor(bus: EventBus) { super(bus, "documentario", "Equipe documental"); }
}
export class NotificadorAnimacao extends NotificadorFamilia {
  constructor(bus: EventBus) { super(bus, "animacao", "Equipe de animação e renderização"); }
}
export class NotificadorPublicitario extends NotificadorFamilia {
  constructor(bus: EventBus) { super(bus, "publicitario", "Equipe da campanha publicitária"); }
}
