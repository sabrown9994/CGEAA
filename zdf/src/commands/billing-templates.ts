import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { writeResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertReadSuccess, ZuoraReadResponse } from '../helpers/zuora-response.js';
import { RESOURCE_SUBFOLDERS } from '../constants.js';

const RESOURCE = 'billing-template';
const ENDPOINT = '/settings/invoice-templates';
const CONTENT_FIELD = 'base64EncodedTemplateFileContent';

/**
 * Fields accepted by `PUT /settings/invoice-templates/{id}`, per the documented request body
 * on docs.zuora.com (zuora-platform > settings-api > settings-api-tutorials >
 * invoice-template-settings > update-a-specific-invoice-template):
 *   { name, defaultTemplate, suppressZeroValueLine, templateFileName, base64EncodedTemplateFileContent }
 * `templateCategory` appears only in that page's *response* example, not the request body, so
 * it is deliberately excluded here. `associatedToBillingAccount` and `templateFormat` are
 * confirmed-rejected by live intQA (400 INVALID_USER_INPUT: "extraneous key ... is not
 * permitted"). `id`, `templateNumber`, and `updatedOn` are read-only/path-redundant and are
 * also excluded. This is an ALLOWLIST (not "resend everything minus a denylist") specifically
 * so future extraneous fields Zuora adds to the GET response don't leak into the PUT body.
 * Custom fields (`__c` suffix) are passed through in addition to this allowlist, matching the
 * convention in helpers/updatable-fields.ts (filterUpdatableFields) — see the loop below.
 */
const UPDATE_ALLOWLIST = ['name', 'defaultTemplate', 'suppressZeroValueLine', 'templateFileName'] as const;

/**
 * Optional fields accepted by `POST /settings/invoice-templates`, per the documented request
 * body on docs.zuora.com (zuora-platform > settings-api > settings-api-tutorials >
 * invoice-template-settings > create-a-new-invoice-template). `name` and
 * `base64EncodedTemplateFileContent` are required and built separately; `templateFormat` is
 * always sent as `'HTML'` (this CLI is HTML-only) and is likewise built separately, not via
 * this list.
 */
const CREATE_OPTIONAL_ALLOWLIST = ['defaultTemplate', 'suppressZeroValueLine', 'templateFileName'] as const;

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
export function sanitizeNameForFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\-_.]/g, '-');
  return cleaned.length > 0 ? cleaned : 'template';
}

/**
 * Thrown by findLocalFile when more than one local file matches an id. Distinguished from the
 * "no match" case (a plain Error) so callers that treat "nothing to clean up locally" as fine
 * can still surface an ambiguous-match warning instead of silently discarding it.
 */
export class MultipleMatchesError extends Error {}

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
    throw new MultipleMatchesError(
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
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('billing-template <id>')
    .description('Fetch an HTML invoice template from Zuora by internal ID and write its decoded design JSON')
    .action((id: string) =>
      runCommand(program, async () => {
        const data = await apiGet<InvoiceTemplateMetadata & ZuoraReadResponse>(`${ENDPOINT}/${encodeURIComponent(id)}`);
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

  createCmd
    .command('billing-template <name>')
    .description('Create an HTML invoice template in Zuora from a local design JSON file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/billing-templates/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        // Use the SAME sanitization as pull (sanitizeNameForFilename) for the default local file
        // name — not the raw `name` — so names with spaces or other disallowed characters (e.g.
        // "HTML - ZDF POC") resolve to a filename that file-io.ts's sanitizeSegment will accept
        // later on (both here and in the post-create rename below). Using the raw name would
        // make the post-create rename throw on any character outside [a-zA-Z0-9._-], leaving a
        // successfully-created remote record with no corresponding local file rename.
        const sanitizedName = sanitizeNameForFilename(name);
        const defaultPath = join(getOutputDir(), RESOURCE_SUBFOLDERS[RESOURCE], `${sanitizedName}.json`);
        const filePath = opts.file ?? defaultPath;
        if (!opts.file && !existsSync(filePath)) {
          throw new Error(
            `No local file found at ${filePath}. Create the design JSON there first, or provide --file <path>.`
          );
        }
        const designJson = readJsonFile(filePath);
        const encoded = Buffer.from(JSON.stringify(designJson), 'utf-8').toString('base64');

        const body: Record<string, unknown> = {
          name,
          [CONTENT_FIELD]: encoded,
          templateFormat: 'HTML',
        };
        // Optional create fields (defaultTemplate, suppressZeroValueLine, templateFileName)
        // may be present in the design JSON itself if a prior pull/edit set them; carry them
        // forward when present so create can round-trip a previously-pulled template.
        if (designJson && typeof designJson === 'object') {
          const parsedForOptions = designJson as Record<string, unknown>;
          for (const field of CREATE_OPTIONAL_ALLOWLIST) {
            if (field in parsedForOptions) {
              body[field] = parsedForOptions[field];
            }
          }
        }

        const res = await apiPost<InvoiceTemplateMetadata & ZuoraReadResponse>(ENDPOINT, body);
        assertReadSuccess(res, 'billing template create');

        const fileId = `${sanitizedName}_${res.id}`;
        if (!opts.file) {
          renameResourceFile(RESOURCE, sanitizedName, fileId);
        } else {
          writeResourceFile(RESOURCE, fileId, designJson);
        }
        output.success(`Billing template created. Zuora ID: ${res.id}`);
      })()
    );

  pushCmd
    .command('billing-template <id>')
    .description('Update an HTML invoice template in Zuora from a local design JSON file')
    .option('-f, --file <path>', 'path to JSON file (defaults to the local <name>_<id>.json under billing-templates/)')
    .action((id: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const filePath = opts.file ?? findLocalFile(id);
        const parsed = readJsonFile(filePath);
        const encoded = Buffer.from(JSON.stringify(parsed), 'utf-8').toString('base64');
        const encodedId = encodeURIComponent(id);

        // Fetch the template's current metadata first so we can (a) re-verify it's still an
        // HTML template and (b) carry forward writable fields like `name` that the PUT
        // contract expects. The PUT body itself is built from an ALLOWLIST of documented
        // request-body fields (see UPDATE_ALLOWLIST) — NOT "current minus a denylist" — because
        // the Settings API rejects any key it doesn't expect (confirmed live: 400
        // INVALID_USER_INPUT on `associatedToBillingAccount` and `templateFormat`).
        const current = await apiGet<InvoiceTemplateMetadata & ZuoraReadResponse>(`${ENDPOINT}/${encodedId}`);
        assertReadSuccess(current, 'billing template fetch (for update)');
        if (current.templateFormat !== 'HTML') {
          throw new Error(
            `billing-template supports HTML templates only; ${id} is ${String(current.templateFormat)}.`
          );
        }

        const body: Record<string, unknown> = { [CONTENT_FIELD]: encoded };
        for (const field of UPDATE_ALLOWLIST) {
          if (field in current) {
            body[field] = current[field];
          }
        }
        // Custom fields always pass through in addition to the allowlist above, consistent
        // with filterUpdatableFields' `key.endsWith('__c')` convention elsewhere in the codebase.
        for (const [key, value] of Object.entries(current)) {
          if (key.endsWith('__c')) {
            body[key] = value;
          }
        }

        // The Settings API PUT echoes the updated resource with no `success` envelope at all
        // on success (confirmed live: HTTP 200 with just the resource body) — unlike the
        // order/account/etc. write endpoints, which always return `{ success: true/false }`.
        // assertReadSuccess is the correct guard here: it treats "no `success` field and no
        // `reasons`/`errors`" as success, and only fails on an explicit `success === false` or
        // a populated `reasons`/`errors` array. Using the strict assertSuccess here was the bug
        // — a genuinely successful update has no `success` key, so assertSuccess always threw.
        const res = await apiPut<InvoiceTemplateMetadata & ZuoraReadResponse>(`${ENDPOINT}/${encodedId}`, body);
        assertReadSuccess(res, 'billing template update');
        output.success(`Billing template ${id} updated.`);
      })()
    );

  deleteCmd
    .command('billing-template <id>')
    .description('Delete an HTML invoice template in Zuora and remove its local file')
    .action((id: string) =>
      runCommand(program, async () => {
        const encodedId = encodeURIComponent(id);
        const res = await apiDelete<ZuoraReadResponse>(`${ENDPOINT}/${encodedId}`);
        assertReadSuccess(res, 'billing template delete');

        let localFile: string | undefined;
        try {
          localFile = findLocalFile(id);
        } catch (err) {
          // A missing local file is fine — nothing to clean up locally, and the remote delete
          // already succeeded above. An ambiguous match (multiple local files), however, is a
          // real condition the user should know about, so surface it as a warning rather than
          // silently discarding it the same way as "no match".
          if (err instanceof MultipleMatchesError) {
            output.warn(err.message);
          }
        }
        if (localFile) unlinkSync(localFile);

        output.success(`Billing template ${id} deleted.`);
      })()
    );
}
