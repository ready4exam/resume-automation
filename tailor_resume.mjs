import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

// -----------------------------
// Gemini setup
// -----------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Primary + fallback models (all available for your key)
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-pro-latest"];

// -----------------------------
// CLI args helper
// -----------------------------
function getArg(flag, defaultValue = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return defaultValue;
  return process.argv[idx + 1];
}

// -----------------------------
// Gemini call with fallback
// -----------------------------
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
      console.error(
        `Model ${modelName} failed with status ${status}:`,
        err.message || err
      );

      if (status === 503 || status === 500) {
        console.error(
          `Model ${modelName} unavailable, trying next fallback model...`
        );
        continue;
      }

      // Non-transient error (auth, invalid request, etc.)
      throw err;
    }
  }

  throw lastError || new Error("All Gemini models failed.");
}

// -----------------------------
// Tagged text helpers
// -----------------------------
function extractSection(tag, text) {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function splitLines(block) {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// -----------------------------
// DOCX helpers: Calibri 11, headings, bullets
// -----------------------------
const BODY_FONT = "Calibri";
const BODY_SIZE = 22; // half-points => 11pt

function bodyRun(text, opts = {}) {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: BODY_SIZE,
    ...opts,
  });
}

function headingRun(text) {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: 26, // ~13pt
    bold: true,
    allCaps: true,
  });
}

function nameRun(text) {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: 40, // ~20pt
    bold: true,
  });
}

function sectionHeading(text) {
  return new Paragraph({
    children: [headingRun(text)],
    spacing: { before: 200, after: 100 },
  });
}

function simpleParagraph(text, opts = {}) {
  return new Paragraph({
    children: [bodyRun(text, opts)],
    spacing: { after: 120 },
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

// -----------------------------
// Build DOCX from tagged AI text
// -----------------------------
async function buildDocxFromTaggedText(taggedText, outPath) {
  const contactBlock = extractSection("CONTACT", taggedText);
  const summaryBlock = extractSection("SUMMARY", taggedText);
  const skillsBlock = extractSection("CORE_SKILLS", taggedText);
  const expBlock = extractSection("EXPERIENCE", taggedText);
  const eduBlock = extractSection("EDUCATION", taggedText);
  const certBlock = extractSection("CERTIFICATIONS", taggedText);
  const techBlock = extractSection("TECHNICAL_SKILLS", taggedText);

  const children = [];

  // CONTACT
  if (contactBlock) {
    const lines = splitLines(contactBlock);
    const name = lines[0] || "";
    const rest = lines.slice(1);

    children.push(
      new Paragraph({
        children: [nameRun(name)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      })
    );

    rest.forEach((line) => {
      children.push(
        new Paragraph({
          children: [bodyRun(line)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        })
      );
    });
  }

  // SUMMARY
  if (summaryBlock) {
    children.push(sectionHeading("PROFESSIONAL SUMMARY"));
    splitLines(summaryBlock).forEach((line) => {
      children.push(simpleParagraph(line));
    });
  }

  // CORE SKILLS
  if (skillsBlock) {
    children.push(sectionHeading("CORE SKILLS & COMPETENCIES"));
    splitLines(skillsBlock).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      children.push(bulletParagraph(clean));
    });
  }

  // EXPERIENCE
  if (expBlock) {
    children.push(sectionHeading("PROFESSIONAL EXPERIENCE"));

    const expLines = expBlock.split("\n");
    let currentJobLines = [];

    const flushJob = () => {
      if (currentJobLines.length === 0) return;
      const jobText = currentJobLines.join("\n").trim();
      if (!jobText) return;

      const jobLines = splitLines(jobText);
      if (jobLines.length === 0) return;

      const headerLine = jobLines[0];
      const bulletLines = jobLines.slice(1);

      children.push(
        new Paragraph({
          children: [bodyRun(headerLine, { bold: true })],
          spacing: { before: 160, after: 80 },
        })
      );

      bulletLines.forEach((l) => {
        const clean = l.replace(/^-+\s*/, "");
        if (clean.length > 0) {
          children.push(bulletParagraph(clean));
        }
      });
    };

    for (const rawLine of expLines) {
      const line = rawLine.trim();
      if (line.toLowerCase().startsWith("company:")) {
        flushJob();
        currentJobLines = [line];
      } else {
        currentJobLines.push(line);
      }
    }
    flushJob();
  }

  // EDUCATION
  if (eduBlock) {
    children.push(sectionHeading("EDUCATION"));
    splitLines(eduBlock).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      children.push(simpleParagraph(clean));
    });
  }

  // CERTIFICATIONS
  if (certBlock) {
    children.push(sectionHeading("CERTIFICATIONS"));
    splitLines(certBlock).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      children.push(bulletParagraph(clean));
    });
  }

  // TECHNICAL SKILLS
  if (techBlock) {
    children.push(sectionHeading("TECHNICAL SKILLS"));
    splitLines(techBlock).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      children.push(simpleParagraph(clean));
    });
  }

  // Page margins: about 1 inch all around (for 1–2 page resume)
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1150, // slightly narrower horizontally
              right: 1150,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

// -----------------------------
// MAIN
// -----------------------------
async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jobDescFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const resumeModeArg = getArg("--resume-mode", "infra"); // infra | hybrid | dev
  const methodsArg = getArg("--methods", ""); // e.g. "agile,finops"

  if (!company || !jobTitle || !jobDescFile) {
    console.error(
      'Usage: node tailor_resume.mjs --company "X" --job-title "Y" --job-desc-file jd.txt [--extra "notes"] [--resume-mode infra|hybrid|dev] [--methods "agile,finops"]'
    );
    process.exit(1);
  }

  const resumeMode =
    resumeModeArg.toLowerCase() === "dev"
      ? "DEV_ONLY"
      : resumeModeArg.toLowerCase() === "hybrid"
      ? "INFRA_PLUS_DEV"
      : "INFRA_ONLY";

  const methodsList = methodsArg
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0);

  const methodologies = [];
  if (methodsList.includes("agile")) methodologies.push("Agile");
  if (methodsList.includes("finops")) methodologies.push("FinOps");

  const baseResumePath = path.join(process.cwd(), "base_resume.md");
  const systemPromptPath = path.join(
    process.cwd(),
    "templates",
    "system_prompt.txt"
  );
  const devResumePath = path.join(process.cwd(), "development.md");

  const baseResume = fs.readFileSync(baseResumePath, "utf8");
  const systemPrompt = fs.readFileSync(systemPromptPath, "utf8");
  const jobDesc = fs.readFileSync(jobDescFile, "utf8");

  let devResumeAddon = "";
  if (resumeMode === "INFRA_PLUS_DEV" || resumeMode === "DEV_ONLY") {
    if (fs.existsSync(devResumePath)) {
      devResumeAddon = fs.readFileSync(devResumePath, "utf8");
    } else {
      console.warn(
        "development.md not found, but a dev mode was requested. Continuing without dev add-on."
      );
    }
  }

  const prompt = `
${systemPrompt}

================ INPUT CONTEXT ================
TARGET_COMPANY: ${company}
TARGET_ROLE: ${jobTitle}

RESUME_MODE: ${resumeMode}
METHODOLOGIES: ${methodologies.join(", ") || "None"}

JOB_DESCRIPTION:
${jobDesc}

EXTRA_INSTRUCTIONS:
${extra || "(none)"}

BASE_RESUME:
${baseResume}

DEV_RESUME_ADDON:
${devResumeAddon || "(none)"}
================================================
  `.trim();

  const aiText = await generateWithFallback(prompt);

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

  const rawOut = path.join(versionDir, `raw_${safeCompany}_${safeTitle}.txt`);
  const docxOut = path.join(versionDir, `resume_${safeCompany}_${safeTitle}.docx`);

  fs.writeFileSync(rawOut, aiText, "utf8");
  await buildDocxFromTaggedText(aiText, docxOut);

  console.log("Saved raw AI output:", rawOut);
  console.log("Saved professional DOCX resume:", docxOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
