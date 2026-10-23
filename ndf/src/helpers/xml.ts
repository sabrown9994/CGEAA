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
