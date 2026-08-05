import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { apiGet, apiPut } from '../api/client.js';
import { writeResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, assertReadSuccess, ZuoraReadResponse, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { RESOURCE_SUBFOLDERS } from '../constants.js';

const RESOURCE = 'billing-template';
const ENDPOINT = '/settings/invoice-templates';
const CONTENT_FIELD = 'base64EncodedTemplateFileContent';

type InvoiceTemplateMetadata = {
  id: string;
  name: string;
  templateFormat: string;
  [key: string]: unknown;
};

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

/**
 * Loosely sanitizes a Zuora template name for use as a filename segment. This is
 * intentionally lossy (unlike file-io.ts's sanitizeSegment, which throws on any
 * disallowed character) — the id suffix is the authoritative key, so a mangled
 * name is acceptable as long as it doesn't blow up the pull.
 */
function sanitizeNameForFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\-_.]/g, '-');
  return cleaned.length > 0 ? cleaned : 'template';
}

function decodeAndValidateTemplateJson(id: string, template: InvoiceTemplateMetadata): unknown {
  if (template.templateFormat !== 'HTML') {
    throw new Error(
      `billing-template supports HTML templates only; ${id} is ${String(template.templateFormat)}.`
    );
  }
  const encoded = template[CONTENT_FIELD];
  if (typeof encoded !== 'string') {
    throw new Error(`Billing template ${id} response is missing ${CONTENT_FIELD}.`);
  }
  let decodedJson: unknown;
  try {
    const decodedStr = Buffer.from(encoded, 'base64').toString('utf-8');
    decodedJson = JSON.parse(decodedStr);
  } catch {
    throw new Error(
      `Billing template ${id} content did not base64-decode to valid JSON; nothing written.`
    );
  }
  return decodedJson;
}

/**
 * Finds the local file for a billing template id. Filenames are `<name>_<id>.json`
 * (see pull), so this scans the billing-templates/ folder for a file whose name
 * ends with `_<id>.json`.
 */
function findLocalFile(id: string): string {
  const dir = join(getOutputDir(), RESOURCE_SUBFOLDERS[RESOURCE]);
  const suffix = `_${id}.json`;
  const matches = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
  if (matches.length === 0) {
    throw new Error(
      `No local file found for billing template ${id} in ${dir}. Run 'zdf pull billing-template ${id}' first or provide --file <path>.`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple local files match billing template ${id}: ${matches.join(', ')}. Provide --file <path> to disambiguate.`
    );
  }
  return join(dir, matches[0]);
}

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON at ${path}: file may be malformed.`);
  }
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const listCmd = getOrCreate(program, 'list', 'List resources from Zuora');
  const updateCmd = getOrCreate(program, 'update', 'Update a resource in Zuora from a local file');

  pullCmd
    .command('billing-template <id>')
    .description('Fetch an HTML invoice template from Zuora by internal ID and write its decoded design JSON')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<InvoiceTemplateMetadata & ZuoraReadResponse>(`${ENDPOINT}/${id}`);
        assertReadSuccess(data, 'billing template fetch');
        const decodedJson = decodeAndValidateTemplateJson(id, data);

        const rawName = typeof data.name === 'string' ? data.name : id;
        const fileId = `${sanitizeNameForFilename(rawName)}_${id}`;
        writeResourceFile(RESOURCE, fileId, decodedJson);
        output.success(`Billing template ${id} written to ${resolveFilePath(RESOURCE, fileId)}`);
      })()
    );

  listCmd
    .command('billing-templates')
    .description('List invoice templates from Zuora (id, name, templateNumber, templateFormat)')
    .action(() =>
      runCommand(program, async () => {
        const data = await apiGet<InvoiceTemplateMetadata[] | ZuoraReadResponse>(ENDPOINT);
        if (!Array.isArray(data)) {
          assertReadSuccess(data, 'billing template list fetch');
          throw new Error('Unexpected response shape from billing template list fetch.');
        }
        for (const t of data) {
          const pullable = t.templateFormat === 'HTML' ? '' : '  (not pullable — WORD format)';
          output.info(`${t.id}  ${t.name}  #${String(t.templateNumber)}  ${t.templateFormat}${pullable}`);
        }
        output.success(`Fetched ${data.length} billing templates.`);
      })()
    );

  updateCmd
    .command('billing-template <id>')
    .description('Update an HTML invoice template in Zuora from a local design JSON file')
    .option('-f, --file <path>', 'path to JSON file (defaults to the local <name>_<id>.json under billing-templates/)')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const filePath = opts.file ?? findLocalFile(id);
        const parsed = readJsonFile(filePath);
        const encoded = Buffer.from(JSON.stringify(parsed), 'utf-8').toString('base64');

        // The Settings API PUT contract isn't documented as content-only, so we fetch the
        // template's current metadata first and resend it verbatim (minus read-only fields)
        // alongside the freshly re-encoded content, rather than guessing a minimal body.
        const current = await apiGet<InvoiceTemplateMetadata & ZuoraReadResponse>(`${ENDPOINT}/${id}`);
        assertReadSuccess(current, 'billing template fetch (for update)');
        if (current.templateFormat !== 'HTML') {
          throw new Error(
            `billing-template supports HTML templates only; ${id} is ${String(current.templateFormat)}.`
          );
        }

        const { id: _id, updatedOn: _updatedOn, success: _success, reasons: _reasons, errors: _errors, ...metadata } = current;
        const body = { ...metadata, [CONTENT_FIELD]: encoded };

        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${id}`, body);
        assertSuccess(res, 'billing template update');
        output.success(`Billing template ${id} updated.`);
      })()
    );
}
