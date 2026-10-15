/** Tarifas publicadas para Work/Codex, USD por 1 milhão de tokens. Fast equivale a 2× Standard em cobrança por token. */
export interface CodexModelPrice {
  id: string;
  label: string;
  input: number;
  cachedInput: number;
  output: number;
}

export const CODEX_MODEL_PRICES: readonly CodexModelPrice[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', input: 10, cachedInput: 1, output: 50 },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', input: 2, cachedInput: 0.1, output: 10 },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', input: 2, cachedInput: 0.2, output: 10 },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', input: 0.1, cachedInput: 0.01, output: 0.5 },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', input: 4, cachedInput: 0.4, output: 20 },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', input: 2, cachedInput: 0.2, output: 12 },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', input: 0.2, cachedInput: 0.02, output: 1.2 },
];

const BY_ID = new Map(CODEX_MODEL_PRICES.map((price) => [price.id, price]));

export interface CodexTokenUsage {
  input: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
}

/** Cache writes não são cobrados pelo rate card do Codex; cached input tem sua própria tarifa. */
export function codexStandardCostUSD(model: string | undefined, usage: CodexTokenUsage): number | undefined {
  const price = model ? BY_ID.get(model.toLowerCase()) : undefined;
  if (!price) return undefined;
  const cached = Math.max(0, usage.cachedInput);
  const writes = Math.max(0, usage.cacheWriteInput);
  const uncached = Math.max(0, usage.input - cached - writes);
  return ((uncached * price.input) + (cached * price.cachedInput) + (Math.max(0, usage.output) * price.output)) / 1_000_000;
}
