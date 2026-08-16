const VERSION = 2;

export function makeCampaignSave(state, roster) {
  return structuredClone({ version: VERSION, state, roster });
}

export function restoreCampaign(save) {
  if (!save || save.version !== VERSION || !save.state || save.state.outcome !== "playing") return null;
  if (!Array.isArray(save.state.units) || !Array.isArray(save.state.tiles)) return null;
  return structuredClone({ state: save.state, roster: save.roster ?? null });
}
