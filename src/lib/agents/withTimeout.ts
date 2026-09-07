// A guaranteed timeout, independent of whatever a provider SDK's own
// `timeout` request option actually does. Diagnosed directly from
// production: passing `{ timeout: 20_000 }` to the Anthropic SDK did NOT
// stop a hung call from running the cron route's full 60s to a hard
// kill -- the SDK-level option is kept alongside this (it may still help
// the SDK cancel the underlying request when it does work), but this
// Promise.race is what actually bounds how long the calling code waits.
// It can't cancel the original request's underlying resources, only stop
// awaiting it -- which is exactly what matters here: it lets the
// serverless function itself move on and return before the platform's
// own hard deadline kills it mid-request.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}
