/**
 * South Sudan UN Cluster Data
 * Sources: HPC 2026 caseload, WHO Master Facility List (April 2025), WFP Markets SSD, DTM R16 Baseline
 */

export type NfiItem = {
  label: string;
  description: string;
};

export type ClusterStat = {
  label: string;
  value: string;
};

export type UnCluster = {
  id: string;
  acronym: string;
  name: string;
  lead: string;
  color: string;
  bgColor: string;
  borderColor: string;
  inNeed: number;
  targeted: number;
  description: string;
  keyServices: string[];
  stats: ClusterStat[];
  nfiItems?: NfiItem[];
  dataSource: string;
};

/** South Sudan population and overall caseload (HPC 2026) */
export const ssdOverall = {
  totalPopulation: 14_363_363,
  totalInNeed: 9_913_863,
  totalTargeted: 4_343_435,
  idpIndividuals: 1_736_150,   // DTM R16 Baseline (internal displacement within SSD)
  healthFacilities: 1_988,     // WHO Master Facility List, April 2025
  wfpMarkets: 125,             // WFP active markets across 10 states
  idpLocations: 2_881,         // DTM locations with confirmed IDPs
};

export const ssdClusters: UnCluster[] = [
  {
    id: "HEA",
    acronym: "Health",
    name: "Emergency Health Services",
    lead: "WHO / MoH",
    color: "#ef4444",
    bgColor: "rgba(239,68,68,0.08)",
    borderColor: "rgba(239,68,68,0.35)",
    inNeed: 6_269_692,
    targeted: 2_884_600,
    description:
      "Emergency primary health care, field hospitals, trauma care, and epidemic response across all 10 states.",
    keyServices: [
      "Field hospitals & emergency surgery",
      "Primary health care units (PHCU/PHCC)",
      "Epidemic response (cholera, measles)",
      "Maternal & child health",
      "Mobile health teams for hard-to-reach areas",
    ],
    stats: [
      { label: "WHO Facilities", value: "1,988" },
      { label: "States covered", value: "10 + Abyei" },
      { label: "Facilities per 1,000 pop (in-need)", value: "0.32" },
    ],
    dataSource: "WHO Master Facility List, April 2025 · HPC 2026",
  },
  {
    id: "FSC",
    acronym: "Food",
    name: "Food Security",
    lead: "WFP / FAO",
    color: "#f97316",
    bgColor: "rgba(249,115,22,0.08)",
    borderColor: "rgba(249,115,22,0.35)",
    inNeed: 7_650_962,
    targeted: 2_664_032,
    description:
      "Emergency food assistance, in-kind distributions, cash and voucher programming, and livelihood support.",
    keyServices: [
      "General food distributions (GFD)",
      "Unconditional cash / food vouchers",
      "School feeding programs",
      "Emergency market support",
      "Livelihood & agricultural recovery",
    ],
    stats: [
      { label: "WFP Active Markets", value: "125" },
      { label: "States with markets", value: "10" },
      { label: "Funding gap (2025)", value: "~60%" },
    ],
    dataSource: "WFP Markets SSD · HPC 2026",
  },
  {
    id: "WSH",
    acronym: "WASH",
    name: "Water, Sanitation & Hygiene",
    lead: "UNICEF",
    color: "#3b82f6",
    bgColor: "rgba(59,130,246,0.08)",
    borderColor: "rgba(59,130,246,0.35)",
    inNeed: 6_806_495,
    targeted: 2_167_689,
    description:
      "Safe drinking water supply, sanitation infrastructure, and hygiene promotion in displacement sites and host communities.",
    keyServices: [
      "Emergency safe water supply",
      "Communal latrines & waste management",
      "Hygiene promotion & behavior change",
      "Water trucking in flood-affected areas",
      "Handwashing stations & soap distribution",
    ],
    stats: [
      { label: "Coverage target", value: "32% of in-need" },
      { label: "Priority: flood-affected", value: "Unity, Jonglei" },
      { label: "IDP sites served", value: "2,881 locations" },
    ],
    dataSource: "DTM R16 Baseline · HPC 2026",
  },
  {
    id: "SHL",
    acronym: "Shelter",
    name: "Shelter & Non-Food Items",
    lead: "UNHCR / IOM",
    color: "#eab308",
    bgColor: "rgba(234,179,8,0.08)",
    borderColor: "rgba(234,179,8,0.35)",
    inNeed: 6_669_355,
    targeted: 1_511_270,
    description:
      "Emergency shelter kits, core relief items, and NFI distributions for internally displaced persons and flood-affected households.",
    keyServices: [
      "Emergency shelter (tarpaulins, poles)",
      "Blankets & sleeping mats",
      "Household cooking sets",
      "Hygiene kits (soap, sanitary items)",
      "Jerricans & water storage containers",
    ],
    stats: [
      { label: "IDPs in-country", value: "1.74M" },
      { label: "Top state: Unity", value: "390,766 IDPs" },
      { label: "Top state: Jonglei", value: "296,871 IDPs" },
    ],
    nfiItems: [
      { label: "Blankets", description: "2 per household for thermal protection" },
      { label: "Tarpaulins", description: "Emergency weatherproof shelter cover" },
      { label: "Hygiene kits", description: "Soap, toothbrush, sanitary pads (3-month supply)" },
      { label: "Cooking sets", description: "Pots, cups, plates, spoons per household" },
      { label: "Jerricans", description: "20L water storage containers (×2 per HH)" },
      { label: "Sleeping mats", description: "1 per person for ground insulation" },
    ],
    dataSource: "DTM R16 Baseline · HPC 2026",
  },
  {
    id: "NUT",
    acronym: "Nutrition",
    name: "Nutrition",
    lead: "UNICEF / WFP",
    color: "#a855f7",
    bgColor: "rgba(168,85,247,0.08)",
    borderColor: "rgba(168,85,247,0.35)",
    inNeed: 5_250_933,
    targeted: 1_833_612,
    description:
      "Prevention and treatment of acute malnutrition, with targeted interventions for children under 5 and pregnant and lactating women.",
    keyServices: [
      "Community-based management of acute malnutrition (CMAM)",
      "Therapeutic feeding centers (TFC)",
      "Supplementary feeding programs (SFP)",
      "MUAC screening & referral",
      "Micronutrient supplementation",
    ],
    stats: [
      { label: "Under-5 at risk", value: "~28% of total" },
      { label: "SAM treatment target", value: "Priority: Unity, Jonglei" },
      { label: "RUTF / RUSF", value: "Ready-to-use therapeutic food" },
    ],
    dataSource: "HPC 2026 · Population Estimates 2025",
  },
];
