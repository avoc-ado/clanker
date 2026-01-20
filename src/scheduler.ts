export type Phase = "explore" | "execute" | "integrate";

export interface SchedulerInputs {
  slaveCap: number;
  readyCount: number;
  phase: Phase;
  conflictRate: number;
  integrationBacklog: number;
  tokenBurnPerMin: number;
  burnCap: number;
}

export const computeSlaveCap = ({
  slaveCap,
  readyCount,
  phase,
  conflictRate,
  integrationBacklog,
  tokenBurnPerMin,
  burnCap,
}: SchedulerInputs): number => {
  let cap = Math.min(slaveCap, readyCount);

  if (phase === "integrate" || conflictRate > 0.1 || integrationBacklog > 0) {
    cap = Math.min(cap, 2);
  }

  if (phase === "explore" && conflictRate < 0.02 && readyCount >= 4) {
    cap = Math.max(cap, slaveCap);
  }

  if (tokenBurnPerMin > burnCap) {
    cap = Math.max(0, cap - 1);
  }

  return cap;
};
