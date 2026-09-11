import { buildProgram } from '../src/program.js';

buildProgram().parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
