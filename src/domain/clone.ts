/** Copia o grafo de domínio, mantendo classes, datas e referências internas. */
export function copiarProfundo<T>(valor: T, vistos = new WeakMap<object, unknown>()): T {
  if (valor === null || typeof valor !== "object") return valor;
  if (vistos.has(valor)) return vistos.get(valor) as T;
  if (valor instanceof Date) {
    const data = new Date(valor.getTime());
    vistos.set(valor, data);
    return data as T;
  }
  const copia = Array.isArray(valor) ? [] : Object.create(Object.getPrototypeOf(valor));
  vistos.set(valor, copia);
  for (const chave of Object.keys(valor)) {
    Object.defineProperty(copia, chave, {
      value: copiarProfundo((valor as Record<string, unknown>)[chave], vistos),
      enumerable: true, writable: true, configurable: true
    });
  }
  return copia as T;
}
