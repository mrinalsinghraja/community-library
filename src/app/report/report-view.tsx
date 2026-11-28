"use client";

import { useState } from "react";

interface Row {
  key: string;
  name: string;
  group: string;
  hits: number;
  users: number;
}
interface Day {
  day: string;
  hits: number;
  users: number;
}
interface Report {
  from: string;
  to: string;
  days: Day[];
  features: Row[];
  countries: Row[];
  states: Row[];
  cities: Row[];
  totals: { hits: number; userDays: number };
  firstDay: string | null;
}

const nf = new Intl.NumberFormat("en-IN");

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border-2 border-black/15 bg-white p-4">
      <div className="text-sm opacity-70">{label}</div>
      <div className="font-display text-3xl">{value}</div>
      {note ? <div className="text-xs opacity-60">{note}</div> : null}
    </div>
  );
}

function csv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((r) => r.map(quote).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Toggle({ mode, onChange }: { mode: "chart" | "table"; onChange: (m: "chart" | "table") => void }) {
  return (
    <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-xl border-2 border-black/30">
      {(["chart", "table"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`min-h-10 px-4 text-sm font-semibold ${mode === m ? "bg-black text-white" : "bg-white"}`}
        >
          {m === "chart" ? "Chart" : "Table"}
        </button>
      ))}
    </div>
  );
}

function DailyChart({ days, color }: { days: Day[]; color: string }) {
  const W = 900;
  const H = 280;
  const pad = { l: 48, r: 48, t: 12, b: 28 };
  const max = Math.max(1, ...days.map((d) => d.hits));
  const nice = Math.ceil(max / 4) * 4 || 4;
  // Users are far fewer than hits, so they get their own scale on the right.
  const maxU = Math.max(1, ...days.map((d) => d.users));
  const niceU = Math.ceil(maxU / 4) * 4 || 4;
  const yU = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / niceU);
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const line = days
    .map((d, i) => `${i === 0 ? "M" : "L"}${pad.l + bw * i + bw / 2},${yU(d.users)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hits and users per day">
      {[0, 1, 2, 3, 4].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y((nice / 4) * t)} y2={y((nice / 4) * t)} stroke="currentColor" opacity=".12" />
          <text x={pad.l - 6} y={y((nice / 4) * t) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity=".7">
            {nf.format((nice / 4) * t)}
          </text>
          <text x={W - pad.r + 6} y={y((nice / 4) * t) + 4} fontSize="11" fill={color} fontWeight="700">
            {nf.format((niceU / 4) * t)}
          </text>
        </g>
      ))}
      {days.map((d, i) => (
        <g key={d.day}>
          <rect x={pad.l + bw * i + 1} y={y(d.hits)} width={Math.max(1, bw - 2)} height={H - pad.b - y(d.hits)} fill={color} opacity=".35" rx="1.5" />
          <rect x={pad.l + bw * i} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent">
            <title>{`${d.day}: ${nf.format(d.hits)} hits, ${nf.format(d.users)} users`}</title>
          </rect>
          {i % 15 === 0 ? (
            <text x={pad.l + bw * i} y={H - 8} fontSize="11" fill="currentColor" opacity=".7">
              {d.day.slice(5)}
            </text>
          ) : null}
        </g>
      ))}
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}

function Bars({ rows, color, limit = 15 }: { rows: Row[]; color: string; limit?: number }) {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.hits));
  if (shown.length === 0) return <p className="py-6 opacity-70">Nothing counted yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((r) => (
        <li key={`${r.group}|${r.key}`} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_auto]">
          <span className="truncate" title={r.group ? `${r.name}, ${r.group}` : r.name}>
            {r.name}
            {r.group ? <span className="opacity-60">, {r.group}</span> : null}
          </span>
          <span className="h-5 rounded-md bg-black/5">
            <span className="block h-5 rounded-md" style={{ width: `${(r.hits / max) * 100}%`, background: color }} />
          </span>
          <span className="tabular-nums">
            {nf.format(r.hits)} <span className="opacity-60">· {nf.format(r.users)} users</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="max-h-[28rem] overflow-auto rounded-xl border-2 border-black/15">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-[#f3efe6]">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-2 ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-black/10">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 ${j === 0 ? "" : "text-right tabular-nums"}`}>
                  {typeof c === "number" ? nf.format(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  note,
  children,
  table,
  csvName,
  csvHead,
  csvRows,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  table: React.ReactNode;
  csvName: string;
  csvHead: string[];
  csvRows: Array<Array<string | number>>;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <section className="mt-8 rounded-2xl border-2 border-black/15 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl">{title}</h2>
          {note ? <p className="text-xs opacity-65">{note}</p> : null}
        </div>
        <div className="flex gap-2">
          <Toggle mode={mode} onChange={setMode} />
          <button
            type="button"
            onClick={() => csv(csvName, csvHead, csvRows)}
            className="min-h-10 rounded-xl border-2 border-black/30 px-3 text-sm font-semibold"
          >
            CSV
          </button>
        </div>
      </div>
      {mode === "chart" ? children : table}
    </section>
  );
}

export function ReportView({ report, color }: { report: Report; color: string }) {
  const today = report.days[report.days.length - 1];
  const avg = Math.round(report.totals.hits / Math.max(1, report.days.length));
  const rowsOf = (rs: Row[]) => rs.map((r) => [r.name, r.hits, r.users]);
  const withState = (rs: Row[]) => rs.map((r) => [r.name, r.group, r.hits, r.users]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hits, 90 days" value={nf.format(report.totals.hits)} />
        <Stat label="Users, 90 days" value={nf.format(report.totals.userDays)} note="each device once a day" />
        <Stat label="Today" value={nf.format(today?.hits ?? 0)} note={`${nf.format(today?.users ?? 0)} users`} />
        <Stat label="Average a day" value={nf.format(avg)} note="hits" />
      </div>
      <p className="mt-3 text-xs opacity-65">
        A hit is one page opened. A user is one device on one day, however many pages it opened.
        {report.firstDay ? ` Counting began on ${report.firstDay}.` : " Counting has not recorded anything yet."}
      </p>

      <Section
        title="Every day"
        note="Bars are hits (left scale). The line is users (right scale)."
        csvName="usage-by-day.csv"
        csvHead={["Day", "Hits", "Users"]}
        csvRows={report.days.map((d) => [d.day, d.hits, d.users])}
        table={<Table head={["Day", "Hits", "Users"]} rows={[...report.days].reverse().map((d) => [d.day, d.hits, d.users])} />}
      >
        <DailyChart days={report.days} color={color} />
      </Section>

      <Section
        title="Features used"
        csvName="usage-by-feature.csv"
        csvHead={["Feature", "Hits", "Users"]}
        csvRows={rowsOf(report.features)}
        table={<Table head={["Feature", "Hits", "Users"]} rows={rowsOf(report.features)} />}
      >
        <Bars rows={report.features} color={color} limit={20} />
      </Section>

      <Section
        title="Countries"
        csvName="usage-by-country.csv"
        csvHead={["Country", "Hits", "Users"]}
        csvRows={rowsOf(report.countries)}
        table={<Table head={["Country", "Hits", "Users"]} rows={rowsOf(report.countries)} />}
      >
        <Bars rows={report.countries} color={color} />
      </Section>

      <Section
        title="India: states"
        csvName="usage-by-state.csv"
        csvHead={["State", "Hits", "Users"]}
        csvRows={rowsOf(report.states)}
        table={<Table head={["State", "Hits", "Users"]} rows={rowsOf(report.states)} />}
      >
        <Bars rows={report.states} color={color} />
      </Section>

      <Section
        title="India: cities"
        note="From the connection's address, so it can name the provider's hub rather than the street. Treat it as a guide."
        csvName="usage-by-city.csv"
        csvHead={["City", "State", "Hits", "Users"]}
        csvRows={withState(report.cities)}
        table={<Table head={["City", "State", "Hits", "Users"]} rows={withState(report.cities)} />}
      >
        <Bars rows={report.cities} color={color} limit={20} />
      </Section>
    </>
  );
}
