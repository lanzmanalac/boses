# Boses — Diagrams

Rendered from the Mermaid sources in `../ARCHITECTURE.md`. Regenerate with:

```bash
mmdc -p pconf.json -c cfg.json -i <source>.mmd -o <name>.png -b white -s 2
```

(`pconf.json` passes `--no-sandbox`; without it Chrome fails to launch on this host.)

---

## The ten diagrams

| # | File | What it shows |
| --- | --- | --- |
| 01 | `01-system-architecture.png` | **Start here.** Full pipeline left-to-right: infrastructure → adapters → domain core → output |
| 02 | `02-ports-and-adapters.png` | Team ownership, the frozen ports, and the forbidden dependency (core must never import adapters) |
| 03 | `03-data-model.png` | ER diagram. Note `WORD.conf` is **nullable** — see ADR-0002 |
| 04 | `04-flow-live-captioning.png` | The spine. Per-utterance loop with the SNR gate and both gap paths |
| 05 | `05-flow-studysheet.png` | End of class → printable artifact, with the LLM's strict boundary |
| 06 | `06-engine-swap.png` | Why hexagonal pays off: three people demoing at T+1.5 while one fights WebGPU |
| 07 | `07-failure-modes.png` | All 11 failure modes converging on one principle: **visible gap, never silent wrong caption** |
| 08 | `08-noise-decision-flow.png` | The ordered guards, cheapest rejection first. SNR gate never invokes the decoder |
| 09 | `09-timeline-19h.png` | The 19.5-hour Gantt with all four lanes and every deadline |
| 10 | `10-offline-privacy.png` | What crosses the network boundary (almost nothing) and why zero egress is architectural |

---

## Reading order for a judge

If you only have two minutes:

1. **01** — what it is
2. **08** — the idea that makes it honest
3. **07** — what happens when it breaks

If you want the full engineering story: **01 → 02 → 04 → 08 → 07 → 03**.

---

## The one thing every diagram has in common

Red nodes are gaps, refusals, or rejections. Green nodes are successful inference. Orange is the domain core. Blue is presentation.

**Red is the honest part of the product.** A system that is red-heavy is telling the truth about what it does not know — and that is the whole design.