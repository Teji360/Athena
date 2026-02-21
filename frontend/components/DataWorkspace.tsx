"use client";

import { useEffect, useState } from "react";

type DataRow = {
  iso3: string;
  country: string | null;
  status: "green" | "yellow" | "red";
  riskScore: number;
  fundingGapRatio: number | null;
  inNeed: number | null;
  floodPopExposed: number | null;
};

export default function DataWorkspace() {
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/countries/risk");
        if (!res.ok) {
          throw new Error(`Failed to fetch data (${res.status})`);
        }
        const payload = (await res.json()) as { data?: DataRow[] };
        setRows(payload.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown data load error");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="content-page">
      <header className="content-header">
        <h1>Pure Data View</h1>
        <p>Live country records from `gold_country_risk_serving`.</p>
      </header>
      {loading ? <div className="content-card">Loading data...</div> : null}
      {error ? <div className="content-card">{error}</div> : null}
      {!loading && !error ? (
        <div className="content-card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ISO3</th>
                <th>Country</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Funding gap</th>
                <th>In need</th>
                <th>Flood exposed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.iso3}>
                  <td>{row.iso3}</td>
                  <td>{row.country ?? "-"}</td>
                  <td>{row.status}</td>
                  <td>{row.riskScore.toFixed(3)}</td>
                  <td>{row.fundingGapRatio == null ? "-" : row.fundingGapRatio.toFixed(3)}</td>
                  <td>{row.inNeed == null ? "-" : Math.round(row.inNeed).toLocaleString()}</td>
                  <td>{row.floodPopExposed == null ? "-" : Math.round(row.floodPopExposed).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
