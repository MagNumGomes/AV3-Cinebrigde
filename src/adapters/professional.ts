import { Avaliacao, Competencia, Papel, Profissional } from "../domain/entities";
import { copiarProfundo } from "../domain/clone";

export interface CriteriosProfissional { papel?: Papel; prazo?: Date }
export interface AdaptadorProfissional {
  listarProfissionais(criterios: CriteriosProfissional): Profissional[];
  detalharProfissional(id: string): Profissional;
  registrarAvaliacao(id: string, avaliacao: Avaliacao): void;
}
function validarAvaliacao(avaliacao: Avaliacao): void {
  if (!Number.isFinite(avaliacao.nota) || avaliacao.nota < 0 || avaliacao.nota > 5 || !avaliacao.generoProjeto.trim()) throw new Error("Avaliação inválida");
}
function filtrar(profissionais: Profissional[], criterios: CriteriosProfissional): Profissional[] {
  return profissionais.filter((p) => (!criterios.papel || p.papeis.includes(criterios.papel))
    && (!criterios.prazo || !p.disponivelAte || p.disponivelAte >= criterios.prazo));
}

export class CadastroInternoSimulado {
  private readonly registros: Profissional[];
  constructor(profissionais: Profissional[] = []) { this.registros = copiarProfundo(profissionais); }
  todos(): Profissional[] { return copiarProfundo(this.registros); }
  avaliar(id: string, avaliacao: Avaliacao): void {
    const profissional = this.registros.find((p) => p.id === id);
    if (!profissional) throw new Error("Profissional não encontrado");
    profissional.avaliacoes.push(copiarProfundo(avaliacao));
  }
}
export class AdaptadorInterno implements AdaptadorProfissional {
  constructor(private readonly api = new CadastroInternoSimulado()) {}
  listarProfissionais(criterios: CriteriosProfissional): Profissional[] { return filtrar(this.api.todos(), criterios); }
  detalharProfissional(id: string): Profissional {
    const profissional = this.api.todos().find((p) => p.id === id);
    if (!profissional) throw new Error("Profissional não encontrado");
    return profissional;
  }
  registrarAvaliacao(id: string, avaliacao: Avaliacao): void { validarAvaliacao(avaliacao); this.api.avaliar(id, avaliacao); }
}

export interface PerfilLinkedIn {
  urn: string; fullName: string; contact: string; roles: Papel[]; genres: string[];
  skills: { label: string; level: number }[]; dailyRateCents: number; availableUntil?: string;
  reviews: { stars: number; genre: string; text?: string }[];
}
export class LinkedInSimulado {
  private readonly profiles: PerfilLinkedIn[];
  constructor(profiles: PerfilLinkedIn[] = []) { this.profiles = copiarProfundo(profiles); }
  search(): { elements: PerfilLinkedIn[] } { return { elements: copiarProfundo(this.profiles) }; }
  endorse(urn: string, review: PerfilLinkedIn["reviews"][number]): void {
    const profile = this.profiles.find((p) => p.urn === urn);
    if (!profile) throw new Error("Perfil LinkedIn não encontrado");
    profile.reviews.push({ ...review });
  }
}
export class AdaptadorLinkedIn implements AdaptadorProfissional {
  constructor(private readonly api = new LinkedInSimulado()) {}
  listarProfissionais(criterios: CriteriosProfissional): Profissional[] {
    return filtrar(this.api.search().elements.map((p) => new Profissional(p.urn, p.fullName, p.contact,
      p.roles, p.genres, p.skills.map((s) => new Competencia(s.label, s.level)),
      p.reviews.map((r) => new Avaliacao(r.stars, r.genre, r.text)), p.dailyRateCents / 100,
      p.availableUntil ? new Date(p.availableUntil) : undefined)), criterios);
  }
  detalharProfissional(id: string): Profissional {
    const profissional = this.listarProfissionais({}).find((p) => p.id === id);
    if (!profissional) throw new Error("Perfil LinkedIn não encontrado");
    return profissional;
  }
  registrarAvaliacao(id: string, avaliacao: Avaliacao): void {
    validarAvaliacao(avaliacao);
    this.api.endorse(id, { stars: avaliacao.nota, genre: avaliacao.generoProjeto, text: avaliacao.comentario });
  }
}
