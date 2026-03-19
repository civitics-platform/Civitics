/**
 * agency-names.ts
 *
 * Acronym → full name lookup for federal agencies.
 *
 * Why this exists: the agencies table stores name = acronym for many rows
 * (the regulations.gov pipeline does not have access to full names).
 * This map is the authoritative source until the DB is corrected.
 *
 * Usage: import { AGENCY_NAMES, agencyFullName } from "@civitics/db";
 */

export const AGENCY_NAMES: Record<string, string> = {
  AMS:    "Agricultural Marketing Service",
  ATF:    "Bureau of Alcohol, Tobacco, Firearms and Explosives",
  BIA:    "Bureau of Indian Affairs",
  BLM:    "Bureau of Land Management",
  BOP:    "Bureau of Prisons",
  BOR:    "Bureau of Reclamation",
  BIS:    "Bureau of Industry and Security",
  CBP:    "U.S. Customs and Border Protection",
  CDC:    "Centers for Disease Control and Prevention",
  CFTC:   "Commodity Futures Trading Commission",
  CMS:    "Centers for Medicare & Medicaid Services",
  CPSC:   "Consumer Product Safety Commission",
  DEA:    "Drug Enforcement Administration",
  DOC:    "Department of Commerce",
  DOD:    "Department of Defense",
  DOE:    "Department of Energy",
  DOI:    "Department of the Interior",
  DOJ:    "Department of Justice",
  DOL:    "Department of Labor",
  DOS:    "Department of State",
  DOT:    "Department of Transportation",
  ED:     "Department of Education",
  EEOC:   "Equal Employment Opportunity Commission",
  EPA:    "Environmental Protection Agency",
  FAA:    "Federal Aviation Administration",
  FBI:    "Federal Bureau of Investigation",
  FCC:    "Federal Communications Commission",
  FDA:    "Food and Drug Administration",
  FDIC:   "Federal Deposit Insurance Corporation",
  FEMA:   "Federal Emergency Management Agency",
  FERC:   "Federal Energy Regulatory Commission",
  FHFA:   "Federal Housing Finance Agency",
  FMCSA:  "Federal Motor Carrier Safety Administration",
  FNS:    "Food and Nutrition Service",
  FPAC:   "Farm Production and Conservation",
  FRA:    "Federal Railroad Administration",
  FTA:    "Federal Transit Administration",
  FWS:    "U.S. Fish and Wildlife Service",
  GSA:    "General Services Administration",
  HHS:    "Department of Health and Human Services",
  HUD:    "Department of Housing and Urban Development",
  ICE:    "Immigration and Customs Enforcement",
  IRS:    "Internal Revenue Service",
  MARAD:  "Maritime Administration",
  MSHA:   "Mine Safety and Health Administration",
  NASA:   "National Aeronautics and Space Administration",
  NCUA:   "National Credit Union Administration",
  NHTSA:  "National Highway Traffic Safety Administration",
  NIH:    "National Institutes of Health",
  NLRB:   "National Labor Relations Board",
  NMFS:   "National Marine Fisheries Service",
  NOAA:   "National Oceanic and Atmospheric Administration",
  NPS:    "National Park Service",
  NRC:    "Nuclear Regulatory Commission",
  NSF:    "National Science Foundation",
  OCC:    "Office of the Comptroller of the Currency",
  OSHA:   "Occupational Safety and Health Administration",
  OPM:    "Office of Personnel Management",
  PBGC:   "Pension Benefit Guaranty Corporation",
  PHMSA:  "Pipeline and Hazardous Materials Safety Administration",
  RUS:    "Rural Utilities Service",
  SBA:    "Small Business Administration",
  SEC:    "Securities and Exchange Commission",
  SSA:    "Social Security Administration",
  TSA:    "Transportation Security Administration",
  USCG:   "U.S. Coast Guard",
  USDA:   "U.S. Department of Agriculture",
  USFWS:  "U.S. Fish and Wildlife Service",
  USFS:   "U.S. Forest Service",
  USPS:   "U.S. Postal Service",
  VA:     "Department of Veterans Affairs",
};

/**
 * Returns the full agency name for a given acronym,
 * falling back to the acronym itself if not found.
 */
export function agencyFullName(acronym: string | null | undefined): string | null {
  if (!acronym) return null;
  return AGENCY_NAMES[acronym.toUpperCase()] ?? acronym;
}
