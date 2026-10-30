import type postgres from "postgres";
import { assert, equals, TestAssertionError } from "../support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import {
  ProcessingError,
  type SourceAdapter,
} from "../../supabase/functions/_shared/application/ports.ts";
import { JeacsAdapter } from "../../supabase/functions/_shared/adapters/sources/jeacs/adapter.ts";
import { jeacsManifest as m } from "../../supabase/functions/_shared/adapters/sources/jeacs/manifest.ts";
import { approvedEndpoints } from "../../supabase/functions/_shared/adapters/sources/registry.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { bytes, digest } from "../../supabase/functions/_shared/domain/primitives.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { article, directory, journalFixtures, journalTransport } from "../jeacs_support.ts";

// Only the guarded runner calls this. Two observations may share a canonical, so cleanup owns BOTH
// sources in one scope. No nested single-source cleanup may delete their shared canonical early.
export async function verifyJournals(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  live = false,
) {
  const inputHash = await conferenceInputHash(),
    passed: string[] = [],
    measurements: unknown[] = [];
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new ProcessingError("backend_key_unavailable");
  const keys = await response.json() as { name?: string; type?: string; api_key?: string }[],
    key = keys.find((k) => k.name === "service_role")?.api_key ??
      keys.find((k) => k.type === "secret")?.api_key;
  if (!key) throw new ProcessingError("backend_key_unavailable");
  const repository = new SupabaseRepository(
      persistenceClient(`https://${target.projectRef}.supabase.co`, key),
    ),
    id = crypto.randomUUID(),
    detailId = crypto.randomUUID(),
    sourceIds = [id, detailId],
    clock = { now: () => new Date().toISOString() },
    signal = new AbortController().signal,
    adapter = new JeacsAdapter(),
    f = await journalFixtures();
  let detailFailure = false, detailOnly = f.detail;
  const injected = journalTransport(f);
  const observed: typeof fetch = async (u, init) => {
    const r = live
      ? await fetch(u, init)
      : detailFailure && String(u) === m.detailUrl
      ? new Response("", { status: 503 })
      : await injected(u, init);
    const measure = { url: String(u), status: r.status, decodedBytes: 0 };
    measurements.push(measure);
    const stream = r.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, c) {
          measure.decodedBytes += chunk.byteLength;
          c.enqueue(chunk);
        },
      }),
    );
    return new Response(stream ?? null, { status: r.status, headers: r.headers });
  };
  const detailAdapter: SourceAdapter = {
    slug: "jeacs-detail-fixture",
    parserVersion: m.parserVersion,
    supportedTypes: m.supportedTypes,
    async collectPage(c, cursor) {
      if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
      // This is a SECOND SANITIZED REPRESENTATION, not a second live source or arbitrary URL fetch.
      const payload = JSON.stringify({
        schemaVersion: 1,
        documentUrl: m.detailUrl,
        html: detailOnly,
        policy: f.policy,
        detail: null,
        detailError: null,
      });
      return {
        payload,
        format: "jeacs-html-v1",
        sourceUrl: m.detailUrl,
        fetchedAt: c.clock.now(),
        sourceRevision: await digest(payload),
        nextCursor: null,
        validators: {},
        notModified: false,
      };
    },
    parsePage: (page) => adapter.parsePage(page),
  };
  const deps = {
    repository,
    adapters: new Map<string, SourceAdapter>([[adapter.slug, adapter], [
      detailAdapter.slug,
      detailAdapter,
    ]]),
    http: new BoundedHttpClient(approvedEndpoints, observed),
    clock,
    logger: new StructuredLogger(),
  };
  const snapshot = async () =>
    await sql`
    select o.id,o.title,o.type_code,o.status,o.cycle_key,o.attributes,o.field_provenance,o.content_revision,
      r.id as observation_id,r.source_id,r.source_record_key,r.metadata,r.normalized_snapshot,
      d.id as deadline_id,d.kind,d.round_key,d.status as deadline_status,d.due_date::text,d.due_at::text,d.precision,d.revision as deadline_revision
    from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id
    left join radar.opportunity_deadlines d on d.opportunity_id=o.id
    where r.source_id=any(${sourceIds}::uuid[]) order by r.source_id,r.source_record_key,d.kind,d.round_key`;
  const execute = async (source = id) => {
    const run = await repository.createRun(source, `p06:${source}:${crypto.randomUUID()}`, "test"),
      lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(lease?.runId === run, "journal scoped task claim");
    return { run, lease, result: await collect(lease, deps, signal) };
  };
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: journals ${label}`);
  };
  const primary = async () => (await snapshot()).filter((r) => r.source_id === id);
  const byRound = (rows: postgres.Row[], kind = "submission") =>
    rows.find((r) => r.source_record_key === "jeacs-v1:announcement:230" && r.kind === kind)!;
  const [pause] = await sql`select value from radar.system_settings where key='collection_paused'`;
  let samples: unknown, initialCounts: unknown;
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)values(${id},${adapter.slug},'Scoped JEACS journal calls','phase06-test',${adapter.parserVersion},true,clock_timestamp())`;
    if (!live) {
      await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)values(${detailId},${detailAdapter.slug},'Sanitized official detail representation','phase06-test',${m.parserVersion},true,clock_timestamp())`;
    }
    const first = await execute(), initial = await primary(), ref = byRound(initial);
    const canonicals = new Map(initial.map((r) => [r.id, r]));
    const [stats] =
      await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed,status from radar.collection_runs where id=${first.run}`;
    initialCounts = { canonicals: canonicals.size, deadlines: initial.length, ...stats };
    samples = [...canonicals.values()].map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type_code,
      status: r.status,
      source_record_key: r.source_record_key,
      cycle_key: r.cycle_key,
      journal: r.attributes.journal,
      source_status: r.attributes.journal_call.source_status,
      source_revision: r.metadata.source_revision,
      journal_call: r.attributes.journal_call,
      deadlines: initial.filter((d) => d.id === r.id).map((d) => ({
        kind: d.kind,
        round_key: d.round_key,
        due_date: d.due_date,
        due_at: d.due_at,
        precision: d.precision,
        status: d.deadline_status,
      })),
    }));
    ok(
      first.result.inserted > 0 && first.result.rejected > 0 && !!ref,
      "real adapter persists author calls and durable non-call exclusions through core RPCs",
    );
    ok(
      stats.records_seen === stats.accepted + stats.rejected &&
        stats.accepted === canonicals.size && stats.pages_committed === 1 &&
        stats.status === "partial",
      "page accounting has one committed page and every logical record has a durable disposition",
    );
    if (!live) {
      ok(
        canonicals.size === 3 && initial.length === 5 && stats.records_seen === 5 &&
          stats.rejected === 2,
        "fixture creates three canonical calls and five distinct semantic deadlines from seven alias-bearing cards",
      );
    } else {ok(
        canonicals.size >= 3 && [...canonicals.values()].some((r) =>
          r.type_code === "journal_cfp" && r.status === "closed"
        ) && [...canonicals.values()].some((r) =>
          r.type_code === "journal_special_issue" && r.status === "open"
        ),
        "live open special issues and seasonal closed standalone CFP retain factual lifecycle",
      );}
    ok(
      initial.every((r) =>
        r.attributes.journal.issn === "2709-9946" &&
        r.field_provenance.title.source_record_id === r.observation_id && r.due_at === null
      ),
      "journal metadata provenance and calendar deadlines survive actual persistence without invented instants",
    );
    ok(
      ref.due_date === "2027-07-15" && ref.attributes.journal_call.guest_editors.length === 3 &&
        ref.attributes.journal_call.language === "English" &&
        ref.attributes.journal_call.fees.amount === 0 &&
        initial.some((r) =>
          r.id === ref.id && r.kind === "abstract" && r.due_date === "2027-02-28"
        ) &&
        initial.some((r) =>
          r.id === ref.id && r.kind === "decision" && r.due_date === "2027-03-31"
        ),
      "persisted sample matches official guest editors abstract decision manuscript dates language and explicit fee policy",
    );
    ok(
      initial.every((r) =>
        !/@[a-z0-9.-]+\.[a-z]{2,}|<script|<html/i.test(JSON.stringify(r.normalized_snapshot)) &&
        bytes(JSON.stringify(r.normalized_snapshot)) <= 12000
      ),
      "bounded factual snapshots contain no source HTML or contact-email payload",
    );
    const countRequests = measurements.length;
    ok(
      (await collect(first.lease, deps, signal)).replayed && measurements.length === countRequests,
      "same task replay has no HTTP writes or completion effects",
    );
    const replay = await execute();
    ok(
      replay.result.inserted === 0,
      "new-run replay creates no duplicate canonical or source identity",
    );
    equals(
      (await primary()).map((r) => [r.id, r.deadline_id, r.content_revision, r.deadline_revision]),
      initial.map((r) => [r.id, r.deadline_id, r.content_revision, r.deadline_revision]),
    );
    if (!live) {
      f.html = f.html.replaceAll("July 15, 2027", "July 16, 2027");
      f.detail = f.detail.replaceAll("July 15, 2027", "July 16, 2027");
      await execute();
      const changed = byRound(await primary());
      ok(
        changed.id === ref.id && changed.deadline_id === ref.deadline_id &&
          changed.deadline_revision === ref.deadline_revision + 1 &&
          changed.due_date === "2027-07-16" && changed.content_revision > ref.content_revision,
        "deadline amendment revises facts while preserving canonical and stable round identity",
      );
      detailOnly = f.detail;
      f.detail = f.detail.replaceAll("July 16, 2027", "July 19, 2027");
      await execute();
      const intrinsic = byRound(await primary());
      ok(
        intrinsic.deadline_status === "conflicted" && intrinsic.due_date === "2027-07-16" &&
          intrinsic.normalized_snapshot.deadline_evidence.filter((d: { kind: string }) =>
              d.kind === "submission"
            ).length === 2,
        "new directory-detail contradiction blocks the previously known deadline and retains both observation values",
      );
      f.detail = detailOnly;
      await execute();
      await execute(detailId);
      const merged = await snapshot(), secondary = merged.filter((r) => r.source_id === detailId);
      ok(
        secondary.length === 3 && secondary.every((r) => r.id === ref.id) &&
          new Set(merged.map((r) => r.id)).size === 3,
        "directory and official-detail representations with reviewed identity merge one canonical across two source observations",
      );
      ok(
        secondary.every((r) =>
          r.metadata.field_documents.title === "detail" &&
          r.metadata.documents.directory === null && r.metadata.documents.detail === m.detailUrl
        ),
        "detail representation retains originating document and source-record evidence",
      );
      // Equal-authority known disagreement is visible; no silent exact-reminder eligibility.
      f.html = f.html.replaceAll("July 16, 2027", "July 18, 2027");
      f.detail = f.detail.replaceAll("July 16, 2027", "July 18, 2027");
      await execute();
      const conflict = byRound(await primary());
      ok(
        conflict.deadline_status === "conflicted" && conflict.deadline_id === ref.deadline_id,
        "equal-authority cross-representation date disagreement preserves one conflicted semantic round",
      );
      detailOnly = detailOnly.replaceAll("July 16, 2027", "July 18, 2027");
      await sql`update radar.sources set config='{"field_authority":{"deadline:submission:manuscript":80}}',config_version=config_version+1 where id=${detailId}`;
      await execute(detailId);
      const authoritative = byRound(await primary());
      ok(
        authoritative.deadline_status === "current" && authoritative.due_date === "2027-07-18" &&
          authoritative.id === ref.id,
        "explicit reviewed field authority resolves the date conflict without a new identity",
      );
      // A new directory ID and explicit publication cycle represent a different issue, even with reused theme.
      f.html = directory(
        article(f.html, "230").replaceAll("/view/230", "/view/1230").replaceAll("2027", "2028"),
      );
      await execute();
      ok(
        new Set((await primary()).map((r) => r.id)).size === 4,
        "recurring theme with a new call identifier and edition year stays distinct",
      );
      const original = await journalFixtures();
      f.html = directory(
        article(original.html, "230"),
        '<article class="obj_announcement_summary"><h2><a href="https://journals.univie.ac.at/index.php/jeacs/announcement/view/9999">Malformed</a></h2></article>',
        article(original.html, "174"),
      );
      f.detail = original.detail;
      const partial = await execute();
      const [partialStats] =
        await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed from radar.collection_runs where id=${partial.run}`;
      ok(
        partialStats.records_seen === 3 && partialStats.accepted === 2 &&
          partialStats.rejected === 1 && partialStats.pages_committed === 1,
        "valid malformed valid siblings commit two calls plus one durable quarantine before cursor advancement",
      );
      detailFailure = true;
      const failedDetail = await execute();
      const [detailStats] =
        await sql`select accepted::integer,rejected::integer,pages_committed from radar.collection_runs where id=${failedDetail.run}`;
      ok(
        detailStats.accepted === 1 && detailStats.rejected === 2 &&
          detailStats.pages_committed === 1,
        "failed bounded detail fetch quarantines its call while regular CFP sibling persists",
      );
      detailFailure = false;
      const beforeDisable = (await primary()).map((r) => [r.id, r.deadline_id]);
      const disabledRun = await repository.createRun(id, `p06:${id}:disable`, "test"),
        lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
      assert(lease?.runId === disabledRun);
      await sql`update radar.sources set enabled=false where id=${id}`;
      try {
        await collect(lease, deps, signal);
        throw new TestAssertionError("disabled journal collected");
      } catch (e) {
        assert(e instanceof ProcessingError && e.code === "source_disabled" && e.canceled);
      }
      await repository.finish(lease, "canceled", "source_disabled", 60);
      equals((await primary()).map((r) => [r.id, r.deadline_id]), beforeDisable);
      await sql`update radar.sources set enabled=true where id=${id}`;
      await execute();
      const [health] = await sql`select consecutive_failures from radar.sources where id=${id}`;
      ok(
        health.consecutive_failures === 0 && (await primary()).some((r) => r.id === ref.id),
        "disable and re-enable retain call identities and canceled work does not harm source health",
      );
    }
    const [{ notifications }] =
      await sql`select count(*)::integer as notifications from radar.notifications`;
    ok(notifications === 0, "journal ingestion creates no delivery or notification work");
  } catch (e) {
    if (e instanceof TestAssertionError) console.error(`Journal assertion: ${e.message}`);
    if (e instanceof ProcessingError) console.error(`Journal error: ${e.code}`);
    throw e;
  } finally {
    const owned = [...new Set((await snapshot()).map((r) => String(r.id)))];
    await sql.begin(async (tx) => {
      await tx`delete from radar.job_tasks where collection_run_id in(select id from radar.collection_runs where source_id=any(${sourceIds}::uuid[]))`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${owned}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id=any(${owned}::uuid[])`;
      await tx`delete from radar.source_records where source_id=any(${sourceIds}::uuid[])`;
      await tx`delete from radar.collection_runs where source_id=any(${sourceIds}::uuid[])`;
      await tx`delete from radar.opportunities where id=any(${owned}::uuid[])`;
      await tx`delete from radar.sources where id=any(${sourceIds}::uuid[])`;
      await tx`update radar.system_settings set value=${
        tx.json(pause.value)
      } where key='collection_paused'`;
    });
    const [remaining] =
      await sql`select exists(select 1 from radar.sources where id=any(${sourceIds}::uuid[])) or exists(select 1 from radar.opportunities where id=any(${owned}::uuid[])) as found`;
    assert(!remaining.found, "journal scoped cleanup");
    console.log("PASS: journal shared-canonical cleanup; pause restored.");
  }
  assert(inputHash === await conferenceInputHash(), "journal inputs changed during verification");
  await Deno.writeTextFile(
    `private/phase06-journals-${live ? "smoke" : "integration"}.json`,
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: new Date().toISOString(),
        inputHash,
        assertions: passed,
        initialCounts,
        samples,
        measurements,
        cleanup: true,
      },
      null,
      2,
    ),
  );
}
