# Angel — Pitch Script

---

## INTRO

Every year, billions of dollars in humanitarian aid get sent to the wrong place at the wrong time — not because people don't care, but because nobody has the full picture.

Angel gives you the full picture.

It's one platform that monitors every crisis on Earth — and tells you exactly where to send help, down to the specific hospital that needs it most.

Let us show you.

---

## PART 1 — THE GLOBE

*[Show the globe]*

This is Angel. Every country on this globe is colored green, yellow, or red based on how severe its crisis situation is right now.

We're pulling data from UN agencies, the World Health Organization, the World Food Programme, flood monitoring systems — and we're combining all of it into a single score for every country, updated daily.

Green means stable. Yellow means watch closely. Red means people need help now.

A UN coordinator can open this and in five seconds understand the state of the world.

---

## PART 2 — ASK IT ANYTHING

But the real power is that you can just ask it questions. Plain English. And the closest implementation to a JARVIS from ironman. without having to touch the keyboard at all

### Air Pollution

*[Types: "Show me the top three countries with the worst air quality."]*

It pulls air quality data, ranks every country, and highlights the worst three on the globe. Done.

### Flood Risk

*[Types: "Which countries have the highest flood exposure?"]*

Different question, different dataset — same interface. The countries with the most people at risk from flooding light up immediately.

### 30-Day Forecast

*[Types: "Show me the 30-day risk forecast."]*

Using linear regression on historical data, Angel forecasts where risk is heading over the next 30 days. You're not just seeing where crises are — you're seeing where they're going.

Three completely different questions. Three completely different data sources. One platform.

---

## PART 3 — WHY THIS MATTERS

So all of that is useful. But global-level data? You can find that in a lot of places.

The real problem is the countries where the data isn't enough.

coordinator cant simply make an educated decision when there are countries that are under-reported and under-funded,

This is the problem we actually built Angel to solve.

"If we were given $1M for humanitarian funding, how would we distribute money in countries like South Sudan?"


---

## PART 4 — SOUTH SUDAN

*[Zooms into South Sudan]*

We picked South Sudan as our proof of concept because the challenges it currently faces politically and economically , 9.9 million people are in need right now.

So we took every data source we could find cleaned it, ran it through our databricks pipeline, and layered gemenis model on top.

*[Shows county-level map]*

It breaks the entire country down by county which are then ranked on a variety of factor. these include hunger severity, displayment, access to health facilities and availbility of food markets.

Counties with the most critical conditions are automatically flagged.

---

## PART 5 — DOWN TO THE BUILDING

*[Queries for hospitals and food shelters]*

however the model goes further and identifies specific hosipitals and shelters that require the most funding in these counties.

Furthermore, it devises a budget that allocates funding across these place of need 

angel removes the guesswork for Critical funding that goes directly into the communities that need it most.

---

## PART 6 — THE VISION

South Sudan is just one example where Angel is able to tell a full story about a country's crises, politically, economically, and socially. Despite not having the information readily available, proxy indicators and robust data exploration allow us to extrapolate these mismatches between humanitarian needs and funded coverage at a global scale. 


Every crisis on Earth from satellite view down to the street address of a hospital.

Thank you.

---

## TECH REFERENCE (For Judge Q&A Only)

| Layer | Technology | Purpose |
|---|---|---|
| Ingestion | Databricks Bronze | Raw data from UN OCHA, HDX, WHO, WFP |
| Normalization | Databricks Silver | Cleaned, ISO3-joined country facts |
| Scoring | Databricks Gold | Composite risk scores with percentile thresholds |
| Forecasting | Linear Regression | 30-day risk projections |
| AI Agent | Google Gemini 1.5 Flash | Natural language to SQL to answer |
| Globe | Mapbox GL 3D | Interactive multi-layer visualization |
| Voice | Web Speech API + ElevenLabs | Speak questions, hear answers |
| Pipeline | Daily Cron (06:00 UTC) | Automated refresh |

**Risk Score:** 35% funding gap + 25% humanitarian need + 20% flood exposure + 10% HRP requirements + 10% demographic vulnerability

**Allocation Score:** 55% county priority + 20% displacement + 15% facility scarcity + 10% hunger severity
