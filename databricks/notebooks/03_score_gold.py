# Databricks notebook source
from pyspark.sql import functions as F


funding = spark.table("athena_catalog.athena_schema.silver_funding")

scored = (
    funding.withColumn(
        "funding_gap",
        F.when(F.col("requirements") > 0, (F.col("requirements") - F.col("funding")) / F.col("requirements")).otherwise(None),
    )
    .withColumn("risk_score", F.coalesce(F.col("funding_gap"), F.lit(0.0)))
    .withColumn(
        "status",
        F.when(F.col("risk_score") > 0.66, F.lit("red"))
        .when(F.col("risk_score") > 0.33, F.lit("yellow"))
        .otherwise(F.lit("green")),
    )
)

scored.write.mode("overwrite").saveAsTable("athena_catalog.athena_schema.gold_country_risk_daily")
