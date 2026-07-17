---
{
  "schema": "trajecktory-runsheet/v1",
  "id": 417,
  "company": "Northwind Logistics",
  "role": "Director of Revenue Operations",
  "stage": "1st Interview",
  "round": 2,
  "template": "hm-round",
  "prep": "northwind-logistics-round-2-hiring-manager.md",
  "generated": "2026-01-15",

  "session": {
    "who": "Alex Chen, VP of Sales",
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
        { "cue": "Biggest build / most impactful / proudest", "answer": "hero", "label": "FORECAST REBUILD" }
      ]
    },
    {
      "id": "blank",
      "title": "Blank? Bucket it, grab the default",
      "style": "panic",
      "cues": [
        { "cue": "The stall line + universal opener", "answer": "blank" },
        { "cue": "Failure, or a call you got wrong", "answer": "badKpi" },
        { "cue": "People, alignment, or conflict", "answer": "definitions" },
        { "cue": "Influence, driving change, disagreeing up", "answer": "definitions" }
      ]
    },
    {
      "id": "behavioral",
      "n": 3,
      "title": "Behavioral, \"tell me about a time...\"",
      "cues": [
        { "cue": "A failure / went sideways", "answer": "badKpi" },
        { "cue": "Aligning teams that disagreed", "answer": "definitions" },
        { "cue": "Getting sellers to do what they didn't want", "answer": "adoption" }
      ]
    },
    {
      "id": "tradeoff",
      "n": 4,
      "title": "Tradeoff and tough",
      "cameraGap": true,
      "cues": [
        { "cue": "The tooling gap on the JD", "answer": "toolGap" },
        { "cue": "60 days in, the data can't support the forecast", "answer": "dataGap" }
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
        "\"Alex, thanks for making the time. I'll say up front, I'm genuinely excited about this one. The problem in your JD, three systems that disagree about what a booking is, is the exact build I've done before and the work I care most about.\""
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
        "\"I'm a revenue operations leader. Six years at Contoso Freight, IC to Director, ending as the person who owned the commercial data surface for a **$400M business** across three regions.",
        "The defining problem I solved is the one in your JD: **leadership couldn't trust the pipeline.** Three business units, three definitions of qualified, forecasting by anecdote. I fixed it by making process enforceable in the system, then governed it so it outlasted me.\""
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
        "\"The way I read it, you've just merged two sales orgs and you're hiring RevOps into the sales org. That adds up to a specific need: **one revenue operating model across both, and soon.** That's the moment I want to join at.\""
      ],
      "notes": [
        "Frame as **your read**, never as a claim about their internals.",
        "Sets up the scope question you ask at the end."
      ]
    },
    "hero": {
      "title": "HERO: The forecast rebuild",
      "tag": "2.5 to 3 min",
      "story": 1,
      "hero": true,
      "useOnce": true,
      "seconds": 165,
      "spoken": [
        "\"Contoso Freight had no commercial KPI baseline. Three business units, 90 sellers, and every leader had a different definition of qualified pipeline. **Forecast reviews were arguments about whose number was right, not decisions.**",
        "Two moves. First, I made qualification **enforceable instead of aspirational**: every stage mapped to a CRM field, so a deal could not progress without the evidence. Second, the judgment call: I did **not** start with infrastructure. I ran sessions where Finance and Sales co-authored the definitions, because a standard survives only if each function feels they wrote it.",
        "The result was the first commercial KPI baseline the company had. **Everything I built there is still running.**\""
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
        "**Then lead with the principle:** \"The way I approach that is, I listen and diagnose before I prescribe, I get the people affected to co-author the standard, and I make the accountability clear.\" By the time you finish that sentence, a story has usually surfaced."
      ],
      "notes": [
        "The pause is your friend. Rushing reads as over-rehearsed.",
        "A thoughtful principle plus a small example beats a rushed perfect story."
      ]
    },
    "badKpi": {
      "title": "The gate I shipped without a pilot",
      "tag": "lead with the miss",
      "story": 4,
      "seconds": 90,
      "spoken": [
        "\"I shipped a stage gate to all three business units on a single day, with no pilot. The logic was sound and I wanted a clean cutover. That was the mistake.",
        "Within two weeks reps were parking deals a stage early to dodge the gate, and my pipeline number got **less** accurate, not more. I paused the rollout, ran it in one unit first, and rebuilt the gate with the reps who had to live in it. The lesson: a control people route around is worse than no control. I shipped it, so the bad quarter of data was mine.\""
      ],
      "notes": [
        "**Lead with the miss, then the fix.** They need to see you surface problems early.",
        "Your default for any failure, judgment, or hard-call question."
      ]
    },
    "definitions": {
      "title": "Finance vs Sales on the definitions",
      "tag": "co-authorship, not mandate",
      "story": 7,
      "seconds": 90,
      "spoken": [
        "\"The exec team wanted one trusted set of numbers fast, and the blocker wasn't technical: **Finance and Sales each believed they owned the definitions.**",
        "The tempting move is to pick one and mandate it from ops. I didn't. I put both in a room and had them co-author the definitions, one at a time, until each function felt they'd helped write it. The result was a standard both sides defended, because it was theirs. **Mandates become shelfware. Co-authorship sticks.**\""
      ],
      "notes": [
        "Reachable from two cues here, so the renderer will flag it as a collision. **Tell it once.**"
      ]
    },
    "adoption": {
      "title": "Getting sellers to adopt it",
      "tag": "field empathy",
      "story": 2,
      "seconds": 75,
      "spoken": [
        "\"I stopped asking for compliance and gave them something they wanted. The gate added two fields per deal, so I cut four fields nobody read and wired the stage picker to autofill from the quote.",
        "Net, a rep spent **less** time in the CRM than before, and the data I needed arrived as a side effect of work they were already doing. Adoption follows self-interest. If hygiene only serves the dashboard, it decays the week you stop nagging.\""
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
        "\"Let me be precise about my lane. What I've owned is the architecture and the governance. What I have **not** done is administer that platform day to day, and I won't pretend otherwise.",
        "Where I operate is the layer above the config: who owns the catalog, how the approval matrix maps to a real discount ladder, how quote data flows into bookings. **That layer is the hard part, and it's where I've lived.**\""
      ],
      "notes": [
        "**Never bluff a tool you have not used.** One bluffed answer kills the candidacy; the honest lane wins it.",
        "Name the gap, then reframe to the layer the JD actually asks for."
      ]
    },
    "dataGap": {
      "title": "60 days in, the data can't support the forecast",
      "tag": "their favourite question",
      "story": null,
      "seconds": 75,
      "spoken": [
        "\"I surface it immediately, with a quantified gap analysis. Not heroics, not silence. Here's the gap, here's what it means for forecast confidence, here's the number I actually trust and the error bars around it.",
        "Then a phased fix: definitions first, highest-revenue-risk objects next, inspection cadence on the clean core. **The fix is a program, not a rescue. And the fastest way to lose a CEO's trust is to let them find the gap before you tell them.**\""
      ],
      "notes": [
        "This is the \"will you protect my forecast\" question. Have it crisp."
      ]
    },
    "qScope": {
      "title": "MUST ASK: the scope question",
      "tag": "resolves their remit",
      "story": null,
      "spoken": [
        "\"After the merge, does RevOps run one operating model across both orgs, or per-org models with shared governance?\""
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
        "\"What breaks first today: forecast reliability, pipeline visibility, or quoting speed?\""
      ],
      "notes": [
        "The question a person who has done the job asks.",
        "Their answer tells you what the first 90 days actually are. Listen hard."
      ]
    }
  },

  "guardrails": [
    "Q3 numbers ONLY. Q4 is not public until the February call",
    "Never bluff the quoting platform. Name the gap, reframe to the layer above it",
    "Do not raise comp in this round. It lands in the recruiter back-channel"
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
