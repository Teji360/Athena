"use client";

import { useMemo, useState } from "react";
import { ssdClusters, ssdOverall } from "@/lib/ssdClusterData";

// ── Budget constants ──────────────────────────────────────────────────────────
// Standard humanitarian unit costs (USD/beneficiary/year) per cluster
// Sources: OCHA Financial Tracking, WFP cost norms, UNICEF cluster guidelines
const UNIT_COSTS: Record<string, number> = {
  HEA: 42,   // Primary health care package (WHO/MoH)
  FSC: 95,   // Food assistance incl. logistics (WFP standard)
  WSH: 28,   // Safe water + sanitation + hygiene promotion (UNICEF)
  SHL: 174,  // Shelter/NFI per household (avg 5 people) → ~$34.80/person
  NUT: 65,   // CMAM + therapeutic feeding per beneficiary (UNICEF)
};

// ── Scenario presets (coverage % of in-need population) ───────────────────────
type Scenario = { label: string; coverages: Record<string, number>; color: string };
const SCENARIOS: Scenario[] = [
  {
    label: "Minimum (HPC 2026)",
    color: "#ef4444",
    coverages: {
      HEA: Math.round((2_884_600 / 6_269_692) * 100),
      FSC: Math.round((2_664_032 / 7_650_962) * 100),
      WSH: Math.round((2_167_689 / 6_806_495) * 100),
      SHL: Math.round((1_511_270 / 6_669_355) * 100),
      NUT: Math.round((1_833_612 / 5_250_933) * 100),
    },
  },
  {
    label: "Scale-Up (50% coverage)",
    color: "#f97316",
    coverages: { HEA: 50, FSC: 50, WSH: 50, SHL: 50, NUT: 50 },
  },
  {
    label: "Emergency Surge (70%)",
    color: "#eab308",
    coverages: { HEA: 70, FSC: 70, WSH: 70, SHL: 70, NUT: 70 },
  },
  {
    label: "Full Response (90%)",
    color: "#22c55e",
    coverages: { HEA: 90, FSC: 90, WSH: 90, SHL: 90, NUT: 90 },
  },
];

const CLUSTER_IDS = ["HEA", "FSC", "WSH", "SHL", "NUT"] as const;
type ClusterId = (typeof CLUSTER_IDS)[number];

function fmt(n: number): string {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toFixed(0);
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toLocaleString();
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PlanningWorkspace() {
  const clusterMap = useMemo(
    () => Object.fromEntries(ssdClusters.map((c) => [c.id, c])),
    []
  );

  // Per-cluster coverage % (slider) and unit cost override
  const [coverages, setCoverages] = useState<Record<ClusterId, number>>({
    HEA: Math.round((2_884_600 / 6_269_692) * 100),
    FSC: Math.round((2_664_032 / 7_650_962) * 100),
    WSH: Math.round((2_167_689 / 6_806_495) * 100),
    SHL: Math.round((1_511_270 / 6_669_355) * 100),
    NUT: Math.round((1_833_612 / 5_250_933) * 100),
  });

  const [unitCosts, setUnitCosts] = useState<Record<ClusterId, number>>({ ...UNIT_COSTS } as Record<ClusterId, number>);
  const [planTitle, setPlanTitle] = useState("South Sudan Humanitarian Response Budget 2026");
  const [planNote, setPlanNote] = useState(
    "Targeting the highest-priority counties in Unity, Jonglei, and Upper Nile states. Coordination through OCHA-led cluster system with WHO, WFP, UNICEF, and UNHCR as lead agencies."
  );
  const [activeScenario, setActiveScenario] = useState(0);
  const [copied, setCopied] = useState(false);

  // Derived per-cluster numbers
  const clusterBudgets = useMemo(() => {
    return CLUSTER_IDS.map((id) => {
      const cluster = clusterMap[id];
      if (!cluster) return null;
      const coveragePct = coverages[id] ?? 30;
      const beneficiaries = Math.round((cluster.inNeed * coveragePct) / 100);
      const uc = unitCosts[id] ?? UNIT_COSTS[id] ?? 0;
      // SHL: convert to households (÷5)
      const cost = id === "SHL" ? Math.round((beneficiaries / 5) * uc) : Math.round(beneficiaries * uc);
      return {
        id,
        name: cluster.name,
        color: cluster.color,
        inNeed: cluster.inNeed,
        coveragePct,
        beneficiaries,
        unitCost: uc,
        cost,
      };
    }).filter(Boolean);
  }, [coverages, unitCosts, clusterMap]);

  const totalBudget = useMemo(
    () => clusterBudgets.reduce((s, c) => s + (c?.cost ?? 0), 0),
    [clusterBudgets]
  );

  const totalBeneficiaries = useMemo(
    () => clusterBudgets.reduce((s, c) => s + (c?.beneficiaries ?? 0), 0),
    [clusterBudgets]
  );

  // Apply scenario preset
  function applyScenario(idx: number) {
    setActiveScenario(idx);
    const sc = SCENARIOS[idx];
    if (!sc) return;
    setCoverages((prev) => {
      const next = { ...prev };
      for (const id of CLUSTER_IDS) {
        next[id] = sc.coverages[id] ?? prev[id];
      }
      return next;
    });
  }

  // Generate plan text for copy/export
  const planText = useMemo(() => {
    const date = new Date().toISOString().split("T")[0];
    const lines = [
      `SOUTH SUDAN HUMANITARIAN RESPONSE BUDGET PLAN`,
      `Generated: ${date}`,
      `Plan: ${planTitle}`,
      ``,
      `CONTEXT`,
      `─────────────────────────────────────────────`,
      `Total population (2025 est.):     ${fmtN(ssdOverall.totalPopulation)}`,
      `People in need:                   ${fmtN(ssdOverall.totalInNeed)}`,
      `Internally displaced (DTM R16):   ${fmtN(ssdOverall.idpIndividuals)}`,
      `WHO health facilities:            ${ssdOverall.healthFacilities.toLocaleString()}`,
      `WFP active markets:               ${ssdOverall.wfpMarkets}`,
      ``,
      `STRATEGIC NOTE`,
      `─────────────────────────────────────────────`,
      planNote,
      ``,
      `CLUSTER BUDGET BREAKDOWN`,
      `─────────────────────────────────────────────`,
      `${"Cluster".padEnd(22)} ${"In Need".padStart(10)} ${"Coverage".padStart(10)} ${"Beneficiaries".padStart(15)} ${"Unit Cost".padStart(11)} ${"Budget".padStart(14)}`,
    ];

    for (const c of clusterBudgets) {
      if (!c) continue;
      const ucLabel = c.id === "SHL" ? `$${c.unitCost}/HH` : `$${c.unitCost}/pp`;
      lines.push(
        `${c.name.padEnd(22)} ${fmtN(c.inNeed).padStart(10)} ${(c.coveragePct + "%").padStart(10)} ${fmtN(c.beneficiaries).padStart(15)} ${ucLabel.padStart(11)} ${fmt(c.cost).padStart(14)}`
      );
    }

    lines.push(
      ``,
      `─────────────────────────────────────────────`,
      `TOTAL BUDGET REQUIREMENT:         ${fmt(totalBudget)}`,
      `Total beneficiaries targeted:     ${fmtN(totalBeneficiaries)}`,
      `Average cost per beneficiary:     $${totalBeneficiaries > 0 ? (totalBudget / totalBeneficiaries).toFixed(2) : "N/A"}`,
      ``,
      `DATA SOURCES`,
      `─────────────────────────────────────────────`,
      `• HPC 2026 South Sudan Caseload (OCHA)`,
      `• WHO Master Facility List, April 2025`,
      `• WFP Market Monitoring SSD`,
      `• DTM Round 16 Baseline Assessment (IOM)`,
      `• SSSD Population Estimates 2025 (NBS/UNFPA)`,
      ``,
      `CLUSTER LEADS`,
      `─────────────────────────────────────────────`,
      `Health (HEA):          WHO / Ministry of Health`,
      `Food Security (FSC):   WFP / FAO`,
      `WASH (WSH):            UNICEF`,
      `Shelter/NFI (SHL):     UNHCR / IOM`,
      `Nutrition (NUT):       UNICEF / WFP`,
    );

    return lines.join("\n");
  }, [clusterBudgets, totalBudget, totalBeneficiaries, planTitle, planNote]);

  function copyPlan() {
    void navigator.clipboard.writeText(planText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="content-page">
      <header className="content-header">
        <h1>Planning Workspace</h1>
        <p>Build an evidence-based humanitarian budget for South Sudan across all UN clusters.</p>
      </header>

      <div className="plan-layout">
        {/* ── Left column: metadata + cluster sliders ── */}
        <div className="plan-left">

          {/* Plan metadata */}
          <div className="content-card plan-meta-card">
            <div className="plan-section-label">Plan Metadata</div>
            <label className="field-label">Operation title</label>
            <input
              className="field-input"
              value={planTitle}
              onChange={(e) => setPlanTitle(e.target.value)}
            />
            <label className="field-label">Strategic note</label>
            <textarea
              className="field-textarea"
              rows={3}
              value={planNote}
              onChange={(e) => setPlanNote(e.target.value)}
            />
          </div>

          {/* Context facts */}
          <div className="content-card">
            <div className="plan-section-label">South Sudan Context (2026)</div>
            <div className="plan-context-grid">
              <div className="plan-context-stat">
                <span className="plan-context-val">{fmtN(ssdOverall.totalPopulation)}</span>
                <span className="plan-context-lbl">Population</span>
              </div>
              <div className="plan-context-stat">
                <span className="plan-context-val" style={{ color: "#ef4444" }}>{fmtN(ssdOverall.totalInNeed)}</span>
                <span className="plan-context-lbl">People in Need</span>
              </div>
              <div className="plan-context-stat">
                <span className="plan-context-val" style={{ color: "#f97316" }}>{fmtN(ssdOverall.idpIndividuals)}</span>
                <span className="plan-context-lbl">IDPs (DTM R16)</span>
              </div>
              <div className="plan-context-stat">
                <span className="plan-context-val" style={{ color: "#3b82f6" }}>{ssdOverall.healthFacilities.toLocaleString()}</span>
                <span className="plan-context-lbl">Health Facilities</span>
              </div>
              <div className="plan-context-stat">
                <span className="plan-context-val" style={{ color: "#a855f7" }}>{ssdOverall.wfpMarkets}</span>
                <span className="plan-context-lbl">WFP Markets</span>
              </div>
              <div className="plan-context-stat">
                <span className="plan-context-val" style={{ color: "#22c55e" }}>{fmtN(ssdOverall.totalTargeted)}</span>
                <span className="plan-context-lbl">HPC 2026 Target</span>
              </div>
            </div>
          </div>

          {/* Scenario presets */}
          <div className="content-card">
            <div className="plan-section-label">Scenario Presets</div>
            <div className="plan-scenario-row">
              {SCENARIOS.map((sc, i) => (
                <button
                  key={sc.label}
                  type="button"
                  className={`plan-scenario-btn ${activeScenario === i ? "active" : ""}`}
                  style={activeScenario === i ? { borderColor: sc.color, color: sc.color } : {}}
                  onClick={() => applyScenario(i)}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cluster budget sliders */}
          <div className="content-card">
            <div className="plan-section-label">Cluster Budgets — Adjust Coverage &amp; Unit Cost</div>
            {clusterBudgets.map((c) => {
              if (!c) return null;
              return (
                <div key={c.id} className="plan-cluster-row">
                  <div className="plan-cluster-header">
                    <span
                      className="plan-cluster-badge"
                      style={{ background: c.color }}
                    >
                      {c.id}
                    </span>
                    <span className="plan-cluster-name">{c.name}</span>
                    <span className="plan-cluster-budget" style={{ color: c.color }}>
                      {fmt(c.cost)}
                    </span>
                  </div>

                  <div className="plan-cluster-meta">
                    <span>{fmtN(c.inNeed)} in need</span>
                    <span style={{ color: c.color }}>→ {fmtN(c.beneficiaries)} targeted ({c.coveragePct}%)</span>
                  </div>

                  {/* Coverage slider */}
                  <div className="plan-slider-wrap">
                    <span className="plan-slider-label">Coverage</span>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      step={1}
                      value={c.coveragePct}
                      className="plan-slider"
                      style={{ "--thumb-color": c.color } as React.CSSProperties}
                      onChange={(e) =>
                        setCoverages((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))
                      }
                    />
                    <span className="plan-slider-val">{c.coveragePct}%</span>
                  </div>

                  {/* Unit cost override */}
                  <div className="plan-slider-wrap">
                    <span className="plan-slider-label">
                      {c.id === "SHL" ? "$/HH" : "$/person"}
                    </span>
                    <input
                      type="range"
                      min={5}
                      max={c.id === "FSC" ? 200 : c.id === "SHL" ? 350 : 150}
                      step={1}
                      value={c.unitCost}
                      className="plan-slider"
                      style={{ "--thumb-color": c.color } as React.CSSProperties}
                      onChange={(e) =>
                        setUnitCosts((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))
                      }
                    />
                    <span className="plan-slider-val">${c.unitCost}</span>
                  </div>

                  {/* Coverage fill bar */}
                  <div className="plan-bar-track">
                    <div
                      className="plan-bar-fill"
                      style={{ width: `${c.coveragePct}%`, background: c.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right column: summary + export ── */}
        <div className="plan-right">

          {/* Budget summary */}
          <div className="content-card plan-summary-card">
            <div className="plan-section-label">Budget Summary</div>
            <div className="plan-total">
              <span className="plan-total-label">Total Requirement</span>
              <span className="plan-total-value">{fmt(totalBudget)}</span>
            </div>
            <div className="plan-total-sub">
              {fmtN(totalBeneficiaries)} beneficiaries ·{" "}
              {totalBeneficiaries > 0
                ? `avg $${(totalBudget / totalBeneficiaries).toFixed(2)}/person`
                : "—"}
            </div>

            {/* Per-cluster breakdown bars */}
            <div className="plan-breakdown">
              {clusterBudgets.map((c) => {
                if (!c) return null;
                const pct = totalBudget > 0 ? (c.cost / totalBudget) * 100 : 0;
                return (
                  <div key={c.id} className="plan-breakdown-row">
                    <span className="plan-breakdown-name" style={{ color: c.color }}>
                      {c.id}
                    </span>
                    <div className="plan-breakdown-bar-wrap">
                      <div
                        className="plan-breakdown-bar"
                        style={{ width: `${pct}%`, background: c.color }}
                      />
                    </div>
                    <span className="plan-breakdown-val">{fmt(c.cost)}</span>
                    <span className="plan-breakdown-pct">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Cluster leads reference */}
            <div className="plan-leads">
              <div className="plan-section-label" style={{ marginTop: 12 }}>Cluster Leads</div>
              {[
                { id: "HEA", lead: "WHO / MoH", color: "#ef4444" },
                { id: "FSC", lead: "WFP / FAO", color: "#f97316" },
                { id: "WSH", lead: "UNICEF", color: "#3b82f6" },
                { id: "SHL", lead: "UNHCR / IOM", color: "#eab308" },
                { id: "NUT", lead: "UNICEF / WFP", color: "#a855f7" },
              ].map((l) => (
                <div key={l.id} className="plan-lead-row">
                  <span className="plan-cluster-badge" style={{ background: l.color }}>{l.id}</span>
                  <span>{l.lead}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Plan preview + export */}
          <div className="content-card">
            <div className="plan-section-label">Plan Export</div>
            <pre className="plan-preview plan-preview-budget">{planText}</pre>
            <button type="button" className="plan-copy-btn" onClick={copyPlan}>
              {copied ? "Copied!" : "Copy Plan to Clipboard"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
