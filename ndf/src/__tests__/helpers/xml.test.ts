import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));

import { generateDeployXml, generateManifestXml, objectIdFromPath, stripSelfProvidedDeps } from '../../helpers/xml.js';

describe('objectIdFromPath', () => {
  it('strips src/Objects/ prefix and .xml suffix', () => {
    expect(objectIdFromPath('src/Objects/customscript_foo.xml')).toBe('customscript_foo');
  });
});

describe('generateDeployXml', () => {
  it('generates targeted deploy.xml with scripts and objects', () => {
    const xml = generateDeployXml(
      ['src/FileCabinet/SuiteScripts/foo.js', 'src/FileCabinet/SuiteScripts/bar.js'],
      ['src/Objects/customscript_foo.xml'],
    );
    expect(xml).toContain('<deploy>');
    expect(xml).toContain('~/FileCabinet/SuiteScripts/foo.js');
    expect(xml).toContain('~/FileCabinet/SuiteScripts/bar.js');
    expect(xml).toContain('~/Objects/customscript_foo.xml');
    expect(xml).toContain('~/AccountConfiguration/*');
    expect(xml).toContain('</deploy>');
  });

  it('omits <files> when no scripts', () => {
    const xml = generateDeployXml([], ['src/Objects/customscript_foo.xml']);
    expect(xml).not.toContain('<files>');
    expect(xml).toContain('<objects>');
  });

  it('omits <objects> when no objects', () => {
    const xml = generateDeployXml(['src/FileCabinet/SuiteScripts/foo.js'], []);
    expect(xml).toContain('<files>');
    expect(xml).not.toContain('<objects>');
  });

  it('always includes <configuration>', () => {
    const xml = generateDeployXml([], []);
    expect(xml).toContain('<configuration>');
    expect(xml).toContain('~/AccountConfiguration/*');
  });

  it('converts src/ prefix to ~/ SDF prefix', () => {
    const xml = generateDeployXml(['src/FileCabinet/SuiteScripts/myscript.js'], []);
    expect(xml).toContain('~/FileCabinet/SuiteScripts/myscript.js');
    expect(xml).not.toContain('src/FileCabinet');
  });
});

describe('generateManifestXml', () => {
  const EXISTING_MANIFEST = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
    <objects>
      <object>old_object</object>
    </objects>
    <files>
      <file>/SuiteBundles/Bundle 123/somefile.js</file>
    </files>
  </dependencies>
</manifest>`;

  it('replaces <objects> with changed object IDs', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<object>customscript_new</object>');
    expect(xml).not.toContain('<object>old_object</object>');
  });

  it('preserves <features> verbatim', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<feature required="true">SERVERSIDESCRIPTING</feature>');
  });

  it('preserves <files> verbatim', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<file>/SuiteBundles/Bundle 123/somefile.js</file>');
  });

  it('generates empty <objects> when no changed objects', () => {
    mockReadFileSync.mockReturnValue(EXISTING_MANIFEST);
    const xml = generateManifestXml('/proj/src/manifest.xml', []);
    expect(xml).toContain('<objects>');
    expect(xml).toContain('</objects>');
    expect(xml).not.toContain('<object>');
  });

  it('uses projectname and frameworkversion from existing manifest', () => {
    const customManifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>FinTech</projectname>
  <frameworkversion>2.1</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
    <objects></objects>
    <files></files>
  </dependencies>
</manifest>`;
    mockReadFileSync.mockReturnValue(customManifest);
    const xml = generateManifestXml('/proj/src/manifest.xml', ['customscript_new']);
    expect(xml).toContain('<projectname>FinTech</projectname>');
    expect(xml).toContain('<frameworkversion>2.1</frameworkversion>');
    expect(xml).not.toContain('<projectname>NetSuite</projectname>');
    expect(xml).not.toContain('<frameworkversion>1.0</frameworkversion>');
  });

  it('falls back to NetSuite/1.0 when projectname/frameworkversion tags are missing', () => {
    const minimalManifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <dependencies>
    <features></features>
    <objects></objects>
    <files></files>
  </dependencies>
</manifest>`;
    mockReadFileSync.mockReturnValue(minimalManifest);
    const xml = generateManifestXml('/proj/src/manifest.xml', []);
    expect(xml).toContain('<projectname>NetSuite</projectname>');
    expect(xml).toContain('<frameworkversion>1.0</frameworkversion>');
  });

  it('falls back to NetSuite/1.0 when projectname/frameworkversion tags are empty', () => {
    const emptyTagsManifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname></projectname>
  <frameworkversion></frameworkversion>
  <dependencies>
    <features></features>
    <objects></objects>
    <files></files>
  </dependencies>
</manifest>`;
    mockReadFileSync.mockReturnValue(emptyTagsManifest);
    const xml = generateManifestXml('/proj/src/manifest.xml', []);
    expect(xml).toContain('<projectname>NetSuite</projectname>');
    expect(xml).toContain('<frameworkversion>1.0</frameworkversion>');
  });
});

describe('sdfPath defensive throw', () => {
  it('throws when path does not start with src/', () => {
    expect(() => generateDeployXml(['bad/path.js'], [])).toThrow('Cannot convert non-src path to SDF path: bad/path.js');
  });

  it('still converts valid src/ paths correctly', () => {
    const xml = generateDeployXml(['src/FileCabinet/SuiteScripts/foo.js'], []);
    expect(xml).toContain('~/FileCabinet/SuiteScripts/foo.js');
    expect(xml).not.toContain('src/FileCabinet');
  });
});

describe('stripSelfProvidedDeps', () => {
  const MANIFEST = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
    <objects>
      <object>customreport_1541_3595813_sb1_510</object>
      <object>customlayout_11815_3595813_sb1_927</object>
      <object>custrecord_external_dep</object>
    </objects>
    <files>
      <file>/SuiteScripts/foo.js</file>
    </files>
  </dependencies>
</manifest>`;

  it('removes objects NDF is shipping but keeps genuine external deps', () => {
    const out = stripSelfProvidedDeps(MANIFEST, [
      'customreport_1541_3595813_sb1_510',
      'customlayout_11815_3595813_sb1_927',
    ]);
    expect(out).not.toContain('<object>customreport_1541_3595813_sb1_510</object>');
    expect(out).not.toContain('<object>customlayout_11815_3595813_sb1_927</object>');
    expect(out).toContain('<object>custrecord_external_dep</object>'); // external dep preserved
    expect(out).toContain('SERVERSIDESCRIPTING');                      // features untouched
    expect(out).toContain('/SuiteScripts/foo.js');                     // files untouched
  });

  it('empties the objects block when every dep is self-provided (the FINT-17163 case)', () => {
    const out = stripSelfProvidedDeps(MANIFEST, [
      'customreport_1541_3595813_sb1_510',
      'customlayout_11815_3595813_sb1_927',
      'custrecord_external_dep',
    ]);
    expect(out).toContain('<objects></objects>');
    expect(out).not.toContain('<object>');
    expect(out).toContain('SERVERSIDESCRIPTING'); // rest of the manifest intact
  });

  it('returns the manifest unchanged when objectIds is empty', () => {
    expect(stripSelfProvidedDeps(MANIFEST, [])).toBe(MANIFEST);
  });

  it('is a no-op when there is no objects block', () => {
    const noObjects = '<manifest><dependencies><features></features><files></files></dependencies></manifest>';
    expect(stripSelfProvidedDeps(noObjects, ['customreport_x'])).toBe(noObjects);
  });

  it('leaves the block intact when the self-provided id is not present', () => {
    const out = stripSelfProvidedDeps(MANIFEST, ['customscript_not_here']);
    expect(out).toContain('<object>custrecord_external_dep</object>');
    expect(out).toContain('<object>customreport_1541_3595813_sb1_510</object>');
  });

  it('preserves an <object> entry that has attributes (removal-only — no data loss)', () => {
    const manifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <dependencies>
    <objects>
      <object type="customrecordtype">custrecord_external_dep</object>
      <object>customreport_1541_3595813_sb1_510</object>
    </objects>
  </dependencies>
</manifest>`;
    const out = stripSelfProvidedDeps(manifest, ['customreport_1541_3595813_sb1_510']);
    expect(out).not.toContain('customreport_1541_3595813_sb1_510'); // self-provided stripped
    // the attributed external dep must survive byte-for-byte (the bug: it used to vanish)
    expect(out).toContain('<object type="customrecordtype">custrecord_external_dep</object>');
  });

  it('ignores a decoy <objects> substring outside <dependencies> (e.g. in a comment)', () => {
    const manifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <!-- legacy note: once had <objects> here -->
  <dependencies>
    <objects>
      <object>customreport_1541_3595813_sb1_510</object>
      <object>custrecord_external_dep</object>
    </objects>
  </dependencies>
</manifest>`;
    const out = stripSelfProvidedDeps(manifest, ['customreport_1541_3595813_sb1_510']);
    expect(out).toContain('<!-- legacy note: once had <objects> here -->'); // comment untouched
    expect(out).not.toContain('<object>customreport_1541_3595813_sb1_510</object>'); // stripped
    expect(out).toContain('<object>custrecord_external_dep</object>'); // external dep kept
  });
});
