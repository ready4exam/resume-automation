import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Load Gemini API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getArg(flag, defaultValue = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return defaultValue;
  return process.argv[idx + 1];
}

async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jobDescFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");

  if (!company || !jobTitle || !jobDescFile) {
    console.error("Usage: node tailor_resume.mjs --company \"X\" --job-title \"Y\" --job-desc-file jd.txt [--extra \"notes\"]");
    process.exit(1);
  }

  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const jobDesc = fs.readFileSync(jobDescFile, "utf8");

  const prompt = `
${systemPrompt}

---------------------
COMPANY: ${company}
TARGET JOB TITLE: ${jobTitle}

JOB DESCRIPTION:
${jobDesc}

EXTRA INSTRUCTIONS:
${extra || "(none)"}

BASE RESUME:
${baseResume}
---------------------

REMEMBER:
- Tailor the resume
- Then act as recruiter & improve it
- Output FINAL resume only
  `.trim();

  // Using Gemini Flash 1.5 — FREE tier
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_");
  const safeTitle = jobTitle.replace(/[^a-z0-9]+/gi, "_");
  const outDir = path.join(process.cwd(), "output");
  const outFile = path.join(outDir, `resume_${safeCompany}_${safeTitle}.md`);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  fs.writeFileSync(outFile, text);
  console.log("Tailored resume saved to:", outFile);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
