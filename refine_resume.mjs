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

// --------------------------------------------
// GEMINI SETUP
// --------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --------------------------------------------
// SMALL HELPERS
// --------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function ai(model, prompt) {
  const m = genAI.getGenerativeModel({ model });
  const r = await m.generateContent(prompt);
  return r.response.text();
}

// --------------------------------------------
// EXTRACTION HELPERS
// --------------------------------------------
function extract(tag, text) {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function splitLines(txt) {
  return txt
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// --------------------------------------------
// DOCX BUILDER (COPIED FROM PHASE-1)
// --------------------------------------------
const FONT = "Calibri";
const SIZE = 22; // 11pt

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: SIZE, ...opts });
}

function heading(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 26, bold: true, allCaps: true })],
    spacing: { before: 200, after: 120 },
  });
}

function nameHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: 40, bold: true })],
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

async function buildDocx(aiText, outPath) {
  const CONTACT = extract("CONTACT", aiText);
  const SUMMARY = extract("SUMMARY", aiText);
  const CORE = extract("CORE_SKILLS", aiText);
  const EXP = extract("EXPERIENCE", aiText);
  const PROJ = extract("PROJECTS", aiText);
  const TECH = extract("TECHNICAL_SKILLS", aiText);
  const CERT = extract("CERTIFICATIONS", aiText);
  const EDU = extract("EDUCATION", aiText);

  const children = [];

  // CONTACT
  if (CONTACT) {
    const lines = splitLines(CONTACT);
    const name = lines[0] || "";
    const rest = lines.slice(1);

    if (name) children.push(nameHeading(name));
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

  if (SUMMARY) {
    children.push(heading("PROFESSIONAL SUMMARY"));
    splitLines(SUMMARY).forEach((x) => children.push(normal(x)));
  }

  if (CORE) {
    children.push(heading("CORE SKILLS & COMPETENCIES"));
    splitLines(CORE).forEach((x) => children.push(bullet(x.replace(/^-+\s*/, ""))));
  }

  if (EXP) {
    children.push(heading("PROFESSIONAL EXPERIENCE"));

    const lines = EXP.split("\n");
    let block = [];

    function flush() {
      if (!block.length) return;
      const jobLines = splitLines(block.join("\n"));
      if (jobLines.length === 0) return;

      const header = jobLines[0];
      children.push(
        new Paragraph({ children: [run(header, { bold: true })], spacing: { before: 160, after: 80 } })
      );

      jobLines.slice(1).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
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

  if (PROJ) {
    children.push(heading("PROJECTS & INDEPENDENT WORK"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-")) children.push(bullet(line.replace(/^-+\s*/, "")));
      else children.push(normal(line));
    });
  }

  if (TECH) {
    children.push(heading("TECHNICAL SKILLS"));
    splitLines(TECH).forEach((x) => children.push(normal(x)));
  }

  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((x) => children.push(bullet(x)));
  }

  if (EDU) {
    children.push(heading("EDUCATION"));
    splitLines(EDU).forEach((x) => children.push(normal(x)));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1150, right: 1150 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

// --------------------------------------------
// MAIN PHASE-2 LOGIC
// --------------------------------------------
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jdFile || !rawFile) {
    console.error('Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt');
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const rawResume = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(path.join("templates", "system_prompt.txt"), "utf8");

  // --------------------------------------------
  // STEP 1 — Recruiter Review
  // --------------------------------------------
  const reviewPrompt = `
You are a senior recruiter.

JOB DESCRIPTION:
${jd}

RESUME:
${rawResume}

Provide improvement feedback ONLY inside:

[REVIEW]
- item
- item
[/REVIEW]
  `.trim();

  let review = await ai("gemini-pro-latest", reviewPrompt);
  if (!review.includes("[REVIEW]")) review = "[REVIEW]\n(No review)\n[/REVIEW]";

  // --------------------------------------------
  // STEP 2 — Generate refined resume
  // --------------------------------------------
  const improvePrompt = `
${systemPrompt}

REVIEW_NOTES:
${review}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${rawResume}

Now output ONLY the final resume using STRICT TAG FORMAT.
  `.trim();

  const improved = await ai("gemini-pro-latest", improvePrompt);

  // --------------------------------------------
  // OUTPUT
  // --------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });

  const reviewOut = path.join(outDir, "review.txt");
  const refinedRawOut = path.join(outDir, "refined_raw.txt");
  const refinedDocxOut = path.join(outDir, "refined_resume.docx");

  fs.writeFileSync(reviewOut, review, "utf8");
  fs.writeFileSync(refinedRawOut, improved, "utf8");

  // FINAL: Only DOCX in entire pipeline
  await buildDocx(improved, refinedDocxOut);

  console.log("Refined files created in:", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
