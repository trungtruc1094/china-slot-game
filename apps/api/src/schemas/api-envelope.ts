import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown())
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export interface ApiEnvelope<TData> {
  data: TData | null;
  error: ApiError | null;
  requestId: string;
}

export function okEnvelope<TData>(data: TData, requestId: string): ApiEnvelope<TData> {
  return {
    data,
    error: null,
    requestId
  };
}

export function errorEnvelope(error: ApiError, requestId: string): ApiEnvelope<never> {
  return {
    data: null,
    error,
    requestId
  };
}
