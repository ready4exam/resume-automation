import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// =====================================================
//  FREE-TIER SAFE MODEL ROTATION (BEST → LAST RESORT)
// =====================================================
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.5-flash-lite"
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =====================================================
//  CLI ARG HELPER
// =====================================================
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// =====================================================
//  BULLETPROOF MODEL CALL WITH RETRY + FALLBACK
// =====================================================
async function callModel(model, prompt, attempt = 1) {
  try {
    console.log(`\n🚀 Attempt ${attempt}: ${model}`);
    const m = genAI.getGenerativeModel({ model });
    const res = await m.generateContent(prompt);
    const text = res.response.text();
    if (!text || !text.trim()) throw new Error("Empty response");
    console.log(`✅ Success: ${model}`);
    return text;
  } catch (err) {
    if ((err.status === 500 || err.status === 503) && attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      return callModel(model, prompt, attempt + 1);
    }
    if (err.status === 429) {
      console.log(`⚠️ Quota exhausted for ${model}, switching model`);
      return null;
    }
    console.log(`⚠️ Skipping model ${model}`);
    return null;
  }
}

async function generateBulletproof(prompt) {
  for (const model of MODEL_CHAIN) {
    const out = await callModel(model, prompt);
    if (out) return out;
  }
  throw new Error("❌ All free-tier models exhausted or failed");
}

// =====================================================
//  MAIN — PHASE 1 (TAILOR ONLY)
// =====================================================
async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error("❌ Missing required arguments");
    process.exit(1);
  }

  // ---------------------------------------------------
  // Resume Mode
  // ---------------------------------------------------
  let resumeMode = "INFRA_ONLY";
  if (rmArg === "dev") resumeMode = "DEV_ONLY";
  if (rmArg === "hybrid") resumeMode = "INFRA_PLUS_DEV";

  // ---------------------------------------------------
  // Methodologies
  // ---------------------------------------------------
  const methods = methodsArg
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

  const methodList = [];
  if (methods.includes("agile")) methodList.push("Agile");
  if (methods.includes("finops")) methodList.push("FinOps");
  if (methods.includes("ai")) methodList.push("AI");

  // ---------------------------------------------------
  // Load Core Inputs
  // ---------------------------------------------------
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const jdText = fs.readFileSync(jdFile, "utf8");

  const devSkills =
    resumeMode !== "INFRA_ONLY" && fs.existsSync("development.md")
      ? fs.readFileSync("development.md", "utf8")
      : "(none)";

  // ---------------------------------------------------
  // FAANG / BIG-TECH DETECTION
  // ---------------------------------------------------
  const upper = company.toUpperCase();
  const isFAANG = [
    "GOOGLE",
    "ALPHABET",
    "AMAZON",
    "AWS",
    "META",
    "FACEBOOK",
    "APPLE",
    "NETFLIX",
    "MICROSOFT"
  ].some(x => upper.includes(x));

  const bigTechReference =
    isFAANG &&
    resumeMode !== "INFRA_ONLY" &&
    fs.existsSync("development_google_template.md")
      ? fs.readFileSync("development_google_template.md", "utf8")
      : "(none)";

  const includeProjects =
    resumeMode === "DEV_ONLY" || resumeMode === "INFRA_PLUS_DEV" ? "YES" : "NO";

  // =====================================================
  //  FINAL PROMPT — PHASE 1 BOUNDARY + ANTI-DUPLICATION
  // =====================================================
  const prompt = `
${systemPrompt}

THIS IS PHASE 1 — TAILORING ONLY.

Produce a strong, VP-level, role-aligned resume draft.
Do NOT perform hiring-manager review.
Do NOT judge selection or rejection.
Do NOT proactively fix gaps.
Assume a separate review phase will refine this output.

ANTI-OVERDOING & ZERO-DUPLICATION RULE:
- Each leadership concept may appear ONLY ONCE in the entire resume.
- SUMMARY = positioning only (no skills, tools, metrics).
- CORE_SKILLS = capability labels only.
- EXPERIENCE = proof and outcomes only.
- PROJECTS = vision and platform leadership only.
- TECHNICAL_SKILLS = grouped executive depth only.
If a concept would repeat, REMOVE it from the later section.

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

BIG_TECH_ENGINEERING_REFERENCE
(FAANG STYLE ONLY — DO NOT COPY VERBATIM):
${bigTechReference}
================================================
`.trim();

  console.log("\n🔥 Phase-1 Tailoring started...");
  const aiText = await generateBulletproof(prompt);

  // ---------------------------------------------------
  // Output
  // ---------------------------------------------------
  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_");
  const safeRole = jobTitle.replace(/[^a-z0-9]+/gi, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join("jobs", safeCompany, safeRole, timestamp);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "raw.txt"), aiText, "utf8");

  console.log(`\n✅ Phase-1 output written to ${outDir}/raw.txt`);
}

main().catch(err => {
  console.error("\n❌ FATAL ERROR:", err);
  process.exit(1);
});
