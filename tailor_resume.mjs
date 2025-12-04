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

// ---------------------------------------------------
// GEMINI SETUP
// ---------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-pro-latest"];

// ---------------------------------------------------
// CLI ARG HANDLER
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ---------------------------------------------------
// CALL GEMINI WITH FALLBACK
// ---------------------------------------------------
async function generateWithFallback(prompt) {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Using Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const resp = await model.generateContent(prompt);
      console.log(`Model ${modelName} succeeded.`);
      return resp.response.text();
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      console.error(`Model ${modelName} error (${status}):`, err.message);

      if (status === 500 || status === 503) {
        console.log("Retrying with next model...");
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("All Gemini models failed.");
}

// ---------------------------------------------------
// EXTRACT SECTION FROM TAGGED TEXT
// ---------------------------------------------------
function extract(tag, text) {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function splitLines(txt) {
  return txt
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ---------------------------------------------------
// DOCX HELPERS
// ---------------------------------------------------
const FONT = "Calibri";
const SIZE = 22; // 11 pt

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: SIZE, ...opts });
}

function heading(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 26,
        bold: true,
        allCaps: true,
      }),
    ],
    spacing: { before: 200, after: 120 },
  });
}

function nameHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 40,
        bold: true,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  });
}

function bullet(text) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function normal(text) {
  return new Paragraph({
    children: [run(text)],
    spacing: { after: 120 },
  });
}

// ---------------------------------------------------
// BUILD DOCX FROM TAGGED AI OUTPUT
// ---------------------------------------------------
async function buildDocx(text, outPath) {
  const CONTACT = extract("CONTACT", text);
  const SUMMARY = extract("SUMMARY", text);
  const CORE = extract("CORE_SKILLS", text);
  const EXP = extract("EXPERIENCE", text);
  const PROJ = extract("PROJECTS", text);
  const TECH = extract("TECHNICAL_SKILLS", text);
  const CERT = extract("CERTIFICATIONS", text);
  const EDU = extract("EDUCATION", text);

  const children = [];

  // CONTACT SECTION
  if (CONTACT) {
    const lines = splitLines(CONTACT);
    const name = lines[0] || "";
    const rest = lines.slice(1);

    children.push(nameHeading(name));
    rest.forEach((l) =>
      children.push(
        new Paragraph({
          children: [run(l)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        })
      )
    );
  }

  // SUMMARY
  if (SUMMARY) {
    children.push(heading("PROFESSIONAL SUMMARY"));
    splitLines(SUMMARY).forEach((x) => children.push(normal(x)));
  }

  // CORE SKILLS
  if (CORE) {
    children.push(heading("CORE SKILLS & COMPETENCIES"));
    splitLines(CORE).forEach((x) =>
      children.push(bullet(x.replace(/^-+\s*/, "")))
    );
  }

  // EXPERIENCE
  if (EXP) {
    children.push(heading("PROFESSIONAL EXPERIENCE"));

    const lines = EXP.split("\n");
    let block = [];

    function flush() {
      if (block.length === 0) return;
      const jobLines = splitLines(block.join("\n"));
      if (jobLines.length === 0) return;

      const header = jobLines[0];
      children.push(
        new Paragraph({
          children: [run(header, { bold: true })],
          spacing: { before: 160, after: 80 },
        })
      );

      jobLines.slice(1).forEach((l) =>
        children.push(bullet(l.replace(/^-+\s*/, "")))
      );

      block = [];
    }

    for (const raw of lines) {
      if (raw.trim().toLowerCase().startsWith("company:")) {
        flush();
        block = [raw];
      } else block.push(raw);
    }
    flush();
  }

  // PROJECTS
  if (PROJ) {
    children.push(heading("PROJECTS & INDEPENDENT WORK"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-")) children.push(bullet(line.replace(/^-+\s*/, "")));
      else children.push(normal(line));
    });
  }

  // TECHNICAL SKILLS
  if (TECH) {
    children.push(heading("TECHNICAL SKILLS"));
    splitLines(TECH).forEach((x) => children.push(normal(x)));
  }

  // CERTIFICATIONS
  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((x) => children.push(bullet(x)));
  }

  // EDUCATION
  if (EDU) {
    children.push(heading("EDUCATION"));
    splitLines(EDU).forEach((x) => children.push(normal(x)));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1150,
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

// ---------------------------------------------------
// MAIN EXECUTION
// ---------------------------------------------------
async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jdFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");
  const rmArg = getArg("--resume-mode", "infra");
  const methodsArg = getArg("--methods", "");

  if (!company || !jobTitle || !jdFile) {
    console.error("Missing required args.");
    process.exit(1);
  }

  // resume mode mapping
  let resumeMode = "INFRA_ONLY";
  if (rmArg.toLowerCase() === "dev") resumeMode = "DEV_ONLY";
  else if (rmArg.toLowerCase() === "hybrid") resumeMode = "INFRA_PLUS_DEV";

  // methodology flags
  const methods = methodsArg
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const methodologyList = [];
  if (methods.includes("agile")) methodologyList.push("Agile");
  if (methods.includes("finops")) methodologyList.push("FinOps");

  // FILES
  const baseResume = fs.readFileSync("base_resume.md", "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");
  const devSkills = fs.existsSync("development.md")
    ? fs.readFileSync("development.md", "utf8")
    : "";

  // BIG-TECH CHECK
  const companyUpper = company.toUpperCase();
  const isBigTech = ["GOOGLE","MICROSOFT","AMAZON","AWS","META","APPLE","NETFLIX"]
    .some(tag => companyUpper.includes(tag));

  // load tone reference template
  const devGoogleTemplate = isBigTech
    ? fs.readFileSync("development_google_template.md", "utf8")
    : "(none)";

  const jdText = fs.readFileSync(jdFile, "utf8");

  // Should projects be inserted?
  const includeProjects =
    resumeMode === "DEV_ONLY" || resumeMode === "INFRA_PLUS_DEV"
      ? "YES"
      : "NO";

  // FINAL PROMPT
  const prompt = `
${systemPrompt}

================ CONTEXT INPUT ================
TARGET_COMPANY: ${company}
TARGET_ROLE: ${jobTitle}

RESUME_MODE: ${resumeMode}
INCLUDE_PROJECTS: ${includeProjects}
METHODOLOGIES: ${methodologyList.join(", ") || "None"}

JOB_DESCRIPTION:
${jdText}

EXTRA_INSTRUCTIONS:
${extra}

BASE_RESUME:
${baseResume}

DEV_SKILLS_BLOCK:
${resumeMode !== "INFRA_ONLY" ? devSkills : "(none)"}

BIG_TECH_TONE_REFERENCE:
${devGoogleTemplate}
================================================
  `.trim();

  const aiText = await generateWithFallback(prompt);

  // OUTPUT PATHS
  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_");
  const safeTitle = jobTitle.replace(/[^a-z0-9]+/gi, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const outDir = path.join("jobs", safeCompany, safeTitle, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const rawOut = path.join(outDir, `raw.txt`);
  const docxOut = path.join(outDir, `resume.docx`);

  fs.writeFileSync(rawOut, aiText, "utf8");
  await buildDocx(aiText, docxOut);

  console.log("Raw output:", rawOut);
  console.log("DOCX saved:", docxOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
