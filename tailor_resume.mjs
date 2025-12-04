import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PRIMARY_MODEL = "gemini-pro-latest";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.0-flash"];

function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function generateWithFallback(prompt) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const model of models) {
    try {
      console.log("Using model:", model);
      const m = genAI.getGenerativeModel({ model });
      const r = await m.generateContent(prompt);
      const text = r.response.text() || "";

      if (!text.trim()) {
        lastErr = new Error("Empty response");
        continue;
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (err.status === 500 || err.status === 503) continue;
      throw err;
    }
  }

  throw lastErr;
}

async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error("Missing required arguments.");
    process.exit(1);
  }

  let resumeMode = "INFRA_ONLY";
  if (rmArg === "dev") resumeMode = "DEV_ONLY";
  if (rmArg === "hybrid") resumeMode = "INFRA_PLUS_DEV";

  const methods = methodsArg
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const methodList = [];
  if (methods.includes("agile")) methodList.push("Agile");
  if (methods.includes("finops")) methodList.push("FinOps");

  // Load files
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const jdText = fs.readFileSync(jdFile, "utf8");

  const devSkills =
    resumeMode !== "INFRA_ONLY" && fs.existsSync("development.md")
      ? fs.readFileSync("development.md", "utf8")
      : "";

  const upper = company.toUpperCase();
  const isBig = ["GOOGLE", "MICROSOFT", "AMAZON", "AWS", "META", "APPLE", "NETFLIX"]
    .some((x) => upper.includes(x));

  const devGoogleTemplate =
    isBig && fs.existsSync("development_google_template.md")
      ? fs.readFileSync("development_google_template.md", "utf8")
      : "(none)";

  const includeProjects =
    resumeMode === "DEV_ONLY" || resumeMode === "INFRA_PLUS_DEV" ? "YES" : "NO";

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
${devSkills}

BIG_TECH_TONE_REFERENCE:
${devGoogleTemplate}
================================================
  `.trim();

  const aiText = await generateWithFallback(prompt);

  // Output folder
  let safeCompany = company.replace(/[^a-z0-9]+/gi, "_") || "Unknown_Company";
  let safeRole = jobTitle.replace(/[^a-z0-9]+/gi, "_") || "Unknown_Role";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const outDir = path.join("jobs", safeCompany, safeRole, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "raw.txt"), aiText, "utf8");

  console.log("RAW written:", outDir + "/raw.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
