# M6 Workpack — Scenario Suite and Authoring

## Objective

Demonstrate that NullCity is an extensible crisis-decision platform, not a hard-coded `Black River` demo.

## Scenario requirements

### Black River

Infrastructure cascade, power/water dependencies, delayed telemetry, media/citizen misinformation, constrained repair and verification resources.

### Glass Harbor

Hazardous-material event with uncertain plume reports, medical capacity pressure, route closures, competing evacuation/advisory choices, and false attribution.

### Signal Zero

Communications degradation with spoofed telemetry, contradictory dispatch reports, degraded observation delivery, and high value of verification/communication prioritization.

## Distinctness gate

Each scenario must differ in:

- dependency graph;
- observation channel behavior;
- resource tradeoffs;
- key failure cascade;
- optimal baseline strategy;
- calibration/verification challenge.

## Authoring experience

- documented source schema and compiled format;
- starter template;
- diagnostic examples for common errors;
- scenario metadata, difficulty, tags, expected duration, and mechanics;
- validation/compile/inspect commands;
- no source-code edit required for normal scenario content;
- deterministic golden receipts for reference policies, versioned carefully.

## Acceptance

All three scenarios compile, run, complete, replay, and benchmark. The three baselines produce meaningfully different metric profiles across the suite.
