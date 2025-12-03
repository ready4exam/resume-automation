import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Document, Packer, Paragraph, TextRun } from "docx";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Primary + fallback models (all are in your model list)
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-pro-latest"
];

function getArg(flag, defaultValue = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return defaultValue;
  return process.argv[idx + 1];
}

function mdToDocxParagraphs(text) {
  return text.split("\n").map(line =>
    new Paragraph({
      children: [new TextRun(line)],
    })
  );
}

async function generateDocx(markdown, outPath) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: mdToDocxParagraphs(markdown)
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

// Call Gemini with automatic fallback if a model is overloaded
async function generateWithFallback(prompt) {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Using Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log(`Model ${modelName} succeeded.`);
      return text;
    } catch (err) {
      lastError = err;
      const status = err?.status;
      console.error(`Model ${modelName} failed with status ${status}:`, err.message || err);

      // If it's a transient server issue, try next model
      if (status === 503 || status === 500) {
        console.error(`Model ${modelName} unavailable, trying next fallback model...`);
        continue;
      }

      // For other errors (auth, bad request etc.), don't hide it
      throw err;
    }
  }

  // If we got here, all models failed
  throw lastError || new Error("All Gemini models failed.");
}

async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jobDescFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");

  if (!company || !jobTitle || !jobDescFile) {
    console.error(
      'Usage: node tailor_resume.mjs --company "X" --job-title "Y" --job-desc-file jd.txt [--extra "notes"]'
    );
    process.exit(1);
  }

  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const jobDesc = fs.readFileSync(jobDescFile, "utf8");

  const prompt = `
${systemPrompt}

---------------------
COMPANY: ${company}
TARGET ROLE: ${jobTitle}

JOB DESCRIPTION:
${jobDesc}

EXTRA:
${extra}

BASE RESUME:
${baseResume}
---------------------
  `.trim();

  // Call Gemini with fallback logic
  const text = await generateWithFallback(prompt);

  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_");
  const safeTitle = jobTitle.replace(/[^a-z0-9]+/gi, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const versionDir = path.join(
    process.cwd(),
    "jobs",
    safeCompany,
    safeTitle,
    timestamp
  );

  fs.mkdirSync(versionDir, { recursive: true });

  const mdOut = path.join(versionDir, `resume_${safeCompany}_${safeTitle}.md`);
  const docOut = mdOut.replace(".md", ".docx");

  fs.writeFileSync(mdOut, text);
  await generateDocx(text, docOut);

  console.log("Saved:", mdOut);
  console.log("Saved:", docOut);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
