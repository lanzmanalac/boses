# Boses

**Live classroom captions in Taglish, running entirely on one cheap phone or any school laptop — no internet, no account, no cloud. And when class ends, the same on-device pipeline turns that lesson into a printed study sheet the student can actually learn from.**

Built for **AppBuildersPH Hackathon 2026 · Local AI**

---

## 0. The pitch

> "A deaf Filipino student sits in a class with no interpreter, no captioning, and no Wi-Fi. Everything said that day — the explanation, the example, the teacher's correction — happens once, out loud, and is then gone. Boses captures it locally, shows it as captions, and gives them the lesson on paper at the end of the period."

---

## 1. Why local AI — the mandatory submission answer

Every submission must answer: **Why does this benefit from running AI locally?**

Because three things break simultaneously in a Philippine classroom, and all three are fixed by moving inference to the device.

| Constraint in the classroom | What a cloud-captioning tool does about it |
| --- | --- |
| **Connectivity is unreliable.** Schools share limited uplinks; a class can lose signal mid-period, and projectors and internet-dependent tools are exactly what dies first | The captions stop. The student is left with a blank screen for the rest of the lesson — the worst possible time to fail |
| **Streaming latency compounds.** Captioning must keep pace with a teacher speaking at normal speed | Round-trip to a cloud endpoint adds latency that makes live captions feel unusable, and cost scales with every minute of every class, forever, per student |
| **A student's disability and everything discussed in class are deeply private.** Health information, family circumstances, peer conversations | Uploading a child's audio and the content of their lessons to a third-party server is a genuine privacy and data-protection problem in a school setting |
| **Most schools cannot pay per-minute speech API costs** at the scale of one device per student | A tool that costs money per minute of class is a tool that gets used for one demo and then abandoned |

**The rule we design around: after first load, Boses never contacts a network again. Captions keep appearing during an outage.**

All of the perception — streaming speech recognition, Taglish handling, confidence estimation, vocabulary extraction, and post-class summarization — runs on the student's own device via WebGPU/WASM. The only internet access in the product's entire lifetime is the one-time download of model weights.

**Why this is fundamental, not decorative:** if you take the network away from a cloud captioning product, you have a blank screen. If you take the network away from Boses, you have the same product, slightly slower on first run. The offline capability *is* the product — it is the only reason this tool can serve a student in a real Filipino classroom at all.

---

## 2. The problem

Thousands of deaf and hard-of-hearing Filipino students attend regular classes. The law recognizes Filipino Sign Language as the national language of the deaf and protects access for Deaf Filipino citizens, but the practical reality in most schools is thin:

- **Interpreters are scarce and expensive.** A full-time interpreter is not a budget line most schools have, so lip-reading and guesswork carry the lesson.
- **Text-only support lags behind.** Transcripts are usually produced days later, if at all, and in language-of-instruction materials rather than what was actually said in the room.
- **Classroom tech is cloud-shaped.** The captioning tools that exist are tied to an operating system or a paid cloud meeting suite, are English-first, and assume a connection that school infrastructure often cannot provide.
- **Taglish is the real language of the classroom.** Teachers switch between Filipino and English mid-sentence, constantly. English-first captioning collapses on exactly the content a student most needs.

And the part that is easy to miss: **a lesson is a one-time event.** The teacher explains once, gives one example, corrects once, and moves on. If the student misses it, the content is simply gone. A recording they can revisit is not a convenience — for a student who was excluded in real time, it is the difference between participating and not.

*Note on statistics: widely cited estimates place the number of deaf and hard-of-hearing Filipinos in the millions — a figure around 1.1 million is frequently quoted, from older national data. Verify and cite the current authoritative source before putting any number on a slide.*

---

## 3. What this is NOT — and how it avoids the obvious competitor category

Cloud captioning is dominated by **OS-bundled and meeting-suite captioning**: live captions inside a desktop operating system, inside a video-conferencing product, inside a presentation tool. That whole family shares a set of assumptions that are exactly wrong for this use case:

| Not this | Why the wrong shape here |
| --- | --- |
| **Desktop operating system captions** | Requires a specific OS on a specific machine. The realistic device in a Philippine classroom is a ₱3,000–8,000 Android phone, or whatever laptop the school already has |
| **Meeting-suite / video-conferencing captions** | Requires a meeting, an account, and a seat license. A classroom is not a meeting |
| **Slide-deck live captions** | Captions the slide being presented, not the teacher's actual explanation — which is where the lesson usually happens |
| **English-first speech services** | Taglish code-switching mid-sentence is the normal speech pattern of a Filipino classroom, and it is exactly what these handle worst |
| **Cloud-dependent streaming services** | Latency, per-minute cost, and a hard dependency on the connection the outage took away |
| **A generic speech-to-text utility** | Produces a wall of undifferentiated text. No vocabulary support, no confidence handling, no lesson artifact, no accessibility-specific output design |

**Bones of the product:** a device-agnostic offline PWA that understands Taglish, is honest about what it did not catch, and ends every class with a usable printed artifact — for a student whose entire access to the lesson depends on it.

*Honesty note:* this is a category-level positioning, not a verified head-to-head feature comparison of specific competing products. Do not claim you benchmarked named products unless you actually did.

---

## 4. Who it helps

| User | What they get |
| --- | --- |
| **Deaf / hard-of-hearing student (primary user)** | Live captions they can follow, and a printed lesson summary plus vocabulary list for everything they missed — without having to ask for help in front of a class |
| **Teacher** | Automatic record of what was actually explained, so the review materials match the real lesson rather than a planned one |
| **Parents and guardians** | A readable record of the day's lesson for a child who cannot tell them about it at home |
| **School guidance office** | A lightweight assistive tool deployable per device, with no account, seat license, or procurement conversation |
| **Hearing students in the same room** | A shared on-screen record — often used for review, and it reduces the need to ask the teacher to repeat things |

**Design stance:** the student is the user. The teacher is a stakeholder, not the customer. Accessibility products built for the institution rather than the person who needs them fail constantly.

---

## 5. What runs where

Everything marked **LOCAL** runs on the device with networking disabled.

| Stage | Where | Implementation |
| --- | --- | --- |
| Microphone capture, noise floor, VAD, segmenting speech turns | **LOCAL** (device) | `getUserMedia`, `AudioContext` + worklet, energy/silence-based VAD calibrated to the measured room noise floor. See Section 7, Step 0 |
| Streaming speech recognition | **LOCAL** | Whisper via `transformers.js` on **WebGPU**, WASM fallback |
| Lesson-vocabulary hotword biasing | **LOCAL** | Whisper hotword/prompt conditioning, seeded from the day's topic list |
| Language / code-switch handling | **LOCAL** | Tagalog + English lexicon, heuristic sentence tagging |
| Confidence estimation | **LOCAL** | Decoder token confidence → word-level reliability |
| **Gap marking** | **LOCAL** | Low-confidence spans replaced with a visible marker, never guessed |
| Vocabulary extraction | **LOCAL** | Local embeddings + phrase scoring; optional stopword and frequency filtering |
| Post-class summary | **LOCAL LLM** *(optional layer)* | `web-llm` (Qwen2.5-1.5B) WebGPU, **numbers and names injected, never generated** |
| Print layout (large type, high contrast) | **LOCAL** | Print stylesheet, A4 |
| Storage of sessions | **LOCAL** | IndexedDB, per-device, user-deletable |
| Static hosting of the app shell | Cloud (optional) | Any static host. Also runs from a USB stick or cached PWA |
| **Data egress** | **NONE** | Audio, transcript, and student data never leave the device |

### The local-LLM boundary rule

The optional local LLM writes prose **only around content it is handed**. It never invents a fact, a number, or a term, and it never touches the caption stream — captions are produced by the ASR layer and are never regenerated. Consequence for the demo: switch the LLM off mid-class, and captions keep running and the printed summary still generates from the deterministic template.

---

## 6. How it works

```
[Phone or laptop — airplane mode, on the student's desk]

  Microphone (device mic — no special hardware)                <- Section 7, Step 0
        |
        v
  [0] LOCAL noise budget: SNR estimate + gating                <- device
        |     -> below-threshold segments become gaps, never guesses
        v
  [1] LOCAL VAD: segment into utterances, normalize gain      <- device
        |
        v
  [2] LOCAL streaming ASR (WebGPU/WASM) + hotword biasing
        |     -> words with confidence
        v
  [3] LOCAL Taglish handling: tagalog / English / mixed spans
        |
        v
  [4] LOCAL gap marking: low-confidence spans -> [ ? ] markers
        |
        v
  [5] LOCAL on-screen live caption (large type, high contrast,
        adjustable, speaker-turn aware where possible)
        |
        +=============================+
                                      |
  [class ends]                       |  (live, throughout)
        |                            |
        v                            |
  [6] LOCAL vocabulary extraction: key terms, Taglish pairs,    |
        low-confidence words the student likely missed          |
        |                            |
        v                            |
  [7] LOCAL lesson summary (deterministic template,             |
        + OPTIONAL local LLM prose around injected facts)       |
        |                            |
        v                            |
  [8] LOCAL printable study sheet: summary, vocabulary,          |
        "ask about this tomorrow" list, full transcript        |
```

**No step has a cloud dependency.** The optional summary layer degrades to a deterministic template. The caption stream never depends on any of steps 6–8.

---

## 7. Step details

### Step 0 — The noise budget

**Why this section exists at all:** a classroom is loud, and noise is not merely a quality problem here — it attacks the product's core promise. Whisper's characteristic failure under noise is **hallucination**: noisy or near-silent input produces fluent, confident, fabricated text. Noise also tends to *inflate* confidence. So the exact input that degrades quality is the input that makes your uncertainty signal lie, which breaks Step 4 precisely when it matters most. If the app is going to be honest about gaps, it has to be honest about noise first.

#### Know the two kinds of noise

They get confused constantly, and they need different answers:

| Type | What it is | Can DSP fix it? |
| --- | --- | --- |
| **Steady noise** — HVAC, fans, hum, rain, traffic | Continuous, stationary | **Mostly yes.** Filtering and gating genuinely work |
| **Competing speech** — other students, group work, overlapping talk | Speech-like, intermittent, unpredictable | **No.** Not a filtering problem. You can only detect it, admit it, and design around it |

Real classrooms are mostly the second kind. **Do not burn build hours trying to digitally filter babble.** Spend them being honest about it.

**Reference numbers.** A teacher at normal volume is roughly 55–60 dB SPL at one metre; classroom background commonly sits around 45–50 dB. At a student's desk, 3–5 m from the teacher with thirty other people present, the **effective SNR may be only 5–15 dB** — low enough to degrade Whisper noticeably. These are typical ranges, not measurements of your room; measure your own rather than quoting these on a slide.

#### Capture source: the built-in mic, by default

The built-in microphone of whatever device is on the desk is the default and the path you build and demo on. **No special hardware is required, and none is assumed.**

If an external microphone happens to be available — a wired lavalier, or a wireless receiver feeding the device — SNR improves substantially, because distance is the dominant source of loss. Treat that as a **measurement to report, not a feature to build**: the capture layer should not care which source it is reading.

**If the mic you happen to test with is Bluetooth, know this before you blame the model.** A2DP is a *playback* profile, so Bluetooth microphone input falls back to **HFP/HSP**: mono, narrowband, codec-compressed (CVSD/mSBC), and jittery, with 20–50 ms dropouts. ASR on HFP audio is meaningfully worse than on a wired input, and model tuning will not fully recover it. A wired or RF receiver input avoids the problem entirely. Latency is a non-issue here — ~100–200 ms is irrelevant when captions are already seconds behind — so **codec quality is the real cost.**

Either way: **measure the difference and report it.** Do not let hardware stand in for model work, and do not let the demo depend on hardware being present.

#### Cheap guards that earn their keep

Ordered by value per hour:

1. **SNR gate per segment.** Estimate segment SNR; below threshold, emit a gap **without running the decoder at all.** Highest value per line of code in this whole section.
2. **Minimum segment duration.** Do not transcribe anything too short to be a plausible word. Kills most silence-hallucination.
3. **Repetition / loop suppression.** Whisper loves emitting the same n-gram repeatedly. Detect and suppress — catches a whole failure class almost for free.
4. **Continuous energy means noise, not speech.** If a segment shows energy with no silence anywhere inside it, treat it as noise. This is the main guard against hallucinated captions over background hiss.
5. **Room noise-floor calibration at session start.** Track a rolling minimum of ambient energy and set the VAD threshold *relative to that room*, not to a hardcoded constant. Merge gaps under ~300 ms so a cough or chair scrape cannot split a word mid-syllable.
6. **Gentle high-pass filter (~80–300 Hz).** Removes HVAC rumble at essentially no cost.

**Explicitly avoid:** aggressive spectral subtraction and heavy automatic gain control. AGC boosts noise in the gaps between words, and spectral subtraction creates musical-noise artifacts that degrade ASR *more* than the mild noise they were meant to remove. The correct principle is **denoise gently, gate hard** — VAD and gating will do more for you than any noise suppressor.

#### Honest interaction with hotword biasing

Hotwords **help** under noise, because the decoder stays pinned to lesson vocabulary instead of drifting off-domain. But they also make hallucination **more confidently in-domain**, which is worse for a deaf reader than a random wrong word, because it looks plausible. State this tradeoff out loud; it is a real limitation, not a bug to hide.

#### Degradation must be designed, not accidental

Noise is worst exactly when the student most needs help — teacher turned away, chaotic group work. So make the failure mode *visible and actionable*:

- **Auto-escalating gap marking.** As SNR falls, get **more** aggressive about marking gaps. The system degrades loudly, never silently.
- **Live signal-quality indicator.** A simple bar showing capture quality. When it drops, the teacher can see *why* captions became unreliable and act on it — move the device closer, ask for quiet, have the class pause. This turns the worst failure into a prompt for the room to fix itself.
- **Noise-flagged spans on the printed sheet**, labelled *"these parts were noisy — you may want to ask about these."* Noise becomes a to-do item instead of a silent hole.
- **Print the coverage figure on the sheet.** A student deserves to know how much of this record is solid before they rely on it.
- **Report coverage honestly.** 70% confidently captured is a far more useful artifact than 100% confidently wrong.

### Step 1 — Local capture and segmentation

Capture abstracts over the audio source and normalizes everything to a single format — mono, 16 kHz — so **no downstream module needs to know or care which device produced the audio.** Segmentation happens by VAD on utterance boundaries, with thresholds calibrated against the measured room noise floor (Step 0) so a cough or a chair scrape does not split a word. Handle unplugged-mic and no-speech cases gracefully: the app must never look broken while waiting.

### Step 2 — Local streaming ASR with lesson-vocabulary biasing

- **Model:** Whisper (tiny/base) via `transformers.js`, WebGPU with **WASM fallback verified in advance**.
- **Streaming:** decode utterance chunks as they close rather than waiting for the class to end. **Do not promise instant captions.** Captions appearing a couple of seconds after a sentence is finished is genuinely usable in a classroom. Promising sub-second latency would be a false claim and an unnecessary engineering trap — reframe the requirement as *"by the time the teacher moves to the next point, the last point is on screen."*
- **Hotword biasing (our technical differentiator):** seed the decoder with the day's vocabulary — the lesson topic, proper nouns, the terms the teacher is actually teaching. This measurably improves accuracy on exactly the words that matter most, and it is a real technique, not a gimmick. Show before/after on your hotword list.

### Step 3 — Taglish handling

The single most important linguistic reality: a Filipino classroom is **Filipino, English, and Taglish in the same breath.** Handle it as a first-class case rather than an edge case:

- Tagalog and English recognition in the same stream, with spans tagged as TL / EN / MIX.
- A Taglish-aware post-pass for mixed tokens and borrowed English technical terms.
- Do not force monolingual output. A sentence that stays in Taglish when the teacher spoke Taglish is *correct* behavior and must not be "corrected" into English.

### Step 4 — Gap marking — the soul of the product

**A confident wrong caption is worse than a visible gap.**

This is the core design insight, and it inverts normal speech-to-text behavior. A hearing-impaired student cannot audit a transcript against the audio the way a sighted user can glance at a screen. If you give them a fluent, plausible, wrong sentence, they will trust it and learn the wrong thing with total confidence. If you give them `"[ ? ]"`, they know to ask.

Therefore:
- Compute per-word confidence. Below threshold → render as a **visible marker**, never a guess.
- Optionally show an alternate candidate only when it is clearly marked as uncertain.
- Track a **coverage figure for the session**: how much of the class was confidently captured versus marked uncertain. This is an honest, unusual, accessibility-minded metric.

Demo this deliberately. It is the moment a judge understands you have actually thought about the user rather than about the model.

### Step 5 — Live caption display

Accessibility requirements, not cosmetic ones:

- **Large, high-contrast type** with adjustable size — legibility is the product.
- **Read-along pacing:** no auto-scrolling that outruns a reader; new lines append, and the student controls position.
- **Screen placement:** a phone propped on the desk or in a stand, so it works without a projector or a second device. On a laptop, the session runs on the teacher's machine and the sheet prints at the end.
- **Speaker-turn awareness** where the confidence signal supports it, and honest labeling of segments where it does not.
- **One-tap "I missed this"** to flag a span for the study sheet while it is still on screen.

### Step 6 — Local vocabulary extraction

Two outputs, both from the device:

- **Key terms** of the lesson, ranked, with Tagalog/English pairs where both were spoken.
- **Low-confidence spans** — the specific words this student most likely did not get. These become the most valuable part of the printed sheet, because they are personalized to what that student actually missed, not a generic word list.

### Step 7 — Post-class summary

- A **deterministic template** that always works: topic, main points extracted from recurring terminology and structure, and the flagged spans.
- The **optional local LLM** drafts the narrative prose around those facts. It receives the extracted facts as structured input and never generates them.
- Hard rule: the summary is **marked as a machine draft** on the printout, with the verbatim transcript always attached beneath it. A student must be able to check the draft against the real thing.

### Step 8 — Printable study sheet

The terminal artifact, and the reason the whole product exists beyond the live captions. One page, printed, designed for the actual user:

1. **Lesson topic and the main points**
2. **Key vocabulary**, with Tagalog and English where both occurred
3. **"Ask about these tomorrow"** — the low-confidence spans, the noisy spans, and the student's own "I missed this" flags
4. **The coverage figure** — how much of this record is solid, printed on the page so the student knows what they can rely on
5. **The full verbatim transcript**, so every summary line can be verified

Adjustable type size and contrast, because a printed sheet in default 11pt defeats the purpose.

---

## 8. Features

**Must-have (the demo spine)**
- Installable PWA, **fully offline**, no account, no login, no setup wizard
- Runs on **phone and laptop** from one codebase — no native build
- Continuous local captioning in Taglish with **visible confidence gaps**
- Large-type, high-contrast, user-adjustable caption display
- **Live signal-quality indicator** and auto-escalating gap marking as conditions worsen
- Lesson-vocabulary hotword biasing, demonstrable before/after
- "I missed this" flag capture
- End-of-class printable study sheet: summary, vocabulary, flagged and noisy spans, coverage figure, full transcript
- One-tap permanent deletion of all sessions
- On-screen network state and a per-stage local/remote indicator

**Nice-to-have (only if the spine is green)**
- Optional local LLM narrative summary with injected facts, plus a "template only" toggle
- Speaker-turn labeling where confidence permits
- Vocabulary review mode across past sessions (device-local history)
- Parent-facing plain-language one-page version of the same lesson

**Explicitly out of scope — and each cut is deliberate**
- No accounts, no logins, no student databases, no teacher dashboards
- No cloud sync, no school admin, no seat licensing
- Native app store packaging (a PWA is the correct deployment for a low-cost shared device)
- Sign-language video interpretation or avatar generation (a different and much larger problem)
- Automatic grading, assessment, or any inference about the student's ability
- Translation between Filipino and English as a headline feature

**One line to say if a judge asks why there are no accounts:** *A shared classroom device with a student log-in is a privacy problem, not a feature. Nothing to sign into means nothing to leak.*

---

## 9. Data privacy and accessibility ethics

- **No egress, by construction.** There is no upload endpoint. Audio and transcripts stay on the device. This is not a policy page — there is no server to send anything to.
- **A disability is sensitive health information.** Nothing about the student's hearing status is ever written into a record, transmitted, or exposed in the shared UI.
- **Local storage is deletable in one tap** — one control removes all sessions and audio permanently. Demonstrate this.
- **Device loss is a real risk.** Offline-first trades server redundancy for local privacy. Be honest about the tradeoff and recommend exporting or printing the sheet at the end of class. Do not claim the data is safe by default.
- **No student data from real students in the demo.** Use team-recorded classroom audio or a simulated lesson, and say so on stage.
- **Consent for the shared room.** If the app is used in a real classroom, captions capture *everyone's* speech, including other students. Say plainly that a real deployment requires school and parental consent and review under the **Data Privacy Act of 2012**.
- **Design for the actual user, not the institution.** Avoid making the student visibly "the one with the device" in a way that singles them out. A screen everyone can read is also a better accommodation.
- **Do not claim** endorsement from DepEd, CHED, or any government agency.

---

## 10. Technical stack

Every choice keeps perception on-device. Use what the team already knows.

| Layer | Choice |
| --- | --- |
| Frontend | Vanilla JS or light framework, installable PWA, service worker |
| Capture | `getUserMedia`, `AudioContext` + worklet for level metering |
| Audio source | Device microphone via `getUserMedia`, normalized to mono 16 kHz. No special hardware assumed or required |
| Noise handling | Rolling room-noise-floor calibration, SNR estimate per segment, SNR gate, min-duration guard, repetition suppression, gentle high-pass |
| ASR | `transformers.js` + Whisper tiny/base, WebGPU with WASM fallback |
| Hotwords | Whisper hotword/prompt conditioning per lesson |
| Taglish pass | Tagalog/English lexicon + mixed-token handling, rule-based |
| Confidence | Decoder token-level confidence + SNR → per-word reliability |
| Vocabulary | Local sentence/word embeddings + frequency and stopword filtering |
| Summary | Deterministic template; optional `web-llm` + Qwen2.5-1.5B WebGPU |
| Print | Print stylesheet, A4, adjustable type size and contrast; on-screen fallback when printing is unavailable |
| Storage | IndexedDB only, per-device |
| Offline | Service worker + cached model weights; build also runnable from `file://` |
| Platform | Vanilla JS + WebGPU/WASM only — one codebase, no native build, works on Chrome, Edge, Safari, Firefox |

### Running on phone and laptop

**Two device classes, chosen deliberately as the two ends of the affordability range.** That is a stronger claim than vague multi-device support: if it runs on a ₱4,000 Android phone and on whatever laptop a school already owns, it runs across the whole realistic range a Philippine classroom can produce.

| | Phone | Laptop |
| --- | --- | --- |
| **Role** | **The student's device.** Cheapest, most common, already owned. Propped on the desk | **The teacher's machine.** Run the session, then print. Or a fallback display |
| **Caption legibility** | Needs the type slider pushed up; keep the caption area to roughly the last 4 lines and let it reflow | Fine at default sizes |
| **WebGPU** | Often present on mid-to-high-end Android — **verify, do not assume** | Present on recent Chrome/Edge |
| **Expected fallback** | **WASM, which is slower — pre-warm the cache** | Rarely needed, but do not assume it |
| **Printing** | Not available — hand off to a shared printer or another device | **Natural fit. Best sheet output** |
| **Power** | Battery risk is real; a 20-minute lesson on a low battery is a live risk | Fine, but **disable sleep/hibernate** |

**Design rules that make two very different devices work**

- **Responsive, not separate layouts.** The caption area is the one element that must stay legible; everything else reflows. Test at **360 px wide**, not just on a laptop viewport.
- **Type size in `rem` with a persisted slider**, so the accessibility control behaves identically on both.
- **Portrait and landscape both work.** A propped phone is usually landscape, but it must not break in portrait. The laptop is landscape. Never lock orientation.
- **Storage is per-device, and there is no cross-device sync.** A phone's session is not on the laptop. This follows from having no account — say it plainly rather than letting it look like an omission. Moving a sheet between devices is printing or a file transfer, by design.
- **Printing is optional, never required.** On a phone, "share / print" hands off to another device. The study sheet must remain fully readable on-screen if printing is unavailable.
- **Touch targets ≥ 44 px**, sized for a student using one hand or a stylus.
- **The laptop is a fallback, not the target.** If the layout only really works at laptop widths, the phone claim is false. Design phone-first.

**Why a PWA and not native (the answer if a judge asks):** one codebase reaches a ₱4,000 Android phone and a school laptop identically, installs without an app store, updates on refresh, runs offline from cache, and creates **no account**. That is the deployment reality. Native would mean two codebases and a store account for a product whose entire thesis is that it must run anywhere.

**Test matrix before Demo Day — do not skip:** **one phone and one laptop.** Run the full spine on each, note which fell back to WASM, and pre-warm the cache on the actual device you will present from. The phone is the riskier of the two — often no WebGPU, no printer, less battery.

---

## 11. Build plan — 19.5 hours

Briefing starts **2:30 PM Oct 9**; code freezes **10:00 AM Oct 10**. That is **19.5 hours.** Do not plan for 30.

| Hours | Goal | Output |
| --- | --- | --- |
| 0–0.5 | Lock scope to the spine. **Run the confidence probe (ADR-0002).** Record one Taglish lesson, plus a **deliberately noisy take** of the same lesson. Commit `contracts.ts` frozen | Lesson audio (2 takes), hotword list, confidence finding |
| 0.5–1 | Create **public repo immediately**; PWA shell, service worker, airplane-mode UI | Public repo, installable shell |
| 1–3 | **Local ASR running in the browser.** WebGPU path first, then verify WASM fallback | Transcript in-browser |
| 3–5 | **Noise budget + VAD segmentation** + streaming utterance decode + caption display | Live captions, degrading honestly |
| 5–7 | Confidence extraction + **gap marking** + coverage figure + signal-quality indicator | Honest captions |
| 7–8.5 | Hotword biasing, measured before/after | Demonstrable accuracy gain |
| 8.5–10.5 | Taglish handling pass + large-type/contrast UI | Classroom-legible captions |
| 10.5–12 | "I missed this" flagging + session storage + one-tap delete | Capture complete |
| 12–14 | Vocabulary extraction (terms, Taglish pairs, flagged spans) | Vocabulary output |
| 14–16 | **Printable study sheet** — the terminal artifact, verified at 360 px width, not just on a laptop viewport | One-page print |
| 16–17 | **Device matrix run** (one phone + one laptop) — note which used WebGPU vs. WASM fallback | Cross-device proof |
| 17–18 | Offline evaluation suite (incl. **WER vs SNR**) + README + DISCLOSURES.md | Published numbers |
| 18–18.75 | Demo rehearsal ×2, **backup demo video recorded in airplane mode** | Recorded backup |
| 18.75–19.5 | Buffer. Freeze. Start nothing new. | Submitted before 10:00 AM |

*The optional local LLM layer has no slot of its own in this table on purpose — it is cut #1. Attempt it only if the spine is green and a checkpoint has passed cleanly.*

**Hard cut lines, in strict order — decide at T7.5, not at T17:**

| # | Cut | Why it's safe |
| --- | --- | --- |
| 1 | Local LLM summary | Cosmetic; the deterministic template already works |
| 2 | Hotword biasing | A differentiator, not a prerequisite — captions work without it |
| 3 | Speaker-turn labeling | Nice-to-have |
| 4 | Taglish span-tagging (`TL`/`EN`/`MIX` labels) | Keep code-switched recognition itself; drop only the labelling |
| 5 | SNR sweep beyond clean + noisy | Report two conditions instead of a full curve |
| 6 | Parent-facing plain-language sheet | Second output format |

*Phone and laptop support are **not** cuttable — both are commitments, and the test matrix at T16:30 must show both working.*

**The four non-negotiables — these are the product:**
1. **Gap marking** — the core promise
2. **SNR gate** — what keeps that promise honest in a loud room
3. **"I missed this" flagging** — makes the artifact personalized
4. **The printable study sheet** — the reason the product exists

*The airplane-mode demo path is a fifth thing you cannot cut, though it is a property of the build rather than a feature.*

**Parallelize from hour 1** — see `docs/coordination.md` for the full ownership map, interface contracts, and checkpoint schedule. One person owns audio recording, transcription, and the noise layer; the others build against fixtures. Audio collection is the long pole.

**Demo Day hardware plan.** WebGPU may be unavailable on the venue machine. Verify the WASM fallback **before** Demo Day, run the device matrix (**one phone, one laptop**), pre-warm the browser cache **on the device you will actually present from**, disable sleep, bring your own charger and cable, and **carry a backup demo video recorded entirely in airplane mode.** Never depend on Cyberzone's Wi-Fi for the one thing your entire pitch is about.

---

## 12. Demo script — 5 minutes

*Totals 4:35, leaving buffer. The brief allows 5 minutes plus 3 minutes of judge Q&A.*

1. **Frame (25s).** "A deaf student in a regular class. No interpreter. No captioning. The teacher explains once. That content is then gone forever." Land the one-time nature of a lesson.
2. **The hook (15s).** Put the device in **airplane mode on camera**. "Nothing from here on uses the internet."
3. **Run the lesson (50s).** Play your simulated Taglish lesson audio — a teacher explaining, with real Taglish code-switching and a proper noun. Captions appear live as the lesson plays. Do not narrate over this; let the room read.
4. **Show the gap (40s).** Point at a `[ ? ]` in the captions. "Here the model was not confident, so it refused to guess. A fluent wrong caption would have taught her something false with total confidence." **This is the emotional and technical peak.**
5. **Break it on purpose (35s).** "Now let me make the room louder." Play the noisy take. Accuracy drops, gaps appear, the signal-quality bar falls, and **the system says it lost track instead of pretending.** Second emotional peak — it proves the gap-marking promise holds under stress and pre-empts the question every judge is about to ask.
6. **Show the hotword gain (20s).** Before/after accuracy on the same audio with and without lesson vocabulary seeded. One number, stated plainly.
7. **The artifact (55s).** End the class. Generate and print the study sheet. Walk through it: main points, key vocabulary with Tagalog/English pairs, **"ask about these tomorrow"** listing the flagged and noisy spans, the printed coverage figure, and the full transcript so every summary line is verifiable. Mention it prints from any device.
8. **Prove it (25s).** Disclosure panel: models, sizes, frameworks, what runs locally, what needs internet (a one-time download only). Note the LLM was switched off and captions never depended on it.
9. **Close (10s).** "Team-recorded simulated lesson, no real students. Real deployment needs school and parental consent and Data Privacy Act review."

**If running long:** cut step 6, then step 8. **Never cut steps 2, 4, 5, or 7.**

---

## 13. Submission checklist

- [ ] Project name, one-line description, member names — all from the official AppBuildersPH list
- [ ] **Public** GitHub repo with judge-reproducible setup instructions
- [ ] Demo video ~60s, posted to X or LinkedIn, tagging Devin / Cognition, with `#AppBuildersPH`
- [ ] **Required answer: why does this benefit from running AI locally?** — Section 1, verbatim
- [ ] Disclosure sheet: models + quantization, frameworks (`transformers.js`, `web-llm`), cloud services (**static host only**), existing code/assets, AI dev tools used
- [ ] Explicit statement that all demo audio is team-recorded and no real student was recorded

Submit at `cerebralvalley.ai/e/appbuildersph-hackathon-2026` by **10:00 AM, Oct 10**. One submission per team. **No edits afterward. No commits after the deadline.**

---

## 14. Evaluate honestly

You have no real students, so measure what you can and publish the weak numbers.

| What to measure | How |
| --- | --- |
| **WER / CER on Taglish classroom audio** | Against a hand-transcribed reference of your own recording. **Report Taglish separately from pure Filipino and pure English** — this is the number that matters |
| **Hotword biasing gain** | WER before vs. after on the same audio, focusing on the seeded vocabulary |
| **Confidence calibration** | Do high-confidence words really have higher accuracy? Plot accuracy by confidence band. **If confidence is not calibrated, say so and retune thresholds** |
| **Gap-marking utility** | Accuracy of the gaps themselves: are the marked spans genuinely the words a listener would miss? |
| **Coverage rate** | Percentage of the lesson captured confidently vs. marked uncertain |
| **WER vs. SNR curve** | Clean, classroom babble, and HVAC at roughly 20 / 10 / 5 / 0 dB. **Publish the ugly end of the curve** — graceful degradation reads as competence, one clean number does not |
| **Hallucination rate under noise** | % of segments that produced output where no speech was present. This is the metric that reveals whether noise broke the core promise |
| **Confidence calibration vs. SNR** | Does confidence actually *drop* as noise rises? If it does not, the gap-marking promise is hollow — retune thresholds or add the SNR gate |
| **VAD segmentation error under noise** | Over- and under-segmentation rates — shows whether segmentation or recognition is the actual bottleneck |
| **Cross-device check** | Run the spine on one phone and one laptop. Report which used WebGPU and which fell back to WASM |
| **Latency** | Seconds from end-of-utterance to caption appearing, **on each device type**, not just the fastest one |
| **Cost footprint** | Model size in MB, cold start, one-time download size |
| **Offline verification** | Run the entire evaluation with networking disabled, and record the result |
| **Independence** | Disable the LLM, regenerate the summary, confirm captions and all facts are unchanged |

Report results as they are, including weak ones. Never present these as performance measured on real students in real classes.

---

## 15. Known limitations and risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **Taglish is hard for ASR models** | Trained mostly on monolingual English | Hotword biasing; rule-based Taglish pass; report TL/EN/MIX metrics separately; state the limitation plainly |
| **Confidence may be poorly calibrated** | A confident wrong caption is the worst failure mode here | Measure calibration; retune thresholds; prefer over-marking gaps; never silently guess |
| Latency feels slow in a live demo | Captions arrive after the sentence | Reframe honestly: captions land before the teacher moves on, which is what a classroom actually requires |
| Classroom noise degrades everything | Real rooms are loud, and SNR at a student's desk may be only 5–15 dB | Noise budget in Step 0: SNR gate, min-duration guard, loop suppression, noise-floor calibration. Auto-escalating gap marking so degradation is loud, not silent |
| **Noise makes confidence lie** | Whisper hallucinates fluent text on noisy or silent input, and confidence can *rise* under noise — breaking Step 4 exactly when it matters | Never trust confidence alone; gate on SNR as well. Measure calibration vs. SNR and publish the hallucination rate |
| **Distance is the dominant source of loss** | The device sits metres from the speaker, and no model setting fixes that | SNR gating so the failure is visible; honest coverage reporting. If a school already has a mic, capture can use it — but the built-in mic must work unaided |
| Models on low-end Android phones | Many classroom devices are weak, and the phone is our committed target | Test on a real phone before Demo Day; cap model size; provide a smaller-model mode; pre-warm the cache |
| Venue machine lacks WebGPU | The whole demo depends on it | Verified WASM fallback; pre-warmed cache; **backup demo video recorded in airplane mode** |
| One page of summary cannot replace a real lesson | Risk of overselling access | Say plainly: this closes a gap, it does not close access; interpreters remain essential |
| Captions capture other students' speech | Privacy exposure in a shared room | Consent, local-only storage, one-tap deletion, and a stated requirement for parental and school consent |
| A shared device is not private | Another student may see the transcript | Session auto-expiry, device-level passcode for the app, and honest framing that this is a classroom tool |
| Scope is large for 19.5 hours | The realistic threat to your finalist spot | Strict cut lines; protect the three non-negotiables |

---

## 16. Expected impact — realistic framing

*If* validated with deaf students, teachers, and advocacy groups, Boses could give a deaf or hard-of-hearing Filipino student independent access to a lesson they would otherwise have partially missed, and give them a reviewable record afterward — on hardware a school can actually afford, without a subscription.

**What this prototype actually demonstrates:** that Taglish classroom captioning and post-class synthesis can run entirely on-device, that a visible gap is more useful to a deaf student than a fluent guess, and that the lesson can end as a usable printed artifact. **That is all we claim.** Any claim about improved learning outcomes would require real studies with real students that we have not done.

---

## 17. Beyond the hackathon

1. Pilot with deaf and hard-of-hearing students, teachers, and **Deaf advocates — with the Deaf community as co-designers, not subjects.**
2. Measure real classroom performance and publish the failure cases, not only the successes.
3. Improve Taglish handling substantially; it is the true technical bottleneck.
4. Multi-speaker handling so captions show who said what.
5. Explore a lighter model tier for low-end classroom devices.
6. Vocabulary lists supplied by teachers per subject, improving hotword biasing where it matters.
7. Parent-facing plain-language output for students who cannot relay the lesson at home.
8. Investigate microphone and display setups that make captioning usable without a phone flat on the desk — including classroom PA and assistive-listening integration.
9. Drive down the cost of good capture so every classroom can afford it, rather than treating better audio as an accessory.

---

## 18. Repository layout

```
boses/
  README.md                # includes the "why local" answer + offline run instructions
  DISCLOSURES.md           # models, frameworks, cloud, existing code, AI tools
  lessons/
    sample/                # team-recorded simulated lesson audio
    transcripts/           # hand-transcribed reference text
    hotwords/              # per-lesson vocabulary lists
  web/                     # PWA — the shipped product (phone / laptop)
    capture.js             # mic input, VAD, utterance segmentation, noise-floor calibration
    noise.js               # SNR estimate, gating, min-duration, loop suppression, high-pass
    asr.js                 # local Whisper wrapper, WebGPU + WASM fallback
    hotwords.js            # hotword conditioning + before/after eval
    taglish.js             # Tagalog/English/mixed handling
    confidence.js          # token confidence + thresholding + coverage figure
    captions.js            # live display, large type, contrast, pacing
    vocab.js               # key terms, Taglish pairs, flagged spans
    summary.js             # deterministic template + OPTIONAL local LLM
    sheet.js               # printable study sheet
    store.js               # IndexedDB sessions + one-tap delete
    sw.js                  # service worker, offline + model cache
  eval/                    # offline evaluation harness + published results
  demo/                    # backup demo video (recorded in airplane mode), screenshots
```

---

## 19. Team roles (3–4 people)

These map one-to-one onto the **P1–P4** lanes in `docs/coordination.md`. For a team of three, merge P1 into P4; for two, merge P3 into P4 and keep P2 separate — audio is the long pole and should never be a shared task.

- **P1 — Local ASR / models:** browser Whisper, WebGPU + WASM paths, hotword biasing, latency, calibration
- **P2 — Audio, capture, and noise:** recording, hand transcription, `capture.js`, `noise.js` (SNR gate, min-duration, loop suppression, noise-floor calibration)
- **P3 — Captioning UI, print, and integration:** live display, type sizing, contrast, pacing, flagged-span capture, signal-quality indicator, print sheet. **Also the integration owner** — runs merge checkpoints and keeps `main` runnable
- **P4 — Taglish, post-class, eval, and submission:** Taglish pass, vocabulary and summary, reference transcripts, WER by language type, calibration and hallucination testing, offline eval suite, README, disclosures, submission. **Also owns the cut decisions**

---

## 20. How this maps to the judging criteria

| Criterion | Weight | Our answer |
| --- | --- | --- |
| **Problem & Usefulness** | 25% | A real, underserved student, in a real classroom, with a lesson that happens only once. The student is the user, not the institution |
| **Local AI Implementation** | 25% | Streaming ASR, Taglish handling, confidence, noise gating, vocabulary, and summary **all on-device**. Zero egress. Product does not exist without local inference |
| **Technical Execution** | 20% | Verified WebGPU + WASM fallback on **phone and laptop**; measured confidence calibration; a published **WER-vs-SNR curve and hallucination rate**; offline eval |
| **Innovation** | 15% | **Confidence-gap design for a user who cannot audit the transcript** — with noise-aware gating so the gap signal survives a loud room, plus hotword biasing and a printable end-of-class artifact. An axis OS- and meeting-suite captioning does not occupy |
| **Product & Demo Quality** | 15% | Airplane-mode-on-camera hook, a demo gap that lands emotionally, **a deliberate "let me add noise" beat**, one printed page held up as the real deliverable, honest disclosure |

---

## 21. The six sentences to have ready

1. "Turn off the internet and it still works. That is not a feature we added — that is where the model runs."
2. "A confident wrong caption is worse than a visible gap. So when it is unsure, it says so instead of inventing something."
3. "It is not English with a Filipino accent. Taglish is the actual language of the classroom, and we built for that."
4. "The lesson happens once. So at the end of class, you get it on paper."
5. "It costs nothing per minute, needs no account, and runs on a ₱4,000 phone or a school laptop."
6. "When the room gets loud, it tells you it lost track — instead of inventing something confident and wrong."

---

## 22. Naming and alternatives

**Boses** means **voices** — the thing a deaf student cannot access, and now can.

Alternatives if you want a different flavor: **Tinig** (voice/sound) · **Dingig** (to hear) · **Akbayan** (to accompany, to help along) · **Boses-PH**.

**If you want a different product in the same family** — same on-device stack, same accessibility DNA, different product:

- **Camera → paper:** point the phone at any textbook page; local OCR reads Tagalog text off the page and produces a large-type, simplified, mother-tongue-friendly accessible version. Vision instead of audio, and the same "no account, no network, printed artifact" shape.
- **Lesson material maker:** the teacher names a topic and the device generates a leveled, illustrated, printable activity offline — local generation instead of local perception, useful for the teacher rather than the student.
- **Heritage language audio cards:** local ASR builds pronunciation references and printable flashcards for local languages, aimed at teachers and parents rather than at assessment.