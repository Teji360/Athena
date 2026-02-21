export type DatabricksConfig = {
  host?: string;
  token?: string;
  warehouseId?: string;
  riskTable?: string;
};

export function getDatabricksConfig(): DatabricksConfig {
  return {
    host: process.env.DATABRICKS_HOST,
    token: process.env.DATABRICKS_TOKEN,
    warehouseId: process.env.DATABRICKS_WAREHOUSE_ID,
    riskTable:
      process.env.DATABRICKS_RISK_TABLE ?? "workspace.default.gold_country_risk_serving"
  };
}

type StatementStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "CLOSED";

type StatementResponse = {
  statement_id?: string;
  status?: { state?: StatementStatus; error?: { message?: string } };
  result?: {
    data_array?: unknown[][];
    manifest?: {
      schema?: {
        columns?: Array<{ name?: string }>;
      };
    };
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDatabricksConfig(config: DatabricksConfig) {
  if (!config.host || !config.token || !config.warehouseId) {
    throw new Error(
      "Missing Databricks config. Set DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID."
    );
  }
}

async function databricksFetch(
  config: DatabricksConfig,
  path: string,
  init?: RequestInit
): Promise<StatementResponse> {
  const response = await fetch(`${config.host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Databricks API error (${response.status}): ${body}`);
  }
  return (await response.json()) as StatementResponse;
}

function rowsToObjects(statement: StatementResponse): Array<Record<string, unknown>> {
  const cols = statement.result?.manifest?.schema?.columns ?? [];
  const rows = statement.result?.data_array ?? [];
  if (cols.length === 0) {
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      row.forEach((value, idx) => {
        out[`col_${idx}`] = value;
      });
      return out;
    });
  }
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    cols.forEach((col, idx) => {
      out[col.name ?? `col_${idx}`] = row[idx];
    });
    return out;
  });
}

export async function runDatabricksQuery(
  sql: string
): Promise<Array<Record<string, unknown>>> {
  const config = getDatabricksConfig();
  ensureDatabricksConfig(config);

  const submit = await databricksFetch(config, "/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: config.warehouseId,
      statement: sql,
      disposition: "INLINE",
      format: "JSON_ARRAY",
      wait_timeout: "30s"
    })
  });

  const statementId = submit.statement_id;
  if (!statementId) {
    throw new Error("Databricks statement_id missing in response.");
  }

  let current = submit;
  let state = current.status?.state;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (state === "SUCCEEDED") {
      return rowsToObjects(current);
    }
    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
      const message = current.status?.error?.message ?? "Statement execution failed.";
      throw new Error(message);
    }
    await sleep(1000);
    current = await databricksFetch(
      config,
      `/api/2.0/sql/statements/${statementId}`
    );
    state = current.status?.state;
  }

  throw new Error("Databricks statement polling timed out.");
}
