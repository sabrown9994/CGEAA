import { describe, it, expect, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));

import { generateDeployXml, generateManifestXml, objectIdFromPath } from '../../helpers/xml.js';

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
});
