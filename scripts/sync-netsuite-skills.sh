#!/usr/bin/env bash
#
# sync-netsuite-skills.sh — vendor Oracle's SuiteCloud *Development* agent skills
# into CGEAA's skills/ directory, verbatim, from a pinned upstream commit.
#
# Source: https://github.com/oracle/netsuite-suitecloud-sdk
#         packages/agent-skills/ (agentskills.io spec, UPL-1.0 licensed)
#
# To update: bump PINNED_SHA to a newer upstream commit and re-run. The skill
# allowlist below is the single source of truth for *which* skills we ship —
# it deliberately excludes the "Business User Skills" (netsuite-ai-connector-
# instructions, netsuite-finance-analyst).

set -euo pipefail

# --- pinned upstream source -------------------------------------------------
UPSTREAM_REPO="oracle/netsuite-suitecloud-sdk"
PINNED_SHA="03d349ecbed3dd3f1f0557e964268d5d21663e68"   # master @ 2026-08-19
UPSTREAM_SUBDIR="packages/agent-skills"

# SuiteCloud Development Skills (allowlist — verbatim, no Business User skills)
SKILLS=(
  netsuite-owasp-secure-coding
  netsuite-sdf-project-documentation
  netsuite-sdf-roles-and-permissions
  netsuite-sdf-safe-guide
  netsuite-suitescript-learning
  netsuite-suitescript-records-reference
  netsuite-suitescript-upgrade
  netsuite-uif-spa-reference
)

# --- paths ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"

log()  { printf '  %s\n' "$*"; }
info() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar  >/dev/null 2>&1 || die "tar is required"

TARBALL_URL="https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${PINNED_SHA}"

info "Fetching ${UPSTREAM_REPO}@${PINNED_SHA}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$TARBALL_URL" -o "$TMPDIR/src.tar.gz" \
  || die "download failed: $TARBALL_URL"
tar -xzf "$TMPDIR/src.tar.gz" -C "$TMPDIR" \
  || die "extract failed"

# GitHub tarballs unpack into <repo>-<sha>/
EXTRACT_ROOT="$TMPDIR/netsuite-suitecloud-sdk-${PINNED_SHA}"
SRC_SKILLS="$EXTRACT_ROOT/$UPSTREAM_SUBDIR"
[ -d "$SRC_SKILLS" ] || die "expected $UPSTREAM_SUBDIR in tarball, not found"

mkdir -p "$SKILLS_DIR"

info "Vendoring ${#SKILLS[@]} SuiteCloud Development Skills into skills/"
for skill in "${SKILLS[@]}"; do
  src="$SRC_SKILLS/$skill"
  dest="$SKILLS_DIR/$skill"
  [ -d "$src" ] || die "skill '$skill' not found upstream (renamed or removed?)"
  [ -f "$src/SKILL.md" ] || die "skill '$skill' has no SKILL.md upstream"
  rm -rf "$dest"
  cp -R "$src" "$dest"
  log "$skill"
done

# Preserve UPL-1.0 attribution: vendor the upstream LICENSE next to the skills.
license_copied=""
for lic in LICENSE LICENSE.txt LICENSE.md; do
  if [ -f "$EXTRACT_ROOT/$lic" ]; then
    cp "$EXTRACT_ROOT/$lic" "$SKILLS_DIR/NETSUITE-SKILLS-LICENSE.txt"
    log "NETSUITE-SKILLS-LICENSE.txt (UPL-1.0)"
    license_copied=1
    break
  fi
done
[ -n "$license_copied" ] || die "upstream LICENSE not found — attribution required for UPL-1.0"

info "Done. Vendored from ${UPSTREAM_REPO}@${PINNED_SHA}"
log "Provenance is recorded in skills/NETSUITE-SKILLS.md"
