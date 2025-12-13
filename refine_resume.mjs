// ============================================================================
// refine_resume.mjs — PHASE 2 (REVIEW + GAP FIX, VP MODE)
// ============================================================================

import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Document,
  Packer,
  Paragraph,
  TextRun
} from "docx";

// ============================================================================
//  FREE-TIER MODEL FALLBACK (SAFE)
// ============================================================================
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.5-flash-lite"
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
//  BULLETPROOF GEMINI CALL
// ============================================================================
async function callGemini(prompt) {
  let lastErr = null;
  for (const model of MODEL_CHAIN) {
    try {
      const m = genAI.getGenerativeModel({ model });
      const r = await m.generateContent(prompt);
      const t = r.response.text();
      if (t && t.trim()) return t;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All models failed");
}

// ============================================================================
//  TAG EXTRACTION
// ============================================================================
function extract(tag, text) {
  const r = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(r);
  return m ? m[1].trim() : "";
}

function lines(t) {
  return t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

// ============================================================================
//  SAFE NAME
// ============================================================================
function safePart(str, max = 30) {
  return str
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, max)
    .replace(/^_+|_+$/g, "");
}

// ============================================================================
//  DOCX BUILDER — UNCHANGED (AS REQUESTED)
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
      spacing: { before: 200, after: 100 }
    });
  const bullet = (t) =>
    new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 60 } });

  const children = [];

  // Header (static – unchanged)
  children.push(new Paragraph({
    children: [new TextRun({ text: "Keshav Karn", font: FONT, size: NAME, bold: true })],
    spacing: { after: 40 }
  }));
  children.push(new Paragraph({ children: [run("Hyderabad, India | 8520977573 | keshav.karn@gmail.com")] }));
  children.push(new Paragraph({
    children: [run("LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn")],
    spacing: { after: 40 }
  }));

  if (SUMMARY) {
    children.push(heading("EXECUTIVE SUMMARY"));
    lines(SUMMARY).forEach(l =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  if (CORE) {
    children.push(heading("CORE STRENGTHS"));
    children.push(new Paragraph({ children: [run(lines(CORE).join(" | "))] }));
  }

  if (EXP) {
    children.push(heading("EXPERIENCE"));
    const raw = EXP.split("\n");
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const a = lines(buf.join("\n"));
      children.push(new Paragraph({ children: [run(a[0], { bold: true })], spacing: { before: 120 } }));
      a.slice(1).forEach(l => children.push(bullet(l.replace(/^-+\s*/, ""))));
      buf = [];
    };
    for (const l of raw) {
      if (l.startsWith("Company:")) flush();
      buf.push(l);
    }
    flush();
  }

  if (PROJ) {
    children.push(heading("PORTFOLIO PROJECTS"));
    lines(PROJ).forEach(l => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  if (TECH) {
    children.push(heading("TECHNICAL LEADERSHIP SKILLS"));
    lines(TECH).forEach(l => children.push(new Paragraph({ children: [run(l)] })));
  }

  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    lines(CERT).forEach(l => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  if (EDU) {
    children.push(heading("EDUCATION"));
    lines(EDU).forEach(l => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
}

// ============================================================================
//  MAIN — PHASE 2 REVIEW + GAP FIX
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
  const phase1 = fs.readFileSync(rawFile, "utf8");
  const reviewPrompt = fs.readFileSync("templates/review_prompt.txt", "utf8");

  fs.mkdirSync(outDir, { recursive: true });

  const prompt = `
${reviewPrompt}

JOB_DESCRIPTION:
${jd}

PHASE_1_RESUME:
${phase1}

TASK:
Review as VP hiring manager.
If gaps exist, FIX THEM.
If neutral, strengthen positioning.
If already strong, refine for clarity.
Avoid repetition. Avoid overdoing.
Output ONLY the final tagged resume.
`.trim();

  const finalText = await callGemini(prompt);

  const company = safePart(jd.split("\n")[0], 25);
  const file = `resume_final_${company}.docx`;

  await buildDocx(finalText, path.join(outDir, file));

  console.log("✅ Phase-2 VP resume generated:", file);
}

main().catch(e => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});
