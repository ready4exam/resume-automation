// ============================================================================
// refine_resume.mjs — FINAL PROD (VP MODE, TOKEN-OPTIMIZED)
// ============================================================================

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

// ============================================================================
//  MODEL CHAIN — FREE TIER FRIENDLY
// ============================================================================
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
//  ARG PARSER
// ============================================================================
function getArg(flag, def = "") {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return def;
  return process.argv[i + 1];
}

// ============================================================================
//  BULLETPROOF LLM CALL
// ============================================================================
async function callGemini(prompt) {
  let lastErr = null;

  for (const model of MODEL_CHAIN) {
    try {
      const m = genAI.getGenerativeModel({ model });
      const result = await m.generateContent(prompt);
      const txt = result.response.text();
      if (txt && txt.trim()) return txt;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("All models failed");
}

// ============================================================================
//  TEXT HELPERS
// ============================================================================
function extract(tag, text) {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function splitLines(txt) {
  return txt
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ============================================================================
//  SAFE FILENAME
// ============================================================================
function safePart(str, max = 30) {
  return str
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, max)
    .replace(/^_+|_+$/g, "");
}

// ============================================================================
//  DOCX BUILDER (UNCHANGED LOOK & FEEL)
// ============================================================================
const FONT = "Calibri";

async function buildDocx(text, outPath) {
  const SUMMARY = extract("SUMMARY", text);
  const CORE = extract("CORE_SKILLS", text);
  const EXP = extract("EXPERIENCE", text);
  const PROJ = extract("PROJECTS", text);
  const TECH = extract("TECHNICAL_SKILLS", text);
  const CERT = extract("CERTIFICATIONS", text);
  const EDU = extract("EDUCATION", text);

  const BODY = 22;
  const HEAD = 26;
  const NAME = 38;

  const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: BODY, ...o });
  const heading = (t) =>
    new Paragraph({
      children: [new TextRun({ text: t, font: FONT, bold: true, size: HEAD, allCaps: true })],
      spacing: { before: 200, after: 100 },
    });
  const bullet = (t) =>
    new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 60 } });

  const children = [];

  // HEADER
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Keshav Karn", font: FONT, size: NAME, bold: true })],
      spacing: { after: 40 },
    })
  );
  children.push(new Paragraph({ children: [run("Hyderabad, India | 8520977573 | keshav.karn@gmail.com")] }));
  children.push(
    new Paragraph({
      children: [
        run("LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn"),
      ],
      spacing: { after: 40 },
    })
  );

  // SUMMARY
  if (SUMMARY) {
    children.push(heading("EXECUTIVE SUMMARY"));
    splitLines(SUMMARY).forEach((l) =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  // CORE SKILLS
  if (CORE) {
    children.push(heading("CORE STRENGTHS"));
    children.push(new Paragraph({ children: [run(splitLines(CORE).join(" | "))] }));
  }

  // EXPERIENCE
  if (EXP) {
    children.push(heading("EXPERIENCE"));
    const lines = EXP.split("\n");
    let buf = [];

    const flush = () => {
      if (!buf.length) return;
      const arr = splitLines(buf.join("\n"));
      children.push(new Paragraph({ children: [run(arr[0], { bold: true })], spacing: { before: 120 } }));
      arr.slice(1).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
      buf = [];
    };

    for (const line of lines) {
      if (line.startsWith("Company:")) flush();
      buf.push(line);
    }
    flush();
  }

  // PROJECTS
  if (PROJ) {
    children.push(heading("PORTFOLIO PROJECTS"));
    splitLines(PROJ).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  // TECHNICAL
  if (TECH) {
    children.push(heading("TECHNICAL LEADERSHIP SKILLS"));
    splitLines(TECH).forEach((l) => children.push(new Paragraph({ children: [run(l)] })));
  }

  // CERT & EDU
  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }
  if (EDU) {
    children.push(heading("EDUCATION"));
    splitLines(EDU).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
}

// ============================================================================
//  MAIN — SINGLE VP REWRITE PASS
// ============================================================================
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "output");

  if (!jdFile || !rawFile) {
    console.error("Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt");
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const raw = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(path.join("templates", "system_prompt.txt"), "utf8");

  fs.mkdirSync(outDir, { recursive: true });

  const company = safePart(jd.split("\n")[0].split(" ")[0], 25);
  const title = safePart(jd.split("\n")[0].replace(company, ""), 35);
  const finalName = `resume_${company}_${title}.docx`;

  const prompt = `
${systemPrompt}

JOB_DESCRIPTION:
${jd}

BASE_RESUME:
${raw}

OUTPUT ONLY THE TAGGED RESUME.
`;

  const improved = await callGemini(prompt);
  await buildDocx(improved, path.join(outDir, finalName));

  console.log("✅ VP resume generated:", finalName);
}

main().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
