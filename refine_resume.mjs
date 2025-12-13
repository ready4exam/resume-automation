// ============================================================================
// refine_resume.mjs — VP-ENHANCED PRODUCTION VERSION (Safe Filename + Free-Tier Engine)
// ============================================================================

import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google-generative-ai/google-generative-ai";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

// ============================================================================
//  MODEL CHAIN — FREE TIER FRIENDLY (AUTO FAILOVER)
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
//  BULLETPROOF LLM CALL (FAILOVER ENGINE)
// ============================================================================
async function callGemini(prompt) {
  let lastErr = null;

  for (const model of MODEL_CHAIN) {
    console.log(`\n⚡ Trying model: ${model}`);

    try {
      const m = genAI.getGenerativeModel({ model });
      const result = await m.generateContent(prompt);
      const txt = result.response.text();

      if (!txt || !txt.trim()) {
        console.log(`⚠ Empty output from ${model} → Trying next...`);
        continue;
      }

      console.log(`✅ SUCCESS with ${model}`);
      return txt;
    } catch (err) {
      lastErr = err;
      const status = err?.status;

      console.log(`❌ ${model} failed (${status}): ${err.message}`);

      if (status === 429) {
        console.log("🔄 Quota exhausted → switching model");
        continue;
      }

      if (status === 500 || status === 503) {
        console.log("🔁 Retrying...");
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      console.log("⏭ Non-recoverable → skipping");
    }
  }

  throw lastErr || new Error("All models failed.");
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
    .filter((x) => x.length > 0);
}

// ============================================================================
//  SAFE FILENAME HELPERS
// ============================================================================
function safePart(str, max = 30) {
  return str
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, max)
    .replace(/^_+|_+$/g, "");
}

// ============================================================================
//  DOCX BUILDER (UNCHANGED – DO NOT MODIFY FORMAT)
// ============================================================================
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

  const BODY_SIZE = 22;
  const HEADING_SIZE = 26;
  const NAME_SIZE = 38;

  function run(t, opts = {}) {
    return new TextRun({ text: t, font: FONT, size: BODY_SIZE, ...opts });
  }
  function heading(t) {
    return new Paragraph({
      children: [
        new TextRun({
          text: t,
          font: FONT,
          bold: true,
          size: HEADING_SIZE,
          allCaps: true,
        }),
      ],
      spacing: { before: 200, after: 100 },
    });
  }
  function bullet(t) {
    return new Paragraph({
      text: t,
      bullet: { level: 0 },
      spacing: { after: 60 },
    });
  }

  const children = [];

  // HEADER (UNCHANGED)
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Keshav Karn", font: FONT, size: NAME_SIZE, bold: true }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    })
  );

  children.push(
    new Paragraph({
      children: [run("Hyderabad, India | 8520977573 | keshav.karn@gmail.com")],
      spacing: { after: 20 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        run("LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn"),
      ],
      spacing: { after: 20 },
    })
  );

  // SUMMARY
  if (SUMMARY) {
    children.push(heading("EXECUTIVE SUMMARY"));
    splitLines(SUMMARY).forEach((l) =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  // ACHIEVEMENTS
  if (ACH) {
    children.push(heading("LEADERSHIP SNAPSHOT"));
    splitLines(ACH).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  // CORE SKILLS
  if (CORE) {
    children.push(heading("CORE STRENGTHS"));
    children.push(
      new Paragraph({
        children: [run(splitLines(CORE).join(" | "))],
        spacing: { after: 120 },
      })
    );
  }

  // EXPERIENCE
  if (EXP) {
    children.push(heading("EXPERIENCE"));
    const lines = EXP.split("\n");
    let buf = [];

    function flush() {
      if (!buf.length) return;
      const arr = splitLines(buf.join("\n"));
      if (!arr.length) return;

      children.push(
        new Paragraph({
          children: [run(arr[0], { bold: true })],
          spacing: { before: 160, after: 60 },
        })
      );

      arr.slice(1).forEach((l) =>
        children.push(bullet(l.replace(/^-+\s*/, "")))
      );

      buf = [];
    }

    for (const line of lines) {
      if (line.trim().startsWith("Company:")) flush();
      buf.push(line);
    }
    flush();
  }

  // PROJECTS
  if (PROJ) {
    children.push(heading("PORTFOLIO PROJECTS"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-"))
        children.push(bullet(line.replace(/^-+\s*/, "")));
      else
        children.push(
          new Paragraph({ children: [run(line)], spacing: { after: 80 } })
        );
    });
  }

  // TECHNICAL SKILLS
  if (TECH) {
    children.push(heading("TECHNICAL LEADERSHIP SKILLS"));
    splitLines(TECH).forEach((l) =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  // CERTIFICATIONS
  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((l) =>
      children.push(bullet(l.replace(/^-+\s*/, "")))
    );
  }

  // EDUCATION
  if (EDU) {
    children.push(heading("EDUCATION"));
    splitLines(EDU).forEach((l) =>
      children.push(
        new Paragraph({
          text: l.replace(/^-+\s*/, ""),
          bullet: { level: 0 },
        })
      )
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1150, right: 1150 } },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

// ============================================================================
//  MAIN PIPELINE — MINIMAL CHANGES BUT VP-LEVEL CONTENT ENABLED
// ============================================================================
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jdFile || !rawFile) {
    console.error("Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt");
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const raw = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(
    path.join("templates", "system_prompt.txt"),
    "utf8"
  );

  fs.mkdirSync(outDir, { recursive: true });

  // Extract company + job title
  function extractCompanyTitle(jdText) {
    const line = jdText.split("\n")[0].trim();

    let company = "Company";
    let title = "Role";

    if (line.includes("-")) {
      const [c, t] = line.split("-");
      company = c.trim().split(" ")[0];
      title = t.trim().replace(/\s+/g, "_");
    } else {
      const w = line.split(" ");
      company = w[0];
      title = w.slice(1).join("_") || "Role";
    }

    return { company, title };
  }

  const { company, title } = extractCompanyTitle(jd);

  const safeCompany = safePart(company, 25);
  const safeTitle = safePart(title, 35);

  // ❗ TIMESTAMP REMOVED for clean filename
  const finalDocName = `resume_${safeCompany}_${safeTitle}.docx`;

  // ======================
  // STAGE 1 — KEYWORD COVERAGE
  // ======================
  console.log("\n📌 Running Keyword Coverage...");

  const coveragePrompt = `
Extract important JD keywords and compare with resume.

Return ONLY:

[KEYWORD_COVERAGE]
matched: [list]
missing: [list]
coverage_percent: 00
critical_gaps: [list]
[/KEYWORD_COVERAGE]

JOB DESCRIPTION:
${jd}

RESUME:
${raw}
`;

  const coverage = await callGemini(coveragePrompt);
  fs.writeFileSync(path.join(outDir, "keyword_coverage.txt"), coverage);

  // ======================
  // STAGE 2 — SUMMARY REWRITE
  // ======================
  console.log("\n📌 Enhancing Summary...");

  const summaryPrompt = `
Rewrite ONLY the Executive Summary using VP-level tone.
Insert essential JD keywords.
End with a one-line leadership fit statement.

Return ONLY:

[SUMMARY]
<text>
[/SUMMARY]

JOB DESCRIPTION:
${jd}

RESUME:
${raw}

KEYWORD_COVERAGE:
${coverage}
`;

  let optimizedSummary = await callGemini(summaryPrompt);
  optimizedSummary = extract("SUMMARY", optimizedSummary);
  fs.writeFileSync(path.join(outDir, "optimized_summary.txt"), optimizedSummary);

  // ======================
  // STAGE 3 — REVIEW NOTES
  // ======================
  console.log("\n📌 Running REVIEW...");

  const reviewPrompt = `
Return ONLY:

[REVIEW]
- item 1
- item 2
...
[/REVIEW]

JOB DESCRIPTION:
${jd}

RESUME:
${raw}
`;

  let review = await callGemini(reviewPrompt);
  if (!review.includes("[REVIEW]")) review = "[REVIEW]\n(No review)\n[/REVIEW]";
  fs.writeFileSync(path.join(outDir, "review.txt"), review);

  // ======================
  // STAGE 4 — FULL RESUME REWRITE (VP STYLE)
//  ======================
  console.log("\n📌 Rewriting Resume in VP Style...");

  const improvePrompt = `
${systemPrompt}

You must rewrite the entire resume in a VP/Head/Director-level style.

MANDATORY VP INSTRUCTIONS:
- SUMMARY: Must include 4–6 sentence Executive Summary + a Leadership Snapshot block.
- CORE_SKILLS: Group skills into Leadership, AI Strategy, Cloud/Platform, Engineering, and Operations.
- EXPERIENCE: For each company, rewrite using strategic subheadings:
  Scope of Leadership, Strategic Impact, Operational Excellence, AI/Innovation Leadership, Cloud/Platform Modernization,
  Global Stakeholder Influence, Financial Impact (NO P&L).
- PROJECTS: Rewrite as enterprise transformation initiatives.
- TECHNICAL_SKILLS: Keep concise and grouped by domain.
- DO NOT add new tags; output ONLY inside existing tags.

Rewrite using:
- OPTIMIZED SUMMARY
- REVIEW NOTES
- KEYWORD COVERAGE
- JOB DESCRIPTION
- ORIGINAL RESUME

OPTIMIZED_SUMMARY:
${optimizedSummary}

REVIEW_NOTES:
${review}

KEYWORD_COVERAGE:
${coverage}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${raw}

OUTPUT ONLY THE TAGGED RESUME.
`;

  const improved = await callGemini(improvePrompt);
  fs.writeFileSync(path.join(outDir, "refined_raw.txt"), improved);

  // ======================
  // STAGE 5 — BUILD DOCX
  // ======================
  console.log(`\n📌 Building DOCX → ${finalDocName}`);

  await buildDocx(improved, path.join(outDir, finalDocName));

  console.log("\n🎉 Resume refinement COMPLETE.");
}

main().catch((err) => {
  console.error("\n❌ FATAL ERROR:", err);
  process.exit(1);
});
