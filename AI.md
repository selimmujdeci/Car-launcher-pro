# AI RULES — MUST FOLLOW
You must follow this file strictly.
Do not ignore any rule.
---
## MODE
STABILIZATION MODE active.
- No new features
- No UI redesign
- No big refactor
- One bug = one fix
---
## CORE RULE
Fix root cause, not symptoms.
---
## PATCH RULES
- Edit only necessary file(s)
- Prefer single file
- No unrelated changes
- Keep behavior unchanged unless required
- Always minimal patch
---
## LIMIT SAFETY
If interrupted:
CONTINUE_STATE:
- completed:
- remaining:
- next_step:
Next prompt:
"CONTINUE FROM CONTINUE_STATE"
Do not repeat work.
---
## NEVER LEAVE
- partial logic
- broken state transitions
- missing cleanup
- non-compiling code
- duplicate imports
- async without finally
---
## NAVIGATION RULES
Do NOT allow:
- navigation ACTIVE without route
- route without geometry
- fake GPS as real origin
- stale route replay
- wrong distance source
Route must:
- exist
- be visible
- match real provider
---
## MAP RULES
- no map actions before READY
- route must survive style change
- reapply after style.load
- no zombie instances
- no invisible click blockers
---
## GPS RULES
Single source: gpsService
Never show:
- route ready + no GPS
- ACTIVE + default GPS
---
## VOICE RULES
Must always exit clean:
- stopListening()
- setListening(false)
- clearTimeout()
- status = idle
Never stuck at "Hazır"
---
## PERMISSIONS
Android 13+:
- READ_MEDIA_AUDIO = required
- POST_NOTIFICATIONS = optional
Never block music for notification permission.
---
## PERFORMANCE
- no reroute spam
- no render storm
- no storage spam
- always cleanup
---
## REQUIRED AFTER PATCH
Run:
npx tsc --noEmit
---
## REAL DEVICE REQUIRED
Not done until:
- route visible
- navigation stable
- distance realistic
- voice not stuck
---
## OUTPUT FORMAT
Analysis:
Patch:
Test:
Next:
