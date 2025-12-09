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

// ========================================================================
//  GEMINI SETUP — BULLETPROOF FREE-TIER CONFIGURATION
// ========================================================================

// BEST free model with 1M token window
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite"
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ========================================================================
//  CLI HELPERS
// ========================================================================
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ========================================================================
//  BULLETPROOF GEMINI CALL ENGINE (FREE-TIER SAFE)
// ========================================================================
async function callGemini(prompt) {
  let lastError = null;

  for (const model of MODEL_CHAIN) {
    console.log(`\n⚡ Trying model: ${model}`);

    try {
      const m = genAI.getGenerativeModel({ model });
      const result = await m.generateContent(prompt);
      const text = result.response.text();

      if (!text || !text.trim()) {
        console.log(`⚠ Model ${model} returned empty text → trying next`);
        continue;
      }

      console.log(`✅ SUCCESS with ${model}`);
      return text;
    } catch (err) {
      const status = err?.status;
      lastError = err;

      // Log failure
      console.log(`❌ Model ${model} failed (status ${status}): ${err.message}`);

      // QUOTA EXHAUSTED → Switch immediately
      if (status === 429) {
        console.log(`🔄 QUOTA EXHAUSTED for ${model} → switching`);
        continue;
      }

      // Transient errors → retry same model with backoff
      if (status === 500 || status === 503) {
        console.log(`🔁 Retrying ${model} after backoff...`);
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }

      // Any other error → skip
      console.log(`⏭ Non-recoverable error → skipping model`);
      continue;
    }
  }

  throw (
    lastError ||
    new Error("All models failed or produced no output.")
  );
}

// ========================================================================
//  TEXT HELPERS
// ========================================================================
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

// ========================================================================
//  DOCX BUILDER (Calibiri + fully preserved formatting)
// ========================================================================
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

  // -------------------- HEADER (FIXED) --------------------
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
      children: [run("Hyderabad, India | 8520977573 | keshav.karn@gmail.com")],
      spacing: { after: 20 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        run(
          "LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn"
        ),
      ],
      spacing: { after: 20 },
    })
  );

  // -------------------- SUMMARY --------------------
  if (SUMMARY) {
    children.push(heading("PROFESSIONAL SUMMARY"));
    splitLines(SUMMARY).forEach((l) =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  // -------------------- ACHIEVEMENTS --------------------
  if (ACH) {
    children.push(heading("ACHIEVEMENTS"));
    splitLines(ACH).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  // -------------------- CORE SKILLS --------------------
  if (CORE) {
    children.push(heading("CORE SKILLS"));
    children.push(
      new Paragraph({
        children: [run(splitLines(CORE).join(" | "))],
        spacing: { after: 120 },
      })
    );
  }

  // -------------------- EXPERIENCE --------------------
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

  // -------------------- PROJECTS --------------------
  if (PROJ && PROJ.trim()) {
    children.push(heading("PROJECTS"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-"))
        children.push(bullet(line.replace(/^-+\s*/, "")));
      else
        children.push(
          new Paragraph({ children: [run(line)], spacing: { after: 80 } })
        );
    });
  }

  // -------------------- TECHNICAL SKILLS --------------------
  if (TECH) {
    children.push(heading("TECHNICAL SKILLS"));
    splitLines(TECH).forEach((l) =>
      children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } }))
    );
  }

  // -------------------- CERTIFICATIONS --------------------
  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((l) =>
      children.push(bullet(l.replace(/^-+\s*/, "")))
    );
  }

  // -------------------- EDUCATION --------------------
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

// ========================================================================
//  MAIN PIPELINE
// ========================================================================
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

  // ===========================
  // 1️⃣ REVIEW STAGE (calls Gemini)
  // ===========================
  const reviewPrompt = `
You are a senior recruiter performing a strict evaluation of a candidate applying for a high-level technology leadership role.

You MUST identify:
• Missing alignment between summary and JD  
• Missing keywords for Agentic AI / SRE / Cloud / FinOps / Leadership  
• Weak bullets lacking measurable impact  
• Tone mismatches (seniority not reflected)  
• Sections too long, vague, or irrelevant  
• Any ATS risks  
• Whether PROJECTS are relevant or should be suppressed  
• Whether SUMMARY needs a final “fit for role” line  

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

  console.log("\n📌 Running REVIEW stage...");
  let review = await callGemini(reviewPrompt);
  if (!review.includes("[REVIEW]")) {
    review = "[REVIEW]\n(No review returned)\n[/REVIEW]";
  }

  // ===========================
  // 2️⃣ IMPROVEMENT STAGE
  // ===========================
  const improvePrompt = `
${systemPrompt}

Rewrite the resume using:
- REVIEW_NOTES
- JOB_DESCRIPTION
- ORIGINAL_RESUME

REVIEW_NOTES:
${review}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${raw}

OUTPUT STRICTLY AS TAGGED RESUME ONLY. NO COMMENTARY.
`;

  console.log("\n📌 Running IMPROVEMENT stage...");
  const improved = await callGemini(improvePrompt);

  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "review.txt"), review, "utf8");
  fs.writeFileSync(path.join(outDir, "refined_raw.txt"), improved, "utf8");

  console.log("\n📌 Building DOCX...");
  await buildDocx(improved, path.join(outDir, "refined_resume.docx"));

  console.log("\n🎉 Resume refinement COMPLETE.");
}

main().catch((err) => {
  console.error("\n❌ FATAL ERROR:", err);
  process.exit(1);
});
