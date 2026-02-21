# Databricks notebook source
from pyspark.sql import functions as F


bronze = spark.read.option("header", True).csv(
    "/Volumes/athena_catalog/athena_schema/athena_volume/bronze/fts_requirements_funding_global/*/*.csv"
)

silver = (
    bronze.filter(~F.col("countryCode").startswith("#"))
    .withColumn("requirements", F.col("requirements").cast("double"))
    .withColumn("funding", F.col("funding").cast("double"))
    .withColumn("percentFunded", F.col("percentFunded").cast("double"))
    .withColumnRenamed("countryCode", "iso3")
)

silver.write.mode("overwrite").saveAsTable("athena_catalog.athena_schema.silver_funding")
