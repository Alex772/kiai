type MercadoPagoCause = {
  code?: unknown;
  description?: unknown;
  data?: unknown;
};

type ErrorLike = {
  message?: unknown;
  error?: unknown;
  status?: unknown;
  cause?: unknown;
};

function stringifyUnknown(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function describeError(error: unknown) {
  if (error instanceof Error && !('cause' in error)) {
    return error.message;
  }

  const errorLike = error as ErrorLike;
  const parts = [
    errorLike.message,
    errorLike.error ? `tipo=${stringifyUnknown(errorLike.error)}` : undefined,
    errorLike.status ? `status=${stringifyUnknown(errorLike.status)}` : undefined
  ].filter(Boolean);

  if (Array.isArray(errorLike.cause)) {
    const causes = errorLike.cause
      .map((cause) => {
        const item = cause as MercadoPagoCause;
        return [item.description, item.code ? `code=${stringifyUnknown(item.code)}` : undefined, item.data]
          .filter(Boolean)
          .map(stringifyUnknown)
          .join(' | ');
      })
      .filter(Boolean);

    parts.push(...causes);
  } else if (error instanceof Error && error.cause) {
    parts.push(describeError(error.cause));
  } else if (errorLike.cause) {
    parts.push(stringifyUnknown(errorLike.cause));
  }

  return parts.length > 0 ? parts.map(stringifyUnknown).join(' - ') : stringifyUnknown(error);
}

export function toUserErrorMessage(_error: unknown) {
  return 'Ocorreu um erro ao processar sua solicitação. Tente novamente em alguns instantes. Se o problema continuar, avise um administrador do servidor.';
}
