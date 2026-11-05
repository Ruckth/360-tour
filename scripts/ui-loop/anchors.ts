import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { args, json, list, save, str } from "./common.ts";
import { DEVICES, FLAWS, SCREENS } from "./config.ts";
import { capture } from "./capture.ts";
import type { Manifest } from "./types.ts";
import type { Anchor, AuditRecord } from "./audit.ts";

if (import.meta.main) {
  const { values: v, positionals } = args(),
    dest = path.resolve("output/ui-loop/anchors");
  await mkdir(dest, { recursive: true });
  if (positionals[0] === "agree") {
    const anchors = await json<Anchor[]>(path.join(dest, "anchors.json")),
      from = path.resolve(str(v.from));
    for (const a of anchors) {
      const file = path.join(from, `${a.screen}-${a.device}.json`),
        cal = path.join(from, `calibration-${a.device}-clean.json`);
      const r = await json<AuditRecord>(existsSync(file) ? file : cal);
      if (
        r.status !== "valid" ||
        r.runs < 3 ||
        r.screen !== a.screen ||
        r.device !== a.device
      )
        throw new Error(`Need three valid reviewer runs for ${a.id}`);
      a.agreed = { overall: r.overall, categories: r.category_means };
    }
    await save(path.join(dest, "anchors.json"), anchors);
    console.log(`Agreed ${anchors.length} anchors`);
  } else if (positionals[0] === "build") {
    if (existsSync(path.join(dest, "anchors.json")))
      throw new Error(
        "Frozen anchors already exist; use another output directory to replace them intentionally",
      );
    const from = path.resolve(str(v.from));
    if (!v.from) throw new Error("--from is required");
    const selected = list(v.screens).length
      ? list(v.screens)
      : ["chats", "settings-business"];
    const anchors: Anchor[] = [];
    // --from identifies a section; other default screens may live in sibling sections at the same round.
    let index = 0;
    for (const d of DEVICES.filter((d) => d.judged))
      for (const id of selected) {
        const screen = SCREENS.find((s) => s.id === id);
        if (!screen) throw new Error(`Unknown screen ${id}`);
        const source = existsSync(path.join(from, `${id}-${d.id}-default.png`))
          ? from
          : path.resolve(from, "..", "..", screen.section, path.basename(from));
        const manifest = await json<Manifest>(
          path.join(source, "manifest.json"),
        );
        const c = manifest.captures.find(
          (c) =>
            c.screen === id &&
            c.device === d.id &&
            c.state === "default" &&
            !c.error,
        );
        if (!c?.files.length)
          throw new Error(`Missing clean capture ${id}/${d.id}`);
        const anchorId = `${id}-${d.id}`,
          flaw = Object.keys(FLAWS)[index++ % Object.keys(FLAWS).length],
          file = anchorId + ".png",
          degradedFile = anchorId + "-degraded.png";
        await copyFile(path.join(source, c.files[0]), path.join(dest, file));
        const scratch = path.join(dest, `.capture-${anchorId}`);
        const failures = await capture({
          section: screen.section,
          round: "0",
          screens: [id],
          devices: [d.id],
          states: ["default"],
          inject: flaw,
          out: scratch,
          concurrency: 1,
        });
        if (failures) throw new Error(`Degraded capture failed ${anchorId}`);
        await copyFile(
          path.join(scratch, `${id}-${d.id}-default.png`),
          path.join(dest, degradedFile),
        );
        await rm(scratch, { recursive: true, force: true });
        anchors.push({
          id: anchorId,
          device: d.id,
          screen: id,
          file,
          degradedFile,
          flaw,
          flawCategory: FLAWS[flaw].category,
          agreed: null,
        });
      }
    await save(path.join(dest, "anchors.json"), anchors);
    console.log(
      `Built ${anchors.length} clean and ${anchors.length} degraded anchors`,
    );
  } else
    throw new Error(
      "Use anchors.ts build --from <captureDir> or agree --from <auditDir>",
    );
}
