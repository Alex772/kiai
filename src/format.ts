/**
 * Formata um valor numérico no padrão brasileiro (vírgula como separador decimal).
 * Ex: 9.9 -> "9,90"
 */
export function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Converte um texto digitado pelo usuário em número, aceitando tanto vírgula quanto ponto
 * como separador decimal. Ex: "9,90" -> 9.9 | "1.234,56" -> 1234.56 | "9.90" -> 9.9
 */
export function parsePrice(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');

  let normalized = trimmed;

  if (hasComma && hasDot) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = trimmed.replace(',', '.');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
