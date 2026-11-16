import type { Context as HonoContext } from 'hono';

import type { JobDefinition, SimpleTriggerJobOptions } from './_internal/job';

export abstract class BaseJobProvider {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async triggerJob(_options: SimpleTriggerJobOptions): Promise<void> {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public defineJob<N extends string, T>(_job: JobDefinition<N, T>): void {
    throw new Error('Not implemented');
  }

  public getApiHandler(): (req: HonoContext) => Promise<Response | void> {
    throw new Error('Not implemented');
  }

  /**
   * Start the cron scheduler for any registered cron jobs.
   *
   * No-op for providers that handle cron scheduling externally (e.g. Inngest).
   * Must be called explicitly at application startup.
   */
  public async runCronOnce(_lookbackMs: number): Promise<void> {
    // No-op by default (providers with their own scheduler).
  }

  public startCron(): void {
    // No-op by default — providers override if needed.
  }
}
