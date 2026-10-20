# SDF Dependency Resolution Behavior — Research Findings

**Date**: 2026-10-01  
**Environment**: FinSys/NetSuite on branch `cicd/ndf`, SDF account `CG-intQA`  
**Purpose**: Document real SuiteCloud CLI behavior for NDF auto-dependency resolution feature

---

## 1. `project:adddependencies` Behavior

**Account connection required?** NO  
The command runs offline without prompting for account credentials.

**Manifest modification?** NO (when no new dependencies detected)  
When run on a project with existing `<dependencies><objects>` entries and no new dependencies to add, the command:
- Outputs: `There are no dependencies to add to the manifest.xml file.`
- Does NOT modify `manifest.xml`

**ADD vs REQUIRE-EMPTY behavior?** INCONCLUSIVE  
Unable to observe the behavior when new dependencies exist, as the test case (existing dependencies, no new ones) resulted in no modification. Further testing needed with a scenario where new dependencies are actually detected.

---

## 2. Missing Object Dependency Error — Exact Text

**Command**: `suitecloud project:deploy` (and `project:validate`)

**VERBATIM error line**:
```
ERROR: The object reference [scriptid=<scriptid>] is missing in the project and also not included in the dependencies list.
```

**Example from test**:
```
ERROR: The object reference [scriptid=custscript_missing_test_record] is missing in the project and also not included in the dependencies list.
```

**Regex to extract script ID**:
```regex
ERROR: The object reference \[scriptid=([^\]]+)\] is missing in the project
```

**Capture group 1** yields the script ID to import (e.g., `custscript_missing_test_record`).

---

## 3. `project:validate --server` Parity

**Does `project:validate --server` report the same error as `project:deploy`?** YES

Both commands produce **identical error output** for missing object dependencies:
- Same error message format
- Same script ID in the error
- Same validation steps and failure indicators

**Note**: The CLI warns that `The "--server" option has no effect. Project validation is always performed on the server.` This means `project:validate` (without the flag) is sufficient for dry-run checks.

**Test evidence**: Both commands reported:
```
ERROR: The object reference [scriptid=custscript_missing_test_record] is missing in the project and also not included in the dependencies list.
```

---

## 4. Single-Object Import Confirmation

**Command**:
```bash
suitecloud object:import --scriptid <scriptid> --type ALL --destinationfolder /Objects
```

**Behavior**: Imports **exactly one object** as specified by the `--scriptid` argument.

**Test case**: 
```bash
suitecloud object:import --scriptid customrecord_custom_void_details --type ALL --destinationfolder /Objects
```

**Output**:
```
The imported objects will overwrite the project objects
The following objects have been imported:
    - customrecordtype:customrecord_custom_void_details
```

**Result**: Created file `NetSuite/src/Objects/customrecord_custom_void_details.xml`

**Confirmation**: ✅ Command imports the specified object successfully and creates the corresponding XML file.

---

## Implementation Recommendations

1. **Error detection regex**: Use the pattern above to extract missing script IDs from deploy/validate output.

2. **Validation before deploy**: Use `project:validate` (no --server flag needed) for dry-run checks in `--dry-run` mode.

3. **Import command**: The confirmed invocation for importing missing dependencies:
   ```bash
   suitecloud object:import --scriptid <extracted_scriptid> --type ALL --destinationfolder /Objects
   ```

4. **Cleanup**: Each imported object creates a new untracked file that must be staged (`git add`) before re-running deploy.

5. **Loop termination**: Set a maximum iteration count (e.g., 10) to prevent infinite loops if circular dependencies or other issues occur.

---

## Unresolved Questions

1. **`project:adddependencies` with new dependencies**: Does it ADD to existing `<objects>` or require the section to be empty? Needs testing with a scenario where the command actually detects new dependencies.

2. **Object type detection**: The import command requires `--type ALL`, but this may import more than necessary. Future optimization: detect specific object types from error messages if available.

3. **Circular dependencies**: How does SDF report circular dependency errors? Needs separate test case.

---

## Test State Restoration

✅ FinSys git status: clean (no uncommitted changes)  
✅ project.json defaultAuthId: `CG-intQA` (unchanged)  
✅ No scratch commits remaining  
✅ No imported files remaining
