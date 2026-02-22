#!/usr/bin/env python3
"""Build an integrated Sudan/South Sudan information database CSV.

Output:
  /Users/davidaror/Documents/Projects/Angel/sudan_mass_information.csv
"""

from __future__ import annotations

import pandas as pd
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CLEAN_DIR = DATA_DIR / "clean"
OUT_PATH = ROOT / "sudan_mass_information.csv"


def to_numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def latest_demo_metrics() -> pd.DataFrame:
    demo = pd.read_csv(CLEAN_DIR / "demographic_data_iso.csv")
    demo["year"] = pd.to_numeric(demo["year"], errors="coerce")
    demo["value"] = pd.to_numeric(demo["value"], errors="coerce")
    demo = demo.dropna(subset=["iso3", "series", "year", "value"])
    demo = demo.sort_values(["iso3", "series", "year"], ascending=[True, True, False])
    latest = demo.drop_duplicates(["iso3", "series"], keep="first")
    piv = latest.pivot(index="iso3", columns="series", values="value").reset_index()
    piv = piv.rename(
        columns={
            "Population annual rate of increase (percent)": "population_growth_pct_latest",
            "Total fertility rate (children per women)": "fertility_rate_latest",
            "Under five mortality rate for both sexes (per 1,000 live births)": "under5_mortality_per_1000_latest",
            "Maternal mortality ratio (deaths per 100,000 population)": "maternal_mortality_per_100k_latest",
            "Life expectancy at birth for both sexes (years)": "life_expectancy_years_latest",
            "Life expectancy at birth for males (years)": "male_life_expectancy_years_latest",
            "Life expectancy at birth for females (years)": "female_life_expectancy_years_latest",
        }
    )
    return piv


def build() -> pd.DataFrame:
    # Base geography: county boundaries
    adm2 = pd.read_excel(DATA_DIR / "ssd_adminboundaries_tabulardata.xlsx", sheet_name="ADM2")
    adm2 = adm2.rename(
        columns={
            "ADM2_EN": "county_name",
            "ADM2_PCODE": "county_pcode",
            "ADM1_EN": "state_name",
            "ADM1_PCODE": "state_pcode",
            "AREA_SQKM": "county_area_sqkm",
        }
    )
    adm2 = adm2[["state_name", "state_pcode", "county_name", "county_pcode", "county_area_sqkm"]].copy()
    adm2["iso3"] = "SSD"
    adm2["country_name"] = "South Sudan"

    # Population + sex composition
    pop = pd.read_excel(DATA_DIR / "ssd_2024_population_estimates_data.xlsx", sheet_name="Pop_Stats_Summary")
    pop = pop.rename(
        columns={
            "Admin1": "state_name",
            "Admin1_Pcode": "state_pcode",
            "Admin2": "county_name",
            "Admin2_Pcode": "county_pcode",
            "Population - 2025": "population_2025_total",
            "No. of Male\nchildren under 5": "male_under5_n",
            "No. of Female\nchildren under 5": "female_under5_n",
            "No. of Male children \naged 5 - 17 years": "male_5_17_n",
            "No. of Female \nchildren aged 5 - 17 years": "female_5_17_n",
            "No. of  Male \nadults aged 18 - 60": "male_18_60_n",
            "No. of Female \nadults aged 18 - 60": "female_18_60_n",
            "No. of Male adults \naged over 60": "male_over60_n",
            "No. Female adults \naged over 60": "female_over60_n",
        }
    )
    pop = pop[
        [
            "state_name",
            "state_pcode",
            "county_name",
            "county_pcode",
            "population_2025_total",
            "male_under5_n",
            "female_under5_n",
            "male_5_17_n",
            "female_5_17_n",
            "male_18_60_n",
            "female_18_60_n",
            "male_over60_n",
            "female_over60_n",
        ]
    ].copy()
    pop = to_numeric(
        pop,
        [
            "population_2025_total",
            "male_under5_n",
            "female_under5_n",
            "male_5_17_n",
            "female_5_17_n",
            "male_18_60_n",
            "female_18_60_n",
            "male_over60_n",
            "female_over60_n",
        ],
    )
    pop["male_total_n"] = pop[["male_under5_n", "male_5_17_n", "male_18_60_n", "male_over60_n"]].sum(axis=1)
    pop["female_total_n"] = pop[["female_under5_n", "female_5_17_n", "female_18_60_n", "female_over60_n"]].sum(axis=1)
    pop["female_share_pct"] = (pop["female_total_n"] / pop["population_2025_total"]) * 100.0
    pop["male_share_pct"] = (pop["male_total_n"] / pop["population_2025_total"]) * 100.0

    # Nutrition
    nut = pd.read_csv(CLEAN_DIR / "south_sudan_nutrition.csv")
    nut = nut.rename(
        columns={
            "ADM1_STATE": "state_name",
            "ADM1_Pcode": "state_pcode",
            "ADM2_COUNTY": "county_name",
            "ADM2_Pcode": "county_pcode",
            "Proxy GAM 2022": "proxy_gam_2022",
        }
    )
    nut["proxy_gam_2022_pct"] = pd.to_numeric(nut["proxy_gam_2022"].astype(str).str.replace("%", "", regex=False), errors="coerce")
    nut["hunger_status"] = pd.cut(
        nut["proxy_gam_2022_pct"],
        bins=[-1, 10, 20, 1000],
        labels=["green", "yellow", "red"],
    )
    nut = nut[["state_name", "state_pcode", "county_name", "county_pcode", "proxy_gam_2022_pct", "hunger_status"]]

    # WHO facilities by county
    fac = pd.read_excel(DATA_DIR / "who-master-facility-list_april2025.xlsx", sheet_name="hsf_master_facility_list_202403")
    fac["county_pcode"] = fac["county_code"].astype(str).str.strip().str.upper()
    fac_cnt = fac.groupby("county_pcode", as_index=False).agg(
        health_facility_count=("site", "count"),
        avg_facility_latitude=("latitude", "mean"),
        avg_facility_longitude=("longitude", "mean"),
    )

    # WFP markets by county
    mk = pd.read_csv(DATA_DIR / "wfp_markets_ssd.csv")
    mk["county_name_norm"] = mk["admin2"].astype(str).str.strip().str.lower()
    mk_cnt = mk.groupby("county_name_norm", as_index=False).agg(
        wfp_market_count=("market_id", "count"),
        avg_market_latitude=("latitude", "mean"),
        avg_market_longitude=("longitude", "mean"),
    )

    # DTM mobility by county
    dtm = pd.read_excel(DATA_DIR / "ssd-dtm-mobility-tracking-r16-baseline-assessment-dataset_updated_20250507.xlsx", sheet_name="MT R16 Baseline_Loc_Dataset")
    dtm = dtm[~dtm["Country"].astype(str).str.startswith("#", na=False)].copy()
    dtm["county_pcode"] = dtm["County_INT_PCode"].astype(str).str.strip().str.upper()
    dtm = to_numeric(dtm, ["a_idp_hhs_ssd", "a_idp_inds_ssd", "i_returnees_internal_present_ind", "k_abroad_ret_ind"])
    dtm_cnt = dtm.groupby("county_pcode", as_index=False).agg(
        idp_households_est=("a_idp_hhs_ssd", "sum"),
        idp_individuals_est=("a_idp_inds_ssd", "sum"),
        returnees_internal_ind_est=("i_returnees_internal_present_ind", "sum"),
        returnees_from_abroad_ind_est=("k_abroad_ret_ind", "sum"),
    )

    # National risk context (SSD + SDN where available)
    risk = pd.read_csv(ROOT / "gold_country_risk_serving-2026-02-21.csv")
    if "iso3" not in risk.columns and "country_name" in risk.columns:
        risk["iso3"] = risk["country_name"].map({"South Sudan": "SSD", "Sudan": "SDN"})
    ssd_risk = risk[risk["iso3"] == "SSD"].copy()
    if ssd_risk.empty:
        ssd_nat_ctx = pd.DataFrame(
            [{"iso3": "SSD", "national_risk_score": None, "national_status": None, "national_funding_gap_ratio": None, "national_flood_area_pct": None}]
        )
    else:
        row = ssd_risk.iloc[0]
        ssd_nat_ctx = pd.DataFrame(
            [
                {
                    "iso3": "SSD",
                    "national_risk_score": row.get("risk_score"),
                    "national_status": row.get("status"),
                    "national_funding_gap_ratio": row.get("funding_gap_ratio"),
                    "national_flood_area_pct": row.get("flood_area_pct"),
                }
            ]
        )

    # Ethnicity descriptors (researched references)
    ethnic = pd.DataFrame(
        [
            {
                "iso3": "SSD",
                "ethnic_groups_summary": "Dinka (largest), Nuer, Shilluk, Azande, Bari, Murle, Toposa, and other groups; ~60 indigenous groups reported.",
                "ethnic_estimates_note": "Demographics pages report Dinka and Nuer as largest groups with multiple estimates.",
                "ethnic_source_url": "https://en.wikipedia.org/wiki/Demographics_of_South_Sudan",
            },
            {
                "iso3": "SDN",
                "ethnic_groups_summary": "Sudanese Arabs (majority), Beja, Nuba, Fur, Nubians, and other groups.",
                "ethnic_estimates_note": "Widely cited estimate: Sudanese Arabs ~70%, Beja 5.9%, Nuba 2.5%, Fur 2.0%, Nubians 1.3%, Others 18.3%.",
                "ethnic_source_url": "https://en.wikipedia.org/wiki/Demographics_of_Sudan",
            },
        ]
    )

    # Latest demographic metrics by country
    demo = latest_demo_metrics()

    # Join all county-level SSD components
    out = adm2.merge(pop, on=["state_name", "state_pcode", "county_name", "county_pcode"], how="left")
    out["county_name_norm"] = out["county_name"].astype(str).str.strip().str.lower()
    out = out.merge(nut, on=["state_name", "state_pcode", "county_name", "county_pcode"], how="left")
    out = out.merge(fac_cnt, on="county_pcode", how="left")
    out = out.merge(mk_cnt, on="county_name_norm", how="left")
    out = out.merge(dtm_cnt, on="county_pcode", how="left")
    out = out.merge(ssd_nat_ctx, on="iso3", how="left")
    out = out.merge(ethnic, on="iso3", how="left")
    out = out.merge(demo, on="iso3", how="left")
    out = out.drop(columns=["county_name_norm"])

    out["record_level"] = "county"
    out["country_code_iso2"] = "SS"
    out["data_sources"] = (
        "ssd_adminboundaries_tabulardata.xlsx; ssd_2024_population_estimates_data.xlsx; "
        "south_sudan_nutrition.csv; who-master-facility-list_april2025.xlsx; "
        "wfp_markets_ssd.csv; ssd-dtm-mobility-tracking-r16-baseline-assessment-dataset_updated_20250507.xlsx; "
        "gold_country_risk_serving-2026-02-21.csv; demographic_data_iso.csv; web demographics sources"
    )

    # Add South Sudan national summary row from county aggregates
    ssd_tot_pop = out["population_2025_total"].sum(skipna=True)
    ssd_tot_male = out["male_total_n"].sum(skipna=True)
    ssd_tot_female = out["female_total_n"].sum(skipna=True)
    ssd_nat = {
        "record_level": "national",
        "country_name": "South Sudan",
        "country_code_iso2": "SS",
        "iso3": "SSD",
        "state_name": None,
        "state_pcode": None,
        "county_name": None,
        "county_pcode": None,
        "county_area_sqkm": out["county_area_sqkm"].sum(skipna=True),
        "population_2025_total": ssd_tot_pop,
        "male_total_n": ssd_tot_male,
        "female_total_n": ssd_tot_female,
        "female_share_pct": (ssd_tot_female / ssd_tot_pop) * 100.0 if ssd_tot_pop else None,
        "male_share_pct": (ssd_tot_male / ssd_tot_pop) * 100.0 if ssd_tot_pop else None,
        "proxy_gam_2022_pct": out["proxy_gam_2022_pct"].mean(skipna=True),
        "hunger_status": None,
        "health_facility_count": out["health_facility_count"].sum(skipna=True),
        "wfp_market_count": out["wfp_market_count"].sum(skipna=True),
        "idp_individuals_est": out["idp_individuals_est"].sum(skipna=True),
        "returnees_internal_ind_est": out["returnees_internal_ind_est"].sum(skipna=True),
        "returnees_from_abroad_ind_est": out["returnees_from_abroad_ind_est"].sum(skipna=True),
        "national_risk_score": ssd_nat_ctx["national_risk_score"].iloc[0] if "national_risk_score" in ssd_nat_ctx.columns else None,
        "national_status": ssd_nat_ctx["national_status"].iloc[0] if "national_status" in ssd_nat_ctx.columns else None,
        "national_funding_gap_ratio": ssd_nat_ctx["national_funding_gap_ratio"].iloc[0] if "national_funding_gap_ratio" in ssd_nat_ctx.columns else None,
        "national_flood_area_pct": ssd_nat_ctx["national_flood_area_pct"].iloc[0] if "national_flood_area_pct" in ssd_nat_ctx.columns else None,
        "ethnic_groups_summary": ethnic.loc[ethnic["iso3"] == "SSD", "ethnic_groups_summary"].iloc[0],
        "ethnic_estimates_note": ethnic.loc[ethnic["iso3"] == "SSD", "ethnic_estimates_note"].iloc[0],
        "ethnic_source_url": ethnic.loc[ethnic["iso3"] == "SSD", "ethnic_source_url"].iloc[0],
        "population_growth_pct_latest": demo.loc[demo["iso3"] == "SSD", "population_growth_pct_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "fertility_rate_latest": demo.loc[demo["iso3"] == "SSD", "fertility_rate_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "under5_mortality_per_1000_latest": demo.loc[demo["iso3"] == "SSD", "under5_mortality_per_1000_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "maternal_mortality_per_100k_latest": demo.loc[demo["iso3"] == "SSD", "maternal_mortality_per_100k_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "life_expectancy_years_latest": demo.loc[demo["iso3"] == "SSD", "life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "male_life_expectancy_years_latest": demo.loc[demo["iso3"] == "SSD", "male_life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "female_life_expectancy_years_latest": demo.loc[demo["iso3"] == "SSD", "female_life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SSD").any() else None,
        "data_sources": "Aggregated from county rows + demographic_data_iso.csv + gold_country_risk_serving-2026-02-21.csv + web demographics source",
    }

    # Add one Sudan national reference row for comparative context
    sudan_nat = {
        "record_level": "national",
        "country_name": "Sudan",
        "country_code_iso2": "SD",
        "iso3": "SDN",
        "state_name": None,
        "state_pcode": None,
        "county_name": None,
        "county_pcode": None,
        "county_area_sqkm": None,
        "population_2025_total": None,
        "male_total_n": 20857303,
        "female_total_n": 20281599,
        "female_share_pct": (20281599 / 41138904) * 100.0,
        "male_share_pct": (20857303 / 41138904) * 100.0,
        "proxy_gam_2022_pct": None,
        "hunger_status": None,
        "health_facility_count": None,
        "wfp_market_count": None,
        "idp_individuals_est": None,
        "returnees_internal_ind_est": None,
        "returnees_from_abroad_ind_est": None,
        "national_risk_score": None,
        "national_status": None,
        "national_funding_gap_ratio": None,
        "national_flood_area_pct": None,
        "ethnic_groups_summary": ethnic.loc[ethnic["iso3"] == "SDN", "ethnic_groups_summary"].iloc[0],
        "ethnic_estimates_note": ethnic.loc[ethnic["iso3"] == "SDN", "ethnic_estimates_note"].iloc[0],
        "ethnic_source_url": ethnic.loc[ethnic["iso3"] == "SDN", "ethnic_source_url"].iloc[0],
        "population_growth_pct_latest": demo.loc[demo["iso3"] == "SDN", "population_growth_pct_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "fertility_rate_latest": demo.loc[demo["iso3"] == "SDN", "fertility_rate_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "under5_mortality_per_1000_latest": demo.loc[demo["iso3"] == "SDN", "under5_mortality_per_1000_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "maternal_mortality_per_100k_latest": demo.loc[demo["iso3"] == "SDN", "maternal_mortality_per_100k_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "life_expectancy_years_latest": demo.loc[demo["iso3"] == "SDN", "life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "male_life_expectancy_years_latest": demo.loc[demo["iso3"] == "SDN", "male_life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "female_life_expectancy_years_latest": demo.loc[demo["iso3"] == "SDN", "female_life_expectancy_years_latest"].iloc[0] if (demo["iso3"] == "SDN").any() else None,
        "data_sources": "Demographics of Sudan web source + demographic_data_iso.csv",
    }

    out = pd.concat([out, pd.DataFrame([ssd_nat, sudan_nat])], ignore_index=True, sort=False)

    # Friendly sort
    out = out.sort_values(["record_level", "state_name", "county_name"], na_position="last").reset_index(drop=True)
    return out


def main() -> None:
    out = build()
    out.to_csv(OUT_PATH, index=False)
    print(f"Wrote {OUT_PATH}")
    print(f"Rows: {len(out)}, Columns: {len(out.columns)}")
    print("Record levels:", out["record_level"].value_counts(dropna=False).to_dict())


if __name__ == "__main__":
    main()
