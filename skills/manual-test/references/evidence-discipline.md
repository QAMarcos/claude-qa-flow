# Evidence discipline (non-negotiable)

A `PASS` backed by evidence that does not show what the sentence claims is worse than an honest
`BLOCKED`: it lands on the ticket, the developer trusts it, and the bug ships. Rules:

- **Evidence must prove the claim.** If the screenshot does not show the element in question, it
  does not support that item. A cropped screenshot of a toolbar does not prove "no modal appeared"
  — that needs the full viewport.
- **A failed interaction does not produce a new state.** If the click timed out, the next
  screenshot is the *previous* state. Labelling it "after the action" is fabricating evidence. Log
  the failure and mark the item `INCONCLUSIVE`.
- **Deduplicate before trusting.** Two screenshots from different steps with the same hash mean the
  interaction between them never happened. Cheap to check:

  ```bash
  # Linux / Git Bash (GNU coreutils) — prints only the duplicated files
  md5sum <evidence-dir>/*.png | sort | uniq -w32 -D

  # macOS (BSD tools) — look for repeated hashes in the sorted list
  shasum <evidence-dir>/*.png | sort
  ```

  ```powershell
  # Windows PowerShell
  Get-FileHash <evidence-dir>\*.png -Algorithm MD5 | Group-Object Hash | Where-Object Count -gt 1
  ```

  In a real run this exposed a "sort menu opened" screenshot that was byte-identical to the closed
  state — the menu had never opened.
- **Text dumps must come from the element, not from `body`.** `document.body.innerText` on a menu
  that never opened returns the page's cards, which looks like a valid list of options.
- **Absence inside a closed accordion/sheet proves nothing.** Collapsed content is often not in the
  DOM; "X not found" only counts if you expanded the container first.
- **Network claims are scoped to what you captured.** Only write "no request was fired" if the
  capture was global (blocklist). Otherwise write "no request to `<captured hosts>`".
- **Before writing each `PASS`, re-open the evidence you are about to cite** and confirm it shows
  the state described. This is the step executors skip most often.
- **If your model cannot view images, say so in the report** — never imply you looked at a
  screenshot you could not see. Back each visual claim with an element-scoped DOM read or a
  web-first assertion from the same run, list "screenshots not visually inspected" under *Could not
  verify*, and leave the pixels for a vision-capable reviewer or the user.
