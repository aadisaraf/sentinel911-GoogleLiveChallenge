# Sentinel-3 Demo Script

**Duration:** ~3 minutes  
**Goal:** Showcase every feature for hackathon judges

---

## Pre-Demo Setup
1. Open app at `localhost:5173`
2. Ensure microphone is enabled
3. Clear browser cache if needed
4. Have this script visible on second monitor

---

## Demo Script (Your Lines)

### Phase 1: Initial Contact (0:00-0:30)
**[Click ENGAGE SYSTEM, wait for "911 Emergency..." response]**

> *"Hello? I need help! There's been an explosion at 200 South Water Street, Henderson, Nevada!"*

**AI will:** `set_location` ONLY, then ask "What's the nature of the emergency?"
**What activates:** Map locks, Visual Recon starts

---

### Phase 2: Fire Confirmed (0:30-0:50)  
**[Answer the AI's question]**

> *"The building is on fire! There's smoke everywhere!"*

**AI will:** `dispatch_unit(fire)` ONLY, then ask "Is anyone injured?"
**What activates:** Fire units dispatch, ONE action in log

---

### Phase 3: Injuries Reported (0:50-1:15)
**[Report injuries when asked]**

> *"Yes! Three people are trapped on the second floor! They're waving from the windows!"*

**AI will:** `dispatch_unit(ambulance)` ONLY, then ask about hazards
**What activates:** Ambulance dispatch, Persons Involved updates

---

### Phase 4: Hazards Escalation (1:15-1:45)
**[Report additional threats - this triggers escalation]**

> *"There's a downed power line sparking! And I smell gas - the leak is getting worse!"*

**AI will:** `dispatch_unit(hazmat)` + `lockdown_sector` (escalation)
**What activates:** HAZMAT team, **Perimeter circle appears**, Threat Level updates

---

### Phase 5: Nearby Location (1:45-2:15)
**[Mention a specific nearby location - tests multi-marker]**

> *"The fire is spreading! There's the Henderson Convention Center right next door at 200 South Green Valley Parkway - people are evacuating!"*

**AI will:** `deploy_drones` for aerial view
**What activates:** Drones deployed, secondary location marker should appear nearby

---

### Phase 6: Resolution (2:15-2:45)
**[Calmer tone - show tone shift]**

> *"I can see the fire trucks arriving. Firefighters are setting up ladders. They're reaching the trapped people."*

**AI will respond reassuringly**
**What activates:** Voice Tone shifts to "Calm", incident updates

---

### Closing (2:45-3:00)

> *"They got everyone out safely! Thank you so much."*

**[Click END CALL]**

---

## Feature Checklist for Video

| Feature | Trigger | Visual Location |
|---------|---------|-----------------|
| Map Location Lock | Address mentioned | Center map panel |
| AI Voice Response | Any speech | Audio + transcript |
| Tool Calls | Incident details | Autonomous Actions Log |
| Autonomous Actions | AUTO: prefix items | Left panel |
| Visual Recon | Map has location | Map satellite image |
| Structured Extraction | Ongoing | Live Incident Board |
| Tone Detection | Voice analysis | Bottom of right panel |
| Smart City Commands | Analysis complete | Tactical Triage buttons |
| Pending → Success | Tool executes | Log status icons |

---

## Edge Cases to Show

1. **Multiple Addresses** - Mention primary + nearby locations
2. **Escalating Threat** - Start with fire, add gas leak = HAZMAT
3. **Tone Shift** - Start panicked, end calm
4. **Autonomous Actions** - Wait silently for 10s to see AUTO: items appear
5. **Interactive Commands** - Click a Smart City Command button

---

## Pro Tips

- **Pause between sentences** to let extraction catch up
- **Speak clearly** but with appropriate emotion
- **Wait 4-5 seconds** after details to see autonomous actions
- **Point out features verbally** in voiceover for judges

