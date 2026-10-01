import { describe, it, expect } from 'vitest';
import { parseMissingObjectRefs } from '../../helpers/dependency-parser.js';

const MISSING_ONE =
  'Validation of account settings failed.\n' +
  'The object reference [scriptid=customrecord_ndf_missing_test] is missing in the project and also not included in the dependencies list.';

const MISSING_TWO =
  'The object reference [scriptid=customrecord_a] is missing in the project and also not included in the dependencies list.\n' +
  'The object reference [scriptid=customlist_b] is missing in the project and also not included in the dependencies list.';

describe('parseMissingObjectRefs', () => {
  it('extracts a single missing object script id', () => {
    expect(parseMissingObjectRefs(MISSING_ONE)).toEqual(['customrecord_ndf_missing_test']);
  });

  it('extracts and dedupes multiple missing ids', () => {
    expect(parseMissingObjectRefs(MISSING_TWO)).toEqual(['customrecord_a', 'customlist_b']);
  });

  it('dedupes a repeated id', () => {
    const twice = MISSING_ONE + '\n' + MISSING_ONE;
    expect(parseMissingObjectRefs(twice)).toEqual(['customrecord_ndf_missing_test']);
  });

  it('returns empty array when no missing-object line is present', () => {
    expect(parseMissingObjectRefs('Some other error: deployment failed.')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseMissingObjectRefs('')).toEqual([]);
  });
});
