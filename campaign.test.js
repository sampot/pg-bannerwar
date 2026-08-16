import { describe, expect, it } from "vitest";
import { createGame, moveUnit } from "./game.js";
import { makeCampaignSave, restoreCampaign } from "./campaign.js";

describe("戰役存檔", () => {
  it("保存並還原當前盤面，而不是只重開章節", () => {
    const initial = createGame({ chapter: 0 });
    const unit = initial.units.find((u) => u.side === "ally");
    const moved = moveUnit(initial, unit.id, 2, 6);
    moved.turn = 4;
    moved.units.find((u) => u.side === "foe").hp = 3;

    const restored = restoreCampaign(makeCampaignSave(moved, null));
    expect(restored.state.turn).toBe(4);
    expect(restored.state.units.find((u) => u.id === unit.id).y).toBe(6);
    expect(restored.state.units.find((u) => u.side === "foe").hp).toBe(3);
  });

  it("拒絕損壞、已結束或版本不符的存檔", () => {
    expect(restoreCampaign(null)).toBe(null);
    expect(restoreCampaign({ version: 99, state: {} })).toBe(null);
    const won = createGame();
    won.outcome = "won";
    expect(restoreCampaign(makeCampaignSave(won, []))).toBe(null);
  });

  it("還原時建立獨立副本，避免修改載入來源", () => {
    const save = makeCampaignSave(createGame(), []);
    const restored = restoreCampaign(save);
    restored.state.turn = 9;
    expect(save.state.turn).toBe(1);
  });
});
