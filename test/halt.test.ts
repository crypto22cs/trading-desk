import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HaltController, clearHaltFile, writeHaltFile } from "../src/halt.js";

describe("halt", () => {
  it("文件或本进程触发后都算急停，删除文件后新控制器恢复", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "nado-halt-")), "HALT");
    const halt = new HaltController(file);
    expect(halt.isHalted()).toBe(false);
    halt.trip("测试");
    expect(halt.isHalted()).toBe(true);
    expect(halt.signal.aborted).toBe(true);
    expect(halt.why()).toContain("测试");

    const external = path.join(mkdtempSync(path.join(tmpdir(), "nado-halt-")), "HALT");
    writeHaltFile(external, "operator");
    const seen = new HaltController(external);
    expect(seen.isHalted()).toBe(true);
    expect(seen.why()).toContain("operator");
    expect(clearHaltFile(external)).toBe(true);
    const again = new HaltController(external);
    expect(again.isHalted()).toBe(false);
  });
});
