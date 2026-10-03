import path from "path";
import { app } from "electron";

/**
 * LEARNIFYTUBE_USER_DATA_DIR runs a second, isolated desktop beside the
 * installed app (the `verify` skill uses it): its own single-instance lock,
 * settings, pairing code, database and downloads folder. main.ts imports this
 * module first so the paths move before anything reads them.
 */
export const userDataOverride = process.env.LEARNIFYTUBE_USER_DATA_DIR
  ? path.resolve(process.env.LEARNIFYTUBE_USER_DATA_DIR)
  : null;

if (userDataOverride) {
  app.setPath("userData", userDataOverride);
  app.setPath("downloads", path.join(userDataOverride, "downloads"));
}
