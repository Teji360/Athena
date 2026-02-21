export type DatabricksConfig = {
  host?: string;
  token?: string;
  warehouseId?: string;
};

export function getDatabricksConfig(): DatabricksConfig {
  return {
    host: process.env.DATABRICKS_HOST,
    token: process.env.DATABRICKS_TOKEN,
    warehouseId: process.env.DATABRICKS_WAREHOUSE_ID
  };
}
