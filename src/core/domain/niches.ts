/**
 * Niche Preset Configurations
 * Pure domain configurations for B2B industry verticals.
 */

import type { NicheKey, NichePreset } from './types';

export const SUPPORTED_NICHES = [
  'borehole',
  'solar',
  'vehicle',
  'dental',
  'plant',
  'general',
] as const;

const STATIC_NICHES: Record<Exclude<NicheKey, 'general'>, NichePreset> = {
  borehole: {
    key: 'borehole',
    headline: 'Turnkey Hydro-Geological Survey & Borehole Drilling',
    subhead: "Choose the survey, drilling or pump work you need. A specialist will follow up about the site.",
    services: [
      'Turnkey Commercial Borehole (180m–220m)',
      'Agricultural Solar Pumping System',
      'Hydro-Geological Survey & Permits Only',
      'Borehole Rehabilitation & Test Pumping',
    ],
    defaultService: 'Turnkey Commercial Borehole (180m–220m)',
    cta: "Request a drilling estimate",
    estimatedValueKes: 1850000,
  },
  solar: {
    key: 'solar',
    headline: 'Commercial & Industrial Solar EPC Feasibility Assessment',
    subhead: "Choose your project type so an engineer can discuss the site, load and storage requirements.",
    services: [
      '65kWp Grid-Tied Commercial Rooftop',
      '120kWp Hybrid Factory Microgrid',
      'Agricultural Solar Water Pumping (20kW–50kW)',
      'Commercial Battery Storage (BESS) Retrofit',
    ],
    defaultService: '65kWp Grid-Tied Commercial Rooftop',
    cta: "Request a solar assessment",
    estimatedValueKes: 4200000,
  },
  vehicle: {
    key: 'vehicle',
    headline: 'Direct Japanese & UK Vehicle Import Clearance Estimate',
    subhead: "Select a vehicle or describe your fleet requirements to request a landed-cost estimate.",
    services: [
      'Toyota Land Cruiser Prado TX-L (2018/2019 Diesel)',
      'Mercedes-Benz GLE 350d (UK Direct)',
      'Subaru Outback Limited (USS Japan Auction Grade 4.5)',
      'Commercial 10-Ton Tipper Truck (Isuzu Giga)',
    ],
    defaultService: 'Toyota Land Cruiser Prado TX-L (2018/2019 Diesel)',
    cta: "Request an import estimate",
    estimatedValueKes: 5600000,
  },
  dental: {
    key: 'dental',
    headline: 'Priority Aesthetic Smile Design & Dental Consultation',
    subhead: "Select the consultation you would like. The clinic will contact you about availability.",
    services: [
      'Full Mouth Porcelain Veneers (6–8 Teeth)',
      'Invisalign Clear Aligners (Turnkey Course)',
      'Emergency Dental Surgery & Extraction',
      'Dental Implants (Titanium Single/Multiple)',
    ],
    defaultService: 'Full Mouth Porcelain Veneers (6–8 Teeth)',
    cta: "Request a consultation",
    estimatedValueKes: 280000,
  },
  plant: {
    key: 'plant',
    headline: 'Heavy Earthmoving Plant & Machinery Rental Quote',
    subhead: "Choose equipment and tell the dispatcher about the site and hire period.",
    services: [
      'CAT 320 20-Ton Excavator (Monthly Wet Lease)',
      'CAT D6 Bulldozer Site Clearing Package',
      '14-Ton Vibratory Road Roller',
      'JCB 3DX Backhoe Loader (Daily/Weekly)',
    ],
    defaultService: 'CAT 320 20-Ton Excavator (Monthly Wet Lease)',
    cta: "Request a hire quote",
    estimatedValueKes: 950000,
  },
};

export function normalizeNicheKey(raw?: string | null): NicheKey {
  const normalized = (raw || '').toLowerCase().trim() as NicheKey;
  return SUPPORTED_NICHES.includes(normalized) ? normalized : 'general';
}

export function getNichePreset(niche: NicheKey | string, clientName: string): NichePreset {
  const key = normalizeNicheKey(niche);
  if (key !== 'general') {
    return STATIC_NICHES[key];
  }

  return {
    key: 'general',
    headline: `Request a project estimate from ${clientName}`,
    subhead: "Select the work you need and share a callback number.",
    services: [
      'Project Quotation & Scope Estimate',
      'Site Survey & Technical Assessment',
      'Turnkey Supply & Installation',
      'Equipment Maintenance, Repair & Retrofit',
      'Priority Engineering Consultation',
      'Commercial Feasibility & Compliance Audit',
    ],
    defaultService: 'Project Quotation & Scope Estimate',
    cta: "Request a callback",
    estimatedValueKes: 250000,
  };
}
