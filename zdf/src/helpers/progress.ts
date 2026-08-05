import ora from 'ora';
type Ora = ReturnType<typeof ora>;

// Progress indicator for long pulls (multi-page fetches, dependency traversal, etc.).
//
// MUST be inert when stdout is not a TTY (piped/redirected output, CI, `npm test`) —
// an ANSI spinner writing control codes into a redirected stream or a test's captured
// stdout would corrupt output and could hang vitest waiting on an open interval timer.
// In that case every method below is a no-op.
//
// Kept as a single shared instance (rather than one per call site) so a caller can
// start/update/stop it around a paginating loop without juggling an ora instance, and so
// it never overlaps with `output.*` calls — `stop()` (or `succeed`/`fail`) must be called
// before any `output.*` call while the spinner is active, matching how ora itself expects
// to have the terminal line to itself.

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && process.env['ZDF_NO_PROGRESS'] !== '1';
}

let spinner: Ora | undefined;

/** Start (or restart) the progress indicator with the given initial text. No-op when not a TTY. */
export function startProgress(text: string): void {
  if (!isInteractive()) return;
  if (spinner) {
    spinner.text = text;
    return;
  }
  spinner = ora(text).start();
}

/** Update the progress indicator's text (e.g. current page/record count). No-op when not a TTY. */
export function updateProgress(text: string): void {
  if (!isInteractive() || !spinner) return;
  spinner.text = text;
}

/** Stop and clear the progress indicator, if any. Safe to call even if never started. */
export function stopProgress(): void {
  if (!spinner) return;
  spinner.stop();
  spinner = undefined;
}
