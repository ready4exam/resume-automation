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
// CLI ARGS
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ---------------------------------------------------
// GEMINI CALL WITH FALLBACK
// ---------------------------------------------------
async function callGemini(prompt) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of models) {
    try {
      console.log(`Phase-2 using model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const txt = result.response.text() || "";
      if (!txt.trim()) {
        throw new Error("Empty response from model");
      }
      return txt;
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      console.error(`Model ${modelName} failed (${status}): ${err.message}`);
      if (status === 500 || status === 503) {
        console.log("Trying next fallback model...");
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("All models failed");
}

// ---------------------------------------------------
// TEXT HELPERS
// ---------------------------------------------------
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

// ---------------------------------------------------
// DOCX BUILDER
// ---------------------------------------------------
const FONT = "Calibri";

async function buildDocx(text, outPath) {
  const CONTACT = extract("CONTACT", text);
  const SUMMARY = extract("SUMMARY", text);
  const ACH = extract("ACHIEVEMENTS", text);
  const CORE = extract("CORE_SKILLS", text);
  const EXP = extract("EXPERIENCE", text);
  const PROJ = extract("PROJECTS", text);
  const TECH = extract("TECHNICAL_SKILLS", text);
  const CERT = extract("CERTIFICATIONS", text);
  const EDU = extract("EDUCATION", text);

  // Font sizes (half-points)
  const BODY_SIZE = 22;    // 11pt
  const HEADING_SIZE = 24; // 12pt
  const NAME_SIZE = 36;    // 18pt (nice but not huge)

  function bodyRun(text, opts = {}) {
    return new TextRun({ text, font: FONT, size: BODY_SIZE, ...opts });
  }

  function headingPara(label) {
    return new Paragraph({
      children: [
        new TextRun({
          text: label,
          font: FONT,
          size: HEADING_SIZE,
          bold: true,
          allCaps: true,
        }),
      ],
      spacing: { before: 200, after: 80 },
    });
  }

  function bulletPara(text) {
    return new Paragraph({
      text,
      bullet: { level: 0 },
      spacing: { after: 60 },
    });
  }

  function normalPara(text, extra = {}) {
    return new Paragraph({
      children: [bodyRun(text)],
      spacing: { after: 120, ...(extra.spacing || {}) },
    });
  }

  function eduBulletPara(text) {
    // Education bullets: compact, no extra spacing
    return new Paragraph({
      text,
      bullet: { level: 0 },
      spacing: { after: 0 },
    });
  }

  const children = [];

  // ---------------------------------------------------
  // FIXED HEADER (as requested, ignoring CONTACT layout)
  // ---------------------------------------------------
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Keshav Karn",
          font: FONT,
          size: NAME_SIZE,
          bold: true,
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        bodyRun("Hyderabad, India | 8520977573 | keshav.karn@gmail.com"),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 20 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        bodyRun(
          "LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn"
        ),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 20 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        bodyRun(
          "Ready4Industry: https://ready4industry.in | Ready4Exam GitHub: https://ready4exam.github.io/ready4exam-class-11/"
        ),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    })
  );

  // ---------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------
  if (SUMMARY) {
    children.push(headingPara("PROFESSIONAL SUMMARY"));
    splitLines(SUMMARY).forEach((line) => {
      children.push(
        new Paragraph({
          children: [bodyRun(line)],
          spacing: { after: 80 },
        })
      );
    });
  }

  // ---------------------------------------------------
  // ACHIEVEMENTS (1–2 bullets)
// ---------------------------------------------------
  if (ACH) {
    children.push(headingPara("ACHIEVEMENTS"));
    splitLines(ACH).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      if (clean) children.push(bulletPara(clean));
    });
  }

  // ---------------------------------------------------
  // CORE SKILLS (pipe-separated, professional)
// ---------------------------------------------------
  if (CORE) {
    children.push(headingPara("CORE SKILLS"));
    const coreLines = splitLines(CORE);
    const coreText =
      coreLines.length > 1 ? coreLines.join(" | ") : coreLines[0] || "";
    if (coreText) {
      children.push(
        new Paragraph({
          children: [bodyRun(coreText)],
          spacing: { after: 120 },
        })
      );
    }
  }

  // ---------------------------------------------------
  // EXPERIENCE
// ---------------------------------------------------
  if (EXP) {
    children.push(headingPara("EXPERIENCE"));

    const lines = EXP.split("\n");
    let block = [];

    function flushBlock() {
      if (!block.length) return;
      const jobLines = splitLines(block.join("\n"));
      if (!jobLines.length) return;

      const header = jobLines[0];
      children.push(
        new Paragraph({
          children: [bodyRun(header, { bold: true })],
          spacing: { before: 160, after: 60 },
        })
      );

      jobLines.slice(1).forEach((l) => {
        const clean = l.replace(/^-+\s*/, "");
        if (clean) children.push(bulletPara(clean));
      });

      block = [];
    }

    for (const raw of lines) {
      if (raw.trim().startsWith("Company:")) {
        flushBlock();
        block = [raw];
      } else {
        block.push(raw);
      }
    }
    flushBlock();
  }

  // ---------------------------------------------------
  // PROJECTS
// ---------------------------------------------------
  if (PROJ && PROJ.trim()) {
    children.push(headingPara("PROJECTS"));
    splitLines(PROJ).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      if (line.startsWith("-")) children.push(bulletPara(clean));
      else children.push(normalPara(line));
    });
  }

  // ---------------------------------------------------
  // TECHNICAL SKILLS
// ---------------------------------------------------
  if (TECH) {
    children.push(headingPara("TECHNICAL SKILLS"));
    splitLines(TECH).forEach((line) => {
      children.push(
        new Paragraph({
          children: [bodyRun(line)],
          spacing: { after: 80 },
        })
      );
    });
  }

  // ---------------------------------------------------
  // CERTIFICATIONS
// ---------------------------------------------------
  if (CERT) {
    children.push(headingPara("CERTIFICATIONS"));
    splitLines(CERT).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      if (clean) children.push(bulletPara(clean));
    });
  }

  // ---------------------------------------------------
  // EDUCATION (3 bullets, no extra spacing)
// ---------------------------------------------------
  if (EDU) {
    children.push(headingPara("EDUCATION"));
    splitLines(EDU).forEach((line) => {
      const clean = line.replace(/^-+\s*/, "");
      if (clean) children.push(eduBulletPara(clean));
    });
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
// HELPER: derive company/role from rawFile path
// Expected pattern: jobs/<company>/<role>/<timestamp>/raw.txt
// ---------------------------------------------------
function inferCompanyRoleFromRawPath(rawFile) {
  const parts = path.normalize(rawFile).split(path.sep);
  const jobsIdx = parts.indexOf("jobs");
  if (jobsIdx >= 0 && parts.length >= jobsIdx + 4) {
    const company = parts[jobsIdx + 1] || "Company";
    const role = parts[jobsIdx + 2] || "Role";
    return { company, role };
  }
  return { company: "Company", role: "Role" };
}

// ---------------------------------------------------
// MAIN
// ---------------------------------------------------
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jdFile || !rawFile) {
    console.error(
      "Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file jobs/.../raw.txt [--out-dir folder]"
    );
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const rawResume = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(
    path.join("templates", "system_prompt.txt"),
    "utf8"
  );

  // ---------------------------------------------------
  // STEP 1 — REVIEW (strict recruiter angle)
// ---------------------------------------------------
  const reviewPrompt = `
You are a senior recruiter performing a strict audit of a candidate's resume against a specific job description.

JOB DESCRIPTION:
${jd}

RESUME:
${rawResume}

From a recruiter perspective, identify all issues:

- Missing or weak alignment to JD requirements.
- Missing or weak keywords.
- Weak verbs or generic bullets.
- Lack of metrics or impact.
- Leadership gaps (especially for Director/AVP/VP roles).
- Inconsistency of seniority tone.
- Sections that feel outdated, redundant, or irrelevant.
- Any ATS risks (too verbose, not keyworded enough).

Respond ONLY in this format:

[REVIEW]
- item 1
- item 2
- item 3
[/REVIEW]
`.trim();

  let review = await callGemini(reviewPrompt);
  if (!review.includes("[REVIEW]")) {
    review = "[REVIEW]\n(No review returned)\n[/REVIEW]";
  }

  // ---------------------------------------------------
  // STEP 2 — REWRITE USING REVIEW + SYSTEM PROMPT
// ---------------------------------------------------
  const improvePrompt = `
${systemPrompt}

You have review feedback from a recruiter and the job description.

REVIEW_NOTES:
${review}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${rawResume}

TASK:
Generate a fully improved resume STRICTLY using the tag structure defined in the system prompt.
DO NOT add any commentary. DO NOT add extra tags. Output ONLY the tagged resume.
`.trim();

  const improved = await callGemini(improvePrompt);

  // ---------------------------------------------------
  // WRITE FILES + DOCX
// ---------------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });

  const reviewPath = path.join(outDir, "review.txt");
  const refinedRawPath = path.join(outDir, "refined_raw.txt");

  fs.writeFileSync(reviewPath, review, "utf8");
  fs.writeFileSync(refinedRawPath, improved, "utf8");

  const { company, role } = inferCompanyRoleFromRawPath(rawFile);
  const docxName = `resume_${company}_${role}.docx`.replace(/_+/g, "_");
  const docxOut = path.join(outDir, docxName);

  await buildDocx(improved, docxOut);

  console.log("Review file:", reviewPath);
  console.log("Refined raw:", refinedRawPath);
  console.log("Final DOCX:", docxOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
