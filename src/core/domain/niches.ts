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
    subhead:
      'Instant technical quote: NEMA licensing, WRMA permits, solar submersible pumps, and 180m drilling estimates in 15 seconds.',
    badge: 'WRMA & NEMA Certified Engineering Protocol',
    services: [
      'Turnkey Commercial Borehole (180m–220m)',
      'Agricultural Solar Pumping System',
      'Hydro-Geological Survey & Permits Only',
      'Borehole Rehabilitation & Test Pumping',
    ],
    defaultService: 'Turnkey Commercial Borehole (180m–220m)',
    cta: 'Calculate Drilling Quote & Dispatch Engineer',
    estimatedValueKes: 1850000,
  },
  solar: {
    key: 'solar',
    headline: 'Commercial & Industrial Solar EPC Feasibility Assessment',
    subhead:
      'Sub-second PV capacity sizing, tier-1 bifacial panels, Huawei commercial inverters, and net-metering payback model.',
    badge: 'EPRA Licensed Solar EPC Contractor',
    services: [
      '65kWp Grid-Tied Commercial Rooftop',
      '120kWp Hybrid Factory Microgrid',
      'Agricultural Solar Water Pumping (20kW–50kW)',
      'Commercial Battery Storage (BESS) Retrofit',
    ],
    defaultService: '65kWp Grid-Tied Commercial Rooftop',
    cta: 'Calculate Solar Feasibility & Dispatch Quote',
    estimatedValueKes: 4200000,
  },
  vehicle: {
    key: 'vehicle',
    headline: 'Direct Japanese & UK Vehicle Import Clearance Estimate',
    subhead:
      'Instant CIF Mombasa landed calculation: KRA CRSP tax, port handling, KEBS inspection, and duty breakdown.',
    badge: 'Authorized KRA / KEBS Direct Clearing Gateway',
    services: [
      'Toyota Land Cruiser Prado TX-L (2018/2019 Diesel)',
      'Mercedes-Benz GLE 350d (UK Direct)',
      'Subaru Outback Limited (USS Japan Auction Grade 4.5)',
      'Commercial 10-Ton Tipper Truck (Isuzu Giga)',
    ],
    defaultService: 'Toyota Land Cruiser Prado TX-L (2018/2019 Diesel)',
    cta: 'Generate Duty Breakdown & Auction Sheet',
    estimatedValueKes: 5600000,
  },
  dental: {
    key: 'dental',
    headline: 'Priority Aesthetic Smile Design & Dental Consultation',
    subhead:
      'Lock your immediate clinic slot with Westlands / Karen senior dental surgeons within 60 seconds.',
    badge: 'Board Certified Dental & Aesthetic Specialists',
    services: [
      'Full Mouth Porcelain Veneers (6–8 Teeth)',
      'Invisalign Clear Aligners (Turnkey Course)',
      'Emergency Dental Surgery & Extraction',
      'Dental Implants (Titanium Single/Multiple)',
    ],
    defaultService: 'Full Mouth Porcelain Veneers (6–8 Teeth)',
    cta: 'Confirm Consultation Slot on WhatsApp',
    estimatedValueKes: 280000,
  },
  plant: {
    key: 'plant',
    headline: 'Heavy Earthmoving Plant & Machinery Rental Quote',
    subhead:
      'Instant wet/dry lease rate cards for CAT excavators, bulldozers, and motor graders with mobilization schedules.',
    badge: 'KeNHA / KURA Approved Plant Fleet',
    services: [
      'CAT 320 20-Ton Excavator (Monthly Wet Lease)',
      'CAT D6 Bulldozer Site Clearing Package',
      '14-Ton Vibratory Road Roller',
      'JCB 3DX Backhoe Loader (Daily/Weekly)',
    ],
    defaultService: 'CAT 320 20-Ton Excavator (Monthly Wet Lease)',
    cta: 'Dispatch Machinery Rate Card via WhatsApp',
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
    headline: `Sub-Second Quote & Engineering Dispatch for ${clientName}`,
    subhead:
      'Our automated intake system locks your pricing and routes your request to a technical lead in under 15 seconds.',
    badge: 'Zero-Latency Verified Intake Engine',
    services: [
      'Standard Turnkey Consultation',
      'Priority Engineering Dispatch',
      'Commercial Project Feasibility Audit',
    ],
    defaultService: 'Standard Turnkey Consultation',
    cta: 'Get Instant Quote via WhatsApp',
    estimatedValueKes: 250000,
  };
}
