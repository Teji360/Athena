# Databricks notebook source
import requests
from datetime import datetime


def download_to_volume(file_url: str, destination_path: str) -> None:
    response = requests.get(file_url, timeout=60)
    response.raise_for_status()
    dbutils.fs.put(destination_path, response.text, overwrite=True)


run_date = datetime.utcnow().strftime("%Y-%m-%d")
base_volume = "/Volumes/athena_catalog/athena_schema/athena_volume/bronze"

# Example source. Replace with production URLs.
funding_url = "https://data.humdata.org/dataset/.../download/file.csv"
funding_path = f"{base_volume}/fts_requirements_funding_global/dt={run_date}/data.csv"
download_to_volume(funding_url, funding_path)
