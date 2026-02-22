// ── Facility-level funding allocation for Planning tab ──────────────────────
// Distributes a cluster's total budget across individual facilities
// using a proximity-based weight: closer facilities → more funding.

export interface FacilityFunding {
  name: string;
  type: string;       // "Hospital" | "Primary Health Care Centre" | market name style
  county: string;
  state: string;
  distKm: number;
  allocShare: number;  // normalized 0–1
  fundingAmount: number;
  kind: "health" | "market";
}

export interface CountyFundingGroup {
  pcode: string;
  county: string;
  state: string;
  facilities: FacilityFunding[];
  countyTotal: number;
}

export interface ClusterFacilityAllocation {
  clusterId: string;
  clusterBudget: number;
  totalFacilities: number;
  avgPerFacility: number;
  counties: CountyFundingGroup[];
  topFunded: FacilityFunding[];
}

// ── Weight function ─────────────────────────────────────────────────────────
function proximityWeight(distKm: number): number {
  return 1 / Math.max(distKm, 1);
}

// ── County resource shape from ssdCountyResources.json ──────────────────────
interface RawFacility {
  name: string;
  type: string;
  state: string;
  county: string;
  lat: number;
  lon: number;
  distKm: number;
  typeRank: number;
}

interface RawMarket {
  name: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  distKm: number;
}

interface RawCounty {
  pcode: string;
  county: string;
  state: string;
  centroidLat: number;
  centroidLon: number;
  topFacilities: RawFacility[];
  topMarkets: RawMarket[];
}

// ── Main computation ────────────────────────────────────────────────────────
export function computeFacilityAllocations(
  countyResources: Record<string, RawCounty>,
  clusterId: string,
  clusterBudget: number
): ClusterFacilityAllocation {
  const isHealth = clusterId === "HEA";

  // 1. Build flat list of all facilities with raw scores
  const allItems: { pcode: string; county: string; state: string; raw: number; facility: Omit<FacilityFunding, "allocShare" | "fundingAmount"> }[] = [];

  for (const [pcode, county] of Object.entries(countyResources)) {
    const items = isHealth ? county.topFacilities : county.topMarkets;
    if (!items) continue;

    for (const item of items) {
      const raw = proximityWeight(item.distKm);
      allItems.push({
        pcode,
        county: county.county,
        state: county.state,
        raw,
        facility: {
          name: item.name,
          type: isHealth ? (item as RawFacility).type : "WFP Market",
          county: county.county,
          state: county.state,
          distKm: item.distKm,
          kind: isHealth ? "health" : "market",
        },
      });
    }
  }

  // 2. Normalize scores and compute dollar amounts
  const totalRaw = allItems.reduce((s, i) => s + i.raw, 0);

  const funded: (FacilityFunding & { pcode: string })[] = allItems.map((item) => {
    const allocShare = totalRaw > 0 ? item.raw / totalRaw : 0;
    return {
      ...item.facility,
      allocShare,
      fundingAmount: Math.round(allocShare * clusterBudget),
      pcode: item.pcode,
    };
  });

  // 3. Group by county
  const countyMap = new Map<string, CountyFundingGroup>();

  for (const f of funded) {
    let group = countyMap.get(f.pcode);
    if (!group) {
      group = {
        pcode: f.pcode,
        county: f.county,
        state: f.state,
        facilities: [],
        countyTotal: 0,
      };
      countyMap.set(f.pcode, group);
    }
    group.facilities.push(f);
    group.countyTotal += f.fundingAmount;
  }

  // Sort counties by total funding desc, facilities within each county by funding desc
  const counties = Array.from(countyMap.values())
    .sort((a, b) => b.countyTotal - a.countyTotal)
    .map((g) => ({
      ...g,
      facilities: g.facilities.sort((a, b) => b.fundingAmount - a.fundingAmount),
    }));

  // 4. Top 10 highest-funded across all
  const topFunded = [...funded]
    .sort((a, b) => b.fundingAmount - a.fundingAmount)
    .slice(0, 10);

  return {
    clusterId,
    clusterBudget,
    totalFacilities: funded.length,
    avgPerFacility: funded.length > 0 ? Math.round(clusterBudget / funded.length) : 0,
    counties,
    topFunded,
  };
}
