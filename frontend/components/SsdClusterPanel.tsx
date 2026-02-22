"use client";

import { useState } from "react";
import { ssdClusters, ssdOverall, type UnCluster } from "@/lib/ssdClusterData";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toLocaleString();
}

function pct(part: number, total: number): string {
  return ((part / total) * 100).toFixed(0) + "%";
}

function ClusterCard({ cluster }: { cluster: UnCluster }) {
  const [expanded, setExpanded] = useState(false);
  const coveragePct = Math.round((cluster.targeted / cluster.inNeed) * 100);

  return (
    <div
      className="cluster-card"
      style={{ borderColor: cluster.borderColor, background: cluster.bgColor }}
    >
      {/* Header */}
      <button
        type="button"
        className="cluster-card-header"
        onClick={() => setExpanded((p) => !p)}
        style={{ color: cluster.color }}
      >
        <span className="cluster-badge" style={{ background: cluster.color }}>
          {cluster.id}
        </span>
        <span className="cluster-name">{cluster.name}</span>
        <span className="cluster-chevron">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Always-visible summary bar */}
      <div className="cluster-summary">
        <div className="cluster-summary-col">
          <span className="cluster-metric-label">In Need</span>
          <span className="cluster-metric-value">{fmt(cluster.inNeed)}</span>
        </div>
        <div className="cluster-summary-divider" />
        <div className="cluster-summary-col">
          <span className="cluster-metric-label">Targeted</span>
          <span className="cluster-metric-value">{fmt(cluster.targeted)}</span>
        </div>
        <div className="cluster-summary-divider" />
        <div className="cluster-summary-col">
          <span className="cluster-metric-label">Coverage</span>
          <span className="cluster-metric-value" style={{ color: cluster.color }}>
            {coveragePct}%
          </span>
        </div>
      </div>

      {/* Coverage bar */}
      <div className="cluster-bar-track">
        <div
          className="cluster-bar-fill"
          style={{ width: `${Math.min(coveragePct, 100)}%`, background: cluster.color }}
        />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="cluster-detail">
          <p className="cluster-desc">{cluster.description}</p>

          <div className="cluster-services">
            <div className="cluster-section-label">Key Services</div>
            <ul>
              {cluster.keyServices.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="cluster-extra-stats">
            {cluster.stats.map((s) => (
              <div key={s.label} className="cluster-extra-row">
                <span>{s.label}</span>
                <span style={{ color: cluster.color }}>{s.value}</span>
              </div>
            ))}
          </div>

          {cluster.nfiItems && cluster.nfiItems.length > 0 && (
            <div className="cluster-nfi">
              <div className="cluster-section-label">Non-Food Items (NFIs)</div>
              <div className="cluster-nfi-grid">
                {cluster.nfiItems.map((item) => (
                  <div key={item.label} className="cluster-nfi-item">
                    <span className="cluster-nfi-label">{item.label}</span>
                    <span className="cluster-nfi-desc">{item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cluster-source">Source: {cluster.dataSource}</div>
        </div>
      )}
    </div>
  );
}

export default function SsdClusterPanel() {
  return (
    <div className="cluster-panel">
      {/* Summary header */}
      <div className="cluster-overview">
        <div className="cluster-overview-title">South Sudan · UN Cluster Response 2026</div>
        <div className="cluster-overview-grid">
          <div className="cluster-overview-stat">
            <span className="cluster-overview-num">{fmt(ssdOverall.totalInNeed)}</span>
            <span className="cluster-overview-lbl">People in Need</span>
          </div>
          <div className="cluster-overview-stat">
            <span className="cluster-overview-num">{fmt(ssdOverall.totalTargeted)}</span>
            <span className="cluster-overview-lbl">Targeted</span>
          </div>
          <div className="cluster-overview-stat">
            <span className="cluster-overview-num">{fmt(ssdOverall.idpIndividuals)}</span>
            <span className="cluster-overview-lbl">IDPs (internal)</span>
          </div>
          <div className="cluster-overview-stat">
            <span className="cluster-overview-num">{pct(ssdOverall.totalTargeted, ssdOverall.totalInNeed)}</span>
            <span className="cluster-overview-lbl">Overall coverage</span>
          </div>
        </div>
      </div>

      {/* Cluster cards */}
      <div className="cluster-list">
        {ssdClusters.map((cluster) => (
          <ClusterCard key={cluster.id} cluster={cluster} />
        ))}
      </div>

      <div className="cluster-panel-footer">
        HPC 2026 · WHO MFL Apr 2025 · WFP Markets · DTM R16
      </div>
    </div>
  );
}
