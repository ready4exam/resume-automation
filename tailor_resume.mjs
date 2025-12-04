import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------------------------------------------------
// GEMINI SETUP
// ---------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-pro-latest";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.0-flash"];

// ---------------------------------------------------
// CLI ARG HANDLER
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ---------------------------------------------------
// AI CALL WITH FALLBACK
// ---------------------------------------------------
async function generateWithFallback(prompt) {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Using Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const resp = await model.generateContent(prompt);
      const output = resp.response.text() || "";

      if (!output.trim()) {
        console.log(`⚠ Empty output from ${modelName}, trying next model...`);
        lastErr = new Error("Empty response from model");
        continue;
      }

      return output;
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      console.error(`Model ${modelName} failed (${status}): ${err.message}`);

      if (status === 500 || status === 503) {
        console.log("Trying next fallback model...");
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
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error(
      'Usage: node tailor_resume.mjs --company "X" --job-title "Y" --job-desc-file jd.txt'
    );
    process.exit(1);
  }

  // --------------------------------------------
  // RESUME MODE
  // --------------------------------------------
  let resumeMode = "INFRA_ONLY";
  if (rmArg.toLowerCase() === "dev") resumeMode = "DEV_ONLY";
  else if (rmArg.toLowerCase() === "hybrid") resumeMode = "INFRA_PLUS_DEV";

  // --------------------------------------------
  // METHODOLOGY PARSING
  // --------------------------------------------
  const methods = methodsArg
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const methodList = [];
  if (methods.includes("agile")) methodList.push("Agile");
  if (methods.includes("finops")) methodList.push("FinOps");

  // --------------------------------------------
  // LOAD TEMPLATE FILES
  // --------------------------------------------
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const devSkills =
    resumeMode !== "INFRA_ONLY" && fs.existsSync("development.md")
      ? fs.readFileSync("development.md", "utf8")
      : "";

  // Big-tech template
  const upper = company.toUpperCase();
  const isBig = ["GOOGLE", "MICROSOFT", "AMAZON", "AWS", "META", "APPLE", "NETFLIX"].some((x) =>
    upper.includes(x)
  );

  const devGoogleTemplate =
    isBig && fs.existsSync("development_google_template.md")
      ? fs.readFileSync("development_google_template.md", "utf8")
      : "(none)";

  const jdText = fs.readFileSync(jdFile, "utf8");

  const includeProjects =
    resumeMode === "DEV_ONLY" || resumeMode === "INFRA_PLUS_DEV" ? "YES" : "NO";

  // --------------------------------------------
  // AI PROMPT
  // --------------------------------------------
  const prompt = `
${systemPrompt}

================ CONTEXT INPUT ================
TARGET_COMPANY: ${company}
TARGET_ROLE: ${jobTitle}

RESUME_MODE: ${resumeMode}
INCLUDE_PROJECTS: ${includeProjects}
METHODOLOGIES: ${methodList.join(", ") || "None"}

JOB_DESCRIPTION:
${jdText}

EXTRA_INSTRUCTIONS:
${extra || "(none)"}

BASE_RESUME:
${baseResume}

DEV_SKILLS_BLOCK:
${devSkills || "(none)"}

BIG_TECH_TONE_REFERENCE:
${devGoogleTemplate}
================================================
  `.trim();

  // --------------------------------------------
  // CALL GEMINI
  // --------------------------------------------
  const aiText = await generateWithFallback(prompt);

  // --------------------------------------------
  // SAFE FOLDER NAMES
  // --------------------------------------------
  let safeCompany = company.replace(/[^a-z0-9]+/gi, "_").trim();
  if (!safeCompany) safeCompany = "Unknown_Company";

  let safeTitle = jobTitle.replace(/[^a-z0-9]+/gi, "_").trim();
  if (!safeTitle) safeTitle = "Unknown_Role";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const outDir = path.join("jobs", safeCompany, safeTitle, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  // --------------------------------------------
  // WRITE RAW OUTPUT ONLY (NO DOCX)
  // --------------------------------------------
  const rawOut = path.join(outDir, "raw.txt");
  fs.writeFileSync(rawOut, aiText || "", "utf8");

  console.log("======================================");
  console.log(" PHASE-1 COMPLETED");
  console.log(" Raw resume written:", rawOut);
  console.log(" (Phase-1 DOCX intentionally disabled)");
  console.log("======================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
