export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

export const DELIVERY_TYPES = ["intrastate", "interstate", "both"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export type AgentCoverageInput = {
  deliveryType: DeliveryType;
  homeState: string | null;
  coveredStates: string[];
  nationwide: boolean;
};

/** Returns an error message when the coverage doesn't match the delivery type, else null. */
export function validateCoverage(input: AgentCoverageInput): string | null {
  const known = new Set<string>(NIGERIAN_STATES);
  if (input.homeState && !known.has(input.homeState)) return "Unknown home state";
  if (input.coveredStates.some(s => !known.has(s))) return "Unknown state in covered states";
  const needsHome = input.deliveryType === "intrastate" || input.deliveryType === "both";
  const needsInterstate = input.deliveryType === "interstate" || input.deliveryType === "both";
  if (needsHome && !input.homeState) return "Choose his home state";
  if (needsInterstate && !input.nationwide && input.coveredStates.length === 0) {
    return "Choose the states he delivers to, or tick Nationwide";
  }
  return null;
}

export type AgentCoverage = {
  deliveryType: string;
  homeState: string | null;
  coveredStates: string[];
  nationwide: boolean;
};

/** Can this delivery company take a job from `pickup` to `drop`? */
export function agentCoversJob(agent: AgentCoverage, pickup: string, drop: string): boolean {
  const intra = (agent.deliveryType === "intrastate" || agent.deliveryType === "both")
    && !!agent.homeState && pickup === agent.homeState && drop === agent.homeState;
  const inter = (agent.deliveryType === "interstate" || agent.deliveryType === "both")
    && pickup !== drop
    && (agent.nationwide || agent.coveredStates.includes(pickup) || agent.coveredStates.includes(drop)
      || (!!agent.homeState && (pickup === agent.homeState || drop === agent.homeState) && agent.deliveryType === "both"));
  return intra || inter;
}
