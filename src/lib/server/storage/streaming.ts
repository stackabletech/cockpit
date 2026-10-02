import { completeJob, failJob, updateJobProgress } from './job-store.js';
import { ndjsonLine } from './operations.js';
import type pino from 'pino';

export interface StreamableOpResult {
  results: Array<{ sourceKey: string; destKey: string }>;
  failed: Array<{ sourceKey: string; error: string }>;
}

type ProgressEventBase =
  | { type: 'progress'; sourceKey: string; destKey: string; loaded: number; total: number }
  | { type: 'done'; sourceKey: string; destKey: string }
  | { type: 'failed'; sourceKey: string; error: string };

type ProgressEvent = ProgressEventBase | { type: 'status'; message: string };

type EmitFn = (event: ProgressEvent) => void;

/**
 * Shared NDJSON streaming response helper.
 *
 * Sets up a ReadableStream that pipes progress/result events from an
 * async operation to the client. Handles job-store integration and
 * client disconnect gracefully.
 */
export function createProgressStream(
  operation: (emit: EmitFn) => Promise<StreamableOpResult>,
  options: {
    jobId?: string;
    operationName: string;
    logger: pino.Logger;
    bucket: string;
    /** Build the complete event payload. Defaults to `{ type: 'complete', results, failed }`. */
    buildCompletePayload?: (result: StreamableOpResult) => Record<string, unknown>;
  }
): Response {
  const encoder = new TextEncoder();
  let emitEvent: EmitFn = () => {};

  const operationPromise = operation((event) => emitEvent(event));

  const stream = new ReadableStream({
    async start(controller) {
      emitEvent = (event) => {
        if (options.jobId && event.type === 'progress') {
          updateJobProgress(options.jobId, { completedBytes: event.loaded });
        }

        try {
          controller.enqueue(encoder.encode(ndjsonLine(event)));
        } catch {
          // Controller closed (client disconnected) — operation continues
          // in the background unaffected.
        }
      };

      const result = await operationPromise;

      if (options.jobId) {
        if (result.failed.length > 0) {
          failJob(
            options.jobId,
            `Failed to ${options.operationName} ${result.failed.length} item(s)`
          );
        } else {
          completeJob(options.jobId, result);
        }
      }

      const completePayload = options.buildCompletePayload
        ? options.buildCompletePayload(result)
        : { type: 'complete', results: result.results, failed: result.failed };

      try {
        controller.enqueue(encoder.encode(ndjsonLine(completePayload)));
        controller.close();
      } catch {
        // Client already disconnected
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
}
