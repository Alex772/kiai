export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

export type Duration = {
  amount: number;
  unit: DurationUnit;
};

const UNIT_ALIASES: Record<string, DurationUnit> = {
  min: 'minutes',
  mins: 'minutes',
  minuto: 'minutes',
  minutos: 'minutes',
  h: 'hours',
  hr: 'hours',
  hrs: 'hours',
  hora: 'hours',
  horas: 'hours',
  d: 'days',
  dia: 'days',
  dias: 'days',
  sem: 'weeks',
  semana: 'weeks',
  semanas: 'weeks',
  mes: 'months',
  mês: 'months',
  meses: 'months',
  ano: 'years',
  anos: 'years'
};

const UNIT_LABELS: Record<DurationUnit, [string, string]> = {
  minutes: ['minuto', 'minutos'],
  hours: ['hora', 'horas'],
  days: ['dia', 'dias'],
  weeks: ['semana', 'semanas'],
  months: ['mês', 'meses'],
  years: ['ano', 'anos']
};

/**
 * Converte um texto como "30 dias", "2semanas", "1 mes", "12h" em { amount, unit }.
 * Retorna undefined se o texto estiver vazio (usado para "sem duração" / permanente)
 * ou se não for um formato reconhecido.
 */
export function parseDuration(input: string): Duration | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  const match = trimmed.match(/^(\d+)\s*([a-zà-ú]+)$/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = UNIT_ALIASES[match[2]];

  if (!unit || !Number.isFinite(amount) || amount <= 0) return undefined;

  return { amount, unit };
}

export function formatDuration(duration: Duration): string {
  const [singular, plural] = UNIT_LABELS[duration.unit];
  return `${duration.amount} ${duration.amount === 1 ? singular : plural}`;
}

/** Soma a duração a uma data base, usando aritmética de calendário para mês/ano (não dias fixos). */
export function addDurationToDate(base: Date, duration: Duration): Date {
  const result = new Date(base.getTime());

  switch (duration.unit) {
    case 'minutes':
      result.setMinutes(result.getMinutes() + duration.amount);
      break;
    case 'hours':
      result.setHours(result.getHours() + duration.amount);
      break;
    case 'days':
      result.setDate(result.getDate() + duration.amount);
      break;
    case 'weeks':
      result.setDate(result.getDate() + duration.amount * 7);
      break;
    case 'months':
      result.setMonth(result.getMonth() + duration.amount);
      break;
    case 'years':
      result.setFullYear(result.getFullYear() + duration.amount);
      break;
  }

  return result;
}

/** Formata o tempo restante até uma data, tipo "3d 4h" ou "45min". Retorna "expirado" se já passou. */
export function formatRemaining(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'expirado';

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}min`);

  return parts.length > 0 ? parts.join(' ') : '<1min';
}
