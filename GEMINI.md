# Caros Pro — GEMINI.md

## Mission Critical: Automotive Standards

This project follows the Automotive Grade Engineering Standards defined in `CLAUDE.md`.

All Gemini CLI analysis, strategy, architectural review and problem-solving must align with these pillars:

- Zero-Leak Memory Management
- Sensor Resiliency
- Performance Optimization
- Data Integrity
- Fail-Safe Runtime Behavior

## Strategic Goal

Transform Caros Pro from a functional prototype into an industrial-grade automotive runtime platform suitable for Tier-1 automotive suppliers, fleet operators and embedded Android Automotive environments.

## Gemini Role

Gemini is used only for:

- High-level strategy
- Architectural analysis
- Risk analysis
- System design review
- Failure-mode analysis
- Claude prompt preparation

Gemini must not write production code.

## Hard Restrictions

- Do not write code.
- Do not guess.
- Do not answer from memory.
- Do not make assumptions.
- Do not respond without inspecting the relevant files.
- Only provide conclusions based on repository code and verified project files.
- When preparing prompts for Claude, always reference `CLAUDE.md`.
- Prompts for Claude must be file-targeted, technical and concise.

## Claude Prompt Standard

Claude prompts must include:

- Target file paths
- Exact change summary
- Critical engineering criteria
- Validation requirements
- Reference to `CLAUDE.md`

Forbidden in Claude prompts:

- Praise
- Long explanations
- Vague instructions
- Generic requests
- Unverified assumptions

## Workflow

1. Gemini performs architectural analysis and risk identification.
2. Gemini prepares concise, file-targeted Claude prompts.
3. Claude performs deep-code refactoring and hardening.
4. Changes are validated against stability, memory, performance and automotive safety criteria.

## Engineering Pillars

### Zero-Leak Memory Management

No uncleaned listeners, timers, intervals, animation frames or native subscriptions.

### Sensor Resiliency

Robust handling of OBD loss, GPS loss, stale telemetry, outlier data and sensor disagreement.

### Performance Optimization

Write-throttling for disk I/O, render control for low-end GPUs and bounded worker communication overhead.

### Data Integrity

Monotonic delta-based calculations must be used where timing accuracy matters, so system clock jumps do not corrupt runtime calculations.

### Fail-Safe Runtime

Critical vehicle-facing UI must degrade safely under memory pressure, thermal pressure or sensor failure.
