# Report format

**Language rule:** every artifact shared with the team — report, evidence captions, screenshot
filenames, tracker comments, bug titles/bodies — is in **English**. Only the conversation with the
user may stay in their language. Strings quoted from the spec stay verbatim regardless of language.

## Human-readable block

```
Manual test — <ticket id or "ad-hoc"> | <env: staging/prod> | <PASS / FAIL / PARTIAL>
Environment / user / date. Scripts: <paths>. Evidence: <dir> (<n> screenshots).

Step 1: <description> — ✅ PASS / ❌ FAIL / ⚠️ BLOCKED / 🔗 BLOCKED-BY-DEPENDENCY / ❓ PO-DECISION / ⛔ INCONCLUSIVE
  Expected: <…>
  Observed: <…>
  Evidence: <file>.png  ← must show the state described above

Step 2: …

Findings: <numbered — for each: app bug, PO decision, or dependency block; tagged `blocking` or
          `non-blocking (Low)` with the severity-gate criterion in one line>
Could not verify: <what, and why — missing data, account tier, known bug in the way>
Summary: <one line — what worked, what didn't, what's still unverified>
Suggested next action: <…>
```

Keep step bodies to 2–3 lines.

## Status vocabulary — use the specific one

| Status | Meaning |
|---|---|
| `PASS` / `FAIL` | Verified today with the data and account available. |
| `BLOCKED` | Something stopped execution (known bug in the path, unreachable state). Say what would unblock it. |
| `BLOCKED-BY-DEPENDENCY` | The AC depends on backend/data from another ticket that has not shipped. **Never `FAIL`.** |
| `PO-DECISION` | Observed behaviour is defensible but the AC is ambiguous or contradicts a business rule. Becomes a question, not a bug. |
| `INCONCLUSIVE` | The interaction did not happen; there is no evidence to judge. Never disguise it as `PASS`. |

## Machine-checkable summary

End the report with this block so the orchestrator can check it mechanically instead of
re-interpreting prose:

```json
{
  "ticket": "<id or ad-hoc>",
  "env": "staging",
  "verdict": "PASS | FAIL | PARTIAL",
  "steps": [
    { "id": 1, "status": "PASS", "evidence": ["_local/evidence/<slug>/step-1-....png"], "note": "" }
  ],
  "findings": [
    { "title": "", "kind": "app-bug | po-decision | dependency", "severity": "blocking | non-blocking", "gate": "<criterion>" }
  ],
  "duplicate_screenshots": [],
  "scripts": ["_local/scripts/_manual-<slug>.spec.ts"]
}
```
