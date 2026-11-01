import { randomUUID } from "node:crypto";

export interface AdaptadorArmazenamento {
  salvarArquivo(conteudo: Buffer, metadados: Record<string, string>): string;
  recuperarArquivo(id: string): Buffer;
  listarArquivos(prefixo: string): string[];
}

export class S3Simulado {
  private readonly objetos = new Map<string, { body: Buffer; metadata: Record<string, string> }>();
  putObject(input: { Key: string; Body: Buffer; Metadata: Record<string, string> }): void {
    this.objetos.set(input.Key, { body: Buffer.from(input.Body), metadata: { ...input.Metadata } });
  }
  getObject(input: { Key: string }): { Body: Buffer } {
    const objeto = this.objetos.get(input.Key);
    if (!objeto) throw new Error("Objeto S3 não encontrado");
    return { Body: Buffer.from(objeto.body) };
  }
  listObjects(input: { Prefix: string }): { Contents: { Key: string }[] } {
    return { Contents: [...this.objetos.keys()].filter((id) => id.startsWith(input.Prefix)).map((Key) => ({ Key })) };
  }
}

export class GoogleCloudSimulado {
  private readonly arquivos = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();
  upload(nome: string, bytes: Buffer, metadata: Record<string, string>): string {
    this.arquivos.set(nome, { bytes: Buffer.from(bytes), metadata: { ...metadata } });
    return nome;
  }
  download(nome: string): Buffer {
    const arquivo = this.arquivos.get(nome);
    if (!arquivo) throw new Error("Arquivo GCS não encontrado");
    return Buffer.from(arquivo.bytes);
  }
  files(prefix: string): string[] { return [...this.arquivos.keys()].filter((nome) => nome.startsWith(prefix)); }
}

export class AdaptadorS3 implements AdaptadorArmazenamento {
  constructor(private readonly api = new S3Simulado()) {}
  salvarArquivo(conteudo: Buffer, metadados: Record<string, string>): string {
    const Key = `${metadados.prefixo ?? ""}${randomUUID()}`;
    this.api.putObject({ Key, Body: conteudo, Metadata: metadados });
    return Key;
  }
  recuperarArquivo(id: string): Buffer { return this.api.getObject({ Key: id }).Body; }
  listarArquivos(prefixo: string): string[] { return this.api.listObjects({ Prefix: prefixo }).Contents.map((item) => item.Key); }
}

export class AdaptadorGoogleCloud implements AdaptadorArmazenamento {
  constructor(private readonly api = new GoogleCloudSimulado()) {}
  salvarArquivo(conteudo: Buffer, metadados: Record<string, string>): string {
    return this.api.upload(`${metadados.prefixo ?? ""}${randomUUID()}`, conteudo, metadados);
  }
  recuperarArquivo(id: string): Buffer { return this.api.download(id); }
  listarArquivos(prefixo: string): string[] { return this.api.files(prefixo); }
}
