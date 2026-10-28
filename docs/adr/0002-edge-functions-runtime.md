# ADR 0002: TypeScript in Supabase Edge Functions

Date: 2026-10-28

Status: accepted

## Context

Collection and Telegram are primarily bounded HTTP/database work. The runtime must align with Supabase, avoid a persistent backend, and allow independently tested domain/parser logic. Hosted Edge limits make unbounded scraping or long worker loops unsuitable.

## Decision

Use TypeScript, Deno-compatible libraries and `supabase-js`. Keep HTTP composition roots thin, share inward-facing modules under `supabase/functions/_shared`, and inject clock/network/storage/delivery dependencies. Work is page/batch bounded with durable continuations; no correctness depends on process memory or detached tasks. Do not add Python, a separate application server or a browser runtime. Tooling begins in 02; core worker in 03; scheduling in 09.

## Alternatives considered

Python/FastAPI or a Node daemon requires a different host. A single long-running function collecting every source risks execution limits and broad failure scope. SQL-only fetching/parsing mixes external IO with database concerns.

## Consequences

Parsers must fit measured CPU/memory/payload budgets and use pinned compatible dependencies. Browser-only sources are deferred rather than forced into the runtime. Edge imports and privilege/config behavior require hosted verification. Optional local tooling cannot become a production runtime dependency.

## Validation

Check the current [hosted function limits](https://supabase.com/docs/guides/functions/limits) in Phase 02/10. Benchmark representative YAML/HTML/XML in Phase 04-06; reduce scope/change source strategy if CPU does not fit. Packaging/auth smoke checks run before activation. See [architecture](../../ARCHITECTURE.md).
