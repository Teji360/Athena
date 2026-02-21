"use client";

import { useState } from "react";

export default function PlanningWorkspace() {
  const [title, setTitle] = useState("Sudan Multi-Sector Response Plan");
  const [objective, setObjective] = useState(
    "Reduce immediate humanitarian risk over the next 30 days in high-priority regions."
  );
  const [actions, setActions] = useState(
    "- Deploy emergency logistics to top red-risk areas\n- Coordinate WASH and medical supply corridors\n- Schedule daily risk review with UN cluster leads"
  );

  return (
    <main className="content-page">
      <header className="content-header">
        <h1>Planning Workspace</h1>
        <p>Draft an operational plan for UN response teams.</p>
      </header>
      <div className="content-grid">
        <section className="content-card">
          <h3>Plan Metadata</h3>
          <label className="field-label">Operation title</label>
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label className="field-label">Strategic objective</label>
          <textarea
            className="field-textarea"
            rows={4}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />

          <label className="field-label">Action draft</label>
          <textarea
            className="field-textarea"
            rows={8}
            value={actions}
            onChange={(e) => setActions(e.target.value)}
          />
        </section>

        <aside className="content-card">
          <h3>Plan Preview</h3>
          <p><strong>Title:</strong> {title}</p>
          <p><strong>Objective:</strong> {objective}</p>
          <p><strong>Drafted actions:</strong></p>
          <pre className="plan-preview">{actions}</pre>
          <button className="ai-toggle" type="button">
            Save Draft (next step)
          </button>
        </aside>
      </div>
    </main>
  );
}
