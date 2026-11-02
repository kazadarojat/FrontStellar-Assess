import type {
  BenchmarkEvent,
  BenchmarkRequest,
  ModelsResult,
  ValidationResult,
} from './types';

interface ApiFailure {
  message?: string;
  details?: string;
  status?: number;
  keyAdjusted?: boolean;
}

export class ApiError extends Error {
  status: number;
  details?: string;
  keyAdjusted?: boolean;

  constructor(message: string, status = 0, details?: string, keyAdjusted?: boolean) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.keyAdjusted = keyAdjusted;
  }
}

async function readError(response: Response): Promise<ApiError> {
  let payload: ApiFailure = {};
  try {
    payload = (await response.json()) as ApiFailure;
  } catch {
    // The server may have returned plain text or an empty body.
  }
  return new ApiError(
    payload.message || `Permintaan gagal (HTTP ${response.status}).`,
    payload.status || response.status,
    payload.details,
    payload.keyAdjusted,
  );
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Tidak dapat menghubungi server FrontStellar Assess lokal.');
  }

  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export function validateProvider(baseUrl: string, apiKey: string, signal?: AbortSignal) {
  return postJson<ValidationResult>('/api/validate', { baseUrl, apiKey }, signal);
}

export function validateProviderWithChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
) {
  return postJson<ValidationResult>('/api/validate-chat', { baseUrl, apiKey, model }, signal);
}

export function fetchAvailableModels(baseUrl: string, apiKey: string, signal?: AbortSignal) {
  return postJson<ModelsResult>('/api/models', { baseUrl, apiKey }, signal);
}

export async function streamBenchmark(
  input: BenchmarkRequest,
  onEvent: (event: BenchmarkEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Tidak dapat menghubungi server FrontStellar Assess lokal.');
  }

  if (!response.ok) throw await readError(response);
  if (!response.body) throw new ApiError('Server tidak mengirim stream hasil benchmark.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as BenchmarkEvent);
    } catch {
      // Ignore malformed, incomplete, or non-event lines.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    consumeLine(buffer + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
