import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------------------------------------------------
// GEMINI SETUP
// ---------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Primary model + fallbacks
const PRIMARY_MODEL = "gemini-pro-latest";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.0-flash"];

// ---------------------------------------------------
// HELPER — get CLI args
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ---------------------------------------------------
// AI CALL with Fallback
// ---------------------------------------------------
async function generateWithFallback(prompt) {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Using Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const resp = await model.generateContent(prompt);

      const text = resp.response.text() || "";
      if (!text.trim()) {
        console.error(`⚠ Empty response from ${modelName}, trying fallback...`);
        lastErr = new Error("Empty response");
        continue;
      }

      return text;
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      console.error(`Model ${modelName} failed (${status}): ${err.message}`);
      if (status === 500 || status === 503) {
        console.log("Trying next fallback...");
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("All Gemini models failed.");
}

// ---------------------------------------------------
// MAIN
// ---------------------------------------------------
async function main() {
  // Read arguments
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error(
      'Usage: node tailor_resume.mjs --company "X" --job-title "Y" --job-desc-file jd.txt [--resume-mode infra|hybrid|dev]'
    );
    process.exit(1);
  }

  // ---------------------------------------------------
  // Resume mode mapping
  // ---------------------------------------------------
  let resumeMode = "INFRA_ONLY";
  if (rmArg.toLowerCase() === "dev") resumeMode = "DEV_ONLY";
  else if (rmArg.toLowerCase() === "hybrid") resumeMode = "INFRA_PLUS_DEV";

  // ---------------------------------------------------
  // Methodologies (agile, finops)
  // ---------------------------------------------------
  const methods = methodsArg
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const methodologyList = [];
  if (methods.includes("agile")) methodologyList.push("Agile");
  if (methods.includes("finops")) methodologyList.push("FinOps");

  // ---------------------------------------------------
  // Load templates + JD
  // ---------------------------------------------------
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");

  const devSkills =
    resumeMode !== "INFRA_ONLY" && fs.existsSync("development.md")
      ? fs.readFileSync("development.md", "utf8")
      : "";

  // Big-tec
