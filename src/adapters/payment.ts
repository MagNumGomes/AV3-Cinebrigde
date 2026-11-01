import { randomUUID } from "node:crypto";

export type StatusPagamento = "aprovado" | "cancelado";
export interface AdaptadorPagamento {
  efetuarPagamento(valor: number, origem: string, destino: string): string;
  cancelarPagamento(id: string): boolean;
  verificarPagamento(id: string): StatusPagamento;
}

function validar(valor: number, origem: string, destino: string): void {
  if (!Number.isFinite(valor) || valor <= 0 || Math.round(valor * 100) < 1 || !origem.trim() || !destino.trim()) {
    throw new Error("Pagamento inválido");
  }
}

export class StripeSimulado {
  private readonly charges = new Map<string, { amount: number; source: string; destination: string; refunded: boolean }>();
  createCharge(input: { amount: number; source: string; destination: string }): { id: string } {
    const id = `ch_${randomUUID()}`;
    this.charges.set(id, { ...input, refunded: false });
    return { id };
  }
  retrieveCharge(id: string) {
    const charge = this.charges.get(id);
    if (!charge) throw new Error("Cobrança Stripe não encontrada");
    return { ...charge };
  }
  refund(id: string): boolean {
    const charge = this.retrieveCharge(id);
    if (charge.refunded) return false;
    this.charges.set(id, { ...charge, refunded: true });
    return true;
  }
}

export class PagSeguroSimulado {
  private readonly transacoes = new Map<string, { reais: string; comprador: string; vendedor: string; status: 3 | 7 }>();
  processar(reais: string, comprador: string, vendedor: string): string {
    const codigo = `ps_${randomUUID()}`;
    this.transacoes.set(codigo, { reais, comprador, vendedor, status: 3 });
    return codigo;
  }
  consultar(codigo: string) {
    const transacao = this.transacoes.get(codigo);
    if (!transacao) throw new Error("Transação PagSeguro não encontrada");
    return { ...transacao };
  }
  estornar(codigo: string): boolean {
    const transacao = this.consultar(codigo);
    if (transacao.status === 7) return false;
    this.transacoes.set(codigo, { ...transacao, status: 7 });
    return true;
  }
}

export class AdaptadorStripe implements AdaptadorPagamento {
  constructor(private readonly api = new StripeSimulado()) {}
  efetuarPagamento(valor: number, origem: string, destino: string): string {
    validar(valor, origem, destino);
    return this.api.createCharge({ amount: Math.round(valor * 100), source: origem, destination: destino }).id;
  }
  cancelarPagamento(id: string): boolean { return this.api.refund(id); }
  verificarPagamento(id: string): StatusPagamento { return this.api.retrieveCharge(id).refunded ? "cancelado" : "aprovado"; }
}

export class AdaptadorPagSeguro implements AdaptadorPagamento {
  constructor(private readonly api = new PagSeguroSimulado()) {}
  efetuarPagamento(valor: number, origem: string, destino: string): string {
    validar(valor, origem, destino);
    return this.api.processar((Math.round(valor * 100) / 100).toFixed(2), origem, destino);
  }
  cancelarPagamento(id: string): boolean { return this.api.estornar(id); }
  verificarPagamento(id: string): StatusPagamento { return this.api.consultar(id).status === 3 ? "aprovado" : "cancelado"; }
}
