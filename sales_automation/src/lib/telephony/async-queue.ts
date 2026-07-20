/**
 * AsyncQueue — bridges a push source (Twilio webhooks + Media Stream frames,
 * which arrive whenever the carrier decides) into the pull-based
 * `AsyncIterable<MediaEvent>` the orchestrator consumes.
 *
 * The webhook/websocket handlers call push()/close(); the orchestrator's
 * `for await` drains it. Backed by a simple value buffer + waiter list.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length) {
      this.waiters.shift()!({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}
