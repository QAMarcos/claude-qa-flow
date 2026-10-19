#!/usr/bin/env node
// Copies the skills (and the matching agent adapters) into the folders each harness reads.
// For Claude Code, prefer the plugin (see README); --target claude is the manual alternative.
//
// Usage: node scripts/install.mjs --target <opencode|codex|agents|claude> [--scope user|project] [--force] [--dry-run]
//
//   opencode  skills → ~/.config/opencode/skills   agents → ~/.config/opencode/agents
//   codex     skills → ~/.agents/skills            agents → ~/.codex/agents
//   agents    skills → ~/.agents/skills            (any harness that follows the Agent Skills standard)
//   claude    skills → ~/.claude/skills            agents → ~/.claude/agents  (+ prints the hook snippet)
//
// --scope project installs into the current directory (.opencode/, .agents/ + .codex/, .claude/).
// Existing destinations are skipped unless --force. Nothing outside those folders is touched.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);

const target = opt("target");
const scope = opt("scope") ?? "user";
const force = flag("force");
const dryRun = flag("dry-run");

const home = homedir();
const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
const base = scope === "project" ? process.cwd() : null;

const TARGETS = {
  opencode: {
    skills: base ? join(base, ".opencode", "skills") : join(xdg, "opencode", "skills"),
    agents: { from: join(ROOT, "adapters", "opencode", "agents"), to: base ? join(base, ".opencode", "agents") : join(xdg, "opencode", "agents") },
  },
  codex: {
    skills: join(base ?? home, ".agents", "skills"),
    agents: { from: join(ROOT, "adapters", "codex", "agents"), to: join(base ?? home, ".codex", "agents") },
  },
  agents: {
    skills: join(base ?? home, ".agents", "skills"),
  },
  claude: {
    skills: join(base ?? home, ".claude", "skills"),
    agents: { from: join(ROOT, "agents"), to: join(base ?? home, ".claude", "agents") },
    guard: join(base ?? home, ".claude", "qa-flow", "guard-tracker-writes.mjs"),
  },
};

if (!TARGETS[target] || !["user", "project"].includes(scope)) {
  console.error("Usage: node scripts/install.mjs --target <opencode|codex|agents|claude> [--scope user|project] [--force] [--dry-run]");
  process.exit(1);
}

const plan = TARGETS[target];
let skipped = 0;

function copy(from, to) {
  if (existsSync(to) && !force) { console.log(`skip (exists): ${to}`); skipped++; return; }
  console.log(`${dryRun ? "would copy" : "copy"}: ${from.slice(ROOT.length + 1)} → ${to}`);
  if (dryRun) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

for (const skill of readdirSync(join(ROOT, "skills"))) {
  copy(join(ROOT, "skills", skill), join(plan.skills, skill));
}

if (plan.agents) {
  for (const file of readdirSync(plan.agents.from)) {
    copy(join(plan.agents.from, file), join(plan.agents.to, file));
  }
}

if (plan.guard) {
  copy(join(ROOT, "scripts", "guard-tracker-writes.mjs"), plan.guard);
  const settings = scope === "project" ? ".claude/settings.json" : "~/.claude/settings.json";
  // A project settings file is shared with the team: reference the script portably.
  const hookPath = scope === "project" ? "$CLAUDE_PROJECT_DIR/.claude/qa-flow/guard-tracker-writes.mjs" : plan.guard.replace(/\\/g, "/");
  console.log(`
The role guard is copied but NOT enabled — this script never edits your settings.
To enable it, add this to ${settings} (or install the plugin instead, which wires it automatically):

  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|PowerShell",
        "hooks": [ { "type": "command", "command": "node \\"${hookPath}\\"" } ] }
    ]
  }
`);
}

if (skipped) console.log(`\n${skipped} destination(s) already existed — re-run with --force to overwrite.`);
console.log(dryRun ? "\nDry run — nothing was written." : "\nDone. Restart your harness so it picks up the new skills/agents.");
