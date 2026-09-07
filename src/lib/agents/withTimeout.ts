// A guaranteed timeout that actually cancels the underlying request,
// rather than merely abandoning it. The original version here just raced
// an already-constructed promise -- which correctly stopped the calling
// code from waiting past 60s, but left the real HTTP request running in
// the background. Confirmed directly from production: every Anthropic
// call across every run kept hitting its full timeout with a 100%
// failure rate, meaning that version would have let every one of those
// requests keep running (and, per the provider's own billing model,
// potentially keep generating tokens) with nothing left to ever read the
// result -- pure wasted spend on top of the reliability problem.
//
// makeRequest receives the AbortSignal to pass into the SDK's own
// `signal` request option; when the timer fires, the signal aborts,
// which the SDK's underlying fetch call honors as a real connection
// cancellation. Whether that actually stops billing is provider-specific
// (Anthropic/OpenAI's fetch-based clients genuinely tear down the
// connection, which for a streaming response should stop further token
// generation; Google's own SDK docs for @google/genai explicitly warn
// that AbortSignal there is "client-only" and usage may still be
// charged) -- but it is strictly better than doing nothing in every
// case, and a real fix rather than a client-side illusion in the
// Anthropic/OpenAI case specifically.
export function withTimeout<T>(
  makeRequest: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return makeRequest(controller.signal)
    .catch((err) => {
      if (controller.signal.aborted) {
        throw new Error(`${label} timed out after ${ms}ms`);
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}
