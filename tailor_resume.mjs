import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// =====================================================
//  BULLETPROOF FREE-TIER MODEL ROTATION
// =====================================================

// Best → fallback → fallback → backup
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite"
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper to get CLI arguments
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// =====================================================
//  BULLETPROOF FALLBACK ENGINE
// =====================================================
async function callModel(model, prompt, attempt = 1) {
  try {
    console.log(`\n🚀 Attempt ${attempt}: Trying model → ${model}`);
    const m = genAI.getGenerativeModel({ model });
    const response = await m.generateContent(prompt);
    const text = response.response.text();

    if (!text.trim()) throw new Error("Empty response from model.");
    console.log(`✅ SUCCESS using model ${model}`);
    return text;
  } catch (err) {
    console.log(`❌ Model failed → ${model}`);
    console.log(`   Reason: ${err.message || err}`);

    // Retry logic for temporary server issues
    if (err.status === 500 || err.status === 503) {
      if (attempt < 3) {
        const wait = 1000 * attempt;
        console.log(`   🔄 Retrying same model after ${wait}ms...`);
        await new Promise((res) => setTimeout(res, wait));
        return callModel(model, prompt, attempt + 1);
      }
    }

    // Quota Exhausted → move to next model
    if (err.status === 429) {
      console.log(`   ⚠️ QUOTA EXHAUSTED for ${model}, switching model...`);
      return null;
    }

    // Any other error = real failure → skip model
    console.log(`   ⚠️ NON-RETRYABLE ERROR. Skipping this model.`);
    return null;
  }
}

// Main function to try all models safely
async function generateBulletproof(prompt) {
  for (const model of MODEL_CHAIN) {
    const result = await callModel(model, prompt);
    if (result) return result; // success
  }

  throw new Error("❌ All free models exhausted or failed.");
}

// =====================================================
//  BUSINESS LOGIC FOR RESUME GENERATION
// =====================================================
async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error("❌ Missing required arguments.");
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

  // Load templates + resume assets
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const jdText = fs.readFileSync(jdFile, "utf8");

  const devSkills =
    resumeMode !== "INFRA_ONLY" && fs.existsSync("development.md")
      ? fs.readFileSync("development.md", "utf8")
      : "";

  const upper = company.toUpperCase();
  const isBigTech = ["GOOGLE", "MICROSOFT", "AMAZON", "AWS", "META", "APPLE", "NETFLIX"]
    .some((x) => upper.includes(x));

  const devGoogleTemplate =
    isBigTech && fs.existsSync("development_google_template.md")
      ? fs.readFileSync("development_google_template.md", "utf8")
      : "(none)";

  const includeProjects =
    resumeMode === "DEV_ONLY" || resumeMode === "INFRA_PLUS_DEV" ? "YES" : "NO";

  // =====================================================
  //  FINAL AI PROMPT ASSEMBLY
  // =====================================================
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

  // =====================================================
  //  RUN BULLETPROOF GENERATION
  // =====================================================
  console.log("\n🔥 Starting bulletproof resume generation...");
  const aiText = await generateBulletproof(prompt);

  // Output directory organization
  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_") || "Unknown_Company";
  const safeRole = jobTitle.replace(/[^a-z0-9]+/gi, "_") || "Unknown_Role";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join("jobs", safeCompany, safeRole, timestamp);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "raw.txt"), aiText, "utf8");

  console.log(`\n✅ RAW resume written to: ${outDir}/raw.txt\n`);
}

main().catch((err) => {
  console.error("\n❌ FATAL ERROR:", err);
  process.exit(1);
});
