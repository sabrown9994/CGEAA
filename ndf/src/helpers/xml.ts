import { readFileSync } from 'fs';

export function objectIdFromPath(objectPath: string): string {
  // src/Objects/customscript_foo.xml → customscript_foo
  return objectPath.replace(/^src\/Objects\//, '').replace(/\.xml$/, '');
}

function sdfPath(srcRelativePath: string): string {
  // src/FileCabinet/SuiteScripts/foo.js → ~/FileCabinet/SuiteScripts/foo.js
  if (!srcRelativePath.startsWith('src/')) {
    throw new Error(`Cannot convert non-src path to SDF path: ${srcRelativePath}`);
  }
  return srcRelativePath.replace(/^src\//, '~/');
}

export function generateDeployXml(scripts: string[], objects: string[]): string {
  const lines: string[] = ['<deploy>'];

  lines.push('    <configuration>');
  lines.push('        <path>~/AccountConfiguration/*</path>');
  lines.push('    </configuration>');

  if (scripts.length > 0) {
    lines.push('    <files>');
    for (const s of scripts) {
      lines.push(`        <path>${sdfPath(s)}</path>`);
    }
    lines.push('    </files>');
  }

  if (objects.length > 0) {
    lines.push('    <objects>');
    for (const o of objects) {
      lines.push(`        <path>${sdfPath(o)}</path>`);
    }
    lines.push('    </objects>');
  }

  lines.push('</deploy>');
  return lines.join('\n');
}

function extractBlock(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close);
  if (start === -1 || end === -1) return `${open}${close}`;
  return xml.slice(start, end + close.length);
}

function extractInner(xml: string, tag: string, fallback: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close);
  if (start === -1 || end === -1 || end <= start) return fallback;
  const inner = xml.slice(start + open.length, end).trim();
  return inner === '' ? fallback : inner;
}

export function generateManifestXml(existingManifestPath: string, changedObjectIds: string[]): string {
  const existing = readFileSync(existingManifestPath, 'utf-8');

  const projectName = extractInner(existing, 'projectname', 'NetSuite');
  const frameworkVersion = extractInner(existing, 'frameworkversion', '1.0');

  const featuresBlock = extractBlock(existing, 'features');
  const filesBlock = extractBlock(existing, 'files');

  const objectLines = changedObjectIds.map((id) => `      <object>${id}</object>`).join('\n');
  const objectsBlock = changedObjectIds.length > 0
    ? `<objects>\n${objectLines}\n    </objects>`
    : '<objects></objects>';

  return `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>${projectName}</projectname>
  <frameworkversion>${frameworkVersion}</frameworkversion>
  <dependencies>
    ${featuresBlock}
    ${objectsBlock}
    ${filesBlock}
  </dependencies>
</manifest>`;
}

/**
 * Remove self-provided objects from a manifest's `<dependencies><objects>` block.
 *
 * `project:adddependencies` re-adds the objects a deploy *ships* to `<dependencies><objects>`, as if
 * they were external objects that must already exist in the target account. On a first-time deploy
 * (every environment move / prod cutover of a new object) that fails account validation:
 * "The manifest contains a dependency on <id> object, but it is not in the account." `<dependencies>`
 * is meant to list only objects referenced-but-not-shipped, so any id NDF is itself deploying
 * (`objectIds`) must be stripped. Type-agnostic — fixes reportdefinition/financiallayout and any other
 * object SDF treats this way (savedsearch, dataset/workbook, …). Genuine external deps are untouched.
 * (FINT-17163)
 */
export function stripSelfProvidedDeps(manifestXml: string, objectIds: string[]): string {
  if (objectIds.length === 0) return manifestXml;
  const selfProvided = new Set(objectIds.map((id) => id.trim()));

  // Scope to <dependencies>…</dependencies> so a stray `<objects>`/`<object>` elsewhere (e.g. inside
  // a comment) can't be matched or corrupted.
  const depOpen = manifestXml.indexOf('<dependencies>');
  const depClose = manifestXml.indexOf('</dependencies>');
  if (depOpen === -1 || depClose === -1 || depClose <= depOpen) return manifestXml;
  const depStart = depOpen + '<dependencies>'.length;
  const deps = manifestXml.slice(depStart, depClose);

  // Removal-only transform: delete ONLY the plain `<object>id</object>` entries whose id is
  // self-provided (the shape SDF's `adddependencies` emits). Everything else — entries with
  // attributes, any unexpected shape, and all surrounding formatting — is left byte-for-byte intact,
  // so a genuine external dependency can never be dropped. (Rebuilding from a kept-allowlist would
  // silently lose anything the parser didn't recognize.)
  let newDeps = deps.replace(/[ \t]*<object>\s*([^<]+?)\s*<\/object>[ \t]*\n?/g, (whole, id: string) =>
    selfProvided.has(id.trim()) ? '' : whole,
  );
  // Collapse a now-emptied objects block to its canonical empty form.
  newDeps = newDeps.replace(/<objects>\s*<\/objects>/, '<objects></objects>');

  if (newDeps === deps) return manifestXml;
  return manifestXml.slice(0, depStart) + newDeps + manifestXml.slice(depClose);
}
