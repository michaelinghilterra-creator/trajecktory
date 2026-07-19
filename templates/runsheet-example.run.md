---
{
  "schema": "trajecktory-runsheet/v1",
  "id": 417,
  "company": "Northwind Logistics",
  "role": "Director of Supply Chain Analytics",
  "stage": "1st Interview",
  "round": 2,
  "template": "hm-round",
  "prep": "northwind-logistics-round-2-hiring-manager.md",
  "generated": "2026-01-15",

  "session": {
    "who": "Dana Whitfield, VP of Global Logistics",
    "when": "2026-01-16T10:30:00-06:00",
    "minutes": 30,
    "format": "Zoom",
    "rule": "One story per job. Click a cue. Eyes up."
  },

  "sections": [
    {
      "id": "opening",
      "n": 1,
      "title": "Opening and why",
      "cues": [
        { "cue": "First 15 seconds", "answer": "opener" },
        { "cue": "Tell me about your background", "answer": "frame", "label": "90-sec frame" },
        { "cue": "Why this role / why now", "answer": "whyThem" }
      ]
    },
    {
      "id": "hero",
      "n": 2,
      "title": "Hero story, use once",
      "style": "hero",
      "cues": [
        { "cue": "Biggest build / most impactful / proudest", "answer": "hero", "label": "CARRIER SCORECARD" }
      ]
    },
    {
      "id": "blank",
      "title": "Blank? Bucket it, grab the default",
      "style": "panic",
      "cues": [
        { "cue": "The stall line + universal opener", "answer": "blank" },
        { "cue": "Failure, or a call you got wrong", "answer": "routingRule" },
        { "cue": "People, alignment, or conflict", "answer": "definition" },
        { "cue": "Influence, driving change, disagreeing up", "answer": "definition" }
      ]
    },
    {
      "id": "behavioral",
      "n": 3,
      "title": "Behavioral, \"tell me about a time...\"",
      "cues": [
        { "cue": "A failure / went sideways", "answer": "routingRule" },
        { "cue": "Aligning teams that disagreed", "answer": "definition" },
        { "cue": "Getting the field to do what they didn't want", "answer": "adoption" }
      ]
    },
    {
      "id": "tradeoff",
      "n": 4,
      "title": "Tradeoff and tough",
      "cameraGap": true,
      "cues": [
        { "cue": "The tooling gap on the JD", "answer": "toolGap" },
        { "cue": "60 days in, the data can't support the scorecard", "answer": "dataGap" }
      ]
    },
    {
      "id": "questions",
      "n": 5,
      "title": "Your questions to ask",
      "cues": [
        { "cue": "MUST ASK, the scope question", "answer": "qScope" },
        { "cue": "Diagnose their pain", "answer": "qBreaks" }
      ]
    }
  ],

  "answers": {
    "opener": {
      "title": "The enthusiasm opener",
      "tag": "first 15 sec",
      "story": null,
      "seconds": 15,
      "spoken": [
        "\"Dana, thanks for making the time. I'll say up front, I'm genuinely excited about this one. The problem in your JD, three systems that disagree about landed cost, is the exact build I've done before and the work I care most about.\""
      ],
      "notes": [
        "About 15 seconds. Say it warmly, then **stop** and let them drive.",
        "Anchor the enthusiasm to a **specific reason**. Generic excitement reads as filler."
      ]
    },
    "frame": {
      "title": "90-second opening frame",
      "tag": "deliver near-verbatim",
      "story": null,
      "seconds": 90,
      "spoken": [
        "\"I'm a supply-chain analytics leader. Five years at Contoso Freight, analyst to Director, ending as the person accountable for the carrier performance data behind **$260M of managed freight spend** across four lanes.",
        "The problem I keep getting hired to solve is the one in your JD: **nobody could agree which carrier was actually performing.** Eleven carriers, four regional teams, and every team scored them off its own spreadsheet. I fixed it by moving the measurement to where the freight actually moved, then handing the scorecard to the people it judged.\""
      ],
      "notes": [
        "Lead with what you **built**, not what you held.",
        "This is the trailer for the hero story. Do not tell the whole thing here."
      ]
    },
    "whyThem": {
      "title": "Why this role, why now",
      "tag": "your read, not a claim",
      "story": null,
      "seconds": 45,
      "spoken": [
        "\"The way I read it, you've just brought a 3PL network in-house and you're hiring analytics into the operations org. That adds up to a specific need: **one performance picture across both networks, and soon.** That's the moment I want to join at.\""
      ],
      "notes": [
        "Frame as **your read**, never as a claim about their internals.",
        "Sets up the scope question you ask at the end."
      ]
    },
    "hero": {
      "title": "HERO: The carrier scorecard rebuild",
      "tag": "2.5 to 3 min",
      "story": 1,
      "hero": true,
      "useOnce": true,
      "seconds": 165,
      "spoken": [
        "\"Contoso Freight had no shared carrier scorecard. Eleven carriers, four regional teams, and each team ranked them off a spreadsheet it maintained itself. **Quarterly carrier reviews turned into spreadsheet duels, and nothing got decided.**",
        "Two moves. First, I moved measurement to the source: on-time and damage came straight off the dock scans and the telematics feed, so a score could not be edited after the fact. Second, the judgment call: the dashboard came last. I spent six weeks with the regional planners settling what 'on time' even meant, because a score nobody believes gets appealed instead of acted on.",
        "The result was the first carrier scorecard the whole network shared. **Two years on, procurement still runs the quarterly review off it.**\""
      ],
      "notes": [
        "**ONLY for \"biggest build / most impactful.\"** Never spend it on a behavioral prompt.",
        "This is the story they retell to the panel. Land it once, cleanly.",
        "If nothing opens it, steer there: \"the clearest example of what I'd bring is...\""
      ]
    },
    "blank": {
      "title": "Blank recovery",
      "tag": "stall, then principle",
      "story": null,
      "seconds": 20,
      "spoken": [
        "**Buy time out loud:** \"Good question, let me pick the best example.\" Three or four seconds of considered silence reads as thoughtful.",
        "**Then lead with the principle:** \"The way I work is, I measure at the source, I let the people being measured shape the definition, and I make the owner of every number obvious.\" By the time you finish that sentence, a story has usually surfaced."
      ],
      "notes": [
        "The pause is your friend. Rushing reads as over-rehearsed.",
        "A thoughtful principle plus a small example beats a rushed perfect story."
      ]
    },
    "routingRule": {
      "title": "The routing rule I shipped without a pilot",
      "tag": "lead with the miss",
      "story": 4,
      "seconds": 90,
      "spoken": [
        "\"I pushed a new routing rule to all four regions on a single day, with no pilot. The logic was sound and I wanted a clean cutover. That was the mistake.",
        "Within two weeks planners were overriding it by hand to protect their own service targets, and my lane-cost number got **less** accurate, not more. I pulled it back, ran it in one region first, and rebuilt the rule with the planners who had to live under it. The lesson: a control people work around is worse than no control. I shipped it, so the bad quarter of data was mine.\""
      ],
      "notes": [
        "**Lead with the miss, then the fix.** They need to see you surface problems early.",
        "Your default for any failure, judgment, or hard-call question."
      ]
    },
    "definition": {
      "title": "Operations vs Procurement on 'on time'",
      "tag": "let the gap argue",
      "story": 7,
      "seconds": 90,
      "spoken": [
        "\"Procurement wanted a single carrier performance number quickly, and the blocker wasn't technical: **Operations and Procurement each believed they owned what 'on time' meant.**",
        "The tempting move is to pick one and mandate it from analytics. I didn't, and I didn't run a workshop either. I published both definitions side by side on the same report for one quarter and let the gap between them argue. By week six both teams were asking for the stricter one, because they could finally see what the loose one had been hiding. **A number people pick beats a number people are handed.**\""
      ],
      "notes": [
        "Reachable from two cues here, so the renderer will flag it as a collision. **Tell it once.**"
      ]
    },
    "adoption": {
      "title": "Getting planners to adopt it",
      "tag": "field empathy",
      "story": 2,
      "seconds": 75,
      "spoken": [
        "\"I stopped asking for compliance and gave them something they wanted. The scorecard needed two extra fields at dock-in, so I cut five nobody had opened in years and wired the carrier picker to autofill from the booking.",
        "Net, a planner spent **less** time in the system than before, and the data I needed arrived as a by-product of work they were already doing. Adoption follows self-interest. A dataset that only feeds a dashboard rots the week you stop chasing it.\""
      ],
      "notes": [
        "Show you can drive discipline **without losing the field**."
      ]
    },
    "toolGap": {
      "title": "The tooling gap, answered straight",
      "tag": "honesty wins it",
      "story": null,
      "seconds": 75,
      "spoken": [
        "\"Let me be precise about my lane. What I've owned is the measurement design and the model behind it. What I have **not** done is administer that TMS day to day, and I won't pretend otherwise.",
        "Where I operate is the layer above the configuration: what gets measured, how a service failure gets attributed, how carrier data reconciles against the invoice. **That layer is the hard part, and it's where I've lived.**\""
      ],
      "notes": [
        "**Never bluff a tool you have not used.** One bluffed answer kills the candidacy; the honest lane wins it.",
        "Name the gap, then reframe to the layer the JD actually asks for."
      ]
    },
    "dataGap": {
      "title": "60 days in, the data can't support the scorecard",
      "tag": "their favourite question",
      "story": null,
      "seconds": 75,
      "spoken": [
        "\"I surface it immediately, with the gap sized. Not heroics, not silence. Here's what's missing, here's what it does to confidence in the number, here's the figure I actually stand behind and how wide the range around it is.",
        "Then a phased fix: definitions first, highest-spend lanes next, review cadence on the clean core. **It's a program, not a rescue. And the fastest way to lose an exec's trust is to let them find the gap before you tell them.**\""
      ],
      "notes": [
        "This is the \"will you protect my numbers\" question. Have it crisp."
      ]
    },
    "qScope": {
      "title": "MUST ASK: the scope question",
      "tag": "resolves their remit",
      "story": null,
      "spoken": [
        "\"Once the 3PL network is in-house, does analytics run one performance model across both networks, or a model per network with shared standards?\""
      ],
      "notes": [
        "**Mandatory.** It quietly reveals whether their own remit just expanded.",
        "Confirms or corrects the read you gave in your why-now answer."
      ]
    },
    "qBreaks": {
      "title": "What breaks first",
      "tag": "diagnose their pain",
      "story": null,
      "spoken": [
        "\"What breaks first today: on-time reliability, cost-to-serve visibility, or claims recovery?\""
      ],
      "notes": [
        "The question a person who has done the job asks.",
        "Their answer tells you what the first 90 days actually are. Listen hard."
      ]
    }
  },

  "guardrails": [
    "Q3 numbers ONLY. Q4 is not public until the February call",
    "Never bluff the TMS. Name the gap, reframe to the layer above it",
    "Do not raise comp in this round. It belongs with the recruiter"
  ]
}
---
# Debrief

> Written AFTER the call. This body is why a run sheet is `.md` and not `.json`.

## What landed

-

## What didn't

-

## Open questions for the next round

-

## New stories to add to the bank

-
