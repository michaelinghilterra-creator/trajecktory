---
{
  "schema": "trajecktory-runsheet/v1",
  "id": 417,
  "company": "Northwind Logistics",
  "role": "Director of Supply Chain Analytics",
  "stage": "Phone Screen",
  "round": 1,
  "template": "screen",
  "prep": "northwind-logistics-round-1-recruiter-screen.md",
  "generated": "2026-01-08",

  "session": {
    "who": "Marcus Ellery, Talent Acquisition Partner",
    "when": "2026-01-09T14:00:00-06:00",
    "minutes": 25,
    "format": "Phone",
    "rule": "Short answers. This is a filter, not the final. Save the hero for the HM."
  },

  "sections": [
    {
      "id": "opening",
      "n": 1,
      "title": "Opening and frame",
      "cues": [
        { "cue": "First 15 seconds", "answer": "opener" },
        { "cue": "Tell me about your background", "answer": "frame", "label": "60-sec pitch" }
      ]
    },
    {
      "id": "why",
      "n": 2,
      "title": "Why this, why you",
      "cues": [
        { "cue": "Why are you open to a move?", "answer": "whyMove" },
        { "cue": "Why this role / why us", "answer": "whyThem" }
      ]
    },
    {
      "id": "logistics",
      "n": 3,
      "title": "Comp, location, timing",
      "cues": [
        { "cue": "Comp expectations", "answer": "comp", "label": "Band first, theirs first" },
        { "cue": "Location and onsite days", "answer": "location" },
        { "cue": "Notice and start date", "answer": "notice" },
        { "cue": "Interviewing elsewhere?", "answer": "elsewhere" }
      ]
    },
    {
      "id": "softspots",
      "n": 4,
      "title": "Soft spots, answer straight",
      "cues": [
        { "cue": "The tooling gap on the JD", "answer": "toolGap" },
        { "cue": "The eleven-month stint", "answer": "shortStint" },
        { "cue": "The gap between roles", "answer": "gapYear" }
      ]
    },
    {
      "id": "blank",
      "title": "Blank? Bucket it, grab the default",
      "style": "panic",
      "cues": [
        { "cue": "The stall line + universal opener", "answer": "blank" },
        { "cue": "Failure, or a call you got wrong", "answer": "failureShort" },
        { "cue": "People, alignment, or conflict", "answer": "definition" },
        { "cue": "Influence, driving change, disagreeing up", "answer": "definition" }
      ]
    },
    {
      "id": "questions",
      "n": 5,
      "title": "Your questions",
      "cues": [
        { "cue": "MUST ASK, the process question", "answer": "qProcess" },
        { "cue": "The band, asked cleanly", "answer": "qBand" },
        { "cue": "What the hiring manager is actually worried about", "answer": "qHM" }
      ]
    }
  ],

  "answers": {
    "opener": {
      "title": "The warm open",
      "tag": "first 15 sec",
      "story": null,
      "seconds": 15,
      "spoken": [
        "\"Marcus, thanks for the call. Quick context before you drive: I've spent my career on carrier and lane performance data, so a Director of Supply Chain Analytics role is squarely the work I want. Happy to go wherever is useful.\""
      ],
      "notes": [
        "About 15 seconds, then **stop**. A screener has a form to get through.",
        "Do not open with the hero story. He is not the audience for it."
      ]
    },
    "frame": {
      "title": "60-second pitch",
      "tag": "tight, then stop",
      "story": null,
      "seconds": 60,
      "spoken": [
        "\"I'm a supply-chain analytics leader. Five years at Contoso Freight, analyst up to Director, ending accountable for the carrier performance data behind a large managed-freight book.",
        "The problem I get hired to solve is the one your posting describes: several systems that disagree about what a carrier actually costs, and no shared answer anyone trusts. I've built that shared answer once already, end to end.\""
      ],
      "notes": [
        "**Sixty seconds, not ninety.** The long frame belongs to the hiring-manager round.",
        "Name the problem, not the build. The build is what earns the next call."
      ]
    },
    "whyMove": {
      "title": "Why you are open",
      "tag": "no blame, forward-looking",
      "story": null,
      "seconds": 30,
      "spoken": [
        "\"I finished the thing I was brought in to build, and it's still running without me. What I want next is the version of that problem with more surface: more networks, more lanes, more of the measurement design sitting with me rather than handed down.\""
      ],
      "notes": [
        "**Never criticise the current employer.** A screener writes down tone, not content.",
        "Land it as pull toward something, not push away from something."
      ]
    },
    "whyThem": {
      "title": "Why this role",
      "tag": "specific, not flattering",
      "story": null,
      "seconds": 35,
      "spoken": [
        "\"Two things. The posting puts analytics inside the operations org rather than beside it, which is where the measurement decisions actually get made. And you've just taken a network in-house, so somebody has to build one performance picture across both sides.",
        "That second one is the job I'd want, and it's the job I've done.\""
      ],
      "notes": [
        "One specific, verifiable observation beats three paragraphs of enthusiasm.",
        "This sets up the scope question you ask at the end."
      ]
    },
    "comp": {
      "title": "Comp expectations",
      "tag": "band first, theirs first",
      "story": null,
      "seconds": 25,
      "spoken": [
        "\"Before I anchor us badly, do you have a band approved for this one? Happy to go first if not.\"",
        "**If pressed to go first:** \"Based on the scope in the posting I've been looking in the low-to-mid range for a director-level analytics seat in this market, and I'd rather calibrate against your band than guess at it.\""
      ],
      "notes": [
        "**Ask for their band first.** The screener usually has one and is allowed to say it.",
        "If you must go first, give a **range** and tie it to scope, never a single number."
      ]
    },
    "location": {
      "title": "Location and onsite",
      "tag": "one line",
      "story": null,
      "seconds": 20,
      "spoken": [
        "\"I'm set up for remote and I can be onsite for planning weeks and quarterly reviews. If the team is in-office on a fixed cadence, tell me the cadence and I'll tell you honestly whether it works.\""
      ],
      "notes": [
        "Answer, then stop. Do not negotiate the arrangement on a screen."
      ]
    },
    "notice": {
      "title": "Notice and start",
      "tag": "one line",
      "story": null,
      "seconds": 15,
      "spoken": [
        "\"Two weeks from a signed offer. Nothing complicated on my end.\""
      ],
      "notes": [
        "A one-line answer. Anything longer reads as a complication that is not there."
      ]
    },
    "elsewhere": {
      "title": "Interviewing elsewhere",
      "tag": "honest, unbothered",
      "story": null,
      "seconds": 20,
      "spoken": [
        "\"A couple of processes in flight, nothing at offer stage. Nothing that changes my interest here, but I'd rather you know than find out later.\""
      ],
      "notes": [
        "Honest and light. Do not manufacture urgency you cannot back up.",
        "Do not name the other companies."
      ]
    },
    "toolGap": {
      "title": "The tooling gap, answered straight",
      "tag": "name it, then reframe",
      "story": null,
      "seconds": 40,
      "spoken": [
        "\"Straight answer: I have not administered that TMS day to day, and I won't pretend I have.",
        "What I've owned is the layer above it, how a service failure gets attributed, how carrier data reconciles against the invoice, what a score is even allowed to be built from. That's the part your posting is asking for, and I'd partner with whoever owns the configuration.\""
      ],
      "notes": [
        "**Never bluff a tool you have not used.** A screener checks this against a list.",
        "Name the gap in the first sentence. Burying it reads as evasion."
      ]
    },
    "shortStint": {
      "title": "The eleven-month stint",
      "tag": "one pass, no defence",
      "story": null,
      "seconds": 30,
      "spoken": [
        "\"Fair question. The function was reorganised out about eleven months in and the analytics work moved to a shared service. I'd have stayed. It reads short because it was short, not because it went badly.\""
      ],
      "notes": [
        "**Say it once, then stop.** Circling back to it is what makes it look like a problem.",
        "Do not volunteer a second soft spot while explaining the first."
      ]
    },
    "gapYear": {
      "title": "The gap between roles",
      "tag": "flat and factual",
      "story": null,
      "seconds": 25,
      "spoken": [
        "\"Five months between roles. I was deliberate about the next one rather than taking the first thing, and I spent part of it rebuilding my SQL and modelling work properly. I can start immediately.\""
      ],
      "notes": [
        "Flat delivery. A gap is only a story if you perform it as one."
      ]
    },
    "blank": {
      "title": "Blank recovery",
      "tag": "buy a beat, then principle",
      "story": null,
      "seconds": 20,
      "spoken": [
        "**Buy the beat:** \"Let me think about the best example for that one.\" Two or three seconds is fine and reads as considered.",
        "**Then lead with how you work:** \"Generally I measure as close to the source as I can, I get the people being measured into the definition early, and I make sure every number has an obvious owner.\" A story almost always surfaces before you finish that sentence."
      ],
      "notes": [
        "On a screen you can also just ask for the question again. It costs nothing.",
        "A short principle answered calmly beats a long story delivered flustered."
      ]
    },
    "failureShort": {
      "title": "The routing rule, short version",
      "tag": "the short version",
      "story": 4,
      "seconds": 35,
      "spoken": [
        "\"I rolled a new routing rule out to every region at once with no pilot. Planners started overriding it by hand within a fortnight and my lane-cost number got worse, not better.",
        "I pulled it, ran one region first, and rebuilt it with the planners. Lesson: a control people work around is worse than no control.\""
      ],
      "notes": [
        "**Two sentences of miss, one of fix, one of lesson.** That is the whole screen version.",
        "The full telling is a round-2 answer. Do not spend it here."
      ]
    },
    "definition": {
      "title": "The 'on time' standoff, short version",
      "tag": "keep it to the standoff",
      "story": 7,
      "seconds": 35,
      "spoken": [
        "\"Operations and Procurement each believed they owned what 'on time' meant, so no shared carrier number could exist.",
        "Rather than pick one and mandate it, I published both definitions side by side for a quarter and let the gap between them make the argument. Both teams asked for the stricter one by week six.\""
      ],
      "notes": [
        "Reachable from two cues here, so the board will flag it. **Tell it once.**",
        "Covers people, alignment, conflict and influence questions equally well."
      ]
    },
    "qProcess": {
      "title": "MUST ASK: the process question",
      "tag": "must ask",
      "story": null,
      "spoken": [
        "\"What does the rest of the process look like, and who would I meet at each stage?\""
      ],
      "notes": [
        "**Mandatory.** It is the one question a screener is always equipped to answer.",
        "Write the names down. They are your prep list for the next round."
      ]
    },
    "qBand": {
      "title": "The band, asked cleanly",
      "tag": "asked cleanly",
      "story": null,
      "spoken": [
        "\"Is the range for this one approved, and is there flex in it for someone coming in above the bar?\""
      ],
      "notes": [
        "Ask once, on the screen, where it belongs. Do not carry it into the manager round."
      ]
    },
    "qHM": {
      "title": "What the hiring manager is worried about",
      "tag": "sets up the next call",
      "story": null,
      "spoken": [
        "\"When the hiring manager describes what is not working today, what does she say?\""
      ],
      "notes": [
        "The screener repeats the manager's own framing, often close to verbatim.",
        "This answer is the brief for your next round. Listen hard and write it down."
      ]
    }
  },

  "guardrails": [
    "Save the carrier scorecard for the manager round. One line here, no more",
    "Give a band and ask for theirs. Never name a single number first",
    "Nothing runs past a minute on a screen. Depth is what the next call is for"
  ]
}
---
# Debrief

> Written AFTER the call. This body is why a run sheet is `.md` and not `.json`.

## What landed

-

## What didn't

-

## Process facts captured

- Next round, who, when:
- Band, if given:

## Open questions for the next round

-
