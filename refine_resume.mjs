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
const PRIMARY_MODEL = "gemini-pro-latest";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.0-flash"];

// ---------------------------------------------------
// HELPERS
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// AI with fallback
async function ai(prompt) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of models) {
    try {
      console.log("Phase-2 using:", modelName);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const txt = result.response.text() || "";
      if (!txt.trim()) throw new Error("Empty response");
      return txt;
    } catch (err) {
      lastErr = err;
      if (err.status === 500 || err.status === 503) continue;
      throw err;
    }
  }

  throw lastErr;
}

// Tag extractors
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
// DOCX builder helpers
// ---------------------------------------------------
const FONT = "Calibri";
const SIZE = 22; // 11pt

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: SIZE, ...opts });
}

function sectionHeading(text) {
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
// BUILD DOCX
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

  // ---------------------------------------------------
  // CONTACT (left-aligned compact header)
  // ---------------------------------------------------
  if (CONTACT) {
    const lines = splitLines(CONTACT);
    const name = lines[0] || "";
    const details = lines.slice(1);

    // NAME
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: name,
            font: FONT,
            bold: true,
            size: 40,
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
      })
    );

    // CONTACT DETAILS (compact, left aligned)
    details.forEach((l) =>
      children.push(
        new Paragraph({
          children: [run(l)],
          alignment: AlignmentType.LEFT,
          spacing: { after: 20 },
        })
      )
    );

    children.push(new Paragraph({ spacing: { after: 80 } }));
  }

  // ---------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------
  children.push(sectionHeading("PROFESSIONAL SUMMARY"));
  splitLines(SUMMARY).forEach((x) => children.push(normal(x)));

  // ---------------------------------------------------
  // CORE SKILLS
  // ---------------------------------------------------
  children.push(sectionHeading("CORE SKILLS"));
  splitLines(CORE).forEach((x) => children.push(bullet(x.replace(/^-+\s*/, ""))));

  // ---------------------------------------------------
  // EXPERIENCE
  // ---------------------------------------------------
  children.push(sectionHeading("EXPERIENCE"));

  const expLines = EXP.split("\n");
  let block = [];

  function flush() {
    if (!block.length) return;
    const job = splitLines(block.join("\n"));
    if (!job.length) return;

    const header = job[0];
    children.push(
      new Paragraph({
        children: [run(header, { bold: true })],
        spacing: { before: 160, after: 80 },
      })
    );

    job.slice(1).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
    block = [];
  }

  for (const line of expLines) {
    if (line.trim().startsWith("Company:")) {
      flush();
      block = [line];
    } else block.push(line);
  }
  flush();

  // ---------------------------------------------------
  // PROJECTS
  // ---------------------------------------------------
  if (PROJ && PROJ.trim()) {
    children.push(sectionHeading("PROJECTS"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-"))
        children.push(bullet(line.replace(/^-+\s*/, "")));
      else children.push(normal(line));
    });
  }

  // ---------------------------------------------------
  // TECHNICAL SKILLS
  // ---------------------------------------------------
  children.push(sectionHeading("TECHNICAL SKILLS"));
  splitLines(TECH).forEach((x) => children.push(normal(x)));

  // ---------------------------------------------------
  // CERTIFICATIONS
  // ---------------------------------------------------
  children.push(sectionHeading("CERTIFICATIONS"));
  splitLines(CERT).forEach((x) => children.push(bullet(x)));

  // ---------------------------------------------------
  // EDUCATION
  // ---------------------------------------------------
  children.push(sectionHeading("EDUCATION"));
  splitLines(EDU).forEach((x) => children.push(normal(x)));

  // ---------------------------------------------------
  // WRITE DOCX
  // ---------------------------------------------------
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
// MAIN
// ---------------------------------------------------
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jdFile || !rawFile) {
    console.error("Usage: refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt");
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const rawResume = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync("templates/system_prompt.txt", "utf8");

  // ---------------------------------------------------
  // REVIEW STEP (auto weakness detection)
  // ---------------------------------------------------
  const reviewPrompt = `
You are a senior recruiter performing a deep resume audit.

JOB DESCRIPTION:
${jd}

RESUME:
${rawResume}

TASK:
Identify every weakness using Auto Weakness Detection:
- Weak verbs
- No metrics
- No outcomes
- Generic text
- Missing keywords
- Leadership gaps
- Repetition
- Passive voice
- ATS alignment issues

Output only:

[REVIEW]
- item
- item
- item
[/REVIEW]
`;

  let review = await ai(reviewPrompt);
  if (!review.includes("[REVIEW]")) {
    review = "[REVIEW]\n(No review returned)\n[/REVIEW]";
  }

  // ---------------------------------------------------
  // REWRITE STEP
  // ---------------------------------------------------
  const improvePrompt = `
${systemPrompt}

USING REVIEW NOTES + JOB DESCRIPTION:
${review}

JOB DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${rawResume}

Now output an improved resume using ONLY the strict tag structure.
`;

  const improved = await ai(improvePrompt);

  // ---------------------------------------------------
  // WRITE FILES
  // ---------------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "review.txt"), review, "utf8");
  fs.writeFileSync(path.join(outDir, "refined_raw.txt"), improved, "utf8");

  // Dynamic DOCX filename
  const companyMatch = rawFile.split("/")[1] || "Company";
  const roleMatch = rawFile.split("/")[2] || "Role";
  const docxName = `resume_${companyMatch}_${roleMatch}.docx`.replace(/_+/g, "_");

  const docxOut = path.join(outDir, docxName);
  await buildDocx(improved, docxOut);

  console.log("Final DOCX:", docxOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
